import { bindBudgetService, createBudgetService } from "../budget.mjs";
import { currentJobs } from "../jobs/model.mjs";

let service = null;
let unbind = null;
let context = null;
let listeners = [];
const inFlight = new Set();

function eventTime(event, now) {
  const parsed = Date.parse(event?.ts ?? "");
  return Number.isFinite(parsed) ? parsed : now();
}

function runSpecificReport(result, jobId) {
  if (!result || result.isError || result.ok === false) return null;
  let report = result;
  if (Array.isArray(result.content)) {
    const text = result.content.find((entry) => entry?.type === "text")?.text;
    if (typeof text !== "string") return null;
    try {
      report = JSON.parse(text);
    } catch {
      return null;
    }
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const run = runs.find((entry) => [entry.runId, entry.jobId, entry.id]
    .some((id) => String(id ?? "") === String(jobId)));
  if (!run) return null;
  const usage = run.usage ?? run;
  return {
    costUSD: usage.costUSD ?? usage.costUsd ?? usage.usd ?? usage.cost ?? usage.total_cost_usd ?? null,
    premiumRequests: usage.premiumRequests ?? usage.premium_requests ?? null,
  };
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

function beginPlanActual(event) {
  const activeService = service;
  const ctx = context;
  if (!activeService || !ctx || typeof event?.jobId !== "string") return;
  const record = async () => {
    try {
      const client = typeof ctx.mcp === "function"
        ? await ctx.mcp({ projectId: event.projectId })
        : ctx.mcp;
      const report = await client.call("forge_cost_report", { runId: event.jobId });
      const usage = runSpecificReport(report, event.jobId);
      activeService.recordUsage({
        source: "cost-report",
        projectId: event.projectId,
        jobId: event.jobId,
        usage: usage ?? {},
        at: eventTime(event, ctx.now ?? Date.now),
      });
      if (!usage) ctx.logger?.warn?.("Plan cost report lacked a run-specific row", { code: "COST_REPORT_RUN_MISSING" });
    } catch (error) {
      activeService.recordUsage({
        source: "cost-report",
        projectId: event.projectId,
        jobId: event.jobId,
        usage: {},
        at: eventTime(event, ctx.now ?? Date.now),
      });
      ctx.logger?.error?.("Plan cost report could not be recorded", {
        code: error?.code ?? "COST_REPORT_FAILED",
      });
    }
  };
  const promise = record().finally(() => inFlight.delete(promise));
  inFlight.add(promise);
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
      mcp: ctx.mcp,
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
    await Promise.allSettled([...inFlight]);
  },
  snapshot(ctx = {}) {
    if (!ctx.store) return { day: null, tz: "Etc/UTC", spendToday: null, caps: {}, unknown: 0, held: 0 };
    return createBudgetService({ store: ctx.store, config: ctx.config }).snapshot();
  },
};
