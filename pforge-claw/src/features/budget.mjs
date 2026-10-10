import { bindBudgetService, BUDGET_UNITS, createBudgetService, USAGE_SOURCES } from "../budget.mjs";
import { currentJobs } from "../jobs/model.mjs";
import { normalizePlanActuals, PLAN_ACTUALS_UNCONFIRMED } from "../jobs/runner-lifecycle.mjs";

const PLAN_ACTUAL_SOURCE = USAGE_SOURCES[2];
let service = null;
let unbind = null;
let context = null;
let listeners = [];

function eventTime(event, now) {
  const parsed = Date.parse(event?.ts ?? "");
  return Number.isFinite(parsed) ? parsed : now();
}

function attach(ctx, eventName, handler) {
  ctx.bus?.on?.(eventName, handler);
  listeners.push([eventName, handler]);
}

function recordSessionUsage(activeService, event, ctx) {
  try {
    activeService.recordUsage({
      source: "session",
      projectId: event.projectId ?? currentJobs(ctx.store)[event.jobId]?.projectId,
      jobId: event.jobId ?? null,
      usage: event.data ?? {},
      at: eventTime(event, ctx.now ?? Date.now),
    });
  } catch (error) {
    ctx.logger?.error?.("Session usage could not be recorded", {
      code: error?.code ?? "BUDGET_USAGE_WRITE_FAILED",
    });
  }
}

function matchingPlanJob(ctx, event) {
  const job = currentJobs(ctx.store)[event.jobId];
  return job?.projectId === event.projectId ? job : null;
}

function warnUnconfirmed(ctx, actuals) {
  if (actuals && BUDGET_UNITS.some((unit) => actuals.usage[unit] !== null)) return;
  ctx.logger?.warn?.("Plan actuals are unconfirmed; recording unknown usage", { code: PLAN_ACTUALS_UNCONFIRMED });
}

function recordPlanActual(activeService, event, ctx) {
  if (activeService.hasUsage({
    source: PLAN_ACTUAL_SOURCE, projectId: event.projectId, jobId: event.jobId,
  })) return;
  const actuals = normalizePlanActuals({ job: matchingPlanJob(ctx, event), actuals: event.planActuals });
  activeService.recordUsage({
    source: PLAN_ACTUAL_SOURCE,
    projectId: event.projectId,
    jobId: event.jobId,
    planActuals: actuals,
    at: eventTime(event, ctx.now ?? Date.now),
  });
  warnUnconfirmed(ctx, actuals);
}

function beginPlanActual(event) {
  const activeService = service;
  const ctx = context;
  if (!activeService || !ctx || typeof event?.jobId !== "string") return;
  try {
    recordPlanActual(activeService, event, ctx);
  } catch (error) {
    ctx.logger?.error?.("Plan usage could not be recorded", {
      code: error?.code ?? "BUDGET_USAGE_WRITE_FAILED",
    });
  }
}

export default {
  name: "budget",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    context = ctx;
    service = createBudgetService({
      store: ctx.store,
      bus: ctx.bus,
      config: ctx.config,
      channel: ctx.channel,
      logger: ctx.logger,
      now: ctx.now ?? Date.now,
    });
    unbind = bindBudgetService(service);
    attach(ctx, "job.transition", (event) => {
      if (event?.to === "approved") service?.gate(event.jobId);
    });
    attach(ctx, "lane.event", (event) => {
      if (event?.type !== "cost") return;
      if (service) recordSessionUsage(service, event, ctx);
    });
    attach(ctx, "job.finished", (event) => {
      if (event?.type === "plan") beginPlanActual(event);
    });
  },
  async stop() {
    if (context?.bus) {
      for (const [eventName, handler] of listeners) context.bus.off?.(eventName, handler);
    }
    listeners = [];
    unbind?.();
    unbind = null;
    service = null;
    context = null;
  },
  snapshot(ctx = {}) {
    if (!ctx.store) return { day: null, tz: "Etc/UTC", spendToday: null, caps: {}, unknown: 0, held: 0 };
    return createBudgetService({ store: ctx.store, config: ctx.config }).snapshot();
  },
};
