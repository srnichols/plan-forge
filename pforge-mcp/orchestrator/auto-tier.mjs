/**
 * Plan Forge — SDK auto-routing tier per slice.
 *
 * When a slice runs on "auto" (no model chosen), the Copilot SDK picks the
 * model; its `autoTier` option says what to optimise for. Plan Forge maps the
 * slice's complexity score (1–10, scoreSliceComplexity) onto a tier, so simple
 * slices go to efficient models and complex ones to the most capable.
 *
 * Config: `.forge.json` → `routing.autoTier`:
 *   "complexity" (default) | "efficiency" | "balance" | "intelligence" | "off"
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SDK_AUTO_TIERS } from "./sdk-worker.mjs";

const COMPLEXITY_MODE = "complexity";
const OFF = "off";
const FIXED_TIERS = SDK_AUTO_TIERS.filter((tier) => tier !== "fast");
const EFFICIENCY_MAX_SCORE = 3;
const BALANCE_MAX_SCORE = 6;

/**
 * @param {string} cwd
 * @returns {"complexity"|"efficiency"|"balance"|"intelligence"|"off"}
 */
export function loadAutoTierConfig(cwd) {
  try {
    const path = resolve(cwd, ".forge.json");
    if (!existsSync(path)) return COMPLEXITY_MODE;
    const value = JSON.parse(readFileSync(path, "utf8"))?.routing?.autoTier;
    return value === OFF || FIXED_TIERS.includes(value) ? value : COMPLEXITY_MODE;
  } catch {
    return COMPLEXITY_MODE;
  }
}

/**
 * @param {{ complexityScore?: number, config: string }} opts
 * @returns {"efficiency"|"balance"|"intelligence"|null}
 */
export function autoTierForSlice({ complexityScore, config }) {
  if (config === OFF) return null;
  if (config !== COMPLEXITY_MODE) return config;
  if (!Number.isFinite(complexityScore)) return "balance";
  if (complexityScore <= EFFICIENCY_MAX_SCORE) return "efficiency";
  if (complexityScore <= BALANCE_MAX_SCORE) return "balance";
  return "intelligence";
}
