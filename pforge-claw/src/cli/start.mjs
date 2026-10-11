import path from "node:path";
import { parseArgs } from "node:util";
import { createApp } from "../app.mjs";
import { assertStartable, loadConfig, requiredSecretNames, resolveHome, validateConfig } from "../config.mjs";
import { createSecrets } from "../secrets.mjs";
import { createStore } from "../state/store.mjs";
import { createRegistry, resolveMcpLaunch } from "../registry.mjs";
import { createProjectClients } from "../mcp/project-client.mjs";
import { bus } from "../events.mjs";
import { ClawError } from "../errors.mjs";
import { bindPlacementService, createPlacementService } from "../placement.mjs";
import { createLaneDirectory, buildLanes } from "../lanes/directory.mjs";
import { createJobExecutor } from "../jobs/executor.mjs";
import { createDispatcher } from "../dispatcher.mjs";
import { getApprovalService } from "../approvals.mjs";
import { getBudgetService } from "../budget.mjs";
import workersFeature from "../features/workers.mjs";
import { createL2Receiver } from "../protocol/l2-receiver.mjs";
import { resolveForgeHome } from "../memory/l2-sync.mjs";

const USAGE = "Usage: pforge claw start [--home <dir>]";

function redactingLogger(secrets) {
  const write = (method) => (...values) => {
    const safe = values.map((value) => secrets.redact(
      typeof value === "string" ? value : JSON.stringify(value),
    ));
    console[method](...safe);
  };
  return { info: write("info"), warn: write("warn"), error: write("error") };
}

function startupError(error) {
  if (error instanceof ClawError) return error;
  return new ClawError("STARTUP_FAILED");
}

function cleanupAction(errors, operation) {
  return async () => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };
}

async function startupConfig(opts, home) {
  const load = opts.loadConfig ?? loadConfig;
  const loaded = opts.loadedConfig ?? await load({ home });
  const config = loaded.config;
  if (config && (!Array.isArray(config.allowlist) || config.allowlist.length === 0)) {
    throw new ClawError("ALLOWLIST_EMPTY", { hint: "Add at least one allowed Telegram user." });
  }
  if (!loaded.ok) {
    const problem = loaded.errors[0];
    throw new ClawError(problem.code, { hint: problem.hint });
  }
  assertStartable(config);
  const validation = await (opts.validateConfig ?? validateConfig)(config, { mode: "runtime" });
  if (!validation.ok) {
    const issue = validation.errors[0];
    throw new ClawError(issue.code, { hint: issue.hint });
  }
  return config;
}

async function startupSecrets({ opts, config, home }) {
  const secrets = opts.secrets ?? await (opts.createSecrets ?? createSecrets)({
    env: opts.env ?? process.env,
    file: path.join(home, "secrets.json"),
    trackNames: requiredSecretNames(config),
  });
  for (const { name } of requiredSecretNames(config)) {
    if (!secrets.has(name)) {
      throw new ClawError("SECRET_MISSING", {
        hint: `Set ${name} in the environment or ${path.join(home, "secrets.json")}.`,
      });
    }
  }
  return secrets;
}

function canonicalReceiver({ config, directory }) {
  const registered = structuredClone(config);
  const forward = createL2Receiver({ config: registered, currentLaneId: null, directory });
  const local = new Map(registered.lanes.filter((lane) => lane.kind === "local").map((lane) => [
    lane.id, createL2Receiver({ config: registered, currentLaneId: lane.id, directory }),
  ]));
  const projects = new Map(registered.projects.map((project) => [project.id, project]));
  const receiverFor = (projectId) => {
    const project = projects.get(projectId);
    if (!project) return forward;
    return local.get(resolveForgeHome({ project, config: registered }).laneId) ?? forward;
  };
  return {
    receive: (transfer, options) => receiverFor(transfer?.projectId).receive(transfer, options),
    read: (request, options) => receiverFor(request?.projectId).read(request, options),
  };
}

function dispatcherContext({ opts, home, config, secrets, store, registry, projectRegistry, logger, clients, lanes, l2Receiver }) {
  return {
    home, config, secrets, store, registry, projectRegistry, logger,
    bus: opts.bus ?? bus, mcp: clients, projectClients: clients, lanes, l2Receiver,
    env: { ...(opts.env ?? process.env) },
    ...(typeof opts.now === "function" ? { now: opts.now } : {}),
    ...(opts.telegramTiming ? { telegramTiming: opts.telegramTiming } : {}),
    ...(Number.isFinite(opts.schedulerTickMs) && opts.schedulerTickMs > 0 ? { schedulerTickMs: opts.schedulerTickMs } : {}),
  };
}

function validateTelegramTiming(timing) {
  if (timing !== undefined && (!timing || Array.isArray(timing)
    || typeof timing.now !== "function" || typeof timing.sleep !== "function")) {
    throw new ClawError("CHANNEL_TIMING_INVALID");
  }
}

function installHistoryReceiver(ctx, workers) {
  const feature = workers ?? ctx.features?.workers ?? workersFeature;
  const workerRegistry = feature.registry?.();
  if (!workerRegistry) return;
  if (typeof workerRegistry.setL2Receiver !== "function") throw new ClawError("SERVICE_UNAVAILABLE", { service: "l2" });
  workerRegistry.setL2Receiver(ctx.l2Receiver.receive);
}

