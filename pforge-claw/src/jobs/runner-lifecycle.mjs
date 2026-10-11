import { readFile } from "node:fs/promises";
import { ClawError } from "../errors.mjs";
import path from "node:path";
import { matchesApplicationAck } from "../protocol/l2-ack.mjs";
import { TERMINAL } from "./model.mjs";
import { prepareJobEnvironment } from "./runner-environment.mjs";
import { beginJobHistory, synchronizeJobHistory } from "./runner-history.mjs";
import { resolveGhCommand } from "./worktree.mjs";

const ERROR_CODE = /^[A-Z0-9_]{1,64}$/;
const EVENT_TEXT_LIMIT = 8 * 1024;
const ACTIVE_STATES = Object.freeze(["leased", "running", "needs-input"]);
const PLAN_USAGE_FIELDS = Object.freeze(["costUSD", "premiumRequests"]);
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
export const PLAN_ACTUALS_UNCONFIRMED = "PLAN_ACTUALS_UNCONFIRMED";
export const PLAN_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export function failureReason(error) {
  return typeof error?.code === "string" && ERROR_CODE.test(error.code) ? error.code : "JOB_RUN_FAILED";
}

function safeText(ctx, value) {
  const text = String(value ?? "").slice(0, EVENT_TEXT_LIMIT);
  return typeof ctx.secrets?.redact === "function" ? ctx.secrets.redact(text) : text;
}

export function assertJobActive({ ctx, job, signal }) {
  const current = ctx.jobs.get(job.id);
  if (signal?.aborted || !current || TERMINAL.includes(current.state)) throw new ClawError("JOB_CANCELLED");
}

function persistTransition({ ctx, job, state, meta }) {
  const updated = ctx.jobs.append(job, state, meta);
  ctx.bus?.emit("job.transition", updated.event);
  return updated.job;
}

function relativePlanValue(value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")
    || path.win32.isAbsolute(value) || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)) return null;
  const normalized = value.replaceAll("\\", "/");
  if (normalized.split("/").includes("..")) return null;
  return path.posix.normalize(normalized);
}

function validActualsIdentity(job, actuals) {
  return job?.type === "plan" && actuals?.jobId === job.id && actuals.projectId === job.projectId
    && typeof actuals.runId === "string" && PLAN_RUN_ID.test(actuals.runId)
    && typeof actuals.endedAt === "string" && actuals.endedAt.length <= 64
    && ISO_INSTANT.test(actuals.endedAt) && Number.isFinite(Date.parse(actuals.endedAt));
}

function validActualsScope(job, actuals) {
  const requested = relativePlanValue(job.planPath ?? job.plan ?? job.description);
  return typeof actuals.plan === "string" && !/[\\/:]/.test(actuals.plan)
    && requested !== null && actuals.plan === path.posix.basename(requested);
}

function validActualsUsage(usage) {
  return usage && typeof usage === "object" && !Array.isArray(usage)
    && PLAN_USAGE_FIELDS.every((field) => usage[field] === undefined || usage[field] === null
      || (typeof usage[field] === "number" && Number.isFinite(usage[field]) && usage[field] >= 0));
}

/** Whitelist only correctly attributed financial facts on a plan's authenticated completion. */
export function normalizePlanActuals({ job, actuals } = {}) {
  if (!validActualsIdentity(job, actuals) || !validActualsScope(job, actuals) || !validActualsUsage(actuals.usage)) return null;
  return {
    jobId: job.id, projectId: job.projectId, runId: actuals.runId,
    plan: actuals.plan, endedAt: actuals.endedAt,
    usage: Object.fromEntries(PLAN_USAGE_FIELDS.map((field) => [field, actuals.usage[field] ?? null])),
  };
}

function planAttribution(job, execution) {
  if (job.type !== "plan") return {};
  const actuals = normalizePlanActuals({ job, actuals: execution?.planActuals });
  if (actuals) return { planActuals: actuals };
  return {
    planActuals: null,
    planActualsError: failureReason({ code: execution?.planActualsError }) === "JOB_RUN_FAILED"
      ? PLAN_ACTUALS_UNCONFIRMED : execution.planActualsError,
  };
}

function emitFinished({ ctx, job, state, reason, execution }) {
  ctx.bus?.emit("job.finished", {
    jobId: job.id, projectId: job.projectId, type: job.type, state,
    ...(job.branch ? { branch: job.branch } : {}),
    ...(job.prUrl ? { prUrl: job.prUrl } : {}),
    ...(reason ? { reason: safeText(ctx, reason) } : {}),
    ...planAttribution(job, execution),
  });
}

