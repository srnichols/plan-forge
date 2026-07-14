/** Plan Forge — Phase-53 S9: run-plan sub-module */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, appendFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { spawn, execSync, execFileSync } from "node:child_process";
import { resolve, basename, dirname, join, relative, extname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { QUORUM_MODES, WATCHER_MODES } from "../enums.mjs";
import { createTraceContext, createTelemetryHandler, writeManifest, appendRunIndex, pruneRunHistory, addLogSummary } from "../telemetry.mjs";
import { recordActivity } from "../team-activity.mjs";
import { isOpenBrainConfigured, buildMemorySearchBlock, buildMemoryCaptureBlock, buildReflexionBlock, buildTrajectorySuffix, extractTrajectory, writeTrajectory, retrieveAutoSkills, buildAutoSkillContext, extractAutoSkill, writeAutoSkill, incrementAutoSkillReuse, buildRunSummaryThought, buildCostAnomalyThought, loadProjectContext, buildPlanBootContext, computeGateSuggestionKey, getGateSuggestionCounter, captureMemory, autoDrainOpenBrainQueue } from "../memory.mjs";
import { enforceCrucibleId, CrucibleEnforcementError } from "../crucible-enforce.mjs";
import { recall as brainRecall, loadReviewerConfig, invokeReviewer } from "../brain.mjs";
import { anvilDlqDrain as _anvilDlqDrain } from "../anvil.mjs";
import {
  readTemperingState as _readTemperingState,
  readTemperingConfig as _readTemperingConfig,
  TEMPERING_SCAN_STALE_DAYS,
  getMinimaForDomain,
  promoteSuppressions as _promoteSuppressions,
} from "../tempering.mjs";
import { loadAuditConfig as _loadAuditConfig, shouldAutoDrain as _shouldAutoDrain } from "../tempering/auto-activate.mjs";
import { getDeploymentQuota, compareSliceEstimate } from "../foundry-quota.mjs";
import { startProxyLogger } from "../proxy-logger.mjs";
import { buildCrossRunSnapshot } from "../watcher.mjs";
import { inspectGithubStack as _inspectGithubStackDefault } from "../github-introspect.mjs";
import { buildIssueBody as _buildIssueBodyDefault, dispatchSlice as _dispatchSliceDefault, pollPullRequest as _pollPullRequestDefault, DEFAULT_POLL_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "../workers/copilot-coding-agent.mjs";
import { API_ALLOWED_ROLES, COST_ANOMALY_MULTIPLIER, CRUCIBLE_STALL_CUTOFF_DAYS, DEFAULT_GATE_TIMEOUT_MS, DEFAULT_WORKER_OUTPUT_IDLE_MS, DEFAULT_WORKER_TIMEOUT_MS, EVENT_SOURCE, GATE_ALLOWED_PREFIXES, GATE_SUGGESTION_AUTO_INJECT_THRESHOLD, POSTMORTEM_RETENTION_COUNT, PROPOSED_FIX_DIR, QUORUM_PRESETS, REVIEW_RESOLUTIONS, REVIEW_SEVERITIES, REVIEW_SOURCES, REVIEW_STATUSES, SECURITY_RISK, SECURITY_RISK_FOR_TYPE, SUPPORTED_AGENTS, UNIX_TOOLS } from "./constants.mjs";
import { LogEventHandler, OrchestratorEventBus, appendEvent, writeSilentExitRecord } from "./event-bus.mjs";
import { buildSlicePrompt } from "./prompt-builders.mjs";
import { parsePlan, computeLockHash, normalizeSliceId, compareSliceIds, parseOnlySlicesExpr, parseWorkerTimeoutValue, parseSlices, buildDAG, loadPlanParserConfig } from "./plan-parser.mjs";
import { resetCliWorkersCache, setGhCopilotProbe, isDirectApiOnlyModel, isCopilotServableModel, isApiOnlyModel, getFoundryAuthScope, detectApiProvider, setSecretsLoader, buildApiMessages, generateImage, loadWorkerCapabilities, compareVersions, detectPackageManager, suggestInstall, classifyProbeFailure, detectWorkers, detectExecutionRuntime, detectClientHost, describeBillingSurface, getRoutingPreference, loadRoutingPreference, resolveRequiredCli, probeQuorumModelAvailability, filterQuorumModels, formatQuorumSummary, assessQuorumViability, detectRuntimes, spawnWorker, detectHelpTextOutput, detectSilentWorkerFailure, detectKilledBySignal, deriveVendorFromModel, extractTokens, shouldDefaultPremiumRequestsToOne, parseStderrStats, resolveWorkerOutputIdleMs, resolveWorkerTimeoutMs, assertWorkerBackendReady } from "./worker-spawn.mjs";
import { resolveGateTimeoutMs, __resetBashPathCache, resolveBashPath, detectSelfRepairMissed, buildRetryPrompt, coalesceGateLines, editDistance, isPlaceholderToken, suggestAllowedCommand, looksLikeProse, runGate, SequentialScheduler, ParallelScheduler, CompetitiveScheduler, selectWinner, detectScopeConflicts } from "./schedulers.mjs";
import { ensureForgeDir, pruneForgeRuns, recordModelPerformance, readForgeJson, appendForgeJsonl, readForgeJsonl, auditOrphanForgeFiles, loadModelPerformance, aggregateModelStats, getCostReport, getHealthTrend, emitToolTelemetry, loadGateCheckConfig, registerGateCheckResponder } from "./forge-io.mjs";
import { extractPlanReleaseVersion, detectVersionCollision, parseValidationGates, lintGateCommands, validateGatePortability, isGateCommandAllowed, regressionGuard } from "./gate-helpers.mjs";
import { isDestructiveSliceTitle, isWorktreeExemptPath, loadTeardownGuardConfig, verifyBranchSafety, captureAbsorbedCommits, snapshotPreSliceState, pushSliceSnapshot, popSliceSnapshot, attachSliceSnapshotRestore, cleanupStaleSnapshots, extractFilesModifiedExhaustive, verifyFilesModified, verifyDeletionSlice, verifySliceScope, autoCommitSliceIfDirty, stageOrphansOnSliceFailure } from "./git-safety.mjs";
import { registerCorrelationThreadResponder, isDeployTrigger, runPreDeployHook, parseGitPorcelain, parseShortstat, resetPostSliceHookFired, runPostSliceHook, resetPostSliceTemperingFired, runPostSliceTemperingHook, runPreAgentHandoffHook, loadOpenClawConfig, postOpenClawSnapshot, runPostRunAuditorHook } from "./hooks.mjs";
import { findLatestRun, parseEventLine, parseEventsLog, readSliceArtifacts, normalizeRunState, readCrucibleState, readReviewQueueState, buildWatchSnapshot, readHomeSnapshot, detectWatchAnomalies, recommendFromAnomalies, ensureReviewQueueDirs, ensureNotificationsDirs, ensureNotificationsConfig, generateReviewItemId, readReviewItem, listReviewItems, addReviewItem, resolveReviewItem, maybeAddStallReview, maybeAddTemperingReview, maybeAddBugReview, maybeAddVisualBaselineReview, maybeAddFixPlanReview, appendWatchHistory, runWatch, runWatchLive, scoreSliceComplexity } from "./review-watcher.mjs";
import { inferSliceType, recommendModel } from "./model-scoring.mjs";
import { loadQuorumConfig, classifyLegError, quorumDispatch, quorumReview, analyzeWithQuorum, calculateSliceCost, buildCostBreakdown } from "./quorum.mjs";
import { estimatePlan as _estimatePlan } from "../cost-service.mjs";
import { rewritePlanStatusOnSuccess as _rewritePlanStatusOnSuccess } from "./run-plan/plan-status-update.mjs";

const [QUORUM_MODE_AUTO, QUORUM_PRESET_POWER, QUORUM_PRESET_SPEED, QUORUM_MODE_FALSE] = QUORUM_MODES;
export const loadAuditConfig = _loadAuditConfig;
export const shouldAutoDrain = _shouldAutoDrain;
export const readTemperingState = _readTemperingState;
export const readTemperingConfig = _readTemperingConfig;
export { TEMPERING_SCAN_STALE_DAYS };

// ─── Phase-26 Slice 2 — Competitive config ────────────────────────────

/**
 * Phase-26 Slice 2 — load runtime.competitive configuration.
 * Schema:
 *   { "runtime": { "competitive": { "maxVariants": 3, "archiveDays": 7 } } }
 * Defaults: maxVariants=3 (clamped [2,5]); archiveDays=7.
 * @param {string} cwd
 * @returns {{ maxVariants: number, archiveDays: number }}
 */
export function loadCompetitiveConfig(cwd) {
  const defaults = { maxVariants: 3, archiveDays: 7 };
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (!existsSync(configPath)) return defaults;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const raw = config?.runtime?.competitive ?? {};
    const out = { ...defaults };
    if (Number.isFinite(raw.maxVariants)) {
      const n = Math.trunc(raw.maxVariants);
      out.maxVariants = Math.min(5, Math.max(2, n));
    }
    if (Number.isFinite(raw.archiveDays) && raw.archiveDays > 0) {
      out.archiveDays = Math.trunc(raw.archiveDays);
    }
    return out;
  } catch {
    return defaults;
  }
}

import { loadGateSynthesisConfig, classifySliceDomain, synthesizeGateSuggestions, formatGateSuggestions } from "./run-plan/gate-synthesis.mjs";
export { GATE_SUGGESTION_AUTO_INJECT_THRESHOLD, loadGateSynthesisConfig, classifySliceDomain, synthesizeGateSuggestions, formatGateSuggestions };

// ─── Phase-26 Slice 9: Incident → fix-proposal auto-retry (C5) ────────
//
// Pure-ish helpers for applying LiveGuard-authored fix proposals against
// slice-level incidents. Keeps the 6900-line executeSlice untouched —
// callers wire these helpers into the retry path once Slice 12 surfaces
// them via `/api/innerloop/proposed-fixes`.
//
// MUST (Phase-26 plan §Slice 9):
//   - dry-run is the default (write patch file only, never touch the tree)
//   - apply mode re-runs the gate; any failure triggers rollback
//   - 1-attempt cap per incident, tracked via `autoFixAttempted: true`

export { PROPOSED_FIX_DIR };

/**
 * Default runner for `git apply` / `git apply -R` invocations. Callers may
 * substitute a stub in tests. Returns `{ ok: boolean, stderr?: string }`.
 * Never throws — converts spawn failures into structured results so the
 * state machine above remains deterministic.
 */
export function defaultRunGitApply({ cwd, args, stdin }) {
  try {
    execFileSync("git", args, {
      cwd,
      input: stdin,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      stderr: err.stderr ? String(err.stderr) : err.message,
    };
  }
}

/**
 * Locate the most recent fix-proposal matching a given incident. Matching
 * order (most → least specific):
 *   1. `proposal.correlationId === incident.id`
 *   2. `proposal.incidentId === incident.id`
 *   3. same `sliceNumber` (proposals whose generatedAt is newest wins)
 *
 * Pure function. Returns the matching record or `null`.
 */
export function findMatchingFixProposal({ incident, proposals } = {}) {
  if (!incident || !Array.isArray(proposals) || proposals.length === 0) return null;
  const incidentId = incident.id || incident.incidentId || null;
  const sliceNumber = incident.sliceNumber ?? null;

  const byCorrelation = proposals.filter((p) => p && incidentId && p.correlationId === incidentId);
  if (byCorrelation.length > 0) return pickNewest(byCorrelation);

  const byIncidentId = proposals.filter((p) => p && incidentId && p.incidentId === incidentId);
  if (byIncidentId.length > 0) return pickNewest(byIncidentId);

  if (sliceNumber !== null) {
    const bySlice = proposals.filter((p) => p && p.sliceNumber === sliceNumber);
    if (bySlice.length > 0) return pickNewest(bySlice);
  }
  return null;
}

function pickNewest(list) {
  const sorted = [...list].sort((a, b) => {
    const ta = Date.parse(a.generatedAt || "") || 0;
    const tb = Date.parse(b.generatedAt || "") || 0;
    return tb - ta;
  });
  return sorted[0] || null;
}

/**
 * Gate for the 1-attempt cap. Returns `false` when the incident already has
 * `autoFixAttempted: true` (regardless of outcome). Pure function.
 */
export function shouldAutoRetryFix(incident) {
  if (!incident || typeof incident !== "object") return false;
  if (incident.autoFixAttempted === true) return false;
  return true;
}

/**
 * Mark an incident record as having consumed its single auto-fix attempt.
 * Returns a new object — does not mutate the input.
 */
export function markFixAttempted(incident, { now = new Date() } = {}) {
  const ts = now instanceof Date ? now.toISOString() : String(now);
  return {
    ...incident,
    autoFixAttempted: true,
    autoFixAttemptedAt: ts,
  };
}

/**
 * Persist a proposed fix as `.forge/proposed-fixes/<fixId>.patch`. Creates
 * the directory if needed. Returns the absolute patch path.
 */
export function writeProposedFixPatch({ cwd = process.cwd(), fixId, patch } = {}) {
  if (!fixId || typeof fixId !== "string") {
    throw new Error("writeProposedFixPatch: fixId (string) required");
  }
  if (typeof patch !== "string") {
    throw new Error("writeProposedFixPatch: patch (string) required");
  }
  const dir = resolve(cwd, ".forge", PROPOSED_FIX_DIR);
  mkdirSync(dir, { recursive: true });
  let safeId = fixId.replace(/[^A-Za-z0-9._-]/g, "_");
  while (safeId.includes("..")) safeId = safeId.replace(/\.\./g, "_");
  const path = resolve(dir, `${safeId}.patch`);
  writeFileSync(path, patch, "utf-8");
  return path;
}

/**
 * Apply (or dry-run write) a fix proposal. Three outcomes:
 *   - `mode = "dry-run"` (default): writes patch, does NOT modify the tree.
 *     Returns `{ ok: true, mode: "dry-run", patchPath }`.
 *   - `mode = "apply"`: writes patch, runs `git apply`. On success returns
 *     `{ ok: true, mode: "apply", patchPath, applied: true }`. On failure
 *     returns `{ ok: false, mode: "apply", patchPath, applied: false, error }`.
 *
 * Never throws on git failures — surfaces them via the return shape. Callers
 * decide whether to invoke `rollbackFixProposal` or propagate the failure.
 *
 * @param {object} opts
 * @param {string} opts.cwd — project root
 * @param {string} opts.fixId — proposal identifier
 * @param {string} opts.patch — unified-diff text
 * @param {"dry-run"|"apply"} [opts.mode="dry-run"]
 * @param {Function} [opts.runGit=defaultRunGitApply] — injectable for tests
 */
export function applyFixProposal({ cwd = process.cwd(), fixId, patch, mode = "dry-run", runGit = defaultRunGitApply } = {}) {
  if (mode !== "dry-run" && mode !== "apply") {
    return { ok: false, mode, error: `invalid mode '${mode}' — expected 'dry-run' or 'apply'` };
  }
  let patchPath;
  try {
    patchPath = writeProposedFixPatch({ cwd, fixId, patch });
  } catch (err) {
    return { ok: false, mode, error: err.message };
  }
  if (mode === "dry-run") {
    return { ok: true, mode, patchPath, applied: false };
  }
  // apply mode
  const res = runGit({ cwd, args: ["apply", "--whitespace=nowarn", patchPath], stdin: null });
  if (res.ok) {
    return { ok: true, mode, patchPath, applied: true };
  }
  return {
    ok: false,
    mode,
    patchPath,
    applied: false,
    error: res.stderr || "git apply failed",
  };
}

/**
 * Reverse an applied fix proposal using `git apply -R`. Returns
 * `{ ok, error? }`. Safe to call when the patch file is missing — returns
 * `{ ok: false, error: "patch not found" }`.
 */
export function rollbackFixProposal({ cwd = process.cwd(), fixId, runGit = defaultRunGitApply } = {}) {
  if (!fixId) return { ok: false, error: "fixId required" };
  let safeId = String(fixId).replace(/[^A-Za-z0-9._-]/g, "_");
  while (safeId.includes("..")) safeId = safeId.replace(/\.\./g, "_");
  const patchPath = resolve(cwd, ".forge", PROPOSED_FIX_DIR, `${safeId}.patch`);
  if (!existsSync(patchPath)) return { ok: false, error: "patch not found" };
  const res = runGit({ cwd, args: ["apply", "-R", "--whitespace=nowarn", patchPath], stdin: null });
  if (res.ok) return { ok: true };
  return { ok: false, error: res.stderr || "git apply -R failed" };
}

// ─── Phase-26 Slice 10: Cost-anomaly detector + escalation re-ranking ─
//
// Pure helpers. When a slice attempt costs > `threshold` × the plan median,
// the NEXT retry's escalation chain is re-ranked by `avg_cost_usd` ascending
// so cheaper-proven models are tried first. Scoped per-plan; callers reset
// at plan start by dropping the `sliceCosts` collector.

export { COST_ANOMALY_MULTIPLIER };

/**
 * Compute the median of a numeric array. Returns 0 for empty input.
 * Skips non-finite values.
 */
export function computeMedian(values) {
  if (!Array.isArray(values)) return 0;
  const nums = values
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

/**
 * Detect whether a slice attempt is a cost outlier relative to the plan's
 * running median. Returns a deterministic report (never throws):
 *
 *   {
 *     isAnomaly: boolean,
 *     median: number,
 *     currentCost: number,
 *     ratio: number | null,        // currentCost / median, null when median=0
 *     threshold: number,
 *   }
 *
 * MUST (Phase-26 §Slice 10):
 *   - Compute median of the plan's observed slice costs so far.
 *   - Flag when `currentCost > multiplier * median`.
 *   - Never flag when the sample is empty — no signal yet.
 */
export function detectCostAnomaly({
  sliceCosts = [],
  currentCost = 0,
  threshold = COST_ANOMALY_MULTIPLIER,
} = {}) {
  const cost = Number(currentCost);
  const mult = Number.isFinite(threshold) && threshold > 0 ? threshold : COST_ANOMALY_MULTIPLIER;
  const median = computeMedian(sliceCosts);
  if (!Number.isFinite(cost) || cost <= 0) {
    return { isAnomaly: false, median, currentCost: cost, ratio: null, threshold: mult };
  }
  if (median <= 0) {
    return { isAnomaly: false, median, currentCost: cost, ratio: null, threshold: mult };
  }
  const ratio = cost / median;
  return {
    isAnomaly: ratio > mult,
    median,
    currentCost: cost,
    ratio,
    threshold: mult,
  };
}

/**
 * Re-rank an escalation chain so cheaper-proven models are tried first.
 * Stable: models absent from `modelStats` keep their relative input order and
 * trail after known cheaper models. `"auto"` (and any string-equal sentinel
 * in `preserveLeading`) is always pinned at the head of the returned chain.
 *
 * @param {object} opts
 * @param {string[]} opts.chain — input escalation chain (order preserved for unknowns)
 * @param {object} opts.modelStats — output of `aggregateModelStats()`; shape per-model `{ avg_cost_usd, ... }`
 * @param {string[]} [opts.preserveLeading=["auto"]] — pinned-at-head sentinels
 * @returns {string[]} new chain, re-ranked by avg_cost_usd ascending for known models
 */
export function rerankEscalationChain({
  chain = [],
  modelStats = {},
  preserveLeading = ["auto"],
} = {}) {
  if (!Array.isArray(chain) || chain.length === 0) return [];
  const leading = [];
  const rest = [];
  for (const entry of chain) {
    if (typeof entry !== "string") { rest.push(entry); continue; }
    if (preserveLeading.includes(entry)) leading.push(entry);
    else rest.push(entry);
  }
  const withStats = [];
  const withoutStats = [];
  rest.forEach((model, idx) => {
    const s = modelStats && typeof modelStats === "object" ? modelStats[model] : null;
    if (s && Number.isFinite(Number(s.avg_cost_usd))) {
      withStats.push({ model, cost: Number(s.avg_cost_usd), idx });
    } else {
      withoutStats.push({ model, idx });
    }
  });
  // Stable sort: ascending by cost, ties keep original order.
  withStats.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.idx - b.idx;
  });
  // Preserve original order for unknowns.
  withoutStats.sort((a, b) => a.idx - b.idx);
  return [
    ...leading,
    ...withStats.map((e) => e.model),
    ...withoutStats.map((e) => e.model),
  ];
}

import { buildPlanPostmortem, listPlanPostmortems, writePlanPostmortem } from "./run-plan/postmortem.mjs";
export { POSTMORTEM_RETENTION_COUNT, buildPlanPostmortem, listPlanPostmortems, writePlanPostmortem };
export { rewritePlanStatusOnSuccess } from "./run-plan/plan-status-update.mjs";

const _PROGRESS_LINE_FORMATTERS = {
  "run-started": (ts, d) => `[${ts}] ▶ Run started: ${d.sliceCount || "?"} slices, mode=${d.mode || "auto"}\n`,
  "slice-started": (ts, d) => `[${ts}] ⏳ Slice ${d.sliceId || "?"}: ${d.title || ""} — executing...\n`,
  "slice-completed": (ts, d) => `[${ts}] ✅ Slice ${d.sliceId || "?"}: ${d.title || ""} — ${d.status || "done"} (${Math.round((d.duration || 0) / 1000)}s)\n`,
  "slice-failed": (ts, d) => `[${ts}] ❌ Slice ${d.sliceId || "?"}: ${d.title || ""} — FAILED\n`,
  "slice-escalated": (ts, d) => `[${ts}] ⬆ Slice ${d.sliceId || "?"}: ${d.title || ""} — escalating to ${d.toModel} (attempt ${d.attempt})\n`,
  "run-completed": (ts, d) => `[${ts}] 🏁 Run complete: ${d.results?.passed || 0} passed, ${d.results?.failed || 0} failed\n`,
  "ci-triggered": (ts, d) => `[${ts}] 🚀 CI triggered: ${d.workflow} @ ${d.ref} — ${d.status}\n`,
};

function _emitRunPlanProgressLine(event) {
  const fmt = _PROGRESS_LINE_FORMATTERS[event.type];
  if (!fmt) return;
  const ts = new Date().toISOString().slice(11, 19);
  const d = event.data || event; // data is nested under event.data by the EventBus
  process.stdout.write(fmt(ts, d));
}

function _buildDryRunSliceResult(slice) {
  return {
    sliceId: slice.id ?? String(slice.number),
    number: slice.number,
    title: slice.title,
    status: "passed",
    duration: 0,
    exitCode: 0,
    gateStatus: "passed",
    gateOutput: "dry-run-worker",
    gateError: null,
    failedCommand: null,
    tokens: { tokens_in: 0, tokens_out: 0, model: "dry-run", premiumRequests: 0, apiDurationMs: null, sessionDurationMs: null, codeChanges: null, vendor: "dry-run" },
    worker: "dry-run",
    model: "dry-run",
    host: "dry-run",
    billingSurface: "dry-run-worker (no spawn)",
    attempts: 1,
    cost_usd: 0,
    autoCommit: { committed: false, reason: "dry-run-worker" },
  };
}

function _bubbleAutoCommitCodeChanges(result) {
  // #186 v2.96.2: bubble auto-commit codeChanges back into tokens when
  // the worker's JSONL events didn't surface result.usage.codeChanges.
  if (result.tokens && !result.tokens.codeChanges && result.autoCommit?.codeChanges) {
    result.tokens.codeChanges = result.autoCommit.codeChanges;
  }
  // Issue #195: when the orchestrator's own commit was housekeeping
  // only, the real product diffstat lives on the absorbed (external) commit.
  if (result.tokens && !result.tokens.codeChanges
      && result.autoCommit?.absorbedCommits?.length) {
    const firstWithStat = result.autoCommit.absorbedCommits.find((c) => c.diffstat);
    if (firstWithStat) result.tokens.codeChanges = firstWithStat.diffstat;
  }
}

function _handlePassedSliceResult(result, slice, ctx) {
  const { cwd, mode, eventBus, startSha, preSliceState, runDir } = ctx;
  result.autoCommit = autoCommitSliceIfDirty({ slice, cwd, mode, eventBus, startSha, preSliceState });
  _bubbleAutoCommitCodeChanges(result);
  // Issue #195: re-persist slice-N.json so the on-disk record matches
  // the slice-completed event.
  try {
    writeFileSync(
      resolve(runDir, `slice-${slice.number}.json`),
      JSON.stringify(result, null, 2),
    );
  } catch { /* non-fatal */ }
}

async function _runPlanSliceCallback(slice, ctx) {
  const { cwd, dryRunWorker, effectiveModel, modelRouting, mode, runDir, maxRetries,
    memoryEnabled, projectName, planPath, quorumConfig, escalationChain, eventBus,
    worker, _dispatchSlice, _pollPullRequest, planMeta } = ctx;
  // Bug #123: capture HEAD before the slice so we can deterministically
  // detect commits made by the worker itself (gh-copilot, claude CLI).
  let startSha = null;
  try {
    startSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
  } catch { /* not a git repo or detached \u2014 fall through */ }
  // Issue #151: snapshot working-tree state so autoCommitSliceIfDirty
  // can distinguish worker-owned paths from operator-owned paths that
  // were already dirty when the slice began.
  const preSliceState = snapshotPreSliceState({ cwd });
  // Issue #176 — dryRunWorker short-circuits the executeSlice spawn so
  // tests that exercise runPlan setup (probe, config, escalation chain)
  // don't hand a real worker (gh-copilot, claude CLI) shell access in
  // the operator's cwd. Synthesizes a passing slice result with the
  // same shape executeSlice would have returned.
  if (dryRunWorker) {
    return _buildDryRunSliceResult(slice);
  }
  const result = await executeSlice(slice, {
    cwd, model: effectiveModel, modelRouting, mode, runDir, maxRetries,
    memoryEnabled, projectName, planName: basename(planPath, ".md"),
    quorumConfig, escalationChain, eventBus,
    worker, _dispatchSlice, _pollPullRequest,
    networkAllowed: planMeta?.networkAllowed ?? null,
    networkEnforce: planMeta?.networkEnforce ?? false,
    toolsDeny: planMeta?.toolsDeny ?? null,
  });
  if (result.status === "passed") {
    _handlePassedSliceResult(result, slice, { cwd, mode, eventBus, startSha, preSliceState, runDir });
  } else if (result.status === "failed") {
    // Issue #132 \u2014 the gate said no, but the worker may have written
    // perfectly correct files. Stage them and warn.
    const orphans = stageOrphansOnSliceFailure({ slice, cwd, runDir, mode, eventBus });
    if (orphans) {
      result.orphans = orphans;
    }
  }
  return result;
}

async function _runDlqBootDrain(anvilDlqDrain, cwd) {
  try {
    const DRAIN_BUDGET_MS = 5000;
    const drainResult = await Promise.race([
      Promise.resolve(anvilDlqDrain({}, { cwd })),
      new Promise((resolve) => setTimeout(() => resolve({ drained: 0, timedOut: true }), DRAIN_BUDGET_MS)),
    ]);
    if (drainResult && typeof drainResult.drained === "number" && drainResult.drained > 0) {
      console.info(`[orchestrator] DLQ boot drain: removed ${drainResult.drained} stale record(s).`);
    }
  } catch {
    // Boot-time drain is best-effort — never block the plan run
  }
}

function _resolveEffectiveModel(model, plan, modelRouting) {
  // Bug #127: Precedence: options.model > frontmatter model: > .forge.json default > null
  const fmModel = (plan.meta && typeof plan.meta.model === "string" && plan.meta.model.trim().length > 0)
    ? plan.meta.model.trim() : null;
  if (model) return { effectiveModel: model, modelSource: "options" };
  if (fmModel) return { effectiveModel: fmModel, modelSource: "frontmatter" };
  if (modelRouting.default) return { effectiveModel: modelRouting.default, modelSource: "config" };
  return { effectiveModel: null, modelSource: "default" };
}

function _checkLockHash(plan, planPath) {
  if (!(plan.meta && typeof plan.meta.lockHash === "string")) return null;
  const planContent = readFileSync(planPath, "utf-8");
  const computedHash = computeLockHash(planContent);
  if (computedHash === plan.meta.lockHash) return null;
  return {
    status: "failed",
    error:
      `Plan body has drifted since it was hardened — lockHash mismatch.\n` +
      `  stored:   ${plan.meta.lockHash}\n` +
      `  computed: ${computedHash}\n` +
      `Re-run Step 2 hardening to regenerate the lockHash, then retry.`,
    code: "LOCK_HASH_MISMATCH",
    storedHash: plan.meta.lockHash,
    computedHash,
    planPath,
    hint: "Re-run Step 2 (step2-harden-plan.prompt.md) to update the lockHash in frontmatter.",
  };
}

function _checkVersionCollision(planPath, cwd) {
  const collision = detectVersionCollision(planPath, cwd);
  if (collision.collision) {
    return {
      status: "failed",
      error:
        `Refusing to run plan: target version v${collision.version} ` +
        `already exists on origin (sha=${collision.originSha?.slice(0, 12) || "?"}). ` +
        `Re-running this plan would overwrite a shipped release.`,
      code: "VERSION_COLLISION",
      version: collision.version,
      originSha: collision.originSha,
      planPath,
      hint:
        "Either bump the plan to a fresh version (recommended), " +
        "or pass --allow-retrograde if you intentionally want to re-tag " +
        "(this is almost never what you want — see meta-bug #129).",
    };
  }
  if (collision.error) {
    // eslint-disable-next-line no-console
    console.error(
      `[preflight] Could not check origin for v${collision.version} ` +
      `tag collision (advisory): ${collision.error}`,
    );
  }
  return null;
}

function _buildEstimateQuorumConfig(quorum, cwd, quorumPreset, quorumThreshold) {
  if (!quorum) return null;
  const estimateQuorumConfig = loadQuorumConfig(cwd, quorumPreset);
  estimateQuorumConfig.enabled = true;
  if (quorum === QUORUM_MODE_AUTO) estimateQuorumConfig.auto = true;
  else if (quorum === true) estimateQuorumConfig.auto = false;
  if (quorumThreshold !== null && typeof quorumThreshold === "number") {
    estimateQuorumConfig.threshold = quorumThreshold;
  }
  return estimateQuorumConfig;
}

function _buildDryRunResult(plan, worker) {
  // Phase GITHUB-B Slice 5: copilot-coding-agent dry-run prints issue body previews
  if (worker === "copilot-coding-agent") {
    const issuePreviews = plan.slices.map((s) => ({
      number: s.number,
      title: s.title || "Untitled slice",
      issueBody: _buildIssueBodyDefault({
        goal: s.goal || (Array.isArray(s.tasks) ? s.tasks.join("\n") : s.tasks),
        scope: s.scope,
        gate: s.validationGate,
      }),
    }));
    return { status: "dry-run", plan, issuePreviews };
  }
  return { status: "dry-run", plan };
}

function _runCopilotPreflight(_inspectGithubStack, cwd, planPath) {
  const inspection = _inspectGithubStack(cwd, { ghToken: true });
  const githubRemote = inspection.checks.find((c) => c.id === "github-remote");
  const ghCli = inspection.checks.find((c) => c.id === "gh-cli");
  const copilotAssignable = inspection.checks.find((c) => c.id === "copilot-coding-agent-assignable");
  const failed = [];
  if (!githubRemote || githubRemote.status !== "pass") {
    const detail = githubRemote?.detail ?? "check unavailable";
    const hint = githubRemote?.fixHint ? ` — ${githubRemote.fixHint}` : "";
    failed.push(`github-remote: ${detail}${hint}`);
  }
  if (!ghCli || ghCli.status !== "pass") {
    const detail = ghCli?.detail ?? "check unavailable";
    const hint = ghCli?.fixHint ? ` — ${ghCli.fixHint}` : "";
    failed.push(`gh-cli: ${detail}${hint}`);
  }
  // warn = Copilot Coding Agent not enabled; fail = API error. Both block dispatch.
  // na = check was skipped (token not available or check deferred) — not blocking.
  if (copilotAssignable && (copilotAssignable.status === "warn" || copilotAssignable.status === "fail")) {
    const detail = copilotAssignable.detail ?? "check unavailable";
    const hint = copilotAssignable.fixHint ? ` — ${copilotAssignable.fixHint}` : "";
    failed.push(`copilot-coding-agent-assignable: ${detail}${hint}`);
  }
  if (failed.length === 0) return null;
  return {
    status: "failed",
    error:
      "copilot-coding-agent worker requires a GitHub repo. " +
      "Run 'pforge github status' for diagnostics.\n" +
      failed.join("\n"),
    code: "COPILOT_AGENT_PREFLIGHT_FAILED",
    planPath,
  };
}

function _checkGateLintPreflight(planPath, cwd) {
  const gateLint = lintGateCommands(planPath, cwd);
  if (gateLint.passed) return null;
  const errorSummary = gateLint.errors.map(e => `  ❌ ${e.message}`).join("\n");
  const warnSummary = gateLint.warnings.map(w => `  ⚠️ ${w.message}`).join("\n");
  return {
    status: "failed",
    error: "Gate lint pre-flight failed — fix these before executing:",
    gateLint: {
      errors: gateLint.errors,
      warnings: gateLint.warnings,
      summary: gateLint.summary,
    },
    detail: [errorSummary, warnSummary].filter(Boolean).join("\n"),
  };
}

function _runGateSynthesisPreflight(plan, cwd, strictGates) {
  try {
    const baseCfg = loadGateSynthesisConfig(cwd);
    const synthConfig = strictGates ? { ...baseCfg, mode: "enforce" } : undefined;
    const synthResult = synthesizeGateSuggestions({ slices: plan.slices, cwd, config: synthConfig });
    if (strictGates && synthResult.suggestions.length > 0) {
      return {
        status: "failed",
        error: "--strict-gates: pre-flight failed — the following slices lack a domain-matched validation gate:",
        code: "STRICT_GATES_PREFLIGHT",
        offendingSlices: synthResult.suggestions.map((s) => ({
          sliceNumber: s.sliceNumber,
          sliceTitle: s.sliceTitle,
          domain: s.domain,
          reason: s.reason,
          suggestedCommand: s.suggestedCommand,
        })),
      };
    }
    const formatted = formatGateSuggestions(synthResult);
    if (formatted) {
      // eslint-disable-next-line no-console
      console.log(formatted);
    }
  } catch { /* advisory must never fail a run */ }
  return null;
}

function _setupSilentDeathGuard(eventBus, runDir) {
  let _guardSliceId = null;
  let _guardSliceTitle = null;
  const _silentDeathGuard = () => {
    writeSilentExitRecord(_guardSliceId, _guardSliceTitle, runDir);
  };
  process.once("exit", _silentDeathGuard);
  eventBus.on("slice-started", (d) => {
    _guardSliceId = d.sliceId ?? null;
    _guardSliceTitle = d.title || "";
  });
  eventBus.on("slice-completed", () => { _guardSliceId = null; _guardSliceTitle = null; });
  eventBus.on("slice-failed",    () => { _guardSliceId = null; _guardSliceTitle = null; });
  eventBus.on("run-completed",   () => { _guardSliceId = null; process.off("exit", _silentDeathGuard); });
  eventBus.on("run-aborted",     () => { _guardSliceId = null; process.off("exit", _silentDeathGuard); });
}

async function _selectScheduler({ plan, eventBus, cwd, planPath, maxParallelism }) {
  const hasParallelSlices = plan.slices.some((s) => s.parallel);
  const hasCompetitiveSlices = plan.slices.some((s) => s.competitive);
  if (hasCompetitiveSlices) {
    const compConfig = loadCompetitiveConfig(cwd);
    const worktreeManager = await import("./worktree-manager.mjs");
    return new CompetitiveScheduler(eventBus, {
      maxVariants: compConfig.maxVariants,
      projectDir: resolve(cwd),
      planBasename: basename(planPath, ".md"),
      worktreeManager,
    });
  }
  if (hasParallelSlices) {
    return new ParallelScheduler(eventBus, maxParallelism);
  }
  return new SequentialScheduler(eventBus);
}

function _readConfigQuorumExplicit(cwd) {
  try {
    const fp = resolve(cwd, ".forge.json");
    if (existsSync(fp)) {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));
      return raw.quorum != null && typeof raw.quorum === "object" && "enabled" in raw.quorum;
    }
  } catch { /* ignore — use legacy default */ }
  return false;
}

