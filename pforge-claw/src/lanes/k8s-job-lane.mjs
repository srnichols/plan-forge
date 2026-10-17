import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { applyCopySet, bootstrapWorktree, COPYSET_MAX_BYTES, DEFAULT_COPY_PATHS, validateCopyEntry } from "../jobs/bootstrap.mjs";
import { snapshotExecutionChoices } from "../jobs/execution-choices.mjs";
import { resolvePforgeCommand, run } from "../jobs/worktree.mjs";
import { assertLane } from "./lane.mjs";
import { encodeDeltaChunks, L2_SYNC_INCOMPLETE } from "../memory/l2-sync.mjs";
import { applicationIdentity, matchesApplicationAck } from "../protocol/l2-ack.mjs";
import { createPodGitEnvironment } from "../k8s/pod-git-env.mjs";
import { streamJobEvents } from "../k8s/job-event-stream.mjs";

const DNS_LABEL_VALUE = /[^a-z0-9-]+/g;
const DNS_LABEL_EDGES = /^-+|-+$/g;
const JOB_KEY_PATTERN = /^[0-9a-f]{64}$/;
const FINAL_EVENT_TIMEOUT_MS = 10_000;
const MCP_READY_TIMEOUT_MS = 15_000;
const MCP_POLL_INTERVAL_MS = 200;
const MCP_STOP_TIMEOUT_MS = 1000;
const MCP_REQUEST_TIMEOUT_MS = 500;
const MCP_PORT = "3100";
const SYNC_ACK_POLL_MS = 100;
const JOB_NAME_MAX_LENGTH = 63;
const JOB_ID_MAX_LENGTH = 51;
const JOB_DEADLINE_SECONDS = 3600;
const JOB_TTL_SECONDS = 600;
const DEFAULT_RESOURCES = Object.freeze({
  requests: Object.freeze({ cpu: "500m", memory: "1Gi" }),
  limits: Object.freeze({ cpu: "2", memory: "4Gi" }),
});

function sanitizeLabel(value, maxLength = 63) {
  return String(value ?? "")
    .toLowerCase()
    .replace(DNS_LABEL_VALUE, "-")
    .replace(DNS_LABEL_EDGES, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "") || "unknown";
}

function uniqueLabel(value, maxLength = 63) {
  const original = String(value ?? "");
  const sanitized = sanitizeLabel(original);
  if (sanitized === original && original.length <= maxLength) return original;
  const suffix = createHash("sha256").update(original).digest("hex").slice(0, 8);
  const prefix = sanitizeLabel(sanitized, maxLength - suffix.length - 1);
  return `${prefix}-${suffix}`;
}

function secretKeyRef(name, key) {
  return { valueFrom: { secretKeyRef: { name, key } } };
}

function configuredSecret(secrets, key, defaultName, defaultKey) {
  const configured = secrets?.[key];
  if (configured === undefined && defaultName === null) return null;
  if (configured === false || configured === null) return null;
  const name = typeof configured === "string" ? configured : configured?.name ?? defaultName;
  const secretKey = typeof configured === "object" ? configured.key ?? defaultKey : defaultKey;
  if (typeof name !== "string" || !name || typeof secretKey !== "string" || !secretKey) {
    throw new ClawError("LANE_BAD_CONFIG");
  }
  return { name, key: secretKey };
}

function configuredLane(config, id) {
  const lanes = config?.lanes;
  if (Array.isArray(lanes)) return lanes.find((entry) => entry?.id === id);
  if (lanes && typeof lanes === "object") return lanes[id];
  return config?.lane?.id === id ? config.lane : null;
}

function resourceRequirements(resources) {
  const source = resources ?? {};
  return {
    requests: { ...DEFAULT_RESOURCES.requests, ...(source.requests ?? {}) },
    limits: { ...DEFAULT_RESOURCES.limits, ...(source.limits ?? {}) },
  };
}

