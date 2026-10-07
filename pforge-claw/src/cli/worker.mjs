import path from "node:path";
import { parseArgs } from "node:util";
import { buildLaunch, createProjectClients } from "../mcp/project-client.mjs";
import { createAgentRuntime } from "../runtime/agent-runtime.mjs";
import { toSessionMcpServers } from "../runtime/copilot-session.mjs";
import { createLocalLane } from "../lanes/local-lane.mjs";
import { loadConfig, requiredSecretNames, resolveHome } from "../config.mjs";
import { createSecrets } from "../secrets.mjs";
import { createStore } from "../state/store.mjs";
import { createRegistry, resolveMcpLaunch } from "../registry.mjs";
import { createEnrollment } from "../protocol/enrollment.mjs";
import { writeSecret } from "../protocol/secret-file.mjs";
import { enrollWorker, createWorkerAgent, detectCapabilities } from "../protocol/worker-agent.mjs";
import { ClawError } from "../errors.mjs";

const USAGE = [
  "Usage: pforge claw worker [enroll --lane <id> | join --code <code> [--url <ws(s)>] | revoke <workerId> | [--home <dir>]]",
  "",
  "Worker transport: use wss:// with ingress TLS or a private Tailscale/WireGuard overlay.",
  "allowInsecureLan permits plain LAN WebSockets and emits a warning on every connection attempt.",
  "Worker secrets are stored in <home>/secrets.json with restricted file permissions.",
].join("\n");
const DEFAULT_WORKER_SECRET = "PFORGE_CLAW_WORKER_SECRET";

function parse(argv) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        home: { type: "string" },
        lane: { type: "string" },
        code: { type: "string" },
        url: { type: "string" },
        "one-shot": { type: "boolean" },
        job: { type: "string" },
      },
    });
  } catch {
    return null;
  }
}

async function loadRuntimeConfig(home) {
  const loaded = await loadConfig({ home });
  if (!loaded.ok) {
    const issue = loaded.errors[0];
    throw new ClawError(issue.code, { hint: issue.hint });
  }
  return loaded.config;
}

function createEnrollmentContext({ home, secrets }) {
  const store = createStore(path.join(home, "state"), { redact: secrets.redact });
  return { store, enrollment: createEnrollment({ store, secretFile: path.join(home, "secrets.json") }) };
}

function lockStore(store) {
  try {
    return store.lock();
  } catch (error) {
    if (error.code === "STATE_LOCKED") {
      throw new ClawError("STATE_LOCKED", {
        hint: "Stop the dispatcher before enrolling or revoking a worker.",
      });
    }
    throw error;
  }
}

async function withDispatcherLock({ home, config, action }) {
  const secrets = await createSecrets({
    file: path.join(home, "secrets.json"),
    trackNames: requiredSecretNames(config),
  });
  const { store, enrollment } = createEnrollmentContext({ home, secrets });
  const release = lockStore(store);
  try {
    return await action(enrollment);
  } finally {
    release();
  }
}

async function enrollCommand({ home, config, laneId }) {
  if (!laneId) throw new ClawError("WORKER_USAGE", { hint: USAGE });
  const lane = (config.lanes ?? []).find((item) => item.id === laneId && item.kind === "remote");
  if (!lane) throw new ClawError("LANE_UNKNOWN", { hint: "Choose a configured remote lane." });
  const code = await withDispatcherLock({
    home, config, action: async (enrollment) => enrollment.issue(laneId),
  });
  process.stdout.write(`${code}\n`);
}

async function revokeCommand({ home, config, workerId }) {
  if (!workerId) throw new ClawError("WORKER_USAGE", { hint: USAGE });
  await withDispatcherLock({
    home, config, action: (enrollment) => enrollment.revoke(workerId),
  });
}

function resolveWorkerIdentity(store) {
  const worker = store.readJson("worker.json", null);
  if (!worker || typeof worker.workerId !== "string" || typeof worker.laneId !== "string") {
    throw new ClawError("WORKER_NOT_JOINED", { hint: "Run pforge claw worker join first." });
  }
  return worker;
}

async function joinCommand({ home, config, code, url }) {
  if (!code) throw new ClawError("WORKER_USAGE", { hint: USAGE });
  const workerConfig = config.worker ?? {};
  const laneId = workerConfig.laneId;
  if (!laneId) throw new ClawError("WORKER_LANE_REQUIRED", { hint: "Set worker.laneId in config.json." });
  const dispatcherUrl = url ?? workerConfig.dispatcherUrl;
  if (!dispatcherUrl) throw new ClawError("WORKER_URL_REQUIRED", { hint: "Set worker.dispatcherUrl or pass --url." });
  const result = await enrollWorker({
    url: dispatcherUrl,
    code,
    laneId,
    allowInsecureLan: workerConfig.allowInsecureLan === true,
  });
  const secretName = workerConfig.secretName ?? DEFAULT_WORKER_SECRET;
  const secretFile = path.join(home, "secrets.json");
  await writeSecret({ file: secretFile, name: secretName, value: result.secret });
  const store = createStore(path.join(home, "state"));
  store.writeJsonAtomic("worker.json", { v: 1, workerId: result.workerId, laneId });
  process.stdout.write(`${result.workerId}\n`);
}

