import { ClawError } from "./errors.mjs";
import { JOBS_STREAM, currentJobs, READ_TYPES, TERMINAL, transition } from "./jobs/model.mjs";
import { JOB_TYPES, LANE_EVENT_TYPES } from "./enums.mjs";
import { placeJob, readLaneState } from "./placement.mjs";
import { runtimeEligibility } from "./handlers/c2-command-context.mjs";
import { fanoutCompletionFor } from "./crossproject.mjs";
import { approvedChoicesFor, consumedApprovalFor, currentJobCaller, fanoutProofFor } from "./jobs/approval-proof.mjs";
import { failureReason, normalizePlanActuals, PLAN_ACTUALS_UNCONFIRMED } from "./jobs/runner-lifecycle.mjs";
import { normalizeRuntimeId } from "./runtime/agent-runtime.mjs";
import { applicationIdentity } from "./protocol/l2-ack.mjs";

export const DISPATCHABLE_TYPES = Object.freeze(JOB_TYPES.filter((type) => !READ_TYPES.includes(type)));
const ACTIVE_STATES = Object.freeze(["leased", "running", "needs-input"]);
const STOP_TIMEOUT_MS = 10_000;

function safeText(ctx, value) {
  const text = String(value ?? "INTERNAL");
  return (typeof ctx.secrets?.redact === "function" ? ctx.secrets.redact(text) : text).slice(0, 500);
}

function storedJobs(ctx) {
  return {
    get: (id) => currentJobs(ctx.store)[id] ?? null,
    all: () => Object.values(currentJobs(ctx.store)),
    append(job, state, meta = {}) {
      const updated = transition(job, state, meta);
      ctx.store.append(JOBS_STREAM, updated.event);
      return updated;
    },
  };
}

function audit(state, record) {
  try {
    state.ctx.store.append("audit", {
      v: 1, ...record, ...(record.reason ? { reason: safeText(state.ctx, record.reason) } : {}),
    });
  } catch (error) {
    logFailure(state, "Dispatcher audit write failed", error);
  }
}

function logFailure(state, message, error) {
  state.ctx.logger?.error?.(message, { code: safeText(state.ctx, error?.code) });
}

function markWaiting(state, job, reason) {
  if (state.waiting.get(job.id) === reason) return;
  state.waiting.set(job.id, reason);
  audit(state, { kind: "dispatcher.waiting", jobId: job.id, reason });
}

function appendTransition(state, job, to, meta = {}) {
  const updated = state.jobs.append(job, to, meta);
  state.ctx.bus?.emit("job.transition", updated.event);
  return updated.job;
}

function approvalProof(state, job) {
  if (job.type === "skill" && job.mutating === false) return "read-only";
  if (job.type === "fanout") return fanoutProofFor({ store: state.ctx.store, config: state.ctx.config, parent: job });
  const direct = consumedApprovalFor({ store: state.ctx.store, config: state.ctx.config, job });
  if (direct || !job.parentId) return direct;
  const parent = state.jobs.get(job.parentId);
  return fanoutProofFor({ store: state.ctx.store, config: state.ctx.config, parent, child: job });
}

function checkProof(state, job) {
  const proof = approvalProof(state, job);
  if (!proof) markWaiting(state, job, "approval-proof-missing");
  return proof;
}

function resultFields(result) {
  return {
    ...(typeof result?.branch === "string" ? { branch: result.branch } : {}),
    ...(typeof result?.prUrl === "string" ? { prUrl: result.prUrl } : {}),
  };
}

function planFacts(job, payload) {
  if (job.type !== "plan") return {};
  const planActuals = normalizePlanActuals({ job, actuals: payload?.planActuals });
  if (planActuals) return { planActuals };
  const code = failureReason({ code: payload?.planActualsError });
  return { planActuals: null, planActualsError: code === "JOB_RUN_FAILED" ? PLAN_ACTUALS_UNCONFIRMED : code };
}

function historyFacts(job, payload) {
  try {
    const identity = applicationIdentity(payload?.l2);
    return identity.jobId === job.id && identity.projectId === job.projectId && payload.l2.ok === true
      ? { l2: { ...identity, ok: true } } : {};
  } catch {
    return {};
  }
}

