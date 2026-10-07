import { JOB_STATES, JOB_TYPES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";

export const JOBS_STREAM = "jobs";
export const READ_TYPES = Object.freeze(["ask", "capture"]);
export const TERMINAL = Object.freeze(["succeeded", "failed", "cancelled", "rejected", "expired"]);

function freezeDeep(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) freezeDeep(child);
  }
  return value;
}

const RUN_TAIL = freezeDeep({
  leased: ["running"],
  running: ["needs-input", "succeeded", "failed", "cancelled"],
  "needs-input": ["running"],
});

export const TRANSITIONS = Object.freeze({
  mutating: freezeDeep({
    queued: ["awaiting-approval"],
    "awaiting-approval": ["approved", "rejected", "expired"],
    approved: ["held-budget", "leased"],
    "held-budget": ["approved"],
    ...RUN_TAIL,
  }),
  read: freezeDeep({
    queued: ["leased"],
    ...RUN_TAIL,
  }),
});

export const TRANSITION_STATES = Object.freeze([...new Set([
  ...Object.keys(TRANSITIONS.mutating),
  ...Object.keys(TRANSITIONS.read),
  ...Object.values(TRANSITIONS).flatMap((table) => Object.values(table).flat()),
])].sort());

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isMutating(type, { readOnly } = {}) {
  if (READ_TYPES.includes(type)) return false;
  if (type === "skill") return readOnly !== true;
  return true;
}

function validIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value);
}

export function createJob({ id, type, projectId, readOnly, parentId }) {
  if (!JOB_TYPES.includes(type)) throw new ClawError("JOB_BAD_FIELD", { field: "type" });
  if (!validIdentifier(id)) throw new ClawError("JOB_BAD_FIELD", { field: "id" });
  if (!validIdentifier(projectId)) throw new ClawError("JOB_BAD_FIELD", { field: "projectId" });
  const job = {
    v: 1,
    id,
    type,
    projectId,
    readOnly: !!readOnly,
    mutating: isMutating(type, { readOnly }),
    parentId: parentId ?? null,
    state: "queued",
  };
  return { job, event: { kind: "job.created", job } };
}

export function transition(job, to, meta = {}) {
  if (!isPlainObject(meta)) throw new ClawError("JOB_BAD_META");
  const from = job.state;
  const table = TRANSITIONS[job.mutating ? "mutating" : "read"];
  if (!JOB_STATES.includes(to) || !table[from]?.includes(to)) {
    throw new ClawError("JOB_TRANSITION_ILLEGAL", {
      jobId: job.id,
      from,
      to,
      type: job.type,
    });
  }
  const reason = typeof meta.reason === "string" && meta.reason.length <= 200
    ? meta.reason
    : undefined;
  return {
    job: { ...job, state: to },
    event: { kind: "job.transition", jobId: job.id, from, to, reason },
  };
}

export function reduceJobs(acc, event) {
  if (event.kind === "job.created") {
    const { id } = event.job;
    if (Object.hasOwn(acc, id)) throw new ClawError("JOB_DUPLICATE", { jobId: id });
    return { ...acc, [id]: event.job };
  }
  if (event.kind === "job.transition") {
    const job = acc[event.jobId];
    if (!job) throw new ClawError("JOB_UNKNOWN", { jobId: event.jobId });
    if (event.from !== job.state) {
      throw new ClawError("JOB_REPLAY_MISMATCH", {
        jobId: event.jobId,
        from: event.from,
        state: job.state,
      });
    }
    return { ...acc, [event.jobId]: transition(job, event.to).job };
  }
  throw new ClawError("JOB_BAD_EVENT");
}

export function currentJobs(store, { useSnapshot = true } = {}) {
  void useSnapshot;
  return store.fold(JOBS_STREAM, reduceJobs, {});
}
