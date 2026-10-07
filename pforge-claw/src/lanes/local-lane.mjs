import { JOB_TYPES } from "../enums.mjs";
import { isMutating } from "../jobs/model.mjs";
import { ClawError } from "../errors.mjs";
import { createLaneEvent, createSeqCounter, assertLane } from "./lane.mjs";

export const DEFAULT_MAX_HEAVY = 2;

function configuredMaxHeavy(config) {
  const lanes = config?.lanes;
  if (Array.isArray(lanes)) return lanes.find((lane) => lane?.kind === "local")?.maxHeavy;
  return lanes?.local?.maxHeavy;
}

export function resolveMaxHeavy({ maxHeavy, config } = {}) {
  const configured = configuredMaxHeavy(config);
  const resolved = maxHeavy !== undefined
    ? maxHeavy
    : configured !== undefined ? configured : DEFAULT_MAX_HEAVY;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new ClawError("LANE_BAD_CONFIG", { field: "maxHeavy" });
  }
  return resolved;
}

function semaphoreRelease(semaphore) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    semaphore.inUse -= 1;
    while (semaphore.waiters.length && semaphore.inUse < semaphore.capacity) {
      const waiter = semaphore.waiters.shift();
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        waiter.reject(new ClawError("JOB_CANCELLED"));
        continue;
      }
      semaphore.inUse += 1;
      waiter.resolve(semaphoreRelease(semaphore));
    }
  };
}

export function createSemaphore(capacity) {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new ClawError("LANE_BAD_CONFIG", { field: "maxHeavy" });
  }
  const semaphore = { capacity, inUse: 0, waiters: [] };
  return {
    acquire({ signal } = {}) {
      if (signal?.aborted) return Promise.reject(new ClawError("JOB_CANCELLED"));
      if (semaphore.inUse < capacity && semaphore.waiters.length === 0) {
        semaphore.inUse += 1;
        return Promise.resolve(semaphoreRelease(semaphore));
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, signal, onAbort: undefined };
        waiter.onAbort = () => {
          const index = semaphore.waiters.indexOf(waiter);
          if (index >= 0) semaphore.waiters.splice(index, 1);
          signal?.removeEventListener("abort", waiter.onAbort);
          reject(new ClawError("JOB_CANCELLED"));
        };
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        semaphore.waiters.push(waiter);
      });
    },
    get inUse() {
      return semaphore.inUse;
    },
    get waiting() {
      return semaphore.waiters.length;
    },
  };
}

export function isHeavyJob(job) {
  if (typeof job?.heavy === "boolean") return job.heavy;
  if (typeof job?.mutating === "boolean") return job.mutating;
  return isMutating(job?.type, { readOnly: job?.readOnly });
}

function createEntry(job) {
  return {
    job,
    controller: new AbortController(),
    buffer: [],
    waiters: [],
    state: "queued",
    nextSeq: createSeqCounter(),
    finished: false,
  };
}

function deliver(entry, event) {
  const waiter = entry.waiters.shift();
  if (waiter) waiter({ value: event, done: false });
  else entry.buffer.push(event);
}

function pushEvent(entry, type, data, { now, bus }) {
  const event = createLaneEvent({
    jobId: entry.job.id,
    seq: entry.nextSeq(),
    type,
    data,
    now,
  });
  bus?.emit("lane.event", event);
  if (entry.waiters.length) {
    deliver(entry, event);
    return;
  }
  entry.buffer.push(event);
  if (entry.buffer.length > 500) {
    const dropIndex = entry.buffer.findIndex((item) => item.type === "progress" || item.type === "log");
    if (dropIndex >= 0) entry.buffer.splice(dropIndex, 1);
  }
}

function finishEntry(entry, status, error, options) {
  if (entry.finished) return;
  entry.finished = true;
  entry.state = "finished";
  const data = { status, usage: entry.usage ?? null };
  if (error !== undefined) data.error = error;
  pushEvent(entry, "finished", data, options);
  for (const wake of entry.waiters.splice(0)) wake({ value: undefined, done: true });
}