function _probeQuorumAvailability(quorumConfig) {
  const { available: availableModels, dropped: droppedModels } = filterQuorumModels(quorumConfig);
  if (availableModels.length === 0) {
    const err = new Error(
      `[quorum] no available models. Dropped: ${droppedModels.map((d) => `${d.model} (${d.reason})`).join(", ")}. ` +
      `Install hints: ${droppedModels.map((d) => d.install).filter(Boolean).join(" | ")}`,
    );
    err.exitCode = 2;
    throw err;
  }
  if (quorumConfig.strictAvailability && droppedModels.length > 0) {
    const err = new Error(
      `[quorum] strictAvailability=true and ${droppedModels.length} model(s) unavailable: ` +
      droppedModels.map((d) => `${d.model} (${d.reason})`).join(", "),
    );
    err.exitCode = 2;
    throw err;
  }
  if (availableModels.length === 1) {
    console.error(
      `[quorum] only 1 of ${quorumConfig.models.length} models available — degrading to single-model ` +
      `(no multi-perspective synthesis benefit); set quorum.strictAvailability=true to fail instead`,
    );
  }
  quorumConfig.models = availableModels;
  quorumConfig.droppedModels = droppedModels;
  // Probe reviewerModel separately — warn but do not block (existing fallback handles it)
  if (quorumConfig.reviewerModel) {
    const reviewerResult = probeQuorumModelAvailability(quorumConfig.reviewerModel);
    if (!reviewerResult.available) {
      console.error(
        `[quorum] reviewer model ${quorumConfig.reviewerModel} unavailable: ${reviewerResult.reason} — ` +
        `existing reviewer fallback will be used`,
      );
    }
  }
}

