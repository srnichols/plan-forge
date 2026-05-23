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

async function _callToolHandler_029_forge_tempering_scan(request, args) {
  const { name } = request.params;
  if (!(name === "forge_tempering_scan")) return _CALL_TOOL_NO_MATCH;

    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await _temperingScanAnvilCompute(args, { _cwd: cwd, _hub: activeHub });
      emitToolTelemetry({ toolName: "forge_tempering_scan", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });

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
      emitToolTelemetry({ toolName: "forge_tempering_status", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_tempering_run", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });

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

      emitToolTelemetry({ toolName: "forge_tempering_approve_baseline", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_tempering_drain", inputs: args, result: response, durationMs: Date.now() - t0, status: response.ok ? "OK" : "ERROR", cwd: cwd });

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
      emitToolTelemetry({ toolName: "forge_triage_route", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: PROJECT_DIR });
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
        emitToolTelemetry({ toolName: "forge_classifier_issue", inputs: args, result: result, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: true };
      }
      let config = {};
      try { config = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8")); } catch { /* proceed without config */ }
      const result = await fileClassifierIssue(args.payload, config, { execSync, cwd, fetch: globalThis.fetch });
      emitToolTelemetry({ toolName: "forge_classifier_issue", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_classifier_issue", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
      return { content: [{ type: "text", text: `Classifier issue error: ${err.message}` }], isError: true };
    }

}

/**
 * Build a short skill-routing advisory for the bug-fix path.
 *
 * Returns a one-line hint pointing the agent at the most useful skill for the
 * next step in the bug lifecycle. Returns `null` when the bug shape doesn't
 * warrant a skill suggestion (so callers can spread conditionally and keep
 * the response payload sparse — ACI rule: no unsolicited fields).
 *
 * @param {object} input
 * @param {"registered"|"in-fix"|"validated-pass"|"validated-fail"} input.stage
 * @param {object} input.bug - the bug record (or a partial with scanner/classification)
 * @returns {string|null}
 */
export function buildBugFixSkillAdvisory({ stage, bug }) {
  if (!bug || typeof stage !== "string") return null;
  const scanner = Array.isArray(bug.scanner) ? bug.scanner[0] : bug.scanner;
  const cls = bug.classification;

  // Non-real-bug classifications get their own concise routing.
  if (cls === "flake") {
    return stage === "validated-pass"
      ? "Flake-class bug — keep /test-sweep on the suspect test for several runs to confirm stability"
      : "Flake-class bug — /forge-troubleshoot before assuming a code-side fix is needed";
  }
  if (cls === "infra") {
    return "Infra-class bug — the fix may live in CI / runner config rather than product code";
  }

  // real-bug (and unset classification — treat as real-bug for the advisory)
  switch (stage) {
    case "registered":
      return "Run /code-review on the affected file(s) before transitioning to in-fix — surfaces collateral issues so they can be fixed together";
    case "in-fix":
      if (scanner === "mutation") return "Mutation-class bug — consider /forge-quench to clarify the logic before patching";
      if (scanner === "visual-diff" || scanner === "ui-playwright") return "UI / visual bug — write the failing test first; /code-review the rendering path";
      if (scanner === "load-stress" || scanner === "performance-budget") return "Performance-class bug — profile before patching; /code-review for hot-path allocations";
      if (scanner === "contract") return "API contract bug — verify consumer-side impact before patching";
      return "Run /code-review on the affected file(s) before implementing; write the failing test first (TDD)";
    case "validated-pass":
      return "Verdict 'fixed' covers only the original scanner. Run /test-sweep to catch regressions in unrelated tests";
    case "validated-fail":
      if (scanner === "mutation") return "Still failing — /forge-quench: the surviving mutant may indicate logic that needs clarification, not just a patch";
      return "Still failing — re-read bug.evidence; consider /code-review on the patch to spot what was missed";
    default:
      return null;
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
      const skillAdvisory = result.ok
        ? buildBugFixSkillAdvisory({ stage: "registered", bug: { scanner: args.scanner, classification: classification.classification } })
        : null;
      const response = skillAdvisory ? { ...result, skillAdvisory } : result;
      emitToolTelemetry({ toolName: "forge_bug_register", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
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
      emitToolTelemetry({ toolName: "forge_bug_list", inputs: args, result: { count: bugs.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      // Surface a skill-routing advisory when the agent is starting the fix
      // (open → in-fix). Other transitions are mechanical and don't need a hint.
      let skillAdvisory = null;
      if (result.ok && newStatus === "in-fix") {
        const bug = loadBug(cwd, args.bugId);
        if (bug) skillAdvisory = buildBugFixSkillAdvisory({ stage: "in-fix", bug });
      }
      const response = skillAdvisory ? { ...result, skillAdvisory } : result;
      emitToolTelemetry({ toolName: "forge_bug_update_status", inputs: args, result: result, durationMs: Date.now() - t0, status: result.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
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
      if (e.code === ERROR_CODES.SCANNER_UNAVAILABLE.code) {
        return { results, scannerUnavailable: { scanner: s, message: e.message } };
      }
      results.push({ scanner: s, passed: false, error: e.message });
    }
  }
  return { results, scannerUnavailable: null };
}

async function _onBugValidatedFixed({ bugId, bug, scanners, attempt, cwd }) {
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

async function _finalizeBugValidationPass({ cwd, bugId, bug, scanners, attempt }) {
  await updateBugStatus(cwd, bugId, "fixed", {
    note: "Validated by forge_bug_validate_fix",
    validatedAt: new Date().toISOString(),
    validationMethod: "scanner-rerun",
  });
  try {
    const updatedBug = loadBug(cwd, bugId);
    await dispatchBugAdapter("commentValidatedFix", updatedBug || bug, {}, { cwd });
  } catch { /* adapter dispatch is advisory */ }
  await _onBugValidatedFixed({ bugId: bugId, bug: bug, scanners: scanners, attempt: attempt, cwd: cwd });
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

function _039_forge_bug_validate_fix_finalizeAttempt({ cwd, bugId, bug, advisory, scanners, attempt, results }) {
  const allPassed = results.every((result) => result.passed);
  attempt.result = allPassed ? "pass" : "fail";
  attempt.details = results;
  appendValidationAttempt(cwd, bugId, attempt);
  const skillAdvisory = buildBugFixSkillAdvisory({
    stage: allPassed ? "validated-pass" : "validated-fail",
    bug: bug || {},
  });
  return {
    allPassed,
    result: {
      bugId,
      verdict: allPassed ? "fixed" : "still-failing",
      scanners,
      attempt,
      validationDetails: results,
      ...(advisory ? { advisory } : {}),
      ...(skillAdvisory ? { skillAdvisory } : {}),
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
    const finalized = _039_forge_bug_validate_fix_finalizeAttempt({ cwd: cwd, bugId: args.bugId, bug: bug, advisory: advisory, scanners: scanners, attempt: attempt, results: results });
    if (finalized.allPassed) await _finalizeBugValidationPass({ cwd: cwd, bugId: args.bugId, bug: bug, scanners: scanners, attempt: attempt });
    emitToolTelemetry({ toolName: "forge_bug_validate_fix", inputs: args, result: finalized.result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
    return { content: [{ type: "text", text: JSON.stringify(finalized.result, null, 2) }], isError: false };
  } catch (err) {
    return { content: [{ type: "text", text: `Bug validation error: ${err.message}` }], isError: true };
  }
}

export {
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
};
