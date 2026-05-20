import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync, renameSync, createWriteStream } from "node:fs";
import { resolve, join, dirname, basename, isAbsolute, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan, runPlan, detectWorkers, getCostReport, getHealthTrend, analyzeWithQuorum, generateImage, runAnalyze, readForgeJson, readForgeJsonl, appendForgeJsonl, emitToolTelemetry, regressionGuard, runPostSliceHook, resetPostSliceHookFired, runPreAgentHandoffHook, postOpenClawSnapshot, loadOpenClawConfig, loadQuorumConfig, runWatch, runWatchLive, readCrucibleState, readHomeSnapshot, addReviewItem, resolveReviewItem, listReviewItems, readReviewQueueState, maybeAddFixPlanReview, assessQuorumViability, detectExecutionRuntime, PROPOSED_FIX_DIR, detectCostAnomaly, computeMedian, spawnWorker } from "../orchestrator.mjs";
import { recall as brainRecall, getReviewerCalibration, federationReadTrajectories, loadFederationConfig, validateFederationConfig, TRAJECTORY_FEDERATION_LIMIT, readHallmark, listHallmarks, validateHallmarkId, HallmarkError } from "../brain.mjs";
import { withAnvil, anvilStat, anvilClear, anvilRebuild, anvilDlqList, anvilDlqDrain } from "../anvil.mjs";
import { pipelinesList, pipelinesStats } from "../pipelines.mjs";
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
} from "../memory.mjs";
import {
  readOpenBrainConfig,
  normalizeQueueRecord,
  normalizeMarkdownFile,
  listMarkdownFiles,
  roundTrip as brainRoundTrip,
  replayRecords as brainReplayRecords,
  createSseClient as createOpenBrainClient,
} from "../openbrain-replay.mjs";
import { createHub, readHubPort } from "../hub.mjs";
import { createBridge } from "../bridge.mjs";
import { buildCapabilitySurface, writeToolsJson, writeCliSchema } from "../capabilities.mjs";
import { classifyDiff as diffClassify } from "../diff-classify.mjs";
import { readRunIndex, emitToolSpan } from "../telemetry.mjs";
import { parseSkill, executeSkill } from "../skill-runner.mjs";
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
} from "../crucible-server.mjs";
import { importSpeckit, listSmelts, getSmelt } from "../crucible-import.mjs";
import { loadCrucibleConfig, saveCrucibleConfig } from "../crucible-config.mjs";
import { readManualImports } from "../crucible-enforce.mjs";
import {
  handleScan as temperingHandleScan,
  handleStatus as temperingHandleStatus,
  readTemperingConfig as readTemperingConfigForLg,
  listRunRecords,
} from "../tempering.mjs";
import { runTemperingRun, runSingleScanner } from "../tempering/runner.mjs";
import { promoteBaseline } from "../tempering/baselines.mjs";
import { registerBug, listBugs, updateBugStatus, loadBug, setLinkedFixPlan, appendValidationAttempt } from "../tempering/bug-registry.mjs";
import { classify as classifyBug } from "../tempering/bug-classifier.mjs";
import { dispatch as dispatchBugAdapter } from "../tempering/bug-adapters/contract.mjs";
import { runTemperingDrain } from "../tempering/drain.mjs";
import { routeFinding } from "../tempering/triage.mjs";
import { fileClassifierIssue } from "../tempering/classifier-issue.mjs";
import { loadAuditConfig, saveAuditConfig, shouldAutoDrain } from "../tempering/auto-activate.mjs";
import { checkForUpdate, detectCorruptInstall } from "../update-check.mjs";
import { inspectGithubStack } from "../github-introspect.mjs";
import { loadMetrics } from "../github-metrics.mjs";
import { fetchUserProfile, fetchRepoSummary, scanCopilotCoauthors, PersonalAuthError, PersonalNotFoundError, PersonalRateLimitError } from "../github-personal.mjs";
import { loadActivity } from "../team-activity.mjs";
import { buildTeamDashboard } from "../dashboard/team-dashboard.mjs";
import { delegateReview, ReviewDelegateNoPrError, ReviewDelegateAuthError } from "../github-review-delegate.mjs";
import { search as forgeSearch } from "../search/core.mjs";
import { timeline as forgeTimeline } from "../timeline/core.mjs";
import { withAuth } from "../auth/middleware.mjs";
import { latticeIndex, latticeStat, latticeQuery, latticeCallers, latticeBlast } from "../lattice.mjs";
import { exportPlan, exportPlanFromFile } from "../export-plan.mjs";
import { syncMemories } from "../sync-memories.mjs";
import { syncInstructions } from "../sync-instructions.mjs";
import { classifyDiff } from "../diff-classify.mjs";
import { ERROR_CODES } from "../enums.mjs";
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
} from "./state.mjs";
import { writeAuditArtifact } from "./audit-writer.mjs";
import { startEventFileWatcher, runPforge, findProjectRoot } from "./helpers.mjs";
import { callOrgRules } from "./org-rules.mjs";
import { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from "./anvil-compute.mjs";
import { TOOLS } from "./tool-definitions.mjs";

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

/**
 * Wrap a CallToolRequestSchema handler to emit an OTel `execute_tool` span
 * after every invocation. Fire-and-forget — never delays or throws.
 */
function _wrapWithToolSpan(handler) {
  return async (request) => {
    const { name } = request.params;
    const t0 = Date.now();
    let isError = false;
    try {
      const result = await handler(request);
      isError = result?.isError ?? false;
      return result;
    } catch (err) {
      isError = true;
      throw err;
    } finally {
      emitToolSpan({ toolName: name, durationMs: Date.now() - t0, isError });
    }
  };
}

// ─── Auth gate for MCP tool dispatch ─────────────────────────────────
// Read-only tools that are open by default (Decision #9 — operators can
// restrict these further by adding explicit scope entries in rbac.json).
const _READ_ONLY_TOOLS = new Set([
  "forge_capabilities", "forge_status", "forge_search", "forge_timeline",
  "forge_watch_live", "forge_home_snapshot", "forge_cost_report",
  "forge_plan_status", "forge_diff", "forge_diff_classify",
]);

let _rbacConfigCache; // undefined = not yet loaded; null = absent

function _getRbacConfig() {
  if (_rbacConfigCache !== undefined) return _rbacConfigCache;
  try {
    const rbacPath = resolve(PROJECT_DIR, ".forge", "rbac.json");
    _rbacConfigCache = existsSync(rbacPath)
      ? JSON.parse(readFileSync(rbacPath, "utf8"))
      : null;
  } catch {
    _rbacConfigCache = null;
  }
  return _rbacConfigCache;
}

/**
 * Auth gate for MCP tool calls using the withAuth middleware.
 * Returns null when the call is allowed, or an MCP error response when denied.
 * When .forge/rbac.json is absent → always null (open-by-default, Decision #1).
 *
 * @param {string} toolName
 * @param {object} request - MCP CallTool request object
 * @returns {Promise<null|{content: Array, isError: boolean}>}
 */
async function _mcpAuthGate(toolName, request) {
  const rbac = _getRbacConfig();
  if (!rbac) return null; // open-by-default: no rbac.json → no enforcement

  const isReadOnly = _READ_ONLY_TOOLS.has(toolName);
  const headers = request?._meta?.headers ?? {};
  const fakeReq = { headers };

  let denied = null;
  const fakeRes = {
    headersSent: false,
    writeHead(status) { denied = status; },
    end() { if (denied == null) denied = 403; },
  };

  const opts = isReadOnly
    ? { provider: "none" }                    // read-only: no auth required
    : { rbac, scope: "forge:run" };           // write/exec: require forge:run scope

  await withAuth(() => {}, opts)(fakeReq, fakeRes);

  if (denied) {
    const error = denied === 401 ? "unauthenticated" : "forbidden";
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
      isError: true,
    };
  }
  return null;
}

const _CALL_TOOL_NO_MATCH = Symbol("call-tool-no-match");

function _resolveToolCwd(args, key = "path") {
  return args[key] ? findProjectRoot(resolve(args[key])) : findProjectRoot(PROJECT_DIR);
}

function _parsePlanArg(args) {
  let planArg = args.plan;
  if ((typeof planArg !== "string" || planArg === "") && typeof args.planPath === "string" && args.planPath !== "") {
    if (!_planPathAliasWarned) {
      setPlanPathAliasWarned(true);
      console.warn("[forge_run_plan] 'planPath' is an alias; prefer 'plan'");
    }
    planArg = args.planPath;
  }
  return planArg;
}

function _parseQuorumMode(quorumArg) {
  let quorum = "auto";
  let quorumPreset = null;
  if (quorumArg === "power") { quorum = true; quorumPreset = "power"; }
  else if (quorumArg === "speed") { quorum = true; quorumPreset = "speed"; }
  else if (quorumArg === "true" || quorumArg === true) quorum = true;
  else if (quorumArg === "false" || quorumArg === false) quorum = false;
  return { quorum, quorumPreset };
}

function _buildRunPlanOptions(args, cwd, eventHandler) {
  const { quorum, quorumPreset } = _parseQuorumMode(args.quorum);
  return {
    cwd,
    model: args.model || null,
    mode: args.mode || "auto",
    resumeFrom: args.resumeFrom != null ? Number(args.resumeFrom) : null,
    estimate: args.estimate || false,
    dryRun: args.dryRun || false,
    quorum,
    quorumPreset,
    quorumThreshold: args.quorumThreshold != null ? Number(args.quorumThreshold) : null,
    abortController: activeAbortController,
    eventHandler,
    manualImport: args.manualImport === true || args.manualImport === "true",
    manualImportSource: args.manualImportSource || "human",
    manualImportReason: args.manualImportReason || null,
  };
}

function _handleRunPlanMemoryCapture(result, cwd) {
  if (!result?._memoryCapture) return;
  if (!result._memoryCapture._captured) {
    if (result._memoryCapture.runSummary) {
      captureMemory(result._memoryCapture.runSummary, "decision", "forge_run_plan", cwd);
    }
    if (result._memoryCapture.costAnomaly) {
      captureMemory(result._memoryCapture.costAnomaly, "gotcha", "forge_run_plan/cost", cwd);
    }
    return;
  }
  if (!result._memoryCapture.receipts) return;
  for (const key of ["runSummary", "costAnomaly"]) {
    const r = result._memoryCapture.receipts[key];
    if (r?.thought && !r.deduped) {
      try {
        activeHub?.broadcast({
          type: "memory-captured",
          thought: r.thought,
          deduped: false,
          timestamp: r.thought.captured_at,
        });
      } catch { /* never break run on broadcast failure */ }
    }
  }
}

async function _callToolHandler_001_forge_run_plan(request, args) {
  const { name } = request.params;
  if (!(name === "forge_run_plan")) return _CALL_TOOL_NO_MATCH;

  try {
    const planArg = _parsePlanArg(args);
    if (typeof planArg !== "string" || planArg === "") {
      return { content: [{ type: "text", text: "forge_run_plan: 'plan' is required (string path to plan markdown)" }], isError: true };
    }

    const cwd = _resolveToolCwd(args);
    const planPath = resolve(cwd, planArg);

    if (!existsSync(planPath)) {
      return { content: [{ type: "text", text: `Plan file not found: ${planArg}` }], isError: true };
    }

    setActiveAbortController(new AbortController());
    const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
    const result = await runPlan(planPath, _buildRunPlanOptions(args, cwd, eventHandler));
    setActiveAbortController(null);

    _handleRunPlanMemoryCapture(result, cwd);

    const isError = !result || result.status === "failed" || (result.results?.failed > 0);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError,
    };
  } catch (err) {
    setActiveAbortController(null);
    return { content: [{ type: "text", text: `Orchestrator error: ${err.message}` }], isError: true };
  }
}

async function _callToolHandler_002_forge_abort(request, args) {
  const { name } = request.params;
  if (!(name === "forge_abort")) return _CALL_TOOL_NO_MATCH;

    if (activeAbortController) {
      activeAbortController.abort();
      return { content: [{ type: "text", text: "Abort signal sent. Current slice will finish, then execution stops." }] };
    }
    return { content: [{ type: "text", text: "No active plan execution to abort." }] };
  
}