function _buildRunPlanQuorumConfig({ quorum, cwd, quorumPreset, quorumThreshold }) {
  if (!quorum) return null;
  const quorumConfig = loadQuorumConfig(cwd, quorumPreset);
  // "auto" (CLI default): preserve quorumConfig.enabled from .forge.json.
  // true / "true" / preset: caller explicitly requested quorum — force enabled regardless of config.
  const callerExplicit = quorum === true || quorum === "true" || quorumPreset !== null;
  const configHasExplicitEnabled = callerExplicit ? false : _readConfigQuorumExplicit(cwd);

  if (callerExplicit) {
    quorumConfig.enabled = true;
  } else if (!configHasExplicitEnabled) {
    // Legacy default: absence of quorum.enabled in .forge.json means enabled
    quorumConfig.enabled = true;
  }
  // else: quorum === "auto" AND .forge.json has explicit enabled — use the loaded value

  if (quorum === QUORUM_MODE_AUTO) {
    quorumConfig.auto = true;
  } else if (quorum === true || quorum === "true") {
    quorumConfig.auto = false; // Force quorum on all slices
  }
  if (quorumThreshold !== null && typeof quorumThreshold === "number") {
    quorumConfig.threshold = quorumThreshold;
  }

  const quorumSource = callerExplicit ? "cli" : (configHasExplicitEnabled ? "config" : "default");
  console.error(`[quorum] enabled=${quorumConfig.enabled} auto=${quorumConfig.auto} source=${quorumSource}`);

  if (quorumConfig.enabled) {
    _probeQuorumAvailability(quorumConfig);
  }
  return quorumConfig;
}

function _resolveExecutionOrder(plan, onlySlices) {
  if (onlySlices === null || onlySlices.length === 0) return plan.dag.order;
  const onlySet = new Set(onlySlices.map(String));
  for (const id of plan.dag.order) {
    if (!onlySet.has(id)) {
      console.log(`[orchestrator] Slice ${id} skipped (not in --only-slices)`);
    }
  }
  for (const id of onlySlices) {
    if (!plan.dag.nodes.has(String(id))) {
      console.warn(`[orchestrator] Slice ${id} requested via --only-slices was not found in plan`);
    }
  }
  return plan.dag.order.filter((id) => onlySet.has(id));
}

