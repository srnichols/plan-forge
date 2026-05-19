/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S6: hooks sub-module
 *
 * Hook logic and related helpers extracted from orchestrator.mjs:
 * PreDeploy, PostSlice, PostSlice Tempering, PreAgentHandoff,
 * correlation-thread responder, OpenClaw integration, and quorum presets.
 *
 * Private helpers (readForgeJson, readForgeJsonl) are copied here to avoid
 * introducing circular imports during the phased orchestrator split.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getPostSliceHookFiredState,
  setPostSliceHookFiredState,
  getPostSliceTemperingFiredState,
  setPostSliceTemperingFiredState,
} from "./state.mjs";
import { QUORUM_PRESETS } from "./constants.mjs";
export { QUORUM_PRESETS };

// ─── Private helpers ──────────────────────────────────────────────────
// These mirror the public implementations in orchestrator.mjs and will be
// removed when the corresponding sub-modules are extracted further.

function readForgeJson(filePath, defaultValue = null, cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return JSON.parse(readFileSync(fullPath, "utf-8"));
    }
  } catch { /* corrupt/missing → return default */ }
  return defaultValue;
}

function readForgeJsonl(filePath, defaultValue = [], cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8")
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
    // G2.1 shim: try the legacy `.json` variant for newly-renamed files
    if (filePath.endsWith(".jsonl")) {
      const legacy = resolve(cwd, ".forge", filePath.slice(0, -1)); // .jsonl → .json
      if (existsSync(legacy)) {
        return readFileSync(legacy, "utf-8")
          .split("\n")
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      }
    }
    return defaultValue;
  } catch { return defaultValue; }
}

// ─── PreDeploy Hook ───────────────────────────────────────────────────

/** File-path glob patterns that indicate a deploy action. */
const DEPLOY_FILE_PATTERNS = [
  /^deploy\//,
  /^Dockerfile/,
  /\.bicep$/,
  /\.tf$/,
  /^k8s\//,
  /^docker-compose.*\.yml$/,
];

/** Terminal commands that indicate a deploy action. */
const DEPLOY_COMMAND_PATTERNS = [
  /\bpforge\s+deploy-log\b/,
  /\bdocker\s+push\b/,
  /\baz\s+deploy\b/,
  /\bkubectl\s+apply\b/,
  /\bazd\s+up\b/,
  /\bgit\s+push\b/,
];

/** Default configuration for the PreDeploy hook. */
const PRE_DEPLOY_DEFAULTS = {
  enabled: true,
  blockOnSecrets: true,
  warnOnEnvGaps: true,
  scanSince: "HEAD~1",
};

/** Maximum age in minutes before cache is considered stale. */
const CACHE_MAX_AGE_MINUTES = 10;

/**
 * Register the `brain.correlation-thread` hub responder.
 * Reads hub-events.jsonl and filters by correlationId.
 *
 * @param {object} hub - Hub instance with onAsk
 * @param {string} cwd - Project root
 * @param {object} [deps] - DI overrides
 */
export function registerCorrelationThreadResponder(hub, cwd, deps = {}) {
  const _readJsonl = deps.readForgeJsonl || readForgeJsonl;

  hub.onAsk("brain.correlation-thread", async (payload) => {
    const { correlationId, limit = 50 } = payload || {};
    if (!correlationId) {
      return { events: [], count: 0 };
    }

    const allEvents = _readJsonl("hub-events.jsonl", [], cwd);
    const filtered = allEvents.filter(
      (e) => e._correlationId === correlationId || e.correlationId === correlationId,
    );

    filtered.sort((a, b) => {
      const tsA = new Date(a.ts || a.timestamp || 0).getTime();
      const tsB = new Date(b.ts || b.timestamp || 0).getTime();
      return tsB - tsA;
    });

    return {
      events: filtered.slice(0, limit),
      count: filtered.length,
    };
  });
}

/**
 * Check whether a tool invocation matches deploy trigger conditions.
 * @param {string} toolName - The tool being invoked (e.g. "editFiles", "runCommand")
 * @param {string} filePath - File path being written to (may be empty)
 * @param {string} command  - Terminal command being executed (may be empty)
 * @returns {boolean}
 */
