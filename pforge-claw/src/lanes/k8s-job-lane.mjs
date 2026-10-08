import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { bootstrapWorktree } from "../jobs/bootstrap.mjs";
import { assertInside, resolvePforgeCommand, run } from "../jobs/worktree.mjs";
import { assertLane } from "./lane.mjs";
import { L2_SYNC_INCOMPLETE } from "../memory/l2-sync.mjs";

const DNS_LABEL_VALUE = /[^a-z0-9-]+/g;
const DNS_LABEL_EDGES = /^-+|-+$/g;
const MAX_COPY_BYTES = 1024 * 1024;
const CONNECT_TIMEOUT_REASON = "worker-connect-timeout";
const FINAL_EVENT_TIMEOUT_MS = 10_000;
const MCP_READY_TIMEOUT_MS = 15_000;
const MCP_POLL_INTERVAL_MS = 200;
const MCP_STOP_TIMEOUT_MS = 1000;
const MCP_REQUEST_TIMEOUT_MS = 500;
const MCP_PORT = "3100";
const SYNC_ACK_POLL_MS = 100;
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

export function buildJobSpec({ job, project, lane, dispatcherUrl } = {}) {
  if (!job || typeof job.id !== "string" || !job.id
    || !project || typeof project.id !== "string" || !project.id
    || !lane || typeof lane !== "object") {
    throw new ClawError("LANE_BAD_CONFIG");
  }
  const k8s = lane.k8s ?? {};
  const image = project.image ?? k8s.defaultImage;
  if (typeof image !== "string" || !image.trim()) throw new ClawError("K8S_NO_IMAGE");
  if (typeof dispatcherUrl !== "string" || !dispatcherUrl.trim()) throw new ClawError("LANE_BAD_CONFIG");

  const deadlineSeconds = k8s.deadlineSeconds ?? 3600;
  const ttlSecondsAfterFinished = k8s.ttlSecondsAfterFinished ?? 600;
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds <= 0
    || !Number.isInteger(ttlSecondsAfterFinished) || ttlSecondsAfterFinished < 0) {
    throw new ClawError("LANE_BAD_CONFIG");
  }

  const safeJob = uniqueLabel(job.id, 51);
  const name = `pforge-claw-${safeJob}`.slice(0, 63).replace(/-+$/g, "");
  const labels = {
    "app.kubernetes.io/part-of": "pforge-claw",
    "pforge-claw/job-id": uniqueLabel(job.id),
    "pforge-claw/project": uniqueLabel(project.id),
  };
  const env = [
    { name: "PFORGE_CLAW_DISPATCHER_URL", value: dispatcherUrl },
    { name: "PFORGE_CLAW_JOB_ID", value: job.id },
    { name: "HOME", value: "/work/home" },
  ];
  const secrets = k8s.secrets ?? {};
  const workerSecret = configuredSecret(secrets, "worker", "pforge-claw-worker", "secret");
  const githubSecret = configuredSecret(secrets, "github", "pforge-claw-github", "token");
  const copilotSecret = configuredSecret(secrets, "copilot", null, "token");
  const bridgeSecretRef = configuredSecret(secrets, "bridge", null, "secret");
  if (!workerSecret || !githubSecret) throw new ClawError("LANE_BAD_CONFIG");
  env.push({ name: "PFORGE_CLAW_WORKER_SECRET", ...secretKeyRef(workerSecret.name, workerSecret.key) });
  env.push({ name: "PFORGE_CLAW_GH_TOKEN", ...secretKeyRef(githubSecret.name, githubSecret.key) });
  if (copilotSecret) {
    env.push({ name: "PFORGE_CLAW_COPILOT_TOKEN", ...secretKeyRef(copilotSecret.name, copilotSecret.key) });
  }
  if (bridgeSecretRef) {
    env.push({ name: "PFORGE_BRIDGE_SECRET", ...secretKeyRef(bridgeSecretRef.name, bridgeSecretRef.key) });
  }
  for (const [envName, reference] of Object.entries(secrets.env ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(envName)
      || typeof reference?.name !== "string" || !reference.name
      || typeof reference.key !== "string" || !reference.key) {
      throw new ClawError("LANE_BAD_CONFIG");
    }
    env.push({ name: envName, ...secretKeyRef(reference.name, reference.key) });
  }

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

  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: deadlineSeconds,
      ttlSecondsAfterFinished,
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

function conditionReason(job, conditionType) {
  return job?.status?.conditions?.find((condition) => condition.type === conditionType && condition.status === "True")
    ?.reason;
}

