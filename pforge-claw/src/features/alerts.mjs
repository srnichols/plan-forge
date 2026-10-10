import {
  ALERT_DEFAULTS,
  bindAlertsService,
  createAlertsService,
  getAlertsService,
} from "../alerts.mjs";

const OBSERVER_UNAVAILABLE_CODE = "FORGE_MASTER_UNAVAILABLE";
const MCP_TOOL_ERROR_CODE = "MCP_TOOL_ERROR";

let service = null;
let unbind = null;
let context = null;
let timer = null;
let isStopping = false;
let channelWarningLogged = false;
const inFlight = new Map();
const runs = new Set();

function projectsFor(ctx) {
  const registry = ctx.registry ?? ctx.projectRegistry;
  if (typeof registry?.all === "function") return registry.all();
  return Array.isArray(ctx.config?.projects) ? ctx.config.projects : [];
}

function reportPollFailure(ctx, projectId, error) {
  ctx?.logger?.warn?.("Alerts project poll failed", {
    projectId,
    code: typeof error?.code === "string" ? error.code : "ALERTS_POLL_FAILED",
  });
}

function runProject(activeService, ctx, project) {
  const current = inFlight.get(project.id);
  if (current) return current;
  const operation = activeService.pollProject(project)
    .catch((error) => reportPollFailure(ctx, project.id, error))
    .finally(() => inFlight.delete(project.id));
  inFlight.set(project.id, operation);
  return operation;
}

async function runPoll(activeService, ctx) {
  if (!activeService || isStopping) return;
  const operation = (async () => {
    const projects = projectsFor(ctx);
    await Promise.all(projects.map((project) => runProject(activeService, ctx, project)));
    try {
      await activeService.collectNudges();
    } catch (error) {
      ctx.logger?.warn?.("Alerts nudge collection failed", {
        code: typeof error?.code === "string" ? error.code : "ALERTS_NUDGE_FAILED",
      });
    }
  })();
  runs.add(operation);
  try {
    await operation;
  } finally {
    runs.delete(operation);
  }
}

function runAndSchedule(activeService, ctx) {
  void runPoll(activeService, ctx)
    .catch((error) => {
      ctx.logger?.error?.("Alerts poll cycle failed", {
        code: typeof error?.code === "string" ? error.code : "ALERTS_POLL_FAILED",
      });
    })
    .finally(() => scheduleNext(ctx));
}

function scheduleNext(ctx) {
  if (isStopping || !service) return;
  const set = ctx.setTimer ?? setTimeout;
  const delay = Number(ctx.alertsOptions?.pollMs ?? ctx.config?.alerts?.pollMs ?? ALERT_DEFAULTS.pollMs);
  timer = set(() => {
    timer = null;
    runAndSchedule(service, ctx);
  }, Number.isFinite(delay) && delay > 0 ? delay : ALERT_DEFAULTS.pollMs);
  timer?.unref?.();
}

function observerPayload(result) {
  const payload = result?.structuredContent ?? result;
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

function observerFailureCheck(project, code) {
  return {
    name: `alerts:${project.id}`,
    status: "warn",
    code,
    detail: `Observer probe failed (${code}).`,
  };
}

function observerUnavailableCheck(project) {
  return {
    name: `alerts:${project.id}`,
    status: "warn",
    code: OBSERVER_UNAVAILABLE_CODE,
    detail: "Forge-Master observer unavailable; using forge_watch_live fallback.",
  };
}

function returnedObserverErrorCode(result, payload) {
  return payload?.error ?? result?.error ?? MCP_TOOL_ERROR_CODE;
}

function isObserverStopped(payload) {
  return payload?.status?.stopped === true
    || payload?.status?.running === false
    || payload?.running === false;
}

function observerResponseCheck(project, result) {
  const payload = observerPayload(result);
  if (result?.isError || payload?.isError) {
    return observerFailureCheck(project, returnedObserverErrorCode(result, payload));
  }
  if (payload?.error === OBSERVER_UNAVAILABLE_CODE) return observerUnavailableCheck(project);
  if (payload?.ok === false || payload?.error) return observerFailureCheck(project, payload.error);
  if (isObserverStopped(payload)) {
    return {
      name: `alerts:${project.id}`,
      status: "warn",
      detail: "run `forge_master_observe start` or set `keepAlive: true`; using forge_watch_live fallback",
    };
  }
  return { name: `alerts:${project.id}`, status: "ok", detail: "observer insights available" };
}

function thrownObserverErrorCode(error) {
  if (typeof error?.code === "string") return error.code;
  const details = `${error?.detail ?? ""} ${error?.message ?? ""}`;
  return details.includes(OBSERVER_UNAVAILABLE_CODE) ? OBSERVER_UNAVAILABLE_CODE : MCP_TOOL_ERROR_CODE;
}

async function probeObserver(ctx, project) {
  try {
    const result = await ctx.mcp.call(project.id, "forge_master_observe", { action: "status" });
    return observerResponseCheck(project, result);
  } catch (error) {
    const code = thrownObserverErrorCode(error);
    return code === OBSERVER_UNAVAILABLE_CODE
      ? observerUnavailableCheck(project)
      : observerFailureCheck(project, code);
  }
}

async function doctorChecks(ctx = {}) {
  const projects = projectsFor(ctx);
  if (projects.length === 0) {
    return [{ name: "alerts", status: "ok", detail: "no registered projects" }];
  }
  if (ctx.live === false) {
    return [
      ...projects.map((project) => ({
        name: `alerts:${project.id}`,
        status: project.keepAlive ? "ok" : "warn",
        detail: project.keepAlive
          ? "keepAlive → observer insights"
          : "no keepAlive → forge_watch_live fallback while MCP is up",
      })),
      { name: "alerts:observer-probe", status: "skip", detail: "offline; no MCP observer probe" },
    ];
  }

  return Promise.all(projects.map((project) => probeObserver(ctx, project)));
}

export default {
  name: "alerts",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    context = ctx;
    isStopping = false;
    service = createAlertsService({
      store: ctx.store,
      mcp: ctx.mcp,
      registry: ctx.registry ?? ctx.projectRegistry,
      channel: ctx.channel,
      config: ctx.config,
      getConfig: () => ctx.getConfig?.() ?? ctx.config,
      lanes: ctx.lanes,
      logger: ctx.logger,
      secrets: ctx.secrets,
      now: ctx.now ?? Date.now,
      options: ctx.alertsOptions ?? ctx.config?.alerts ?? {},
    });
    unbind = bindAlertsService(service);
    if (!ctx.channel && !channelWarningLogged) {
      channelWarningLogged = true;
      ctx.logger?.warn?.("Alerts channel unavailable; alerts will be polled but not delivered.", {
        code: "ALERTS_CHANNEL_UNAVAILABLE",
      });
    }
    runAndSchedule(service, ctx);
  },
  async stop() {
    isStopping = true;
    const ctx = context;
    if (timer !== null) (ctx?.clearTimer ?? clearTimeout)(timer);
    timer = null;
    unbind?.();
    unbind = null;
    service = null;
    context = null;
    await Promise.allSettled([...inFlight.values(), ...runs]);
    inFlight.clear();
  },
  snapshot() {
    return getAlertsService()?.snapshot() ?? { projects: [] };
  },
  doctorChecks,
};
