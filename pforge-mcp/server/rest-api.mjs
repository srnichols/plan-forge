import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync, renameSync, createWriteStream } from "node:fs";
import { resolve, join, dirname, basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";


import { parsePlan, runPlan, detectWorkers, getCostReport, getHealthTrend, analyzeWithQuorum, generateImage, runAnalyze, readForgeJson, readForgeJsonl, appendForgeJsonl, emitToolTelemetry, regressionGuard, runPostSliceHook, resetPostSliceHookFired, runPreAgentHandoffHook, postOpenClawSnapshot, loadOpenClawConfig, loadQuorumConfig, runWatch, runWatchLive, readCrucibleState, readHomeSnapshot, addReviewItem, resolveReviewItem, listReviewItems, readReviewQueueState, maybeAddFixPlanReview, assessQuorumViability, detectExecutionRuntime, PROPOSED_FIX_DIR, detectCostAnomaly, computeMedian, spawnWorker } from "../orchestrator.mjs";
// Phase FORGE-SHOP-07 Slice 07.2 — brain facade for unified recall
import { recall as brainRecall, getReviewerCalibration, federationReadTrajectories, loadFederationConfig, validateFederationConfig, TRAJECTORY_FEDERATION_LIMIT, readHallmark, listHallmarks, validateHallmarkId, HallmarkError } from "../brain.mjs";
// Phase ANVIL Slice 5 — Δ-only memoization wrapper for read-only tools
import { withAnvil, anvilStat, anvilClear, anvilRebuild, anvilDlqList, anvilDlqDrain } from "../anvil.mjs";
// Phase ANVIL Slice 6 — Pipelines registry
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
// Phase TEMPER-01 Slice 01.1 — Tempering foundation (read-only scan)
import {
  handleScan as temperingHandleScan,
  handleStatus as temperingHandleStatus,
  readTemperingConfig as readTemperingConfigForLg,
  listRunRecords,
} from "../tempering.mjs";
// Phase TEMPER-02 Slice 02.1 — Tempering execution harness (unit scanner)
import { runTemperingRun, runSingleScanner } from "../tempering/runner.mjs";
// Phase TEMPER-04 Slice 04.1 — Visual-diff baseline promotion
import { promoteBaseline } from "../tempering/baselines.mjs";
// Phase TEMPER-06 Slice 06.1 — Bug Registry + Classifier
import { registerBug, listBugs, updateBugStatus, loadBug, setLinkedFixPlan, appendValidationAttempt } from "../tempering/bug-registry.mjs";
import { classify as classifyBug } from "../tempering/bug-classifier.mjs";
import { dispatch as dispatchBugAdapter } from "../tempering/bug-adapters/contract.mjs";
// Phase-39 Slice 4 — Audit loop MCP tools
import { runTemperingDrain } from "../tempering/drain.mjs";
import { routeFinding } from "../tempering/triage.mjs";
import { fileClassifierIssue } from "../tempering/classifier-issue.mjs";
// Phase-39 Slice 7 — audit-loop activation surface
import { loadAuditConfig, saveAuditConfig, shouldAutoDrain } from "../tempering/auto-activate.mjs";
import { checkForUpdate, detectCorruptInstall } from "../update-check.mjs";
// Phase GITHUB-A — GitHub stack introspection
import { inspectGithubStack } from "../github-introspect.mjs";
// Phase GITHUB-D Slice 5 — Copilot Metrics REST endpoint
import { loadMetrics } from "../github-metrics.mjs";
// Phase-54 Slice 1 — GitHub Personal REST endpoint
import { fetchUserProfile, fetchRepoSummary, scanCopilotCoauthors, PersonalAuthError, PersonalNotFoundError, PersonalRateLimitError } from "../github-personal.mjs";
import { loadActivity } from "../team-activity.mjs";
import { buildTeamDashboard } from "../dashboard/team-dashboard.mjs";
// D6 — Agentic code review delegation
import { delegateReview, ReviewDelegateNoPrError, ReviewDelegateAuthError } from "../github-review-delegate.mjs";
// Phase FORGE-SHOP-04 Slice 04.1 — Global search
import { search as forgeSearch } from "../search/core.mjs";
// Phase FORGE-SHOP-05 Slice 05.1 — Unified timeline
import { timeline as forgeTimeline } from "../timeline/core.mjs";
// Phase-AUTH-RBAC-SCAFFOLD Slice 5 — auth middleware wired into MCP tool dispatch
import { withAuth } from "../auth/middleware.mjs";
// Phase LATTICE Slice 7 — Lattice code-graph MCP handlers
import { latticeIndex, latticeStat, latticeQuery, latticeCallers, latticeBlast } from "../lattice.mjs";
// Roadmap C2 — forge_export_plan: convert loose plans to hardened Plan Forge format
import { exportPlan, exportPlanFromFile } from "../export-plan.mjs";
// Roadmap C3 — forge_sync_memories: generate .github/copilot-memory-hints.md from forge decisions
import { syncMemories } from "../sync-memories.mjs";
// v3.0.0 — forge_sync_instructions: generate .github/copilot-instructions.md from forge project context
import { syncInstructions } from "../sync-instructions.mjs";
// Phase 55/56 — Local semantic recall + embedding status
import { isNeuralEmbeddingAvailable, readLocalThoughts, getIndexStatus, clearPersistedIndex } from "../local-recall.mjs";
import { exportAudit } from "../audit-export.mjs";
// Phase WORKER-GUARDRAILS A2 — forge_diff_classify: classify staged diff by category
import { classifyDiff } from "../diff-classify.mjs";
import { ERROR_CODES } from "../enums.mjs";
import express from "express";
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
  setMcpServerRef,
} from "./state.mjs";




import { writeAuditArtifact } from "./audit-writer.mjs";
import { startEventFileWatcher, runPforge, findProjectRoot } from "./helpers.mjs";
import { callOrgRules } from "./org-rules.mjs";
import { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from "./anvil-compute.mjs";
import { TOOLS } from "./tool-definitions.mjs";

import { invokeForgeTool, callToolRequestHandler, searchOpenBrainL3, MCP_ONLY_TOOLS, planNameToRunbookName, generateRunbook, executeTool } from "./tool-handlers.mjs";
import { server } from "./mcp-handler.mjs";
import { runDrainPass, __shouldDrainOnInit } from "./openbrain-bridge.mjs";

const __dirname = resolve(fileURLToPath(new URL("..", import.meta.url)));

const CROSS_RUN_CACHE_TTL_MS = 60 * 60 * 1000;

function writeJsonAtomically(filePath, payload) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

function readCrossRunCache(cachePath, now = Date.now()) {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
    const cachedAtMs = new Date(raw.cachedAt).getTime();
    if (!Number.isFinite(cachedAtMs)) return null;
    if ((now - cachedAtMs) > CROSS_RUN_CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}



export const REST_ROUTES = [
  { method: "GET", path: "/api/search" },
  { method: "GET", path: "/api/timeline" },
  { method: "GET", path: "/api/version" },
  { method: "GET", path: "/api/update-status" },
  { method: "POST", path: "/api/self-update" },
  { method: "GET", path: "/api/watcher/cross-run" },
  { method: "GET", path: "/api/status" },
  { method: "GET", path: "/api/brain/stats" },
  { method: "GET", path: "/api/runs" },
  { method: "GET", path: "/api/skills/pending" },
  { method: "POST", path: "/api/skills/accept" },
  { method: "POST", path: "/api/skills/reject" },
  { method: "POST", path: "/api/skills/defer" },
  { method: "GET", path: "/api/innerloop/status" },
  { method: "GET", path: "/api/innerloop/reviewer-calibration" },
  { method: "GET", path: "/api/innerloop/gate-suggestions" },
  { method: "GET", path: "/api/innerloop/cost-anomalies" },
  { method: "GET", path: "/api/innerloop/proposed-fixes" },
  { method: "GET", path: "/api/innerloop/federation" },
  { method: "POST", path: "/api/innerloop/federation/toggle" },
  { method: "POST", path: "/api/server/restart" },
  { method: "GET", path: "/api/dashboard-state" },
  { method: "POST", path: "/api/dashboard-state" },
  { method: "GET", path: "/api/config" },
  { method: "POST", path: "/api/config" },
  { method: "GET", path: "/api/secrets" },
  { method: "POST", path: "/api/secrets" },
  { method: "GET", path: "/api/cost" },
  { method: "GET", path: "/api/github-metrics" },
  { method: "GET", path: "/api/github-personal" },
  { method: "GET", path: "/api/team-activity" },
  { method: "GET", path: "/api/team-dashboard" },
  { method: "GET", path: "/api/github-readiness" },
  { method: "GET", path: "/api/memory/report" },
  { method: "GET", path: "/api/health-trend" },
  { method: "POST", path: "/api/tool/org-rules" },
  { method: "GET", path: "/api/drift" },
  { method: "GET", path: "/api/drift/history" },
  { method: "POST", path: "/api/regression-guard" },
  { method: "POST", path: "/api/incident" },
  { method: "GET", path: "/api/incidents" },
  { method: "POST", path: "/api/deploy-journal" },
  { method: "GET", path: "/api/deploy-journal" },
  { method: "GET", path: "/api/liveguard/traces" },
  { method: "GET", path: "/api/audit/config" },
  { method: "POST", path: "/api/audit/drain" },
  { method: "GET", path: "/api/triage" },
  { method: "POST", path: "/api/runbook" },
  { method: "GET", path: "/api/runbooks" },
  { method: "POST", path: "/api/crucible/submit" },
  { method: "POST", path: "/api/crucible/ask" },
  { method: "GET", path: "/api/crucible/list" },
  { method: "GET", path: "/api/crucible/preview" },
  { method: "POST", path: "/api/crucible/finalize" },
  { method: "POST", path: "/api/crucible/abandon" },
  { method: "GET", path: "/api/crucible/config" },
  { method: "POST", path: "/api/crucible/config" },
  { method: "GET", path: "/api/crucible/manual-imports" },
  { method: "GET", path: "/api/crucible/governance" },
  { method: "GET", path: "/api/hotspots" },
  { method: "GET", path: "/api/deps/watch" },
  { method: "POST", path: "/api/deps/watch/run" },
  { method: "GET", path: "/api/secret-scan" },
  { method: "POST", path: "/api/secret-scan/run" },
  { method: "GET", path: "/api/env/diff" },
  { method: "GET", path: "/api/tempering/artifact" },
  { method: "POST", path: "/api/tempering/bug-stub" },
  { method: "GET", path: "/api/bugs/list" },
  { method: "POST", path: "/api/tool/run-plan" },
  { method: "POST", path: "/api/tool/:name" },
  { method: "GET", path: "/api/hub" },
  { method: "GET", path: "/api/replay/:runIdx/:sliceId" },
  { method: "GET", path: "/api/traces" },
  { method: "GET", path: "/api/runs/latest" },
  { method: "GET", path: "/api/runs/:runIdx" },
  { method: "GET", path: "/api/skills" },
  { method: "GET", path: "/api/traces/:runId" },
  { method: "GET", path: "/.well-known/plan-forge.json" },
  { method: "GET", path: "/api/capabilities" },
  { method: "GET", path: "/api/extensions" },
  { method: "GET", path: "/api/plans" },
  { method: "GET", path: "/api/memory" },
  { method: "POST", path: "/api/memory/search" },
  { method: "POST", path: "/api/memory/capture" },
  { method: "POST", path: "/api/memory/drain" },
  { method: "POST", path: "/api/brain/test" },
  { method: "POST", path: "/api/brain/replay" },
  { method: "GET", path: "/api/memory/presets" },
  { method: "GET", path: "/api/workers" },
  { method: "POST", path: "/api/image/generate" },
  { method: "GET", path: "/api/bridge/status" },
  { method: "POST", path: "/api/bridge/approve/:runId" },
  { method: "GET", path: "/api/bridge/approve/:runId" },
  { method: "POST", path: "/api/runs/trigger" },
  { method: "POST", path: "/api/runs/abort" },
  { method: "GET", path: "/api/fix/proposals" },
  { method: "POST", path: "/api/fix/propose" },
  { method: "GET", path: "/api/quorum/prompt" },
  { method: "POST", path: "/api/quorum/prompt" },
  { method: "POST", path: "/api/openclaw/snapshot" },
  { method: "GET", path: "/api/openclaw/config" },
  { method: "GET", path: "/api/notifications/config" },
  { method: "POST", path: "/api/notifications/config" },
  { method: "GET", path: "/api/copilot-instructions" },
  { method: "POST", path: "/api/copilot-instructions/preview" },
  { method: "POST", path: "/api/copilot-instructions/sync" },
  { method: "GET", path: "/api/auditor/latest" },
  { method: "GET", path: "/api/brain/recall" },
  { method: "GET", path: "/api/embedding/status" },
  { method: "GET", path: "/api/local-recall/status" },
  { method: "GET", path: "/api/audit/export" },
];

// ─── REST handler sub-helpers (Phase ESLINT-D1 — extracted from arrow handlers) ──

function _validateObserverConfig(obs) {
  if (obs.maxUsdPerDay !== undefined) {
    if (typeof obs.maxUsdPerDay !== "number" || !Number.isFinite(obs.maxUsdPerDay) || obs.maxUsdPerDay < 0) {
      return { ok: false, status: 400, error: "forgeMaster.observer.maxUsdPerDay must be a finite number >= 0" };
    }
  }
  if (obs.maxNarrationsPerHour !== undefined) {
    if (typeof obs.maxNarrationsPerHour !== "number" || !Number.isFinite(obs.maxNarrationsPerHour) || obs.maxNarrationsPerHour < 0) {
      return { ok: false, status: 400, error: "forgeMaster.observer.maxNarrationsPerHour must be a finite number >= 0" };
    }
  }
  return null;
}

function _validateAuditorConfig(aud) {
  if (!Number.isFinite(aud.everyNRuns) || aud.everyNRuns <= 0 || aud.everyNRuns !== Math.trunc(aud.everyNRuns)) {
    return { ok: false, status: 400, error: "forgeMaster.auditor.everyNRuns must be a positive integer or null" };
  }
  if (aud.everyNRuns >= 1 && aud.everyNRuns <= 4) {
    return { ok: false, status: 400, error: "forgeMaster.auditor.everyNRuns must be null/blank or at least 5" };
  }
  return null;
}

function _validateConfigPayload(config) {
  if (!config || typeof config !== "object") {
    return { ok: false, status: 400, error: "Request body must be a JSON object" };
  }
  if (config.preset && typeof config.preset !== "string") {
    return { ok: false, status: 400, error: "preset must be a string" };
  }
  if (config.updateSource !== undefined) {
    const allowed = ["auto", "github-tags", "local-sibling"];
    if (typeof config.updateSource !== "string" || !allowed.includes(config.updateSource)) {
      return { ok: false, status: 400, error: `updateSource must be one of: ${allowed.join(", ")}` };
    }
  }
  const obs = config.forgeMaster?.observer;
  if (obs && typeof obs === "object") {
    const obsErr = _validateObserverConfig(obs);
    if (obsErr) return obsErr;
  }
  const aud = config.forgeMaster?.auditor;
  if (aud && typeof aud === "object" && aud.everyNRuns !== undefined && aud.everyNRuns !== null) {
    const audErr = _validateAuditorConfig(aud);
    if (audErr) return audErr;
  }
  return { ok: true };
}

function _shannonEntropy(str) {
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

const _SECRET_KEY_PATTERNS_RE = /(?:key|secret|token|password|api_key|auth|credential|private)/i;

function _scoreSecretConfidence(entropy, keyMatch) {
  if (entropy >= 4.5 && keyMatch) return "high";
  if ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) return "medium";
  return "low";
}

function _scanSecretsInDiffLine({ added, currentFile, lineNumber, threshold, findings }) {
  const tokens = added.match(/["']([^"']{8,})["']|(?:=|:|=>)\s*["']?([^\s"',;]{8,})["']?/g) || [];
  for (const raw of tokens) {
    const cleaned = raw.replace(/^[=:>]\s*["']?|["']$/g, "").replace(/^["']/, "");
    if (cleaned.length < 8) continue;
    const entropy = _shannonEntropy(cleaned);
    if (entropy < threshold) continue;
    const keyMatch = _SECRET_KEY_PATTERNS_RE.test(added);
    findings.push({
      file: currentFile,
      line: lineNumber,
      type: "unknown",
      entropyScore: Math.round(entropy * 100) / 100,
      masked: "<REDACTED>",
      confidence: _scoreSecretConfidence(entropy, keyMatch),
    });
  }
}

function _scanDiffForSecrets(diffOutput, threshold) {
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
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      lineNumber = m ? parseInt(m[1], 10) - 1 : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNumber++;
      _scanSecretsInDiffLine({ added: line.slice(1), currentFile: currentFile, lineNumber: lineNumber, threshold: threshold, findings: findings });
    } else if (!line.startsWith("-")) {
      lineNumber++;
    }
  }
  return { findings, scannedFiles };
}

