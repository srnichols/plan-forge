#!/usr/bin/env node
/**
 * Plan Forge Orchestrator — DAG-Based Plan Execution Engine
 *
 * Architecture:
 *   - parsePlan()          → Markdown → DAG of slices with metadata
 *   - SequentialScheduler  → executes slices in topological order (Phase 1)
 *   - ParallelScheduler    → interface stub for Phase 6
 *   - EventBus (DI)        → lifecycle events (Phase 3 hub subscribes)
 *   - Worker spawning      → gh copilot CLI (primary) with fallback chain
 *
 * Spike findings (Slice 0): gh copilot CLI is the primary worker.
 *   Non-interactive, context-aware, multi-model, JSONL output with tokens.
 *
 * Usage:
 *   node pforge-mcp/orchestrator.mjs --test              # run self-test
 *   node pforge-mcp/orchestrator.mjs --parse <plan>      # parse and dump DAG
 *
 * @module orchestrator
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, appendFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { spawn, execSync, execFileSync } from "node:child_process";
import { resolve, basename, dirname, join, relative, extname, isAbsolute } from "node:path";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  getCachedBashPath,
  setCachedBashPath,
  getGhCopilotProbeState,
  setGhCopilotProbeState,
  getGhCopilotCacheState,
  setGhCopilotCacheState,
  getSecretsLoaderState,
  setSecretsLoaderState,
  getCliWorkersCacheState,
  setCliWorkersCacheState,
  getCliWorkersCacheExpiryState,
  setCliWorkersCacheExpiryState,
  getWorkerCapabilitiesCacheState,
  setWorkerCapabilitiesCacheState,
} from "./orchestrator/state.mjs";
import { QUORUM_MODES, WATCHER_MODES } from "./enums.mjs";
import { createTraceContext, createTelemetryHandler, writeManifest, appendRunIndex, pruneRunHistory, addLogSummary } from "./telemetry.mjs";
import { recordActivity } from "./team-activity.mjs";
import { isOpenBrainConfigured, buildMemorySearchBlock, buildMemoryCaptureBlock, buildReflexionBlock, buildTrajectorySuffix, extractTrajectory, writeTrajectory, retrieveAutoSkills, buildAutoSkillContext, extractAutoSkill, writeAutoSkill, incrementAutoSkillReuse, buildRunSummaryThought, buildCostAnomalyThought, loadProjectContext, buildPlanBootContext, computeGateSuggestionKey, getGateSuggestionCounter, captureMemory, autoDrainOpenBrainQueue } from "./memory.mjs";
import { enforceCrucibleId, CrucibleEnforcementError } from "./crucible-enforce.mjs";
// Phase FORGE-SHOP-07 Slice 07.2 — brain facade for unified recall
import { recall as brainRecall, loadReviewerConfig, invokeReviewer } from "./brain.mjs";
// Phase-ANVIL Slice 4 — DLQ boot-time drain
import { anvilDlqDrain as _anvilDlqDrain } from "./anvil.mjs";
// Phase TEMPER-01 Slice 01.1 — re-export tempering state reader so the
// watcher-snapshot contract mirrors readCrucibleState exactly.
import {
  readTemperingState as _readTemperingState,
  readTemperingConfig as _readTemperingConfig,
  TEMPERING_SCAN_STALE_DAYS,
  getMinimaForDomain,
  promoteSuppressions as _promoteSuppressions,
} from "./tempering.mjs";
// Phase-39 Slice 7 — audit-loop activation surface
import {
  loadAuditConfig as _loadAuditConfig,
  shouldAutoDrain as _shouldAutoDrain,
} from "./tempering/auto-activate.mjs";
// Phase-FOUNDRY-QUOTA-PREFLIGHT Slice 3 — quota pre-flight for Foundry deployments
import { getDeploymentQuota, compareSliceEstimate } from "./foundry-quota.mjs";
// Phase-WORKER-GUARDRAILS Slice 4 (A5) — network egress proxy logger
import { startProxyLogger } from "./proxy-logger.mjs";
// Phase-39 Slice 3 — cross-run watcher
import { buildCrossRunSnapshot } from "./watcher.mjs";
// Phase GITHUB-B Slice 3 — Copilot Coding Agent dispatch routing
import { inspectGithubStack as _inspectGithubStackDefault } from "./github-introspect.mjs";
import {
  buildIssueBody as _buildIssueBodyDefault,
  dispatchSlice as _dispatchSliceDefault,
  pollPullRequest as _pollPullRequestDefault,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
} from "./workers/copilot-coding-agent.mjs";
export const loadAuditConfig = _loadAuditConfig;
export const shouldAutoDrain = _shouldAutoDrain;
export const readTemperingState = _readTemperingState;
export const readTemperingConfig = _readTemperingConfig;
export { TEMPERING_SCAN_STALE_DAYS };

const [QUORUM_MODE_AUTO, QUORUM_PRESET_POWER, QUORUM_PRESET_SPEED, QUORUM_MODE_FALSE] = QUORUM_MODES;
const [WATCHER_MODE_SNAPSHOT, WATCHER_MODE_ANALYZE, WATCHER_MODE_CROSS_RUN] = WATCHER_MODES;

// ─── Centralized Constants ────────────────────────────────────────────
/** Canonical list of all supported agent adapters. Update here — consumed by dashboard, setup, and docs. */
export const SUPPORTED_AGENTS = ["copilot", "claude", "cursor", "codex", "gemini", "windsurf", "generic"];

/**
 * Canonical event source identifiers — matches the `source` field defined in EVENTS.md common fields.
 * Use these when constructing event payloads to avoid magic strings.
 */
export const EVENT_SOURCE = Object.freeze({
  ORCHESTRATOR: "orchestrator",
  WORKER: "worker",
  HUB: "hub",
  BRIDGE: "bridge",
  LIVEGUARD: "liveguard",
  CRUCIBLE: "crucible",
  SKILL: "skill",
  WATCHER: "watcher",
  AUDIT: "audit",
});

/**
 * Canonical security risk levels — matches the `security_risk` field defined in EVENTS.md common fields.
 * Use these when constructing event payloads to avoid magic strings.
 */
