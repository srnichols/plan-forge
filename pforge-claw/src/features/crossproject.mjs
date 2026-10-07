import { createApprovalService } from "../approvals.mjs";
import { getBudgetService } from "../budget.mjs";
import {
  bindCrossprojectDependencies,
  onChildTerminal,
  onParentApproved,
  onParentClosed,
  reconcile,
} from "../crossproject.mjs";
import { currentJobs, TERMINAL } from "../jobs/model.mjs";

let context = null;
let dependencies = null;
let unbind = null;
let listeners = [];
const inFlight = new Set();
const pendingReports = new Set();

function logFailure(error) {
  context?.logger?.error?.("Cross-project event could not be handled", {
    code: error?.code ?? "CROSSPROJECT_FAILED",
  });
}

function track(promise, reportParentId = null) {
  if (reportParentId) pendingReports.add(reportParentId);
  let tracked;
  tracked = Promise.resolve(promise)
    .catch(logFailure)
    .finally(() => {
      if (reportParentId) pendingReports.delete(reportParentId);
      inFlight.delete(tracked);
    });
  inFlight.add(tracked);
  return tracked;
}

function attach(ctx, eventName, handler) {
  ctx.bus?.on?.(eventName, handler);
  listeners.push([eventName, handler]);
}

function handleTransition(event) {
  if (event?.kind !== "job.transition" || !dependencies) return;
  let result;
  let pendingParent = null;
  try {
    const job = currentJobs(dependencies.store)[event.jobId];
    if (event.to === "approved" && job?.type === "fanout") {
      result = onParentApproved(dependencies, event);
    } else if (["rejected", "expired"].includes(event.to) && job?.type === "fanout") {
      result = onParentClosed(dependencies, event);
    } else if (TERMINAL.includes(event.to) && job?.parentId) {
      const parent = currentJobs(dependencies.store)[job.parentId];
      if (parent?.type === "fanout" && parent.state === "running") pendingParent = parent.id;
      result = onChildTerminal(dependencies, event);
      if (pendingParent && currentJobs(dependencies.store)[pendingParent]?.state === "running") {
        pendingParent = null;
      }
    }
  } catch (error) {
    logFailure(error);
    return;
  }
  if (result && typeof result.then === "function") track(result, pendingParent);
}

export default {
  name: "crossproject",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    context = ctx;
    dependencies = {
      ...ctx,
      registry: ctx.registry ?? ctx.projectRegistry,
      budget: getBudgetService(),
      approvals: createApprovalService({
        store: ctx.store,
        bus: ctx.bus,
        channel: ctx.channel,
        logger: ctx.logger,
        now: ctx.now ?? Date.now,
      }),
    };
    unbind = bindCrossprojectDependencies(dependencies);
    attach(ctx, "job.transition", handleTransition);
    try {
      await reconcile(dependencies);
    } catch (error) {
      logFailure(error);
    }
  },
  async stop() {
    if (context?.bus) {
      for (const [eventName, handler] of listeners) context.bus.off?.(eventName, handler);
    }
    listeners = [];
    unbind?.();
    unbind = null;
    await Promise.allSettled([...inFlight]);
    inFlight.clear();
    pendingReports.clear();
    dependencies = null;
    context = null;
  },
  snapshot(ctx = {}) {
    const jobs = ctx.store ? Object.values(currentJobs(ctx.store)) : [];
    return {
      activeFanouts: jobs.filter((job) => job.type === "fanout" && !TERMINAL.includes(job.state)).length,
      pendingReports: pendingReports.size,
    };
  },
};
