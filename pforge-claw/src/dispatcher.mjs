import { ClawError } from "./errors.mjs";
import { JOBS_STREAM, currentJobs, TERMINAL, transition } from "./jobs/model.mjs";
import { placeJob, readLaneState } from "./placement.mjs";

export const DISPATCHABLE_TYPES = Object.freeze(["task", "skill", "plan"]);
const STOP_TIMEOUT_MS = 10_000;

function safeText(ctx, value) {
  const text = String(value ?? "INTERNAL").slice(0, 500);
  return typeof ctx.secrets?.redact === "function" ? ctx.secrets.redact(text) : text;
}

function storedJobs(ctx) {
  return {
    get(id) {
      return currentJobs(ctx.store)[id] ?? null;
    },
    all() {
      return Object.values(currentJobs(ctx.store));
    },
    append(job, state, meta = {}) {
      const result = transition(job, state, meta);
      ctx.store.append(JOBS_STREAM, result.event);
      return result;
    },
  };
}

function makeController() {
  return new AbortController();
}

function createAudit(ctx) {
  return (record) => {
    try {
      ctx.store.append("audit", {
        v: 1,
        ...record,
        ...(record.reason ? { reason: safeText(ctx, record.reason) } : {}),
      });
    } catch (error) {
      ctx.logger?.error?.("Dispatcher audit write failed", { code: safeText(ctx, error?.code) });
    }
  };
}

function approvalProof(ctx, job) {
  if (job.type === "skill" && job.mutating === false) return "read-only";
  const records = [...(ctx.store.read?.("approvals") ?? [])].map(({ record }) => record);
  return records.some((record) => record.kind === "approval.consumed"
    && record.decision === "approve"
    && [job.id, job.parentId].filter(Boolean).includes(record.jobId))
    ? "approval"
    : null;
}

function appendTransition(ctx, jobs, job, state, meta = {}) {
  const result = jobs.append(job, state, meta);
  ctx.bus?.emit("job.transition", result.event);
  return result.job;
}

