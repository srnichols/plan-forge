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
import { searchLocalThoughts, isNeuralEmbeddingAvailable, readLocalThoughts, getIndexStatus, clearPersistedIndex } from "../../local-recall.mjs";
import { exportAudit } from "../../audit-export.mjs";
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
          emitToolTelemetry({ toolName: "forge_master_ask", inputs: args, result: { proxied: true }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_master_ask", inputs: args, result: {
        sessionId: result.sessionId,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        toolCallCount: result.toolCalls?.length ?? 0,
        truncated: result.truncated,
      }, durationMs: Date.now() - t0, status: result.error ? "ERROR" : "OK", cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_master_ask", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
        emitToolTelemetry({ toolName: "forge_meta_bug_file", inputs: args, result: result, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      if (!args.title || !args.symptom) {
        const result = { ok: false, error: ERROR_CODES.MISSING_REQUIRED_FIELDS.code };
        emitToolTelemetry({ toolName: "forge_meta_bug_file", inputs: args, result: result, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_meta_bug_file", inputs: args, result: filerResult, durationMs: Date.now() - t0, status: filerResult.ok ? "OK" : "ERROR", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(filerResult, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_meta_bug_file", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_graph_query", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_graph_query", inputs: args, result: { error: err.message }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_patterns_list", inputs: args, result: { count: patterns.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(patterns, null, 2) }] };
    } catch (err) {
      const durationMs = Date.now() - t0;
      emitToolTelemetry({ toolName: "forge_patterns_list", inputs: args, result: { error: err.message }, durationMs: durationMs, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_delegate_review", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const isNoPr = err instanceof ReviewDelegateNoPrError;
      const isAuth = err instanceof ReviewDelegateAuthError;
      const code = isNoPr ? "NO_PR" : isAuth ? "AUTH_ERROR" : "DELEGATE_ERROR";
      const response = { ok: false, error: err.message, code };
      emitToolTelemetry({ toolName: "forge_delegate_review", inputs: args, result: response, durationMs: Date.now() - t0, status: "ERROR", cwd: "" });
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
      emitToolTelemetry({ toolName: "forge_team_dashboard", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_team_activity", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
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
        emitToolTelemetry({ toolName: "forge_github_metrics", inputs: args, result: notDetected, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
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

      emitToolTelemetry({ toolName: "forge_github_metrics", inputs: args, result: { ok: true, repo: repoSlug }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_github_metrics", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_anvil_stat", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_anvil_stat", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_anvil_clear", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const errPayload = { error: err.message, code: err.code || undefined };
      emitToolTelemetry({ toolName: "forge_anvil_clear", inputs: args, result: errPayload, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_anvil_rebuild", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_anvil_rebuild", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_anvil_dlq_list", inputs: args, result: { total: result.total }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_anvil_dlq_list", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_anvil_dlq_drain", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_anvil_dlq_drain", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
          emitToolTelemetry({ toolName: "forge_hallmark_show", inputs: args, result: notFound, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
          return { content: [{ type: "text", text: JSON.stringify(notFound, null, 2) }], isError: true };
        }
        emitToolTelemetry({ toolName: "forge_hallmark_show", inputs: args, result: { ok: true, id: args.id }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
        return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }] };
      } else {
        // No id — list all
        const list = listHallmarks({}, { cwd });
        emitToolTelemetry({ toolName: "forge_hallmark_show", inputs: args, result: { ok: true, count: list.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
        return { content: [{ type: "text", text: JSON.stringify({ hallmarks: list, count: list.length }, null, 2) }] };
      }
    } catch (err) {
      const isHallmarkErr = err instanceof HallmarkError;
      const errPayload = { ok: false, error: isHallmarkErr ? "ERR_INVALID_ID" : "ERR_UNEXPECTED", message: err.message };
      emitToolTelemetry({ toolName: "forge_hallmark_show", inputs: args, result: errPayload, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
        emitToolTelemetry({ toolName: "forge_hallmark_verify", inputs: args, result: notFound, durationMs: Date.now() - t0, status: "ERROR", cwd: cwd });
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
      emitToolTelemetry({ toolName: "forge_hallmark_verify", inputs: args, result: { ok: true, id: record.id, drift }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const isHallmarkErr = err instanceof HallmarkError;
      const errPayload = { ok: false, error: isHallmarkErr ? "ERR_INVALID_ID" : "ERR_UNEXPECTED", message: err.message };
      emitToolTelemetry({ toolName: "forge_hallmark_verify", inputs: args, result: errPayload, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_pipelines_list", inputs: args, result: { count: result.pipelines.length }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_pipelines_list", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_lattice_index", inputs: args, result: result, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_lattice_index", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_lattice_stat", inputs: args, result: { chunks: result.chunks, edges: result.edges }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_lattice_stat", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_lattice_query", inputs: args, result: { total: result.total }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_lattice_query", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_lattice_callers", inputs: args, result: { total: result.total }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_lattice_callers", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
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
      emitToolTelemetry({ toolName: "forge_lattice_blast", inputs: args, result: { total: result.total }, durationMs: Date.now() - t0, status: "OK", cwd: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      emitToolTelemetry({ toolName: "forge_lattice_blast", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
      return { content: [{ type: "text", text: `forge_lattice_blast error: ${err.message}` }], isError: true };
    }
  
}
/* eslint-enable complexity */

async function _callToolHandler_095_forge_local_search(request, args) {
  const { name } = request.params;
  if (!(name === "forge_local_search")) return _CALL_TOOL_NO_MATCH;

  const t0 = Date.now();
  try {
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "query is required" }) }], isError: true };
    }
    const limit = Math.min(Math.max(1, Number(args.limit) || 5), 20);
    const threshold = typeof args.threshold === "number" ? args.threshold : 0.02;
    const backendArg = args.backend === "tfidf" ? "tfidf" : args.backend === "neural" ? "neural" : "auto";
    const sources = Array.isArray(args.sources) && args.sources.length > 0 ? args.sources : undefined;

    if (backendArg === "neural" && !(await isNeuralEmbeddingAvailable())) {
      const hint = "Install @xenova/transformers: npm install --save-optional @xenova/transformers";
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `neural backend requested but @xenova/transformers is not installed. ${hint}` }) }], isError: true };
    }

    const result = await searchLocalThoughts(query, {
      cwd,
      limit,
      threshold,
      sources,
      forceBackend: backendArg === "auto" ? undefined : backendArg,
    });

    emitToolTelemetry({ toolName: "forge_local_search", inputs: args, result: { total: result.total, backend: result.backend }, durationMs: Date.now() - t0, status: "OK", cwd });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    emitToolTelemetry({ toolName: "forge_local_search", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
    return { content: [{ type: "text", text: `forge_local_search error: ${err.message}` }], isError: true };
  }
}

async function _callToolHandler_096_forge_embedding_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_embedding_status")) return _CALL_TOOL_NO_MATCH;

  const t0 = Date.now();
  try {
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

    // Probe neural availability
    const neuralAvailable = await isNeuralEmbeddingAvailable();

    // Detect installed version of @xenova/transformers if available
    let neuralVersion = null;
    if (neuralAvailable) {
      try {
        const pkgPath = join(cwd, "node_modules", "@xenova", "transformers", "package.json");
        if (existsSync(pkgPath)) {
          neuralVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? null;
        }
      } catch { /* version undetectable — non-fatal */ }
    }

    // Read corpus size from local .forge/ JSONL stores
    const thoughts = readLocalThoughts(cwd);
    const corpusSize = thoughts.length;

    // Determine configured backend override from .forge.json
    let configuredBackend = "auto";
    try {
      const forgeJson = readForgeJson(cwd);
      if (forgeJson?.embeddingBackend) configuredBackend = forgeJson.embeddingBackend;
    } catch { /* .forge.json absent or unreadable — auto */ }

    // Effective backend: configured override wins; otherwise auto-detect
    const effectiveBackend = configuredBackend === "tfidf" ? "tfidf"
      : configuredBackend === "neural" ? (neuralAvailable ? "neural" : "tfidf")
      : (neuralAvailable ? "neural" : "tfidf"); // "auto"

    const installHint = "npm install --save-optional @xenova/transformers";
    const neuralStatus = neuralAvailable
      ? `neural available (v${neuralVersion ?? "unknown"})`
      : `neural unavailable — install with: ${installHint}`;
    const backendNote = effectiveBackend === "neural"
      ? "Active backend: neural (all-MiniLM-L6-v2)"
      : `Active backend: tfidf${neuralAvailable ? "" : " (neural not installed)"}`;
    const message = `${backendNote}. ${neuralStatus}. Corpus: ${corpusSize} thought${corpusSize === 1 ? "" : "s"} in .forge/.`;

    const result = {
      ok: true,
      backend: effectiveBackend,
      neuralAvailable,
      neuralPackage: "@xenova/transformers",
      neuralVersion,
      model: "Xenova/all-MiniLM-L6-v2",
      corpusSize,
      configuredBackend,
      installHint: neuralAvailable ? null : installHint,
      message,
    };

    emitToolTelemetry({ toolName: "forge_embedding_status", inputs: args, result: { backend: effectiveBackend, neuralAvailable, corpusSize }, durationMs: Date.now() - t0, status: "OK", cwd });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    emitToolTelemetry({ toolName: "forge_embedding_status", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
    return { content: [{ type: "text", text: `forge_embedding_status error: ${err.message}` }], isError: true };
  }
}

async function _callToolHandler_097_forge_local_recall_status(request, args) {
  const { name } = request.params;
  if (!(name === "forge_local_recall_status")) return _CALL_TOOL_NO_MATCH;

  const t0 = Date.now();
  try {
    const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
    const sub = (args.subcommand ?? "status").toLowerCase();

    if (sub === "clear") {
      clearPersistedIndex(cwd);
      const result = {
        ok: true,
        action: "cleared",
        message: "TF-IDF index cache cleared. It will be rebuilt on the next forge_local_search call.",
      };
      emitToolTelemetry({ toolName: "forge_local_recall_status", inputs: args, result, durationMs: Date.now() - t0, status: "OK", cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (sub === "warm") {
      await searchLocalThoughts("_warm_", { cwd, limit: 1, noCache: false });
      const status = getIndexStatus(cwd);
      const result = {
        ok: true,
        action: "warmed",
        indexExists: status.exists,
        corpusSize: status.corpusSize,
        builtAt: status.builtAt,
        message: status.exists
          ? `Index warmed. ${status.corpusSize ?? 0} thought${(status.corpusSize ?? 0) === 1 ? "" : "s"} indexed.`
          : "No thoughts found in .forge/ — index not built (empty corpus).",
      };
      emitToolTelemetry({ toolName: "forge_local_recall_status", inputs: args, result, durationMs: Date.now() - t0, status: "OK", cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // default: "status"
    const status = getIndexStatus(cwd);
    const staleness = status.exists
      ? (status.stale === true ? "stale" : status.stale === false ? "fresh" : "unknown")
      : "n/a";
    const message = !status.exists
      ? "No TF-IDF index cache found. Run forge_local_search or 'pforge local-recall warm' to build it."
      : status.stale
        ? `Index exists but is stale (a source JSONL has changed). It will be rebuilt on the next forge_local_search call.`
        : `Index is fresh. ${status.corpusSize ?? 0} thought${(status.corpusSize ?? 0) === 1 ? "" : "s"} indexed, built at ${status.builtAt}.`;

    const result = {
      ok: true,
      indexExists: status.exists,
      version: status.version,
      builtAt: status.builtAt,
      corpusSize: status.corpusSize,
      staleness,
      cacheFile: status.cacheFile,
      message,
    };

    emitToolTelemetry({ toolName: "forge_local_recall_status", inputs: args, result: { indexExists: status.exists, corpusSize: status.corpusSize, staleness }, durationMs: Date.now() - t0, status: "OK", cwd });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    emitToolTelemetry({ toolName: "forge_local_recall_status", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd: findProjectRoot(PROJECT_DIR) });
    return { content: [{ type: "text", text: `forge_local_recall_status error: ${err.message}` }], isError: true };
  }
}

// #098 — forge_audit_export: ACI-paginated export of orchestrator audit events from .forge/runs/
async function _callToolHandler_098_forge_audit_export(args) {
  const t0 = Date.now();
  const cwd = args.path ? resolve(args.path) : findProjectRoot(PROJECT_DIR);
  const format = (args.format === "csv") ? "csv" : "json";
  const rawLimit = typeof args.limit === "number" ? args.limit : 100;
  const limit = Math.min(Math.max(1, rawLimit), 500);

  const filters = {
    since: args.since ?? null,
    until: args.until ?? null,
    type: Array.isArray(args.type) && args.type.length > 0 ? args.type : null,
    run: args.run ?? null,
    format,
  };

  try {
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
      records = collected.map(line => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
    } else {
      records = collected;
    }

    let message;
    if (total === 0) {
      const runsDir = resolve(cwd, ".forge", "runs");
      message = `No audit events found in ${runsDir}. Run a plan first to generate events, or broaden your filters (since, until, type, run).`;
    } else {
      message = `Returned ${total} ${format === "csv" ? "CSV row" : "event record"}${total === 1 ? "" : "s"}${truncated ? ` (truncated at limit ${limit})` : ""}.`;
    }

    const result = { ok: true, records, total, truncated, format, filters, message };
    emitToolTelemetry({ toolName: "forge_audit_export", inputs: args, result: { total, truncated, format }, durationMs: Date.now() - t0, status: "OK", cwd });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    emitToolTelemetry({ toolName: "forge_audit_export", inputs: args, result: { error: err.message }, durationMs: Date.now() - t0, status: "ERROR", cwd });
    return { content: [{ type: "text", text: `forge_audit_export error: ${err.message}` }], isError: true };
  }
}


export {
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
  _callToolHandler_095_forge_local_search,
  _callToolHandler_096_forge_embedding_status,
  _callToolHandler_097_forge_local_recall_status,
  _callToolHandler_098_forge_audit_export,
};