function createEventStream(entry, cancel) {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (entry.buffer.length) return Promise.resolve({ value: entry.buffer.shift(), done: false });
          if (entry.finished) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => entry.waiters.push(resolve));
        },
        async return() {
          if (!entry.finished) await cancel(entry.job.id);
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function removeProjectIfIdle(projects, projectId, project) {
  if (!project.active && project.queue.length === 0) projects.delete(projectId);
}

function errorCode(error) {
  return error instanceof ClawError ? error.code : "RUNTIME_FAILED";
}

export function createLocalLane({
  id = "local",
  runtime,
  runtimeFor,
  config,
  maxHeavy,
  semaphore,
  bus,
  now = Date.now,
} = {}) {
  const heavyLimit = resolveMaxHeavy({ maxHeavy, config });
  const permits = semaphore ?? createSemaphore(heavyLimit);
  const projects = new Map();
  const jobs = new Map();
  const eventOptions = { now, bus };

  function removeEntry(entry) {
    jobs.delete(entry.job.id);
    const project = projects.get(entry.job.projectId);
    if (!project) return;
    if (project.active === entry) project.active = null;
    removeProjectIfIdle(projects, entry.job.projectId, project);
  }

  async function pump(projectId) {
    const project = projects.get(projectId);
    if (!project || project.active || project.queue.length === 0) return;
    const entry = project.queue.shift();
    project.active = entry;
    let release;
    try {
      if (isHeavyJob(entry.job)) {
        entry.state = "waiting";
        release = await permits.acquire({ signal: entry.controller.signal });
      }
      if (entry.controller.signal.aborted) {
        finishEntry(entry, "cancelled", undefined, eventOptions);
        return;
      }
      entry.state = "running";
      pushEvent(entry, "started", {}, eventOptions);
      const agent = runtimeFor ? await runtimeFor(entry.job) : runtime;
      if (!agent || typeof agent.run !== "function") throw new ClawError("RUNTIME_BAD_CONTRACT");
      const result = await agent.run({
        ...entry.job,
        jobId: entry.job.id,
        signal: entry.controller.signal,
        emit: (type, data) => pushEvent(entry, type, data, eventOptions),
      });
      entry.usage = result?.usage;
      const status = entry.controller.signal.aborted ? "cancelled" : result?.status ?? "succeeded";
      finishEntry(entry, status, result?.error, eventOptions);
    } catch (error) {
      const status = entry.controller.signal.aborted ? "cancelled" : "failed";
      finishEntry(entry, status, status === "failed" ? errorCode(error) : undefined, eventOptions);
    } finally {
      release?.();
      removeEntry(entry);
      void pump(projectId);
    }
  }

  async function cancel(jobId) {
    const entry = jobs.get(jobId);
    if (!entry) return { ok: false, error: "JOB_UNKNOWN" };
    const project = projects.get(entry.job.projectId);
    const queueIndex = project?.queue.indexOf(entry) ?? -1;
    if (queueIndex >= 0) {
      project.queue.splice(queueIndex, 1);
      finishEntry(entry, "cancelled", undefined, eventOptions);
      jobs.delete(jobId);
      removeProjectIfIdle(projects, entry.job.projectId, project);
      return { ok: true, state: "cancelled" };
    }
    entry.controller.abort();
    if (entry.state === "running" || entry.state === "cancelling") {
      entry.state = "cancelling";
      return { ok: true, state: "cancelling" };
    }
    return { ok: true, state: "cancelling" };
  }

  function submit(job) {
    if (!job || typeof job.id !== "string" || !job.id
      || typeof job.projectId !== "string" || !job.projectId) {
      throw new ClawError("JOB_BAD_FIELD", { field: "id/projectId" });
    }
    if (jobs.has(job.id)) throw new ClawError("JOB_DUPLICATE", { jobId: job.id });
    const entry = createEntry(job);
    jobs.set(job.id, entry);
    let project = projects.get(job.projectId);
    if (!project) {
      project = { queue: [], active: null };
      projects.set(job.projectId, project);
    }
    project.queue.push(entry);
    void pump(job.projectId);
    return createEventStream(entry, cancel);
  }

  function health() {
    let queued = 0;
    let running = 0;
    for (const project of projects.values()) {
      queued += project.queue.length;
      if (project.active?.state === "running") running += 1;
      if (project.active?.state === "waiting") queued += 1;
    }
    return {
      ok: true,
      kind: "local",
      id,
      queued,
      running,
      heavyInUse: permits.inUse,
      maxHeavy: heavyLimit,
    };
  }

  return assertLane({
    kind: "local",
    id,
    capabilities: { jobTypes: JOB_TYPES, heavy: true },
    submit,
    cancel,
    health,
  });
}
