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
} from "./orchestrator/model-scoring.mjs";
import { COST_SOURCES } from "./enums.mjs";
import { quotaCacheGet, compareSliceEstimate } from "./foundry-quota.mjs";

const VALID_COST_SOURCE_LABELS = new Set(COST_SOURCES);

function warnOnUnknownCostSourceLabel(source, context) {
  if (typeof source !== "string" || source.length === 0) return;
  if (!VALID_COST_SOURCE_LABELS.has(source)) {
    console.warn(`[cost-service] Unknown cost source '${source}' at ${context}; expected one of ${COST_SOURCES.join(", ")}. Keeping record for backward compatibility.`);
  }
}

// ─── Foundry Quota Preflight Helper ──────────────────────────────────
// When PFORGE_FOUNDRY_QUOTA_PREFLIGHT=1 and provider is microsoft-foundry,
// attach a compareSliceEstimate result to estimation return shapes.
// Uses cache-only lookup (synchronous) — the orchestrator pre-fetches at
// slice-start via getDeploymentQuota (Slice 3). Returns null when the env
// var is unset, provider is not foundry, or env vars are missing.
function _computeFoundryQuota({ estimatedTokensIn, estimatedTokensOut, provider, env = process.env, cwd = null }) {
  if (env.PFORGE_FOUNDRY_QUOTA_PREFLIGHT !== "1") return null;
  if (provider !== "microsoft-foundry") return null;

  const subscriptionId = env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup  = env.AZURE_RESOURCE_GROUP;
  const accountName    = env.AZURE_OPENAI_ACCOUNT_NAME || env.AZURE_OPENAI_RESOURCE_NAME || "";
  const deploymentName = env.AZURE_OPENAI_DEPLOYMENT || "default";

  if (!subscriptionId || !resourceGroup) {
    return compareSliceEstimate(
      { ok: false, reason: "missing AZURE_SUBSCRIPTION_ID or AZURE_RESOURCE_GROUP" },
      { tokens_in: estimatedTokensIn, tokens_out: estimatedTokensOut }
    );
  }

  const cacheKey = `${subscriptionId}/${resourceGroup}/${accountName}/${deploymentName}`;
  const cachedQuota = quotaCacheGet(cacheKey);

  return compareSliceEstimate(
    cachedQuota ?? { ok: false, reason: "quota not prefetched; orchestrator will fetch at slice-start" },
    { tokens_in: estimatedTokensIn, tokens_out: estimatedTokensOut }
  );
}

// ─── Pricing Table ────────────────────────────────────────────────────
/**
 * Per-token costs in USD.
 *
 * Entry shape:
 *   {
 *     input: number,
 *     output: number,
 *     cache_read_multiplier?: number,
 *     cache_write_5m_multiplier?: number,
 *     cache_write_1h_multiplier?: number,
 *     flex_input_multiplier?: number,
 *     flex_output_multiplier?: number,
 *     priority_input_multiplier?: number,
 *     priority_output_multiplier?: number,
 *     _retiredAfter?: string,
 *     _source?: string,
 *   }
 *
 * Rates are stored per 1 token. getPricing() spreads default multiplier values
 * so callers never receive an undefined multiplier.
 *
 * IMPORTANT — Vendor convention asymmetry:
 *   - Anthropic input_tokens EXCLUDES cache_read_input_tokens + cache_creation_*
 *     (bill all three independently per priceSlice() math).
 *   - OpenAI / xAI prompt_tokens INCLUDES cached_tokens
 *     (subtract cached_tokens before billing the uncached portion).
 * See Phase-COST-TOKEN-COVERAGE-PLAN.md Forbidden Actions #4 and #5.
 *
 * _retiredAfter marks xAI's May 15, 2026 model retirements and is informational
 * only; entries are retained for historical cost-history.json compatibility.
 */
