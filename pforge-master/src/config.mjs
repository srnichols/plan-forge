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
import { FORGE_MASTER_MODES, MODEL_TIERS } from "../../pforge-mcp/enums.mjs";

export const FORGE_MASTER_DEFAULTS = Object.freeze({
  reasoningModel: null,
  reasoningProvider: null,
  defaultProvider: "githubCopilot",
  providers: Object.freeze({
    githubCopilot: Object.freeze({ model: "gpt-4o-mini" }),
  }),
  routerModel: "grok-4.20-0309-non-reasoning",
  maxToolCalls: 5,
  ceilingToolCalls: 10,
  sessionRetentionDays: 14,
  // CTO defaults (Phase-43): L3 cross-project recall on by default; gracefully
  // degrades to L2 when OpenBrain isn't configured (doRecall returns empty).
  l3Enabled: true,
  discoverExtensionTools: true,
  reasoningTiers: Object.freeze({ low: null, medium: null, high: null }),
  defaultTier: null,
  autoEscalate: true,
  observer: Object.freeze({
    // CTO defaults (Phase-43): observer unblocked by default. Still requires
    // explicit forge_master_observe(action:"start") call to actually run.
    enabled: true,
    maxUsdPerDay: 1.0,
    maxNarrationsPerHour: 6,
    modelTier: null,
  }),
  auditor: Object.freeze({
    modelTier: null,
  }),
});

const VALID_PROVIDERS = new Set(["githubCopilot", "anthropic", "openai", "xai"]);
const VALID_MODEL_TIERS = new Set(MODEL_TIERS);
const VALID_FORGE_MASTER_MODES = new Set(FORGE_MASTER_MODES);

function formatValidValues(values) {
  return [...values].join(", ");
}

function validateOptionalModelTier(kind, value) {
  if (value == null) return null;
  if (!VALID_MODEL_TIERS.has(value)) {
    throw new RangeError(`Invalid ${kind} '${value}'. Valid: ${formatValidValues(MODEL_TIERS)} or null`);
  }
  return value;
}

function validateOptionalForgeMasterMode(value) {
  if (typeof value !== "string" || value.length === 0) return;
  if (!VALID_FORGE_MASTER_MODES.has(value)) {
    throw new RangeError(`Invalid forgeMaster.mode '${value}'. Valid: ${formatValidValues(FORGE_MASTER_MODES)}`);
  }
}

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

const VALID_DEFAULT_TIERS = ["low", "medium", "high"];

function loadForgeMasterBlock(configPath) {
  let forgeJson = null;
  let block = null;

  try {
    if (existsSync(configPath)) {
      forgeJson = JSON.parse(readFileSync(configPath, "utf-8"));
      block = forgeJson?.forgeMaster ?? null;
    }
  } catch { /* fall through to defaults */ }

  return { forgeJson, block };
}