function _validateBrainReplayRequest(body, cfg) {
  if (!cfg) {
    return { ok: false, status: 503, error: "OpenBrain SSE endpoint not found in .vscode/mcp.json or .claude/mcp.json." };
  }
  if (!cfg.key && !body?.dryRun) {
    return { ok: false, status: 503, error: "OpenBrain auth key not resolved. Set OPENBRAIN_KEY env var or check the mcp.json headers entry." };
  }
  const sourceArg = String(body?.source || "").trim();
  if (!sourceArg) {
    return { ok: false, status: 400, error: "source is required: pass a queue jsonl path, a markdown file path, or a directory of .md files." };
  }
  return { ok: true, sourceArg };
}

function _collectReplayRecords(sourcePath, { project, maxRecords }) {
  if (!existsSync(sourcePath)) {
    return { ok: false, status: 404, error: `source not found: ${sourcePath}` };
  }
  const st = statSync(sourcePath);
  let records = [];
  let sourceType = "unknown";
  if (st.isDirectory()) {
    sourceType = "markdown-dir";
    for (const f of listMarkdownFiles(sourcePath, { recursive: false })) {
      records.push(...normalizeMarkdownFile(f, { project, source: `replay:${basename(f)}` }));
    }
  } else if (/\.md$/i.test(sourcePath)) {
    sourceType = "markdown-file";
    records = normalizeMarkdownFile(sourcePath, { project, source: `replay:${basename(sourcePath)}` });
  } else if (/\.jsonl?$/i.test(sourcePath)) {
    sourceType = "queue-jsonl";
    const raw = readFileSync(sourcePath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try { records.push(normalizeQueueRecord(JSON.parse(s))); } catch { /* skip malformed line */ }
    }
  } else {
    return { ok: false, status: 400, error: `unsupported source type for ${sourcePath} — expected .jsonl, .md, or a directory.` };
  }
  if (records.length > maxRecords) records = records.slice(0, maxRecords);
  return { ok: true, sourceType, records };
}

function _buildBrainReplayRequest(body, cfg) {
  const validation = _validateBrainReplayRequest(body, cfg);
  if (!validation.ok) return validation;
  return {
    ok: true,
    cfg,
    sourceArg: validation.sourceArg,
    dryRun: Boolean(body?.dryRun),
    project: body?.project || "plan-forge",
    maxRecords: Number(body?.maxRecords ?? 500),
    rate: Number(body?.rate ?? 50),
    maxRetries: Number(body?.maxRetries ?? 3),
    retryDelayMs: Number(body?.retryDelayMs ?? 250),
  };
}

function _createBrainReplayReceiptLog() {
  const receiptPath = resolve(PROJECT_DIR, ".forge", `openbrain-replay-${Date.now()}.jsonl`);
  let receiptStream = null;
  try {
    mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
    receiptStream = createWriteStream(receiptPath, { flags: "a" });
  } catch { /* receipt log is best-effort */ }
  return { receiptPath, receiptStream };
}

async function _prepareBrainReplayRun(request) {
  const sourcePath = isAbsolute(request.sourceArg) ? request.sourceArg : resolve(PROJECT_DIR, request.sourceArg);
  const collected = _collectReplayRecords(sourcePath, { project: request.project, maxRecords: request.maxRecords });
  if (!collected.ok) return collected;
  const client = request.dryRun ? null : await createOpenBrainClient(request.cfg);
  return {
    ok: true,
    cfg: request.cfg,
    dryRun: request.dryRun,
    rate: request.rate,
    maxRetries: request.maxRetries,
    retryDelayMs: request.retryDelayMs,
    sourcePath,
    collected,
    client,
    ..._createBrainReplayReceiptLog(),
  };
}

function _recordBrainReplayProgress(receiptStream, ev) {
  if (!receiptStream) return;
  try { receiptStream.write(JSON.stringify({ ...ev, ts: new Date().toISOString() }) + "\n"); } catch { /* ignore */ }
}

function _closeBrainReplayReceiptLog(receiptStream) {
  if (!receiptStream) return;
  try { receiptStream.end(); } catch { /* ignore */ }
}

async function _closeBrainReplayClient(client) {
  if (!client) return;
  try { await client.close(); } catch { /* best-effort */ }
}

async function _runBrainReplay(run) {
  const captureClient = run.dryRun ? { capture: async () => ({}) } : run.client;
  const result = await brainReplayRecords(captureClient, run.collected.records, {
    rate: run.rate,
    maxRetries: run.maxRetries,
    retryDelayMs: run.retryDelayMs,
    dryRun: run.dryRun,
    sampleSize: 5,
    onProgress: (ev) => _recordBrainReplayProgress(run.receiptStream, ev),
  });
  return {
    ok: result.failed === 0,
    sourceType: run.collected.sourceType,
    source: run.sourcePath,
    receiptLog: run.receiptStream ? run.receiptPath : null,
    endpoint: run.cfg.url,
    ...result,
  };
}

const _EXPRESS_ROUTE_REGISTRARS = [
  _registerSearchTimelineRoutes,
  _registerStaticVersionRoutes,
  _registerStatusRunsSkillsRoutes,
  _registerInnerloopServerRoutes,
  _registerConfigSecretsRoutes,
  _registerMetricsTeamRoutes,
  _registerDriftIncidentRoutes,
  _registerCrucibleHotspotRoutes,
  _registerDepsTemperingToolRoutes,
  _registerHubTracesPlansRoutes,
  _registerMemoryBrainRoutes,
  _registerImageBridgeFixRoutes,
  _registerQuorumMiscRoutes,
];

function _registerExpressRouteGroups(app) {
  for (const registerRoutes of _EXPRESS_ROUTE_REGISTRARS) {
    registerRoutes(app);
  }
}

const _QUORUM_GOAL_PRESETS = {
  "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
  "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
  "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
  "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
};

function _validateQuorumQuestion(question, fieldName) {
  if (!question) return null;
  if (question.length > 500) return { status: 400, error: `${fieldName} exceeds 500 character limit` };
  if (/<script|javascript:|on\w+=/i.test(question)) return { status: 400, error: `${fieldName} contains disallowed content` };
  return null;
}

function _collectQuorumContextBySource(source) {
  const context = {};
  let oldestTimestamp = null;
  const trackAge = (ts) => { if (ts && (!oldestTimestamp || ts < oldestTimestamp)) oldestTimestamp = ts; };
  if (source === "all" || source === "drift") {
    const driftHistory = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
    if (driftHistory.length) { context.drift = driftHistory.slice(-5); trackAge(driftHistory[0]?.timestamp); }
  }
  if (source === "all" || source === "incident") {
    const incidents = readForgeJsonl("incidents.jsonl", [], PROJECT_DIR).slice(-10);
    if (incidents.length) { context.incidents = incidents; trackAge(incidents[0]?.capturedAt); }
  }
  if (source === "all" || source === "triage") {
    const triageCache = readForgeJson("alert-triage-cache.json", null, PROJECT_DIR);
    if (triageCache) { context.triage = triageCache; trackAge(triageCache.generatedAt); }
  }
  if (source === "all" || source === "fix-proposal") {
    const proposals = readForgeJsonl("fix-proposals.json", [], PROJECT_DIR).slice(-5);
    if (proposals.length) { context.fixProposals = proposals; trackAge(proposals[0]?.generatedAt); }
  }
  return { context, oldestTimestamp };
}

function _pickQuorumQuestion(customQuestion, analysisGoal) {
  if (customQuestion) return customQuestion;
  if (analysisGoal && _QUORUM_GOAL_PRESETS[analysisGoal]) return _QUORUM_GOAL_PRESETS[analysisGoal];
  return _QUORUM_GOAL_PRESETS["risk-assess"];
}

function _formatQuorumResponse({ context, oldestTimestamp, customQuestion, analysisGoal, quorumSize }) {
  const questionUsed = _pickQuorumQuestion(customQuestion, analysisGoal);
  const votingInstruction = `Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= 60 and majority consensus. Quorum size: ${quorumSize} models.`;
  const contextStr = JSON.stringify(context, null, 2);
  const quorumPrompt = `## Context\n${contextStr}\n\n## Question\n${questionUsed}\n\n## Voting Instruction\n${votingInstruction}`;
  const qConfig = loadQuorumConfig(PROJECT_DIR);
  const suggestedModels = (qConfig.models || ["claude-opus-4.7", "grok-4.20", "gemini-3-pro-preview"]).slice(0, quorumSize);
  const promptTokenEstimate = Math.ceil(quorumPrompt.length / 4);
  let dataSnapshotAge = "unknown";
  if (oldestTimestamp) {
    const ageMins = Math.round((Date.now() - new Date(oldestTimestamp).getTime()) / 60000);
    dataSnapshotAge = ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
  }
  return { quorumPrompt, promptTokenEstimate, suggestedModels, dataSnapshotAge, questionUsed };
}

// ─── Express App + REST API  ─────────────────────────────
export function createExpressApp() {
  const app = express();
  app.use(express.json());
  app.use("/dashboard", express.static(resolve(__dirname, "dashboard")));
  _registerExpressRouteGroups(app);
  return app;
}

