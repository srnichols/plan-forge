import { randomUUID } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { message, L2_ACK_ERRORS, L2_APPLIED_MESSAGE, L2_PACKET_KIND, READ_ERRORS } from "./messages.mjs";
import { renewGrant } from "./lease-grant.mjs";
import { createLeaseStream, enqueueLeaseEvent } from "./registry-stream.mjs";
import { createApplicationTransfer, collectApplicationChunk, matchesApplicationAck } from "./l2-ack.mjs";
import { L2_ERROR_CODES, L2_MAX_DELTA_BYTES, L2_SYNC_INCOMPLETE } from "../memory/l2-sync.mjs";

const DEFAULTS = Object.freeze({
  leaseMs: 60_000, ackMs: 10_000, maxAttempts: 2, maxReplay: 1000, requireL2: false,
});
const transferKey = (identity) => `${identity.deltaId}\0${identity.sha256Total}`;

function isHistoryArtifact(entry, event) {
  return entry.kind === "job" && event.type === "artifact" && event.data.kind === L2_PACKET_KIND;
}

class WorkerRegistry {
  constructor(options) {
    const { onEvent: emitEvent = () => {}, ...settings } = options;
    Object.assign(this, DEFAULTS, {
      now: Date.now, setTimeoutFn: setTimeout, clearTimeoutFn: clearTimeout,
    }, settings);
    this.emitEvent = emitEvent;
    this.workers = new Map();
    this.pending = new Map();
    this.leases = new Map();
    this.recentLeases = new Map();
    this.jobs = new Map();
    this.jobScopes = new Map();
    this.completions = new Map();
    this.completionWaiters = new Map();
    this.stats = { staleDropped: 0, duplicatesDropped: 0 };
    this.closed = false;
  }

  queueFor(laneId) {
    if (!this.pending.has(laneId)) this.pending.set(laneId, []);
    return this.pending.get(laneId);
  }

  terminal(entry, data) {
    return {
      v: 1, jobId: entry.jobId, seq: entry.lastSeq + 1,
      ts: new Date(this.now()).toISOString(), type: "finished", data,
    };
  }

  complete(entry, event) {
    if (entry.finished) return;
    entry.finished = true;
    entry.lastSeq = Math.max(entry.lastSeq, event.seq);
    enqueueLeaseEvent(entry, event);
    for (const listener of entry.listeners) {
      for (const wake of listener.waiters.splice(0)) wake({ value: undefined, done: true });
    }
    this.recordCompletion(entry, this.completionFor(entry, event));
    for (const lease of [...this.leases.values()]) if (lease.entry === entry) this.removeLease(lease);
    this.revokeScope(entry.jobId);
    const queue = this.queueFor(entry.laneId);
    const index = queue.indexOf(entry);
    if (index >= 0) queue.splice(index, 1);
    this.jobs.delete(entry.jobId);
  }

  completionFor(entry, event) {
    const active = [...this.leases.values()].find((lease) => lease.entry === entry);
    const applicationAck = entry.application?.ack ?? null;
    return {
      jobId: entry.jobId, projectId: entry.payload.projectId,
      leaseId: active?.leaseId ?? entry.lastLeaseId, attempt: entry.attempt, event,
      applicationAck,
      ok: event.data.status === "succeeded" && (!this.requireL2 || applicationAck?.ok === true),
    };
  }

  recordCompletion(entry, completion) {
    this.completions.set(entry.jobId, completion);
    while (this.completions.size > this.maxReplay) this.completions.delete(this.completions.keys().next().value);
    for (const resolve of this.completionWaiters.get(entry.jobId) ?? []) resolve(structuredClone(completion));
    this.completionWaiters.delete(entry.jobId);
  }

  fail(entry, data) {
    const event = this.terminal(entry, data);
    this.emitEvent(event);
    this.complete(entry, event);
  }

  removeLease(lease) {
    this.clearTimeoutFn(lease.timer);
    this.leases.delete(lease.leaseId);
    this.workers.get(lease.workerId)?.leases.delete(lease.leaseId);
  }