function emitCompletion(state, { job, to, reason, result, terminalEvent, emitLaneEvent }) {
  const facts = planFacts(job, terminalEvent?.data);
  if (emitLaneEvent) state.ctx.bus?.emit("lane.event", {
    v: 1, jobId: job.id, seq: terminalEvent?.seq ?? 1,
    ts: terminalEvent?.ts ?? new Date(state.now()).toISOString(), type: "finished",
    data: {
      status: to, ...result, ...facts, ...historyFacts(job, terminalEvent?.data),
      ...(reason ? { error: safeText(state.ctx, reason) } : {}),
      ...(terminalEvent?.data?.usage !== undefined ? { usage: terminalEvent.data.usage } : {}),
    },
  });
  state.ctx.bus?.emit("job.finished", {
    jobId: job.id, projectId: job.projectId, type: job.type, state: to, ...facts,
    ...(job.branch ? { branch: job.branch } : {}),
    ...(job.prUrl ? { prUrl: job.prUrl } : {}),
    ...(reason ? { reason: safeText(state.ctx, reason) } : {}),
  });
}

function settle(state, { jobId, to, reason, result, terminalEvent, duringStop = false, emitLaneEvent = true }) {
  if (state.writesFenced && !duringStop) return false;
  let job = state.jobs.get(jobId);
  if (!job || !ACTIVE_STATES.includes(job.state)) return false;
  if (to === "succeeded" && job.state !== "running") job = appendTransition(state, job, "running");
  const metadata = resultFields(result);
  const updated = appendTransition(state, job, to, {
    ...(reason ? { reason: safeText(state.ctx, reason) } : {}),
    ...(to === "succeeded" ? { result: metadata } : {}),
  });
  emitCompletion(state, { job: updated, to, reason, result: metadata, terminalEvent, emitLaneEvent });
  return true;
}

function eligible(job) {
  return DISPATCHABLE_TYPES.includes(job.type)
    && ((job.mutating && job.state === "approved")
      || (job.type === "skill" && job.mutating === false && job.state === "queued"));
}

function checkBudget(state, job) {
  if (!job.mutating) return true;
  if (typeof state.budget?.gate !== "function") {
    markWaiting(state, job, "budget-unavailable");
    appendTransition(state, job, "held-budget", { reason: "budget:unavailable" });
    return false;
  }
  try {
    state.budget.gate(job.id);
    return state.jobs.get(job.id)?.state === "approved";
  } catch (error) {
    markWaiting(state, job, "budget-error");
    logFailure(state, "Dispatcher budget gate failed", error);
    const latest = state.jobs.get(job.id);
    if (latest?.state === "approved") appendTransition(state, latest, "held-budget", { reason: "budget:error" });
    return false;
  }
}

function chooseLane(state, job) {
  const project = state.ctx.config?.projects?.find((entry) => entry.id === job.projectId);
  if (!project) return { error: "project-unavailable" };
  const choice = placeJob({
    project, projects: state.ctx.config.projects, lanes: state.ctx.config.lanes ?? [],
    health: state.directory.snapshot(), laneState: readLaneState(state.ctx.store),
  });
  return choice.ok ? { lane: state.directory.get(choice.laneId), choice } : { error: choice.error, choice };
}

function runtimeVerdict(state, job, lane) {
  if (job.runtime !== undefined || job.provider !== undefined) return { ok: false, code: "RUNTIME_POLICY_DENIED" };
  const config = state.ctx.config;
  const configured = config?.lanes?.find((candidate) => candidate.id === lane.id);
  if (!configured || configured.enabled === false) return { ok: false, code: "RUNTIME_POLICY_DENIED" };
  return runtimeEligibility({
    config, project: config.projects?.find((candidate) => candidate.id === job.projectId),
    lane: configured, caller: currentJobCaller({ config, job }),
    secrets: state.ctx.secrets, requireKey: configured.kind === "local",
  });
}

function admittedLane(state, job) {
  const selected = chooseLane(state, job);
  if (!selected.lane) {
    markWaiting(state, job, selected.error ?? "lane-offline");
    return null;
  }
  const verdict = runtimeVerdict(state, job, selected.lane);
  if (!verdict.ok) {
    markWaiting(state, job, verdict.code);
    return null;
  }
  return selected.lane;
}

function lease(state, job, lane, proof) {
  const leased = appendTransition(state, job, "leased", lane ? { lane: lane.id } : {});
  const { quorum } = approvedChoicesFor({ job: leased, approval: proof });
  return quorum === null ? leased : { ...leased, quorum };
}

function startFanout(state, parent, proof) {
  for (const target of parent.targets) {
    const child = state.jobs.get(target.childId);
    if (!child || !admittedLane(state, child)) {
      markWaiting(state, parent, "fanout-target-unavailable");
      return;
    }
  }
  // Aggregate parents retain their declared per-target lane; they never run on a worker.
  const leased = lease(state, parent, null, proof);
  appendTransition(state, leased, "running");
  state.waiting.delete(parent.id);
}