async function _runApprovalGate(bridge, runId, summary) {
  try {
    const approvalResult = await bridge.requestApproval(runId, { ...summary, runId });
    if (!approvalResult.approved) {
      summary.status = "approval-rejected";
      summary.approval = {
        status: "rejected",
        approver: approvalResult.approver ?? null,
        timedOut: approvalResult.timedOut ?? false,
        timestamp: new Date().toISOString(),
      };
    } else {
      summary.approval = {
        status: "approved",
        approver: approvalResult.approver ?? null,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (err) {
    // Non-fatal — log and continue without blocking the run
    console.error(`[orchestrator] Approval gate error: ${err.message}`);
  }
}

function _runAuditDrainHook(summary, cwd, results, eventBus) {
  try {
    const auditConfig = _loadAuditConfig(cwd);
    const evaluation = _shouldAutoDrain({
      cwd,
      config: auditConfig,
      filesChanged: results.length,
      env: process.env.PFORGE_ENV || "dev",
    });
    if (evaluation.fire) {
      eventBus.emit("drain-auto-estimate", {
        mode: auditConfig.mode,
        maxRounds: auditConfig.maxRounds,
        signals: evaluation.signals,
      });
      summary.auditDrain = { dispatched: true, mode: auditConfig.mode, signals: evaluation.signals };
    }
  } catch { /* non-fatal — never fail the run for audit activation */ }
}

async function _captureRunMemoryAndDrain(summary, cwd, projectName) {
  const runSummary = buildRunSummaryThought(summary, projectName);
  const costAnomaly = buildCostAnomalyThought(summary, getCostReport(cwd), projectName);
  const receipts = { runSummary: null, costAnomaly: null };
  if (runSummary) {
    receipts.runSummary = captureMemory({ content: runSummary, type: "decision", source: "forge_run_plan", cwd });
  }
  if (costAnomaly) {
    receipts.costAnomaly = captureMemory({ content: costAnomaly, type: "gotcha", source: "forge_run_plan/cost", cwd });
  }
  summary._memoryCapture = {
    runSummary,
    costAnomaly,
    _captured: true,
    receipts,
  };
  try {
    const drainResult = await autoDrainOpenBrainQueue(cwd, {
      source: "cli-drain",
      timeoutMs: 10_000,
    });
    summary._memoryCapture.drain = drainResult;
  } catch (err) {
    summary._memoryCapture.drain = { error: String(err?.message || err) };
  }
}

function _writePostmortemSafe(summary, planPath, cwd) {
  try {
    const planBasename = basename(planPath, ".md");
    const prior = listPlanPostmortems({ cwd, planBasename }).map((e) => e.record);
    const record = buildPlanPostmortem({ summary, planBasename, priorPostmortems: prior });
    const path = writePlanPostmortem({ cwd, planBasename, record });
    summary.postmortem = { path, record };
  } catch (err) {
    // Never block the run on postmortem failure.
    summary.postmortem = { error: err?.message || String(err) };
  }
}

function _recordActivitySafe(activitySummary, status, cwd) {
  try {
    recordActivity({ ...activitySummary, status }, { storeDir: join(cwd, ".forge") });
  } catch {
    // Never block the run on team activity write failure.
  }
}

function _emitMemoryPreload(plan, planPath, projectName, eventBus) {
  try {
    const boot = buildPlanBootContext(
      { name: basename(planPath, ".md"), slices: plan.slices },
      projectName,
    );
    if (boot.hints.length > 0) {
      eventBus.emit("memory-preload", boot);
    }
  } catch { /* best-effort — never break run start */ }
}

function _emitSnapshotJanitor(cwd, eventBus) {
  try {
    const cleanup = cleanupStaleSnapshots({ cwd });
    if (cleanup.dropped.length > 0) {
      eventBus.emit("snapshot-janitor", {
        scanned: cleanup.scanned,
        dropped: cleanup.dropped.length,
        errors: cleanup.errors.length,
      });
    }
  } catch { /* best-effort — never break run start */ }
}

function _precomputeSliceComplexity(plan, cwd) {
  for (const [_sliceId, sliceNode] of plan.dag.nodes) {
    try {
      const { score } = scoreSliceComplexity(sliceNode, cwd);
      sliceNode.complexityScore = score;
    } catch { /* leave undefined — UI will render a neutral '—' */ }
  }
}

function _enforceCruciblePreflight({ planPath, cwd, manualImport, manualImportSource, manualImportReason }) {
  try {
    enforceCrucibleId(planPath, {
      cwd,
      manualImport,
      source: manualImportSource,
      reason: manualImportReason,
    });
    return null;
  } catch (err) {
    if (err instanceof CrucibleEnforcementError) {
      return {
        status: "failed",
        error: err.message,
        code: err.code,
        planPath: err.planPath,
        hint:
          "Run `forge_crucible_submit` to start a smelt, or re-invoke with " +
          "--manual-import to bypass (audited in .forge/crucible/manual-imports.jsonl).",
      };
    }
    throw err;
  }
}

function _runPlanPostExecutionPreflight({ plan, planPath, cwd, worker, _inspectGithubStack, strictGates }) {
  // Phase GITHUB-B Slice 3 — Copilot Coding Agent pre-flight (skipped for estimate/dryRun)
  if (worker === "copilot-coding-agent") {
    const copilotFail = _runCopilotPreflight(_inspectGithubStack, cwd, planPath);
    if (copilotFail) return copilotFail;
  }
  // Pre-flight: lint gate commands before burning time on execution
  const gateLintFail = _checkGateLintPreflight(planPath, cwd);
  if (gateLintFail) return gateLintFail;
  // Phase-25 Slice 4 (L6 adaptive gate synthesis)
  const gateSynthFail = _runGateSynthesisPreflight(plan, cwd, strictGates);
  if (gateSynthFail) return gateSynthFail;
  return null;
}

function _buildRunMeta({ planPath, trace, effectiveModel, modelRouting, mode, quorum, quorumPreset, plan }) {
  return {
    plan: planPath,
    traceId: trace.traceId,
    startTime: new Date().toISOString(),
    model: effectiveModel || "auto",
    modelRouting,
    mode,
    // Issue #182: surface the quorum *mode* separately from the worker `mode`.
    quorumMode: quorum === false ? QUORUM_MODE_FALSE
              : quorumPreset // "power" | "speed"
              || (quorum === true ? "all" : QUORUM_MODE_AUTO),
    quorumPreset: quorumPreset || null,
    sliceCount: plan.slices.length,
    executionOrder: plan.dag.order,
  };
}

function _buildCombinedEventHandler(telemetryHandler, eventHandler, logHandler, isCliRun) {
  return {
    handle(event) {
      telemetryHandler.handle(event);
      if (eventHandler) eventHandler.handle(event);
      logHandler.handle(event);
      // Write progress to stdout so terminal stays alive (prevents VS Code "awaiting input" stall)
      if (isCliRun && event?.type) {
        _emitRunPlanProgressLine(event);
      }
    },
  };
}

function _restoreDisableTempering(priorValue) {
  if (priorValue === undefined) {
    delete process.env.PFORGE_DISABLE_TEMPERING;
  } else {
    process.env.PFORGE_DISABLE_TEMPERING = priorValue;
  }
}

function _runPostAuditorHook(summary, cwd, allPassed, eventBus) {
  try {
    const auditorResult = runPostRunAuditorHook({ cwd, allPassed, eventBus });
    if (auditorResult.triggered) {
      summary._auditor = auditorResult;
    }
  } catch { /* never block the run on auditor hook failure */ }
}

async function _finalizeRunPlan({
  results, plan, runMeta, runDir, planPath, cwd,
  abortSignal, bridge, eventBus, estimate, dryRun, memoryEnabled, projectName,
  trace,
}) {
  const allPassed = results.every((r) => r.status === "passed" || r.status === "skipped");
  let sweepResult = null;
  let analyzeResult = null;
  if (allPassed && !estimate && !dryRun) {
    sweepResult = runAutoSweep(cwd);
    analyzeResult = runAutoAnalyze(cwd, planPath);
  }

  const runId = basename(runDir);
  const summary = buildSummary(plan, results, runMeta, { sweepResult, analyzeResult });
  const activitySummary = {
    runId,
    plan: summary.plan,
    sliceCount: summary.sliceCount,
    duration_ms: summary.totalDuration,
    cost_usd: summary.cost?.total_cost_usd ?? null,
    timestamp: summary.endTime,
  };

  if (abortSignal?.aborted) {
    _recordActivitySafe(activitySummary, "aborted", cwd);
  }

  // Approval gate (Phase 16) — pause and await human approval before finalising
  if (allPassed && bridge?.hasApprovalChannels) {
    await _runApprovalGate(bridge, runId, summary);
  }

  _runPostRunHooks({ summary, allPassed, estimate, dryRun, results, cwd, bridge, eventBus, runId });

  _writeFinalRunArtifacts({ summary, runDir, runId, cwd, trace, eventBus, activitySummary, abortSignal });

  // OpenBrain: capture run summary + cost anomaly as thoughts.
  if (memoryEnabled) {
    await _captureRunMemoryAndDrain(summary, cwd, projectName);
  }

  // Phase-25 Slice 5 (L5 closed loop): write a plan postmortem after every run.
  _writePostmortemSafe(summary, planPath, cwd);

  // Issue #212: rewrite plan-file status header on a fully successful run so the
  // plan file reflects COMPLETE instead of remaining pinned at HARDENED.
  if (allPassed && !estimate && !dryRun) {
    _rewritePlanStatusOnSuccess({
      planPath,
      cwd,
      shippedAt: summary.endTime || new Date().toISOString(),
    });
  }

  // Phase-31 Slice 6: promote recurring tempering suppressions to bug files.
  try {
    _promoteSuppressions({ cwd });
  } catch { /* never block the run on promoter failure */ }

  return summary;
}

function _runPlanPrePlanPreflight({ plan, planPath, cwd, allowRetrograde }) {
  if (plan.slices.length === 0) {
    return {
      status: "failed",
      error: "No slices found in plan — expected '### Slice N: …' headers (h2/h3/h4 accepted)",
      code: "NO_SLICES",
      planPath,
    };
  }
  const lockHashFail = _checkLockHash(plan, planPath);
  if (lockHashFail) return lockHashFail;
  if (!allowRetrograde) {
    const collisionFail = _checkVersionCollision(planPath, cwd);
    if (collisionFail) return collisionFail;
  }
  return null;
}

function _setupRunInfrastructure({ planPath, cwd, mode, effectiveModel, plan, eventHandler }) {
  const runDir = createRunDir(cwd, planPath);
  const logHandler = new LogEventHandler(runDir);
  const trace = createTraceContext(planPath, { mode, model: effectiveModel, sliceCount: plan.slices.length });
  const telemetryHandler = createTelemetryHandler(trace, runDir);
  const isCliRun = !eventHandler;
  const combinedHandler = _buildCombinedEventHandler(telemetryHandler, eventHandler, logHandler, isCliRun);
  const eventBus = new OrchestratorEventBus(combinedHandler);
  _setupSilentDeathGuard(eventBus, runDir);
  return { runDir, trace, eventBus };
}

async function _executeSlicesWithTempering({
  plan, executionOrder, noTempering, scheduler, abortSignal, resumeFrom, hub, gateCheckConfig, sliceCtx,
}) {
  const _priorDisableTempering = process.env.PFORGE_DISABLE_TEMPERING;
  if (noTempering) {
    process.env.PFORGE_DISABLE_TEMPERING = "1";
  }
  try {
    return await scheduler.execute(
      plan.dag.nodes,
      executionOrder,
      (slice) => _runPlanSliceCallback(slice, sliceCtx),
      { abortSignal, resumeFrom: resumeFrom ? String(resumeFrom) : null, hub, gateCheckConfig },
    );
  } finally {
    _restoreDisableTempering(_priorDisableTempering);
  }
}

function _runPostRunHooks({ summary, allPassed, estimate, dryRun, results, cwd, bridge, eventBus, runId }) {
  // Approval gate (Phase 16) — pause and await human approval before finalising
  // (approval is async and handled by caller; this only handles sync post-hooks)
  // CI/CD Integration Hook — trigger workflow after successful run
  if (allPassed && summary.status !== "approval-rejected") {
    const ciConfig = loadCiConfig(cwd);
    if (ciConfig.enabled && ciConfig.workflow) {
      summary.ci = triggerCiWorkflow(ciConfig, eventBus);
    }
  }
  // Phase-39 Slice 7 — audit-loop activation hook (end-of-plan)
  if (allPassed && !estimate && !dryRun) {
    _runAuditDrainHook(summary, cwd, results, eventBus);
  }
  // Phase-39 Slice 1 — post-run auditor auto-invoke on failure
  if (!estimate && !dryRun) {
    _runPostAuditorHook(summary, cwd, allPassed, eventBus);
  }
}

function _writeFinalRunArtifacts({ summary, runDir, runId, cwd, trace, eventBus, activitySummary, abortSignal }) {
  // Write summary
  writeFileSync(resolve(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  // Phase 2: Append to cost history
  if (summary.cost && summary.status !== "estimate" && summary.status !== "approval-rejected") {
    appendCostHistory(cwd, summary);
  }
  // Emit run-completed — telemetry handler writes trace.json during this emit
  eventBus.emit("run-completed", summary);
  if (!abortSignal?.aborted) {
    _recordActivitySafe(activitySummary, summary.status, cwd);
  }
  // v2.4: Write manifest + index + prune (AFTER trace.json is written by emit)
  const manifest = writeManifest(runDir, runId, { ...summary, traceId: trace.traceId });
  appendRunIndex(cwd, runId, manifest);
  pruneRunHistory(cwd, loadMaxRunHistory(cwd));
}

const _RUN_PLAN_DEFAULTS = Object.freeze({
  mode: "auto",
  quorum: QUORUM_MODE_AUTO,
  manualImportSource: "human",
});

function _normalizeRunPlanOptions(options) {
  const defaultsApplied = {
    cwd: options.cwd ?? process.cwd(),
    model: options.model ?? null,
    mode: options.mode ?? _RUN_PLAN_DEFAULTS.mode,
    resumeFrom: options.resumeFrom ?? null,
    estimate: options.estimate ?? false,
    dryRun: options.dryRun ?? false,
    eventHandler: options.eventHandler ?? null,
    abortController: options.abortController ?? null,
    quorum: options.quorum ?? _RUN_PLAN_DEFAULTS.quorum,
    quorumThreshold: options.quorumThreshold ?? null,
    quorumPreset: options.quorumPreset ?? null,
    bridge: options.bridge ?? null,
    manualImport: options.manualImport ?? false,
    manualImportSource: options.manualImportSource ?? _RUN_PLAN_DEFAULTS.manualImportSource,
    manualImportReason: options.manualImportReason ?? null,
  };
  return { ...defaultsApplied, ..._normalizeRunPlanOptionsExtras(options) };
}

function _normalizeRunPlanOptionsExtras(options) {
  return {
    hub: options.hub ?? null,
    strictGates: options.strictGates ?? false,
    onlySlices: options.onlySlices ?? null,
    noTempering: options.noTempering ?? false,
    allowRetrograde: options.allowRetrograde ?? false,
    worker: options.worker ?? null,
    dryRunWorker: options.dryRunWorker ?? false,
    _inspectGithubStack: options._inspectGithubStack ?? _inspectGithubStackDefault,
    _dispatchSlice: options._dispatchSlice ?? _dispatchSliceDefault,
    _pollPullRequest: options._pollPullRequest ?? _pollPullRequestDefault,
    _anvilDlqDrain: options._anvilDlqDrain ?? _anvilDlqDrain,
  };
}

export async function runPlan(planPath, options = {}) {
  const {
    cwd, model, mode, resumeFrom, estimate, dryRun, eventHandler, abortController,
    quorum, quorumThreshold, quorumPreset, bridge,
    manualImport, manualImportSource, manualImportReason,
    hub, strictGates, onlySlices, noTempering, allowRetrograde,
    worker, dryRunWorker,
    _inspectGithubStack, _dispatchSlice, _pollPullRequest,
    _anvilDlqDrain: anvilDlqDrain,
  } = _normalizeRunPlanOptions(options);

  // Phase-ANVIL Slice 4 — DLQ boot-time drain (5-second budget, best-effort).
  // Runs before any slice work so stale L3-deferred records can be recovered.
  // Does NOT block the run: errors are silently swallowed.
  await _runDlqBootDrain(anvilDlqDrain, cwd);

  // Mutual exclusion: --resume-from and --only-slices cannot both be active
  if (resumeFrom !== null && onlySlices !== null && onlySlices.length > 0) {
    throw new Error("--resume-from and --only-slices are mutually exclusive");
  }

  // Load model routing from .forge.json (Slice 5 — effectiveModel resolved after parsePlan)
  const modelRouting = loadModelRouting(cwd);

  // v2.37 Crucible (Slice 01.4) — enforce that the plan was smelted
  // through the Crucible funnel or an explicit `--manual-import` bypass.
  const crucibleFail = _enforceCruciblePreflight({ planPath: planPath, cwd: cwd, manualImport: manualImport, manualImportSource: manualImportSource, manualImportReason: manualImportReason });
  if (crucibleFail) return crucibleFail;

  // Parse plan
  const plan = parsePlan(planPath, cwd);

  // Bug #127: Precedence: options.model > frontmatter model: > .forge.json default > null
  const { effectiveModel, modelSource } = _resolveEffectiveModel(model, plan, modelRouting);
  // Bug #127: emit resolution log so users can trace which source won.
  // eslint-disable-next-line no-console
  console.error(`[model] resolved=${effectiveModel} source=${modelSource}`);

  // Zero-slice / lockHash / version-collision preflight (post-parse)
  const planPreflightFail = _runPlanPrePlanPreflight({ plan, planPath, cwd, allowRetrograde });
  if (planPreflightFail) return planPreflightFail;

  // Estimation mode — return without executing
  if (estimate) {
    // Bonus preflight: surface (but don't block) a missing/unauthenticated
    // worker backend so users see the problem before committing to Full Auto.
    const estimateAuthGate = assertWorkerBackendReady({ model: effectiveModel, worker, cwd });
    if (estimateAuthGate) {
      // eslint-disable-next-line no-console
      console.error(`[preflight] ${estimateAuthGate.error}`);
    }
    const estimateQuorumConfig = _buildEstimateQuorumConfig(quorum, cwd, quorumPreset, quorumThreshold);
    const estimateResult = buildEstimate({ plan, model: effectiveModel, cwd, quorumConfig: estimateQuorumConfig, resumeFrom, worker });
    if (estimateAuthGate) estimateResult.workerWarning = estimateAuthGate.error;
    return estimateResult;
  }

  // Dry run — parse and validate only
  if (dryRun) {
    return _buildDryRunResult(plan, worker);
  }

  // Worker-backend preflight: refuse to start Full Auto when no usable worker
  // exists (e.g. gh not authenticated). Returns a clean, actionable failure
  // instead of dispatching doomed workers — which previously cascaded into N
  // opaque slice failures (and, before the UV_HANDLE_CLOSING fix, a libuv abort).
  const workerAuthGate = assertWorkerBackendReady({ model: effectiveModel, worker, cwd });
  if (workerAuthGate) {
    return { ...workerAuthGate, planPath };
  }

  // Phase GITHUB-B Slice 3 + gate lint + gate synthesis pre-flight
  const postExecFail = _runPlanPostExecutionPreflight({
    plan, planPath, cwd, worker, _inspectGithubStack, strictGates,
  });
  if (postExecFail) return postExecFail;

  // Set up event bus, run dir, telemetry, silent-death guard
  const { runDir, trace, eventBus } = _setupRunInfrastructure({
    planPath, cwd, mode, effectiveModel, plan, eventHandler,
  });

  // Write run.json metadata
  const runMeta = _buildRunMeta({ planPath, trace, effectiveModel, modelRouting, mode, quorum, quorumPreset, plan });
  writeFileSync(resolve(runDir, "run.json"), JSON.stringify(runMeta, null, 2));

  // Select scheduler — use ParallelScheduler if plan has [P] tags
  const maxParallelism = loadMaxParallelism(cwd);
  const scheduler = await _selectScheduler({ plan: plan, eventBus: eventBus, cwd: cwd, planPath: planPath, maxParallelism: maxParallelism });
  const abortSignal = abortController?.signal || null;

  // OpenBrain memory integration
  const memoryEnabled = isOpenBrainConfigured(cwd);
  const projectName = loadProjectName(cwd);

  // Quorum mode (v2.5) — fix #122: respect .forge.json quorum.enabled when quorum==="auto"
  const quorumConfig = _buildRunPlanQuorumConfig({ quorum, cwd, quorumPreset, quorumThreshold });

  eventBus.emit("run-started", { ...runMeta, quorum: quorumConfig ? { enabled: quorumConfig.enabled, auto: quorumConfig.auto, threshold: quorumConfig.threshold } : null });

  // Issue #201 — janitor pass: drop any pforge-slice-N-snapshot stashes older
  // than 7 days. Best-effort.
  _emitSnapshotJanitor(cwd, eventBus);

  // GX.2 (v2.36): L3 → L1 preload. Emit a `memory-preload` event right after
  // run-started carrying the deterministic search-hints derived from the plan.
  if (memoryEnabled && projectName) {
    _emitMemoryPreload(plan, planPath, projectName, eventBus);
  }

  // Execute slices
  const maxRetries = loadMaxRetries(cwd);
  const escalationChain = loadEscalationChain(cwd);

  // Phase CRUCIBLE-02 Slice 02.1 — pre-compute complexity for every slice
  _precomputeSliceComplexity(plan, cwd);

  // Phase FORGE-SHOP-06 Slice 06.2 — Gate check config for inter-slice validation
  const gateCheckConfig = hub ? loadGateCheckConfig(cwd) : null;

  // Phase-33.1: Pre-filter execution order for --only-slices.
  const executionOrder = _resolveExecutionOrder(plan, onlySlices);

  const results = await _executeSlicesWithTempering({
    plan, executionOrder, noTempering, scheduler, abortSignal, resumeFrom, hub, gateCheckConfig,
    sliceCtx: {
      cwd, dryRunWorker, effectiveModel, modelRouting, mode, runDir, maxRetries,
      memoryEnabled, projectName, planPath, quorumConfig, escalationChain, eventBus,
      worker, _dispatchSlice, _pollPullRequest, planMeta: plan.meta,
    },
  });

  return _finalizeRunPlan({
    results, plan, runMeta, runDir, planPath, cwd,
    abortSignal, bridge, eventBus, estimate, dryRun, memoryEnabled, projectName, trace,
  });
}

/**
 * Load model routing configuration from .forge.json.
 * Schema: { "modelRouting": { "execute": "gpt-5.3-codex", "review": "claude-sonnet-4.6", "default": "auto" } }
 * Returns the modelRouting object, or defaults if not configured.
 */
export function loadModelRouting(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.modelRouting && typeof config.modelRouting === "object") {
        return config.modelRouting;
      }
    }
  } catch {
    // Invalid JSON or missing file — use defaults
  }
  return { default: "claude-opus-4.8" };
}

/**
 * Load max parallelism from .forge.json.
 * Schema: { "maxParallelism": 3 }
 * @returns {number}
 */
function loadMaxParallelism(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (typeof config.maxParallelism === "number" && config.maxParallelism > 0) {
        return config.maxParallelism;
      }
    }
  } catch { /* defaults */ }
  return 3; // Default: 3 concurrent workers
}

