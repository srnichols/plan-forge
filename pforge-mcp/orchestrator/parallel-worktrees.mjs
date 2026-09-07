import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { variantPath } from "../worktree-manager.mjs";
import { copyWorktreeInputs } from "./worktree-inputs.mjs";
import { checkWorktreeGates } from "./worktree-gates.mjs";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 8_388_608;

class ParallelWorktreeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParallelWorktreeError";
  }
}

async function git(cwd, args, { raw = false } = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return raw ? stdout : stdout.trim();
}

async function requireCleanParent(projectDir, expectedHead) {
  if (await git(projectDir, ["status", "--porcelain", "--untracked-files=normal"])) {
    throw new ParallelWorktreeError("Parallel isolation requires a clean parent worktree; commit or stash local changes before retrying.");
  }
  const head = await git(projectDir, ["rev-parse", "HEAD"]);
  if (expectedHead && head !== expectedHead) {
    throw new ParallelWorktreeError("Parent HEAD changed during parallel execution; worker worktrees were retained and nothing was promoted.");
  }
  return head;
}

async function createDetachedWorktree({ projectDir, batchId, sliceId, baseSha, ignoredPaths = [], abortSignal }) {
  const worktreePath = variantPath(projectDir, batchId, sliceId, 1);
  await mkdir(dirname(worktreePath), { recursive: true });
  await git(projectDir, ["worktree", "add", "--detach", worktreePath, baseSha]);
  await copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths, abortSignal });
  return worktreePath;
}

function failedResult(slice, error, extra = {}) {
  const reason = `parallel-worktree: ${error.message}`;
  return { ...extra, sliceId: slice.number, status: "failed", statusReason: reason, error: reason };
}

async function executeInWorktree({ slice, worktreePath, executeFn, eventBus }) {
  eventBus.emit("slice-started", {
    sliceId: slice.number, title: slice.title, parallel: true,
    complexityScore: slice.complexityScore, worktreePath,
  });
  try {
    const outcome = await executeFn({ ...slice, worktreePath });
    if (outcome.status === "passed" && await git(worktreePath, ["status", "--porcelain"])) {
      throw new ParallelWorktreeError("Worker returned success with uncommitted files; its worktree was retained for recovery.");
    }
    return { ...outcome, sliceId: slice.number, worktreePath };
  } catch (error) {
    return failedResult(slice, error, { worktreePath });
  }
}

async function integrateWorker({ outcome, integrationPath, baseSha }) {
  await git(outcome.worktreePath, ["merge-base", "--is-ancestor", baseSha, "HEAD"]);
  const sourceCommits = (await git(outcome.worktreePath, ["rev-list", "--reverse", `${baseSha}..HEAD`]))
    .split("\n").filter(Boolean);
  if (sourceCommits.length === 0) return { sourceCommits, commits: [] };
  const previousHead = await git(integrationPath, ["rev-parse", "HEAD"]);
  try {
    await git(integrationPath, ["cherry-pick", "-x", ...sourceCommits]);
  } catch (error) {
    await git(integrationPath, ["cherry-pick", "--abort"]);
    throw new ParallelWorktreeError(`Promotion conflict; worker worktree retained. ${error.message}`);
  }
  const commits = (await git(integrationPath, ["rev-list", "--reverse", `${previousHead}..HEAD`]))
    .split("\n").filter(Boolean);
  return { sourceCommits, commits };
}

async function removePromotedWorktree(projectDir, worktreePath) {
  try {
    await git(projectDir, ["worktree", "remove", "--force", worktreePath]);
    return null;
  } catch (error) {
    return `Worktree retained at ${worktreePath}: ${error.message}`;
  }
}