  armLease(lease, duration) {
    this.clearTimeoutFn(lease.timer);
    lease.timer = this.setTimeoutFn(() => this.expire(lease), duration);
    lease.timer?.unref?.();
  }

  send(worker, packet) {
    try {
      worker.send(packet);
      return true;
    } catch {
      this.disconnect(worker.workerId, "SEND_FAILED");
      return false;
    }
  }

  eligible(worker, entry) {
    if (worker.laneId !== entry.laneId) return false;
    if (worker.jobScope) return entry.kind === "job" && entry.jobId === worker.jobScope.jobId
      && this.hasActiveJob(entry.laneId, entry.jobId);
    if (entry.kind === "read") return true;
    return worker.capabilities.projects.includes(entry.payload.projectId);
  }

  expire(lease) {
    if (this.leases.get(lease.leaseId) !== lease) return;
    this.removeLease(lease);
    const entry = lease.entry;
    if (entry.finished) return;
    if (entry.cancelled) {
      this.fail(entry, { status: "cancelled", error: "JOB_CANCELLED" });
      return;
    }
    if (lease.attempt < this.maxAttempts) {
      entry.attempt = lease.attempt + 1;
      this.queueFor(entry.laneId).unshift(entry);
      this.dispatch(entry.laneId);
    } else this.fail(entry, { status: "failed", code: "LEASE_LOST" });
  }

  leasePayload(worker, entry, lease) {
    if (entry.kind === "read") return { request: { ...entry.payload, requestId: entry.jobId } };
    const { leaseGrant, ...job } = entry.payload;
    if (!this.signLease) return { job };
    const renewed = renewGrant({
      grant: leaseGrant, now: this.now, deadlineMs: this.jobScopes.get(entry.jobId)?.deadlineMs,
    });
    const grant = this.signLease({
      worker: { ...worker, id: worker.workerId },
      grant: { ...renewed, leaseId: lease.leaseId, attempt: lease.attempt },
    });
    return { job, grant };
  }

  sendLease(worker, entry) {
    const resumed = entry.lastWorkerId === worker.workerId;
    const lease = {
      leaseId: randomUUID(), entry, workerId: worker.workerId, attempt: entry.attempt,
      seqBase: resumed ? entry.seqBase : entry.lastSeq, lastSeq: entry.lastSeq,
      acked: false, timer: null,
    };
    let payload;
    try {
      payload = this.leasePayload(worker, entry, lease);
    } catch {
      this.fail(entry, { status: "failed", error: "LEASE_GRANT_UNAVAILABLE" });
      return;
    }
    if (!resumed) entry.application = null;
    entry.lastWorkerId = worker.workerId;
    entry.seqBase = lease.seqBase;
    entry.lastLeaseId = lease.leaseId;
    entry.usedWorkers.add(worker.workerId);
    this.leases.set(lease.leaseId, lease);
    worker.leases.add(lease.leaseId);
    this.armLease(lease, this.ackMs);
    this.send(worker, message("lease", {
      leaseId: lease.leaseId, attempt: lease.attempt, kind: entry.kind, expiresAt: this.now() + this.leaseMs,
      seqBase: lease.seqBase, lastSeq: lease.lastSeq, resume: resumed, ...payload,
    }));
  }

  dispatch(laneId) {
    if (this.closed) return;
    const queue = this.queueFor(laneId);
    while (queue.length) {
      const available = [...this.workers.values()];
      const readIndex = queue.findIndex((entry) => entry.kind === "read"
        && available.some((worker) => this.eligible(worker, entry)));
      if (readIndex >= 0) {
        const [entry] = queue.splice(readIndex, 1);
        this.sendLease(available.find((worker) => this.eligible(worker, entry)), entry);
        continue;
      }
      const busy = [...this.leases.values()].some((lease) => lease.entry.laneId === laneId
        && lease.entry.kind === "job" && !this.workers.get(lease.workerId)?.jobScope);
      const eligible = (entry) => available.filter((worker) => this.eligible(worker, entry) && (!busy || worker.jobScope));
      const index = queue.findIndex((entry) => entry.kind === "job" && eligible(entry).length);
      if (index < 0) return;
      const [entry] = queue.splice(index, 1);
      const candidates = eligible(entry);
      const worker = candidates.find((candidate) => !entry.usedWorkers.has(candidate.workerId)) ?? candidates[0];
      this.sendLease(worker, entry);
    }
  }

