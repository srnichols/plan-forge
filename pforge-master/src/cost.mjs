/**
 * Plan Forge — Forge-Master Turn Cost Estimation (Phase-38.2).
 *
 * Computes API-equivalent USD cost for a single model turn.
 *
 * IMPORTANT: These are API-equivalent estimates only.
 * Users accessing models via a GitHub Copilot subscription pay via their
 * subscription plan — not per-token API billing.  The numbers here match
 * published API list prices and are useful for comparative reasoning
 * (e.g. "Deep costs ~30× more per turn than Fast") but are NOT billed amounts.
 *
 * Pricing source: published API pricing pages, April 2026.
 * Rates are USD per token.
 *
 * @module forge-master/cost
 */

/**
 * Per-token pricing table for models known to Forge-Master.
 * Fallback ("default") applies to any unrecognised model identifier.
 *
 * @type {Record<string, { input: number, output: number }>}
 */
export const TURN_PRICING = {
  // Anthropic Claude
  "claude-opus-4.7":      { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4.6":      { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4.5":      { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-opus-4":        { input: 15 / 1_000_000,   output: 75 / 1_000_000 },
  "claude-sonnet-4.6":    { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-sonnet-4.5":    { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-sonnet-4":      { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "claude-haiku-4.5":     { input: 0.8 / 1_000_000,  output: 4 / 1_000_000 },
  // OpenAI GPT
  "gpt-5.4":              { input: 5 / 1_000_000,    output: 15 / 1_000_000 },
  "gpt-5.3-codex":        { input: 3 / 1_000_000,    output: 12 / 1_000_000 },
  "gpt-5.2-codex":        { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.2":              { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-5.4-mini":         { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-5-mini":           { input: 0.4 / 1_000_000,  output: 1.6 / 1_000_000 },
  "gpt-4.1":              { input: 2 / 1_000_000,    output: 8 / 1_000_000 },
  "gpt-4o":               { input: 2.5 / 1_000_000,  output: 10 / 1_000_000 },
  "gpt-4o-mini":          { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  // xAI Grok
  "grok-4.20":            { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4":               { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4-0709":          { input: 2 / 1_000_000,    output: 6 / 1_000_000 },
  "grok-4-fast":          { input: 0.20 / 1_000_000, output: 0.50 / 1_000_000 },
  "grok-3":               { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
  "grok-3-mini":          { input: 0.30 / 1_000_000, output: 0.50 / 1_000_000 },
  // Fallback for unknown / unconfigured models
  default:                { input: 3 / 1_000_000,    output: 15 / 1_000_000 },
};

/**
 * Return per-token pricing for a model, falling back to `default` for
 * unrecognised identifiers.
 *
 * @param {string|null|undefined} model
 * @returns {{ input: number, output: number }}
 */
export function getPricing(model) {
  if (model && typeof model === "string") {
    return TURN_PRICING[model] ?? TURN_PRICING.default;
  }
  return TURN_PRICING.default;
}

/**
 * Compute the API-equivalent USD cost for a single model invocation.
 *
 * @param {string|null|undefined} model — the model name actually used
 * @param {number} tokensIn  — prompt token count reported by the provider
 * @param {number} tokensOut — completion token count reported by the provider
 * @returns {number} estimated cost in USD (≥ 0)
 */
export function computeTurnCost(model, tokensIn, tokensOut) {
  const { input, output } = getPricing(model);
  return (tokensIn * input) + (tokensOut * output);
}