function clampIntegerOption(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function resolveCeilingToolCalls(value, maxToolCalls) {
  if (!Number.isFinite(value)) return FORGE_MASTER_DEFAULTS.ceilingToolCalls;
  return Math.max(maxToolCalls, Math.min(20, Math.trunc(value)));
}

function resolveBooleanOption(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function resolveDefaultProvider(block) {
  return (typeof block?.defaultProvider === "string" && VALID_PROVIDERS.has(block.defaultProvider))
    ? block.defaultProvider
    : FORGE_MASTER_DEFAULTS.defaultProvider;
}

function resolveReasoningTiers(block) {
  return {
    low: typeof block?.reasoningTiers?.low === "string" ? block.reasoningTiers.low : null,
    medium: typeof block?.reasoningTiers?.medium === "string" ? block.reasoningTiers.medium : null,
    high: typeof block?.reasoningTiers?.high === "string" ? block.reasoningTiers.high : null,
  };
}

function resolveDefaultTier(block) {
  return (typeof block?.defaultTier === "string" && VALID_DEFAULT_TIERS.includes(block.defaultTier))
    ? block.defaultTier
    : FORGE_MASTER_DEFAULTS.defaultTier;
}

function resolveObserverNumber(value, fallback) {
  return (typeof value === "number" && Number.isFinite(value) && value >= 0)
    ? value
    : fallback;
}

function resolveObserverNarrationLimit(value, fallback) {
  return (typeof value === "number" && Number.isFinite(value) && value >= 0)
    ? Math.trunc(value)
    : fallback;
}

function resolveOptionalModelTierValue(kind, value, fallback) {
  return typeof value === "string"
    ? validateOptionalModelTier(kind, value)
    : fallback;
}

function resolveObserverConfig(block) {
  const observerBlock = block?.observer ?? {};
  return {
    enabled: resolveBooleanOption(observerBlock.enabled, FORGE_MASTER_DEFAULTS.observer.enabled),
    maxUsdPerDay: resolveObserverNumber(observerBlock.maxUsdPerDay, FORGE_MASTER_DEFAULTS.observer.maxUsdPerDay),
    maxNarrationsPerHour: resolveObserverNarrationLimit(
      observerBlock.maxNarrationsPerHour,
      FORGE_MASTER_DEFAULTS.observer.maxNarrationsPerHour,
    ),
    modelTier: resolveOptionalModelTierValue(
      "forgeMaster.observer.modelTier",
      observerBlock.modelTier,
      FORGE_MASTER_DEFAULTS.observer.modelTier,
    ),
  };
}

function resolveAuditorConfig(block) {
  const auditorBlock = block?.auditor ?? {};
  return {
    modelTier: resolveOptionalModelTierValue(
      "forgeMaster.auditor.modelTier",
      auditorBlock.modelTier,
      FORGE_MASTER_DEFAULTS.auditor.modelTier,
    ),
  };
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
 *   observer: { enabled: boolean, maxUsdPerDay: number, maxNarrationsPerHour: number, modelTier: string|null },
 *   auditor: { modelTier: string|null },
 * }}
 */
export function getForgeMasterConfig({ cwd = process.cwd() } = {}) {
  const configPath = resolve(cwd, ".forge.json");
  const { forgeJson, block } = loadForgeMasterBlock(configPath);
  const reasoningModel = resolveReasoningModel(block, forgeJson);
  const reasoningProvider = resolveReasoningProvider(block, reasoningModel);
  const observer = resolveObserverConfig(block);
  const auditor = resolveAuditorConfig(block);

  validateOptionalForgeMasterMode(block?.mode);

  return {
    reasoningModel,
    reasoningProvider,
    defaultProvider: resolveDefaultProvider(block),
    routerModel: (typeof block?.routerModel === "string" && block.routerModel)
      ? block.routerModel
      : FORGE_MASTER_DEFAULTS.routerModel,
    maxToolCalls: clampIntegerOption(block?.maxToolCalls, FORGE_MASTER_DEFAULTS.maxToolCalls, 1, 10),
    ceilingToolCalls: resolveCeilingToolCalls(
      block?.ceilingToolCalls,
      clampIntegerOption(block?.maxToolCalls, FORGE_MASTER_DEFAULTS.maxToolCalls, 1, 10),
    ),
    sessionRetentionDays: clampIntegerOption(
      block?.sessionRetentionDays,
      FORGE_MASTER_DEFAULTS.sessionRetentionDays,
      1,
      365,
    ),
    l3Enabled: resolveBooleanOption(block?.l3Enabled, FORGE_MASTER_DEFAULTS.l3Enabled),
    discoverExtensionTools: resolveBooleanOption(
      block?.discoverExtensionTools,
      FORGE_MASTER_DEFAULTS.discoverExtensionTools,
    ),
    reasoningTiers: resolveReasoningTiers(block),
    defaultTier: resolveDefaultTier(block),
    autoEscalate: resolveBooleanOption(block?.autoEscalate, FORGE_MASTER_DEFAULTS.autoEscalate),
    observer,
    auditor,
  };
}