  connect(workerId, info = {}) {
    if (this.closed) throw new ClawError("WORKER_SERVER_CLOSED");
    this.disconnect(workerId, "RECONNECTED");
    const worker = {
      workerId, send: info.send, laneId: info.laneId, capabilities: info.capabilities ?? { projects: [] },
      jobScope: info.jobScope, connection: info.connection, lastSeen: this.now(), leases: new Set(),
    };
    this.workers.set(workerId, worker);
    this.dispatch(worker.laneId);
    return { connected: true };
  }

  disconnect(workerId, reason = "DISCONNECTED") {
    const worker = this.workers.get(workerId);
    if (!worker) return { disconnected: false };
    this.workers.delete(workerId);
    for (const leaseId of [...worker.leases]) {
      const lease = this.leases.get(leaseId);
      if (lease) this.expire(lease);
    }
    return { disconnected: true, reason };
  }

  enqueue(laneId, { kind, job, request } = {}) {
    if (this.closed) throw new ClawError("WORKER_SERVER_CLOSED");
    if (!["job", "read"].includes(kind)) throw new ClawError("LEASE_BAD_KIND");
    const payload = kind === "job" ? job : request;
    if (!payload || typeof payload !== "object") throw new ClawError("LEASE_BAD_PAYLOAD");
    const jobId = kind === "job" ? payload.id : randomUUID();
    if (typeof jobId !== "string" || !jobId) throw new ClawError("LEASE_BAD_JOB");
    if (this.jobs.has(jobId)) throw new ClawError("JOB_DUPLICATE", { jobId });
    this.completions.delete(jobId);
    const entry = {
      jobId, laneId, kind, payload: structuredClone(payload), attempt: 1, lastSeq: 0, seqBase: 0,
      listeners: new Set(), pending: [], finished: false, maxReplay: this.maxReplay, usedWorkers: new Set(),
      application: null, applications: new Map(), applicationBytes: 0,
    };
    this.jobs.set(jobId, entry);
    const queue = this.queueFor(laneId);
    if (kind === "read") queue.unshift(entry);
    else queue.push(entry);
    this.dispatch(laneId);
    return { jobId, iterator: createLeaseStream(entry) };
  }

