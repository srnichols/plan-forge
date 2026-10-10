import path from "node:path";
import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { buildLaunch, createProjectClients } from "../mcp/project-client.mjs";
import { createJobExecutor, executionConfigFor } from "../jobs/executor.mjs";
import { snapshotExecutionChoices } from "../jobs/execution-choices.mjs";
import { clonedWorkspace, createLeaseJobSource, deferredWorktreeWorkspace } from "../jobs/lease-jobs.mjs";
import { collectCopySet } from "../jobs/bootstrap.mjs";
import { LEASE_GRANT_INVALID, verifyGrant } from "../protocol/lease-grant.mjs";
import { finalizePodJob, runPodJob } from "../lanes/k8s-job-lane.mjs";
import { computeDelta, snapshotForge } from "../memory/l2-sync.mjs";
import { run as runCommand } from "../jobs/worktree.mjs";
import { createLocalLane } from "../lanes/local-lane.mjs";
import { loadConfig, requiredSecretNames, resolveHome } from "../config.mjs";
import { createSecrets } from "../secrets.mjs";
import { createStore } from "../state/store.mjs";
import { createRegistry, resolveMcpLaunch } from "../registry.mjs";
import { createEnrollment } from "../protocol/enrollment.mjs";
import { writeSecret } from "../protocol/secret-file.mjs";
import { enrollWorker, createWorkerAgent, createL2Receiver, detectCapabilities } from "../protocol/worker-agent.mjs";
import { ClawError } from "../errors.mjs";
import { deltaApplicationIdentity, matchesApplicationAck, matchesLeaseAck } from "../protocol/l2-ack.mjs";
import { L2_ACK_ERRORS } from "../protocol/messages.mjs";

const USAGE = [
  "Usage: pforge claw worker [enroll --lane <id> [--rotate] | join --code <code> [--url <ws(s)>] | revoke <workerId> | --one-shot --job <id> | [--home <dir>]]",
  "",
  "Worker transport: use wss:// with ingress TLS or a private Tailscale/WireGuard overlay.",
  "allowInsecureLan permits plain LAN WebSockets and emits a warning on every connection attempt.",
  "Worker secrets are stored in <home>/secrets.json with restricted file permissions.",
].join("\n");
const DEFAULT_WORKER_SECRET = "PFORGE_CLAW_WORKER_SECRET";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

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
        rotate: { type: "boolean" },
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
  return { store, enrollment: createEnrollment({ store, secretFile: path.join(home, "secrets.json"), secrets }) };
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
    return await action(enrollment, secrets);
  } finally {
    release();
  }
}

