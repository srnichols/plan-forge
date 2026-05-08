// ─── Cost Service ─────────────────────────────────────────────────────
// Phase-27 (v2.60.0): Canonical pricing + estimation module.
// Consolidates MODEL_PRICING, per-slice costing, per-run breakdowns,
// plan cost estimation, and multi-mode quorum estimation.
// Orchestrator and scanners re-export / import from here; this is the
// single source of truth for every $-denominated value in pforge.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  scoreSliceComplexity,
  loadModelPerformance,
  inferSliceType,
  recommendModel,
  assessQuorumViability,
  aggregateModelStats,
  isApiOnlyModel,
  QUORUM_PRESETS,
} from "./orchestrator.mjs";

// ─── Pricing Table ────────────────────────────────────────────────────
// Per-token costs in USD. Updated 2026-05-06 (Phase-COST-TOKEN-COVERAGE).
// Source: published vendor API pricing pages, retrieval date in _source.
// Rates are per 1 token. Multipliers default to 1.0 in getPricing() if absent.
//
// IMPORTANT — Vendor convention asymmetry:
//   - Anthropic input_tokens EXCLUDES cache_read_input_tokens + cache_creation_*
//     (bill all three independently per priceSlice() math).
//   - OpenAI / xAI prompt_tokens INCLUDES cached_tokens
//     (subtract cached_tokens before billing the uncached portion).
// See Phase-COST-TOKEN-COVERAGE-PLAN.md Forbidden Actions #4 and #5.
//
// _retiredAfter: ISO date marking xAI's May 15, 2026 model retirements
// (informational only; entries kept for historical cost-history.json compatibility).
export const MODEL_PRICING = {
  // ─── Anthropic Claude ──────────────────────────────────────────────
  // Cache: read 0.10×, 5m write 1.25×, 1h write 2.0× (uniform across all tiers).
  // Opus 4.5/4.6/4.7 dropped to $5/$25 per Anthropic pricing page (2026-05-06).
  // Source: https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
  "claude-opus-4.7":        { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-opus-4.6":        { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-opus-4.6-fast":   { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-opus-4.5":        { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-sonnet-4.6":      { input: 3 / 1_000_000,    output: 15 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-sonnet-4.5":      { input: 3 / 1_000_000,    output: 15 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-sonnet-4":        { input: 3 / 1_000_000,    output: 15 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },
  "claude-haiku-4.5":       { input: 1 / 1_000_000,    output: 5 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching (2026-05-06)" },

  // ─── OpenAI GPT (5.x family) ───────────────────────────────────────
  // Cache: 0.10× read for GPT-5.x. Writes are FREE (no cache_write multiplier).
  // Flex: 0.5× input AND 0.5× output (symmetric, gpt-5.5 + gpt-5.4 only).
  // Priority: 2.0× input, 1.5× output (asymmetric).
  // Source: https://developers.openai.com/api/docs/pricing (2026-05-06)
  "gpt-5.5":                { input: 5 / 1_000_000,    output: 30 / 1_000_000,
    cache_read_multiplier: 0.10,
    flex_input_multiplier: 0.5, flex_output_multiplier: 0.5,
    priority_input_multiplier: 2.0, priority_output_multiplier: 1.5,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.4":                { input: 2.5 / 1_000_000,  output: 15 / 1_000_000,
    cache_read_multiplier: 0.10,
    flex_input_multiplier: 0.5, flex_output_multiplier: 0.5,
    priority_input_multiplier: 2.0, priority_output_multiplier: 1.5,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.4-mini":           { input: 0.75 / 1_000_000, output: 4.5 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.4-nano":           { input: 0.20 / 1_000_000, output: 1.25 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.3-codex":          { input: 1.75 / 1_000_000, output: 14 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.2-codex":          { input: 1.75 / 1_000_000, output: 14 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.2":                { input: 1.75 / 1_000_000, output: 14 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5.1":                { input: 1.25 / 1_000_000, output: 10 / 1_000_000,
    cache_read_multiplier: 0.10,
    aoai_deployment_type_multiplier: { global: 1.0, "data-zone": 1.1, regional: 1.1, provisioned: 1.0 },
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5":                  { input: 1.25 / 1_000_000, output: 10 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5-mini":             { input: 0.25 / 1_000_000, output: 2 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-5-nano":             { input: 0.05 / 1_000_000, output: 0.40 / 1_000_000,
    cache_read_multiplier: 0.10,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },

  // ─── OpenAI GPT 4.x family ────────────────────────────────────────
  // Cache: 0.25× read for GPT-4.1/4.1-mini; 0.50× for GPT-4o/4o-mini.
  // aoai_deployment_type_multiplier: AOAI uplift for Data Zone / Regional
  // deployments (1.1×); Global and Provisioned remain 1.0× (no uplift).
  // Source: https://learn.microsoft.com/azure/ai-services/openai/concepts/pricing-versions
  "gpt-4.1":                { input: 2 / 1_000_000,    output: 8 / 1_000_000,
    cache_read_multiplier: 0.25,
    aoai_deployment_type_multiplier: { global: 1.0, "data-zone": 1.1, regional: 1.1, provisioned: 1.0 },
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-4.1-mini":           { input: 0.40 / 1_000_000, output: 1.60 / 1_000_000,
    cache_read_multiplier: 0.25,
    aoai_deployment_type_multiplier: { global: 1.0, "data-zone": 1.1, regional: 1.1, provisioned: 1.0 },
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-4o":                 { input: 2.5 / 1_000_000,  output: 10 / 1_000_000,
    cache_read_multiplier: 0.50,
    aoai_deployment_type_multiplier: { global: 1.0, "data-zone": 1.1, regional: 1.1, provisioned: 1.0 },
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "gpt-4o-mini":            { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000,
    cache_read_multiplier: 0.50,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },

  // ─── OpenAI o-series (reasoning models) ───────────────────────────
  // Cache: 0.50× read for o1 / o1-mini / o3-mini; 0.25× for o3 / o4-mini.
  // reasoning_tokens are billed at output rate AND already counted in output_tokens
  // — DO NOT add reasoning_tokens separately to billable output (Forbidden Action #3).
  "o1":                     { input: 15 / 1_000_000,   output: 60 / 1_000_000,
    cache_read_multiplier: 0.50,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "o1-mini":                { input: 1.10 / 1_000_000, output: 4.40 / 1_000_000,
    cache_read_multiplier: 0.50,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "o3":                     { input: 2 / 1_000_000,    output: 8 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "o3-mini":                { input: 1.10 / 1_000_000, output: 4.40 / 1_000_000,
    cache_read_multiplier: 0.50,
    aoai_deployment_type_multiplier: { global: 1.0, "data-zone": 1.1, regional: 1.1, provisioned: 1.0 },
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "o4-mini":                { input: 1.10 / 1_000_000, output: 4.40 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },

  // ─── Google Gemini ────────────────────────────────────────────────
  "gemini-3-pro-preview":   { input: 1.25 / 1_000_000, output: 5 / 1_000_000 },

  // ─── xAI Grok ─────────────────────────────────────────────────────
  // Cache: ~0.25× approximation. Authoritative cost comes from response
  // usage.cost_in_usd_ticks (1 tick = 1e-10 USD); priceSlice() uses ticks
  // when present and falls back to multiplier math otherwise.
  // Source: https://docs.x.ai/developers/models, https://docs.x.ai/developers/cost-tracking
  // _retiredAfter: marks xAI May 15, 2026 retirements (kept for historical compat).
  "grok-4.3":                          { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/models (2026-05-06)" },
  "grok-4.20":                         { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/models (2026-05-06)" },
  "grok-4.20-0309-reasoning":          { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/models (2026-05-06)" },
  "grok-4.20-0309-non-reasoning":      { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/models (2026-05-06)" },
  "grok-4.20-multi-agent-0309":        { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/models (2026-05-06)" },
  "grok-4-1-fast-reasoning":           { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000,
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-4-1-fast-non-reasoning":       { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000,
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-4":                            { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/models (2026-05-06)" },
  "grok-4-0709":                       { input: 1.25 / 1_000_000, output: 2.50 / 1_000_000,
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-3":                            { input: 3 / 1_000_000,    output: 15 / 1_000_000,
    _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-3-mini":                       { input: 0.30 / 1_000_000, output: 0.50 / 1_000_000 },

  // ─── Fallback ─────────────────────────────────────────────────────
  // Conservative default: kept at $3/$15 (Sonnet-class) so unknown models
  // don't dramatically under-estimate cost. No cache multipliers applied
  // (defaults to 1.0 — no benefit assumed for unrecognised models).
  default:                  { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
};

/**
 * Default multiplier values applied to every pricing entry that doesn't override them.
 * Phase-COST-TOKEN-COVERAGE Slice 1: enables additive vendor-aware math in priceSlice()
 * without breaking entries that only carry { input, output }. Anthropic-only fields
 * (cache_write_5m_multiplier, cache_write_1h_multiplier) and OpenAI-only fields
 * (flex_*, priority_*) all default to 1.0 so unknown/legacy entries cost as before.
 */
const PRICING_MULTIPLIER_DEFAULTS = Object.freeze({
  cache_read_multiplier: 1.0,
  cache_write_5m_multiplier: 1.0,
  cache_write_1h_multiplier: 1.0,
  flex_input_multiplier: 1.0,
  flex_output_multiplier: 1.0,
  priority_input_multiplier: 1.0,
  priority_output_multiplier: 1.0,
});

/**
 * Look up per-token pricing for a model. Unknown models fall through to the
 * default rate so callers never hit an undefined.
 *
 * Returns the full pricing object with all multiplier defaults applied (1.0 for any
 * cache_read / cache_write / flex / priority multiplier the entry doesn't override).
 * Callers can rely on every multiplier field being a number — no need to handle
 * missing keys downstream.
 *
 * @param {string} model
 * @returns {{
 *   input: number, output: number,
 *   cache_read_multiplier: number,
 *   cache_write_5m_multiplier: number, cache_write_1h_multiplier: number,
 *   flex_input_multiplier: number, flex_output_multiplier: number,
 *   priority_input_multiplier: number, priority_output_multiplier: number,
 *   _retiredAfter?: string, _source?: string,
 * }}
 */
export function getPricing(model) {
  const entry = MODEL_PRICING[model] || MODEL_PRICING.default;
  return { ...PRICING_MULTIPLIER_DEFAULTS, ...entry };
}

// ─── Provider Awareness ───────────────────────────────────────────────
// Subscription CLI providers bill by premium-request count, not per-token.
export const SUBSCRIPTION_PROVIDERS = new Set(["gh-copilot", "claude-cli", "codex-cli"]);

// ─── Microsoft Foundry: deployment-name → model-key resolution ────────
// Reads `.forge/foundry-deployments.json` (operator-editable) once per cwd;
// falls back to the raw deployment name when the map is absent or the
// deployment is not listed.  Shape: `{ "my-deployment": "gpt-5.4-mini" }`.
let _foundryDeploymentMap = null;
let _foundryMapCwd = null;

function loadFoundryDeployments() {
  const cwd = process.cwd();
  if (_foundryDeploymentMap !== null && _foundryMapCwd === cwd) {
    return _foundryDeploymentMap;
  }
  const mapPath = resolve(cwd, ".forge", "foundry-deployments.json");
  try {
    _foundryDeploymentMap = existsSync(mapPath)
      ? JSON.parse(readFileSync(mapPath, "utf-8"))
      : {};
  } catch {
    _foundryDeploymentMap = {};
  }
  _foundryMapCwd = cwd;
  return _foundryDeploymentMap;
}

/**
 * Resolve a Microsoft Foundry deployment name to a canonical MODEL_PRICING key.
 * Reads `.forge/foundry-deployments.json`; falls back to the deployment name itself.
 * @param {string} deployment
 * @returns {string}
 */
function resolveFoundryModel(deployment) {
  const map = loadFoundryDeployments();
  return (deployment && map[deployment]) || deployment || "unknown";
}

const CLI_PER_REQUEST_USD = 0.01;

/**
 * Expected wall-clock minutes for one Copilot Coding Agent slice.
 * Based on DEFAULT_TIMEOUT_MS (30 min) in copilot-coding-agent.mjs.
 * Used by estimatePlan to project elapsed time for --estimate output.
 */
export const COPILOT_AGENT_MINUTES_PER_SLICE = 30;

/**
 * Determine cost model for the active execution environment.
 *
 * Precedence (highest to lowest):
 *   1. env.PFORGE_COST_MODEL — explicit override
 *   2. forgeConfig.cost?.model — project-level config in .forge.json
 *   3. Model-name heuristic:
 *      - gpt-*       → openai-api
 *      - grok-*      → xai-api
 *      - claude-* + ANTHROPIC_API_KEY → anthropic-api
 *      - claude-* (no key)            → claude-cli
 *      - "gh-copilot" / *copilot*     → gh-copilot
 *      - else                         → unknown
 *   4. default → unknown
 *
 * @param {{ env?: Record<string,string>, forgeConfig?: object, model?: string }} opts
 * @returns {{ provider: string, perRequestUsd: number|null, source: string }}
 */
export function detectCostModel({ env = {}, forgeConfig = {}, model = "" } = {}) {
  const knownProviders = new Set([
    "gh-copilot", "claude-cli", "codex-cli",
    "anthropic-api", "openai-api", "xai-api", "unknown",
  ]);

  function toResult(provider, source) {
    let perRequestUsd;
    if (SUBSCRIPTION_PROVIDERS.has(provider)) {
      perRequestUsd = CLI_PER_REQUEST_USD;
    } else if (provider === "unknown") {
      perRequestUsd = 0;
    } else {
      perRequestUsd = null; // API provider — use token-based pricing
    }
    return { provider, perRequestUsd, source };
  }

  // 1. Explicit env override
  const envOverride = env.PFORGE_COST_MODEL;
  if (envOverride && knownProviders.has(envOverride)) {
    return toResult(envOverride, "env:PFORGE_COST_MODEL");
  }

  // 2. forge.json cost.model
  const cfgModel = forgeConfig?.cost?.model;
  if (cfgModel && knownProviders.has(cfgModel)) {
    return toResult(cfgModel, "forge.json:cost.model");
  }

  // 3. Model-name heuristic
  // Issue #120: previously gpt-* always routed to openai-api (token pricing),
  // which produced ~250x overestimates for users running gh-copilot. Align
  // with probeQuorumModelAvailability's host detection: when no API key is
  // present, prefer the local CLI (gh-copilot for gpt-*, claude-cli for
  // claude-*) which is subscription-priced.
  const m = typeof model === "string" ? model : "";
  if (m.startsWith("gpt-") || m.startsWith("chatgpt-")) {
    const hasKey = Boolean(env.OPENAI_API_KEY);
    return toResult(hasKey ? "openai-api" : "gh-copilot", "model-prefix");
  }
  if (m.startsWith("grok-")) {
    // Grok has no Copilot host today — direct API only.
    return toResult("xai-api", "model-prefix");
  }
  if (m.startsWith("claude-")) {
    const hasKey = Boolean(env.ANTHROPIC_API_KEY);
    return toResult(hasKey ? "anthropic-api" : "claude-cli", "model-prefix");
  }
  if (m === "gh-copilot" || m.includes("copilot")) {
    return toResult("gh-copilot", "model-prefix");
  }
  if (m === "codex-cli" || m.startsWith("codex-")) {
    return toResult("codex-cli", "model-prefix");
  }

  // 4. Default
  return toResult("unknown", "default");
}

/**
 * Round a USD cost to 6 decimal places (matches existing convention; ~$0.000001 precision).
 */
function roundUsd(n) {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Build a zero-filled `cost_breakdown` object. Every priceSlice() return populates
 * the same shape so downstream consumers can rely on the keys existing.
 */
function emptyBreakdown() {
  return {
    input_uncached: 0,
    input_cache_read: 0,
    input_cache_write_5m: 0,
    input_cache_write_1h: 0,
    output_total: 0,
    reasoning_tokens: 0,
    tier_adjustment: 0,
    subscription_cost: 0,
  };
}

/**
 * Resolve OpenAI / xAI service-tier multipliers from a pricing entry.
 * Returns `{ input: 1.0, output: 1.0 }` for unknown/missing tiers (no adjustment).
 */
function resolveTierMultipliers(pricing, serviceTier) {
  switch (serviceTier) {
    case "flex":
      return { input: pricing.flex_input_multiplier, output: pricing.flex_output_multiplier };
    case "priority":
      return { input: pricing.priority_input_multiplier, output: pricing.priority_output_multiplier };
    case "standard":
    case "default":
    case null:
    case undefined:
    default:
      return { input: 1.0, output: 1.0 };
  }
}

/**
 * Calculate cost for a single slice from its token data.
 *
 * Phase-COST-TOKEN-COVERAGE Slice 3: vendor-aware billing math with per-class
 * `cost_breakdown`. Five execution paths, picked from `tokens.vendor`:
 *
 *  - **Subscription CLI** (`worker` is set and not `api-*`): unchanged path —
 *    `premiumRequests × $0.01`. v2.83.0 Forbidden Action #1 protected.
 *  - **Anthropic** (`vendor === 'anthropic'`): `tokens_in` is uncached input
 *    (after last cache breakpoint). Bill `tokens_in`, cache_read, 5m write,
 *    1h write each independently with their multipliers.
 *  - **OpenAI** (`vendor === 'openai'`): `tokens_in` INCLUDES `cache_read_tokens`.
 *    Subtract cached from input before billing uncached portion. Apply tier
 *    multipliers (flex/priority).
 *  - **xAI** (`vendor === 'xai'`): if `cost_in_usd_ticks` present, use it directly
 *    (1 tick = 1e-10 USD); skip computed math. Otherwise mirror OpenAI math.
 *  - **Unknown / legacy** (`vendor` absent or unrecognized): backward-compatible
 *    math. `tokens_in × input + tokens_out × output`. Existing callers that
 *    construct `{ tokens_in, tokens_out, model }` see identical cost as before.
 *
 * @param {{
 *   tokens_in?: number|null, tokens_out?: number|null, model?: string,
 *   premiumRequests?: number,
 *   cache_read_tokens?: number,
 *   cache_creation_5m_tokens?: number, cache_creation_1h_tokens?: number,
 *   cache_creation_input_tokens?: number,
 *   reasoning_tokens?: number,
 *   service_tier?: 'standard'|'flex'|'priority'|'default'|null,
 *   cost_in_usd_ticks?: number,
 *   vendor?: 'anthropic'|'openai'|'xai'|'azure-openai'|'microsoft-foundry'|'unknown',
 *   provider?: string,
 *   deployment?: string,
 * }} tokens
 * @param {string} [worker] - Worker type: "gh-copilot", "claude", "codex", "api-xai", etc.
 * @returns {{
 *   cost_usd: number, model: string, tokens_in: number, tokens_out: number,
 *   cost_breakdown: object,
 * }}
 */
export function priceSlice(tokens, worker) {
  // ─── Microsoft Foundry: deployment-name → canonical model-key ────────
  // Detect: explicit provider field OR worker produced by the foundry dispatch.
  // Resolve the deployment field via .forge/foundry-deployments.json before
  // the getPricing() lookup. Falls back to deployment name as a literal key.
  const _rawModel = tokens?.model || "unknown";
  const isFoundry = (tokens?.provider === "microsoft-foundry") ||
                    (worker === "api-microsoft-foundry");
  const model = isFoundry
    ? resolveFoundryModel(tokens?.deployment || _rawModel)
    : _rawModel;
  const tokensIn = typeof tokens?.tokens_in === "number" ? tokens.tokens_in : 0;
  const tokensOut = typeof tokens?.tokens_out === "number" ? tokens.tokens_out : 0;
  const breakdown = emptyBreakdown();

  // ─── Subscription CLI path (UNCHANGED — v2.83.0 Forbidden Action) ───
  if (worker && !worker.startsWith("api-")) {
    const premiumRequests = tokens?.premiumRequests || 0;
    const PREMIUM_REQUEST_RATE = 0.01; // ~$0.01 per premium request
    const cost = premiumRequests * PREMIUM_REQUEST_RATE;
    breakdown.subscription_cost = roundUsd(cost);
    return {
      cost_usd: roundUsd(cost),
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_breakdown: breakdown,
    };
  }

  // ─── xAI authoritative override: cost_in_usd_ticks wins ───
  // Per xAI cost-tracking docs: usage.cost_in_usd_ticks is the authoritative
  // billed amount per response (1 tick = 1e-10 USD). When present, multiplier
  // math is bypassed so estimates exactly match the xAI invoice.
  if (tokens?.vendor === "xai" && typeof tokens?.cost_in_usd_ticks === "number") {
    const costFromTicks = tokens.cost_in_usd_ticks * 1e-10;
    const reasoning = tokens?.reasoning_tokens || 0;
    breakdown.input_uncached = roundUsd(costFromTicks); // attributed for sum invariant
    breakdown.reasoning_tokens = reasoning;
    breakdown.authoritative_source = "cost_in_usd_ticks";
    return {
      cost_usd: roundUsd(costFromTicks),
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_breakdown: breakdown,
    };
  }

  const pricing = getPricing(model);
  const reasoningTokens = tokens?.reasoning_tokens || 0;
  breakdown.reasoning_tokens = reasoningTokens; // informational subset of tokens_out

  // ─── Anthropic path: input_tokens EXCLUDES cached + creation ───
  // Bill each component independently. Per Anthropic prompt caching docs,
  // total billable input = uncached + cache_read + cache_creation (5m + 1h).
  if (tokens?.vendor === "anthropic") {
    const cacheRead = tokens?.cache_read_tokens || 0;
    let cache5m = tokens?.cache_creation_5m_tokens || 0;
    let cache1h = tokens?.cache_creation_1h_tokens || 0;
    const cacheCombined = tokens?.cache_creation_input_tokens || 0;

    // If only the combined cache_creation_input_tokens is set (no 5m/1h split),
    // default the entire amount to 5m rate. Per plan Required Decision #4:
    // when split is unavailable, 5m rate is the conservative-correct default.
    if (cacheCombined > 0 && cache5m === 0 && cache1h === 0) {
      cache5m = cacheCombined;
    }

    breakdown.input_uncached = roundUsd(tokensIn * pricing.input);
    breakdown.input_cache_read = roundUsd(cacheRead * pricing.input * pricing.cache_read_multiplier);
    breakdown.input_cache_write_5m = roundUsd(cache5m * pricing.input * pricing.cache_write_5m_multiplier);
    breakdown.input_cache_write_1h = roundUsd(cache1h * pricing.input * pricing.cache_write_1h_multiplier);
    breakdown.output_total = roundUsd(tokensOut * pricing.output);
    breakdown.tier_adjustment = 0; // Anthropic has no flex/priority tier today

    const cost = breakdown.input_uncached + breakdown.input_cache_read +
                 breakdown.input_cache_write_5m + breakdown.input_cache_write_1h +
                 breakdown.output_total;
    return {
      cost_usd: roundUsd(cost),
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_breakdown: breakdown,
    };
  }

  // ─── OpenAI / xAI (computed) path: prompt_tokens INCLUDES cached ───
  // Subtract cached from input before billing the uncached portion.
  // Apply service-tier multipliers (flex 0.5×, priority 2.0/1.5× asymmetric).
  if (tokens?.vendor === "openai" || tokens?.vendor === "xai") {
    const cacheRead = tokens?.cache_read_tokens || 0;
    const uncachedIn = Math.max(0, tokensIn - cacheRead);
    const tier = resolveTierMultipliers(pricing, tokens?.service_tier);

    const inputUncachedCost = uncachedIn * pricing.input * tier.input;
    const inputCacheReadCost = cacheRead * pricing.input * pricing.cache_read_multiplier * tier.input;
    const outputCost = tokensOut * pricing.output * tier.output;

    // Tier adjustment = (computed cost at active tier) − (cost at standard tier)
    // Negative for flex savings, positive for priority surcharge, 0 for standard.
    const standardCost = (uncachedIn * pricing.input) +
                         (cacheRead * pricing.input * pricing.cache_read_multiplier) +
                         (tokensOut * pricing.output);
    const activeCost = inputUncachedCost + inputCacheReadCost + outputCost;
    const tierAdjustment = activeCost - standardCost;

    breakdown.input_uncached = roundUsd(inputUncachedCost);
    breakdown.input_cache_read = roundUsd(inputCacheReadCost);
    breakdown.output_total = roundUsd(outputCost);
    breakdown.tier_adjustment = roundUsd(tierAdjustment);

    return {
      cost_usd: roundUsd(activeCost),
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_breakdown: breakdown,
    };
  }

  // ─── Unknown / legacy / azure-openai path: backward-compatible math ───
  // Vendor absent or unrecognized. Existing callers that construct
  // { tokens_in, tokens_out, model } see identical cost as before. New
  // optional fields are ignored on this path so cache + reasoning are not
  // applied without a positive vendor identification (avoids surprise costs).
  // Phase-FOUNDRY-PROVIDER Slice 5: when isFoundry, apply AOAI deployment-type
  // multiplier (data-zone / regional = 1.1×; global / provisioned = 1.0×).
  const baseCost = (tokensIn * pricing.input) + (tokensOut * pricing.output);
  let foundryMultiplier = 1.0;
  if (isFoundry && pricing.aoai_deployment_type_multiplier) {
    const deploymentType = process.env.AZURE_OPENAI_DEPLOYMENT_TYPE || "global";
    foundryMultiplier = pricing.aoai_deployment_type_multiplier[deploymentType] ?? 1.0;
  }
  const cost = baseCost * foundryMultiplier;
  breakdown.input_uncached = roundUsd(tokensIn * pricing.input * foundryMultiplier);
  breakdown.output_total = roundUsd(tokensOut * pricing.output * foundryMultiplier);
  if (isFoundry && foundryMultiplier !== 1.0) {
    breakdown.tier_adjustment = roundUsd(cost - baseCost);
  }
  return {
    cost_usd: roundUsd(cost),
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_breakdown: breakdown,
  };
}

/**
 * Build cost breakdown from all slice results.
 * Drop-in replacement for orchestrator.buildCostBreakdown.
 * @param {Array} sliceResults
 * @returns {{ total_cost_usd, by_model, by_slice }}
 */
export function priceRun(sliceResults) {
  const byModel = {};
  const bySlice = [];
  let totalCost = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const sr of sliceResults) {
    if (!sr.tokens || sr.status === "skipped") continue;
    const cost = priceSlice(sr.tokens, sr.worker);
    totalCost += cost.cost_usd;
    totalIn += cost.tokens_in;
    totalOut += cost.tokens_out;

    bySlice.push({
      slice: sr.number || sr.sliceId,
      ...cost,
    });

    if (!byModel[cost.model]) {
      byModel[cost.model] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, slices: 0 };
    }
    byModel[cost.model].tokens_in += cost.tokens_in;
    byModel[cost.model].tokens_out += cost.tokens_out;
    byModel[cost.model].cost_usd += cost.cost_usd;
    byModel[cost.model].slices += 1;
  }

  // Round model totals
  for (const m of Object.values(byModel)) {
    m.cost_usd = Math.round(m.cost_usd * 1_000_000) / 1_000_000;
  }

  return {
    total_cost_usd: Math.round(totalCost * 100) / 100,
    total_tokens_in: totalIn,
    total_tokens_out: totalOut,
    by_model: byModel,
    by_slice: bySlice,
  };
}

/**
 * Build a cost estimate for an entire plan.
 * Drop-in replacement for orchestrator.buildEstimate — same signature, same output shape.
 *
 * Historical calibration: reads .forge/cost-history.json when available; clamps
 * correction factor to [0.5, 3.0]. Quorum overhead computed when quorumConfig.enabled.
 * Per-plan model recommendation from .forge/model-performance.json.
 */
export function estimatePlan(plan, model, cwd, quorumConfig = null, resumeFrom = null, worker = null) {
  // Bug #81: When --resume-from is specified, exclude shipped slices from
  // the estimate. Mirror SequentialScheduler.execute() skip logic: walk the
  // topological execution order, start including once we hit resumeFrom.
  // If resumeFrom is null or doesn't match any slice, we fall through to the
  // full plan (existing behaviour).
  let effectiveSlices = plan.slices;
  let effectiveOrder = plan.dag.order;
  if (resumeFrom !== null && resumeFrom !== undefined) {
    const target = String(resumeFrom);
    const startIdx = plan.dag.order.findIndex((id) => id === target);
    if (startIdx >= 0) {
      effectiveOrder = plan.dag.order.slice(startIdx);
      const includeIds = new Set(effectiveOrder);
      effectiveSlices = plan.slices.filter((s) => includeIds.has(String(s.number)));
    }
  }

  // Phase-34 Slice 2: Provider-aware cost model detection
  let forgeConfig = {};
  try {
    const forgePath = cwd ? resolve(cwd, ".forge.json") : null;
    if (forgePath && existsSync(forgePath)) {
      forgeConfig = JSON.parse(readFileSync(forgePath, "utf-8"));
    }
  } catch { /* default to {} */ }
  const costModel = detectCostModel({ env: process.env, forgeConfig, model });
  const pricingMode = SUBSCRIPTION_PROVIDERS.has(costModel.provider) ? "subscription" : "token";

  // Phase 2 Slice 4: Use historical data if available
  const historyPath = cwd ? resolve(cwd, ".forge", "cost-history.json") : null;
  let avgTokensPerSlice = null;

  try {
    if (historyPath && existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, "utf-8"));
      if (Array.isArray(history) && history.length > 0) {
        const totalIn = history.reduce((s, e) => s + (e.total_tokens_in || 0), 0);
        const totalOut = history.reduce((s, e) => s + (e.total_tokens_out || 0), 0);
        const totalSlices = history.reduce((s, e) => s + (e.sliceCount || 1), 0);
        if (totalSlices > 0) {
          avgTokensPerSlice = {
            input: Math.round(totalIn / totalSlices),
            output: Math.round(totalOut / totalSlices),
            source: `${history.length} prior run(s)`,
          };
        }
      }
    }
  } catch {
    // Fall back to heuristic
  }

  // Subscription path: calibrate avg premium requests per slice from history
  let avgPremiumPerSlice = null;
  if (pricingMode === "subscription") {
    try {
      if (historyPath && existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, "utf-8"));
        if (Array.isArray(history) && history.length > 0) {
          const valid = history.filter(
            (e) => typeof e.total_premium_requests === "number" && (e.sliceCount || 1) > 0
          );
          if (valid.length > 0) {
            const sum = valid.reduce(
              (s, e) => s + e.total_premium_requests / (e.sliceCount || 1),
              0
            );
            avgPremiumPerSlice = Math.max(0.5, Math.min(5.0, sum / valid.length));
          }
        }
      }
    } catch { /* fall through to default 1.5 */ }
  }

  const tokensPerSlice = avgTokensPerSlice || { input: 2000, output: 5000, source: "heuristic" };
  const pricing = getPricing(model);
  const sliceCount = effectiveSlices.length;
  const totalInputTokens = sliceCount * tokensPerSlice.input;
  const totalOutputTokens = sliceCount * tokensPerSlice.output;

  // Phase GITHUB-B Slice 5: copilot-coding-agent dispatches GitHub Issues to the
  // cloud agent — no API token billing and no CLI premium requests. Cost is $0.
  // Wall-clock time is estimated as sliceCount × COPILOT_AGENT_MINUTES_PER_SLICE.
  if (worker === "copilot-coding-agent") {
    return {
      status: "estimate",
      sliceCount,
      executionOrder: effectiveOrder,
      ...(resumeFrom !== null && resumeFrom !== undefined && { resumeFrom: String(resumeFrom), fullSliceCount: plan.slices.length }),
      worker: "copilot-coding-agent",
      model: model || "copilot-coding-agent",
      tokens: {
        estimatedInput: totalInputTokens,
        estimatedOutput: totalOutputTokens,
        source: tokensPerSlice.source,
      },
      estimatedCostUSD: 0,
      estimated_cost_usd: 0,
      provider: "copilot-coding-agent",
      pricingMode: "subscription",
      wallClockEstimateMinutes: sliceCount * COPILOT_AGENT_MINUTES_PER_SLICE,
      confidence: "heuristic",
      slices: effectiveSlices.map((s) => ({
        number: s.number,
        title: s.title,
        depends: s.depends,
        parallel: s.parallel,
        scope: s.scope,
      })),
    };
  }

  let estimatedCost;
  if (pricingMode === "subscription") {
    const reqPerSlice = avgPremiumPerSlice !== null ? avgPremiumPerSlice : 1.5;
    estimatedCost = sliceCount * reqPerSlice * costModel.perRequestUsd;
  } else {
    estimatedCost = (totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output);
  }

  // Cost calibration: compare prior estimates vs actuals to compute correction factor.
  // Subscription providers are calibrated via avgPremiumPerSlice; skip token-based correction.
  let costCalibration = null;
  if (pricingMode === "token") {
    try {
      if (historyPath && existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, "utf-8"));
        const withEstimates = Array.isArray(history) ? history.filter(h => h.estimated_cost_usd > 0 && h.total_cost_usd > 0) : [];
        if (withEstimates.length >= 3) {
          const ratios = withEstimates.slice(-10).map(h => h.total_cost_usd / h.estimated_cost_usd);
          const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
          const correctionFactor = Math.max(0.5, Math.min(3.0, avgRatio)); // Clamp to 0.5x–3x
          estimatedCost *= correctionFactor;
          costCalibration = { correctionFactor: Math.round(correctionFactor * 100) / 100, samplesUsed: withEstimates.length, source: "historical" };
        }
      }
    } catch { /* fall through to uncalibrated estimate */ }
  }

  // Quorum overhead estimation (v2.5)
  let quorumOverhead = null;
  if (quorumConfig && quorumConfig.enabled) {
    const quorumSlices = quorumConfig.auto
      ? effectiveSlices.filter((s) => scoreSliceComplexity(s, cwd).score >= quorumConfig.threshold)
      : effectiveSlices;
    const modelCount = quorumConfig.models.length;
    // Each quorum slice: N dry-run prompt+response + 1 reviewer
    const dryRunInputPerLeg = tokensPerSlice.input * 1.5; // Dry-run prompt is larger
    const dryRunOutputPerLeg = tokensPerSlice.output * 0.8; // Plan output is shorter than code
    const reviewerInput = dryRunOutputPerLeg * modelCount + tokensPerSlice.input; // All outputs + original
    const reviewerOutput = tokensPerSlice.output * 0.6;

    // Phase-27.1 Slice 1: price each leg using that model's rate, not the
    // default model's rate. Without this, power and speed return identical
    // numbers because both multiply by the same default pricing.
    //
    // Phase-29 (v2.83.0): provider-aware per-leg pricing. The base estimate
    // already routes gpt-* / claude-* to gh-copilot / claude-cli when no API
    // key is set (issue #120 fix). The quorum overhead block had NOT been
    // updated, so it still priced every leg via raw API token rates — which
    // produced ~250× over-estimates for users on gh-copilot. Re-detect the
    // provider per leg and bill subscription legs as 1 premium request.
    const costForLeg = (legModel, inTokens, outTokens) => {
      const legCost = detectCostModel({ env: process.env, forgeConfig, model: legModel });
      if (SUBSCRIPTION_PROVIDERS.has(legCost.provider)) {
        // Subscription provider — flat per-request charge regardless of token volume.
        return legCost.perRequestUsd;
      }
      const mPricing = getPricing(legModel);
      return (inTokens * mPricing.input) + (outTokens * mPricing.output);
    };
    const dryRunCostPerSlice = quorumConfig.models.reduce(
      (sum, m) => sum + costForLeg(m, dryRunInputPerLeg, dryRunOutputPerLeg),
      0
    );
    const reviewerCostPerSlice = costForLeg(quorumConfig.reviewerModel, reviewerInput, reviewerOutput);

    quorumOverhead = {
      quorumSliceCount: quorumSlices.length,
      totalSliceCount: sliceCount,
      dryRunCostPerSlice: Math.round(dryRunCostPerSlice * 100) / 100,
      reviewerCostPerSlice: Math.round(reviewerCostPerSlice * 100) / 100,
      totalOverheadUSD: Math.round((dryRunCostPerSlice + reviewerCostPerSlice) * quorumSlices.length * 100) / 100,
      models: quorumConfig.models,
      reviewerModel: quorumConfig.reviewerModel,
      slices: quorumSlices.map((s) => ({
        number: s.number,
        title: s.title,
        complexityScore: scoreSliceComplexity(s, cwd).score,
      })),
    };
  }

  // Quorum viability assessment — runtime-aware validation (#73)
  let quorumViability = null;
  if (quorumConfig && quorumConfig.enabled) {
    const presetName = quorumConfig.preset || null;
    if (presetName && QUORUM_PRESETS[presetName]) {
      quorumViability = assessQuorumViability(presetName);
    }
  }

  // Phase 3: Recommend cheapest model with >80% success rate from performance history
  let modelRecommendation = null;
  if (cwd) {
    try {
      const perfRecords = loadModelPerformance(cwd);
      if (perfRecords.length > 0) {
        const stats = aggregateModelStats(perfRecords);
        // Minimum 3 slices of data before trusting a model's success rate
        const MIN_SAMPLE = 3;
        const qualified = Object.entries(stats)
          .filter(([m, s]) => !isApiOnlyModel(m) && s.total_slices >= MIN_SAMPLE && s.success_rate > 0.8)
          .map(([m, s]) => ({
            model: m,
            success_rate: s.success_rate,
            total_slices: s.total_slices,
            avg_cost_usd: s.avg_cost_usd,
          }))
          .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);

        if (qualified.length > 0) {
          const best = qualified[0];
          modelRecommendation = {
            model: best.model,
            reason: `Cheapest model with >${(0.8 * 100).toFixed(0)}% success rate`,
            success_rate: best.success_rate,
            avg_cost_usd_per_slice: best.avg_cost_usd,
            based_on_slices: best.total_slices,
            all_qualified: qualified,
          };
        }
      }
    } catch {
      // Non-fatal — skip recommendation if performance data unavailable
    }
  }

  // Slice auto-split advisory: flag slices that have timed out or exceeded task count thresholds
  let splitAdvisories = [];
  try {
    const perfRecords = loadModelPerformance(cwd);
    for (const s of effectiveSlices) {
      const priorFailures = perfRecords.filter(p =>
        p.sliceTitle && s.title && p.sliceTitle.toLowerCase() === s.title.toLowerCase() && p.status !== "passed"
      );
      const taskCount = s.tasks?.length || 0;
      const scopeCount = s.scope?.length || 0;
      if (priorFailures.length >= 2 || (taskCount > 6 && scopeCount > 4)) {
        splitAdvisories.push({
          sliceNumber: s.number,
          sliceTitle: s.title,
          reason: priorFailures.length >= 2
            ? `Failed ${priorFailures.length} time(s) historically — consider splitting`
            : `${taskCount} tasks + ${scopeCount} scope files — may be too large`,
          tasks: taskCount,
          scope: scopeCount,
          priorFailures: priorFailures.length,
        });
      }
    }
  } catch { /* best-effort */ }

  return {
    status: "estimate",
    sliceCount,
    executionOrder: effectiveOrder,
    ...(resumeFrom !== null && resumeFrom !== undefined && { resumeFrom: String(resumeFrom), fullSliceCount: plan.slices.length }),
    model: model || "auto",
    ...(modelRecommendation && { modelRecommendation }),
    ...(splitAdvisories.length > 0 && { splitAdvisories }),
    tokens: {
      estimatedInput: totalInputTokens,
      estimatedOutput: totalOutputTokens,
      source: tokensPerSlice.source,
    },
    estimatedCostUSD: Math.round(estimatedCost * 100) / 100,
    estimated_cost_usd: Math.round(estimatedCost * 100) / 100,
    provider: costModel.provider,
    pricingMode,
    ...(costCalibration && { costCalibration }),
    ...(quorumOverhead && {
      quorumOverhead,
      totalCostWithQuorumUSD: Math.round((estimatedCost + quorumOverhead.totalOverheadUSD) * 100) / 100,
    }),
    ...(quorumViability && { quorumViability }),
    confidence: avgTokensPerSlice ? "historical" : "heuristic",
    slices: effectiveSlices.map((s) => {
      const sliceType = inferSliceType(s);
      const rec = cwd ? recommendModel(cwd, sliceType) : null;
      return {
        number: s.number,
        title: s.title,
        depends: s.depends,
        parallel: s.parallel,
        scope: s.scope,
        sliceType,
        ...(rec && {
          recommendedModel: {
            model: rec.model,
            success_rate: rec.success_rate,
            based_on_slices: rec.total_slices,
          },
        }),
        ...(quorumConfig && quorumConfig.enabled && {
          complexityScore: scoreSliceComplexity(s, cwd).score,
          quorumEligible: quorumConfig.auto
            ? scoreSliceComplexity(s, cwd).score >= quorumConfig.threshold
            : true,
        }),
      };
    }),
  };
}

/**
 * Build a quorum configuration object for a given mode name.
 * Shared by estimateQuorum and estimateSlice so the two always agree
 * on which models, thresholds, and auto flags each mode implies.
 *
 * @param {"auto"|"power"|"speed"|"false"} mode
 * @returns {object|null} quorumConfig for estimatePlan, or null for mode "false".
 */
export function buildQuorumConfigForMode(mode) {
  if (mode === "false" || mode === false) return null;
  if (mode === "auto") {
    return {
      enabled: true,
      auto: true,
      // Phase-27.1 Slice 3: threshold lowered from 7 → 5 to match
      // QUORUM_PRESETS.power.threshold. `5` restores the "auto picks
      // what power would force" semantic.
      threshold: 5,
      models: QUORUM_PRESETS.speed?.models || ["claude-sonnet-4.6"],
      reviewerModel: QUORUM_PRESETS.speed?.reviewerModel || "claude-sonnet-4.6",
      preset: "speed",
    };
  }
  if (mode === "power") {
    return {
      enabled: true,
      auto: false,
      threshold: QUORUM_PRESETS.power?.threshold ?? 5,
      models: QUORUM_PRESETS.power?.models || [],
      reviewerModel: QUORUM_PRESETS.power?.reviewerModel || "claude-opus-4.7",
      preset: "power",
    };
  }
  if (mode === "speed") {
    return {
      enabled: true,
      auto: false,
      threshold: QUORUM_PRESETS.speed?.threshold ?? 7,
      models: QUORUM_PRESETS.speed?.models || [],
      reviewerModel: QUORUM_PRESETS.speed?.reviewerModel || "claude-sonnet-4.6",
      preset: "speed",
    };
  }
  throw new Error(`buildQuorumConfigForMode: unknown mode "${mode}" — expected auto | power | speed | false`);
}

/**
 * Project cost for a single slice under a given quorum mode.
 *
 * Per-slice projections are un-calibrated base × rate numbers. Run-level
 * historical calibration (correction factor from cost-history.json) is
 * applied only in `estimatePlan` / `estimateQuorum`. This is intentional:
 * a single slice does not provide enough context to re-derive the factor.
 *
 * @param {object} options
 * @param {object} options.plan - Parsed plan object with slices and dag
 * @param {string|number} options.sliceNumber - Slice identifier (may be alphanumeric, e.g. "2A")
 * @param {"auto"|"power"|"speed"|"false"} [options.mode="auto"] - Quorum mode
 * @param {string} [options.model="claude-sonnet-4.5"] - Base model for pricing
 * @param {string} [options.cwd] - Project root for history + complexity scoring
 * @returns {{
 *   estimatedCostUSD: number,
 *   baseCostUSD: number,
 *   overheadUSD: number,
 *   complexityScore: number,
 *   model: string,
 *   quorumEligible: boolean,
 *   rationale: string,
 *   generatedAt: string
 * }}
 */
export function estimateSlice({ plan, sliceNumber, mode = "auto", model = "claude-sonnet-4.5", cwd, env = process.env } = {}) {
  if (!plan || !plan.slices) {
    throw new Error("estimateSlice: plan object with slices is required");
  }
  const target = String(sliceNumber);
  const slice = plan.slices.find((s) => String(s.number) === target);
  if (!slice) {
    throw new Error(`estimateSlice: sliceNumber "${target}" not found in plan (available: ${plan.slices.map((s) => s.number).join(", ")})`);
  }

  // Validate mode before use
  const VALID_MODES = ["auto", "power", "speed", "false"];
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`estimateSlice: unknown mode "${mode}" — expected auto | power | speed | false`);
  }

  const resolvedCwd = cwd === null ? null : (cwd || process.cwd());

  // Historical avg tokens (same logic as estimatePlan, but no correction factor)
  const historyPath = resolvedCwd ? resolve(resolvedCwd, ".forge", "cost-history.json") : null;
  let avgTokensPerSlice = null;
  try {
    if (historyPath && existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, "utf-8"));
      if (Array.isArray(history) && history.length > 0) {
        const totalIn = history.reduce((s, e) => s + (e.total_tokens_in || 0), 0);
        const totalOut = history.reduce((s, e) => s + (e.total_tokens_out || 0), 0);
        const totalSlices = history.reduce((s, e) => s + (e.sliceCount || 1), 0);
        if (totalSlices > 0) {
          avgTokensPerSlice = { input: Math.round(totalIn / totalSlices), output: Math.round(totalOut / totalSlices) };
        }
      }
    }
  } catch { /* fall back to heuristic */ }
  const tokensPerSlice = avgTokensPerSlice || { input: 2000, output: 5000 };

  // Phase-29 (v2.83.0): provider-aware base + overhead. estimateSlice was
  // unconditionally using token-based MODEL_PRICING for both base and
  // quorum overhead, which over-estimated by ~250× for users on
  // subscription CLIs (gh-copilot, claude-cli). Mirror estimatePlan's
  // detection logic so the per-slice picker numbers agree with the
  // run-level estimate.
  let forgeConfig = {};
  try {
    const forgePath = resolvedCwd ? resolve(resolvedCwd, ".forge.json") : null;
    if (forgePath && existsSync(forgePath)) {
      forgeConfig = JSON.parse(readFileSync(forgePath, "utf-8"));
    }
  } catch { /* default to {} */ }
  const costForLeg = (legModel, inTokens, outTokens) => {
    const legCost = detectCostModel({ env, forgeConfig, model: legModel });
    if (SUBSCRIPTION_PROVIDERS.has(legCost.provider)) {
      return legCost.perRequestUsd;
    }
    const mPricing = getPricing(legModel);
    return (inTokens * mPricing.input) + (outTokens * mPricing.output);
  };

  // Base cost respects the active provider (subscription vs API)
  const baseCostUSD = costForLeg(model, tokensPerSlice.input, tokensPerSlice.output);

  // Complexity scoring
  const { score: complexityScore } = scoreSliceComplexity(slice, resolvedCwd);

  // Quorum config for the requested mode
  const quorumConfig = buildQuorumConfigForMode(mode);

  // Determine quorum eligibility
  let quorumEligible = false;
  let rationale;
  if (!quorumConfig) {
    rationale = "mode false: quorum disabled";
  } else if (quorumConfig.auto) {
    quorumEligible = complexityScore >= quorumConfig.threshold;
    rationale = quorumEligible
      ? `threshold ${quorumConfig.threshold} met: complexity ${complexityScore}`
      : `threshold ${quorumConfig.threshold} not met: complexity ${complexityScore}`;
  } else {
    // power / speed: force all slices into quorum
    quorumEligible = true;
    rationale = `mode ${mode}: all slices quorum-eligible`;
  }

  // Compute quorum overhead if eligible (same per-leg loop as estimatePlan)
  let overheadUSD = 0;
  if (quorumEligible && quorumConfig) {
    const dryRunInput = tokensPerSlice.input * 1.5;
    const dryRunOutput = tokensPerSlice.output * 0.8;
    const dryRunCost = quorumConfig.models.reduce(
      (sum, m) => sum + costForLeg(m, dryRunInput, dryRunOutput),
      0
    );
    const reviewerInput = dryRunOutput * quorumConfig.models.length + tokensPerSlice.input;
    const reviewerOutput = tokensPerSlice.output * 0.6;
    const reviewerCost = costForLeg(quorumConfig.reviewerModel, reviewerInput, reviewerOutput);
    overheadUSD = dryRunCost + reviewerCost;
  }

  const estimatedCostUSD = baseCostUSD + overheadUSD;

  return {
    estimatedCostUSD: Math.round(estimatedCostUSD * 1_000_000) / 1_000_000,
    baseCostUSD: Math.round(baseCostUSD * 1_000_000) / 1_000_000,
    overheadUSD: Math.round(overheadUSD * 1_000_000) / 1_000_000,
    complexityScore,
    model,
    quorumEligible,
    rationale,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build a cost estimate for all four quorum modes in a single call.
 * This is the canonical "show me the picker" entry point — agents must call
 * this tool instead of hand-computing quorum costs in chat.
 *
 * @param {object} options
 * @param {object} options.plan - Parsed plan object (same shape estimatePlan expects)
 * @param {string} [options.cwd] - Project root for history lookup
 * @param {string|number} [options.resumeFrom] - Optional resume point
 * @param {string} [options.defaultModel] - Base model when quorum disabled (default: "claude-sonnet-4.5")
 * @returns {{
 *   auto: object, power: object, speed: object, "false": object,
 *   recommended: "auto"|"power"|"speed"|"false",
 *   generatedAt: string
 * }}
 *   Each mode summary contains: mode, estimatedCostUSD, baseCostUSD,
 *   overheadUSD, quorumSliceCount, totalSliceCount, confidence, and
 *   slices[] — an additive per-slice breakdown with sliceNumber,
 *   projectedCostUSD, complexityScore, quorumEligible.
 */
export function estimateQuorum({ plan, cwd, resumeFrom = null, defaultModel = "claude-sonnet-4.5" } = {}) {
  if (!plan || !plan.slices || !plan.dag) {
    throw new Error("estimateQuorum: plan object with slices and dag is required");
  }

  // Meta-bug #97: distinguish `cwd === null` (caller opts out of history lookup —
  // fresh heuristic estimate) from `cwd === undefined` (fall back to process.cwd()).
  // Previously both collapsed to process.cwd(), which on a pforge checkout silently
  // pulled the plan-forge repo's own .forge/cost-history.json and produced
  // "historical" confidence + inflated cost (calibration factor × large-run token
  // averages) on caller-supplied heuristic plans.
  const resolvedCwd = cwd === null ? null : (cwd || process.cwd());

  const autoConfig = buildQuorumConfigForMode("auto");
  const powerConfig = buildQuorumConfigForMode("power");
  const speedConfig = buildQuorumConfigForMode("speed");

  const estAuto = estimatePlan(plan, defaultModel, resolvedCwd, autoConfig, resumeFrom);
  const estPower = estimatePlan(plan, defaultModel, resolvedCwd, powerConfig, resumeFrom);
  const estSpeed = estimatePlan(plan, defaultModel, resolvedCwd, speedConfig, resumeFrom);
  const estNone = estimatePlan(plan, defaultModel, resolvedCwd, null, resumeFrom);

  // Per-mode, per-slice breakdown (additive — does not alter existing keys).
  // Uses estimateSlice for parity with the single-slice MCP tool. Un-calibrated
  // (no run-level historical correction factor); summed values may differ from
  // the run-level estimate's calibrated totalCostWithQuorumUSD.
  const buildSliceBreakdown = (mode) =>
    plan.slices.map((s) => {
      const sliceEst = estimateSlice({ plan, sliceNumber: s.number, mode, model: defaultModel, cwd: resolvedCwd });
      return {
        sliceNumber: s.number,
        projectedCostUSD: sliceEst.estimatedCostUSD,
        complexityScore: sliceEst.complexityScore,
        quorumEligible: sliceEst.quorumEligible,
      };
    });

  const toSummary = (est, mode) => ({
    mode,
    estimatedCostUSD: est.totalCostWithQuorumUSD ?? est.estimatedCostUSD,
    baseCostUSD: est.estimatedCostUSD,
    overheadUSD: est.quorumOverhead?.totalOverheadUSD ?? 0,
    quorumSliceCount: est.quorumOverhead?.quorumSliceCount ?? 0,
    totalSliceCount: est.sliceCount,
    confidence: est.confidence,
    slices: buildSliceBreakdown(mode),
  });

  const summaries = {
    auto: toSummary(estAuto, "auto"),
    power: toSummary(estPower, "power"),
    speed: toSummary(estSpeed, "speed"),
    "false": toSummary(estNone, "false"),
  };

  // Recommendation: cheapest mode under optional runtime.cost.budget, else auto.
  let budgetCap = null;
  if (cwd) {
    try {
      const cfgPath = resolve(cwd, ".forge.json");
      if (existsSync(cfgPath)) {
        const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
        if (cfg?.runtime?.cost?.budget && Number.isFinite(cfg.runtime.cost.budget)) {
          budgetCap = cfg.runtime.cost.budget;
        }
      }
    } catch { /* budget cap optional */ }
  }

  let recommended = "auto";
  if (budgetCap !== null) {
    const affordable = Object.entries(summaries)
      .filter(([, s]) => s.estimatedCostUSD <= budgetCap)
      .sort((a, b) => a[1].estimatedCostUSD - b[1].estimatedCostUSD);
    if (affordable.length > 0) recommended = affordable[0][0];
  }

  return {
    ...summaries,
    recommended,
    ...(budgetCap !== null && { budgetCapUSD: budgetCap }),
    generatedAt: new Date().toISOString(),
  };
}
