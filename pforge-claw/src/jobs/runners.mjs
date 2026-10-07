import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { FEATURES } from "../features/index.mjs";
import { toSessionMcpServers } from "../runtime/copilot-session.mjs";
import {
  addWorktree,
  isInside,
  removeWorktree,
  resolvePforgeCommand,
  run,
} from "./worktree.mjs";
import { bootstrapWorktree } from "./bootstrap.mjs";
import { policyFor } from "./permission-policy.mjs";
import { currentJobs, JOBS_STREAM, transition } from "./model.mjs";

const TASK_CONTEXT_TIMEOUT_MS = 10_000;
const TASK_CONTEXT_LIMIT = 8 * 1024;
const EVENT_LIMIT = 8 * 1024;
const ABORT_TIMEOUT_MS = 5_000;
const QUORUM_MODES = new Set(["auto", "power", "speed", "false"]);

function safeText(value, secrets) {
  const text = String(value ?? "").slice(0, EVENT_LIMIT);
  return typeof secrets?.redact === "function" ? secrets.redact(text) : text;
}

function appendOutput(current, chunk, other = "") {
  const remaining = EVENT_LIMIT - Buffer.byteLength(current) - Buffer.byteLength(other);
  if (remaining <= 0) return current;
  let bytes = Buffer.from(chunk).subarray(0, remaining);
  while (bytes.length && Buffer.byteLength(bytes.toString("utf8")) > remaining) {
    bytes = bytes.subarray(0, bytes.length - 1);
  }
  return current + bytes.toString("utf8");
}

function getJobs(store) {
  return currentJobs(store);
}

function persistTransition({ store, bus, job, state, meta }) {
  const result = transition(job, state, meta);
  store.append(JOBS_STREAM, result.event);
  bus?.emit("job.transition", result.event);
  return result.job;
}

function projectFor(config, job) {
  return config?.projects?.find((project) => project.id === job.projectId);
}

function checkService(value, name) {
  if (!value) throw new ClawError("SERVICE_UNAVAILABLE", { service: name });
}

function parseJobResult(result) {
  if (result?.status === "failed" || result?.ok === false) {
    throw new ClawError(typeof result.error === "string" ? result.error : "RUNTIME_FAILED");
  }
  if (result?.status === "cancelled") throw new ClawError("JOB_CANCELLED");
  return result;
}

async function runCommand(runner, command, args, options) {
  const result = await runner(command, args, options);
  if (result.code !== 0) throw new ClawError("COMMAND_FAILED");
  return result;
}

async function hasChanges(runner, cwd) {
  const result = await runner("git", ["-C", cwd, "status", "--porcelain"]);
  if (result.code !== 0) throw new ClawError("GIT_STATUS_FAILED");
  return result.stdout.split(/\r?\n/).some((line) =>
    line.trim().length > 0 && line.slice(3).trim() !== ".claw-job.json");
}

async function hasCommitsAhead(runner, cwd, baseBranch) {
  const result = await runner("git", ["-C", cwd, "rev-list", "--count", `${baseBranch}..HEAD`]);
  if (result.code !== 0) throw new ClawError("GIT_LOG_FAILED");
  return Number.parseInt(result.stdout.trim(), 10) > 0;
}

async function pullRequestBody({ job, project, worktree, summary }) {
  const templateFile = path.join(worktree, ".github", "pull_request_template.md");
  try {
    const template = await readFile(templateFile, "utf8");
    return `${template.trim()}\n\n---\n\nJob: ${job.id}\n\n${summary}`;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return `Job: ${job.id}\n\nProject: ${project.id}\n\n${summary}`;
  }
}

async function publish({ ctx, job, project, worktree, summary }) {
  const baseBranch = project.repo.baseBranch ?? "main";
  if (await hasChanges(ctx.runner, worktree)) {
    await runCommand(ctx.runner, "git", [
      "-C", worktree, "add", "-A", "--", ".", ":(exclude).claw-job.json",
    ], { cwd: worktree });
    await runCommand(ctx.runner, "git", [
      "-C", worktree, "commit", "-m", `[claw] ${summary} (job ${job.id})`,
    ], { cwd: worktree });
  }
  if (!(await hasCommitsAhead(ctx.runner, worktree, baseBranch))) {
    return { pr: null, note: "empty diff" };
  }
  const branch = `claw/${job.id}`;
  await runCommand(ctx.runner, "git", ["-C", worktree, "push", "-u", "origin", branch], { cwd: worktree });
  const body = await pullRequestBody({ job, project, worktree, summary });
  const title = `[claw] ${summary}`;
  await runCommand(ctx.runner, "gh", [
    "pr", "create", "--base", baseBranch, "--head", branch, "--title", title, "--body", body,
  ], { cwd: worktree });
  return { pr: true, branch };
}

