import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { QUORUM_MODES } from "./approval-proof.mjs";
import { isInside, resolveCommand, resolvePforgeCommand } from "./worktree.mjs";
import { assertJobActive, PLAN_ACTUALS_UNCONFIRMED, PLAN_RUN_ID } from "./runner-lifecycle.mjs";
import { createPlanProgress, PLAN_PROGRESS_ERRORS } from "./plan-progress.mjs";

const OUTPUT_LIMIT = 8 * 1024;
const ABORT_TIMEOUT_MS = 5_000;
const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_RUN_SUMMARIES = 256;
const MAX_SUMMARY_BYTES = 256 * 1024;

export const PLAN_ACTUALS_ERRORS = Object.freeze({
  UNCONFIRMED: PLAN_ACTUALS_UNCONFIRMED,
  SUMMARY_MISSING: "PLAN_SUMMARY_MISSING",
  REPORT_UNAVAILABLE: "PLAN_COST_REPORT_UNAVAILABLE",
  CANCELLED: "PLAN_ACTUALS_CANCELLED",
});

function safeText(value, secrets) {
  const text = String(value ?? "").slice(0, OUTPUT_LIMIT);
  return typeof secrets?.redact === "function" ? secrets.redact(text) : text;
}

function appendOutput(current, chunk, other) {
  const remaining = OUTPUT_LIMIT - Buffer.byteLength(current) - Buffer.byteLength(other);
  if (remaining <= 0) return current;
  let bytes = Buffer.from(chunk).subarray(0, remaining);
  while (bytes.length && Buffer.byteLength(bytes.toString("utf8")) > remaining) bytes = bytes.subarray(0, bytes.length - 1);
  return current + bytes.toString("utf8");
}

async function relativePlan(worktree, input) {
  if (typeof input !== "string" || !input.trim() || input.includes("\0")
    || path.isAbsolute(input) || path.win32.isAbsolute(input) || path.posix.isAbsolute(input)
    || /^[a-z]:/i.test(input)) throw new ClawError("PLAN_PATH_INVALID");
  const target = path.resolve(worktree, input);
  const relative = path.relative(worktree, target);
  if (!relative || !(await isInside(worktree, target))) throw new ClawError("PLAN_PATH_INVALID");
  try {
    if (!(await stat(target)).isFile()) throw new ClawError("PLAN_PATH_INVALID");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new ClawError("PLAN_PATH_INVALID");
    throw error;
  }
  return relative;
}

function planChoices(job) {
  const quorum = job.quorum ?? "auto";
  if (!QUORUM_MODES.includes(quorum)) throw new ClawError("APPROVAL_QUORUM_INVALID");
  const args = [`--quorum=${quorum}`];
  if (job.resumeFrom !== undefined) {
    if (!Number.isSafeInteger(job.resumeFrom) || job.resumeFrom < 1) throw new ClawError("PLAN_RESUME_INVALID");
    args.push("--resume-from", String(job.resumeFrom));
  }
  return args;
}

function boundedCall(operation, { timeoutMs, signal, code }) {
  let timer;
  let onAbort;
  const waiting = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ClawError(code)), timeoutMs);
    timer.unref?.();
    onAbort = () => reject(new ClawError("JOB_CANCELLED"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([operation, waiting]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  });
}