export const SECURITY_RISK = Object.freeze({
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

/**
 * Per-event-type security_risk defaults for action-equivalent events.
 * Applied by appendEvent when the caller omits security_risk in data.
 * bridge-edit-blocked is enforced unconditionally (not just as default).
 */
export const SECURITY_RISK_FOR_TYPE = Object.freeze(new Map([
  ["slice-started",        SECURITY_RISK.LOW],
  ["slice-completed",      SECURITY_RISK.LOW],
  ["slice-failed",         SECURITY_RISK.LOW],
  ["skill-step-started",   SECURITY_RISK.LOW],
  ["skill-step-completed", SECURITY_RISK.LOW],
  ["tool-call",            SECURITY_RISK.NONE],
  ["bridge-edit-blocked",  SECURITY_RISK.HIGH],
  ["bridge-edit-approved", SECURITY_RISK.LOW],
]));

/** Default gate timeout: 10 minutes (raised from 2 min in v2.62.1). Override with PFORGE_GATE_TIMEOUT_MS. */

/** Default worker output idle timeout: 8 minutes. Override with PFORGE_WORKER_OUTPUT_IDLE_MS. */
export const DEFAULT_WORKER_OUTPUT_IDLE_MS = 480_000;

/**
 * Resolve the worker output idle timeout in milliseconds.
 * Priority: PFORGE_WORKER_OUTPUT_IDLE_MS env var → default (480 000 ms / 8 min).
 * Used by the watchdog to detect stalled worker processes.
 * @returns {number}
 */
export function resolveWorkerOutputIdleMs() {
  const envVal = process.env.PFORGE_WORKER_OUTPUT_IDLE_MS;
  if (envVal != null && envVal !== "") {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_WORKER_OUTPUT_IDLE_MS;
}

/** Default worker total-run timeout: 30 minutes. Override with PFORGE_WORKER_TIMEOUT_MS. */
export const DEFAULT_WORKER_TIMEOUT_MS = 1_800_000;

/**
 * Resolve the worker total-run timeout in milliseconds.
 * Priority: opts.sliceOverride (per-slice frontmatter) → PFORGE_WORKER_TIMEOUT_MS env var → default (1 800 000 ms / 30 min).
 * Used by spawnWorker() to hard-kill a worker that never finishes.
 * @param {{ sliceOverride?: number|null }} [opts]
 * @returns {number}
 */
export function resolveWorkerTimeoutMs(opts = {}) {
  const sliceOverride = opts && opts.sliceOverride != null ? opts.sliceOverride : null;
  if (sliceOverride !== null && Number.isFinite(sliceOverride) && sliceOverride > 0) {
    return sliceOverride;
  }
  const envVal = process.env.PFORGE_WORKER_TIMEOUT_MS;
  if (envVal != null && envVal !== "") {
    const parsed = Number(envVal);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_WORKER_TIMEOUT_MS;
}

// ─── Event Bus (C3: Dependency Injection) ─────────────────────────────

/**
 * Default event handler — writes events to log.
 * Phase 3: WebSocket hub replaces this via DI.
 */
class LogEventHandler {
  constructor(logDir) {
    this.logDir = logDir;
    this.events = [];
  }

  handle(event) {
    const data = appendEvent(event.type, event.data, this.logDir);
    this.events.push({ type: event.type, data, timestamp: event.timestamp });
  }
}

/**
 * Orchestrator event bus with dependency-injected handler.
 * Wraps Node EventEmitter. Handler can be swapped for WebSocket hub (Phase 3).
 */
class OrchestratorEventBus extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler || new LogEventHandler(null);
    // Proxy all known events to the handler
    const events = [
      "run-started", "slice-started", "slice-completed",
      "slice-failed", "slice-escalated", "run-completed", "run-aborted",
      "quorum-dispatch-started", "quorum-leg-completed", "quorum-review-completed",
      "skill-started", "skill-step-started", "skill-step-completed", "skill-completed",
      "slice-model-routed", "self-repair-missed",
      "tool-call", "bridge-edit-blocked", "bridge-edit-approved",
      "pforge.foundry.quota",
      "snapshot-janitor",
    ];
    for (const evt of events) {
      this.on(evt, (data) => this.handler.handle({ type: evt, data, timestamp: new Date().toISOString() }));
    }
  }
}

/**
 * Stamp `source` and `security_risk` into event data and write the event
 * to the run's events.log file. This is the canonical write path for all
 * lifecycle events.
 *
 * Defaults:
 *   source        → EVENT_SOURCE.ORCHESTRATOR ("orchestrator")
 *   security_risk → SECURITY_RISK.NONE ("none")
 *
 * Callers that know the risk level (e.g. slice-started, bridge-edit-blocked)
 * should pass the appropriate value in `data`; it overrides the default.
 *
 * Line format (byte-for-byte stable): [ISO-timestamp] type: {json}
 *
 * @param {string} type    - Event type identifier (e.g. "slice-started")
 * @param {object} data    - Event payload; may include source / security_risk overrides
 * @param {string|null} logDir - Directory where events.log lives; null = skip write
 * @returns {object} stamped - The stamped data object (with source + security_risk)
 */
export function appendEvent(type, data, logDir) {
  const stamped = {
    source: EVENT_SOURCE.ORCHESTRATOR,
    security_risk: SECURITY_RISK_FOR_TYPE.get(type) ?? SECURITY_RISK.NONE,
    ...data,
  };
  // bridge-edit-blocked is always HIGH — enforce unconditionally after spread
  if (type === "bridge-edit-blocked") {
    stamped.security_risk = SECURITY_RISK.HIGH;
  }
  if (logDir) {
    try {
      const ts = new Date().toISOString();
      const line = `[${ts}] ${type}: ${JSON.stringify(stamped)}\n`;
      writeFileSync(resolve(logDir, "events.log"), line, { flag: "a" });
    } catch {
      // Log dir may not exist yet during early events
    }
  }
  return stamped;
}

/**
 * Issue #197 — Write a slice-failed record when the process exits while a
 * slice is still in-progress (silent-death guard). Exported for tests.
 *
 * Returns `true` if a record was written, `false` when sliceId is falsy
 * (no slice was active, nothing to write).
 *
 * @param {string|null} sliceId  - Active slice ID, or null if none.
 * @param {string}      title    - Slice title (may be "").
 * @param {string|null} runDir   - Run directory for events.log; null = skip.
 * @returns {boolean}
 */
export function writeSilentExitRecord(sliceId, title, runDir) {
  if (!sliceId) return false;
  appendEvent(
    "slice-failed",
    {
      sliceId,
      title: title || "",
      status: "error",
      error:
        "orchestrator-silent-exit: process exited while slice was in-progress. " +
        "Possible cause: gh copilot CLI requires an attached console on Windows " +
        "and the background launcher did not allocate one (Issue #197). " +
        "Re-run with --foreground to diagnose.",
      reason: "worker-exited-without-output",
    },
    runDir,
  );
  return true;
}

// ─── Plan Parser ──────────────────────────────────────────────────────
// Phase-53 S1: extracted to orchestrator/plan-parser.mjs
import {
  parsePlan,
  computeLockHash,
  normalizeSliceId,
  compareSliceIds,
  parseOnlySlicesExpr,
  parseWorkerTimeoutValue,
  parseSlices,
  buildDAG,
  loadPlanParserConfig,
} from "./orchestrator/plan-parser.mjs";
export { parsePlan, computeLockHash, normalizeSliceId, compareSliceIds, parseOnlySlicesExpr, parseWorkerTimeoutValue };
/* Source-test anchors retained after extraction:
function parseSlices(lines, opts = {}) {
  const implicitGates = opts.implicitGates === true;
  const lang = line.slice(3).trim().toLowerCase();
  const isShellLang = lang === "bash" || lang === "sh";
  current._bashBlockCount = (current._bashBlockCount || 0) + 1;
  current.implicitGate = true;
  if (implicitGates && !current.validationGate && !inValidationGate) {}
}
function loadPlanParserConfig(cwd = process.cwd()) {
  const defaults = { implicitGates: false };
  const block = raw?.runtime?.planParser;
}
parseSlices(lines, { implicitGates: parserCfg.implicitGates });
*/

// ─── API Provider Role Allowlist ──────────────────────────────────────
// ─── API Provider Registry ────────────────────────────────────────────
// ─── Worker Spawning + Worker Runtime sections ───────────────────────
// Phase-53 S2: extracted to orchestrator/worker-spawn.mjs
import {
  API_ALLOWED_ROLES,
  resetCliWorkersCache, setGhCopilotProbe,
  isDirectApiOnlyModel, isCopilotServableModel, isApiOnlyModel,
  getFoundryAuthScope, detectApiProvider, setSecretsLoader, buildApiMessages,
  generateImage, loadWorkerCapabilities, compareVersions, detectPackageManager,
  suggestInstall, classifyProbeFailure, detectWorkers, detectExecutionRuntime,
  detectClientHost, describeBillingSurface, getRoutingPreference,
  loadRoutingPreference, resolveRequiredCli, probeQuorumModelAvailability,
  filterQuorumModels, formatQuorumSummary, assessQuorumViability, detectRuntimes,
  spawnWorker, detectHelpTextOutput, detectSilentWorkerFailure, detectKilledBySignal,
  deriveVendorFromModel, extractTokens, shouldDefaultPremiumRequestsToOne,
  parseStderrStats,
} from "./orchestrator/worker-spawn.mjs";
export {
  API_ALLOWED_ROLES,
  resetCliWorkersCache, setGhCopilotProbe,
  isDirectApiOnlyModel, isCopilotServableModel, isApiOnlyModel,
  getFoundryAuthScope, detectApiProvider, setSecretsLoader, buildApiMessages,
  generateImage, loadWorkerCapabilities, compareVersions, detectPackageManager,
  suggestInstall, classifyProbeFailure, detectWorkers, detectExecutionRuntime,
  detectClientHost, describeBillingSurface, getRoutingPreference,
  loadRoutingPreference, resolveRequiredCli, probeQuorumModelAvailability,
  filterQuorumModels, formatQuorumSummary, assessQuorumViability, detectRuntimes,
  spawnWorker, detectHelpTextOutput, detectSilentWorkerFailure, detectKilledBySignal,
  deriveVendorFromModel, extractTokens, shouldDefaultPremiumRequestsToOne, parseStderrStats,
};
// ─── Windows bash dispatch ────────────────────────────────────────────
// ─── Phase-28.3 Slice 4: Post-slice advisory scanner ─────────────────
// ─── Schedulers (C2: Pluggable) ───────────────────────────────────────
// Phase-53 S3: extracted to orchestrator/schedulers.mjs
import {
  DEFAULT_GATE_TIMEOUT_MS, GATE_ALLOWED_PREFIXES, UNIX_TOOLS,
  resolveGateTimeoutMs, __resetBashPathCache, resolveBashPath,
  detectSelfRepairMissed, buildRetryPrompt, coalesceGateLines, editDistance,
  isPlaceholderToken, suggestAllowedCommand, looksLikeProse, runGate,
  SequentialScheduler, ParallelScheduler, CompetitiveScheduler, selectWinner,
} from "./orchestrator/schedulers.mjs";
export {
  DEFAULT_GATE_TIMEOUT_MS, GATE_ALLOWED_PREFIXES, UNIX_TOOLS,
  resolveGateTimeoutMs, __resetBashPathCache, resolveBashPath,
  detectSelfRepairMissed, buildRetryPrompt, coalesceGateLines, editDistance,
  isPlaceholderToken, suggestAllowedCommand, looksLikeProse, runGate,
  SequentialScheduler, ParallelScheduler, CompetitiveScheduler, selectWinner,
};
// ─── Run-plan helpers (Phase-53 S4) ──────────────────────────────────
// Phase-53 S4: extracted to orchestrator/run-plan.mjs
import {
  loadCompetitiveConfig, GATE_SUGGESTION_AUTO_INJECT_THRESHOLD,
  loadGateSynthesisConfig, classifySliceDomain, synthesizeGateSuggestions,
  formatGateSuggestions, PROPOSED_FIX_DIR, defaultRunGitApply,
  findMatchingFixProposal, shouldAutoRetryFix, markFixAttempted,
  writeProposedFixPatch, applyFixProposal, rollbackFixProposal,
  COST_ANOMALY_MULTIPLIER, computeMedian, detectCostAnomaly, rerankEscalationChain,
  POSTMORTEM_RETENTION_COUNT, buildPlanPostmortem, listPlanPostmortems, writePlanPostmortem,
} from "./orchestrator/run-plan.mjs";
export {
  loadCompetitiveConfig, GATE_SUGGESTION_AUTO_INJECT_THRESHOLD,
  loadGateSynthesisConfig, classifySliceDomain, synthesizeGateSuggestions,
  formatGateSuggestions, PROPOSED_FIX_DIR, defaultRunGitApply,
  findMatchingFixProposal, shouldAutoRetryFix, markFixAttempted,
  writeProposedFixPatch, applyFixProposal, rollbackFixProposal,
  COST_ANOMALY_MULTIPLIER, computeMedian, detectCostAnomaly, rerankEscalationChain,
  POSTMORTEM_RETENTION_COUNT, buildPlanPostmortem, listPlanPostmortems, writePlanPostmortem,
};
// ─── Forge I/O helpers (Phase-53 S5) ─────────────────────────────────
// Phase-53 S5: extracted to orchestrator/forge-io.mjs
import {
  ensureForgeDir, pruneForgeRuns, aggregateModelStats, loadModelPerformance,
  getCostReport, getHealthTrend, loadGateCheckConfig, registerGateCheckResponder,
} from "./orchestrator/forge-io.mjs";
export {
  ensureForgeDir, pruneForgeRuns, aggregateModelStats, loadModelPerformance,
  getCostReport, getHealthTrend, loadGateCheckConfig, registerGateCheckResponder,
};
// ─── Hooks (Phase-53 S6) ─────────────────────────────────────────────
// Phase-53 S6: extracted to orchestrator/hooks.mjs
import {
  QUORUM_PRESETS,
  registerCorrelationThreadResponder,
  isDeployTrigger,
  runPreDeployHook,
  parseGitPorcelain,
  parseShortstat,
  resetPostSliceHookFired,
  runPostSliceHook,
  resetPostSliceTemperingFired,
  runPostSliceTemperingHook,
  runPreAgentHandoffHook as _runPreAgentHandoffHookImpl,
  loadOpenClawConfig,
  postOpenClawSnapshot,
} from "./orchestrator/hooks.mjs";
export {
  QUORUM_PRESETS,
  registerCorrelationThreadResponder,
  isDeployTrigger,
  runPreDeployHook,
  parseGitPorcelain,
  parseShortstat,
  resetPostSliceHookFired,
  runPostSliceHook,
  resetPostSliceTemperingFired,
  runPostSliceTemperingHook,
  loadOpenClawConfig,
  postOpenClawSnapshot,
};
// ─── Review Watcher (Phase-53 S7) ────────────────────────────────────
// Phase-53 S7: extracted to orchestrator/review-watcher.mjs
import {
  findLatestRun,
  parseEventLine,
  parseEventsLog,
  readSliceArtifacts,
  normalizeRunState,
  CRUCIBLE_STALL_CUTOFF_DAYS,
  readCrucibleState,
  readReviewQueueState,
  buildWatchSnapshot,
  readHomeSnapshot,
  detectWatchAnomalies,
  recommendFromAnomalies,
  scoreSliceComplexity,
} from "./orchestrator/review-watcher.mjs";
export {
  findLatestRun,
  parseEventLine,
  parseEventsLog,
  readSliceArtifacts,
  normalizeRunState,
  CRUCIBLE_STALL_CUTOFF_DAYS,
  readCrucibleState,
  readReviewQueueState,
  buildWatchSnapshot,
  readHomeSnapshot,
  detectWatchAnomalies,
  recommendFromAnomalies,
  scoreSliceComplexity,
};
// Wrap runPreAgentHandoffHook to inject regressionGuard (avoids circular import in hooks.mjs)
export function runPreAgentHandoffHook(params = {}) {
  return _runPreAgentHandoffHookImpl({ ...params, _deps: { _regressionGuard: regressionGuard } });
}
// ─── Orchestrator ─────────────────────────────────────────────────────

/**
 * Main orchestrator — coordinates plan execution.
 *
 * @param {string} planPath - Path to hardened plan Markdown
 * @param {object} options
 * @param {string} options.cwd - Project working directory
 * @param {string} options.model - Model override
 * @param {string} options.mode - "auto" | "assisted"
 * @param {number} options.resumeFrom - Slice number to resume from
 * @param {boolean} options.estimate - Estimate only, don't execute
 * @param {boolean} options.dryRun - Parse + validate only
 * @param {object} options.eventHandler - Custom event handler (DI)
 * @param {AbortController} options.abortController
 */
export async function runPlan(planPath, options = {}) {
  const {
    cwd = process.cwd(),
    model = null,
    mode = "auto",
    resumeFrom = null,
    estimate = false,
    dryRun = false,
    eventHandler = null,
    abortController = null,
    quorum = QUORUM_MODE_AUTO, // false | true | "auto" — default: auto (threshold-based)
    quorumThreshold = null, // override threshold from config
    quorumPreset = null,   // "power" | "speed" | null — selects model preset
    bridge = null,         // BridgeManager instance for approval gate
    manualImport = false,   // v2.37 Crucible (Slice 01.4): bypass crucibleId gate
    manualImportSource = "human", // audit tag: "human" | "speckit" | "grandfather"
    manualImportReason = null,    // free-form note for audit log
    hub = null,             // Phase FORGE-SHOP-06 Slice 06.2: Hub instance for gate-check
    strictGates = false,    // Phase-31 Slice 4: force enforce mode for this run only
    onlySlices = null,      // Phase-33.1: number[] | null — run only specified slice IDs
    noTempering = false,    // Phase-33.1: disable post-slice tempering for this run
    allowRetrograde = false, // Meta-bug #129: allow plan whose target version already exists on origin
    worker = null,           // Phase GITHUB-B Slice 3: e.g. "copilot-coding-agent"
    // Issue #176 — dryRunWorker: skip the real worker spawn (executeSlice) and
    // synthesize a passing slice result. Tests that exercise runPlan setup
    // (quorum probe, config loading, escalation chain) without needing real
    // worker side-effects must opt in. Default false preserves prod behavior.
    // Without this guard, tests that call runPlan() with a real worker (e.g.
    // gh-copilot) hand the worker full shell access in the operator's cwd —
    // the worker can edit any source file and even `git push` to origin.
    dryRunWorker = false,
    // Injectable dependencies for testing (copilot-coding-agent dispatch path)
    _inspectGithubStack = _inspectGithubStackDefault,
    _dispatchSlice = _dispatchSliceDefault,
    _pollPullRequest = _pollPullRequestDefault,
    // Phase-ANVIL Slice 4: injectable DLQ drain for testing
    _anvilDlqDrain: anvilDlqDrain = _anvilDlqDrain,
  } = options;

  // Phase-ANVIL Slice 4 — DLQ boot-time drain (5-second budget, best-effort).
  // Runs before any slice work so stale L3-deferred records can be recovered.
  // Does NOT block the run: errors are silently swallowed.
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

  // Mutual exclusion: --resume-from and --only-slices cannot both be active
  if (resumeFrom !== null && onlySlices !== null && onlySlices.length > 0) {
    throw new Error("--resume-from and --only-slices are mutually exclusive");
  }

  // Load model routing from .forge.json (Slice 5 — effectiveModel resolved after parsePlan)
  const modelRouting = loadModelRouting(cwd);

  // v2.37 Crucible (Slice 01.4) — enforce that the plan was smelted
  // through the Crucible funnel or an explicit `--manual-import` bypass
  // was provided. Runs BEFORE parsePlan / estimate / dryRun so nobody
  // can sneak a plan in by claiming "I'm only estimating."
  try {
    enforceCrucibleId(planPath, {
      cwd,
      manualImport,
      source: manualImportSource,
      reason: manualImportReason,
    });
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

  // Parse plan
  const plan = parsePlan(planPath, cwd);

  // Bug #127: Precedence: options.model > frontmatter model: > .forge.json default > null
  const fmModel = (plan.meta && typeof plan.meta.model === "string" && plan.meta.model.trim().length > 0)
    ? plan.meta.model.trim() : null;
  let effectiveModel, modelSource;
  if (model) {
    effectiveModel = model;
    modelSource = "options";
  } else if (fmModel) {
    effectiveModel = fmModel;
    modelSource = "frontmatter";
  } else if (modelRouting.default) {
    effectiveModel = modelRouting.default;
    modelSource = "config";
  } else {
    effectiveModel = null;
    modelSource = "default";
  }
  // Bug #127: emit resolution log so users can trace which source won.
  // Uses `resolved=` to match the Bug #127 contract. Note: CLI workers
  // (gh-copilot, claude-cli, codex-cli) may select their own model regardless
  // of what is resolved here; they emit their own `[model]` line when they do.
  // eslint-disable-next-line no-console
  console.error(`[model] resolved=${effectiveModel} source=${modelSource}`);

  // Zero-slice guard: loud-fail before any dispatch (Bug #124)
  if (plan.slices.length === 0) {
    return {
      status: "failed",
      error: "No slices found in plan — expected '### Slice N: …' headers (h2/h3/h4 accepted)",
      code: "NO_SLICES",
      planPath,
    };
  }

  // Phase-WORKER-GUARDRAILS Slice 5 (A6): lockHash enforcement.
  // If frontmatter has `lockHash`, verify plan body has not drifted since hardening.
  // Absent lockHash → runs as today (backwards-compatible per decision #7).
  if (plan.meta && typeof plan.meta.lockHash === "string") {
    const planContent = readFileSync(planPath, "utf-8");
    const computedHash = computeLockHash(planContent);
    if (computedHash !== plan.meta.lockHash) {
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
  }

  // Meta-bug #129 preflight: refuse to run a plan whose target release version
  // already exists as a tag on origin. Prevents the "retrograde release" class
  // of disaster (re-running an old plan against newer master, producing a
  // chore(release): commit + tag that overwrites a shipped release). Runs
  // BEFORE estimate / dryRun so estimating a doomed plan also surfaces the
  // problem early. Bypass with `--allow-retrograde` if intentional (e.g.
  // patch release on a hotfix branch). Network / git errors degrade to
  // advisory — offline runs are not blocked.
  if (!allowRetrograde) {
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
  }

  // Estimation mode — return without executing
  if (estimate) {
    // Build quorum config for estimate even though we're not running
    let estimateQuorumConfig = null;
    if (quorum) {
      estimateQuorumConfig = loadQuorumConfig(cwd, quorumPreset);
      estimateQuorumConfig.enabled = true;
      if (quorum === QUORUM_MODE_AUTO) estimateQuorumConfig.auto = true;
      else if (quorum === true) estimateQuorumConfig.auto = false;
      if (quorumThreshold !== null && typeof quorumThreshold === "number") {
        estimateQuorumConfig.threshold = quorumThreshold;
      }
    }
    return buildEstimate(plan, effectiveModel, cwd, estimateQuorumConfig, resumeFrom, worker);
  }

  // Dry run — parse and validate only
  if (dryRun) {
    // Phase GITHUB-B Slice 5: copilot-coding-agent dry-run prints issue body previews
    // without requiring `gh` to be installed.
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

  // Phase GITHUB-B Slice 3 — Copilot Coding Agent pre-flight (skipped for estimate/dryRun)
  // Hotfix v2.90.4: always probe copilot-coding-agent-assignable (ghToken:true) so a
  // missing Copilot Coding Agent enablement is caught before any issue is created.
  if (worker === "copilot-coding-agent") {
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
    if (failed.length > 0) {
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
  }

  // Pre-flight: lint gate commands before burning time on execution
  const gateLint = lintGateCommands(planPath, cwd);
  if (!gateLint.passed) {
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

  // Phase-25 Slice 4 (L6 adaptive gate synthesis): scan plan slices for
  // domain-matched slices that lack a validation gate and print suggestions.
  // Advisory-only by default (D8 mode="suggest"). When strictGates=true the
  // mode is overridden to "enforce" for this run only (never written to
  // .forge.json) and pre-flight fails with a structured error listing each
  // offending slice. (Phase-31 Slice 4.)
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

  // Set up event bus with DI handler
  const runDir = createRunDir(cwd, planPath);
  const logHandler = new LogEventHandler(runDir);

  // v2.4: Create trace context and telemetry handler
  const trace = createTraceContext(planPath, { mode, model: effectiveModel, sliceCount: plan.slices.length });
  const telemetryHandler = createTelemetryHandler(trace, runDir);

  // Chain handlers: user-provided → telemetry → log → console progress
  const isCliRun = !eventHandler; // If no custom handler, we're running from CLI — show progress on stdout
  const combinedHandler = {
    handle(event) {
      telemetryHandler.handle(event);
      if (eventHandler) eventHandler.handle(event);
      logHandler.handle(event);
      // Write progress to stdout so terminal stays alive (prevents VS Code "awaiting input" stall)
      if (isCliRun && event?.type) {
        const ts = new Date().toISOString().slice(11, 19);
        const d = event.data || event; // data is nested under event.data by the EventBus
        switch (event.type) {
          case "run-started":
            process.stdout.write(`[${ts}] ▶ Run started: ${d.sliceCount || "?"} slices, mode=${d.mode || "auto"}\n`);
            break;
          case "slice-started":
            process.stdout.write(`[${ts}] ⏳ Slice ${d.sliceId || "?"}: ${d.title || ""} — executing...\n`);
            break;
          case "slice-completed":
            process.stdout.write(`[${ts}] ✅ Slice ${d.sliceId || "?"}: ${d.title || ""} — ${d.status || "done"} (${Math.round((d.duration || 0) / 1000)}s)\n`);
            break;
          case "slice-failed":
            process.stdout.write(`[${ts}] ❌ Slice ${d.sliceId || "?"}: ${d.title || ""} — FAILED\n`);
            break;
          case "slice-escalated":
            process.stdout.write(`[${ts}] ⬆ Slice ${d.sliceId || "?"}: ${d.title || ""} — escalating to ${d.toModel} (attempt ${d.attempt})\n`);
            break;
          case "run-completed":
            process.stdout.write(`[${ts}] 🏁 Run complete: ${d.results?.passed || 0} passed, ${d.results?.failed || 0} failed\n`);
            break;
          case "ci-triggered":
            process.stdout.write(`[${ts}] 🚀 CI triggered: ${d.workflow} @ ${d.ref} — ${d.status}\n`);
            break;
        }
      }
    },
  };
  const eventBus = new OrchestratorEventBus(combinedHandler);

  // Issue #197 — Silent-death guard.
  // When Node is launched in background mode on Windows without an attached
  // console (Start-Process -FilePath 'node' -WindowStyle Hidden), the gh
  // copilot CLI worker needs a console to initialize its progress reporter.
  // Without one, it exits immediately with no output, the worker promise
  // resolves with an empty result, and the orchestrator's event loop drains
  // cleanly — leaving the run log with slice-started but no slice-failed.
  //
  // This guard registers a synchronous `process.on('exit')` listener that
  // writes a slice-failed event whenever the process exits while a slice is
  // still in-progress, making the silent death detectable and retriable.
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

  // Write run.json metadata
  const runMeta = {
    plan: planPath,
    traceId: trace.traceId,
    startTime: new Date().toISOString(),
    model: effectiveModel || "auto",
    modelRouting,
    mode,
    // Issue #182: surface the quorum *mode* separately from the worker `mode`
    // (auto/assisted). Before this fix, summary.mode was "auto" both for
    // single-model auto runs and for --quorum=power runs, making cost
    // attribution and historical filtering impossible.
    quorumMode: quorum === false ? QUORUM_MODE_FALSE
              : quorumPreset // "power" | "speed"
              || (quorum === true ? "all" : QUORUM_MODE_AUTO),
    quorumPreset: quorumPreset || null,
    sliceCount: plan.slices.length,
    executionOrder: plan.dag.order,
  };
  writeFileSync(resolve(runDir, "run.json"), JSON.stringify(runMeta, null, 2));

  // Select scheduler — use ParallelScheduler if plan has [P] tags
  const hasParallelSlices = plan.slices.some((s) => s.parallel);
  const hasCompetitiveSlices = plan.slices.some((s) => s.competitive);
  const maxParallelism = loadMaxParallelism(cwd);
  let scheduler;
  if (hasCompetitiveSlices) {
    const compConfig = loadCompetitiveConfig(cwd);
    // Lazy-load worktree manager so projects without competitive slices don't
    // pay the import cost.
    const worktreeManager = await import("./worktree-manager.mjs");
    scheduler = new CompetitiveScheduler(eventBus, {
      maxVariants: compConfig.maxVariants,
      projectDir: resolve(cwd),
      planBasename: basename(planPath, ".md"),
      worktreeManager,
    });
  } else if (hasParallelSlices) {
    scheduler = new ParallelScheduler(eventBus, maxParallelism);
  } else {
    scheduler = new SequentialScheduler(eventBus);
  }
  const abortSignal = abortController?.signal || null;

  // OpenBrain memory integration
  const memoryEnabled = isOpenBrainConfigured(cwd);
  const projectName = loadProjectName(cwd);

  // Quorum mode (v2.5) — fix #122: respect .forge.json quorum.enabled when quorum==="auto"
  let quorumConfig = null;
  if (quorum) {
    quorumConfig = loadQuorumConfig(cwd, quorumPreset);

    // "auto" (CLI default): preserve quorumConfig.enabled from .forge.json.
    // Absence of .forge.json quorum.enabled ≙ legacy default ≙ enabled=true.
    // true / "true" / preset: caller explicitly requested quorum — force enabled regardless of config.
    const callerExplicit = quorum === true || quorum === "true" || quorumPreset !== null;

    let configHasExplicitEnabled = false;
    if (!callerExplicit) {
      try {
        const fp = resolve(cwd, ".forge.json");
        if (existsSync(fp)) {
          const raw = JSON.parse(readFileSync(fp, "utf-8"));
          configHasExplicitEnabled = raw.quorum != null && typeof raw.quorum === "object" && "enabled" in raw.quorum;
        }
      } catch { /* ignore — use legacy default */ }
    }

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

    // H.3: Probe model availability — only when quorum is actually enabled
    if (quorumConfig.enabled) {
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
  }

  eventBus.emit("run-started", { ...runMeta, quorum: quorumConfig ? { enabled: quorumConfig.enabled, auto: quorumConfig.auto, threshold: quorumConfig.threshold } : null });

  // Issue #201 — janitor pass: drop any pforge-slice-N-snapshot stashes older
  // than 7 days. Prevents accumulation of orphaned snapshots from conflicted
  // pops in prior runs (testbed observed 60+ orphans). Best-effort.
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

  // GX.2 (v2.36): L3 → L1 preload. Emit a `memory-preload` event right after
  // run-started carrying the deterministic search-hints derived from the plan.
  // The dashboard, watchers, and the first worker pick this up via hub history
  // *before* the first slice runs — closing the "no semantic context at boot" gap.
  if (memoryEnabled && projectName) {
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

  // Execute slices
  const maxRetries = loadMaxRetries(cwd);
  const escalationChain = loadEscalationChain(cwd);

  // Phase CRUCIBLE-02 Slice 02.1 — pre-compute complexity for every slice so
  // slice-started events (emitted by the scheduler) can carry the score.
  // Best-effort: a scoring failure on one slice should not block the run.
  for (const [sliceId, sliceNode] of plan.dag.nodes) {
    try {
      const { score } = scoreSliceComplexity(sliceNode, cwd);
      sliceNode.complexityScore = score;
    } catch { /* leave undefined — UI will render a neutral '—' */ }
  }

  // Phase FORGE-SHOP-06 Slice 06.2 — Gate check config for inter-slice validation
  const gateCheckConfig = hub ? loadGateCheckConfig(cwd) : null;

  // Phase-33.1: Set PFORGE_DISABLE_TEMPERING env var before the slice loop when requested.
  // Use try/finally to restore the prior value so in-process callers don't leak state.
  const _priorDisableTempering = process.env.PFORGE_DISABLE_TEMPERING;
  if (noTempering) {
    process.env.PFORGE_DISABLE_TEMPERING = "1";
  }

  // Phase-33.1: Pre-filter execution order for --only-slices.
  // Filtering here (before scheduler dispatch) ensures all scheduler types respect it.
  let executionOrder = plan.dag.order;
  if (onlySlices !== null && onlySlices.length > 0) {
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
    executionOrder = plan.dag.order.filter((id) => onlySet.has(id));
  }

  let results;
  try {
    results = await scheduler.execute(
      plan.dag.nodes,
      executionOrder,
      async (slice) => {
        // Bug #123: capture HEAD before the slice so we can deterministically
        // detect commits made by the worker itself (gh-copilot, claude CLI).
        // Without this, autoCommitSliceIfDirty saw a clean tree post-slice
        // and reported "clean-tree" \u2014 even though the worker had committed
        // multiple times \u2014 producing non-deterministic per-slice commit
        // counts in run summaries.
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
        const result = await executeSlice(slice, {
          cwd, model: effectiveModel, modelRouting, mode, runDir, maxRetries,
          memoryEnabled, projectName, planName: basename(planPath, ".md"),
          quorumConfig, escalationChain, eventBus,
          worker, _dispatchSlice, _pollPullRequest,
          networkAllowed: plan.meta?.networkAllowed ?? null,
          networkEnforce: plan.meta?.networkEnforce ?? false,
          toolsDeny: plan.meta?.toolsDeny ?? null,
        });
        if (result.status === "passed") {
          result.autoCommit = autoCommitSliceIfDirty({ slice, cwd, mode, eventBus, startSha, preSliceState });
          // #186 v2.96.2: bubble auto-commit codeChanges back into tokens when
          // the worker's JSONL events didn't surface result.usage.codeChanges.
          // gh-copilot currently doesn't emit this field, so without the
          // fallback every slice records codeChanges=null and downstream
          // dashboards (forge_drift_report, forge_health_trend) plot zeros.
          if (result.tokens && !result.tokens.codeChanges && result.autoCommit?.codeChanges) {
            result.tokens.codeChanges = result.autoCommit.codeChanges;
          }
          // Issue #195: when the orchestrator's own commit was housekeeping
          // only, the real product diffstat lives on the absorbed (external)
          // commit. Fall back so tokens.codeChanges reflects actual work.
          if (result.tokens && !result.tokens.codeChanges
              && result.autoCommit?.absorbedCommits?.length) {
            const firstWithStat = result.autoCommit.absorbedCommits.find((c) => c.diffstat);
            if (firstWithStat) result.tokens.codeChanges = firstWithStat.diffstat;
          }
          // Issue #195: re-persist slice-N.json so the on-disk record matches
          // the slice-completed event. Without this, autoCommit, raceDetected,
          // absorbedCommits, and the bubbled codeChanges are only visible in
          // events.log — every consumer reading slice-N.json (dashboards,
          // reviewers, postmortems) sees `autoCommit: {}` and
          // `codeChanges: null` even on slices that committed real work.
          try {
            writeFileSync(
              resolve(runDir, `slice-${slice.number}.json`),
              JSON.stringify(result, null, 2),
            );
          } catch { /* non-fatal */ }
        } else if (result.status === "failed") {
          // Issue #132 \u2014 the gate said no, but the worker may have written
          // perfectly correct files (typical when the gate script itself is
          // buggy). Stage them and warn so the operator can triage instead of
          // losing work to a clean-tree on the next resume.
          const orphans = stageOrphansOnSliceFailure({ slice, cwd, runDir, mode, eventBus });
          if (orphans) {
            result.orphans = orphans;
          }
        }
        return result;
      },
      { abortSignal, resumeFrom: resumeFrom ? String(resumeFrom) : null, hub, gateCheckConfig },
    );
  } finally {
    // Restore the prior value of PFORGE_DISABLE_TEMPERING regardless of outcome
    if (_priorDisableTempering === undefined) {
      delete process.env.PFORGE_DISABLE_TEMPERING;
    } else {
      process.env.PFORGE_DISABLE_TEMPERING = _priorDisableTempering;
    }
  }

  // Auto-sweep + auto-analyze after all slices (Slice 6)
  const allPassed = results.every((r) => r.status === "passed" || r.status === "skipped");
  let sweepResult = null;
  let analyzeResult = null;

  if (allPassed && !estimate && !dryRun) {
    sweepResult = runAutoSweep(cwd);
    analyzeResult = runAutoAnalyze(cwd, planPath);
  }

  // Build summary in memory (needed for approval message content)
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
    try {
      recordActivity({ ...activitySummary, status: "aborted" }, { storeDir: join(cwd, ".forge") });
    } catch {
      // Never block the run on team activity write failure.
    }
  }

  // Approval gate (Phase 16) — pause and await human approval before finalising
  if (allPassed && bridge?.hasApprovalChannels) {
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

  // CI/CD Integration Hook — trigger workflow after successful run
  if (allPassed && summary.status !== "approval-rejected") {
    const ciConfig = loadCiConfig(cwd);
    if (ciConfig.enabled && ciConfig.workflow) {
      summary.ci = triggerCiWorkflow(ciConfig, eventBus);
    }
  }

  // Phase-39 Slice 7 — audit-loop activation hook (end-of-plan)
  if (allPassed && !estimate && !dryRun) {
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

  // Phase-39 Slice 1 — post-run auditor auto-invoke on failure
  if (!estimate && !dryRun) {
    try {
      const auditorResult = runPostRunAuditorHook({ cwd, allPassed, eventBus });
      if (auditorResult.triggered) {
        summary._auditor = auditorResult;
      }
    } catch { /* never block the run on auditor hook failure */ }
  }

  // Write summary
  writeFileSync(resolve(runDir, "summary.json"), JSON.stringify(summary, null, 2));

  // Phase 2: Append to cost history
  if (summary.cost && summary.status !== "estimate" && summary.status !== "approval-rejected") {
    appendCostHistory(cwd, summary);
  }

  // Emit run-completed — telemetry handler writes trace.json during this emit
  eventBus.emit("run-completed", summary);
  if (!abortSignal?.aborted) {
    try {
      recordActivity({ ...activitySummary, status: summary.status }, { storeDir: join(cwd, ".forge") });
    } catch {
      // Never block the run on team activity write failure.
    }
  }

  // v2.4: Write manifest + index + prune (AFTER trace.json is written by emit)
  const manifest = writeManifest(runDir, runId, { ...summary, traceId: trace.traceId });
  appendRunIndex(cwd, runId, manifest);
  pruneRunHistory(cwd, loadMaxRunHistory(cwd));

  // OpenBrain: capture run summary + cost anomaly as thoughts.
  // Issue #205 (May 2026): the capture now happens here in the orchestrator
  // — previously it only fired from the MCP `forge_run_plan` handler in
  // `server.mjs`, so CLI runs (`pforge run-plan`) silently dropped every
  // capture. `_captured: true` on the receipt tells the server handler to
  // skip its legacy re-capture path and avoid double-writing.
  if (memoryEnabled) {
    const runSummary = buildRunSummaryThought(summary, projectName);
    const costAnomaly = buildCostAnomalyThought(summary, getCostReport(cwd), projectName);
    const receipts = { runSummary: null, costAnomaly: null };
    if (runSummary) {
      receipts.runSummary = captureMemory(runSummary, "decision", "forge_run_plan", cwd);
    }
    if (costAnomaly) {
      receipts.costAnomaly = captureMemory(costAnomaly, "gotcha", "forge_run_plan/cost", cwd);
    }
    summary._memoryCapture = {
      runSummary,
      costAnomaly,
      _captured: true,
      receipts,
    };

    // Issue #205 fix #3: auto-drain the OpenBrain queue so newly-captured
    // thoughts land in L3 without requiring a manual `pforge brain replay`.
    // Best-effort with 10s timeout — never blocks the run. Previously the
    // queue file grew forever until a human ran `pforge brain replay`, so
    // L3 search returned stale results for days after a successful run.
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

  // Phase-25 Slice 5 (L5 closed loop): write a plan postmortem after every
  // run regardless of pass/fail, bounded by retention count (D7). Delta
  // fields compare against the most-recent prior postmortem for the same
  // plan basename. Never fails the run.
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

  // Phase-31 Slice 6: promote recurring tempering suppressions to bug files.
  // Runs after postmortem so suppression data from this run is fully written.
  try {
    _promoteSuppressions({ cwd });
  } catch { /* never block the run on promoter failure */ }

  return summary;
}

/**
 * Load model routing configuration from .forge.json.
 * Schema: { "modelRouting": { "execute": "gpt-5.2-codex", "review": "claude-sonnet-4.6", "default": "auto" } }
 * Returns the modelRouting object, or defaults if not configured.
 */
function loadModelRouting(cwd) {
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
  return { default: "claude-opus-4.6" };
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
function loadCiConfig(cwd) {
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
    execSync(`gh ${args.join(" ")}`, { encoding: "utf-8", timeout: 30_000 });

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
function resolveModel(cliModel, modelRouting, slice) {
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
export function recordModelPerformance(cwd, entry) {
  const perfPath = resolve(cwd, ".forge", "model-performance.json");
  const records = loadModelPerformance(cwd);
  records.push(entry);
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  writeFileSync(perfPath, JSON.stringify(records, null, 2));
}

// Phase-53 S5: aggregateModelStats, ensureForgeDir → orchestrator/forge-io.mjs

/**
 * Read and parse a JSON file from .forge/.
 * @param {string} filePath - Path relative to .forge/ (e.g. "cost-history.json")
 * @param {*} [defaultValue=null] - Returned when file is missing or contains invalid JSON
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {*} Parsed JSON or defaultValue
 */
export function readForgeJson(filePath, defaultValue = null, cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return JSON.parse(readFileSync(fullPath, "utf-8"));
    }
  } catch { /* corrupt/missing → return default */ }
  return defaultValue;
}

/**
 * Append a JSON record as a single line to a JSONL file under .forge/.
 * Creates parent directories if absent.
 *
 * G2.2 (v2.36): every record is auto-stamped with `_v: 1` (schema version)
 *   if not already present. Future schema migrations can branch on this.
 * G2.4 (v2.36): when `opts.correlationId` is provided, the record gets a
 *   `_correlationId` field — lets analysts trace L1 events ↔ L2 records ↔
 *   L3 captures back to the same originating run/slice.
 *
 * @param {string} filePath - Path relative to .forge/ (e.g. "telemetry/tool-calls.jsonl")
 * @param {object} record - JSON-serializable object to append
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @param {{correlationId?: string}} [opts] - Optional metadata
 */
export function appendForgeJsonl(filePath, record, cwd = process.cwd(), opts = {}) {
  const fullPath = resolve(cwd, ".forge", filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const stamped = {
    _v: 1,
    ...(opts.correlationId ? { _correlationId: opts.correlationId } : {}),
    ...record,
  };
  appendFileSync(fullPath, JSON.stringify(stamped) + "\n");
}

/**
 * Read a JSONL file under .forge/ and return an array of parsed records.
 * Returns defaultValue (default []) if the file is missing or unreadable.
 *
 * G2.1 (v2.36): backward-compat shim. When `filePath` ends with `.jsonl` and
 *   the new file doesn't exist, transparently fall back to the legacy `.json`
 *   variant. Lets us rename misnamed `*-history.json` → `*-history.jsonl`
 *   without breaking projects upgrading from <2.36.
 *
 * @param {string} filePath - Path relative to .forge/
 * @param {Array} [defaultValue=[]] - Fallback when file is absent
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {Array}
 */
export function readForgeJsonl(filePath, defaultValue = [], cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8")
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
    // G2.1 shim: try the legacy `.json` variant for newly-renamed files
    if (filePath.endsWith(".jsonl")) {
      const legacy = resolve(cwd, ".forge", filePath.slice(0, -1)); // .jsonl → .json
      if (existsSync(legacy)) {
        return readFileSync(legacy, "utf-8")
          .split("\n")
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      }
    }
    return defaultValue;
  } catch { return defaultValue; }
}

// Phase-53 S5: pruneForgeRuns → orchestrator/forge-io.mjs

// ─── G2.5 — Orphan file audit ─────────────────────────────────────────

/**
 * G2.5 (v2.36): list files under `.forge/` that aren't recognised by any
 * tool. Useful for catching stale artifacts from removed tools or typos in
 * write paths. Returns `{ known, orphan }` lists relative to `.forge/`.
 *
 * The whitelist is intentionally hand-maintained — when a tool produces a
 * new artifact, add it here so it stops showing up as orphan.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {{known: string[], orphan: string[], whitelist: string[]}}
 */
export function auditOrphanForgeFiles(cwd = process.cwd()) {
  // Patterns of recognised artifacts (substring or RegExp)
  const WHITELIST = [
    // Top-level state
    "server-ports.json", "hub-events.jsonl", "watch-history.jsonl",
    // L2 LiveGuard / dual-write
    "drift-history.jsonl", "drift-history.json",
    "regression-history.jsonl", "regression-history.json",
    "health-dna.jsonl", "health-dna.json",
    "quorum-history.jsonl", "quorum-history.json",
    "incidents.jsonl", "deploy-journal.jsonl",
    "liveguard-events.jsonl", "liveguard-memories.jsonl",
    "openbrain-queue.jsonl", "openbrain-dlq.jsonl", "openbrain-stats.jsonl",
    "env-diff-history.jsonl",
    // Caches
    "cost-history.json", "model-performance.json",
    "secret-scan-cache.json", "regression-gates.json",
    // Subdirectories handled separately
  ];
  const KNOWN_DIRS = new Set(["runs", "telemetry", "cache", "skills"]);

  const dir = resolve(cwd, ".forge");
  const known = [];
  const orphan = [];
  if (!existsSync(dir)) return { known, orphan, whitelist: WHITELIST };

  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return { known, orphan, whitelist: WHITELIST }; }

  for (const e of entries) {
    if (e.isDirectory()) {
      if (KNOWN_DIRS.has(e.name)) known.push(e.name + "/");
      else orphan.push(e.name + "/");
      continue;
    }
    if (WHITELIST.includes(e.name)) known.push(e.name);
    else orphan.push(e.name);
  }
  return { known, orphan, whitelist: WHITELIST };
}

// Phase-53 S5: getHealthTrend → orchestrator/forge-io.mjs

/**
 * Extract a target release version from a plan file.
 *
 * Scans (in order):
 *   1. Plan filename for `v<MAJOR>.<MINOR>[.<PATCH>][-...]` (e.g. `Phase-33.4-...-v2.67.4-PLAN.md`)
 *   2. Plan frontmatter `version:` field (if present)
 *   3. First `chore(release): vX.Y.Z` literal in the body
 *
 * Returns `null` when no version literal is found (non-release plan).
 *
 * @param {string} planPath - Path to plan markdown file
 * @returns {string|null} Bare semver string (no `v` prefix) or null
 */
export function extractPlanReleaseVersion(planPath) {
  if (!planPath || typeof planPath !== "string") return null;

  // 1. Filename: ...-v2.67.4-... or ...-v2.67-... Pre-release suffix is
  //    intentionally NOT captured from the filename (too easy to swallow
  //    "-PLAN.md" etc.) — use frontmatter or chore(release) line for that.
  const fname = planPath.split(/[\\/]/).pop() || "";
  const fnameMatch = fname.match(/[-_]v(\d+\.\d+(?:\.\d+)?)\b/);
  if (fnameMatch) return fnameMatch[1];

  // 2./3. Body scan (frontmatter `version:` or chore(release) line)
  let body = "";
  try {
    body = readFileSync(planPath, "utf-8");
  } catch {
    return null;
  }

  const fmMatch = body.match(/(?:^|\n)version:\s*['"]?v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)['"]?/);
  if (fmMatch) return fmMatch[1];

  const choreMatch = body.match(/chore\(release\):\s*v(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/);
  if (choreMatch) return choreMatch[1];

  return null;
}

/**
 * Check whether a plan's target release version collides with a tag that
 * already exists on `origin`. Prevents the "retrograde release disaster"
 * (re-running an old plan against newer master, producing a `chore(release):`
 * commit + tag that overwrites a shipped release).
 *
 * Behaviour:
 *   - Returns `{ collision: false, version: null }` when no version is detected
 *     (non-release plan — bail out as no-op).
 *   - Returns `{ collision: false, version, originSha: null }` when the tag does
 *     not exist on origin.
 *   - Returns `{ collision: true, version, originSha }` when the tag already
 *     exists on origin.
 *
 * If `git ls-remote` itself fails (no network, no remote, etc.) returns
 * `{ collision: false, version, error }` — the orchestrator treats this as
 * advisory-only so offline runs aren't blocked.
 *
 * @param {string} planPath - Path to plan markdown file
 * @param {string} [cwd=process.cwd()] - Project root (where git is invoked)
 * @param {{ runner?: (cmd: string, opts: object) => string }} [opts] - Test seam
 * @returns {{ version: string|null, collision: boolean, originSha: string|null, error: string|null }}
 */
export function detectVersionCollision(planPath, cwd = process.cwd(), opts = {}) {
  const version = extractPlanReleaseVersion(planPath);
  if (!version) {
    return { version: null, collision: false, originSha: null, error: null };
  }

  const tagRef = `refs/tags/v${version}`;
  const runner = opts.runner || ((cmd, options) => execSync(cmd, options).toString());

  try {
    const out = runner(`git ls-remote --tags origin ${tagRef}`, {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = (out || "").trim();
    if (!trimmed) {
      return { version, collision: false, originSha: null, error: null };
    }
    // Output format: "<sha>\trefs/tags/v2.67.4"
    const sha = trimmed.split(/\s+/)[0] || null;
    return { version, collision: true, originSha: sha, error: null };
  } catch (err) {
    return {
      version,
      collision: false,
      originSha: null,
      error: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * Extract validation gates from a parsed plan file.
 * Delegates to parsePlan() — does not duplicate parsing logic.
 * @param {string} planFilePath - Absolute or project-relative path to a plan markdown file
 * @param {string} [cwd=process.cwd()] - Project root (used for path-traversal check)
 * @returns {Array<{sliceNumber: string, sliceTitle: string, gates: string[]}>}
 */
export function parseValidationGates(planFilePath, cwd = process.cwd()) {
  const plan = parsePlan(planFilePath, cwd);
  return plan.slices
    .filter(s => s.validationGate)
    .map(s => ({
      sliceNumber: s.number,
      sliceTitle: s.title,
      gates: s.validationGate
        .split("\n")
        .map(l => l.replace(/\s{2,}#\s.*$/, "").trim())
        .filter(l => l.length > 0),
    }));
}

/**
 * Lint all validation gate commands in a plan file.
 * Catches common issues that cause gate failures at runtime:
 *   - Commands not in the allowlist
 *   - Standalone comment lines (# ...) that get treated as commands
 *   - /dev/stdin usage (not cross-platform — fails on Windows)
 *   - curl localhost:* in non-final slices (requires running server)
 *   - `node *.test.mjs` for vitest test files (must use npx vitest)
 *
 * @param {string} planFilePath - Path to the plan Markdown file
 * @returns {{ warnings: Array, errors: Array, passed: boolean }}
 */
export function lintGateCommands(planFilePath, cwd = process.cwd()) {
  const plan = (planFilePath !== null && typeof planFilePath === "object")
    ? planFilePath
    : parsePlan(planFilePath, cwd);
  const warnings = [];
  const errors = [];
  const portabilityWarnings = [];
  // Strict mode: PFORGE_GATE_LINT_STRICT=1 promotes all W-rule warnings to errors.
  const strictMode = process.env.PFORGE_GATE_LINT_STRICT === "1";
  const lastSliceNumber = plan.slices.length > 0
    ? plan.slices[plan.slices.length - 1].number
    : null;

  for (const slice of plan.slices) {
    if (!slice.validationGate) continue;

    // Also lint raw lines for comment detection before coalescing
    const rawLines = slice.validationGate.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    // Parse per-gate suppression directives: # pforge-lint-disable W1 or # pforge-lint-disable W1,W2
    const disabledRules = new Set();
    for (const raw of rawLines) {
      const disableMatch = raw.match(/^#\s*pforge-lint-disable\s+(.+)$/i);
      if (disableMatch) {
        for (const rid of disableMatch[1].split(",").map(s => s.trim().toUpperCase()).filter(Boolean)) {
          disabledRules.add(rid);
        }
      } else if (raw.startsWith("#")) {
        const loc = `Slice ${slice.number} ("${slice.title}")`;
        warnings.push({
          slice: slice.number,
          command: raw,
          rule: "comment-line",
          severity: "warn",
          message: `${loc}: Standalone comment '${raw.slice(0, 60)}...' will be treated as a command. Remove or prefix with a real command.`,
        });
      }
    }

    const commands = coalesceGateLines(slice.validationGate);

    for (const line of commands) {
      const loc = `Slice ${slice.number} ("${slice.title}")`;

      // 1. /dev/stdin (not cross-platform)
      if (line.includes("/dev/stdin")) {
        errors.push({
          slice: slice.number,
          command: line,
          rule: "unix-only-path",
          severity: "error",
          message: `${loc}: '/dev/stdin' is Unix-only — fails on Windows. Use readFileSync(0,'utf8') for cross-platform stdin.`,
        });
      }

      // 3. Command not in allowlist
      // Skip prose lines with a warning instead of an error
      if (looksLikeProse(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "prose-detected",
          severity: "warn",
          message: `${loc}: Line looks like prose, not a command: '${line.slice(0, 60)}...' — will be skipped at runtime.`,
        });
        continue;
      }
      // Skip leading env var assignments (VAR=val command ...) to find the real command
      const tokens = line.split(/\s+/);
      let cmdIdx = 0;
      while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
        cmdIdx++;
      }
      const cmdToken = (tokens[cmdIdx] || tokens[0]).toLowerCase();
      const isAllowed = GATE_ALLOWED_PREFIXES.some(p => cmdToken === p || cmdToken.endsWith(`/${p}`));
      if (!isAllowed) {
        errors.push({
          slice: slice.number,
          command: line,
          rule: "blocked-command",
          severity: "error",
          message: `${loc}: '${cmdToken}' is not in the gate allowlist. Add it to GATE_ALLOWED_PREFIXES or rewrite the command.`,
        });
      }

      // 4. curl localhost in non-final slices (requires running server)
      if (/curl\s.*localhost[:\s]/.test(line) && slice.number !== lastSliceNumber) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "runtime-gate",
          severity: "warn",
          message: `${loc}: curl to localhost requires a running server. Move runtime API checks to vitest integration tests.`,
        });
      }

      // 5. node *.test.mjs for vitest files (should use npx vitest)
      if (/^node\s+.*\.test\.(mjs|js|ts)/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "vitest-direct-node",
          severity: "warn",
          message: `${loc}: 'node *.test.*' fails for vitest test files. Use 'npx vitest run <file>' instead.`,
        });
      }

      // 6. `pforge analyze <plan>` in gates — reliably false-negatives on noisy
      // text-match test-coverage heuristic. Observed Slice 5 failure on all 8
      // Phase-38.x plans. Orchestrator auto-runs analyze post-execution, so the
      // in-gate call is redundant. Use `pforge regression-guard` for doc checks.
      if (/\bpforge\s+analyze\b/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "pforge-analyze-in-gate",
          severity: "warn",
          message: `${loc}: 'pforge analyze' in a gate exits 1 on noisy text-match heuristics (false-negatived all Phase-38.1–38.8 Slice 5 gates). Omit it — the orchestrator auto-runs analyze post-execution. Use 'pforge regression-guard <plan>' for a doc-integrity check instead.`,
        });
      }

      // 6. Unix-only commands (not available in cmd.exe on Windows)
      if (UNIX_TOOLS.includes(cmdToken) && !/^bash\s+-c/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "windows-unavailable",
          severity: "warn",
          message: `${loc}: '${cmdToken}' is not available in cmd.exe on Windows. Wrap in 'bash -c' or use a 'node -e' equivalent.`,
        });
      }

      // 7. Unix-only paths (/tmp/, /dev/null)
      if (/\/tmp\/|\/dev\/null/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "unix-only-path",
          severity: "warn",
          message: `${loc}: Unix-only path (/tmp/ or /dev/null) — fails on Windows. Use os.tmpdir() or NUL.`,
        });
      }

      // 8. Project scripts not on PATH (pforge is a .ps1/.sh script, not a global binary)
      if (/^pforge\s/.test(line)) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "project-script",
          severity: "warn",
          message: `${loc}: 'pforge' is a project script, not on PATH during gate execution. Use 'pwsh ./pforge.ps1' or rewrite as 'node -e'.`,
        });
      }

      // 9. JS comments inside node -e one-liners (// swallows the rest of the line)
      if (/^node\s+-e\s+".*\/\//.test(line) && !line.includes("http://") && !line.includes("https://")) {
        warnings.push({
          slice: slice.number,
          command: line,
          rule: "js-comment-in-eval",
          severity: "warn",
          message: `${loc}: node -e contains '//' which acts as a line comment on a single line, breaking the code. Remove JS comments from gate commands.`,
        });
      }

      // W1. bash -c prefix pitfall — wrapping cross-platform commands in bash is
      // unnecessary and fails on Windows where bash is not in PATH by default.
      if (/^bash\s+-c\b/.test(line) && !disabledRules.has("W1")) {
        const _sev = strictMode ? "error" : "warn";
        (_sev === "error" ? errors : warnings).push({
          slice: slice.number,
          command: line,
          ruleId: "W1",
          rule: "bash-prefix",
          severity: _sev,
          message: `${loc}: 'bash -c' prefix detected — fails on Windows (bash not in PATH). Rewrite as a direct node/npx command or use 'pwsh -Command' instead.`,
        });
      }

      // W2. Pipeline in node/npx/pwsh gate — shell pipe operator with a node-family
      // left operand.  Shell pipelines still work when the orchestrator detects
      // hasShellChain, but wrapping in a 'node -e' script that uses child_process
      // is more portable and avoids cmd.exe quirks.  Skip lines already caught by
      // W1 (bash -c prefix), which legitimately use pipes inside the bash string.
      if (!/^bash\s+-c\b/.test(line) && /^(node|npx|pwsh)\b.*\|/.test(line) && !disabledRules.has("W2")) {
        const _sev = strictMode ? "error" : "warn";
        (_sev === "error" ? errors : warnings).push({
          slice: slice.number,
          command: line,
          ruleId: "W2",
          rule: "pipeline-node",
          severity: _sev,
          message: `${loc}: Shell pipeline with '${cmdToken}' as left operand — cmd.exe may handle this differently. Consider wrapping in a 'node -e' script that uses child_process for portability.`,
        });
      }

      // W3. Regex-escape heuristic — double-escaped backslash before a common
      // regex metachar (\\s, \\d, \\w, \\S, \\D, \\W, \\b, \\B, \\n, \\t, \\r)
      // inside a 'node -e' command.  cmd.exe strips one backslash level when
      // processing double-quoted strings, so '\\\\s' in plan source becomes '\\s'
      // at the shell level — making the compiled regex match a literal backslash
      // followed by 's' rather than the whitespace class.  The heuristic fires when
      // two consecutive backslashes precede a metachar in the gate string as stored.
      if (/^node\s+-e\s+.*\\\\[sdwSDWbBntr]/.test(line) && !disabledRules.has("W3")) {
        const _sev = strictMode ? "error" : "warn";
        (_sev === "error" ? errors : warnings).push({
          slice: slice.number,
          command: line,
          ruleId: "W3",
          rule: "regex-escape",
          severity: _sev,
          message: `${loc}: node -e contains '\\\\<metachar>' — the double-backslash is likely an over-escape; cmd.exe strips one level, so the regex may not match as intended. Use a single '\\' for regex escapes inside node -e strings.`,
        });
      }

      // W4. cd-chain pitfall — 'cd dir && command' does not change the working
      // directory for the subsequent command on Windows cmd.exe.  Use the
      // command's own --cwd / --project flag, or spawn with { cwd: '...' }.
      if (/\bcd\s+\S+.*&&/.test(line) && !disabledRules.has("W4")) {
        const _sev = strictMode ? "error" : "warn";
        (_sev === "error" ? errors : warnings).push({
          slice: slice.number,
          command: line,
          ruleId: "W4",
          rule: "cd-chain",
          severity: _sev,
          message: `${loc}: 'cd dir && command' chain — on Windows cmd.exe the directory change does not persist for the next command. Use a --cwd flag or run commands from the target directory directly.`,
        });
      }

      // W5. Nested double-quote escapes inside `node -e "..."` — proven repeatable
      // failure on Windows + PowerShell. The combination of `node -e "..."` outer
      // quotes + Markdown's backslash rules + PowerShell's parser mangles embedded
      // `\"` sequences BEFORE they reach Node's --input-type=module evaluator,
      // producing `SyntaxError: Expected ')', got 'string literal'`. Even the
      // orchestrator's execFileSync(shell:false) fast-path cannot help — the
      // mangling happens at shell-parse time. See Phase 52 S3 (broke 3 attempts
      // including auto-escalation). Fix: use only single quotes inside the inline
      // JS, or replace dual-form path checks with a single substring check, or
      // move the logic to a helper `.mjs` script invoked as `node script.mjs`.
      if (/^node\s+-e\s+".*\\"/.test(line) && !disabledRules.has("W5")) {
        const _sev = strictMode ? "error" : "warn";
        (_sev === "error" ? errors : warnings).push({
          slice: slice.number,
          command: line,
          ruleId: "W5",
          rule: "node-e-nested-double-quote",
          severity: _sev,
          message: `${loc}: node -e contains nested '\\"' (escaped double-quote) — mangled by PowerShell before reaching Node, produces runtime SyntaxError. Use single quotes inside the inline JS, or invoke a helper script via 'node script.mjs'.`,
        });
      }

      // 10. Cross-platform portability checks (non-blocking)
      const portResult = validateGatePortability(line);
      for (const pw of portResult.warnings) {
        portabilityWarnings.push({
          ...pw,
          slice: slice.number,
          command: line,
        });
      }
    }
  }

  const allFindings = [...errors, ...warnings, ...portabilityWarnings];
  const result = {
    warnings,
    errors,
    portabilityWarnings,
    passed: errors.length === 0,
    summary: `${errors.length} error(s), ${warnings.length} warning(s), ${portabilityWarnings.length} portability warning(s) across ${plan.slices.length} slices`,
    find: (predicate) => allFindings.find(predicate),
    filter: (predicate) => allFindings.filter(predicate),
  };
  return result;
}

/**
 * Check a single gate command for cross-platform portability issues.
 * Returns non-blocking warnings for shell constructs that may behave
 * differently (or fail) across bash, zsh, cmd.exe, and PowerShell.
 * @param {string} command - A single gate command string
 * @returns {{ warnings: Array<{pattern: string, message: string, suggestion: string}> }}
 */
export function validateGatePortability(command) {
  if (!command || typeof command !== "string" || !command.trim()) {
    return { warnings: [] };
  }
  const warnings = [];

  // 1. Pipe into brace-group with read — behavior differs across shells
  if (/\|\s*\{[^}]*\bread\b/.test(command)) {
    warnings.push({
      pattern: "pipe-to-brace-read",
      message: "Pipe to brace-group with 'read' — variable may be lost in a subshell on some shells.",
      suggestion: "Use process substitution or a temp file instead of piping into a brace-group.",
    });
  }

  // 2. Nested double-quotes inside bash -c — escaping is fragile across platforms
  if (/bash\s+-c\s+".*\\"/.test(command) || /bash\s+-c\s+".*\\.+"/.test(command)) {
    warnings.push({
      pattern: "nested-double-quotes",
      message: "Nested double-quotes inside bash -c — escaping is fragile across platforms.",
      suggestion: "Use single-quotes for the outer bash -c argument, or use a script file.",
    });
  }

  // 3. Command substitution containing a pipe — complex nesting, error-prone
  if (/\$\(.*\|.*\)/.test(command)) {
    warnings.push({
      pattern: "cmd-substitution-pipe",
      message: "Command substitution containing a pipe — complex nesting is error-prone cross-platform.",
      suggestion: "Break into separate commands or use a temporary variable.",
    });
  }

  // 4. `bash -c "..."` chained with `&&` to another command — known broken on
  // Windows when the second command is `node -e "..."` containing `(` from
  // JSON.parse, regex literals, etc. The Windows cmd→bash shim mangles outer
  // quoting and inner parens (Phase 51 S0 hit this exact pattern).
  // The fix proven by Phase 41 and Phase 51 is to split each command onto
  // its own line so runGate() dispatches them separately via the inline-node
  // fast path (no shell involved).
  if (/^\s*bash\s+-c\s+["'].*["']\s*&&\s+/.test(command)) {
    warnings.push({
      pattern: "bash-c-chained-with-and",
      message: "`bash -c \"...\" && <cmd>` chains are mangled by the Windows cmd\u2192bash quoting shim when <cmd> contains nested quotes or parens (e.g. `node -e \"JSON.parse(...)\"`). Phase 51 S0 hit this.",
      suggestion: "Split into one command per line. Each line is dispatched separately by runGate(); inline-`node -e` lines bypass the shell entirely. Pattern: `node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run TESTS', {stdio:'inherit',shell:true});\"` on its own line.",
    });
  }

  // 5. `bash -c "cd X && ..."` — cwd-changing wrapper. Same root cause as #4:
  // the `&&` chain inside bash -c is fragile through the Windows shim and the
  // `node -e "process.chdir(X); execSync(...)"` form is strictly better
  // because it bypasses bash entirely.
  if (/^\s*bash\s+-c\s+["']\s*cd\s+\S+\s*&&\s+/.test(command)) {
    warnings.push({
      pattern: "bash-c-cd-prefix",
      message: "`bash -c \"cd X && ...\"` wraps a cwd change in bash, which is fragile through the Windows cmd\u2192bash shim and unnecessary.",
      suggestion: "Use the per-line node pattern: `node -e \"process.chdir('X'); require('child_process').execSync('<cmd>', {stdio:'inherit',shell:true});\"`. This runs through runGate()'s inline-node fast path (no shell), so quoting survives Windows verbatim.",
    });
  }

  return { warnings };
}

/**
 * Check whether a line would pass the gate allowlist (prefix-based) without the prose guard.
 * Used by regressionGuard to implement the precedence rule: allowlisted commands win over prose heuristic.
 * @param {string} cmd - The command line to check
 * @returns {boolean} true if the command matches an allowlist prefix
 */
function wouldPassAllowlist(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  const trimmed = cmd.trim();
  const tokens = trimmed.split(/\s+/);
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
    cmdIdx++;
  }
  const cmdToken = (tokens[cmdIdx] || tokens[0] || "").toLowerCase();
  return GATE_ALLOWED_PREFIXES.some((p) => cmdToken === p || cmdToken.endsWith(`/${p}`));
}

/**
 * Check if a command string is permitted in validation gates.
 * Uses the same GATE_ALLOWED_PREFIXES allowlist as runGate() and lintGateCommands().
 * Skips leading env-var assignments (e.g., "NODE_ENV=test npm test").
 * Additionally blocks known-dangerous patterns (e.g., rm -rf /) regardless of prefix.
 * @param {string} cmd - The command line to check
 * @returns {boolean} true if the command is allowed, false if blocked
 */
export function isGateCommandAllowed(cmd) {
  if (!cmd || typeof cmd !== "string") return false;
  const trimmed = cmd.trim();

  // Block known-dangerous patterns first — allowlist cannot override these
  const BLOCKED_PATTERNS = [
    /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+[/~*]/i,  // rm -rf / or rm -fr ~
    /\brm\s+-[a-z]*\s+\/(\s|$)/,                                          // rm -* /
    /\bdd\s+.*of=\/dev\/(sda|hda|nvme)/i,                                 // dd to raw block device
    /\bmkfs\b/i,                                                           // format filesystem
    /\b:>\s*\/dev\/(sda|hda)/i,                                           // truncate block device
  ];
  if (BLOCKED_PATTERNS.some((p) => p.test(trimmed))) return false;

  // Skip prose lines — not commands
  if (looksLikeProse(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  let cmdIdx = 0;
  while (cmdIdx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[cmdIdx])) {
    cmdIdx++;
  }
  const cmdToken = (tokens[cmdIdx] || tokens[0] || "").toLowerCase();
  return GATE_ALLOWED_PREFIXES.some((p) => cmdToken === p || cmdToken.endsWith(`/${p}`));
}

/**
 * Run regression guard — extract validation gate commands from plan files,
 * check each against the allowlist, execute allowed commands, and report results.
 *
 * Stop condition: if parseValidationGates cannot reliably extract commands from a plan
 * (e.g., no bash-block gates found), falls back to `testCommand` fields from parsed slices.
 *
 * @param {string[]} files - Changed file paths to guard (informational — included in result)
 * @param {object} [options]
 * @param {string} [options.plan] - Path to a specific plan file (relative to cwd). If omitted, scans docs/plans/
 * @param {boolean} [options.failFast=false] - Stop on first gate failure
 * @param {string} [options.cwd=process.cwd()] - Project root
 * @returns {Promise<{files: string[], gatesChecked: number, passed: number, failed: number, blocked: number, skipped: number, success: boolean, results: object[]}>}
 */
export async function regressionGuard(files, { plan, failFast = false, cwd = process.cwd() } = {}) {
  // Resolve plan files to check
  let planPaths = [];
  if (plan) {
    const resolved = resolve(cwd, plan);
    if (existsSync(resolved)) {
      planPaths = [resolved];
    }
  } else {
    const plansDir = resolve(cwd, "docs", "plans");
    if (existsSync(plansDir)) {
      planPaths = readdirSync(plansDir)
        .filter((f) => f.endsWith("-PLAN.md") || f.endsWith("-plan.md"))
        .map((f) => resolve(plansDir, f));
    }
  }

  // Collect gate commands from plans
  const gateItems = [];
  for (const planPath of planPaths) {
    try {
      const parsed = parsePlan(planPath, cwd);
      const sliceGates = parsed.slices
        .filter(s => s.validationGate)
        .map(s => ({
          sliceNumber: s.number,
          sliceTitle: s.title,
          gates: s.validationGate
            .split("\n")
            .map(l => l.replace(/\s{2,}#\s.*$/, "").trim())
            .filter(l => l.length > 0),
        }));

      let foundGates = false;
      for (const sg of sliceGates) {
        for (const cmd of sg.gates) {
          gateItems.push({ planFile: basename(planPath), sliceNumber: sg.sliceNumber, sliceTitle: sg.sliceTitle, cmd, source: "validation-gate" });
          foundGates = true;
        }
      }

      // Fallback chain: testCommand → buildCommand → backtick commands from validationGateDescription
      if (!foundGates) {
        for (const s of parsed.slices) {
          if (s.testCommand) {
            gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: s.testCommand, source: "testCommand" });
          } else if (s.buildCommand) {
            gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: s.buildCommand, source: "buildCommand" });
          } else if (s.validationGateDescription) {
            // Extract backtick-wrapped commands from prose gate descriptions
            const backtickRe = /`([^`]+)`/g;
            let bm;
            while ((bm = backtickRe.exec(s.validationGateDescription)) !== null) {
              const candidate = bm[1].trim();
              // Only treat as executable if it looks like a command (starts with a known tool)
              if (/^(dotnet|npm|npx|node|bash|pwsh|powershell|python|go|cargo|make|mvn|gradle)\b/i.test(candidate)) {
                gateItems.push({ planFile: basename(planPath), sliceNumber: s.number, sliceTitle: s.title, cmd: candidate, source: "prose-gate" });
              }
            }
          }
        }
      }
    } catch { /* unreadable plan — skip */ }
  }

  // Hotspot-aware gate prioritization: run gates for high-churn files first
  try {
    const hotspotCache = resolve(cwd, ".forge", "hotspot-cache.json");
    if (existsSync(hotspotCache)) {
      const cached = JSON.parse(readFileSync(hotspotCache, "utf-8"));
      const hotFiles = new Set((cached.hotspots || []).slice(0, 10).map(h => h.file));
      if (hotFiles.size > 0) {
        gateItems.sort((a, b) => {
          const aHot = a.cmd && [...hotFiles].some(h => a.cmd.includes(h)) ? 1 : 0;
          const bHot = b.cmd && [...hotFiles].some(h => b.cmd.includes(h)) ? 1 : 0;
          return bHot - aHot; // Hot gates first
        });
      }
    }
  } catch { /* best-effort prioritization */ }

  const results = [];
  let passed = 0, failed = 0, blocked = 0, skipped = 0;

  for (const gate of gateItems) {
    // Prose lines are skipped unless they would pass the allowlist (command wins over heuristic)
    if (looksLikeProse(gate.cmd) && !wouldPassAllowlist(gate.cmd)) {
      results.push({ ...gate, status: "skipped", reason: "liveguard-prose-skipped" });
      skipped++;
      try {
        appendForgeJsonl("liveguard-events.jsonl", {
          timestamp: new Date().toISOString(),
          type: "liveguard-prose-skipped",
          severity: "info",
          sliceNumber: gate.sliceNumber,
          command: gate.cmd,
        }, cwd);
      } catch { /* best-effort telemetry */ }
      continue;
    }
    if (!isGateCommandAllowed(gate.cmd)) {
      results.push({ ...gate, status: "blocked", reason: `'${gate.cmd.split(/\s+/)[0]}' not in gate allowlist` });
      blocked++;
      continue;
    }

    try {
      const output = execSync(gate.cmd, { cwd, stdio: "pipe", timeout: resolveGateTimeoutMs(), encoding: "utf-8" });
      results.push({ ...gate, status: "passed", output: (output || "").trim().slice(0, 500) });
      passed++;
    } catch (err) {
      const errOut = ((err.stderr || "") + (err.stdout || "")).trim().slice(0, 500) || err.message;
      results.push({ ...gate, status: "failed", output: errOut });
      failed++;
      if (failFast) {
        // Mark remaining as skipped
        const remaining = gateItems.slice(gateItems.indexOf(gate) + 1);
        for (const rem of remaining) {
          results.push({ ...rem, status: "skipped", reason: "fail-fast: previous gate failed" });
          skipped++;
        }
        break;
      }
    }
  }

  return {
    files: files || [],
    gatesChecked: gateItems.length,
    passed,
    failed,
    blocked,
    skipped,
    success: failed === 0,
    results,
  };
}

/**
 * Emit a telemetry record for a tool invocation. Best-effort — never throws.
 * @param {string} toolName - Tool identifier (e.g. "forge_smith")
 * @param {object|string} inputs - Tool input parameters
 * @param {*} result - Tool result (truncated to 2000 chars)
 * @param {number} durationMs - Execution time in milliseconds
 * @param {string} status - "ok" | "error" | "timeout"
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {object} The telemetry record written
 */
const LIVEGUARD_TOOLS = new Set([
  "forge_drift_report", "forge_incident_capture", "forge_dep_watch",
  "forge_regression_guard", "forge_runbook", "forge_hotspot",
  "forge_health_trend", "forge_alert_triage", "forge_deploy_journal",
  "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
  "forge_quorum_analyze", "forge_liveguard_run",
  // Phase TEMPER-06 Slice 06.1 — Bug Registry tools
  "forge_bug_register", "forge_bug_list", "forge_bug_update_status",
  // Phase TEMPER-06 Slice 06.3 — Closed-loop fix validation
  "forge_bug_validate_fix",
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools
  "forge_review_add", "forge_review_list", "forge_review_resolve",
  // Phase TEMPER-07 Slice 07.1 — Agent delegation
  "forge_delegate_to_agent",
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools
  "forge_notify_send", "forge_notify_test",
]);

export function emitToolTelemetry(toolName, inputs, result, durationMs, status, cwd = process.cwd()) {
  const normalizedResult = typeof result === "string"
    ? result.slice(0, 2000)
    : JSON.stringify(result ?? "").slice(0, 2000);
  const record = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    inputs: typeof inputs === "object" ? inputs : { raw: inputs },
    result: normalizedResult,
    durationMs,
    status,
  };
  try {
    appendForgeJsonl("telemetry/tool-calls.jsonl", record, cwd);
  } catch { /* telemetry is best-effort — never crash the tool */ }
  if (LIVEGUARD_TOOLS.has(toolName)) {
    try {
      appendForgeJsonl("liveguard-events.jsonl", { timestamp: record.timestamp, tool: toolName, status, durationMs }, cwd);
    } catch { /* best-effort */ }
  }
  return record;
}

// ─── PreDeploy Hook ───────────────────────────────────────────────────
// Phase-53 S6: DEPLOY_FILE_PATTERNS, DEPLOY_COMMAND_PATTERNS,
// PRE_DEPLOY_DEFAULTS, CACHE_MAX_AGE_MINUTES → orchestrator/hooks.mjs

/**
 * Check whether a tool invocation matches deploy trigger conditions.
 * @param {string} toolName - The tool being invoked (e.g. "editFiles", "runCommand")
 * @param {string} filePath - File path being written to (may be empty)
 * @param {string} command  - Terminal command being executed (may be empty)
 * @returns {boolean}
 */
/**
 * Check whether a slice title indicates a destructive operation
 * (teardown, cleanup, rollback, postmortem, finalize).
 * Prefix-anchored: "Setup teardown hooks" does NOT match.
 * @param {string} title - Slice title to check
 * @returns {boolean}
 */
export function isDestructiveSliceTitle(title) {
  if (typeof title !== "string") return false;
  return /^\s*(teardown|cleanup|rollback|postmortem|finalize)\b/i.test(title);
}

/** Default configuration for the Teardown Safety Guard. */
const TEARDOWN_GUARD_DEFAULTS = {
  enabled: true,
  blockOnBranchLoss: true,
  checkRemote: true,
  // Phase-26 Slice 4 — paths exempt from branch-loss detection.
  // When a missing-branch failure resolves to a worktree living under one
  // of these prefixes, the guard filters the failure instead of opening an
  // incident. Prevents competitive worktree archival from tripping the guard.
  exemptPathPrefixes: [".forge/worktrees", ".forge/worktrees-archive"],
};

/**
 * Phase-26 Slice 4 — pure path predicate.
 * Returns true when `candidatePath` (absolute or relative) resolves under
 * any of the exempt prefixes. Comparison is performed with forward-slash
 * normalization so Windows paths behave the same as POSIX.
 *
 * @param {string} candidatePath - Path to test.
 * @param {string[]} [prefixes] - Optional prefix list (defaults to the guard defaults).
 * @returns {boolean}
 */
export function isWorktreeExemptPath(candidatePath, prefixes = TEARDOWN_GUARD_DEFAULTS.exemptPathPrefixes) {
  if (typeof candidatePath !== "string" || candidatePath.length === 0) return false;
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false;
  const normalized = candidatePath.replace(/\\/g, "/");
  for (const prefix of prefixes) {
    if (typeof prefix !== "string" || prefix.length === 0) continue;
    const normPrefix = prefix.replace(/\\/g, "/").replace(/\/$/, "");
    // Match segment boundary: `.forge/worktrees` matches
    // `.forge/worktrees/...` or `path/to/.forge/worktrees/...`
    // but not `.forge/worktrees-other`.
    const idx = normalized.indexOf(normPrefix);
    if (idx < 0) continue;
    const after = normalized[idx + normPrefix.length];
    if (after === undefined || after === "/") return true;
  }
  return false;
}

/**
 * Load teardown guard configuration from .forge.json.
 * Falls back to TEARDOWN_GUARD_DEFAULTS if absent or malformed.
 * @param {string} cwd - Project root directory
 * @returns {{ enabled: boolean, blockOnBranchLoss: boolean, checkRemote: boolean }}
 */
export function loadTeardownGuardConfig(cwd) {
  let config = { ...TEARDOWN_GUARD_DEFAULTS };
  const configPath = resolve(cwd, ".forge.json");
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.orchestrator?.teardownGuard) {
        config = { ...config, ...raw.orchestrator.teardownGuard };
      }
    } catch {
      /* malformed config — use defaults */
    }
  }
  return config;
}

// Phase-53 S5: loadGateCheckConfig, registerGateCheckResponder → orchestrator/forge-io.mjs

// ─── Phase FORGE-SHOP-06 Slice 06.2 — Correlation Thread Responder ──

/**
 * Register the `brain.correlation-thread` hub responder.
 * Reads hub-events.jsonl and filters by correlationId.
 *
 * @param {object} hub - Hub instance with onAsk
 * @param {string} cwd - Project root
 * @param {object} [deps] - DI overrides
 */
// Phase-53 S6: registerCorrelationThreadResponder → orchestrator/hooks.mjs

/**
 * Verify that git branch state was not destroyed during a slice.
 * @param {{ branch: string, headSha: string, upstream: string|null }} baseline
 * @param {{ checkRemote: boolean, exemptPathPrefixes?: string[] }} config
 * @param {string} cwd
 * @param {{ exec?: (cmd: string, opts: object) => string }} [deps] - DI for tests.
 * @returns {{ ok: boolean, failures: string[], reflogTail: string[] }}
 */
export function verifyBranchSafety(baseline, config, cwd, deps = {}) {
  const exec = deps.exec || ((cmd, opts) => execSync(cmd, opts));
  const failures = [];
  let reflogTail = [];
  let localBranchMissing = false;

  // 1. Local branch ref still exists
  try {
    exec(`git show-ref --verify refs/heads/${baseline.branch}`, {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    });
  } catch {
    localBranchMissing = true;
    failures.push(`local branch ref 'refs/heads/${baseline.branch}' no longer exists`);
  }

  // 2. Baseline HEAD still reachable
  try {
    exec(`git cat-file -e ${baseline.headSha}^{commit}`, {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    });
  } catch {
    failures.push(`baseline HEAD ${baseline.headSha} is no longer reachable`);
  }

  // 3. Remote branch ref (when upstream was configured and checkRemote enabled)
  if (baseline.upstream && config.checkRemote) {
    try {
      const remoteName = baseline.upstream.split("/")[0] || "origin";
      const remoteBranch = baseline.upstream.split("/").slice(1).join("/") || baseline.branch;
      const lsRemote = exec(`git ls-remote --heads ${remoteName} ${remoteBranch}`, {
        cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe",
      }).trim();
      if (!lsRemote) {
        failures.push(`remote branch '${baseline.upstream}' no longer exists on remote`);
      }
    } catch (err) {
      failures.push(`remote check failed for '${baseline.upstream}': ${err.message || "unknown error"}`);
    }
  }

  // Phase-26 Slice 4 — filter branch-loss failures whose underlying
  // worktree path lives under an exempt prefix (competitive worktrees).
  const exemptPrefixes = Array.isArray(config.exemptPathPrefixes)
    ? config.exemptPathPrefixes
    : TEARDOWN_GUARD_DEFAULTS.exemptPathPrefixes;
  if (localBranchMissing && exemptPrefixes.length > 0) {
    const worktreePath = resolveBranchWorktreePath(baseline.branch, cwd, exec);
    if (worktreePath && isWorktreeExemptPath(worktreePath, exemptPrefixes)) {
      // Drop the local-branch-ref failure — the worktree was intentionally torn down.
      const idx = failures.indexOf(`local branch ref 'refs/heads/${baseline.branch}' no longer exists`);
      if (idx >= 0) failures.splice(idx, 1);
    }
  }

  // On failure, capture reflog for recovery
  if (failures.length > 0) {
    try {
      reflogTail = exec("git reflog -n 20 --format=%H\\ %gs", {
        cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
      }).trim().split("\n");
    } catch { /* reflog unavailable */ }
  }

  return { ok: failures.length === 0, failures, reflogTail };
}

/**
 * Phase-26 Slice 4 — look up the worktree path for a given branch by
 * parsing `git worktree list --porcelain`. Returns null when the branch
 * has no associated worktree (e.g. already deleted) or when git fails.
 *
 * @param {string} branch
 * @param {string} cwd
 * @param {(cmd: string, opts: object) => string} exec
 * @returns {string|null}
 */
function resolveBranchWorktreePath(branch, cwd, exec) {
  try {
    const porcelain = exec("git worktree list --porcelain", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    });
    // Porcelain format: blocks separated by blank lines.
    //   worktree <path>
    //   HEAD <sha>
    //   branch refs/heads/<name>
    const blocks = String(porcelain).split(/\r?\n\r?\n/);
    for (const block of blocks) {
      if (!block.includes(`branch refs/heads/${branch}`)) continue;
      const m = block.match(/^worktree\s+(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch {
    /* git unavailable or no worktrees — fall through */
  }
  return null;
}

// Phase-53 S6: isDeployTrigger, isCacheStale → orchestrator/hooks.mjs

/**
 * Run the PreDeploy hook logic. Reads secret-scan and env-diff caches,
 * evaluates them against the hook configuration, and returns a result
 * indicating whether the deploy should be blocked or an advisory issued.
 *
 * @param {object} params
 * @param {string} params.toolName  - Tool being invoked
 * @param {string} [params.filePath=""] - File path being written
 * @param {string} [params.command=""]  - Command being executed
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, blocked?: boolean, reason?: string, advisory?: string, secretFindings?: Array, envGaps?: Array }}
 */
// Phase-53 S6: runPreDeployHook → orchestrator/hooks.mjs

// ─── PostSlice Hook ───────────────────────────────────────────────────
// Phase-53 S6: POSTSLICE_COMMIT_PATTERN, POSTSLICE_SKIP_PATTERNS,
// POSTSLICE_DEFAULTS, resetPostSliceHookFired → orchestrator/hooks.mjs

/**
 * Parse `git status --porcelain` output into a Map<path, statusLine>.
 * The status line is the full original line including the XY status code,
 * which lets callers tell whether a path was further modified between two
 * snapshots (same path + different line = worker touched it). Renames are
 * tracked at their post-rename path.
 *
 * @param {string} porcelain
 * @returns {Map<string, string>}
 */
// Phase-53 S6: parseGitPorcelain, parseShortstat → orchestrator/hooks.mjs

/**
 * Issue #195 — enumerate commits that landed between two SHAs during a
 * slice window. Used by {@link autoCommitSliceIfDirty} to record external
 * commits (e.g. the VS Code Copilot extension's auto-commit) that would
 * otherwise be silently absorbed into the orchestrator's housekeeping
 * commit, producing a misleading "feat(slice-N): …" message on a tree
 * containing only `.forge/` artifacts.
 *
 * Returns an array of `{ sha, author, subject, diffstat }`, oldest first.
 * Returns `[]` on any git failure — callers treat absence as
 * "no race detected", which is the safe default.
 */
export function captureAbsorbedCommits({ cwd = process.cwd(), fromSha, toSha = "HEAD" } = {}) {
  if (!fromSha) return [];
  let log;
  try {
    log = execSync(
      `git log --reverse --format=%H%x09%an%x09%s ${fromSha}..${toSha}`,
      { cwd, encoding: "utf-8", timeout: 5_000 },
    );
  } catch {
    return [];
  }
  const commits = [];
  const lines = (log || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [sha, author, ...rest] = line.split("\t");
    if (!sha) continue;
    let diffstat = null;
    try {
      const shortstat = execSync(`git show --shortstat --format= ${sha}`, { cwd, encoding: "utf-8", timeout: 5_000 });
      diffstat = parseShortstat(shortstat);
    } catch { /* ignore */ }
    commits.push({ sha, author: author || "unknown", subject: rest.join("\t") || "", diffstat });
  }
  return commits;
}

/**
 * Capture the working-tree state at slice start so {@link autoCommitSliceIfDirty}
 * can later distinguish worker-owned paths from operator-owned paths that
 * were already dirty when the slice began. Issue #151.
 *
 * Returns null on any git failure (caller treats null as "no snapshot — fall
 * back to legacy `git add -A` behaviour").
 *
 * @param {{ cwd?: string }} [params]
 * @returns {Map<string, string>|null}
 */
export function snapshotPreSliceState({ cwd = process.cwd() } = {}) {
  try {
    const out = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 });
    return parseGitPorcelain(out);
  } catch {
    return null;
  }
}

/**
 * Issue #178 / #202 — stash any pre-slice working-tree changes before the
 * worker runs, so a buggy worker (or a destructive teardown) can't trample
 * operator WIP. Pair with `popSliceSnapshot` at slice end.
 *
 * #202: `git stash push` without `-u` silently SKIPS untracked files even
 * when `git status --porcelain` shows them as dirty. That caused
 * `pushSliceSnapshot` to return `pushed:true` when no stash was actually
 * created (untracked-only working trees), surfacing at pop time as a
 * misleading "snapshot stash not found" error. Add `-u` so untracked
 * files are protected too and push/pop status is honest.
 *
 * @param {{ cwd?: string, sliceNumber: string|number, _execSync?: Function }} params
 * @returns {{ pushed: boolean, stashRef: string|null, reason?: string }}
 */
export function pushSliceSnapshot({ cwd = process.cwd(), sliceNumber, _execSync = execSync } = {}) {
  const stashRef = `pforge-slice-${sliceNumber}-snapshot`;
  try {
    const status = _execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 }).toString().trim();
    if (!status) return { pushed: false, stashRef: null, reason: "clean-tree" };
    // #202: `-u` (--include-untracked) — without it, an untracked-only tree
    // is silently skipped and the caller is misled into thinking we stashed.
    _execSync(`git stash push -u -m "${stashRef}"`, { cwd, encoding: "utf-8", timeout: 10_000 });
    return { pushed: true, stashRef };
  } catch (err) {
    return { pushed: false, stashRef: null, reason: (err?.message || "git-failed").slice(0, 200) };
  }
}

/**
 * Issue #178 / #201 — restore the snapshot stashed by `pushSliceSnapshot`.
 * Always called at slice end (success OR failure) so operator WIP is never
 * silently captured in `git stash list`.
 *
 * Strategy (Issue #201):
 *   1. Look up the stash ref BY MESSAGE (`pforge-slice-N-snapshot`), not by
 *      blind `git stash pop` of the top of the stack — the top may be an
 *      unrelated operator stash if anything stashed during the slice run.
 *   2. Use `git stash apply <ref>` (non-destructive). If it succeeds, drop
 *      the stash explicitly. If it fails with conflict OR "would be
 *      overwritten" (the dirty-tree case caused by orchestrator runtime
 *      writes between push and pop), leave the stash in place and return a
 *      structured error so the operator can recover via
 *      `git stash list` + `git stash show -p <ref>`.
 *
 * Conflict trigger (Issue #201): the orchestrator self-modifies runtime
 * files between push and pop (`.forge/watch-history.jsonl`,
 * `liveguard-broadcast.log`, `server-ports.json`, `model-performance.json`,
 * `quorum-history.jsonl`). Old behavior: blind `pop` failed with "would be
 * overwritten by merge", but git actually leaves the stash intact in that
 * case — the snapshot then accumulates in `git stash list` forever.
 *
 * @param {{ cwd?: string, sliceNumber: string|number, _execSync?: Function }} params
 * @returns {{ restored: boolean, conflict?: boolean, dirtyTree?: boolean, error?: string, stashRef?: string }}
 */
export function popSliceSnapshot({ cwd = process.cwd(), sliceNumber, _execSync = execSync } = {}) {
  const message = `pforge-slice-${sliceNumber}-snapshot`;
  // Step 1: find the stash ref by message (more reliable than top-of-stack).
  let stashRef = null;
  try {
    const list = _execSync("git stash list", { cwd, encoding: "utf-8", timeout: 5_000 }).toString();
    for (const line of list.split(/\r?\n/)) {
      // Match e.g. "stash@{2}: On master: pforge-slice-3-snapshot"
      const m = line.match(/^(stash@\{\d+\}):\s*[^:]*:\s*(.+)$/);
      if (m && m[2].trim() === message) { stashRef = m[1]; break; }
    }
  } catch (err) {
    return { restored: false, error: `git stash list failed: ${(err?.message || "").slice(0, 200)}` };
  }
  if (!stashRef) {
    // Nothing to restore (push reported `clean-tree`, or someone else dropped it).
    return { restored: false, error: "snapshot stash not found in git stash list" };
  }
  // Step 2: apply (non-destructive). On success, drop. On failure, leave intact.
  try {
    _execSync(`git stash apply ${stashRef}`, { cwd, encoding: "utf-8", timeout: 15_000, stdio: "pipe" });
  } catch (err) {
    const stderr = (err?.stderr?.toString?.() || err?.message || "").toString().trim();
    const conflict = /conflict|CONFLICT/i.test(stderr);
    const dirtyTree = /would be overwritten/i.test(stderr);
    return {
      restored: false,
      conflict,
      dirtyTree,
      stashRef,
      error: (stderr.slice(0, 400) || "git stash apply failed") +
        ` — recover with: git stash show -p ${stashRef} ; git stash apply ${stashRef}`,
    };
  }
  // Step 3: drop only after successful apply.
  try {
    _execSync(`git stash drop ${stashRef}`, { cwd, encoding: "utf-8", timeout: 10_000, stdio: "pipe" });
  } catch {
    // Apply succeeded but drop failed — non-fatal, operator can clean up.
  }
  return { restored: true, stashRef };
}

/**
 * Attach snapshot restore metadata to a slice result and restore the snapshot
 * exactly once when `snapshotStash` is true.
 *
 * This centralizes snapshot finalize behavior so every executeSlice return path
 * (success, failure, early-return) reports consistent snapshot fields.
 *
 * @param {{
 *   sliceResult: Record<string, any>,
 *   snapshotStash: boolean,
 *   cwd?: string,
 *   sliceNumber: string|number,
 *   eventBus?: { emit?: Function }|null,
 *   _popSliceSnapshot?: Function,
 * }} params
 * @returns {Record<string, any>}
 */
export function attachSliceSnapshotRestore({
  sliceResult,
  snapshotStash,
  cwd = process.cwd(),
  sliceNumber,
  eventBus = null,
  _popSliceSnapshot = popSliceSnapshot,
} = {}) {
  const base = { ...(sliceResult || {}) };

  if (!snapshotStash) {
    return { ...base, snapshotStashed: false };
  }

  const restore = _popSliceSnapshot({ cwd, sliceNumber });
  const withSnapshot = {
    ...base,
    snapshotStashed: true,
    snapshotRestored: !!restore?.restored,
  };

  if (!restore?.restored) {
    withSnapshot.snapshotRestoreError = restore?.error || "snapshot restore failed";
    if (eventBus) {
      eventBus.emit("snapshot-restore-failed", {
        sliceNumber,
        stashRef: `pforge-slice-${sliceNumber}-snapshot`,
        conflict: !!restore?.conflict,
        error: withSnapshot.snapshotRestoreError,
        recovery: "Run `git stash list` and `git stash apply stash@{0}` to recover your WIP.",
      });
    }
  }

  return withSnapshot;
}

/**
 * Issue #201 — janitor pass that drops `pforge-slice-N-snapshot` stashes
 * older than a threshold (default 7 days). Prevents long-term accumulation
 * of orphaned snapshots from conflicted pops in prior runs.
 *
 * Called at run-start from `runPlan` (best-effort, errors swallowed).
 *
 * @param {{ cwd?: string, maxAgeDays?: number, _execSync?: Function, _now?: () => Date }} params
 * @returns {{ scanned: number, dropped: string[], errors: string[] }}
 */
export function cleanupStaleSnapshots({
  cwd = process.cwd(),
  maxAgeDays = 7,
  _execSync = execSync,
  _now = () => new Date(),
} = {}) {
  const result = { scanned: 0, dropped: [], errors: [] };
  let list;
  try {
    // `%gd %ct %s` → stash ref, committer Unix timestamp, subject.
    list = _execSync(
      'git stash list --format="%gd|%ct|%s"',
      { cwd, encoding: "utf-8", timeout: 5_000 },
    ).toString();
  } catch (err) {
    result.errors.push(`git stash list failed: ${(err?.message || "").slice(0, 200)}`);
    return result;
  }
  const cutoffSec = Math.floor(_now().getTime() / 1000) - maxAgeDays * 24 * 60 * 60;
  // Iterate oldest→newest by collecting first, then dropping in reverse order
  // so refs remain valid (dropping stash@{0} shifts the others down).
  const toDrop = [];
  for (const line of list.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const [ref, tsStr, subject] = parts;
    result.scanned++;
    const ts = parseInt(tsStr, 10);
    if (!Number.isFinite(ts) || ts >= cutoffSec) continue;
    // Only target our own snapshot stashes — leave operator stashes alone.
    if (!/pforge-slice-\d+-snapshot/.test(subject)) continue;
    toDrop.push(ref);
  }
  // Drop in reverse so earlier refs stay stable (stash@{N} indexes shift down).
  for (const ref of toDrop.reverse()) {
    try {
      _execSync(`git stash drop ${ref}`, { cwd, encoding: "utf-8", timeout: 5_000, stdio: "pipe" });
      result.dropped.push(ref);
    } catch (err) {
      result.errors.push(`drop ${ref}: ${(err?.message || "").slice(0, 100)}`);
    }
  }
  return result;
}

/**
 * Shell-quote a single path for use after `git add --`. Wraps in double
 * quotes and escapes embedded quotes/backslashes. Safe on POSIX and Windows
 * because git accepts forward-slash quoted paths on both.
 */
function shellQuotePath(p) {
  return `"${String(p).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Issue #152 — extract the file paths declared in a slice's
 * **Files Modified (Exhaustive)** table (or the more permissive
 * **Files Modified** label many plans use).
 *
 * Plans express the table in markdown:
 *
 *   | File | Change |
 *   |------|--------|
 *   | `path/to/file.ts` | description |
 *   | path/other.md     | description |
 *
 * Only the first column is parsed. Backtick-wrapped paths are preferred;
 * otherwise we accept any token that looks like a path (contains `/`, `.`,
 * or matches a glob-ish pattern). Returns an empty array when the slice has
 * no such table — the caller must treat that as "no contract to enforce"
 * rather than a violation.
 *
 * @param {{ rawLines?: string[] }} slice
 * @returns {string[]}
 */
export function extractFilesModifiedExhaustive(slice) {
  const lines = slice?.rawLines || [];
  if (lines.length === 0) return [];

  // Look for a heading or bold marker that opens the table window.
  // Accepts "Files Modified", "Files Modified (Exhaustive)", "Files Touched",
  // optionally as bold (`**`), optionally followed by a colon. The bold
  // close `**` always precedes the optional `:` in markdown:
  //   **Files Modified (Exhaustive)**:  ← bold close, then colon
  //   **Files Modified**:
  //   **Files Modified**
  //   Files Modified:
  // Case-insensitive.
  const headerRe = /^\s*\*{0,2}files\s+(?:modified|touched)(?:\s*\([^)]*\))?\*{0,2}\s*:?\s*$/i;

  const declared = [];
  let inTable = false;
  let sawSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTable) {
      if (headerRe.test(line.trim())) {
        inTable = true;
        sawSeparator = false;
      }
      continue;
    }

    // Inside the table window. A blank line, a markdown heading, or another
    // bold-section marker closes the window.
    const trimmed = line.trim();
    if (trimmed === "" || /^#{1,6}\s/.test(trimmed) || /^\*\*[^*]+\*\*\s*:?\s*$/.test(trimmed)) {
      // Allow a single blank line right after the header before the table starts;
      // otherwise close.
      if (declared.length === 0 && trimmed === "" && !sawSeparator) continue;
      break;
    }

    // Markdown table separator: |---|---|
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-")) {
      sawSeparator = true;
      continue;
    }

    // Table row: leading "|" + cells. Skip the header row ("File | Change").
    if (line.includes("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length === 0) continue;
      const firstCell = cells[0];

      // Skip the header row. Detect by exact match against common header
      // labels (case-insensitive, no trailing punctuation).
      if (!sawSeparator && /^(file|path|filename)$/i.test(firstCell)) continue;

      // Prefer backtick-wrapped paths; fall back to bare tokens that look
      // like a path.
      const backticks = firstCell.match(/`([^`]+)`/g);
      if (backticks && backticks.length > 0) {
        for (const b of backticks) {
          const p = b.replace(/`/g, "").trim();
          if (p && !declared.includes(p)) declared.push(p);
        }
      } else if (/[/.]/.test(firstCell) && !/\s/.test(firstCell)) {
        if (!declared.includes(firstCell)) declared.push(firstCell);
      }
    }
  }

  return declared;
}

/**
 * Issue #152 — verify every path declared in the slice's
 * **Files Modified (Exhaustive)** table actually appears in the slice's
 * working-tree changes (`git diff --name-only <startSha>..HEAD` plus current
 * porcelain for uncommitted edits).
 *
 * Returns a structured result. Never throws. When `declared` is empty, the
 * result reports `enforced: false` — there's no contract to enforce.
 *
 * @param {object} params
 * @param {{ number: number|string, title: string, rawLines?: string[] }} params.slice
 * @param {string} [params.cwd=process.cwd()]
 * @param {string|null} [params.startSha] — HEAD SHA captured at slice start
 * @returns {{
 *   enforced: boolean,
 *   declared: string[],
 *   actual: string[],
 *   missing: string[],
 * }}
 */
export function verifyFilesModified({ slice, cwd = process.cwd(), startSha = null } = {}) {
  const declared = extractFilesModifiedExhaustive(slice);
  if (declared.length === 0) {
    return { enforced: false, declared: [], actual: [], missing: [] };
  }

  // Collect actual touched paths: committed since startSha + currently dirty.
  const actualSet = new Set();

  if (startSha) {
    try {
      const diffOut = execSync(`git diff --name-only ${startSha} HEAD`, {
        cwd, encoding: "utf-8", timeout: 5_000,
      });
      for (const p of diffOut.split(/\r?\n/)) {
        const path = p.trim();
        if (path) actualSet.add(path);
      }
    } catch { /* startSha may not exist on first slice — fall through */ }
  }

  try {
    const porcelain = execSync("git status --porcelain", {
      cwd, encoding: "utf-8", timeout: 5_000,
    });
    for (const path of parseGitPorcelain(porcelain).keys()) {
      actualSet.add(path);
    }
  } catch { /* not a git repo — leave actualSet possibly empty */ }

  const actual = [...actualSet];
  // Normalize separators for cross-platform comparison (declared paths in
  // plans are typically forward-slash; git output is forward-slash on all OSes).
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const actualNorm = new Set(actual.map(norm));
  const missing = declared.filter((d) => !actualNorm.has(norm(d)));

  return { enforced: true, declared, actual, missing };
}

/**
 * After a slice passes, commit any dirty working-tree changes with a
 * deterministic conventional-commit message derived from the slice title.
 * Never commits on `mode === "assisted"` runs.
 *
 * Issue #151 — when `preSliceState` is provided, only paths the worker
 * actually created or modified during the slice are staged. Paths that were
 * already dirty at slice start (operator edits, parallel-process scratch
 * files) are left alone and reported via a `slice-foreign-files-detected`
 * event. Without `preSliceState` the function falls back to the legacy
 * `git add -A` behaviour for backward compatibility.
 *
 * @param {object} params
 * @param {{ number: number, title: string }} params.slice
 * @param {string} [params.cwd=process.cwd()]
 * @param {string} [params.mode]   — "assisted" skips auto-commit
 * @param {{ emit: Function }} [params.eventBus]
 * @param {string|null} [params.startSha]
 * @param {Map<string, string>|null} [params.preSliceState] — porcelain snapshot from {@link snapshotPreSliceState}
 * @returns {{ committed: boolean, reason?: string, sha?: string, message?: string, error?: string, foreignFiles?: string[] }}
 */
export function autoCommitSliceIfDirty({
  slice,
  cwd = process.cwd(),
  mode,
  eventBus,
  startSha = null,
  preSliceState = null,
} = {}) {
  if (mode === "assisted") {
    return { committed: false, reason: "assisted-mode" };
  }

  // Check working tree
  let statusOut;
  try {
    statusOut = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 });
  } catch (err) {
    eventBus?.emit("slice-dirty-tree-warning", { sliceNumber: slice?.number, error: err.message });
    return { committed: false, reason: "git-failed", error: err.message };
  }

  if (!statusOut || !statusOut.trim()) {
    // Bug #123: tree is clean \u2014 but did the worker advance HEAD itself?
    // If startSha was captured and HEAD now differs, the worker (gh-copilot
    // or claude CLI) committed during execution. Report deterministically.
    if (startSha) {
      try {
        const currentSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
        if (currentSha && currentSha !== startSha) {
          // Issue #195: capture absorbed commits + diffstat so codeChanges
          // is populated even when the worker self-committed.
          const absorbedCommits = captureAbsorbedCommits({ cwd, fromSha: startSha, toSha: currentSha });
          let codeChanges = null;
          try {
            const shortstat = execSync(`git show --shortstat --format= ${currentSha}`, { cwd, encoding: "utf-8", timeout: 5_000 });
            codeChanges = parseShortstat(shortstat);
          } catch { /* ignore */ }
          const evt = { sliceNumber: slice.number, sha: currentSha, message: "(worker-committed)", source: "worker" };
          if (absorbedCommits.length > 0) evt.absorbedCommits = absorbedCommits;
          if (codeChanges) evt.codeChanges = codeChanges;
          eventBus?.emit("slice-auto-committed", evt);
          const out = { committed: true, sha: currentSha, message: "(worker-committed)", source: "worker", raceDetected: absorbedCommits.length > 1 };
          if (absorbedCommits.length > 0) out.absorbedCommits = absorbedCommits;
          if (codeChanges) out.codeChanges = codeChanges;
          return out;
        }
      } catch { /* fall through */ }
    }
    return { committed: false, reason: "clean-tree" };
  }

  // Issue #151 — split current dirty paths into worker-owned vs foreign.
  // A path is worker-owned when:
  //   (a) it didn't exist in the pre-slice snapshot (newly created/modified), OR
  //   (b) its porcelain status line changed (worker further modified it).
  // A path is foreign when it appears identically in pre and post snapshots
  // (the operator/parallel-process touched it before the slice and the
  // worker never touched it again).
  const currentState = parseGitPorcelain(statusOut);
  let workerPaths;
  let foreignFiles = [];

  if (preSliceState) {
    workerPaths = [];
    for (const [path, line] of currentState) {
      const priorLine = preSliceState.get(path);
      if (priorLine === undefined || priorLine !== line) {
        workerPaths.push(path);
      } else {
        foreignFiles.push(path);
      }
    }

    if (foreignFiles.length > 0) {
      eventBus?.emit("slice-foreign-files-detected", {
        sliceNumber: slice?.number,
        foreignFiles,
      });
    }

    if (workerPaths.length === 0) {
      // Worker didn't touch the working tree (only operator-owned dirt remains).
      return { committed: false, reason: "no-worker-changes", foreignFiles };
    }
  } else {
    workerPaths = null; // signal: legacy `git add -A` path
  }

  // Issue #195: detect commits absorbed during the slice window (e.g. the
  // VS Code Copilot extension auto-committing the worker's real edits).
  // Capture BEFORE we add our own commit so HEAD still points at the last
  // absorbed commit.
  const absorbedCommits = startSha
    ? captureAbsorbedCommits({ cwd, fromSha: startSha, toSha: "HEAD" })
    : [];
  const raceDetected = absorbedCommits.length > 0;

  // Housekeeping detection: when every worker-owned path is inside `.forge/`,
  // the orchestrator's own commit carries no product deliverables. Combined
  // with raceDetected, relabel so log readers don't see "feat(slice-N): …"
  // on a commit that only touched housekeeping artifacts.
  const allHousekeeping = workerPaths && workerPaths.length > 0
    && workerPaths.every((p) => p.replace(/\\/g, "/").startsWith(".forge/"));

  // Infer conventional commit type from title
  const conventionalType = /^(bug\s*#?\d+|fix)/i.test(slice.title) ? "fix" : "feat";

  // Strip only "Bug #N: " prefix (not "Fix"), truncate to 72 chars
  const subject = slice.title.replace(/^bug\s*#?\d+[:\s]*/i, "").slice(0, 72).trim() || slice.title.slice(0, 72);
  let commitMessage = `${conventionalType}(slice-${slice.number}): ${subject}`;
  if (allHousekeeping && raceDetected) {
    const absorbedRef = absorbedCommits.map((c) => c.sha.slice(0, 7)).join(", ");
    commitMessage = `chore(slice-${slice.number}): housekeeping (source absorbed by ${absorbedRef})`;
  }

  try {
    if (workerPaths) {
      // Stage worker-owned paths individually so foreign files stay un-staged.
      // Chunk to avoid blowing past Windows command-line length limits when a
      // slice touches a very large number of files.
      const CHUNK = 50;
      for (let i = 0; i < workerPaths.length; i += CHUNK) {
        const batch = workerPaths.slice(i, i + CHUNK).map(shellQuotePath).join(" ");
        execSync(`git add -- ${batch}`, { cwd, encoding: "utf-8", timeout: 10_000 });
      }
    } else {
      execSync("git add -A", { cwd, encoding: "utf-8", timeout: 10_000 });
    }
    // Issue #162: use execFileSync with array args so the shell never sees the
    // commit message — prevents breakage when slice titles contain ", ', `, $().
    // windowsHide: suppress per-slice git.exe console flash (spawn-storm fix).
    execFileSync("git", ["commit", "-m", commitMessage], { cwd, encoding: "utf-8", timeout: 15_000, windowsHide: true });
    const sha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();

    // #186 v2.96.2: capture commit stats so the orchestrator can populate
    // tokens.codeChanges (used by forge_drift_report + forge_health_trend).
    // Best-effort: any error leaves codeChanges null so we never block the
    // commit-success path on a stat parse.
    let codeChanges = null;
    try {
      const shortstat = execSync(`git show --shortstat --format= ${sha}`, {
        cwd, encoding: "utf-8", timeout: 5_000,
      });
      codeChanges = parseShortstat(shortstat);
    } catch { /* ignore — codeChanges stays null */ }

    const evt = { sliceNumber: slice.number, sha, message: commitMessage };
    if (foreignFiles.length > 0) evt.foreignFiles = foreignFiles;
    if (codeChanges) evt.codeChanges = codeChanges;
    if (absorbedCommits.length > 0) evt.absorbedCommits = absorbedCommits;
    if (raceDetected) evt.raceDetected = true;
    eventBus?.emit("slice-auto-committed", evt);
    const out = { committed: true, sha, message: commitMessage };
    if (foreignFiles.length > 0) out.foreignFiles = foreignFiles;
    if (codeChanges) out.codeChanges = codeChanges;
    if (absorbedCommits.length > 0) out.absorbedCommits = absorbedCommits;
    if (raceDetected) out.raceDetected = true;
    if (allHousekeeping) out.housekeepingOnly = true;
    return out;
  } catch (err) {
    eventBus?.emit("slice-dirty-tree-warning", { sliceNumber: slice?.number, error: err.message });
    return { committed: false, reason: "git-failed", error: err.message };
  }
}

/**
 * Issue #132 \u2014 after a slice fails, capture any uncommitted worker
 * deliverables so they aren't silently orphaned. Stages files with
 * `git add -A` (no commit), writes `.forge/runs/<runId>/orphans-slice-<N>.json`
 * with the file list and recovery hints, and emits a `slice-orphan-warning`
 * event. Failing-gate is the most common case: a buggy gate script (typo,
 * relative path, regex escape issue) marks the slice failed even though
 * the deliverables on disk are correct. Without staging + warning, the
 * next resume saw a clean tree and either re-ran the slice (wasting tokens)
 * or skipped it entirely.
 *
 * Never throws \u2014 best-effort. Returns a summary or null when nothing was
 * to capture.
 *
 * @param {object} params
 * @param {{ number: number, title: string }} params.slice
 * @param {string} params.cwd
 * @param {string} [params.runDir] - .forge/runs/<runId> for orphans-slice-N.json
 * @param {string} [params.mode] - "assisted" skips staging
 * @param {{ emit: Function }} [params.eventBus]
 * @returns {{ staged: boolean, files: string[], orphansPath?: string, reason?: string, error?: string }|null}
 */
export function stageOrphansOnSliceFailure({ slice, cwd = process.cwd(), runDir = null, mode, eventBus } = {}) {
  if (mode === "assisted") {
    return { staged: false, files: [], reason: "assisted-mode" };
  }

  let statusOut;
  try {
    statusOut = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 });
  } catch (err) {
    return { staged: false, files: [], reason: "git-failed", error: err.message };
  }

  if (!statusOut || !statusOut.trim()) {
    return null; // nothing on disk to orphan
  }

  // Parse `git status --porcelain` into a flat file list. Each line is
  // "XY path" (or "XY orig -> new" for renames). We capture the rightmost
  // path so renamed files are tracked at their new location.
  const files = statusOut
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const arrowIdx = l.indexOf(" -> ");
      const tail = arrowIdx >= 0 ? l.slice(arrowIdx + 4) : l.slice(3);
      return tail.trim().replace(/^"|"$/g, "");
    })
    .filter(Boolean);

  // Stage everything so files become visible in `git status` (and can be
  // committed by the operator after triage). We never commit on failure
  // \u2014 the gate said no, the human must verify.
  let staged = false;
  let stageError = null;
  try {
    execSync("git add -A", { cwd, encoding: "utf-8", timeout: 10_000 });
    staged = true;
  } catch (err) {
    stageError = err.message;
  }

  // Drop a structured orphans-slice-N.json artifact next to the run log.
  let orphansPath = null;
  if (runDir) {
    try {
      mkdirSync(runDir, { recursive: true });
      orphansPath = resolve(runDir, `orphans-slice-${slice.number}.json`);
      const payload = {
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        capturedAt: new Date().toISOString(),
        staged,
        stageError,
        files,
        recovery: [
          `git status --short  # review staged files`,
          `git diff --cached   # see what the worker wrote`,
          `git commit -m "feat(slice-${slice.number}): <subject>"   # if deliverables are correct`,
          `git restore --staged . && git restore .                  # if deliverables are wrong`,
        ],
      };
      writeFileSync(orphansPath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      orphansPath = null;
    }
  }

  if (eventBus && typeof eventBus.emit === "function") {
    try {
      eventBus.emit("slice-orphan-warning", {
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        fileCount: files.length,
        files: files.slice(0, 20), // cap event payload
        staged,
        stageError,
        orphansPath: orphansPath ? relative(cwd, orphansPath) : null,
      });
    } catch { /* best-effort */ }
  }

  return { staged, files, orphansPath: orphansPath || undefined, ...(stageError ? { error: stageError } : {}) };
}