export function isDeployTrigger(toolName, filePath, command) {
  if (filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    for (const pattern of DEPLOY_FILE_PATTERNS) {
      if (pattern.test(normalized)) return true;
    }
  }
  if (command) {
    for (const pattern of DEPLOY_COMMAND_PATTERNS) {
      if (pattern.test(command)) return true;
    }
  }
  return false;
}

/**
 * Determine if a cache file is stale (older than CACHE_MAX_AGE_MINUTES).
 * @param {object|null} cache - Parsed cache with `scannedAt` ISO timestamp
 * @returns {boolean} true if cache is missing, has no timestamp, or is stale
 */
function isCacheStale(cache) {
  if (!cache || !cache.scannedAt) return true;
  const age = Date.now() - new Date(cache.scannedAt).getTime();
  return age > CACHE_MAX_AGE_MINUTES * 60 * 1000;
}

/**
 * Run the PreDeploy hook logic. Reads secret-scan and env-diff caches,
 * evaluates them against the hook configuration, and returns a result
 * indicating whether the deploy should be blocked or an advisory issued.
 *
 * @param {object} params
 * @param {string} params.toolName  - Tool being invoked
 * @param {string} [params.filePath=""] - File path being written
 * @param {string} [params.command=""]  - Command being executed
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, blocked?: boolean, reason?: string, advisory?: string, secretFindings?: Array, envGaps?: Array }}
 */