function _registerSearchTimelineRoutes(app) {
  app.get("/api/search", async (req, res) => {
    try {
      const params = {
        query: req.query.query || "",
        tags: req.query.tags ? req.query.tags.split(",") : undefined,
        since: req.query.since || undefined,
        correlationId: req.query.correlationId || undefined,
        sources: req.query.sources ? req.query.sources.split(",") : undefined,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      };
      const cwd = findProjectRoot(PROJECT_DIR);
      const wantsMemory = !params.sources || params.sources.includes("memory");
      let l3Hits = [];
      if (wantsMemory && isOpenBrainConfigured(cwd)) {
        l3Hits = await searchOpenBrainL3(cwd, params);
      }
      const openBrainSearchFn = l3Hits.length > 0 ? () => l3Hits : null;
      const result = forgeSearch(params, { cwd, openBrainSearchFn });
      if (l3Hits.length > 0) result.l3Hits = l3Hits.length;
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase FORGE-SHOP-05 Slice 05.2 — timeline API for dashboard
  app.get("/api/timeline", async (req, res) => {
    try {
      const params = {
        from: req.query.from || undefined,
        to: req.query.to || undefined,
        correlationId: req.query.correlationId || undefined,
        sources: req.query.sources ? req.query.sources.split(",") : undefined,
        events: req.query.events ? req.query.events.split(",") : undefined,
        groupBy: req.query.groupBy || "time",
        limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
      };
      const cwd = findProjectRoot(PROJECT_DIR);
      const result = await forgeTimeline(params, { cwd });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Plan Browser static files
}

function _registerStaticVersionRoutes(app) {
  app.use("/ui", express.static(resolve(__dirname, "ui")));

  // REST API: GET /api/version — server + framework version
  app.get("/api/version", (_req, res) => {
    try {
      // Issue #106: prefer PROJECT_DIR's VERSION when available (lets the
      // dashboard show the framework version of the project being managed),
      // but always fall back to FRAMEWORK_VERSION (the install's own VERSION)
      // so we never report "unknown" or a stale literal.
      const versionFile = resolve(PROJECT_DIR, "VERSION");
      const projectVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : null;
      const frameworkVersion = projectVersion || FRAMEWORK_VERSION;
      // Server and framework ship together — use the same value for both.
      res.json({ server: frameworkVersion, framework: frameworkVersion });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/update-status — is there a newer Plan Forge release?
  // Returns the last cached check (may be null when suppressed / unavailable).
  // See `kickoffUpdateCheck()` below for the boot-time refresh.
  // Pass ?force=1 to bypass the 24h cache and hit GitHub now (manual check).
  app.get("/api/update-status", async (req, res) => {
    try {
      // Issue #106: use FRAMEWORK_VERSION (install's own VERSION) so the
      // dashboard's update banner compares against the running framework,
      // not whatever VERSION happens to live in PROJECT_DIR.
      const versionFile = resolve(PROJECT_DIR, "VERSION");
      const projectVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : null;
      const current = (FRAMEWORK_VERSION && FRAMEWORK_VERSION !== "unknown") ? FRAMEWORK_VERSION : projectVersion;
      if (!current) return res.json({ available: false, reason: "no-version-file" });
      const force = req.query?.force === "1" || req.query?.force === "true";
      const result = await checkForUpdate({ currentVersion: current, projectDir: PROJECT_DIR, force });
      if (!result) return res.json({ available: false, current });
      return res.json({
        available: Boolean(result.isNewer),
        current: result.current,
        latest: result.latest,
        url: result.url,
        publishedAt: result.publishedAt,
        checkedAt: result.checkedAt,
        fromCache: result.fromCache,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/self-update — trigger self-update with SSE progress
  // Phase AUTO-UPDATE-01 Slice 2
  let _lastSelfUpdateTs = 0;
  const _SELF_UPDATE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

  app.post("/api/self-update", async (_req, res) => {
    try {
      // Rate limit
      const now = Date.now();
      if (now - _lastSelfUpdateTs < _SELF_UPDATE_COOLDOWN_MS) {
        const retryAfterMs = _SELF_UPDATE_COOLDOWN_MS - (now - _lastSelfUpdateTs);
        return res.status(429).json({ error: "Rate limited", retryAfterMs });
      }

      // Guard: reject if a plan run is active
      if (activeAbortController) {
        return res.status(409).json({ error: "Cannot update during active plan run", code: ERROR_CODES.ERR_UPDATE_DURING_RUN.code });
      }

      // SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      _lastSelfUpdateTs = now;
      const runId = `self-update-${now}`;
      const send = (state, detail) =>
        res.write(`data: ${JSON.stringify({ runId, state, detail, ts: new Date().toISOString() })}\n\n`);

      // 1. Check for updates (force refresh)
      send("checking", "Checking for updates...");
      // Issue #106: framework's own VERSION drives self-update, not PROJECT_DIR.
      const versionFile = resolve(PROJECT_DIR, "VERSION");
      const projectVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : null;
      const currentVersion = (FRAMEWORK_VERSION && FRAMEWORK_VERSION !== "unknown") ? FRAMEWORK_VERSION : projectVersion;
      if (!currentVersion) {
        send("failed", "VERSION file not found");
        return res.end();
      }
      const result = await checkForUpdate({ currentVersion, projectDir: PROJECT_DIR, force: true });
      if (!result || !result.isNewer) {
        send("done", `Already current (v${currentVersion})`);
        return res.end();
      }

      // 2. Spawn pforge self-update --yes as child process
      const latestTag = `v${result.latest}`;
      send("downloading", `Downloading ${latestTag}...`);

      const { spawn } = await import("node:child_process");
      const isWin = process.platform === "win32";
      const pforgeScript = isWin
        ? resolve(PROJECT_DIR, "pforge.ps1")
        : resolve(PROJECT_DIR, "pforge.sh");
      const args = isWin
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", pforgeScript, "update", "--from-github", "--tag", latestTag]
        : [pforgeScript, "update", "--from-github", "--tag", latestTag];
      const cmd = isWin ? "pwsh" : "bash";

      const child = spawn(cmd, args, {
        cwd: PROJECT_DIR,
        env: { ...process.env, PFORGE_SELF_UPDATE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let lastState = "downloading";
      child.stdout.on("data", (chunk) => {
        const line = chunk.toString().trim();
        if (!line) return;
        if (line.includes("Extracting") || line.includes("extracting")) {
          lastState = "extracting";
          send("extracting", line);
        } else if (line.includes("Applying") || line.includes("applying") || line.includes("Copying")) {
          lastState = "applying";
          send("applying", line);
        } else {
          send(lastState, line);
        }
      });

      child.stderr.on("data", (chunk) => {
        const line = chunk.toString().trim();
        if (line) send(lastState, line);
      });

      child.on("close", (code) => {
        if (code === 0) {
          send("done", `Updated to ${latestTag}`);
        } else {
          send("failed", `Update process exited with code ${code}`);
        }
        res.end();
      });

      child.on("error", (err) => {
        send("failed", `Failed to spawn update process: ${err.message}`);
        res.end();
      });

      // Clean up if client disconnects
      _req.on("close", () => {
        // Don't kill the child — let the update finish
      });
    } catch (err) {
      // If headers already sent, try SSE error frame
      if (res.headersSent) {
        try { res.write(`data: ${JSON.stringify({ state: "failed", detail: err.message, ts: new Date().toISOString() })}\n\n`); } catch {}
        res.end();
      } else {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // REST API: GET /api/watcher/cross-run — cached 14d cross-run anomaly view
  app.get("/api/watcher/cross-run", async (_req, res) => {
    try {
      const cachePath = resolve(PROJECT_DIR, ".forge", "cross-run-cache.json");
      const cached = readCrossRunCache(cachePath);
      if (cached) {
        return res.json({ ...cached.report, cachedAt: cached.cachedAt, fromCache: true });
      }

      const report = await runWatch({ targetPath: PROJECT_DIR, mode: "cross-run", crossRunWindow: "14d" });
      const cachedAt = new Date().toISOString();
      writeJsonAtomically(cachePath, { cachedAt, report });
      return res.json({ ...report, cachedAt, fromCache: false });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // REST API: GET /api/status — current run status
}

function _registerStatusRunsSkillsRoutes(app) {
  app.get("/api/status", (_req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.json({ status: "idle", message: "No runs yet" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      if (dirs.length === 0) return res.json({ status: "idle" });
      const summaryPath = resolve(runsDir, dirs[0], "summary.json");
      if (existsSync(summaryPath)) {
        return res.json(JSON.parse(readFileSync(summaryPath, "utf-8")));
      }
      const runPath = resolve(runsDir, dirs[0], "run.json");
      if (existsSync(runPath)) {
        return res.json({ status: "running", ...JSON.parse(readFileSync(runPath, "utf-8")) });
      }
      res.json({ status: "unknown" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/brain/stats — Phase FORGE-SHOP-07 Slice 07.2
  app.get("/api/brain/stats", (_req, res) => {
    try {
      const forgeDir = resolve(PROJECT_DIR, ".forge");
      // Tier counters from OTEL spans if available, otherwise zeroed
      const tiers = {
        l1: { recalls: 0, misses: 0 },
        l2: { recalls: 0, misses: 0 },
        l3: { recalls: 0, misses: 0 },
      };
      // Scan hub-events for brain.recall spans
      const topKeysMap = {};
      const misses = [];
      try {
        const hubPath = resolve(forgeDir, "hub-events.jsonl");
        if (existsSync(hubPath)) {
          const lines = readFileSync(hubPath, "utf-8").split("\n").filter(Boolean).slice(-500);
          for (const line of lines) {
            try {
              const ev = JSON.parse(line);
              if (ev.type === "brain-recall" || ev.data?.operation === "brain.recall") {
                const tier = ev.data?.tierServed || ev.data?.["tier-served"] || "l2";
                const key = ev.data?.key || "unknown";
                const hit = ev.data?.tierServed !== "miss";
                if (hit) {
                  tiers[tier] = tiers[tier] || { recalls: 0, misses: 0 };
                  tiers[tier].recalls++;
                  topKeysMap[key] = topKeysMap[key] || { key, hits: 0, tier };
                  topKeysMap[key].hits++;
                } else {
                  tiers.l2.misses++;
                  misses.push({ key, timestamp: ev.ts || null });
                }
              }
            } catch { /* skip line */ }
          }
        }
      } catch { /* no hub events — zeroed counters */ }
      const topKeys = Object.values(topKeysMap)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 10);
      res.json({ tiers, topKeys, misses: misses.slice(-20).reverse() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/runs — run history
  app.get("/api/runs", (_req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.json([]);
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      const runs = [];
      for (const dir of dirs.slice(0, 50)) { // Limit to 50
        const summaryPath = resolve(runsDir, dir, "summary.json");
        if (existsSync(summaryPath)) {
          try { runs.push(JSON.parse(readFileSync(summaryPath, "utf-8"))); } catch { /* skip corrupt */ }
        }
      }
      res.json(runs);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Phase-26 Slice 8: Auto-skill promotion API ──────────────────────
  // REST API: GET /api/skills/pending — eligible auto-skill candidates
  app.get("/api/skills/pending", (req, res) => {
    try {
      const threshold = req.query.threshold !== undefined
        ? Number(req.query.threshold)
        : undefined;
      const skills = listPendingAutoSkills({ cwd: PROJECT_DIR, threshold });
      res.json({ skills });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/skills/accept — promote a candidate to .github/skills/
  // Body: { sha256Prefix: string }
  app.post("/api/skills/accept", (req, res) => {
    try {
      const { sha256Prefix } = req.body || {};
      if (!sha256Prefix || typeof sha256Prefix !== "string") {
        return res.status(400).json({ error: "sha256Prefix (string) required" });
      }
      const result = acceptAutoSkill({ cwd: PROJECT_DIR, sha256Prefix });
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/skills/reject — move candidate to rejected/ folder
  // Body: { sha256Prefix: string, reason?: string }
  app.post("/api/skills/reject", (req, res) => {
    try {
      const { sha256Prefix, reason } = req.body || {};
      if (!sha256Prefix || typeof sha256Prefix !== "string") {
        return res.status(400).json({ error: "sha256Prefix (string) required" });
      }
      const result = rejectAutoSkill({ cwd: PROJECT_DIR, sha256Prefix, reason });
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/skills/defer — defer candidate 7 days
  // Body: { sha256Prefix: string }
  app.post("/api/skills/defer", (req, res) => {
    try {
      const { sha256Prefix } = req.body || {};
      if (!sha256Prefix || typeof sha256Prefix !== "string") {
        return res.status(400).json({ error: "sha256Prefix (string) required" });
      }
      const result = deferAutoSkill({ cwd: PROJECT_DIR, sha256Prefix });
      if (!result.ok) return res.status(404).json(result);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Phase-26 Slice 12: Inner Loop dashboard endpoints ──────────────
  //
  // These power the "Inner Loop" tab (Slice 13). Each endpoint is a
  // read-only projection over existing on-disk state. All responses are
  // advisory unless the user has explicitly opted into the subsystem via
  // `.forge.json` — the endpoints report configuration state alongside
  // data so the UI can render the right empty-state message.

  // GET /api/innerloop/status — all subsystem states in one payload
}

function _registerInnerloopServerRoutes(app) {
  app.get("/api/innerloop/status", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const calibration = getReviewerCalibration(cwd);
      const skillsPending = listPendingAutoSkills({ cwd });
      const federation = loadFederationConfig(cwd);
      const federationErrors = validateFederationConfig(cwd);
      const fixProposals = readForgeJsonl("fix-proposals.json", [], cwd);
      const openFixProposals = fixProposals.filter(
        (p) => p && p.status !== "resolved" && p.status !== "closed"
      );
      res.json({
        reviewer: {
          eligible: calibration.eligible,
          count: calibration.count,
          threshold: calibration.threshold,
        },
        skills: {
          pendingCount: skillsPending.length,
        },
        federation: {
          enabled: federation.enabled,
          repoCount: federation.repos.length,
          configErrors: federationErrors.length,
        },
        autoFix: {
          openProposals: openFixProposals.length,
        },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/reviewer-calibration — count + threshold + eligibility
  app.get("/api/innerloop/reviewer-calibration", (_req, res) => {
    try {
      const result = getReviewerCalibration(PROJECT_DIR);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/gate-suggestions — recent accept events + per-key counters
  app.get("/api/innerloop/gate-suggestions", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const path = resolve(cwd, ".forge", "gate-suggestions.jsonl");
      if (!existsSync(path)) return res.json({ records: [], counters: {} });
      // Read last 200 accept events for the dashboard list.
      const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
      const records = [];
      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (rec && rec.type === "accept") records.push(rec);
        } catch { /* skip malformed */ }
      }
      const recent = records.slice(-200).reverse();
      const counters = {};
      for (const rec of records) {
        if (!rec.suggestionKey) continue;
        counters[rec.suggestionKey] = (counters[rec.suggestionKey] || 0) + 1;
      }
      res.json({ records: recent, counters });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/cost-anomalies — detected anomalies from .forge/cost-anomalies.jsonl
  app.get("/api/innerloop/cost-anomalies", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const anomalies = readForgeJsonl("cost-anomalies.jsonl", [], cwd);
      // Latest 50, newest first.
      const recent = anomalies.slice(-50).reverse();
      res.json({ anomalies: recent, count: anomalies.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/proposed-fixes — list .forge/proposed-fixes/*.patch
  app.get("/api/innerloop/proposed-fixes", (_req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const dir = resolve(cwd, ".forge", PROPOSED_FIX_DIR);
      if (!existsSync(dir)) return res.json({ fixes: [] });
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".patch"));
      const fixes = [];
      for (const e of entries) {
        const fullPath = resolve(dir, e.name);
        try {
          const stat = statSync(fullPath);
          fixes.push({
            fixId: e.name.slice(0, -".patch".length),
            path: fullPath,
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch { /* skip unreadable */ }
      }
      fixes.sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.json({ fixes });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/innerloop/federation — config + validation errors + recent trajectories
  app.get("/api/innerloop/federation", (req, res) => {
    try {
      const cwd = PROJECT_DIR;
      const config = loadFederationConfig(cwd);
      const errors = validateFederationConfig(cwd);
      let trajectories = [];
      if (config.enabled && config.repos.length > 0) {
        const limitQ = Number(req.query?.limit);
        const limit = Number.isFinite(limitQ) && limitQ > 0
          ? Math.min(limitQ, TRAJECTORY_FEDERATION_LIMIT)
          : 20;
        // Strip large `content` field for the list view.
        trajectories = federationReadTrajectories({ cwd, limit }).map((t) => ({
          repo: t.repo,
          planBasename: t.planBasename,
          sliceId: t.sliceId,
          mtimeMs: t.mtimeMs,
        }));
      }
      res.json({
        enabled: config.enabled,
        repos: config.repos,
        configErrors: errors,
        trajectories,
        limit: TRAJECTORY_FEDERATION_LIMIT,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/innerloop/federation/toggle — flip brain.federation.enabled in .forge.json
  // Body: { enabled: boolean }. Writes .forge.json atomically (read → merge → write).
  // Returns the updated state (same shape as GET minus trajectories).
  app.post("/api/innerloop/federation/toggle", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || typeof req.body.enabled !== "boolean") {
        return res.status(400).json({ error: "body must be { enabled: boolean }" });
      }
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      let cfg = {};
      if (existsSync(configPath)) {
        try { cfg = JSON.parse(readFileSync(configPath, "utf-8")); } catch {
          return res.status(500).json({ error: ".forge.json is not valid JSON" });
        }
      }
      if (!cfg.brain || typeof cfg.brain !== "object") cfg.brain = {};
      if (!cfg.brain.federation || typeof cfg.brain.federation !== "object") {
        cfg.brain.federation = { enabled: false, repos: [] };
      }
      cfg.brain.federation.enabled = req.body.enabled;
      if (!Array.isArray(cfg.brain.federation.repos)) cfg.brain.federation.repos = [];
      writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\n");
      const updated = loadFederationConfig(PROJECT_DIR);
      const errors = validateFederationConfig(PROJECT_DIR);
      res.json({ enabled: updated.enabled, repos: updated.repos, configErrors: errors });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/server/restart — exit the MCP/HTTP server process so the
  // supervising MCP client (VS Code, etc.) respawns it with freshly-loaded
  // code. Useful immediately after `pforge self-update` replaces files on
  // disk but the running process still has the old code in memory.
  //
  // Guards: refuses while a plan run is active (same guard as self-update).
  // Response returns 202 BEFORE the actual exit so the browser sees the ack.
  let _lastRestartTs = 0;
  const _RESTART_COOLDOWN_MS = 10 * 1000;
  app.post("/api/server/restart", (_req, res) => {
    try {
      if (activeAbortController) {
        return res.status(409).json({ error: "Cannot restart during active plan run", code: "ERR_RESTART_DURING_RUN" }); // TODO: enum migration
      }
      const now = Date.now();
      if (now - _lastRestartTs < _RESTART_COOLDOWN_MS) {
        const retryAfterMs = _RESTART_COOLDOWN_MS - (now - _lastRestartTs);
        return res.status(429).json({ error: "Rate limited", retryAfterMs });
      }
      _lastRestartTs = now;
      res.status(202).json({ ok: true, message: "Server exiting — the MCP client should respawn it automatically" });
      // Flush the response, then exit. 500ms gives Express time to drain.
      setTimeout(() => {
        try { console.log("[restart] exiting on /api/server/restart request"); } catch {}
        process.exit(0);
      }, 500).unref?.();
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Phase-26 Slice 14: Dashboard UI state ──────────────────────────
  //
  // Stores per-user-machine dashboard preferences (welcome-card dismissal,
  // feature-tour progress). Kept in `.forge/dashboard-state.json` so it is
  // gitignored by default along with the rest of `.forge/`. Schema is an
  // arbitrary object — the dashboard owns the shape.
  app.get("/api/dashboard-state", (_req, res) => {
    try {
      const path = resolve(PROJECT_DIR, ".forge", "dashboard-state.json");
      if (!existsSync(path)) return res.json({});
      res.json(JSON.parse(readFileSync(path, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/dashboard-state", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ error: "Request body must be a JSON object" });
      }
      const dir = resolve(PROJECT_DIR, ".forge");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = resolve(dir, "dashboard-state.json");
      // Merge onto existing state so partial updates don't wipe other keys.
      let current = {};
      if (existsSync(path)) {
        try { current = JSON.parse(readFileSync(path, "utf-8")); } catch { current = {}; }
        if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
      }
      const merged = { ...current, ...req.body };
      writeFileSync(path, JSON.stringify(merged, null, 2));
      res.json({ success: true, state: merged });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/config — read .forge.json
}

function _registerConfigSecretsRoutes(app) {
  app.get("/api/config", (_req, res) => {
    try {
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      if (!existsSync(configPath)) return res.json({});
      res.json(JSON.parse(readFileSync(configPath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/config — write .forge.json (with validation)
  app.post("/api/config", (req, res) => {
    try {
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      const v = _validateConfigPayload(req.body);
      if (!v.ok) return res.status(v.status).json({ error: v.error });
      writeFileSync(configPath, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/secrets — read .forge/secrets.json (masked values)
  app.get("/api/secrets", (_req, res) => {
    try {
      const secretsPath = resolve(PROJECT_DIR, ".forge", "secrets.json");
      if (!existsSync(secretsPath)) return res.json({ keys: {} });
      const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
      // Mask values: show only last 4 chars
      const masked = {};
      for (const [key, value] of Object.entries(secrets)) {
        if (typeof value === "string" && value.length > 4) {
          masked[key] = { set: true, masked: "••••" + value.slice(-4) };
        } else if (typeof value === "string" && value.length > 0) {
          masked[key] = { set: true, masked: "••••" };
        } else {
          masked[key] = { set: false, masked: "" };
        }
      }
      // Also check env vars for known provider keys
      const envKeys = ["GITHUB_TOKEN", "XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENCLAW_API_KEY"];
      for (const ek of envKeys) {
        if (!masked[ek] && process.env[ek]) {
          masked[ek] = { set: true, masked: "••••" + process.env[ek].slice(-4), source: "env" };
        }
      }
      res.json({ keys: masked });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/secrets — write individual keys to .forge/secrets.json
  app.post("/api/secrets", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    try {
      const { key, value } = req.body || {};
      if (!key || typeof key !== "string") return res.status(400).json({ error: "key is required" });
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return res.status(400).json({ error: "key must be UPPER_SNAKE_CASE" });
      const secretsDir = resolve(PROJECT_DIR, ".forge");
      mkdirSync(secretsDir, { recursive: true });
      const secretsPath = resolve(secretsDir, "secrets.json");
      let secrets = {};
      if (existsSync(secretsPath)) {
        try { secrets = JSON.parse(readFileSync(secretsPath, "utf-8")); } catch { secrets = {}; }
      }
      if (value === "" || value === null || value === undefined) {
        delete secrets[key];
      } else {
        secrets[key] = value;
      }
      writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
      res.json({ success: true, key, action: value ? "set" : "removed" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/cost — cost report
}

function _registerMetricsTeamRoutes(app) {
  app.get("/api/cost", (_req, res) => {
    try {
      res.json(getCostReport(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Phase-54 helper: convert PersonalError subclass to a sanitised category string.
  // Raw error messages are never echoed (they may contain auth header dumps).
  function _ghPersonalErrCategory(err) {
    if (err instanceof PersonalAuthError)      return "auth";
    if (err instanceof PersonalNotFoundError)  return "not-found";
    if (err instanceof PersonalRateLimitError) return "rate-limit";
    if (/not installed|not authenticated|ENOENT/i.test(err.message))
      return "gh CLI not installed or not authenticated";
    return "unknown";
  }

  // REST API: GET /api/github-metrics — Phase GITHUB-D Slice 5
  // Returns Copilot Metrics records for an org plus cost-service data for the
  // "GitHub × Plan-Forge" unified leaderboard dashboard tab.
  // Query params: org (required), since, until, storeDir (optional overrides)
  app.get("/api/github-metrics", (req, res) => {
    try {
      const org = req.query.org || null;
      const since = req.query.since || undefined;
      const until = req.query.until || undefined;
      const storeDir = req.query.storeDir
        ? resolve(req.query.storeDir)
        : resolve(PROJECT_DIR, ".forge", "github-metrics");

      let metrics = [];
      if (org) {
        try {
          metrics = loadMetrics({ storeDir, org, since, until });
        } catch {
          metrics = [];
        }
      }

      let costReport = null;
      try { costReport = getCostReport(PROJECT_DIR); } catch { /* best-effort */ }

      res.json({
        org: org || null,
        since: since || null,
        until: until || null,
        metrics,
        costReport: costReport || null,
        _meta: { storeDir, recordCount: metrics.length },
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/github-personal — Phase-54 Slice 1
  // Best-effort aggregate: authenticated user profile + repo summary +
  // Copilot-coauthor commit scan. NEVER returns 500 — partial failures
  // populate errors.<key> as a category string inside a 200 response.
  // Query params:
  //   owner   — repo owner (optional — defaults from git remote get-url origin)
  //   repo    — repo name  (optional — defaults from git remote get-url origin)
  //   perPage — commits to scan, max 200 (optional, default 100)
  app.get("/api/github-personal", (req, res) => {
    let owner = req.query.owner?.trim() || null;
    let repo  = req.query.repo?.trim()  || null;
    const perPage = Math.min(parseInt(req.query.perPage ?? "100", 10), 200);

    let defaultsFrom = "query";
    if (!owner || !repo) {
      try {
        const raw = execSync("git remote get-url origin", {
          cwd: PROJECT_DIR,
          encoding: "utf-8",
          timeout: 5_000,
        }).trim();
        const m = raw.match(/github\.com[/:]([^/]+?)\/(.+?)(?:\.git)?$/);
        if (m) {
          if (!owner) owner = m[1];
          if (!repo)  repo  = m[2];
          defaultsFrom = "origin";
        }
      } catch { /* no git, no remote, or non-GitHub remote */ }
    }

    const result = {
      ok: true,
      user: null,
      repo: null,
      copilotSignal: null,
      errors: {},
      _meta: { ghAuthDetected: false, defaultsFrom },
    };

    try {
      result.user = fetchUserProfile();
      result._meta.ghAuthDetected = true;
    } catch (err) {
      result.errors.user = _ghPersonalErrCategory(err);
    }

    if (owner && repo) {
      try {
        result.repo = fetchRepoSummary({ owner, repo });
      } catch (err) {
        result.errors.repo = _ghPersonalErrCategory(err);
      }
    }

    if (owner && repo) {
      try {
        result.copilotSignal = scanCopilotCoauthors({ owner, repo, perPage });
      } catch (err) {
        result.errors.copilotSignal = _ghPersonalErrCategory(err);
      }
    }

    return res.json(result);
  });

  // REST API: GET /api/github-readiness — Phase Hotfix-v2.90.8 Slice 4
  // Returns inspectGithubStack() result for the requested project directory.
  // Query params:
  //   cwd       — project root to inspect (defaults to PROJECT_DIR)
  //   gh-token  — "true" to enable the network-backed assignable probe (opt-in)
  app.get("/api/team-activity", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit ?? "20", 10), 100);
      const since = req.query.since || undefined;
      const cwd = findProjectRoot(PROJECT_DIR);
      const activities = loadActivity({ storeDir: join(cwd, ".forge"), limit, since });
      res.json({ ok: true, count: activities.length, activities });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/team-dashboard", (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit ?? "50", 10), 200);
      const since = req.query.since || undefined;
      const cwd = findProjectRoot(PROJECT_DIR);
      const result = buildTeamDashboard({ storeDir: join(cwd, ".forge"), limit, since });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/github-readiness", (req, res) => {
    try {
      const cwd = req.query.cwd ? resolve(req.query.cwd) : findProjectRoot(PROJECT_DIR);
      const ghToken = req.query["gh-token"] === "true" ? true : null;
      const result = inspectGithubStack(cwd, { ghToken });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // REST API: GET /api/memory/report — GX.3 (v2.36) memory health aggregator
  // Backs the Memory tab in the dashboard (GX.1).
  app.get("/api/memory/report", (_req, res) => {
    try {
      res.json(buildMemoryReport(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/health-trend — health trend analysis
  app.get("/api/health-trend", (_req, res) => {
    try {
      const days = Math.max(1, Math.min(365, parseInt(_req.query.days) || 30));
      const metrics = _req.query.metrics ? _req.query.metrics.split(",").map(m => m.trim()) : null;
      res.json(getHealthTrend(PROJECT_DIR, days, metrics));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/tool/org-rules — export org custom instructions
  app.post("/api/tool/org-rules", (req, res) => {
    try {
      const format = req.body?.format || "github";
      const outputFile = req.body?.output || null;
      const result = callOrgRules({ format, output: outputFile }, PROJECT_DIR);
      if (outputFile) {
        res.json({ success: true, output: result });
      } else {
        res.type("text/plain").send(result);
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/drift — run drift check
}

function _registerDriftIncidentRoutes(app) {
  app.get("/api/drift", async (_req, res) => {
    try {
      const threshold = Math.max(0, Math.min(100, parseInt(_req.query.threshold) || 70));
      const analysis = await runAnalyze({ mode: "file", path: ".", cwd: PROJECT_DIR });
      const score = Math.max(0, 100 - (analysis.violations.length * 2));
      const history = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
      const prev = history.length ? history[history.length - 1] : null;
      const delta = prev ? score - prev.score : 0;
      const trend = !prev ? "stable" : delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
      const record = { timestamp: new Date().toISOString(), score, violations: analysis.violations, filesScanned: analysis.filesScanned, delta, trend };
      appendForgeJsonl("drift-history.json", record, PROJECT_DIR);
      if (score < threshold) {
        activeHub?.broadcast({ type: "drift-alert", data: { score, threshold, violations: analysis.violations.length }, timestamp: record.timestamp });
      }
      res.json({ score, violations: analysis.violations, filesScanned: analysis.filesScanned, trend, delta, historyLength: history.length + 1 });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/drift/history — drift history
  app.get("/api/drift/history", (_req, res) => {
    try {
      res.json(readForgeJsonl("drift-history.json", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/regression-guard — run regression guard
  app.post("/api/regression-guard", async (req, res) => {
    try {
      const { files = [], plan = null, failFast = false } = req.body || {};
      if (!Array.isArray(files)) {
        return res.status(400).json({ error: "files must be an array of strings" });
      }
      const result = await regressionGuard(files, { plan, failFast, cwd: PROJECT_DIR });
      res.status(result.success ? 200 : 422).json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/incident — capture a new incident
  app.post("/api/incident", (req, res) => {
    try {
      const { description, severity = "medium", files = [], resolvedAt = null } = req.body || {};
      if (!description || typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ error: "description is required" });
      }
      const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
      if (!VALID_SEVERITIES.includes(severity)) {
        return res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}` });
      }
      const capturedAt = new Date().toISOString();
      let mttr = null;
      if (resolvedAt) {
        const resolvedMs = new Date(resolvedAt).getTime();
        if (isNaN(resolvedMs)) return res.status(400).json({ error: `Invalid resolvedAt: '${resolvedAt}'` });
        const capturedMs = new Date(capturedAt).getTime();
        if (resolvedMs < capturedMs) return res.status(400).json({ error: "resolvedAt must be after capturedAt" });
        mttr = resolvedMs - capturedMs;
      }
      const record = { id: `inc-${Date.now()}`, description: description.trim(), severity, files, capturedAt, resolvedAt, mttr };
      appendForgeJsonl("incidents.jsonl", record, PROJECT_DIR);
      activeHub?.broadcast({ type: "incident-captured", data: record, timestamp: capturedAt });
      // Bridge dispatch to onCall if configured
      try {
        const forgeConfig = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
        if (forgeConfig.onCall) activeBridge?.dispatch?.({ type: "incident-captured", severity, description: record.description, onCall: forgeConfig.onCall });
      } catch { /* no .forge.json or no onCall — skip */ }
      res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/incidents — list all captured incidents
  app.get("/api/incidents", (_req, res) => {
    try {
      res.json(readForgeJsonl("incidents.jsonl", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/deploy-journal — record a deployment
  app.post("/api/deploy-journal", (req, res) => {
    try {
      const { version, by = "unknown", notes = null, slice = null } = req.body || {};
      if (!version || typeof version !== "string" || !version.trim()) {
        return res.status(400).json({ error: "version is required" });
      }
      const record = {
        id: `deploy-${Date.now()}`,
        version: version.trim(),
        by: (by || "unknown").trim(),
        notes: notes ? notes.trim() : null,
        slice: slice ? slice.trim() : null,
        deployedAt: new Date().toISOString(),
      };
      appendForgeJsonl("deploy-journal.jsonl", record, PROJECT_DIR);
      activeHub?.broadcast({ type: "deploy-recorded", data: record, timestamp: record.deployedAt });
      res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/deploy-journal — list all deploy journal entries
  app.get("/api/deploy-journal", (_req, res) => {
    try {
      res.json(readForgeJsonl("deploy-journal.jsonl", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/liveguard/traces — LiveGuard tool completion events
  app.get("/api/liveguard/traces", (_req, res) => {
    try {
      res.json(readForgeJsonl("liveguard-events.jsonl", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/audit/config — read audit activation config
  app.get("/api/audit/config", (_req, res) => {
    try {
      const config = loadAuditConfig(PROJECT_DIR);
      res.json(config);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: PUT /api/audit/config — update audit activation config
  app.put("/api/audit/config", (req, res) => {
    try {
      const patch = req.body || {};
      const result = saveAuditConfig(PROJECT_DIR, patch);
      if (!result.ok) return res.status(500).json({ error: result.error });
      res.json(result.config);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/audit/drain — trigger audit drain loop manually
  app.post("/api/audit/drain", async (req, res) => {
    try {
      const config = loadAuditConfig(PROJECT_DIR);
      const { maxRounds, dryRun, env } = req.body || {};
      const rounds = maxRounds || config.maxRounds || 5;
      if (config.forbidProduction && env === "production") {
        return res.status(403).json({ error: "production-forbidden" });
      }
      if (dryRun) {
        return res.json({ dryRun: true, config, wouldRun: true, maxRounds: rounds });
      }
      const drainResult = await runTemperingDrain({
        project: PROJECT_DIR,
        maxRounds: rounds,
        hub: activeHub,
      });
      res.json(drainResult);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/triage — prioritized alert triage (read-only)
  app.get("/api/triage", (req, res) => {
    try {
      const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
      const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };
      const minSeverity = SEVERITY_ORDER.includes(req.query.minSeverity) ? req.query.minSeverity : "low";
      const minIdx = SEVERITY_ORDER.indexOf(minSeverity);
      const maxResults = Math.max(1, Math.min(200, parseInt(req.query.max) || 20));

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

      // Open incidents
      const incidents = readForgeJsonl("incidents.jsonl", [], PROJECT_DIR);
      for (const inc of incidents) {
        if (inc.resolvedAt) continue;
        const sev = SEVERITY_ORDER.includes(inc.severity) ? inc.severity : "medium";
        if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
        const ts = inc.capturedAt || new Date(0).toISOString();
        const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
        alerts.push({ source: "incident", id: inc.id, description: inc.description, severity: sev, timestamp: ts, files: inc.files || [], priority: Math.round(priority * 100) / 100 });
      }

      // Latest drift violations
      const driftHistory = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
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

      alerts.sort((a, b) => b.priority - a.priority || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json({ total: alerts.length, showing: Math.min(maxResults, alerts.length), minSeverity, alerts: alerts.slice(0, maxResults), generatedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/runbook — generate runbook from plan file
  app.post("/api/runbook", (req, res) => {
    try {
      const { plan, includeIncidents = true } = req.body || {};
      if (!plan || typeof plan !== "string") {
        return res.status(400).json({ error: "plan is required and must be a string" });
      }
      const planPath = resolve(PROJECT_DIR, plan);
      if (!existsSync(planPath)) {
        return res.status(404).json({ error: `Plan file not found: ${plan}` });
      }
      const parsed = parsePlan(planPath, PROJECT_DIR);
      const content = generateRunbook(parsed, PROJECT_DIR, { includeIncidents });
      const runbookName = planNameToRunbookName(planPath);
      const runbooksDir = resolve(PROJECT_DIR, ".forge", "runbooks");
      mkdirSync(runbooksDir, { recursive: true });
      writeFileSync(resolve(runbooksDir, runbookName), content, "utf-8");
      res.status(201).json({ runbook: `.forge/runbooks/${runbookName}`, slices: parsed.slices.length, generatedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/runbooks — list generated runbooks
  app.get("/api/runbooks", (_req, res) => {
    try {
      const runbooksDir = resolve(PROJECT_DIR, ".forge", "runbooks");
      if (!existsSync(runbooksDir)) return res.json([]);
      const files = readdirSync(runbooksDir).filter((f) => f.endsWith(".md")).sort();
      res.json(files.map((f) => ({ file: `.forge/runbooks/${f}` })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── v2.37 Crucible REST API (Slice 01.5) ──────────────────────────
  // Back the dashboard Crucible tab. Thin HTTP wrappers around the
  // crucible-server handlers that already power the MCP tools, so the
  // dashboard and the agent share one code path.

  // POST /api/crucible/submit — start a new smelt
}

function _registerCrucibleHotspotRoutes(app) {
  app.post("/api/crucible/submit", (req, res) => {
    try {
      const { rawIdea, lane = null, source = "human", parentSmeltId = null } = req.body || {};
      if (typeof rawIdea !== "string" || !rawIdea.trim()) {
        return res.status(400).json({ error: "rawIdea is required" });
      }
      const result = crucibleHandleSubmit({
        rawIdea,
        lane,
        source,
        parentSmeltId,
        projectDir: PROJECT_DIR,
        hub: activeHub,
      });
      res.status(201).json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/crucible/ask — record an answer and fetch the next question
  app.post("/api/crucible/ask", (req, res) => {
    try {
      const { id, answer, questionId } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleAsk({ id, answer, questionId, projectDir: PROJECT_DIR, hub: activeHub });
      res.json(result);
    } catch (err) {
      // Issue #138 — surface ASK_QUESTION_MISMATCH as 409 with the expected
      // pending question so the client can re-fetch and retry.
      if (err && err.code === "ASK_QUESTION_MISMATCH") {
        return res.status(409).json({
          error: err.message,
          code: err.code,
          expected: err.expected,
          got: err.got,
        });
      }
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/crucible/list — all smelts (optionally filtered by status)
  app.get("/api/crucible/list", (req, res) => {
    try {
      const status = typeof req.query?.status === "string" ? req.query.status : null;
      res.json(crucibleHandleList({ status, projectDir: PROJECT_DIR }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/preview?id=… — live markdown preview + unresolved fields
  app.get("/api/crucible/preview", (req, res) => {
    try {
      const id = typeof req.query?.id === "string" ? req.query.id : null;
      if (!id) return res.status(400).json({ error: "id is required" });
      res.json(crucibleHandlePreview({ id, projectDir: PROJECT_DIR }));
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/crucible/finalize — emit docs/plans/Phase-NN.md
  app.post("/api/crucible/finalize", (req, res) => {
    try {
      const { id, overwrite } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleFinalize({
        id,
        projectDir: PROJECT_DIR,
        hub: activeHub,
        overwrite: overwrite === true,
      });
      res.status(201).json(result);
    } catch (err) {
      // Issue #136 — propagate criticalGaps so callers don't have to fall
      // back to GET /preview to discover what's missing.
      if (err instanceof CrucibleFinalizeRefusedError) {
        return res.status(409).json({
          error: "Cannot finalize: smelt has unresolved fields. Resolve required questions first.",
          criticalGaps: err.payload?.criticalGaps || [],
          unresolvedFields: err.payload?.criticalGaps || [],
          hint: err.payload?.hint || "GET /api/crucible/preview?id=... for details",
        });
      }
      // Issue #137 — surface "plan already exists" as 409 with a path hint
      // so callers can re-issue with overwrite:true if they really mean it.
      if (err && err.code === "PLAN_ALREADY_EXISTS") {
        return res.status(409).json({
          error: err.message,
          phaseName: err.phaseName,
          planPath: err.planPath,
          draftPath: err.draftPath,
          hint: "Re-submit with overwrite:true to replace, or accept the side-by-side draft path.",
        });
      }
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/crucible/abandon — mark a smelt abandoned (no plan written)
  app.post("/api/crucible/abandon", (req, res) => {
    try {
      const { id } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleAbandon({ id, projectDir: PROJECT_DIR });
      res.json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/crucible/config — load Crucible config (defaults if absent)
  app.get("/api/crucible/config", (_req, res) => {
    try {
      res.json(loadCrucibleConfig(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/crucible/config — persist Crucible config (sanitized)
  app.post("/api/crucible/config", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "body must be a JSON object" });
      }
      res.json(saveCrucibleConfig(PROJECT_DIR, req.body));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/manual-imports — read-only audit log for the
  // Governance tab. Newest first, capped at 500 so we never leak a
  // runaway log into the browser.
  app.get("/api/crucible/manual-imports", (_req, res) => {
    try {
      const entries = readManualImports(PROJECT_DIR);
      const capped = entries
        .slice()
        .reverse()
        .slice(0, 500);
      res.json({ total: entries.length, showing: capped.length, entries: capped });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/governance — read-only view of PROJECT-PRINCIPLES.md
  // and any project-profile files. Returns file content + mtime so the
  // Governance tab can render it and offer an "open in VS Code" deep link.
  app.get("/api/crucible/governance", (_req, res) => {
    try {
      const files = [
        { path: "docs/plans/PROJECT-PRINCIPLES.md", role: "principles" },
        { path: ".github/instructions/project-profile.instructions.md", role: "project-profile" },
        { path: ".github/instructions/project-principles.instructions.md", role: "principles-instruction" },
      ];
      const out = [];
      for (const f of files) {
        const abs = resolve(PROJECT_DIR, f.path);
        if (!existsSync(abs)) continue;
        try {
          const stat = statSync(abs);
          const content = readFileSync(abs, "utf-8");
          out.push({
            path: f.path,
            absolutePath: abs,
            role: f.role,
            mtime: stat.mtime.toISOString(),
            bytes: stat.size,
            content,
          });
        } catch { /* skip unreadable */ }
      }
      res.json({ files: out, readOnly: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/hotspots — git churn hotspot analysis (cache TTL 24h)
  app.get("/api/hotspots", (_req, res) => {
    try {
      const top = Math.max(1, Math.min(100, parseInt(_req.query.top) || 10));
      const since = _req.query.since || "6 months ago";
      const cacheFile = resolve(PROJECT_DIR, ".forge", "hotspot-cache.json");

      let cached = null;
      if (existsSync(cacheFile)) {
        try {
          cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
          const age = Date.now() - new Date(cached.generatedAt).getTime();
          if (age > 24 * 60 * 60 * 1000 || cached.since !== since) cached = null;
        } catch { cached = null; }
      }

      if (!cached) {
        const raw = execSync(`git log --format=format: --name-only --since="${since}"`, { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 30_000 });
        const counts = {};
        for (const line of raw.split("\n")) {
          const f = line.trim();
          if (f && !f.startsWith(".forge/")) counts[f] = (counts[f] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const hotspots = sorted.map(([file, commits]) => ({ file, commits }));
        mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
        cached = { generatedAt: new Date().toISOString(), since, totalFiles: hotspots.length, hotspots };
        writeFileSync(cacheFile, JSON.stringify(cached, null, 2), "utf-8");
      }

      res.json({ ...cached, hotspots: cached.hotspots.slice(0, top), showing: Math.min(top, cached.hotspots.length) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/deps/watch — latest dependency vulnerability snapshot
}

function _registerDepsTemperingToolRoutes(app) {
  app.get("/api/deps/watch", (_req, res) => {
    try {
      const snapshotPath = resolve(PROJECT_DIR, ".forge", "deps-snapshot.json");
      if (!existsSync(snapshotPath)) return res.json({ snapshot: null, message: "No dependency snapshot yet — run forge_dep_watch first" });
      res.json(JSON.parse(readFileSync(snapshotPath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/deps/watch/run — trigger dependency scan (auth required)
  app.post("/api/deps/watch/run", (req, res) => {
    try {
      if (!checkApprovalSecret(req, res)) return;
      const pkgPath = resolve(PROJECT_DIR, "package.json");
      if (!existsSync(pkgPath)) return res.status(400).json({ error: "No package.json found" });

      let auditResult;
      try {
        const raw = execSync("npm audit --json 2>&1", { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 60_000 });
        auditResult = JSON.parse(raw);
      } catch (err) {
        if (err.stdout) { try { auditResult = JSON.parse(err.stdout); } catch { auditResult = null; } }
        if (!auditResult) return res.status(500).json({ error: `npm audit failed: ${err.message}` });
      }

      const currentVulns = [];
      const vulns = auditResult.vulnerabilities || {};
      for (const [name, info] of Object.entries(vulns)) {
        currentVulns.push({ name, severity: info.severity || "unknown" });
      }

      mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
      const snapshot = { capturedAt: new Date().toISOString(), depCount: currentVulns.length, vulnerabilities: currentVulns };
      writeFileSync(resolve(PROJECT_DIR, ".forge", "deps-snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
      res.json(snapshot);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/secret-scan — latest secret scan cache
  app.get("/api/secret-scan", (_req, res) => {
    try {
      const cachePath = resolve(PROJECT_DIR, ".forge", "secret-scan-cache.json");
      if (!existsSync(cachePath)) return res.json({ cache: null, message: "No scan results yet — run forge_secret_scan first" });
      res.json(JSON.parse(readFileSync(cachePath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/secret-scan/run — trigger secret scan (auth required)
  app.post("/api/secret-scan/run", (req, res) => {
    try {
      if (!checkApprovalSecret(req, res)) return;
      const since = req.body?.since || "HEAD~1";
      const threshold = Math.max(3.5, Math.min(5.0, parseFloat(req.body?.threshold) || 4.0));
      let diffOutput;
      try {
        diffOutput = execSync(`git diff ${since}`, { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 30_000 });
      } catch {
        return res.json({ clean: null, scannedFiles: 0, findings: [], error: "git unavailable" });
      }
      const { findings, scannedFiles } = _scanDiffForSecrets(diffOutput, threshold);
      const result = { scannedAt: new Date().toISOString(), since, threshold, scannedFiles: scannedFiles.size, clean: findings.length === 0, findings };
      mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
      writeFileSync(resolve(PROJECT_DIR, ".forge", "secret-scan-cache.json"), JSON.stringify(result, null, 2), "utf-8");
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/env/diff — latest env diff cache
  app.get("/api/env/diff", (_req, res) => {
    try {
      const cachePath = resolve(PROJECT_DIR, ".forge", "env-diff-cache.json");
      if (!existsSync(cachePath)) return res.json({ cache: null, message: "No diff data yet — run forge_env_diff first" });
      res.json(JSON.parse(readFileSync(cachePath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/tempering/artifact — serve visual-diff PNG artifacts (TEMPER-04 Slice 04.2)
  app.get("/api/tempering/artifact", (req, res) => {
    try {
      const reqPath = req.query.path;
      if (!reqPath || typeof reqPath !== "string") {
        return res.status(400).json({ error: "path query parameter is required" });
      }
      const resolved = resolve(reqPath);
      const temperingRoot = resolve(PROJECT_DIR, ".forge", "tempering");
      // Path-traversal safety: must be under .forge/tempering/
      if (!resolved.startsWith(temperingRoot)) {
        return res.status(403).json({ error: "Access denied: path must be under .forge/tempering/" });
      }
      if (!existsSync(resolved)) {
        return res.status(404).json({ error: "Artifact not found" });
      }
      res.type("image/png").sendFile(resolved);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/tempering/bug-stub — compatibility wrapper (TEMPER-04 → TEMPER-06 bridge)
  // Delegates to real registerBug() for persistence, preserving the original response shape.
  app.post("/api/tempering/bug-stub", async (req, res) => {
    try {
      const { urlHash, url, verdict, explanation } = req.body || {};
      if (!urlHash || typeof urlHash !== "string") {
        return res.status(400).json({ error: "urlHash is required" });
      }
      const cwd = findProjectRoot(PROJECT_DIR);
      const result = await registerBug({
        cwd,
        scanner: "visual-diff",
        severity: "medium",
        evidence: { testName: urlHash, assertionMessage: explanation || verdict || "visual regression", visualDiffScore: null },
        correlationId: `bug-stub-${Date.now()}`,
        classification: "real-bug",
        classifierMeta: { rule: "bug-stub-compat", reason: "filed via legacy bug-stub endpoint", confidence: 1.0, source: "rule" },
        hub: activeHub,
      });
      // Preserve legacy response shape for backward compatibility
      const record = {
        id: result.bugId || `bug-${Date.now()}`,
        urlHash,
        url: url || null,
        verdict: verdict || null,
        explanation: explanation || null,
        createdAt: new Date().toISOString(),
      };
      res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/bugs/list — dashboard endpoint for Bug Registry tab
  app.get("/api/bugs/list", (req, res) => {
    try {
      const cwd = findProjectRoot(PROJECT_DIR);
      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.severity) filters.severity = req.query.severity;
      if (req.query.scanner) filters.scanner = req.query.scanner;
      if (req.query.since) filters.since = req.query.since;
      if (req.query.until) filters.until = req.query.until;
      res.json(listBugs(cwd, filters));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/tool/run-plan — run or estimate a plan (with arg validation)
  // Validates --only-slices value before proxying to the pforge CLI.
  const ONLY_SLICES_RE = /^[0-9](?:[0-9,\- ]*[0-9])?$/;
  app.post("/api/tool/run-plan", (req, res) => {
    try {
      const toolArgs = req.body?.args || "";
      const tokens = toolArgs.trim().split(/\s+/);
      const onlySlicesIdx = tokens.indexOf("--only-slices");
      if (onlySlicesIdx !== -1) {
        const val = tokens[onlySlicesIdx + 1];
        if (!val || !ONLY_SLICES_RE.test(val)) {
          return res.status(400).json({ error: "invalid --only-slices value" });
        }
      }
      const result = runPforge(`run-plan ${toolArgs}`.trim(), PROJECT_DIR);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/tool/:name", async (req, res) => {
    try {
      const toolName = req.params.name;
      if (MCP_ONLY_TOOLS.has(toolName)) {
        // Dispatch through the MCP CallToolRequestSchema handler directly
        try {
          const fakeRequest = { method: "tools/call", params: { name: toolName, arguments: req.body || {} } };
          const handlers = server._requestHandlers || server.requestHandlers;
          const handler = handlers?.get?.("tools/call");
          if (handler) {
            const mcpResult = await handler(fakeRequest);
            if (mcpResult?.content?.[0]?.text) {
              try { return res.json(JSON.parse(mcpResult.content[0].text)); } catch { return res.json(mcpResult); }
            }
            return res.json(mcpResult || { error: "No result from tool handler" });
          }
        } catch (err) {
          return res.status(500).json({ error: `Tool handler error: ${err.message}` });
        }
        // Fallback: try executeTool for CLI-delegated tools
        const syncResult = executeTool(toolName, req.body || {});
        if (syncResult !== null) return res.json(syncResult);
      }
      const toolArgs = req.body?.args || "";
      const result = runPforge(`${toolName} ${toolArgs}`.trim(), PROJECT_DIR);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/hub — hub status
}

function _registerHubTracesPlansRoutes(app) {
  app.get("/api/hub", (_req, res) => {
    if (activeHub) {
      res.json({ running: true, port: activeHub.port, clients: activeHub.getClients() });
    } else {
      res.json({ running: false });
    }
  });

  // REST API: GET /api/replay/:runIdx/:sliceId — session replay log
  app.get("/api/replay/:runIdx/:sliceId", (req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.status(404).json({ error: "No runs" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      const runIdx = parseInt(req.params.runIdx, 10);
      if (runIdx < 0 || runIdx >= dirs.length) return res.status(404).json({ error: "Run not found" });
      const logPath = resolve(runsDir, dirs[runIdx], `slice-${req.params.sliceId}-log.txt`);
      if (!existsSync(logPath)) return res.status(404).json({ error: "Log not found" });
      res.json({ log: readFileSync(logPath, "utf-8") });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/traces — list all runs from index.jsonl
  app.get("/api/traces", (_req, res) => {
    try {
      const entries = readRunIndex(PROJECT_DIR);
      res.json(entries.reverse()); // Newest first
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Phase-COST-BADGE-FIX — derive cost_usd for historical slice JSON files
  // that pre-date the orchestrator stamping the field onto sliceResult.
  // Pure read-side enrichment; never writes to disk. Returns the same object
  // shape with `cost_usd` and `cost_breakdown` populated when missing AND a
  // pricing inference is possible. Errors are swallowed (fail-open).
  let _priceSliceFn = null;
  async function _ensurePriceSliceLoaded() {
    if (_priceSliceFn) return _priceSliceFn;
    try {
      const mod = await import("../cost-service.mjs");
      _priceSliceFn = mod.priceSlice || null;
    } catch { _priceSliceFn = null; }
    return _priceSliceFn;
  }
  function backfillSliceCost(slice) {
    if (!slice || typeof slice !== "object") return slice;
    if (typeof slice.cost_usd === "number") return slice; // already present
    if (!_priceSliceFn) return slice;                      // pricer unavailable
    if (!slice.tokens || typeof slice.tokens !== "object") return slice;
    try {
      const priced = _priceSliceFn(slice.tokens, slice.worker);
      if (priced && typeof priced.cost_usd === "number") {
        slice.cost_usd = priced.cost_usd;
        if (priced.cost_breakdown && !slice.cost_breakdown) {
          slice.cost_breakdown = priced.cost_breakdown;
        }
      }
    } catch { /* fail-open — missing badge is acceptable, broken endpoint is not */ }
    return slice;
  }

  // GET /api/runs/latest — most recent run summary + current slice status
  app.get("/api/runs/latest", (_req, res) => {
    try {
      // Lazy-load the pricer once; fire-and-forget so the first request still
      // succeeds without it (fields just won't be backfilled until the second).
      if (!_priceSliceFn) _ensurePriceSliceLoaded().catch(() => {});
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.status(404).json({ error: "No runs yet" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      if (dirs.length === 0) return res.status(404).json({ error: "No runs yet" });
      const runDir = resolve(runsDir, dirs[0]);
      const summaryPath = resolve(runDir, "summary.json");
      const runPath = resolve(runDir, "run.json");
      let base = {};
      if (existsSync(summaryPath)) {
        base = JSON.parse(readFileSync(summaryPath, "utf-8"));
      } else if (existsSync(runPath)) {
        base = { status: "running", ...JSON.parse(readFileSync(runPath, "utf-8")) };
      } else {
        base = { status: "unknown" };
      }
      // Attach current slice status from the most recent slice-N.json
      const sliceFiles = existsSync(runDir)
        ? readdirSync(runDir).filter((f) => /^slice-\d+\.json$/.test(f)).sort((a, b) => {
            const na = parseInt(a.match(/\d+/)[0], 10), nb = parseInt(b.match(/\d+/)[0], 10);
            return nb - na; // descending — latest slice first
          })
        : [];
      if (sliceFiles.length > 0) {
        try {
          const latestSlice = JSON.parse(readFileSync(resolve(runDir, sliceFiles[0]), "utf-8"));
          base.currentSlice = backfillSliceCost(latestSlice);
        } catch { /* skip corrupt slice */ }
      }
      res.json(base);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/runs/:runIdx — single run detail with slice data
  app.get("/api/runs/:runIdx", (req, res) => {
    try {
      if (!_priceSliceFn) _ensurePriceSliceLoaded().catch(() => {});
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.status(404).json({ error: "No runs" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      const idx = parseInt(req.params.runIdx, 10);
      if (isNaN(idx) || idx < 0 || idx >= dirs.length) return res.status(404).json({ error: "Run not found" });
      const runDir = resolve(runsDir, dirs[idx]);
      const summaryPath = resolve(runDir, "summary.json");
      if (!existsSync(summaryPath)) return res.status(404).json({ error: "No summary" });
      const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
      // Load per-slice detail files
      const slices = [];
      const sliceFiles = readdirSync(runDir).filter((f) => /^slice-\d+\.json$/.test(f)).sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0], 10), nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb;
      });
      for (const sf of sliceFiles) {
        try {
          const parsed = JSON.parse(readFileSync(resolve(runDir, sf), "utf-8"));
          slices.push(backfillSliceCost(parsed));
        } catch { /* skip */ }
      }
      res.json({ summary, slices });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/skills — available slash command skills
  app.get("/api/skills", (_req, res) => {
    try {
      const skills = [];
      // Check .github/skills/
      const skillsDir = resolve(PROJECT_DIR, ".github", "skills");
      if (existsSync(skillsDir)) {
        for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const skillMd = resolve(skillsDir, entry.name, "SKILL.md");
            if (existsSync(skillMd)) {
              try {
                const content = readFileSync(skillMd, "utf-8");
                const titleMatch = content.match(/^#\s+(.+)/m);
                const descMatch = content.match(/^(?!#)(.{10,})/m);
                skills.push({ name: entry.name, description: descMatch?.[1]?.trim() || "", file: `.github/skills/${entry.name}/SKILL.md` });
              } catch { /* skip */ }
            }
          }
        }
      }
      // Built-in forge skills
      const builtins = [
        { name: "code-review", description: "Comprehensive review: architecture, security, testing, patterns", file: "built-in" },
        { name: "test-sweep", description: "Run all test suites and aggregate results", file: "built-in" },
        { name: "staging-deploy", description: "Build, push, migrate, deploy, and verify on staging", file: "built-in" },
        { name: "dependency-audit", description: "Scan dependencies for vulnerabilities and outdated packages", file: "built-in" },
        { name: "release-notes", description: "Generate release notes from git history and CHANGELOG", file: "built-in" },
        { name: "health-check", description: "Forge diagnostic: smith → validate → sweep", file: "built-in" },
        { name: "forge-execute", description: "Guided plan execution: list plans → estimate cost → execute", file: "built-in" },
      ];
      res.json([...skills, ...builtins]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/traces/:runId — single run trace detail (v2.8: includes quorum data)
  app.get("/api/traces/:runId", (req, res) => {
    try {
      const runDir = resolve(PROJECT_DIR, ".forge", "runs", req.params.runId);
      if (!existsSync(runDir)) return res.status(404).json({ error: "Run not found" });
      let traceResult = null;
      // Try trace.json first, fall back to manifest, then summary
      const tracePath = resolve(runDir, "trace.json");
      if (existsSync(tracePath)) traceResult = JSON.parse(readFileSync(tracePath, "utf-8"));
      if (!traceResult) {
        const manifestPath = resolve(runDir, "manifest.json");
        if (existsSync(manifestPath)) traceResult = JSON.parse(readFileSync(manifestPath, "utf-8"));
      }
      if (!traceResult) {
        const summaryPath = resolve(runDir, "summary.json");
        if (existsSync(summaryPath)) traceResult = JSON.parse(readFileSync(summaryPath, "utf-8"));
      }
      if (!traceResult) return res.status(404).json({ error: "No trace data" });

      // Attach quorum data from slice-N-quorum.json files
      const quorumFiles = readdirSync(runDir).filter((f) => /^slice-\d+-quorum\.json$/.test(f)).sort();
      if (quorumFiles.length > 0) {
        traceResult.quorum = {};
        for (const qf of quorumFiles) {
          const sliceNum = qf.match(/slice-(\d+)-quorum/)[1];
          try { traceResult.quorum[sliceNum] = JSON.parse(readFileSync(resolve(runDir, qf), "utf-8")); } catch { /* skip */ }
        }
      }
      res.json(traceResult);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // .well-known discovery endpoint
  app.get("/.well-known/plan-forge.json", (_req, res) => {
    try {
      const surface = buildCapabilitySurface(TOOLS, { cwd: PROJECT_DIR, hubPort: activeHub?.port || null });
      res.json(surface);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Capabilities API
  app.get("/api/capabilities", (_req, res) => {
    try {
      const surface = buildCapabilitySurface(TOOLS, { cwd: PROJECT_DIR, hubPort: activeHub?.port || null });
      res.json(surface);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Extensions catalog API (structured JSON)
  app.get("/api/extensions", (_req, res) => {
    try {
      const catalogPath = join(PROJECT_DIR, "extensions", "catalog.json");
      if (existsSync(catalogPath)) {
        const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
        const extensions = catalog.extensions || {};
        res.json(Object.values(extensions));
      } else {
        res.json([]);
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Plans list API — parsed plan metadata for dashboard browser
  app.get("/api/plans", (_req, res) => {
    try {
      const plansDir = resolve(PROJECT_DIR, "docs", "plans");
      if (!existsSync(plansDir)) return res.json([]);
      const files = readdirSync(plansDir)
        .filter((f) => /^Phase-.*-PLAN\.md$/i.test(f))
        .sort();
      const plans = [];
      for (const file of files) {
        try {
          const parsed = parsePlan(resolve(plansDir, file), PROJECT_DIR);
          plans.push({
            file: `docs/plans/${file}`,
            title: parsed.meta.title || file,
            status: parsed.meta.status || "Unknown",
            sliceCount: parsed.slices.length,
            branch: parsed.meta.branch || null,
            scopeContract: parsed.scopeContract || null,
            slices: parsed.slices.map((s) => ({
              id: s.id || s.number,
              title: s.title || s.name || `Slice ${s.number}`,
              tasks: s.tasks || [],
              buildCommand: s.buildCommand || null,
              testCommand: s.testCommand || null,
              parallel: s.parallel || false,
              depends: s.depends || [],
              scope: s.scope || [],
            })),
          });
        } catch { /* skip malformed plans */ }
      }
      res.json(plans);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // OpenBrain memory status API
}

function _registerMemoryBrainRoutes(app) {
  app.get("/api/memory", (_req, res) => {
    try {
      const configured = isOpenBrainConfigured(PROJECT_DIR);
      const result = { configured, endpoint: null, serverName: null };
      if (configured) {
        // Extract endpoint from mcp.json
        for (const configFile of [".vscode/mcp.json", ".claude/mcp.json"]) {
          const configPath = join(PROJECT_DIR, configFile);
          if (existsSync(configPath)) {
            try {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              const servers = config.servers || config.mcpServers || {};
              for (const [name, server] of Object.entries(servers)) {
                const serverStr = JSON.stringify(server).toLowerCase();
                if (serverStr.includes("openbrain") || serverStr.includes("open-brain")) {
                  result.serverName = name;
                  result.endpoint = server.url || server.command || null;
                  break;
                }
              }
            } catch { /* ignore parse errors */ }
          }
          if (result.endpoint) break;
        }
      }
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // OpenBrain memory search API
  app.post("/api/memory/search", (req, res) => {
    try {
      if (!isOpenBrainConfigured(PROJECT_DIR)) {
        return res.json({ configured: false, results: [], note: "OpenBrain not configured. Add openbrain MCP server to enable project memory." });
      }
      const query = req.body?.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query is required" });
      }
      // Search local .forge memory files for relevant content
      const results = [];
      const forgeDir = resolve(PROJECT_DIR, ".forge");
      const searchDirs = [forgeDir, resolve(PROJECT_DIR, "docs", "plans")];
      const searchPattern = query.toLowerCase();
      for (const dir of searchDirs) {
        if (!existsSync(dir)) continue;
        try {
          const files = readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".md"));
          for (const file of files.slice(0, 20)) {
            try {
              const content = readFileSync(resolve(dir, file), "utf-8");
              if (content.toLowerCase().includes(searchPattern)) {
                const lines = content.split("\n");
                const matchLine = lines.findIndex((l) => l.toLowerCase().includes(searchPattern));
                const excerpt = lines.slice(Math.max(0, matchLine - 1), matchLine + 3).join("\n").substring(0, 200);
                results.push({ file: `${dir === forgeDir ? ".forge" : "docs/plans"}/${file}`, excerpt, line: matchLine + 1 });
              }
            } catch { /* skip unreadable */ }
          }
        } catch { /* skip missing dir */ }
      }
      res.json({ configured: true, results, note: results.length === 0 ? "No matches found. Try broader terms or check preset suggestions." : null });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/memory/capture — capture a thought directly into OpenBrain via REST
  //   Auth: Authorization: Bearer <bridge.approvalSecret>  OR  ?token=<secret>
  //   Body: { content, project?, type?, source?, created_by? }
  //   OpenClaw and external tools use this to write memories without going through an AI worker.
  app.post("/api/memory/capture", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    if (!isOpenBrainConfigured(PROJECT_DIR)) {
      return res.status(503).json({ error: "OpenBrain is not configured. Add the openbrain MCP server to .vscode/mcp.json or .claude/mcp.json." });
    }

    const { content, project, type, source, created_by } = req.body || {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required and must be a string" });
    }

    // Resolve project name from .forge.json if not provided
    let resolvedProject = project || null;
    if (!resolvedProject) {
      try {
        const forgeConfig = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
        resolvedProject = forgeConfig.projectName || "plan-forge";
      } catch { resolvedProject = "plan-forge"; }
    }

    const thought = {
      content,
      project: resolvedProject,
      type: type || "decision",
      source: source || "api/memory/capture",
      created_by: created_by || "openclaw",
      captured_at: new Date().toISOString(),
    };

    // Broadcast to hub so dashboard + bridge can observe the capture event
    if (activeHub) {
      activeHub.broadcast({ type: "memory-captured", thought, timestamp: thought.captured_at });
    }

    // Return the thought payload — the caller (OpenClaw) must forward to OpenBrain's capture_thought API
    // This endpoint normalises and validates; OpenBrain's own REST/MCP handles persistence.
    res.json({
      ok: true,
      thought,
      note: "Forward this payload to OpenBrain capture_thought to persist. Plan Forge does not proxy writes to OpenBrain directly.",
    });
  });

  // POST /api/memory/drain — manually drain pending OpenBrain queue records
  //   Auth: Authorization: Bearer <bridge.approvalSecret>  OR  ?token=<secret>
  //   Returns { ok, source, attempted, delivered, deferred, dlq, durationMs }
  app.post("/api/memory/drain", async (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    if (!isOpenBrainConfigured(PROJECT_DIR)) {
      return res.status(503).json({ ok: false, error: "OpenBrain is not configured." });
    }
    try {
      const result = await runDrainPass(PROJECT_DIR, "rest-drain", activeHub);
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // Brain test — round-trip capture+search against the configured OpenBrain SSE
  // endpoint. Confirms the L3 memory pipeline is alive before bulk replays.
  // Returns { ok, marker, hit, capturedId, durationMs } or {ok:false, error}.
  app.post("/api/brain/test", async (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    const cfg = readOpenBrainConfig(PROJECT_DIR);
    if (!cfg) {
      return res.status(503).json({ ok: false, error: "OpenBrain SSE endpoint not found in .vscode/mcp.json or .claude/mcp.json." });
    }
    if (!cfg.key) {
      return res.status(503).json({ ok: false, error: "OpenBrain auth key not resolved. Set OPENBRAIN_KEY env var or check the mcp.json headers entry." });
    }
    let client = null;
    try {
      client = await createOpenBrainClient(cfg);
      const project = req.body?.project || "plan-forge";
      const result = await brainRoundTrip(client, {
        project,
        source: "pforge-brain-test",
        indexDelayMs: Number(req.body?.indexDelayMs ?? 500),
      });
      res.json({ ok: result.ok, ...result, endpoint: cfg.url });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    } finally {
      if (client) { try { await client.close(); } catch { /* best-effort */ } }
    }
  });

  // Brain replay — bulk-load records from a source (queue jsonl, markdown file,
  // or markdown directory) into OpenBrain via capture_thought. Bounded output:
  // returns counts + a small samples array; full per-record receipt log lives
  // at .forge/openbrain-replay-<ts>.jsonl.
  app.post("/api/brain/replay", async (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    const replayRequest = _buildBrainReplayRequest(req.body, readOpenBrainConfig(PROJECT_DIR));
    if (!replayRequest.ok) return res.status(replayRequest.status).json({ ok: false, error: replayRequest.error });

    let replayRun = null;
    try {
      replayRun = await _prepareBrainReplayRun(replayRequest);
      if (!replayRun.ok) return res.status(replayRun.status).json({ ok: false, error: replayRun.error });
      res.json(await _runBrainReplay(replayRun));
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    } finally {
      _closeBrainReplayReceiptLog(replayRun?.receiptStream);
      await _closeBrainReplayClient(replayRun?.client);
    }
  });

  // Memory search presets API
  app.get("/api/memory/presets", (_req, res) => {
    try {
      // Build context-aware presets from project config
      let projectName = "Plan Forge";
      let preset = "";
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      if (existsSync(configPath)) {
        try {
          const config = JSON.parse(readFileSync(configPath, "utf-8"));
          projectName = config.projectName || projectName;
          preset = config.preset || "";
        } catch { /* ignore */ }
      }
      // Check what data exists to suggest relevant searches
      const hasRuns = existsSync(resolve(PROJECT_DIR, ".forge", "runs"));
      const hasCost = existsSync(resolve(PROJECT_DIR, ".forge", "cost-history.json"));
      const hasPlans = existsSync(resolve(PROJECT_DIR, "docs", "plans"));
      const presets = {
        categories: [
          { name: "Plans & Phases", icon: "📋", queries: ["Phase", "PLAN", "roadmap", "slice", "scope contract"] },
          { name: "Architecture", icon: "🏗️", queries: ["architecture", "design", "pattern", "layer", "service"] },
          { name: "Configuration", icon: "⚙️", queries: ["config", "model", "routing", "quorum", "preset"] },
          { name: "Testing", icon: "🧪", queries: ["test", "validation", "gate", "coverage", "sweep"] },
          { name: "Cost & Tokens", icon: "💰", queries: ["cost", "token", "spend", "model", "budget"] },
          { name: "Issues & Fixes", icon: "🐛", queries: ["bug", "fix", "error", "fail", "TODO"] },
        ],
        recentFiles: [],
        projectContext: { projectName, preset, hasRuns, hasCost, hasPlans },
      };
      // Add recent run files as suggested search targets
      if (hasRuns) {
        const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
        try {
          const dirs = readdirSync(runsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, 5);
          presets.recentFiles = dirs.map((d) => ({ dir: d, label: d.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+_/, "") }));
        } catch { /* ignore */ }
      }
      res.json(presets);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Worker detection API
  app.get("/api/workers", (_req, res) => {
    try {
      const workers = detectWorkers(PROJECT_DIR);
      res.json(workers);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Image generation API
}

function _registerImageBridgeFixRoutes(app) {
  app.post("/api/image/generate", async (req, res) => {
    try {
      const { prompt, outputPath, model, size } = req.body || {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }
      if (!outputPath || typeof outputPath !== "string") {
        return res.status(400).json({ error: "outputPath is required" });
      }
      const result = await generateImage(prompt, {
        model: model || "grok-imagine-image",
        size: size || "1024x1024",
        outputPath,
        cwd: PROJECT_DIR,
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Bridge REST API ─────────────────────────────────────────────────

  // Helper: validate the optional bridge approval secret.
  // If bridge.approvalSecret is set, the request must supply it via
  //   Authorization: Bearer <secret>  OR  ?token=<secret>
  function checkApprovalSecret(req, res) {
    const secret = activeBridge?.config?.approvalSecret;
    if (!secret) return true; // No secret configured — open access
    const authHeader = req.headers?.authorization ?? "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    const queryToken = req.query?.token ?? null;
    if (bearerToken === secret || queryToken === secret) return true;
    res.status(401).json({ error: "Unauthorized — invalid or missing approval secret" });
    return false;
  }

  // GET /api/bridge/status — connected channels, pending approvals, stats
  app.get("/api/bridge/status", (_req, res) => {
    if (!activeBridge) {
      return res.json({
        enabled: false,
        message: "Bridge not initialised (no bridge config in .forge.json)",
      });
    }
    const channels = (activeBridge.config?.channels ?? []).map((c) => ({
      type: c.type,
      level: c.level ?? "important",
      approvalRequired: c.approvalRequired ?? false,
      // Mask URL to avoid leaking tokens
      url: (c.url ?? "").replace(/\/bot[^/]+\//, "/bot[REDACTED]/"),
    }));
    res.json({
      enabled: activeBridge.isEnabled,
      connected: !!(activeBridge._ws && activeBridge._ws.readyState === 1),
      hasApprovalChannels: activeBridge.hasApprovalChannels,
      channels,
      pendingApprovals: activeBridge.getPendingApprovals(),
    });
  });

  // POST /api/bridge/approve/:runId — receive approval callback
  //   Body: { action: "approve" | "reject", approver?: string }
  app.post("/api/bridge/approve/:runId", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    const { runId } = req.params;
    if (!runId) return res.status(400).json({ error: "runId is required" });

    if (!activeBridge) {
      return res.status(503).json({ error: "Bridge not initialised" });
    }

    // Rate limit: only accept one decision per runId
    if (_approvedRunIds.has(runId)) {
      return res.status(409).json({ error: "Approval already received for this runId" });
    }

    const { action, approver } = req.body || {};
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const approved = action === "approve";
    const result = activeBridge.receiveApproval(runId, approved, approver ?? "api");

    if (!result.ok) {
      return res.status(404).json({ error: result.message });
    }

    _approvedRunIds.add(runId);
    res.json({ ok: true, runId, action, approver: approver ?? "api" });
  });

  // GET /api/bridge/approve/:runId — browser-friendly approval link (Telegram inline buttons)
  //   Query: ?action=approve|reject  (required)
  //          ?token=<secret>         (optional, if approvalSecret is set)
  app.get("/api/bridge/approve/:runId", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    const { runId } = req.params;
    if (!runId) return res.status(400).send("runId is required");

    if (!activeBridge) {
      return res.status(503).send("Bridge not initialised");
    }

    if (_approvedRunIds.has(runId)) {
      return res.status(409).send(`<html><body><h2>Already processed</h2><p>Approval for run <code>${runId}</code> was already received.</p></body></html>`);
    }

    const action = req.query?.action;
    if (action !== "approve" && action !== "reject") {
      return res.status(400).send('Query parameter "action" must be "approve" or "reject"');
    }

    const approved = action === "approve";
    const result = activeBridge.receiveApproval(runId, approved, "browser");

    if (!result.ok) {
      return res.status(404).send(`<html><body><h2>Not Found</h2><p>${result.message}</p></body></html>`);
    }

    _approvedRunIds.add(runId);
    const icon = approved ? "✅" : "❌";
    const label = approved ? "Approved" : "Rejected";
    res.send(`<html><body><h2>${icon} ${label}</h2><p>Run <code>${runId}</code> has been <strong>${label.toLowerCase()}</strong>.</p></body></html>`);
  });

  // POST /api/runs/trigger — inbound trigger for OpenClaw / external orchestrators
  //   Auth: Authorization: Bearer <bridge.approvalSecret>  OR  ?token=<secret>
  //   Body: { plan: "docs/plans/Phase-1.md", quorum?: "auto"|"power"|"speed"|true|false,
  //           model?: string, resumeFrom?: number, estimate?: boolean, dryRun?: boolean }
  //   Response: { ok: true, triggerId, message }  (run executes in background)
  app.post("/api/runs/trigger", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    const { plan, quorum: rawQuorum, model, resumeFrom, estimate, dryRun } = req.body || {};
    if (!plan || typeof plan !== "string") {
      return res.status(400).json({ error: "plan is required and must be a string path" });
    }

    // Prevent concurrent runs
    if (activeAbortController) {
      return res.status(409).json({ error: "A plan run is already in progress. Abort it first via POST /api/runs/abort" });
    }

    const cwd = findProjectRoot(PROJECT_DIR);
    const planPath = resolve(cwd, plan);
    if (!existsSync(planPath)) {
      return res.status(404).json({ error: `Plan file not found: ${plan}` });
    }

    // Parse quorum parameter (mirrors forge_run_plan MCP handler)
    let quorum = "auto";
    let quorumPreset = null;
    if (rawQuorum === "power") { quorum = true; quorumPreset = "power"; }
    else if (rawQuorum === "speed") { quorum = true; quorumPreset = "speed"; }
    else if (rawQuorum === "true" || rawQuorum === true) quorum = true;
    else if (rawQuorum === "false" || rawQuorum === false) quorum = false;

    const triggerId = `trigger-${Date.now()}`;

    // Fire-and-forget — run executes in background; dashboard + bridge handle progress
    setActiveAbortController(new AbortController());
    const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
    runPlan(planPath, {
      cwd,
      model: model || null,
      mode: "auto",
      resumeFrom: resumeFrom != null ? Number(resumeFrom) : null,
      estimate: estimate || false,
      dryRun: dryRun || false,
      quorum,
      quorumPreset,
      abortController: activeAbortController,
      eventHandler,
    }).then(() => {
      setActiveAbortController(null);
    }).catch((err) => {
      setActiveAbortController(null);
      console.error(`[trigger] Run failed: ${err.message}`);
    });

    res.json({ ok: true, triggerId, message: `Plan run started: ${plan}`, plan });
  });

  // POST /api/runs/abort — abort an in-progress triggered run
  app.post("/api/runs/abort", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    if (!activeAbortController) {
      return res.status(404).json({ error: "No active run to abort" });
    }
    activeAbortController.abort();
    res.json({ ok: true, message: "Abort signal sent. Current slice will finish, then execution stops." });
  });

  // ─── Bridge REST API endpoints are registered above ─────────────────

  // GET /api/fix/proposals — list all fix proposals
  app.get("/api/fix/proposals", (req, res) => {
    try {
      const autoDir = resolve(PROJECT_DIR, "docs/plans/auto");
      if (!existsSync(autoDir)) return res.json([]);
      const files = readdirSync(autoDir).filter((f) => f.startsWith("LIVEGUARD-FIX-") && f.endsWith(".md"));
      const proposals = files.map((f) => {
        const content = readFileSync(resolve(autoDir, f), "utf-8");
        const sourceMatch = content.match(/> Source: (.+)/);
        const genMatch = content.match(/> Generated: (.+)/);
        return { file: f, source: sourceMatch?.[1] || "unknown", generatedAt: genMatch?.[1] || null };
      });
      res.json(proposals);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/fix/propose — generate a fix proposal
  app.post("/api/fix/propose", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    try {
      const { source, incidentId } = req.body || {};
      // Delegate to the MCP tool logic by simulating a tool call
      const args = { source, incidentId, path: PROJECT_DIR };
      // Inline the same logic (simplified)
      const autoDir = resolve(PROJECT_DIR, "docs/plans/auto");
      mkdirSync(autoDir, { recursive: true });
      const fixId = incidentId || `${source || "auto"}-${Date.now()}`;
      const planName = `LIVEGUARD-FIX-${fixId}.md`;
      const planPath = resolve(autoDir, planName);
      if (existsSync(planPath)) {
        return res.json({ alreadyExists: true, plan: `docs/plans/auto/${planName}`, fixId });
      }
      const planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n> Generated: ${new Date().toISOString()}\n> Source: ${source || "auto"}\n\n## Slice 1 — Investigate\n\n- [ ] Review findings\n- [ ] Identify root cause\n\n## Slice 2 — Fix + Verify\n\n- [ ] Apply fix\n- [ ] Run validation\n`;
      writeFileSync(planPath, planContent, "utf-8");
      activeHub?.broadcast({ type: "fix-proposal-ready", data: { fixId, plan: `docs/plans/auto/${planName}` } });
      res.json({ fixId, plan: `docs/plans/auto/${planName}`, alreadyExists: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/quorum/prompt — assemble quorum prompt (read-only)
}

function _registerQuorumMiscRoutes(app) {
  app.get("/api/quorum/prompt", (req, res) => {
    try {
      const source = req.query.source || "all";
      const customQuestion = req.query.question || null;
      const analysisGoal = req.query.goal || null;
      const quorumSize = Math.max(1, Math.min(10, parseInt(req.query.quorumSize) || 3));
      const qErr = _validateQuorumQuestion(customQuestion, "question");
      if (qErr) return res.status(qErr.status).json({ quorumPrompt: null, error: qErr.error });

      const { context, oldestTimestamp } = _collectQuorumContextBySource(source);

      if (source !== "all" && Object.keys(context).length === 0) {
        return res.json({ quorumPrompt: null, error: `no ${source} data available — run the corresponding LiveGuard tool first` });
      }

      res.json(_formatQuorumResponse({ context, oldestTimestamp, customQuestion, analysisGoal, quorumSize }));
    } catch (err) {
      res.status(500).json({ quorumPrompt: null, error: err.message });
    }
  });

  // POST /api/quorum/prompt — same as GET but with body params
  app.post("/api/quorum/prompt", (req, res) => {
    try {
      const { source: reqSource, customQuestion, analysisGoal, quorumSize: reqQuorumSize, targetFile } = req.body || {};
      const source = reqSource || "all";
      const quorumSize = Math.max(1, Math.min(10, parseInt(reqQuorumSize) || 3));
      const qErr = _validateQuorumQuestion(customQuestion, "customQuestion");
      if (qErr) return res.status(qErr.status).json({ quorumPrompt: null, error: qErr.error });

      let context;
      let oldestTimestamp = null;
      if (targetFile) {
        context = {};
        const data = readForgeJson(targetFile, null, PROJECT_DIR);
        if (data) {
          context.targetFile = data;
          if (data.timestamp) oldestTimestamp = data.timestamp;
        }
      } else {
        ({ context, oldestTimestamp } = _collectQuorumContextBySource(source));
      }

      if (source !== "all" && !targetFile && Object.keys(context).length === 0) {
        return res.json({ quorumPrompt: null, error: `no ${source} data available — run the corresponding LiveGuard tool first` });
      }

      res.json(_formatQuorumResponse({ context, oldestTimestamp, customQuestion, analysisGoal, quorumSize }));
    } catch (err) {
      res.status(500).json({ quorumPrompt: null, error: err.message });
    }
  });

  // POST /api/openclaw/snapshot — post LiveGuard snapshot to OpenClaw endpoint
  app.post("/api/openclaw/snapshot", async (req, res) => {
    try {
      const extraContext = req.body || {};
      const result = await postOpenClawSnapshot(PROJECT_DIR, extraContext);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/openclaw/config — check OpenClaw configuration status
  app.get("/api/openclaw/config", (req, res) => {
    const config = loadOpenClawConfig(PROJECT_DIR);
    res.json({ configured: !!config.endpoint, endpoint: config.endpoint || null, hasApiKey: !!config.apiKey });
  });

  // Phase FORGE-SHOP-03 Slice 03.2 — Notifications config REST API
  app.get("/api/notifications/config", async (_req, res) => {
    try {
      const { loadNotificationsConfig } = await import("../notifications/core.mjs");
      res.json(loadNotificationsConfig(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/notifications/config", async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "body must be a JSON object" });
      }
      const { ensureNotificationsDirs } = await import("../orchestrator.mjs");
      ensureNotificationsDirs(PROJECT_DIR);
      const configPath = resolve(PROJECT_DIR, ".forge", "notifications", "config.json");
      writeFileSync(configPath, JSON.stringify(req.body, null, 2));
      res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // D5 — Chat Customizations editor: /api/copilot-instructions (v3.1.0)
  // GET  — returns current file status + content
  // POST /preview — dry-run: returns rendered Markdown without writing
  // POST /sync    — writes .github/copilot-instructions.md
  app.get("/api/copilot-instructions", (_req, res) => {
    try {
      const root = findProjectRoot(PROJECT_DIR);
      const filePath = join(root, ".github", "copilot-instructions.md");
      const exists = existsSync(filePath);
      let content = null, lastModified = null, byteSize = 0;
      if (exists) {
        try {
          content = readFileSync(filePath, "utf-8");
          const st = statSync(filePath);
          lastModified = st.mtimeMs;
          byteSize = st.size;
        } catch { /* non-fatal */ }
      }
      // Count sections (lines starting with "##")
      const sectionCount = content ? (content.match(/^##\s/gm) || []).length : 0;
      res.json({ ok: true, exists, filePath, content, lastModified, byteSize, sectionCount });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.post("/api/copilot-instructions/preview", (req, res) => {
    try {
      const root = findProjectRoot(PROJECT_DIR);
      const { noPrinciples = false, noProfile = false, noExtras = false } = req.body || {};
      const result = syncInstructions({
        projectRoot: root,
        dryRun: true,
        noPrinciples: Boolean(noPrinciples),
        noProfile:    Boolean(noProfile),
        noExtras:     Boolean(noExtras),
      });
      res.json(result);
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.post("/api/copilot-instructions/sync", (req, res) => {
    try {
      const root = findProjectRoot(PROJECT_DIR);
      const { noPrinciples = false, noProfile = false, noExtras = false, force = false } = req.body || {};
      const result = syncInstructions({
        projectRoot: root,
        dryRun:       false,
        force:        Boolean(force),
        noPrinciples: Boolean(noPrinciples),
        noProfile:    Boolean(noProfile),
        noExtras:     Boolean(noExtras),
      });
      res.json(result);
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  // Phase-29 — Forge-Master Studio API routes (async, registered on demand)
  import("../forge-master-routes.mjs").then(({ registerForgeMasterRoutes }) => {
    registerForgeMasterRoutes(app, invokeForgeTool);
  }).catch(err => console.warn(`[forge-master-routes] Skipped: ${err.message}`));

  // Phase-40 — GET /api/auditor/latest: most recent auditor auto-invoke result
  app.get("/api/auditor/latest", (_req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.json({ triggered: false, message: "No runs found." });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
      for (const runId of dirs) {
        const summaryPath = resolve(runsDir, runId, "summary.json");
        if (!existsSync(summaryPath)) continue;
        try {
          const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
          if (summary._auditor?.triggered) return res.json({ runId, ...summary._auditor });
        } catch { continue; }
      }
      return res.json({ triggered: false, message: "No auditor invocations found in recent runs." });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Phase-40 — GET /api/brain/recall: list brain records by source (entity) key
  app.get("/api/brain/recall", (req, res) => {
    try {
      const source = req.query.source || "";
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
      if (!source) return res.status(400).json({ error: "source query parameter is required" });
      const brainDir = resolve(PROJECT_DIR, ".forge", "brain", source);
      if (!existsSync(brainDir)) {
        return res.json({ records: [], total: 0, message: `No brain records found for source=${source}. Run the observer first.` });
      }
      const files = readdirSync(brainDir).filter((f) => f.endsWith(".json")).sort().reverse();
      const records = [];
      for (const file of files.slice(0, limit)) {
        try {
          const raw = JSON.parse(readFileSync(resolve(brainDir, file), "utf-8"));
          records.push({ id: file.replace(/\.json$/, ""), ...raw });
        } catch { continue; }
      }
      return res.json({ records, total: files.length, showing: records.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Phase-56 — GET /api/embedding/status: embedding backend health
  app.get("/api/embedding/status", async (req, res) => {
    try {
      const cwd = req.query.path ? resolve(req.query.path) : PROJECT_DIR;
      const neuralAvailable = await isNeuralEmbeddingAvailable();
      let neuralVersion = null;
      if (neuralAvailable) {
        try {
          const pkgPath = join(cwd, "node_modules", "@xenova", "transformers", "package.json");
          if (existsSync(pkgPath)) neuralVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? null;
        } catch { /* non-fatal */ }
      }
      const thoughts = readLocalThoughts(cwd);
      let configuredBackend = "auto";
      try {
        const fj = readForgeJson(cwd);
        if (fj?.embeddingBackend) configuredBackend = fj.embeddingBackend;
      } catch { /* .forge.json absent */ }
      const effectiveBackend = configuredBackend === "tfidf" ? "tfidf"
        : configuredBackend === "neural" ? (neuralAvailable ? "neural" : "tfidf")
        : (neuralAvailable ? "neural" : "tfidf");
      const installHint = neuralAvailable ? null : "npm install --save-optional @xenova/transformers";
      return res.json({
        ok: true,
        backend: effectiveBackend,
        neuralAvailable,
        neuralPackage: "@xenova/transformers",
        neuralVersion,
        model: "Xenova/all-MiniLM-L6-v2",
        corpusSize: thoughts.length,
        configuredBackend,
        installHint,
        message: `Active backend: ${effectiveBackend}. Neural: ${neuralAvailable ? "available (v" + (neuralVersion ?? "unknown") + ")" : "unavailable"}. Corpus: ${thoughts.length} thoughts.`,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Phase-58 — GET /api/local-recall/status: TF-IDF index cache diagnostics
  app.get("/api/local-recall/status", (req, res) => {
    try {
      const cwd = req.query.path ? resolve(req.query.path) : PROJECT_DIR;
      const status = getIndexStatus(cwd);
      const staleness = status.exists
        ? (status.stale === true ? "stale" : status.stale === false ? "fresh" : "unknown")
        : "n/a";
      const message = !status.exists
        ? "No TF-IDF index cache found. Run forge_local_search or 'pforge local-recall warm' to build it."
        : status.stale
          ? "Index exists but is stale. It will be rebuilt on the next forge_local_search call."
          : `Index is fresh. ${status.corpusSize ?? 0} thought${(status.corpusSize ?? 0) === 1 ? "" : "s"} indexed, built at ${status.builtAt}.`;
      return res.json({ ok: true, indexExists: status.exists, version: status.version, builtAt: status.builtAt, corpusSize: status.corpusSize, staleness, cacheFile: status.cacheFile, message });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Phase OTEL-AUDIT-EXPORT — GET /api/audit/export: ACI-paginated audit event export
  app.get("/api/audit/export", async (req, res) => {
    try {
      const cwd = req.query.path ? resolve(req.query.path) : PROJECT_DIR;
      const format = req.query.format === "csv" ? "csv" : "json";
      const rawLimit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
      const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 100 : rawLimit), 500);
      const typeFilter = req.query.type
        ? (Array.isArray(req.query.type) ? req.query.type : [req.query.type])
        : null;
      const filters = {
        since: req.query.since ?? null,
        until: req.query.until ?? null,
        type: typeFilter,
        run: req.query.run ?? null,
        format,
      };

      const gen = exportAudit({ cwd, since: filters.since, until: filters.until, type: filters.type, run: filters.run, format });
      const collected = [];
      for await (const line of gen) {
        collected.push(line);
        if (collected.length > limit) break;
      }

      const truncated = collected.length > limit;
      if (truncated) collected.pop();
      const total = collected.length;

      let records;
      if (format === "json") {
        records = collected.map(line => { try { return JSON.parse(line); } catch { return { raw: line }; } });
      } else {
        records = collected;
      }

      const message = total === 0
        ? `No audit events found in ${resolve(cwd, ".forge", "runs")}. Run a plan first to generate events, or broaden your filters.`
        : `Returned ${total} ${format === "csv" ? "CSV row" : "event record"}${total === 1 ? "" : "s"}${truncated ? ` (truncated at limit ${limit})` : ""}.`;

      return res.json({ ok: true, records, total, truncated, format, filters, message });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });
}