function hasCondition(job, conditionType) {
  return job?.status?.conditions?.some((condition) => condition.type === conditionType && condition.status === "True")
    ?? false;
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

/**
 * Start the project MCP HTTP server on the pod-local fixed port.
 * @param {{repoDir: string, runner?: Function, spawnFn?: Function, now?: Function, sleep?: Function}} options
 */
export async function startPodMcp({
  repoDir, runner = run, spawnFn = spawn, now = Date.now,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
} = {}) {
  void runner;
  if (typeof repoDir !== "string" || !repoDir || typeof spawnFn !== "function"
    || typeof now !== "function" || typeof sleep !== "function") {
    throw new ClawError("L2_MCP_START_FAILED");
  }
  let child;
  try {
    child = spawnFn(process.execPath, [
      path.join(repoDir, "pforge-mcp", "server.mjs"), "--port", MCP_PORT,
    ], { cwd: repoDir, env: process.env, stdio: "ignore", windowsHide: true });
  } catch {
    throw new ClawError("L2_MCP_START_FAILED");
  }
  if (!child || typeof child.once !== "function" || typeof child.kill !== "function") {
    throw new ClawError("L2_MCP_START_FAILED");
  }
  let spawnFailed = false;
  child.once("error", () => { spawnFailed = true; });
  const stop = async () => {
    if (spawnFailed || child.exitCode !== null || child.signalCode !== null) return;
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
  while (!spawnFailed && now() < expiresAt && child.exitCode === null && child.signalCode === null) {
    if (await probeMcp(`http://127.0.0.1:${MCP_PORT}/mcp`)) {
      await sleep(MCP_POLL_INTERVAL_MS);
      if (!spawnFailed && child.exitCode === null && child.signalCode === null) return { stop };
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
  const childEnv = Object.fromEntries(Object.entries({ ...process.env, ...suppliedEnv })
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
  collectDelta, awaitAck, deadlineMs, now = Date.now,
} = {}) {
  if (typeof collectDelta !== "function" || typeof awaitAck !== "function"
    || !Number.isFinite(deadlineMs) || typeof now !== "function") {
    throw new ClawError("L2_MALFORMED");
  }
  const mcp = await startMcp({ repoDir, runner });
  try {
    await drainPodMemory({ repoDir, runner, suppliedEnv: env });
    const delta = await collectDelta({ repoDir });
    if (!delta) return { status: "ok" };
    const remainingMs = Math.max(0, deadlineMs - now());
    if (!remainingMs) return { status: "failed", reason: L2_SYNC_INCOMPLETE };
    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(false), remainingMs);
    });
    try {
      const acknowledgement = await Promise.race([
        awaitAck({ delta, deadlineMs, timeoutMs: remainingMs }),
        timeout,
      ]);
      const acknowledged = acknowledgement !== false && acknowledgement?.ok !== false
        && acknowledgement?.status !== "failed";
      return acknowledged
        ? { status: "ok" }
        : { status: "failed", reason: L2_SYNC_INCOMPLETE };
    } finally {
      clearTimeout(timeoutId);
    }
  } finally {
    await mcp?.stop?.();
  }
}

function copyRelativePath(input) {
  if (typeof input !== "string" || !input || path.isAbsolute(input) || path.win32.isAbsolute(input)) {
    throw new ClawError("BOOTSTRAP_COPY_INVALID");
  }
  const normalized = input.replaceAll("\\", "/");
  if (/^[a-z]:/i.test(normalized)) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..")) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  const relative = segments.join(path.sep);
  if (!relative) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  if (relative.toLowerCase() === path.join(".forge", "secrets.json").toLowerCase()) {
    throw new ClawError("BOOTSTRAP_SECRET_COPY_REFUSED");
  }
  return relative;
}

export async function runPodJob({
  job,
  project,
  config = {},
  requestCopySet,
  runner = run,
  workdir = "/work",
} = {}) {
  if (!job || !project?.repo?.remote || !project.repo.baseBranch
    || typeof requestCopySet !== "function" || typeof runner !== "function") {
    return { ok: false, reason: "bootstrap", step: "clone" };
  }
  const repoDir = path.join(workdir, "repo");
  const cloneArgs = ["clone"];
  const remote = project.repo.remote;
  if (remote.startsWith("ssh://") || remote.startsWith("git@")) {
    return { ok: false, reason: "bootstrap", step: "clone", code: "REMOTE_AUTH_UNSUPPORTED" };
  }
  const laneK8s = config.lane?.k8s
    ?? config.k8s
    ?? config.lanes?.find?.((entry) => entry.kind === "k8s")?.k8s
    ?? {};
  if (laneK8s.repoCache?.claimName) cloneArgs.push("--reference", "/cache");
  cloneArgs.push("--depth", "1", "--branch", project.repo.baseBranch, remote, repoDir);
  let clone;
  try {
    clone = await runner("git", cloneArgs, { cwd: workdir });
  } catch {
    return { ok: false, reason: "bootstrap", step: "clone", code: "REPO_CLONE_FAILED" };
  }
  if (clone?.code !== 0) {
    return { ok: false, reason: "bootstrap", step: "clone", code: "REPO_CLONE_FAILED" };
  }

  try {
    const requested = config.bootstrap?.copy ?? [];
    const allowedPaths = requested.map(copyRelativePath);
    const response = await requestCopySet(requested);
    const files = Array.isArray(response) ? response : response?.files;
    if (!Array.isArray(files)) throw new ClawError("BOOTSTRAP_COPY_INVALID");
    let totalBytes = 0;
    const copiedPaths = new Set();
    for (const file of files) {
      const relative = copyRelativePath(file?.path);
      if (!allowedPaths.some((allowed) => relative === allowed || relative.startsWith(`${allowed}${path.sep}`))
        || copiedPaths.has(relative)) {
        throw new ClawError("BOOTSTRAP_COPY_INVALID");
      }
      copiedPaths.add(relative);
      const target = path.resolve(repoDir, relative);
      await assertInside(repoDir, target, "BOOTSTRAP_COPY_INVALID");
      const contents = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content ?? ""));
      totalBytes += contents.byteLength;
      if (totalBytes > MAX_COPY_BYTES) throw new ClawError("BOOTSTRAP_COPY_TOO_LARGE");
      await mkdir(path.dirname(target), { recursive: true });
      await assertInside(repoDir, target, "BOOTSTRAP_COPY_INVALID");
      await writeFile(target, contents);
    }
  } catch {
    return { ok: false, reason: "bootstrap", step: "copy" };
  }

  const bootstrapConfig = {
    ...config,
    bootstrap: { ...config.bootstrap, copy: [], install: "ci" },
  };
  const result = await bootstrapWorktree({
    job,
    worktree: repoDir,
    forgeHome: repoDir,
    homeRepo: repoDir,
    config: bootstrapConfig,
    secrets: { get: (name) => process.env[name] },
    runner,
  });
  if (!result.ok) return result;
  return { ok: true, repoDir };
}