async function validateIntegration({ slices, outcomes, integrationPath, abortSignal }) {
  const acceptedIds = new Set(outcomes.filter((outcome) => outcome.status === "passed").map((outcome) => outcome.sliceId));
  const head = await git(integrationPath, ["rev-parse", "HEAD"]);
  const validation = await checkWorktreeGates({
    slices: slices.filter((slice) => acceptedIds.has(slice.number)), cwd: integrationPath, abortSignal,
  });
  if (!validation.success) {
    throw new ParallelWorktreeError(`integrated gate failed for slice ${validation.sliceId}: ${validation.failedCommand}. ${validation.output}`);
  }
  if (head !== await git(integrationPath, ["rev-parse", "HEAD"]) || await git(integrationPath, ["status", "--porcelain"])) {
    throw new ParallelWorktreeError("Integrated validation modified the worktree; retained without promotion.");
  }
}

async function promoteBatch({ outcomes, slices, projectDir, batchId, baseSha, ignoredPaths, abortSignal }) {
  if (abortSignal?.aborted) throw new ParallelWorktreeError("Run aborted; worker worktrees retained without promotion.");
  const successful = outcomes.filter((outcome) => outcome.status === "passed");
  if (successful.length === 0) return;
  const integrationPath = await createDetachedWorktree({ projectDir, batchId, sliceId: "integration", baseSha, ignoredPaths, abortSignal });
  for (const outcome of successful) {
    outcome.integrationPath = integrationPath;
    try {
      outcome.promotion = await integrateWorker({ outcome, integrationPath, baseSha });
    } catch (error) {
      Object.assign(outcome, failedResult({ number: outcome.sliceId }, error));
    }
  }
  await validateIntegration({ slices, outcomes, integrationPath, abortSignal });
  if (abortSignal?.aborted) throw new ParallelWorktreeError("Run aborted; worker worktrees retained without promotion.");
  await requireCleanParent(projectDir, baseSha);
  const integratedHead = await git(integrationPath, ["rev-parse", "HEAD"]);
  await git(projectDir, ["merge", "--ff-only", integratedHead]);
  for (const outcome of successful) {
    if (outcome.status !== "passed") continue;
    outcome.promotion.promoted = true;
    outcome.cleanupWarning = await removePromotedWorktree(projectDir, outcome.worktreePath);
  }
  const cleanupWarning = await removePromotedWorktree(projectDir, integrationPath);
  if (cleanupWarning) {
    for (const outcome of successful) outcome.integrationCleanupWarning = cleanupWarning;
  }
}

/**
 * Execute a ready batch in detached worktrees and promote only validated commits.
 * @param {{ projectDir: string, slices: object[], executeFn: Function, eventBus: object, abortSignal?: AbortSignal, runDir?: string }} options
 * @returns {Promise<object[]>}
 */
export async function executeIsolatedBatch({ projectDir, slices, executeFn, eventBus, abortSignal, runDir }) {
  projectDir = resolve(projectDir);
  const batchId = `parallel-${randomUUID()}`;
  const prepared = new Map();
  let outcomes;
  try {
    const baseSha = await requireCleanParent(projectDir);
    const ignoredPaths = (await git(projectDir, [
      "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory", "-z",
    ], { raw: true })).split("\0").filter(Boolean);
    for (const slice of slices) {
      if (abortSignal?.aborted) throw new ParallelWorktreeError("Run aborted before workers started.");
      prepared.set(slice.number, variantPath(projectDir, batchId, slice.number, 1));
      await createDetachedWorktree({ projectDir, batchId, sliceId: slice.number, baseSha, ignoredPaths, abortSignal });
    }
    outcomes = await Promise.all(slices.map((slice) => executeInWorktree({
      slice, worktreePath: prepared.get(slice.number), executeFn, eventBus,
    })));
    await promoteBatch({ outcomes, slices, projectDir, batchId, baseSha, ignoredPaths, abortSignal });
  } catch (error) {
    outcomes = slices.map((slice, index) => {
      const outcome = outcomes?.[index];
      if (outcome && outcome.status !== "passed") return outcome;
      return failedResult(slice, error, { ...outcome, worktreePath: prepared.get(slice.number) });
    });
  }
  for (const outcome of outcomes) {
    if (runDir) await writeFile(join(runDir, `slice-${outcome.sliceId}.json`), JSON.stringify(outcome, null, 2));
    eventBus.emit(outcome.status === "passed" ? "slice-completed" : "slice-failed", { ...outcome, parallel: true });
  }
  return outcomes;
}
