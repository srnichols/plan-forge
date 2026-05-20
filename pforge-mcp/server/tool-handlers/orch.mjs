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

import {
  _CALL_TOOL_NO_MATCH,
  _resolveToolCwd,
  _parsePlanArg,
  _parseQuorumMode,
  _buildRunPlanOptions,
  _handleRunPlanMemoryCapture,
} from "./shared.mjs";
import {
  planNameToRunbookName,
  generateRunbook,
  executeTool,
  invokeForgeTool,
  searchOpenBrainL3,
} from "./core.mjs";

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
      const { parsePlan } = await import("../../orchestrator.mjs");
      const { estimateQuorum } = await import("../../cost-service.mjs");
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
      const { parsePlan } = await import("../../orchestrator.mjs");
      const { estimateSlice } = await import("../../cost-service.mjs");
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
      emitToolTelemetry({ toolName: "forge_health_trend", inputs: args, result: report, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_alert_triage", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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

export {
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
};
