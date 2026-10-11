import { createApprovalService } from "../approvals.mjs";
import { getBudgetService } from "../budget.mjs";
import {
  bindCrossprojectDependencies,
  onChildTerminal,
  onParentApproved,
  onParentClosed,
  onParentTerminal,
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

function parentHandler(state) {
  if (["approved", "leased", "running"].includes(state)) return onParentApproved;
  if (["rejected", "expired"].includes(state)) return onParentClosed;
  return TERMINAL.includes(state) ? onParentTerminal : null;
}

function transitionHandler(job, event) {
  if (job.type === "fanout") return parentHandler(event.to);
  return job.parentId && TERMINAL.includes(event.to) ? onChildTerminal : null;
}

function pendingReportId(job, handler) {
  if (handler === onParentTerminal) return job.id;
  if (handler !== onChildTerminal) return null;
  const parent = currentJobs(dependencies.store)[job.parentId];
  return parent?.type === "fanout" && TERMINAL.includes(parent.state) ? parent.id : null;
}

function handleTransition(event) {
  if (event?.kind !== "job.transition" || !dependencies) return;
  try {
    const job = currentJobs(dependencies.store)[event.jobId];
    if (!job || job.state !== event.to) return;
    const handler = transitionHandler(job, event);
    if (!handler) return;
    const result = handler(dependencies, event);
    if (result && typeof result.then === "function") {
      track(result, pendingReportId(job, handler));
    }
  } catch (error) {
    logFailure(error);
  }
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
      budget: getBudgetService() ?? ctx.budget,
      approvals: createApprovalService({
        store: ctx.store,
        bus: ctx.bus,
        channel: ctx.channel,
        logger: ctx.logger,
        config: ctx.config,
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