function validateJobSpecIdentity({ job, project, lane, dispatcherUrl }) {
  if (!job || typeof job.id !== "string" || !job.id
    || !project || typeof project.id !== "string" || !project.id
    || !lane || typeof lane !== "object") {
    throw new ClawError("LANE_BAD_CONFIG");
  }
  if (typeof dispatcherUrl !== "string" || !dispatcherUrl.trim()) throw new ClawError("LANE_BAD_CONFIG");
}

function jobDeadlines(k8s) {
  const deadlineSeconds = k8s.deadlineSeconds ?? JOB_DEADLINE_SECONDS;
  const ttlSecondsAfterFinished = k8s.ttlSecondsAfterFinished ?? JOB_TTL_SECONDS;
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds <= 0
    || !Number.isInteger(ttlSecondsAfterFinished) || ttlSecondsAfterFinished < 0) {
    throw new ClawError("LANE_BAD_CONFIG");
  }
  return { deadlineSeconds, ttlSecondsAfterFinished };
}

function jobName(jobId) {
  return `pforge-claw-${uniqueLabel(jobId, JOB_ID_MAX_LENGTH)}`
    .slice(0, JOB_NAME_MAX_LENGTH).replace(/-+$/g, "");
}

function appendSecretEnvironment({ env, name, reference }) {
  if (reference) env.push({ name, ...secretKeyRef(reference.name, reference.key) });
}

function jobEnvironment({ job, lane, dispatcherUrl, jobKey, deadlineSeconds }) {
  const env = [
    { name: "PFORGE_CLAW_DISPATCHER_URL", value: dispatcherUrl },
    { name: "PFORGE_CLAW_JOB_ID", value: job.id },
    ...(jobKey === undefined ? [] : [{ name: "PFORGE_CLAW_JOB_KEY", value: jobKey }]),
    { name: "PFORGE_CLAW_LANE_ID", value: lane.id },
    { name: "PFORGE_CLAW_JOB_DEADLINE_SECONDS", value: String(deadlineSeconds) },
    { name: "HOME", value: "/work/home" },
    { name: "PFORGE_CLAW_HOME", value: "/work/claw" },
  ];
  const secrets = lane.k8s?.secrets ?? {};
  const githubSecret = configuredSecret(secrets, "github", "pforge-claw-github", "token");
  const copilotSecret = configuredSecret(secrets, "copilot", null, "token");
  const bridgeSecretRef = configuredSecret(secrets, "bridge", null, "secret");
  if (!githubSecret || (jobKey !== undefined && !JOB_KEY_PATTERN.test(jobKey))) throw new ClawError("LANE_BAD_CONFIG");
  env.push({ name: "PFORGE_CLAW_GH_TOKEN", ...secretKeyRef(githubSecret.name, githubSecret.key) });
  appendSecretEnvironment({ env, name: "PFORGE_CLAW_COPILOT_TOKEN", reference: copilotSecret });
  appendSecretEnvironment({ env, name: "PFORGE_BRIDGE_SECRET", reference: bridgeSecretRef });
  appendExtraSecrets({ env, references: secrets.env ?? {}, job, lane });
  return env;
}

function signedSecretNames(job) {
  if (!job.leaseGrant) return null;
  if (job.provider && Object.hasOwn(job.provider, "apiKey")) throw new ClawError("LANE_BAD_CONFIG");
  const names = new Set(job.project?.bootstrap?.env ?? []);
  if (job.provider?.keySecret) names.add(job.provider.keySecret);
  return names;
}