function preparedRuntimeMatches(verdict, payload) {
  if (!payload || payload.runtime === undefined) return true;
  if (normalizeRuntimeId(payload.runtime) !== verdict.runtimeId) return false;
  const expected = verdict.provider;
  if (!expected) return payload.provider === undefined;
  const actual = payload.provider;
  return actual && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function assertBeforeSubmit(state, { job, lane, entry, payload }) {
  const current = state.jobs.get(job.id);
  if (entry.controller.signal.aborted || !state.accepting || state.writesFenced || current?.state !== "leased") {
    throw new ClawError("JOB_CANCELLED");
  }
  if (!approvalProof(state, current)) throw new ClawError("LEASE_PROOF_MISSING");
  const verdict = runtimeVerdict(state, current, lane);
  if (!verdict.ok || !preparedRuntimeMatches(verdict, payload)) throw new ClawError(verdict.code ?? "RUNTIME_POLICY_DENIED");
}

function assertEvent(job, event) {
  if (event?.v !== 1 || event.jobId !== job.id || !Number.isSafeInteger(event.seq) || event.seq < 1
    || !LANE_EVENT_TYPES.includes(event.type) || !event.data || typeof event.data !== "object") {
    throw new ClawError("LANE_BAD_EVENT");
  }
}

function consumeRemote(state, { job, event, entry }) {
  if (event.type !== "finished") state.ctx.bus?.emit("lane.event", event);
  if (event.type === "started") {
    const current = state.jobs.get(job.id);
    if (current?.state === "leased") appendTransition(state, current, "running");
  } else if (event.type === "artifact" && event.data.kind === "pr") {
    entry.result = resultFields({ branch: event.data.branch, prUrl: event.data.url });
  } else if (event.type === "finished") {
    entry.finished = true;
    const to = entry.controller.signal.aborted || event.data.status === "cancelled" ? "cancelled"
      : event.data.status === "succeeded" ? "succeeded" : "failed";
    settle(state, {
      jobId: job.id, to, reason: event.data.error, result: to === "succeeded" ? entry.result : undefined,
      terminalEvent: event,
    });
  }
}

function consumeLocal(state, { job, event, entry }) {
  if (event.type !== "finished") return;
  entry.finished = true;
  const current = state.jobs.get(job.id);
  if (!current || TERMINAL.includes(current.state)) return;
  const to = event.data.status === "cancelled" || entry.controller.signal.aborted ? "cancelled" : "failed";
  settle(state, {
    jobId: job.id, to, reason: event.data.error ?? (to === "cancelled" ? "cancelled-before-start" : "local-run-unsettled"),
    terminalEvent: event, emitLaneEvent: false,
  });
}

async function consume(state, { job, lane, stream, entry }) {
  for await (const event of stream) {
    assertEvent(job, event);
    if (event.seq <= entry.lastSeq) continue;
    entry.lastSeq = event.seq;
    if (state.writesFenced) continue;
    if (lane.kind === "local") consumeLocal(state, { job, event, entry });
    else consumeRemote(state, { job, event, entry });
  }
  if (!entry.finished) settle(state, {
    jobId: job.id, to: entry.controller.signal.aborted ? "cancelled" : "failed",
    reason: entry.controller.signal.aborted ? "cancelled-before-start" : "lane-stream-ended",
  });
}

async function pump(state, { job, lane }) {
  const entry = { job, lane, controller: new AbortController(), promise: null, finished: false, result: {}, lastSeq: 0 };
  state.inFlight.set(job.id, entry);
  try {
    const payload = await lane.prepareLease?.(job, { signal: entry.controller.signal });
    assertBeforeSubmit(state, { job, lane, entry, payload });
    const stream = await lane.submit(job);
    await consume(state, { job, lane, stream, entry });
  } catch (error) {
    logFailure(state, "Dispatcher lane submission failed", error);
    settle(state, {
      jobId: job.id, to: entry.controller.signal.aborted ? "cancelled" : "failed",
      reason: entry.controller.signal.aborted ? "cancelled" : safeText(state.ctx, error?.code ?? "lane-submit-failed"),
    });
  } finally {
    state.inFlight.delete(job.id);
  }
}

async function dispatch(state, job) {
  if (!checkBudget(state, job)) return;
  const current = state.jobs.get(job.id);
  if (!current || !eligible(current) || !state.accepting) return state.waiting.delete(job.id);
  const proof = checkProof(state, current);
  if (!proof) return;
  if (current.type === "fanout") return startFanout(state, current, proof);
  const lane = admittedLane(state, current);
  if (!lane) return;
  state.waiting.delete(current.id);
  const leased = lease(state, current, lane, proof);
  const pending = pump(state, { job: leased, lane });
  const entry = state.inFlight.get(leased.id);
  if (entry) entry.promise = pending;
  await Promise.resolve();
}

function completeFanouts(state) {
  for (const parent of state.jobs.all()) {
    if (parent.type !== "fanout" || !ACTIVE_STATES.includes(parent.state)) continue;
    if (!checkProof(state, parent)) continue;
    const completion = fanoutCompletionFor({ store: state.ctx.store, parent });
    if (completion) settle(state, { jobId: parent.id, to: completion.to, reason: completion.reason });
  }
}

async function runSweep(state) {
  if (!state.accepting) return;
  completeFanouts(state);
  for (const job of state.jobs.all()) {
    if (!state.accepting) return;
    if (eligible(job)) {
      try { await dispatch(state, job); } catch (error) { logFailure(state, "Dispatcher sweep failed", error); }
    } else if (!ACTIVE_STATES.includes(job.state)) state.waiting.delete(job.id);
  }
}

async function cancelEntry(state, entry) {
  entry.controller.abort();
  try { await entry.lane.cancel(entry.job.id); } catch (error) { logFailure(state, "Dispatcher cancellation failed", error); }
}

async function stopDispatch(state) {
  state.accepting = false;
  clearInterval(state.interval);
  state.interval = null;
  state.ctx.bus?.off?.("job.transition", state.onTransition);
  state.ctx.bus?.off?.("fanout.ready", state.onFanout);
  state.ctx.bus?.off?.("fanout.settle", state.onFanout);
  const active = [...state.inFlight.values()];
  const cancelling = active.map((entry) => cancelEntry(state, entry));
  let timer;
  try {
    await Promise.race([
      Promise.allSettled([...cancelling, ...active.map((entry) => entry.promise).filter(Boolean)]),
      new Promise((resolve) => { timer = setTimeout(resolve, state.stopTimeoutMs); timer.unref?.(); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  state.writesFenced = true;
  for (const entry of state.inFlight.values()) settle(state, {
    jobId: entry.job.id, to: "failed", reason: "dispatcher-stopped", duringStop: true,
  });
  for (const parent of state.jobs.all()) {
    if (parent.type === "fanout" && ACTIVE_STATES.includes(parent.state)) {
      settle(state, { jobId: parent.id, to: "cancelled", reason: "dispatcher-stopped", duringStop: true });
    }
  }
  state.started = false;
}

/** The sole lease writer consumes current authority and exact family proof before handoff. */
export function createDispatcher(ctx, deps = {}) {
  const state = {
    ctx, directory: deps.directory, budget: deps.budget, jobs: storedJobs(ctx),
    now: deps.now ?? Date.now, defer: deps.defer ?? setImmediate, tickMs: deps.tickMs ?? 1000,
    stopTimeoutMs: deps.stopTimeoutMs ?? STOP_TIMEOUT_MS,
    inFlight: new Map(), waiting: new Map(), interval: null, sweepPromise: null,
    accepting: false, started: false, writesFenced: false, stopPromise: null,
  };
  function sweep() {
    state.sweepPromise ??= runSweep(state).finally(() => { state.sweepPromise = null; });
    return state.sweepPromise;
  }
  const requestSweep = () => state.defer(() => {
    void sweep().catch((error) => logFailure(state, "Dispatcher event sweep failed", error));
  });
  state.onTransition = (event) => { if (event?.to === "approved" || TERMINAL.includes(event?.to)) requestSweep(); };
  state.onFanout = requestSweep;
  async function start() {
    if (state.started) return;
    state.started = true;
    state.writesFenced = false;
    state.stopPromise = null;
    for (const job of state.jobs.all()) {
      if (ACTIVE_STATES.includes(job.state)) settle(state, { jobId: job.id, to: "failed", reason: "orphaned" });
    }
    state.accepting = true;
    ctx.bus?.on?.("job.transition", state.onTransition);
    ctx.bus?.on?.("fanout.ready", state.onFanout);
    ctx.bus?.on?.("fanout.settle", state.onFanout);
    await sweep();
    state.interval = setInterval(() => { void sweep().catch((error) => logFailure(state, "Dispatcher interval sweep failed", error)); }, state.tickMs);
    state.interval.unref?.();
  }
  function stop() {
    if (!state.started) return state.stopPromise ?? Promise.resolve();
    state.stopPromise ??= stopDispatch(state);
    return state.stopPromise;
  }
  return { start, stop, sweep };
}
