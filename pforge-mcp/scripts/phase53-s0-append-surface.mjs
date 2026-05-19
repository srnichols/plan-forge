/**
 * Append buildOrchestratorSurface() to orchestrator.mjs (Phase 53 S0).
 * Run once with: node pforge-mcp/scripts/phase53-s0-append-surface.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const orchPath = resolve(ROOT, "orchestrator.mjs");

const src = readFileSync(orchPath, "utf-8");

// Verify it doesn't already have buildOrchestratorSurface
if (src.includes("buildOrchestratorSurface")) {
  console.log("buildOrchestratorSurface already present — skipping");
  process.exit(0);
}

// The surface function body to insert before the self-test comment
const insertion = `
// ─── Phase 53 — Snapshot-as-contract surface (pure, no side-effects) ─────────

/**
 * Returns the sorted list of all exported symbol names from this module.
 * Used by \`tests/orchestrator-surface-snapshot.test.mjs\` to verify that
 * the Phase 53 (ORCHESTRATOR-SPLIT) extraction slices don't add or remove
 * any public exports (zero-behavior-change contract).
 *
 * NOTE: This list is static — update it (and regenerate the golden fixture) if
 * you intentionally add or remove a public export.
 */
export function buildOrchestratorSurface() {
  return {
    exports: [
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
      "addReviewItem",
      "aggregateModelStats",
      "analyzeWithQuorum",
      "appendEvent",
      "appendForgeJsonl",
      "appendWatchHistory",
      "applyFixProposal",
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
      "isApiOnlyModel",
      "isCopilotServableModel",
      "isDeployTrigger",
      "isDestructiveSliceTitle",
      "isDirectApiOnlyModel",
      "isGateCommandAllowed",
      "isPlaceholderToken",
      "isWorktreeExemptPath",
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
    ],
  };
}

`;

const marker = "// ─── Self-Test ────────────────────────────────────────────────────────";
const idx = src.indexOf(marker);
if (idx === -1) {
  console.error("Could not find self-test marker in orchestrator.mjs");
  process.exit(1);
}

const newSrc = src.slice(0, idx) + insertion + src.slice(idx);
writeFileSync(orchPath, newSrc);
console.log(`Inserted buildOrchestratorSurface() at index ${idx} in orchestrator.mjs`);
console.log(`New file size: ${newSrc.split("\n").length} lines`);