function appendExtraSecrets({ env, references, job, lane }) {
  const required = signedSecretNames(job);
  const laneCredentials = new Set([
    "PFORGE_CLAW_WORKER_SECRET", "PFORGE_CLAW_K8S_LANE_SECRET", lane.k8s?.laneSecret,
  ]);
  for (const [envName, reference] of Object.entries(references)) {
    if (laneCredentials.has(envName) || envName === "PFORGE_CLAW_JOB_KEY"
      || env.some((entry) => entry.name === envName) || !/^[A-Z][A-Z0-9_]*$/.test(envName)
      || typeof reference?.name !== "string" || !reference.name
      || typeof reference.key !== "string" || !reference.key) {
      throw new ClawError("LANE_BAD_CONFIG");
    }
    if (required && !required.has(envName)) continue;
    env.push({ name: envName, ...secretKeyRef(reference.name, reference.key) });
  }
  for (const envName of required ?? []) {
    if (!env.some((entry) => entry.name === envName && entry.valueFrom?.secretKeyRef)) {
      throw new ClawError("BOOTSTRAP_SECRET_MISSING");
    }
  }
}

function jobWorkspace(k8s) {
  const volumes = [{ name: "work", emptyDir: {} }, { name: "tmp", emptyDir: {} }];
  const volumeMounts = [
    { name: "work", mountPath: "/work" },
    { name: "tmp", mountPath: "/tmp" },
  ];
  const claimName = k8s.repoCache?.claimName;
  if (claimName) {
    volumes.push({ name: "repo-cache", persistentVolumeClaim: { claimName } });
    volumeMounts.push({ name: "repo-cache", mountPath: "/cache", readOnly: true });
  }
  return { volumes, volumeMounts };
}

export function buildJobSpec({ job, project, lane, dispatcherUrl, jobKey } = {}) {
  validateJobSpecIdentity({ job, project, lane, dispatcherUrl });
  const k8s = lane.k8s ?? {};
  const image = project.image ?? k8s.defaultImage;
  if (typeof image !== "string" || !image.trim()) throw new ClawError("K8S_NO_IMAGE");
  const { deadlineSeconds, ttlSecondsAfterFinished } = jobDeadlines(k8s);
  const labels = {
    "app.kubernetes.io/part-of": "pforge-claw",
    "pforge-claw/job-id": uniqueLabel(job.id),
    "pforge-claw/project": uniqueLabel(project.id),
  };
  const env = jobEnvironment({ job, lane, dispatcherUrl, jobKey, deadlineSeconds });
  const { volumes, volumeMounts } = jobWorkspace(k8s);
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: jobName(job.id), labels,
      annotations: { "pforge-claw/cleanup-after-ack-seconds": String(ttlSecondsAfterFinished) },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: deadlineSeconds,
      template: {
        metadata: { labels: { ...labels, "pforge-claw/role": "job" } },
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 10001,
            fsGroup: 10001,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [{
            name: "worker",
            image,
            command: ["pforge", "claw", "worker", "--one-shot", "--job", job.id],
            env,
            resources: resourceRequirements(k8s.resources),
            securityContext: {
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              capabilities: { drop: ["ALL"] },
            },
            volumeMounts,
          }],
          volumes,
        },
      },
    },
  };
}

function errorReason(error) {
  return error?.details?.reason ?? error?.code ?? "unknown";
}

function finished(jobId, data, seq = 1, now = Date.now) {
  return {
    v: 1,
    jobId,
    seq,
    ts: new Date(now()).toISOString(),
    type: "finished",
    data,
  };
}

function isNotFound(error) {
  return error?.code === "K8S_API" && error.details?.status === 404;
}

async function probeMcp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS) });
    return Number.isInteger(response.status);
  } catch {
    return false;
  }
}

function validateMcpOptions({ repoDir, spawnFn, now, sleep }) {
  if (typeof repoDir !== "string" || !repoDir || typeof spawnFn !== "function"
    || typeof now !== "function" || typeof sleep !== "function") {
    throw new ClawError("L2_MCP_START_FAILED");
  }
}

/**
 * Start the project MCP HTTP server on the pod-local fixed port.
 * @param {{repoDir: string, env?: object, runner?: Function, spawnFn?: Function, now?: Function, sleep?: Function}} options
 */
