// ─── Cost Service ─────────────────────────────────────────────────────
// Phase-27 (v2.60.0): Canonical pricing + estimation module.
// Consolidates MODEL_PRICING, per-slice costing, per-run breakdowns,
// plan cost estimation, and multi-mode quorum estimation.
// Orchestrator and scanners re-export / import from here; this is the
// single source of truth for every $-denominated value in pforge.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Pricing Table ────────────────────────────────────────────────────
// Per-token costs in USD. Updated April 2026.
// Source: published API pricing pages. Rates are per 1 token.
export const MODEL_PRICING = {
  // Anthropic Claude
  "claude-opus-4.6":        { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4.6-fast":   { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4.5":        { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-sonnet-4.6":      { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-sonnet-4.5":      { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-sonnet-4":        { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-haiku-4.5":       { input: 0.8 / 1_000_000,  output: 4 / 1_000_000 },
  // OpenAI GPT
  "gpt-5.4":                { input: 5 / 1_000_000,    output: 15 / 1_000_000 },
  "gpt-5.3-codex":          { input: 3 / 1_000_000,    output: 12 / 1_000_000 },
  "gpt-5.2-codex":          { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.2":                { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.4-mini":           { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-5-mini":             { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-4.1":                { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  // Google Gemini
  "gemini-3-pro-preview":   { input: 1.25 / 1_000_000, output: 5 / 1_000_000 },
  // xAI Grok (reasoning_tokens billed as output — per docs.x.ai/developers/models)
  "grok-4.20":                         { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4.20-0309-reasoning":         { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4.20-0309-non-reasoning":     { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4.20-multi-agent-0309":       { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4-1-fast-reasoning":          { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000 },
  "grok-4-1-fast-non-reasoning":      { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000 },
  "grok-4":                 { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4-0709":            { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-3":                 { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "grok-3-mini":            { input: 0.30 / 1_000_000, output: 0.50 / 1_000_000 },
  // Fallback
  default:                  { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
};

/**
 * Look up per-token pricing for a model. Unknown models fall through to the
 * default rate so callers never hit an undefined.
 * @param {string} model
 * @returns {{ input: number, output: number }}
 */
export function getPricing(model) {
  return MODEL_PRICING[model] || MODEL_PRICING.default;
}

/**
 * Calculate cost for a single slice from its token data.
 *
 * CLI workers (gh-copilot, claude) are subscription-based — cost is estimated
 * from premium request counts, not token-based API pricing.
 * API workers use per-token MODEL_PRICING.
 *
 * Signature kept positional for drop-in parity with the legacy
 * `calculateSliceCost(tokens, worker)` entry point in orchestrator.mjs.
 *
 * @param {{ tokens_in: number|null, tokens_out: number|null, model: string, premiumRequests?: number }} tokens
 * @param {string} [worker] - Worker type: "gh-copilot", "claude", "codex", "api-xai", etc.
 * @returns {{ cost_usd: number, model: string, tokens_in: number, tokens_out: number }}
 */
export function priceSlice(tokens, worker) {
  const model = tokens?.model || "unknown";
  const tokensIn = typeof tokens?.tokens_in === "number" ? tokens.tokens_in : 0;
  const tokensOut = typeof tokens?.tokens_out === "number" ? tokens.tokens_out : 0;

  let cost;
  // CLI subscription workers: cost based on premium requests, not API token pricing
  if (worker && !worker.startsWith("api-")) {
    const premiumRequests = tokens?.premiumRequests || 0;
    // GitHub Copilot premium request rate — approximate per-request cost
    const PREMIUM_REQUEST_RATE = 0.01; // ~$0.01 per premium request
    cost = premiumRequests * PREMIUM_REQUEST_RATE;
  } else {
    // API workers: use per-token pricing
    const pricing = getPricing(model);
    cost = (tokensIn * pricing.input) + (tokensOut * pricing.output);
  }

  return {
    cost_usd: Math.round(cost * 1_000_000) / 1_000_000, // 6 decimal places
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
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