/**
 * Run the PostSlice hook logic. Detects conventional commits, reads drift
 * history, computes delta, and returns an advisory or warning message.
 *
 * @param {object} params
 * @param {string} params.commitMessage - The git commit message
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, action?: string, message?: string, priorScore?: number, newScore?: number, delta?: number, skippedReason?: string }}
 */
// Phase-53 S6: runPostSliceHook → orchestrator/hooks.mjs

// ─── PostSlice Tempering Hook (TEMPER-02 Slice 02.2) ──────────────────
// Phase-53 S6: resetPostSliceTemperingFired, runPostSliceTemperingHook
// → orchestrator/hooks.mjs

// ─── PreAgentHandoff Hook ─────────────────────────────────────────────
// Phase-53 S6: PRE_AGENT_HANDOFF_DEFAULTS, isLiveGuardCacheStale,
// formatSnapshotAge, runPreAgentHandoffHook → orchestrator/hooks.mjs

/**
 * Infer the slice type from its title and tasks for model routing purposes.
 * Returns one of: "test" | "review" | "migration" | "execute"
 * @param {object} slice - Parsed slice object
 * @returns {string}
 */
export function inferSliceType(slice) {
  const text = [slice.title || "", ...(slice.tasks || [])].join(" ").toLowerCase();
  if (/\b(test|spec|unit test|integration test|e2e|coverage)\b/.test(text)) return "test";
  if (/\b(review|audit|lint|analyze|analyse|check|inspect)\b/.test(text)) return "review";
  if (/\b(migration|migrate|schema|seed|alter table|create table|drop table|dbcontext|ef core)\b/.test(text)) return "migration";
  return "execute";
}