// Phase-53 S4: loadCompetitiveConfig → orchestrator/run-plan.mjs

/**
 * Load max retries from .forge.json.
 * Schema: { "maxRetries": 1 }
 * @returns {number}
 */
function loadMaxRetries(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (typeof config.maxRetries === "number" && config.maxRetries >= 0) {
        return config.maxRetries;
      }
    }
  } catch { /* defaults */ }
  return 1; // Default: 1 retry (2 total attempts)
}

/**
 * Load escalation chain from .forge.json.
 * Schema: { "escalationChain": ["auto", "claude-opus-4.7", "gpt-5.3-codex"] }
 * On each retry, the orchestrator escalates to the next model in the chain.
 * First escalation jumps to top-tier reasoning (Opus 4.7 — strongest reasoner
 * for hard bugs), then to Codex for bug-fixing.
 * @returns {string[]}
 */
function loadEscalationChain(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (Array.isArray(config.escalationChain) && config.escalationChain.length > 0) {
        return config.escalationChain;
      }
    }
  } catch { /* defaults */ }

  // Auto-tune: reorder default chain by historical success rate × cost efficiency
  try {
    const perf = loadModelPerformance(cwd);
    if (perf.length >= 5) {
      const stats = {};
      for (const p of perf) {
        const m = p.model || "unknown";
        if (!stats[m]) stats[m] = { passed: 0, total: 0, cost: 0 };
        stats[m].total++;
        if (p.status === "passed") stats[m].passed++;
        stats[m].cost += p.cost_usd || 0;
      }
      const ranked = Object.entries(stats)
        .filter(([, s]) => s.total >= 3)
        .map(([model, s]) => ({
          model,
          successRate: s.passed / s.total,
          avgCost: s.cost / s.total,
          score: (s.passed / s.total) * 100 - (s.cost / s.total) * 1000, // success weighted, cost penalized
        }))
        .sort((a, b) => b.score - a.score);
      if (ranked.length >= 2) {
        return ["auto", ...ranked.slice(0, 3).map(r => r.model)];
      }
    }
  } catch { /* fall through to static default */ }

  return ["auto", "claude-opus-4.7", "gpt-5.3-codex"];
}

// Phase-53 S4: gate-synthesis helpers → orchestrator/run-plan.mjs

// Phase-53 S4: gate-synthesis helpers → orchestrator/run-plan.mjs

// Phase-53 S4: fix-proposal helpers → orchestrator/run-plan.mjs

// Phase-53 S4: fix-proposal helpers (writeProposedFixPatch, applyFixProposal, rollbackFixProposal) → orchestrator/run-plan.mjs

// Phase-53 S4: cost-anomaly helpers → orchestrator/run-plan.mjs

// Phase-53 S4: plan-postmortem helpers → orchestrator/run-plan.mjs

/**
 * @returns {number}
 */
function loadMaxRunHistory(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (typeof config.maxRunHistory === "number" && config.maxRunHistory > 0) return config.maxRunHistory;
    }
  } catch { /* defaults */ }
  return 50;
}

/**
 * Load project name from .forge.json.
 */
function loadProjectName(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.projectName) return config.projectName;
    }
  } catch { /* defaults */ }
  return basename(cwd);
}

/**
 * Load CI/CD integration configuration from .forge.json.
 * Schema: { "ci": { "enabled": true, "workflow": "ci.yml", "ref": "main", "inputs": { "key": "value" } } }
 * @returns {{ enabled: boolean, workflow: string|null, ref: string, inputs: object }}
 */
export function loadCiConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.ci && typeof config.ci === "object") {
        return {
          enabled: config.ci.enabled === true,
          workflow: config.ci.workflow || null,
          ref: config.ci.ref || "main",
          inputs: config.ci.inputs && typeof config.ci.inputs === "object" ? config.ci.inputs : {},
        };
      }
    }
  } catch { /* defaults */ }
  return { enabled: false, workflow: null, ref: "main", inputs: {} };
}

/**
 * Trigger a GitHub Actions workflow via `gh workflow run`.
 * Emits a `ci-triggered` event and returns a CI result object.
 * @param {{ workflow: string, ref: string, inputs: object }} ciConfig
 * @param {OrchestratorEventBus} eventBus
 * @returns {{ workflow: string, ref: string, status: "triggered"|"failed", error?: string, timestamp: string }}
 */
function triggerCiWorkflow(ciConfig, eventBus) {
  const { workflow, ref, inputs } = ciConfig;
  const timestamp = new Date().toISOString();

  try {
    const args = ["workflow", "run", workflow, "--ref", ref];
    if (inputs && Object.keys(inputs).length > 0) {
      for (const [key, value] of Object.entries(inputs)) {
        args.push("-f", `${key}=${value}`);
      }
    }
    execFileSync("gh", args, { encoding: "utf-8", timeout: 30_000 });

    const result = { workflow, ref, status: "triggered", timestamp };
    eventBus.emit("ci-triggered", result);
    return result;
  } catch (err) {
    const error = err.stderr?.trim() || err.message || "unknown error";
    const result = { workflow, ref, status: "failed", error, timestamp };
    eventBus.emit("ci-triggered", result);
    return result;
  }
}

/**
 * Resolve which model to use for a given slice based on routing config.
 * Priority: CLI override > slice-type routing > default routing > null (auto)
 */
export function resolveModel(cliModel, modelRouting, slice) {
  if (cliModel && cliModel !== "auto") return cliModel;
  // Match slice type to routing keys (e.g. modelRouting.test, modelRouting.review, etc.)
  if (slice) {
    const sliceType = inferSliceType(slice);
    if (modelRouting[sliceType] && modelRouting[sliceType] !== "auto") return modelRouting[sliceType];
  }
  if (modelRouting.default && modelRouting.default !== "auto") return modelRouting.default;
  return null; // Let CLI worker pick default
}

// ─── Cost History (Phase 2) ───────────────────────────────────────────

/**
 * Append a run's cost data to .forge/cost-history.json.
 * Each entry captures date, plan, total cost, and per-model breakdown.
 */
function appendCostHistory(cwd, summary) {
  const historyPath = resolve(cwd, ".forge", "cost-history.json");
  let history = [];
  try {
    if (existsSync(historyPath)) {
      history = JSON.parse(readFileSync(historyPath, "utf-8"));
      if (!Array.isArray(history)) history = [];
    }
  } catch {
    history = [];
  }

  const entry = {
    date: summary.endTime || new Date().toISOString(),
    plan: summary.plan,
    sliceCount: summary.sliceCount,
    status: summary.status,
    total_tokens_in: summary.cost?.total_tokens_in || 0,
    total_tokens_out: summary.cost?.total_tokens_out || 0,
    total_cost_usd: summary.cost?.total_cost_usd || 0,
    by_model: summary.cost?.by_model || {},
    duration_ms: summary.totalDuration || 0,
  };

  history.push(entry);

  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

// Phase-53 S5: getCostReport, loadModelPerformance → orchestrator/forge-io.mjs

/**
 * Append a per-slice performance entry to .forge/model-performance.json.
 * Each entry records the model used, pass/fail outcome, cost, and timing.
 *
 * @param {string} cwd
 * @param {{ date, plan, sliceId, sliceTitle, model, status, attempts, duration_ms, cost_usd }} entry
 */

// ─── executeSlice helpers (extracted to satisfy clean-code D1/D2) ────

function _executeSliceCaptureBaseline({ cwd, slice }) {
  let sliceStartHead = null;
  try {
    sliceStartHead = execSync("git rev-parse HEAD", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim();
  } catch { /* not a git repo */ }
  const snapshot = pushSliceSnapshot({ cwd, sliceNumber: slice.number });
  const snapshotStash = snapshot.pushed;
  return { sliceStartHead, snapshotStash };
}

function _executeSliceCaptureTeardownBaseline({ cwd, slice }) {
  const teardownGuardConfig = isDestructiveSliceTitle(slice.title)
    ? loadTeardownGuardConfig(cwd)
    : { enabled: false };
  let teardownBaseline = null;
  if (teardownGuardConfig.enabled) {
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd, encoding: "utf-8", timeout: 5000,
      }).trim();
      const headSha = execSync("git rev-parse HEAD", {
        cwd, encoding: "utf-8", timeout: 5000,
      }).trim();
      let upstream = null;
      try {
        upstream = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
          cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
        }).trim();
      } catch { /* no upstream */ }
      teardownBaseline = { branch, headSha, upstream, capturedAt: new Date().toISOString() };
    } catch {
      teardownBaseline = null;
    }
  }
  return { teardownBaseline, teardownGuardConfig };
}

function _executeSliceRouteAgent({ resolvedModel, cwd, slice, eventBus }) {
  let finalModel = resolvedModel;
  if (!finalModel && cwd) {
    const sliceType = inferSliceType(slice);
    const rec = recommendModel(cwd, sliceType);
    if (rec) {
      finalModel = rec.model;
      if (eventBus) {
        eventBus.emit("slice-model-routed", {
          sliceId: slice.number,
          title: slice.title,
          model: rec.model,
          sliceType,
          success_rate: rec.success_rate,
          based_on_slices: rec.total_slices,
        });
      }
    }
  }
  return finalModel;
}

async function _executeSliceSetupQuorum({ slice, cwd, mode, quorumConfig, memoryEnabled, projectName, runDir }) {
  let quorumResult = null;
  let useQuorum = false;
  let complexityScore = 0;
  if (!quorumConfig || !quorumConfig.enabled || mode === "assisted") {
    return { quorumResult, useQuorum, complexityScore };
  }
  const { score, signals } = scoreSliceComplexity(slice, cwd);
  complexityScore = score;
  useQuorum = quorumConfig.auto ? score >= quorumConfig.threshold : true;
  if (!useQuorum) return { quorumResult, useQuorum, complexityScore };
  const dispatchResult = await quorumDispatch(slice, quorumConfig, {
    cwd, memoryEnabled, projectName, complexityScore: score,
  });
  quorumResult = await quorumReview(dispatchResult, slice, quorumConfig, { cwd });
  const quorumLog = {
    score, signals,
    threshold: quorumConfig.threshold,
    models: quorumConfig.models,
    successfulLegs: dispatchResult.successful.length,
    totalLegs: dispatchResult.all.length,
    legsFailed: dispatchResult.all.length - dispatchResult.successful.length,
    legErrors: dispatchResult.all
      .filter(r => !r.success && r.error)
      .map(r => ({ model: r.model, reason: r.error.reason, code: r.error.code })),
    dispatchDuration: dispatchResult.totalDuration,
    reviewerFallback: quorumResult.fallback,
    reviewerCost: quorumResult.reviewerCost,
  };
  writeFileSync(
    resolve(runDir, `slice-${slice.number}-quorum.json`),
    JSON.stringify(quorumLog, null, 2),
  );
  return { quorumResult, useQuorum, complexityScore };
}

