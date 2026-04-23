/**
 * Plan Forge — Forge-Master Config (Phase-28, Slice 1; Phase-33, Slice 2).
 *
 * Loads the `forgeMaster` block from `.forge.json` and applies the
 * documented fallback chain for reasoningModel / routerModel so callers
 * always receive a fully-resolved config without having to handle missing
 * keys themselves.
 *
 * Fallback chain for reasoningModel:
 *   1. forgeMaster.reasoningModel  (explicit override)
 *   2. model.default               (shared project default)
 *   3. env-detected provider default:
 *        GITHUB_TOKEN      -> "gpt-4o-mini"     (GitHub Models — zero-key default)
 *        ANTHROPIC_API_KEY -> "claude-sonnet-4.5"
 *        OPENAI_API_KEY    -> "gpt-5.3-codex"
 *        XAI_API_KEY       -> "grok-4-fast"
 *        (no key)          -> "gpt-4o-mini"      (caller must handle missing key)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const FORGE_MASTER_DEFAULTS = Object.freeze({
  reasoningModel: null,
  reasoningProvider: null,
  defaultProvider: "githubCopilot",
  providers: Object.freeze({
    githubCopilot: Object.freeze({ model: "gpt-4o-mini" }),
  }),
  routerModel: "grok-3-mini",
  maxToolCalls: 5,
  ceilingToolCalls: 10,
  sessionRetentionDays: 14,
  l3Enabled: false,
  discoverExtensionTools: true,
  reasoningTiers: Object.freeze({ low: null, medium: null, high: null }),
  defaultTier: null,
  autoEscalate: false,
});

const VALID_PROVIDERS = new Set(["githubCopilot", "anthropic", "openai", "xai"]);

function resolveReasoningModel(forgeMasterBlock, forgeJson) {
  if (forgeMasterBlock?.reasoningModel && typeof forgeMasterBlock.reasoningModel === "string") {
    return forgeMasterBlock.reasoningModel;
  }
  if (forgeJson?.model?.default && typeof forgeJson.model.default === "string") {
    return forgeJson.model.default;
  }
  if (process.env.GITHUB_TOKEN) return "gpt-4o-mini";
  if (process.env.ANTHROPIC_API_KEY) return "claude-sonnet-4.5";
  if (process.env.OPENAI_API_KEY) return "gpt-5.3-codex";
  if (process.env.XAI_API_KEY) return "grok-4-fast";
  return null; // no key detected — auto-select will handle fallback
}

function resolveReasoningProvider(forgeMasterBlock, resolvedModel) {
  const explicit = forgeMasterBlock?.reasoningProvider;
  // Always pass through the explicit value — selectProvider handles unknown names by returning null.
  if (explicit) return explicit;
  if (!resolvedModel) return null; // no model → auto-select decides
  if (/^claude/i.test(resolvedModel)) return "anthropic";
  if (/^grok/i.test(resolvedModel)) return "xai";
  if (/^gpt-4o/i.test(resolvedModel)) return "githubCopilot";
  if (/^gpt/i.test(resolvedModel)) return "openai";
  return null;
}

/**
 * Load and return a fully-resolved Forge-Master config.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {{
 *   reasoningModel: string,
 *   reasoningProvider: "githubCopilot"|"anthropic"|"openai"|"xai"|null,
 *   defaultProvider: "githubCopilot"|"anthropic"|"openai"|"xai",
 *   routerModel: string,
 *   maxToolCalls: number,
 *   ceilingToolCalls: number,
 *   sessionRetentionDays: number,
 *   l3Enabled: boolean,
 *   discoverExtensionTools: boolean,
 *   reasoningTiers: { low: string|null, medium: string|null, high: string|null },
 *   defaultTier: "low"|"medium"|"high"|null,
 *   autoEscalate: boolean,
 * }}
 */
export function getForgeMasterConfig({ cwd = process.cwd() } = {}) {
  const configPath = resolve(cwd, ".forge.json");
  let forgeJson = null;
  let block = null;

  try {
    if (existsSync(configPath)) {
      forgeJson = JSON.parse(readFileSync(configPath, "utf-8"));
      block = forgeJson?.forgeMaster ?? null;
    }
  } catch { /* fall through to defaults */ }

  const reasoningModel = resolveReasoningModel(block, forgeJson);
  const reasoningProvider = resolveReasoningProvider(block, reasoningModel);

  const routerModel =
    (typeof block?.routerModel === "string" && block.routerModel)
      ? block.routerModel
      : FORGE_MASTER_DEFAULTS.routerModel;

  const maxToolCalls = Number.isFinite(block?.maxToolCalls)
    ? Math.max(1, Math.min(10, Math.trunc(block.maxToolCalls)))
    : FORGE_MASTER_DEFAULTS.maxToolCalls;

  const ceilingToolCalls = Number.isFinite(block?.ceilingToolCalls)
    ? Math.max(maxToolCalls, Math.min(20, Math.trunc(block.ceilingToolCalls)))
    : FORGE_MASTER_DEFAULTS.ceilingToolCalls;

  const sessionRetentionDays = Number.isFinite(block?.sessionRetentionDays)
    ? Math.max(1, Math.min(365, Math.trunc(block.sessionRetentionDays)))
    : FORGE_MASTER_DEFAULTS.sessionRetentionDays;

  const l3Enabled = typeof block?.l3Enabled === "boolean"
    ? block.l3Enabled
    : FORGE_MASTER_DEFAULTS.l3Enabled;

  const discoverExtensionTools = typeof block?.discoverExtensionTools === "boolean"
    ? block.discoverExtensionTools
    : FORGE_MASTER_DEFAULTS.discoverExtensionTools;

  const defaultProvider =
    (typeof block?.defaultProvider === "string" && VALID_PROVIDERS.has(block.defaultProvider))
      ? block.defaultProvider
      : FORGE_MASTER_DEFAULTS.defaultProvider;

  const reasoningTiers = {
    low: typeof block?.reasoningTiers?.low === "string" ? block.reasoningTiers.low : null,
    medium: typeof block?.reasoningTiers?.medium === "string" ? block.reasoningTiers.medium : null,
    high: typeof block?.reasoningTiers?.high === "string" ? block.reasoningTiers.high : null,
  };

  const VALID_TIER_VALUES = ["low", "medium", "high"];
  const defaultTier =
    (typeof block?.defaultTier === "string" && VALID_TIER_VALUES.includes(block.defaultTier))
      ? block.defaultTier
      : FORGE_MASTER_DEFAULTS.defaultTier;

  const autoEscalate = typeof block?.autoEscalate === "boolean"
    ? block.autoEscalate
    : FORGE_MASTER_DEFAULTS.autoEscalate;

  return {
    reasoningModel,
    reasoningProvider,
    defaultProvider,
    routerModel,
    maxToolCalls,
    ceilingToolCalls,
    sessionRetentionDays,
    l3Enabled,
    discoverExtensionTools,
    reasoningTiers,
    defaultTier,
    autoEscalate,
  };
}