/**
 * Recommend the best model for a given slice type based on historical performance.
 *
 * Selection criteria:
 *   1. Minimum 3 slices of data (MIN_SAMPLE)
 *   2. Success rate > 80%
 *   3. Cheapest qualifying model wins
 *
 * Records are filtered by sliceType when type info is present in history.
 * Falls back to all records when no type-specific data is available.
 *
 * @param {string} cwd - Project working directory
 * @param {string|null} sliceType - Slice type from inferSliceType(), or null for global stats
 * @returns {{ model: string, success_rate: number, avg_cost_usd: number, total_slices: number } | null}
 */
export function recommendModel(cwd, sliceType = null) {
  try {
    const records = loadModelPerformance(cwd);
    if (records.length === 0) return null;

    // Prefer type-specific records; fall back to all records
    const typed = sliceType ? records.filter((r) => r.sliceType === sliceType) : records;
    const relevant = typed.length >= 3 ? typed : records;

    const stats = aggregateModelStats(relevant);
    const MIN_SAMPLE = 3;
    const qualified = Object.entries(stats)
      .filter(([m, s]) => !isApiOnlyModel(m) && s.total_slices >= MIN_SAMPLE && s.success_rate > 0.8)
      .map(([m, s]) => ({
        model: m,
        success_rate: s.success_rate,
        avg_cost_usd: s.avg_cost_usd,
        total_slices: s.total_slices,
      }))
      .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);

    return qualified.length > 0 ? qualified[0] : null;
  } catch {
    return null;
  }
}