  currentLease({ leaseId, attempt, workerId }) {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.attempt !== attempt || lease.workerId !== workerId) {
      this.stats.staleDropped += 1;
      return null;
    }
    return lease;
  }

  onAck({ leaseId, attempt, workerId, seqBase }) {
    const lease = this.currentLease({ leaseId, attempt, workerId });
    if (!lease) return false;
    if (seqBase !== undefined) {
      if (!Number.isSafeInteger(seqBase) || seqBase < lease.seqBase || seqBase > lease.lastSeq) return false;
      lease.seqBase = seqBase;
      lease.entry.seqBase = seqBase;
    }
    lease.acked = true;
    this.armLease(lease, this.leaseMs);
    this.sendApplicationAck(lease);
    return true;
  }

  applicationFor(entry, chunk) {
    const key = transferKey(chunk);
    let transfer = entry.applications.get(key);
    if (!transfer) {
      if (entry.application && entry.application.ack?.ok !== true) throw new ClawError(L2_ACK_ERRORS.SCOPE);
      if (entry.applications.size >= this.maxReplay) throw new ClawError(L2_ERROR_CODES.DELTA_TOO_LARGE);
      transfer = createApplicationTransfer({
        jobId: entry.jobId, projectId: entry.payload.projectId, chunk, maxChunks: this.maxReplay,
      });
      entry.applications.set(key, transfer);
      entry.application = transfer;
    } else if (!entry.application) entry.application = transfer;
    return transfer;
  }

  collectL2(lease, event) {
    const entry = lease.entry;
    try {
      const transfer = this.applicationFor(entry, event.data);
      if (transfer.ack?.ok === false) {
        this.sendApplicationAck(lease, transfer);
        return;
      }
      const before = transfer.bytes;
      const ready = collectApplicationChunk(transfer, event.data);
      entry.applicationBytes += transfer.bytes - before;
      if (entry.applicationBytes > L2_MAX_DELTA_BYTES) throw new ClawError(L2_ERROR_CODES.DELTA_TOO_LARGE);
      if (ready && !transfer.pending && !transfer.ack) {
        transfer.pending = this.applyTransfer(entry, transfer);
      } else this.sendApplicationAck(lease, transfer);
    } catch (error) {
      entry.syncError = error instanceof ClawError ? error.code : L2_ACK_ERRORS.UNCONFIRMED;
      if (entry.application) entry.application.ack = { ...entry.application.identity, ok: false, code: entry.syncError };
      this.sendApplicationAck(lease);
    }
  }

  async applyTransfer(entry, transfer) {
    let ack;
    try {
      if (typeof this.applyL2 !== "function") throw new ClawError(L2_ACK_ERRORS.HOME_UNAVAILABLE);
      const candidate = await this.applyL2({
        ...transfer.identity, chunks: [...transfer.chunks.values()].map((chunk) => structuredClone(chunk)),
      });
      if (!matchesApplicationAck(transfer.identity, candidate)) throw new ClawError(L2_ACK_ERRORS.UNCONFIRMED);
      ack = candidate;
    } catch (error) {
      ack = { ...transfer.identity, ok: false, code: error instanceof ClawError ? error.code : L2_ACK_ERRORS.HOME_UNAVAILABLE };
    }
    if (transfer.ack || !entry.applications.has(transferKey(transfer.identity)) || entry.finished) return;
    transfer.ack = { ...transfer.identity, ok: ack.ok === true, ...(ack.ok ? {} : { code: ack.code }) };
    const lease = [...this.leases.values()].find((item) => item.entry === entry);
    if (lease) this.sendApplicationAck(lease, transfer);
  }

  sendApplicationAck(lease, transfer = lease.entry.application) {
    const ack = transfer?.ack;
    const worker = this.workers.get(lease.workerId);
    if (!worker || !ack || !lease.acked) return;
    this.send(worker, message(L2_APPLIED_MESSAGE, { ...ack, leaseId: lease.leaseId, attempt: lease.attempt }));
  }

  needsApplicationAck(entry, event) {
    return entry.kind === "job" && event.data.status === "succeeded"
      && (this.requireL2 || Boolean(entry.application));
  }

  checkedTerminal(entry, event) {
    if (entry.cancelled) return { ...event, data: { ...event.data, status: "cancelled", error: "JOB_CANCELLED" } };
    if (!this.needsApplicationAck(entry, event)) return event;
    const ack = entry.application?.ack;
    if (ack?.ok === true && matchesApplicationAck(entry.application.identity, event.data.l2)) return event;
    return { ...event, data: {
      ...event.data, status: "failed", reason: L2_SYNC_INCOMPLETE,
      l2: { ok: false, code: ack?.code ?? entry.syncError ?? L2_ACK_ERRORS.UNCONFIRMED },
    } };
  }

  onEvent({ leaseId, attempt, workerId, event }) {
    const lease = this.currentLease({ leaseId, attempt, workerId });
    if (!lease) return false;
    const entry = lease.entry;
    if (event.jobId !== entry.jobId || !Number.isSafeInteger(event.seq) || event.seq < 1) {
      this.stats.staleDropped += 1;
      return false;
    }
    if (event.seq <= entry.lastSeq) {
      this.stats.duplicatesDropped += 1;
      return false;
    }
    if (event.seq > entry.lastSeq + 1 && entry.lastSeq > 0) {
      const gap = { ...event, seq: entry.lastSeq + 1, type: "log", data: { code: "SEQ_GAP" } };
      if (!this.onEventCallback(entry, gap)) return false;
    }
    entry.lastSeq = event.seq;
    if (isHistoryArtifact(entry, event)) {
      this.collectL2(lease, event);
    }
    if (event.type !== "finished") {
      return this.onEventCallback(entry, event);
    }
    const terminal = this.checkedTerminal(entry, event);
    this.emitEvent(terminal);
    this.recentLeases.set(leaseId, { workerId, attempt, lastSeq: entry.lastSeq, recordedAt: this.now() });
    while (this.recentLeases.size > this.maxReplay) this.recentLeases.delete(this.recentLeases.keys().next().value);
    this.complete(entry, terminal);
    this.dispatch(entry.laneId);
    return true;
  }

  onEventCallback(entry, event) {
    if (!enqueueLeaseEvent(entry, event)) {
      for (const lease of this.leases.values()) {
        if (lease.entry === entry) {
          const worker = this.workers.get(lease.workerId);
          if (worker) this.send(worker, message("cancel", { jobId: entry.jobId }));
        }
      }
      this.fail(entry, {
        status: "failed", reason: L2_SYNC_INCOMPLETE,
        l2: { ok: false, code: L2_ACK_ERRORS.BUFFER_FULL },
      });
      this.dispatch(entry.laneId);
      return false;
    }
    this.emitEvent(event);
    return true;
  }

  onHeartbeat({ workerId, leases: reports = [] }) {
    const worker = this.workers.get(workerId);
    if (!worker) return [];
    worker.lastSeen = this.now();
    return reports.flatMap((report) => {
      const lease = this.leases.get(report.leaseId);
      if (!lease || lease.attempt !== report.attempt || lease.workerId !== workerId) {
        const recent = this.recentLeases.get(report.leaseId);
        return recent?.attempt === report.attempt && recent.workerId === workerId ? [{
          leaseId: report.leaseId, attempt: report.attempt, lastSeq: recent.lastSeq,
        }] : [];
      }
      this.armLease(lease, this.leaseMs);
      this.sendApplicationAck(lease);
      return [{ leaseId: lease.leaseId, attempt: lease.attempt, lastSeq: lease.entry.lastSeq }];
    });
  }

  cancel(jobId) {
    const entry = this.jobs.get(jobId);
    if (!entry) return { ok: false, error: "JOB_UNKNOWN" };
    entry.cancelled = true;
    const queue = this.queueFor(entry.laneId);
    if (queue.includes(entry)) {
      this.fail(entry, { status: "cancelled" });
      return { ok: true, state: "cancelled" };
    }
    for (const lease of this.leases.values()) {
      if (lease.entry !== entry) continue;
      const worker = this.workers.get(lease.workerId);
      if (worker) this.send(worker, message("cancel", entry.kind === "read" ? { leaseId: lease.leaseId } : { jobId }));
    }
    if (entry.kind === "read") {
      this.fail(entry, { status: "failed", code: READ_ERRORS.CANCELLED });
      return { ok: true, state: "cancelled" };
    }
    this.revokeScope(jobId);
    return { ok: true, state: "cancelling" };
  }

  revokeScope(jobId) {
    const scope = this.jobScopes.get(jobId);
    if (scope) this.clearTimeoutFn(scope.timer);
    this.jobScopes.delete(jobId);
  }

  hasActiveJob(laneId, jobId) {
    const scope = this.jobScopes.get(jobId);
    return Boolean(scope && scope.laneId === laneId && scope.deadlineMs > this.now() && !this.jobs.get(jobId)?.finished);
  }

  registerPending(laneId, jobId, { deadlineMs }) {
    if (this.closed || this.jobScopes.has(jobId) || !Number.isFinite(deadlineMs) || deadlineMs <= this.now()) {
      throw new ClawError("WORKER_JOB_UNKNOWN");
    }
    const scope = { laneId, deadlineMs, timer: null };
    this.jobScopes.set(jobId, scope);
    scope.timer = this.setTimeoutFn(() => {
      this.revokeScope(jobId);
      const entry = this.jobs.get(jobId);
      if (entry) this.fail(entry, { status: "failed", reason: "deadline" });
    }, deadlineMs - this.now());
    scope.timer?.unref?.();
  }

  revoke(id) {
    if (this.jobScopes.has(id) || this.jobs.has(id)) {
      this.cancel(id);
      const entry = this.jobs.get(id);
      if (entry) this.fail(entry, { status: "cancelled" });
      this.revokeScope(id);
      return { ok: true };
    }
    const worker = this.workers.get(id);
    if (worker) this.send(worker, { closeCode: 4403, message: message("bye", { reason: "WORKER_REVOKED" }) });
    return this.disconnect(id, "REVOKED");
  }

  snapshot() {
    const byLane = {};
    const laneIds = new Set([...this.workers.values()].map((worker) => worker.laneId));
    for (const laneId of this.pending.keys()) laneIds.add(laneId);
    for (const laneId of laneIds) byLane[laneId] = {
      connected: [...this.workers.values()].filter((worker) => worker.laneId === laneId).length,
      pending: this.pending.get(laneId)?.length ?? 0,
      active: [...this.leases.values()].filter((lease) => lease.entry.laneId === laneId).length,
    };
    return { workers: this.workers.size, byLane, stats: { ...this.stats } };
  }

  waitForCompletion({ jobId, timeoutMs = 30_000, signal } = {}) {
    if (signal?.aborted) return Promise.reject(new ClawError("JOB_CANCELLED"));
    if (this.completions.has(jobId)) return Promise.resolve(structuredClone(this.completions.get(jobId)));
    if (!this.jobs.has(jobId)) return Promise.reject(new ClawError("JOB_UNKNOWN"));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new ClawError("L2_MALFORMED"));
    return new Promise((resolve, reject) => {
      const waiters = this.completionWaiters.get(jobId) ?? new Set();
      this.completionWaiters.set(jobId, waiters);
      const finish = (value, error) => {
        this.clearTimeoutFn(timer);
        signal?.removeEventListener("abort", abort);
        waiters.delete(complete);
        if (!waiters.size) this.completionWaiters.delete(jobId);
        if (error) reject(error);
        else resolve(value);
      };
      const complete = (value) => finish(value);
      const abort = () => finish(null, new ClawError("JOB_CANCELLED"));
      const timer = this.setTimeoutFn(() => finish(null, new ClawError(L2_ACK_ERRORS.TIMEOUT)), timeoutMs);
      timer?.unref?.();
      waiters.add(complete);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.jobs.values()) this.fail(entry, { status: "failed", code: "SERVER_CLOSED" });
    for (const lease of this.leases.values()) this.clearTimeoutFn(lease.timer);
    this.leases.clear();
    this.workers.clear();
    this.pending.clear();
    this.recentLeases.clear();
    for (const jobId of this.jobScopes.keys()) this.revokeScope(jobId);
  }
}

/** Registry owns transport fencing; applyL2 is installed by the canonical-home composition root. */
export function createWorkerRegistry(options = {}) {
  const registry = new WorkerRegistry(options);
  const ports = [
    "connect", "disconnect", "enqueue", "dispatch", "onAck", "onEvent", "onHeartbeat", "cancel", "revoke",
    "close", "snapshot", "hasActiveJob", "registerPending", "waitForCompletion",
  ];
  return {
    ...Object.fromEntries(ports.map((name) => [name, registry[name].bind(registry)])),
    stats: registry.stats, leaseMs: registry.leaseMs, ackMs: registry.ackMs,
    current: (id) => registry.workers.get(id)?.connection,
    completion: (id) => structuredClone(registry.completions.get(id) ?? null),
    setL2Receiver(receive) {
      if (typeof receive !== "function") throw new ClawError("L2_MALFORMED");
      registry.applyL2 = receive;
    },
  };
}
