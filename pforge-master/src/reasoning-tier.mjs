/**
 * Plan Forge — Reasoning Tier Resolver (Phase-34, Slice 1).
 *
 * Maps reasoning tiers ("low" | "medium" | "high") to model names configured
 * under `forgeMaster.reasoningTiers` in `.forge.json`.  Falls back to
 * `config.reasoningModel` for any tier that has no explicit mapping.
 *
 * @module forge-master/reasoning-tier
 */

/** @type {Readonly<["low","medium","high"]>} */
export const VALID_TIERS = Object.freeze(["low", "medium", "high"]);

/**
 * Resolve the model name to use for a given reasoning tier.
 *
 * Resolution order:
 *   1. `config.reasoningTiers[tier]` — explicit per-tier override
 *   2. `config.reasoningModel`        — shared project default
 *   3. `null`                         — no model configured (caller must handle)
 *
 * @param {"low"|"medium"|"high"|string|null|undefined} tier
 * @param {{
 *   reasoningTiers?: { low?: string|null, medium?: string|null, high?: string|null },
 *   reasoningModel?: string|null,
 * }} config — from getForgeMasterConfig
 * @returns {string|null}
 */
export function resolveModel(tier, config) {
  if (tier && VALID_TIERS.includes(tier)) {
    const tiered = config?.reasoningTiers?.[tier];
    if (tiered && typeof tiered === "string") return tiered;
  }
  return config?.reasoningModel ?? null;
}