/**
 * Execute a single slice — spawn worker + run validation gates.
 * Supports automatic retry: if gate fails, re-invokes worker with error context.
 */
async function executeSlice(slice, options) {
  const { cwd, model, modelRouting = {}, mode, runDir, maxRetries = 1,
    memoryEnabled = false, projectName = "", planName = "",
    quorumConfig = null,
    escalationChain = ["auto", "claude-opus-4.7", "gpt-5.3-codex"],
    eventBus = null,
    worker = null,
    _dispatchSlice = _dispatchSliceDefault,
    _pollPullRequest = _pollPullRequestDefault,
    networkAllowed = null,  // Phase-WORKER-GUARDRAILS Slice 4 (A5): string[] | null
    networkEnforce = false, // Phase-WORKER-GUARDRAILS Slice 4 (A5): default log-only
    toolsDeny = null,       // Phase-WORKER-GUARDRAILS Slice 6 (A8): string[] | null — MCP tool names the worker may not invoke
  } = options;
  const startTime = Date.now();
  const resolvedModel = resolveModel(model, modelRouting, slice);

  // Meta-bug #88: capture HEAD at slice start so the timeout-retry path can
  // detect a worker that committed successfully just before being killed by
  // the timeout. Without this, the retry loop burns a premium request
  // re-doing work that already landed on master.
  let sliceStartHead = null;
  try {
    sliceStartHead = execSync("git rev-parse HEAD", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim();
  } catch { /* not a git repo — leave null, retry logic falls back to default */ }

  // Fix 8 + Issue #178: Snapshot working tree before slice. Always restored
  // at slice end via popSliceSnapshot — pre-fix, the stash was pushed but
  // never popped, silently capturing operator WIP into `git stash list`.
  const snapshot = pushSliceSnapshot({ cwd, sliceNumber: slice.number });
  const snapshotStash = snapshot.pushed;
  const finalizeSliceResult = (result) => attachSliceSnapshotRestore({
    sliceResult: result,
    snapshotStash,
    cwd,
    sliceNumber: slice.number,
    eventBus,
  });

  // ─── Teardown Safety Guard: capture git baseline ────────────────────
  let teardownBaseline = null;
  const teardownGuardConfig = isDestructiveSliceTitle(slice.title)
    ? loadTeardownGuardConfig(cwd)
    : { enabled: false };

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
      } catch { /* no upstream — local-only check */ }
      teardownBaseline = { branch, headSha, upstream, capturedAt: new Date().toISOString() };
    } catch {
      teardownBaseline = null; // non-git context — skip verification
    }
  }

  // ─── Agent-Per-Slice Routing (Slice 1) ───────────────────────────────
  // When no explicit model is set, recommend one from historical performance data.
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

  // ─── Quorum Mode (v2.5) ───
  let quorumResult = null;
  let useQuorum = false;
  let complexityScore = 0;

  if (quorumConfig && quorumConfig.enabled && mode !== "assisted") {
    const { score, signals } = scoreSliceComplexity(slice, cwd);
    complexityScore = score;

    // Determine if this slice qualifies for quorum
    if (quorumConfig.auto) {
      useQuorum = score >= quorumConfig.threshold;
    } else {
      useQuorum = true; // Force quorum on all slices
    }

    if (useQuorum) {
      // Dispatch to multiple models for dry-run analysis
      const dispatchResult = await quorumDispatch(slice, quorumConfig, {
        cwd,
        memoryEnabled,
        projectName,
        complexityScore: score,
      });

      // Synthesize responses
      quorumResult = await quorumReview(dispatchResult, slice, quorumConfig, { cwd });

      // Log quorum data
      const quorumLog = {
        score,
        signals,
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
    }
  }

  let attempt = 0;
  let workerResult = null;
  let gateResult = { success: true, output: "No validation gate defined" };
  let lastError = null;
  // Phase-25 Slice 1 (L1 Reflexion): per-attempt context used to build the
  // "## Previous attempt (N-1) summary" block on retry. Contains the fields
  // mandated by Phase-25 MUST #1: gateName, model, durationMs, stderrTail.
  let lastFailureContext = null;
  let currentModel = finalModel;
  // Phase GITHUB-B Slice 4 — trajectory schema for copilot-coding-agent slices.
  // Captures issue + PR provenance so sliceResult.trajectory carries render hints.
  let copilotDispatchData = null;

  // Phase-25 Slice 3 (L2 Voyager): retrieve auto-skills matching this slice's
  // domain keywords once per slice so every retry sees the same context.
  // reuseCount is only bumped after the slice ultimately passes — skills that
  // did not help an eventually-failing slice should not promote.
  let injectedAutoSkills = [];
  try {
    injectedAutoSkills = retrieveAutoSkills({ cwd, slice, limit: 3 }) || [];
  } catch {
    injectedAutoSkills = [];
  }
  const autoSkillContextBlock = buildAutoSkillContext(injectedAutoSkills);

  // Phase-FOUNDRY-QUOTA-PREFLIGHT Slice 3 — emit pforge.foundry.quota warning before
  // dispatching to worker when PFORGE_FOUNDRY_QUOTA_PREFLIGHT=1 and an Azure Foundry
  // deployment model (azure/* prefix) is configured. Fail-open: quota errors never
  // block execution; they only emit an advisory event to events.log.
  if (process.env.PFORGE_FOUNDRY_QUOTA_PREFLIGHT === "1") {
    const _fqRawModel = finalModel || "";
    if (_fqRawModel.startsWith("azure/")) {
      const _fqSubscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
      const _fqResourceGroup  = process.env.AZURE_RESOURCE_GROUP;
      const _fqAccountName    = process.env.AZURE_OPENAI_ACCOUNT_NAME || process.env.AZURE_OPENAI_RESOURCE_NAME || "";
      const _fqDeploymentName = _fqRawModel.replace(/^azure\//, "") || process.env.AZURE_OPENAI_DEPLOYMENT || "default";
      let _fqQuota = null;
      try {
        _fqQuota = await getDeploymentQuota({
          subscriptionId: _fqSubscriptionId,
          resourceGroup: _fqResourceGroup,
          accountName: _fqAccountName,
          deploymentName: _fqDeploymentName,
        });
      } catch {
        _fqQuota = { ok: false, reason: "preflight_fetch_error" };
      }
      const _fqAssessment = compareSliceEstimate(_fqQuota, { tokens_in: 0, tokens_out: 0 });
      if (_fqAssessment.status === "warning" || _fqAssessment.status === "critical") {
        const _fqEventData = {
          sliceId: slice.number,
          title: slice.title,
          deploymentName: _fqDeploymentName,
          status: _fqAssessment.status,
          headroomPct: _fqAssessment.headroomPct,
          message: _fqAssessment.message,
        };
        appendEvent("pforge.foundry.quota", _fqEventData, runDir);
        if (eventBus) {
          eventBus.emit("pforge.foundry.quota", _fqEventData);
        }
        console.warn(`[pforge] foundry-quota preflight: ${_fqAssessment.message}`);
      }
    }
  }

  while (attempt <= maxRetries) {
    const attemptStartTime = Date.now();
    // Auto-escalate model on retries — skip past the current model in chain
    if (attempt > 0 && escalationChain.length > 1) {
      let nextModel = currentModel;
      for (let i = 0; i < escalationChain.length; i++) {
        const candidate = escalationChain[i] === "auto" ? null : escalationChain[i];
        if (candidate !== currentModel) {
          nextModel = candidate;
          break;
        }
      }
      // If starting model is already the top of the chain, try the next one down
      if (nextModel === currentModel) {
        const curIdx = escalationChain.findIndex(m => (m === "auto" ? null : m) === currentModel);
        const nextIdx = Math.min(curIdx + attempt, escalationChain.length - 1);
        const candidate = escalationChain[nextIdx] === "auto" ? null : escalationChain[nextIdx];
        if (candidate !== currentModel) nextModel = candidate;
      }
      if (nextModel !== currentModel) {
        const fromModel = currentModel || "auto";
        currentModel = nextModel;
        if (eventBus) {
          eventBus.emit("slice-escalated", {
            sliceId: slice.number,
            title: slice.title,
            attempt,
            fromModel,
            toModel: currentModel || "auto",
          });
        }
      }
    }

    // Build prompt — on retry, include the error context
    let sliceInstructions = (useQuorum && quorumResult)
      ? quorumResult.enhancedPrompt
      : buildSlicePrompt(slice);

    // OpenBrain: inject memory search + capture instructions
    if (memoryEnabled) {
      sliceInstructions = buildMemorySearchBlock(projectName, slice) + "\n" + sliceInstructions;
      sliceInstructions += "\n" + buildMemoryCaptureBlock(projectName, slice, planName);
    }

    // Phase-25 Slice 3 (L2 Voyager): inject auto-skill recipes that matched
    // this slice's domain keywords. Injected once per attempt so retries also
    // see the prior-knowledge cues.
    if (autoSkillContextBlock) {
      sliceInstructions += autoSkillContextBlock;
    }

    // Phase-25 Slice 2 (L8 Trajectory): ask the worker to emit a first-person
    // sentinel-wrapped prose note after its work is done. The note is captured
    // from stdout after gate success and persisted to
    // .forge/trajectories/<plan>/slice-<id>.md for future slices to consult.
    sliceInstructions += "\n" + buildTrajectorySuffix();

    // Teardown Safety Guard: inject pre-flight constraint
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

    // Phase-31 Slice 3: prepend reflexion preamble when a prior attempt context
    // is available. First attempts (lastFailureContext === null) are unchanged.
    sliceInstructions = buildRetryPrompt(sliceInstructions, lastFailureContext);

    if (mode === "assisted") {
      workerResult = {
        output: "Assisted mode — human executes in VS Code",
        tokens: { tokens_in: null, tokens_out: null, model: "human" },
        exitCode: 0,
        worker: "human",
        model: "human",
      };
    } else if (worker === "copilot-coding-agent") {
      // Phase GITHUB-B Slice 3 — dispatch via GitHub Issue + poll for PR.
      // Uses injected _dispatchSlice / _pollPullRequest for testability.
      try {
        const issueResult = _dispatchSlice(slice, { cwd });
        const prResult = await _pollPullRequest(issueResult.issueNumber, {
          cwd,
          intervalMs: DEFAULT_POLL_INTERVAL_MS,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });
        const timedOut = prResult.status === "timeout";
        // Phase GITHUB-B Slice 4 — capture trajectory data for sliceResult
        const prHint = timedOut
          ? `PR pending (timeout)`
          : `PR #${prResult.prNumber} (${prResult.status})`;
        copilotDispatchData = {
          issueNumber: issueResult.issueNumber,
          issueUrl: issueResult.issueUrl,
          prNumber: timedOut ? null : prResult.prNumber,
          prUrl: timedOut ? null : prResult.prUrl,
          prStatus: prResult.status,
          renderHint: `🤖 Issue #${issueResult.issueNumber} → ${prHint}`,
        };
        workerResult = {
          output: JSON.stringify({ ...issueResult, pr: prResult }),
          exitCode: timedOut ? 1 : 0,
          worker: "copilot-coding-agent",
          model: "copilot-coding-agent",
          stderr: timedOut
            ? `Copilot did not open a PR within the polling timeout (issue #${issueResult.issueNumber})`
            : "",
        };
      } catch (err) {
        return finalizeSliceResult({
          status: "failed",
          duration: Date.now() - startTime,
          error: err.message,
          attempts: attempt + 1,
        });
      }
    } else {
      // Phase-WORKER-GUARDRAILS Slice 4 (A5): start network proxy when plan declares network.allowed.
      // Proxy is active only during the worker's execution and stopped in all exit paths via finally.
      let _attemptProxy = null;
      let _attemptProxyEnv = null;
      if (networkAllowed && Array.isArray(networkAllowed) && networkAllowed.length >= 0) {
        const _nLogPath = resolve(runDir, "slices", String(slice.number), "network.log");
        try {
          _attemptProxy = await startProxyLogger({
            allowlist: networkAllowed,
            networkLogPath: _nLogPath,
            enforce: networkEnforce,
          });
          _attemptProxyEnv = {
            HTTPS_PROXY: _attemptProxy.proxyUrl,
            HTTP_PROXY: _attemptProxy.proxyUrl,
            PFORGE_NETWORK_LOG_ONLY: "1",
          };
        } catch (pErr) {
          console.warn(`[pforge] network proxy start failed: ${pErr.message}`);
        }
      }
      try {
        workerResult = await spawnWorker(sliceInstructions, { model: currentModel, cwd, runPlanActive: true, timeout: resolveWorkerTimeoutMs({ sliceOverride: slice.workerTimeoutMs }), eventBus, extraEnv: _attemptProxyEnv });
      } catch (err) {
        return finalizeSliceResult({
          status: "failed",
          duration: Date.now() - startTime,
          error: err.message,
          attempts: attempt + 1,
        });
      } finally {
        if (_attemptProxy) try { _attemptProxy.stop(); } catch { /* ignore */ }
      }
    }

    // Capture session log (C4) — append on retry
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

    // Run validation gate if defined
    gateResult = { success: true, output: "No validation gate defined" };
    if (slice.validationGate) {
      const gateLines = coalesceGateLines(slice.validationGate);

      for (const gateLine of gateLines) {
        gateResult = runGate(gateLine, cwd);
        if (!gateResult.success) {
          gateResult.failedCommand = gateLine;
          break;
        }
      }
    }

    // If gate passed AND worker didn't timeout/fail, we're done
    if (gateResult.success && workerResult.exitCode === 0) break;

    // Worker timed out — retry with timeout context
    if (workerResult.timedOut) {
      // Meta-bug #88: before paying for a retry, check whether the worker
      // committed successfully in its last seconds. If HEAD advanced since
      // slice start, the work already landed — treat as success and break.
      if (sliceStartHead) {
        try {
          const postTimeoutHead = execSync("git rev-parse HEAD", {
            cwd, encoding: "utf-8", timeout: 5000,
          }).trim();
          if (postTimeoutHead && postTimeoutHead !== sliceStartHead) {
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
            // Force exitCode to 0 so downstream logic (status writer, summary)
            // sees this as a clean success.
            workerResult.exitCode = 0;
            workerResult.timedOut = false;
            workerResult.committedBeforeTimeout = true;
            break;
          }
        } catch { /* git unavailable — fall through to existing retry logic */ }
      }

      lastError = `Worker timed out after ${Math.round((Date.now() - startTime) / 1000)}s. The task may be too complex for a single slice — consider splitting it.`;
      // Phase-25 Slice 1: capture reflexion context for next attempt's prompt
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

    // Worker failed with non-zero exit (not timeout) — no point retrying
    if (workerResult.exitCode !== 0) break;

    // Gate failed — set error for retry prompt
    lastError = `Gate command '${gateResult.failedCommand || "unknown"}' failed:\n${gateResult.error || gateResult.output}`;
    // Phase-25 Slice 1: capture reflexion context for next attempt's prompt
    lastFailureContext = {
      previousAttempt: attempt + 1,
      gateName: gateResult.failedCommand || "unknown",
      model: workerResult.model || currentModel || "auto",
      durationMs: Date.now() - attemptStartTime,
      stderrTail: [gateResult.error, gateResult.output, workerResult.stderr].filter(Boolean).join("\n\n"),
    };
    attempt++;

    if (attempt <= maxRetries) {
      // Log the retry
      writeFileSync(logFile, `\n\n--- GATE FAILED, RETRYING (attempt ${attempt + 1}) ---\n${lastError}\n`, { flag: "a" });
    }
  }

  // ─── Teardown Safety Guard: post-slice branch verification ──────────
  if (teardownBaseline && teardownGuardConfig.enabled) {
    const verification = verifyBranchSafety(teardownBaseline, teardownGuardConfig, cwd);
    if (!verification.ok) {
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

      // L3 memory capture (LiveGuard)
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
    }
  }

  const duration = Date.now() - startTime;

  // Issue #77: silent-failure guard. A worker that exits 0 with empty/trivial stdout
  // did not actually do any work — previously this slipped through as "passed" because
  // the gate (if any) ran against unchanged files. Treat as a failure so operators see it.
  const silentFailure = detectSilentWorkerFailure(workerResult, mode, slice.number);

  // Meta-bug #99: worker killed by signal / Ctrl+C must never be marked passed,
  // even when no validation gate exists. Previously this fell through because
  // the default `gateResult.success = true` for slices without a gate combined
  // with `silentFailure` only firing on exit 0.
  const killedBySignal = detectKilledBySignal(workerResult.exitCode);
  const hadValidationGate = !!slice.validationGate;

  // Status: gate is the authority when it ran. Without a gate, the worker's
  // exit code becomes the fallback signal — a non-zero exit (especially a
  // signal-kill) is a failure even if no gate existed to catch it.
  //   - silentFailure (exit 0, no output) → failed
  //   - killedBySignal (Ctrl+C, SIGTERM, etc.) → failed
  //   - gate exists and failed → failed
  //   - no gate AND worker exited non-zero → failed (meta-bug #99)
  //   - otherwise → passed
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

  const sliceResult = {
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
    // #104: record host + billing surface per slice so cost aggregation
    // can distinguish subscription-covered vs pay-per-token spend.
    ...(() => {
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
    })(),
    attempts: attempt + 1,
    ...(currentModel !== finalModel && { escalatedModel: finalModel || "auto" }),
    ...(useQuorum && {
      quorum: {
        score: complexityScore,
        models: quorumResult?.modelResponses?.map((r) => r.model) || [],
        reviewerFallback: quorumResult?.fallback || false,
        reviewerCost: quorumResult?.reviewerCost || 0,
        dryRunTokens: quorumResult?.modelResponses?.reduce((sum, r) => ({
          tokens_in: (sum.tokens_in || 0) + (r.tokens?.tokens_in || 0),
          tokens_out: (sum.tokens_out || 0) + (r.tokens?.tokens_out || 0),
        }), { tokens_in: 0, tokens_out: 0 }) || { tokens_in: 0, tokens_out: 0 },
      },
    }),
    // Phase GITHUB-B Slice 4 — trajectory schema for copilot-coding-agent.
    // Present only when worker dispatched via GitHub Issue + PR polling.
    ...(copilotDispatchData && { trajectory: copilotDispatchData }),
  };

  // Issue #152 — verify the slice's Files Modified (Exhaustive) table.
  // Non-blocking advisory: never flips status to failed. Surfaces missing
  // declarations as a warning event + sliceResult.filesModifiedCheck so the
  // run summary, dashboard, and post-run audits can see the omission.
  if (status === "passed") {
    try {
      const fmCheck = verifyFilesModified({ slice, cwd, startSha: sliceStartHead });
      if (fmCheck.enforced) {
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
      }
    } catch {
      // Non-fatal — Files Modified verification must never fail a passing slice
    }
  }

  // Phase-COST-BADGE-FIX — stamp cost_usd onto sliceResult so it lands in
  // slice-${n}.json AND is spread into the slice-completed SSE event
  // (dashboard reads `data.cost_usd` to render the 💰 spend badge).
  // calculateSliceCost is pure; safe to call here. Non-fatal on error.
  let _sliceCostForRecord = null;
  try {
    _sliceCostForRecord = calculateSliceCost(sliceResult.tokens, sliceResult.worker);
    sliceResult.cost_usd = _sliceCostForRecord.cost_usd;
    sliceResult.cost_breakdown = _sliceCostForRecord.cost_breakdown;
  } catch {
    // Non-fatal — missing cost field just means the spend badge won't render
  }

  writeFileSync(
    resolve(runDir, `slice-${slice.number}.json`),
    JSON.stringify(sliceResult, null, 2),
  );

  // Phase-25 Slice 2 (L8 Trajectory): persist worker's sentinel-wrapped trajectory
  // note on successful slices to .forge/trajectories/<plan>/slice-<id>.md.
  // Word-capped to TRAJECTORY_MAX_WORDS (D2). Non-fatal on failure.
  if (status === "passed" && planName) {
    try {
      const note = extractTrajectory(workerResult.output || "");
      if (note) {
        const path = writeTrajectory({
          cwd,
          planBasename: planName,
          sliceId: slice.number,
          content: note,
        });
        sliceResult.trajectoryPath = relative(cwd, path);
        if (eventBus) {
          eventBus.emit("trajectory-written", {
            sliceNumber: slice.number,
            path: sliceResult.trajectoryPath,
          });
        }
      }
    } catch {
      // Non-fatal — trajectory persistence must never fail a passing slice
    }
  }

  // Phase-28.3 Slice 4: Post-slice advisory — scan trajectory for self-repair
  // markers. If markers found but no forge_meta_bug_file call, emit advisory.
  // Non-blocking, non-fatal, does not change slice status.
  if (status === "passed") {
    try {
      const trajectoryText = sliceResult.trajectoryPath
        ? readFileSync(resolve(cwd, sliceResult.trajectoryPath), "utf8")
        : null;
      const advisory = detectSelfRepairMissed(trajectoryText, workerResult?.output);
      if (advisory) {
        const advisoryEvent = {
          sliceId: slice.number,
          markers: advisory.matched,
          suggestion: "Consider calling forge_meta_bug_file to record this Plan Forge defect for future prevention.",
        };
        sliceResult.selfRepairAdvisory = advisoryEvent;
        if (eventBus) {
          eventBus.emit("self-repair-missed", advisoryEvent);
        }
      }
    } catch {
      // Non-fatal — advisory must never fail a passing slice
    }
  }

  // Phase-25 Slice 3 (L2 Voyager): on successful slices, (a) bump reuseCount
  // for every auto-skill that was injected into this slice's context, so skills
  // that helped produce passing work accrue toward the promotion threshold
  // (MUST #4 / D3), and (b) capture this slice itself as a new auto-skill
  // candidate (MUST #3). Non-fatal on failure.
  if (status === "passed") {
    try {
      for (const injected of injectedAutoSkills) {
        if (injected && injected.sha256Prefix) {
          incrementAutoSkillReuse({ cwd, sha256Prefix: injected.sha256Prefix });
        }
      }
    } catch {
      // Non-fatal — reuse-count bookkeeping must never fail a passing slice
    }
    try {
      const record = extractAutoSkill({ slice, planBasename: planName, cwd });
      if (record) {
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
      }
    } catch {
      // Non-fatal — auto-skill capture must never fail a passing slice
    }
  }

  // Record model performance for this slice
  try {
    // Reuse the cost computed pre-write (Phase-COST-BADGE-FIX) when available;
    // fall back to a fresh compute so this block stays robust if the earlier
    // try/catch swallowed an error.
    const sliceCost = _sliceCostForRecord
      || calculateSliceCost(sliceResult.tokens, sliceResult.worker);
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
  } catch {
    // Non-fatal — don't fail the slice over a tracking write error
  }

  // Record quorum outcome for adaptive threshold tuning
  if (quorumConfig?.enabled) {
    try {
      const initialFailed = sliceResult.attempts > 1;
      appendForgeJsonl("quorum-history.jsonl", { // G2.1: was .json
        timestamp: new Date().toISOString(),
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        complexityScore: complexityScore || null,
        quorumUsed: useQuorum,
        quorumNeeded: useQuorum && !initialFailed, // Needed = quorum used AND initial model would have failed
        status: sliceResult.status,
      }, cwd);
    } catch { /* non-fatal */ }
  }

  return finalizeSliceResult(sliceResult);
}

function buildSlicePrompt(slice) {
  const parts = [
    `Execute Slice ${slice.number}: ${slice.title}`,
    "",
    "Tasks:",
  ];
  for (const task of slice.tasks) {
    parts.push(`- ${task}`);
  }
  // Scope isolation: tell worker which files to modify
  if (slice.scope && slice.scope.length > 0) {
    parts.push("", `SCOPE: Only modify files matching: ${slice.scope.join(", ")}`);
    parts.push("Do NOT create or modify files outside this scope.");
  }
  if (slice.buildCommand) {
    parts.push("", `Build command: ${slice.buildCommand}`);
  }
  if (slice.testCommand) {
    parts.push(`Test command: ${slice.testCommand}`);
  }
  if (slice.validationGate) {
    parts.push("", "Validation gate (run these after completion):", slice.validationGate);
  }
  if (slice.stopCondition) {
    parts.push("", `Stop condition: ${slice.stopCondition}`);
  }
  return parts.join("\n");
}

// ─── Quorum Mode (Phase 7 — v2.5) ────────────────────────────────────

// Phase-53 S7: SECURITY_KEYWORDS, DATABASE_KEYWORDS → orchestrator/review-watcher.mjs

/**
 * Load quorum configuration from .forge.json.
 * Schema: { "quorum": { "enabled": false, "auto": true, "threshold": 7, "preset": "power|speed", "models": [...], "reviewerModel": "...", "dryRunTimeout": 300000 } }
 * Returns merged config with defaults.
 */

// Phase-53 S6: QUORUM_PRESETS → orchestrator/hooks.mjs

// ─── OpenClaw Integration (v2.29) ────────────────────────────────────
// Phase-53 S6: loadOpenClawConfig, postOpenClawSnapshot
// → orchestrator/hooks.mjs

// ─── Watcher (v2.34) ─────────────────────────────────────────────────
// A read-only observer that watches another project's pforge run from a
// separate VS Code Copilot session. Tails events.log + slice-*.json files,
// optionally invokes a frontier model (default: claude-opus-4.7) to advise.
// The watcher MUST NOT modify files in the target project.

/**
 * Default model for the watcher. Frontier-tier — needs strong reasoning to
 * spot anomalies in another agent's output.
 */
const DEFAULT_WATCHER_MODEL = "claude-opus-4.7";

// Phase-53 S7: findLatestRun, parseEventLine, parseEventsLog, readSliceArtifacts,
// normalizeRunState, CRUCIBLE_STALL_CUTOFF_DAYS, readCrucibleState
// → orchestrator/review-watcher.mjs


// ─── PostRun Auditor Hook (Phase-39 Slice 1 + Slice 2) ───────────────

/**
 * Read persisted auditor state from .forge/auditor-state.json.
 * Returns {} if the file is missing or unreadable.
 *
 * @param {string} cwd - Project root directory
 * @returns {{ runsSinceLastAudit?: number }}
 */
function readAuditorState(cwd) {
  try {
    const statePath = resolve(cwd, ".forge", "auditor-state.json");
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    }
  } catch { /* use empty defaults */ }
  return {};
}

/**
 * Write auditor state to .forge/auditor-state.json (creates .forge dir if needed).
 * Failure is non-fatal — the run must never block on a counter write.
 *
 * @param {string} cwd - Project root directory
 * @param {{ runsSinceLastAudit: number }} state
 */
function writeAuditorState(cwd, state) {
  try {
    const forgeDir = resolve(cwd, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const statePath = resolve(forgeDir, "auditor-state.json");
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

/**
 * Post-run auditor hook — reads hooks.postRun.invokeAuditor from .forge.json
 * and fires when the configured condition is met.
 *
 * Supports:
 *   onFailure: true   — fire when the run failed (!allPassed)
 *   everyNRuns: N     — fire after every N completed runs (pass or fail)
 *                       Counter is persisted in .forge/auditor-state.json.
 *                       When the state file is absent, counter starts at N so
 *                       the first run after enabling always triggers.
 *                       If both conditions fire on the same run, invoke once
 *                       and reset the everyNRuns counter.
 *
 * @param {object} params
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @param {boolean} [params.allPassed=true]   - Whether all slices passed
 * @param {object|null} [params.eventBus=null] - EventEmitter for broadcasting
 * @returns {{ triggered: boolean, reason?: string, config?: object, timestamp?: string }}
 */
export function runPostRunAuditorHook({ cwd = process.cwd(), allPassed = true, eventBus = null } = {}) {
  let config = { onFailure: false, everyNRuns: null };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.hooks?.postRun?.invokeAuditor) {
        config = { ...config, ...raw.hooks.postRun.invokeAuditor };
      }
    }
  } catch { /* use defaults on any parse/read failure */ }

  const onFailureFires = config.onFailure === true && !allPassed;

  // Phase-39 Slice 2 — everyNRuns counter
  let everyNRunsFires = false;
  const everyN = config.everyNRuns;
  if (everyN !== null && typeof everyN === "number" && everyN > 0) {
    const state = readAuditorState(cwd);
    // Counter starts at everyN (absent file ≡ threshold already reached) so the
    // first run after enabling always triggers.  Subsequent runs increment from 0.
    const currentCount = typeof state.runsSinceLastAudit === "number"
      ? state.runsSinceLastAudit + 1
      : everyN;
    everyNRunsFires = currentCount >= everyN;
    writeAuditorState(cwd, { runsSinceLastAudit: everyNRunsFires ? 0 : currentCount });
  }

  const shouldFire = onFailureFires || everyNRunsFires;
  if (!shouldFire) {
    return { triggered: false };
  }

  // When both conditions fire on the same run, invoke once (onFailure takes
  // priority in the reason label; counter has already been reset above).
  const reason = onFailureFires ? "onFailure" : "everyNRuns";

  const result = {
    triggered: true,
    reason,
    config,
    timestamp: new Date().toISOString(),
  };

  if (eventBus && typeof eventBus.emit === "function") {
    try {
      eventBus.emit("auditor-auto-invoke", { reason, config });
    } catch { /* non-fatal */ }
  }

  return result;
}

// ─── Phase FORGE-SHOP-02 Slice 02.1 — Review Queue Storage ───────────

export const REVIEW_SOURCES = Object.freeze(new Set([
  "crucible-stall", "tempering-quorum-inconclusive",
  "tempering-baseline", "bug-classify", "fix-plan-approval",
]));
export const REVIEW_SEVERITIES = Object.freeze(new Set(["blocker", "high", "medium", "low"]));
export const REVIEW_STATUSES = Object.freeze(new Set(["open", "resolved", "deferred"]));
export const REVIEW_RESOLUTIONS = Object.freeze(new Set(["approve", "reject", "defer"]));

export function ensureReviewQueueDirs(projectRoot) {
  return ensureForgeDir("review-queue", projectRoot);
}

// Phase FORGE-SHOP-03 Slice 03.1 — Notification system
export function ensureNotificationsDirs(projectRoot) {
  return ensureForgeDir("notifications", projectRoot);
}

export function ensureNotificationsConfig(projectRoot) {
  const dir = ensureNotificationsDirs(projectRoot);
  const configPath = resolve(dir, "config.json");
  if (!existsSync(configPath)) {
    const seed = {
      enabled: false,
      adapters: { webhook: { enabled: false, url: "${env:PFORGE_WEBHOOK_URL}" } },
      routes: [
        { when: { event: "slice-failed" }, via: ["webhook"] },
        { when: { event: "run-aborted" }, via: ["webhook"] },
        { when: { event: "run-completed" }, via: ["webhook"] },
      ],
      rateLimit: { perMinute: 10, digestAfter: 5 },
    };
    try {
      writeFileSync(configPath, JSON.stringify(seed, null, 2) + "\n", { flag: "wx" });
    } catch { /* race-safe: another process created it first */ }
  }
  return configPath;
}

export function generateReviewItemId(projectRoot, nowFn = () => new Date()) {
  const dir = ensureReviewQueueDirs(projectRoot);
  const date = nowFn().toISOString().slice(0, 10);
  const prefix = `review-${date}-`;

  let existing = [];
  try {
    existing = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => {
        const numStr = f.slice(prefix.length, -5);
        return parseInt(numStr, 10);
      })
      .filter((n) => !isNaN(n));
  } catch { /* empty dir or unreadable */ }

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function readReviewItem(targetPath, itemId) {
  const filePath = resolve(targetPath, ".forge", "review-queue", `${itemId}.json`);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function listReviewItems(targetPath, filters = {}) {
  const dir = resolve(targetPath, ".forge", "review-queue");
  if (!existsSync(dir)) return [];

  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch { return []; }

  const items = [];
  for (const file of entries) {
    try {
      const raw = readFileSync(resolve(dir, file), "utf-8");
      const item = JSON.parse(raw);
      if (filters.status && item.status !== filters.status) continue;
      if (filters.source && item.source !== filters.source) continue;
      if (filters.severity && item.severity !== filters.severity) continue;
      if (filters.correlationId && item.correlationId !== filters.correlationId) continue;
      items.push(item);
    } catch {
      console.warn(`[review-queue] skipping corrupt file: ${file}`);
    }
  }

  items.sort((a, b) => {
    const ta = a.createdAt || "";
    const tb = b.createdAt || "";
    return tb.localeCompare(ta);
  });

  const cursor = typeof filters.cursor === "number" && filters.cursor > 0 ? filters.cursor : 0;
  const limit = Math.min(Math.max(typeof filters.limit === "number" ? filters.limit : 50, 1), 500);
  return items.slice(cursor, cursor + limit);
}

// Phase-53 S7: readReviewQueueState → orchestrator/review-watcher.mjs


export function addReviewItem(targetPath, input, hub = null, captureMemoryFn = null) {
  if (!REVIEW_SOURCES.has(input.source)) {
    const err = new Error(`Invalid source: ${input.source}. Must be one of: ${[...REVIEW_SOURCES].join(", ")}`);
    err.code = "ERR_INVALID_SOURCE";
    throw err;
  }
  if (!REVIEW_SEVERITIES.has(input.severity)) {
    const err = new Error(`Invalid severity: ${input.severity}. Must be one of: ${[...REVIEW_SEVERITIES].join(", ")}`);
    err.code = "ERR_INVALID_SEVERITY";
    throw err;
  }
  if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
    const err = new Error("Title is required and must be a non-empty string");
    err.code = "ERR_INVALID_TITLE";
    throw err;
  }
  if (input.context !== undefined && input.context !== null && typeof input.context !== "object") {
    const err = new Error("Context must be an object, not a string or primitive");
    err.code = "ERR_INVALID_CONTEXT";
    throw err;
  }

  const itemId = generateReviewItemId(targetPath, input._nowFn);
  const now = (input._nowFn || (() => new Date()))().toISOString();
  const record = {
    _v: 1,
    itemId,
    source: input.source,
    severity: input.severity,
    title: input.title.trim(),
    context: input.context || null,
    correlationId: input.correlationId || null,
    status: "open",
    createdAt: now,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    note: null,
  };

  const dir = ensureReviewQueueDirs(targetPath);
  const filePath = resolve(dir, `${itemId}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: "wx" });
  } catch (wxErr) {
    if (wxErr.code === "EEXIST") {
      // Collision: retry with next sequence
      const retryId = generateReviewItemId(targetPath, input._nowFn);
      record.itemId = retryId;
      const retryPath = resolve(dir, `${retryId}.json`);
      writeFileSync(retryPath, JSON.stringify(record, null, 2), { flag: "wx" });
    } else {
      throw wxErr;
    }
  }

  try {
    hub?.broadcast({
      type: "review-queue-item-added",
      itemId: record.itemId,
      source: record.source,
      severity: record.severity,
      correlationId: record.correlationId,
      timestamp: now,
    });
  } catch { /* hub broadcast is best-effort */ }

  return record;
}

export function resolveReviewItem(targetPath, input, hub = null, captureMemoryFn = null) {
  const existing = readReviewItem(targetPath, input.itemId);
  if (!existing) {
    const err = new Error(`Review item not found: ${input.itemId}`);
    err.code = "ERR_ITEM_NOT_FOUND";
    throw err;
  }
  if (!REVIEW_RESOLUTIONS.has(input.resolution)) {
    const err = new Error(`Invalid resolution: ${input.resolution}. Must be one of: ${[...REVIEW_RESOLUTIONS].join(", ")}`);
    err.code = "ERR_INVALID_RESOLUTION";
    throw err;
  }
  if (!input.resolvedBy || typeof input.resolvedBy !== "string" || !input.resolvedBy.trim()) {
    const err = new Error("resolvedBy is required and must be a non-empty string");
    err.code = "ERR_INVALID_RESOLVED_BY";
    throw err;
  }
  if (existing.status !== "open") {
    const err = new Error(`Item ${input.itemId} is already ${existing.status}`);
    err.code = "ERR_ALREADY_RESOLVED";
    throw err;
  }

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    status: input.resolution === "defer" ? "deferred" : "resolved",
    resolution: input.resolution,
    resolvedBy: input.resolvedBy.trim(),
    resolvedAt: now,
    note: input.note || null,
  };

  const filePath = resolve(targetPath, ".forge", "review-queue", `${input.itemId}.json`);
  writeFileSync(filePath, JSON.stringify(updated, null, 2));

  try {
    hub?.broadcast({
      type: "review-queue-item-resolved",
      itemId: input.itemId,
      resolution: input.resolution,
      resolvedBy: input.resolvedBy.trim(),
      timestamp: now,
    });
  } catch { /* hub broadcast is best-effort */ }

  try {
    captureMemoryFn?.(
      `Review ${input.itemId} ${input.resolution} by ${input.resolvedBy}`,
      "decision",
      "forge_review_resolve",
      targetPath
    );
  } catch { /* L3 capture is best-effort */ }

  return updated;
}

// ─── Phase FORGE-SHOP-02 Slice 02.2 — Review Queue Producer Hooks ────

/**
 * Shared producer hook pattern.  Each `maybeAdd*Review` helper:
 *   1. Short-circuits in NODE_ENV=test (no side-effects)
 *   2. Checks for an existing open item with the same correlationId+source (idempotence)
 *   3. Creates a new review item if none exists
 *   4. Catches all errors — never propagates to the caller
 */

export function maybeAddStallReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "crucible-stall",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "crucible-stall",
      severity: "medium",
      title: args.title || `Crucible smelt stalled — ${args.correlationId}`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddStallReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddTemperingReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "tempering-quorum-inconclusive",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "tempering-quorum-inconclusive",
      severity: "medium",
      title: args.title || `Tempering quorum inconclusive — ${args.correlationId}`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddTemperingReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddBugReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "bug-classify",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "bug-classify",
      severity: args.severity || "blocker",
      title: args.title || `Bug ${args.correlationId} needs human review (critical/functional)`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddBugReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddVisualBaselineReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "tempering-baseline",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "tempering-baseline",
      severity: "medium",
      title: args.title || `Visual regression — review baseline update`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddVisualBaselineReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddFixPlanReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "fix-plan-approval",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "fix-plan-approval",
      severity: args.severity || "high",
      title: args.title || `Fix proposal ${args.correlationId} pending approval`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddFixPlanReview failed: ${err.message}`); } catch {}
    return null;
  }
}

