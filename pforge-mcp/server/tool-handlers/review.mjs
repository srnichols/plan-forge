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
      emitToolTelemetry({ toolName: "forge_review_add", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_review_list", inputs: args, result: { count: items.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_review_resolve", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
        emitToolTelemetry({ toolName: "forge_delegate_to_agent", inputs: args, result: result, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
        return { content: [{ type: "text", text: JSON.stringify(result) }], isError: true };
      }

      const route = resolveRoute({ ...bug, type: deriveBugType(bug) });
      if (!route) {
        const result = { ok: true, routed: false, reason: "no-rule-matches", bugId: args.bugId };
        emitToolTelemetry({ toolName: "forge_delegate_to_agent", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      const prompt = buildAnalystPrompt(bug, route);
      let reviewItemId = null;

      if (!args.dryRun) {
        recordDelegation({ targetPath: cwd, bugId: args.bugId, route, mode: args.mode, reviewItemId: null });
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
      emitToolTelemetry({ toolName: "forge_delegate_to_agent", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_notify_send", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_notify_test", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_NOTIFY_TEST", message: err.message }) }], isError: true };
    }
  
}

export {
  _callToolHandler_057_forge_review_add,
  _callToolHandler_058_forge_review_list,
  _callToolHandler_059_forge_review_resolve,
  _callToolHandler_060_forge_delegate_to_agent,
  _callToolHandler_061_forge_notify_send,
  _callToolHandler_062_forge_notify_test,
};
