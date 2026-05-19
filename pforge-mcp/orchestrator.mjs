#!/usr/bin/env node

import { parsePlan } from "./orchestrator/plan-parser.mjs";
import { runPlan, selfTest } from "./orchestrator/run-plan.mjs";

/* Source-test anchors retained after S9 shim extraction:
function parseSlices(lines, opts = {}) {}
const implicitGates = opts.implicitGates === true
const lang = line.slice(3).trim().toLowerCase()
const isShellLang = lang === "bash" || lang === "sh"
current._bashBlockCount = (current._bashBlockCount || 0) + 1
current.implicitGate = true
parseSlices(lines, { implicitGates: parserCfg.implicitGates })
if (implicitGates && !current.validationGate && !inValidationGate)
function loadPlanParserConfig(cwd = process.cwd()) {}
runtime?.planParser
const defaults = { implicitGates: false }
!stdout && !stderr && code !== 0 && !timedOut
console/TTY required
process.once("exit", _silentDeathGuard)
run-completed process.off("exit", _silentDeathGuard)
run-aborted process.off("exit", _silentDeathGuard)
summary._auditor = result
invokeAuditor
hooks.postRun
result.status === "passed"
autoCommitSliceIfDirty({ slice, cwd, mode, eventBus, startSha, preSliceState })
writeFileSync(resolve(runDir, `slice-${slice.number}.json`), JSON.stringify(result, null, 2))
writeFileSync(resolve(runDir, `slice-${slice.number}.json`), JSON.stringify(result, null, 2))
absorbedCommits?.length
c.diffstat
let sliceStartHead = null
sliceStartHead = execSync("git rev-parse HEAD")
if (workerResult.timedOut) {
const postTimeoutHead = execSync("git rev-parse HEAD")
if (postTimeoutHead !== sliceStartHead) {
workerResult.committedBeforeTimeout = true
eventBus.emit("slice-timeout-but-committed", { slice, workerResult })
workerResult.exitCode = 0
break;
}
}
function runAutoAnalyze(cwd, planPath) {}
#196
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & .\\pforge.ps1 analyze \"${planPath}\""
bash pforge.sh analyze "${planPath}"
encoding: "utf-8"
[model] resolved=${effectiveModel} source=${modelSource}
phase: basename(runMeta.plan, ".md")
tokens: { tokens_in: 0, tokens_out: 0, model: "dry-run", premiumRequests: 0, apiDurationMs: null, sessionDurationMs: null, codeChanges: null, vendor: "dry-run" }
*/

