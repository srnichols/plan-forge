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

async function _callToolHandler_021_forge_crucible_submit(request, args) {
  const { name } = request.params;
  if (!(name === "forge_crucible_submit")) return _CALL_TOOL_NO_MATCH;

    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleSubmit({
        rawIdea: args.rawIdea,
        mode: args.mode,
        lane: args.lane,
        bugId: args.bugId,
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

export {
  _callToolHandler_021_forge_crucible_submit,
  _callToolHandler_022_forge_crucible_ask,
  _callToolHandler_023_forge_crucible_preview,
  _callToolHandler_024_forge_crucible_finalize,
  _callToolHandler_025_forge_crucible_list,
  _callToolHandler_026_forge_crucible_abandon,
  _callToolHandler_027_forge_crucible_import,
  _callToolHandler_028_forge_crucible_status,
};
