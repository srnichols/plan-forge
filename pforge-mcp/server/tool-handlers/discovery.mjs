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
      emitToolTelemetry({ toolName: "forge_search", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_search", inputs: args, result: { error: err.message }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_timeline", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_timeline", inputs: args, result: { error: err.message }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_doctor_quorum", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: findProjectRoot(PROJECT_DIR) });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_doctor_quorum", inputs: args, result: { error: err.message }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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

      emitToolTelemetry({ toolName: "forge_quorum_analyze", inputs: args, result: { source, questionLength: questionUsed.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_testbed_run", inputs: args, result: result, durationMs: Date.now() - t0, status: result.status === "passed" ? "OK" : "FAIL", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: result.status !== "passed" };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_testbed_run", inputs: args, result: { error: err.message, code: err.code }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_testbed_findings", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_testbed_findings", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_export_plan", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_export_plan", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_sync_memories", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_sync_memories", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_sync_instructions", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_sync_instructions", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_testbed_happypath", inputs: args, result: summary, durationMs: Date.now() - t0, status: status, cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }], isError: failed > 0 };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_testbed_happypath", inputs: args, result: { error: err.message, code: err.code }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
      return { content: [{ type: "text", text: JSON.stringify({ error: err.code || "ERR_TESTBED", message: err.message }) }], isError: true };
    }
  
}

export {
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
};
