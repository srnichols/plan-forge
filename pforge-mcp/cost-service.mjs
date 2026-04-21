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
  QUORUM_PRESETS,
} from "./orchestrator.mjs";

// ─── Pricing Table ────────────────────────────────────────────────────
// Per-token costs in USD. Updated April 2026.
// Source: published API pricing pages. Rates are per 1 token.
export const MODEL_PRICING = {
  // Anthropic Claude
  // claude-opus-4.7 — mirrors published claude-opus-4.6 rates until Anthropic
  // publishes a distinct price point for 4.7. Source: Anthropic pricing page
  // (claude-opus-4.6: $15 / $75 per Mtok, retrieved 2026-04-20). Phase-27.1 Slice 2.
  "claude-opus-4.7":        { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
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

/**
 * Build a cost estimate for an entire plan.
 * Drop-in replacement for orchestrator.buildEstimate — same signature, same output shape.
 *
 * Historical calibration: reads .forge/cost-history.json when available; clamps
 * correction factor to [0.5, 3.0]. Quorum overhead computed when quorumConfig.enabled.
 * Per-plan model recommendation from .forge/model-performance.json.
 */
export function estimatePlan(plan, model, cwd, quorumConfig = null, resumeFrom = null) {
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

  const tokensPerSlice = avgTokensPerSlice || { input: 2000, output: 5000, source: "heuristic" };
  const pricing = getPricing(model);
  const sliceCount = effectiveSlices.length;
  const totalInputTokens = sliceCount * tokensPerSlice.input;
  const totalOutputTokens = sliceCount * tokensPerSlice.output;
  let estimatedCost = (totalInputTokens * pricing.input) + (totalOutputTokens * pricing.output);

  // Cost calibration: compare prior estimates vs actuals to compute correction factor
  let costCalibration = null;
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
    const dryRunCostPerSlice = quorumConfig.models.reduce((sum, m) => {
      const mPricing = getPricing(m);
      return sum + (dryRunInputPerLeg * mPricing.input) + (dryRunOutputPerLeg * mPricing.output);
    }, 0);
    const reviewerPricing = getPricing(quorumConfig.reviewerModel);
    const reviewerCostPerSlice = (reviewerInput * reviewerPricing.input) + (reviewerOutput * reviewerPricing.output);

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
          .filter(([, s]) => s.total_slices >= MIN_SAMPLE && s.success_rate > 0.8)
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
export function estimateSlice({ plan, sliceNumber, mode = "auto", model = "claude-sonnet-4.5", cwd } = {}) {
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

  const resolvedCwd = cwd || process.cwd();

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

  // Base cost from model pricing
  const pricing = getPricing(model);
  const baseCostUSD = (tokensPerSlice.input * pricing.input) + (tokensPerSlice.output * pricing.output);

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
    const dryRunCost = quorumConfig.models.reduce((sum, m) => {
      const mPricing = getPricing(m);
      return sum + (dryRunInput * mPricing.input) + (dryRunOutput * mPricing.output);
    }, 0);
    const reviewerInput = dryRunOutput * quorumConfig.models.length + tokensPerSlice.input;
    const reviewerOutput = tokensPerSlice.output * 0.6;
    const reviewerPricing = getPricing(quorumConfig.reviewerModel);
    const reviewerCost = (reviewerInput * reviewerPricing.input) + (reviewerOutput * reviewerPricing.output);
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
 */
export function estimateQuorum({ plan, cwd, resumeFrom = null, defaultModel = "claude-sonnet-4.5" } = {}) {
  if (!plan || !plan.slices || !plan.dag) {
    throw new Error("estimateQuorum: plan object with slices and dag is required");
  }

  const resolvedCwd = cwd || process.cwd();

  const autoConfig = buildQuorumConfigForMode("auto");
  const powerConfig = buildQuorumConfigForMode("power");
  const speedConfig = buildQuorumConfigForMode("speed");

  const estAuto = estimatePlan(plan, defaultModel, resolvedCwd, autoConfig, resumeFrom);
  const estPower = estimatePlan(plan, defaultModel, resolvedCwd, powerConfig, resumeFrom);
  const estSpeed = estimatePlan(plan, defaultModel, resolvedCwd, speedConfig, resumeFrom);
  const estNone = estimatePlan(plan, defaultModel, resolvedCwd, null, resumeFrom);

  const toSummary = (est, mode) => ({
    mode,
    estimatedCostUSD: est.totalCostWithQuorumUSD ?? est.estimatedCostUSD,
    baseCostUSD: est.estimatedCostUSD,
    overheadUSD: est.quorumOverhead?.totalOverheadUSD ?? 0,
    quorumSliceCount: est.quorumOverhead?.quorumSliceCount ?? 0,
    totalSliceCount: est.sliceCount,
    confidence: est.confidence,
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