function emitFinished({ bus, job, state, reason, secrets }) {
  bus?.emit("job.finished", {
    jobId: job.id,
    projectId: job.projectId,
    type: job.type,
    state,
    ...(reason ? { reason: safeText(reason, secrets) } : {}),
  });
}

function findStoredJob(ctx, jobId) {
  return getJobs(ctx.store)[jobId];
}

async function callWithTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ClawError("MCP_CALL_TIMEOUT")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function contextPrompt({ job, contextParts }) {
  const section = contextParts.length
    ? `\n\n<plan-forge-task-context>\n${contextParts.join("\n")}\n</plan-forge-task-context>`
    : "";
  const prompt = `${job.description ?? ""}${section}`;
  return Buffer.byteLength(prompt, "utf8") <= TASK_CONTEXT_LIMIT
    ? prompt
    : Buffer.from(prompt, "utf8").subarray(0, TASK_CONTEXT_LIMIT).toString("utf8");
}

async function collectTaskContext(features, job, ctx) {
  const hooks = features.filter((feature) => typeof feature.taskContext === "function");
  const results = await Promise.allSettled(hooks.map(async (feature) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => feature.taskContext(job, ctx)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new ClawError("TASK_CONTEXT_TIMEOUT")), TASK_CONTEXT_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }));
  const parts = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || (typeof result.value !== "string"
      && (!result.value || typeof result.value !== "object" || Array.isArray(result.value)))) {
      throw new ClawError("TASK_CONTEXT_FAILED");
    }
    parts.push(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
  }
  return parts;
}

function failureReason(error) {
  if (error instanceof ClawError) return error.code;
  return typeof error?.code === "string" ? error.code : "JOB_RUN_FAILED";
}

function createLifecycle(ctx) {
  async function withWorktree(job, fn, { signal } = {}) {
    const stored = findStoredJob(ctx, job.id);
    const readQueued = stored?.mutating === false && stored.state === "queued";
    if (!stored || (!readQueued && !["approved", "leased"].includes(stored.state))) {
      throw new ClawError("JOB_NOT_APPROVED");
    }
    const project = projectFor(ctx.config, stored);
    if (!project?.repo?.path) throw new ClawError("PROJECT_UNAVAILABLE");
    let running = stored;
    if (running.state === "approved" || readQueued) {
      running = persistTransition({ store: ctx.store, bus: ctx.bus, job: running, state: "leased" });
    }
    running = persistTransition({ store: ctx.store, bus: ctx.bus, job: running, state: "running" });
    let worktree = null;
    let outcome = null;
    try {
      worktree = await addWorktree({
        home: ctx.home,
        project,
        job: stored,
        runner: ctx.runner,
      });
      const bootstrap = await bootstrapWorktree({
        job: stored,
        worktree,
        forgeHome: ctx.home,
        homeRepo: project.repo.path,
        config: ctx.config,
        secrets: ctx.secrets,
        runner: ctx.runner,
      });
      if (!bootstrap.ok) {
        throw new ClawError("BOOTSTRAP_FAILED", {
          reason: "bootstrap",
          step: bootstrap.step,
          code: bootstrap.code,
        });
      }
      const returned = await fn({ job: stored, project, worktree, env: bootstrap.env, signal });
      const summary = stored.summary ?? stored.description ?? `${stored.type} ${stored.id}`;
      let published;
      try {
        published = await publish({ ctx, job: stored, project, worktree: worktree.path, summary });
      } catch {
        throw new ClawError("PUBLISH_FAILED", { reason: "publish" });
      }
      outcome = returned ?? published;
      const latest = findStoredJob(ctx, stored.id);
      const completed = persistTransition({
        store: ctx.store, bus: ctx.bus, job: latest, state: "succeeded",
      });
      emitFinished({ bus: ctx.bus, job: completed, state: "succeeded", secrets: ctx.secrets });
      await removeWorktree({ repoPath: project.repo.path, path: worktree.path, runner: ctx.runner });
      return { status: "succeeded", result: outcome };
    } catch (error) {
      const latest = findStoredJob(ctx, stored.id);
      if (latest?.state === "running") {
        persistTransition({
          store: ctx.store,
          bus: ctx.bus,
          job: latest,
          state: signal?.aborted ? "cancelled" : "failed",
          meta: { reason: error?.details?.reason ?? failureReason(error) },
        });
      }
      if (worktree && ctx.config?.jobs?.pushOnFailure) {
        try {
          await runCommand(ctx.runner, "git", ["-C", worktree.path, "push", "-u", "origin", `claw/${stored.id}`], { cwd: worktree.path });
        } catch {
          ctx.bus?.emit("job.warning", {
            jobId: stored.id,
            code: "FAILURE_PUSH_FAILED",
          });
        }
      }
      const latestState = findStoredJob(ctx, stored.id)?.state ?? "failed";
      emitFinished({ bus: ctx.bus, job: stored, state: latestState, reason: failureReason(error), secrets: ctx.secrets });
      return { status: latestState === "cancelled" ? "cancelled" : "failed", error: failureReason(error) };
    }
  }
  return { withWorktree };
}