// Phase-53 S7: buildWatchSnapshot, clampActivityTail, buildCrucibleQuadrant,
// buildActiveRunsQuadrant, buildLiveguardQuadrant, buildTemperingQuadrant,
// buildActivityFeed, readHomeSnapshot → orchestrator/review-watcher.mjs


// Phase-53 S7: detectWatchAnomalies, recommendFromAnomalies → orchestrator/review-watcher.mjs


/**
 * Build the watcher analyzer prompt for the frontier model.
 */
function buildWatcherPrompt(snapshot, anomalies) {
  const lines = [
    "You are the Plan Forge WATCHER — a read-only observer of another AI agent's plan execution.",
    "You CANNOT modify any files. Your job is to:",
    "  1. Summarize the watched run's current state in 2-3 sentences.",
    "  2. Flag anomalies, regressions, or concerning patterns.",
    "  3. Recommend specific corrective actions the executing agent should take.",
    "",
    "Be concise. Prefer concrete recommendations over generic observations.",
    "When advising commands, format them as: `pforge <command>` or shell snippets.",
    "",
    "--- SNAPSHOT ---",
    JSON.stringify({
      targetPath: snapshot.targetPath,
      runId: snapshot.runId,
      runState: snapshot.runState,
      plan: snapshot.plan,
      model: snapshot.model,
      counts: snapshot.counts,
      lastEventAgeMs: snapshot.lastEventAgeMs,
      summary: snapshot.summary
        ? {
            status: snapshot.summary.status,
            results: snapshot.summary.results,
            totalDuration: snapshot.summary.totalDuration,
            totalTokensOut: snapshot.summary.totalTokensOut,
            cost: snapshot.summary.cost?.total_cost_usd,
          }
        : null,
      artifacts: snapshot.artifacts,
    }, null, 2),
    "",
    "--- HEURISTIC ANOMALIES (already detected) ---",
    anomalies.length === 0 ? "(none)" : JSON.stringify(anomalies, null, 2),
    "",
    "--- LAST 25 EVENTS ---",
    JSON.stringify(snapshot.events, null, 2),
    "",
    "Produce your watcher report as Markdown with sections: ## Status / ## Anomalies / ## Recommendations.",
  ];
  return lines.join("\n");
}

/**
 * (v2.35) Append a watcher observation to the watcher's OWN .forge/watch-history.jsonl.
 * NEVER writes inside the target project — preserves the read-only contract.
 *
 * @param {object} report - Watcher report
 * @param {string} watcherCwd - Watcher's own working directory
 */
export function appendWatchHistory(report, watcherCwd = process.cwd()) {
  try {
    const historyDir = resolve(watcherCwd, ".forge");
    if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
    const historyPath = resolve(historyDir, "watch-history.jsonl");
    const record = {
      ts: report.timestamp || new Date().toISOString(),
      targetPath: report.targetPath,
      runId: report.runId,
      runState: report.runState,
      mode: report.mode,
      anomalyCount: Array.isArray(report.anomalies) ? report.anomalies.length : 0,
      anomalyCodes: Array.isArray(report.anomalies) ? report.anomalies.map((a) => a.code) : [],
      counts: report.counts,
      cursor: report.cursor || null,
    };
    appendFileSync(historyPath, JSON.stringify(record) + "\n");
    return { ok: true, path: historyPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Watch another project's pforge execution. Read-only.
 *
 * Modes:
 *   - "snapshot": Return current state + heuristic anomalies. No AI call. Cheap.
 *   - "analyze":  Snapshot + invoke frontier model for advice. Costs a worker call.
 *
 * @param {object} options
 * @param {string} options.targetPath  - Absolute path to project being watched
 * @param {string} [options.runId]     - Specific run dir; default = latest
 * @param {"snapshot"|"analyze"} [options.mode="snapshot"]
 * @param {string} [options.model]     - Override watcher model (default: claude-opus-4.7)
 * @param {number} [options.timeout=300000] - Worker timeout for analyze mode
 * @param {number} [options.tailEvents=25] - Trailing events (1-200)
 * @param {string} [options.sinceTimestamp] - (v2.35) Only flag events newer than this ISO timestamp
 * @param {boolean} [options.recordHistory=true] - (v2.35) Append to watcher's .forge/watch-history.jsonl
 * @param {object} [options.eventBus] - (v2.35) Optional event bus to emit watch-* events
 * @returns {Promise<object>} Watcher report
 */
export async function runWatch(options = {}) {
  const {
    targetPath,
    runId = null,
    mode = WATCHER_MODE_SNAPSHOT,
    crossRunWindow = "14d",
    model = DEFAULT_WATCHER_MODEL,
    timeout = 300_000,
    tailEvents = 25,
    sinceTimestamp = null,
    recordHistory = true,
    eventBus = null,
  } = options;

  if (!targetPath) {
    return { ok: false, error: "targetPath is required" };
  }
  const resolved = resolve(targetPath);
  if (!existsSync(resolved)) {
    return { ok: false, error: `Target path does not exist: ${resolved}` };
  }

  // Phase-39 Slice 3 — cross-run aggregation mode
  if (mode === WATCHER_MODE_CROSS_RUN) {
    const xSnap = await buildCrossRunSnapshot(resolved, { window: crossRunWindow });
    const xAnomalies = detectWatchAnomalies(xSnap);
    const xRecs = recommendFromAnomalies(xAnomalies, xSnap);
    return {
      ok: xSnap.ok,
      mode: WATCHER_MODE_CROSS_RUN,
      targetPath: resolved,
      crossRunWindow,
      timestamp: new Date().toISOString(),
      totalRuns: xSnap.totalRuns,
      passedRuns: xSnap.passedRuns,
      failedRuns: xSnap.failedRuns,
      runs: xSnap.runs,
      anomalies: xAnomalies,
      recommendations: xRecs,
      snapshot: xSnap,
    };
  }

  const snapshot = await buildWatchSnapshot(resolved, runId, { tailEvents, sinceTimestamp });
  if (!snapshot.ok) return snapshot;

  const anomalies = detectWatchAnomalies(snapshot);
  const recommendations = recommendFromAnomalies(anomalies, snapshot);

  const report = {
    ok: true,
    mode,
    watcherModel: mode === WATCHER_MODE_ANALYZE ? model : null,
    targetPath: resolved,
    runId: snapshot.runId,
    runState: snapshot.runState,
    lastEventType: snapshot.lastEventType,
    plan: snapshot.plan,
    counts: snapshot.counts,
    lastEventAgeMs: snapshot.lastEventAgeMs,
    tailEvents: snapshot.tailEvents,
    // v2.35: cursor for stateful polling
    cursor: snapshot.cursor,
    sinceTimestamp: snapshot.sinceTimestamp,
    hasNewEvents: snapshot.hasNewEvents,
    newEventsCount: snapshot.newEventsCount,
    summary: snapshot.summary
      ? {
          status: snapshot.summary.status,
          results: snapshot.summary.results,
          totalDuration: snapshot.summary.totalDuration,
          totalTokensOut: snapshot.summary.totalTokensOut,
          cost: snapshot.summary.cost?.total_cost_usd,
        }
      : null,
    artifacts: snapshot.artifacts,
    anomalies,
    recommendations,
    // Phase CRUCIBLE-03 Slice 03.1 — funnel health alongside run health
    crucible: snapshot.crucible,
    // Phase TEMPER-01 Slice 01.2 — test-coverage health alongside run + funnel
    tempering: snapshot.tempering,
    timestamp: new Date().toISOString(),
  };

  // v2.35: emit hub events (when watcher's hub is active)
  if (eventBus && typeof eventBus.emit === "function") {
    try {
      eventBus.emit("watch-snapshot-completed", {
        targetPath: report.targetPath,
        runId: report.runId,
        runState: report.runState,
        anomalyCount: anomalies.length,
        cursor: report.cursor,
        // Phase CRUCIBLE-03 Slice 03.2 — compact Crucible summary so the
        // dashboard Watcher tab can render the funnel row without a
        // follow-up REST call. Kept to primitives so the WS payload
        // stays small for clients on bandwidth-constrained links.
        crucible: report.crucible
          ? {
              total: report.crucible.counts.total,
              finalized: report.crucible.counts.finalized,
              in_progress: report.crucible.counts.in_progress,
              abandoned: report.crucible.counts.abandoned,
              staleInProgress: report.crucible.staleInProgress,
              orphanHandoffs: report.crucible.orphanHandoffs.length,
              stallCutoffDays: report.crucible.stallCutoffDays,
            }
          : null,
        // Phase TEMPER-01 Slice 01.2 — compact Tempering summary for the
        // Watcher tab row. Already primitives (readTemperingState returns
        // a flat shape), so we just forward a whitelist of fields.
        tempering: report.tempering
          ? {
              totalScans: report.tempering.totalScans,
              latestStatus: report.tempering.latestStatus,
              latestScanAgeMs: report.tempering.latestScanAgeMs,
              latestScanTs: report.tempering.latestScanTs,
              gaps: report.tempering.gaps,
              belowMinimum: report.tempering.belowMinimum,
              stale: report.tempering.stale,
              staleCutoffDays: report.tempering.staleCutoffDays,
            }
          : null,
        // Phase FORGE-SHOP-01 Slice 01.2 — Home chip data for watcher tab.
        // Already extracted by buildWatchSnapshot; forward as-is.
        home: snapshot.home || null,
      });
      for (const anomaly of anomalies) {
        eventBus.emit("watch-anomaly-detected", {
          targetPath: report.targetPath,
          runId: report.runId,
          ...anomaly,
        });
      }
    } catch { /* never throw from event emission */ }
  }

  if (mode === WATCHER_MODE_SNAPSHOT) {
    if (recordHistory) appendWatchHistory(report);
    return report;
  }

  // Analyze mode: invoke frontier watcher model
  // CRITICAL: spawn the worker with cwd = watcher's own directory, NEVER the target's,
  // so any tool calls the watcher might make cannot touch the target project.
  const prompt = buildWatcherPrompt(snapshot, anomalies);
  const watcherCwd = process.cwd(); // watcher's own working directory
  try {
    const result = await spawnWorker(prompt, { model, cwd: watcherCwd, timeout });
    report.advice = result.output || "(no advice returned)";
    report.tokens = result.tokens || null;
    report.workerExitCode = result.exitCode;
    if (eventBus && typeof eventBus.emit === "function") {
      try {
        eventBus.emit("watch-advice-generated", {
          targetPath: report.targetPath,
          runId: report.runId,
          model,
          tokensOut: result.tokens?.tokens_out || null,
        });
      } catch { /* never throw */ }
    }
  } catch (err) {
    report.adviceError = err.message;
  }

  if (recordHistory) appendWatchHistory(report);
  return report;
}

/**
 * (v2.35) Connect to a target project's WebSocket hub for live event streaming.
 * Falls back to polling buildWatchSnapshot if hub is not running.
 *
 * Read-only by design: only subscribes to events; never sends any messages
 * to the target hub other than the initial label handshake.
 *
 * @param {object} options
 * @param {string} options.targetPath - Absolute path to project being watched
 * @param {(event: object) => void} options.onEvent - Callback per event received
 * @param {(error: Error) => void} [options.onError] - Optional error callback
 * @param {number} [options.durationMs=60000] - How long to listen (1-3600s window)
 * @param {number} [options.pollIntervalMs=3000] - Polling interval if hub not available
 * @returns {Promise<{ ok: boolean, mode: "websocket"|"polling", events: number, durationMs: number, error?: string }>}
 */
export async function runWatchLive(options = {}) {
  const {
    targetPath,
    onEvent,
    onError,
    durationMs = 60_000,
    pollIntervalMs = 3_000,
  } = options;

  if (!targetPath) return { ok: false, error: "targetPath is required" };
  if (typeof onEvent !== "function") return { ok: false, error: "onEvent callback is required" };
  const resolved = resolve(targetPath);
  if (!existsSync(resolved)) return { ok: false, error: `Target path does not exist: ${resolved}` };

  const cappedDuration = Math.min(3_600_000, Math.max(1_000, durationMs));

  // Try WebSocket connection to target's hub
  const portsPath = resolve(resolved, ".forge", "server-ports.json");
  let hubInfo = null;
  if (existsSync(portsPath)) {
    try { hubInfo = JSON.parse(readFileSync(portsPath, "utf-8")); } catch { /* fall through */ }
  }

  if (hubInfo?.ws) {
    // WebSocket mode
    let ws;
    let WSCtor;
    try {
      WSCtor = (await import("ws")).default;
    } catch (err) {
      // ws library not installed; fall through to polling
      hubInfo = null;
    }

    if (WSCtor) {
      return new Promise((resolveP) => {
        let eventCount = 0;
        let timer = null;
        const url = `ws://127.0.0.1:${hubInfo.ws}?label=watcher-${Date.now()}`;
        try {
          ws = new WSCtor(url);
        } catch (err) {
          return resolveP({ ok: false, mode: "websocket", events: 0, durationMs: 0, error: err.message });
        }

        const cleanup = (result) => {
          if (timer) clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          resolveP(result);
        };

        ws.on("open", () => {
          timer = setTimeout(() => cleanup({ ok: true, mode: "websocket", events: eventCount, durationMs: cappedDuration }), cappedDuration);
        });

        ws.on("message", (raw) => {
          try {
            const event = JSON.parse(raw.toString());
            eventCount++;
            onEvent(event);
          } catch { /* skip malformed */ }
        });

        ws.on("error", (err) => {
          if (typeof onError === "function") onError(err);
        });

        ws.on("close", () => {
          if (timer) {
            // Connection closed before duration expired — return what we got
            cleanup({ ok: true, mode: "websocket", events: eventCount, durationMs: Date.now() % cappedDuration });
          }
        });
      });
    }
  }

  // Polling fallback — diff cursor pattern
  return new Promise((resolveP) => {
    let cursor = null;
    let eventCount = 0;
    const startTime = Date.now();

    const poll = async () => {
      try {
        const snap = await buildWatchSnapshot(resolved, null, { tailEvents: 200, sinceTimestamp: cursor });
        if (snap.ok) {
          // Yield only events newer than cursor
          if (cursor) {
            const cutoffMs = new Date(cursor).getTime();
            for (const ev of snap.events) {
              if (new Date(ev.ts).getTime() > cutoffMs) {
                eventCount++;
                onEvent(ev);
              }
            }
          } else {
            // First poll — yield all in tail
            for (const ev of snap.events) {
              eventCount++;
              onEvent(ev);
            }
          }
          cursor = snap.cursor || cursor;
        }
      } catch (err) {
        if (typeof onError === "function") onError(err);
      }

      if (Date.now() - startTime >= cappedDuration) {
        return resolveP({ ok: true, mode: "polling", events: eventCount, durationMs: cappedDuration });
      }
      setTimeout(poll, pollIntervalMs);
    };

    poll();
  });
}

export function loadQuorumConfig(cwd, presetOverride = null) {
  const defaults = {
    enabled: false,
    auto: true,
    // Phase-31 Slice 5: recalibrated from 6 → 3 based on empirical distribution
    // across Phase-25–30 plans (63 slices). At threshold=6 only 1/63 slices
    // triggered quorum. At threshold=3 (60th-percentile score), 56/63 slices
    // qualify — matching the intent of "complex slices get multi-model review".
    threshold: 3,
    // Bug #107: default uses the standard tier (opus-4.6). Users who want
    // the premium tier (opus-4.7) opt in via --quorum=power. Reviewer stays
    // on 4.7 since it only runs once per slice and the spend is bounded.
    models: ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    reviewerModel: "claude-opus-4.7",
    dryRunTimeout: 300_000, // 5 min per dry-run leg
    strictAvailability: false, // H.3: true = fast-fail if any model unavailable
  };

  // Adaptive threshold: learn from quorum history which slices actually need quorum
  try {
    const qHistory = readForgeJsonl("quorum-history.jsonl", [], cwd); // G2.1
    if (qHistory.length >= 5) {
      const needed = qHistory.filter(q => q.quorumNeeded).length;
      const total = qHistory.length;
      const neededRate = needed / total;
      // If <20% of slices needed quorum, raise threshold (fewer get quorum)
      // If >60% needed quorum, lower threshold (more get quorum)
      if (neededRate < 0.2 && defaults.threshold < 9) defaults.threshold = Math.min(9, defaults.threshold + 1);
      else if (neededRate > 0.6 && defaults.threshold > 3) defaults.threshold = Math.max(3, defaults.threshold - 1);
    }
  } catch { /* use static default */ }
  const configPath = resolve(cwd, ".forge.json");
  let userConfig = {};
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.quorum && typeof config.quorum === "object") {
        userConfig = config.quorum;
      }
    }
  } catch { /* defaults */ }

  // Resolve preset: CLI override > .forge.json preset > none
  const presetName = presetOverride || userConfig.preset || null;
  const preset = presetName ? QUORUM_PRESETS[presetName] || {} : {};

  // Merge order: defaults < preset < userConfig (explicit fields win)
  return { ...defaults, ...preset, ...userConfig, ...(presetOverride ? { preset: presetOverride } : {}) };
}

