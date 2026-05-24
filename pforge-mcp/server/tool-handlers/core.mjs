import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync, renameSync, createWriteStream } from "node:fs";
import { resolve, join, dirname, basename, isAbsolute, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan, runPlan, detectWorkers, getCostReport, getHealthTrend, analyzeWithQuorum, generateImage, runAnalyze, readForgeJson, readForgeJsonl, appendForgeJsonl, emitToolTelemetry, regressionGuard, runPostSliceHook, resetPostSliceHookFired, runPreAgentHandoffHook, postOpenClawSnapshot, loadOpenClawConfig, loadQuorumConfig, runWatch, runWatchLive, readCrucibleState, readHomeSnapshot, addReviewItem, resolveReviewItem, listReviewItems, readReviewQueueState, maybeAddFixPlanReview, assessQuorumViability, detectExecutionRuntime, PROPOSED_FIX_DIR, detectCostAnomaly, computeMedian, spawnWorker } from "../../orchestrator.mjs";
import { recall as brainRecall, getReviewerCalibration, federationReadTrajectories, loadFederationConfig, validateFederationConfig, TRAJECTORY_FEDERATION_LIMIT, readHallmark, listHallmarks, validateHallmarkId, HallmarkError } from "../../brain.mjs";
import { withAnvil, anvilStat, anvilClear, anvilRebuild, anvilDlqList, anvilDlqDrain } from "../../anvil.mjs";
import { pipelinesList, pipelinesStats } from "../../pipelines.mjs";
import {
  drainOpenBrainQueue,
  isOpenBrainConfigured,
  shapeWatcherAnomalyThought,
  dedupeWatcherAnomalies,
  shapeQueueRecord,
  dedupeThoughtsBySimilarity,
  stampThoughtExpiry,
  buildCaptureTelemetry,
  validateSourceFormat,
  buildWatcherSearchPrompt,
  buildMemoryReport,
  listPendingAutoSkills,
  acceptAutoSkill,
  rejectAutoSkill,
  deferAutoSkill,
  computeGateSuggestionKey,
  getGateSuggestionCounter,
} from "../../memory.mjs";
import {
  readOpenBrainConfig,
  normalizeQueueRecord,
  normalizeMarkdownFile,
  listMarkdownFiles,
  roundTrip as brainRoundTrip,
  replayRecords as brainReplayRecords,
  createSseClient as createOpenBrainClient,
} from "../../openbrain-replay.mjs";
import { createHub, readHubPort } from "../../hub.mjs";
import { createBridge } from "../../bridge.mjs";
import { buildCapabilitySurface, writeToolsJson, writeCliSchema } from "../../capabilities.mjs";
import { classifyDiff as diffClassify } from "../../diff-classify.mjs";
import { readRunIndex, emitToolSpan } from "../../telemetry.mjs";
import { parseSkill, executeSkill } from "../../skill-runner.mjs";
import {
  handleSubmit as crucibleHandleSubmit,
  handleAsk as crucibleHandleAsk,
  handlePreview as crucibleHandlePreview,
  handleFinalize as crucibleHandleFinalize,
  handleList as crucibleHandleList,
  handleAbandon as crucibleHandleAbandon,
  CrucibleFinalizeRefusedError,
  CruciblePlanExistsError,
  CrucibleAskMismatchError,
} from "../../crucible-server.mjs";
import { importSpeckit, listSmelts, getSmelt } from "../../crucible-import.mjs";
import { loadCrucibleConfig, saveCrucibleConfig } from "../../crucible-config.mjs";
import { readManualImports } from "../../crucible-enforce.mjs";
import {
  handleScan as temperingHandleScan,
  handleStatus as temperingHandleStatus,
  readTemperingConfig as readTemperingConfigForLg,
  listRunRecords,
} from "../../tempering.mjs";
import { runTemperingRun, runSingleScanner } from "../../tempering/runner.mjs";
import { promoteBaseline } from "../../tempering/baselines.mjs";
import { registerBug, listBugs, updateBugStatus, loadBug, setLinkedFixPlan, appendValidationAttempt } from "../../tempering/bug-registry.mjs";
import { classify as classifyBug } from "../../tempering/bug-classifier.mjs";
import { dispatch as dispatchBugAdapter } from "../../tempering/bug-adapters/contract.mjs";
import { runTemperingDrain } from "../../tempering/drain.mjs";
import { routeFinding } from "../../tempering/triage.mjs";
import { fileClassifierIssue } from "../../tempering/classifier-issue.mjs";
import { loadAuditConfig, saveAuditConfig, shouldAutoDrain } from "../../tempering/auto-activate.mjs";
import { checkForUpdate, detectCorruptInstall } from "../../update-check.mjs";
import { inspectGithubStack } from "../../github-introspect.mjs";
import { loadMetrics } from "../../github-metrics.mjs";
import { fetchUserProfile, fetchRepoSummary, scanCopilotCoauthors, PersonalAuthError, PersonalNotFoundError, PersonalRateLimitError } from "../../github-personal.mjs";
import { loadActivity } from "../../team-activity.mjs";
import { buildTeamDashboard } from "../../dashboard/team-dashboard.mjs";
import { delegateReview, ReviewDelegateNoPrError, ReviewDelegateAuthError } from "../../github-review-delegate.mjs";
import { search as forgeSearch } from "../../search/core.mjs";
import { timeline as forgeTimeline } from "../../timeline/core.mjs";
import { withAuth } from "../../auth/middleware.mjs";
import { latticeIndex, latticeStat, latticeQuery, latticeCallers, latticeBlast } from "../../lattice.mjs";
import { exportPlan, exportPlanFromFile } from "../../export-plan.mjs";
import { syncMemories } from "../../sync-memories.mjs";
import { syncInstructions } from "../../sync-instructions.mjs";
import { classifyDiff } from "../../diff-classify.mjs";
import { searchLocalThoughts, isNeuralEmbeddingAvailable } from "../../local-recall.mjs";
import { ERROR_CODES } from "../../enums.mjs";
import {
  PROJECT_DIR,
  PROJECT_DIR_SOURCE,
  HTTP_PORT,
  IS_WINDOWS,
  PFORGE,
  activeAbortController,
  _planPathAliasWarned,
  activeRunPromise,
  activeHub,
  activeBridge,
  activeEventWatcher,
  _studioClient,
  _approvedRunIds,
  getOrSpawnStudioChild,
  broadcastLiveGuard,
  captureMemory,
  setActiveAbortController,
  setPlanPathAliasWarned,
  setActiveRunPromise,
  setActiveHub,
  setActiveBridge,
  setActiveEventWatcher,
  setStudioClient,
  FRAMEWORK_VERSION,
  _SERVER_CODE_HASH,
  _mcpServerRef,
} from "../state.mjs";
import { writeAuditArtifact } from "../audit-writer.mjs";
import { startEventFileWatcher, runPforge, findProjectRoot } from "../helpers.mjs";
import { callOrgRules } from "../org-rules.mjs";
import { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from "../anvil-compute.mjs";
import { TOOLS } from "../tool-definitions.mjs";

const __dirname = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function planNameToRunbookName(planPath) {
  const base = basename(planPath, ".md");
  return base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") + "-runbook.md";
}

function _runbookHeader(lines, plan) {
  lines.push(`# Runbook: ${plan.meta.title || "Unnamed Plan"}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (plan.meta.status) lines.push(`Status: ${plan.meta.status}`);
  if (plan.meta.branch) lines.push(`Branch: \`${plan.meta.branch}\``);
  lines.push("");
}

function _runbookScopeSection(lines, title, items) {
  if (!items.length) return;
  lines.push(`### ${title}`);
  lines.push("");
  items.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
}

function _runbookScopeContract(lines, scopeContract) {
  if (!scopeContract) return;
  const inScope = scopeContract.inScope || [];
  const outOfScope = scopeContract.outOfScope || [];
  const forbidden = scopeContract.forbidden || [];
  if (!(inScope.length || outOfScope.length || forbidden.length)) return;
  lines.push("## Scope Contract");
  lines.push("");
  _runbookScopeSection(lines, "In Scope", inScope);
  _runbookScopeSection(lines, "Out of Scope", outOfScope);
  _runbookScopeSection(lines, "Forbidden Actions", forbidden);
}

function _runbookSlice(lines, slice) {
  const deps = slice.depends || [];
  const parallel = slice.parallel ? " [parallel]" : "";
  lines.push(`### Slice ${slice.number}: ${slice.title}${parallel}`);
  lines.push("");
  if (deps.length) {
    lines.push(`**Depends on:** Slice ${deps.join(", Slice ")}`);
    lines.push("");
  }
  if (slice.tasks?.length) {
    lines.push("**Tasks:**");
    slice.tasks.forEach((task) => lines.push(`1. ${task}`));
    lines.push("");
  }
  if (slice.buildCommand) {
    lines.push(`**Build Command:** \`${slice.buildCommand}\``);
    lines.push("");
  }
  if (slice.testCommand) {
    lines.push(`**Test Command:** \`${slice.testCommand}\``);
    lines.push("");
  }
  if (slice.validationGate) {
    lines.push("**Validation Gate:**");
    lines.push("```");
    lines.push(slice.validationGate);
    lines.push("```");
    lines.push("");
  }
  if (slice.stopCondition) {
    lines.push(`**Stop Condition:** ${slice.stopCondition}`);
    lines.push("");
  }
}

function _runbookSlices(lines, slices) {
  lines.push("## Execution Slices");
  lines.push("");
  slices.forEach((slice) => _runbookSlice(lines, slice));
}

function _runbookIncidents(lines, cwd) {
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  if (!incidents.length) return;
  lines.push("## Recent Incidents");
  lines.push("");
  incidents.slice(-5).forEach((incident) => {
    const sev = (incident.severity || "medium").toUpperCase();
    const resolved = incident.resolvedAt ? ` — resolved ${incident.resolvedAt}` : " — unresolved";
    lines.push(`- **[${sev}]** ${incident.description}${resolved} (${incident.capturedAt})`);
  });
  lines.push("");
}

function _runbookEnvDiff(lines, cwd) {
  try {
    const envDiffPath = resolve(cwd, ".forge", "env-diff-cache.json");
    if (!existsSync(envDiffPath)) return;
    const envDiff = JSON.parse(readFileSync(envDiffPath, "utf-8"));
    if (!envDiff.summary || envDiff.summary.clean) return;
    const gapPairs = (envDiff.pairs || []).filter((pair) => (pair.missingInTarget?.length || 0) + (pair.missingInBaseline?.length || 0) > 0);
    if (!gapPairs.length) return;
    lines.push("## Environment Key Gaps");
    lines.push("");
    lines.push(`Baseline: \`${envDiff.baseline || ".env"}\` (${envDiff.summary.baselineKeyCount || "?"} keys)`);
    lines.push("");
    gapPairs.forEach((pair) => {
      lines.push(`### ${pair.file}`);
      lines.push("");
      if (pair.missingInTarget?.length) {
        lines.push("**Missing in target (present in baseline):**");
        pair.missingInTarget.forEach((key) => lines.push(`- \`${key}\``));
        lines.push("");
      }
      if (pair.missingInBaseline?.length) {
        lines.push("**Missing in baseline (present in target):**");
        pair.missingInBaseline.forEach((key) => lines.push(`- \`${key}\``));
        lines.push("");
      }
    });
  } catch { /* env-diff cache unavailable — skip */ }
}

export function generateRunbook(plan, cwd, options = {}) {
  const { includeIncidents = true } = options;
  const lines = [];
  _runbookHeader(lines, plan);
  _runbookScopeContract(lines, plan.scopeContract);
  _runbookSlices(lines, plan.slices);
  if (includeIncidents) _runbookIncidents(lines, cwd);
  _runbookEnvDiff(lines, cwd);
  return lines.join("\n");
}


const _NULL_RETURN_TOOLS = new Set([
  "forge_sweep",
  "forge_diff_classify",
  "forge_analyze",
  "forge_org_rules",
  "forge_run_plan",
  "forge_abort",
  "forge_plan_status",
  "forge_cost_report",
  "forge_estimate_quorum",
  "forge_estimate_slice",
  "forge_health_trend",
  "forge_alert_triage",
  "forge_capabilities",
  "forge_fix_proposal",
  "forge_quorum_analyze",
  "forge_liveguard_run",
  "forge_watch",
  "forge_watch_live",
  "forge_memory_report",
  "forge_notify_send",
  "forge_notify_test",
  "forge_search",
  "forge_doctor_quorum",
  "forge_testbed_run",
  "forge_testbed_happypath",
  "forge_master_ask",
  "forge_master_audit",
  "forge_meta_bug_file",
  "forge_graph_query",
  "forge_patterns_list",
  "forge_github_metrics",
  "forge_team_activity",
  "forge_anvil_stat",
  "forge_anvil_clear",
  "forge_anvil_rebuild",
  "forge_anvil_dlq_list",
  "forge_anvil_dlq_drain",
  "forge_hallmark_show",
  "forge_hallmark_verify",
  "forge_pipelines_list",
  "forge_lattice_index",
  "forge_lattice_stat",
  "forge_lattice_query",
  "forge_lattice_callers",
  "forge_lattice_blast",
  // Phase-43 — Restored to Forge-Master allowlist; handlers live in
  // tool-handlers/{crucible,tempering,safety,orch,review,memory,discovery}.mjs
  // and dispatch via the MCP CallToolRequestSchema handler.
  "forge_dep_watch",
  "forge_drift_report",
  "forge_hotspot",
  "forge_regression_guard",
  "forge_diagnose",
  "forge_crucible_list",
  "forge_crucible_submit",
  "forge_crucible_ask",
  "forge_crucible_preview",
  "forge_timeline",
  "forge_tempering_scan",
  "forge_tempering_status",
  "forge_bug_list",
  "forge_review_list",
  "forge_skill_status",
  "forge_runbook",
  "forge_deploy_journal",
]);

const _SYNC_TOOL_EXECUTORS = {
  forge_smith: (_args, cwd) => runPforge("smith", cwd),
  forge_github_status: (args, cwd) => ({ success: true, ...inspectGithubStack(cwd, { extra: !!args.extra }) }),
  forge_validate: (_args, cwd) => runPforge("check", cwd),
  forge_status: (_args, cwd) => runPforge("status", cwd),
  forge_diff: (args, cwd) => runPforge(`diff "${args.plan}"`, cwd),
  forge_ext_search: (args, cwd) => runPforge(`ext search ${args.query || ""}`.trim(), cwd),
  forge_ext_info: (args, cwd) => runPforge(`ext info "${args.name}"`, cwd),
  forge_new_phase: (args, cwd) => runPforge(`new-phase "${args.name}"`, cwd),
};

export function executeTool(name, args) {
  const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
  if (_NULL_RETURN_TOOLS.has(name)) return null;
  const executor = _SYNC_TOOL_EXECUTORS[name];
  return executor ? executor(args, cwd) : { success: false, error: `Unknown tool: ${name}` };
}

/**
 * In-process MCP tool invoker — wraps `executeTool` for use as a dispatcher.
 *
 * Exposed as a named export so `forge-master-routes.mjs` (and ultimately
 * `http-routes.mjs`) can wire it as the real `mcpCall` for the HTTP
 * dispatcher, replacing the default no-op.
 *
 * For tools handled synchronously by `executeTool` (CLI-delegated), the
 * result is returned directly. For tools that return null from `executeTool`
 * (async/streaming tools handled in the MCP CallToolRequestSchema handler),
 * the call is forwarded to that handler and its terminal result is returned.
 *
 * @param {string} toolName
 * @param {object} [args]
 * @returns {Promise<any>}
 */
export async function invokeForgeTool(toolName, args = {}) {
  const syncResult = executeTool(toolName, args);
  if (syncResult != null) return syncResult;

  // ASYNC tool: forward through the registered MCP CallToolRequestSchema handler
  try {
    const handlers = _mcpServerRef?._requestHandlers || _mcpServerRef?.requestHandlers;
    const handler = handlers?.get?.("tools/call");
    if (handler) {
      const mcpResult = await handler({
        method: "tools/call",
        params: { name: toolName, arguments: args },
      });
      if (mcpResult?.content?.[0]?.text) {
        try {
          return JSON.parse(mcpResult.content[0].text);
        } catch {
          return mcpResult;
        }
      }
      return mcpResult || {};
    }
  } catch (err) {
    return { error: `Tool handler error: ${err.message}` };
  }
  return {};
}

// ─── Issue #205 — OpenBrain L3 semantic-search bridge ───────────────────

/**
 * Pre-fetch L3 (OpenBrain) hits for `forge_search`. The synchronous L2
 * search engine in `search/core.mjs` accepts an `openBrainSearchFn` hook
 * that must be sync — so we await the SSE call here and return a closure
 * that hands back the resolved array.
 *
 * Best-effort: any failure (config missing, key invalid, SSE timeout)
 * returns `[]` so the L2 search still serves results. The 5s timeout
 * bounds wall-clock impact when OpenBrain is unreachable.
 *
 * @param {string} cwd
 * @param {{query: string, limit?: number}} args
 * @returns {Promise<Array>} normalized L3 hits ready for ranker merge
 */
export async function searchOpenBrainL3(cwd, args) {
  if (!isOpenBrainConfigured(cwd)) return [];
  const cfg = readOpenBrainConfig(cwd);
  if (!cfg || !cfg.url || !cfg.key) return [];

  let project = "plan-forge";
  try {
    const forgeCfg = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
    project = forgeCfg.projectName || project;
  } catch { /* default */ }

  const TIMEOUT_MS = 5_000;
  let client = null;
  try {
    const sseLimit = Math.min(Math.max((args.limit || 50) * 2, 25), 100);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("L3 search timeout")), TIMEOUT_MS)
    );
    client = await Promise.race([createOpenBrainClient(cfg), timeoutPromise]);
    const searchRes = await Promise.race([
      client.search({ query: String(args.query || ""), project, limit: sseLimit }),
      timeoutPromise,
    ]);
    const raw = searchRes?.results ?? searchRes?.thoughts ?? searchRes?.hits ?? [];
    if (!Array.isArray(raw)) return [];

    return raw.map((h) => ({
      source: "openbrain",
      recordRef: String(h.id || h.recordRef || h.thought_id || ""),
      text: String(h.content || h.text || ""),
      timestamp: h.captured_at || h.timestamp || h.created_at || new Date().toISOString(),
      tags: Array.isArray(h.tags) ? h.tags : [],
      correlationId: h.correlationId || h.correlation_id || "",
    })).filter((h) => h.text);
  } catch {
    return [];
  } finally {
    if (client) { try { await client.close(); } catch { /* best-effort */ } }
  }
}