async function executeTask(ctx, job, { emit, signal, features }) {
  checkService(ctx.runtime, "runtime");
  checkService(ctx.mcp, "mcp");
  let taskParts;
  try {
    taskParts = await collectTaskContext(features, job, ctx);
  } catch {
    throw new ClawError("TASK_CONTEXT_FAILED", { reason: "context" });
  }
  const project = projectFor(ctx.config, job);
  const model = project?.models?.work ?? project?.models?.chat ?? ctx.config?.runtimes?.default;
  if (!model) throw new ClawError("MODEL_MISSING");
  const prompt = contextPrompt({ job, contextParts: taskParts });
  const launch = ctx.mcpLaunchForWorktree
    ? await ctx.mcpLaunchForWorktree({ project, cwd: ctx.worktree })
    : ctx.mcpLaunch;
  if (!launch) throw new ClawError("SERVICE_UNAVAILABLE", { service: "mcp" });
  const result = parseJobResult(await ctx.runtime.run({
    prompt,
    model,
    cwd: ctx.worktree,
    mcpServers: toSessionMcpServers({ launch }),
    onPermissionRequest: policyFor(job, { worktree: ctx.worktree, project }),
    emit,
    signal,
  }));
  return result;
}

function normalizePlanQuorum(value) {
  if (QUORUM_MODES.has(value)) return value;
  return "auto";
}

