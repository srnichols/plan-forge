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

  const home = parsed.values.home ?? resolveHome();
  let releaseLock = null;
  let app = null;
  let clients = null;
  try {
    const loaded = await loadConfig({ home });
    const config = loaded.config;
    if (config && (!Array.isArray(config.allowlist) || config.allowlist.length === 0)) {
      throw new ClawError("ALLOWLIST_EMPTY", { hint: "Add at least one allowed Telegram user." });
    }
    if (!loaded.ok) {
      const problem = loaded.errors[0];
      throw new ClawError(problem.code, { hint: problem.hint });
    }
    assertStartable(config);
    const validation = await validateConfig(config, { mode: "runtime" });
    if (!validation.ok) {
      const issue = validation.errors[0];
      throw new ClawError(issue.code, { hint: issue.hint });
    }
    const secrets = await createSecrets({
      env: process.env,
      file: path.join(home, "secrets.json"),
      trackNames: requiredSecretNames(config),
    });
    for (const { name } of requiredSecretNames(config)) {
      if (!secrets.has(name)) {
        throw new ClawError("SECRET_MISSING", { hint: `Set ${name} in the environment or ${path.join(home, "secrets.json")}.` });
      }
    }
    const store = createStore(path.join(home, "state"), { redact: secrets.redact });
    releaseLock = store.lock();
    const projectRegistry = createRegistry(config);
    const registry = { ...projectRegistry, resolveMcpLaunch };
    const logger = redactingLogger(secrets);
    clients = createProjectClients({ config, registry, logger });
    const ctx = {
      home,
      config,
      secrets,
      store,
      registry,
      projectRegistry,
      logger,
      bus,
      mcp: clients,
    };
    app = createApp(ctx);
    await app.start();
    // Startup self-check: surface feature warnings (observer down, memory unreachable, …) in the dispatcher log.
    void app.doctor().then((results) => {
      for (const check of results) {
        if (check.status === "warn" || check.status === "fail") logger.warn(`doctor ${check.id}: ${check.message}`, { code: check.code });
      }
    });
    await new Promise((resolve) => {
      let stopping = false;
      const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        try {
          await app.stop();
          process.exitCode = 0;
        } finally {
          releaseLock?.();
          resolve();
        }
      };
      const onSignal = () => { void shutdown().catch((error) => {
        logger.error("Dispatcher shutdown failed", { code: error?.code ?? "STOP_FAILED" });
        process.exitCode = 1;
        releaseLock?.();
        resolve();
      }); };
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    });
    return process.exitCode ?? 0;
  } catch (error) {
    const failure = startupError(error);
    process.stderr.write(`${failure.code}${failure.details?.hint ? `: ${failure.details.hint}` : ""}\n`);
    try {
      await app?.stop();
      await clients?.closeAll();
    } catch (cleanupError) {
      process.stderr.write(`Cleanup failed: ${cleanupError?.code ?? "STOP_FAILED"}\n`);
    } finally {
      releaseLock?.();
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