export const MODEL_PRICING = {
  // ─── Anthropic Claude ──────────────────────────────────────────────
  // Cache: read 0.10×, 5m write 1.25×, 1h write 2.0× (uniform across all tiers).
  // Opus 4.5/4.6/4.7 dropped to $5/$25 per Anthropic pricing page (2026-05-06).
  // Source: https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching
  "claude-opus-4.7":        { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://www.anthropic.com/pricing (2026-05-06)" },
  "claude-opus-4.7-1m-internal": { input: 5 / 1_000_000, output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://www.anthropic.com/pricing (2026-05-06)" },
  "claude-opus-4.7-high":   { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://www.anthropic.com/pricing (2026-05-06)" },
  "claude-opus-4.7-xhigh":  { input: 5 / 1_000_000,    output: 25 / 1_000_000,
    cache_read_multiplier: 0.10, cache_write_5m_multiplier: 1.25, cache_write_1h_multiplier: 2.0,
    _source: "https://www.anthropic.com/pricing (2026-05-06)" },
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
  // Cache: 0.50× read for o1 / o1-mini, 0.25× for o3 / o3-mini, and 0.275× for o4-mini.
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
    cache_read_multiplier: 0.25,
    aoai_deployment_type_multiplier: { global: 1.0, "data-zone": 1.1, regional: 1.1, provisioned: 1.0 },
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },
  "o4-mini":                { input: 1.10 / 1_000_000, output: 4.40 / 1_000_000,
    cache_read_multiplier: 0.275,
    _source: "https://developers.openai.com/api/docs/pricing (2026-05-06)" },

  // ─── Google Gemini ────────────────────────────────────────────────
  "gemini-3-pro-preview":   { input: 1.25 / 1_000_000, output: 5 / 1_000_000,
    _source: "https://ai.google.dev/gemini-api/docs/pricing (2026-05-06)" },

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
    _source: "https://docs.x.ai/developers/advanced-api-usage/prompt-caching (2026-05-06)" },
  "grok-4-fast-reasoning":             { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000,
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-4-fast-non-reasoning":         { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000,
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-code-fast-1":                  { input: 0.20 / 1_000_000, output: 1.50 / 1_000_000,
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
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
    cache_read_multiplier: 0.25, _retiredAfter: "2026-05-15",
    _source: "https://docs.x.ai/developers/migration/may-15-retirement (2026-05-06)" },
  "grok-3-mini":                       { input: 0.30 / 1_000_000, output: 0.50 / 1_000_000,
    cache_read_multiplier: 0.25,
    _source: "https://docs.x.ai/developers/advanced-api-usage/prompt-caching (2026-05-06)" },

  // ─── Fallback ─────────────────────────────────────────────────────
  // Conservative default: kept at $3/$15 (Sonnet-class) so unknown models
  // don't dramatically under-estimate cost. No cache multipliers applied
  // (defaults to 1.0 — no benefit assumed for unrecognised models).
  default:                  { input: 3 / 1_000_000,    output: 15 / 1_000_000,
    _source: "https://www.anthropic.com/pricing (2026-05-06)" },
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
function _detectProviderFromModelPrefix(m, env) {
  if (m.startsWith("gpt-") || m.startsWith("chatgpt-")) {
    return {
      provider: Boolean(env.OPENAI_API_KEY) ? "openai-api" : "gh-copilot",
      source: "model-prefix",
    };
  }
  if (m.startsWith("grok-")) {
    return { provider: "xai-api", source: "model-prefix" };
  }
  if (m.startsWith("claude-")) {
    return {
      provider: Boolean(env.ANTHROPIC_API_KEY) ? "anthropic-api" : "claude-cli",
      source: "model-prefix",
    };
  }
  if (m === "gh-copilot" || m.includes("copilot")) {
    return { provider: "gh-copilot", source: "model-prefix" };
  }
  if (m === "codex-cli" || m.startsWith("codex-")) {
    return { provider: "codex-cli", source: "model-prefix" };
  }
  return null;
}

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
  const prefixResult = _detectProviderFromModelPrefix(m, env);
  if (prefixResult) {
    return toResult(prefixResult.provider, prefixResult.source);
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

function debugCostLog(message) {
  if (process.env.PFORGE_LOG_LEVEL === "debug") {
    console.error(`[cost-service] ${message}`);
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
function _priceSliceSubscription(tokens, model, tokensIn, tokensOut, breakdown) {
  const premiumRequests = tokens?.premiumRequests || 0;
  const cost = premiumRequests * CLI_PER_REQUEST_USD;
  breakdown.subscription_cost = roundUsd(cost);
  return {
    cost_usd: roundUsd(cost),
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_breakdown: breakdown,
  };
}

function _priceSliceXaiTicks(tokens, model, tokensIn, tokensOut, breakdown) {
  const costFromTicks = tokens.cost_in_usd_ticks * 1e-10;
  const reasoning = tokens?.reasoning_tokens || 0;
  breakdown.input_uncached = roundUsd(costFromTicks);
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

function _priceSliceAnthropic(tokens, model, tokensIn, tokensOut, pricing, breakdown) {
  const cacheRead = tokens?.cache_read_tokens || 0;
  let cache5m = tokens?.cache_creation_5m_tokens || 0;
  let cache1h = tokens?.cache_creation_1h_tokens || 0;
  const cacheCombined = tokens?.cache_creation_input_tokens || 0;

  if (cacheCombined > 0 && cache5m === 0 && cache1h === 0) {
    cache5m = cacheCombined;
    debugCostLog(`Anthropic cache_creation_input_tokens lacked 5m/1h split for ${model}; defaulted ${cacheCombined} tokens to 5m pricing.`);
  }

  breakdown.input_uncached = roundUsd(tokensIn * pricing.input);
  breakdown.input_cache_read = roundUsd(cacheRead * pricing.input * pricing.cache_read_multiplier);
  breakdown.input_cache_write_5m = roundUsd(cache5m * pricing.input * pricing.cache_write_5m_multiplier);
  breakdown.input_cache_write_1h = roundUsd(cache1h * pricing.input * pricing.cache_write_1h_multiplier);
  breakdown.output_total = roundUsd(tokensOut * pricing.output);
  breakdown.tier_adjustment = 0;

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

function _priceSliceOpenAiXai(tokens, model, tokensIn, tokensOut, pricing, breakdown) {
  const cacheRead = tokens?.cache_read_tokens || 0;
  const uncachedIn = Math.max(0, tokensIn - cacheRead);
  const tier = resolveTierMultipliers(pricing, tokens?.service_tier);
  const inputUncachedCost = uncachedIn * pricing.input * tier.input;
  const inputCacheReadCost = cacheRead * pricing.input * pricing.cache_read_multiplier * tier.input;
  const outputCost = tokensOut * pricing.output * tier.output;
  const standardCost = (uncachedIn * pricing.input) +
                       (cacheRead * pricing.input * pricing.cache_read_multiplier) +
                       (tokensOut * pricing.output);
  const activeCost = inputUncachedCost + inputCacheReadCost + outputCost;
  breakdown.input_uncached = roundUsd(inputUncachedCost);
  breakdown.input_cache_read = roundUsd(inputCacheReadCost);
  breakdown.output_total = roundUsd(outputCost);
  breakdown.tier_adjustment = roundUsd(activeCost - standardCost);
  return {
    cost_usd: roundUsd(activeCost),
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_breakdown: breakdown,
  };
}

function _priceSliceDefault(tokensIn, tokensOut, model, pricing, breakdown, isFoundry) {
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

function _priceSliceIsFoundry(tokens, worker) {
  return tokens?.provider === "microsoft-foundry" || worker === "api-microsoft-foundry";
}

function _priceSliceNumber(value) {
  return typeof value === "number" ? value : 0;
}

function _priceSliceContext(tokens, worker) {
  const rawModel = tokens?.model || "unknown";
  const isFoundry = _priceSliceIsFoundry(tokens, worker);
  return {
    model: isFoundry ? resolveFoundryModel(tokens?.deployment || rawModel) : rawModel,
    tokensIn: _priceSliceNumber(tokens?.tokens_in),
    tokensOut: _priceSliceNumber(tokens?.tokens_out),
    breakdown: emptyBreakdown(),
    isFoundry,
  };
}

function _priceSliceUsesSubscriptionPricing(worker) {
  return Boolean(worker) && !worker.startsWith("api-");
}

function _priceSliceUsesXaiTicks(tokens) {
  return tokens?.vendor === "xai" && typeof tokens?.cost_in_usd_ticks === "number";
}

function _priceSliceUsesComputedVendorPricing(tokens) {
  return tokens?.vendor === "openai" || tokens?.vendor === "xai";
}

export function priceSlice(tokens, worker) {
  const { model, tokensIn, tokensOut, breakdown, isFoundry } = _priceSliceContext(tokens, worker);

  if (_priceSliceUsesSubscriptionPricing(worker)) {
    return _priceSliceSubscription(tokens, model, tokensIn, tokensOut, breakdown);
  }
  if (_priceSliceUsesXaiTicks(tokens)) {
    return _priceSliceXaiTicks(tokens, model, tokensIn, tokensOut, breakdown);
  }

  const pricing = getPricing(model);
  breakdown.reasoning_tokens = tokens?.reasoning_tokens || 0;

  if (tokens?.vendor === "anthropic") {
    return _priceSliceAnthropic(tokens, model, tokensIn, tokensOut, pricing, breakdown);
  }
  if (_priceSliceUsesComputedVendorPricing(tokens)) {
    return _priceSliceOpenAiXai(tokens, model, tokensIn, tokensOut, pricing, breakdown);
  }

  return _priceSliceDefault(tokensIn, tokensOut, model, pricing, breakdown, isFoundry);
}

/**
 * Build cost breakdown from all slice results.
 * Drop-in replacement for orchestrator.buildCostBreakdown.
 * @param {Array} sliceResults
 * @returns {{ total_cost_usd, by_model, by_slice }}
 */
function _apportionReviewerCostToModels(byModel, reviewerModels, reviewerCost, reviewerTokensIn, reviewerTokensOut) {
  if (reviewerModels.length === 0) return;
  if (reviewerCost <= 0 && reviewerTokensIn <= 0 && reviewerTokensOut <= 0) return;

  const share = 1 / reviewerModels.length;
  for (const rm of reviewerModels) {
    if (!byModel[rm]) {
      byModel[rm] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, slices: 0, role: "reviewer" };
    } else if (!byModel[rm].role) {
      byModel[rm].role = byModel[rm].cost_usd > 0 ? "mixed" : "reviewer";
    }
    byModel[rm].tokens_in += reviewerTokensIn * share;
    byModel[rm].tokens_out += reviewerTokensOut * share;
    byModel[rm].cost_usd += reviewerCost * share;
    byModel[rm].slices += 1;
  }
}

function _priceRunContextLabel(sliceResult) {
  return `slice ${sliceResult?.number || sliceResult?.sliceId || "?"}`;
}

function _priceRunReviewerTelemetry(sliceResult) {
  return {
    reviewerCost: Number(sliceResult.quorum?.reviewerCost) || 0,
    reviewerModels: Array.isArray(sliceResult.quorum?.models) ? sliceResult.quorum.models : [],
    reviewerTokensIn: Number(sliceResult.quorum?.dryRunTokens?.tokens_in) || 0,
    reviewerTokensOut: Number(sliceResult.quorum?.dryRunTokens?.tokens_out) || 0,
  };
}

function _priceRunAccumulateModel(byModel, cost) {
  if (!byModel[cost.model]) {
    byModel[cost.model] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, slices: 0 };
  }
  byModel[cost.model].tokens_in += cost.tokens_in;
  byModel[cost.model].tokens_out += cost.tokens_out;
  byModel[cost.model].cost_usd += cost.cost_usd;
  byModel[cost.model].slices += 1;
}

export function priceRun(sliceResults) {
  const byModel = {};
  const bySlice = [];
  let totalCost = 0;
  let totalReviewerCost = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const sr of sliceResults) {
    warnOnUnknownCostSourceLabel(sr?.source ?? null, _priceRunContextLabel(sr));
    if (!sr.tokens || sr.status === "skipped") continue;

    const cost = priceSlice(sr.tokens, sr.worker);
    const { reviewerCost, reviewerModels, reviewerTokensIn, reviewerTokensOut } = _priceRunReviewerTelemetry(sr);
    totalCost += cost.cost_usd;
    totalReviewerCost += reviewerCost;
    totalIn += cost.tokens_in + reviewerTokensIn;
    totalOut += cost.tokens_out + reviewerTokensOut;

    bySlice.push({
      slice: sr.number || sr.sliceId,
      ...cost,
      reviewer_cost_usd: Math.round(reviewerCost * 1_000_000) / 1_000_000,
      reviewer_models: reviewerModels,
    });

    _priceRunAccumulateModel(byModel, cost);
    _apportionReviewerCostToModels(byModel, reviewerModels, reviewerCost, reviewerTokensIn, reviewerTokensOut);
  }

  for (const m of Object.values(byModel)) {
    m.cost_usd = Math.round(m.cost_usd * 1_000_000) / 1_000_000;
    m.tokens_in = Math.round(m.tokens_in);
    m.tokens_out = Math.round(m.tokens_out);
  }

  return {
    total_cost_usd: Math.round((totalCost + totalReviewerCost) * 100) / 100,
    total_executor_cost_usd: Math.round(totalCost * 100) / 100,
    total_reviewer_cost_usd: Math.round(totalReviewerCost * 100) / 100,
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
function _readJsonIfExists(path, fallback = null) {
  try {
    if (path && existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function _loadForgeConfig(cwd) {
  const forgeConfig = _readJsonIfExists(cwd ? resolve(cwd, ".forge.json") : null, {});
  return forgeConfig && typeof forgeConfig === "object" ? forgeConfig : {};
}

function _loadCostHistory(cwd) {
  const history = _readJsonIfExists(cwd ? resolve(cwd, ".forge", "cost-history.json") : null, []);
  return Array.isArray(history) ? history : [];
}

function _computeAverageTokensPerSlice(history, source = null) {
  if (!Array.isArray(history) || history.length === 0) return null;

  const totalIn = history.reduce((sum, entry) => sum + (entry.total_tokens_in || 0), 0);
  const totalOut = history.reduce((sum, entry) => sum + (entry.total_tokens_out || 0), 0);
  const totalSlices = history.reduce((sum, entry) => sum + (entry.sliceCount || 1), 0);
  if (totalSlices <= 0) return null;

  return {
    input: Math.round(totalIn / totalSlices),
    output: Math.round(totalOut / totalSlices),
    ...(source && { source }),
  };
}

function _computeAveragePremiumPerSlice(history) {
  if (!Array.isArray(history) || history.length === 0) return null;

  const valid = history.filter(
    (entry) => typeof entry.total_premium_requests === "number" && (entry.sliceCount || 1) > 0
  );
  if (valid.length === 0) return null;

  const sum = valid.reduce(
    (total, entry) => total + entry.total_premium_requests / (entry.sliceCount || 1),
    0
  );
  return Math.max(0.5, Math.min(5.0, sum / valid.length));
}

function _resolveEffectiveSlices(plan, resumeFrom) {
  let effectiveSlices = plan.slices;
  let effectiveOrder = plan.dag.order;
  if (resumeFrom !== null && resumeFrom !== undefined) {
    const target = String(resumeFrom);
    const startIdx = plan.dag.order.findIndex((id) => id === target);
    if (startIdx >= 0) {
      effectiveOrder = plan.dag.order.slice(startIdx);
      const includeIds = new Set(effectiveOrder);
      effectiveSlices = plan.slices.filter((slice) => includeIds.has(String(slice.number)));
    }
  }
  return { effectiveSlices, effectiveOrder };
}

function _calibrateCorrectionFactor(modelKey, cwd) {
  const history = _loadCostHistory(cwd);
  const withEstimates = history.filter((entry) => entry.estimated_cost_usd > 0 && entry.total_cost_usd > 0);
  if (withEstimates.length < 3) return null;

  const ratios = withEstimates.slice(-10).map((entry) => entry.total_cost_usd / entry.estimated_cost_usd);
  const avgRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  const correctionFactor = Math.max(0.5, Math.min(3.0, avgRatio));
  return {
    correctionFactor,
    samplesUsed: withEstimates.length,
    source: "historical",
    model: modelKey,
  };
}

function _computeQuorumOverhead(quorumConfig, _modelKey, sliceEstimates) {
  if (!(quorumConfig && quorumConfig.enabled)) return null;

  const { effectiveSlices, sliceCount, tokensPerSlice, cwd, costForLeg } = sliceEstimates;
  const quorumSlices = quorumConfig.auto
    ? effectiveSlices.filter((slice) => scoreSliceComplexity(slice, cwd).score >= quorumConfig.threshold)
    : effectiveSlices;
  const modelCount = quorumConfig.models.length;
  const dryRunInputPerLeg = tokensPerSlice.input * 1.5;
  const dryRunOutputPerLeg = tokensPerSlice.output * 0.8;
  const reviewerInput = dryRunOutputPerLeg * modelCount + tokensPerSlice.input;
  const reviewerOutput = tokensPerSlice.output * 0.6;
  const dryRunCostPerSlice = quorumConfig.models.reduce(
    (sum, legModel) => sum + costForLeg(legModel, dryRunInputPerLeg, dryRunOutputPerLeg),
    0
  );
  const reviewerCostPerSlice = costForLeg(quorumConfig.reviewerModel, reviewerInput, reviewerOutput);

  return {
    quorumSliceCount: quorumSlices.length,
    totalSliceCount: sliceCount,
    dryRunCostPerSlice: Math.round(dryRunCostPerSlice * 100) / 100,
    reviewerCostPerSlice: Math.round(reviewerCostPerSlice * 100) / 100,
    totalOverheadUSD: Math.round((dryRunCostPerSlice + reviewerCostPerSlice) * quorumSlices.length * 100) / 100,
    models: quorumConfig.models,
    reviewerModel: quorumConfig.reviewerModel,
    slices: quorumSlices.map((slice) => ({
      number: slice.number,
      title: slice.title,
      complexityScore: scoreSliceComplexity(slice, cwd).score,
    })),
  };
}

function _loadModelRecommendation(modelKey, cwd) {
  if (!cwd) return null;

  try {
    const perfRecords = loadModelPerformance(cwd);
    if (perfRecords.length === 0) return null;

    const stats = aggregateModelStats(perfRecords);
    const MIN_SAMPLE = 3;
    const qualified = Object.entries(stats)
      .filter(([candidate, stat]) => !isApiOnlyModel(candidate) && stat.total_slices >= MIN_SAMPLE && stat.success_rate > 0.8)
      .map(([candidate, stat]) => ({
        model: candidate,
        success_rate: stat.success_rate,
        total_slices: stat.total_slices,
        avg_cost_usd: stat.avg_cost_usd,
      }))
      .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);
    if (qualified.length === 0) return null;

    const best = qualified[0];
    return {
      model: best.model,
      reason: `Cheapest model with >${(0.8 * 100).toFixed(0)}% success rate`,
      success_rate: best.success_rate,
      avg_cost_usd_per_slice: best.avg_cost_usd,
      based_on_slices: best.total_slices,
      all_qualified: qualified,
    };
  } catch {
    return null;
  }
}

function _loadSplitAdvisories(effectiveSlices, cwd) {
  try {
    const perfRecords = loadModelPerformance(cwd);
    return effectiveSlices.reduce((items, slice) => {
      const priorFailures = perfRecords.filter((record) =>
        record.sliceTitle && slice.title && record.sliceTitle.toLowerCase() === slice.title.toLowerCase() && record.status !== "passed"
      );
      const taskCount = slice.tasks?.length || 0;
      const scopeCount = slice.scope?.length || 0;
      if (priorFailures.length >= 2 || (taskCount > 6 && scopeCount > 4)) {
        items.push({
          sliceNumber: slice.number,
          sliceTitle: slice.title,
          reason: priorFailures.length >= 2
            ? `Failed ${priorFailures.length} time(s) historically — consider splitting`
            : `${taskCount} tasks + ${scopeCount} scope files — may be too large`,
          tasks: taskCount,
          scope: scopeCount,
          priorFailures: priorFailures.length,
        });
      }
      return items;
    }, []);
  } catch {
    return [];
  }
}

function _estimatePlanResumeFields(plan, resumeFrom) {
  return resumeFrom !== null && resumeFrom !== undefined
    ? { resumeFrom: String(resumeFrom), fullSliceCount: plan.slices.length }
    : {};
}

function _buildCopilotCodingAgentEstimate(plan, effectiveSlices, effectiveOrder, resumeFrom, model, tokensPerSlice) {
  const sliceCount = effectiveSlices.length;
  const totalInputTokens = sliceCount * tokensPerSlice.input;
  const totalOutputTokens = sliceCount * tokensPerSlice.output;
  return {
    status: "estimate",
    sliceCount,
    executionOrder: effectiveOrder,
    ..._estimatePlanResumeFields(plan, resumeFrom),
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
    slices: effectiveSlices.map((slice) => ({
      number: slice.number,
      title: slice.title,
      depends: slice.depends,
      parallel: slice.parallel,
      scope: slice.scope,
    })),
  };
}

function _buildEstimatePlanSlices(effectiveSlices, cwd, quorumConfig) {
  return effectiveSlices.map((slice) => {
    const sliceType = inferSliceType(slice);
    const recommendation = cwd ? recommendModel(cwd, sliceType) : null;
    const complexityScore = quorumConfig && quorumConfig.enabled
      ? scoreSliceComplexity(slice, cwd).score
      : null;
    return {
      number: slice.number,
      title: slice.title,
      depends: slice.depends,
      parallel: slice.parallel,
      scope: slice.scope,
      sliceType,
      ...(recommendation && {
        recommendedModel: {
          model: recommendation.model,
          success_rate: recommendation.success_rate,
          based_on_slices: recommendation.total_slices,
        },
      }),
      ...(quorumConfig && quorumConfig.enabled && {
        complexityScore,
        quorumEligible: quorumConfig.auto
          ? complexityScore >= quorumConfig.threshold
          : true,
      }),
    };
  });
}

function _estimatePlanHistoryContext(cwd, pricingMode) {
  const history = _loadCostHistory(cwd);
  return {
    avgTokensPerSlice: _computeAverageTokensPerSlice(
      history,
      history.length > 0 ? `${history.length} prior run(s)` : null
    ),
    avgPremiumPerSlice: pricingMode === "subscription"
      ? _computeAveragePremiumPerSlice(history)
      : null,
  };
}

function _estimatePlanBaseCost(pricingMode, sliceCount, avgPremiumPerSlice, costModel, totalInputTokens, totalOutputTokens, pricing) {
  if (pricingMode === "subscription") {
    const reqPerSlice = avgPremiumPerSlice !== null ? avgPremiumPerSlice : 1.5;
    return sliceCount * reqPerSlice * costModel.perRequestUsd;
  }
  return (totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output);
}

function _estimatePlanCostCalibration(pricingMode, model, cwd) {
  if (pricingMode !== "token") return null;

  const correction = _calibrateCorrectionFactor(model, cwd);
  if (!correction) return null;

  return {
    appliedFactor: correction.correctionFactor,
    output: {
      correctionFactor: Math.round(correction.correctionFactor * 100) / 100,
      samplesUsed: correction.samplesUsed,
      source: correction.source,
    },
  };
}

function _estimatePlanQuorumViability(quorumConfig) {
  if (!(quorumConfig && quorumConfig.enabled)) return null;

  const presetName = quorumConfig.preset || null;
  if (!(presetName && QUORUM_PRESETS[presetName])) return null;
  return assessQuorumViability(presetName);
}

function _estimatePlanFoundryQuota(totalInputTokens, totalOutputTokens, provider, cwd) {
  return _computeFoundryQuota({
    estimatedTokensIn: totalInputTokens,
    estimatedTokensOut: totalOutputTokens,
    provider,
    cwd,
  });
}

function _buildEstimatePlanResult({
  plan,
  resumeFrom,
  model,
  costModel,
  pricingMode,
  avgTokensPerSlice,
  splitAdvisories,
  modelRecommendation,
  estimatedCost,
  totalInputTokens,
  totalOutputTokens,
  tokensPerSlice,
  effectiveOrder,
  effectiveSlices,
  sliceCount,
  quorumOverhead,
  quorumViability,
  costCalibration,
  cwd,
  quorumConfig,
}) {
  const foundryQuota = _estimatePlanFoundryQuota(totalInputTokens, totalOutputTokens, costModel.provider, cwd);
  return {
    status: "estimate",
    sliceCount,
    executionOrder: effectiveOrder,
    ..._estimatePlanResumeFields(plan, resumeFrom),
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
    ...(foundryQuota && { foundryQuota }),
    slices: _buildEstimatePlanSlices(effectiveSlices, cwd, quorumConfig),
  };
}

export function estimatePlan(plan, model, cwd, quorumConfig = null, resumeFrom = null, worker = null) {
  const { effectiveSlices, effectiveOrder } = _resolveEffectiveSlices(plan, resumeFrom);
  const forgeConfig = _loadForgeConfig(cwd);
  const costModel = detectCostModel({ env: process.env, forgeConfig, model });
  const pricingMode = SUBSCRIPTION_PROVIDERS.has(costModel.provider) ? "subscription" : "token";
  const { avgTokensPerSlice, avgPremiumPerSlice } = _estimatePlanHistoryContext(cwd, pricingMode);
  const tokensPerSlice = avgTokensPerSlice || { input: 2000, output: 5000, source: "heuristic" };
  const pricing = getPricing(model);
  const sliceCount = effectiveSlices.length;
  const totalInputTokens = sliceCount * tokensPerSlice.input;
  const totalOutputTokens = sliceCount * tokensPerSlice.output;

  if (worker === "copilot-coding-agent") {
    return _buildCopilotCodingAgentEstimate(plan, effectiveSlices, effectiveOrder, resumeFrom, model, tokensPerSlice);
  }

  let estimatedCost = _estimatePlanBaseCost(
    pricingMode,
    sliceCount,
    avgPremiumPerSlice,
    { costModel, totalInputTokens, totalOutputTokens, pricing },
  );
  const calibration = _estimatePlanCostCalibration(pricingMode, model, cwd);
  const costCalibration = calibration?.output || null;
  if (calibration) {
    estimatedCost *= calibration.appliedFactor;
  }

  const costForLeg = (legModel, inTokens, outTokens) => {
    const legCost = detectCostModel({ env: process.env, forgeConfig, model: legModel });
    if (SUBSCRIPTION_PROVIDERS.has(legCost.provider)) {
      // Subscription provider — flat per-request charge regardless of token volume.
      return legCost.perRequestUsd;
    }
    const mPricing = getPricing(legModel);
    return (inTokens * mPricing.input) + (outTokens * mPricing.output);
  };

  return _buildEstimatePlanResult({
    plan,
    resumeFrom,
    model,
    costModel,
    pricingMode,
    avgTokensPerSlice,
    splitAdvisories: _loadSplitAdvisories(effectiveSlices, cwd),
    modelRecommendation: _loadModelRecommendation(model, cwd),
    estimatedCost,
    totalInputTokens,
    totalOutputTokens,
    tokensPerSlice,
    effectiveOrder,
    effectiveSlices,
    sliceCount,
    quorumOverhead: _computeQuorumOverhead(quorumConfig, model, {
      effectiveSlices,
      sliceCount,
      tokensPerSlice,
      cwd,
      costForLeg,
    }),
    quorumViability: _estimatePlanQuorumViability(quorumConfig),
    costCalibration,
    cwd,
    quorumConfig,
  });
}

/**
 * Build a quorum configuration object for a given mode name.
 * Shared by estimateQuorum and estimateSlice so the two always agree
 * on which models, thresholds, and auto flags each mode implies.
 *
 * @param {"auto"|"power"|"speed"|"false"} mode
 * @returns {object|null} quorumConfig for estimatePlan, or null for mode "false".
 */
function _buildQuorumAutoConfig() {
  return {
    enabled: true,
    auto: true,
    threshold: 5,
    models: QUORUM_PRESETS.speed?.models || ["claude-sonnet-4.6"],
    reviewerModel: QUORUM_PRESETS.speed?.reviewerModel || "claude-sonnet-4.6",
    preset: "speed",
  };
}

function _buildQuorumPresetConfig(presetName, fallbackThreshold, fallbackReviewerModel) {
  return {
    enabled: true,
    auto: false,
    threshold: QUORUM_PRESETS[presetName]?.threshold ?? fallbackThreshold,
    models: QUORUM_PRESETS[presetName]?.models || [],
    reviewerModel: QUORUM_PRESETS[presetName]?.reviewerModel || fallbackReviewerModel,
    preset: presetName,
  };
}

export function buildQuorumConfigForMode(mode) {
  if (mode === "false" || mode === false) return null;

  const builders = {
    auto: _buildQuorumAutoConfig,
    power: () => _buildQuorumPresetConfig("power", 5, "claude-opus-4.7"),
    speed: () => _buildQuorumPresetConfig("speed", 7, "claude-sonnet-4.6"),
  };
  const builder = builders[mode];
  if (builder) {
    return builder();
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
const VALID_ESTIMATE_SLICE_MODES = new Set(["auto", "power", "speed", "false"]);

function _estimateSliceTokensPerSlice(resolvedCwd) {
  return _computeAverageTokensPerSlice(_loadCostHistory(resolvedCwd)) || { input: 2000, output: 5000 };
}

function _estimateSliceQuorumDecision(quorumConfig, complexityScore, mode) {
  if (!quorumConfig) {
    return { quorumEligible: false, rationale: "mode false: quorum disabled" };
  }
  if (quorumConfig.auto) {
    const quorumEligible = complexityScore >= quorumConfig.threshold;
    return {
      quorumEligible,
      rationale: quorumEligible
        ? `threshold ${quorumConfig.threshold} met: complexity ${complexityScore}`
        : `threshold ${quorumConfig.threshold} not met: complexity ${complexityScore}`,
    };
  }
  return {
    quorumEligible: true,
    rationale: `mode ${mode}: all slices quorum-eligible`,
  };
}

function _estimateSliceOverhead(quorumEligible, quorumConfig, tokensPerSlice, costForLeg) {
  if (!(quorumEligible && quorumConfig)) return 0;

  const dryRunInput = tokensPerSlice.input * 1.5;
  const dryRunOutput = tokensPerSlice.output * 0.8;
  const dryRunCost = quorumConfig.models.reduce(
    (sum, legModel) => sum + costForLeg(legModel, dryRunInput, dryRunOutput),
    0
  );
  const reviewerInput = dryRunOutput * quorumConfig.models.length + tokensPerSlice.input;
  const reviewerOutput = tokensPerSlice.output * 0.6;
  const reviewerCost = costForLeg(quorumConfig.reviewerModel, reviewerInput, reviewerOutput);
  return dryRunCost + reviewerCost;
}

export function estimateSlice({ plan, sliceNumber, mode = "auto", model = "claude-sonnet-4.5", cwd, env = process.env } = {}) {
  if (!plan || !plan.slices) {
    throw new Error("estimateSlice: plan object with slices is required");
  }
  const target = String(sliceNumber);
  const slice = plan.slices.find((s) => String(s.number) === target);
  if (!slice) {
    throw new Error(`estimateSlice: sliceNumber "${target}" not found in plan (available: ${plan.slices.map((s) => s.number).join(", ")})`);
  }
  if (!VALID_ESTIMATE_SLICE_MODES.has(mode)) {
    throw new Error(`estimateSlice: unknown mode "${mode}" — expected auto | power | speed | false`);
  }

  const resolvedCwd = cwd === null ? null : (cwd || process.cwd());
  const tokensPerSlice = _estimateSliceTokensPerSlice(resolvedCwd);
  const forgeConfig = _loadForgeConfig(resolvedCwd);
  const costForLeg = (legModel, inTokens, outTokens) => {
    const legCost = detectCostModel({ env, forgeConfig, model: legModel });
    if (SUBSCRIPTION_PROVIDERS.has(legCost.provider)) {
      return legCost.perRequestUsd;
    }
    const mPricing = getPricing(legModel);
    return (inTokens * mPricing.input) + (outTokens * mPricing.output);
  };

  const baseCostUSD = costForLeg(model, tokensPerSlice.input, tokensPerSlice.output);
  const { score: complexityScore } = scoreSliceComplexity(slice, resolvedCwd);
  const quorumConfig = buildQuorumConfigForMode(mode);
  const { quorumEligible, rationale } = _estimateSliceQuorumDecision(quorumConfig, complexityScore, mode);
  const overheadUSD = _estimateSliceOverhead(quorumEligible, quorumConfig, tokensPerSlice, costForLeg);
  const estimatedCostUSD = baseCostUSD + overheadUSD;
  const _sliceProvider = detectCostModel({ env, forgeConfig, model }).provider;
  const _sliceFq = _computeFoundryQuota({
    estimatedTokensIn: tokensPerSlice.input,
    estimatedTokensOut: tokensPerSlice.output,
    provider: _sliceProvider,
    env,
    cwd: resolvedCwd,
  });

  return {
    estimatedCostUSD: Math.round(estimatedCostUSD * 1_000_000) / 1_000_000,
    baseCostUSD: Math.round(baseCostUSD * 1_000_000) / 1_000_000,
    overheadUSD: Math.round(overheadUSD * 1_000_000) / 1_000_000,
    complexityScore,
    model,
    quorumEligible,
    rationale,
    generatedAt: new Date().toISOString(),
    ...(_sliceFq && { foundryQuota: _sliceFq }),
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
    ...(() => {
      const _qFq = _computeFoundryQuota({
        estimatedTokensIn: estAuto.tokens?.estimatedInput ?? 0,
        estimatedTokensOut: estAuto.tokens?.estimatedOutput ?? 0,
        provider: estAuto.provider ?? "unknown",
        cwd: resolvedCwd,
      });
      return _qFq ? { foundryQuota: _qFq } : {};
    })(),
  };
}