async function _executeSliceFoundryQuotaPreflight({ finalModel, slice, runDir, eventBus }) {
  if (process.env.PFORGE_FOUNDRY_QUOTA_PREFLIGHT !== "1") return;
  const rawModel = finalModel || "";
  if (!rawModel.startsWith("azure/")) return;
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup  = process.env.AZURE_RESOURCE_GROUP;
  const accountName    = process.env.AZURE_OPENAI_ACCOUNT_NAME || process.env.AZURE_OPENAI_RESOURCE_NAME || "";
  const deploymentName = rawModel.replace(/^azure\//, "") || process.env.AZURE_OPENAI_DEPLOYMENT || "default";
  let quota = null;
  try {
    quota = await getDeploymentQuota({ subscriptionId, resourceGroup, accountName, deploymentName });
  } catch {
    quota = { ok: false, reason: "preflight_fetch_error" };
  }
  const assessment = compareSliceEstimate(quota, { tokens_in: 0, tokens_out: 0 });
  if (assessment.status !== "warning" && assessment.status !== "critical") return;
  const eventData = {
    sliceId: slice.number,
    title: slice.title,
    deploymentName,
    status: assessment.status,
    headroomPct: assessment.headroomPct,
    message: assessment.message,
  };
  appendEvent("pforge.foundry.quota", eventData, runDir);
  if (eventBus) eventBus.emit("pforge.foundry.quota", eventData);
  console.warn(`[pforge] foundry-quota preflight: ${assessment.message}`);
}

function _executeSliceEscalateModel({ attempt, currentModel, escalationChain, slice, eventBus }) {
  if (attempt === 0 || escalationChain.length <= 1) return currentModel;
  let nextModel = currentModel;
  for (let i = 0; i < escalationChain.length; i++) {
    const candidate = escalationChain[i] === "auto" ? null : escalationChain[i];
    if (candidate !== currentModel) { nextModel = candidate; break; }
  }
  if (nextModel === currentModel) {
    const curIdx = escalationChain.findIndex(m => (m === "auto" ? null : m) === currentModel);
    const nextIdx = Math.min(curIdx + attempt, escalationChain.length - 1);
    const candidate = escalationChain[nextIdx] === "auto" ? null : escalationChain[nextIdx];
    if (candidate !== currentModel) nextModel = candidate;
  }
  if (nextModel !== currentModel && eventBus) {
    eventBus.emit("slice-escalated", {
      sliceId: slice.number,
      title: slice.title,
      attempt,
      fromModel: currentModel || "auto",
      toModel: nextModel || "auto",
    });
  }
  return nextModel;
}

function _executeSliceBuildInstructions({ slice, useQuorum, quorumResult, memoryEnabled, projectName, planName, autoSkillContextBlock, teardownGuardConfig, lastFailureContext }) {
  let sliceInstructions = (useQuorum && quorumResult)
    ? quorumResult.enhancedPrompt
    : buildSlicePrompt(slice);
  if (memoryEnabled) {
    sliceInstructions = buildMemorySearchBlock(projectName, slice) + "\n" + sliceInstructions;
    sliceInstructions += "\n" + buildMemoryCaptureBlock(projectName, slice, planName);
  }
  if (autoSkillContextBlock) {
    sliceInstructions += autoSkillContextBlock;
  }
  sliceInstructions += "\n" + buildTrajectorySuffix();
  if (teardownGuardConfig.enabled && isDestructiveSliceTitle(slice.title)) {
    const preFlightWarning = [
      "",
      "--- TEARDOWN SAFETY GUARD (v2.49.1) ---",
      "This slice MUST NOT delete, reset, or rename local or remote git branches.",
      "Forbidden commands: `git branch -d`, `git branch -D`, `git push --delete`,",
      "`git reset --hard` against protected refs, `git update-ref -d`.",
      "Forbidden mutations: setting status to `abandoned` in `.github/` or `docs/plans/`",
      "without an explicit plan directive.",
      "Cleanup applies ONLY to cloud resources or scratch files the plan explicitly names.",
      "A post-slice branch-safety check will verify HEAD reachability and ref integrity.",
      "--- END TEARDOWN SAFETY GUARD ---",
      "",
    ].join("\n");
    sliceInstructions = preFlightWarning + sliceInstructions;
  }
  return buildRetryPrompt(sliceInstructions, lastFailureContext);
}

async function _executeSliceDispatchCopilot({ slice, cwd, _dispatchSlice, _pollPullRequest }) {
  const issueResult = _dispatchSlice(slice, { cwd });
  const prResult = await _pollPullRequest(issueResult.issueNumber, {
    cwd,
    intervalMs: DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const timedOut = prResult.status === "timeout";
  const prHint = timedOut ? `PR pending (timeout)` : `PR #${prResult.prNumber} (${prResult.status})`;
  const copilotDispatchData = {
    issueNumber: issueResult.issueNumber,
    issueUrl: issueResult.issueUrl,
    prNumber: timedOut ? null : prResult.prNumber,
    prUrl: timedOut ? null : prResult.prUrl,
    prStatus: prResult.status,
    renderHint: `🤖 Issue #${issueResult.issueNumber} → ${prHint}`,
  };
  const workerResult = {
    output: JSON.stringify({ ...issueResult, pr: prResult }),
    exitCode: timedOut ? 1 : 0,
    worker: "copilot-coding-agent",
    model: "copilot-coding-agent",
    stderr: timedOut
      ? `Copilot did not open a PR within the polling timeout (issue #${issueResult.issueNumber})`
      : "",
  };
  return { workerResult, copilotDispatchData };
}

async function _executeSliceStartProxy({ networkAllowed, networkEnforce, runDir, slice }) {
  if (!networkAllowed || !Array.isArray(networkAllowed) || networkAllowed.length < 0) {
    return { proxy: null, proxyEnv: null };
  }
  const nLogPath = resolve(runDir, "slices", String(slice.number), "network.log");
  try {
    const proxy = await startProxyLogger({
      allowlist: networkAllowed,
      networkLogPath: nLogPath,
      enforce: networkEnforce,
    });
    return {
      proxy,
      proxyEnv: {
        HTTPS_PROXY: proxy.proxyUrl,
        HTTP_PROXY: proxy.proxyUrl,
        PFORGE_NETWORK_LOG_ONLY: "1",
      },
    };
  } catch (pErr) {
    console.warn(`[pforge] network proxy start failed: ${pErr.message}`);
    return { proxy: null, proxyEnv: null };
  }
}

function _executeSliceWriteLog({ runDir, slice, attempt, workerResult, startTime }) {
  const logFile = resolve(runDir, `slice-${slice.number}-log.txt`);
  const logContent = [
    attempt > 0 ? `\n=== RETRY ATTEMPT ${attempt + 1} ===` : "",
    `=== Slice ${slice.number}: ${slice.title} ===`,
    `Worker: ${workerResult.worker}`,
    `Model: ${workerResult.model}`,
    `Started: ${new Date(startTime).toISOString()}`,
    "",
    "=== STDOUT ===",
    workerResult.output || "(empty)",
    "",
    "=== STDERR ===",
    workerResult.stderr || "(empty)",
  ].join("\n");
  writeFileSync(logFile, logContent, attempt > 0 ? { flag: "a" } : undefined);
  return logFile;
}

function _executeSliceRunGates(slice, cwd) {
  let gateResult = { success: true, output: "No validation gate defined" };
  if (!slice.validationGate) return gateResult;
  const gateLines = coalesceGateLines(slice.validationGate);
  for (const gateLine of gateLines) {
    gateResult = runGate(gateLine, cwd);
    if (!gateResult.success) {
      gateResult.failedCommand = gateLine;
      break;
    }
  }
  return gateResult;
}

function _executeSliceHandleTimeoutCommit({ workerResult, sliceStartHead, cwd, slice, logFile, eventBus }) {
  if (!sliceStartHead) return false;
  try {
    const postTimeoutHead = execSync("git rev-parse HEAD", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim();
    if (!postTimeoutHead || postTimeoutHead === sliceStartHead) return false;
    writeFileSync(logFile,
      `\n\n--- WORKER TIMED OUT BUT COMMITTED (${sliceStartHead.slice(0, 7)} -> ${postTimeoutHead.slice(0, 7)}) — treating as success ---\n`,
      { flag: "a" });
    if (eventBus && typeof eventBus.emit === "function") {
      try {
        eventBus.emit("slice-timeout-but-committed", {
          sliceNumber: slice.number,
          sliceTitle: slice.title,
          preSliceHead: sliceStartHead,
          postTimeoutHead,
        });
      } catch { /* best-effort */ }
    }
    workerResult.exitCode = 0;
    workerResult.timedOut = false;
    workerResult.committedBeforeTimeout = true;
    return true;
  } catch {
    return false;
  }
}

function _executeSlicePostTeardownVerify({ teardownBaseline, teardownGuardConfig, cwd, slice, planName, eventBus, finalizeSliceResult }) {
  if (!teardownBaseline || !teardownGuardConfig.enabled) return null;
  const verification = verifyBranchSafety(teardownBaseline, teardownGuardConfig, cwd);
  if (verification.ok) return null;
  const incident = {
    id: `INC-teardown-${Date.now()}`,
    capturedAt: new Date().toISOString(),
    severity: "critical",
    title: "teardown-branch-loss",
    sliceNumber: slice.number,
    sliceTitle: slice.title,
    baseline: teardownBaseline,
    failures: verification.failures,
    reflogTail: verification.reflogTail,
    tags: ["teardown", "branch-loss", "critical"],
  };
  appendForgeJsonl("incidents.jsonl", incident, cwd);
  appendForgeJsonl("liveguard-memories.jsonl", {
    capturedAt: incident.capturedAt,
    type: "gotcha",
    source: "teardown-guard",
    content: `Branch safety failure during slice "${slice.title}": ${verification.failures.join("; ")}. Reflog tip: ${verification.reflogTail?.[0] ?? "n/a"}.`,
    tags: ["teardown", "branch-loss", "critical"],
    sliceRef: `${planName}::${slice.number}`,
  }, cwd);
  if (eventBus) {
    eventBus.emit("teardown-branch-loss", {
      sliceNumber: slice.number,
      failures: verification.failures,
      blocked: teardownGuardConfig.blockOnBranchLoss,
    });
  }
  if (teardownGuardConfig.blockOnBranchLoss) {
    return finalizeSliceResult({
      ok: false,
      sliceNumber: slice.number,
      reason: "teardown-branch-loss",
      incident,
    });
  }
  return null;
}

function _executeSliceDetermineStatus({ workerResult, mode, slice, gateResult }) {
  const silentFailure = detectSilentWorkerFailure(workerResult, mode, slice.number);
  const killedBySignal = detectKilledBySignal(workerResult.exitCode);
  const hadValidationGate = !!slice.validationGate;
  let status;
  let statusReason = null;
  if (silentFailure) {
    status = "failed";
    statusReason = silentFailure;
  } else if (killedBySignal) {
    status = "failed";
    statusReason = `worker killed before completion: ${killedBySignal}`;
  } else if (!gateResult.success) {
    status = "failed";
    statusReason = `validation gate failed: ${gateResult.failedCommand || "unknown"}`;
  } else if (!hadValidationGate && workerResult.exitCode !== 0) {
    status = "failed";
    statusReason = `worker exited ${workerResult.exitCode} with no validation gate to cross-check — cannot assume success`;
  } else {
    status = "passed";
  }
  return { status, statusReason, silentFailure, killedBySignal };
}

function _executeSliceBillingInfo(workerResult) {
  try {
    const host = detectClientHost();
    const via = workerResult.worker === "gh-copilot"
      ? "gh-copilot"
      : (workerResult.worker && /^(claude|codex|grok|xai)/i.test(workerResult.worker) ? "other-cli" : "direct-api");
    const billing = describeBillingSurface(via, host);
    return {
      host,
      billingSurface: billing.label,
      ...(billing.warning ? { billingWarning: billing.warning } : {}),
    };
  } catch { return {}; }
}

function _executeSliceQuorumPayload({ useQuorum, quorumResult, complexityScore }) {
  if (!useQuorum) return null;
  return {
    score: complexityScore,
    models: quorumResult?.modelResponses?.map((r) => r.model) || [],
    reviewerFallback: quorumResult?.fallback || false,
    reviewerCost: quorumResult?.reviewerCost || 0,
    dryRunTokens: quorumResult?.modelResponses?.reduce((sum, r) => ({
      tokens_in: (sum.tokens_in || 0) + (r.tokens?.tokens_in || 0),
      tokens_out: (sum.tokens_out || 0) + (r.tokens?.tokens_out || 0),
    }), { tokens_in: 0, tokens_out: 0 }) || { tokens_in: 0, tokens_out: 0 },
  };
}

function _executeSliceBuildResult({ slice, status, statusReason, duration, workerResult, gateResult, silentFailure, killedBySignal, attempt, currentModel, finalModel, useQuorum, quorumResult, complexityScore, copilotDispatchData }) {
  const quorumPayload = _executeSliceQuorumPayload({ useQuorum, quorumResult, complexityScore });
  const escalated = currentModel !== finalModel ? { escalatedModel: finalModel || "auto" } : null;
  return {
    number: slice.number,
    title: slice.title,
    status,
    duration,
    exitCode: workerResult.exitCode,
    gateStatus: gateResult.success ? "passed" : "failed",
    gateOutput: gateResult.output,
    gateError: gateResult.error || null,
    failedCommand: gateResult.failedCommand || null,
    ...(silentFailure && { silentFailure }),
    ...(killedBySignal && { killedBySignal }),
    ...(statusReason && { statusReason }),
    tokens: workerResult.tokens || { tokens_in: null, tokens_out: null, model: "unknown" },
    worker: workerResult.worker,
    model: workerResult.model,
    ..._executeSliceBillingInfo(workerResult),
    attempts: attempt + 1,
    ...(escalated || {}),
    ...(quorumPayload && { quorum: quorumPayload }),
    ...(copilotDispatchData && { trajectory: copilotDispatchData }),
  };
}

function _executeSliceFilesModifiedCheck({ sliceResult, slice, cwd, sliceStartHead, eventBus }) {
  if (sliceResult.status !== "passed") return;
  try {
    const fmCheck = verifyFilesModified({ slice, cwd, startSha: sliceStartHead });
    if (!fmCheck.enforced) return;
    sliceResult.filesModifiedCheck = {
      enforced: true,
      declared: fmCheck.declared,
      missing: fmCheck.missing,
    };
    if (fmCheck.missing.length > 0 && eventBus) {
      eventBus.emit("slice-files-modified-warning", {
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        declared: fmCheck.declared,
        missing: fmCheck.missing,
      });
    }
  } catch { /* non-fatal */ }
}

/**
 * Issue #227 — fail a deletion slice whose commit re-added the files it was
 * supposed to remove. A pure-deletion slice ("Delete redundant …") that
 * commits an ADD of its declared targets is the inverse of its intent; the
 * slice's own gate did not catch this in Phase-86 Slice 12. Marking the slice
 * failed lets the retry/rollback machinery restore the correct deleted state.
 */
function _executeSliceDeletionInversionCheck({ sliceResult, slice, cwd, sliceStartHead, eventBus }) {
  if (sliceResult.status !== "passed") return;
  try {
    const check = verifyDeletionSlice({ slice, cwd, startSha: sliceStartHead });
    if (!check.applicable || !check.inverted) return;
    const paths = check.offending.map(o => o.path).join(", ");
    sliceResult.status = "failed";
    sliceResult.statusReason = `deletion-inversion: slice "${slice.title}" committed an ADD of files it should delete (${paths})`;
    sliceResult.deletionInversion = { offending: check.offending };
    eventBus?.emit("slice-deletion-inversion", {
      sliceNumber: slice.number,
      sliceTitle: slice.title,
      offending: check.offending,
    });
  } catch { /* non-fatal */ }
}

/**
 * Issue #230 — fail a slice whose entire commit landed outside its declared
 * file scope. The Phase-93 false-green run committed only out-of-scope
 * `.github/instructions/*.md` docs while every promised in-scope feature file
 * was missing, yet 14/14 slices reported PASSED. When a slice declares a
 * non-empty scope and NONE of the changed paths match it, the worker did not
 * build what it was told to. Marking the slice failed lets the retry/rollback
 * machinery recover instead of pushing a doc-only no-op as a feature build.
 */
function _executeSliceScopeEscapeCheck({ sliceResult, slice, cwd, sliceStartHead, eventBus }) {
  if (sliceResult.status !== "passed") return;
  try {
    const check = verifySliceScope({ slice, cwd, startSha: sliceStartHead });
    if (!check.applicable || !check.escaped) return;
    const paths = check.offending.slice(0, 10).join(", ");
    sliceResult.status = "failed";
    sliceResult.statusReason = `scope-escape: slice "${slice.title}" committed only out-of-scope files (${paths}); none match declared scope (${check.scope.join(", ")})`;
    sliceResult.scopeEscape = { offending: check.offending, scope: check.scope };
    eventBus?.emit("slice-scope-escape", {
      sliceNumber: slice.number,
      sliceTitle: slice.title,
      offending: check.offending,
      scope: check.scope,
    });
  } catch { /* non-fatal */ }
}

function _executeSliceStampCost(sliceResult) {
  try {
    const rec = calculateSliceCost(sliceResult.tokens, sliceResult.worker);
    sliceResult.cost_usd = rec.cost_usd;
    sliceResult.cost_breakdown = rec.cost_breakdown;
    return rec;
  } catch {
    return null;
  }
}

function _executeSlicePersistTrajectory({ sliceResult, workerResult, planName, slice, cwd, eventBus }) {
  if (sliceResult.status !== "passed" || !planName) return;
  try {
    const note = extractTrajectory(workerResult.output || "");
    if (!note) return;
    const path = writeTrajectory({
      cwd, planBasename: planName, sliceId: slice.number, content: note,
    });
    sliceResult.trajectoryPath = relative(cwd, path);
    if (eventBus) {
      eventBus.emit("trajectory-written", {
        sliceNumber: slice.number,
        path: sliceResult.trajectoryPath,
      });
    }
  } catch { /* non-fatal */ }
}

function _executeSliceSelfRepairAdvisory({ sliceResult, workerResult, cwd, slice, eventBus }) {
  if (sliceResult.status !== "passed") return;
  try {
    const trajectoryText = sliceResult.trajectoryPath
      ? readFileSync(resolve(cwd, sliceResult.trajectoryPath), "utf8")
      : null;
    const advisory = detectSelfRepairMissed(trajectoryText, workerResult?.output);
    if (!advisory) return;
    const advisoryEvent = {
      sliceId: slice.number,
      markers: advisory.matched,
      suggestion: "Consider calling forge_meta_bug_file to record this Plan Forge defect for future prevention.",
    };
    sliceResult.selfRepairAdvisory = advisoryEvent;
    if (eventBus) eventBus.emit("self-repair-missed", advisoryEvent);
  } catch { /* non-fatal */ }
}

function _executeSliceAutoSkillBookkeeping({ sliceResult, injectedAutoSkills, slice, planName, cwd, eventBus }) {
  if (sliceResult.status !== "passed") return;
  try {
    for (const injected of injectedAutoSkills) {
      if (injected && injected.sha256Prefix) {
        incrementAutoSkillReuse({ cwd, sha256Prefix: injected.sha256Prefix });
      }
    }
  } catch { /* non-fatal */ }
  try {
    const record = extractAutoSkill({ slice, planBasename: planName, cwd });
    if (!record) return;
    const path = writeAutoSkill({ cwd, record });
    sliceResult.autoSkillPath = relative(cwd, path);
    sliceResult.autoSkillPrefix = record.sha256Prefix;
    if (eventBus) {
      eventBus.emit("auto-skill-captured", {
        sliceNumber: slice.number,
        prefix: record.sha256Prefix,
        path: sliceResult.autoSkillPath,
      });
    }
  } catch { /* non-fatal */ }
}

function _executeSliceRecordModelPerf({ sliceResult, cwd, planName, slice, costRecord }) {
  try {
    const sliceCost = costRecord || calculateSliceCost(sliceResult.tokens, sliceResult.worker);
    recordModelPerformance(cwd, {
      date: new Date().toISOString(),
      plan: planName,
      sliceId: slice.number,
      sliceTitle: slice.title,
      sliceType: inferSliceType(slice),
      model: sliceResult.model || "unknown",
      status: sliceResult.status,
      attempts: sliceResult.attempts,
      duration_ms: sliceResult.duration,
      cost_usd: sliceCost.cost_usd,
    });
  } catch { /* non-fatal */ }
}

function _executeSliceRecordQuorumHistory({ sliceResult, slice, quorumConfig, useQuorum, complexityScore, cwd }) {
  if (!quorumConfig?.enabled) return;
  try {
    const initialFailed = sliceResult.attempts > 1;
    appendForgeJsonl("quorum-history.jsonl", {
      timestamp: new Date().toISOString(),
      sliceNumber: slice.number,
      sliceTitle: slice.title,
      complexityScore: complexityScore || null,
      quorumUsed: useQuorum,
      quorumNeeded: useQuorum && !initialFailed,
      status: sliceResult.status,
    }, cwd);
  } catch { /* non-fatal */ }
}

async function _executeSliceDispatchWorkerForAttempt({ mode, worker, slice, cwd, _dispatchSlice, _pollPullRequest, sliceInstructions, currentModel, networkAllowed, networkEnforce, runDir, eventBus }) {
  if (mode === "assisted") {
    return {
      workerResult: {
        output: "Assisted mode — human executes in VS Code",
        tokens: { tokens_in: null, tokens_out: null, model: "human" },
        exitCode: 0,
        worker: "human",
        model: "human",
      },
      copilotDispatchData: null,
    };
  }
  if (worker === "copilot-coding-agent") {
    const dispatched = await _executeSliceDispatchCopilot({ slice, cwd, _dispatchSlice, _pollPullRequest });
    return { workerResult: dispatched.workerResult, copilotDispatchData: dispatched.copilotDispatchData };
  }
  const { proxy, proxyEnv } = await _executeSliceStartProxy({ networkAllowed, networkEnforce, runDir, slice });
  try {
    const workerResult = await spawnWorker(sliceInstructions, {
      model: currentModel, cwd, runPlanActive: true,
      timeout: resolveWorkerTimeoutMs({ sliceOverride: slice.workerTimeoutMs }),
      eventBus, extraEnv: proxyEnv,
    });
    return { workerResult, copilotDispatchData: null };
  } finally {
    if (proxy) try { proxy.stop(); } catch { /* ignore */ }
  }
}

async function _executeSliceAttemptLoop(ctx) {
  const {
    slice, cwd, mode, runDir, maxRetries, worker,
    _dispatchSlice, _pollPullRequest, networkAllowed, networkEnforce,
    eventBus, useQuorum, quorumResult, memoryEnabled, projectName, planName,
    autoSkillContextBlock, teardownGuardConfig, escalationChain,
    startTime, sliceStartHead, finalizeSliceResult,
  } = ctx;
  let attempt = 0;
  let workerResult = null;
  let gateResult = { success: true, output: "No validation gate defined" };
  let lastError = null;
  let lastFailureContext = null;
  let currentModel = ctx.finalModel;
  let copilotDispatchData = null;

  while (attempt <= maxRetries) {
    const attemptStartTime = Date.now();
    currentModel = _executeSliceEscalateModel({ attempt, currentModel, escalationChain, slice, eventBus });
    const sliceInstructions = _executeSliceBuildInstructions({
      slice, useQuorum, quorumResult, memoryEnabled, projectName, planName,
      autoSkillContextBlock, teardownGuardConfig, lastFailureContext,
    });

    try {
      const dispatched = await _executeSliceDispatchWorkerForAttempt({
        mode, worker, slice, cwd, _dispatchSlice, _pollPullRequest,
        sliceInstructions, currentModel, networkAllowed, networkEnforce, runDir, eventBus,
      });
      workerResult = dispatched.workerResult;
      if (dispatched.copilotDispatchData) copilotDispatchData = dispatched.copilotDispatchData;
    } catch (err) {
      return { earlyReturn: finalizeSliceResult({
        status: "failed",
        duration: Date.now() - startTime,
        error: err.message,
        attempts: attempt + 1,
      }) };
    }

    const logFile = _executeSliceWriteLog({ runDir, slice, attempt, workerResult, startTime });
    gateResult = _executeSliceRunGates(slice, cwd);

    if (gateResult.success && workerResult.exitCode === 0) break;

    if (workerResult.timedOut) {
      if (_executeSliceHandleTimeoutCommit({ workerResult, sliceStartHead, cwd, slice, logFile, eventBus })) break;
      lastError = `Worker timed out after ${Math.round((Date.now() - startTime) / 1000)}s. The task may be too complex for a single slice — consider splitting it.`;
      lastFailureContext = {
        previousAttempt: attempt + 1,
        gateName: "(worker timed out before gate)",
        model: workerResult.model || currentModel || "auto",
        durationMs: Date.now() - attemptStartTime,
        stderrTail: [lastError, workerResult.stderr].filter(Boolean).join("\n\n"),
      };
      attempt++;
      if (attempt <= maxRetries) {
        writeFileSync(logFile, `\n\n--- WORKER TIMED OUT, RETRYING (attempt ${attempt + 1}) ---\n${lastError}\n`, { flag: "a" });
      }
      continue;
    }

    if (workerResult.exitCode !== 0) break;

    lastError = `Gate command '${gateResult.failedCommand || "unknown"}' failed:\n${gateResult.error || gateResult.output}`;
    lastFailureContext = {
      previousAttempt: attempt + 1,
      gateName: gateResult.failedCommand || "unknown",
      model: workerResult.model || currentModel || "auto",
      durationMs: Date.now() - attemptStartTime,
      stderrTail: [gateResult.error, gateResult.output, workerResult.stderr].filter(Boolean).join("\n\n"),
    };
    attempt++;
    if (attempt <= maxRetries) {
      writeFileSync(logFile, `\n\n--- GATE FAILED, RETRYING (attempt ${attempt + 1}) ---\n${lastError}\n`, { flag: "a" });
    }
  }

  return { workerResult, gateResult, attempt, currentModel, copilotDispatchData, lastError };
}

async function executeSlice(slice, options) {
  const { cwd, model, modelRouting = {}, mode, runDir, maxRetries = 1,
    memoryEnabled = false, projectName = "", planName = "",
    quorumConfig = null,
    escalationChain = ["auto", "claude-opus-4.7", "gpt-5.3-codex"],
    eventBus = null,
    worker = null,
    _dispatchSlice = _dispatchSliceDefault,
    _pollPullRequest = _pollPullRequestDefault,
    networkAllowed = null,
    networkEnforce = false,
    toolsDeny = null,
  } = options;
  void toolsDeny;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model, modelRouting, slice);

  const { sliceStartHead, snapshotStash } = _executeSliceCaptureBaseline({ cwd, slice });
  const finalizeSliceResult = (result) => attachSliceSnapshotRestore({
    sliceResult: result,
    snapshotStash,
    cwd,
    sliceNumber: slice.number,
    eventBus,
  });

  const { teardownBaseline, teardownGuardConfig } = _executeSliceCaptureTeardownBaseline({ cwd, slice });
  const finalModel = _executeSliceRouteAgent({ resolvedModel, cwd, slice, eventBus });

  const { quorumResult, useQuorum, complexityScore } = await _executeSliceSetupQuorum({
    slice, cwd, mode, quorumConfig, memoryEnabled, projectName, runDir,
  });

  let injectedAutoSkills = [];
  try {
    injectedAutoSkills = retrieveAutoSkills({ cwd, slice, limit: 3 }) || [];
  } catch {
    injectedAutoSkills = [];
  }
  const autoSkillContextBlock = buildAutoSkillContext(injectedAutoSkills);

  await _executeSliceFoundryQuotaPreflight({ finalModel, slice, runDir, eventBus });

  const loopResult = await _executeSliceAttemptLoop({
    slice, cwd, mode, runDir, maxRetries, worker,
    _dispatchSlice, _pollPullRequest, networkAllowed, networkEnforce,
    eventBus, useQuorum, quorumResult, memoryEnabled, projectName, planName,
    autoSkillContextBlock, teardownGuardConfig, escalationChain,
    startTime, sliceStartHead, finalizeSliceResult, finalModel,
  });
  if (loopResult.earlyReturn) return loopResult.earlyReturn;
  const { workerResult, gateResult, attempt, currentModel, copilotDispatchData } = loopResult;

  const teardownEarly = _executeSlicePostTeardownVerify({
    teardownBaseline, teardownGuardConfig, cwd, slice, planName, eventBus, finalizeSliceResult,
  });
  if (teardownEarly) return teardownEarly;

  const duration = Date.now() - startTime;
  const { status, statusReason, silentFailure, killedBySignal } = _executeSliceDetermineStatus({
    workerResult, mode, slice, gateResult,
  });

  const sliceResult = _executeSliceBuildResult({
    slice, status, statusReason, duration, workerResult, gateResult,
    silentFailure, killedBySignal, attempt, currentModel, finalModel,
    useQuorum, quorumResult, complexityScore, copilotDispatchData,
  });

  _executeSliceFilesModifiedCheck({ sliceResult, slice, cwd, sliceStartHead, eventBus });
  _executeSliceDeletionInversionCheck({ sliceResult, slice, cwd, sliceStartHead, eventBus });
  _executeSliceScopeEscapeCheck({ sliceResult, slice, cwd, sliceStartHead, eventBus });
  const costRecord = _executeSliceStampCost(sliceResult);

  writeFileSync(
    resolve(runDir, `slice-${slice.number}.json`),
    JSON.stringify(sliceResult, null, 2),
  );

  _executeSlicePersistTrajectory({ sliceResult, workerResult, planName, slice, cwd, eventBus });
  _executeSliceSelfRepairAdvisory({ sliceResult, workerResult, cwd, slice, eventBus });
  _executeSliceAutoSkillBookkeeping({ sliceResult, injectedAutoSkills, slice, planName, cwd, eventBus });
  _executeSliceRecordModelPerf({ sliceResult, cwd, planName, slice, costRecord });
  _executeSliceRecordQuorumHistory({ sliceResult, slice, quorumConfig, useQuorum, complexityScore, cwd });

  return finalizeSliceResult(sliceResult);
}


export function buildEstimate({ plan, model, cwd, quorumConfig = null, resumeFrom = null, worker = null }) {
  return _estimatePlan({ plan, model, cwd, quorumConfig, resumeFrom, worker });
}

/**
 * Run auto-sweep after all slices pass.
 * Calls pforge sweep and captures results.
 */
export function runAutoSweep(cwd) {
  const IS_WINDOWS = process.platform === "win32";
  const pforge = IS_WINDOWS
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1 sweep`
    : `bash pforge.sh sweep`;
  try {
    const output = execSync(pforge, { cwd, encoding: "utf-8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } });
    const markerCount = (output.match(/TODO|FIXME|HACK|stub|placeholder/gi) || []).length;
    return { ran: true, clean: markerCount === 0, markerCount, output: output.trim() };
  } catch (err) {
    if (err.code === "ENOBUFS" || err instanceof RangeError) {
      return { ran: false, clean: false, error: "ENOBUFS: sweep output exceeded 64MB buffer", markerCount: 0, output: "" };
    }
    return { ran: true, clean: false, error: (err.stderr || err.message || "").trim() };
  }
}

import { runAnalyze, parseAnalyzeScore } from "./run-plan/architecture-guardrails.mjs";
export { runAnalyze, parseAnalyzeScore };

/**
 * Run auto-analyze after all slices pass.
 * Calls pforge analyze and captures consistency score.
 *
 * Bug #189: `pforge analyze` exits non-zero (1) as a *warning signal* when the
 * consistency score falls below the configured threshold (default 60).
 * Previously the catch block discarded `err.stdout` and reported
 * `{ score: null, error: "Command failed" }`, hiding the actual score from
 * the run summary. Now we always parse the score from stdout regardless of
 * exit code, and only surface `error` when the score genuinely cannot be
 * recovered (timeout, missing wrapper, parser crash).
 */
function runAutoAnalyze(cwd, planPath) {
  const IS_WINDOWS = process.platform === "win32";
  // Issue #196: force PowerShell's host output encoding to UTF-8 BEFORE
  // invoking pforge.ps1, so box-drawing chars (╔═╗║) + ✓/⚠ glyphs survive
  // the execSync capture instead of collapsing to U+FFFD. Defense-in-depth
  // alongside the same fix in pforge.ps1 itself — protects callers that
  // checked out a pre-#196 wrapper script.
  const pforge = IS_WINDOWS
    ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & .\\pforge.ps1 analyze \\"${planPath}\\""`
    : `bash pforge.sh analyze "${planPath}"`;
  try {
    const output = execSync(pforge, { cwd, encoding: "utf-8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } });
    const score = parseAnalyzeScore(output);
    return { ran: true, score, output: output.trim() };
  } catch (err) {
    // execSync attaches stdout/stderr on the thrown error even when exit != 0.
    // Try to recover a score from stdout first — analyze exits 1 as a warning
    // when score < threshold but the score itself is still printed.
    const stdout = (err.stdout || "").toString();
    const stderr = (err.stderr || "").toString();
    const score = parseAnalyzeScore(stdout);
    if (score !== null) {
      // Below-threshold warning — keep the score, surface the full output, and
      // record exitCode for callers that want to gate on it.
      return {
        ran: true,
        score,
        output: stdout.trim(),
        exitCode: err.status ?? null,
        warning: `analyze exited ${err.status ?? "non-zero"} (score ${score} below threshold)`,
      };
    }
    // Genuine failure (timeout / parse crash / missing wrapper) — preserve
    // both stdout and stderr so the diagnostic trail isn't lost.
    return {
      ran: true,
      score: null,
      error: (stderr || err.message || "").trim(),
      stdout: stdout.trim() || undefined,
    };
  }
}

function buildSummary(plan, results, runMeta, extras = {}) {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  const totalTokensOut = results.reduce((sum, r) => {
    const t = r.tokens?.tokens_out;
    return sum + (typeof t === "number" ? t : 0);
  }, 0);

  const summary = {
    plan: runMeta.plan,
    // Issue #193 (v3.0.1) Defect C: expose `phase` (plan basename without .md)
    // as a top-level field so dashboards and aggregators don't have to re-parse
    // the absolute `plan` path. Example: "Phase-2-PROJECTS-CRUD-PLAN".
    phase: basename(runMeta.plan, ".md"),
    startTime: runMeta.startTime,
    endTime: new Date().toISOString(),
    mode: runMeta.mode,
    // Issue #182: persist quorum mode separately so cost reports and run
    // history can distinguish "auto" (single model) from "power"/"speed"
    // (quorum presets). `mode` continues to mean "auto" vs "assisted".
    quorumMode: runMeta.quorumMode ?? null,
    quorumPreset: runMeta.quorumPreset ?? null,
    model: runMeta.model,
    sliceCount: plan.slices.length,
    results: { passed, failed, skipped, total: results.length },
    totalDuration,
    totalTokensOut,
    status: failed > 0 ? "failed" : "completed",
    cost: buildCostBreakdown(results),
    sliceResults: results,
  };

  // Auto-sweep + auto-analyze results (Slice 6)
  if (extras.sweepResult) summary.sweep = extras.sweepResult;
  if (extras.analyzeResult) summary.analyze = extras.analyzeResult;

  // Build report line
  const parts = [`All slices: ${passed} passed, ${failed} failed`];
  if (summary.cost?.total_cost_usd > 0) {
    parts.push(`Cost: $${summary.cost.total_cost_usd}`);
  }
  if (extras.sweepResult?.ran) {
    parts.push(`Sweep: ${extras.sweepResult.clean ? "clean" : `${extras.sweepResult.markerCount || "?"} markers`}`);
  }
  if (extras.analyzeResult?.ran && extras.analyzeResult.score !== null) {
    parts.push(`Score: ${extras.analyzeResult.score}/100`);
  }
  summary.report = parts.join(". ") + ".";

  return summary;
}

function createRunDir(cwd, planPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planName = basename(planPath, ".md");
  const runDir = resolve(cwd, ".forge", "runs", `${timestamp}_${planName}`);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

import { selfTest as _selfTestImpl } from "./run-plan/self-test.mjs";
export function selfTest() { return _selfTestImpl({ runPlan, buildEstimate, loadModelRouting, resolveModel, loadCiConfig }); }


/**
 * Phase 53 S0 — Orchestrator surface snapshot contract.
 * Returns deterministic export + section-banner metadata for snapshot testing.
 * Pure function — no side effects, no I/O.
 */

// ─── Phase-53 S9: Full CLI dispatch for direct `node orchestrator.mjs` invocation ─

function _cliParseQuorumArgs(args) {
  let quorum = QUORUM_MODE_AUTO;
  let quorumPreset = null;
  const quorumArg = args.find((a) => a.startsWith("--quorum") || a === "--no-quorum");
  if (quorumArg) {
    if (quorumArg === "--quorum=auto") quorum = QUORUM_MODE_AUTO;
    else if (quorumArg === "--quorum=power") { quorum = true; quorumPreset = QUORUM_PRESET_POWER; }
    else if (quorumArg === "--quorum=speed") { quorum = true; quorumPreset = QUORUM_PRESET_SPEED; }
    else if (quorumArg === "--no-quorum" || quorumArg === "--quorum=false") quorum = false;
    else quorum = true;
  }
  return { quorum, quorumPreset };
}

function _cliParseRunOptions(args, getArg) {
  const resumeFrom = getArg("--resume-from") ? Number(getArg("--resume-from")) : null;
  const { quorum, quorumPreset } = _cliParseQuorumArgs(args);
  const onlySlicesRaw = getArg("--only-slices");
  let onlySlices = null;
  if (onlySlicesRaw) {
    onlySlices = parseOnlySlicesExpr(onlySlicesRaw);
  }
  if (resumeFrom !== null && onlySlices !== null && onlySlices.length > 0) {
    const err = new Error("--resume-from and --only-slices are mutually exclusive");
    err.exitCode = 1;
    throw err;
  }
  return {
    cwd: process.cwd(),
    mode: getArg("--mode") || "auto",
    model: getArg("--model") || null,
    worker: getArg("--worker") || null,
    resumeFrom,
    estimate: args.includes("--estimate"),
    dryRun: args.includes("--dry-run"),
    quorum,
    quorumThreshold: getArg("--quorum-threshold") ? Number(getArg("--quorum-threshold")) : null,
    quorumPreset,
    manualImport: args.includes("--manual-import"),
    manualImportSource: getArg("--manual-import-source") || "human",
    manualImportReason: getArg("--manual-import-reason") || null,
    strictGates: args.includes("--strict-gates"),
    onlySlices,
    noTempering: args.includes("--no-tempering"),
    allowRetrograde: args.includes("--allow-retrograde"),
  };
}

async function _cliCmdRun(args, getArg) {
  const planPath = getArg("--run");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --run <plan-path> [options]");
    process.exit(1);
  }
  let runOpts;
  try {
    runOpts = _cliParseRunOptions(args, getArg);
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
    process.exit(typeof err.exitCode === "number" ? err.exitCode : 1);
  }
  try {
    const result = await runPlan(planPath, runOpts);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
    process.exit(typeof err.exitCode === "number" ? err.exitCode : 1);
  }
}

async function _cliCmdAnalyze(args, getArg) {
  const target = getArg("--analyze");
  if (!target) {
    console.error("Usage: node orchestrator.mjs --analyze <plan-or-file> [--mode plan|file] [--models model1,model2,...]");
    process.exit(1);
  }
  const mode = getArg("--mode") || (target.match(/plan/i) ? "plan" : "file");
  const modelsArg = getArg("--models");
  const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;
  try {
    const result = await analyzeWithQuorum({ target, mode, models, cwd: process.cwd() });
    if (result.synthesis) {
      console.log("\n" + "═".repeat(60));
      console.log("  QUORUM ANALYSIS — SYNTHESIZED REPORT");
      console.log("═".repeat(60) + "\n");
      console.log(result.synthesis);
    }
    console.log("\n" + "─".repeat(40));
    console.log(`  Models: ${result.models.join(", ")}`);
    console.log(`  Duration: ${Math.round(result.totalDuration / 1000)}s`);
    console.log(`  Cost: $${result.totalCost.toFixed(2)}`);
    console.log("─".repeat(40));
    const reportDir = resolve(process.cwd(), ".forge", "analysis");
    mkdirSync(reportDir, { recursive: true });
    const reportFile = resolve(reportDir, `${basename(target, ".md")}-${Date.now()}.json`);
    writeFileSync(reportFile, JSON.stringify(result, null, 2));
    console.log(`\n  📄 Full report saved: ${reportFile}\n`);
    process.exitCode = 0;
  } catch (err) {
    console.error(`Analysis error: ${err.message}`);
    process.exit(1);
  }
}

async function _cliCmdDiagnose(args, getArg) {
  const target = getArg("--diagnose");
  if (!target) {
    console.error("Usage: node orchestrator.mjs --diagnose <file> [--models model1,model2,...]");
    process.exit(1);
  }
  const modelsArg = getArg("--models");
  const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;
  try {
    const result = await analyzeWithQuorum({ target, mode: "diagnose", models, cwd: process.cwd() });
    if (result.synthesis) {
      console.log("\n" + "═".repeat(60));
      console.log("  QUORUM DIAGNOSIS — BUG INVESTIGATION REPORT");
      console.log("═".repeat(60) + "\n");
      console.log(result.synthesis);
    }
    console.log("\n" + "─".repeat(40));
    console.log(`  Models: ${result.models.join(", ")}`);
    console.log(`  Duration: ${Math.round(result.totalDuration / 1000)}s`);
    console.log(`  Cost: $${result.totalCost.toFixed(2)}`);
    console.log("─".repeat(40));
    const reportDir = resolve(process.cwd(), ".forge", "analysis");
    mkdirSync(reportDir, { recursive: true });
    const reportFile = resolve(reportDir, `diagnose-${basename(target)}-${Date.now()}.json`);
    writeFileSync(reportFile, JSON.stringify(result, null, 2));
    console.log(`\n  📄 Full report saved: ${reportFile}\n`);
    process.exitCode = 0;
  } catch (err) {
    console.error(`Diagnosis error: ${err.message}`);
    process.exit(1);
  }
}

function _cliCmdParse(getArg) {
  const planPath = getArg("--parse");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --parse <plan-path>");
    process.exit(1);
  }
  console.log(JSON.stringify(parsePlan(planPath), null, 2));
}

export async function runOrchestratorCli(args = []) {
  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  if (args.includes("--test")) {
    await selfTest();
  } else if (args.includes("--parse")) {
    _cliCmdParse(getArg);
  } else if (args.includes("--run")) {
    await _cliCmdRun(args, getArg);
  } else if (args.includes("--analyze")) {
    await _cliCmdAnalyze(args, getArg);
  } else if (args.includes("--diagnose")) {
    await _cliCmdDiagnose(args, getArg);
  }
}
const ORCHESTRATOR_SURFACE_EXPORTS = [
  "API_ALLOWED_ROLES",
  "COST_ANOMALY_MULTIPLIER",
  "CRUCIBLE_STALL_CUTOFF_DAYS",
  "CompetitiveScheduler",
  "DEFAULT_GATE_TIMEOUT_MS",
  "DEFAULT_WORKER_OUTPUT_IDLE_MS",
  "DEFAULT_WORKER_TIMEOUT_MS",
  "EVENT_SOURCE",
  "GATE_ALLOWED_PREFIXES",
  "GATE_SUGGESTION_AUTO_INJECT_THRESHOLD",
  "POSTMORTEM_RETENTION_COUNT",
  "PROPOSED_FIX_DIR",
  "ParallelScheduler",
  "QUORUM_PRESETS",
  "REVIEW_RESOLUTIONS",
  "REVIEW_SEVERITIES",
  "REVIEW_SOURCES",
  "REVIEW_STATUSES",
  "SECURITY_RISK",
  "SECURITY_RISK_FOR_TYPE",
  "SUPPORTED_AGENTS",
  "SequentialScheduler",
  "TEMPERING_SCAN_STALE_DAYS",
  "UNIX_TOOLS",
  "__resetBashPathCache",
  "__resetChildShutdownGuard",
  "addReviewItem",
  "aggregateModelStats",
  "analyzeWithQuorum",
  "appendEvent",
  "appendForgeJsonl",
  "appendWatchHistory",
  "applyFixProposal",
  "assertWorkerBackendReady",
  "assessQuorumViability",
  "attachSliceSnapshotRestore",
  "auditOrphanForgeFiles",
  "autoCommitSliceIfDirty",
  "buildApiMessages",
  "buildCostBreakdown",
  "buildEstimate",
  "buildOrchestratorSurface",
  "buildPlanPostmortem",
  "buildRetryPrompt",
  "buildWatchSnapshot",
  "calculateSliceCost",
  "captureAbsorbedCommits",
  "classifyLegError",
  "classifyProbeFailure",
  "classifySliceDomain",
  "cleanupStaleSnapshots",
  "coalesceGateLines",
  "compareSliceIds",
  "compareVersions",
  "computeLockHash",
  "computeMedian",
  "defaultRunGitApply",
  "deriveVendorFromModel",
  "describeBillingSurface",
  "detectApiProvider",
  "detectClientHost",
  "detectCostAnomaly",
  "detectExecutionRuntime",
  "detectHelpTextOutput",
  "detectKilledBySignal",
  "detectPackageManager",
  "detectRuntimes",
  "detectSelfRepairMissed",
  "detectSilentWorkerFailure",
  "detectVersionCollision",
  "detectWatchAnomalies",
  "detectWorkers",
  "editDistance",
  "emitToolTelemetry",
  "ensureForgeDir",
  "ensureNotificationsConfig",
  "ensureNotificationsDirs",
  "ensureReviewQueueDirs",
  "extractFilesModifiedExhaustive",
  "extractPlanReleaseVersion",
  "extractTokens",
  "filterQuorumModels",
  "findLatestRun",
  "findMatchingFixProposal",
  "formatGateSuggestions",
  "formatQuorumSummary",
  "generateImage",
  "generateReviewItemId",
  "getCostReport",
  "getFoundryAuthScope",
  "getHealthTrend",
  "getRoutingPreference",
  "inferSliceType",
  "installChildCleanupHandlers",
  "isApiOnlyModel",
  "isCopilotServableModel",
  "isDeployTrigger",
  "isDestructiveSliceTitle",
  "isDirectApiOnlyModel",
  "isGateCommandAllowed",
  "isPlaceholderToken",
  "isWorktreeExemptPath",
  "killTrackedChildren",
  "lintGateCommands",
  "listPlanPostmortems",
  "listReviewItems",
  "loadAuditConfig",
  "loadCompetitiveConfig",
  "loadGateCheckConfig",
  "loadGateSynthesisConfig",
  "loadModelPerformance",
  "loadOpenClawConfig",
  "loadQuorumConfig",
  "loadRoutingPreference",
  "loadTeardownGuardConfig",
  "loadWorkerCapabilities",
  "looksLikeProse",
  "markFixAttempted",
  "maybeAddBugReview",
  "maybeAddFixPlanReview",
  "maybeAddStallReview",
  "maybeAddTemperingReview",
  "maybeAddVisualBaselineReview",
  "normalizeRunState",
  "normalizeSliceId",
  "parseAnalyzeScore",
  "parseEventLine",
  "parseEventsLog",
  "parseGitPorcelain",
  "parseOnlySlicesExpr",
  "parsePlan",
  "parseShortstat",
  "parseStderrStats",
  "parseValidationGates",
  "parseWorkerTimeoutValue",
  "popSliceSnapshot",
  "postOpenClawSnapshot",
  "probeQuorumModelAvailability",
  "pruneForgeRuns",
  "pushSliceSnapshot",
  "quorumDispatch",
  "quorumReview",
  "readCrucibleState",
  "readForgeJson",
  "readForgeJsonl",
  "readHomeSnapshot",
  "readReviewItem",
  "readReviewQueueState",
  "readSliceArtifacts",
  "readTemperingConfig",
  "readTemperingState",
  "recommendFromAnomalies",
  "recommendModel",
  "recordModelPerformance",
  "registerCorrelationThreadResponder",
  "registerGateCheckResponder",
  "regressionGuard",
  "rerankEscalationChain",
  "resetCliWorkersCache",
  "resetPostSliceHookFired",
  "resetPostSliceTemperingFired",
  "resolveBashPath",
  "resolveGateTimeoutMs",
  "resolveRequiredCli",
  "resolveReviewItem",
  "resolveWorkerOutputIdleMs",
  "resolveWorkerTimeoutMs",
  "rollbackFixProposal",
  "runAnalyze",
  "runAutoSweep",
  "runGate",
  "runPlan",
  "runPostRunAuditorHook",
  "runPostSliceHook",
  "runPostSliceTemperingHook",
  "runPreAgentHandoffHook",
  "runPreDeployHook",
  "runWatch",
  "runWatchLive",
  "scoreSliceComplexity",
  "selectWinner",
  "setGhCopilotProbe",
  "setSecretsLoader",
  "shouldAutoDrain",
  "shouldAutoRetryFix",
  "shouldDefaultPremiumRequestsToOne",
  "snapshotPreSliceState",
  "spawnWorker",
  "stageOrphansOnSliceFailure",
  "suggestAllowedCommand",
  "suggestInstall",
  "synthesizeGateSuggestions",
  "validateGatePortability",
  "verifyBranchSafety",
  "verifyFilesModified",
  "writePlanPostmortem",
  "writeProposedFixPatch",
  "writeSilentExitRecord",
];

const ORCHESTRATOR_SURFACE_SECTION_BANNERS = [
  "API Provider Registry",
  "API Provider Role Allowlist",
  "Architecture Guardrail Rules",
  "CLI Entry Point",
  "Centralized Constants",
  "Client Host Detection",
  "Cost History (Phase 2)",
  "Event Bus (C3: Dependency Injection)",
  "Execution Runtime Detection",
  "G2.3 — Run pruning",
  "G2.5 — Orphan file audit",
  "Health Trend Analysis",
  "Host-Aware Routing Preference (#104)",
  "Model Performance Tracking (Phase 3)",
  "OpenClaw Integration (v2.29)",
  "Operational Data Infrastructure",
  "Orchestrator",
  "Phase FORGE-SHOP-01 Slice 01.1 — Shop-floor home snapshot",
  "Phase FORGE-SHOP-02 Slice 02.1 — Review Queue Storage",
  "Phase FORGE-SHOP-02 Slice 02.2 — Review Queue Producer Hooks",
  "Phase FORGE-SHOP-06 Slice 06.2 — Correlation Thread Responder",
  "Phase FORGE-SHOP-06 Slice 06.2 — Gate Check Configuration",
  "Phase FORGE-SHOP-06 Slice 06.2 — Gate Check Responder",
  "Phase-25 Slice 4: Adaptive gate synthesis (L6)",
  "Phase-25 Slice 5: Plan postmortem (L5 closed research loop)",
  "Phase-26 Slice 10: Cost-anomaly detector + escalation re-ranking",
  "Phase-26 Slice 9: Incident → fix-proposal auto-retry (C5)",
  "Phase-28.3 Slice 4: Post-slice advisory scanner",
  "Plan Parser",
  "PostRun Auditor Hook (Phase-39 Slice 1 + Slice 2)",
  "PostSlice Hook",
  "PostSlice Tempering Hook (TEMPER-02 Slice 02.2)",
  "PreAgentHandoff Hook",
  "PreDeploy Hook",
  "Pricing + Cost Estimation",
  "Quorum Analysis",
  "Quorum Mode (Phase 7 — v2.5)",
  "Quorum Model Availability Probing (H.3)",
  "Schedulers (C2: Pluggable)",
  "Self-Test",
  "Watcher (v2.34)",
  "Windows bash dispatch",
  "Worker Spawning",
];

export function buildOrchestratorSurface() {
  return {
    exports: ORCHESTRATOR_SURFACE_EXPORTS,
    sectionBanners: ORCHESTRATOR_SURFACE_SECTION_BANNERS,
  };
}