export async function enrollCommand({ home, config, laneId, rotate = false }) {
  if (!laneId) throw new ClawError("WORKER_USAGE", { hint: USAGE });
  const lane = (config.lanes ?? []).find((item) => item.id === laneId && ["remote", "k8s"].includes(item.kind));
  if (!lane) throw new ClawError("LANE_UNKNOWN", { hint: "Choose a configured remote or k8s lane." });
  if (lane.kind === "k8s") {
    const name = lane.k8s?.laneSecret ?? "PFORGE_CLAW_K8S_LANE_SECRET";
    await withDispatcherLock({
      home, config, action: async (_enrollment, secrets) => {
        if (secrets.get(name) && !rotate) throw new ClawError("K8S_LANE_SECRET_EXISTS");
        await writeSecret({ file: path.join(home, "secrets.json"), name, value: randomBytes(32).toString("hex") });
        if (process.env[name]) process.stderr.write(`K8S_LANE_SECRET_ENV_OVERRIDE: ${name}\n`);
      },
    });
    process.stdout.write(`${name}\n`);
    return;
  }
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

export function leasedJob(job, { subject, laneId, key, expectJobId } = {}) {
  if (!job || typeof job !== "object" || Array.isArray(job)) throw new ClawError(LEASE_GRANT_INVALID);
  const { leaseGrant, ...plain } = job;
  verifyGrant({ grant: leaseGrant, job: plain, subject, laneId, key, expectJobId });
  return snapshotExecutionChoices(job);
}

function leaseIdentity(job) {
  const grant = job?.leaseGrant;
  if (typeof grant?.leaseId !== "string" || !grant.leaseId
    || !Number.isSafeInteger(grant.attempt) || grant.attempt < 1) return null;
  return { leaseId: grant.leaseId, attempt: grant.attempt };
}

function isSuccessfulTerminal(job, event) {
  return Boolean(event?.type === "finished" && event.jobId === job.id
    && event.data?.status === "succeeded" && event.data.l2?.ok === true);
}

function hasCleanupProof({ entry, job, event, applicationAck }) {
  if (!entry?.identity || !applicationAck || !job || job.projectId !== entry.job.projectId) return false;
  const lease = leaseIdentity(entry.job);
  return isSuccessfulTerminal(entry.job, event) && applicationAck.ok === true
    && matchesApplicationAck(entry.identity, applicationAck)
    && matchesApplicationAck(entry.identity, event.data.l2)
    && matchesLeaseAck(lease, job.leaseGrant) && matchesLeaseAck(lease, applicationAck);
}

export function createLeaseExecution({ ctx, clients, subject, laneId, key, runtimeFactory } = {}) {
  const workspaces = new Map();
  const verifiedJobs = new Map();
  const executionCtx = { ...ctx, projectClients: clients };
  let executor;
  function recordVerifiedLease(verified) {
    const previous = verifiedJobs.get(verified.id);
    if (previous && previous.leaseGrant.jobDigest !== verified.leaseGrant.jobDigest) {
      throw new ClawError(LEASE_GRANT_INVALID);
    }
    const previousLease = leaseIdentity(previous);
    const nextLease = leaseIdentity(verified);
    if (previousLease && (!nextLease || nextLease.attempt < previousLease.attempt
      || (nextLease.attempt === previousLease.attempt && nextLease.leaseId !== previousLease.leaseId))) {
      throw new ClawError(LEASE_GRANT_INVALID);
    }
    verifiedJobs.set(verified.id, verified);
    const entry = workspaces.get(verified.id);
    if (entry) entry.job = verified;
    return verified;
  }
  function workspaceFor(job) {
    const config = executionConfigFor({ job, config: ctx.config });
    const project = config.projects.find((entry) => entry.id === job.projectId);
    if (!project) throw new ClawError("PROJECT_NOT_FOUND");
    const workspace = deferredWorktreeWorkspace({
      repoPath: project.repo.path, jobId: job.id, home: ctx.home, project,
      config, secrets: ctx.secrets, runner: ctx.runner, bootstrapFiles: job.bootstrapFiles,
    });
    const verified = verifiedJobs.get(job.id);
    if (!verified) throw new ClawError(LEASE_GRANT_INVALID);
    workspaces.set(job.id, { workspace, job: verified, identity: null });
    return workspace;
  }
  return {
    verifyLease: (job) => recordVerifiedLease(leasedJob(job, { subject, laneId, key })),
    runtimeFor: (job) => {
      const verified = leasedJob(job, { subject, laneId, key });
      recordVerifiedLease(verified);
      executor ??= createJobExecutor({
        ctx: { ...executionCtx, externalHistoryDelivery: true }, clients, runtimeFactory,
        jobsFor: createLeaseJobSource, workspaceFor,
      });
      return executor.runtimeFor(verified);
    },
    l2: {
      forgeDirFor: (job) => workspaces.get(job.id)?.workspace.forgeDirFor(),
      snapshot: async () => null,
      collect: async ({ forgeDir, deltaId }) => {
        const entry = [...workspaces.values()].find((current) => current.workspace.forgeDirFor() === forgeDir);
        if (!entry) throw new ClawError("L2_WORKSPACE_MISSING");
        const delta = await entry.workspace.delta();
        entry.identity = deltaApplicationIdentity({ jobId: entry.job.id, projectId: entry.job.projectId, deltaId, delta });
        return delta;
      },
    },
    async afterJob({ job, event, applicationAck }) {
      const entry = workspaces.get(job.id);
      if (!hasCleanupProof({ entry, job, event, applicationAck })) {
        return { ok: false, code: L2_ACK_ERRORS.UNCONFIRMED };
      }
      await entry.workspace.release(null, { success: true });
      await entry.workspace.settle({ ok: true });
      workspaces.delete(job.id);
      verifiedJobs.delete(job.id);
      return { ok: true };
    },
  };
}

function createWorkerLogger() {
  return {
    info: (...values) => console.info(...values),
    warn: (...values) => console.warn(...values),
    error: (...values) => console.error(...values),
  };
}

async function runWorker({ home, config }) {
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
    currentLaneId: laneId,
    resolveLaunch: (project, currentConfig, options) => buildLaunch(
      project, currentConfig, { ...options, currentLaneId: laneId },
    ),
  });
  const ctx = { home, config, secrets, registry, logger, bus: new EventEmitter(), features: [] };
  const execution = createLeaseExecution({ ctx, clients, subject: identity.workerId, laneId, key: secret });
  const historyReceiver = createL2Receiver({ config, currentLaneId: laneId });
  const localLane = createLocalLane({
    id: laneId,
    config,
    runtimeFor: execution.runtimeFor,
  });
  const capabilities = await detectCapabilities({ config, laneId });
  const agent = createWorkerAgent({
    url, workerId: identity.workerId, secret, laneId, capabilities, localLane,
    verifyLease: execution.verifyLease, l2: execution.l2, afterJob: execution.afterJob,
    readHandler: async (request, { signal } = {}) => {
      const { projectId, tool, args = {} } = request;
      if (tool === "l2.apply") return historyReceiver.read(request, { signal });
      const project = projectRegistry.byId(projectId ?? args.projectId);
      if (!project || project.homeLane !== laneId) throw new ClawError("PROJECT_NOT_FOUND");
      if (typeof tool !== "string" || !tool) throw new ClawError("READ_BAD_REQUEST");
      if (tool === "claw.bootstrap.copySet") {
        return collectCopySet({ repoPath: project.repo.path, paths: project.bootstrap?.copy });
      }
      return clients.call(projectId, tool, args, { signal });
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
        await agent.drain();
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

function oneShotEnvironment(env, expectJobId) {
  const jobId = env.PFORGE_CLAW_JOB_ID;
  const laneId = env.PFORGE_CLAW_LANE_ID;
  const key = env.PFORGE_CLAW_JOB_KEY;
  const url = env.PFORGE_CLAW_DISPATCHER_URL;
  const seconds = Number(env.PFORGE_CLAW_JOB_DEADLINE_SECONDS);
  if (!IDENTIFIER.test(jobId ?? "") || !IDENTIFIER.test(laneId ?? "")
    || !/^[0-9a-f]{64}$/.test(key ?? "") || !url
    || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(seconds * 1000)
    || (expectJobId !== undefined && expectJobId !== jobId)) throw new ClawError("ONE_SHOT_ENV_MISSING");
  return { jobId, laneId, key, url, deadlineMs: Date.now() + seconds * 1000 };
}

async function podConfig(repoDir, job) {
  let forge;
  try {
    forge = JSON.parse(await readFile(path.join(repoDir, ".forge.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new ClawError("CONFIG_INVALID");
    forge = {};
  }
  if (!forge || typeof forge !== "object" || Array.isArray(forge)) throw new ClawError("CONFIG_INVALID");
  return podExecutionConfig(job, repoDir, forge);
}

function podExecutionConfig(job, repoDir, local = {}) {
  return executionConfigFor({
    job,
    config: {
      ...local,
      projects: [{
        id: job.projectId, homeLane: "local", models: local.models,
        repo: { ...job.project.repo, path: repoDir, baseBranch: job.project.repo.defaultBranch ?? job.project.repo.baseBranch },
      }],
    },
  });
}

export async function runOneShot(env = process.env, {
  jobId: expectJobId, workdir = "/work", runner = runCommand, runtimeFactory,
  clientsFactory = createProjectClients, finalize = finalizePodJob,
} = {}) {
  const { jobId, laneId, key, url, deadlineMs } = oneShotEnvironment(env, expectJobId);
  const subject = `job:${jobId}`;
  const secrets = await createSecrets({ env, trackNames: Object.keys(env) });
  const logger = createWorkerLogger();
  let clients;
  let forgeDir;
  let snapshot;
  let resolveDone;
  let terminal;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const localLane = createLocalLane({
    id: laneId,
    runtimeFor: (job) => ({ run: (input, options) => runPodLease(job, input, options) }),
  });

  async function runPodLease(job, input, options) {
    const verified = leasedJob(job, { subject, laneId, key, expectJobId: jobId });
    const bootstrapConfig = podExecutionConfig(verified, path.join(workdir, "repo"));
    const signal = input.signal;
    let jobEnv = { ...env };
    const podRunner = (command, args, commandOptions = {}) => {
      signal?.throwIfAborted();
      return runner(command, args, { ...commandOptions, env: commandOptions.env ?? jobEnv, signal });
    };
    const boot = await runPodJob({
      job: verified, project: verified.project, config: bootstrapConfig,
      requestCopySet: async () => verified.bootstrapFiles, env: jobEnv,
      workdir, runner: podRunner, secrets,
    });
    if (!boot.ok) throw new ClawError(boot.code ?? "BOOTSTRAP_FAILED", { reason: "bootstrap" });
    jobEnv = boot.env;
    const config = await podConfig(boot.repoDir, verified);
    forgeDir = path.join(boot.repoDir, ".forge");
    snapshot = await snapshotForge({ forgeDir });
    const registry = { ...createRegistry(config), resolveMcpLaunch };
    clients = clientsFactory({
      config, registry, logger, env: jobEnv,
      resolveLaunch: (project, currentConfig, launchOptions) => buildLaunch(
        { ...project, homeLane: "local" }, currentConfig, { ...launchOptions, env: jobEnv },
      ),
    });
    const executor = createJobExecutor({
      ctx: { config, secrets, registry, logger, env: jobEnv, bus: new EventEmitter(), features: [], runner: podRunner, projectClients: clients, externalHistoryDelivery: true },
      clients, runtimeFactory, jobsFor: createLeaseJobSource,
      workspaceFor: () => clonedWorkspace({ repoDir: boot.repoDir, env: boot.env, jobId }),
    });
    const runtime = await executor.runtimeFor(verified);
    const result = await runtime.run(input, options);
    const finalized = await finalize({
      repoDir: boot.repoDir, jobId, projectId: verified.projectId,
      env: jobEnv, runner: podRunner, deadlineMs,
      collectDelta: () => computeDelta({ forgeDir, snapshot }),
      awaitAck: ({ delta, transfer }) => agent.syncHistory({ jobId, delta, deltaId: transfer?.deltaId }),
    });
    return finalized.status === "failed" ? { status: "failed", error: "l2-sync-incomplete" } : result;
  }

  const agent = createWorkerAgent({
    url, workerId: subject, secret: key, laneId, jobScope: { jobId },
    localLane, logger,
    verifyLease: (job) => leasedJob(job, { subject, laneId, key, expectJobId: jobId }),
    l2: {
      forgeDirFor: () => forgeDir, snapshot: async () => null,
      collect: async () => snapshot ? computeDelta({ forgeDir, snapshot }) : null,
    },
    afterJob: ({ event }) => { terminal = event; },
    onLeaseAcked: ({ applicationAck }) => resolveDone(
      terminal?.data.status === "succeeded" && applicationAck?.ok === true
        && matchesApplicationAck(terminal.data.l2, applicationAck) ? 0 : 1,
    ),
    onPermanentClose: () => resolveDone(1),
  });
  const timer = setTimeout(() => {
    logger.error("l2-sync-incomplete");
    resolveDone(1);
  }, Math.max(0, deadlineMs - Date.now()));
  try {
    agent.start();
    return await done;
  } finally {
    clearTimeout(timer);
    agent.stop();
    await agent.drain();
    await clients?.closeAll();
  }
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
    const oneShot = parsed.values["one-shot"] || parsed.values.job;
    validateWorkerArguments({ command, positionals, oneShot });
    if (oneShot) {
      return await runOneShot(process.env, { jobId: parsed.values.job });
    }
    const config = await loadRuntimeConfig(home);
    await runWorkerCommand({ command, home, config, values: parsed.values, positionals });
    return 0;
  } catch (error) {
    const failure = error instanceof ClawError ? error : new ClawError("WORKER_FAILED");
    process.stderr.write(`${failure.code}${failure.details?.hint ? `: ${failure.details.hint}` : ""}\n`);
    return 2;
  }
}

function validateWorkerArguments({ command, positionals, oneShot }) {
  if (oneShot && command !== "run") throw new ClawError("WORKER_USAGE", { hint: USAGE });
  const expected = command === "revoke" ? 1 : 0;
  if (positionals.length !== expected) throw new ClawError("WORKER_USAGE", { hint: USAGE });
}

async function runWorkerCommand({ command, home, config, values, positionals }) {
  const actions = {
    enroll: () => enrollCommand({ home, config, laneId: values.lane, rotate: values.rotate }),
    join: () => joinCommand({ home, config, code: values.code, url: values.url }),
    revoke: () => revokeCommand({ home, config, workerId: positionals[0] }),
    run: () => runWorker({ home, config }),
  };
  return actions[command]();
}

export default {
  name: "worker",
  summary: "Enroll, revoke, or run a Forge-Claw worker",
  usage: USAGE,
  run,
};