export async function resolvePlan({ root, input } = {}) {
  if (typeof root !== "string" || !root || typeof input !== "string" || !input.trim()) {
    return { kind: "none", candidates: [] };
  }
  const candidate = path.resolve(root, input);
  const relative = path.relative(path.resolve(root), candidate);
  if (!path.isAbsolute(input) && !relative.startsWith("..") && !path.isAbsolute(relative)
    && await isInside(root, candidate)) {
    try {
      const metadata = await stat(candidate);
      if (metadata.isFile()) return { kind: "exact", candidates: [relative] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const plansRoot = path.join(root, "docs", "plans");
  let entries;
  try {
    entries = await readdir(plansRoot);
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "none", candidates: [] };
    throw error;
  }
  const query = input.toLocaleLowerCase();
  const matches = entries.filter((name) => name.toLowerCase().endsWith("-plan.md")
    && name.toLowerCase().includes(query)).sort((left, right) => left.localeCompare(right));
  const candidates = [];
  for (const name of matches) {
    const relativePath = path.join("docs", "plans", name);
    const fullPath = path.join(root, relativePath);
    if (!(await isInside(root, fullPath))) continue;
    try {
      if ((await stat(fullPath)).isFile()) candidates.push(relativePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (candidates.length === 1) return { kind: "unique", candidates };
  return { kind: candidates.length ? "multiple" : "none", candidates };
}

export function createRunners(ctx = {}) {
  const dependencies = { runner: run, features: FEATURES, now: Date.now, ...ctx };
  const lifecycle = createLifecycle(dependencies);

  async function runJob(job, { emit, signal } = {}) {
    const stored = job?.id ? findStoredJob(dependencies, job.id) : null;
    if (!stored) throw new ClawError("JOB_NOT_APPROVED");
    const startable = stored.mutating
      ? ["approved", "leased"].includes(stored.state)
      : ["queued", "leased"].includes(stored.state);
    if (!startable) throw new ClawError("JOB_NOT_APPROVED");
    const handler = stored.type === "task" ? task : stored.type === "skill" ? skill : stored.type === "plan" ? plan : null;
    if (!handler) throw new ClawError("JOB_TYPE_UNSUPPORTED");
    return handler(stored, { emit, signal });
  }

  async function task(job, { emit, signal } = {}) {
    checkService(dependencies.runtime, "runtime");
    checkService(dependencies.mcp, "mcp");
    return lifecycle.withWorktree(job, ({ job: approvedJob, worktree }) =>
      executeTask({ ...dependencies, worktree: worktree.path }, approvedJob, { emit, signal, features: dependencies.features })
        .then(async (result) => {
          if (result?.status === "failed" || result?.status === "cancelled") throw new ClawError(result.error ?? "RUNTIME_FAILED");
          return result;
        }), { signal });
  }

  async function skill(job, { signal } = {}) {
    checkService(dependencies.mcp, "mcp");
    return lifecycle.withWorktree(job, async ({ job: approvedJob, worktree, project }) => {
      const client = typeof dependencies.mcp === "function"
        ? await dependencies.mcp({ projectId: project.id, cwd: worktree.path })
        : dependencies.mcp;
      if (!client || typeof client.call !== "function") throw new ClawError("SERVICE_UNAVAILABLE", { service: "mcp" });
      const result = await client.call("forge_run_skill", {
        skill: approvedJob.skill ?? approvedJob.name,
        args: approvedJob.args ?? "",
        path: worktree.path,
      });
      if (result?.isError || result?.ok === false) throw new ClawError(result.error ?? "SKILL_FAILED");
      return result;
    }, { signal });
  }

  async function plan(job, { emit, signal } = {}) {
    checkService(dependencies.mcp, "mcp");
    return lifecycle.withWorktree(job, async ({ job: approvedJob, worktree, project }) => {
      const command = resolvePforgeCommand({ config: dependencies.config, cwd: worktree.path });
      const planPath = path.resolve(worktree.path, approvedJob.planPath ?? approvedJob.description);
      const planRelative = path.relative(worktree.path, planPath);
      if (planRelative.startsWith("..") || path.isAbsolute(planRelative)) throw new ClawError("PLAN_PATH_INVALID");
      const quorum = normalizePlanQuorum(approvedJob.quorum);
      const args = [...command.slice(1), "run-plan", planPath, `--quorum=${quorum}`];
      if (approvedJob.resumeFrom !== undefined) args.push("--resume-from", String(approvedJob.resumeFrom));
      const client = typeof dependencies.mcp === "function"
        ? await dependencies.mcp({ projectId: project.id, cwd: worktree.path })
        : dependencies.mcp;
      if (!client || typeof client.call !== "function") {
        throw new ClawError("SERVICE_UNAVAILABLE", { service: "mcp" });
      }
      const executable = command[0];
      const child = spawn(executable, args, {
        cwd: worktree.path,
        shell: false,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout = appendOutput(stdout, safeText(chunk.toString("utf8"), dependencies.secrets), stderr);
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendOutput(stderr, safeText(chunk.toString("utf8"), dependencies.secrets), stdout);
      });
      const childResult = new Promise((resolve) => {
        child.once("error", (error) => resolve({ code: -1, error }));
        child.once("close", (code) => resolve({ code: code ?? -1, error: null }));
      });
      const abortPoll = async () => {
        try {
          await callWithTimeout(
            client.call("forge_abort", {}),
            ABORT_TIMEOUT_MS,
          );
        } catch {
          emit?.("log", { level: "error", code: "PLAN_ABORT_FAILED" });
        } finally {
          child.kill();
        }
      };
      const onAbort = () => { void abortPoll(); };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      let finished = false;
      let warned = false;
      const pollProgress = async () => {
        while (!finished && !signal?.aborted) {
          try {
            const progress = await client.call("forge_watch_live", {
              targetPath: worktree.path,
              durationMs: 1000,
              pollIntervalMs: 500,
              maxCapturedEvents: 100,
            });
            if (progress) emit?.("progress", { text: safeText(JSON.stringify(progress), dependencies.secrets) });
          } catch {
            if (!warned) emit?.("log", { level: "warn", code: "PLAN_PROGRESS_UNAVAILABLE" });
            warned = true;
          }
          if (finished || signal?.aborted) break;
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 1000);
            timer.unref?.();
          });
        }
      };
      const polling = pollProgress();
      try {
        const completed = await childResult;
        finished = true;
        if (signal?.aborted) throw new ClawError("JOB_CANCELLED");
        if (completed.code !== 0) {
          throw new ClawError(completed.error ? "PLAN_SPAWN_FAILED" : "PLAN_RUN_FAILED");
        }
        emit?.("progress", { text: safeText(stdout, dependencies.secrets) });
        if (stderr) emit?.("log", { level: "warn", text: safeText(stderr, dependencies.secrets) });
        return { status: "succeeded" };
      } finally {
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        void polling;
      }
    }, { signal });
  }

  return { task, skill, plan, runJob };
}

export { normalizePlanQuorum };