export async function startPodMcp({
  repoDir, env = process.env, runner = run, spawnFn = spawn, now = Date.now,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  void runner;
  validateMcpOptions({ repoDir, spawnFn, now, sleep });
  let child;
  try {
    child = spawnFn(process.execPath, [
      path.join(repoDir, "pforge-mcp", "server.mjs"), "--port", MCP_PORT,
    ], { cwd: repoDir, env, stdio: "ignore", windowsHide: true });
  } catch {
    throw new ClawError("L2_MCP_START_FAILED");
  }
  if (!child || typeof child.once !== "function" || typeof child.kill !== "function") {
    throw new ClawError("L2_MCP_START_FAILED");
  }
  let spawnFailed = false;
  child.once("error", () => { spawnFailed = true; });
  const isRunning = () => !spawnFailed && child.exitCode === null && child.signalCode === null;
  const stop = async () => {
    if (!isRunning()) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, MCP_STOP_TIMEOUT_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  };
  const expiresAt = now() + MCP_READY_TIMEOUT_MS;
  while (isRunning() && now() < expiresAt) {
    if (await probeMcp(`http://127.0.0.1:${MCP_PORT}/mcp`)) {
      await sleep(MCP_POLL_INTERVAL_MS);
      if (isRunning()) return { stop };
      break;
    }
    await sleep(Math.min(MCP_POLL_INTERVAL_MS, Math.max(0, expiresAt - now())));
  }
  await stop();
  throw new ClawError("L2_MCP_START_FAILED");
}

async function bridgeSecret(repoDir, suppliedEnv) {
  if (suppliedEnv.PFORGE_BRIDGE_SECRET) return suppliedEnv.PFORGE_BRIDGE_SECRET;
  try {
    return (await readFile(path.join(repoDir, ".forge", "bridge-secret"), "utf8")).trim();
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function drainPodMemory({ repoDir, runner, suppliedEnv }) {
  const pforgeCommand = resolvePforgeCommand({
    config: suppliedEnv.config ?? suppliedEnv,
    cwd: repoDir,
  });
  const childEnv = Object.fromEntries(Object.entries(suppliedEnv)
    .filter(([key, value]) => key !== "config" && typeof value === "string"));
  const secret = await bridgeSecret(repoDir, suppliedEnv);
  if (secret) childEnv.PFORGE_BRIDGE_SECRET = secret;
  try {
    return await runner(pforgeCommand[0], [...pforgeCommand.slice(1), "drain-memory"], {
      cwd: repoDir, env: childEnv,
    });
  } catch {
    return { code: -1 };
  }
}

/**
 * Poll a dispatcher sequence acknowledgement until it arrives or its deadline expires.
 * @param {{getAckedSeq: Function, targetSeq: number, deadlineMs: number, now?: Function, sleep?: Function}} options
 */
export async function awaitSyncAck({
  getAckedSeq, targetSeq, deadlineMs, now = Date.now,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  if (typeof getAckedSeq !== "function" || !Number.isFinite(targetSeq)
    || !Number.isFinite(deadlineMs) || typeof now !== "function" || typeof sleep !== "function") {
    throw new ClawError("L2_MALFORMED");
  }
  while (now() < deadlineMs) {
    if (await getAckedSeq() >= targetSeq) return true;
    await sleep(Math.min(SYNC_ACK_POLL_MS, Math.max(0, deadlineMs - now())));
  }
  return false;
}

/**
 * Run the pod's final memory drain and transfer, always stopping the MCP server.
 * @param {object} options
 */
export async function finalizePodJob({
  repoDir, runner = run, env = process.env, startMcp = startPodMcp,
  collectDelta, awaitAck, deadlineMs, now = Date.now, jobId = env.PFORGE_CLAW_JOB_ID, projectId,
} = {}) {
  if (typeof collectDelta !== "function" || typeof awaitAck !== "function"
    || !Number.isFinite(deadlineMs) || typeof now !== "function") {
    throw new ClawError("L2_MALFORMED");
  }
  const mcp = await startMcp({ repoDir, runner, env });
  try {
    await drainPodMemory({ repoDir, runner, suppliedEnv: env });
    const collected = await collectDelta({ repoDir });
    if (!collected) return { status: "ok" };
    const delta = snapshotExecutionChoices(collected);
    const chunks = encodeDeltaChunks({ delta, deltaId: `${jobId}:pod-finalize:v1` });
    let transfer;
    try {
      transfer = snapshotExecutionChoices({
        ...applicationIdentity({ jobId, projectId, deltaId: chunks[0].deltaId, sha256Total: chunks[0].sha256Total }),
        chunks,
      });
    } catch {
      return { status: "failed", reason: L2_SYNC_INCOMPLETE };
    }
    const remainingMs = Math.max(0, deadlineMs - now());
    if (!remainingMs) return { status: "failed", reason: L2_SYNC_INCOMPLETE };
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(false), remainingMs);
    });
    try {
      const acknowledgement = await Promise.race([
        awaitAck({ delta, transfer, deadlineMs, timeoutMs: remainingMs }),
        timeout,
      ]);
      const acknowledged = matchesApplicationAck(transfer, acknowledgement) && acknowledgement.ok === true;
      return acknowledged
        ? { status: "ok", applicationAck: snapshotExecutionChoices({ ...applicationIdentity(transfer), ok: true }) }
        : { status: "failed", reason: L2_SYNC_INCOMPLETE };
    } catch {
      return { status: "failed", reason: L2_SYNC_INCOMPLETE };
    } finally {
      clearTimeout(timeoutId);
    }
  } finally {
    await mcp?.stop?.();
  }
}

function unsupportedRemote(remote) {
  try {
    const url = new URL(remote);
    return url.protocol !== "https:" || !url.hostname || Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return true;
  }
}

function podK8sConfig(config) {
  return config.lane?.k8s
    ?? config.k8s
    ?? config.lanes?.find?.((entry) => entry.kind === "k8s")?.k8s
    ?? {};
}

async function clonePodRepository({ project, config, repoDir, workdir, runner, env }) {
  const remote = project.repo.url ?? project.repo.remote;
  const baseBranch = project.repo.defaultBranch ?? project.repo.baseBranch;
  if (unsupportedRemote(remote)) {
    return { ok: false, reason: "bootstrap", step: "clone", code: "REMOTE_AUTH_UNSUPPORTED" };
  }
  const cloneArgs = ["clone"];
  const laneK8s = podK8sConfig(config);
  if (laneK8s.repoCache?.claimName) cloneArgs.push("--reference", "/cache");
  cloneArgs.push("--depth", "1", "--branch", baseBranch, "--", remote, repoDir);
  try {
    await mkdir(env.HOME, { recursive: true });
    const clone = await runner("git", cloneArgs, { cwd: workdir, env });
    if (clone?.code === 0) return { ok: true };
  } catch {
    return { ok: false, reason: "bootstrap", step: "clone", code: "REPO_CLONE_FAILED" };
  }
  return { ok: false, reason: "bootstrap", step: "clone", code: "REPO_CLONE_FAILED" };
}

async function copyPodBootstrapFiles({ job, project, config, repoDir, requestCopySet, runner, env }) {
  try {
    const branch = await runner("git", ["-C", repoDir, "checkout", "-b", `claw/${job.id}`], { env });
    if (branch.code !== 0) throw new ClawError("WORKTREE_ADD_FAILED");
    const requested = project.bootstrap?.copy ?? config.bootstrap?.copy ?? DEFAULT_COPY_PATHS;
    const allowedPaths = requested.map(validateCopyEntry);
    const response = await requestCopySet(requested);
    const files = Array.isArray(response) ? response : response?.files;
    if (!Array.isArray(files)) throw new ClawError("BOOTSTRAP_COPY_INVALID");
    for (const file of files) {
      const relative = validateCopyEntry(file?.path);
      if (!allowedPaths.includes(relative)) {
        throw new ClawError("BOOTSTRAP_COPY_INVALID");
      }
    }
    if (files.length !== new Set(allowedPaths).size) throw new ClawError("CLAW_COPYSET_MISSING");
    await applyCopySet({ repoPath: repoDir, files, maxBytes: COPYSET_MAX_BYTES });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "bootstrap", step: "copy", code: error.code ?? "BOOTSTRAP_COPY_INVALID" };
  }
}