async function publicationCommand({ ctx, job, signal, env, cwd, command, args, code = "COMMAND_FAILED" }) {
  assertJobActive({ ctx, job, signal });
  const completed = await ctx.runner(command, args, { cwd, env, signal });
  assertJobActive({ ctx, job, signal });
  if (completed.code !== 0) throw new ClawError(code);
  return completed;
}

async function hasChanges(options) {
  const completed = await publicationCommand({
    ...options, command: "git", args: ["-C", options.cwd, "status", "--porcelain"], code: "GIT_STATUS_FAILED",
  });
  return completed.stdout.split(/\r?\n/).some((line) =>
    line.trim().length > 0 && line.slice(3).trim() !== ".claw-job.json");
}

async function pullRequestBody({ job, project, worktree, summary }) {
  try {
    const template = await readFile(path.join(worktree, ".github", "pull_request_template.md"), "utf8");
    return `${template.trim()}\n\n---\n\nJob: ${job.id}\n\n${summary}`;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return `Job: ${job.id}\n\nProject: ${project.id}\n\n${summary}`;
  }
}

async function publishWorktree({ ctx, job, project, handle, env, signal }) {
  const cwd = handle.path;
  const baseBranch = project.repo.baseBranch ?? "main";
  const summary = job.summary ?? job.description ?? `${job.type} ${job.id}`;
  const options = { ctx, job, env, signal, cwd };
  if (await hasChanges(options)) {
    await publicationCommand({
      ...options, command: "git", args: ["-C", cwd, "add", "-A", "--", ".", ":(exclude).claw-job.json"],
    });
    await publicationCommand({
      ...options, command: "git", args: ["-C", cwd, "commit", "-m", `[claw] ${summary} (job ${job.id})`],
    });
  }
  const ahead = await publicationCommand({
    ...options, command: "git", args: ["-C", cwd, "rev-list", "--count", `${baseBranch}..HEAD`], code: "GIT_LOG_FAILED",
  });
  if (!(Number.parseInt(ahead.stdout.trim(), 10) > 0)) return { pr: false };
  const branch = `claw/${job.id}`;
  await publicationCommand({ ...options, command: "git", args: ["-C", cwd, "push", "-u", "origin", branch] });
  const body = await pullRequestBody({ job, project, worktree: cwd, summary });
  const gh = resolveGhCommand({ config: ctx.config });
  const created = await publicationCommand({
    ...options, command: gh[0],
    args: [...gh.slice(1), "pr", "create", "--base", baseBranch, "--head", branch, "--title", `[claw] ${summary}`, "--body", body],
  });
  const prUrl = (created.stdout.match(/https:\/\/\S+/g) ?? []).at(-1);
  return { pr: true, branch, ...(prUrl ? { prUrl } : {}) };
}

function isCancelled(error, signal) {
  return signal?.aborted || failureReason(error) === "JOB_CANCELLED";
}

async function pushFailure({ ctx, job, handle, env, signal }) {
  if (!handle?.path || !ctx.config?.jobs?.pushOnFailure || signal?.aborted) return;
  try {
    await publicationCommand({
      ctx, job, signal, env, cwd: handle.path, command: "git",
      args: ["-C", handle.path, "push", "-u", "origin", `claw/${job.id}`],
    });
  } catch (error) {
    if (isCancelled(error, signal)) return;
    ctx.logger?.warn?.("Failed worktree push failed", { code: failureReason(error) });
    ctx.bus?.emit("job.warning", { jobId: job.id, code: "FAILURE_PUSH_FAILED" });
  }
}

function settleFailure({ ctx, job, error, signal, execution }) {
  const latest = ctx.jobs.get(job.id);
  const cancelled = isCancelled(error, signal);
  if (latest && ACTIVE_STATES.includes(latest.state)) {
    const state = cancelled ? "cancelled" : "failed";
    const reason = error?.details?.reason ?? failureReason(error);
    const updated = persistTransition({ ctx, job: latest, state, meta: { reason } });
    emitFinished({ ctx, job: updated, state, reason, execution: execution ?? error?.details });
  }
  const state = ctx.jobs.get(job.id)?.state;
  return {
    status: state === "cancelled" ? "cancelled" : "failed",
    error: cancelled ? "JOB_CANCELLED" : failureReason(error),
    ...(Number.isInteger(error?.details?.exitCode) ? { exitCode: error.details.exitCode } : {}),
    ...planAttribution(job, execution ?? error?.details),
  };
}

