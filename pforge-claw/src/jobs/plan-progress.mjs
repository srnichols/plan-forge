import path from "node:path";
import { ClawError } from "../errors.mjs";

export const PLAN_PROGRESS_ERRORS = Object.freeze({
  UNAVAILABLE: "PLAN_PROGRESS_UNAVAILABLE",
  INCOMPLETE: "PLAN_PROGRESS_INCOMPLETE",
  SCOPE: "PLAN_PROGRESS_SCOPE_MISMATCH",
});
const MAX_EVENTS = 100;
const MAX_RESPONSE_BYTES = 262_144;
const MAX_SLICES = 10_000;
const MAX_SLICE_ID_LENGTH = 80;
const PERCENT_SCALE = 100;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SLICE_ID = /^[\d.]+[A-Za-z]?$/;
const WATCH_MODES = Object.freeze(["polling", "websocket"]);
const PROGRESS_BASIS = "reported-passed-slices";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeResponse(response) {
  if (!isObject(response) || response.isError || response.ok === false) return null;
  if (Array.isArray(response.content)) {
    const text = response.content.find((entry) => entry?.type === "text")?.text;
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null;
    try { return decodeResponse(JSON.parse(text)); } catch { return null; }
  }
  return response;
}

function hasVerboseEvents(response) {
  return response?.ok === true && response.eventProjection === "verbose" && WATCH_MODES.includes(response.mode)
    && Array.isArray(response.events) && response.events.length <= MAX_EVENTS;
}

function validateResponse(response) {
  if (!hasVerboseEvents(response)) return PLAN_PROGRESS_ERRORS.UNAVAILABLE;
  if (!Number.isSafeInteger(response.capturedEvents) || response.capturedEvents !== response.events.length
    || !Number.isSafeInteger(response.droppedEvents) || response.droppedEvents < 0
    || !Number.isSafeInteger(response.maxCapturedEvents) || response.maxCapturedEvents < response.capturedEvents) {
    return PLAN_PROGRESS_ERRORS.INCOMPLETE;
  }
  return response.droppedEvents > 0 ? PLAN_PROGRESS_ERRORS.INCOMPLETE : null;
}

function eventTime(event) {
  const timestamp = event?.ts ?? event?.timestamp;
  return typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
}

function matchesPlan(state, plan) {
  return typeof plan === "string" && !!plan && !plan.includes("\0")
    && path.relative(state.planPath, path.resolve(state.worktree, plan)) === "";
}

function declaredOrder(data) {
  if (!Number.isSafeInteger(data.sliceCount) || data.sliceCount < 1 || data.sliceCount > MAX_SLICES
    || !Array.isArray(data.executionOrder) || data.executionOrder.length !== data.sliceCount) return null;
  const order = data.executionOrder.map((id) => typeof id === "number" ? String(id) : id);
  if (order.some((id) => typeof id !== "string" || id.length > MAX_SLICE_ID_LENGTH || !SLICE_ID.test(id))
    || new Set(order).size !== data.sliceCount) return null;
  return order;
}

function progressUpdate(run) {
  return {
    type: "progress",
    data: {
      percent: run.reportedPassed === null ? null : Math.floor(PERCENT_SCALE * run.reportedPassed / run.total),
      completedSlices: run.reportedPassed, totalSlices: run.total,
      traceId: run.traceId, basis: PROGRESS_BASIS,
    },
  };
}

function runStartMetadata(state, event) {
  const data = event.data;
  const startTime = typeof data.startTime === "string" ? Date.parse(data.startTime) : NaN;
  if (!matchesPlan(state, data.plan) || !Number.isFinite(startTime) || startTime < state.startedAt
    || eventTime(event) < startTime) return { reason: PLAN_PROGRESS_ERRORS.SCOPE };
  const order = declaredOrder(data);
  return TRACE_ID.test(data.traceId ?? "") && order
    ? { order, startTime } : { reason: PLAN_PROGRESS_ERRORS.UNAVAILABLE };
}

function beginRun({ state, event, updates }) {
  const data = event.data;
  state.accepting = false;
  const { reason, order, startTime } = runStartMetadata(state, event);
  if (reason) return reason;
  if (state.run) {
    if (state.run.traceId !== data.traceId || state.run.startTime !== data.startTime
      || JSON.stringify(state.run.order) !== JSON.stringify(order)) return PLAN_PROGRESS_ERRORS.SCOPE;
    state.accepting = true;
    return null;
  }
  state.run = {
    traceId: data.traceId, startTime: data.startTime, startedAt: startTime,
    total: data.sliceCount, order, passed: new Set(), failed: new Set(),
    reportedPassed: null, finished: false,
  };
  state.accepting = true;
  updates.push(progressUpdate(state.run));
  return null;
}

function sliceIdentity(run, data) {
  const id = typeof data.sliceId === "number" ? String(data.sliceId) : data.sliceId;
  return typeof id === "string" && run.order.includes(id) ? id : null;
}