function validPodJobInputs({ job, project, requestCopySet, runner }) {
  const remote = project?.repo?.url ?? project?.repo?.remote;
  const baseBranch = project?.repo?.defaultBranch ?? project?.repo?.baseBranch;
  return Boolean(job && typeof remote === "string" && remote && typeof baseBranch === "string" && baseBranch
    && typeof requestCopySet === "function" && typeof runner === "function");
}

function podBootstrapEnvironment({ env, bootstrap, secrets }) {
  const bootEnv = { ...env };
  for (const name of bootstrap.env ?? []) {
    const value = secrets?.get?.(name);
    if (typeof value !== "string" || !value) throw new ClawError("BOOTSTRAP_SECRET_MISSING");
    bootEnv[name] = value;
  }
  return createPodGitEnvironment({ env: bootEnv, home: env.HOME, secrets });
}

export async function runPodJob({
  job, project, config = {}, requestCopySet, runner = run, workdir = "/work",
  env: suppliedEnv = process.env,
  secrets = { get: (name) => process.env[name] },
} = {}) {
  if (!validPodJobInputs({ job, project, requestCopySet, runner })) {
    return { ok: false, reason: "bootstrap", step: "clone" };
  }
  const repoDir = path.join(workdir, "repo");
  const env = createPodGitEnvironment({ env: suppliedEnv, home: path.join(workdir, "home"), secrets });
  const cloned = await clonePodRepository({ project, config, repoDir, workdir, runner, env });
  if (!cloned.ok) return cloned;
  const copied = await copyPodBootstrapFiles({ job, project, config, repoDir, requestCopySet, runner, env });
  if (!copied.ok) return copied;
  const bootstrapConfig = {
    ...config,
    bootstrap: {
      ...config.bootstrap, ...project.bootstrap,
      copy: [], install: project.bootstrap?.install ?? config.bootstrap?.install ?? "ci",
    },
  };
  let jobEnv;
  try {
    jobEnv = podBootstrapEnvironment({ env, bootstrap: bootstrapConfig.bootstrap, secrets });
  } catch (error) {
    return { ok: false, reason: "bootstrap", step: "environment", code: error.code ?? "BOOTSTRAP_SECRET_MISSING" };
  }
  const result = await bootstrapWorktree({
    job,
    worktree: repoDir,
    forgeHome: repoDir,
    homeRepo: repoDir,
    config: bootstrapConfig,
    secrets,
    runner: (command, args, options = {}) => runner(command, args, {
      ...options,
      env: jobEnv,
    }),
  });
  if (!result.ok) return result;
  return {
    ok: true, repoDir,
    env: jobEnv,
  };
}