export function createK8sJobLane({
  id,
  config,
  api,
  registry,
  now = Date.now,
  connectTimeoutMs = 120_000,
} = {}) {
  const lane = configuredLane(config, id);
  if (typeof id !== "string" || !id || lane?.kind !== "k8s"
    || !api || typeof api.createJob !== "function" || typeof api.deleteJob !== "function"
    || typeof api.watchJob !== "function" || typeof api.getJob !== "function"
    || !registry || typeof registry.enqueue !== "function" || typeof registry.cancel !== "function"
    || !Number.isFinite(connectTimeoutMs) || connectTimeoutMs <= 0
    || typeof now !== "function") {
    throw new ClawError("LANE_BAD_CONFIG");
  }
  const k8s = lane.k8s ?? {};
  const namespace = k8s.namespace ?? "default";
  const dispatcherUrl = config.worker?.dispatcherUrl;
  if (!/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(namespace)
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
    let spec;
    let name;
    let byokOnly;
    try {
      const project = config.projects?.find((entry) => entry.id === job.projectId);
      if (!project) throw new ClawError("LANE_BAD_CONFIG");
      spec = buildJobSpec({ job, project, lane, dispatcherUrl });
      name = spec.metadata.name;
      byokOnly = !spec.spec.template.spec.containers[0].env
        .some((entry) => entry.name === "PFORGE_CLAW_COPILOT_TOKEN");
    } catch (error) {
      yield finished(job?.id, { status: "failed", error: error?.code ?? "LANE_BAD_CONFIG", reason: errorReason(error) });
      return;
    }

    const record = { name, namespace, byokOnly, started: false };
    activeJobs.set(job.id, record);
    let source;
    let watchController;
    let workerDone = false;
    let terminalSent = false;
    let transferOpen = false;
    let lastSeq = 0;
    let connectTimer;
    let finalTimer;
    const queue = [];
    let wake;
    const push = (value) => {
      if (wake) {
        const resolve = wake;
        wake = null;
        resolve(value);
      } else queue.push(value);
    };
    const take = () => queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolve) => { wake = resolve; });
    const emitTerminal = (data) => {
      if (terminalSent) return;
      terminalSent = true;
      push({ kind: "terminal", event: finished(job.id, data, lastSeq + 1, now) });
    };

    try {
      try {
        await api.createJob(namespace, spec);
      } catch (error) {
        if (error?.code === "K8S_API" && error.details?.status === 409) {
          try {
            const existing = await api.getJob(namespace, name);
            if (existing?.metadata?.labels?.["pforge-claw/job-id"] !== uniqueLabel(job.id)) {
              emitTerminal({ status: "failed", error: "JOB_DUPLICATE", reason: "conflict" });
              yield await take().then((item) => item.event);
              return;
            }
          } catch (readError) {
            emitTerminal({ status: "failed", error: "K8S_API", reason: errorReason(readError) });
            yield await take().then((item) => item.event);
            return;
          }
        } else {
          lastError = { code: error?.code ?? "K8S_API", reason: errorReason(error) };
          emitTerminal({ status: "failed", error: "K8S_API", reason: errorReason(error) });
          yield await take().then((item) => item.event);
          return;
        }
      }

      const { iterator } = registry.enqueue(id, { kind: "job", job });
      source = iterator[Symbol.asyncIterator]();
      watchController = new AbortController();
      if (cancelIntent.has(job.id)) {
        await registry.cancel(job.id);
        await deleteIgnoringNotFound(name);
      }
      connectTimer = setTimeout(() => {
        if (record.started || terminalSent) return;
        void deleteIgnoringNotFound(name);
        emitTerminal({ status: "failed", reason: CONNECT_TIMEOUT_REASON });
      }, connectTimeoutMs);
      connectTimer.unref?.();

      const workerPump = (async () => {
        try {
          while (true) {
            const next = await source.next();
            if (next.done) break;
            const event = next.value;
            if (Number.isFinite(event?.seq)) {
              if (event.seq <= lastSeq) continue;
              lastSeq = event.seq;
            }
            if (event?.type === "started") {
              record.started = true;
              clearTimeout(connectTimer);
            }
            if (event?.type === "artifact" && event.data?.kind === "l2-delta") transferOpen = true;
            if (event?.type === "finished") {
              transferOpen = false;
              workerDone = true;
              clearTimeout(connectTimer);
              clearTimeout(finalTimer);
              if (!terminalSent) {
                terminalSent = true;
                push({ kind: "terminal", event });
              }
              break;
            }
            push({ kind: "worker", event });
          }
        } catch (error) {
          lastError = { code: error?.code ?? "WORKER_STREAM", reason: errorReason(error) };
        } finally {
          push({ kind: "worker-done" });
        }
      })();

      const watchPump = (async () => {
        try {
          for await (const event of api.watchJob(namespace, name, { signal: watchController.signal })) {
            if (watchController.signal.aborted || terminalSent) break;
            const failedReason = conditionReason(event?.object, "Failed");
            if (failedReason) {
              const incompleteTransfer = failedReason === "DeadlineExceeded" && transferOpen;
              if (incompleteTransfer) {
                incompleteSyncs += 1;
                lastError = { code: L2_SYNC_INCOMPLETE, reason: L2_SYNC_INCOMPLETE };
              }
              emitTerminal({
                status: "failed",
                reason: incompleteTransfer ? L2_SYNC_INCOMPLETE
                  : failedReason === "DeadlineExceeded" ? "deadline" : "pod-failed",
              });
              break;
            }
            if (hasCondition(event?.object, "Complete") && !workerDone && !finalTimer) {
              finalTimer = setTimeout(() => {
                emitTerminal({ status: "failed", reason: "no-final-event" });
              }, FINAL_EVENT_TIMEOUT_MS);
              finalTimer.unref?.();
            }
          }
        } catch (error) {
          if (!watchController.signal.aborted) {
            lastError = { code: error?.code ?? "K8S_WATCH", reason: errorReason(error) };
          }
        } finally {
          push({ kind: "watch-done" });
        }
      })();

      while (!terminalSent) {
        const item = await take();
        if (!item) continue;
        if (item.kind === "worker" || item.kind === "terminal") yield item.event;
        if (item.kind === "terminal") break;
        if (item.kind === "watch-done" && workerDone) {
          emitTerminal({ status: "failed", reason: "watch-ended" });
        }
      }
      if (terminalSent) {
        const terminal = queue.find((item) => item.kind === "terminal");
        if (terminal) yield terminal.event;
      }
    } finally {
      clearTimeout(connectTimer);
      clearTimeout(finalTimer);
      watchController?.abort();
      await source?.return?.();
      if (!terminalSent && cancelIntent.has(job.id)) {
        emitTerminal({ status: "cancelled" });
      }
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
    if (active) {
      const deletion = await deleteIgnoringNotFound(active.name);
      if (!deletion.ok) return deletion;
    }
    if (registryError) return { ok: false, error: registryError };
    if (registryResult?.error && registryResult.error !== "JOB_UNKNOWN") {
      return { ok: false, error: registryResult.error };
    }
    return { ok: true, state: "cancelling" };
  }

  function health() {
    const snapshot = registry.snapshot?.().byLane?.[id] ?? {};
    return {
      ok: Boolean(snapshot.connected ?? true),
      kind: "k8s",
      id,
      namespace,
      active: activeJobs.size,
      byokOnly,
      incompleteSyncs,
      ...(lastError ? { lastError } : {}),
    };
  }

  return assertLane({ kind: "k8s", id, capabilities: lane.capabilities ?? {}, submit, cancel, health });
}