async function _callToolHandler_003_forge_plan_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_plan_status")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const runsDir = resolve(cwd, ".forge", "runs");

      if (!existsSync(runsDir)) {
        return { content: [{ type: "text", text: "No runs found. Run `forge_run_plan` first." }] };
      }

      const runDirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();

      if (runDirs.length === 0) {
        return { content: [{ type: "text", text: "No runs found." }] };
      }

      // Find matching run (by plan name filter or latest)
      let targetDir = runDirs[0];
      if (args.plan) {
        const planName = args.plan.replace(/\.md$/, "").split("/").pop();
        // M1: Match plan name at end of directory name (after timestamp_) to avoid false positives
        const match = runDirs.find((d) => d.endsWith(`_${planName}`) || d.endsWith(`_${planName}/`));
        if (match) targetDir = match;
      }

      const summaryPath = resolve(runsDir, targetDir, "summary.json");
      if (existsSync(summaryPath)) {
        const summary = readFileSync(summaryPath, "utf-8");
        return { content: [{ type: "text", text: summary }] };
      }

      // No summary yet — check run.json for in-progress
      const runPath = resolve(runsDir, targetDir, "run.json");
      if (existsSync(runPath)) {
        const runMeta = readFileSync(runPath, "utf-8");
        return { content: [{ type: "text", text: `Run in progress:\n${runMeta}` }] };
      }

      return { content: [{ type: "text", text: `Run directory exists but no data: ${targetDir}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Status error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_004_forge_diff_classify(request, args) {
  const { name } = request.params;
  if (!(name === "forge_diff_classify")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = classifyDiff({ cwd, since: args.since || undefined });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `diff-classify error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_005_forge_cost_report(request, args) {
  const { name } = request.params;
  if (!(name === "forge_cost_report")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const report = getCostReport(cwd);
      try {
        const ht = getHealthTrend(cwd, 30, ["drift", "cost"]);
        report.healthTrend = { trend: ht.trend, dataPoints: ht.dataPoints };
      } catch { /* backward-compatible — omit on failure */ }
      // G1.3 (v2.36): emit an L1 hub event so dashboards can show
      // "cost report generated" in real time, consistent with every other
      // dual-write tool. Best-effort — broadcastLiveGuard is no-op when
      // the hub isn't running.
      await broadcastLiveGuard("forge_cost_report", "OK", Date.now() - t0, {
        totalRuns: report.runs ?? 0,
        totalCost: report.total_cost_usd ?? 0,
      });
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Cost report error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_006_forge_estimate_quorum(request, args) {
  const { name } = request.params;
  if (!(name === "forge_estimate_quorum")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!args.planPath || typeof args.planPath !== "string") {
        return { content: [{ type: "text", text: "forge_estimate_quorum: planPath (string) is required" }], isError: true };
      }
      const planFullPath = resolve(cwd, args.planPath);
      if (!existsSync(planFullPath)) {
        return { content: [{ type: "text", text: `${ERROR_CODES.PLAN_NOT_FOUND.code}: ${args.planPath}` }], isError: true };
      }
      const { parsePlan } = await import("./orchestrator.mjs");
      const { estimateQuorum } = await import("./cost-service.mjs");
      let plan;
      try {
        plan = parsePlan(planFullPath, cwd);
      } catch (err) {
        return { content: [{ type: "text", text: `${ERROR_CODES.PLAN_PARSE_ERROR.code}: ${err.message}` }], isError: true };
      }
      const result = estimateQuorum({
        plan,
        cwd,
        resumeFrom: args.resumeFrom ?? null,
      });
      await broadcastLiveGuard("forge_estimate_quorum", "OK", Date.now() - t0, {
        recommended: result.recommended,
        sliceCount: result.auto?.totalSliceCount ?? 0,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Estimate error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_007_forge_estimate_slice(request, args) {
  const { name } = request.params;
  if (!(name === "forge_estimate_slice")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!args.planPath || typeof args.planPath !== "string") {
        return { content: [{ type: "text", text: "forge_estimate_slice: planPath (string) is required" }], isError: true };
      }
      if (args.sliceNumber === undefined || args.sliceNumber === null || args.sliceNumber === "") {
        return { content: [{ type: "text", text: "forge_estimate_slice: sliceNumber is required" }], isError: true };
      }
      const planFullPath = resolve(cwd, args.planPath);
      if (!existsSync(planFullPath)) {
        return { content: [{ type: "text", text: `${ERROR_CODES.PLAN_NOT_FOUND.code}: ${args.planPath}` }], isError: true };
      }
      const { parsePlan } = await import("./orchestrator.mjs");
      const { estimateSlice } = await import("./cost-service.mjs");
      let plan;
      try {
        plan = parsePlan(planFullPath, cwd);
      } catch (err) {
        return { content: [{ type: "text", text: `${ERROR_CODES.PLAN_PARSE_ERROR.code}: ${err.message}` }], isError: true };
      }
      let result;
      try {
        result = estimateSlice({
          plan,
          sliceNumber: args.sliceNumber,
          mode: args.mode ?? "auto",
          model: args.model ?? "claude-sonnet-4.5",
          cwd,
        });
      } catch (err) {
        const msg = String(err?.message || err);
        if (msg.includes("not found in plan")) {
          return { content: [{ type: "text", text: `SLICE_NOT_FOUND: ${msg}` }], isError: true };
        }
        throw err;
      }
      await broadcastLiveGuard("forge_estimate_slice", "OK", Date.now() - t0, {
        sliceNumber: String(args.sliceNumber),
        mode: args.mode ?? "auto",
        quorumEligible: result.quorumEligible,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Estimate error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_008_forge_health_trend(request, args) {
  const { name } = request.params;
  if (!(name === "forge_health_trend")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const days = Math.max(1, Math.min(365, parseInt(args.days) || 30));
      const metrics = args.metrics ? args.metrics.split(",").map(m => m.trim()) : null;
      const report = getHealthTrend(cwd, days, metrics);
      emitToolTelemetry("forge_health_trend", args, report, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_health_trend", "OK", Date.now() - t0);

      // Auto-capture significant health changes
      if (report.healthScore != null && report.trend && report.trend !== "stable") {
        captureMemory(
          `Health trend: score ${report.healthScore}/100, trend ${report.trend}. Drift avg: ${report.drift?.avg ?? "?"}, incidents: ${report.incidents?.open ?? 0} open.`,
          "decision", "forge_health_trend", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Health trend error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_009_forge_alert_triage(request, args) {
  const { name } = request.params;
  if (!(name === "forge_alert_triage")) return _CALL_TOOL_NO_MATCH;

    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
      const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };
      const minSeverity = SEVERITY_ORDER.includes(args.minSeverity) ? args.minSeverity : "low";
      const minIdx = SEVERITY_ORDER.indexOf(minSeverity);
      const maxResults = Math.max(1, Math.min(200, parseInt(args.max) || 20));

      const now = Date.now();
      const recencyFactor = (isoTimestamp) => {
        const age = now - new Date(isoTimestamp).getTime();
        const hours24 = 24 * 60 * 60 * 1000;
        if (age < hours24) return 1.0;
        if (age < 7 * hours24) return 0.8;
        if (age < 30 * hours24) return 0.5;
        return 0.3;
      };

      const alerts = [];

      // Collect open incidents
      const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
      for (const inc of incidents) {
        if (inc.resolvedAt) continue; // skip resolved
        const sev = SEVERITY_ORDER.includes(inc.severity) ? inc.severity : "medium";
        if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
        const ts = inc.capturedAt || new Date(0).toISOString();
        const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
        alerts.push({ source: "incident", id: inc.id, description: inc.description, severity: sev, timestamp: ts, files: inc.files || [], priority: Math.round(priority * 100) / 100 });
      }

      // Collect latest drift violations
      const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
      if (driftHistory.length) {
        const latest = driftHistory[driftHistory.length - 1];
        for (const v of (latest.violations || [])) {
          const sev = SEVERITY_ORDER.includes(v.severity) ? v.severity : "medium";
          if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
          const ts = latest.timestamp || new Date(0).toISOString();
          const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
          alerts.push({ source: "drift", id: `drift-${v.rule}-${v.file}:${v.line}`, description: `${v.rule}: ${v.file}:${v.line}`, severity: sev, timestamp: ts, files: [v.file], priority: Math.round(priority * 100) / 100 });
        }
      }

      // Sort: primary by priority desc, tiebreak by timestamp desc (more recent first)
      alerts.sort((a, b) => b.priority - a.priority || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const result = { total: alerts.length, showing: Math.min(maxResults, alerts.length), minSeverity, alerts: alerts.slice(0, maxResults), generatedAt: new Date().toISOString() };
      emitToolTelemetry("forge_alert_triage", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_alert_triage", "OK", Date.now() - t0, { total: result.total, showing: result.showing });

      // Auto-capture when critical/high alerts exist
      const critHigh = alerts.filter(a => a.severity === "critical" || a.severity === "high");
      if (critHigh.length > 0) {
        captureMemory(
          `Alert triage: ${critHigh.length} critical/high alert(s) of ${result.total} total. Top: ${critHigh.slice(0, 3).map(a => a.description).join("; ")}.`,
          "gotcha", "forge_alert_triage", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Alert triage error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_010_forge_sweep(request, args) {
  const { name } = request.params;
  if (!(name === "forge_sweep")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await _sweepAnvilCompute(args, { _cwd: cwd });
      return {
        content: [{ type: "text", text: result.success ? result.output : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}` }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Sweep error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_011_forge_analyze(request, args) {
  const { name } = request.params;
  if (!(name === "forge_analyze" && !args.quorum)) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await _analyzeAnvilCompute(args, { _cwd: cwd });
      return {
        content: [{ type: "text", text: result.success ? result.output : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}` }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Analyze error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_012_forge_analyze(request, args) {
  const { name } = request.params;
  if (!(name === "forge_analyze" && args.quorum)) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const mode = args.mode || (args.plan.match(/plan/i) ? "plan" : "file");
      const models = args.models ? args.models.split(",").map((m) => m.trim()) : null;

      const result = await analyzeWithQuorum({
        target: args.plan,
        mode,
        models,
        cwd,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Quorum analysis error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_013_forge_diagnose(request, args) {
  const { name } = request.params;
  if (!(name === "forge_diagnose")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const models = args.models ? args.models.split(",").map((m) => m.trim()) : null;

      const result = await analyzeWithQuorum({
        target: args.file,
        mode: "diagnose",
        models,
        cwd,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Diagnosis error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_014_forge_capabilities(request, args) {
  const { name } = request.params;
  if (!(name === "forge_capabilities")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const surface = buildCapabilitySurface(TOOLS, { cwd, hubPort: activeHub?.port || null });
      return { content: [{ type: "text", text: JSON.stringify(surface, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Capabilities error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_015_forge_watch(request, args) {
  const { name } = request.params;
  if (!(name === "forge_watch")) return _CALL_TOOL_NO_MATCH;

    try {
      if (!args.targetPath) {
        return { content: [{ type: "text", text: "forge_watch requires targetPath (absolute path to the project being watched)." }], isError: true };
      }
      const report = await runWatch({
        targetPath: args.targetPath,
        runId: args.runId || null,
        mode: args.mode || "snapshot",
        model: args.model || undefined,
        tailEvents: args.tailEvents || undefined,
        sinceTimestamp: args.sinceTimestamp || undefined,
        recordHistory: args.recordHistory !== false,
        eventBus: activeHub
          ? { emit: (type, data) => { try { activeHub.broadcast({ type, data, timestamp: new Date().toISOString() }); } catch { /* ignore */ } } }
          : null,
      });

      // G3.1 (v2.35.1): capture watcher anomalies to L2/L3 memory.
      // The watcher is the only cross-project observer — anomaly patterns are high-value
      // semantic signals. Captures go to the WATCHER's .forge/ (PROJECT_DIR), NEVER the
      // target's, preserving the watcher's read-only contract on the target project.
      // Source attribution follows the GX.4 standard: "forge_watch/<anomaly-code>".
      let searchHints = "";
      if (Array.isArray(report?.anomalies) && report.anomalies.length > 0) {
        const meta = { targetPath: report.targetPath, runId: report.runId, runState: report.runState };
        // G3.3 (v2.36): build proactive OpenBrain search-prompt hints so the
        // agent consulting forge_watch knows to look up prior occurrences of
        // each anomaly code before reacting.
        let projectName = "plan-forge";
        try {
          const forgeCfg = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
          projectName = forgeCfg.projectName || projectName;
        } catch { /* use default */ }
        const seenCodes = new Set();
        for (const anomaly of report.anomalies) {
          const shaped = shapeWatcherAnomalyThought(anomaly, meta, "forge_watch");
          captureMemory(shaped.content, shaped.type, shaped.source, PROJECT_DIR);
          if (anomaly?.code && !seenCodes.has(anomaly.code)) {
            seenCodes.add(anomaly.code);
            searchHints += buildWatcherSearchPrompt(anomaly, projectName);
          }
        }
      }

      const reportJson = JSON.stringify(report, null, 2);
      const text = searchHints ? `${searchHints}\n${reportJson}` : reportJson;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Watcher error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_016_forge_watch_live(request, args) {
  const { name } = request.params;
  if (!(name === "forge_watch_live")) return _CALL_TOOL_NO_MATCH;

    try {
      if (!args.targetPath) {
        return { content: [{ type: "text", text: "forge_watch_live requires targetPath." }], isError: true };
      }
      // G1.4 (v2.36): configurable cap + dropped-event counter so callers
      // know when the watcher ran hotter than the captured buffer could hold.
      // Default 500 preserves pre-v2.36 behaviour; max 10_000 guards memory.
      const rawMax = Number.isFinite(args.maxCapturedEvents) ? Number(args.maxCapturedEvents) : 500;
      const maxCapturedEvents = Math.min(10_000, Math.max(1, Math.floor(rawMax)));
      const captured = [];
      let droppedEvents = 0;
      const liveAnomalies = [];
      const result = await runWatchLive({
        targetPath: args.targetPath,
        durationMs: args.durationMs || 60_000,
        pollIntervalMs: args.pollIntervalMs || 3_000,
        onEvent: (event) => {
          // G1.4 (v2.36): cap configurable, track drops
          if (captured.length < maxCapturedEvents) {
            captured.push(event);
          } else {
            droppedEvents++;
          }
          // G3.1 (v2.35.1): collect anomaly events for L2/L3 capture after stream closes
          if (event?.type === "watch-anomaly-detected" && event?.data) {
            liveAnomalies.push(event.data);
          }
        },
      });

      // G3.1 (v2.35.1): dedupe by code+message within this live session and capture.
      // Writes land in the WATCHER's .forge/ — target project is never touched.
      const uniqueAnomalies = dedupeWatcherAnomalies(liveAnomalies);
      // G3.3 (v2.36): build proactive OpenBrain search hints, one per code.
      let projectName = "plan-forge";
      try {
        const forgeCfg = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
        projectName = forgeCfg.projectName || projectName;
      } catch { /* use default */ }
      let searchHints = "";
      const seenCodes = new Set();
      for (const a of uniqueAnomalies) {
        const meta = { targetPath: a.targetPath || args.targetPath, runId: a.runId };
        const shaped = shapeWatcherAnomalyThought(a, meta, "forge_watch_live");
        captureMemory(shaped.content, shaped.type, shaped.source, PROJECT_DIR);
        if (a?.code && !seenCodes.has(a.code)) {
          seenCodes.add(a.code);
          searchHints += buildWatcherSearchPrompt(a, projectName);
        }
      }
      const anomalyCaptureCount = uniqueAnomalies.length;

      // Phase ACI-HARDENING (Section 13 fix #3): default to lite event
      // projection ({ ts, type, correlationId }) so a high-velocity watcher
      // doesn't blow agent context budgets. Pass `verbose: true` to opt back
      // into full event objects (preserves pre-ACI behaviour for callers that
      // need event payloads).
      const verbose = args.verbose === true;
      const projectedEvents = verbose
        ? captured
        : captured.map(ev => ({
            ts: ev?.ts ?? ev?.timestamp ?? null,
            type: ev?.type ?? null,
            correlationId: ev?.correlationId ?? ev?.data?.correlationId ?? null,
          }));

      const payload = JSON.stringify({
        ...result,
        capturedEvents: captured.length,
        droppedEvents,               // G1.4
        maxCapturedEvents,           // G1.4
        capturedAnomalies: anomalyCaptureCount,
        eventProjection: verbose ? "verbose" : "lite",
        events: projectedEvents,
      }, null, 2);
      const text = searchHints ? `${searchHints}\n${payload}` : payload;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Watcher live error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_017_forge_memory_report(request, args) {
  const { name } = request.params;
  if (!(name === "forge_memory_report")) return _CALL_TOOL_NO_MATCH;

    // GX.3 (v2.36): aggregate every memory surface (L2 files, OpenBrain queue
    // state, drain stats trend, capture telemetry, search cache, orphans).
    // Read-only — never mutates the forge dir.
    try {
      const report = buildMemoryReport(PROJECT_DIR);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Memory report error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_018_forge_skill_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_skill_status")) return _CALL_TOOL_NO_MATCH;

    try {
      if (!activeHub) {
        return { content: [{ type: "text", text: "Hub not running. Start the MCP server with --port to enable skill event tracking." }] };
      }
      const history = activeHub.getHistory();
      let skillEvents = history.filter((e) => e.type?.startsWith("skill-"));
      if (args.skillName) {
        skillEvents = skillEvents.filter((e) => e.skillName === args.skillName || e.data?.skillName === args.skillName);
      }
      if (skillEvents.length === 0) {
        return { content: [{ type: "text", text: "No skill execution events found. Run a skill via forge_run_skill first." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(skillEvents, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Skill status error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_019_forge_run_skill(request, args) {
  const { name } = request.params;
  if (!(name === "forge_run_skill")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

      // Resolve skill path — accept name or full path
      let skillPath = args.skill;
      if (!skillPath.endsWith(".md")) {
        // Try well-known locations
        const candidates = [
          join(cwd, ".github", "skills", skillPath, "SKILL.md"),
          join(cwd, "presets", "shared", "skills", skillPath, "SKILL.md"),
        ];
        skillPath = candidates.find((p) => existsSync(p));
        if (!skillPath) {
          return { content: [{ type: "text", text: `Skill not found: ${args.skill}. Looked in .github/skills/${args.skill}/SKILL.md` }], isError: true };
        }
      } else {
        skillPath = resolve(cwd, skillPath);
      }

      if (!existsSync(skillPath)) {
        return { content: [{ type: "text", text: `Skill file not found: ${skillPath}` }], isError: true };
      }

      const skill = parseSkill(skillPath);

      // Dry run — return parsed structure without executing
      if (args.dryRun) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "dry-run",
              skillName: skill.meta.name,
              description: skill.meta.description,
              tools: skill.meta.tools,
              stepCount: skill.stepCount,
              steps: skill.steps.map((s) => ({ number: s.number, name: s.name, hasConditional: !!s.conditional })),
              safetyRules: skill.safetyRules,
            }, null, 2),
          }],
        };
      }

      // Execute with hub event broadcasting
      const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
      const result = await executeSkill(skill, { cwd, eventHandler });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.status === "failed",
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Skill execution error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_020_forge_org_rules(request, args) {
  const { name } = request.params;
  if (!(name === "forge_org_rules")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = callOrgRules({ format: args.format || "github", output: args.output || null }, cwd);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Org rules error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_021_forge_crucible_submit(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_submit")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleSubmit({
        rawIdea: args.rawIdea,
        lane: args.lane,
        source: args.source,
        parentSmeltId: args.parentSmeltId,
        projectDir: cwd,
        hub: activeHub,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible submit error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_022_forge_crucible_ask(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_ask")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleAsk({
        id: args.id,
        questionId: args.questionId,
        answer: args.answer,
        projectDir: cwd,
        hub: activeHub,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // Issue #138 — surface mismatched questionId as a structured payload
      // so callers can re-fetch the pending question and retry.
      if (err instanceof CrucibleAskMismatchError) {
        const payload = { ok: false, code: err.code, expected: err.expected, got: err.got, hint: err.message };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      }
      return { content: [{ type: "text", text: `Crucible ask error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_023_forge_crucible_preview(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_preview")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandlePreview({ id: args.id, projectDir: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible preview error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_024_forge_crucible_finalize(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_finalize")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleFinalize({
        id: args.id,
        projectDir: cwd,
        hub: activeHub,
        overwrite: args.overwrite === true,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      if (err instanceof CrucibleFinalizeRefusedError) {
        const payload = { ok: false, refused: true, criticalGaps: err.payload.criticalGaps, hint: err.payload.hint };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      }
      // Issue #137 — plan-already-exists is a structured refusal so callers
      // can choose to re-issue with overwrite:true or accept the side-by-side draft.
      if (err instanceof CruciblePlanExistsError) {
        const payload = {
          ok: false,
          refused: true,
          code: err.code,
          phaseName: err.phaseName,
          planPath: err.planPath,
          draftPath: err.draftPath,
          hint: err.message,
        };
        return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
      }
      return { content: [{ type: "text", text: `Crucible finalize error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_025_forge_crucible_list(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_list")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleList({ status: args.status || null, projectDir: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible list error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_026_forge_crucible_abandon(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_abandon")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleAbandon({ id: args.id, projectDir: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible abandon error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_027_forge_crucible_import(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_import")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = importSpeckit({
        projectRoot: cwd,
        dir: args.dir || null,
        dryRun: args.dryRun === true,
        syncPrinciples: args.syncPrinciples === true,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible import error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_028_forge_crucible_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_status")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (args.smeltId) {
        const smelt = getSmelt(cwd, args.smeltId);
        if (!smelt) {
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: ERROR_CODES.SMELT_NOT_FOUND.code, smeltId: args.smeltId }) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, smelt }, null, 2) }] };
      }
      const smelts = listSmelts(cwd);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, smelts }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible status error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_029_forge_tempering_scan(request, args) {
  const { name } = request.params;
  if (!(name === "forge_tempering_scan")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await _temperingScanAnvilCompute(args, { _cwd: cwd, _hub: activeHub });
      emitToolTelemetry("forge_tempering_scan", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);

      // L3 capture on completion — tags `tempering`, `scan`, `<stack>`,
      // `<status>`; payload is the gap summary only (never source
      // content). Best-effort; OpenBrain outages fall through to
      // .forge/openbrain-queue.jsonl.
      try {
        const belowMin = Array.isArray(result.coverageVsMinima)
          ? result.coverageVsMinima.filter((g) => g.gap >= 5).length
          : 0;
        const summary = [
          `Tempering scan ${result.scanId} on ${result.stack}: status=${result.status}`,
          result.reason ? `(${result.reason})` : "",
          `gaps=${Array.isArray(result.coverageVsMinima) ? result.coverageVsMinima.length : 0} belowMin=${belowMin}`,
          `corr=${result.correlationId || "none"}`,
        ].filter(Boolean).join(" — ");
        captureMemory(summary, "lesson", `forge_tempering_scan/${result.stack}/${result.status}`, cwd);
      } catch { /* best-effort */ }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Tempering scan error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_030_forge_tempering_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_tempering_status")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = temperingHandleStatus({
        projectDir: cwd,
        limit: typeof args.limit === "number" ? args.limit : 10,
      });
      emitToolTelemetry("forge_tempering_status", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Tempering status error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_031_forge_tempering_run(request, args) {
  const { name } = request.params;
  if (!(name === "forge_tempering_run")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await runTemperingRun({
        projectDir: cwd,
        hub: activeHub,
        correlationId: args.correlationId || null,
        sliceRef: args.sliceRef || null,
        lastGreenSha: typeof args.lastGreenSha === "string" ? args.lastGreenSha : null,
        objective: args.objective && typeof args.objective === "object" ? args.objective : null,
        spawnWorker,
      });
      emitToolTelemetry("forge_tempering_run", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);

      // L3 capture on completion — tags `tempering`, `run`, `<stack>`,
      // `<verdict>`; payload is scanner mix + verdict + pass/fail count.
      // Best-effort; OpenBrain outages fall through to the queue.
      try {
        if (result.ok && result.scanners) {
          const unit = result.scanners.find((s) => s.scanner === "unit") || {};
          const summary = [
            `Tempering run ${result.runId} on ${result.stack}: verdict=${result.verdict}`,
            `unit: ${unit.pass || 0} pass / ${unit.fail || 0} fail / ${unit.skipped || 0} skip`,
            unit.timedOut ? "(budget-exceeded)" : "",
            `corr=${result.correlationId}`,
          ].filter(Boolean).join(" — ");
          captureMemory(summary, "lesson", `forge_tempering_run/${result.stack}/${result.verdict}`, cwd);
        }
      } catch { /* best-effort */ }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Tempering run error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_032_forge_tempering_approve_baseline(request, args) {
  const { name } = request.params;
  if (!(name === "forge_tempering_approve_baseline")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = promoteBaseline({
        urlHash: args.urlHash || null,
        url: args.url || null,
        runId: args.runId || null,
      }, cwd);

      // Emit hub event
      if (activeHub) {
        try {
          activeHub.broadcast({
            type: "tempering-baseline-promoted",
            data: { urlHash: result.urlHash, url: args.url || null, baselinePath: result.baselinePath },
            timestamp: new Date().toISOString(),
          });
        } catch { /* best-effort */ }
      }

      emitToolTelemetry("forge_tempering_approve_baseline", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Baseline approval error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_033_forge_tempering_drain(request, args) {
  const { name } = request.params;
  if (!(name === "forge_tempering_drain")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const maxRounds = typeof args.maxRounds === "number" ? Math.min(Math.max(1, args.maxRounds), 20) : 5;
      const result = await runTemperingDrain({
        project: cwd,
        maxRounds,
        scanners: Array.isArray(args.scanners) ? args.scanners : undefined,
        hub: activeHub,
        correlationId: args.correlationId || null,
        spawnWorker,
      });

      // Write audit artifact to .forge/audits/dev-<ts>.json
      const auditArtifactPath = writeAuditArtifact(cwd, result, args.sliceRef || null);

      const response = {
        ok: result.terminated !== "aborted",
        ...result,
        auditArtifact: auditArtifactPath,
      };

      emitToolTelemetry("forge_tempering_drain", args, response, Date.now() - t0, response.ok ? "OK" : "ERROR", cwd);

      // L3 capture on completion
      try {
        const summary = [
          `Drain ${response.ok ? "converged" : "did not converge"}: ${result.terminated}`,
          `rounds=${result.rounds.length}`,
          `curve=[${result.summary.drainCurve.join(",")}]`,
          `finalFindings=${result.summary.finalRealFindings}`,
        ].join(" — ");
        captureMemory(summary, "lesson", `forge_tempering_drain/${result.terminated}`, cwd);
      } catch { /* best-effort */ }

      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Tempering drain error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_034_forge_triage_route(request, args) {
  const { name } = request.params;
  if (!(name === "forge_triage_route")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      if (!args.finding || typeof args.finding !== "object") {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "finding object required" }, null, 2) }], isError: true };
      }
      const result = routeFinding(args.finding, args.classifierResult || null);
      emitToolTelemetry("forge_triage_route", args, result, Date.now() - t0, "OK", PROJECT_DIR);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...result }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Triage route error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_035_forge_classifier_issue(request, args) {
  const { name } = request.params;
  if (!(name === "forge_classifier_issue")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!args.payload || typeof args.payload !== "object") {
        const result = { ok: false, error: ERROR_CODES.MISSING_PAYLOAD.code, message: "payload object is required" };
        emitToolTelemetry("forge_classifier_issue", args, result, Date.now() - t0, "ERROR", cwd);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: true };
      }
      let config = {};
      try { config = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8")); } catch { /* proceed without config */ }
      const result = await fileClassifierIssue(args.payload, config, { execSync, cwd, fetch: globalThis.fetch });
      emitToolTelemetry("forge_classifier_issue", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_classifier_issue", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Classifier issue error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_036_forge_bug_register(request, args) {
  const { name } = request.params;
  if (!(name === "forge_bug_register")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const classification = await classifyBug({
        scanner: args.scanner,
        evidence: args.evidence || {},
        callModel: null,  // LLM not wired in MCP direct-call; rules only
      });
      const result = await registerBug({
        cwd,
        scanner: args.scanner,
        severity: args.severity || "medium",
        evidence: args.evidence || {},
        affectedFiles: args.affectedFiles || [],
        reproSteps: args.reproSteps || [],
        correlationId: args.correlationId || `bug-${Date.now()}`,
        sliceRef: args.sliceRef || null,
        classification: classification.classification,
        classifierMeta: classification,
        hub: activeHub,
        captureMemory,
      });
      emitToolTelemetry("forge_bug_register", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Bug registration error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_037_forge_bug_list(request, args) {
  const { name } = request.params;
  if (!(name === "forge_bug_list")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const filters = {};
      if (args.status) filters.status = args.status;
      if (args.severity) filters.severity = args.severity;
      if (args.scanner) filters.scanner = args.scanner;
      if (args.since) filters.since = args.since;
      if (args.until) filters.until = args.until;
      const bugs = listBugs(cwd, filters);
      emitToolTelemetry("forge_bug_list", args, { count: bugs.length }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: bugs.length, bugs }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Bug list error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_038_forge_bug_update_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_bug_update_status")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      // Bug #116: accept `status` as an alias for `newStatus`. Field-name
      // confusion was a footgun in the autonomous bug-fix loop \u2014 callers
      // copy the schema name from forge_bug_register (`status`) and the
      // tool silently rejected the call. Now both names work and we surface
      // a clear error if neither is provided.
      const newStatus = args.newStatus || args.status;
      if (typeof newStatus !== "string" || newStatus === "") {
        return { content: [{ type: "text", text: JSON.stringify({ error: ERROR_CODES.MISSING_STATUS.code, message: "forge_bug_update_status requires 'newStatus' (or alias 'status'). Valid values: open|in-fix|fixed|wont-fix|duplicate." }) }], isError: true };
      }
      const result = await updateBugStatus(cwd, args.bugId, newStatus, { note: args.note || null });
      if (result.ok && activeHub) {
        try {
          activeHub.broadcast({
            type: "tempering-bug-status-changed",
            data: { bugId: args.bugId, newStatus, note: args.note || null },
            timestamp: new Date().toISOString(),
          });
        } catch { /* best-effort */ }
      }
      emitToolTelemetry("forge_bug_update_status", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Bug status update error: ${err.message}` }], isError: true };
    }
  
}

function _getForgeBugValidationAdvisory(bug) {
  return (bug.status === "open" && !bug.linkedFixPlan)
    ? "Bug is 'open' with no linked fix plan — proceeding with validation (manual fix assumed)"
    : null;
}

async function _runBugScanners(scanners, testFilter, cwd) {
  const results = [];
  for (const s of scanners) {
    try {
      const r = await runSingleScanner(s, { cwd, testNameFilter: testFilter, timeoutMs: 120_000, now: () => new Date() });
      results.push({ scanner: s, passed: r.failures === 0, details: r });
    } catch (e) {
      if (e.code === "SCANNER_UNAVAILABLE") {
        return { results, scannerUnavailable: { scanner: s, message: e.message } };
      }
      results.push({ scanner: s, passed: false, error: e.message });
    }
  }
  return { results, scannerUnavailable: null };
}

async function _onBugValidatedFixed(bugId, bug, scanners, attempt, cwd) {
  if (activeHub) {
    try {
      activeHub.broadcast({
        type: "tempering-bug-validated-fixed",
        data: { bugId, scanners, attempt },
        timestamp: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
  }
  try {
    if (isOpenBrainConfigured(cwd)) {
      captureMemory(
        `Bug ${bugId} validated fixed by scanner rerun (${scanners.join(", ")}). Classification: ${bug.classification}. Fix plan: ${bug.linkedFixPlan || "manual"}.`,
        "decision", "forge_bug_validate_fix", cwd
      );
    }
  } catch { /* silent */ }
}

function _getBugValidationAdvisoryMessage(bug) {
  return (bug.status === "open" && !bug.linkedFixPlan)
    ? "Bug is 'open' with no linked fix plan — proceeding with validation (manual fix assumed)"
    : null;
}

function _createBugValidationAttemptData(args, bug) {
  const scanners = args.scannerOverride ?? (Array.isArray(bug.scanner) ? bug.scanner : [bug.scanner]);
  const testFilter = args.testNameOverride ?? bug.evidence?.testName ?? null;
  return {
    scanners,
    testFilter,
    attempt: { at: new Date().toISOString(), scanners, result: null, details: null },
  };
}

async function _finalizeBugValidationPass(cwd, bugId, bug, scanners, attempt) {
  await updateBugStatus(cwd, bugId, "fixed", {
    note: "Validated by forge_bug_validate_fix",
    validatedAt: new Date().toISOString(),
    validationMethod: "scanner-rerun",
  });
  try {
    const updatedBug = loadBug(cwd, bugId);
    await dispatchBugAdapter("commentValidatedFix", updatedBug || bug, {}, { cwd });
  } catch { /* adapter dispatch is advisory */ }
  await _onBugValidatedFixed(bugId, bug, scanners, attempt, cwd);
}

function _039_forge_bug_validate_fix_loadContext(cwd, args) {
  const bug = loadBug(cwd, args.bugId);
  if (!bug) {
    return {
      response: { content: [{ type: "text", text: JSON.stringify({ error: ERROR_CODES.BUG_NOT_FOUND.code, bugId: args.bugId }) }], isError: true },
    };
  }
  if (["fixed", "wont-fix", "duplicate"].includes(bug.status)) {
    return {
      response: {
        content: [{ type: "text", text: JSON.stringify({ error: ERROR_CODES.ALREADY_FIXED.code, bugId: args.bugId, currentStatus: bug.status }) }],
        isError: true,
      },
    };
  }
  return {
    bug,
    advisory: _getBugValidationAdvisoryMessage(bug),
    ..._createBugValidationAttemptData(args, bug),
  };
}

function _039_forge_bug_validate_fix_finalizeAttempt(cwd, bugId, advisory, scanners, attempt, results) {
  const allPassed = results.every((result) => result.passed);
  attempt.result = allPassed ? "pass" : "fail";
  attempt.details = results;
  appendValidationAttempt(cwd, bugId, attempt);
  return {
    allPassed,
    result: {
      bugId,
      verdict: allPassed ? "fixed" : "still-failing",
      scanners,
      attempt,
      validationDetails: results,
      ...(advisory ? { advisory } : {}),
    },
  };
}

async function _callToolHandler_039_forge_bug_validate_fix(request, args) {
  const { name } = request.params;
  if (!(name === "forge_bug_validate_fix")) return _CALL_TOOL_NO_MATCH;

  const t0 = Date.now();
  try {
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const context = _039_forge_bug_validate_fix_loadContext(cwd, args);
    if (context.response) return context.response;
    const { bug, advisory, scanners, testFilter, attempt } = context;
    const { results, scannerUnavailable } = await _runBugScanners(scanners, testFilter, cwd);
    if (scannerUnavailable) {
      return { content: [{ type: "text", text: JSON.stringify({ error: ERROR_CODES.SCANNER_UNAVAILABLE.code, scanner: scannerUnavailable.scanner, message: scannerUnavailable.message }) }], isError: true };
    }
    const finalized = _039_forge_bug_validate_fix_finalizeAttempt(cwd, args.bugId, advisory, scanners, attempt, results);
    if (finalized.allPassed) await _finalizeBugValidationPass(cwd, args.bugId, bug, scanners, attempt);
    emitToolTelemetry("forge_bug_validate_fix", args, finalized.result, Date.now() - t0, "OK", cwd);
    return { content: [{ type: "text", text: JSON.stringify(finalized.result, null, 2) }], isError: false };
  } catch (err) {
    return { content: [{ type: "text", text: `Bug validation error: ${err.message}` }], isError: true };
  }
}

async function _callToolHandler_040_forge_memory_capture(request, args) {
  const { name } = request.params;
  if (!(name === "forge_memory_capture")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!isOpenBrainConfigured(cwd)) {
        return { content: [{ type: "text", text: "OpenBrain is not configured. Add the openbrain MCP server to .vscode/mcp.json or .claude/mcp.json to enable persistent memory capture." }], isError: true };
      }

      // Read project name from .forge.json if not provided
      let project = args.project || null;
      if (!project) {
        try {
          const forgeConfig = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
          project = forgeConfig.projectName || "plan-forge";
        } catch { project = "plan-forge"; }
      }

      const thought = {
        content: args.content,
        project,
        type: args.type || "decision",
        source: args.source || "forge_memory_capture",
        created_by: args.created_by || "forge_memory_capture",
        captured_at: new Date().toISOString(),
      };

      // Return structured capture instructions — the AI worker executes capture_thought
      return {
        content: [{
          type: "text",
          text: `MEMORY CAPTURE — use the capture_thought tool with these parameters:\n\n${JSON.stringify(thought, null, 2)}\n\nAlternatively, POST to /api/memory/capture with the same payload to capture directly via REST (no AI worker needed).`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Memory capture error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_041_forge_brain_test(request, args) {
  const { name } = request.params;
  if (!(name === "forge_brain_test")) return _CALL_TOOL_NO_MATCH;

    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const cfg = readOpenBrainConfig(cwd);
    if (!cfg) {
      return { content: [{ type: "text", text: "OpenBrain SSE endpoint not found in .vscode/mcp.json or .claude/mcp.json (stdio-mode entries do not support brain_test)." }], isError: true };
    }
    if (!cfg.key) {
      return { content: [{ type: "text", text: "OpenBrain auth key not resolved. Set OPENBRAIN_KEY env var or check the mcp.json headers entry." }], isError: true };
    }
    let client = null;
    try {
      client = await createOpenBrainClient(cfg);
      const result = await brainRoundTrip(client, {
        project: args.project || "plan-forge",
        source: "pforge-brain-test",
        indexDelayMs: Number(args.indexDelayMs ?? 500),
      });
      const status = result.ok ? "✓ round-trip OK" : "✗ round-trip FAILED";
      const summary = [
        `${status}`,
        `  endpoint:   ${cfg.url}`,
        `  marker:     ${result.marker}`,
        `  duration:   ${result.durationMs}ms`,
        result.ok ? `  captured:   id=${result.capturedId || "(unknown)"}` : `  error:      ${result.error || "no hit returned by search"}`,
      ].join("\n");
      return { content: [{ type: "text", text: summary }], isError: !result.ok };
    } catch (err) {
      return { content: [{ type: "text", text: `Brain test error: ${err.message}` }], isError: true };
    } finally {
      if (client) { try { await client.close(); } catch { /* best-effort */ } }
    }
  
}

function _loadBrainReplayRecordsFromSource(sourcePath, st, project) {
  if (st.isDirectory()) {
    const records = [];
    for (const f of listMarkdownFiles(sourcePath, { recursive: false })) {
      records.push(...normalizeMarkdownFile(f, { project, source: `replay:${basename(f)}` }));
    }
    return { records, sourceType: "markdown-dir" };
  }
  if (/\.md$/i.test(sourcePath)) {
    return {
      records: normalizeMarkdownFile(sourcePath, { project, source: `replay:${basename(sourcePath)}` }),
      sourceType: "markdown-file",
    };
  }
  if (/\.jsonl?$/i.test(sourcePath)) {
    const records = [];
    const raw = readFileSync(sourcePath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try { records.push(normalizeQueueRecord(JSON.parse(s))); } catch { /* skip malformed */ }
    }
    return { records, sourceType: "queue-jsonl" };
  }
  return { records: null, sourceType: null };
}

function _resolveBrainReplaySource(args, cwd) {
  const sourcePath = isAbsolute(args.source) ? args.source : resolve(cwd, args.source);
  if (!existsSync(sourcePath)) {
    return {
      errorResponse: { content: [{ type: "text", text: `source not found: ${sourcePath}` }], isError: true },
      sourcePath,
    };
  }
  return { sourcePath, st: statSync(sourcePath) };
}

function _buildBrainReplaySummary(args, cfg, sourceType, sourcePath, result) {
  return [
    `Brain replay — ${args.dryRun ? "DRY RUN" : "sent"}`,
    `  source:     ${sourceType} (${sourcePath})`,
    `  endpoint:   ${cfg.url}`,
    `  attempted:  ${result.attempted}`,
    `  sent:       ${result.sent}`,
    `  failed:     ${result.failed}`,
    `  skipped:    ${result.skipped}`,
    `  duration:   ${result.durationMs}ms`,
    result.samples.length > 0 ? `  samples:    ${result.samples.map(s => `[${s.index}] ${s.content}`).join(" · ")}` : "",
  ].filter(Boolean).join("\n");
}

function _042_forge_brain_replay_validateRequest(args, cwd) {
  if (!args.source || typeof args.source !== "string") {
    return {
      response: { content: [{ type: "text", text: "source is required: pass a queue jsonl path, a markdown file, or a directory of .md files." }], isError: true },
    };
  }
  const cfg = readOpenBrainConfig(cwd);
  if (!cfg) {
    return {
      response: { content: [{ type: "text", text: "OpenBrain SSE endpoint not found in mcp.json (stdio-mode entries do not support brain_replay)." }], isError: true },
    };
  }
  if (!cfg.key && !args.dryRun) {
    return {
      response: { content: [{ type: "text", text: "OpenBrain auth key not resolved. Set OPENBRAIN_KEY env var or pass dryRun=true to preview without sending." }], isError: true },
    };
  }
  return { cfg };
}

function _042_forge_brain_replay_loadRecords(args, cwd) {
  const resolvedSource = _resolveBrainReplaySource(args, cwd);
  if (resolvedSource.errorResponse) return { response: resolvedSource.errorResponse };
  const { sourcePath, st } = resolvedSource;
  const project = args.project || "plan-forge";
  const { records: rawRecords, sourceType } = _loadBrainReplayRecordsFromSource(sourcePath, st, project);
  if (!rawRecords) {
    return {
      response: {
        content: [{ type: "text", text: `unsupported source type for ${sourcePath} — expected .jsonl, .md, or directory of .md files.` }],
        isError: true,
      },
    };
  }
  const maxRecords = Number(args.maxRecords ?? 500);
  return {
    sourcePath,
    sourceType,
    records: rawRecords.length > maxRecords ? rawRecords.slice(0, maxRecords) : rawRecords,
  };
}

async function _042_forge_brain_replay_runClient(args, cfg, records) {
  const replayClient = args.dryRun ? { capture: async () => ({}) } : await createOpenBrainClient(cfg);
  const client = args.dryRun ? null : replayClient;
  const result = await brainReplayRecords(replayClient, records, {
    rate: Number(args.rate ?? 50),
    maxRetries: Number(args.maxRetries ?? 3),
    dryRun: Boolean(args.dryRun),
    sampleSize: 3,
  });
  return { client, result };
}

async function _callToolHandler_042_forge_brain_replay(request, args) {
  const { name } = request.params;
  if (!(name === "forge_brain_replay")) return _CALL_TOOL_NO_MATCH;

  const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
  const validation = _042_forge_brain_replay_validateRequest(args, cwd);
  if (validation.response) return validation.response;
  let client = null;
  try {
    const loaded = _042_forge_brain_replay_loadRecords(args, cwd);
    if (loaded.response) return loaded.response;
    const executed = await _042_forge_brain_replay_runClient(args, validation.cfg, loaded.records);
    client = executed.client;
    const summary = _buildBrainReplaySummary(args, validation.cfg, loaded.sourceType, loaded.sourcePath, executed.result);
    return { content: [{ type: "text", text: summary }], isError: executed.result.failed > 0 };
  } catch (err) {
    return { content: [{ type: "text", text: `Brain replay error: ${err.message}` }], isError: true };
  } finally {
    if (client) { try { await client.close(); } catch { /* best-effort */ } }
  }
}

async function _callToolHandler_043_forge_generate_image(request, args) {
  const { name } = request.params;
  if (!(name === "forge_generate_image")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await generateImage(args.prompt, {
        model: args.model || "grok-imagine-image",
        size: args.size || "1024x1024",
        format: args.format,
        quality: args.quality,
        outputPath: args.outputPath,
        cwd,
      });

      if (result.success) {
        const payload = {
          status: "generated",
          localPath: result.localPath,
          mimeType: result.mimeType,
          originalFormat: result.originalFormat,
          converted: result.converted,
          model: result.model,
          revisedPrompt: result.revisedPrompt,
        };
        if (result.extensionCorrected) {
          payload.extensionWarning = `File extension was corrected from '${result.requestedPath}' to '${result.localPath}' — conversion to requested format was not possible (${result.warning || "sharp not installed"}).`;
        }
        if (result.warning) {
          payload.warning = result.warning;
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(payload, null, 2),
          }],
        };
      }
      return { content: [{ type: "text", text: `Image generation failed: ${result.error}` }], isError: true };
    } catch (err) {
      return { content: [{ type: "text", text: `Image generation error: ${err.message}` }], isError: true };
    }
  
}

function _resolveIncidentMttr(capturedAt, resolvedAt) {
  if (!resolvedAt) return { mttr: null, error: null };
  const resolvedMs = new Date(resolvedAt).getTime();
  const capturedMs = new Date(capturedAt).getTime();
  if (isNaN(resolvedMs)) {
    return { mttr: null, error: `Invalid resolvedAt timestamp: '${resolvedAt}'. Must be ISO 8601 (e.g., 2024-01-01T02:30:00Z)` };
  }
  if (resolvedMs < capturedMs) {
    return { mttr: null, error: `resolvedAt (${resolvedAt}) is earlier than capturedAt (${capturedAt}). Check the timestamp.` };
  }
  return { mttr: resolvedMs - capturedMs, error: null };
}

function _correlateIncidentDeploy(capturedAt, cwd) {
  try {
    const deploys = readForgeJsonl("deploy-journal.jsonl", [], cwd);
    const capturedMs = new Date(capturedAt).getTime();
    for (let i = deploys.length - 1; i >= 0; i--) {
      const d = deploys[i];
      if (d.deployedAt && new Date(d.deployedAt).getTime() <= capturedMs) {
        return { journalId: d.id, version: d.version };
      }
    }
  } catch { /* no deploy journal — skip */ }
  return null;
}

function _detectRecurringIncident(record, incFiles, cwd) {
  if (!incFiles.length) return null;
  try {
    const allIncidents = readForgeJsonl("incidents.jsonl", [], cwd);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const priorOnSameFiles = allIncidents.filter(i =>
      i.id !== record.id &&
      new Date(i.capturedAt || 0).getTime() > thirtyDaysAgo &&
      (i.files || []).some(f => incFiles.some(cf => f.includes(cf) || cf.includes(f)))
    );
    if (priorOnSameFiles.length < 2) return null;
    const recurring = { count: priorOnSameFiles.length + 1, files: incFiles, pattern: "systemic" };
    if (record.severity === "medium" || record.severity === "low") {
      record.severity = "high";
      record.autoEscalated = true;
      record.escalationReason = `Recurring: ${priorOnSameFiles.length + 1} incidents on same file(s) in 30 days`;
    }
    return recurring;
  } catch { /* best-effort recurring detection */ }
  return null;
}

function _validateIncidentSeverityValue(severity) {
  const validSeverities = ["low", "medium", "high", "critical"];
  return validSeverities.includes(severity)
    ? null
    : `Invalid severity '${severity}'. Must be one of: ${validSeverities.join(", ")}`;
}

function _loadIncidentOnCall(cwd) {
  try {
    const forgeConfigPath = resolve(cwd, ".forge.json");
    if (!existsSync(forgeConfigPath)) return null;
    const forgeConfig = JSON.parse(readFileSync(forgeConfigPath, "utf-8"));
    return forgeConfig.onCall || null;
  } catch { /* ignore */ }
  return null;
}

function _createIncidentRecord(args, severity, capturedAt, mttr) {
  return {
    id: `inc-${Date.now()}`,
    description: args.description,
    severity,
    files: args.files || [],
    capturedAt,
    resolvedAt: args.resolvedAt || null,
    mttr,
  };
}

function _044_forge_incident_capture_validateArgs(args) {
  const severity = args.severity || "medium";
  const severityError = _validateIncidentSeverityValue(severity);
  if (severityError) {
    return { response: { content: [{ type: "text", text: severityError }], isError: true } };
  }
  const capturedAt = new Date().toISOString();
  const { mttr, error: mttrError } = _resolveIncidentMttr(capturedAt, args.resolvedAt || null);
  if (mttrError) {
    return { response: { content: [{ type: "text", text: mttrError }], isError: true } };
  }
  return { severity, capturedAt, mttr };
}

function _044_forge_incident_capture_buildRecord(args, cwd, severity, capturedAt, mttr) {
  const record = _createIncidentRecord(args, severity, capturedAt, mttr);
  const precedingDeploy = _correlateIncidentDeploy(capturedAt, cwd);
  if (precedingDeploy) record.precedingDeploy = precedingDeploy;
  appendForgeJsonl("incidents.jsonl", record, cwd);
  const recurring = _detectRecurringIncident(record, args.files || [], cwd);
  if (recurring) record.recurring = recurring;
  return record;
}

function _044_forge_incident_capture_notify(args, cwd, severity, capturedAt, record) {
  activeHub?.broadcast({ type: "incident-captured", data: record, timestamp: capturedAt });
  const onCall = _loadIncidentOnCall(cwd);
  if (onCall) {
    activeBridge?.dispatch?.({ type: "incident-captured", severity, description: args.description, onCall });
  }
}

async function _callToolHandler_044_forge_incident_capture(request, args) {
  const { name } = request.params;
  if (!(name === "forge_incident_capture")) return _CALL_TOOL_NO_MATCH;

  try {
    const t0 = Date.now();
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const validation = _044_forge_incident_capture_validateArgs(args);
    if (validation.response) return validation.response;
    const { severity, capturedAt, mttr } = validation;
    const record = _044_forge_incident_capture_buildRecord(args, cwd, severity, capturedAt, mttr);
    _044_forge_incident_capture_notify(args, cwd, severity, capturedAt, record);
    emitToolTelemetry("forge_incident_capture", args, record, Date.now() - t0, "OK", cwd);
    await broadcastLiveGuard("forge_incident_capture", "OK", Date.now() - t0);
    captureMemory(
      `Incident ${record.id}: ${args.description}. Severity: ${severity}. Files: ${(args.files || []).join(", ") || "none"}.`,
      "gotcha", "forge_incident_capture", cwd
    );
    return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }], isError: false };
  } catch (err) {
    return { content: [{ type: "text", text: `Incident capture error: ${err.message}` }], isError: true };
  }
}

async function _callToolHandler_045_forge_deploy_journal(request, args) {
  const { name } = request.params;
  if (!(name === "forge_deploy_journal")) return _CALL_TOOL_NO_MATCH;

    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

      if (!args.version || typeof args.version !== "string" || !args.version.trim()) {
        return { content: [{ type: "text", text: "version is required and must be a non-empty string" }], isError: true };
      }

      const record = {
        id: `deploy-${Date.now()}`,
        version: args.version.trim(),
        by: (args.by || "unknown").trim(),
        notes: args.notes ? args.notes.trim() : null,
        slice: args.slice ? args.slice.trim() : null,
        deployedAt: new Date().toISOString(),
      };

      appendForgeJsonl("deploy-journal.jsonl", record, cwd);

      activeHub?.broadcast({ type: "deploy-recorded", data: record, timestamp: record.deployedAt });

      emitToolTelemetry("forge_deploy_journal", args, record, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_deploy_journal", "OK", Date.now() - t0);

      // Auto-capture deploy decision
      captureMemory(
        `Deploy v${record.version}: ${record.notes || "no notes"}. By: ${record.by}.`,
        "decision", "forge_deploy_journal", cwd
      );

      return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Deploy journal error: ${err.message}` }], isError: true };
    }
  
}

function _buildForgeRegressionHistoryRecord(result) {
  return {
    timestamp: new Date().toISOString(),
    gatesChecked: result.gatesChecked,
    passed: result.passed,
    failed: result.failed,
    blocked: result.blocked || 0,
    skipped: result.skipped || 0,
  };
}

function _collectForgeRegressionGuardedFiles(files, cwd, planPath) {
  const guardedFiles = new Set(files);
  if (!planPath) return guardedFiles;
  try {
    const plan = parsePlan(resolve(cwd, planPath), cwd);
    for (const scopedPath of (plan.scopeContract?.inScope || [])) {
      guardedFiles.add(scopedPath);
    }
  } catch { /* skip */ }
  return guardedFiles;
}

function _expandForgeRegressionGuardedFiles(incidents, guardedFiles) {
  const hasOpenAutoDrift = incidents.some((incident) => !incident.resolvedAt && incident.source === "auto-drift");
  if (guardedFiles.size > 0 || !hasOpenAutoDrift) return guardedFiles;
  for (const incident of incidents) {
    if (incident.resolvedAt || incident.source !== "auto-drift") continue;
    for (const file of (incident.files || [])) {
      guardedFiles.add(file);
    }
  }
  return guardedFiles;
}

function _resolveForgeRegressionIncidents(incidents, guardedFiles) {
  const resolveAll = guardedFiles.size === 0;
  const resolvedAt = new Date().toISOString();
  const guarded = [...guardedFiles];
  const resolvedIncidents = [];
  const updatedIncidents = incidents.map((incident) => {
    if (incident.resolvedAt) return incident;
    const incidentFiles = incident.files || [];
    const shouldResolve = resolveAll
      || incidentFiles.some((file) => guarded.some((guardedFile) => file.includes(guardedFile) || guardedFile.includes(file)));
    if (!shouldResolve) return incident;
    const capturedMs = new Date(incident.capturedAt || incident.timestamp || 0).getTime();
    const resolvedMs = new Date(resolvedAt).getTime();
    resolvedIncidents.push(incident.id);
    return { ...incident, resolvedAt, mttr: resolvedMs - capturedMs };
  });
  return { updatedIncidents, resolvedIncidents };
}

function _persistForgeRegressionResolutions(cwd, updatedIncidents, resolvedIncidents) {
  if (resolvedIncidents.length === 0) return;
  const incPath = resolve(cwd, ".forge", "incidents.jsonl");
  writeFileSync(incPath, updatedIncidents.map((incident) => JSON.stringify(incident)).join("\n") + "\n", "utf-8");

  try {
    const proposals = readForgeJsonl("fix-proposals.json", [], cwd);
    for (const proposal of proposals) {
      if (proposal.outcome) continue;
      const matchesResolved = resolvedIncidents.some((resolvedId) => proposal.fixId && resolvedId.includes(proposal.fixId.replace("drift-auto-", "")));
      if (!matchesResolved) continue;
      proposal.outcome = "effective";
      proposal.resolvedAt = new Date().toISOString();
    }
    const proposalPath = resolve(cwd, ".forge", "fix-proposals.json");
    writeFileSync(proposalPath, proposals.map((proposal) => JSON.stringify(proposal)).join("\n") + "\n", "utf-8");
  } catch { /* best-effort outcome tracking */ }
}

function _captureForgeRegressionGuardMemory(result, cwd) {
  if (result.resolvedIncidents?.length > 0) {
    captureMemory(
      `Regression guard passed (${result.passed}/${result.gatesChecked} gates). Auto-resolved ${result.resolvedIncidents.length} incident(s).`,
      "lesson", "forge_regression_guard", cwd
    );
    return;
  }
  if (result.failed > 0) {
    captureMemory(
      `Regression guard failed: ${result.failed}/${result.gatesChecked} gate(s) failed.`,
      "gotcha", "forge_regression_guard", cwd
    );
  }
}

function _046_forge_regression_guard_shouldAutoResolve(result, args) {
  return result.success && result.passed > 0 && args.autoResolve !== false;
}

function _046_forge_regression_guard_collectGuardedFiles(files, planPath, incidents, cwd) {
  const guardedFiles = new Set(files || []);
  if (planPath) {
    try {
      const plan = parsePlan(resolve(cwd, planPath), cwd);
      for (const scopeItem of (plan.scopeContract?.inScope || [])) guardedFiles.add(scopeItem);
    } catch { /* skip */ }
  }
  const hasOpenAutoDrift = incidents.some((incident) => !incident.resolvedAt && incident.source === "auto-drift");
  if (guardedFiles.size === 0 && hasOpenAutoDrift) {
    for (const incident of incidents) {
      if (!incident.resolvedAt && incident.source === "auto-drift") {
        for (const file of (incident.files || [])) guardedFiles.add(file);
      }
    }
  }
  return guardedFiles;
}

function _046_forge_regression_guard_updateIncidents(incidents, guardedFiles, passed) {
  const resolvedIncidents = [];
  const resolvedAt = new Date().toISOString();
  const guardedList = [...guardedFiles];
  const resolveAll = guardedFiles.size === 0 && passed > 0;
  const updatedIncidents = incidents.map((incident) => {
    if (incident.resolvedAt) return incident;
    const incidentFiles = incident.files || [];
    const shouldResolve = resolveAll || incidentFiles.some((file) => guardedList.some((guardedFile) => file.includes(guardedFile) || guardedFile.includes(file)));
    if (!shouldResolve) return incident;
    const capturedMs = new Date(incident.capturedAt || incident.timestamp || 0).getTime();
    const resolvedMs = new Date(resolvedAt).getTime();
    resolvedIncidents.push(incident.id);
    return { ...incident, resolvedAt, mttr: resolvedMs - capturedMs };
  });
  return { resolvedAt, resolvedIncidents, updatedIncidents };
}

function _046_forge_regression_guard_writeIncidents(cwd, updatedIncidents) {
  const incidentPath = resolve(cwd, ".forge", "incidents.jsonl");
  writeFileSync(incidentPath, updatedIncidents.map((incident) => JSON.stringify(incident)).join("\n") + "\n", "utf-8");
}

function _046_forge_regression_guard_markProposalOutcomes(cwd, resolvedIncidents, resolvedAt) {
  try {
    const proposals = readForgeJsonl("fix-proposals.json", [], cwd);
    for (const proposal of proposals) {
      if (proposal.outcome) continue;
      const matchesResolved = resolvedIncidents.some((incidentId) => proposal.fixId && incidentId.includes(proposal.fixId.replace("drift-auto-", "")));
      if (matchesResolved) {
        proposal.outcome = "effective";
        proposal.resolvedAt = resolvedAt;
      }
    }
    const proposalPath = resolve(cwd, ".forge", "fix-proposals.json");
    writeFileSync(proposalPath, proposals.map((proposal) => JSON.stringify(proposal)).join("\n") + "\n", "utf-8");
  } catch { /* best-effort outcome tracking */ }
}

function _046_forge_regression_guard_autoResolve(result, args, files, cwd) {
  if (!_046_forge_regression_guard_shouldAutoResolve(result, args)) return [];
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  const guardedFiles = _046_forge_regression_guard_collectGuardedFiles(files, args.plan, incidents, cwd);
  const { resolvedAt, resolvedIncidents, updatedIncidents } = _046_forge_regression_guard_updateIncidents(incidents, guardedFiles, result.passed);
  if (resolvedIncidents.length === 0) return [];
  _046_forge_regression_guard_writeIncidents(cwd, updatedIncidents);
  _046_forge_regression_guard_markProposalOutcomes(cwd, resolvedIncidents, resolvedAt);
  return resolvedIncidents;
}

function _046_forge_regression_guard_capture(result, cwd) {
  if (result.resolvedIncidents?.length > 0) {
    captureMemory(
      `Regression guard passed (${result.passed}/${result.gatesChecked} gates). Auto-resolved ${result.resolvedIncidents.length} incident(s).`,
      "lesson", "forge_regression_guard", cwd
    );
    return;
  }
  if (result.failed > 0) {
    captureMemory(
      `Regression guard failed: ${result.failed}/${result.gatesChecked} gate(s) failed.`,
      "gotcha", "forge_regression_guard", cwd
    );
  }
}

function _th_046_appendRegressionHistory(result, cwd) {
  const regRecord = {
    timestamp: new Date().toISOString(),
    gatesChecked: result.gatesChecked,
    passed: result.passed,
    failed: result.failed,
    blocked: result.blocked || 0,
    skipped: result.skipped || 0,
  };
  appendForgeJsonl("regression-history.jsonl", regRecord, cwd);
}

function _th_046_buildGuardedFiles({ args, cwd, files, incidents }) {
  const guardedFiles = new Set(files);
  if (args.plan) {
    try {
      const plan = parsePlan(resolve(cwd, args.plan), cwd);
      for (const scoped of (plan.scopeContract?.inScope || [])) guardedFiles.add(scoped);
    } catch { /* skip */ }
  }

  const hasOpenAutoDrift = incidents.some((incident) => !incident.resolvedAt && incident.source === "auto-drift");
  if (guardedFiles.size === 0 && hasOpenAutoDrift) {
    for (const incident of incidents) {
      if (incident.resolvedAt || incident.source !== "auto-drift") continue;
      for (const file of (incident.files || [])) guardedFiles.add(file);
    }
  }
  return guardedFiles;
}

function _th_046_resolveIncidentSet({ incidents, guardedFiles, resolveAll, resolvedAt }) {
  const guarded = [...guardedFiles];
  const resolvedIncidents = [];
  const updatedIncidents = incidents.map((incident) => {
    if (incident.resolvedAt) return incident;
    const incidentFiles = incident.files || [];
    const shouldResolve = resolveAll || incidentFiles.some((file) =>
      guarded.some((guardedFile) => file.includes(guardedFile) || guardedFile.includes(file))
    );
    if (!shouldResolve) return incident;
    const capturedMs = new Date(incident.capturedAt || incident.timestamp || 0).getTime();
    const resolvedMs = new Date(resolvedAt).getTime();
    resolvedIncidents.push(incident.id);
    return { ...incident, resolvedAt, mttr: resolvedMs - capturedMs };
  });
  return { updatedIncidents, resolvedIncidents };
}

function _th_046_trackResolvedFixProposals(cwd, resolvedIncidents, resolvedAt) {
  try {
    const proposals = readForgeJsonl("fix-proposals.json", [], cwd);
    for (const proposal of proposals) {
      if (proposal.outcome) continue;
      const matchesResolved = resolvedIncidents.some((resolvedId) =>
        proposal.fixId && resolvedId.includes(proposal.fixId.replace("drift-auto-", ""))
      );
      if (matchesResolved) {
        proposal.outcome = "effective";
        proposal.resolvedAt = resolvedAt;
      }
    }
    const proposalPath = resolve(cwd, ".forge", "fix-proposals.json");
    writeFileSync(proposalPath, proposals.map((proposal) => JSON.stringify(proposal)).join("\n") + "\n", "utf-8");
  } catch { /* best-effort outcome tracking */ }
}

function _th_046_autoResolveIncidents({ args, cwd, files, result }) {
  if (!(result.success && result.passed > 0 && args.autoResolve !== false)) return [];
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  const guardedFiles = _th_046_buildGuardedFiles({ args, cwd, files, incidents });
  const resolveAll = guardedFiles.size === 0 && result.passed > 0;
  const resolvedAt = new Date().toISOString();
  const { updatedIncidents, resolvedIncidents } = _th_046_resolveIncidentSet({
    incidents,
    guardedFiles,
    resolveAll,
    resolvedAt,
  });
  if (resolvedIncidents.length === 0) return [];
  const incidentsPath = resolve(cwd, ".forge", "incidents.jsonl");
  writeFileSync(incidentsPath, updatedIncidents.map((incident) => JSON.stringify(incident)).join("\n") + "\n", "utf-8");
  _th_046_trackResolvedFixProposals(cwd, resolvedIncidents, resolvedAt);
  return resolvedIncidents;
}

function _th_046_captureRegressionGuardMemory(result, cwd) {
  if (result.resolvedIncidents?.length > 0) {
    captureMemory(
      `Regression guard passed (${result.passed}/${result.gatesChecked} gates). Auto-resolved ${result.resolvedIncidents.length} incident(s).`,
      "lesson", "forge_regression_guard", cwd
    );
    return;
  }
  if (result.failed > 0) {
    captureMemory(
      `Regression guard failed: ${result.failed}/${result.gatesChecked} gate(s) failed.`,
      "gotcha", "forge_regression_guard", cwd
    );
  }
}

async function _callToolHandler_046_forge_regression_guard(request, args) {
  const { name } = request.params;
  if (!(name === "forge_regression_guard")) return _CALL_TOOL_NO_MATCH;

    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const files = args.files || [];
      const result = await regressionGuard(files, {
        plan: args.plan || null,
        failFast: args.failFast || false,
        cwd,
      });

      _th_046_appendRegressionHistory(result, cwd);
      const resolvedIncidents = _th_046_autoResolveIncidents({ args, cwd, files, result });
      if (resolvedIncidents.length > 0) result.resolvedIncidents = resolvedIncidents;

      emitToolTelemetry("forge_regression_guard", args, result, Date.now() - t0, result.success ? "ok" : "error", cwd);
      await broadcastLiveGuard("forge_regression_guard", result.success ? "ok" : "error", Date.now() - t0, {
        gates: result.gatesChecked,
        passed: result.passed,
        failed: result.failed,
        resolved: (result.resolvedIncidents || []).length,
      });

      _th_046_captureRegressionGuardMemory(result, cwd);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Regression guard error: ${err.message}` }], isError: true };
    }
  
}

function _th_047_detectTestStatus(cwd) {
  try {
    const hasPkgJson = existsSync(resolve(cwd, "package.json"));
    const hasDotnet = readdirSync(cwd).some((file) => file.endsWith(".csproj") || file.endsWith(".sln") || file.endsWith(".slnx"));
    const testCmd = hasPkgJson ? "npm test --if-present" : hasDotnet ? "dotnet test --nologo --verbosity quiet" : null;
    if (!testCmd) return null;
    try {
      const output = execSync(testCmd, { cwd, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });
      const passMatch = output.match(/(\d+)\s+passed/i);
      return {
        status: "green",
        passed: passMatch ? parseInt(passMatch[1], 10) : null,
        failed: 0,
        command: testCmd,
      };
    } catch (testErr) {
      const errOutput = (testErr.stdout || "") + (testErr.stderr || "");
      const passMatch = errOutput.match(/(\d+)\s+passed/i);
      const failMatch = errOutput.match(/(\d+)\s+failed/i);
      return {
        status: "red",
        passed: passMatch ? parseInt(passMatch[1], 10) : 0,
        failed: failMatch ? parseInt(failMatch[1], 10) : 1,
        command: testCmd,
      };
    }
  } catch {
    return null;
  }
}

function _th_047_recordDriftHistory(score, analysis, cwd) {
  const history = readForgeJsonl("drift-history.json", [], cwd);
  const previous = history.length ? history[history.length - 1] : null;
  const delta = previous ? score - previous.score : 0;
  const trend = !previous ? "stable" : delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
  const record = {
    timestamp: new Date().toISOString(),
    score,
    violations: analysis.violations,
    frameworkViolations: analysis.frameworkViolations || [],
    filesScanned: analysis.filesScanned,
    delta,
    trend,
  };
  appendForgeJsonl("drift-history.json", record, cwd);
  return { historyLength: history.length + 1, delta, trend, record };
}

function _th_047_groupViolationsByFile(violations) {
  const byFile = {};
  for (const violation of violations) {
    if (!byFile[violation.file]) byFile[violation.file] = [];
    byFile[violation.file].push(violation);
  }
  return byFile;
}

function _th_047_buildCodeSnippet(filePath, lineNum) {
  const lines = readFileSync(filePath, "utf-8").split("\n");
  const start = Math.max(0, lineNum - 6);
  const end = Math.min(lines.length, lineNum + 5);
  return lines.slice(start, end).map((line, index) => {
    const num = start + index + 1;
    const marker = num === lineNum ? " >>>" : "    ";
    return `${marker} ${String(num).padStart(4)}| ${line}`;
  }).join("\n");
}

function _th_047_generateAutoFixPlan(cwd, severeViolations, byFile) {
  const fixId = `drift-auto-${Date.now()}`;
  const autoDir = resolve(cwd, "docs/plans/auto");
  mkdirSync(autoDir, { recursive: true });
  const planName = `LIVEGUARD-FIX-${fixId}.md`;
  const planPath = resolve(autoDir, planName);
  if (existsSync(planPath)) return null;

  let planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n`;
  planContent += `> Generated: ${new Date().toISOString()}\n`;
  planContent += `> Source: drift (auto-incident)\n\n`;
  planContent += `## Scope Contract\n\nThis plan addresses ${severeViolations.length} high/critical drift violation(s) detected by LiveGuard.\n\n`;
  for (const [file, violations] of Object.entries(byFile)) {
    planContent += `## Slice — Fix: ${file}\n\n`;
    planContent += `**Tasks:**\n`;
    for (const violation of violations) planContent += `- [ ] Fix ${violation.rule} at line ${violation.line}: ${violation.description}\n`;
    try {
      const filePath = resolve(cwd, file);
      if (existsSync(filePath)) {
        for (const violation of violations.slice(0, 3)) {
          const snippet = _th_047_buildCodeSnippet(filePath, violation.line);
          planContent += `\n**Code at violation (line ${violation.line}):**\n\`\`\`\n${snippet}\n\`\`\`\n`;
        }
      }
    } catch { /* file read error — skip snippet */ }
    planContent += `\n**Scope:** ${file}\n\n`;
  }
  writeFileSync(planPath, planContent, "utf-8");
  return `docs/plans/auto/${planName}`;
}

function _th_047_addAutoIncidents(args, analysis, result, cwd) {
  if (!args.autoIncident) return;
  const severeViolations = analysis.violations.filter((violation) => violation.severity === "high" || violation.severity === "critical");
  if (severeViolations.length === 0) return;
  const byFile = _th_047_groupViolationsByFile(severeViolations);
  const autoIncidents = [];
  for (const [file, violations] of Object.entries(byFile)) {
    const description = violations.map((violation) => `${violation.rule} at line ${violation.line}`).join("; ");
    const incidentRecord = {
      id: `inc-drift-${Date.now()}-${file.replace(/[/\\]/g, "-")}`,
      description: `Drift violation in ${file}: ${description}`,
      severity: violations.some((violation) => violation.severity === "critical") ? "critical" : "high",
      files: [file],
      capturedAt: new Date().toISOString(),
      resolvedAt: null,
      mttr: null,
      source: "auto-drift",
    };
    appendForgeJsonl("incidents.jsonl", incidentRecord, cwd);
    autoIncidents.push(incidentRecord.id);
  }
  result.autoIncidents = autoIncidents;
  try {
    const autoFixPlan = _th_047_generateAutoFixPlan(cwd, severeViolations, byFile);
    if (autoFixPlan) result.autoFixPlan = autoFixPlan;
  } catch { /* fix proposal generation is best-effort */ }
}

function _th_047_captureDriftMemory(analysis, score, cwd) {
  if (analysis.violations.length === 0) return;
  captureMemory(
    `Drift: ${analysis.violations.length} violation(s) — ${[...new Set(analysis.violations.map((violation) => violation.rule))].join(", ")} in ${[...new Set(analysis.violations.map((violation) => violation.file))].join(", ")}. Score: ${score}/100.`,
    "gotcha", "forge_drift_report", cwd
  );
}

async function _callToolHandler_047_forge_drift_report(request, args) {
  const { name } = request.params;
  if (!(name === "forge_drift_report")) return _CALL_TOOL_NO_MATCH;

    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const threshold = Math.max(0, Math.min(100, args.threshold ?? 70));
      const penaltyPerViolation = 2;
      const analysis = await runAnalyze({ mode: "file", path: ".", rules: args.rules || null, cwd });
      const score = Math.max(0, 100 - (analysis.violations.length * penaltyPerViolation));
      const testStatus = _th_047_detectTestStatus(cwd);
      const historyData = _th_047_recordDriftHistory(score, analysis, cwd);

      if (score < threshold) {
        activeHub?.broadcast({
          type: "drift-alert",
          data: { score, threshold, violations: analysis.violations.length },
          timestamp: historyData.record.timestamp,
        });
        activeBridge?.dispatch?.({ type: "drift-alert", score, threshold });
      }

      const result = {
        score,
        violations: analysis.violations,
        frameworkViolations: analysis.frameworkViolations || [],
        filesScanned: analysis.filesScanned,
        trend: historyData.trend,
        delta: historyData.delta,
        historyLength: historyData.historyLength,
        testStatus,
      };

      _th_047_addAutoIncidents(args, analysis, result, cwd);
      emitToolTelemetry("forge_drift_report", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_drift_report", "OK", Date.now() - t0, {
        score,
        appViolations: analysis.violations.length,
        testStatus: testStatus?.status || null,
      });
      _th_047_captureDriftMemory(analysis, score, cwd);

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Drift report error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_048_forge_runbook(request, args) {
  const { name } = request.params;
  if (!(name === "forge_runbook")) return _CALL_TOOL_NO_MATCH;

    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const planPath = resolve(cwd, args.plan);

      if (!existsSync(planPath)) {
        return { content: [{ type: "text", text: `Plan file not found: ${args.plan}` }], isError: true };
      }

      const plan = parsePlan(planPath, cwd);
      const includeIncidents = args.includeIncidents !== false;
      const content = generateRunbook(plan, cwd, { includeIncidents });

      const runbookName = planNameToRunbookName(planPath);
      const runbooksDir = resolve(cwd, ".forge", "runbooks");
      mkdirSync(runbooksDir, { recursive: true });
      writeFileSync(resolve(runbooksDir, runbookName), content, "utf-8");

      const result = { runbook: `.forge/runbooks/${runbookName}`, slices: plan.slices.length, generatedAt: new Date().toISOString() };
      emitToolTelemetry("forge_runbook", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_runbook", "OK", Date.now() - t0);

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Runbook error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_049_forge_hotspot(request, args) {
  const { name } = request.params;
  if (!(name === "forge_hotspot")) return _CALL_TOOL_NO_MATCH;

    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await _hotspotAnvilCompute(args, { _cwd: cwd });
      emitToolTelemetry("forge_hotspot", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_hotspot", "OK", Date.now() - t0);

      // Auto-capture hotspot patterns
      if (result.hotspots?.length > 0) {
        const top3 = result.hotspots.slice(0, 3).map(h => h.file).join(", ");
        captureMemory(
          `Hotspots (top ${result.showing}): ${top3}. ${result.totalFiles} files analyzed.`,
          "pattern", "forge_hotspot", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Hotspot analysis error: ${err.message}` }], isError: true };
    }
  
}

function _detectForgeDepWatchProjectType(cwd) {
  const snapshotPath = resolve(cwd, ".forge", "deps-snapshot.json");
  const pkgPath = resolve(cwd, "package.json");
  const hasPkgJson = existsSync(pkgPath);
  const csprojFiles = hasPkgJson ? [] : readdirSync(cwd).filter((file) => file.endsWith(".csproj") || file.endsWith(".sln") || file.endsWith(".slnx"));
  const isDotnet = !hasPkgJson && csprojFiles.length > 0;
  return { snapshotPath, hasPkgJson, isDotnet };
}

function _loadForgeDepWatchSnapshot(snapshotPath) {
  if (!existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch {
    return null;
  }
}

function _parseDotnetVulnsFromJson(dotnetOutput) {
  const parsed = JSON.parse(dotnetOutput);
  const projects = parsed.projects || [];
  const vulns = [];
  for (const project of projects) {
    for (const framework of (project.frameworks || [])) {
      const packages = [...(framework.topLevelPackages || []), ...(framework.transitivePackages || [])];
      for (const packageInfo of packages) {
        for (const vulnerability of (packageInfo.vulnerabilities || [])) {
          vulns.push({
            name: packageInfo.id,
            severity: (vulnerability.severity || "unknown").toLowerCase(),
            via: [vulnerability.advisoryurl || ""],
            range: `${packageInfo.resolvedVersion || ""}`,
          });
        }
      }
    }
  }
  return vulns;
}

function _parseDotnetVulnsFromText(dotnetOutput) {
  const vulns = [];
  for (const line of dotnetOutput.split("\n")) {
    const match = line.match(/>\s+(\S+)\s+(\S+)\s+(\S+)\s+(Low|Moderate|High|Critical)/i);
    if (!match) continue;
    vulns.push({
      name: match[1],
      severity: match[4].toLowerCase().replace("moderate", "medium"),
      via: [],
      range: match[2],
    });
  }
  return vulns;
}

function _scanForgeDotnetVulnerabilities(cwd) {
  return _th_050_collectDotnetVulnerabilities(cwd);
}

function _scanForgeNpmVulnerabilities(cwd) {
  let auditResult;
  try {
    auditResult = JSON.parse(execSync("npm audit --json 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 }));
  } catch (err) {
    if (err.stdout) {
      try {
        auditResult = JSON.parse(err.stdout);
      } catch {
        auditResult = null;
      }
    }
    if (!auditResult) {
      throw new Error(`npm audit failed: ${err.message}`);
    }
  }

  const vulns = auditResult.vulnerabilities || {};
  return Object.entries(vulns).map(([pkgName, info]) => ({
    name: pkgName,
    severity: info.severity || "unknown",
    via: Array.isArray(info.via) ? info.via.filter((item) => typeof item === "string") : [],
    range: info.range || "",
  }));
}

function _compareForgeDepWatchSnapshots(prevSnapshot, currentVulns) {
  const prevVulnNames = new Set((prevSnapshot?.vulnerabilities || []).map((item) => item.name));
  const currVulnNames = new Set(currentVulns.map((item) => item.name));
  const newVulnerabilities = currentVulns.filter((item) => !prevVulnNames.has(item.name));
  const resolvedVulnerabilities = (prevSnapshot?.vulnerabilities || []).filter((item) => !currVulnNames.has(item.name));
  return {
    newVulnerabilities,
    resolvedVulnerabilities,
    unchanged: currentVulns.length - newVulnerabilities.length,
  };
}

function _persistForgeDepWatchSnapshot(snapshotPath, cwd, currentVulns) {
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  const snapshot = {
    capturedAt: new Date().toISOString(),
    depCount: currentVulns.length,
    vulnerabilities: currentVulns,
  };
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}

function _notifyForgeDepWatchBridge(notify, newVulnerabilities) {
  if (!(notify && newVulnerabilities.length > 0 && activeBridge)) return;
  activeBridge.dispatch?.({
    type: "dep-vulnerability",
    newVulnerabilities: newVulnerabilities.map((item) => ({ name: item.name, severity: item.severity })),
    count: newVulnerabilities.length,
  });
}

function _050_forge_dep_watch_errorResponse(message, isError = true) {
  return { content: [{ type: "text", text: JSON.stringify({ error: message, newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 0, snapshot: null }) }], isError };
}

function _050_forge_dep_watch_detectProject(cwd) {
  const pkgPath = resolve(cwd, "package.json");
  const hasPkgJson = existsSync(pkgPath);
  const csprojFiles = hasPkgJson ? [] : readdirSync(cwd).filter((file) => file.endsWith(".csproj") || file.endsWith(".sln") || file.endsWith(".slnx"));
  return { pkgPath, hasPkgJson, isDotnet: !hasPkgJson && csprojFiles.length > 0 };
}

function _050_forge_dep_watch_loadSnapshot(snapshotPath) {
  if (!existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch {
    return null;
  }
}

function _050_forge_dep_watch_pushDotnetPackageVulnerabilities(packages, currentVulns) {
  for (const pkg of (packages || [])) {
    if (!pkg.vulnerabilities?.length) continue;
    for (const vulnerability of pkg.vulnerabilities) {
      currentVulns.push({
        name: pkg.id,
        severity: (vulnerability.severity || "unknown").toLowerCase(),
        via: [vulnerability.advisoryurl || ""],
        range: `${pkg.resolvedVersion || ""}`,
      });
    }
  }
}

function _050_forge_dep_watch_parseDotnetJson(dotnetOutput) {
  const currentVulns = [];
  const parsed = JSON.parse(dotnetOutput);
  for (const project of (parsed.projects || [])) {
    for (const framework of (project.frameworks || [])) {
      _050_forge_dep_watch_pushDotnetPackageVulnerabilities(framework.topLevelPackages, currentVulns);
      _050_forge_dep_watch_pushDotnetPackageVulnerabilities(framework.transitivePackages, currentVulns);
    }
  }
  return currentVulns;
}

function _050_forge_dep_watch_parseDotnetText(dotnetOutput) {
  const currentVulns = [];
  for (const line of dotnetOutput.split("\n")) {
    const match = line.match(/>\s+(\S+)\s+(\S+)\s+(\S+)\s+(Low|Moderate|High|Critical)/i);
    if (match) {
      currentVulns.push({ name: match[1], severity: match[4].toLowerCase().replace("moderate", "medium"), via: [], range: match[2] });
    }
  }
  return currentVulns;
}

function _050_forge_dep_watch_readDotnetVulnerabilities(cwd) {
  let dotnetOutput;
  try {
    dotnetOutput = execSync("dotnet list package --vulnerable --format json 2>&1", { cwd, encoding: "utf-8", timeout: 120_000 });
  } catch (err) {
    dotnetOutput = err.stdout || err.stderr || err.message || "";
    if (!dotnetOutput) throw new Error(`dotnet list package --vulnerable failed: ${err.message}`);
  }
  try {
    return _050_forge_dep_watch_parseDotnetJson(dotnetOutput);
  } catch {
    return _050_forge_dep_watch_parseDotnetText(dotnetOutput);
  }
}

function _050_forge_dep_watch_readNpmVulnerabilities(cwd) {
  let auditResult;
  try {
    auditResult = JSON.parse(execSync("npm audit --json 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 }));
  } catch (err) {
    if (err.stdout) {
      try {
        auditResult = JSON.parse(err.stdout);
      } catch {
        auditResult = null;
      }
    }
    if (!auditResult) throw new Error(`npm audit failed: ${err.message}`);
  }
  return Object.entries(auditResult.vulnerabilities || {}).map(([pkgName, info]) => ({
    name: pkgName,
    severity: info.severity || "unknown",
    via: Array.isArray(info.via) ? info.via.filter((entry) => typeof entry === "string") : [],
    range: info.range || "",
  }));
}

function _050_forge_dep_watch_compareSnapshots(prevSnapshot, currentVulns) {
  const prevVulnNames = new Set((prevSnapshot?.vulnerabilities || []).map((vulnerability) => vulnerability.name));
  const currVulnNames = new Set(currentVulns.map((vulnerability) => vulnerability.name));
  const newVulnerabilities = currentVulns.filter((vulnerability) => !prevVulnNames.has(vulnerability.name));
  const resolvedVulnerabilities = (prevSnapshot?.vulnerabilities || []).filter((vulnerability) => !currVulnNames.has(vulnerability.name));
  return {
    newVulnerabilities,
    resolvedVulnerabilities,
    unchanged: currentVulns.length - newVulnerabilities.length,
  };
}

function _050_forge_dep_watch_saveSnapshot(cwd, snapshotPath, currentVulns) {
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  const snapshot = { capturedAt: new Date().toISOString(), depCount: currentVulns.length, vulnerabilities: currentVulns };
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}

function _050_forge_dep_watch_notify(active, newVulnerabilities) {
  if (!active || newVulnerabilities.length === 0 || !activeBridge) return;
  activeBridge.dispatch?.({ type: "dep-vulnerability", newVulnerabilities: newVulnerabilities.map((vulnerability) => ({ name: vulnerability.name, severity: vulnerability.severity })), count: newVulnerabilities.length });
}

function _th_050_unsupportedDependencyResponse() {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        error: "No package.json or .csproj/.sln/.slnx found — project type not supported",
        newVulnerabilities: [],
        resolvedVulnerabilities: [],
        unchanged: 0,
        snapshot: null,
      }),
    }],
    isError: false,
  };
}

function _th_050_detectDependencyProject(cwd) {
  const snapshotPath = resolve(cwd, ".forge", "deps-snapshot.json");
  const pkgPath = resolve(cwd, "package.json");
  const hasPkgJson = existsSync(pkgPath);
  const csprojFiles = hasPkgJson ? [] : readdirSync(cwd).filter((file) => file.endsWith(".csproj") || file.endsWith(".sln") || file.endsWith(".slnx"));
  return {
    snapshotPath,
    hasPkgJson,
    isDotnet: !hasPkgJson && csprojFiles.length > 0,
  };
}

function _th_050_loadPreviousSnapshot(snapshotPath) {
  if (!existsSync(snapshotPath)) return null;
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch {
    return null;
  }
}

function _th_050_collectDotnetVulnerabilities(cwd) {
  let dotnetOutput;
  try {
    dotnetOutput = execSync("dotnet list package --vulnerable --format json 2>&1", { cwd, encoding: "utf-8", timeout: 120_000 });
  } catch (err) {
    dotnetOutput = err.stdout || err.stderr || err.message || "";
    if (!dotnetOutput) throw new Error(`dotnet list package --vulnerable failed: ${err.message}`);
  }
  try {
    return _050_forge_dep_watch_parseDotnetJson(dotnetOutput);
  } catch {
    return _050_forge_dep_watch_parseDotnetText(dotnetOutput);
  }
}

function _th_050_collectNpmVulnerabilities(cwd) {
  let auditResult;
  try {
    auditResult = JSON.parse(execSync("npm audit --json 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 }));
  } catch (err) {
    if (err.stdout) {
      try {
        auditResult = JSON.parse(err.stdout);
      } catch {
        auditResult = null;
      }
    }
    if (!auditResult) {
      throw new Error(`npm audit failed: ${err.message}`);
    }
  }
  return Object.entries(auditResult.vulnerabilities || {}).map(([packageName, info]) => ({
    name: packageName,
    severity: info.severity || "unknown",
    via: Array.isArray(info.via) ? info.via.filter((entry) => typeof entry === "string") : [],
    range: info.range || "",
  }));
}

function _th_050_compareDependencySnapshots(prevSnapshot, currentVulns) {
  const prevVulnNames = new Set((prevSnapshot?.vulnerabilities || []).map((vulnerability) => vulnerability.name));
  const currVulnNames = new Set(currentVulns.map((vulnerability) => vulnerability.name));
  const newVulnerabilities = currentVulns.filter((vulnerability) => !prevVulnNames.has(vulnerability.name));
  const resolvedVulnerabilities = (prevSnapshot?.vulnerabilities || []).filter((vulnerability) => !currVulnNames.has(vulnerability.name));
  return {
    newVulnerabilities,
    resolvedVulnerabilities,
    unchanged: currentVulns.length - newVulnerabilities.length,
  };
}

function _th_050_writeDependencySnapshot(cwd, snapshotPath, currentVulns) {
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  const snapshot = {
    capturedAt: new Date().toISOString(),
    depCount: currentVulns.length,
    vulnerabilities: currentVulns,
  };
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
  return snapshot;
}

function _th_050_notifyDependencyBridge(notify, newVulnerabilities) {
  if (!(notify && newVulnerabilities.length > 0 && activeBridge)) return;
  activeBridge.dispatch?.({
    type: "dep-vulnerability",
    newVulnerabilities: newVulnerabilities.map((vulnerability) => ({ name: vulnerability.name, severity: vulnerability.severity })),
    count: newVulnerabilities.length,
  });
}

async function _callToolHandler_050_forge_dep_watch(request, args) {
  const { name } = request.params;
  if (!(name === "forge_dep_watch")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const notify = args.notify !== false;
      const project = _th_050_detectDependencyProject(cwd);
      if (!(project.hasPkgJson || project.isDotnet)) return _th_050_unsupportedDependencyResponse();

      const prevSnapshot = _th_050_loadPreviousSnapshot(project.snapshotPath);
      const currentVulns = project.isDotnet
        ? _th_050_collectDotnetVulnerabilities(cwd)
        : _th_050_collectNpmVulnerabilities(cwd);
      const comparison = _th_050_compareDependencySnapshots(prevSnapshot, currentVulns);
      const snapshot = _th_050_writeDependencySnapshot(cwd, project.snapshotPath, currentVulns);

      _th_050_notifyDependencyBridge(notify, comparison.newVulnerabilities);
      const result = {
        newVulnerabilities: comparison.newVulnerabilities,
        resolvedVulnerabilities: comparison.resolvedVulnerabilities,
        unchanged: comparison.unchanged,
        snapshot: { capturedAt: snapshot.capturedAt, depCount: snapshot.depCount },
      };
      emitToolTelemetry("forge_dep_watch", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_dep_watch", "OK", Date.now() - t0);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Dependency watch error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_051_forge_diff_classify(request, args) {
  const { name } = request.params;
  if (!(name === "forge_diff_classify")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      let diff = args.diff;
      if (!diff) {
        try {
          diff = execSync("git diff --cached", { cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe" });
        } catch {
          diff = "";
        }
      }
      const opts = {};
      if (args.maxLines) opts.maxLines = args.maxLines;
      const result = diffClassify(diff, opts);
      emitToolTelemetry("forge_diff_classify", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_diff_classify", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Diff classify error: ${err.message}` }], isError: true };
    }
  
}

function _forgeSecretScanEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const char of str) freq[char] = (freq[char] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function _getForgeSecretScanType(line) {
  const lowerLine = line.toLowerCase();
  if (/api.?key/i.test(lowerLine)) return "api_key";
  if (/secret/i.test(lowerLine)) return "secret";
  if (/token/i.test(lowerLine)) return "token";
  if (/password|passwd/i.test(lowerLine)) return "password";
  if (/auth/i.test(lowerLine)) return "auth";
  if (/private/i.test(lowerLine)) return "private_key";
  if (/credential/i.test(lowerLine)) return "credential";
  return "unknown";
}

function _getForgeSecretScanDiff(cwd, since) {
  try {
    return { diffOutput: execSync(`git diff ${since}`, { cwd, encoding: "utf-8", timeout: 30_000 }) };
  } catch (err) {
    if (err.status === 128 || (err.message && err.message.includes("not a git repository"))) {
      return {
        graceful: {
          clean: null,
          scannedFiles: 0,
          findings: [],
          error: "git unavailable",
        },
      };
    }
    throw err;
  }
}

function _parseForgeSecretScanFindings(diffOutput, threshold) {
  const KEY_PATTERNS = /(?:key|secret|token|password|api_key|auth|credential|private)/i;
  const findings = [];
  const scannedFiles = new Set();
  let currentFile = null;
  let lineNumber = 0;

  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      scannedFiles.add(currentFile);
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNumber = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      const added = line.slice(1);
      const tokens = added.match(/["']([^"']{8,})["']|(?:=|:|=>)\s*["']?([^\s"',;]{8,})["']?/g) || [];
      for (const raw of tokens) {
        const cleaned = raw.replace(/^[=:>]\s*["']?|["']$/g, "").replace(/^["']/, "");
        if (cleaned.length < 8) continue;
        const entropy = _forgeSecretScanEntropy(cleaned);
        if (entropy < threshold) continue;
        const keyMatch = KEY_PATTERNS.test(added);
        const confidence = entropy >= 4.5 && keyMatch ? "high"
          : ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) ? "medium"
            : "low";
        findings.push({
          file: currentFile,
          line: lineNumber,
          type: _getForgeSecretScanType(added),
          entropyScore: Math.round(entropy * 100) / 100,
          masked: "<REDACTED>",
          confidence,
        });
      }
      continue;
    }
    if (!line.startsWith("-")) lineNumber++;
  }

  return { findings, scannedFiles };
}

function _buildForgeSecretScanResult(findings, scannedFiles, since, threshold) {
  return {
    scannedAt: new Date().toISOString(),
    since,
    threshold,
    scannedFiles: scannedFiles.size,
    clean: findings.length === 0,
    findings,
  };
}

function _writeForgeSecretScanCache(cwd, result) {
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  writeFileSync(resolve(cwd, ".forge", "secret-scan-cache.json"), JSON.stringify(result, null, 2), "utf-8");
}

function _annotateForgeSecretScanDeploySidecar(cwd, clean, scannedAt) {
  try {
    const journalPath = resolve(cwd, ".forge", "deploy-journal.jsonl");
    if (!existsSync(journalPath)) return;
    const deploys = readForgeJsonl("deploy-journal.jsonl", [], cwd);
    if (deploys.length === 0) return;
    const lastDeploy = deploys[deploys.length - 1];
    let headSha = null;
    try {
      headSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
    } catch { /* skip */ }
    if (!(headSha && lastDeploy.id)) return;
    const sidecarPath = resolve(cwd, ".forge", "deploy-journal-meta.json");
    let sidecar = {};
    try {
      if (existsSync(sidecarPath)) sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    } catch {
      sidecar = {};
    }
    sidecar[lastDeploy.id] = {
      ...(sidecar[lastDeploy.id] || {}),
      secretScanClean: clean,
      secretScanAt: scannedAt,
    };
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
  } catch { /* best-effort sidecar annotation */ }
}

function _captureForgeSecretScanMemory(result, cwd) {
  if (result.clean) return;
  captureMemory(
    `Secret scan: ${result.findings.length} high-entropy finding(s) in ${result.scannedFiles} file(s). Review and rotate if confirmed.`,
    "gotcha",
    "forge_secret_scan",
    cwd
  );
}

function _052_forge_secret_scan_entropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const char of str) freq[char] = (freq[char] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function _052_forge_secret_scan_extractTokens(addedLine) {
  return addedLine.match(/["']([^"']{8,})["']|(?:=|:|=>)\s*["']?([^\s"',;]{8,})["']?/g) || [];
}

function _052_forge_secret_scan_getConfidence(entropy, keyMatch) {
  if (entropy >= 4.5 && keyMatch) return "high";
  if ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) return "medium";
  return "low";
}

function _052_forge_secret_scan_getType(addedLine) {
  const lowerLine = addedLine.toLowerCase();
  if (/api.?key/i.test(lowerLine)) return "api_key";
  if (/secret/i.test(lowerLine)) return "secret";
  if (/token/i.test(lowerLine)) return "token";
  if (/password|passwd/i.test(lowerLine)) return "password";
  if (/auth/i.test(lowerLine)) return "auth";
  if (/private/i.test(lowerLine)) return "private_key";
  if (/credential/i.test(lowerLine)) return "credential";
  return "unknown";
}

function _052_forge_secret_scan_readDiff(cwd, since, args, t0) {
  try {
    return { diffOutput: execSync(`git diff ${since}`, { cwd, encoding: "utf-8", timeout: 30_000 }) };
  } catch (err) {
    if (err.status === 128 || (err.message && err.message.includes("not a git repository"))) {
      const graceful = { clean: null, scannedFiles: 0, findings: [], error: "git unavailable" };
      emitToolTelemetry("forge_secret_scan", args, graceful, Date.now() - t0, "DEGRADED", cwd);
      return { gracefulResponse: { content: [{ type: "text", text: JSON.stringify(graceful, null, 2) }], isError: false } };
    }
    throw err;
  }
}

function _052_forge_secret_scan_parseDiff(diffOutput, threshold) {
  const KEY_PATTERNS = /(?:key|secret|token|password|api_key|auth|credential|private)/i;
  const findings = [];
  const scannedFiles = new Set();
  let currentFile = null;
  let lineNumber = 0;
  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      scannedFiles.add(currentFile);
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNumber = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      const added = line.slice(1);
      for (const raw of _052_forge_secret_scan_extractTokens(added)) {
        const cleaned = raw.replace(/^[=:>]\s*["']?|["']$/g, "").replace(/^["']/, "");
        if (cleaned.length < 8) continue;
        const entropy = _052_forge_secret_scan_entropy(cleaned);
        if (entropy < threshold) continue;
        findings.push({
          file: currentFile,
          line: lineNumber,
          type: _052_forge_secret_scan_getType(added),
          entropyScore: Math.round(entropy * 100) / 100,
          masked: "<REDACTED>",
          confidence: _052_forge_secret_scan_getConfidence(entropy, KEY_PATTERNS.test(added)),
        });
      }
      continue;
    }
    if (!line.startsWith("-")) lineNumber++;
  }
  return { findings, scannedFiles };
}

function _052_forge_secret_scan_annotateDeployJournal(cwd, clean, scannedAt) {
  try {
    const journalPath = resolve(cwd, ".forge", "deploy-journal.jsonl");
    if (!existsSync(journalPath)) return;
    const deploys = readForgeJsonl("deploy-journal.jsonl", [], cwd);
    if (deploys.length === 0) return;
    const lastDeploy = deploys[deploys.length - 1];
    let headSha = null;
    try {
      headSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
    } catch { /* skip */ }
    if (!headSha || !lastDeploy.id) return;
    const sidecarPath = resolve(cwd, ".forge", "deploy-journal-meta.json");
    let sidecar = {};
    try {
      if (existsSync(sidecarPath)) sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    } catch {
      sidecar = {};
    }
    sidecar[lastDeploy.id] = {
      ...(sidecar[lastDeploy.id] || {}),
      secretScanClean: clean,
      secretScanAt: scannedAt,
    };
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
  } catch { /* best-effort sidecar annotation */ }
}

function _052_forge_secret_scan_capture(clean, findings, scannedFiles, cwd) {
  if (clean) return;
  captureMemory(
    `Secret scan: ${findings.length} high-entropy finding(s) in ${scannedFiles.size} file(s). Review and rotate if confirmed.`,
    "gotcha", "forge_secret_scan", cwd
  );
}

function _th_052_shannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const char of str) freq[char] = (freq[char] || 0) + 1;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function _th_052_readSecretDiff(cwd, since) {
  try {
    return { diffOutput: execSync(`git diff ${since}`, { cwd, encoding: "utf-8", timeout: 30_000 }) };
  } catch (err) {
    if (err.status === 128 || (err.message && err.message.includes("not a git repository"))) {
      return { graceful: { clean: null, scannedFiles: 0, findings: [], error: "git unavailable" } };
    }
    throw err;
  }
}

function _th_052_inferConfidence(entropy, keyMatch) {
  if (entropy >= 4.5 && keyMatch) return "high";
  if ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) return "medium";
  return "low";
}

function _th_052_inferSecretType(lowerLine) {
  if (/api.?key/i.test(lowerLine)) return "api_key";
  if (/secret/i.test(lowerLine)) return "secret";
  if (/token/i.test(lowerLine)) return "token";
  if (/password|passwd/i.test(lowerLine)) return "password";
  if (/auth/i.test(lowerLine)) return "auth";
  if (/private/i.test(lowerLine)) return "private_key";
  if (/credential/i.test(lowerLine)) return "credential";
  return "unknown";
}

function _th_052_parseSecretFindings(diffOutput, threshold) {
  const findings = [];
  const scannedFiles = new Set();
  const keyPatterns = /(?:key|secret|token|password|api_key|auth|credential|private)/i;
  let currentFile = null;
  let lineNumber = 0;

  for (const line of diffOutput.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      scannedFiles.add(currentFile);
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNumber = match ? parseInt(match[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      const added = line.slice(1);
      const tokens = added.match(/["']([^"']{8,})["']|(?:=|:|=>)\s*["']?([^\s"',;]{8,})["']?/g) || [];
      for (const raw of tokens) {
        const cleaned = raw.replace(/^[=:>]\s*["']?|["']$/g, "").replace(/^["']/, "");
        if (cleaned.length < 8) continue;
        const entropy = _th_052_shannonEntropy(cleaned);
        if (entropy < threshold) continue;
        findings.push({
          file: currentFile,
          line: lineNumber,
          type: _th_052_inferSecretType(added.toLowerCase()),
          entropyScore: Math.round(entropy * 100) / 100,
          masked: "<REDACTED>",
          confidence: _th_052_inferConfidence(entropy, keyPatterns.test(added)),
        });
      }
      continue;
    }
    if (!line.startsWith("-")) lineNumber++;
  }

  return { findings, scannedFiles };
}

function _th_052_annotateDeployJournal(cwd, clean, scannedAt) {
  try {
    const journalPath = resolve(cwd, ".forge", "deploy-journal.jsonl");
    if (!existsSync(journalPath)) return;
    const deploys = readForgeJsonl("deploy-journal.jsonl", [], cwd);
    if (deploys.length === 0) return;
    const lastDeploy = deploys[deploys.length - 1];
    let headSha = null;
    try {
      headSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
    } catch { /* skip */ }
    if (!(headSha && lastDeploy.id)) return;
    const sidecarPath = resolve(cwd, ".forge", "deploy-journal-meta.json");
    let sidecar = {};
    try {
      if (existsSync(sidecarPath)) sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    } catch {
      sidecar = {};
    }
    sidecar[lastDeploy.id] = {
      ...(sidecar[lastDeploy.id] || {}),
      secretScanClean: clean,
      secretScanAt: scannedAt,
    };
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
  } catch { /* best-effort sidecar annotation */ }
}

async function _callToolHandler_052_forge_secret_scan(request, args) {
  const { name } = request.params;
  if (!(name === "forge_secret_scan")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const since = args.since || "HEAD~1";
      const threshold = Math.max(3.5, Math.min(5.0, args.threshold ?? 4.0));
      const diffResult = _th_052_readSecretDiff(cwd, since);
      if (diffResult.graceful) {
        emitToolTelemetry("forge_secret_scan", args, diffResult.graceful, Date.now() - t0, "DEGRADED", cwd);
        return { content: [{ type: "text", text: JSON.stringify(diffResult.graceful, null, 2) }], isError: false };
      }

      const { findings, scannedFiles } = _th_052_parseSecretFindings(diffResult.diffOutput, threshold);
      const result = {
        scannedAt: new Date().toISOString(),
        since,
        threshold,
        scannedFiles: scannedFiles.size,
        clean: findings.length === 0,
        findings,
      };

      mkdirSync(resolve(cwd, ".forge"), { recursive: true });
      writeFileSync(resolve(cwd, ".forge", "secret-scan-cache.json"), JSON.stringify(result, null, 2), "utf-8");
      _th_052_annotateDeployJournal(cwd, result.clean, result.scannedAt);

      emitToolTelemetry("forge_secret_scan", args, {
        clean: result.clean,
        findings: findings.length,
        scannedFiles: scannedFiles.size,
      }, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_secret_scan", "OK", Date.now() - t0);

      if (!result.clean) {
        captureMemory(
          `Secret scan: ${findings.length} high-entropy finding(s) in ${scannedFiles.size} file(s). Review and rotate if confirmed.`,
          "gotcha", "forge_secret_scan", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Secret scan error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_053_forge_env_diff(request, args) {
  const { name } = request.params;
  if (!(name === "forge_env_diff")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const baselinePath = resolve(cwd, args.baseline || ".env");

      // Stop condition: baseline not found → return error object, no throw
      if (!existsSync(baselinePath)) {
        const graceful = { pairs: [], summary: { clean: null, error: `baseline file not found: ${args.baseline || ".env"}` } };
        emitToolTelemetry("forge_env_diff", args, graceful, Date.now() - t0, "DEGRADED", cwd);
        return { content: [{ type: "text", text: JSON.stringify(graceful, null, 2) }], isError: false };
      }

      // Parse .env keys (key names only — never values)
      function parseEnvKeys(filePath) {
        const content = readFileSync(filePath, "utf-8");
        const keys = new Set();
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) keys.add(trimmed.slice(0, eqIdx).trim());
        }
        return keys;
      }

      const baselineKeys = parseEnvKeys(baselinePath);

      // Resolve target files
      let targetFiles = [];
      if (args.files) {
        targetFiles = args.files.split(",").map(f => f.trim()).filter(Boolean);
      } else {
        // Auto-detect .env.* files in project root
        try {
          const entries = readdirSync(cwd);
          targetFiles = entries.filter(f => f.startsWith(".env.") && !f.endsWith(".example")).sort();
        } catch { targetFiles = []; }
      }

      const pairs = [];
      for (const targetFile of targetFiles) {
        const targetPath = resolve(cwd, targetFile);
        if (!existsSync(targetPath)) {
          pairs.push({ file: targetFile, missingInTarget: [], missingInBaseline: [], error: `file not found: ${targetFile}` });
          continue;
        }
        const targetKeys = parseEnvKeys(targetPath);
        const missingInTarget = [...baselineKeys].filter(k => !targetKeys.has(k)).sort();
        const missingInBaseline = [...targetKeys].filter(k => !baselineKeys.has(k)).sort();
        pairs.push({ file: targetFile, missingInTarget, missingInBaseline });
      }

      const totalGaps = pairs.reduce((sum, p) => sum + (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0), 0);
      const clean = totalGaps === 0;

      const result = {
        scannedAt: new Date().toISOString(),
        baseline: args.baseline || ".env",
        filesCompared: targetFiles.length,
        pairs,
        summary: { clean, totalGaps, baselineKeyCount: baselineKeys.size },
      };

      // Write cache (key names only, never values)
      mkdirSync(resolve(cwd, ".forge"), { recursive: true });
      writeFileSync(resolve(cwd, ".forge", "env-diff-cache.json"), JSON.stringify(result, null, 2), "utf-8");

      // G2.7 (v2.36): also append a compact history record so trend analysis
      // and the dashboard can see env-drift over time without re-reading the
      // single-snapshot cache. Keys only — values are never recorded.
      try {
        appendForgeJsonl("env-diff-history.jsonl", {
          scannedAt: result.scannedAt,
          baseline: result.baseline,
          filesCompared: result.filesCompared,
          totalGaps,
          clean,
          baselineKeyCount: baselineKeys.size,
          pairs: pairs.map((p) => ({
            file: p.file,
            missingInTargetCount: p.missingInTarget?.length || 0,
            missingInBaselineCount: p.missingInBaseline?.length || 0,
          })),
        }, cwd);
      } catch { /* best-effort history */ }

      emitToolTelemetry("forge_env_diff", args, { clean, totalGaps, filesCompared: targetFiles.length }, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_env_diff", "OK", Date.now() - t0);

      // Auto-capture env gaps
      if (totalGaps > 0) {
        captureMemory(
          `Env diff: ${totalGaps} missing key(s) across ${targetFiles.length} env file(s). Ensure all environments have required keys.`,
          "gotcha", "forge_env_diff", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Env diff error: ${err.message}` }], isError: true };
    }
  
}

function _th_054_response(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { content: [{ type: "text", text }], isError };
}

function _th_054_planlessResponse(message) {
  return _th_054_response({ error: message, planFile: null }, false);
}

function _th_054_tryIncidentSource(source, incidentId, cwd) {
  if (!(source === "incident" || (source === "auto" && incidentId))) return { sourceData: null, fixId: "" };
  if (!incidentId) return { response: _th_054_response("incidentId required for incident source", true) };
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  if (!incidents.length) return { response: _th_054_planlessResponse("no incident data — run pforge incident first") };
  const incident = incidents.find((entry) => entry.id === incidentId || entry.incidentId === incidentId);
  if (!incident) return { response: _th_054_response(`Incident not found: ${incidentId}`, true) };
  return { sourceData: { type: "incident", incident }, fixId: incidentId };
}

function _th_054_tryRegressionSource(source, cwd) {
  if (source !== "regression") return { sourceData: null, fixId: "" };
  const regPath = resolve(cwd, ".forge", "regression-gates.json");
  if (!existsSync(regPath)) return { response: _th_054_planlessResponse("no regression data — run pforge regression-guard first") };
  try {
    const regData = JSON.parse(readFileSync(regPath, "utf-8"));
    if (!regData || (Array.isArray(regData) && regData.length === 0)) {
      return { response: _th_054_planlessResponse("no regression data — run pforge regression-guard first") };
    }
    return { sourceData: { type: "regression", regression: regData }, fixId: `regression-${Date.now()}` };
  } catch {
    return { response: _th_054_planlessResponse("no regression data — run pforge regression-guard first") };
  }
}

function _th_054_tryDriftSource(source, cwd) {
  if (!(source === "drift" || source === "auto")) return { sourceData: null, fixId: "" };
  const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
  if (!driftHistory.length) {
    return source === "drift"
      ? { response: _th_054_planlessResponse("no drift data — run pforge drift first") }
      : { sourceData: null, fixId: "" };
  }
  const latest = driftHistory[driftHistory.length - 1];
  return { sourceData: { type: "drift", drift: latest }, fixId: `drift-${Date.now()}` };
}

function _th_054_trySecretSource(source, cwd) {
  if (!(source === "secret" || source === "auto")) return { sourceData: null, fixId: "" };
  const scanPath = resolve(cwd, ".forge", "secret-scan-cache.json");
  if (!existsSync(scanPath)) {
    return source === "secret"
      ? { response: _th_054_planlessResponse("no secret scan data — run pforge secret-scan first") }
      : { sourceData: null, fixId: "" };
  }
  try {
    const scan = JSON.parse(readFileSync(scanPath, "utf-8"));
    return { sourceData: { type: "secret", scan }, fixId: `secret-${Date.now()}` };
  } catch {
    return source === "secret"
      ? { response: _th_054_planlessResponse("no secret scan data — run pforge secret-scan first") }
      : { sourceData: null, fixId: "" };
  }
}

function _th_054_tryExplicitCrucibleTarget(cwd, smeltIdArg) {
  if (!smeltIdArg) return { target: null, targetKind: null };
  const smeltPath = resolve(cwd, ".forge", "crucible", `${smeltIdArg}.json`);
  if (!existsSync(smeltPath)) return { error: `smelt ${smeltIdArg} not found in .forge/crucible/` };
  try {
    const smelt = JSON.parse(readFileSync(smeltPath, "utf-8"));
    return { targetKind: "explicit", target: { id: smeltIdArg, smelt } };
  } catch {
    return { error: `smelt ${smeltIdArg} is unreadable` };
  }
}

// Phase CRUCIBLE-04 — Crucible-aware fix proposals.
function _th_054_findStalledCrucibleTarget(cwd, crucible) {
  if (crucible.staleInProgress <= 0) return null;
  const crucibleDir = resolve(cwd, ".forge", "crucible");
  const cutoffMs = Date.now() - crucible.stallCutoffDays * 24 * 60 * 60 * 1000;
  let oldest = null;
  try {
    for (const entry of readdirSync(crucibleDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (entry.name === "config.json" || entry.name === "phase-claims.json") continue;
      const full = resolve(crucibleDir, entry.name);
      let smelt;
      try {
        smelt = JSON.parse(readFileSync(full, "utf-8"));
      } catch {
        continue;
      }
      if (smelt.status !== "in_progress") continue;
      const mtime = statSync(full).mtimeMs;
      if (mtime >= cutoffMs) continue;
      if (!oldest || mtime < oldest.mtime) oldest = { id: basename(entry.name, ".json"), smelt, mtime };
    }
  } catch { /* unreadable dir — fall through */ }
  return oldest ? { targetKind: "stalled", target: { id: oldest.id, smelt: oldest.smelt } } : null;
}

function _th_054_tryCrucibleSource(source, args, cwd) {
  if (!(source === "crucible" || source === "auto")) return { sourceData: null, fixId: "" };
  const crucible = readCrucibleState(cwd);
  if (!crucible) {
    return source === "crucible"
      ? { response: _th_054_planlessResponse("no Crucible data — .forge/crucible/ does not exist") }
      : { sourceData: null, fixId: "" };
  }

  const explicit = _th_054_tryExplicitCrucibleTarget(cwd, args.smeltId || null);
  if (explicit.error) {
    return source === "crucible"
      ? { response: _th_054_planlessResponse(explicit.error) }
      : { sourceData: null, fixId: "" };
  }

  const stalled = explicit.target ? explicit : _th_054_findStalledCrucibleTarget(cwd, crucible);
  const orphan = stalled?.target ? stalled : (crucible.orphanHandoffs.length > 0
    ? { targetKind: "orphan", target: { id: crucible.orphanHandoffs[0].crucibleId || `orphan-${Date.now()}`, orphan: crucible.orphanHandoffs[0] } }
    : null);

  if (!orphan?.target) {
    return source === "crucible"
      ? { response: _th_054_response({ error: "Crucible funnel is healthy — no stalled or orphan smelts to fix", planFile: null, counts: crucible.counts }, false) }
      : { sourceData: null, fixId: "" };
  }

  return {
    sourceData: { type: "crucible", kind: orphan.targetKind, target: orphan.target, cutoffDays: crucible.stallCutoffDays },
    fixId: `crucible-${orphan.target.id}`,
  };
}

function _th_054_tryTemperingBugSource(source, args, cwd) {
  if (!(source === "tempering-bug" || source === "auto")) return { sourceData: null, fixId: "" };
  const bugId = args.bugId || null;
  if (source === "tempering-bug" && !bugId) {
    return {
      response: _th_054_response({
        error: ERROR_CODES.MISSING_BUG_ID.code,
        message: "bugId is required when source is tempering-bug",
      }, true),
    };
  }
  if (bugId) {
    const bug = loadBug(cwd, bugId);
    if (!bug) {
      return source === "tempering-bug"
        ? { response: _th_054_response({ error: ERROR_CODES.BUG_NOT_FOUND.code, bugId }, true) }
        : { sourceData: null, fixId: "" };
    }
    if (bug.status === "fixed" || bug.status === "wont-fix" || bug.status === "duplicate") {
      return source === "tempering-bug"
        ? { response: _th_054_response({ error: ERROR_CODES.BUG_TERMINAL_STATUS.code, bugId, currentStatus: bug.status }, true) }
        : { sourceData: null, fixId: "" };
    }
    return { sourceData: { type: "tempering-bug", bug }, fixId: `tempering-bug-${bugId}` };
  }

  const openBugs = listBugs(cwd, { status: "open" }).filter((bug) => bug.classification === "real-bug" && !bug.linkedFixPlan);
  if (openBugs.length === 0) return { sourceData: null, fixId: "" };
  return { sourceData: { type: "tempering-bug", bug: openBugs[0] }, fixId: `tempering-bug-${openBugs[0].bugId}` };
}

function _th_054_resolveSourceData(args, cwd) {
  const source = args.source || "auto";
  const sourceResolvers = [
    () => _th_054_tryIncidentSource(source, args.incidentId || null, cwd),
    () => _th_054_tryRegressionSource(source, cwd),
    () => _th_054_tryDriftSource(source, cwd),
    () => _th_054_trySecretSource(source, cwd),
    () => _th_054_tryCrucibleSource(source, args, cwd),
    () => _th_054_tryTemperingBugSource(source, args, cwd),
  ];

  for (const resolveSource of sourceResolvers) {
    const resolved = resolveSource();
    if (resolved.response || resolved.fixId) return resolved;
  }
  return {
    response: _th_054_planlessResponse(
      "no LiveGuard data found — run drift, incident-capture, regression-guard, secret-scan, start a Crucible smelt, or register a tempering bug first"
    ),
  };
}

function _th_054_collectIncidentCodeSnippets(cwd, incident, affectedFiles) {
  const codeSnippets = [];
  for (const file of affectedFiles) {
    try {
      const filePath = resolve(cwd, file);
      if (!existsSync(filePath)) continue;
      const lines = readFileSync(filePath, "utf-8").split("\n");
      const violationLines = (incident.violations || []).filter((violation) => violation.file === file).map((violation) => violation.line);
      if (violationLines.length === 0) {
        const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
        if (driftHistory.length) {
          const latest = driftHistory[driftHistory.length - 1];
          for (const violation of (latest.violations || [])) {
            if (violation.file === file) violationLines.push(violation.line);
          }
        }
      }
      for (const lineNum of violationLines.slice(0, 3)) {
        const start = Math.max(0, lineNum - 6);
        const end = Math.min(lines.length, lineNum + 5);
        const snippet = lines.slice(start, end).map((line, index) => {
          const num = start + index + 1;
          const marker = num === lineNum ? " >>>" : "    ";
          return `${marker} ${String(num).padStart(4)}| ${line}`;
        }).join("\n");
        codeSnippets.push({ file, line: lineNum, snippet });
      }
    } catch { /* file read error — skip snippet */ }
  }
  return codeSnippets;
}

function _th_054_resolveIncidentGate(cwd, affectedFiles) {
  let gateCmd = null;
  const hasCsproj = existsSync(resolve(cwd, "*.csproj")) || readdirSync(cwd).some((file) => file.endsWith(".csproj") || file.endsWith(".sln"));
  const hasPkgJson = existsSync(resolve(cwd, "package.json"));
  if (hasCsproj) {
    gateCmd = "dotnet test";
    if (affectedFiles.length > 0) {
      const testFilters = affectedFiles
        .map((file) => basename(file, extname(file)).replace(/\.(cs|fs|vb)$/, ""))
        .filter((name) => name.length > 0);
      if (testFilters.length > 0) {
        gateCmd = `dotnet test --filter "${testFilters.map((name) => `FullyQualifiedName~${name}`).join("|")}"`;
      }
    }
    return gateCmd;
  }
  if (hasPkgJson) return "npm test";
  return "pforge regression-guard";
}

function _th_054_buildIncidentSlices(sourceData, fixId, cwd) {
  const incident = sourceData.incident;
  const affectedFiles = incident.files || incident.affectedFiles || [];
  const description = incident.description || incident.title || fixId;
  const severity = incident.severity || "medium";
  const investTasks = [`Review incident: ${description}`];
  if (affectedFiles.length > 0) investTasks.push(`Inspect affected file(s): ${affectedFiles.join(", ")}`);
  investTasks.push("Identify root cause — check for: empty catch blocks, inverted logic, missing validation, null references");
  investTasks.push("Document the exact code location and failure mechanism");
  const codeSnippets = _th_054_collectIncidentCodeSnippets(cwd, incident, affectedFiles);

  return [
    {
      title: `Investigate: ${description}`,
      tasks: investTasks,
      scope: affectedFiles,
      codeSnippets,
    },
    {
      title: `Apply Fix + Verify (${severity})`,
      tasks: [
        "Implement the fix in the identified file(s)",
        ...(affectedFiles.length > 0 ? ["Add or update unit tests covering the fix in affected file(s)"] : []),
        "Run regression guard to verify no side effects",
        "Verify incident resolution by reproducing the original failure scenario",
      ],
      scope: affectedFiles,
      gate: _th_054_resolveIncidentGate(cwd, affectedFiles),
    },
  ];
}

function _th_054_buildCrucibleSlices(sourceData) {
  const kind = sourceData.kind;
  const cutoff = sourceData.cutoffDays || 7;
  const smeltId = sourceData.target.id;
  const smeltPathRel = `.forge/crucible/${smeltId}.json`;
  if (kind === "orphan") {
    const orphan = sourceData.target.orphan;
    const planPath = orphan?.planPath || "(unknown)";
    const phaseName = orphan?.phaseName || "(unnamed phase)";
    return [
      {
        title: `Triage orphan handoff: ${phaseName}`,
        tasks: [
          `Inspect hub-events.jsonl entry for smelt ${smeltId}`,
          `Check whether the hardener plan file ever existed: ${planPath}`,
          `Decide: (a) re-generate the plan from the smelt journal, OR (b) record the handoff as abandoned and move on`,
          "Document the decision rationale in the smelt's `notes` field",
        ],
        scope: [smeltPathRel, ".forge/hub-events.jsonl"],
      },
      {
        title: "Resolve orphan: regenerate or archive",
        tasks: [
          `If regenerating: run the hardener workflow against smelt ${smeltId} to produce ${planPath}`,
          `If archiving: set smelt status to "abandoned" with reason "orphan handoff — plan unrecoverable"`,
          "Verify: re-run forge_watch or pforge smith — orphan count should drop to 0",
        ],
        scope: [smeltPathRel, planPath],
        gate: "pforge smith",
      },
    ];
  }

  const phaseName = sourceData.target.smelt?.phaseName || sourceData.target.smelt?.title || "(untitled smelt)";
  const status = sourceData.target.smelt?.status || "unknown";
  return [
    {
      title: `Triage stalled smelt: ${phaseName}`,
      tasks: [
        `Read the smelt journal at ${smeltPathRel} (current status: ${status})`,
        `Check mtime — flagged stalled when idle ≥ ${cutoff} days`,
        "Review the smelt's last recorded action and any open questions",
        "Decide: (a) RESUME if the work is still relevant, OR (b) ABANDON if superseded / no longer needed",
        "Document the decision rationale in the smelt's `notes` field",
      ],
      scope: [smeltPathRel],
    },
    {
      title: "Execute decision: resume or abandon",
      tasks: [
        `If RESUMING: touch the smelt journal, set a concrete "nextAction" field, resume normal Crucible workflow`,
        `If ABANDONING: set smelt status to "abandoned" with reason and supersededBy (if applicable)`,
        "Verify: re-run forge_watch or pforge smith — staleInProgress should drop by at least 1",
      ],
      scope: [smeltPathRel],
      gate: "pforge smith",
    },
  ];
}

function _th_054_resolveTemperingBugAffectedFiles(bug) {
  if (bug.affectedFiles?.length) return bug.affectedFiles;
  if (!bug.evidence?.stackTrace) return [];
  return [...bug.evidence.stackTrace.matchAll(/(?:at\s+\S+\s+\(?|\/)([\w./-]+\.[a-z]{1,5})/gi)]
    .map((match) => match[1])
    .filter((file) => !file.includes("node_modules"))
    .slice(0, 5);
}

function _th_054_buildTemperingBugTriageSlice(bug, bugId, severity, affectedFiles) {
  return {
    title: `Triage: ${bug.evidence?.testName || bug.evidence?.assertionMessage?.slice(0, 50) || bugId}`,
    tasks: [
      `Review bug ${bugId} (${bug.scanner} scanner, ${severity} severity)`,
      bug.evidence?.assertionMessage ? `Assertion: ${bug.evidence.assertionMessage.slice(0, 200)}` : "Investigate the failure evidence",
      bug.evidence?.stackTrace ? `Stack trace starts at: ${bug.evidence.stackTrace.split("\\n")[0]?.slice(0, 120)}` : "Reproduce the failure",
      `Classification: ${bug.classification || "unknown"}`,
      ...(bug.reproSteps?.length ? [`Repro steps: ${bug.reproSteps.join(" → ")}`] : []),
      "Identify root cause and document the fix approach",
    ],
    scope: affectedFiles.length > 0 ? affectedFiles : [".forge/bugs/"],
  };
}

function _th_054_buildTemperingBugApplySlice(bugId, affectedFiles) {
  return {
    title: `Apply fix for ${bugId}`,
    tasks: [
      "Implement the fix in the identified file(s)",
      ...(affectedFiles.length > 0 ? [`Affected files: ${affectedFiles.join(", ")}`] : []),
      "Add or update tests covering the fixed behavior",
      `Validate: run forge_bug_validate_fix --bugId ${bugId}`,
    ],
    scope: affectedFiles,
    gate: `forge_bug_validate_fix --bugId ${bugId}`,
  };
}

function _th_054_buildTemperingBugRegressionSlice(severity) {
  if (!(severity === "critical" || severity === "high")) return null;
  return {
    title: `Regression guard (${severity} severity)`,
    tasks: [
      "Run full regression guard to verify no side effects",
      "Verify no new tempering findings introduced",
    ],
    gate: "forge_regression_guard",
  };
}

async function _th_054_linkTemperingBugPlan(cwd, bugId) {
  const relPlanPath = `docs/plans/auto/LIVEGUARD-FIX-tempering-bug-${bugId}.md`;
  await updateBugStatus(cwd, bugId, "in-fix", { note: `Linked fix plan: ${relPlanPath}` });
  setLinkedFixPlan(cwd, bugId, relPlanPath);
}

async function _th_054_buildTemperingBugSlices(sourceData, cwd) {
  const bug = sourceData.bug;
  const bugId = bug.bugId;
  const severity = bug.severity || "medium";
  const affectedFiles = _th_054_resolveTemperingBugAffectedFiles(bug);
  const slices = [
    _th_054_buildTemperingBugTriageSlice(bug, bugId, severity, affectedFiles),
    _th_054_buildTemperingBugApplySlice(bugId, affectedFiles),
  ];
  const regressionSlice = _th_054_buildTemperingBugRegressionSlice(severity);
  if (regressionSlice) slices.push(regressionSlice);
  await _th_054_linkTemperingBugPlan(cwd, bugId);
  return slices;
}

async function _th_054_buildSlices(sourceData, fixId, cwd, source) {
  if (sourceData.type === "incident") return _th_054_buildIncidentSlices(sourceData, fixId, cwd);
  if (sourceData.type === "drift") {
    return [{
      title: `Resolve Drift Violations (score: ${sourceData.drift?.score || "unknown"})`,
      tasks: ["Review drift violations", "Fix architectural deviations", "Re-run drift report to verify score improvement"],
      gate: "pforge drift",
    }];
  }
  if (sourceData.type === "secret") {
    return [{
      title: "Credential Rotation",
      tasks: ["Rotate any exposed credentials", "Update secret references to use environment variables or secret manager", "Remove hardcoded values from source"],
      gate: "pforge secret-scan --since HEAD~1",
    }];
  }
  if (sourceData.type === "crucible") return _th_054_buildCrucibleSlices(sourceData);
  if (sourceData.type === "tempering-bug") return _th_054_buildTemperingBugSlices(sourceData, cwd);
  return [{ title: `Fix: ${source}`, tasks: ["Investigate the issue", "Apply fix", "Validate"], gate: "pforge regression-guard" }];
}

function _th_054_renderPlanContent(fixId, sourceData, slices) {
  let planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n`;
  planContent += `> Generated: ${new Date().toISOString()}\n`;
  planContent += `> Source: ${sourceData.type}\n\n`;
  planContent += "## Scope Contract\n\n";
  planContent += `This plan addresses a ${sourceData.type} finding detected by LiveGuard.\n\n`;
  for (let index = 0; index < slices.length; index++) {
    const slice = slices[index];
    planContent += `## Slice ${index + 1} — ${slice.title}\n\n`;
    planContent += "**Tasks:**\n";
    for (const task of slice.tasks) planContent += `- [ ] ${task}\n`;
    if (slice.codeSnippets && slice.codeSnippets.length > 0) {
      planContent += "\n**Code Context:**\n";
      for (const snippet of slice.codeSnippets) {
        planContent += `\n\`${snippet.file}\` line ${snippet.line}:\n\`\`\`\n${snippet.snippet}\n\`\`\`\n`;
      }
    }
    if (slice.scope && slice.scope.length > 0) planContent += `\n**Scope:** ${slice.scope.join(", ")}\n`;
    if (slice.gate) planContent += `\n**Validation Gate:**\n\`\`\`bash\n${slice.gate}\n\`\`\`\n`;
    planContent += "\n";
  }
  return planContent;
}

function _th_054_maybeQueueReview(cwd, slices, fixId, planName, sourceData) {
  if (!(Array.isArray(slices) && slices.some((slice) => (slice.codeSnippets?.length > 0) || (slice.scope?.length > 0)))) return;
  try {
    maybeAddFixPlanReview(cwd, {
      title: `Fix proposal ${fixId} pending approval`,
      severity: sourceData.type === "incident" ? "high" : "medium",
      context: { proposalId: fixId, planPath: `docs/plans/auto/${planName}`, slices: slices.length },
      correlationId: fixId,
    }, activeHub, captureMemory);
  } catch (err) {
    console.warn?.(`Fix-plan review hook failed: ${err.message}`);
  }
}

function _054_forge_fix_proposal_textError(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function _054_forge_fix_proposal_jsonResult(payload, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError };
}

function _054_forge_fix_proposal_noData(message, extras = {}) {
  return _054_forge_fix_proposal_jsonResult({ error: message, planFile: null, ...extras });
}

function _054_forge_fix_proposal_readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function _054_forge_fix_proposal_resolveIncidentSource({ args, cwd, source }) {
  const incidentId = args.incidentId || null;
  if (!(source === "incident" || (source === "auto" && incidentId))) return null;
  if (!incidentId) return { response: _054_forge_fix_proposal_textError("incidentId required for incident source") };
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  if (!incidents.length) return { response: _054_forge_fix_proposal_noData("no incident data — run pforge incident first") };
  const incident = incidents.find((item) => item.id === incidentId || item.incidentId === incidentId);
  if (!incident) return { response: _054_forge_fix_proposal_textError(`Incident not found: ${incidentId}`) };
  return { sourceData: { type: "incident", incident }, fixId: incidentId };
}

function _054_forge_fix_proposal_resolveRegressionSource({ cwd, source }) {
  if (source !== "regression") return null;
  const regPath = resolve(cwd, ".forge", "regression-gates.json");
  if (!existsSync(regPath)) return { response: _054_forge_fix_proposal_noData("no regression data — run pforge regression-guard first") };
  try {
    const regression = _054_forge_fix_proposal_readJsonFile(regPath);
    if (!regression || (Array.isArray(regression) && regression.length === 0)) {
      return { response: _054_forge_fix_proposal_noData("no regression data — run pforge regression-guard first") };
    }
    return { sourceData: { type: "regression", regression }, fixId: `regression-${Date.now()}` };
  } catch {
    return { response: _054_forge_fix_proposal_noData("no regression data — run pforge regression-guard first") };
  }
}

function _054_forge_fix_proposal_resolveDriftSource({ cwd, source }) {
  if (!(source === "drift" || source === "auto")) return null;
  const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
  if (!driftHistory.length) {
    return source === "drift"
      ? { response: _054_forge_fix_proposal_noData("no drift data — run pforge drift first") }
      : null;
  }
  const latest = driftHistory[driftHistory.length - 1];
  return { sourceData: { type: "drift", drift: latest }, fixId: `drift-${Date.now()}` };
}

function _054_forge_fix_proposal_resolveSecretSource({ cwd, source }) {
  if (!(source === "secret" || source === "auto")) return null;
  const scanPath = resolve(cwd, ".forge", "secret-scan-cache.json");
  if (!existsSync(scanPath)) {
    return source === "secret"
      ? { response: _054_forge_fix_proposal_noData("no secret scan data — run pforge secret-scan first") }
      : null;
  }
  try {
    const scan = _054_forge_fix_proposal_readJsonFile(scanPath);
    return { sourceData: { type: "secret", scan }, fixId: `secret-${Date.now()}` };
  } catch {
    return source === "secret"
      ? { response: _054_forge_fix_proposal_noData("no secret scan data — run pforge secret-scan first") }
      : null;
  }
}

function _054_forge_fix_proposal_pickExplicitCrucibleTarget(cwd, smeltIdArg, source) {
  if (!smeltIdArg) return { target: null };
  const smeltPath = resolve(cwd, ".forge", "crucible", `${smeltIdArg}.json`);
  if (!existsSync(smeltPath)) {
    return source === "crucible"
      ? { response: _054_forge_fix_proposal_noData(`smelt ${smeltIdArg} not found in .forge/crucible/`) }
      : { target: null };
  }
  try {
    const smelt = _054_forge_fix_proposal_readJsonFile(smeltPath);
    return { targetKind: "explicit", target: { id: smeltIdArg, smelt } };
  } catch {
    return source === "crucible"
      ? { response: _054_forge_fix_proposal_noData(`smelt ${smeltIdArg} is unreadable`) }
      : { target: null };
  }
}

function _054_forge_fix_proposal_pickStalledCrucibleTarget(cwd, crucible) {
  if (!(crucible.staleInProgress > 0)) return null;
  const crucibleDir = resolve(cwd, ".forge", "crucible");
  const cutoffMs = Date.now() - crucible.stallCutoffDays * 24 * 60 * 60 * 1000;
  let oldest = null;
  try {
    for (const entry of readdirSync(crucibleDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (entry.name === "config.json" || entry.name === "phase-claims.json") continue;
      const fullPath = resolve(crucibleDir, entry.name);
      let smelt;
      try {
        smelt = _054_forge_fix_proposal_readJsonFile(fullPath);
      } catch {
        continue;
      }
      if (smelt.status !== "in_progress") continue;
      const mtime = statSync(fullPath).mtimeMs;
      if (mtime >= cutoffMs) continue;
      if (!oldest || mtime < oldest.mtime) oldest = { id: basename(entry.name, ".json"), smelt, mtime };
    }
  } catch { /* unreadable dir — fall through */ }
  return oldest ? { targetKind: "stalled", target: { id: oldest.id, smelt: oldest.smelt } } : null;
}

function _054_forge_fix_proposal_pickCrucibleTarget({ args, cwd, source, crucible }) {
  const explicit = _054_forge_fix_proposal_pickExplicitCrucibleTarget(cwd, args.smeltId || null, source);
  if (explicit?.response || explicit?.target) return explicit;
  const stalled = _054_forge_fix_proposal_pickStalledCrucibleTarget(cwd, crucible);
  if (stalled) return stalled;
  if (crucible.orphanHandoffs.length > 0) {
    const orphan = crucible.orphanHandoffs[0];
    return { targetKind: "orphan", target: { id: orphan.crucibleId || `orphan-${Date.now()}`, orphan } };
  }
  return { target: null };
}

function _054_forge_fix_proposal_resolveCrucibleSource(context) {
  const { cwd, source } = context;
  if (!(source === "crucible" || source === "auto")) return null;
  const crucible = readCrucibleState(cwd);
  if (!crucible) {
    return source === "crucible"
      ? { response: _054_forge_fix_proposal_noData("no Crucible data — .forge/crucible/ does not exist") }
      : null;
  }
  const targetState = _054_forge_fix_proposal_pickCrucibleTarget({ ...context, crucible });
  if (targetState?.response) return targetState;
  if (!targetState?.target) {
    return source === "crucible"
      ? { response: _054_forge_fix_proposal_noData("Crucible funnel is healthy — no stalled or orphan smelts to fix", { counts: crucible.counts }) }
      : null;
  }
  return {
    sourceData: { type: "crucible", kind: targetState.targetKind, target: targetState.target, cutoffDays: crucible.stallCutoffDays },
    fixId: `crucible-${targetState.target.id}`,
  };
}

function _054_forge_fix_proposal_isTerminalBugStatus(status) {
  return status === "fixed" || status === "wont-fix" || status === "duplicate";
}

function _054_forge_fix_proposal_resolveTemperingBugSource({ args, cwd, source }) {
  if (!(source === "tempering-bug" || source === "auto")) return null;
  const bugId = args.bugId || null;
  if (source === "tempering-bug" && !bugId) {
    return {
      response: _054_forge_fix_proposal_jsonResult({
        error: ERROR_CODES.MISSING_BUG_ID.code,
        message: "bugId is required when source is tempering-bug",
      }, true),
    };
  }
  if (bugId) {
    const bug = loadBug(cwd, bugId);
    if (!bug) {
      return source === "tempering-bug"
        ? { response: _054_forge_fix_proposal_jsonResult({ error: ERROR_CODES.BUG_NOT_FOUND.code, bugId }, true) }
        : null;
    }
    if (_054_forge_fix_proposal_isTerminalBugStatus(bug.status)) {
      return source === "tempering-bug"
        ? { response: _054_forge_fix_proposal_jsonResult({ error: ERROR_CODES.BUG_TERMINAL_STATUS.code, bugId, currentStatus: bug.status }, true) }
        : null;
    }
    return { sourceData: { type: "tempering-bug", bug }, fixId: `tempering-bug-${bugId}` };
  }
  const openBug = listBugs(cwd, { status: "open" }).find((bug) => bug.classification === "real-bug" && !bug.linkedFixPlan);
  return openBug ? { sourceData: { type: "tempering-bug", bug: openBug }, fixId: `tempering-bug-${openBug.bugId}` } : null;
}

function _054_forge_fix_proposal_resolveSource(context) {
  const resolvers = [
    _054_forge_fix_proposal_resolveIncidentSource,
    _054_forge_fix_proposal_resolveRegressionSource,
    _054_forge_fix_proposal_resolveDriftSource,
    _054_forge_fix_proposal_resolveSecretSource,
    _054_forge_fix_proposal_resolveCrucibleSource,
    _054_forge_fix_proposal_resolveTemperingBugSource,
  ];
  for (const resolver of resolvers) {
    const outcome = resolver(context);
    if (outcome?.response || outcome?.fixId) return outcome;
  }
  return { sourceData: {}, fixId: "" };
}

function _054_forge_fix_proposal_getPlanDetails(cwd, fixId) {
  const autoDir = resolve(cwd, "docs/plans/auto");
  mkdirSync(autoDir, { recursive: true });
  const planName = `LIVEGUARD-FIX-${fixId}.md`;
  return { autoDir, planName, planPath: resolve(autoDir, planName) };
}

function _054_forge_fix_proposal_collectIncidentLines(cwd, incident, file) {
  const lines = (incident.violations || []).filter((violation) => violation.file === file).map((violation) => violation.line);
  if (lines.length > 0) return lines;
  const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
  if (!driftHistory.length) return lines;
  const latest = driftHistory[driftHistory.length - 1];
  for (const violation of (latest.violations || [])) {
    if (violation.file === file) lines.push(violation.line);
  }
  return lines;
}

function _054_forge_fix_proposal_buildCodeSnippet(lines, lineNum) {
  const start = Math.max(0, lineNum - 6);
  const end = Math.min(lines.length, lineNum + 5);
  return lines.slice(start, end).map((line, index) => {
    const num = start + index + 1;
    const marker = num === lineNum ? " >>>" : "    ";
    return `${marker} ${String(num).padStart(4)}| ${line}`;
  }).join("\n");
}

function _054_forge_fix_proposal_collectIncidentSnippets(cwd, incident, affectedFiles) {
  const snippets = [];
  for (const file of affectedFiles) {
    try {
      const filePath = resolve(cwd, file);
      if (!existsSync(filePath)) continue;
      const lines = readFileSync(filePath, "utf-8").split("\n");
      for (const lineNum of _054_forge_fix_proposal_collectIncidentLines(cwd, incident, file).slice(0, 3)) {
        snippets.push({ file, line: lineNum, snippet: _054_forge_fix_proposal_buildCodeSnippet(lines, lineNum) });
      }
    } catch { /* file read error — skip snippet */ }
  }
  return snippets;
}

function _054_forge_fix_proposal_getIncidentGateCommand(cwd, affectedFiles) {
  const hasCsproj = existsSync(resolve(cwd, "*.csproj")) || readdirSync(cwd).some((file) => file.endsWith(".csproj") || file.endsWith(".sln"));
  if (hasCsproj) {
    const testFilters = affectedFiles
      .map((file) => basename(file, extname(file)).replace(/\.(cs|fs|vb)$/, ""))
      .filter((name) => name.length > 0);
    return testFilters.length > 0
      ? `dotnet test --filter "${testFilters.map((name) => `FullyQualifiedName~${name}`).join("|")}"`
      : "dotnet test";
  }
  return existsSync(resolve(cwd, "package.json")) ? "npm test" : "pforge regression-guard";
}

function _054_forge_fix_proposal_buildIncidentSlices(cwd, sourceData, fixId) {
  const incident = sourceData.incident;
  const affectedFiles = incident.files || incident.affectedFiles || [];
  const description = incident.description || incident.title || fixId;
  const severity = incident.severity || "medium";
  const investigateTasks = [`Review incident: ${description}`];
  if (affectedFiles.length > 0) investigateTasks.push(`Inspect affected file(s): ${affectedFiles.join(", ")}`);
  investigateTasks.push("Identify root cause — check for: empty catch blocks, inverted logic, missing validation, null references");
  investigateTasks.push("Document the exact code location and failure mechanism");
  const fixTasks = [
    "Implement the fix in the identified file(s)",
    ...(affectedFiles.length > 0 ? ["Add or update unit tests covering the fix in affected file(s)"] : []),
    "Run regression guard to verify no side effects",
    "Verify incident resolution by reproducing the original failure scenario",
  ];
  return [
    {
      title: `Investigate: ${description}`,
      tasks: investigateTasks,
      scope: affectedFiles,
      codeSnippets: _054_forge_fix_proposal_collectIncidentSnippets(cwd, incident, affectedFiles),
    },
    {
      title: `Apply Fix + Verify (${severity})`,
      tasks: fixTasks,
      scope: affectedFiles,
      gate: _054_forge_fix_proposal_getIncidentGateCommand(cwd, affectedFiles),
    },
  ];
}

function _054_forge_fix_proposal_buildCrucibleSlices(sourceData) {
  const { kind, target } = sourceData;
  const cutoff = sourceData.cutoffDays || 7;
  const smeltId = target.id;
  const smeltPathRel = `.forge/crucible/${smeltId}.json`;
  if (kind === "orphan") {
    const orphan = target.orphan;
    const planPath = orphan?.planPath || "(unknown)";
    const phaseName = orphan?.phaseName || "(unnamed phase)";
    return [
      {
        title: `Triage orphan handoff: ${phaseName}`,
        tasks: [
          `Inspect hub-events.jsonl entry for smelt ${smeltId}`,
          `Check whether the hardener plan file ever existed: ${planPath}`,
          "Decide: (a) re-generate the plan from the smelt journal, OR (b) record the handoff as abandoned and move on",
          "Document the decision rationale in the smelt's `notes` field",
        ],
        scope: [smeltPathRel, ".forge/hub-events.jsonl"],
      },
      {
        title: "Resolve orphan: regenerate or archive",
        tasks: [
          `If regenerating: run the hardener workflow against smelt ${smeltId} to produce ${planPath}`,
          'If archiving: set smelt status to "abandoned" with reason "orphan handoff — plan unrecoverable"',
          "Verify: re-run forge_watch or pforge smith — orphan count should drop to 0",
        ],
        scope: [smeltPathRel, planPath],
        gate: "pforge smith",
      },
    ];
  }
  const phaseName = target.smelt?.phaseName || target.smelt?.title || "(untitled smelt)";
  const status = target.smelt?.status || "unknown";
  return [
    {
      title: `Triage stalled smelt: ${phaseName}`,
      tasks: [
        `Read the smelt journal at ${smeltPathRel} (current status: ${status})`,
        `Check mtime — flagged stalled when idle ≥ ${cutoff} days`,
        "Review the smelt's last recorded action and any open questions",
        "Decide: (a) RESUME if the work is still relevant, OR (b) ABANDON if superseded / no longer needed",
        "Document the decision rationale in the smelt's `notes` field",
      ],
      scope: [smeltPathRel],
    },
    {
      title: "Execute decision: resume or abandon",
      tasks: [
        'If RESUMING: touch the smelt journal, set a concrete "nextAction" field, resume normal Crucible workflow',
        'If ABANDONING: set smelt status to "abandoned" with reason and supersededBy (if applicable)',
        "Verify: re-run forge_watch or pforge smith — staleInProgress should drop by at least 1",
      ],
      scope: [smeltPathRel],
      gate: "pforge smith",
    },
  ];
}

function _054_forge_fix_proposal_getBugAffectedFiles(bug) {
  if (bug.affectedFiles?.length > 0) return bug.affectedFiles;
  if (!bug.evidence?.stackTrace) return [];
  return [...bug.evidence.stackTrace.matchAll(/(?:at\s+\S+\s+\(?|\/)([\w./-]+\.[a-z]{1,5})/gi)]
    .map((match) => match[1])
    .filter((file) => !file.includes("node_modules"))
    .slice(0, 5);
}

async function _054_forge_fix_proposal_buildTemperingBugSlices(cwd, bug) {
  const bugId = bug.bugId;
  const severity = bug.severity || "medium";
  const affectedFiles = _054_forge_fix_proposal_getBugAffectedFiles(bug);
  const slices = [
    {
      title: `Triage: ${bug.evidence?.testName || bug.evidence?.assertionMessage?.slice(0, 50) || bugId}`,
      tasks: [
        `Review bug ${bugId} (${bug.scanner} scanner, ${severity} severity)`,
        bug.evidence?.assertionMessage ? `Assertion: ${bug.evidence.assertionMessage.slice(0, 200)}` : "Investigate the failure evidence",
        bug.evidence?.stackTrace ? `Stack trace starts at: ${bug.evidence.stackTrace.split("\\n")[0]?.slice(0, 120)}` : "Reproduce the failure",
        `Classification: ${bug.classification || "unknown"}`,
        ...(bug.reproSteps?.length ? [`Repro steps: ${bug.reproSteps.join(" → ")}`] : []),
        "Identify root cause and document the fix approach",
      ],
      scope: affectedFiles.length > 0 ? affectedFiles : [".forge/bugs/"],
    },
    {
      title: `Apply fix for ${bugId}`,
      tasks: [
        "Implement the fix in the identified file(s)",
        ...(affectedFiles.length > 0 ? [`Affected files: ${affectedFiles.join(", ")}`] : []),
        "Add or update tests covering the fixed behavior",
        `Validate: run forge_bug_validate_fix --bugId ${bugId}`,
      ],
      scope: affectedFiles,
      gate: `forge_bug_validate_fix --bugId ${bugId}`,
    },
  ];
  if (severity === "critical" || severity === "high") {
    slices.push({
      title: `Regression guard (${severity} severity)`,
      tasks: ["Run full regression guard to verify no side effects", "Verify no new tempering findings introduced"],
      gate: "forge_regression_guard",
    });
  }
  const relPlanPath = `docs/plans/auto/LIVEGUARD-FIX-tempering-bug-${bugId}.md`;
  await updateBugStatus(cwd, bugId, "in-fix", { note: `Linked fix plan: ${relPlanPath}` });
  setLinkedFixPlan(cwd, bugId, relPlanPath);
  return slices;
}

async function _054_forge_fix_proposal_buildSlices(cwd, sourceData, source, fixId) {
  if (sourceData.type === "incident") return _054_forge_fix_proposal_buildIncidentSlices(cwd, sourceData, fixId);
  if (sourceData.type === "drift") {
    return [{
      title: `Resolve Drift Violations (score: ${sourceData.drift?.score || "unknown"})`,
      tasks: ["Review drift violations", "Fix architectural deviations", "Re-run drift report to verify score improvement"],
      gate: "pforge drift",
    }];
  }
  if (sourceData.type === "secret") {
    return [{
      title: "Credential Rotation",
      tasks: ["Rotate any exposed credentials", "Update secret references to use environment variables or secret manager", "Remove hardcoded values from source"],
      gate: "pforge secret-scan --since HEAD~1",
    }];
  }
  if (sourceData.type === "crucible") return _054_forge_fix_proposal_buildCrucibleSlices(sourceData);
  if (sourceData.type === "tempering-bug") return _054_forge_fix_proposal_buildTemperingBugSlices(cwd, sourceData.bug);
  return [{ title: `Fix: ${source}`, tasks: ["Investigate the issue", "Apply fix", "Validate"], gate: "pforge regression-guard" }];
}

function _054_forge_fix_proposal_renderPlan(fixId, sourceType, slices) {
  let planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n`;
  planContent += `> Generated: ${new Date().toISOString()}\n`;
  planContent += `> Source: ${sourceType}\n\n`;
  planContent += "## Scope Contract\n\n";
  planContent += `This plan addresses a ${sourceType} finding detected by LiveGuard.\n\n`;
  slices.forEach((slice, index) => {
    planContent += `## Slice ${index + 1} — ${slice.title}\n\n`;
    planContent += "**Tasks:**\n";
    for (const task of slice.tasks) planContent += `- [ ] ${task}\n`;
    if (slice.codeSnippets?.length > 0) {
      planContent += "\n**Code Context:**\n";
      for (const snippet of slice.codeSnippets) {
        planContent += `\n\`${snippet.file}\` line ${snippet.line}:\n\`\`\`\n${snippet.snippet}\n\`\`\`\n`;
      }
    }
    if (slice.scope?.length > 0) planContent += `\n**Scope:** ${slice.scope.join(", ")}\n`;
    if (slice.gate) planContent += `\n**Validation Gate:**\n\`\`\`bash\n${slice.gate}\n\`\`\`\n`;
    planContent += "\n";
  });
  return planContent;
}

function _054_forge_fix_proposal_maybeQueueReview(cwd, fixId, planName, sourceType, slices) {
  if (!(Array.isArray(slices) && slices.some((slice) => (slice.codeSnippets?.length > 0) || (slice.scope?.length > 0)))) return;
  try {
    maybeAddFixPlanReview(cwd, {
      title: `Fix proposal ${fixId} pending approval`,
      severity: sourceType === "incident" ? "high" : "medium",
      context: { proposalId: fixId, planPath: `docs/plans/auto/${planName}`, slices: slices.length },
      correlationId: fixId,
    }, activeHub, captureMemory);
  } catch (err) {
    console.warn?.(`Fix-plan review hook failed: ${err.message}`);
  }
}

function _054_forge_fix_proposal_persistArtifacts(opts) {
  const { cwd, fixId, planName, planPath, sourceType, slices, planContent } = opts;
  writeFileSync(planPath, planContent, "utf-8");
  appendForgeJsonl("fix-proposals.json", {
    fixId,
    plan: `docs/plans/auto/${planName}`,
    source: sourceType,
    sliceCount: slices.length,
    generatedAt: new Date().toISOString(),
  }, cwd);
  _054_forge_fix_proposal_maybeQueueReview(cwd, fixId, planName, sourceType, slices);
}

async function _callToolHandler_054_forge_fix_proposal(request, args) {
  const { name } = request.params;
  if (!(name === "forge_fix_proposal")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const source = args.source || "auto";
      const resolvedSource = _054_forge_fix_proposal_resolveSource({ args, cwd, source });
      if (resolvedSource.response) return resolvedSource.response;
      const { sourceData, fixId } = resolvedSource;
      if (!fixId) {
        return _054_forge_fix_proposal_noData("no LiveGuard data found — run drift, incident-capture, regression-guard, secret-scan, start a Crucible smelt, or register a tempering bug first");
      }
      const { planName, planPath } = _054_forge_fix_proposal_getPlanDetails(cwd, fixId);
      if (existsSync(planPath)) {
        return _054_forge_fix_proposal_jsonResult({ alreadyExists: true, plan: `docs/plans/auto/${planName}`, fixId });
      }
      const slices = await _054_forge_fix_proposal_buildSlices(cwd, sourceData, source, fixId);
      const planContent = _054_forge_fix_proposal_renderPlan(fixId, sourceData.type, slices);
      _054_forge_fix_proposal_persistArtifacts({ cwd, fixId, planName, planPath, sourceType: sourceData.type, slices, planContent });
      const result = { fixId, plan: `docs/plans/auto/${planName}`, source: sourceData.type, sliceCount: slices.length, alreadyExists: false };
      emitToolTelemetry("forge_fix_proposal", args, result, Date.now() - t0, "OK", cwd);
      activeHub?.broadcast({ type: "fix-proposal-ready", data: result });
      await broadcastLiveGuard("forge_fix_proposal", "OK", Date.now() - t0);
      captureMemory(
        `Fix proposal ${fixId}: ${sourceData.type} source, ${slices.length} slice(s). Plan: docs/plans/auto/${planName}.`,
        "decision", "forge_fix_proposal", cwd
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Fix proposal error: ${err.message}` }], isError: true };
    }
  
}

function _055_forge_liveguard_run_entropy(str) {
  const charSet = new Set(str);
  return [...charSet].reduce((sum, char) => {
    const p = (str.split(char).length - 1) / str.length;
    return sum - p * Math.log2(p);
  }, 0);
}

async function _055_forge_liveguard_run_checkDrift(cwd, penaltyPerViolation) {
  try {
    const analysis = await runAnalyze({ mode: "file", path: ".", cwd });
    const score = Math.max(0, 100 - (analysis.violations.length * penaltyPerViolation));
    return { score, appViolations: analysis.violations.length, frameworkViolations: (analysis.frameworkViolations || []).length, filesScanned: analysis.filesScanned };
  } catch (err) {
    return { error: err.message };
  }
}

function _055_forge_liveguard_run_checkSweep(cwd) {
  try {
    const sweepResult = JSON.parse(execSync(
      process.platform === "win32"
        ? "powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1 sweep"
        : "bash pforge.sh sweep",
      { cwd, encoding: "utf-8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } }
    ).trim() || "{}");
    const sweepText = typeof sweepResult === "string" ? sweepResult : "";
    const appMatch = sweepText.match(/FOUND (\d+)/);
    return { appMarkers: appMatch ? parseInt(appMatch[1], 10) : 0, ran: true };
  } catch (err) {
    const output = (err.stdout || err.stderr || "").trim();
    const appMatch = output.match(/FOUND (\d+)/);
    const appMarkers = output.includes("SWEEP CLEAN") ? 0 : (appMatch ? parseInt(appMatch[1], 10) : 0);
    return { appMarkers, ran: true };
  }
}

function _055_forge_liveguard_run_shouldFlagSecretLine(content, threshold, keyPattern) {
  if (content.length < 8 || content.length > 200) return false;
  if (/^[a-f0-9]{40,}$/i.test(content.trim())) return false;
  if (/^[A-Za-z0-9+/=]{50,}$/.test(content.trim())) return false;
  if (content.includes("integrity") && content.includes("sha")) return false;
  return _055_forge_liveguard_run_entropy(content) >= threshold && keyPattern.test(content);
}

function _055_forge_liveguard_run_checkSecrets(cwd) {
  try {
    let diff = "";
    try {
      diff = execSync('git diff HEAD~1 -p -- . ":!package-lock.json" ":!*.min.js" ":!*.min.css" ":!*.map" ":!*.svg" ":!pforge-mcp/" ":!.github/" ":!pforge.ps1" ":!pforge.sh"', { cwd, encoding: "utf-8", timeout: 30_000 });
    } catch { /* ignore */ }
    const findings = [];
    const secretKeyPattern = /(?:password|secret|token|api[_-]?key|auth|credential|private[_-]?key|connection[_-]?string|bearer)\s*[:=]/i;
    for (const line of diff.split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const content = line.slice(1);
      if (_055_forge_liveguard_run_shouldFlagSecretLine(content, 4.5, secretKeyPattern)) {
        findings.push({ line: content.slice(0, 80), entropy: Math.round(_055_forge_liveguard_run_entropy(content) * 100) / 100 });
      }
    }
    return { findings: findings.length };
  } catch (err) {
    return { error: err.message };
  }
}

async function _055_forge_liveguard_run_checkRegression(cwd) {
  try {
    const regResult = await regressionGuard([], { cwd });
    return { gates: regResult.gatesChecked, passed: regResult.passed, failed: regResult.failed };
  } catch (err) {
    return { error: err.message };
  }
}

function _055_forge_liveguard_run_checkDeps(cwd) {
  try {
    const hasPkgJson = existsSync(resolve(cwd, "package.json"));
    const hasDotnet = !hasPkgJson && readdirSync(cwd).some((file) => file.endsWith(".csproj") || file.endsWith(".sln") || file.endsWith(".slnx"));
    if (hasPkgJson) {
      let auditResult = null;
      try {
        auditResult = JSON.parse(execSync("npm audit --json 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 }));
      } catch (err) {
        if (err.stdout) {
          try {
            auditResult = JSON.parse(err.stdout);
          } catch {
            auditResult = null;
          }
        }
      }
      return { vulnerabilities: auditResult ? Object.keys(auditResult.vulnerabilities || {}).length : 0 };
    }
    if (hasDotnet) {
      let vulnCount = 0;
      try {
        const parsed = JSON.parse(execSync("dotnet list package --vulnerable --format json 2>&1", { cwd, encoding: "utf-8", timeout: 120_000 }));
        for (const project of (parsed.projects || [])) {
          for (const framework of (project.frameworks || [])) {
            vulnCount += (framework.topLevelPackages || []).filter((pkg) => pkg.vulnerabilities?.length).length;
            vulnCount += (framework.transitivePackages || []).filter((pkg) => pkg.vulnerabilities?.length).length;
          }
        }
      } catch { /* parse error — skip */ }
      return { vulnerabilities: vulnCount };
    }
    return { skipped: true, reason: "no package.json or .csproj/.sln/.slnx" };
  } catch (err) {
    return { error: err.message };
  }
}

async function _055_forge_liveguard_run_checkAlerts(cwd) {
  try {
    const brainDeps = { cwd, readForgeJsonl };
    const incidents = ((await brainRecall("project.liveguard.incidents", { freshnessMs: 60_000 }, brainDeps)) || []).filter((incident) => !incident.resolvedAt);
    const driftHistory = (await brainRecall("project.liveguard.drift", { freshnessMs: 60_000 }, brainDeps)) || [];
    const latestViolations = driftHistory.length ? (driftHistory[driftHistory.length - 1].violations || []) : [];
    const criticalAlerts = [
      ...incidents.filter((incident) => incident.severity === "critical" || incident.severity === "high"),
      ...latestViolations.filter((violation) => violation.severity === "critical" || violation.severity === "high"),
    ];
    return {
      critical: criticalAlerts.filter((alert) => alert.severity === "critical").length,
      high: criticalAlerts.filter((alert) => alert.severity === "high").length,
      openIncidents: incidents.length,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function _055_forge_liveguard_run_checkHealth(cwd) {
  try {
    const brainDeps = { cwd, readForgeJsonl };
    const driftHistory = (await brainRecall("project.liveguard.drift", { freshnessMs: 60_000 }, brainDeps)) || [];
    const recentScores = driftHistory.slice(-5).map((entry) => entry.score).filter((score) => typeof score === "number");
    const avgScore = recentScores.length ? Math.round(recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length) : null;
    const trend = recentScores.length >= 2
      ? (recentScores[recentScores.length - 1] > recentScores[0] ? "improving" : recentScores[recentScores.length - 1] < recentScores[0] ? "degrading" : "stable")
      : "stable";
    return { avgScore, trend, dataPoints: driftHistory.length };
  } catch (err) {
    return { error: err.message };
  }
}

function _055_forge_liveguard_run_checkDiff(cwd, planArg) {
  if (!planArg) return undefined;
  try {
    const planPath = resolve(cwd, planArg);
    if (!existsSync(planPath)) return { error: `Plan not found: ${planArg}` };
    const plan = parsePlan(planPath, cwd);
    const forbidden = plan.scopeContract?.forbidden || [];
    return { plan: planArg, forbiddenPaths: forbidden.length, checked: true };
  } catch (err) {
    return { error: err.message };
  }
}

function _055_forge_liveguard_run_getCoverageVsMinima(lastRun, temperingConfig) {
  const coverageMinima = temperingConfig?.coverageMinima || {};
  const coverageVsMinima = { met: 0, total: 0 };
  if (!(lastRun && lastRun.scanners && Object.keys(coverageMinima).length > 0)) return coverageVsMinima;
  for (const [layer, min] of Object.entries(coverageMinima)) {
    void min;
    coverageVsMinima.total++;
    const scannerResult = lastRun.scanners.find((scanner) => scanner.scanner === layer);
    if (scannerResult && (scannerResult.pass > 0 || scannerResult.verdict === "pass")) coverageVsMinima.met++;
  }
  return coverageVsMinima;
}

function _055_forge_liveguard_run_checkTempering(cwd) {
  try {
    const openBugs = listBugs(cwd, { status: "open" });
    const criticalOrHigh = openBugs.filter((bug) => bug.severity === "critical" || bug.severity === "high");
    const temperingConfig = readTemperingConfigForLg(cwd);
    const runRecords = listRunRecords(cwd);
    const lastRun = runRecords.length > 0 ? runRecords[runRecords.length - 1] : null;
    const coverageVsMinima = _055_forge_liveguard_run_getCoverageVsMinima(lastRun, temperingConfig);
    const mutationScore = lastRun?.scanners?.find((scanner) => scanner.scanner === "mutation")?.score ?? null;
    let temperingStatus = "green";
    if (criticalOrHigh.length > 0) temperingStatus = "red";
    else if (openBugs.length > 0 || (coverageVsMinima.total > 0 && coverageVsMinima.met < coverageVsMinima.total)) temperingStatus = "yellow";
    return {
      openBugs: openBugs.length,
      criticalOrHighOpen: criticalOrHigh.length,
      coverageVsMinima,
      mutationScore,
      lastRunAt: lastRun?.completedAt ?? null,
      status: temperingStatus,
    };
  } catch (err) {
    return { openBugs: 0, criticalOrHighOpen: 0, coverageVsMinima: { met: 0, total: 0 }, mutationScore: null, lastRunAt: null, status: "unknown", error: err.message };
  }
}

function _055_forge_liveguard_run_isDriftOk(report, threshold) {
  return !report.drift.error && (report.drift.score ?? 0) >= threshold;
}

function _055_forge_liveguard_run_isSecretsOk(report) {
  return !report.secrets?.error && (report.secrets?.findings ?? 0) === 0;
}

function _055_forge_liveguard_run_isRegressionOk(report) {
  return !report.regression?.error && (report.regression?.failed ?? 0) === 0;
}

function _055_forge_liveguard_run_isDepsOk(report) {
  return !report.deps?.error && (report.deps?.vulnerabilities ?? 0) === 0;
}

function _055_forge_liveguard_run_isAlertsOk(report) {
  return !report.alerts?.error && (report.alerts?.critical ?? 0) === 0;
}

function _055_forge_liveguard_run_isTemperingOk(report) {
  return !report.tempering?.error && report.tempering?.status !== "red";
}

function _055_forge_liveguard_run_getStatusChecks(report, threshold) {
  return {
    driftOk: _055_forge_liveguard_run_isDriftOk(report, threshold),
    secretsOk: _055_forge_liveguard_run_isSecretsOk(report),
    regressionOk: _055_forge_liveguard_run_isRegressionOk(report),
    depsOk: _055_forge_liveguard_run_isDepsOk(report),
    alertsOk: _055_forge_liveguard_run_isAlertsOk(report),
    temperingOk: _055_forge_liveguard_run_isTemperingOk(report),
  };
}

function _055_forge_liveguard_run_computeOverallStatus(report, threshold) {
  const { driftOk, secretsOk, regressionOk, depsOk, alertsOk, temperingOk } = _055_forge_liveguard_run_getStatusChecks(report, threshold);
  if (driftOk && secretsOk && regressionOk && depsOk && alertsOk && temperingOk) return "green";
  return (!regressionOk || !secretsOk || !temperingOk) ? "red" : "yellow";
}

async function _callToolHandler_055_forge_liveguard_run(request, args) {
  const { name } = request.params;
  if (!(name === "forge_liveguard_run")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const threshold = Math.max(0, Math.min(100, args.threshold ?? 70));
      const report = {};
      report.drift = await _055_forge_liveguard_run_checkDrift(cwd, 2);
      report.sweep = _055_forge_liveguard_run_checkSweep(cwd);
      report.secrets = _055_forge_liveguard_run_checkSecrets(cwd);
      report.regression = await _055_forge_liveguard_run_checkRegression(cwd);
      report.deps = _055_forge_liveguard_run_checkDeps(cwd);
      report.alerts = await _055_forge_liveguard_run_checkAlerts(cwd);
      report.health = await _055_forge_liveguard_run_checkHealth(cwd);
      const diffResult = _055_forge_liveguard_run_checkDiff(cwd, args.plan);
      if (diffResult) report.diff = diffResult;
      report.tempering = _055_forge_liveguard_run_checkTempering(cwd);
      report.overallStatus = _055_forge_liveguard_run_computeOverallStatus(report, threshold);
      emitToolTelemetry("forge_liveguard_run", args, report, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_liveguard_run", "OK", Date.now() - t0, { overallStatus: report.overallStatus, driftScore: report.drift?.score, gates: report.regression?.gates, secrets: report.secrets?.findings });
      captureMemory(
        `LiveGuard health: drift ${report.drift?.score ?? "?"}/100, ${report.regression?.passed ?? 0}/${report.regression?.gates ?? 0} gates, ${report.alerts?.openIncidents ?? 0} open incidents, ${report.deps?.vulnerabilities ?? 0} vulnerabilities. Status: ${report.overallStatus}.`,
        "decision", "forge_liveguard_run", cwd
      );
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `LiveGuard run error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_056_forge_home_snapshot(request, args) {
  const { name } = request.params;
  if (!(name === "forge_home_snapshot")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    const cwd = args.targetPath
      ? findProjectRoot(resolve(args.targetPath))
      : findProjectRoot(PROJECT_DIR);
    const result = await readHomeSnapshot(cwd, {
      activityTail: args.activityTail,
      drill: args.drill,
      activityCursor: args.activityCursor,
    });
    emitToolTelemetry(
      "forge_home_snapshot", args, result, Date.now() - t0,
      result.ok ? "OK" : "ERROR", cwd
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  
}

async function _callToolHandler_057_forge_review_add(request, args) {
  const { name } = request.params;
  if (!(name === "forge_review_add")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = addReviewItem(cwd, {
        source: args.source,
        severity: args.severity,
        title: args.title,
        context: args.context || null,
        correlationId: args.correlationId || null,
      }, activeHub, captureMemory);
      emitToolTelemetry("forge_review_add", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_UNKNOWN", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_058_forge_review_list(request, args) {
  const { name } = request.params;
  if (!(name === "forge_review_list")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const filters = {};
      if (args.status) filters.status = args.status;
      if (args.source) filters.source = args.source;
      if (args.severity) filters.severity = args.severity;
      if (args.correlationId) filters.correlationId = args.correlationId;
      if (args.limit !== undefined) filters.limit = args.limit;
      if (args.cursor !== undefined) filters.cursor = args.cursor;
      const items = listReviewItems(cwd, filters);
      emitToolTelemetry("forge_review_list", args, { count: items.length }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: items.length, items }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_UNKNOWN", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_059_forge_review_resolve(request, args) {
  const { name } = request.params;
  if (!(name === "forge_review_resolve")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = resolveReviewItem(cwd, {
        itemId: args.itemId,
        resolution: args.resolution,
        resolvedBy: args.resolvedBy,
        note: args.note || null,
      }, activeHub, captureMemory);
      emitToolTelemetry("forge_review_resolve", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_UNKNOWN", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_060_forge_delegate_to_agent(request, args) {
  const { name } = request.params;
  if (!(name === "forge_delegate_to_agent")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.targetPath ? findProjectRoot(resolve(args.targetPath)) : findProjectRoot(PROJECT_DIR);
      const { loadBug } = await import("./tempering/bug-registry.mjs");
      const { resolveRoute, buildAnalystPrompt, recordDelegation, deriveBugType } = await import("./tempering/agent-router.mjs");

      const bug = loadBug(cwd, args.bugId);
      if (!bug) {
        const result = { ok: false, error: ERROR_CODES.BUG_NOT_FOUND.code, bugId: args.bugId };
        emitToolTelemetry("forge_delegate_to_agent", args, result, Date.now() - t0, "ERROR", cwd);
        return { content: [{ type: "text", text: JSON.stringify(result) }], isError: true };
      }

      const route = resolveRoute({ ...bug, type: deriveBugType(bug) });
      if (!route) {
        const result = { ok: true, routed: false, reason: "no-rule-matches", bugId: args.bugId };
        emitToolTelemetry("forge_delegate_to_agent", args, result, Date.now() - t0, "OK", cwd);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      const prompt = buildAnalystPrompt(bug, route);
      let reviewItemId = null;

      if (!args.dryRun) {
        recordDelegation(cwd, args.bugId, route, args.mode, null);
        if (args.mode === "review-queue-item") {
          const reviewResult = addReviewItem(cwd, {
            source: "fix-plan-approval",
            severity: bug.severity === "critical" ? "blocker" : "high",
            title: `Agent analysis needed: ${bug.bugId} (${route.agent})`,
            context: { bugId: args.bugId, recordRef: `.forge/bugs/${args.bugId}.json`, suggestedAgent: route.agent, suggestedSkill: route.skill },
            correlationId: args.bugId,
          }, activeHub, captureMemory);
          reviewItemId = reviewResult?.itemId || null;
        }
        activeHub?.broadcast({ type: "tempering-bug-delegated", bugId: args.bugId, agent: route.agent, skill: route.skill, mode: args.mode, reviewItemId, timestamp: new Date().toISOString() });
        if (typeof captureMemory === "function") {
          captureMemory(`Delegated bug ${args.bugId} to ${route.agent}`, "decision", `forge_delegate_to_agent/${route.agent}/${bug.severity}`, cwd);
        }
      }

      const result = { ok: true, routed: true, bugId: args.bugId, agent: route.agent, skill: route.skill, mode: args.mode, dryRun: !!args.dryRun, reviewItemId, analystPrompt: prompt };
      emitToolTelemetry("forge_delegate_to_agent", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_DELEGATE", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_061_forge_notify_send(request, args) {
  const { name } = request.params;
  if (!(name === "forge_notify_send")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { createNotificationCore } = await import("./notifications/core.mjs");
      const { webhookAdapter } = await import("./notifications/webhook-adapter.mjs");
      const core = createNotificationCore({ hub: activeHub, projectRoot: cwd, adapters: { webhook: webhookAdapter }, captureMemoryFn: captureMemory });
      const result = await core.directSend({ via: args.via, payload: args.payload, formattedMessage: args.formattedMessage });
      core.shutdown();
      emitToolTelemetry("forge_notify_send", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.ok };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_NOTIFY", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_062_forge_notify_test(request, args) {
  const { name } = request.params;
  if (!(name === "forge_notify_test")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { createNotificationCore } = await import("./notifications/core.mjs");
      const { webhookAdapter } = await import("./notifications/webhook-adapter.mjs");
      const core = createNotificationCore({ hub: activeHub, projectRoot: cwd, adapters: { webhook: webhookAdapter }, captureMemoryFn: captureMemory });
      const result = core.testAdapter({ adapter: args.adapter });
      core.shutdown();
      emitToolTelemetry("forge_notify_test", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_NOTIFY_TEST", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_063_forge_search(request, args) {
  const { name } = request.params;
  if (!(name === "forge_search")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const sourcesArg = Array.isArray(args.sources) ? args.sources : null;
      const wantsMemory = !sourcesArg || sourcesArg.includes("memory");
      let l3Hits = [];
      if (wantsMemory && isOpenBrainConfigured(cwd)) {
        l3Hits = await searchOpenBrainL3(cwd, args);
      }
      const openBrainSearchFn = l3Hits.length > 0 ? () => l3Hits : null;
      const result = forgeSearch(args, { cwd, openBrainSearchFn });
      if (l3Hits.length > 0) {
        result.l3Hits = l3Hits.length;
      }
      emitToolTelemetry("forge_search", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_search", args, { error: err.message }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Search error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_064_forge_timeline(request, args) {
  const { name } = request.params;
  if (!(name === "forge_timeline")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = findProjectRoot(PROJECT_DIR);
      const result = await forgeTimeline(args, { cwd });
      emitToolTelemetry("forge_timeline", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_timeline", args, { error: err.message }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Timeline error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_065_forge_doctor_quorum(request, args) {
  const { name } = request.params;
  if (!(name === "forge_doctor_quorum")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const presetArg = args.preset || "all";
      const presets = presetArg === "all" ? ["power", "speed"] : [presetArg];
      const results = presets.map((p) => assessQuorumViability(p));
      const result = { runtime: detectExecutionRuntime(), presets: results };
      emitToolTelemetry("forge_doctor_quorum", args, result, Date.now() - t0, "OK", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_doctor_quorum", args, { error: err.message }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Doctor quorum error: ${err.message}` }], isError: true };
    }
  
}

const _FORGE_QUORUM_GOAL_PRESETS = {
  "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
  "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
  "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
  "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
};

function _validateForgeQuorumQuestion(customQuestion) {
  if (!customQuestion) return null;
  if (customQuestion.length > 500) {
    return "customQuestion exceeds 500 character limit";
  }
  if (/<script|javascript:|on\w+=/i.test(customQuestion)) {
    return "customQuestion contains disallowed content";
  }
  return null;
}

function _th_066_loadRunbookContext(cwd, trackAge) {
  const runbooksDir = resolve(cwd, ".forge/runbooks");
  if (!existsSync(runbooksDir)) return null;
  try {
    const files = readdirSync(runbooksDir).filter((file) => file.endsWith("-runbook.md")).slice(-3);
    if (files.length === 0) return null;
    return files.map((file) => {
      const fullPath = resolve(runbooksDir, file);
      trackAge(statSync(fullPath).mtime.toISOString());
      return { file, preview: readFileSync(fullPath, "utf-8").slice(0, 2000) };
    });
  } catch {
    return null;
  }
}

function _th_066_collectContextShared(cwd, source, targetFile) {
  const context = {};
  let oldestTimestamp = null;
  const trackAge = (timestamp) => {
    if (timestamp && (!oldestTimestamp || timestamp < oldestTimestamp)) oldestTimestamp = timestamp;
  };
  if (targetFile) {
    const data = readForgeJson(targetFile, null, cwd);
    if (data) {
      context.targetFile = data;
      trackAge(data.timestamp);
    }
    return { context, oldestTimestamp };
  }

  const loaders = {
    "drift": () => {
      const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
      return driftHistory.length ? { key: "drift", value: driftHistory.slice(-5), timestamp: driftHistory.at(-5)?.timestamp || driftHistory[0]?.timestamp } : null;
    },
    "incident": () => {
      const incidents = readForgeJsonl("incidents.jsonl", [], cwd).slice(-10);
      return incidents.length ? { key: "incidents", value: incidents, timestamp: incidents[0]?.capturedAt } : null;
    },
    "triage": () => {
      const triageCache = readForgeJson("alert-triage-cache.json", null, cwd);
      return triageCache ? { key: "triage", value: triageCache, timestamp: triageCache.generatedAt || triageCache.timestamp } : null;
    },
    "runbook": () => {
      const runbooks = _th_066_loadRunbookContext(cwd, trackAge);
      return runbooks ? { key: "runbooks", value: runbooks } : null;
    },
    "fix-proposal": () => {
      const proposals = readForgeJsonl("fix-proposals.json", [], cwd).slice(-5);
      return proposals.length ? { key: "fixProposals", value: proposals, timestamp: proposals[0]?.generatedAt || proposals[0]?.timestamp } : null;
    },
  };

  const activeSources = source === "all" ? Object.keys(loaders) : [source];
  for (const sourceKey of activeSources) {
    const loaded = loaders[sourceKey]?.();
    if (!loaded) continue;
    context[loaded.key] = loaded.value;
    if (loaded.timestamp) trackAge(loaded.timestamp);
  }
  return { context, oldestTimestamp };
}

function _loadForgeQuorumContext(cwd, source, targetFile) {
  return _th_066_collectContextShared(cwd, source, targetFile);
}

function _selectForgeQuorumQuestion(customQuestion, analysisGoal) {
  if (customQuestion) return customQuestion;
  if (analysisGoal && _FORGE_QUORUM_GOAL_PRESETS[analysisGoal]) {
    return _FORGE_QUORUM_GOAL_PRESETS[analysisGoal];
  }
  return _FORGE_QUORUM_GOAL_PRESETS["risk-assess"];
}

function _buildForgeQuorumPrompt(context, questionUsed, quorumSize) {
  const votingInstruction = `Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= 60 and majority consensus. Quorum size: ${quorumSize} models.`;
  const contextStr = JSON.stringify(context, null, 2);
  return `## Context\n${contextStr}\n\n## Question\n${questionUsed}\n\n## Voting Instruction\n${votingInstruction}`;
}

function _formatForgeQuorumSnapshotAge(oldestTimestamp) {
  if (!oldestTimestamp) return "unknown";
  const ageMs = Date.now() - new Date(oldestTimestamp).getTime();
  const ageMins = Math.round(ageMs / 60000);
  return ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
}

const _066_forge_quorum_analyze_GOAL_PRESETS = {
  "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
  "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
  "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
  "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
};

function _066_forge_quorum_analyze_validateQuestion(customQuestion) {
  if (!customQuestion) return null;
  if (customQuestion.length > 500) {
    return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: "customQuestion exceeds 500 character limit" }) }], isError: true };
  }
  if (/<script|javascript:|on\w+=/i.test(customQuestion)) {
    return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: "customQuestion contains disallowed content" }) }], isError: true };
  }
  return null;
}

function _066_forge_quorum_analyze_trackAge(oldestTimestamp, timestamp) {
  if (!timestamp) return oldestTimestamp;
  return !oldestTimestamp || timestamp < oldestTimestamp ? timestamp : oldestTimestamp;
}

function _066_forge_quorum_analyze_collectRunbooks(cwd, oldestTimestamp) {
  const runbooksDir = resolve(cwd, ".forge/runbooks");
  if (!existsSync(runbooksDir)) return { value: null, oldestTimestamp };
  try {
    const files = readdirSync(runbooksDir).filter((file) => file.endsWith("-runbook.md")).slice(-3);
    if (files.length === 0) return { value: null, oldestTimestamp };
    const value = files.map((file) => {
      const fullPath = resolve(runbooksDir, file);
      const content = readFileSync(fullPath, "utf-8").slice(0, 2000);
      const stat = statSync(fullPath);
      oldestTimestamp = _066_forge_quorum_analyze_trackAge(oldestTimestamp, stat.mtime.toISOString());
      return { file, preview: content };
    });
    return { value, oldestTimestamp };
  } catch {
    return { value: null, oldestTimestamp };
  }
}

function _066_forge_quorum_analyze_collectContext(cwd, source, targetFile) {
  return _th_066_collectContextShared(cwd, source, targetFile);
}

function _066_forge_quorum_analyze_selectQuestion(customQuestion, analysisGoal) {
  if (customQuestion) return customQuestion;
  if (analysisGoal && _066_forge_quorum_analyze_GOAL_PRESETS[analysisGoal]) {
    return _066_forge_quorum_analyze_GOAL_PRESETS[analysisGoal];
  }
  return _066_forge_quorum_analyze_GOAL_PRESETS["risk-assess"];
}

function _066_forge_quorum_analyze_formatAge(oldestTimestamp) {
  if (!oldestTimestamp) return "unknown";
  const ageMs = Date.now() - new Date(oldestTimestamp).getTime();
  const ageMins = Math.round(ageMs / 60000);
  return ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
}

const _TH_066_GOAL_PRESETS = {
  "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
  "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
  "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
  "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
};

function _th_066_validateCustomQuestion(customQuestion) {
  if (!customQuestion) return null;
  if (customQuestion.length > 500) return "customQuestion exceeds 500 character limit";
  if (/<script|javascript:|on\w+=/i.test(customQuestion)) return "customQuestion contains disallowed content";
  return null;
}

function _th_066_collectQuorumContext({ cwd, source, targetFile }) {
  return _th_066_collectContextShared(cwd, source, targetFile);
}

function _th_066_resolveQuestion(customQuestion, analysisGoal) {
  if (customQuestion) return customQuestion;
  if (analysisGoal && _TH_066_GOAL_PRESETS[analysisGoal]) return _TH_066_GOAL_PRESETS[analysisGoal];
  return _TH_066_GOAL_PRESETS["risk-assess"];
}

function _th_066_formatSnapshotAge(oldestTimestamp) {
  if (!oldestTimestamp) return "unknown";
  const ageMs = Date.now() - new Date(oldestTimestamp).getTime();
  const ageMins = Math.round(ageMs / 60_000);
  return ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
}

async function _callToolHandler_066_forge_quorum_analyze(request, args) {
  const { name } = request.params;
  if (!(name === "forge_quorum_analyze")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const source = args.source || "all";
      const customQuestion = args.customQuestion || null;
      const analysisGoal = args.analysisGoal || null;
      const quorumSize = Math.max(1, Math.min(10, parseInt(args.quorumSize) || 3));
      const targetFile = args.targetFile || null;
      const validationError = _th_066_validateCustomQuestion(customQuestion);
      if (validationError) {
        return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: validationError }) }], isError: true };
      }

      const { context, oldestTimestamp } = _th_066_collectQuorumContext({ cwd, source, targetFile });
      if (source !== "all" && !targetFile && Object.keys(context).length === 0) {
        const result = { quorumPrompt: null, error: `no ${source} data available — run the corresponding LiveGuard tool first` };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
      }

      const questionUsed = _th_066_resolveQuestion(customQuestion, analysisGoal);
      const votingInstruction = `Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= 60 and majority consensus. Quorum size: ${quorumSize} models.`;
      const quorumPrompt = `## Context\n${JSON.stringify(context, null, 2)}\n\n## Question\n${questionUsed}\n\n## Voting Instruction\n${votingInstruction}`;
      const qConfig = loadQuorumConfig(cwd);
      const suggestedModels = (qConfig.models || ["claude-opus-4.7", "grok-4.20", "gemini-3-pro-preview"]).slice(0, quorumSize);
      const result = {
        quorumPrompt,
        promptTokenEstimate: Math.ceil(quorumPrompt.length / 4),
        suggestedModels,
        dataSnapshotAge: _th_066_formatSnapshotAge(oldestTimestamp),
        questionUsed,
      };

      emitToolTelemetry("forge_quorum_analyze", args, { source, questionLength: questionUsed.length }, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_quorum_analyze", "OK", Date.now() - t0);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: `Quorum analyze error: ${err.message}` }) }], isError: true };
    }
  
}

function _th_067_resolveSmithCwd(args) {
  return args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
}

function _th_067_formatAge(ageMs) {
  if (ageMs <= 0) return "—";
  if (ageMs > 86_400_000) return `${Math.round(ageMs / 86_400_000)}d`;
  if (ageMs > 3_600_000) return `${Math.round(ageMs / 3_600_000)}h`;
  return `${Math.round(ageMs / 60_000)}m`;
}

async function _th_067_tryAppend(output, appendFn) {
  try {
    return await appendFn(output);
  } catch {
    return output;
  }
}

function _th_067_appendOnCallWarning(output, cwd) {
  const forgeJsonPath = resolve(cwd, ".forge.json");
  if (!existsSync(forgeJsonPath)) return output;
  const config = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
  if (!config.onCall) return output;
  const missing = [];
  if (!config.onCall.name) missing.push("name");
  if (!config.onCall.channel) missing.push("channel");
  return missing.length
    ? `${output}\n\n⚠️  .forge.json: onCall is configured but missing required field(s): ${missing.join(", ")}. Incident notifications may not route correctly.`
    : output;
}

function _th_067_appendReviewQueue(output, cwd) {
  const rqState = readReviewQueueState(cwd);
  if (!rqState) return output;
  const allItems = listReviewItems(cwd, { limit: 500 });
  const today = new Date().toISOString().slice(0, 10);
  const resolvedToday = allItems.filter((item) => item.resolvedAt?.startsWith(today)).length;
  const openItems = allItems.filter((item) => item.status === "open");
  const oldestOpen = openItems.reduce((maxAge, item) => {
    const age = Date.now() - new Date(item.createdAt).getTime();
    return age > maxAge ? age : maxAge;
  }, 0);
  return `${output}\n\nReview queue:\n  Open:            ${rqState.open}\n  Resolved today:  ${resolvedToday}\n  Oldest open age: ${_th_067_formatAge(oldestOpen)}`;
}

async function _th_067_appendNotifications(output, cwd) {
  const { loadNotificationsConfig } = await import("./notifications/core.mjs");
  const { parseEventsLog, findLatestRun } = await import("./orchestrator.mjs");
  const config = loadNotificationsConfig(cwd);
  const enabledAdapters = Object.entries(config.adapters || {}).filter(([, value]) => value.enabled).map(([key]) => key);
  const routeCount = (config.routes || []).length;
  let sentToday = 0;
  let failedToday = 0;
  try {
    const located = findLatestRun(cwd);
    if (located) {
      const today = new Date().toISOString().slice(0, 10);
      for (const event of parseEventsLog(located.runDir)) {
        if (!event.ts?.startsWith(today)) continue;
        if (event.type === "notification-sent") sentToday++;
        if (event.type === "notification-send-failed") failedToday++;
      }
    }
  } catch { /* events read error — skip */ }
  return `${output}\n\nNotifications:\n  Enabled adapters: ${enabledAdapters.length}${enabledAdapters.length ? ` (${enabledAdapters.join(", ")})` : ""}\n  Routes configured: ${routeCount}\n  Events sent today: ${sentToday}\n  Failures today:    ${failedToday}`;
}

function _th_067_loadDrainWarnConfig(cwd) {
  const drainWarnCfg = { count: 10, ageHours: 24 };
  try {
    const forgeJsonPath = resolve(cwd, ".forge.json");
    if (!existsSync(forgeJsonPath)) return drainWarnCfg;
    const config = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
    if (typeof config?.openbrain?.drainWarn?.count === "number") drainWarnCfg.count = config.openbrain.drainWarn.count;
    if (typeof config?.openbrain?.drainWarn?.ageHours === "number") drainWarnCfg.ageHours = config.openbrain.drainWarn.ageHours;
  } catch { /* use defaults */ }
  return drainWarnCfg;
}

function _th_067_countPendingQueueRecords(queuePath) {
  if (!existsSync(queuePath)) return [];
  const pendingRecords = [];
  for (const line of readFileSync(queuePath, "utf-8").split("\n").filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (record._status === "pending") pendingRecords.push(record);
    } catch { /* skip */ }
  }
  return pendingRecords;
}

function _th_067_findLastSyncAge(hubPath) {
  if (!existsSync(hubPath)) return "—";
  const hubLines = readFileSync(hubPath, "utf-8").split("\n").filter(Boolean).reverse();
  for (const line of hubLines) {
    try {
      const event = JSON.parse(line);
      if (event.type !== "openbrain-sync" && event.type !== "openbrain-flush") continue;
      return `${_th_067_formatAge(Date.now() - new Date(event.ts).getTime())} ago`;
    } catch { /* skip line */ }
  }
  return "—";
}

function _th_067_resolveL3StatusLine(cwd) {
  try {
    return isOpenBrainConfigured(cwd)
      ? `L3 OpenBrain:    \u2713 configured (Reflexion + Federation active)`
      : `L3 OpenBrain:    \u26A0 not configured \u2014 run 'pforge brain hint' or see https://srnichols.github.io/OpenBrain`;
  } catch {
    return "L3 OpenBrain:    (status check failed)";
  }
}

function _th_067_buildDrainWarning(cwd, pendingRecords) {
  if (pendingRecords.length === 0) return "";
  let oldestAgeMs = 0;
  for (const record of pendingRecords) {
    if (!record._enqueuedAt) continue;
    const age = Date.now() - new Date(record._enqueuedAt).getTime();
    if (age > oldestAgeMs) oldestAgeMs = age;
  }
  const drainWarnCfg = _th_067_loadDrainWarnConfig(cwd);
  const pendingTooMany = pendingRecords.length > drainWarnCfg.count;
  const pendingTooOld = oldestAgeMs / 3_600_000 > drainWarnCfg.ageHours;
  return (pendingTooMany || pendingTooOld)
    ? `\n  \u26A0 Drain:         ${pendingRecords.length} pending (oldest: ${_th_067_formatAge(oldestAgeMs)}). Run 'pforge drain-memory' or restart MCP.`
    : "";
}

function _th_067_appendMemory(output, cwd) {
  const forgeDir = resolve(cwd, ".forge");
  const l2DirCount = existsSync(forgeDir)
    ? readdirSync(forgeDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    : 0;
  const queuePath = resolve(forgeDir, "openbrain-queue.jsonl");
  const pendingRecords = _th_067_countPendingQueueRecords(queuePath);
  let memoryOutput = `${output}\n\nMemory:\n  L1 keys:         (session-scoped)\n  L2 store size:   ${l2DirCount} dirs\n  ${_th_067_resolveL3StatusLine(cwd)}\n  L3 queue depth:  ${pendingRecords.length}\n  L3 last sync:    ${_th_067_findLastSyncAge(resolve(forgeDir, "hub-events.jsonl"))}`;
  memoryOutput += _th_067_buildDrainWarning(cwd, pendingRecords);
  return memoryOutput;
}

async function _th_067_appendTestbed(output, cwd) {
  const { listScenarios } = await import("./testbed/scenarios.mjs");
  const { listFindings } = await import("./testbed/defect-log.mjs");
  let scenarioCount = 0;
  try {
    scenarioCount = listScenarios({ projectRoot: cwd }).length;
  } catch { /* no scenarios dir */ }
  let openFindings = [];
  try {
    openFindings = listFindings({ status: "open" }, { projectRoot: cwd });
  } catch { /* no findings dir */ }
  const bySeverity = {};
  for (const finding of openFindings) bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
  const sevStr = Object.keys(bySeverity).length
    ? Object.entries(bySeverity).map(([severity, count]) => `${count} ${severity}`).join(", ")
    : "none";
  return `${output}\n\nTestbed:\n  Scenarios:       ${scenarioCount}\n  Open findings:   ${openFindings.length} (${sevStr})`;
}

function _067_forge_smith_resolveCwd(args) {
  return args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
}

function _067_forge_smith_appendOnCallWarning(output, cwd) {
  try {
    const forgeJsonPath = resolve(cwd, ".forge.json");
    if (!existsSync(forgeJsonPath)) return output;
    const config = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
    if (!config.onCall) return output;
    const missing = [];
    if (!config.onCall.name) missing.push("name");
    if (!config.onCall.channel) missing.push("channel");
    return missing.length > 0
      ? `${output}\n\n⚠️  .forge.json: onCall is configured but missing required field(s): ${missing.join(", ")}. Incident notifications may not route correctly.`
      : output;
  } catch {
    return output;
  }
}

function _067_forge_smith_formatAge(ageMs) {
  if (!(ageMs > 0)) return "—";
  if (ageMs > 86400000) return `${Math.round(ageMs / 86400000)}d`;
  if (ageMs > 3600000) return `${Math.round(ageMs / 3600000)}h`;
  return `${Math.round(ageMs / 60000)}m`;
}

function _067_forge_smith_appendReviewQueue(output, cwd) {
  try {
    const rqState = readReviewQueueState(cwd);
    if (!rqState) return output;
    const allItems = listReviewItems(cwd, { limit: 500 });
    const today = new Date().toISOString().slice(0, 10);
    const resolvedToday = allItems.filter((item) => item.resolvedAt?.startsWith(today)).length;
    const openItems = allItems.filter((item) => item.status === "open");
    const oldestOpen = openItems.reduce((maxAge, item) => {
      const age = Date.now() - new Date(item.createdAt).getTime();
      return age > maxAge ? age : maxAge;
    }, 0);
    return `${output}\n\nReview queue:\n  Open:            ${rqState.open}\n  Resolved today:  ${resolvedToday}\n  Oldest open age: ${_067_forge_smith_formatAge(oldestOpen)}`;
  } catch {
    return output;
  }
}

async function _067_forge_smith_appendNotifications(output, cwd) {
  try {
    const { loadNotificationsConfig } = await import("./notifications/core.mjs");
    const { parseEventsLog, findLatestRun } = await import("./orchestrator.mjs");
    const nCfg = loadNotificationsConfig(cwd);
    const enabledAdapters = Object.entries(nCfg.adapters || {}).filter(([, value]) => value.enabled).map(([key]) => key);
    const routeCount = (nCfg.routes || []).length;
    let sentToday = 0;
    let failedToday = 0;
    try {
      const located = findLatestRun(cwd);
      if (located) {
        const today = new Date().toISOString().slice(0, 10);
        for (const event of parseEventsLog(located.runDir)) {
          if (!event.ts?.startsWith(today)) continue;
          if (event.type === "notification-sent") sentToday++;
          if (event.type === "notification-send-failed") failedToday++;
        }
      }
    } catch { /* events read error — skip */ }
    return `${output}\n\nNotifications:\n  Enabled adapters: ${enabledAdapters.length}${enabledAdapters.length ? ` (${enabledAdapters.join(", ")})` : ""}\n  Routes configured: ${routeCount}\n  Events sent today: ${sentToday}\n  Failures today:    ${failedToday}`;
  } catch {
    return output;
  }
}

function _067_forge_smith_getL2DirCount(forgeDir) {
  try {
    if (!existsSync(forgeDir)) return 0;
    return readdirSync(forgeDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

function _067_forge_smith_getPendingQueueRecords(forgeDir) {
  const queuePath = resolve(forgeDir, "openbrain-queue.jsonl");
  if (!existsSync(queuePath)) return [];
  const records = [];
  for (const line of readFileSync(queuePath, "utf-8").split("\n").filter(Boolean)) {
    try {
      const record = JSON.parse(line);
      if (record._status === "pending") records.push(record);
    } catch { /* skip */ }
  }
  return records;
}

function _067_forge_smith_getL3LastSync(forgeDir) {
  try {
    const hubPath = resolve(forgeDir, "hub-events.jsonl");
    if (!existsSync(hubPath)) return "—";
    const hubLines = readFileSync(hubPath, "utf-8").split("\n").filter(Boolean).reverse();
    for (const line of hubLines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "openbrain-sync" || event.type === "openbrain-flush") {
          return `${_067_forge_smith_formatAge(Date.now() - new Date(event.ts).getTime())} ago`;
        }
      } catch { /* skip line */ }
    }
  } catch { /* best-effort */ }
  return "—";
}

function _067_forge_smith_getL3StatusLine(cwd) {
  try {
    return isOpenBrainConfigured(cwd)
      ? "L3 OpenBrain:    ✓ configured (Reflexion + Federation active)"
      : "L3 OpenBrain:    ⚠ not configured — run 'pforge brain hint' or see https://srnichols.github.io/OpenBrain";
  } catch {
    return "L3 OpenBrain:    (status check failed)";
  }
}

function _067_forge_smith_getDrainWarnConfig(cwd) {
  const config = { count: 10, ageHours: 24 };
  try {
    const forgeJsonPath = resolve(cwd, ".forge.json");
    if (!existsSync(forgeJsonPath)) return config;
    const parsed = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
    if (typeof parsed?.openbrain?.drainWarn?.count === "number") config.count = parsed.openbrain.drainWarn.count;
    if (typeof parsed?.openbrain?.drainWarn?.ageHours === "number") config.ageHours = parsed.openbrain.drainWarn.ageHours;
  } catch { /* use defaults */ }
  return config;
}

function _067_forge_smith_getDrainWarning(cwd, forgeDir, pendingRecords) {
  if (pendingRecords.length === 0) return "";
  const drainWarnCfg = _067_forge_smith_getDrainWarnConfig(cwd);
  const oldestAgeMs = pendingRecords.reduce((maxAge, record) => {
    if (!record._enqueuedAt) return maxAge;
    const age = Date.now() - new Date(record._enqueuedAt).getTime();
    return age > maxAge ? age : maxAge;
  }, 0);
  const pendingTooMany = pendingRecords.length > drainWarnCfg.count;
  const pendingTooOld = oldestAgeMs / 3600000 > drainWarnCfg.ageHours;
  if (!(pendingTooMany || pendingTooOld)) return "";
  return `\n  ⚠ Drain:         ${pendingRecords.length} pending (oldest: ${_067_forge_smith_formatAge(oldestAgeMs)}). Run 'pforge drain-memory' or restart MCP.`;
}

function _067_forge_smith_appendMemory(output, cwd) {
  try {
    const forgeDir = resolve(cwd, ".forge");
    const pendingRecords = _067_forge_smith_getPendingQueueRecords(forgeDir);
    const memoryBlock = `\n\nMemory:\n  L1 keys:         (session-scoped)\n  L2 store size:   ${_067_forge_smith_getL2DirCount(forgeDir)} dirs\n  ${_067_forge_smith_getL3StatusLine(cwd)}\n  L3 queue depth:  ${pendingRecords.length}\n  L3 last sync:    ${_067_forge_smith_getL3LastSync(forgeDir)}`;
    return `${output}${memoryBlock}${_067_forge_smith_getDrainWarning(cwd, forgeDir, pendingRecords)}`;
  } catch {
    return output;
  }
}

async function _067_forge_smith_appendTestbed(output, cwd) {
  try {
    const { listScenarios } = await import("./testbed/scenarios.mjs");
    const { listFindings } = await import("./testbed/defect-log.mjs");
    let scenarioCount = 0;
    let openFindings = [];
    try {
      scenarioCount = listScenarios({ projectRoot: cwd }).length;
    } catch { /* no scenarios dir */ }
    try {
      openFindings = listFindings({ status: "open" }, { projectRoot: cwd });
    } catch { /* no findings dir */ }
    const bySev = {};
    for (const finding of openFindings) bySev[finding.severity] = (bySev[finding.severity] || 0) + 1;
    const sevStr = Object.keys(bySev).length ? Object.entries(bySev).map(([key, value]) => `${value} ${key}`).join(", ") : "none";
    return `${output}\n\nTestbed:\n  Scenarios:       ${scenarioCount}\n  Open findings:   ${openFindings.length} (${sevStr})`;
  } catch {
    return output;
  }
}

async function _callToolHandler_067_forge_smith(request, args) {
  const { name } = request.params;
  if (!(name === "forge_smith")) return _CALL_TOOL_NO_MATCH;

    const result = executeTool(name, args || {});
    const cwd = _067_forge_smith_resolveCwd(args);
    let output = result.success ? result.output : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}`;
    output = _067_forge_smith_appendOnCallWarning(output, cwd);
    output = _067_forge_smith_appendReviewQueue(output, cwd);
    output = await _067_forge_smith_appendNotifications(output, cwd);
    output = _067_forge_smith_appendMemory(output, cwd);
    output = await _067_forge_smith_appendTestbed(output, cwd);
    return { content: [{ type: "text", text: output }], isError: !result.success };
  
}

async function _callToolHandler_068_forge_testbed_run(request, args) {
  const { name } = request.params;
  if (!(name === "forge_testbed_run")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { loadScenario, resolveTestbedPath } = await import("./testbed/scenarios.mjs");
      const { runScenario } = await import("./testbed/runner.mjs");
      const scenario = loadScenario(args.scenarioId, { projectRoot: cwd });
      const testbedPath = resolveTestbedPath({ testbedPath: args.testbedPath }, { projectRoot: cwd });
      const result = await runScenario(scenario, {
        hub: activeHub,
        projectRoot: cwd,
        captureMemoryFn: captureMemory,
        testbedPath,
        dryRun: args.dryRun || false,
      });
      emitToolTelemetry("forge_testbed_run", args, result, Date.now() - t0, result.status === "passed" ? "OK" : "FAIL", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: result.status !== "passed" };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_testbed_run", args, { error: err.message, code: err.code }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_TESTBED", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_069_forge_testbed_findings(request, args) {
  const { name } = request.params;
  if (!(name === "forge_testbed_findings")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { listFindings } = await import("./testbed/defect-log.mjs");
      const filter = {};
      if (args.status) filter.status = args.status;
      if (args.severity) filter.severity = args.severity;
      if (args.since) filter.since = args.since;
      const all = listFindings(filter, { projectRoot: cwd });
      const limit = Math.max(1, args.limit || 50);
      const findings = all.slice(0, limit);
      const result = { findings, total: all.length, truncated: all.length > limit };
      emitToolTelemetry("forge_testbed_findings", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_testbed_findings", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Tool error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_070_forge_export_plan(request, args) {
  const { name } = request.params;
  if (!(name === "forge_export_plan")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
      const result = exportPlan(args.input, {
        phaseName: args.phaseName,
        outputPath: args.outputPath,
        sourceNote: args.sourceNote,
        cwd,
      });
      emitToolTelemetry("forge_export_plan", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_export_plan", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Tool error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_071_forge_sync_memories(request, args) {
  const { name } = request.params;
  if (!(name === "forge_sync_memories")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
      const result = syncMemories({
        projectRoot: cwd,
        dryRun:  args.dryRun  ?? false,
        force:   args.force   ?? false,
        limit:   args.limit   ?? 10,
        since:   args.since,
        output:  args.output,
      });
      emitToolTelemetry("forge_sync_memories", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_sync_memories", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Tool error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_072_forge_sync_instructions(request, args) {
  const { name } = request.params;
  if (!(name === "forge_sync_instructions")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
      const result = syncInstructions({
        projectRoot:   cwd,
        dryRun:        args.dryRun        ?? false,
        force:         args.force         ?? false,
        noPrinciples:  args.noPrinciples  ?? false,
        noProfile:     args.noProfile     ?? false,
        noExtras:      args.noExtras      ?? false,
        output:        args.output,
      });
      emitToolTelemetry("forge_sync_instructions", args, result, Date.now() - t0, result.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_sync_instructions", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Tool error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_073_forge_testbed_happypath(request, args) {
  const { name } = request.params;
  if (!(name === "forge_testbed_happypath")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { listScenarios, loadScenario, resolveTestbedPath } = await import("./testbed/scenarios.mjs");
      const { runScenario } = await import("./testbed/runner.mjs");
      const allScenarios = listScenarios({ projectRoot: cwd });
      const happyPathIds = allScenarios.filter(s => s.kind === "happy-path").map(s => s.scenarioId);

      const testbedPath = resolveTestbedPath({ testbedPath: args.testbedPath }, { projectRoot: cwd });
      const results = [];
      let passed = 0;
      let failed = 0;

      for (const id of happyPathIds) {
        let scenario;
        try {
          scenario = loadScenario(id, { projectRoot: cwd });
        } catch (loadErr) {
          results.push({ scenarioId: id, status: "load-error", error: loadErr.message, code: loadErr.code });
          failed++;
          continue;
        }
        try {
          const res = await runScenario(scenario, {
            hub: activeHub,
            projectRoot: cwd,
            captureMemoryFn: captureMemory,
            testbedPath,
            dryRun: args.dryRun || false,
          });
          results.push(res);
          if (res.status === "passed") passed++;
          else failed++;
        } catch (runErr) {
          results.push({ scenarioId: id, status: "error", error: runErr.message, code: runErr.code });
          failed++;
        }
      }

      // ── Module-based in-process scenarios (Phase-MEMORY-QA-PLAN Slice 6) ──
      let moduleScenarios = [];
      try {
        const { REGISTERED_SCENARIOS } = await import("./testbed/scenarios/index.mjs");
        moduleScenarios = Array.isArray(REGISTERED_SCENARIOS)
          ? REGISTERED_SCENARIOS.filter(s => s.kind === "happy-path")
          : [];
      } catch { /* scenarios/index.mjs not yet present — silent skip */ }

      for (const modScenario of moduleScenarios) {
        try {
          const res = await modScenario.run({ hub: activeHub, projectRoot: cwd });
          results.push({ scenarioId: modScenario.scenarioId, ...res });
          if (res.ok && res.status === "passed") passed++;
          else failed++;
        } catch (runErr) {
          results.push({ scenarioId: modScenario.scenarioId, status: "error", error: runErr.message });
          failed++;
        }
      }

      const total = happyPathIds.length + moduleScenarios.length;
      const summary = { passed, failed, total, results };
      const status = failed === 0 && total > 0 ? "OK" : "FAIL";
      emitToolTelemetry("forge_testbed_happypath", args, summary, Date.now() - t0, status, cwd);
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], isError: failed > 0 };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_testbed_happypath", args, { error: err.message, code: err.code }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_TESTBED", message: err.message }) }], isError: true };
    }
  
}

async function _callToolHandler_074_forge_master_ask(request, args) {
  const { name } = request.params;
  if (!(name === "forge_master_ask")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!args.message || typeof args.message !== "string") {
        return { content: [{ type: "text", text: "forge_master_ask: message (string) is required" }], isError: true };
      }

      // ── Proxy path: route through pforge-master/server.mjs if available ──
      const studio = await getOrSpawnStudioChild();
      if (studio) {
        try {
          const proxyResult = await studio.invoke("forge_master_ask", args);
          const text = typeof proxyResult === "string" ? proxyResult : JSON.stringify(proxyResult, null, 2);
          emitToolTelemetry("forge_master_ask", args, { proxied: true }, Date.now() - t0, "OK", cwd);
          return { content: [{ type: "text", text }] };
        } catch (proxyErr) {
          console.error(`forge-master: proxy error, falling back in-process: ${proxyErr.message}`);
          setStudioClient(null); // reset so next call retries
        }
      }

      // ── Fallback: in-process reasoning ──
      const { runTurn, loadPrefs } = await import("./forge-master/index.mjs");
      const { TOOL_METADATA } = await import("./capabilities.mjs");
      const prefs = loadPrefs(cwd);
      const result = await runTurn(
        {
          message: args.message,
          sessionId: args.sessionId || undefined,
          maxToolCalls: args.maxToolCalls || undefined,
          tier: prefs.tier || undefined,
          cwd,
        },
        {
          dispatcher: async (toolName, toolArgs, toolCwd) => {
            return invokeForgeTool(toolName, { ...toolArgs, path: toolCwd || cwd });
          },
          hub: activeHub || null,
          toolMetadata: TOOL_METADATA,
        },
      );
      emitToolTelemetry("forge_master_ask", args, {
        sessionId: result.sessionId,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        toolCallCount: result.toolCalls?.length ?? 0,
        truncated: result.truncated,
      }, Date.now() - t0, result.error ? "ERROR" : "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_master_ask", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Forge-Master error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_075_forge_meta_bug_file(request, args) {
  const { name } = request.params;
  if (!(name === "forge_meta_bug_file")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { fileMetaBug, META_BUG_CLASSES } = await import("./tempering/bug-adapters/github.mjs");

      // Validate class enum
      if (!args.class || !META_BUG_CLASSES.includes(args.class)) {
        const result = { ok: false, error: ERROR_CODES.INVALID_CLASS.code, validClasses: [...META_BUG_CLASSES] };
        emitToolTelemetry("forge_meta_bug_file", args, result, Date.now() - t0, "ERROR", cwd);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      if (!args.title || !args.symptom) {
        const result = { ok: false, error: ERROR_CODES.MISSING_REQUIRED_FIELDS.code };
        emitToolTelemetry("forge_meta_bug_file", args, result, Date.now() - t0, "ERROR", cwd);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      // Auto-pull trajectory excerpt when slice is provided
      let trajectoryExcerpt;
      if (args.slice) {
        try {
          const planStem = args.plan
            ? basename(args.plan, ".md").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
            : null;
          if (planStem) {
            const trajPath = resolve(cwd, ".forge", "trajectories", planStem, `slice-${args.slice}.md`);
            if (existsSync(trajPath)) {
              const lines = readFileSync(trajPath, "utf-8").split("\n");
              trajectoryExcerpt = lines.slice(-80).join("\n");
            }
          }
        } catch {
          // trajectory auto-pull is best-effort
        }
      }

      // Load config for GitHub token/repo resolution
      let config = {};
      try {
        config = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
      } catch {
        // proceed with empty config — fileMetaBug handles token resolution
      }

      const filerResult = await fileMetaBug(
        {
          class: args.class,
          title: args.title,
          symptom: args.symptom,
          workaround: args.workaround,
          filePaths: args.filePaths,
          slice: args.slice,
          plan: args.plan,
          severity: args.severity,
          trajectoryExcerpt,
        },
        config,
        { execSync, cwd },
      );

      emitToolTelemetry("forge_meta_bug_file", args, filerResult, Date.now() - t0, filerResult.ok ? "OK" : "ERROR", cwd);
      return { content: [{ type: "text", text: JSON.stringify(filerResult, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_meta_bug_file", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Meta-bug filing error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_076_forge_graph_query(request, args) {
  const { name } = request.params;
  if (!(name === "forge_graph_query")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { queryByPhase, queryByFile, queryRecentChanges, neighbors } = await import("./graph/query.mjs");
      const queryType = args.type || "recent-changes";
      let result;
      if (queryType === "phase") {
        result = queryByPhase(args.filter || "", { projectDir: cwd });
      } else if (queryType === "file") {
        result = queryByFile(args.filter || "", { projectDir: cwd });
      } else if (queryType === "neighbors") {
        result = neighbors(args.filter || "", { projectDir: cwd, edgeType: args.edgeType });
      } else {
        result = queryRecentChanges({ since: args.since, type: args.filter }, { projectDir: cwd });
      }
      emitToolTelemetry("forge_graph_query", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_graph_query", args, { error: err.message }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Graph query error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_077_forge_patterns_list(request, args) {
  const { name } = request.params;
  if (!(name === "forge_patterns_list")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const { runDetectors } = await import("./patterns/registry.mjs");
      let patterns = await runDetectors({ cwd });
      if (args.since) {
        const sinceDate = new Date(args.since);
        if (!isNaN(sinceDate.getTime())) {
          patterns = patterns.filter((p) => {
            if (!p.lastSeen) return true;
            return new Date(p.lastSeen) >= sinceDate;
          });
        }
      }
      emitToolTelemetry("forge_patterns_list", args, { count: patterns.length }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(patterns, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry("forge_patterns_list", args, { error: err.message }, durationMs, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `Pattern list error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_078_forge_delegate_review(request, args) {
  const { name } = request.params;
  if (!(name === "forge_delegate_review")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
      const result = delegateReview({ criteria: args.criteria, cwd });
      emitToolTelemetry("forge_delegate_review", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const isNoPr = err instanceof ReviewDelegateNoPrError;
      const isAuth = err instanceof ReviewDelegateAuthError;
      const code = isNoPr ? "NO_PR" : isAuth ? "AUTH_ERROR" : "DELEGATE_ERROR";
      const response = { ok: false, error: err.message, code };
      emitToolTelemetry("forge_delegate_review", args, response, Date.now() - t0, "ERROR", "");
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    }
  
}

async function _callToolHandler_079_forge_team_dashboard(request, args) {
  const { name } = request.params;
  if (!(name === "forge_team_dashboard")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
      const limit = Math.min(args.limit ?? 50, 200);
      const result = buildTeamDashboard({ storeDir: join(cwd, ".forge"), limit, since: args.since });
      emitToolTelemetry("forge_team_dashboard", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
    }
  
}

async function _callToolHandler_080_forge_team_activity(request, args) {
  const { name } = request.params;
  if (!(name === "forge_team_activity")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
      const limit = Math.min(args.limit ?? 20, 100);
      const activities = loadActivity({ storeDir: join(cwd, ".forge"), limit, since: args.since });
      const result = {
        ok: true,
        count: activities.length,
        activities,
        message: activities.length > 0
          ? `${activities.length} recent team activity entries`
          : "No team activity recorded yet. Team activity is recorded after each plan run.",
      };
      emitToolTelemetry("forge_team_activity", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: err.message }) }] };
    }
  
}

function _resolveForgeGithubMetricsRepoSlug(args, cwd) {
  let repoSlug = args.repo || null;
  if (repoSlug) return repoSlug;
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/\s]+\/[^\s.]+?)(?:\.git)?$/i);
    if (match) repoSlug = match[1];
  } catch { /* no remote */ }
  if (repoSlug) return repoSlug;
  try {
    return execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function _forgeGithubMetricsApi(cwd, apiPath) {
  try {
    return JSON.parse(execSync(`gh api ${apiPath}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    }));
  } catch {
    return null;
  }
}

function _countForgeGithubOpenPullRequests(cwd, repoSlug) {
  try {
    const prList = JSON.parse(execSync(`gh pr list --repo ${repoSlug} --state open --json number --limit 500`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    }));
    return prList.length;
  } catch {
    return null;
  }
}

function _countForgeGithubOpenIssues(cwd, repoSlug) {
  try {
    const issueList = JSON.parse(execSync(`gh issue list --repo ${repoSlug} --state open --json number --limit 500`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    }));
    return issueList.length;
  } catch {
    return null;
  }
}

function _summarizeForgeGithubCommitActivity(commitActivity, periodDays) {
  if (!Array.isArray(commitActivity)) return null;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const inPeriod = commitActivity.filter((week) => week.week * 1000 >= cutoff);
  return {
    weeksInPeriod: inPeriod.length,
    totalCommits: inPeriod.reduce((sum, week) => sum + (week.total || 0), 0),
  };
}

function _countForgeGithubContributors(cwd, repoSlug, contributors) {
  if (contributors === null) return null;
  try {
    const allContrib = JSON.parse(execSync(`gh api repos/${repoSlug}/contributors?per_page=100 --paginate`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    }));
    return Array.isArray(allContrib) ? allContrib.length : null;
  } catch {
    return Array.isArray(contributors) ? contributors.length : null;
  }
}

function _buildForgeGithubRepoMeta(repoData) {
  if (!repoData) return null;
  return {
    stars: repoData.stargazers_count ?? null,
    forks: repoData.forks_count ?? null,
    openIssuesFromApi: repoData.open_issues_count ?? null,
    defaultBranch: repoData.default_branch ?? null,
    language: repoData.language ?? null,
    visibility: repoData.visibility ?? null,
    createdAt: repoData.created_at ?? null,
    pushedAt: repoData.pushed_at ?? null,
  };
}

function _081_forge_github_metrics_runJson(cwd, command, timeout = 10000) {
  try {
    return JSON.parse(execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    }));
  } catch {
    return null;
  }
}

function _081_forge_github_metrics_resolveRepoSlug(cwd, argsRepo) {
  if (argsRepo) return argsRepo;
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/\s]+\/[^\s.]+?)(?:\.git)?$/i);
    if (match) return match[1];
  } catch { /* no remote */ }
  try {
    return execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function _081_forge_github_metrics_ghApi(cwd, apiPath) {
  return _081_forge_github_metrics_runJson(cwd, `gh api ${apiPath}`);
}

function _081_forge_github_metrics_loadOpenCount(cwd, repoSlug, kind) {
  const command = kind === "pr"
    ? `gh pr list --repo ${repoSlug} --state open --json number --limit 500`
    : `gh issue list --repo ${repoSlug} --state open --json number --limit 500`;
  const items = _081_forge_github_metrics_runJson(cwd, command);
  return Array.isArray(items) ? items.length : null;
}

function _081_forge_github_metrics_getCommitStats(commitActivity, periodDays) {
  if (!Array.isArray(commitActivity)) return null;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const inPeriod = commitActivity.filter((week) => week.week * 1000 >= cutoff);
  return {
    weeksInPeriod: inPeriod.length,
    totalCommits: inPeriod.reduce((sum, week) => sum + (week.total || 0), 0),
  };
}

function _081_forge_github_metrics_getContributorCount(cwd, repoSlug, contributors) {
  if (contributors === null) return null;
  const allContributors = _081_forge_github_metrics_runJson(cwd, `gh api repos/${repoSlug}/contributors?per_page=100 --paginate`, 15000);
  if (Array.isArray(allContributors)) return allContributors.length;
  return Array.isArray(contributors) ? contributors.length : null;
}

function _th_081_resolveRepoSlug(args, cwd) {
  let repoSlug = args.repo || null;
  if (!repoSlug) {
    try {
      const remoteUrl = execSync("git remote get-url origin", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
      }).trim();
      const match = remoteUrl.match(/github\.com[:/]([^/\s]+\/[^\s.]+?)(?:\.git)?$/i);
      if (match) repoSlug = match[1];
    } catch { /* no remote */ }
  }
  if (!repoSlug) {
    try {
      repoSlug = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
        cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5_000,
      }).trim();
    } catch { /* gh unavailable */ }
  }
  return repoSlug;
}

function _th_081_ghApi(cwd, apiPath) {
  try {
    return JSON.parse(execSync(`gh api ${apiPath}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }));
  } catch {
    return null;
  }
}

function _th_081_getOpenPullRequests(cwd, repoSlug) {
  try {
    const prList = JSON.parse(execSync(`gh pr list --repo ${repoSlug} --state open --json number --limit 500`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }));
    return prList.length;
  } catch {
    return null;
  }
}

function _th_081_getOpenIssues(cwd, repoSlug) {
  try {
    const issueList = JSON.parse(execSync(`gh issue list --repo ${repoSlug} --state open --json number --limit 500`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }));
    return issueList.length;
  } catch {
    return null;
  }
}

function _th_081_getCommitStats(cwd, repoSlug, periodDays) {
  const commitActivity = _th_081_ghApi(cwd, `repos/${repoSlug}/stats/commit_activity`);
  if (!Array.isArray(commitActivity)) return null;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const inPeriod = commitActivity.filter((week) => week.week * 1000 >= cutoff);
  return {
    weeksInPeriod: inPeriod.length,
    totalCommits: inPeriod.reduce((sum, week) => sum + (week.total || 0), 0),
  };
}

function _th_081_getContributorCount(cwd, repoSlug) {
  const contributors = _th_081_ghApi(cwd, `repos/${repoSlug}/contributors?per_page=1&anon=false`);
  if (contributors === null) return null;
  try {
    const allContrib = JSON.parse(execSync(`gh api repos/${repoSlug}/contributors?per_page=100 --paginate`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15_000,
    }));
    return Array.isArray(allContrib) ? allContrib.length : null;
  } catch {
    return Array.isArray(contributors) ? contributors.length : null;
  }
}

async function _callToolHandler_081_forge_github_metrics(request, args) {
  const { name } = request.params;
  if (!(name === "forge_github_metrics")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const period = args.period || "30d";
      const periodDays = period === "7d" ? 7 : period === "90d" ? 90 : 30;
      const repoSlug = _th_081_resolveRepoSlug(args, cwd);
      if (!repoSlug) {
        const notDetected = { ok: false, error: "REPO_NOT_DETECTED", hint: "Pass repo: 'owner/repo' or add a github.com remote." };
        emitToolTelemetry("forge_github_metrics", args, notDetected, Date.now() - t0, "ERROR", cwd);
        return { content: [{ type: "text", text: JSON.stringify(notDetected, null, 2) }], isError: true };
      }

      const repoData = _th_081_ghApi(cwd, `repos/${repoSlug}`);
      const result = {
        ok: true,
        repo: repoSlug,
        period,
        scannedAt: new Date().toISOString(),
        repoMeta: repoData ? {
          stars: repoData.stargazers_count ?? null,
          forks: repoData.forks_count ?? null,
          openIssuesFromApi: repoData.open_issues_count ?? null,
          defaultBranch: repoData.default_branch ?? null,
          language: repoData.language ?? null,
          visibility: repoData.visibility ?? null,
          createdAt: repoData.created_at ?? null,
          pushedAt: repoData.pushed_at ?? null,
        } : null,
        pullRequests: { open: _th_081_getOpenPullRequests(cwd, repoSlug) },
        issues: { open: _th_081_getOpenIssues(cwd, repoSlug) },
        commits: _th_081_getCommitStats(cwd, repoSlug, periodDays),
        contributors: _th_081_getContributorCount(cwd, repoSlug),
      };

      emitToolTelemetry("forge_github_metrics", args, { ok: true, repo: repoSlug }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_github_metrics", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `GitHub metrics error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_082_forge_anvil_stat(request, args) {
  const { name } = request.params;
  if (!(name === "forge_anvil_stat")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = anvilStat({ cwd });
      emitToolTelemetry("forge_anvil_stat", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_anvil_stat", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_anvil_stat error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_083_forge_anvil_clear(request, args) {
  const { name } = request.params;
  if (!(name === "forge_anvil_clear")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const opts = {};
      if (args.tool != null) opts.tool = String(args.tool);
      if (args.olderThanMs != null) opts.olderThanMs = Number(args.olderThanMs);
      const result = anvilClear(opts, { cwd });
      emitToolTelemetry("forge_anvil_clear", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const errPayload = { error: err.message, code: err.code || undefined };
      emitToolTelemetry("forge_anvil_clear", args, errPayload, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: JSON.stringify(errPayload, null, 2) }], isError: true };
    }
  
}

async function _callToolHandler_084_forge_anvil_rebuild(request, args) {
  const { name } = request.params;
  if (!(name === "forge_anvil_rebuild")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!args.since) {
        const errPayload = { error: "ERR_NO_SINCE", message: "'since' parameter (git SHA) is required" };
        return { content: [{ type: "text", text: JSON.stringify(errPayload, null, 2) }], isError: true };
      }
      const result = anvilRebuild({ since: String(args.since) }, { cwd });
      emitToolTelemetry("forge_anvil_rebuild", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_anvil_rebuild", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_anvil_rebuild error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_085_forge_anvil_dlq_list(request, args) {
  const { name } = request.params;
  if (!(name === "forge_anvil_dlq_list")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const opts = {};
      if (args.tool != null) opts.tool = String(args.tool);
      if (args.limit != null) opts.limit = Number(args.limit);
      const result = anvilDlqList(opts, { cwd });
      emitToolTelemetry("forge_anvil_dlq_list", args, { total: result.total }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_anvil_dlq_list", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_anvil_dlq_list error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_086_forge_anvil_dlq_drain(request, args) {
  const { name } = request.params;
  if (!(name === "forge_anvil_dlq_drain")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const opts = {};
      if (args.id != null) opts.id = String(args.id);
      if (args.tool != null) opts.tool = String(args.tool);
      const result = anvilDlqDrain(opts, { cwd });
      emitToolTelemetry("forge_anvil_dlq_drain", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_anvil_dlq_drain", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_anvil_dlq_drain error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_087_forge_hallmark_show(request, args) {
  const { name } = request.params;
  if (!(name === "forge_hallmark_show")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (args.id) {
        const record = readHallmark(String(args.id), { cwd });
        if (!record) {
          const notFound = { ok: false, error: "ERR_NOT_FOUND", id: args.id, message: `Hallmark '${args.id}' not found` };
          emitToolTelemetry("forge_hallmark_show", args, notFound, Date.now() - t0, "ERROR", cwd);
          return { content: [{ type: "text", text: JSON.stringify(notFound, null, 2) }], isError: true };
        }
        emitToolTelemetry("forge_hallmark_show", args, { ok: true, id: args.id }, Date.now() - t0, "OK", cwd);
        return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
      } else {
        // No id — list all
        const list = listHallmarks({}, { cwd });
        emitToolTelemetry("forge_hallmark_show", args, { ok: true, count: list.length }, Date.now() - t0, "OK", cwd);
        return { content: [{ type: "text", text: JSON.stringify({ hallmarks: list, count: list.length }, null, 2) }] };
      }
    } catch (err) {
      const isHallmarkErr = err instanceof HallmarkError;
      const errPayload = { ok: false, error: isHallmarkErr ? "ERR_INVALID_ID" : "ERR_UNEXPECTED", message: err.message };
      emitToolTelemetry("forge_hallmark_show", args, errPayload, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: JSON.stringify(errPayload, null, 2) }], isError: true };
    }
  
}

async function _callToolHandler_088_forge_hallmark_verify(request, args) {
  const { name } = request.params;
  if (!(name === "forge_hallmark_verify")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!args.id) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "ERR_NO_ID", message: "'id' is required" }, null, 2) }], isError: true };
      }
      const record = readHallmark(String(args.id), { cwd });
      if (!record) {
        const notFound = { ok: false, error: "ERR_NOT_FOUND", id: args.id, drift: null, message: `Hallmark '${args.id}' not found` };
        emitToolTelemetry("forge_hallmark_verify", args, notFound, Date.now() - t0, "ERROR", cwd);
        return { content: [{ type: "text", text: JSON.stringify(notFound, null, 2) }], isError: true };
      }
      // If the hallmark has a source field pointing to an existing file, re-hash and report drift
      let drift = false;
      let driftDetail = null;
      if (record.source && typeof record.source === "string") {
        const sourcePath = resolve(cwd, record.source);
        if (existsSync(sourcePath)) {
          try {
            const { createHash } = await import("node:crypto");
            const { readFileSync: rfs } = await import("node:fs");
            const currentHash = createHash("sha256").update(rfs(sourcePath)).digest("hex");
            if (record.sourceHash && record.sourceHash !== currentHash) {
              drift = true;
              driftDetail = { storedHash: record.sourceHash, currentHash };
            }
          } catch { /* hash failure is non-fatal */ }
        }
      }
      const result = {
        ok: true,
        id: record.id,
        drift,
        message: drift
          ? `Source file has changed since hallmark was written.`
          : record.source
            ? `Hallmark present; source file hash matches.`
            : `Hallmark present; no source file to verify.`,
        writtenAt: record.writtenAt,
        ...(driftDetail ? { driftDetail } : {}),
      };
      emitToolTelemetry("forge_hallmark_verify", args, { ok: true, id: record.id, drift }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const isHallmarkErr = err instanceof HallmarkError;
      const errPayload = { ok: false, error: isHallmarkErr ? "ERR_INVALID_ID" : "ERR_UNEXPECTED", message: err.message };
      emitToolTelemetry("forge_hallmark_verify", args, errPayload, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: JSON.stringify(errPayload, null, 2) }], isError: true };
    }
  
}

async function _callToolHandler_089_forge_pipelines_list(request, args) {
  const { name } = request.params;
  if (!(name === "forge_pipelines_list")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = pipelinesStats({ cwd });
      emitToolTelemetry("forge_pipelines_list", args, { count: result.pipelines.length }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_pipelines_list", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_pipelines_list error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_090_forge_lattice_index(request, args) {
  const { name } = request.params;
  if (!(name === "forge_lattice_index")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const paths = Array.isArray(args.paths) ? args.paths : ['.'];
      const since = typeof args.since === "string" && args.since ? args.since : undefined;
      const result = await latticeIndex({ paths, since, deps: { cwd } });
      emitToolTelemetry("forge_lattice_index", args, result, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_lattice_index", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_lattice_index error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_091_forge_lattice_stat(request, args) {
  const { name } = request.params;
  if (!(name === "forge_lattice_stat")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = latticeStat({ deps: { cwd } });
      emitToolTelemetry("forge_lattice_stat", args, { chunks: result.chunks, edges: result.edges }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_lattice_stat", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_lattice_stat error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_092_forge_lattice_query(request, args) {
  const { name } = request.params;
  if (!(name === "forge_lattice_query")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = latticeQuery({
        query: args.query || '',
        language: args.language,
        kind: args.kind,
        filePath: args.filePath,
        limit: args.limit != null ? Number(args.limit) : 25,
        deps: { cwd },
      });
      emitToolTelemetry("forge_lattice_query", args, { total: result.total }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_lattice_query", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_lattice_query error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_093_forge_lattice_callers(request, args) {
  const { name } = request.params;
  if (!(name === "forge_lattice_callers")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = latticeCallers({
        name: args.name,
        limit: args.limit != null ? Number(args.limit) : 25,
        deps: { cwd },
      });
      emitToolTelemetry("forge_lattice_callers", args, { total: result.total }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_lattice_callers", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_lattice_callers error: ${err.message}` }], isError: true };
    }
  
}

async function _callToolHandler_094_forge_lattice_blast(request, args) {
  const { name } = request.params;
  if (!(name === "forge_lattice_blast")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = latticeBlast({
        chunkId: args.chunkId,
        name: args.name,
        direction: args.direction || 'both',
        depth: args.depth != null ? Number(args.depth) : 3,
        limit: args.limit != null ? Number(args.limit) : 50,
        deps: { cwd },
      });
      emitToolTelemetry("forge_lattice_blast", args, { total: result.total }, Date.now() - t0, "OK", cwd);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry("forge_lattice_blast", args, { error: err.message }, Date.now() - t0, "ERROR", findProjectRoot(PROJECT_DIR));
      return { content: [{ type: "text", text: `forge_lattice_blast error: ${err.message}` }], isError: true };
    }
  
}
/* eslint-enable complexity */

const _CALL_TOOL_HANDLERS = [
  _callToolHandler_001_forge_run_plan,
  _callToolHandler_002_forge_abort,
  _callToolHandler_003_forge_plan_status,
  _callToolHandler_004_forge_diff_classify,
  _callToolHandler_005_forge_cost_report,
  _callToolHandler_006_forge_estimate_quorum,
  _callToolHandler_007_forge_estimate_slice,
  _callToolHandler_008_forge_health_trend,
  _callToolHandler_009_forge_alert_triage,
  _callToolHandler_010_forge_sweep,
  _callToolHandler_011_forge_analyze,
  _callToolHandler_012_forge_analyze,
  _callToolHandler_013_forge_diagnose,
  _callToolHandler_014_forge_capabilities,
  _callToolHandler_015_forge_watch,
  _callToolHandler_016_forge_watch_live,
  _callToolHandler_017_forge_memory_report,
  _callToolHandler_018_forge_skill_status,
  _callToolHandler_019_forge_run_skill,
  _callToolHandler_020_forge_org_rules,
  _callToolHandler_021_forge_crucible_submit,
  _callToolHandler_022_forge_crucible_ask,
  _callToolHandler_023_forge_crucible_preview,
  _callToolHandler_024_forge_crucible_finalize,
  _callToolHandler_025_forge_crucible_list,
  _callToolHandler_026_forge_crucible_abandon,
  _callToolHandler_027_forge_crucible_import,
  _callToolHandler_028_forge_crucible_status,
  _callToolHandler_029_forge_tempering_scan,
  _callToolHandler_030_forge_tempering_status,
  _callToolHandler_031_forge_tempering_run,
  _callToolHandler_032_forge_tempering_approve_baseline,
  _callToolHandler_033_forge_tempering_drain,
  _callToolHandler_034_forge_triage_route,
  _callToolHandler_035_forge_classifier_issue,
  _callToolHandler_036_forge_bug_register,
  _callToolHandler_037_forge_bug_list,
  _callToolHandler_038_forge_bug_update_status,
  _callToolHandler_039_forge_bug_validate_fix,
  _callToolHandler_040_forge_memory_capture,
  _callToolHandler_041_forge_brain_test,
  _callToolHandler_042_forge_brain_replay,
  _callToolHandler_043_forge_generate_image,
  _callToolHandler_044_forge_incident_capture,
  _callToolHandler_045_forge_deploy_journal,
  _callToolHandler_046_forge_regression_guard,
  _callToolHandler_047_forge_drift_report,
  _callToolHandler_048_forge_runbook,
  _callToolHandler_049_forge_hotspot,
  _callToolHandler_050_forge_dep_watch,
  _callToolHandler_051_forge_diff_classify,
  _callToolHandler_052_forge_secret_scan,
  _callToolHandler_053_forge_env_diff,
  _callToolHandler_054_forge_fix_proposal,
  _callToolHandler_055_forge_liveguard_run,
  _callToolHandler_056_forge_home_snapshot,
  _callToolHandler_057_forge_review_add,
  _callToolHandler_058_forge_review_list,
  _callToolHandler_059_forge_review_resolve,
  _callToolHandler_060_forge_delegate_to_agent,
  _callToolHandler_061_forge_notify_send,
  _callToolHandler_062_forge_notify_test,
  _callToolHandler_063_forge_search,
  _callToolHandler_064_forge_timeline,
  _callToolHandler_065_forge_doctor_quorum,
  _callToolHandler_066_forge_quorum_analyze,
  _callToolHandler_067_forge_smith,
  _callToolHandler_068_forge_testbed_run,
  _callToolHandler_069_forge_testbed_findings,
  _callToolHandler_070_forge_export_plan,
  _callToolHandler_071_forge_sync_memories,
  _callToolHandler_072_forge_sync_instructions,
  _callToolHandler_073_forge_testbed_happypath,
  _callToolHandler_074_forge_master_ask,
  _callToolHandler_075_forge_meta_bug_file,
  _callToolHandler_076_forge_graph_query,
  _callToolHandler_077_forge_patterns_list,
  _callToolHandler_078_forge_delegate_review,
  _callToolHandler_079_forge_team_dashboard,
  _callToolHandler_080_forge_team_activity,
  _callToolHandler_081_forge_github_metrics,
  _callToolHandler_082_forge_anvil_stat,
  _callToolHandler_083_forge_anvil_clear,
  _callToolHandler_084_forge_anvil_rebuild,
  _callToolHandler_085_forge_anvil_dlq_list,
  _callToolHandler_086_forge_anvil_dlq_drain,
  _callToolHandler_087_forge_hallmark_show,
  _callToolHandler_088_forge_hallmark_verify,
  _callToolHandler_089_forge_pipelines_list,
  _callToolHandler_090_forge_lattice_index,
  _callToolHandler_091_forge_lattice_stat,
  _callToolHandler_092_forge_lattice_query,
  _callToolHandler_093_forge_lattice_callers,
  _callToolHandler_094_forge_lattice_blast,
];

export const callToolRequestHandler = _wrapWithToolSpan(async (request) => {
  const { name, arguments: args } = request.params;

  // ─── Auth gate — open-by-default when .forge/rbac.json is absent ───
  const authDenied = await _mcpAuthGate(name, request);
  if (authDenied) return authDenied;

  // ─── Async orchestrator tools ───
    for (const handler of _CALL_TOOL_HANDLERS) {
    const handled = await handler(request, args);
    if (handled !== _CALL_TOOL_NO_MATCH) return handled;
  }

const result = executeTool(name, args || {});

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? result.output
          : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}`,
      },
    ],
    isError: !result.success,
  };
});


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


// REST API: POST /api/tool/:name — invoke forge tool
// MCP-only tools route through internal handler; CLI tools proxy through pforge.ps1
export const MCP_ONLY_TOOLS = new Set([
  "forge_liveguard_run", "forge_quorum_analyze", "forge_health_trend",
  "forge_alert_triage", "forge_drift_report", "forge_regression_guard",
  "forge_incident_capture", "forge_deploy_journal", "forge_dep_watch",
  "forge_diff_classify", "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
  "forge_hotspot", "forge_runbook", "forge_run_plan", "forge_cost_report",
  // Phase-27.1 Slice 2b — forge_estimate_quorum was registered in
  // capabilities.mjs/tools.json/switch case/handler in Phase-27 Slice 6 but
  // missed this Set, so /api/tool/forge_estimate_quorum fell through to
  // runPforge() (no CLI counterpart). Added here so the HTTP bridge reaches
  // the MCP handler.
  "forge_estimate_quorum",
  // Phase-27.2 Slice 3 — forge_estimate_slice is MCP-native (no CLI
  // counterpart). Adding here so /api/tool/forge_estimate_slice reaches
  // the MCP handler instead of falling through to runPforge().
  "forge_estimate_slice",
  "forge_capabilities", "forge_memory_capture",
  // Phase TEMPER-01 Slice 01.2 — Tempering tools handle their own IO
  // via tempering.mjs; they are MCP-native and must not be shelled
  // through pforge.ps1 (which has no Tempering command).
  "forge_tempering_scan", "forge_tempering_status",
  // Phase TEMPER-02 Slice 02.1 — execution harness owns its own
  // subprocess boundary; must not shell through pforge.ps1.
  "forge_tempering_run",
  // Phase TEMPER-04 Slice 04.1 — baseline promotion is MCP-native.
  "forge_tempering_approve_baseline",
  // Phase TEMPER-06 Slice 06.1 — Bug registry tools are MCP-native.
  "forge_bug_register", "forge_bug_list", "forge_bug_update_status",
  // Phase TEMPER-06 Slice 06.3 — Closed-loop validation is MCP-native.
  "forge_bug_validate_fix",
  // Phase FORGE-SHOP-01 Slice 01.1 — Home snapshot is MCP-native read-only.
  "forge_home_snapshot",
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools are MCP-native.
  "forge_review_add", "forge_review_list", "forge_review_resolve",
  // Phase TEMPER-07 Slice 07.1 — Agent delegation is MCP-native.
  "forge_delegate_to_agent",
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools are MCP-native.
  "forge_notify_send", "forge_notify_test",
  // Phase FORGE-SHOP-04 Slice 04.1 — Search is MCP-native read-only.
  "forge_search",
  // Phase FORGE-SHOP-05 Slice 05.1 — Timeline is MCP-native read-only.
  "forge_timeline",
  // Issue #73 — Doctor quorum is MCP-native read-only.
  "forge_doctor_quorum",
  // Phase TESTBED-01 Slice 01 — Testbed runner is MCP-native.
  "forge_testbed_run",
  // Phase TESTBED-02 Slice 01 — Testbed happypath runner is MCP-native.
  "forge_testbed_happypath",
  // Phase-28.3 Slice 03 — Self-repair meta-bug filer is MCP-native.
  "forge_meta_bug_file",
  // Phase-38.3 — Knowledge graph query is MCP-native.
  "forge_graph_query",
  // Phase-38.6 — Pattern list is MCP-native.
  "forge_patterns_list",
  // Phase GITHUB-D — GitHub metrics is MCP-native.
  "forge_github_metrics",
  // Phase-TEAM-ACTIVITY — Team activity feed is MCP-native.
  // Phase-TEAM-DASHBOARD — Team coordination dashboard is MCP-native.
  "forge_team_dashboard",
  "forge_team_activity",
  // Phase CLASSIFIER-ISSUE — Classifier-lane GitHub issue filer is MCP-native.
  "forge_classifier_issue",
  // D6 — Agentic code review delegation is MCP-native.
  "forge_delegate_review",
  // Phase-ANVIL Slice 6 — Anvil + Hallmark + Pipelines tools are MCP-native.
  "forge_anvil_stat",
  "forge_anvil_clear",
  "forge_anvil_rebuild",
  "forge_anvil_dlq_list",
  "forge_anvil_dlq_drain",
  "forge_hallmark_show",
  "forge_hallmark_verify",
  "forge_pipelines_list",
  // Phase LATTICE Slice 7 — Lattice code-graph tools are MCP-native.
  "forge_lattice_index",
  "forge_lattice_stat",
  "forge_lattice_query",
  "forge_lattice_callers",
  "forge_lattice_blast",
  // Issue #134 — Crucible tools are MCP-native (handled by switch-case
  // in CallToolRequestSchema). Without these in the allowlist,
  // POST /api/tool/forge_crucible_* falls through to runPforge() which
  // has no Crucible CLI commands and returns "Unknown command".
  "forge_crucible_submit",
  "forge_crucible_ask",
  "forge_crucible_preview",
  "forge_crucible_finalize",
  "forge_crucible_list",
  "forge_crucible_abandon",
  "forge_crucible_import",
  "forge_crucible_status",
  // Roadmap C2 — forge_export_plan is MCP-native (no CLI shell equivalent).
  "forge_export_plan",
  // Roadmap C3 — forge_sync_memories is MCP-native (CLI also available via pforge sync-memories).
  "forge_sync_memories",
  // v3.0.0 — forge_sync_instructions is MCP-native (CLI also available via pforge sync-instructions).
  "forge_sync_instructions",
]);