function validateLanePorts({ id, lane, api, registry, connectTimeoutMs, now }) {
  if (typeof id !== "string" || !id || lane?.kind !== "k8s"
    || !Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0 || typeof now !== "function") {
    throw new ClawError("LANE_BAD_CONFIG");
  }
  for (const [port, methods] of [
    [api, ["createJob", "deleteJob", "watchJob", "getJob"]],
    [registry, ["enqueue", "cancel", "registerPending", "revoke"]],
  ]) {
    if (!port || methods.some((method) => typeof port[method] !== "function")) {
      throw new ClawError("LANE_BAD_CONFIG");
    }
  }
}

async function createOrAdoptJob({ api, namespace, spec, jobId, recordError }) {
  try {
    await api.createJob(namespace, spec);
    return null;
  } catch (error) {
    if (error?.code !== "K8S_API" || error.details?.status !== 409) {
      recordError(error);
      return { status: "failed", error: "K8S_API", reason: errorReason(error) };
    }
    try {
      const existing = await api.getJob(namespace, spec.metadata.name);
      if (existing?.metadata?.labels?.["pforge-claw/job-id"] !== uniqueLabel(jobId)) {
        return { status: "failed", error: "JOB_DUPLICATE", reason: "conflict" };
      }
      return null;
    } catch (readError) {
      return { status: "failed", error: "K8S_API", reason: errorReason(readError) };
    }
  }
}

