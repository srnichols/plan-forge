import { ClawError } from "../errors.mjs";
import { approvedChoicesFor, consumedApprovalFor, QUORUM_MODES } from "./approval-proof.mjs";
import { FEATURES } from "../features/index.mjs";
import { toSessionMcpServers } from "../runtime/copilot-session.mjs";
import { addWorktree, removeWorktree, run } from "./worktree.mjs";
import { bootstrapWorktree } from "./bootstrap.mjs";
import { policyFor } from "./permission-policy.mjs";
import { currentJobs, JOBS_STREAM, transition } from "./model.mjs";
import { canReleaseWorkspace, createRunnerLifecycle, failureReason } from "./runner-lifecycle.mjs";
import { closeRunnerMcp, openRunnerMcp } from "./runner-mcp.mjs";
import { runForegroundPlan } from "./plan-process.mjs";

export { resolvePlan } from "./plan-resolution.mjs";

const TASK_CONTEXT_TIMEOUT_MS = 10_000;
const TASK_CONTEXT_LIMIT = 8 * 1024;

function createStoredJobs(ctx) {
  return {
    get(id) {
      const job = currentJobs(ctx.store)[id] ?? null;
      if (!job || job.type !== "plan" || job.leaseGrant) return job;
      const approval = consumedApprovalFor({ store: ctx.store, config: ctx.config, job });
      const { quorum } = approvedChoicesFor({ job, approval });
      return quorum === null ? job : { ...job, quorum };
    },
    append(job, state, meta) {
      const updated = transition(job, state, meta);
      ctx.store.append(JOBS_STREAM, updated.event);
      return updated;
    },
  };
}

function parseJobResult(completed, fallback) {
  if (completed?.status === "cancelled") throw new ClawError("JOB_CANCELLED");
  if (completed?.status === "failed" || completed?.ok === false || completed?.isError) {
    const code = failureReason({ code: completed.error });
    throw new ClawError(code === "JOB_RUN_FAILED" ? fallback : code);
  }
  return completed;
}

function contextPrompt({ job, contextParts }) {
  const section = contextParts.length
    ? `\n\n<plan-forge-task-context>\n${contextParts.join("\n")}\n</plan-forge-task-context>`
    : "";
  const prompt = `${job.description ?? job.prompt ?? ""}${section}`;
  return Buffer.byteLength(prompt, "utf8") <= TASK_CONTEXT_LIMIT
    ? prompt
    : Buffer.from(prompt, "utf8").subarray(0, TASK_CONTEXT_LIMIT).toString("utf8");
}

async function featureContext(feature, job, ctx) {
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
}

async function collectTaskContext(features, job, ctx) {
  const hooks = features.filter((feature) => typeof feature.taskContext === "function");
  const collected = await Promise.allSettled(hooks.map((feature) => featureContext(feature, job, ctx)));
  const parts = [];
  for (const entry of collected) {
    if (entry.status !== "fulfilled" || (typeof entry.value !== "string"
      && (!entry.value || typeof entry.value !== "object" || Array.isArray(entry.value)))) {
      throw new ClawError("TASK_CONTEXT_FAILED", { reason: "context" });
    }
    parts.push(typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value));
  }
  return parts;
}