function settleSuccess({ ctx, job, published, execution }) {
  const result = {
    ...(published.branch ? { branch: published.branch } : {}),
    ...(published.prUrl ? { prUrl: published.prUrl } : {}),
  };
  const updated = persistTransition({
    ctx, job: ctx.jobs.get(job.id), state: "succeeded", meta: { result },
  });
  emitFinished({ ctx, job: updated, state: "succeeded", execution });
}

async function publishOrFail(options) {
  try {
    return await publishWorktree(options);
  } catch (error) {
    if (isCancelled(error, options.signal)) throw new ClawError("JOB_CANCELLED");
    throw new ClawError("PUBLISH_FAILED", { reason: "publish", code: failureReason(error) });
  }
}

/** Validated receiver proof is also the default workspace's removal precondition. */
export function canReleaseWorkspace({ success, identity, applicationAck, signal, externalHistoryDelivery }) {
  return Boolean(success && !signal?.aborted && externalHistoryDelivery !== true
    && identity && applicationAck?.ok === true && matchesApplicationAck(identity, applicationAck));
}

async function prepareWorkspace({ ctx, job, project, signal, state }) {
  state.env = prepareJobEnvironment({ job, project, config: ctx.config, secrets: ctx.secrets, env: ctx.env, signal });
  const prepared = await ctx.workspace.prepare(job, { signal, env: state.env });
  state.handle = prepared?.handle ?? prepared?.worktree ?? null;
  if (!state.handle?.path) throw new ClawError("WORKSPACE_BAD_CONTRACT");
  state.env = { ...state.env, ...prepared.env };
  assertJobActive({ ctx, job, signal });
  return beginJobHistory({ job, worktree: state.handle.path });
}

async function completeWorkspace({ ctx, job, project, state, snapshot, returned, signal, emit }) {
  assertJobActive({ ctx, job, signal });
  const published = await publishOrFail({ ctx, job, project, handle: state.handle, env: state.env, signal });
  assertJobActive({ ctx, job, signal });
  if (published.prUrl) emit?.("artifact", { kind: "pr", url: published.prUrl, branch: published.branch });
  const history = state.externalHistoryDelivery ? null : await synchronizeJobHistory({
    job, worktree: state.handle.path, snapshot, receiver: ctx.l2Receiver, signal, timeoutMs: ctx.l2AckTimeoutMs,
  });
  assertJobActive({ ctx, job, signal });
  if (history) {
    ctx.store?.append?.("audit", {
      v: 1, kind: "job.history-applied", applicationAck: history.applicationAck,
    });
    assertJobActive({ ctx, job, signal });
    await ctx.workspace.release(state.handle, { success: true, signal, env: state.env, ...history });
    assertJobActive({ ctx, job, signal });
  }
  settleSuccess({ ctx, job, published, execution: returned });
  const { planActuals, planActualsError, ...executionResult } = returned ?? {};
  void planActuals;
  void planActualsError;
  return {
    status: "succeeded", result: { ...executionResult, publish: published },
    usage: returned?.usage ?? null,
    ...(history ? { l2: history.applicationAck } : {}),
    ...planAttribution(job, returned),
  };
}

/** Compose execution, publication, canonical application, and cancellation fences in order. */
export function createRunnerLifecycle(ctx) {
  async function withWorktree(inputJob, execute, { signal, emit } = {}) {
    const job = ctx.jobs.get(inputJob.id);
    if (!job || job.state !== "leased") throw new ClawError("JOB_NOT_LEASED");
    const project = ctx.config?.projects?.find((entry) => entry.id === job.projectId);
    if (!project?.repo?.path) throw new ClawError("PROJECT_UNAVAILABLE");
    const state = { handle: null, env: undefined, execution: null, externalHistoryDelivery: ctx.externalHistoryDelivery === true };
    try {
      assertJobActive({ ctx, job, signal });
      persistTransition({ ctx, job, state: "running" });
      const snapshot = await prepareWorkspace({ ctx, job, project, signal, state });
      const returned = await execute({ job, project, worktree: state.handle, env: state.env, signal });
      state.execution = returned;
      return await completeWorkspace({ ctx, job, project, state, snapshot, returned, signal, emit });
    } catch (error) {
      state.handle ??= error?.worktreeHandle ?? null;
      if (!isCancelled(error, signal)) await pushFailure({ ctx, job, handle: state.handle, env: state.env, signal });
      return settleFailure({ ctx, job, error, signal, execution: state.execution });
    }
  }
  return { withWorktree };
}