function prepareJobSubmission({ job, config, lane, dispatcherUrl, jobKeyFor }) {
  const project = config.projects?.find((entry) => entry.id === job.projectId);
  if (!project) throw new ClawError("LANE_BAD_CONFIG");
  const jobKey = jobKeyFor(job.id);
  if (typeof jobKey !== "string" || !JOB_KEY_PATTERN.test(jobKey)) throw new ClawError("K8S_LANE_SECRET_MISSING");
  const spec = buildJobSpec({ job, project, lane, dispatcherUrl, jobKey });
  return {
    spec,
    name: spec.metadata.name,
    byokOnly: !spec.spec.template.spec.containers[0].env
      .some((entry) => entry.name === "PFORGE_CLAW_COPILOT_TOKEN"),
  };
}

function canonicalCompletion({ registry, job, event }) {
  if (event.type !== "finished" || event.data?.status !== "succeeded") return event;
  const completion = appliedCompletion(registry, job.id);
  if (completion && completion.applicationAck.projectId === job.projectId && completion.event.seq === event.seq
    && matchesApplicationAck(completion.applicationAck, event.data.l2)) return event;
  return { ...event, data: { ...event.data, status: "failed", reason: L2_SYNC_INCOMPLETE } };
}

function appliedCompletion(registry, jobId) {
  const completion = registry.completion?.(jobId);
  const ack = completion?.applicationAck;
  if (completion?.ok !== true || ack?.ok !== true || ack.jobId !== jobId || completion.event?.jobId !== jobId
    || !matchesApplicationAck(ack, completion.event.data?.l2)) return null;
  return completion;
}

function cleanupEligible({ registry, jobId, active }) {
  if (active && !active.started) return true;
  return Boolean(appliedCompletion(registry, jobId));
}