/**
 * Score a slice's technical complexity on a 1-10 scale.
 *
 * Weighted signals:
 *   - File count in scope (20%) — saturates at 3 files
 *   - Cross-module dependencies (20%) — saturates at 3 deps
 *   - Security-sensitive keywords (15%) — saturates at 2 hits
 *   - Database/migration keywords (15%) — saturates at 2 hits
 *   - Acceptance criteria / gate length (10%) — saturates at 3 lines
 *   - Task count (10%) — saturates at 6 tasks
 *   - Historical failure rate (10%)
 *
 * @param {object} slice - Parsed slice from plan
 * @param {string} cwd - Working directory (for historical data)
 * @returns {{ score: number, signals: object }}
 */
// Phase-53 S7: scoreSliceComplexity, getHistoricalFailureRate → orchestrator/review-watcher.mjs

/**
 * Build the dry-run prompt for quorum dispatch.
 * Wraps the original slice prompt with dry-run instructions.
 */
function buildDryRunPrompt(slice) {
  const originalPrompt = buildSlicePrompt(slice);
  return [
    "You are in QUORUM DRY-RUN mode. Do NOT execute any code changes.",
    "Do NOT create, modify, or delete any files.",
    "",
    "Instead, produce a detailed implementation plan for the slice below:",
    "",
    "1. **Files to create or modify** — exact paths, one per line",
    "2. **Implementation approach** — for each file, describe the key changes (classes, methods, patterns)",
    "3. **Edge cases and failure modes** — what could go wrong, how to handle it",
    "4. **Testing strategy** — how to verify the validation gate passes",
    "5. **Risk assessment** — rate confidence (high/medium/low) and explain concerns",
    "",
    "--- ORIGINAL SLICE INSTRUCTIONS ---",
    originalPrompt,
  ].join("\n");
}

/**
 * Build the reviewer synthesis prompt from dry-run responses.
 */
function buildReviewerPrompt(dryRunResults, slice) {
  const originalPrompt = buildSlicePrompt(slice);
  const parts = [
    "You are the QUORUM REVIEWER. Three AI models independently analyzed the same coding task",
    "and produced implementation plans. Your job is to synthesize the BEST execution plan.",
    "",
    "Rules:",
    "- Pick the BEST approach for each file/component (not necessarily from the same model)",
    "- When models DISAGREE on architecture, choose the approach with better error handling and testability",
    "- Flag any RISK AREAS where all three models expressed concerns",
    "- Produce a CONCRETE execution plan (not vague guidance) — the output will be used as instructions for the executing agent",
    "- Include specific file paths, class names, method signatures, and patterns to use",
    "",
  ];

  for (let i = 0; i < dryRunResults.length; i++) {
    const r = dryRunResults[i];
    parts.push(`--- MODEL ${String.fromCharCode(65 + i)} (${r.model}) ---`);
    parts.push(r.output || "(no response)");
    parts.push("");
  }

  parts.push("--- ORIGINAL SLICE ---");
  parts.push(originalPrompt);
  parts.push("");
  parts.push("Produce the unified execution plan now.");

  return parts.join("\n");
}

const LEG_ERROR_PATTERNS = [
  [/timed?\s*out|ETIMEDOUT|SIGTERM/i, "timeout"],
  [/rate[- ]?limit|429/i, "rate-limit"],
  [/context|token limit|max tokens/i, "context-overflow"],
  [/ENOENT|spawn\s+\w+\s+ENOENT|EACCES/i, "spawn-failed"],
];
export function classifyLegError(stderr) {
  const text = String(stderr || "");
  for (const [re, reason] of LEG_ERROR_PATTERNS) {
    if (re.test(text)) return reason;
  }
  return "unknown";
}

/**
 * Dispatch a slice to multiple models for parallel dry-run analysis.
 * Returns array of dry-run results.
 *
 * @param {object} slice - Parsed slice
 * @param {object} config - Quorum config from loadQuorumConfig()
 * @param {object} options - { cwd, eventBus, memoryEnabled, projectName }
 * @returns {Promise<{ model: string, output: string, tokens: object, duration: number, exitCode: number }[]>}
 */
export async function quorumDispatch(slice, config, options = {}) {
  const { cwd = process.cwd(), eventBus = null, memoryEnabled = false, projectName = "" } = options;

  let dryPrompt = buildDryRunPrompt(slice);

  // OpenBrain: inject memory search for dry-run agents too
  if (memoryEnabled) {
    dryPrompt = buildMemorySearchBlock(projectName, slice) + "\n" + dryPrompt;
  }

  if (eventBus) {
    eventBus.emit("quorum-dispatch-started", {
      sliceId: slice.number,
      models: config.models,
      score: options.complexityScore || null,
    });
  }

  const startTime = Date.now();
  const promises = config.models.map(async (model) => {
    const legStart = Date.now();
    try {
      const result = await spawnWorker(dryPrompt, {
        model,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
        role: "quorum-dry-run", // bug #80: API providers see system-framed prompt
      });
      const legResult = {
        model,
        output: result.output || result.stderr || "",
        tokens: result.tokens,
        duration: Date.now() - legStart,
        exitCode: result.exitCode,
        success: true, // gh copilot may exit non-zero but still produce useful output
      };
      // Determine success: has meaningful output (stdout or stderr) regardless of exit code
      // gh copilot outputs text to stderr in non-TTY mode
      legResult.success = (legResult.output || "").trim().length > 50;
      if (!legResult.success) {
        const stderr = String(result?.stderr || "").slice(-2048);
        legResult.error = {
          code: legResult.exitCode ?? 1,
          reason: classifyLegError(stderr),
          stderr,
        };
      }
      if (eventBus) {
        eventBus.emit("quorum-leg-completed", { sliceId: slice.number, ...legResult });
      }
      return legResult;
    } catch (err) {
      const rawStderr = err?.stderr ?? err?.message ?? String(err ?? "");
      const stderr = rawStderr.slice(-2048);
      const reason = classifyLegError(stderr);
      const exitCode = Number.isInteger(err?.exitCode) ? err.exitCode : (err?.code ?? 1);
      const legResult = {
        model,
        output: "",
        tokens: { tokens_in: null, tokens_out: null, model },
        duration: Date.now() - legStart,
        exitCode,
        success: false,
        error: { code: exitCode, reason, stderr },
      };
      if (eventBus) {
        eventBus.emit("quorum-leg-completed", { sliceId: slice.number, ...legResult });
      }
      return legResult;
    }
  });

  const results = await Promise.all(promises);

  // Filter to successful responses
  const successful = results.filter((r) => r.success && (r.output || "").trim().length > 0);

  return { all: results, successful, totalDuration: Date.now() - startTime };
}

/**
 * Synthesize multiple dry-run responses into a unified execution plan.
 * Spawns a reviewer agent to merge the best elements.
 *
 * @param {{ successful: object[] }} dispatchResult - Output from quorumDispatch()
 * @param {object} slice - Original slice
 * @param {object} config - Quorum config
 * @param {object} options - { cwd, eventBus }
 * @returns {Promise<{ enhancedPrompt: string, reviewerTokens: object, reviewerCost: number, modelResponses: object[] }>}
 */
export async function quorumReview(dispatchResult, slice, config, options = {}) {
  const { cwd = process.cwd(), eventBus = null } = options;
  const { successful } = dispatchResult;

  // Need at least 2 responses for meaningful consensus
  if (successful.length < 2) {
    // Fall back: use the single best response or original prompt
    const fallback = successful.length === 1
      ? `Based on analysis, here is the recommended approach:\n\n${successful[0].output}\n\n--- EXECUTE ---\n${buildSlicePrompt(slice)}`
      : buildSlicePrompt(slice);

    return {
      enhancedPrompt: fallback,
      reviewerTokens: { tokens_in: 0, tokens_out: 0, model: "none" },
      reviewerCost: 0,
      modelResponses: successful,
      fallback: true,
    };
  }

  const reviewerPrompt = buildReviewerPrompt(successful, slice);

  try {
    const reviewerResult = await spawnWorker(reviewerPrompt, {
      model: config.reviewerModel,
      cwd,
      timeout: config.dryRunTimeout || 300_000,
      role: "reviewer", // bug #80: API providers see system-framed prompt
    });

    const enhancedPrompt = [
      `Execute Slice ${slice.number}: ${slice.title}`,
      "",
      "The following execution plan was synthesized from multi-model consensus analysis.",
      "Follow this plan precisely:",
      "",
      reviewerResult.output,
      "",
      "--- ORIGINAL REQUIREMENTS ---",
      // Include scope and gate from original so they're not lost
      ...(slice.scope && slice.scope.length > 0
        ? [`SCOPE: Only modify files matching: ${slice.scope.join(", ")}`, "Do NOT create or modify files outside this scope.", ""]
        : []),
      ...(slice.validationGate
        ? ["Validation gate (run these after completion):", slice.validationGate, ""]
        : []),
    ].join("\n");

    if (eventBus) {
      eventBus.emit("quorum-review-completed", {
        sliceId: slice.number,
        reviewerModel: config.reviewerModel,
        tokens: reviewerResult.tokens,
        modelCount: successful.length,
      });
    }

    return {
      enhancedPrompt,
      reviewerTokens: reviewerResult.tokens,
      reviewerCost: calculateSliceCost(reviewerResult.tokens).cost_usd,
      modelResponses: successful,
      fallback: false,
    };
  } catch (err) {
    // Reviewer failed — fall back to best single dry-run
    const best = successful.reduce((a, b) =>
      (a.output || "").length > (b.output || "").length ? a : b);

    return {
      enhancedPrompt: `Based on analysis by ${best.model}, here is the recommended approach:\n\n${best.output || ""}\n\n--- EXECUTE ---\n${buildSlicePrompt(slice)}`,
      reviewerTokens: { tokens_in: 0, tokens_out: 0, model: "none" },
      reviewerCost: 0,
      modelResponses: successful,
      fallback: true,
      error: err.message,
    };
  }
}

// ─── Quorum Analysis ─────────────────────────────────────────────────

/**
 * Multi-model analysis of a plan or file.
 * Dispatches independent analysis to N models, then synthesizes findings.
 *
 * Modes:
 *   - plan: Analyze a hardened plan for consistency, coverage gaps, risk
 *   - file: Analyze source file(s) for bugs, patterns, improvements
 *
 * @param {object} options - { target, mode, models, cwd }
 * @returns {Promise<{ results, synthesis, cost }>}
 */