export function runPreDeployHook({ toolName, filePath = "", command = "", cwd = process.cwd() } = {}) {
  if (!isDeployTrigger(toolName, filePath, command)) {
    return { triggered: false };
  }

  let config = { ...PRE_DEPLOY_DEFAULTS };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw && raw.hooks && raw.hooks.preDeploy) {
        config = { ...PRE_DEPLOY_DEFAULTS, ...raw.hooks.preDeploy };
      }
    }
  } catch { /* use defaults */ }

  if (config.enabled === false) {
    return { triggered: true, blocked: false, reason: null, advisory: null, secretFindings: [], envGaps: [] };
  }

  const result = { triggered: true, blocked: false, reason: null, advisory: null, secretFindings: [], envGaps: [] };

  const secretCache = readForgeJson("secret-scan-cache.json", null, cwd);
  if (secretCache && !secretCache.clean && Array.isArray(secretCache.findings) && secretCache.findings.length > 0) {
    result.secretFindings = secretCache.findings.map(f => ({
      file: f.file,
      line: f.line,
      type: f.type,
      entropyScore: f.entropyScore,
      confidence: f.confidence,
      masked: f.masked || "<REDACTED>",
    }));
    if (config.blockOnSecrets !== false) {
      result.blocked = true;
      result.reason = `secret-scan-found-${secretCache.findings.length}-findings`;
    }
  }

  if (isCacheStale(secretCache)) {
    const staleMsg = "Secret scan cache is stale or missing — run forge_secret_scan to refresh.";
    result.advisory = result.advisory ? `${result.advisory}\n${staleMsg}` : staleMsg;
  }

  const envDiffCache = readForgeJson("env-diff-cache.json", null, cwd);
  if (envDiffCache && envDiffCache.summary && envDiffCache.summary.totalMissing > 0) {
    const gapPairs = (envDiffCache.pairs || []).filter(p =>
      (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0
    );
    result.envGaps = gapPairs;
    if (config.warnOnEnvGaps !== false && gapPairs.length > 0) {
      const lines = gapPairs.map(p => {
        const missing = [...(p.missingInTarget || []), ...(p.missingInBaseline || [])];
        return `${p.file || p.compareTo}: missing ${missing.join(", ")}`;
      });
      const envMsg = `Environment key gaps detected:\n${lines.map(l => `• ${l}`).join("\n")}`;
      result.advisory = result.advisory ? `${result.advisory}\n${envMsg}` : envMsg;
    }
  }
  if (!result.envGaps.length && envDiffCache && envDiffCache.summary && envDiffCache.summary.totalGaps > 0) {
    const gapPairs = (envDiffCache.pairs || []).filter(p =>
      (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0
    );
    if (gapPairs.length > 0) {
      result.envGaps = gapPairs;
      if (config.warnOnEnvGaps !== false) {
        const lines = gapPairs.map(p => {
          const missing = [...(p.missingInTarget || []), ...(p.missingInBaseline || [])];
          return `${p.file || p.compareTo}: missing ${missing.join(", ")}`;
        });
        const envMsg = `Environment key gaps detected:\n${lines.map(l => `• ${l}`).join("\n")}`;
        result.advisory = result.advisory ? `${result.advisory}\n${envMsg}` : envMsg;
      }
    }
  }

  return result;
}

// ─── PostSlice Hook ───────────────────────────────────────────────────

/** Conventional commit types that affect code drift. */
const POSTSLICE_COMMIT_PATTERN = /^(feat|fix|refactor|perf|chore|style|test)\(/;

/** Commit patterns that should NOT trigger the PostSlice hook. */
const POSTSLICE_SKIP_PATTERNS = [
  /^docs[:(]/,
  /^ci[:(]/,
  /^Merge /,
  /--no-verify/,
];

/** Default configuration for the PostSlice hook. */
const POSTSLICE_DEFAULTS = {
  enabled: true,
  silentDeltaThreshold: 5,
  warnDeltaThreshold: 10,
  scoreFloor: 70,
};

/**
 * Reset the PostSlice hook fired flag. Exposed for testing.
 */
export function resetPostSliceHookFired() {
  setPostSliceHookFiredState(false);
}

/**
 * Parse `git status --porcelain` output into a Map<path, statusLine>.
 * The status line is the full original line including the XY status code,
 * which lets callers tell whether a path was further modified between two
 * snapshots (same path + different line = worker touched it). Renames are
 * tracked at their post-rename path.
 *
 * @param {string} porcelain
 * @returns {Map<string, string>}
 */
export function parseGitPorcelain(porcelain) {
  const map = new Map();
  if (!porcelain) return map;
  for (const raw of porcelain.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const arrowIdx = raw.indexOf(" -> ");
    const tail = arrowIdx >= 0 ? raw.slice(arrowIdx + 4) : raw.slice(3);
    const path = tail.trim().replace(/^"|"$/g, "");
    if (path) map.set(path, raw);
  }
  return map;
}

/**
 * #186 v2.96.2 — parse a `git show --shortstat` line into a structured
 * codeChanges object.
 *
 * @param {string|null|undefined} shortstat
 * @returns {{ filesChanged: number, linesAdded: number, linesRemoved: number }|null}
 */
export function parseShortstat(shortstat) {
  if (!shortstat || typeof shortstat !== "string") return null;
  const lines = shortstat.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let summary = null;
  for (const line of lines) {
    if (/\d+\s+files?\s+changed/.test(line)) { summary = line; break; }
  }
  if (!summary) return null;
  const filesMatch = summary.match(/(\d+)\s+files?\s+changed/);
  const addMatch = summary.match(/(\d+)\s+insertions?\(\+\)/);
  const delMatch = summary.match(/(\d+)\s+deletions?\(-\)/);
  return {
    filesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
    linesAdded: addMatch ? parseInt(addMatch[1], 10) : 0,
    linesRemoved: delMatch ? parseInt(delMatch[1], 10) : 0,
  };
}

/**
 * PostSlice hook — checks whether the latest drift score regressed after a
 * code-affecting commit and emits an advisory or warning.
 *
 * @param {object} params
 * @param {string} params.commitMessage - The git commit message
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, action?: string, message?: string, priorScore?: number, newScore?: number, delta?: number, skippedReason?: string }}
 */
export function runPostSliceHook({ commitMessage, cwd = process.cwd() } = {}) {
  if (!commitMessage) return { triggered: false, skippedReason: "no-commit-message" };

  if (getPostSliceHookFiredState()) {
    return { triggered: false, skippedReason: "already-fired" };
  }

  for (const pattern of POSTSLICE_SKIP_PATTERNS) {
    if (pattern.test(commitMessage)) {
      return { triggered: false, skippedReason: `skip-pattern: ${pattern.source}` };
    }
  }

  if (!POSTSLICE_COMMIT_PATTERN.test(commitMessage)) {
    return { triggered: false, skippedReason: "not-conventional-commit" };
  }

  let config = { ...POSTSLICE_DEFAULTS };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.hooks?.postSlice) {
        config = { ...POSTSLICE_DEFAULTS, ...raw.hooks.postSlice };
      }
    }
  } catch { /* use defaults */ }

  if (config.enabled === false) {
    return { triggered: true, action: "disabled", message: null };
  }

  const driftHistory = readForgeJsonl("drift-history.jsonl", [], cwd);
  if (driftHistory.length < 2) {
    return { triggered: true, action: "skip", skippedReason: "insufficient-drift-history", message: null };
  }

  const priorScore = driftHistory[driftHistory.length - 2]?.score;
  const newScore = driftHistory[driftHistory.length - 1]?.score;
  const violations = driftHistory[driftHistory.length - 1]?.violations || [];

  if (priorScore == null || newScore == null) {
    return { triggered: true, action: "skip", skippedReason: "missing-scores", message: null };
  }

  const delta = priorScore - newScore;

  setPostSliceHookFiredState(true);

  if (newScore >= priorScore) {
    return { triggered: true, action: "silent", message: null, priorScore, newScore, delta: -delta };
  }
  if (delta <= config.silentDeltaThreshold) {
    return { triggered: true, action: "silent", message: null, priorScore, newScore, delta };
  }

  if (delta > config.warnDeltaThreshold || newScore < config.scoreFloor) {
    const topViolations = violations.slice(0, 5).map(v => `• ${v.file}: ${v.rule} (${v.severity})`).join("\n");
    const belowFloor = newScore < config.scoreFloor ? `Score is BELOW threshold (${config.scoreFloor}/${newScore}). ` : "";
    const message = `🔴 PostSlice Hook — Drift Warning\n\nDrift score dropped ${delta} points after this commit (${priorScore} → ${newScore}).\n${belowFloor}Recommend resolving violations before starting the next slice.\n\nTop violations:\n${topViolations}\n\nOptions:\n1. Fix violations now and amend the commit\n2. Accept and continue — run \`pforge incident\` if this causes a prod issue later\n3. Run \`pforge runbook docs/plans/<current-plan>\` to update ops docs with new risk\n\nThe next slice will start with this reduced score as the new baseline.`;
    return { triggered: true, action: "warning", message, priorScore, newScore, delta };
  }

  const topViolations = violations.slice(0, 3).map(v => `• ${v.file}: ${v.rule} (${v.severity})`).join("\n");
  const message = `🟡 PostSlice Hook — Drift Advisory\n\nDrift score dropped ${delta} points after this commit (${priorScore} → ${newScore}).\nScore is still above threshold (${config.scoreFloor}) — proceeding is safe, but investigate before shipping.\n\nTop new violations:\n${topViolations}\n\nRun \`pforge drift\` to see the full report.`;
  return { triggered: true, action: "advisory", message, priorScore, newScore, delta };
}

// ─── PostSlice Tempering Hook ─────────────────────────────────────────

/** Reset the fired guard. Exposed for testing + CLI reuse. */
export function resetPostSliceTemperingFired() {
  setPostSliceTemperingFiredState(new Set());
}

/**
 * PostSlice Tempering hook — invokes `forge_tempering_run` after a
 * slice commit when the user has opted in via
 * `.forge/tempering/config.json` → `execution.trigger: "post-slice"`.
 *
 * @param {object} params
 * @param {string} params.commitMessage
 * @param {{plan:string, slice:string}} [params.sliceRef]
 * @param {string} [params.cwd=process.cwd()]
 * @param {Function} params.runTemperingRun - injected runner (async)
 * @param {object} [params.hub]
 * @param {string} [params.correlationId]
 * @param {string} [params.lastGreenSha]
 * @returns {Promise<{triggered:boolean, skippedReason?:string, result?:object}>}
 */
export async function runPostSliceTemperingHook({
  commitMessage,
  sliceRef = null,
  cwd = process.cwd(),
  runTemperingRun,
  hub = null,
  correlationId = null,
  lastGreenSha = null,
  spawnWorker = null,
} = {}) {
  if (process.env.PFORGE_DISABLE_TEMPERING === "1") {
    return { skipped: true, reason: "PFORGE_DISABLE_TEMPERING" };
  }
  if (!commitMessage) return { triggered: false, skippedReason: "no-commit-message" };
  if (typeof runTemperingRun !== "function") {
    return { triggered: false, skippedReason: "no-runner-injected" };
  }

  for (const pattern of POSTSLICE_SKIP_PATTERNS) {
    if (pattern.test(commitMessage)) {
      return { triggered: false, skippedReason: `skip-pattern:${pattern.source}` };
    }
  }
  if (!POSTSLICE_COMMIT_PATTERN.test(commitMessage)) {
    return { triggered: false, skippedReason: "not-conventional-commit" };
  }

  const fireKey = sliceRef
    ? `${sliceRef.plan}::${sliceRef.slice}`
    : `commit::${commitMessage.slice(0, 80)}`;
  if (getPostSliceTemperingFiredState().has(fireKey)) {
    return { triggered: false, skippedReason: "already-fired-for-slice" };
  }

  let triggerMode = "post-slice";
  try {
    const configPath = resolve(cwd, ".forge", "tempering", "config.json");
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      if (cfg?.execution?.trigger) triggerMode = cfg.execution.trigger;
      if (cfg?.enabled === false) {
        return { triggered: false, skippedReason: "tempering-disabled" };
      }
    }
  } catch { /* fall through to default */ }

  if (triggerMode !== "post-slice") {
    return { triggered: false, skippedReason: `trigger-mode:${triggerMode}` };
  }

  getPostSliceTemperingFiredState().add(fireKey);

  let result;
  try {
    result = await runTemperingRun({
      projectDir: cwd,
      hub,
      correlationId,
      sliceRef,
      lastGreenSha,
      spawnWorker,
    });
  } catch (err) {
    return { triggered: true, action: "error", skippedReason: `runner-threw:${err.message}` };
  }

  return { triggered: true, action: "ran", result };
}

