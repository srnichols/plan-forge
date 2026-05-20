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

async function _callToolHandler_044_forge_incident_capture(request, args) {
  const { name } = request.params;
  if (!(name === "forge_incident_capture")) return _CALL_TOOL_NO_MATCH;

  try {
    const t0 = Date.now();
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const validation = _044_forge_incident_capture_validateArgs(args);
    if (validation.response) return validation.response;
    const { severity, capturedAt, mttr } = validation;
    const record = _044_forge_incident_capture_buildRecord({ args: args, cwd: cwd, severity: severity, capturedAt: capturedAt, mttr: mttr });
    _044_forge_incident_capture_notify({ args: args, cwd: cwd, severity: severity, capturedAt: capturedAt, record: record });
    emitToolTelemetry({ toolName: "forge_incident_capture", inputs: args, result: record, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_deploy_journal", inputs: args, result: record, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_regression_guard", inputs: args, result: result, durationMs: Date.now() - t0, status: result.success ? "ok" : "error", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_drift_report", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_runbook", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_hotspot", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_dep_watch", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_diff_classify", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_diff_classify", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_secret_scan", inputs: args, result: graceful, durationMs: Date.now() - t0, status: "DEGRADED", cwd: cwd });
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
        emitToolTelemetry({ toolName: "forge_secret_scan", inputs: args, result: diffResult.graceful, durationMs: Date.now() - t0, status: "DEGRADED", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_secret_scan", inputs: args, result: {
        clean: result.clean,
        findings: findings.length,
        scannedFiles: scannedFiles.size,
      }, durationMs: Date.now() - t0, status: "OK", cwd });
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
        emitToolTelemetry({ toolName: "forge_env_diff", inputs: args, result: graceful, durationMs: Date.now() - t0, status: "DEGRADED", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_env_diff", inputs: args, result: { clean, totalGaps, filesCompared: targetFiles.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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

function _th_054_maybeQueueReview({ cwd, slices, fixId, planName, sourceData }) {
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

function _054_forge_fix_proposal_maybeQueueReview({ cwd, fixId, planName, sourceType, slices }) {
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
  _054_forge_fix_proposal_maybeQueueReview({ cwd: cwd, fixId: fixId, planName: planName, sourceType: sourceType, slices: slices });
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
      emitToolTelemetry({ toolName: "forge_fix_proposal", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_liveguard_run", inputs: args, result: report, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
    emitToolTelemetry({ toolName: "forge_home_snapshot", inputs: args, result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.ok,
    };
  
}

export {
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
};