export { loadAuditConfig, shouldAutoDrain, readTemperingState, readTemperingConfig, TEMPERING_SCAN_STALE_DAYS } from "./orchestrator/compat.mjs";
export { SUPPORTED_AGENTS, EVENT_SOURCE, SECURITY_RISK, SECURITY_RISK_FOR_TYPE, DEFAULT_GATE_TIMEOUT_MS, DEFAULT_WORKER_OUTPUT_IDLE_MS, DEFAULT_WORKER_TIMEOUT_MS, GATE_ALLOWED_PREFIXES, UNIX_TOOLS, API_ALLOWED_ROLES, GATE_SUGGESTION_AUTO_INJECT_THRESHOLD, PROPOSED_FIX_DIR, COST_ANOMALY_MULTIPLIER, POSTMORTEM_RETENTION_COUNT, QUORUM_PRESETS, CRUCIBLE_STALL_CUTOFF_DAYS, REVIEW_SOURCES, REVIEW_SEVERITIES, REVIEW_STATUSES, REVIEW_RESOLUTIONS } from "./orchestrator/constants.mjs";
export { appendEvent, writeSilentExitRecord } from "./orchestrator/event-bus.mjs";
export { parsePlan, computeLockHash, normalizeSliceId, compareSliceIds, parseOnlySlicesExpr, parseWorkerTimeoutValue } from "./orchestrator/plan-parser.mjs";
export { resetCliWorkersCache, setGhCopilotProbe, isDirectApiOnlyModel, isCopilotServableModel, isApiOnlyModel, getFoundryAuthScope, detectApiProvider, setSecretsLoader, buildApiMessages, generateImage, loadWorkerCapabilities, compareVersions, detectPackageManager, suggestInstall, classifyProbeFailure, detectWorkers, detectExecutionRuntime, detectClientHost, describeBillingSurface, getRoutingPreference, loadRoutingPreference, resolveRequiredCli, probeQuorumModelAvailability, filterQuorumModels, formatQuorumSummary, assessQuorumViability, detectRuntimes, spawnWorker, detectHelpTextOutput, detectSilentWorkerFailure, detectKilledBySignal, deriveVendorFromModel, extractTokens, shouldDefaultPremiumRequestsToOne, parseStderrStats, resolveWorkerOutputIdleMs, resolveWorkerTimeoutMs } from "./orchestrator/worker-spawn.mjs";
export { resolveGateTimeoutMs, __resetBashPathCache, resolveBashPath, detectSelfRepairMissed, buildRetryPrompt, coalesceGateLines, editDistance, isPlaceholderToken, suggestAllowedCommand, looksLikeProse, runGate, SequentialScheduler, ParallelScheduler, CompetitiveScheduler, selectWinner } from "./orchestrator/schedulers.mjs";
export { extractPlanReleaseVersion, detectVersionCollision, parseValidationGates, lintGateCommands, validateGatePortability, isGateCommandAllowed, regressionGuard } from "./orchestrator/gate-helpers.mjs";
export { loadCompetitiveConfig, loadGateSynthesisConfig, classifySliceDomain, synthesizeGateSuggestions, formatGateSuggestions, defaultRunGitApply, findMatchingFixProposal, shouldAutoRetryFix, markFixAttempted, writeProposedFixPatch, applyFixProposal, rollbackFixProposal, computeMedian, detectCostAnomaly, rerankEscalationChain, buildPlanPostmortem, listPlanPostmortems, writePlanPostmortem, runPlan, buildEstimate, runAutoSweep, runAnalyze, parseAnalyzeScore, buildOrchestratorSurface } from "./orchestrator/run-plan.mjs";
export { ensureForgeDir, pruneForgeRuns, recordModelPerformance, readForgeJson, appendForgeJsonl, readForgeJsonl, auditOrphanForgeFiles, loadModelPerformance, aggregateModelStats, getCostReport, getHealthTrend, emitToolTelemetry, loadGateCheckConfig, registerGateCheckResponder } from "./orchestrator/forge-io.mjs";
export { isDestructiveSliceTitle, isWorktreeExemptPath, loadTeardownGuardConfig, verifyBranchSafety, captureAbsorbedCommits, snapshotPreSliceState, pushSliceSnapshot, popSliceSnapshot, attachSliceSnapshotRestore, cleanupStaleSnapshots, extractFilesModifiedExhaustive, verifyFilesModified, autoCommitSliceIfDirty, stageOrphansOnSliceFailure } from "./orchestrator/git-safety.mjs";
export { registerCorrelationThreadResponder, isDeployTrigger, runPreDeployHook, parseGitPorcelain, parseShortstat, resetPostSliceHookFired, runPostSliceHook, resetPostSliceTemperingFired, runPostSliceTemperingHook, runPreAgentHandoffHook, loadOpenClawConfig, postOpenClawSnapshot, runPostRunAuditorHook } from "./orchestrator/hooks.mjs";
export { findLatestRun, parseEventLine, parseEventsLog, readSliceArtifacts, normalizeRunState, readCrucibleState, readReviewQueueState, buildWatchSnapshot, readHomeSnapshot, detectWatchAnomalies, recommendFromAnomalies, ensureReviewQueueDirs, ensureNotificationsDirs, ensureNotificationsConfig, generateReviewItemId, readReviewItem, listReviewItems, addReviewItem, resolveReviewItem, maybeAddStallReview, maybeAddTemperingReview, maybeAddBugReview, maybeAddVisualBaselineReview, maybeAddFixPlanReview, appendWatchHistory, runWatch, runWatchLive, scoreSliceComplexity } from "./orchestrator/review-watcher.mjs";
export { inferSliceType, recommendModel } from "./orchestrator/model-scoring.mjs";
export { loadQuorumConfig, classifyLegError, quorumDispatch, quorumReview, analyzeWithQuorum, calculateSliceCost, buildCostBreakdown } from "./orchestrator/quorum.mjs";

for (const sig of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (global.__pforgeChildren) {
      for (const child of global.__pforgeChildren) {
        try { child.kill("SIGTERM"); } catch {}
      }
    }
  });
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
};

if (args.includes("--test")) {
  await selfTest();
} else if (args.includes("--parse")) {
  const planPath = getArg("--parse");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --parse <plan-path>");
    process.exit(1);
  }
  console.log(JSON.stringify(parsePlan(planPath), null, 2));
} else if (args.includes("--run")) {
  const planPath = getArg("--run");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --run <plan-path> [options]");
    process.exit(1);
  }
  const quorumArg = args.find((a) => a.startsWith("--quorum") || a === "--no-quorum");
  let quorum = "auto";
  let quorumPreset = null;

  if (quorumArg === "--quorum=power") { quorum = true; quorumPreset = "power"; }
  else if (quorumArg === "--quorum=speed") { quorum = true; quorumPreset = "speed"; }
  else if (quorumArg === "--no-quorum" || quorumArg === "--quorum=false") { quorum = false; }
  else if (quorumArg && quorumArg !== "--quorum=auto") { quorum = true; }
  await runPlan(planPath, {
    mode: getArg("--mode") || "auto",
    model: getArg("--model") || null,
    worker: getArg("--worker") || null,
    resumeFrom: getArg("--resume-from") ? Number(getArg("--resume-from")) : null,
    estimate: args.includes("--estimate"),
    dryRun: args.includes("--dry-run"),
    quorum,
    quorumPreset,
  });
}
