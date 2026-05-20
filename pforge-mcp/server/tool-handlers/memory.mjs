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

function _buildBrainReplaySummary({ args, cfg, sourceType, sourcePath, result }) {
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
    const summary = _buildBrainReplaySummary({ args: args, cfg: validation.cfg, sourceType: loaded.sourceType, sourcePath: loaded.sourcePath, result: executed.result });
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

function _044_forge_incident_capture_buildRecord({ args, cwd, severity, capturedAt, mttr }) {
  const record = _createIncidentRecord(args, severity, capturedAt, mttr);
  const precedingDeploy = _correlateIncidentDeploy(capturedAt, cwd);
  if (precedingDeploy) record.precedingDeploy = precedingDeploy;
  appendForgeJsonl("incidents.jsonl", record, cwd);
  const recurring = _detectRecurringIncident(record, args.files || [], cwd);
  if (recurring) record.recurring = recurring;
  return record;
}

function _044_forge_incident_capture_notify({ args, cwd, severity, capturedAt, record }) {
  activeHub?.broadcast({ type: "incident-captured", data: record, timestamp: capturedAt });
  const onCall = _loadIncidentOnCall(cwd);
  if (onCall) {
    activeBridge?.dispatch?.({ type: "incident-captured", severity, description: args.description, onCall });
  }
}

export {
  _callToolHandler_017_forge_memory_report,
  _callToolHandler_018_forge_skill_status,
  _callToolHandler_019_forge_run_skill,
  _callToolHandler_020_forge_org_rules,
  _callToolHandler_040_forge_memory_capture,
  _callToolHandler_041_forge_brain_test,
  _callToolHandler_042_forge_brain_replay,
  _callToolHandler_043_forge_generate_image,
};