function pollDelay(signal) {
  return new Promise((resolve) => {
    let timer;
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    timer = setTimeout(finish, POLL_INTERVAL_MS);
    timer.unref?.();
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

function emitPlanUpdates({ response, progress, signal, emit }) {
  if (signal?.aborted) return null;
  const normalized = progress.consume(response);
  for (const update of normalized.updates) {
    if (signal?.aborted) break;
    emit?.(update.type, update.data);
  }
  return normalized.reason;
}

function readPlanProgress({ client, worktree, signal }) {
  return boundedCall(client.call("forge_watch_live", {
    targetPath: worktree, durationMs: 1000, pollIntervalMs: 500, maxCapturedEvents: 100, verbose: true,
  }, { signal }), { timeoutMs: POLL_TIMEOUT_MS, signal, code: "MCP_CALL_TIMEOUT" });
}

async function pollProgress({ client, worktree, signal, emit, progress }) {
  let warned = false;
  while (!signal.aborted) {
    try {
      const response = await readPlanProgress({ client, worktree, signal });
      const reason = emitPlanUpdates({ response, progress, signal, emit });
      if (reason && !warned) emit?.("log", { level: "warn", code: reason });
      if (reason) warned = true;
    } catch {
      if (!signal.aborted && !warned) emit?.("log", { level: "warn", code: PLAN_PROGRESS_ERRORS.UNAVAILABLE });
      warned = true;
    }
    if (!signal.aborted) await pollDelay(signal);
  }
}

async function drainPlanProgress({ client, worktree, signal, emit, progress }) {
  try {
    const response = await readPlanProgress({ client, worktree, signal });
    const reason = emitPlanUpdates({ response, progress, signal, emit });
    if (reason && !signal?.aborted) emit?.("log", { level: "warn", code: reason });
  } catch {
    if (!signal?.aborted) emit?.("log", { level: "warn", code: PLAN_PROGRESS_ERRORS.UNAVAILABLE });
  }
}

function monitorChild(child, secrets) {
  let stdout = "";
  let stderr = "";
  const completion = new Promise((resolve) => {
    child.once("error", () => resolve({ code: -1, spawned: false }));
    child.once("close", (code) => resolve({ code: code ?? -1, spawned: true }));
  });
  child.stdout?.on("data", (chunk) => { stdout = appendOutput(stdout, safeText(chunk.toString("utf8"), secrets), stderr); });
  child.stderr?.on("data", (chunk) => { stderr = appendOutput(stderr, safeText(chunk.toString("utf8"), secrets), stdout); });
  return { completion, output: () => ({ stdout, stderr }) };
}

async function readSummary(worktree, runId) {
  const file = path.join(worktree, ".forge", "runs", runId, "summary.json");
  if (!(await isInside(worktree, file))) throw new ClawError(PLAN_ACTUALS_ERRORS.UNCONFIRMED);
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_SUMMARY_BYTES) return null;
    const bytes = await readFile(file);
    if (bytes.length > MAX_SUMMARY_BYTES) return null;
    const hash = createHash("sha256").update(bytes).digest("hex");
    let summary = null;
    try { summary = JSON.parse(bytes.toString("utf8")); } catch { summary = null; }
    return { runId, hash, summary };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

async function snapshotRunSummaries(worktree) {
  const root = path.join(worktree, ".forge", "runs");
  if (!(await isInside(worktree, root))) throw new ClawError(PLAN_ACTUALS_ERRORS.UNCONFIRMED);
  let directories;
  try {
    directories = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  if (directories.length > MAX_RUN_SUMMARIES) throw new ClawError(PLAN_ACTUALS_ERRORS.UNCONFIRMED);
  const summaries = new Map();
  for (const entry of directories) {
    if (!entry.isDirectory() || !PLAN_RUN_ID.test(entry.name)) continue;
    const summary = await readSummary(worktree, entry.name);
    if (summary) summaries.set(entry.name, summary);
  }
  return summaries;
}

async function matchesExecutedPlan({ worktree, relativePlan, summary }) {
  if (typeof summary?.plan !== "string" || summary.plan.includes("\0")
    || typeof summary.endTime !== "string" || !Number.isFinite(Date.parse(summary.endTime))
    || typeof summary.status !== "string" || !summary.status
    || ["estimate", "approval-rejected"].includes(summary.status)) return false;
  const target = path.resolve(worktree, summary.plan);
  return path.relative(path.resolve(worktree, relativePlan), target) === "" && await isInside(worktree, target);
}

async function completedRun({ worktree, relativePlan, runSnapshot }) {
  if (!(runSnapshot instanceof Map)) return null;
  const matches = [];
  for (const candidate of (await snapshotRunSummaries(worktree)).values()) {
    if (runSnapshot.get(candidate.runId)?.hash === candidate.hash) continue;
    if (await matchesExecutedPlan({ worktree, relativePlan, summary: candidate.summary })) matches.push(candidate);
  }
  return matches.length === 1 ? matches[0] : null;
}

function decodeCostReport(report) {
  if (report?.isError || report?.ok === false) return null;
  if (Array.isArray(report?.content)) {
    const text = report.content.find((entry) => entry?.type === "text")?.text;
    if (typeof text !== "string" || text.length > MAX_SUMMARY_BYTES) return null;
    try { return decodeCostReport(JSON.parse(text)); } catch { return null; }
  }
  return Number.isSafeInteger(report?.runs) && report.runs > 0
    && report.latest && typeof report.latest === "object" && !Array.isArray(report.latest) ? report : null;
}

function reportedUnit(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function unknownActuals(code) {
  return { planActuals: null, planActualsError: code };
}

/**
 * Correlate the native latest row to this isolated execution's exact newly written summary.
 * @param {{job: object, worktree: string, relativePlan: string, runSnapshot: Map, client: object, signal?: AbortSignal}} options
 * @returns {Promise<{planActuals: object|null, planActualsError?: string}>}
 */
export async function collectPlanActuals({ job, worktree, relativePlan, runSnapshot, client, signal }) {
  if (signal?.aborted) return unknownActuals(PLAN_ACTUALS_ERRORS.CANCELLED);
  let candidate;
  try {
    candidate = await completedRun({ worktree, relativePlan, runSnapshot });
  } catch {
    return unknownActuals(PLAN_ACTUALS_ERRORS.UNCONFIRMED);
  }
  if (!candidate) return unknownActuals(PLAN_ACTUALS_ERRORS.SUMMARY_MISSING);
  let report;
  try {
    report = decodeCostReport(await boundedCall(
      Promise.resolve().then(() => client.call("forge_cost_report", { path: worktree }, { signal })),
      { timeoutMs: POLL_TIMEOUT_MS, signal, code: "MCP_CALL_TIMEOUT" },
    ));
  } catch {
    return unknownActuals(signal?.aborted ? PLAN_ACTUALS_ERRORS.CANCELLED : PLAN_ACTUALS_ERRORS.REPORT_UNAVAILABLE);
  }
  if (signal?.aborted) return unknownActuals(PLAN_ACTUALS_ERRORS.CANCELLED);
  const latest = report?.latest;
  const summary = candidate.summary;
  if (!latest || latest.plan !== summary.plan || latest.date !== summary.endTime || latest.status !== summary.status) {
    return unknownActuals(PLAN_ACTUALS_ERRORS.UNCONFIRMED);
  }
  const unchanged = await readSummary(worktree, candidate.runId).catch(() => null);
  if (unchanged?.hash !== candidate.hash) return unknownActuals(PLAN_ACTUALS_ERRORS.UNCONFIRMED);
  return { planActuals: {
    jobId: job.id, projectId: job.projectId, runId: candidate.runId,
    plan: path.basename(relativePlan), endedAt: summary.endTime,
    usage: {
      costUSD: reportedUnit(latest.total_cost_usd),
      premiumRequests: reportedUnit(latest.premiumRequests ?? latest.premium_requests),
    },
  } };
}

/** The shipped foreground wrapper is awaited; abort RPC and polling settle before returning. */
export async function runForegroundPlan({ ctx, job, worktree, env, signal, emit, client }) {
  const relative = await relativePlan(worktree, job.planPath ?? job.plan ?? job.description);
  const runSnapshot = await snapshotRunSummaries(worktree).catch(() => null);
  const wrapper = resolvePforgeCommand({ config: ctx.config, cwd: worktree });
  const [executable, ...prefix] = resolveCommand(wrapper[0], { env });
  const args = [...prefix, ...wrapper.slice(1), "run-plan", relative, "--foreground", ...planChoices(job)];
  assertJobActive({ ctx, job, signal });
  const progress = createPlanProgress({ worktree, relativePlan: relative, startedAt: Date.now() });
  const child = spawn(executable, args, { cwd: worktree, env, shell: false, windowsHide: true });
  const monitored = monitorChild(child, ctx.secrets);
  const pollingController = new AbortController();
  const polling = pollProgress({ client, worktree, signal: pollingController.signal, emit, progress });
  let abortRequest;
  const onAbort = () => {
    pollingController.abort();
    abortRequest ??= boundedCall(client.call("forge_abort", { path: worktree }), {
      timeoutMs: ABORT_TIMEOUT_MS, code: "MCP_CALL_TIMEOUT",
    }).catch(() => emit?.("log", { level: "error", code: "PLAN_ABORT_FAILED" }))
      .finally(() => child.kill());
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const completed = await monitored.completion;
    if (abortRequest) await abortRequest;
    assertJobActive({ ctx, job, signal });
    pollingController.abort();
    await polling;
    assertJobActive({ ctx, job, signal });
    if (completed.code === 0) await drainPlanProgress({ client, worktree, signal, emit, progress });
    assertJobActive({ ctx, job, signal });
    const actuals = await collectPlanActuals({ job, worktree, relativePlan: relative, runSnapshot, client, signal });
    assertJobActive({ ctx, job, signal });
    if (completed.code !== 0) throw new ClawError(completed.spawned ? "PLAN_RUN_FAILED" : "PLAN_SPAWN_FAILED", {
      exitCode: completed.code, ...actuals,
    });
    const { stdout, stderr } = monitored.output();
    if (stdout) emit?.("progress", { text: safeText(stdout, ctx.secrets) });
    if (stderr) emit?.("log", { level: "warn", text: safeText(stderr, ctx.secrets) });
    return { status: "succeeded", ...actuals };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    pollingController.abort();
    await Promise.all([polling, abortRequest]);
  }
}