export function createDispatcher(ctx, deps = {}) {
  const directory = deps.directory;
  const approvals = deps.approvals;
  const budget = deps.budget;
  const now = deps.now ?? Date.now;
  const defer = deps.defer ?? setImmediate;
  const tickMs = deps.tickMs ?? 1000;
  const stopTimeoutMs = deps.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  const jobs = storedJobs(ctx);
  const audit = createAudit(ctx);
  const inFlight = new Map();
  const waiting = new Map();
  let interval = null;
  let sweepPromise = null;
  let accepting = false;
  let started = false;
  let writesFenced = false;

  function logFailure(message, error) {
    ctx.logger?.error?.(message, { code: safeText(ctx, error?.code) });
  }

  function markWaiting(job, reason) {
    if (waiting.get(job.id) === reason) return;
    waiting.set(job.id, reason);
    audit({ kind: "dispatcher.waiting", jobId: job.id, reason });
  }

  function clearWaiting(jobId) {
    waiting.delete(jobId);
  }

  function settle(jobId, state, reason, result, { duringStop = false } = {}) {
    if (writesFenced && !duringStop) return false;
    const job = jobs.get(jobId);
    if (!job || TERMINAL.includes(job.state) || !["leased", "running"].includes(job.state)) return false;
    let current = job;
    if (state === "succeeded" && current.state === "leased") {
      current = appendTransition(ctx, jobs, current, "running");
    }
    const updated = appendTransition(ctx, jobs, current, state, {
      ...(reason ? { reason: safeText(ctx, reason) } : {}),
      ...(state === "succeeded" && result ? { result } : {}),
    });
    const done = {
      v: 1,
      jobId: updated.id,
      seq: Number.isInteger(result?.seq) ? result.seq : 1,
      ts: new Date(now()).toISOString(),
      type: "finished",
      data: { status: state, ...(reason ? { error: safeText(ctx, reason) } : {}), ...(result ?? {}) },
    };
    ctx.bus?.emit("lane.event", done);
    ctx.bus?.emit("job.finished", {
      jobId: updated.id,
      projectId: updated.projectId,
      type: updated.type,
      state,
      ...(updated.branch ? { branch: updated.branch } : {}),
      ...(updated.prUrl ? { prUrl: updated.prUrl } : {}),
      ...(reason ? { reason: safeText(ctx, reason) } : {}),
    });
    return true;
  }

  function recoverOrphans() {
    for (const job of jobs.all()) {
      if (!["leased", "running"].includes(job.state)) continue;
      settle(job.id, "failed", "orphaned");
    }
  }

  function eligible(job) {
    return DISPATCHABLE_TYPES.includes(job.type)
      && ((job.mutating && job.state === "approved")
        || (job.type === "skill" && job.mutating === false && job.state === "queued"));
  }

  function checkBudget(job) {
    if (!job.mutating) return true;
    if (!budget || typeof budget.gate !== "function") {
      markWaiting(job, "budget-unavailable");
      appendTransition(ctx, jobs, job, "held-budget", { reason: "budget:unavailable" });
      return false;
    }
    try {
      budget.gate(job.id);
      return jobs.get(job.id)?.state === "approved";
    } catch (error) {
      markWaiting(job, "budget-error");
      logFailure("Dispatcher budget gate failed", error);
      const latest = jobs.get(job.id);
      if (latest?.state === "approved") {
        appendTransition(ctx, jobs, latest, "held-budget", { reason: "budget:error" });
      }
      return false;
    }
  }

  function chooseLane(job) {
    const project = ctx.projectRegistry?.byId?.(job.projectId)
      ?? ctx.config?.projects?.find((entry) => entry.id === job.projectId);
    if (!project) return { error: "project-unavailable" };
    const choice = placeJob({
      project,
      projects: ctx.config?.projects ?? [],
      lanes: ctx.config?.lanes ?? [],
      health: directory.snapshot(),
      laneState: readLaneState(ctx.store),
    });
    return choice.ok ? { lane: directory.get(choice.laneId), choice } : { error: choice.error, choice };
  }

  function checkProof(job) {
    const proof = approvalProof(ctx, job);
    if (proof) return proof;
    markWaiting(job, "approval-proof-missing");
    return null;
  }

  function lease(job, laneId) {
    appendTransition(ctx, jobs, job, "leased", { lane: laneId });
    return jobs.get(job.id);
  }

  async function consume(job, lane, stream, entry) {
    let finished = false;
    let result = {};
    for await (const event of stream) {
      if (lane.kind !== "local") {
        if (event.type !== "finished") ctx.bus?.emit("lane.event", event);
        if (event.type === "started") {
          const latest = jobs.get(job.id);
          if (latest?.state === "leased" && !writesFenced) {
            appendTransition(ctx, jobs, latest, "running");
          }
        } else if (event.type === "artifact" && event.data?.kind === "pr") {
          result = {
            ...(typeof event.data.branch === "string" ? { branch: event.data.branch } : {}),
            ...(typeof event.data.url === "string" ? { prUrl: event.data.url } : {}),
          };
        } else if (event.type === "finished") {
          finished = true;
          const status = event.data?.status;
          const state = status === "succeeded" || status === "success" ? "succeeded"
            : status === "cancelled" ? "cancelled" : "failed";
          if (state === "succeeded" && jobs.get(job.id)?.state === "leased" && !writesFenced) {
            appendTransition(ctx, jobs, jobs.get(job.id), "running");
          }
          settle(job.id, state, event.data?.error, state === "succeeded" ? result : undefined);
        }
      }
      if (event.type === "finished" && event.data?.status === "cancelled") finished = true;
    }
    if (!finished) {
      const latest = jobs.get(job.id);
      if (!TERMINAL.includes(latest?.state)) {
        settle(job.id, entry.controller.signal.aborted ? "cancelled" : "failed",
          entry.controller.signal.aborted ? "cancelled-before-start" : "lane-stream-ended");
      }
    }
  }

  async function pump(job, lane) {
    const entry = { job, lane, controller: makeController(), promise: null };
    inFlight.set(job.id, entry);
    try {
      await lane.prepareLease?.(job, { signal: entry.controller.signal });
      if (entry.controller.signal.aborted) {
        settle(job.id, "cancelled", "cancelled-before-start");
        return;
      }
      const stream = await lane.submit(job);
      await consume(job, lane, stream, entry);
    } catch (error) {
      logFailure("Dispatcher lane submission failed", error);
      settle(job.id, entry.controller.signal.aborted ? "cancelled" : "failed",
        entry.controller.signal.aborted ? "cancelled" : safeText(ctx, error?.code ?? "lane-submit-failed"));
    } finally {
      inFlight.delete(job.id);
    }
  }

  async function dispatch(job) {
    if (!checkBudget(job)) return;
    const fresh = jobs.get(job.id);
    if (!fresh || !eligible(fresh)) return clearWaiting(job.id);
    if (!checkProof(fresh)) return;
    const selected = chooseLane(fresh);
    if (!selected.lane) {
      markWaiting(fresh, selected.error ?? "lane-offline");
      return;
    }
    clearWaiting(fresh.id);
    const leasedJob = lease(fresh, selected.lane.id);
    // Fan-out parents (crossproject.mjs) and inline captures (capture.mjs, handlers/capture-commands.mjs) retain their own leases.
    const pending = pump(leasedJob, selected.lane);
    inFlight.get(leasedJob.id).promise = pending;
    await Promise.resolve();
  }

  async function runSweep() {
    if (!accepting) return;
    for (const job of jobs.all()) {
      if (eligible(job)) {
        try {
          await dispatch(job);
        } catch (error) {
          logFailure("Dispatcher sweep failed", error);
        }
      } else if (!["leased", "running"].includes(job.state)) {
        clearWaiting(job.id);
      }
    }
  }

  function sweep() {
    if (sweepPromise) return sweepPromise;
    sweepPromise = runSweep().finally(() => { sweepPromise = null; });
    return sweepPromise;
  }

  function onApproval(event) {
    if (event?.to !== "approved") return;
    defer(() => {
      void sweep().catch((error) => logFailure("Dispatcher approval sweep failed", error));
    });
  }

  async function start() {
    if (started) return;
    started = true;
    recoverOrphans();
    accepting = true;
    ctx.bus?.on?.("job.transition", onApproval);
    await sweep();
    interval = setInterval(() => {
      void sweep().catch((error) => logFailure("Dispatcher interval sweep failed", error));
    }, tickMs);
    interval.unref?.();
  }

  async function stop() {
    if (!started) return;
    accepting = false;
    if (interval) clearInterval(interval);
    interval = null;
    ctx.bus?.off?.("job.transition", onApproval);
    for (const entry of inFlight.values()) {
      entry.controller.abort();
      try {
        await entry.lane.cancel(entry.job.id);
      } catch (error) {
        logFailure("Dispatcher cancellation failed", error);
      }
    }
    const active = [...inFlight.values()].map(({ promise }) => promise).filter(Boolean);
    let timeout;
    await Promise.race([
      Promise.allSettled(active),
      new Promise((resolve) => {
        timeout = setTimeout(resolve, stopTimeoutMs);
        timeout.unref?.();
      }),
    ]);
    clearTimeout(timeout);
    writesFenced = true;
    for (const entry of inFlight.values()) {
      settle(entry.job.id, "failed", "dispatcher-stopped", undefined, { duringStop: true });
    }
    started = false;
  }

  return { start, stop, sweep };
}