// ─── PreAgentHandoff Hook ─────────────────────────────────────────────

/** Default configuration for the PreAgentHandoff hook. */
const PRE_AGENT_HANDOFF_DEFAULTS = {
  enabled: true,
  injectContext: true,
  runRegressionGuard: true,
  cacheMaxAgeMinutes: 30,
  minAlertSeverity: "medium",
};

/**
 * Check whether a LiveGuard cache file is stale based on its timestamp field.
 * @param {object|null} cache - Cache object with a timestamp or scannedAt field
 * @param {number} maxAgeMinutes - Maximum acceptable age in minutes
 * @returns {boolean}
 */
function isLiveGuardCacheStale(cache, maxAgeMinutes) {
  if (!cache) return true;
  const ts = cache.scannedAt || cache.timestamp || cache.createdAt;
  if (!ts) return true;
  const age = Date.now() - new Date(ts).getTime();
  return age > maxAgeMinutes * 60 * 1000;
}

/**
 * Format a relative time string like "5 min" or "2 hr".
 * @param {string} isoTimestamp
 * @returns {string}
 */
function formatSnapshotAge(isoTimestamp) {
  if (!isoTimestamp) return "unknown";
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr`;
}

/**
 * Run the PreAgentHandoff hook. Reads LiveGuard caches and builds a
 * structured context header for injection into a new agent session.
 *
 * @param {object} params
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @param {string[]} [params.dirtyFiles=[]] - Files modified on the current branch (git diff)
 * @param {boolean} [params.hasActivePlan=false] - Whether an active plan file exists
 * @param {boolean} [params.hasAutoFixPlan=false] - Whether a LIVEGUARD-FIX-*.md auto-fix plan exists
 * @param {boolean} [params.isResumeSession=false] - Whether the session references --resume-from
 * @param {object} [params._deps={}] - Injectable dependencies
 * @returns {Promise<{ triggered: boolean, contextHeader?: string, regressionResult?: object, openClawResult?: object, skippedReason?: string }>}
 */
export async function runPreAgentHandoffHook({
  cwd = process.cwd(),
  dirtyFiles = [],
  hasActivePlan = false,
  hasAutoFixPlan = false,
  isResumeSession = false,
  _deps = {},
} = {}) {
  if (process.env.PFORGE_QUORUM_TURN) {
    console.error("[PreAgentHandoff] skipping context injection — PFORGE_QUORUM_TURN active");
    return { triggered: false, skippedReason: "PFORGE_QUORUM_TURN active" };
  }

  const hasDirtyBranch = dirtyFiles.length > 0;
  const shouldFire = hasDirtyBranch || hasActivePlan || hasAutoFixPlan || isResumeSession;
  if (!shouldFire) {
    return { triggered: false, skippedReason: "no-trigger-conditions" };
  }

  let config = { ...PRE_AGENT_HANDOFF_DEFAULTS };
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.hooks?.preAgentHandoff) {
        config = { ...PRE_AGENT_HANDOFF_DEFAULTS, ...raw.hooks.preAgentHandoff };
      }
    }
  } catch { /* use defaults */ }

  if (config.enabled === false) {
    return { triggered: true, contextHeader: null, skippedReason: "disabled" };
  }

  const maxAge = config.cacheMaxAgeMinutes ?? 30;

  const triageCache = readForgeJson("alert-triage-cache.json", null, cwd);
  const driftHistory = readForgeJsonl("drift-history.jsonl", [], cwd);
  const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
  const secretScanCache = readForgeJson("secret-scan-cache.json", null, cwd);
  const deployJournal = readForgeJsonl("deploy-journal.jsonl", [], cwd);

  const hasAnyData = triageCache || driftHistory.length > 0 || incidents.length > 0 || secretScanCache || deployJournal.length > 0;

  if (!hasAnyData) {
    const contextHeader = "🛡️ LIVEGUARD CONTEXT — No data yet\nRun `pforge triage` after completing the first deploy to activate LiveGuard monitoring.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    return { triggered: true, contextHeader, regressionResult: null, openClawResult: null };
  }

  const latestDrift = driftHistory.length > 0 ? driftHistory[driftHistory.length - 1] : null;
  const score = latestDrift?.score ?? "N/A";
  const trend = latestDrift?.trend ?? "unknown";
  const violationCount = latestDrift?.violations?.length ?? 0;
  const snapshotTs = latestDrift?.timestamp || triageCache?.scannedAt || new Date().toISOString();
  const snapshotAge = formatSnapshotAge(snapshotTs);

  const openIncidents = incidents.filter(i => !i.resolvedAt);

  const lastDeploy = deployJournal.length > 0 ? deployJournal[deployJournal.length - 1] : null;

  const secretScan = secretScanCache || { clean: true, findings: [] };
  const secretScanAge = secretScanCache ? formatSnapshotAge(secretScanCache.scannedAt) : "never";

  const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
  const minRank = severityRank[config.minAlertSeverity] || 2;
  const alerts = (triageCache?.alerts || triageCache?.results || [])
    .filter(a => (severityRank[a.severity] || 0) >= minRank);

  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "🛡️ LIVEGUARD CONTEXT — Session Start",
    `(As of ${snapshotAge} ago — run \`pforge triage\` to refresh)`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    `Drift Score: ${score}/100 (${trend}) — ${violationCount} active violations`,
    `Open Incidents: ${openIncidents.length}${openIncidents.length > 0 ? ` (${openIncidents.map(i => i.severity).join(", ")})` : ""}`,
  ];

  if (lastDeploy) {
    const postHealth = lastDeploy.postHealthScore ?? "not yet recorded";
    lines.push(`Last Deploy: ${lastDeploy.version || "unknown"} @ ${lastDeploy.timestamp || "unknown"} (pre: ${lastDeploy.preHealthScore ?? "N/A"}, post: ${postHealth})`);
  } else {
    lines.push("Last Deploy: none recorded");
  }

  lines.push(`Last Secret Scan: ${secretScan.clean !== false ? "✅ Clean" : `⛔ ${(secretScan.findings || []).length} finding(s)`} (${secretScanAge})`);
  lines.push("");

  if (alerts.length > 0) {
    lines.push("Top Alerts (medium+):");
    alerts.slice(0, 5).forEach((a, i) => {
      lines.push(`${i + 1}. [${(a.severity || "unknown").toUpperCase()}] ${a.title || a.message || "untitled"} — ${a.recommendedAction || "investigate"}`);
    });
    if (alerts.length > 5) {
      lines.push(`...and ${alerts.length - 5} more. Run \`pforge triage\` for full list.`);
    }
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let contextHeader = lines.join("\n");

  let regressionResult = null;
  if (hasDirtyBranch && config.runRegressionGuard !== false) {
    try {
      if (_deps._regressionGuard) {
        regressionResult = await _deps._regressionGuard(dirtyFiles, { cwd });
      }
      if (regressionResult && regressionResult.failed > 0) {
        const failedGates = (regressionResult.results || []).filter(r => r.status === "failed");
        const regressionLines = [
          "",
          `⚠️ Regression Alert — ${regressionResult.failed} gate(s) failing on current branch changes`,
          "",
          ...failedGates.map(r => `• Slice ${r.sliceNumber} (${r.planFile}): ${r.cmd}`),
          "",
          "Resolve these before adding new code — the current branch has introduced regressions.",
        ];
        contextHeader += "\n" + regressionLines.join("\n");
      }
    } catch (err) {
      console.error(`[PreAgentHandoff] regression guard error: ${err.message}`);
    }
  }

  let openClawResult = null;
  try {
    const { endpoint } = loadOpenClawConfig(cwd);
    if (endpoint) {
      const openClawPromise = postOpenClawSnapshot(cwd, {
        trigger: "preAgentHandoff",
        dirtyFiles: dirtyFiles.length,
        openIncidents: openIncidents.length,
      });
      openClawPromise.then(r => { openClawResult = r; }).catch(err => {
        console.error(`[PreAgentHandoff] openclaw snapshot skipped: ${err.message}`);
      });
    }
  } catch (err) {
    console.error(`[PreAgentHandoff] openclaw snapshot skipped: ${err.message}`);
  }

  return { triggered: true, contextHeader, regressionResult, openClawResult };
}

// ─── OpenClaw Integration ─────────────────────────────────────────────

/**
 * Load OpenClaw configuration from .forge.json.
 * @param {string} cwd
 * @returns {{ endpoint: string|null, apiKey: string|null }}
 */
export function loadOpenClawConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.openclaw && config.openclaw.endpoint) {
        let apiKey = config.openclaw.apiKey || null;
        if (!apiKey) {
          const secretsPath = resolve(cwd, ".forge/secrets.json");
          if (existsSync(secretsPath)) {
            try {
              const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
              apiKey = secrets.OPENCLAW_API_KEY || null;
            } catch { /* skip */ }
          }
        }
        return { endpoint: config.openclaw.endpoint, apiKey };
      }
    }
  } catch { /* skip */ }
  return { endpoint: null, apiKey: null };
}