function reportPassedSlice({ run, data, updates }) {
  const id = sliceIdentity(run, data);
  if (!id || data.status !== "passed" || run.failed.has(id)) return PLAN_PROGRESS_ERRORS.INCOMPLETE;
  if (run.passed.has(id)) return null;
  run.passed.add(id);
  run.reportedPassed = run.passed.size;
  updates.push({
    type: "slice", data: {
      index: run.order.indexOf(id) + 1, total: run.total, sliceId: id, status: "passed", traceId: run.traceId,
    },
  }, progressUpdate(run));
  return null;
}

function reportFailedSlice({ run, data, updates }) {
  const id = sliceIdentity(run, data);
  if (!id || !["failed", "error"].includes(data.status) || run.passed.has(id)) return PLAN_PROGRESS_ERRORS.INCOMPLETE;
  if (!run.failed.has(id)) {
    run.failed.add(id);
    updates.push({ type: "log", data: { level: "warn", code: "PLAN_SLICE_REPORTED_FAILED", sliceId: id } });
  }
  return null;
}

function summaryCounts(run, data) {
  const counts = data.results;
  if (data.sliceCount !== run.total || !isObject(counts)
    || !["passed", "failed", "skipped", "total"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) {
    return null;
  }
  if (counts.total > run.total || counts.passed + counts.failed + counts.skipped !== counts.total
    || counts.passed < run.passed.size || counts.failed < run.failed.size) return null;
  return counts;
}

function reportRunSummary({ state, data, updates }) {
  const run = state.run;
  const endedAt = typeof data.endTime === "string" ? Date.parse(data.endTime) : NaN;
  if (!matchesPlan(state, data.plan) || data.startTime !== run.startTime
    || !Number.isFinite(endedAt) || endedAt < run.startedAt) return PLAN_PROGRESS_ERRORS.SCOPE;
  const counts = summaryCounts(run, data);
  if (!counts || !["completed", "failed", "aborted"].includes(data.status)) return PLAN_PROGRESS_ERRORS.INCOMPLETE;
  if (run.reportedPassed !== counts.passed) {
    run.reportedPassed = counts.passed;
    updates.push(progressUpdate(run));
  }
  if (data.status !== "completed" || counts.failed > 0) {
    updates.push({ type: "log", data: { level: "warn", code: "PLAN_RUN_REPORTED_FAILED" } });
  }
  run.finished = true;
  return null;
}

function eventMatchesRun(state, event) {
  return (event.data.plan === undefined || matchesPlan(state, event.data.plan))
    && (event.data.traceId === undefined || event.data.traceId === state.run.traceId);
}

function reportAbortedRun({ state, updates }) {
  updates.push({ type: "log", data: { level: "warn", code: "PLAN_RUN_REPORTED_ABORTED" } });
  state.run.finished = true;
}

const OUTCOME_READERS = Object.freeze({
  "slice-completed": ({ state, data, updates }) => reportPassedSlice({ run: state.run, data, updates }),
  "slice-failed": ({ state, data, updates }) => reportFailedSlice({ run: state.run, data, updates }),
  "run-completed": reportRunSummary,
  "run-aborted": reportAbortedRun,
});

function consumeEvent({ state, event, updates }) {
  const timestamp = eventTime(event);
  if (!isObject(event?.data) || !Number.isFinite(timestamp)) return null;
  if (event.type === "run-started") return beginRun({ state, event, updates });
  const run = state.run;
  if (!run || !state.accepting || run.finished || timestamp < run.startedAt) return null;
  if (!eventMatchesRun(state, event)) return PLAN_PROGRESS_ERRORS.SCOPE;
  return Object.hasOwn(OUTCOME_READERS, event.type)
    ? OUTCOME_READERS[event.type]({ state, data: event.data, updates }) ?? null : null;
}

/**
 * Project native verbose watcher facts into bounded, replay-safe Claw progress.
 * @param {{worktree:string,relativePlan:string,startedAt:number}} options Validated foreground scope.
 * @returns {{consume:(response:object) => {updates:Array<{type:string,data:object}>,reason:string|null}}}
 */
export function createPlanProgress({ worktree, relativePlan, startedAt }) {
  if (typeof worktree !== "string" || !path.isAbsolute(worktree) || typeof relativePlan !== "string"
    || !relativePlan || !Number.isFinite(startedAt)) throw new ClawError(PLAN_PROGRESS_ERRORS.SCOPE);
  const state = { worktree, planPath: path.resolve(worktree, relativePlan), startedAt, run: null, accepting: false };
  return {
    consume(response) {
      let decoded;
      try {
        if (Buffer.byteLength(JSON.stringify(response) ?? "") > MAX_RESPONSE_BYTES) {
          return { updates: [], reason: PLAN_PROGRESS_ERRORS.INCOMPLETE };
        }
        decoded = decodeResponse(response);
      } catch {
        return { updates: [], reason: PLAN_PROGRESS_ERRORS.UNAVAILABLE };
      }
      const invalid = validateResponse(decoded);
      if (invalid) return { updates: [], reason: invalid };
      const updates = [];
      let reason = null;
      for (const event of decoded.events) {
        const eventReason = consumeEvent({ state, event, updates });
        reason ??= eventReason;
      }
      return { updates, reason: reason ?? (state.run ? null : PLAN_PROGRESS_ERRORS.UNAVAILABLE) };
    },
  };
}
