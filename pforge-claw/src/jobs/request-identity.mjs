import { randomBytes } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "./model.mjs";

const ID_BYTES = 12;
const REQUEST_FIELDS = Object.freeze([
  "adapter", "updateId", "type", "projectId", "callerId", "chatId", "threadId", "parentId",
]);
const chains = new Map();

function identityValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new ClawError("REQUEST_BAD_IDENTITY");
}

/** Normalizes all eight scalar fields even when there is no delivery key to deduplicate. */
export function normalizeRequestFields(input = {}) {
  return Object.fromEntries(REQUEST_FIELDS.map((field) => [field, identityValue(input?.[field])]));
}

/** A missing delivery ID denotes a distinct direct call, never a content-based identity. */
export function requestIdentity(input = {}) {
  if (input.updateId === undefined || input.updateId === null) return null;
  const identity = normalizeRequestFields(input);
  if (!identity.updateId) throw new ClawError("REQUEST_BAD_IDENTITY");
  return identity;
}

/** The ordered tuple is scoped by caller, route, project, operation and fanout parent. */
export function requestKey(input) {
  const identity = requestIdentity(input ?? {});
  return identity ? JSON.stringify(REQUEST_FIELDS.map((field) => identity[field])) : null;
}

/** Returns current durable state, including declared fanout children and partial creations. */
export function findRequestJob(store, input) {
  const key = requestKey(input);
  if (key === null) return null;
  const matches = Object.values(currentJobs(store)).filter((job) => requestKey(job) === key);
  if (matches.length > 1) throw new ClawError("REQUEST_DUPLICATE");
  return matches[0] ?? null;
}

/** Serializes matching operations; durable lookup inside the operation remains authoritative. */
export async function withRequestIdentity({ identity } = {}, operation) {
  if (typeof operation !== "function") throw new ClawError("REQUEST_BAD_OPERATION");
  const key = requestKey(identity);
  if (key === null) return operation();
  const previous = chains.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  chains.set(key, current);
  return current.finally(() => {
    if (chains.get(key) === current) chains.delete(key);
  });
}

/** Creates or recovers a producer job and completes only its required approval-pending transition. */
export function ensureRequestJob({
  store, request, fields = {}, now = Date.now, idFactory = () => randomBytes(ID_BYTES).toString("hex"),
} = {}) {
  if (Object.hasOwn(fields, "runtime") || Object.hasOwn(fields, "provider")) {
    throw new ClawError("RUNTIME_POLICY_DENIED");
  }
  let job = findRequestJob(store, request);
  const recovered = job !== null;
  if (!job) {
    const created = createJob({
      id: idFactory(), type: request.type, projectId: request.projectId,
      parentId: request.parentId, readOnly: fields.readOnly,
    });
    job = { ...fields, ...created.job, ...normalizeRequestFields(request), createdAt: new Date(now()).toISOString() };
    store.append(JOBS_STREAM, { kind: "job.created", job });
  }
  if (job.mutating && job.state === "queued") {
    const awaiting = transition(job, "awaiting-approval");
    store.append(JOBS_STREAM, awaiting.event);
    job = awaiting.job;
  }
  return { job, recovered };
}