function createDefaultWorkspace(ctx) {
  return {
    async prepare(job, { signal, env } = {}) {
      const project = ctx.config?.projects?.find((entry) => entry.id === job.projectId);
      if (!project?.repo?.path) throw new ClawError("PROJECT_UNAVAILABLE");
      const worktree = await addWorktree({ home: ctx.home, project, job, runner: ctx.runner, env, signal });
      const handle = { ...worktree, repoPath: project.repo.path };
      try {
        const bootstrap = await bootstrapWorktree({
          job, worktree: handle.path, forgeHome: ctx.home, homeRepo: project.repo.path,
          config: ctx.config, secrets: ctx.secrets, runner: ctx.runner, env, signal,
        });
        if (!bootstrap.ok) throw new ClawError("BOOTSTRAP_FAILED", {
          reason: "bootstrap", step: bootstrap.step, code: bootstrap.code,
        });
        return { handle, env: bootstrap.env };
      } catch (error) {
        error.worktreeHandle = handle;
        throw error;
      }
    },
    async release(handle, options = {}) {
      if (!handle || !canReleaseWorkspace(options)) return { ok: false, historyRetained: true };
      if (!handle.repoPath) throw new ClawError("PROJECT_UNAVAILABLE");
      const removed = await removeWorktree({
        repoPath: handle.repoPath, path: handle.path, runner: ctx.runner,
        env: options.env, signal: options.signal,
      });
      if (!removed.ok) throw new ClawError("WORKTREE_REMOVE_FAILED");
      return removed;
    },
  };
}

async function executeTask({ ctx, job, project, worktree, env, client, emit, signal }) {
  if (typeof ctx.runtime?.run !== "function") throw new ClawError("SERVICE_UNAVAILABLE", { service: "runtime" });
  const taskParts = await collectTaskContext(ctx.features, job, { ...ctx, worktree: worktree.path });
  const model = project?.models?.work ?? project?.models?.chat;
  if (!model) throw new ClawError("MODEL_MISSING");
  return parseJobResult(await ctx.runtime.run({
    prompt: contextPrompt({ job, contextParts: taskParts }),
    model, cwd: worktree.path, env,
    mcpServers: toSessionMcpServers({ launch: client.launch }),
    onPermissionRequest: policyFor(job, { worktree: worktree.path, project }),
    emit, signal,
  }), "RUNTIME_FAILED");
}

async function executeSkill({ job, worktree, client, signal }) {
  return parseJobResult(await client.call("forge_run_skill", {
    skill: job.skill ?? job.name, args: job.args ?? "", path: worktree.path,
  }, { signal }), "SKILL_FAILED");
}

/** Run stored, leased choices using the executing workspace's environment and MCP. */
export function createRunners(ctx = {}, { jobs = createStoredJobs(ctx), workspace } = {}) {
  const dependencies = { features: FEATURES, now: Date.now, ...ctx, runner: ctx.runner ?? run, jobs };
  dependencies.workspace = workspace ?? ctx.workspace ?? createDefaultWorkspace(dependencies);
  const lifecycle = createRunnerLifecycle(dependencies);

  function execute(job, handler, { emit, signal } = {}) {
    return lifecycle.withWorktree(job, async (prepared) => {
      const client = await openRunnerMcp({
        ctx: dependencies, project: prepared.project, worktree: prepared.worktree.path,
        env: prepared.env, signal,
      });
      let completed;
      let failure;
      try {
        completed = await handler({ ...prepared, ctx: dependencies, client, emit, signal });
        return completed;
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        const closed = await closeRunnerMcp(client, dependencies);
        if (!closed && !failure) throw new ClawError("MCP_CLOSE_FAILED", {
          ...(completed?.planActuals ? { planActuals: completed.planActuals } : {}),
        });
      }
    }, { emit, signal });
  }

  const task = (job, options) => execute(job, executeTask, options);
  const skill = (job, options) => execute(job, executeSkill, options);
  const plan = (job, options) => execute(job, (prepared) => runForegroundPlan({
    ...prepared, worktree: prepared.worktree.path,
  }), options);
  const handlers = { task, skill, plan };

  async function runJob(input, options = {}) {
    const stored = input?.id ? jobs.get(input.id) : null;
    if (!stored) throw new ClawError("JOB_NOT_APPROVED");
    if (stored.state !== "leased") throw new ClawError("JOB_NOT_LEASED");
    const handler = handlers[stored.type];
    if (!handler) throw new ClawError("JOB_TYPE_UNSUPPORTED");
    return handler(stored, options);
  }

  return { task, skill, plan, runJob };
}

export function normalizePlanQuorum(value) {
  return QUORUM_MODES.includes(value) ? value : "auto";
}