/**
 * Post a LiveGuard context snapshot to the configured OpenClaw endpoint.
 * Fire-and-forget with a 5s hard timeout. Never throws.
 *
 * @param {string} cwd - Project directory
 * @param {object} [extraContext] - Additional context fields to include
 * @returns {Promise<{ sent: boolean, endpoint?: string, error?: string }>}
 */
export async function postOpenClawSnapshot(cwd, extraContext = {}) {
  const { endpoint, apiKey } = loadOpenClawConfig(cwd);
  if (!endpoint) return { sent: false, error: "No openclaw.endpoint configured" };

  try {
    const snapshot = { timestamp: new Date().toISOString(), project: null, ...extraContext };

    try {
      const config = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
      snapshot.project = config.projectName || null;
    } catch { /* skip */ }

    try {
      const history = readForgeJsonl("drift-history.jsonl", [], cwd);
      const latest = history[history.length - 1];
      snapshot.driftScore = latest?.score ?? null;
      snapshot.driftViolations = latest?.violations ?? null;
    } catch { /* skip */ }

    const incidentsPath = resolve(cwd, ".forge/incidents.jsonl");
    if (existsSync(incidentsPath)) {
      try {
        const lines = readFileSync(incidentsPath, "utf-8").trim().split("\n").filter(Boolean);
        const incidents = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        snapshot.openIncidents = incidents.filter((i) => !i.resolvedAt).length;
        snapshot.totalIncidents = incidents.length;
      } catch { /* skip */ }
    }

    const deployPath = resolve(cwd, ".forge/deploy-journal.jsonl");
    if (existsSync(deployPath)) {
      try {
        const lines = readFileSync(deployPath, "utf-8").trim().split("\n").filter(Boolean);
        const last = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null;
        if (last) {
          snapshot.lastDeployVersion = last.version || null;
          snapshot.lastDeployEnv = last.environment || null;
          snapshot.lastDeployAt = last.timestamp || null;
        }
      } catch { /* skip */ }
    }

    const scanPath = resolve(cwd, ".forge/secret-scan-cache.json");
    if (existsSync(scanPath)) {
      try {
        const scan = JSON.parse(readFileSync(scanPath, "utf-8"));
        snapshot.secretScanClean = scan.clean ?? null;
        snapshot.secretScanFindings = scan.findings?.length ?? 0;
      } catch { /* skip */ }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return { sent: true, endpoint, status: response.status };
  } catch (err) {
    return { sent: false, endpoint, error: err.name === "AbortError" ? "timeout (5s)" : err.message };
  }
}