export async function bootDispatcher(opts = {}) {
  validateTelegramTiming(opts.telegramTiming);
  const home = opts.home ?? resolveHome({ env: opts.env ?? process.env });
  const config = await startupConfig(opts, home);
  const secrets = await startupSecrets({ opts, config, home });

  const store = opts.store ?? (opts.createStore ?? createStore)(
    path.join(home, "state"), { redact: secrets.redact },
  );
  const errors = [];
  let releaseLock = null;
  let clients = null;
  let app = null;
  let dispatcher = null;
  let unbindPlacement = null;
  let appStarted = false;
  let stopped = false;
  let stopPromise = null;
  const rollback = async () => {
    await cleanupAction(errors, () => dispatcher?.stop?.())();
    await cleanupAction(errors, () => app?.stop?.())();
    await cleanupAction(errors, () => unbindPlacement?.())();
    await cleanupAction(errors, () => clients?.closeAll?.())();
    await cleanupAction(errors, () => releaseLock?.())();
  };

  try {
    releaseLock = store.lock();
    const projectRegistry = (opts.createRegistry ?? createRegistry)(config);
    const registry = { ...projectRegistry, resolveMcpLaunch };
    const logger = opts.logger ?? redactingLogger(secrets);
    const lanes = (opts.createLaneDirectory ?? createLaneDirectory)();
    lanes.configure?.(config.lanes);
    const l2Receiver = canonicalReceiver({ config, directory: lanes });
    clients = (opts.createProjectClients ?? createProjectClients)({
      config, registry, logger, directory: lanes, secrets, env: opts.env ?? process.env,
    });
    const ctx = dispatcherContext({
      opts, home, config, secrets, store, registry, projectRegistry, logger, clients, lanes, l2Receiver,
    });
    const placementService = (opts.createPlacementService ?? createPlacementService)({
      store,
      config,
      health: () => lanes.snapshot(),
    });
    unbindPlacement = (opts.bindPlacementService ?? bindPlacementService)(placementService);
    app = (opts.createApp ?? createApp)(ctx);
    await app.start();
    appStarted = true;
    const executor = (opts.createJobExecutor ?? createJobExecutor)({
      ctx,
      clients,
      runtimeFactory: opts.runtimeFactory,
      createSession: opts.createSession,
      jobsFor: opts.jobsFor,
      workspaceFor: opts.workspaceFor,
    });
    (opts.buildLanes ?? buildLanes)({
      directory: lanes,
      config,
      bus: ctx.bus,
      runtimeFor: executor.runtimeFor,
      logger,
      workers: opts.workers,
      k8sApiFactory: opts.k8sApiFactory,
      ctx,
    });
    installHistoryReceiver(ctx, opts.workers);
    dispatcher = (opts.createDispatcher ?? createDispatcher)(ctx, {
      directory: lanes,
      placement: placementService,
      approvals: getApprovalService(),
      budget: getBudgetService(),
      now: opts.now,
      defer: opts.defer,
      tickMs: opts.tickMs,
      stopTimeoutMs: opts.stopTimeoutMs,
    });
    await dispatcher.start();
    void Promise.resolve(app.doctor()).then((results) => {
      for (const check of results) {
        if (check.status === "warn" || check.status === "fail") {
          logger.warn(`doctor ${check.id}: ${check.message}`, { code: check.code });
        }
      }
    }).catch((error) => {
      logger.warn("Dispatcher doctor check failed", { code: error?.code ?? "DOCTOR_FAILED" });
    });

    async function stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        await rollback();
        stopped = true;
        if (errors.length) throw new AggregateError(errors, "Claw dispatcher shutdown was incomplete.");
      })();
      return stopPromise;
    }

    return {
      home, config, secrets, store, registry, projectRegistry, logger, clients, lanes, ctx, app,
      executor, dispatcher, stop,
      get stopped() { return stopped; },
      get appStarted() { return appStarted; },
    };
  } catch (error) {
    await rollback();
    if (errors.length) throw new AggregateError([error, ...errors], "Claw startup failed and rollback was incomplete.");
    throw error;
  }
}

async function run(argv = []) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { home: { type: "string" } },
    });
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let handles;
  try {
    handles = await bootDispatcher({ home: parsed.values.home });
    await new Promise((resolve) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        try {
          await handles.stop();
          process.exitCode = 0;
        } finally {
          resolve();
        }
      };
      const onSignal = () => {
        void shutdown().catch((error) => {
          handles.logger.error("Dispatcher shutdown failed", { code: error?.code ?? "STOP_FAILED" });
          process.exitCode = 1;
          resolve();
        });
      };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    });
    return process.exitCode ?? 0;
  } catch (error) {
    const failure = startupError(error);
    process.stderr.write(`${failure.code}${failure.details?.hint ? `: ${failure.details.hint}` : ""}\n`);
    if (error instanceof AggregateError) {
      for (const cleanupError of error.errors.slice(1)) {
        process.stderr.write(`Cleanup failed: ${cleanupError?.code ?? "STOP_FAILED"}\n`);
      }
    }
    return 1;
  }
}

export default {
  name: "start",
  summary: "Start the Forge-Claw dispatcher",
  usage: USAGE,
  run,
};
