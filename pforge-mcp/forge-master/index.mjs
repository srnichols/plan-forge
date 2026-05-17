/**
 * Plan Forge — Forge-Master Subsystem (Phase-29 shim).
 *
 * Exports the full pforge-master surface when available. When pforge-master
 * is not installed (e.g., pforge-mcp deployed in isolation), exports stub
 * implementations for `runTurn` and `loadPrefs` so `forge_master_ask` degrades
 * gracefully instead of throwing "Cannot find module" (Issue #200).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PFORGE_INDEX = resolve(__dirname, "../../pforge-master/src/index.mjs");

// Top-level await: attempt to load pforge-master once at module initialization.
let _mod = null;
if (existsSync(PFORGE_INDEX)) {
  try {
    _mod = await import(pathToFileURL(PFORGE_INDEX).href);
  } catch {
    _mod = null;
  }
}

// ── Stub: loadPrefs ────────────────────────────────────────────────────────────
// Mirrors pforge-master/src/http-routes.mjs so forge_master_ask can read
// .forge/fm-prefs.json even when pforge-master is not installed.

const _PREFS_FILE = ".forge/fm-prefs.json";
const _PREFS_DEFAULTS = { tier: null, autoEscalate: false, quorumAdvisory: "off", embeddingFallback: true };
const _VALID_TIERS = Object.freeze(["low", "medium", "high"]);
const _VALID_QUORUM_MODES = Object.freeze(["off", "auto", "always"]);

export function loadPrefs(cwd = process.cwd()) {
  if (_mod?.loadPrefs) return _mod.loadPrefs(cwd);
  try {
    const raw = JSON.parse(readFileSync(join(cwd, _PREFS_FILE), "utf-8"));
    const tier = raw.tier && _VALID_TIERS.includes(raw.tier) ? raw.tier : null;
    const autoEscalate = typeof raw.autoEscalate === "boolean" ? raw.autoEscalate : false;
    const quorumAdvisory = _VALID_QUORUM_MODES.includes(raw.quorumAdvisory) ? raw.quorumAdvisory : "off";
    const embeddingFallback = typeof raw.embeddingFallback === "boolean" ? raw.embeddingFallback : true;
    return { tier, autoEscalate, quorumAdvisory, embeddingFallback };
  } catch {
    return { ..._PREFS_DEFAULTS };
  }
}

// ── Stub: runTurn ──────────────────────────────────────────────────────────────
// Returns a graceful degradation response when pforge-master is absent so
// forge_master_ask callers receive a useful message instead of a module error.

export async function runTurn(params, deps) {
  if (_mod?.runTurn) return _mod.runTurn(params, deps);
  return {
    reply: [
      "Forge-Master is not available in this environment.",
      "The `pforge-master` package was not found alongside `pforge-mcp`.",
      "",
      "Use individual forge tools directly to accomplish your task:",
      "  \u2022 forge_plan_status  \u2014 plan progress and slice status",
      "  \u2022 brain_recall       \u2014 retrieve project memories",
      "  \u2022 forge_analyze      \u2014 analyze plan or code",
      "  \u2022 forge_cost_report  \u2014 token and cost summary",
    ].join("\n"),
    sessionId: randomUUID(),
    tokensIn: 0,
    tokensOut: 0,
    totalCostUSD: 0,
    toolCalls: [],
    truncated: false,
    error: "pforge-master not installed",
  };
}

// ── Full API surface passthrough ──────────────────────────────────────────────
// When pforge-master IS installed these delegate to the real module.
// When absent they are `undefined`; consumers get undefined rather than a throw.

export const getForgeMasterConfig = _mod?.getForgeMasterConfig;
export const FORGE_MASTER_DEFAULTS = _mod?.FORGE_MASTER_DEFAULTS;
export const BASE_ALLOWLIST = _mod?.BASE_ALLOWLIST;
export const WRITE_TOOLS_EXCLUDED = _mod?.WRITE_TOOLS_EXCLUDED;
export const USAGE_HINTS = _mod?.USAGE_HINTS;
export const resolveAllowlist = _mod?.resolveAllowlist;
export const isAllowlisted = _mod?.isAllowlisted;
export const WRITE_ALLOWLIST = _mod?.WRITE_ALLOWLIST;
export const PHASE29_FULL_ALLOWLIST = _mod?.PHASE29_FULL_ALLOWLIST;
export const classify = _mod?.classify;
export const LANES = _mod?.LANES;
export const LANE_TOOLS = _mod?.LANE_TOOLS;
export const OFFTOPIC_REDIRECT = _mod?.OFFTOPIC_REDIRECT;
export const fetchContext = _mod?.fetchContext;
export const TOKEN_CAP = _mod?.TOKEN_CAP;
export const L1_KEYS = _mod?.L1_KEYS;
export const L2_KEYS_BY_LANE = _mod?.L2_KEYS_BY_LANE;
export const L3_KEYS = _mod?.L3_KEYS;
export const invokeAllowlisted = _mod?.invokeAllowlisted;
export const invokeMany = _mod?.invokeMany;
export const summarize = _mod?.summarize;
export const createDispatcher = _mod?.createDispatcher;
export const SUMMARY_LIMIT = _mod?.SUMMARY_LIMIT;
export const buildToolSchemas = _mod?.buildToolSchemas;
export const selectProvider = _mod?.selectProvider;
export const autoSelectProvider = _mod?.autoSelectProvider;
export const ABSOLUTE_CEILING = _mod?.ABSOLUTE_CEILING;
export const loadPrinciples = _mod?.loadPrinciples;
export const UNIVERSAL_BASELINE = _mod?.UNIVERSAL_BASELINE;
export const _clearPrinciplesCache = _mod?._clearPrinciplesCache;
export const ensureSessionId = _mod?.ensureSessionId;
export const appendTurn = _mod?.appendTurn;
export const summarizeIfNeeded = _mod?.summarizeIfNeeded;
export const SUMMARIZE_THRESHOLD = _mod?.SUMMARIZE_THRESHOLD;
export const SUMMARIZE_COUNT = _mod?.SUMMARIZE_COUNT;
export const _resetLocks = _mod?._resetLocks;
export const createHubSubscriber = _mod?.createHubSubscriber;
export const createApprovalGate = _mod?.createApprovalGate;
export const getPromptCatalog = _mod?.getPromptCatalog;
export const getPromptById = _mod?.getPromptById;
export const createSseStream = _mod?.createSseStream;
export const createHttpRoutes = _mod?.createHttpRoutes;
export const savePrefs = _mod?.savePrefs;
export const createHttpDispatcher = _mod?.createHttpDispatcher;
export const invokeForgeTool = _mod?.invokeForgeTool;
export const lifecycleStart = _mod?.lifecycleStart;
export const lifecycleStop = _mod?.lifecycleStop;
export const lifecycleStatus = _mod?.lifecycleStatus;
export const lifecycleLogs = _mod?.lifecycleLogs;
