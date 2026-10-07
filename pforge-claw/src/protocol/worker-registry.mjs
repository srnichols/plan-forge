import { randomUUID } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { message } from "./messages.mjs";

function createJob({ jobId, laneId, kind, payload, attempt = 1, maxReplay }) {
  return {
    jobId, laneId, kind, payload, attempt, lastSeq: 0, listeners: new Set(), pending: [],
    waiters: [], finished: false, maxReplay, usedWorkers: new Set(),
  };
}

function enqueueEvent(job, event) {
  if (job.listeners.size === 0) {
    job.pending.push(event);
    if (job.pending.length > job.maxReplay) job.pending.shift();
    return;
  }
  for (const listener of job.listeners) {
    if (listener.waiters.length) listener.waiters.shift()({ value: event, done: false });
    else listener.pending.push(event);
  }
}

export function createWorkerRegistry({
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  leaseMs = 60_000,
  ackMs = 10_000,
  maxAttempts = 2,
  maxReplay = 1000,
  onEvent: emitEvent = () => {},
} = {}) {
  const workers = new Map();
  const pending = new Map();
  const leases = new Map();
  const recentLeases = new Map();
  const jobs = new Map();
  const counters = { staleDropped: 0, duplicatesDropped: 0 };
  let closed = false;

  function queueFor(laneId) {
    if (!pending.has(laneId)) pending.set(laneId, []);
    return pending.get(laneId);
  }

  function complete(entry, event) {
    if (entry.finished) return;
    entry.finished = true;
    enqueueEvent(entry, event);
    for (const waiter of entry.waiters.splice(0)) waiter({ value: undefined, done: true });
    jobs.delete(entry.jobId);
  }

  function removeLease(lease) {
    clearTimeoutFn(lease.timer);
    leases.delete(lease.leaseId);
    const worker = workers.get(lease.workerId);
    worker?.leases.delete(lease.leaseId);
  }

  function send(worker, value) {
    try {
      worker.send(value);
      return true;
    } catch {
      disconnect(worker.workerId, "SEND_FAILED");
      return false;
    }
  }

  function eligible(worker, entry) {
    if (worker.laneId !== entry.laneId) return false;
    if (entry.kind === "read") return true;
    return worker.capabilities.projects.includes(entry.payload.projectId);
  }

  function expire(lease) {
    if (leases.get(lease.leaseId) !== lease) return;
    removeLease(lease);
    const entry = lease.entry;
    if (entry.finished) return;
    if (lease.attempt < maxAttempts) {
      entry.attempt = lease.attempt + 1;
      queueFor(entry.laneId).unshift(entry);
      dispatch(entry.laneId);
      return;
    }
    const event = {
      v: 1, jobId: entry.jobId, seq: Math.max(1, entry.lastSeq + 1),
      ts: new Date(now()).toISOString(), type: "finished",
      data: { status: "failed", code: "LEASE_LOST" },
    };
    entry.lastSeq = event.seq;
    emitEvent(event);
    complete(entry, event);
  }

  function sendLease(worker, entry) {
    entry.usedWorkers.add(worker.workerId);
    const leaseId = randomUUID();
    const lease = {
      leaseId, entry, workerId: worker.workerId, attempt: entry.attempt,
      acked: false, timer: null,
    };
    leases.set(leaseId, lease);
    worker.leases.add(leaseId);
    const fields = {
      leaseId, attempt: lease.attempt, kind: entry.kind,
      expiresAt: now() + leaseMs,
      ...(entry.kind === "job"
        ? { job: entry.payload }
        : { request: { ...entry.payload, requestId: entry.jobId } }),
    };
    if (!send(worker, message("lease", fields))) return;
    lease.timer = setTimeoutFn(() => expire(lease), ackMs);
    lease.timer?.unref?.();
  }

  function dispatch(laneId) {
    if (closed) return;
    const queue = queueFor(laneId);
    while (queue.length) {
      const readIndex = queue.findIndex((entry) => entry.kind === "read"
        && [...workers.values()].some((worker) => eligible(worker, entry)));
      if (readIndex >= 0) {
        const [readEntry] = queue.splice(readIndex, 1);
        const readWorker = [...workers.values()].find((candidate) => eligible(candidate, readEntry));
        sendLease(readWorker, readEntry);
        continue;
      }
      if ([...leases.values()].some((lease) => lease.entry.laneId === laneId && lease.entry.kind === "job")) return;
      const index = queue.findIndex((entry) => entry.kind === "job");
      if (index < 0) return;
      const entry = queue[index];
      const availableWorkers = [...workers.values()].filter((candidate) => eligible(candidate, entry));
      if (availableWorkers.length === 0) return;
      queue.splice(index, 1);
      const worker = availableWorkers.find((candidate) => !entry.usedWorkers.has(candidate.workerId))
        ?? availableWorkers[0];
      sendLease(worker, entry);
    }
  }

  function connect(workerId, info = {}) {
    if (closed) throw new ClawError("WORKER_SERVER_CLOSED");
    disconnect(workerId, "RECONNECTED");
    const worker = {
      workerId, send: info.send, laneId: info.laneId,
      capabilities: info.capabilities ?? { projects: [] },
      lastSeen: now(), leases: new Set(),
    };
    workers.set(workerId, worker);
    dispatch(worker.laneId);
    return { connected: true };
  }

  function disconnect(workerId, reason = "DISCONNECTED") {
    const worker = workers.get(workerId);
    if (!worker) return { disconnected: false };
    workers.delete(workerId);
    for (const leaseId of [...worker.leases]) {
      const lease = leases.get(leaseId);
      if (lease) expire(lease);
    }
    return { disconnected: true, reason };
  }

  function enqueue(laneId, { kind, job, request } = {}) {
    if (closed) throw new ClawError("WORKER_SERVER_CLOSED");
    if (!["job", "read"].includes(kind)) throw new ClawError("LEASE_BAD_KIND");
    const payload = kind === "job" ? job : request;
    if (!payload || typeof payload !== "object") throw new ClawError("LEASE_BAD_PAYLOAD");
    const jobId = kind === "job" ? payload.id : randomUUID();
    if (typeof jobId !== "string" || !jobId) throw new ClawError("LEASE_BAD_JOB");
    if (jobs.has(jobId)) throw new ClawError("JOB_DUPLICATE", { jobId });
    const entry = createJob({ jobId, laneId, kind, payload, maxReplay });
    jobs.set(jobId, entry);
    const iterator = {
      [Symbol.asyncIterator]() {
        const listener = { pending: entry.pending.splice(0), waiters: [], closed: false };
        entry.listeners.add(listener);
        return {
          next() {
            if (listener.pending.length) return Promise.resolve({ value: listener.pending.shift(), done: false });
            if (entry.finished || listener.closed) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => listener.waiters.push(resolve));
          },
          async return() {
            listener.closed = true;
            entry.listeners.delete(listener);
            for (const wake of listener.waiters.splice(0)) wake({ value: undefined, done: true });
            return { value: undefined, done: true };
          },
        };
      },
    };
    const queue = queueFor(laneId);
    if (kind === "read") queue.unshift(entry);
    else queue.push(entry);
    dispatch(laneId);
    return { jobId, iterator };
  }

  function currentLease({ leaseId, attempt }) {
    const lease = leases.get(leaseId);
    if (!lease || lease.attempt !== attempt) {
      counters.staleDropped += 1;
      return null;
    }
    return lease;
  }

  function onAck({ leaseId, attempt, workerId }) {
    const lease = currentLease({ leaseId, attempt });
    if (!lease || lease.workerId !== workerId) return false;
    lease.acked = true;
    clearTimeoutFn(lease.timer);
    lease.timer = setTimeoutFn(() => expire(lease), leaseMs);
    lease.timer?.unref?.();
    return true;
  }

  function onEvent({ leaseId, attempt, workerId, event }) {
    const lease = currentLease({ leaseId, attempt });
    if (!lease || lease.workerId !== workerId) return false;
    const entry = lease.entry;
    if (event.jobId !== entry.jobId) {
      counters.staleDropped += 1;
      return false;
    }
    if (event.seq <= entry.lastSeq && event.type !== "finished") {
      counters.duplicatesDropped += 1;
      return false;
    }
    if (event.seq > entry.lastSeq + 1 && entry.lastSeq > 0) {
      const gap = {
        ...event, seq: entry.lastSeq + 1, type: "log", data: { code: "SEQ_GAP" },
      };
      emitEvent(gap);
      enqueueEvent(entry, gap);
    }
    entry.lastSeq = Math.max(entry.lastSeq, event.seq);
    emitEvent(event);
    enqueueEvent(entry, event);
    if (event.type === "finished") {
      recentLeases.set(lease.leaseId, {
        workerId, attempt, lastSeq: entry.lastSeq, recordedAt: now(),
      });
      while (recentLeases.size > maxReplay) recentLeases.delete(recentLeases.keys().next().value);
      removeLease(lease);
      complete(entry, event);
      dispatch(entry.laneId);
    }
    return true;
  }

  function onHeartbeat({ workerId, leases: reports = [] }) {
    const worker = workers.get(workerId);
    if (!worker) return [];
    worker.lastSeen = now();
    return reports.flatMap((report) => {
      const lease = leases.get(report.leaseId);
      if (!lease || lease.attempt !== report.attempt || lease.workerId !== workerId) {
        const recent = recentLeases.get(report.leaseId);
        if (recent?.attempt === report.attempt && recent.workerId === workerId) {
          return [{ leaseId: report.leaseId, attempt: report.attempt, lastSeq: recent.lastSeq }];
        }
        return [];
      }
      clearTimeoutFn(lease.timer);
      lease.timer = setTimeoutFn(() => expire(lease), leaseMs);
      lease.timer?.unref?.();
      return [{ leaseId: lease.leaseId, attempt: lease.attempt, lastSeq: lease.entry.lastSeq }];
    });
  }

  function cancel(jobId) {
    const entry = jobs.get(jobId);
    if (!entry) return { ok: false, error: "JOB_UNKNOWN" };
    for (const [laneId, queue] of pending) {
      const index = queue.indexOf(entry);
      if (index >= 0) {
        queue.splice(index, 1);
        const event = {
          v: 1, jobId, seq: Math.max(1, entry.lastSeq + 1),
          ts: new Date(now()).toISOString(), type: "finished", data: { status: "cancelled" },
        };
        emitEvent(event);
        complete(entry, event);
        return { ok: true, state: "cancelled" };
      }
      if (laneId !== entry.laneId) continue;
    }
    for (const leaseId of [...leases.keys()]) {
      const lease = leases.get(leaseId);
      if (lease?.entry !== entry) continue;
      const worker = workers.get(lease.workerId);
      if (worker) send(worker, message("cancel", { jobId }));
    }
    return { ok: true, state: "cancelling" };
  }

  function revoke(workerId) {
    const worker = workers.get(workerId);
    if (worker) send(worker, { closeCode: 4403, message: message("bye", { reason: "WORKER_REVOKED" }) });
    return disconnect(workerId, "REVOKED");
  }

  function snapshot() {
    const byLane = {};
    const laneIds = new Set([...workers.values()].map((worker) => worker.laneId));
    for (const [laneId, queue] of pending) laneIds.add(laneId);
    for (const laneId of laneIds) {
      byLane[laneId] = {
        connected: [...workers.values()].filter((worker) => worker.laneId === laneId).length,
        pending: pending.get(laneId)?.length ?? 0,
        active: [...leases.values()].filter((lease) => lease.entry.laneId === laneId).length,
      };
    }
    return { workers: workers.size, byLane, stats: { ...counters } };
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const lease of leases.values()) clearTimeoutFn(lease.timer);
    leases.clear();
    for (const entry of jobs.values()) {
      complete(entry, {
        v: 1, jobId: entry.jobId, seq: Math.max(1, entry.lastSeq + 1),
        ts: new Date(now()).toISOString(), type: "finished", data: { status: "failed", code: "SERVER_CLOSED" },
      });
    }
    workers.clear();
    pending.clear();
    recentLeases.clear();
  }

  return {
    connect, disconnect, enqueue, dispatch, onAck, onEvent, onHeartbeat, cancel, revoke,
    close, snapshot, stats: counters, leaseMs, ackMs,
  };
}