async function makeWorkerRuntime({ config, secrets, projectRegistry, job }) {
  const project = projectRegistry.byId(job.projectId);
  if (!project) throw new ClawError("PROJECT_NOT_FOUND");
  const model = job.model ?? project.models?.work ?? project.models?.chat ?? config.runtimes?.default;
  const prompt = job.prompt ?? job.message;
  if (typeof model !== "string" || !model) throw new ClawError("MODEL_MISSING");
  if (typeof prompt !== "string" || !prompt) throw new ClawError("JOB_BAD_FIELD", { field: "prompt" });
  const runtime = await createAgentRuntime({
    id: job.runtime ?? config.worker?.runtime ?? config.runtimes?.default,
    config, secrets,
  });
  const launch = await buildLaunch({ ...project, homeLane: "local" }, config, {
    registry: { ...projectRegistry, resolveMcpLaunch },
  });
  return {
    run: (turn) => runtime.run({
      ...turn,
      model,
      prompt,
      cwd: job.cwd ?? project.repo.path,
      mcpServers: toSessionMcpServers({ launch }),
    }),
  };
}

function createWorkerLogger() {
  return {
    info: (...values) => console.info(...values),
    warn: (...values) => console.warn(...values),
    error: (...values) => console.error(...values),
  };
}

async function runWorker({ home, config, oneShot, jobId }) {
  if (oneShot || jobId) {
    throw new ClawError("WORKER_MODE_NOT_SUPPORTED", { hint: "--one-shot/--job is not yet supported." });
  }
  const workerConfig = config.worker ?? {};
  const secretName = workerConfig.secretName ?? DEFAULT_WORKER_SECRET;
  const secrets = await createSecrets({ env: process.env, file: path.join(home, "secrets.json"), trackNames: [secretName] });
  const secret = secrets.get(secretName);
  if (!secret) throw new ClawError("SECRET_MISSING", { hint: `Set ${secretName} in ${path.join(home, "secrets.json")}.` });
  const store = createStore(path.join(home, "state"), { redact: secrets.redact });
  const identity = resolveWorkerIdentity(store);
  const laneId = workerConfig.laneId ?? identity.laneId;
  if (identity.laneId !== laneId) throw new ClawError("WORKER_LANE_MISMATCH");
  const url = workerConfig.dispatcherUrl;
  if (!url) throw new ClawError("WORKER_URL_REQUIRED", { hint: "Set worker.dispatcherUrl in config.json." });
  const projectRegistry = createRegistry(config);
  const registry = { ...projectRegistry, resolveMcpLaunch };
  const logger = createWorkerLogger();
  const clients = createProjectClients({
    config,
    registry,
    logger,
    resolveLaunch: (project, currentConfig, options) => buildLaunch(
      { ...project, homeLane: "local" }, currentConfig, options,
    ),
  });
  const localLane = createLocalLane({
    id: laneId,
    config,
    runtimeFor: (job) => makeWorkerRuntime({ config, secrets, projectRegistry, job }),
  });
  const capabilities = await detectCapabilities({ config, laneId });
  const agent = createWorkerAgent({
    url, workerId: identity.workerId, secret, laneId, capabilities, localLane,
    readHandler: async ({ projectId, tool, args = {} }) => {
      const project = projectRegistry.byId(projectId);
      if (!project || project.homeLane !== laneId) throw new ClawError("PROJECT_NOT_FOUND");
      if (typeof tool !== "string" || !tool) throw new ClawError("READ_BAD_REQUEST");
      return clients.call(projectId, tool, args);
    },
    allowInsecureLan: workerConfig.allowInsecureLan === true,
    logger,
  });
  agent.start();
  await new Promise((resolve) => {
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      agent.stop();
      try {
        await clients.closeAll();
      } finally {
        resolve();
      }
    };
    const onSignal = () => { void stop(); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

async function run(argv = []) {
  const parsed = parse(argv);
  if (!parsed) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const [command = "run", ...positionals] = parsed.positionals;
  if (!["run", "enroll", "join", "revoke"].includes(command)) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const home = parsed.values.home ?? resolveHome();
  try {
    if (parsed.values["one-shot"] || parsed.values.job) {
      throw new ClawError("WORKER_MODE_NOT_SUPPORTED", { hint: "--one-shot/--job is not yet supported." });
    }
    if (command === "join" && positionals.length > 0) throw new ClawError("WORKER_USAGE", { hint: USAGE });
    if ((command === "run" || command === "enroll") && positionals.length > 0) {
      throw new ClawError("WORKER_USAGE", { hint: USAGE });
    }
    const config = await loadRuntimeConfig(home);
    if (command === "enroll") await enrollCommand({ home, config, laneId: parsed.values.lane });
    else if (command === "join") {
      await joinCommand({ home, config, code: parsed.values.code, url: parsed.values.url });
    }     else if (command === "revoke") {
      if (positionals.length !== 1) throw new ClawError("WORKER_USAGE", { hint: USAGE });
      await revokeCommand({ home, config, workerId: positionals[0] });
    }
    else await runWorker({
      home, config, oneShot: parsed.values["one-shot"], jobId: parsed.values.job,
    });
    return 0;
  } catch (error) {
    const failure = error instanceof ClawError ? error : new ClawError("WORKER_FAILED");
    process.stderr.write(`${failure.code}${failure.details?.hint ? `: ${failure.details.hint}` : ""}\n`);
    return 2;
  }
}

export default {
  name: "worker",
  summary: "Enroll, revoke, or run a Forge-Claw worker",
  usage: USAGE,
  run,
};