export function createK8sJobLane({
  id,
  config,
  api,
  registry,
  now = Date.now,
  connectTimeoutMs = 120_000,
  jobKeyFor,
  canDeriveJobKeys = () => false,
} = {}) {
  const lane = configuredLane(config, id);
  validateLanePorts({ id, lane, api, registry, connectTimeoutMs, now });
  const k8s = lane.k8s ?? {};
  const namespace = k8s.namespace;
  const dispatcherUrl = config.worker?.dispatcherUrl;
  if (typeof namespace !== "string" || !/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(namespace)
    || typeof dispatcherUrl !== "string" || !dispatcherUrl) {
    throw new ClawError("LANE_BAD_CONFIG");
  }

  const activeJobs = new Map();
  const cancelIntent = new Set();
  const copilot = configuredSecret(k8s.secrets ?? {}, "copilot", null, "token");
  const byokOnly = !copilot;
  let lastError;
  let incompleteSyncs = 0;

  async function deleteIgnoringNotFound(name) {
    try {
      await api.deleteJob(namespace, name);
      return { ok: true };
    } catch (error) {
      if (isNotFound(error)) return { ok: true };
      lastError = { code: error?.code ?? "K8S_API", reason: errorReason(error) };
      return { ok: false, error: error?.code ?? "K8S_API" };
    }
  }

  async function* submit(job) {
    if (!canDeriveJobKeys()) {
      yield finished(job.id, { status: "failed", error: "K8S_LANE_SECRET_MISSING" });
      return;
    }
    let submission;
    try {
      submission = prepareJobSubmission({ job, config, lane, dispatcherUrl, jobKeyFor });
    } catch (error) {
      yield finished(job?.id, { status: "failed", error: error?.code ?? "LANE_BAD_CONFIG", reason: errorReason(error) });
      return;
    }

    const { spec, name, byokOnly } = submission;
    const record = { name, namespace, byokOnly, started: false };
    activeJobs.set(job.id, record);
    let source;

    try {
      registry.registerPending(id, job.id, { deadlineMs: now() + spec.spec.activeDeadlineSeconds * 1000 });
      const createError = await createOrAdoptJob({
        api, namespace, spec, jobId: job.id,
        recordError: (error) => { lastError = { code: error?.code ?? "K8S_API", reason: errorReason(error) }; },
      });
      if (createError) {
        yield finished(job.id, createError, 1, now);
        return;
      }

      const { iterator } = registry.enqueue(id, { kind: "job", job });
      source = iterator[Symbol.asyncIterator]();
      if (cancelIntent.has(job.id)) {
        await registry.cancel(job.id);
        await deleteIgnoringNotFound(name);
      }
      const events = streamJobEvents({
        jobId: job.id, source, now, connectTimeoutMs, finalTimeoutMs: FINAL_EVENT_TIMEOUT_MS,
        watch: (options) => api.watchJob(namespace, name, options),
        onStarted: () => { record.started = true; },
        onError: (error) => { lastError = error; },
        onIncomplete: () => {
          incompleteSyncs += 1;
          lastError = { code: L2_SYNC_INCOMPLETE, reason: L2_SYNC_INCOMPLETE };
        },
        onConnectionTimeout: () => deleteIgnoringNotFound(name),
      });
      for await (const event of events) {
        const checked = canonicalCompletion({ registry, job, event });
        if (checked !== event) {
          incompleteSyncs += 1;
          lastError = { code: L2_SYNC_INCOMPLETE, reason: L2_SYNC_INCOMPLETE };
        }
        if (checked.type === "finished" && checked.data?.status === "succeeded") {
          const cleanupTimer = setTimeout(() => { void deleteIgnoringNotFound(name); }, (k8s.ttlSecondsAfterFinished ?? JOB_TTL_SECONDS) * 1000);
          cleanupTimer.unref?.();
        }
        yield checked;
      }
    } finally {
      registry.revoke(job.id);
      activeJobs.delete(job.id);
      cancelIntent.delete(job.id);
    }
  }

  async function cancel(jobId) {
    const active = activeJobs.get(jobId);
    if (active) cancelIntent.add(jobId);
    let registryResult;
    let registryError;
    try {
      registryResult = await registry.cancel(jobId);
    } catch (error) {
      registryError = error?.code ?? "WORKER_CANCEL";
    }
    registry.revoke(jobId);
    if (!cleanupEligible({ registry, jobId, active })) {
      if (registryError) return { ok: false, error: registryError };
      return { ok: true, state: "cancelling", historyRetained: true };
    }
    const name = active?.name ?? jobName(jobId);
    const deletion = await deleteIgnoringNotFound(name);
    if (!deletion.ok) return deletion;
    if (registryError) return { ok: false, error: registryError };
    if (registryResult?.error && registryResult.error !== "JOB_UNKNOWN") {
      return { ok: false, error: registryResult.error };
    }
    return { ok: true, state: "cancelling" };
  }

  function health() {
    return {
      ok: canDeriveJobKeys(),
      kind: "k8s",
      id,
      namespace,
      active: activeJobs.size,
      byokOnly,
      incompleteSyncs,
      ...(!canDeriveJobKeys() ? { code: "K8S_LANE_SECRET_MISSING" } : {}),
      ...(lastError ? { lastError } : {}),
    };
  }

  return assertLane({ kind: "k8s", id, capabilities: lane.capabilities ?? {}, submit, cancel, health });
}