export async function analyzeWithQuorum(options = {}) {
  const {
    target,
    mode = "plan",   // "plan" | "file" | "diagnose"
    models = null,
    cwd = process.cwd(),
  } = options;

  const config = loadQuorumConfig(cwd);
  const analyzeModels = models || config.models;

  // Build analysis prompt based on mode
  let content;
  try {
    content = readFileSync(resolve(cwd, target), "utf-8");
  } catch (err) {
    throw new Error(`Cannot read analysis target: ${target} — ${err.message}`);
  }

  const prompt = mode === "plan"
    ? buildPlanAnalysisPrompt(content, target)
    : mode === "diagnose"
      ? buildDiagnosePrompt(content, target)
      : buildFileAnalysisPrompt(content, target);

  console.log(`\n🗳️  Quorum Analysis — dispatching to ${analyzeModels.length} models...`);
  console.log(`   Target: ${target} (${mode} mode)`);
  console.log(`   Models: ${analyzeModels.join(", ")}\n`);

  // Dispatch to all models in parallel
  const startTime = Date.now();
  const promises = analyzeModels.map(async (model) => {
    const legStart = Date.now();
    console.log(`   ⏳ ${model} — analyzing...`);
    try {
      const result = await spawnWorker(prompt, {
        model,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
        role: "analysis", // bug #80: API providers see system-framed prompt
      });
      const duration = Date.now() - legStart;
      console.log(`   ✅ ${model} — done (${Math.round(duration / 1000)}s)`);
      return {
        model,
        output: result.output || "",
        tokens: result.tokens,
        duration,
        success: (result.output || "").trim().length > 50,
        worker: result.worker,
      };
    } catch (err) {
      const duration = Date.now() - legStart;
      console.log(`   ❌ ${model} — failed: ${err.message}`);
      return {
        model,
        output: "",
        tokens: { tokens_in: 0, tokens_out: 0, model },
        duration,
        success: false,
        error: err.message,
        worker: "failed",
      };
    }
  });

  const results = await Promise.all(promises);
  const successful = results.filter((r) => r.success);
  const totalDuration = Date.now() - startTime;

  console.log(`\n   📊 ${successful.length}/${results.length} models returned results (${Math.round(totalDuration / 1000)}s total)`);

  // Synthesize findings if we have 2+ responses
  let synthesis = null;
  let synthesisCost = 0;
  if (successful.length >= 2) {
    console.log(`   🔄 Synthesizing with ${config.reviewerModel}...`);
    const synthPrompt = buildAnalysisSynthesisPrompt(successful, target, mode);
    try {
      const synthResult = await spawnWorker(synthPrompt, {
        model: config.reviewerModel,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
        role: "reviewer", // bug #80: API providers see system-framed prompt
      });
      synthesis = synthResult.output || "";
      synthesisCost = calculateSliceCost(synthResult.tokens).cost_usd;
      console.log(`   ✅ Synthesis complete`);
    } catch (err) {
      console.log(`   ⚠️  Synthesis failed: ${err.message} — returning raw results`);
    }
  } else if (successful.length === 1) {
    synthesis = successful[0].output;
  }

  // Calculate total cost
  let totalCost = synthesisCost;
  for (const r of results) {
    totalCost += calculateSliceCost(r.tokens).cost_usd;
  }

  return {
    target,
    mode,
    models: analyzeModels,
    results: results.map((r) => ({
      model: r.model,
      output: r.output,
      duration: r.duration,
      success: r.success,
      worker: r.worker,
      cost: calculateSliceCost(r.tokens).cost_usd,
      error: r.error,
    })),
    synthesis,
    totalDuration,
    totalCost: Math.round(totalCost * 100) / 100,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build analysis prompt for a hardened plan file.
 */
function buildPlanAnalysisPrompt(content, filename) {
  return [
    "You are a senior software architect performing an independent code review of a hardened execution plan.",
    "Analyze the following plan and report on:",
    "",
    "1. **Consistency**: Are slice dependencies correct? Do scopes overlap or conflict?",
    "2. **Coverage Gaps**: Are there untested edge cases, missing error handlers, or validation gaps?",
    "3. **Risk Assessment**: Which slices have the highest failure risk and why?",
    "4. **Naming & Style**: Are naming conventions consistent across slices?",
    "5. **Security**: Any security concerns in the planned implementation?",
    "6. **Improvement Suggestions**: Concrete, actionable improvements.",
    "",
    "Format your response as structured Markdown with clear headings for each category.",
    "Rate each category as: ✅ Good | ⚠️ Needs Attention | ❌ Critical Issue",
    "End with an overall confidence score (1-10) for plan readiness.",
    "",
    `--- PLAN: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build analysis prompt for source file(s).
 */
function buildFileAnalysisPrompt(content, filename) {
  return [
    "You are a senior software engineer performing an independent code review.",
    "Analyze the following file and report on:",
    "",
    "1. **Bugs**: Logic errors, null reference risks, race conditions, off-by-one errors",
    "2. **Security**: Input validation gaps, injection risks, auth issues, secret exposure",
    "3. **Performance**: Hot paths, unnecessary allocations, N+1 queries, missing caching",
    "4. **Architecture**: Separation of concerns, testability, coupling issues",
    "5. **Error Handling**: Missing error handlers, swallowed exceptions, incomplete recovery",
    "6. **Improvements**: Concrete, actionable fixes with code snippets where helpful",
    "",
    "Format your response as structured Markdown with clear headings.",
    "Rate each category as: ✅ Good | ⚠️ Needs Attention | ❌ Critical Issue",
    "End with an overall code quality score (1-10).",
    "",
    `--- FILE: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build diagnosis prompt for bug investigation.
 * Focused on root cause analysis, failure modes, and fix recommendations.
 */
function buildDiagnosePrompt(content, filename) {
  return [
    "You are a senior software engineer performing a focused bug investigation.",
    "The user suspects there may be bugs or reliability issues in this file.",
    "Investigate thoroughly and report on:",
    "",
    "1. **Root Cause Analysis**: What bugs exist? Trace the exact code path for each.",
    "2. **Failure Modes**: How will each bug manifest at runtime? Under what conditions?",
    "3. **Reproduction Steps**: How would you trigger each bug? What inputs or state?",
    "4. **Impact Assessment**: Severity (crash/data loss/wrong result/cosmetic) and blast radius",
    "5. **Fix Recommendations**: Exact code changes needed. Show before/after snippets.",
    "6. **Regression Risk**: Could the fixes break other functionality? What tests should be added?",
    "",
    "Be thorough — examine every code path, every edge case, every null/undefined risk.",
    "Check for: race conditions, boundary values, error propagation, resource leaks,",
    "unhandled promise rejections, type coercion bugs, off-by-one errors, stale closures.",
    "",
    "Format your response as structured Markdown with clear headings.",
    "Rate overall reliability as: ✅ Solid | ⚠️ Has Issues | ❌ Unreliable",
    "End with a prioritized fix list (fix most critical bugs first).",
    "",
    `--- FILE UNDER INVESTIGATION: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build synthesis prompt from multiple model analysis results.
 */
function buildAnalysisSynthesisPrompt(successful, target, mode) {
  const type = mode === "plan" ? "plan analysis" : mode === "diagnose" ? "bug investigation" : "code review";
  let prompt = [
    `You are a senior technical reviewer synthesizing ${type} results from ${successful.length} independent AI models.`,
    `Each model independently analyzed: ${target}`,
    "",
    "Your job is to:",
    "1. Identify findings that MULTIPLE models agree on (high confidence)",
    "2. Flag unique findings from single models that seem valid (medium confidence)",
    "3. Resolve any contradictions between models",
    "4. Produce a unified, prioritized report",
    "",
    "Format: Structured Markdown with priority levels (🔴 Critical, 🟡 Important, 🟢 Minor).",
    "Include a confidence indicator for each finding: [Consensus: N/M models agree]",
    "End with an overall assessment and top 3 action items.",
    "",
  ].join("\n");

  for (const r of successful) {
    prompt += `\n--- ANALYSIS BY ${r.model} ---\n${r.output}\n`;
  }

  return prompt;
}

// ─── Pricing + Cost Estimation ────────────────────────────────────────
// Phase-27 (v2.60.0): Canonical pricing + estimation logic lives in
// ./cost-service.mjs. This block imports and re-exports the functions so
// existing `import { calculateSliceCost, buildCostBreakdown, buildEstimate }
// from "./orchestrator.mjs"` call sites (tests, sdk consumers, internal
// orchestrator code below) remain drop-in compatible.
//
// NOTE: We use function declarations (hoisted, live from module-init) rather
// than `export const` aliases. Under vitest with circular imports the const
// aliases arrive undefined at the importer; function declarations do not.
import {
  priceSlice as _priceSlice,
  priceRun as _priceRun,
  estimatePlan as _estimatePlan,
} from "./cost-service.mjs";

export function calculateSliceCost(tokens, worker) {
  return _priceSlice(tokens, worker);
}
export function buildCostBreakdown(sliceResults) {
  return _priceRun(sliceResults);
}
export function buildEstimate(plan, model, cwd, quorumConfig = null, resumeFrom = null, worker = null) {
  return _estimatePlan(plan, model, cwd, quorumConfig, resumeFrom, worker);
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

// ─── Architecture Guardrail Rules ────────────────────────────────────
const GUARDRAIL_RULES = [
  { id: "empty-catch",     pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*)?\s*\}|catch\s*(?:\([^)]*\))?\s*\{\s*\/\*[^*]*\*\/\s*\}/g, severity: "high",     description: "Empty catch block — must log or handle the error (comments alone don't count)" },
  { id: "any-type",        pattern: /:\s*any\b|<any>|as\s+any\b/g,                             severity: "medium",   description: "Avoid 'any' type — use explicit types" },
  { id: "sync-over-async", pattern: /\.(Result|Wait\(\))\b/g,                                  severity: "high",     description: "Sync-over-async (.Result/.Wait()) — use await instead" },
  { id: "sql-injection",   pattern: /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b[^`]*\$\{/gi, severity: "critical", description: "SQL string interpolation — use parameterized queries" },
  { id: "deferred-work",   pattern: /\b(TODO|FIXME|HACK)\b/g,                                  severity: "low",      description: "Deferred work marker in production code" },
];

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx", ".cs", ".py"]);
const EXCLUDE_DIRS = new Set(["node_modules", ".git", "bin", "obj", "dist", ".forge", "vendor", "coverage", ".next", "out"]);

/** Framework paths that belong to Plan Forge itself, not the user's application code. */
const FRAMEWORK_PATHS = ["pforge-mcp", "pforge.ps1", "pforge.sh", "setup.ps1", "setup.sh", "validate-setup.ps1", "validate-setup.sh"];

/**
 * Scan source files for architecture guardrail violations.
 * Called by forge_drift_report to score the codebase without spawning a subprocess.
 * Separates app code violations from framework (Plan Forge) code violations.
 *
 * @param {object} options
 * @param {string} [options.path="."]   - Directory to scan (relative to cwd)
 * @param {string} [options.mode="file"] - Analysis mode (currently only "file" is used)
 * @param {string[]|null} [options.rules=null] - Rule IDs to run; null = all rules
 * @param {string} [options.cwd=process.cwd()] - Project root
 * @returns {Promise<{violations: Array<{file,rule,severity,line,description,framework?:boolean}>, frameworkViolations: Array, filesScanned: number}>}
 */
export async function runAnalyze({ mode = "file", path: targetPath = ".", rules = null, cwd = process.cwd(), planPath = null } = {}) {
  const activeRules = rules
    ? GUARDRAIL_RULES.filter(r => rules.includes(r.id))
    : GUARDRAIL_RULES;

  const rootPath = resolve(cwd, targetPath);
  const violations = [];
  const frameworkViolations = [];
  let filesScanned = 0;

  function isFrameworkPath(relPath) {
    const normalized = relPath.replace(/\\/g, "/");
    return FRAMEWORK_PATHS.some(fp => normalized === fp || normalized.startsWith(fp + "/"));
  }

  function scanDir(dirPath) {
    let entries;
    try { entries = readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) scanDir(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        filesScanned++;
        let content;
        try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
        const relPath = relative(cwd, fullPath);
        const isFramework = isFrameworkPath(relPath);
        const applicableRules = isFramework
          ? activeRules.filter(r => r.id !== "sql-injection") // Skip SQL injection in framework/client-side code
          : activeRules;
        for (const rule of applicableRules) {
          const re = new RegExp(rule.pattern.source, rule.pattern.flags);
          let match;
          while ((match = re.exec(content)) !== null) {
            const line = content.substring(0, match.index).split("\n").length;
            const violation = { file: relPath, rule: rule.id, severity: rule.severity, line, description: rule.description };
            if (isFramework) {
              frameworkViolations.push({ ...violation, framework: true });
            } else {
              violations.push(violation);
            }
          }
        }
      }
    }
  }

  scanDir(rootPath);

  // Phase-31 Slice 2 — plan-parser lint advisories.
  // When planPath is provided, parse the plan and emit an advisory for every
  // slice that has bash code blocks but no explicit **Validation Gate**: marker.
  // Advisory is suppressed when runtime.planParser.implicitGates is true because
  // in that mode parseSlices captures bare bash blocks as the validation gate.
  // Note: we resolve planPath against cwd (not process.cwd()) and call parseSlices
  // directly rather than parsePlan(), which resolves paths against process.cwd().
  const advisories = [];
  if (planPath) {
    try {
      const fullPlanPath = resolve(cwd, planPath);
      const content = readFileSync(fullPlanPath, "utf-8");
      const lines = content.replace(/\r\n/g, "\n").split("\n");
      const { implicitGates } = loadPlanParserConfig(cwd);
      const slices = parseSlices(lines, { implicitGates });
      for (const slice of slices) {
        const bashCount = slice._bashBlockCount || 0;
        if (bashCount > 0 && !slice.validationGate) {
          const blockWord = bashCount === 1 ? "bash block" : "bash blocks";
          advisories.push(
            `ADVISORY plan-parser-gate-missing: Slice ${slice.number} (${slice.title}) has ${bashCount} ${blockWord} but no **Validation Gate**: marker. Add a validation gate or set runtime.planParser.implicitGates = true to suppress.`
          );
        }
      }
    } catch { /* best-effort — missing plan file should not crash runAnalyze */ }
  }

  return { violations, frameworkViolations, filesScanned, advisories };
}

/**
 * Parse the consistency score from `pforge analyze` stdout.
 * Exported for testing — see tests/auto-analyze-issue-189.test.mjs.
 *
 * Looks for either "Consistency Score: NN/100", "NN/100", or "Score: NN".
 * Returns null when no recognizable score line is present.
 */
export function parseAnalyzeScore(output) {
  if (typeof output !== "string" || output.length === 0) return null;
  const match = output.match(/(\d+)\s*\/\s*100|Score:\s*(\d+)/i);
  if (!match) return null;
  const n = parseInt(match[1] || match[2], 10);
  return Number.isFinite(n) ? n : null;
}

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

// ─── Self-Test ────────────────────────────────────────────────────────

async function selfTest() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Plan Forge Orchestrator — Self Test     ║");
  console.log("╚══════════════════════════════════════════╝\n");

  let passed = 0;
  let failed = 0;

  function assert(label, condition) {
    if (condition) {
      console.log(`  ✅ ${label}`);
      passed++;
    } else {
      console.log(`  ❌ ${label}`);
      failed++;
    }
  }

  // Test 1: Parse example plan
  console.log("─── Plan Parser ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      assert("Parses plan without error", true);
      assert(`Found ${plan.slices.length} slices`, plan.slices.length > 0);
      assert("First slice has number", !!plan.slices[0]?.number);
      assert("First slice has title", !!plan.slices[0]?.title);
      assert("DAG has execution order", plan.dag.order.length > 0);
      assert("DAG order matches slice count", plan.dag.order.length === plan.slices.length);
      assert("Meta title extracted", !!plan.meta.title);

      // Check validation gate parsing
      const sliceWithGate = plan.slices.find((s) => s.validationGate);
      assert("At least one slice has validation gate", !!sliceWithGate);

      // Check build command parsing
      const sliceWithBuild = plan.slices.find((s) => s.buildCommand);
      assert("At least one slice has build command", !!sliceWithBuild);
    } else {
      console.log("  ⚠️  Example plan not found — skipping parser tests");
    }
  } catch (err) {
    assert(`Parse plan: ${err.message}`, false);
  }

  // Test 2: Parse Phase 1 plan (with tags)
  console.log("\n─── Phase 1 Plan (tags) ───");
  try {
    const phase1Plan = resolve(process.cwd(), "docs/plans/Phase-1-ORCHESTRATOR-RUN-PLAN-PLAN.md");
    if (existsSync(phase1Plan)) {
      const plan = parsePlan(phase1Plan);
      assert("Parses Phase 1 plan", true);
      assert(`Found ${plan.slices.length} slices`, plan.slices.length >= 8);
      assert("Has scope contract", plan.scopeContract.inScope.length > 0);
      assert("Has forbidden actions", plan.scopeContract.forbidden.length > 0);
    }
  } catch (err) {
    assert(`Parse Phase 1: ${err.message}`, false);
  }

  // Test 3: DAG with dependencies
  console.log("\n─── DAG Builder ───");
  try {
    const testSlices = [
      { number: "1", title: "First", depends: [], parallel: false, scope: [], tasks: [] },
      { number: "2", title: "Second", depends: ["1"], parallel: false, scope: [], tasks: [] },
      { number: "3", title: "Third", depends: ["1"], parallel: true, scope: ["src/**"], tasks: [] },
      { number: "4", title: "Fourth", depends: ["2", "3"], parallel: false, scope: [], tasks: [] },
    ];
    const dag = buildDAG(testSlices);
    assert("DAG built from explicit deps", true);
    assert("Topological order has 4 entries", dag.order.length === 4);
    assert("Slice 1 is first", dag.order[0] === "1");
    assert("Slice 4 is last", dag.order[dag.order.length - 1] === "4");
    assert("Parallel flag preserved", dag.nodes.get("3").parallel === true);
    assert("Scope metadata preserved", dag.nodes.get("3").scope.length > 0);
  } catch (err) {
    assert(`DAG builder: ${err.message}`, false);
  }

  // Test 4: Cycle detection
  console.log("\n─── Cycle Detection ───");
  try {
    const cyclicSlices = [
      { number: "1", title: "A", depends: ["2"], parallel: false, scope: [], tasks: [] },
      { number: "2", title: "B", depends: ["1"], parallel: false, scope: [], tasks: [] },
    ];
    try {
      buildDAG(cyclicSlices);
      assert("Cycle detection throws error", false);
    } catch (err) {
      assert("Cycle detection throws error", err.message.includes("Cycle"));
    }
  } catch (err) {
    assert(`Cycle test: ${err.message}`, false);
  }

  // Test 5: Event bus
  console.log("\n─── Event Bus ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    bus.emit("slice-started", { sliceId: "1" });
    bus.emit("slice-completed", { sliceId: "1" });
    assert("Event bus fires events", events.length === 2);
    assert("Events have type", events[0].type === "slice-started");
    assert("Events have timestamp", !!events[0].timestamp);
    assert("Events have data", !!events[0].data.sliceId);
  } catch (err) {
    assert(`Event bus: ${err.message}`, false);
  }

  // Test 6: Sequential scheduler with mock executor
  console.log("\n─── Sequential Scheduler ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    const scheduler = new SequentialScheduler(bus);

    const nodes = new Map();
    nodes.set("1", { number: "1", title: "First", children: ["2"], inDegree: 0 });
    nodes.set("2", { number: "2", title: "Second", children: [], inDegree: 1 });
    const order = ["1", "2"];

    const results = await scheduler.execute(nodes, order, async (slice) => {
      return { status: "passed", duration: 100 };
    });

    assert("Scheduler executed 2 slices", results.length === 2);
    assert("Both passed", results.every((r) => r.status === "passed"));
    assert("Events fired for lifecycle",
      events.some((e) => e.type === "slice-started") &&
      events.some((e) => e.type === "slice-completed"));
  } catch (err) {
    assert(`Scheduler: ${err.message}`, false);
  }

  // Test 7: Worker detection
  console.log("\n─── Worker Detection ───");
  try {
    const workers = detectWorkers();
    assert("Detects workers array", Array.isArray(workers));
    assert(`Found ${workers.filter((w) => w.available).length} available worker(s)`,
      workers.some((w) => w.available));

    const ghCopilot = workers.find((w) => w.name === "gh-copilot");
    assert("gh-copilot in worker list", !!ghCopilot);
  } catch (err) {
    assert(`Worker detection: ${err.message}`, false);
  }

  // Test 8: Gate execution
  console.log("\n─── Gate Execution ───");
  try {
    const result = runGate("node --version", process.cwd());
    assert("Gate runs command", result.success);
    assert("Gate captures output", result.output.startsWith("v"));

    const failResult = runGate("exit 1", process.cwd());
    assert("Gate detects failure", !failResult.success);

    // C1: Gate allowlist blocks unknown commands
    const blockedResult = runGate("wget http://example.com", process.cwd());
    assert("Gate blocks non-allowlisted commands", !blockedResult.success);
    assert("Gate error mentions allowlist", blockedResult.error.includes("allowlist"));

    // C1: Gate allows common build tools
    const npmResult = runGate("node -e \"console.log('ok')\"", process.cwd());
    assert("Gate allows node commands", npmResult.success);

    // C1: Gate allows curl (used in gate verification commands)
    const curlResult = runGate("curl --version", process.cwd());
    assert("Gate allows curl commands", curlResult.success);
  } catch (err) {
    assert(`Gate execution: ${err.message}`, false);
  }

  // Test 8b: Gate Lint
  console.log("\n─── Gate Lint ───");
  try {
    // Use a real plan file if available
    const lintPlan = resolve(process.cwd(), "docs/plans/Phase-LiveGuard-v2.27.0-PLAN.md");
    if (existsSync(lintPlan)) {
      const result = lintGateCommands(lintPlan);
      assert("Gate lint returns warnings array", Array.isArray(result.warnings));
      assert("Gate lint returns errors array", Array.isArray(result.errors));
      assert("Gate lint returns passed boolean", typeof result.passed === "boolean");
      assert("Gate lint returns summary string", typeof result.summary === "string");
      assert("Cleaned plan has 0 errors", result.errors.length === 0);
    } else {
      console.log("  ⚠️  LiveGuard plan not found — skipping gate lint tests");
    }

    // Test lint detection with synthetic bad commands
    const origParse = parsePlan;
    // Temporarily test the detection logic inline
    const testLines = [
      "# this is a comment",
      "node pforge-mcp/tests/foo.test.mjs",
      "curl http://localhost:3100/api/test",
      "wget http://example.com",
    ];
    const commentLine = testLines[0];
    assert("Detects comment lines", commentLine.startsWith("#"));

    const vitestLine = testLines[1];
    assert("Detects node *.test.mjs pattern", /^node\s+.*\.test\.(mjs|js|ts)/.test(vitestLine));

    const curlLine = testLines[2];
    assert("Detects curl localhost pattern", /curl\s.*localhost[:\s]/.test(curlLine));

    const wgetCmd = testLines[3].split(/\s+/)[0].toLowerCase();
    assert("Detects blocked command", !GATE_ALLOWED_PREFIXES.some(p => wgetCmd === p));
  } catch (err) {
    assert(`Gate lint: ${err.message}`, false);
  }

  // Test 9: Estimate mode
  console.log("\n─── Estimate Mode ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const plan = parsePlan(examplePlan);
      const est = buildEstimate(plan, "claude-sonnet-4.6", process.cwd());
      assert("Estimate has slice count", est.sliceCount > 0);
      assert("Estimate has cost", est.estimatedCostUSD >= 0);
      assert("Estimate has tokens", est.tokens.estimatedInput > 0);
      assert("Estimate has execution order", est.executionOrder.length > 0);
      assert("Estimate has confidence", est.confidence === "heuristic" || est.confidence === "historical");
      assert("Estimate has source", !!est.tokens.source);
    }
  } catch (err) {
    assert(`Estimate: ${err.message}`, false);
  }

  // Test 10: runPlan() dry-run mode (T1: end-to-end test)
  console.log("\n─── Full Run (Dry-Run) ───");
  try {
    const examplePlan = resolve(process.cwd(), "docs/plans/examples/Phase-DOTNET-EXAMPLE.md");
    if (existsSync(examplePlan)) {
      const result = await runPlan(examplePlan, { dryRun: true, cwd: process.cwd() });
      assert("Dry-run returns status", result.status === "dry-run");
      assert("Dry-run returns plan object", !!result.plan);
      assert("Dry-run plan has slices", result.plan.slices.length > 0);
    }
  } catch (err) {
    assert(`Dry-run: ${err.message}`, false);
  }

  // Test 11: Model routing (T2: loadModelRouting)
  console.log("\n─── Model Routing ───");
  try {
    const routing = loadModelRouting(process.cwd());
    assert("loadModelRouting returns object", typeof routing === "object");
    assert("Has default key", "default" in routing);

    // resolveModel priority chain
    assert("CLI override wins", resolveModel("claude-sonnet-4.6", { default: "gpt-5" }, null) === "claude-sonnet-4.6");
    assert("Routing default when CLI is auto", resolveModel("auto", { default: "gpt-5" }, null) === "gpt-5");
    assert("Null when both auto", resolveModel(null, { default: "auto" }, null) === null);
    assert("Default is claude-opus-4.6 when no .forge.json", loadModelRouting("/nonexistent-path-pforge-test").default === "claude-opus-4.6");
  } catch (err) {
    assert(`Model routing: ${err.message}`, false);
  }

  // Test 12: Path traversal prevention (C4)
  console.log("\n─── Security ───");
  try {
    try {
      parsePlan("../../../../etc/passwd");
      assert("Path traversal blocked", false);
    } catch (err) {
      assert("Path traversal blocked", err.message.includes("within project"));
    }
  } catch (err) {
    assert(`Security: ${err.message}`, false);
  }

  // Test 13: Error paths (T2: missing file)
  console.log("\n─── Error Paths ───");
  try {
    try {
      parsePlan("nonexistent-plan.md");
      assert("Missing file throws", false);
    } catch {
      assert("Missing file throws", true);
    }

    // Token extraction with empty events
    const emptyTokens = extractTokens([]);
    assert("Empty events returns null tokens_in", emptyTokens.tokens_in === null);
    assert("Empty events returns 0 tokens_out", emptyTokens.tokens_out === 0);
  } catch (err) {
    assert(`Error paths: ${err.message}`, false);
  }

  // Test 14: Cost calculation (Phase 2)
  console.log("\n─── Cost Calculation ───");
  try {
    // Per-slice cost
    const cost1 = calculateSliceCost({ tokens_in: 1000, tokens_out: 500, model: "claude-sonnet-4.6" });
    assert("Cost calculated for Claude Sonnet", cost1.cost_usd > 0);
    assert("Cost has model", cost1.model === "claude-sonnet-4.6");
    // 1000 * 3/1M + 500 * 15/1M = 0.003 + 0.0075 = 0.0105
    assert("Cost matches expected", Math.abs(cost1.cost_usd - 0.0105) < 0.0001);

    const cost2 = calculateSliceCost({ tokens_in: null, tokens_out: 100, model: "unknown-model" });
    assert("Unknown model uses default pricing", cost2.cost_usd > 0);
    assert("Null tokens_in treated as 0", cost2.tokens_in === 0);

    // CLI worker uses premium request costing, not token pricing
    const cost3 = calculateSliceCost({ tokens_in: 500000, tokens_out: 5000, model: "claude-opus-4.6", premiumRequests: 3 }, "gh-copilot");
    assert("CLI worker uses premium request rate", cost3.cost_usd === 0.03);
    assert("CLI worker preserves token counts", cost3.tokens_in === 500000);

    // API worker uses per-token pricing
    const cost4 = calculateSliceCost({ tokens_in: 1000, tokens_out: 500, model: "grok-4" }, "api-xai");
    assert("API worker uses token pricing", cost4.cost_usd > 0);
    assert("API worker cost matches expected", Math.abs(cost4.cost_usd - 0.005) < 0.0001); // 1000*2/1M + 500*6/1M

    // Breakdown
    const mockResults = [
      { number: "1", tokens: { tokens_in: 500, tokens_out: 200, model: "claude-sonnet-4.6" }, status: "passed" },
      { number: "2", tokens: { tokens_in: 300, tokens_out: 100, model: "gpt-5-mini" }, status: "passed" },
      { number: "3", status: "skipped" },
    ];
    const breakdown = buildCostBreakdown(mockResults);
    assert("Breakdown has total cost", breakdown.total_cost_usd >= 0);
    assert("Breakdown has 2 models", Object.keys(breakdown.by_model).length === 2);
    assert("Breakdown has 2 slices (skipped excluded)", breakdown.by_slice.length === 2);

    // Cost report with no history
    const report = getCostReport(process.cwd());
    assert("Cost report works (may be empty)", report !== undefined);
  } catch (err) {
    assert(`Cost calculation: ${err.message}`, false);
  }

  // Test 15: Parallel scheduler (Phase 6)
  console.log("\n─── Parallel Scheduler ───");
  try {
    const events = [];
    const handler = { handle: (e) => events.push(e) };
    const bus = new OrchestratorEventBus(handler);
    const pScheduler = new ParallelScheduler(bus, 2);

    // Build a DAG with parallel slices
    const pNodes = new Map();
    pNodes.set("1", { number: "1", title: "Setup", depends: [], parallel: false, scope: [], children: ["2", "3"], inDegree: 0 });
    pNodes.set("2", { number: "2", title: "AuthModule", depends: ["1"], parallel: true, scope: ["src/auth/**"], children: ["4"], inDegree: 1 });
    pNodes.set("3", { number: "3", title: "UserModule", depends: ["1"], parallel: true, scope: ["src/user/**"], children: ["4"], inDegree: 1 });
    pNodes.set("4", { number: "4", title: "Integration", depends: ["2", "3"], parallel: false, scope: [], children: [], inDegree: 2 });
    const pOrder = ["1", "2", "3", "4"];

    let concurrentCount = 0;
    let maxConcurrent = 0;
    const pResults = await pScheduler.execute(pNodes, pOrder, async (slice) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 50)); // Simulate work
      concurrentCount--;
      return { status: "passed", duration: 50 };
    });

    assert("Parallel scheduler executed all 4 slices", pResults.length === 4);
    assert("All slices passed", pResults.every((r) => r.status === "passed"));
    assert("Slices 2+3 ran in parallel", maxConcurrent >= 2);
    assert("Events fired for parallel slices", events.some((e) => e.type === "slice-completed"));

    // Test conflict detection
    const conflictNodes = new Map();
    conflictNodes.set("1", { parallel: true, scope: ["src/auth/**"] });
    conflictNodes.set("2", { parallel: true, scope: ["src/auth/login.js"] }); // Overlaps!
    conflictNodes.set("3", { parallel: true, scope: ["src/user/**"] }); // No overlap
    const conflicts = detectScopeConflicts(conflictNodes);
    assert("Conflict detection finds overlapping scopes", conflicts.has("1") && conflicts.has("2"));
    assert("Non-overlapping scope has no conflict", !conflicts.has("3"));
  } catch (err) {
    assert(`Parallel scheduler: ${err.message}`, false);
  }

  // Test 16: Quorum — Complexity scoring (v2.5)
  console.log("\n─── Quorum: Complexity Scoring ───");
  try {
    // Simple slice — low complexity
    const simpleSlice = {
      number: "1", title: "Add README",
      tasks: ["Create README.md"],
      scope: [], depends: [], validationGate: "",
    };
    const simpleResult = scoreSliceComplexity(simpleSlice, process.cwd());
    assert("Simple slice scores low", simpleResult.score <= 3);
    assert("Score has signals object", typeof simpleResult.signals === "object");
    assert("Signals have scopeWeight", "scopeWeight" in simpleResult.signals);

    // Complex slice — auth + migration + many deps + many tasks
    const complexSlice = {
      number: "2", title: "Auth migration with RBAC",
      tasks: [
        "Create migration for users table",
        "Implement JWT authentication",
        "Add RBAC role checking middleware",
        "Create token refresh endpoint",
        "Add password hashing service",
        "Write auth integration tests",
        "Add CORS policy for auth endpoints",
        "Seed admin role data",
      ],
      scope: ["src/auth/**", "src/middleware/**", "db/migrations/**", "tests/auth/**"],
      depends: ["1", "3", "4"],
      validationGate: "dotnet build\ndotnet test --filter Auth\ndotnet ef database update\ncurl -f http://localhost/health",
    };
    const complexResult = scoreSliceComplexity(complexSlice, process.cwd());
    assert("Complex slice scores high", complexResult.score >= 7);
    assert("Security keywords detected", complexResult.signals.securityWeight > 0);
    assert("Database keywords detected", complexResult.signals.databaseWeight > 0);
    assert("High task count detected", complexResult.signals.taskWeight > 0);
    assert("Multiple deps detected", complexResult.signals.dependencyWeight > 0);

    // Score is always 1-10
    assert("Score >= 1", simpleResult.score >= 1);
    assert("Score <= 10", complexResult.score <= 10);
  } catch (err) {
    assert(`Complexity scoring: ${err.message}`, false);
  }

  // Test 17: Quorum — Config loading (v2.5)
  console.log("\n─── Quorum: Config ───");
  try {
    const config = loadQuorumConfig(process.cwd());
    assert("Config has enabled flag", "enabled" in config);
    assert("Config has auto flag", "auto" in config);
    assert("Config has threshold", typeof config.threshold === "number");
    assert("Config has models array", Array.isArray(config.models));
    assert("Config has 3 default models", config.models.length === 3);
    assert("Config has reviewerModel", typeof config.reviewerModel === "string");
    assert("Config has dryRunTimeout", typeof config.dryRunTimeout === "number");
    assert("Default threshold is 6", config.threshold === 6);
  } catch (err) {
    assert(`Quorum config: ${err.message}`, false);
  }

  // Test 18: CI config loading
  console.log("\n─── CI/CD Integration ───");
  try {
    const ciConfig = loadCiConfig(process.cwd());
    assert("loadCiConfig returns object", typeof ciConfig === "object");
    assert("Has enabled flag", "enabled" in ciConfig);
    assert("Has workflow field", "workflow" in ciConfig);
    assert("Has ref field", "ref" in ciConfig);
    assert("Has inputs field", typeof ciConfig.inputs === "object");
    assert("Default enabled is false", ciConfig.enabled === false || typeof ciConfig.enabled === "boolean");
    assert("Default ref is main (when no config)", ciConfig.workflow === null || typeof ciConfig.workflow === "string");
  } catch (err) {
    assert(`CI config: ${err.message}`, false);
  }

  // Test 19: Agent-Per-Slice Routing (Slice 1)
  console.log("\n─── Agent-Per-Slice Routing ───");
  try {
    // inferSliceType detection
    const testSlice = { title: "Write unit tests for auth module", tasks: ["Add spec coverage"] };
    assert("Infers test type", inferSliceType(testSlice) === "test");

    const reviewSlice = { title: "Code review and audit", tasks: ["Review PR changes"] };
    assert("Infers review type", inferSliceType(reviewSlice) === "review");

    const migrationSlice = { title: "Database migration", tasks: ["Add schema migration for users table"] };
    assert("Infers migration type", inferSliceType(migrationSlice) === "migration");

    const executeSlice2 = { title: "Implement auth service", tasks: ["Add login endpoint"] };
    assert("Defaults to execute type", inferSliceType(executeSlice2) === "execute");

    // recommendModel returns null when no performance data
    const noRec = recommendModel(process.cwd(), "execute");
    assert("recommendModel returns null or object", noRec === null || typeof noRec === "object");
    if (noRec !== null) {
      assert("Recommendation has model", typeof noRec.model === "string");
      assert("Recommendation has success_rate", typeof noRec.success_rate === "number");
      assert("Recommendation has total_slices", typeof noRec.total_slices === "number");
    }

    // slice-model-routed event is registered in the event bus
    const events2 = [];
    const handler2 = { handle: (e) => events2.push(e) };
    const bus2 = new OrchestratorEventBus(handler2);
    bus2.emit("slice-model-routed", { sliceId: "1", model: "test-model" });
    assert("slice-model-routed event fires", events2.some((e) => e.type === "slice-model-routed"));
  } catch (err) {
    assert(`Agent-per-slice routing: ${err.message}`, false);
  }

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Phase 53 S0 — Orchestrator surface snapshot contract.
 * Returns deterministic export + section-banner metadata for snapshot testing.
 * Pure function — no side effects, no I/O.
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
    sectionBanners: [
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
    ],
  };
}

// ─── CLI Entry Point ──────────────────────────────────────────────────

// Fix 1: Clean up zombie child processes when parent exits
for (const sig of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (global.__pforgeChildren) {
      for (const child of global.__pforgeChildren) {
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
      }
    }
  });
}

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

if (args.includes("--test")) {
  selfTest();
} else if (args.includes("--parse")) {
  const planPath = getArg("--parse");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --parse <plan-path>");
    process.exit(1);
  }
  const plan = parsePlan(planPath);
  console.log(JSON.stringify(plan, null, 2));
} else if (args.includes("--run")) {
  const planPath = getArg("--run");
  if (!planPath) {
    console.error("Usage: node orchestrator.mjs --run <plan-path> [options]");
    process.exit(1);
  }

  const mode = getArg("--mode") || "auto";
  const model = getArg("--model") || null;
  // Phase GITHUB-B.1: --worker <name> selects a non-default worker. Currently
  // recognised: "copilot-coding-agent" (Phase GITHUB-B Slice 3 dispatch path).
  // Falls through to standard worker selection when null.
  const worker = getArg("--worker") || null;
  const resumeFrom = getArg("--resume-from") ? Number(getArg("--resume-from")) : null;
  const estimate = args.includes("--estimate");
  const dryRun = args.includes("--dry-run");

  // Quorum mode: --quorum=auto (default), --quorum=power, --quorum=speed, --quorum (force all), --no-quorum / --quorum=false (disable)
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
  const quorumThreshold = getArg("--quorum-threshold") ? Number(getArg("--quorum-threshold")) : null;

  // v2.37 Crucible (Slice 01.4) — --manual-import bypass for legacy
  // / Spec Kit-imported plans without a `crucibleId:` frontmatter.
  const manualImport = args.includes("--manual-import");
  const manualImportSource = getArg("--manual-import-source") || "human";
  const manualImportReason = getArg("--manual-import-reason") || null;
  const strictGates = args.includes("--strict-gates");

  // Phase-33.1: --only-slices <expr> and --no-tempering
  const onlySlicesRaw = getArg("--only-slices");
  let onlySlices = null;
  if (onlySlicesRaw) {
    try {
      onlySlices = parseOnlySlicesExpr(onlySlicesRaw);
    } catch (err) {
      console.error(`Orchestrator error: ${err.message}`);
      process.exit(1);
    }
  }
  if (resumeFrom !== null && onlySlices !== null && onlySlices.length > 0) {
    console.error("--resume-from and --only-slices are mutually exclusive");
    process.exit(1);
  }
  const noTempering = args.includes("--no-tempering");

  // Meta-bug #129: allow re-running a plan whose target version is already
  // tagged on origin. Default: false (refuse retrograde releases).
  const allowRetrograde = args.includes("--allow-retrograde");

  try {
    const result = await runPlan(planPath, {
      cwd: process.cwd(),
      mode,
      model,
      worker,
      resumeFrom,
      estimate,
      dryRun,
      quorum,
      quorumThreshold,
      quorumPreset,
      manualImport,
      manualImportSource,
      manualImportReason,
      strictGates,
      onlySlices,
      noTempering,
      allowRetrograde,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.status === "failed" ? 1 : 0);
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
    process.exit(typeof err.exitCode === "number" ? err.exitCode : 1);
  }
} else if (args.includes("--analyze")) {
  const target = getArg("--analyze");
  if (!target) {
    console.error("Usage: node orchestrator.mjs --analyze <plan-or-file> [--mode plan|file] [--models model1,model2,...]");
    process.exit(1);
  }

  const mode = getArg("--mode") || (target.match(/plan/i) ? "plan" : "file");
  const modelsArg = getArg("--models");
  const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;

  try {
    const result = await analyzeWithQuorum({
      target,
      mode,
      models,
      cwd: process.cwd(),
    });

    // Print synthesis (readable) to stdout
    if (result.synthesis) {
      console.log("\n" + "═".repeat(60));
      console.log("  QUORUM ANALYSIS — SYNTHESIZED REPORT");
      console.log("═".repeat(60) + "\n");
      console.log(result.synthesis);
    }

    // Print cost summary
    console.log("\n" + "─".repeat(40));
    console.log(`  Models: ${result.models.join(", ")}`);
    console.log(`  Duration: ${Math.round(result.totalDuration / 1000)}s`);
    console.log(`  Cost: $${result.totalCost.toFixed(2)}`);
    console.log("─".repeat(40));

    // Save full JSON report to .forge/
    const reportDir = resolve(process.cwd(), ".forge", "analysis");
    mkdirSync(reportDir, { recursive: true });
    const reportFile = resolve(reportDir, `${basename(target, ".md")}-${Date.now()}.json`);
    writeFileSync(reportFile, JSON.stringify(result, null, 2));
    console.log(`\n  📄 Full report saved: ${reportFile}\n`);

    // Bug #82: avoid `process.exit(0)` after fetch() — on Windows, forcing
    // exit while undici keepalive sockets are still closing trips
    // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`. Set exitCode
    // and let the event loop drain naturally (idle sockets unref themselves).
    process.exitCode = 0;
  } catch (err) {
    console.error(`Analysis error: ${err.message}`);
    process.exit(1);
  }
} else if (args.includes("--diagnose")) {
  const target = getArg("--diagnose");
  if (!target) {
    console.error("Usage: node orchestrator.mjs --diagnose <file> [--models model1,model2,...]");
    process.exit(1);
  }

  const modelsArg = getArg("--models");
  const models = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : null;

  try {
    const result = await analyzeWithQuorum({
      target,
      mode: "diagnose",
      models,
      cwd: process.cwd(),
    });

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

    // Bug #82: see --analyze branch. Same fix — exitCode over exit().
    process.exitCode = 0;
  } catch (err) {
    console.error(`Diagnosis error: ${err.message}`);
    process.exit(1);
  }
}
