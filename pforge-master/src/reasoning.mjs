/**
 * Plan Forge — Forge-Master Reasoning Loop (Phase-28, Slice 5; Phase-33, Slice 2).
 *
 * Implements the tool-use reasoning loop:
 *   1. Classify intent via intent-router.
 *   2. Fetch context from brain tiers via retrieval.
 *   3. Load + interpolate system prompt.
 *   4. Invoke frontier model via provider adapter with tool schemas.
 *   5. Execute tool calls through tool-bridge.
 *   6. Iterate until final reply or budget exceeded.
 *
 * Exports:
 *   - runTurn({message, sessionId, maxToolCalls, cwd}, deps) → result
 *   - buildToolSchemas(allowlist, usageHints) → schema array
 *   - selectProvider(providerName) → adapter module  (explicit by-name selection)
 *   - autoSelectProvider(config, env, _providers) → adapter module (availability-order selection)
 *   - ABSOLUTE_CEILING — hard ceiling for tool calls (10)
 *
 * @module forge-master/reasoning
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { classify, LANES, LANE_DESCRIPTORS, OFFTOPIC_REDIRECT } from "./intent-router.mjs";
import { fetchContext } from "./retrieval.mjs";
import { getForgeMasterConfig } from "./config.mjs";
import { resolveAllowlist, USAGE_HINTS } from "./allowlist.mjs";
import { invokeMany, invokeAllowlisted } from "./tool-bridge.mjs";
import { plan as runPlanner } from "./planner.mjs";
import { executePlan } from "./plan-executor.mjs";
import { ensureSessionId, appendTurn, summarizeIfNeeded } from "./persistence.mjs";
import { appendTurn as storeAppendTurn, loadSession, hashReply } from "./session-store.mjs";
import { loadIndex, queryIndex } from "./recall-index.mjs";
import { loadPrinciples, UNIVERSAL_BASELINE } from "./principles.mjs";
import { resolveModel, VALID_TIERS } from "./reasoning-tier.mjs";
import { computeTurnCost } from "./cost.mjs";
import { dispatchQuorum } from "./quorum-dispatcher.mjs";
import * as githubCopilotProvider from "./providers/github-copilot-tools.mjs";
import { checkBudget, recordSpend, loadBudgetState, saveBudgetState } from "./observer-budget.mjs";
import { buildObserverPrompt } from "./observer-prompt.mjs";
import { OBSERVER_NARRATION_EVENT_TYPE } from "./observer-loop.mjs";
import { buildUsage, invalidInputResult, normalizeTurnInput } from "./turn-input.mjs";

// ─── Recall-eligible lanes ────────────────────────────────────────────

const RECALL_LANES = new Set([LANES.OPERATIONAL, LANES.TROUBLESHOOT, LANES.ADVISORY]);

// ─── Quorum advisory — model set for multi-model fan-out ────────────

const QUORUM_MODELS = [
  { model: "claude-sonnet-5.5", provider: "anthropic" },
  { model: "gpt-6-sol", provider: "openai" },
  { model: "grok-4.7", provider: "xai" },
];

// Lanes where quorum must NEVER engage (hard guard)
const QUORUM_BLOCKED_LANES = new Set([
  LANES.BUILD,
  LANES.OPERATIONAL,
  LANES.TROUBLESHOOT,
  LANES.OFFTOPIC,
  LANES.TEMPERING,
  LANES.PRINCIPLE_JUDGMENT,
  LANES.META_BUG_TRIAGE,
]);

// ─── Constants ──────────────────────────────────────────────────────

export const ABSOLUTE_CEILING = 10;

/**
 * Observer tool allowlist (RD #11) — exactly four read-only tools.
 * Any model-requested tool call outside this list is rejected by the bridge filter.
 */
export const OBSERVER_TOOL_ALLOWLIST = [
  "brain_recall",
  "forge_search",
  "forge_plan_status",
  "forge_watch",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = resolve(__dirname, "system-prompt.md");
const LANE_OVERLAYS = Object.freeze({
  [LANES.ADVISORY]: resolve(__dirname, "prompts", "advisory-cto.md"),
  [LANES.BUILD]: resolve(__dirname, "prompts", "build-interviewer.md"),
  [LANES.TROUBLESHOOT]: resolve(__dirname, "prompts", "troubleshoot-sre.md"),
});

/**
 * Load lane-specific overlay text. Returns empty string if no overlay file
 * exists for the lane — lanes without overlays fall through to the base prompt.
 * @param {string} lane
 * @returns {string}
 */
function loadLaneOverlay(lane) {
  const path = LANE_OVERLAYS[lane];
  if (!path) return "";
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

// Ordered from highest to lowest for tier fallback traversal
const TIER_ORDER = ["high", "medium", "low"];
function nextTier(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}
/** Escalate to the next higher tier (toward "high"). Returns null if already at top. */
function escalateTier(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  return idx > 0 ? TIER_ORDER[idx - 1] : null;
}

// ─── Provider Selection ─────────────────────────────────────────────

const NO_PROVIDER_SUGGESTION =
  "Sign in with GitHub Copilot (`gh auth login` or Copilot CLI), or set ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY.";

export const AUTO_SELECT_ORDER = ["githubCopilot", "anthropic", "openai", "xai"];

/**
 * Select the appropriate provider adapter by explicit name.
 * Returns a module with `sendTurn(opts)`, or null for unknown names.
 * Maintained for backward compatibility — prefer `autoSelectProvider` for new code.
 *
 * @param {"githubCopilot"|"anthropic"|"openai"|"xai"|string|null} providerName
 * @returns {Promise<{ sendTurn: Function, PROVIDER_NAME: string }|null>}
 */
export async function selectProvider(providerName) {
  switch (providerName) {
    case "githubCopilot":
      return githubCopilotProvider;
    case "anthropic":
      return import("./providers/anthropic-tools.mjs");
    case "openai":
      return import("./providers/openai-tools.mjs");
    case "xai":
      return import("./providers/xai-tools.mjs");
    default:
      return null;
  }
}

/**
 * Auto-select the first available provider adapter by checking `isAvailable()`.
 * Iterates `["anthropic", "openai", "xai"]` unless `config.defaultProvider`
 * names one of them first.
 *
 * @param {{ defaultProvider?: string }} config
 * @param {NodeJS.ProcessEnv} [env]
 * @param {Record<string, { module: object, isAvailable: () => boolean }>|null} [_providers]
 *   — injectable for testing; null = use real providers
 * @returns {Promise<{ sendTurn: Function, PROVIDER_NAME: string }|null>}
 */
export async function autoSelectProvider(config, env = process.env, _providers = null) {
  const providerDefs = _providers || {
    githubCopilot: {
      module: githubCopilotProvider,
      isAvailable: () => githubCopilotProvider.isAvailable({ env }),
      load: () => githubCopilotProvider,
    },
    anthropic: {
      module: null,
      isAvailable: () => Boolean(env.ANTHROPIC_API_KEY),
      load: () => import("./providers/anthropic-tools.mjs"),
    },
    openai: {
      module: null,
      isAvailable: () => Boolean(env.OPENAI_API_KEY),
      load: () => import("./providers/openai-tools.mjs"),
    },
    xai: {
      module: null,
      isAvailable: () => Boolean(env.XAI_API_KEY),
      load: () => import("./providers/xai-tools.mjs"),
    },
  };

  let order = [...AUTO_SELECT_ORDER];
  const preferred = config?.defaultProvider;
  if (preferred && order.includes(preferred)) {
    order = [preferred, ...order.filter((p) => p !== preferred)];
  }

  for (const name of order) {
    const entry = providerDefs[name];
    if (!entry) continue;
    if (entry.isAvailable()) {
      return entry.module ?? (await entry.load());
    }
  }
  return null;
}

// ─── Tool Schema Builder ────────────────────────────────────────────

/**
 * Build simplified tool schemas for the reasoning model from the
 * allowlist and usage hints.
 *
 * @param {string[]} allowlist — resolved allowlist of tool names
 * @param {Record<string, string>} [hints=USAGE_HINTS]
 * @returns {Array<{name: string, description: string, parameters: object}>}
 */
export function buildToolSchemas(allowlist, hints = USAGE_HINTS) {
  return allowlist.map((name) => ({
    name,
    description: hints[name] || `Plan Forge tool: ${name}`,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  }));
}

// ─── System Prompt Loader ───────────────────────────────────────────

/**
 * Load and interpolate the system prompt.
 * Composes base prompt + optional lane overlay, then substitutes
 * {principles_block} (non-negotiable, never truncated) and {context_block}
 * (may have been pre-trimmed by retrieval.mjs).
 *
 * @param {string} contextBlock     — pre-fetched and truncated memory context
 * @param {string} principlesBlock  — active principles (loadPrinciples or UNIVERSAL_BASELINE)
 * @param {string} [lane]           — classification lane; selects an overlay if matched
 * @returns {string}
 */
function loadSystemPrompt(contextBlock, principlesBlock, lane = null) {
  const overlay = loadLaneOverlay(lane);
  try {
    const raw = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
    const withOverlay = overlay ? `${raw}\n\n${overlay}` : raw;
    return withOverlay
      .replace("{principles_block}", principlesBlock || UNIVERSAL_BASELINE)
      .replace("{context_block}", contextBlock || "(no context available)");
  } catch {
    const overlayBlock = overlay ? `\n\n${overlay}` : "";
    return `You are Forge-Master, a Plan Forge reasoning assistant.${overlayBlock}\n\n## Philosophy & Guardrails\n\n${principlesBlock || UNIVERSAL_BASELINE}\n\n## Current Context\n\n${contextBlock || "(no context available)"}`;
  }
}

// ─── Private helpers for runTurn ────────────────────────────────────

async function _loadPriorTurns(effectiveSessionId, isEphemeral, cwd) {
  if (isEphemeral) return [];
  try {
    const all = await loadSession(effectiveSessionId, cwd);
    return all.slice(-10);
  } catch { return []; }
}

function _resolveTierState(input, config) {
  const inputModel = typeof input.model === "string" ? input.model : null;
  const rawInputTier = input.tier ?? null;
  const requestedTier = !inputModel && rawInputTier && VALID_TIERS.includes(rawInputTier)
    ? rawInputTier
    : (!inputModel && config.defaultTier ? config.defaultTier : null);
  return {
    inputModel,
    requestedTier,
    currentTier: requestedTier,
    currentModel: inputModel ?? resolveModel(requestedTier, config),
  };
}

function _applyAutoEscalation({ inputModel, currentTier, currentModel, config, classification }) {
  if (inputModel || !currentTier || !config.autoEscalate) {
    return { applied: false, autoEscalated: false, autoFromTier: null, autoToTier: null, autoEscalationReason: null, currentTier, currentModel };
  }
  if (!(LANE_DESCRIPTORS[classification.lane]?.recommendedTierBump > 0)) {
    return { applied: false, autoEscalated: false, autoFromTier: null, autoToTier: null, autoEscalationReason: null, currentTier, currentModel };
  }
  const escalated = escalateTier(currentTier);
  if (!escalated) {
    return { applied: false, autoEscalated: false, autoFromTier: null, autoToTier: null, autoEscalationReason: null, currentTier, currentModel };
  }
  return {
    applied: true,
    autoEscalated: true,
    autoFromTier: currentTier,
    autoToTier: escalated,
    autoEscalationReason: `high-stakes lane: ${classification.lane}`,
    currentTier: escalated,
    currentModel: resolveModel(escalated, config),
  };
}

async function _buildContextBlock({ effectiveSessionId, isEphemeral, classification, message, cwd, priorTurns, deps }) {
  let contextBlock = "";
  try {
    const ctx = await fetchContext({ sessionId: effectiveSessionId, lane: classification.lane, cwd }, deps);
    contextBlock = ctx.contextBlock;
  } catch { /* non-fatal */ }

  let relatedTurns = [];
  if (!isEphemeral && RECALL_LANES.has(classification.lane)) {
    try {
      await loadIndex(cwd);
      relatedTurns = await queryIndex(message, { topK: 3, projectDir: cwd });
    } catch (err) {
      console.warn("[forge-master] recall-index query failed (non-fatal):", err?.message);
    }
    if (relatedTurns.length > 0) {
      const recallLines = relatedTurns.map((r) => {
        const ts = r.timestamp ? r.timestamp.slice(0, 10) : "unknown";
        return `- [${ts} · ${r.lane}] "${r.userMessage}"`;
      });
      contextBlock = `${contextBlock}\n\n> **Recall (advisory):**\n${recallLines.join("\n")}`.trimStart();
    }
  }

  if (classification.lane === LANES.TROUBLESHOOT) {
    try {
      const detectPatterns = deps.detectPatterns || null;
      const surfacedPatterns = typeof detectPatterns === "function" ? await detectPatterns({ cwd }) : [];
      if (surfacedPatterns.length > 0) {
        const patternLines = surfacedPatterns.slice(0, 3).map(
          (p) => `> **Recurring pattern observed:** ${p.title || p.summary || p.id}`,
        );
        contextBlock = `${contextBlock}\n\n${patternLines.join("\n")}`.trimStart();
      }
    } catch { /* non-fatal */ }
  }

  if (priorTurns.length > 0) {
    const priorBlock = priorTurns.map((t) => `Turn ${t.turn}: User: "${t.userMessage}"`).join("\n");
    contextBlock = `## Prior conversation turns (oldest first)\n\n${priorBlock}\n\n${contextBlock}`;
  }

  return { contextBlock, relatedTurns };
}

function _loadPrinciplesBlock(cwd) {
  try {
    const { block } = loadPrinciples({ cwd });
    return block;
  } catch (err) {
    console.warn("[forge-master] principles loader failed, using universal baseline:", err?.message);
    return UNIVERSAL_BASELINE;
  }
}

async function _resolveProvider(config, deps) {
  let provider = deps.provider || null;
  if (!provider) {
    provider = config.reasoningProvider && config.reasoningProviderExplicit
      ? await selectProvider(config.reasoningProvider)
      : await autoSelectProvider(config, process.env, deps._providers || null);
  }
  return provider;
}

async function _resolveFallbackProvider(config, deps, failedProvider) {
  if (deps.provider || config.reasoningProviderExplicit) return null;
  const failedName = failedProvider?.PROVIDER_NAME;
  const realProviders = {
    githubCopilot: { module: githubCopilotProvider, isAvailable: () => failedName !== githubCopilotProvider.PROVIDER_NAME && githubCopilotProvider.isAvailable(), load: () => githubCopilotProvider },
    anthropic: { module: null, isAvailable: () => failedName !== "anthropic" && Boolean(process.env.ANTHROPIC_API_KEY), load: () => import("./providers/anthropic-tools.mjs") },
    openai: { module: null, isAvailable: () => failedName !== "openai" && Boolean(process.env.OPENAI_API_KEY), load: () => import("./providers/openai-tools.mjs") },
    xai: { module: null, isAvailable: () => failedName !== "xai" && Boolean(process.env.XAI_API_KEY), load: () => import("./providers/xai-tools.mjs") },
  };
  const injected = deps._providers ? Object.fromEntries(Object.entries(deps._providers).map(([name, entry]) => [name, { ...entry, isAvailable: () => name !== failedName && entry.isAvailable() }])) : realProviders;
  return autoSelectProvider(config, process.env, injected);
}

function _providerKeyName(providerName) {
  if (providerName === "anthropic") return "ANTHROPIC_API_KEY";
  if (providerName === "openai") return "OPENAI_API_KEY";
  if (providerName === "xai") return "XAI_API_KEY";
  return null;
}

function _resolveApiKey(config, deps, providerName = config.reasoningProvider) {
  if (deps.resolveApiKey) return deps.resolveApiKey(providerName);
  const envName = _providerKeyName(providerName);
  if (envName && process.env[envName]) return process.env[envName];
  if (deps.detectApiProvider) return deps.detectApiProvider(config.reasoningModel)?.apiKey || null;
  return null;
}

function _resolveModelForProvider(providerName, config, currentModel) {
  const configured = providerName ? config?.providers?.[providerName]?.model : null;
  if (typeof configured === "string" && configured) return configured;
  if (providerName === "anthropic") return "claude-sonnet-5.5";
  if (providerName === "openai") return "gpt-6-sol";
  if (providerName === "xai") return "grok-4.7";
  return currentModel || config.reasoningModel || null;
}

async function _runPlannerPhase({ provider, currentModel, apiKey, message, classification, allowlist, cwd, deps, systemPrompt }) {
  if (deps.skipPlanner || typeof provider?.sendTurn !== "function") return { plannerSynthesis: null, plannerToolCalls: [], tokensIn: 0, tokensOut: 0, costUSD: 0, usageKnown: false };
  let tokensIn = 0, tokensOut = 0, costUSD = 0;
  let usageKnown = false;
  try {
    const callPlannerModel = async ({ systemPrompt: sp, userMessage: um }) => {
      const planResp = await provider.sendTurn({
        messages: [{ role: "system", content: sp }, { role: "user", content: um }],
        tools: [],
        model: currentModel,
        apiKey: apiKey || "",
        signal: undefined,
      });
      if (Number.isFinite(planResp.tokensIn) || Number.isFinite(planResp.tokensOut)) usageKnown = true;
      tokensIn += planResp.tokensIn || 0;
      tokensOut += planResp.tokensOut || 0;
      costUSD += computeTurnCost(currentModel, planResp.tokensIn || 0, planResp.tokensOut || 0);
      return planResp.content || "";
    };
    const planResult = await runPlanner({ userMessage: message, classification, lane: classification.lane, allowedTools: allowlist, deps: { callPlannerModel } });
    try { if (typeof deps.onPlan === "function") deps.onPlan(planResult); } catch { /* observer */ }
    if (!planResult.steps || planResult.steps.length === 0) return { plannerSynthesis: null, plannerToolCalls: [], tokensIn, tokensOut, costUSD, usageKnown };

    const planDispatch = async (step) => invokeAllowlisted(
      { tool: step.tool, args: step.args || {}, cwd },
      { resolvedAllowlist: allowlist, dispatcher: deps.dispatcher || (async () => ({})), hub: deps.hub || null },
    );
    const execResult = await executePlan({ steps: planResult.steps }, { dispatch: planDispatch });

    // Issue #153 — record planner-executed steps as tool-call records (source: "planner")
    const plannerToolCalls = execResult.results.map((r) => {
      const outputStr = r.error ? `ERROR: ${r.error}` : (typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? null));
      const summary = outputStr.length > 800 ? outputStr.slice(0, 800) + "…" : outputStr;
      return { name: r.step.tool, args: r.step.args || {}, resultSummary: summary, costUSD: 0, source: "planner", stepId: r.step.id, ...(r.error && { error: r.error }) };
    });
    const lines = execResult.results.map((r) => {
      const status = r.error ? `ERROR: ${r.error}` : "OK";
      const output = r.error ? "(no output)" : (typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? null));
      const trunc = output.length > 800 ? output.slice(0, 800) + "…" : output;
      return `[${r.step.id}] ${r.step.tool} → ${status}\n${trunc}`;
    });
    return { plannerSynthesis: lines.join("\n\n"), plannerToolCalls, tokensIn, tokensOut, costUSD, usageKnown };
  } catch {
    return { plannerSynthesis: null, plannerToolCalls: [], tokensIn, tokensOut, costUSD, usageKnown };
  }
}

async function _runQuorumAdvisory({ deps, classification, message, systemPrompt, autoEscalated, autoToTier }) {
  const quorumAdvisoryMode = deps.quorumAdvisory || "off";
  if (quorumAdvisoryMode === "off" || QUORUM_BLOCKED_LANES.has(classification.lane)) return { quorumResult: null, costUSD: 0 };
  const shouldEngage =
    quorumAdvisoryMode === "always" ||
    (quorumAdvisoryMode === "auto" && classification.lane === LANES.ADVISORY && autoEscalated &&
      autoToTier === "high" && (classification.confidence === "medium" || classification.confidence === "high"));
  if (!shouldEngage) return { quorumResult: null, costUSD: 0 };

  const estimatedCostUSD = QUORUM_MODELS.reduce((sum, m) => sum + computeTurnCost(m.model, 500, 500), 0);
  try { if (typeof deps.onQuorumEstimate === "function") deps.onQuorumEstimate({ type: "quorum-estimate", models: QUORUM_MODELS.map((m) => m.model), estimatedCostUSD, canCancel: true }); } catch { /* observer */ }

  try {
    const quorumResult = await dispatchQuorum({ prompt: message, models: QUORUM_MODELS, deps: { selectProvider, systemPrompt, timeoutMs: undefined } });
    const costUSD = quorumResult?.replies ? quorumResult.replies.reduce((s, r) => s + (r.costUSD || 0), 0) : 0;
    return { quorumResult, costUSD };
  } catch {
    return { quorumResult: null, costUSD: 0 };
  }
}

// Returns { ok: true, response, currentTier, currentModel, fallbackFromTier }
//      or { ok: false, earlyError, currentTier, currentModel, fallbackFromTier, finalReply }
async function _callWithTierFallback({ provider, messages, toolSchemas, currentTier, currentModel, config, apiKey, fallbackFromTier, partialReply }) {
  for (;;) {
    let response;
    try {
      response = await provider.sendTurn({ messages, tools: toolSchemas, model: currentModel, apiKey: apiKey || "", signal: undefined });
    } catch {
      return { ok: false, earlyError: "reasoning_model_unavailable", currentTier, currentModel, fallbackFromTier, finalReply: partialReply };
    }
    if (response.type === "rate_limited") {
      const next = nextTier(currentTier);
      if (next) {
        if (!fallbackFromTier) fallbackFromTier = currentTier;
        currentTier = next;
        currentModel = resolveModel(currentTier, config);
        continue;
      }
      return { ok: false, earlyError: "rate_limited", currentTier, currentModel, fallbackFromTier, finalReply: "" };
    }
    return { ok: true, response, currentTier, currentModel, fallbackFromTier };
  }
}

// Returns { done: false } to continue the loop, or { done: true, truncated, finalReply } on budget-exceeded.
// Mutates conversationMessages and allToolCalls in-place.
async function _dispatchToolCalls({ response, conversationMessages, allToolCalls, allowlist, cwd, deps, effectiveMaxToolCalls }) {
  const reactiveCount = allToolCalls.reduce((n, tc) => (tc.source === "planner" ? n : n + 1), 0);
  if (reactiveCount + response.toolCalls.length > effectiveMaxToolCalls) {
    return { done: true, truncated: true, finalReply: response.content || "(tool budget exceeded — partial response)" };
  }
  const bridgeCalls = response.toolCalls.map((tc) => ({ tool: tc.name, args: tc.args || {}, cwd }));
  const results = await invokeMany(bridgeCalls, { resolvedAllowlist: allowlist, dispatcher: deps.dispatcher || (async () => ({})), hub: deps.hub || null });
  conversationMessages.push({ role: "assistant", content: response.content || null, toolCalls: response.toolCalls });
  for (let i = 0; i < response.toolCalls.length; i++) {
    const tc = response.toolCalls[i];
    const result = results[i];
    allToolCalls.push({ name: tc.name, args: tc.args || {}, resultSummary: result?.summary || result?.error || "", costUSD: result?.costUSD || 0 });
    conversationMessages.push({ role: "tool_result", toolCallId: tc.id, content: result?.summary || result?.error || "no result" });
  }
  return { done: false };
}

async function _executeToolUseLoop({ provider, conversationMessages, toolSchemas, maxIterations, effectiveMaxToolCalls, allowlist, cwd, deps, config, currentTier, currentModel, apiKey, fallbackFromTier, allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD, usageKnown }) {
  let finalReply = "", truncated = false, iterationCount = 0;
  let _currentTier = currentTier, _currentModel = currentModel, _fallbackFromTier = fallbackFromTier;

  while (iterationCount < maxIterations) {
    iterationCount++;
    const callResult = await _callWithTierFallback({ provider, messages: conversationMessages, toolSchemas, currentTier: _currentTier, currentModel: _currentModel, config, apiKey, fallbackFromTier: _fallbackFromTier, partialReply: finalReply });
    if (!callResult.ok) {
      return { earlyError: callResult.earlyError, currentTier: callResult.currentTier, currentModel: callResult.currentModel, fallbackFromTier: callResult.fallbackFromTier, allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD, finalReply: callResult.finalReply, usageKnown };
    }
    _currentTier = callResult.currentTier;
    _currentModel = callResult.currentModel;
    _fallbackFromTier = callResult.fallbackFromTier;
    const { response } = callResult;
    if (Number.isFinite(response.tokensIn) || Number.isFinite(response.tokensOut)) usageKnown = true;
    totalTokensIn += response.tokensIn || 0;
    totalTokensOut += response.tokensOut || 0;
    totalCostUSD += computeTurnCost(_currentModel, response.tokensIn || 0, response.tokensOut || 0);

    if (response.type === "reply") { finalReply = response.content || ""; break; }

    if (response.type === "tool_calls" && response.toolCalls) {
      const toolResult = await _dispatchToolCalls({ response, conversationMessages, allToolCalls, allowlist, cwd, deps, effectiveMaxToolCalls });
      if (toolResult.done) { truncated = toolResult.truncated; finalReply = toolResult.finalReply; break; }
      continue;
    }
    finalReply = response.content || "";
    break;
  }

  if (!finalReply && iterationCount >= maxIterations) { truncated = true; finalReply = "(tool budget exceeded — partial response)"; }
  return { allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD, finalReply, truncated, currentTier: _currentTier, currentModel: _currentModel, fallbackFromTier: _fallbackFromTier, usageKnown };
}

async function _runProviderLoop({ provider, conversationMessages, toolSchemas, effectiveMaxToolCalls, allowlist, cwd, deps, currentModel, allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD, usageKnown, systemPrompt }) {
  const dispatchTool = async (name, args) => invokeAllowlisted(
    { tool: name, args: args || {}, cwd },
    { resolvedAllowlist: allowlist, dispatcher: deps.dispatcher || (async () => ({})), hub: deps.hub || null },
  );
  const response = await provider.runLoop({
    system: systemPrompt,
    messages: conversationMessages,
    tools: toolSchemas,
    dispatchTool,
    maxToolCalls: effectiveMaxToolCalls,
    model: currentModel,
    signal: undefined,
    cwd,
    ...(deps.createCopilotSession ? { createSession: deps.createCopilotSession } : {}),
    ...(deps.copilotSdk ? { sdk: deps.copilotSdk } : {}),
  });
  const resolvedModel = response.model || currentModel;
  const mappedToolCalls = (response.toolCalls || []).map((tc) => ({
    name: tc.name,
    args: tc.args || {},
    resultSummary: tc.result?.summary || tc.result?.error || (typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result ?? null)),
    costUSD: tc.result?.costUSD || 0,
  }));
  const tokensIn = response.tokensIn || 0;
  const tokensOut = response.tokensOut || 0;
  return {
    allToolCalls: [...allToolCalls, ...mappedToolCalls],
    totalTokensIn: totalTokensIn + tokensIn,
    totalTokensOut: totalTokensOut + tokensOut,
    totalCostUSD: totalCostUSD + computeTurnCost(resolvedModel, tokensIn, tokensOut),
    finalReply: response.reply || "",
    truncated: false,
    currentModel: resolvedModel,
    fallbackFromTier: null,
    usageKnown: usageKnown || Number.isFinite(response.tokensIn) || Number.isFinite(response.tokensOut),
  };
}

async function _persistTurnToStores({ isEphemeral, effectiveSessionId, message, classification, finalReply, allToolCalls, totalTokensIn, totalTokensOut, truncated, cwd, deps }) {
  const brainDeps = { recall: deps.recall || (async () => null), remember: deps.remember || (() => ({ ok: true })), cwd };
  try {
    await appendTurn({ sessionId: effectiveSessionId, turn: { role: "turn", userMessage: message, assistantReply: finalReply, toolCalls: allToolCalls, tokensIn: totalTokensIn, tokensOut: totalTokensOut, truncated } }, brainDeps);
    await summarizeIfNeeded({ sessionId: effectiveSessionId }, brainDeps);
  } catch { /* non-fatal */ }
  if (!isEphemeral) {
    try { await storeAppendTurn(effectiveSessionId, { userMessage: message, classification, replyHash: hashReply(finalReply), toolCalls: allToolCalls }, cwd); } catch { /* non-fatal */ }
  }
}

function _notifyClassification(deps, classification) {
  try { if (typeof deps.onClassification === "function") deps.onClassification(classification); } catch { /* observer */ }
}

async function _handleOfftopicTurn({ isEphemeral, effectiveSessionId, message, classification, requestedTier, currentModel, cwd }) {
  if (!isEphemeral) {
    try { await storeAppendTurn(effectiveSessionId, { userMessage: message, classification, replyHash: hashReply(OFFTOPIC_REDIRECT), toolCalls: [] }, cwd); } catch { /* non-fatal */ }
  }
  return { reply: OFFTOPIC_REDIRECT, toolCalls: [], tokensIn: 0, tokensOut: 0, totalCostUSD: 0, usage: buildUsage({ tokensIn: 0, tokensOut: 0, costUSD: 0, model: null, provider: null }), truncated: false, sessionId: effectiveSessionId, requestedTier, resolvedModel: currentModel, fallbackFromTier: null, escalated: false, autoEscalated: false, fromTier: null, toTier: null, reason: null, classification: classification ?? null, relatedTurns: [] };
}

function _formatCrossRunSnap(snap) {
  if (!snap || snap.ok === false || snap.mode !== "cross-run") return;
  const cr = snap.crossRun || snap.snapshot?.crossRun || {};
  const hasAnomalies = Array.isArray(snap.anomalies) && snap.anomalies.length > 0;
  const anomalyLines = hasAnomalies
    ? snap.anomalies.slice(0, 4).map((a) => `  - ${a.code}: ${a.message || ""}`)
    : ["  (none in window)"];
  const retryFlag = cr.retryRateSpike ? " — ⚠" : "";
  const costFlag = cr.costTrend === "up" ? " — ⚠ cost" : "";
  // Build the string for parity; not injected into systemPrompt (already frozen above).
  void (`${snap.totalRuns ?? 0} runs — ${snap.failedRuns ?? 0} failed${retryFlag}${costFlag}\n${anomalyLines.join("\n")}`);
}

function _shouldPreFetchCrossRunContext(classification, message, deps) {
  return classification.lane === LANES.OPERATIONAL
    && /\b(health|audit|failure|retry|gate|slice|plan.health|watcher)\b/i.test(message)
    && !!deps.dispatcher;
}

async function _warmCrossRunContextCache({ cwd, allowlist, deps }) {
  const watchResult = await invokeAllowlisted(
    { tool: "forge_watch", args: { targetPath: cwd || ".", mode: "cross-run" }, cwd },
    { resolvedAllowlist: allowlist, dispatcher: deps.dispatcher, hub: deps.hub || null },
  );
  _formatCrossRunSnap(watchResult?.result ?? watchResult);
}

async function _preFetchCrossRunContext({ classification, message, cwd, allowlist, deps }) {
  if (!_shouldPreFetchCrossRunContext(classification, message, deps)) return;
  // Behavioral parity: original code fetched cross-run context here but systemPrompt was already built.
  // The fetch is preserved for side-effects (watcher cache warm-up); result is not injected.
  try {
    await _warmCrossRunContextCache({ cwd, allowlist, deps });
  } catch { /* non-fatal */ }
}

function _emitTurnComplete(hub, payload) {
  if (hub && typeof hub.broadcast === "function") hub.broadcast({ type: "forge-master.turn-complete", source: "forge-master", worker: "forge-master-reasoning", ...payload });
}

function _turnTelemetrySeed(plannerOut, quorumOut) {
  return {
    allToolCalls: [...plannerOut.plannerToolCalls],
    totalTokensIn: plannerOut.tokensIn,
    totalTokensOut: plannerOut.tokensOut,
    totalCostUSD: plannerOut.costUSD + quorumOut.costUSD,
    usageKnown: plannerOut.usageKnown,
  };
}

function _buildConversationMessages({ systemPrompt, message, plannerSynthesis }) {
  const messages = [{ role: "system", content: systemPrompt }, { role: "user", content: message }];
  if (plannerSynthesis) {
    messages.push({ role: "user", content: `The following tool results were pre-fetched to help answer the query:\n\n${plannerSynthesis}\n\nUse these results to formulate your response. You may call additional tools if needed.` });
  }
  return messages;
}

function _turnMetadata({ effectiveSessionId, requestedTier, resolvedModel, fallbackFromTier = null, autoEscalation, classification, relatedTurns }) {
  return {
    sessionId: effectiveSessionId,
    requestedTier,
    resolvedModel,
    fallbackFromTier,
    escalated: false,
    autoEscalated: autoEscalation.autoEscalated,
    fromTier: autoEscalation.autoFromTier,
    toTier: autoEscalation.autoToTier,
    reason: autoEscalation.autoEscalationReason,
    classification: classification ?? null,
    relatedTurns,
  };
}

function _noProviderResult({ effectiveSessionId, requestedTier, currentModel, autoEscalation, classification, relatedTurns }) {
  return {
    reply: "",
    toolCalls: [],
    tokensIn: 0,
    tokensOut: 0,
    totalCostUSD: 0,
    usage: buildUsage({ tokensIn: null, tokensOut: null, costUSD: null, model: currentModel, provider: null }),
    truncated: false,
    error: "no provider available",
    suggestion: NO_PROVIDER_SUGGESTION,
    ..._turnMetadata({ effectiveSessionId, requestedTier, resolvedModel: currentModel, autoEscalation, classification, relatedTurns }),
  };
}

function _providerLoopErrorResult({ err, telemetry, effectiveSessionId, requestedTier, currentModel, provider, autoEscalation, classification, relatedTurns }) {
  return {
    reply: "",
    toolCalls: telemetry.allToolCalls,
    tokensIn: telemetry.totalTokensIn,
    tokensOut: telemetry.totalTokensOut,
    totalCostUSD: telemetry.totalCostUSD,
    usage: buildUsage({
      tokensIn: telemetry.usageKnown ? telemetry.totalTokensIn : null,
      tokensOut: telemetry.usageKnown ? telemetry.totalTokensOut : null,
      costUSD: telemetry.usageKnown ? telemetry.totalCostUSD : null,
      model: currentModel,
      provider,
    }),
    truncated: false,
    error: err?.code || "reasoning_model_unavailable",
    ..._turnMetadata({ effectiveSessionId, requestedTier, resolvedModel: currentModel, autoEscalation, classification, relatedTurns }),
  };
}

function _earlyLoopErrorResult({ loopResult, effectiveSessionId, requestedTier, provider, autoEscalation, classification, relatedTurns }) {
  return {
    reply: loopResult.finalReply || "",
    toolCalls: loopResult.allToolCalls,
    tokensIn: loopResult.totalTokensIn,
    tokensOut: loopResult.totalTokensOut,
    totalCostUSD: loopResult.totalCostUSD,
    usage: buildUsage({
      tokensIn: loopResult.usageKnown ? loopResult.totalTokensIn : null,
      tokensOut: loopResult.usageKnown ? loopResult.totalTokensOut : null,
      costUSD: loopResult.usageKnown ? loopResult.totalCostUSD : null,
      model: loopResult.currentModel,
      provider: loopResult.providerName ?? provider,
    }),
    truncated: false,
    error: loopResult.earlyError,
    ..._turnMetadata({
      effectiveSessionId,
      requestedTier,
      resolvedModel: loopResult.currentModel,
      fallbackFromTier: loopResult.fallbackFromTier,
      autoEscalation,
      classification,
      relatedTurns,
    }),
  };
}

function _successResult({ loopResult, effectiveSessionId, requestedTier, provider, autoEscalation, classification, relatedTurns, quorumResult }) {
  return {
    reply: loopResult.finalReply,
    toolCalls: loopResult.allToolCalls,
    tokensIn: loopResult.totalTokensIn,
    tokensOut: loopResult.totalTokensOut,
    totalCostUSD: loopResult.totalCostUSD,
    usage: buildUsage({
      tokensIn: loopResult.usageKnown ? loopResult.totalTokensIn : null,
      tokensOut: loopResult.usageKnown ? loopResult.totalTokensOut : null,
      costUSD: loopResult.usageKnown ? loopResult.totalCostUSD : null,
      model: loopResult.currentModel,
      provider: loopResult.providerName ?? provider,
    }),
    truncated: loopResult.truncated,
    ..._turnMetadata({
      effectiveSessionId,
      requestedTier,
      resolvedModel: loopResult.currentModel,
      fallbackFromTier: loopResult.fallbackFromTier,
      autoEscalation,
      classification,
      relatedTurns,
    }),
    quorumResult,
  };
}

async function _executeFallbackLoopAfterProviderError({ err, provider, conversationMessages, toolSchemas, effectiveMaxToolCalls, allowlist, cwd, deps, config, currentTier, currentModel, telemetry, errorContext }) {
  const fallbackProvider = await _resolveFallbackProvider(config, deps, provider);
  if (!fallbackProvider) {
    return { earlyReturn: _providerLoopErrorResult({ err, telemetry, currentModel, provider: provider.PROVIDER_NAME, ...errorContext }) };
  }

  const fallbackModel = _resolveModelForProvider(fallbackProvider.PROVIDER_NAME, config, currentModel);
  const fallbackApiKey = _resolveApiKey(config, deps, fallbackProvider.PROVIDER_NAME);
  return {
    loopResult: {
      ...await _executeToolUseLoop({
      provider: fallbackProvider,
      conversationMessages,
      toolSchemas,
      maxIterations: effectiveMaxToolCalls + 1,
      effectiveMaxToolCalls,
      allowlist,
      cwd,
      deps,
      config,
      currentTier,
      currentModel: fallbackModel,
      apiKey: fallbackApiKey,
      fallbackFromTier: provider.PROVIDER_NAME || "githubCopilot",
      ...telemetry,
      }),
      providerName: fallbackProvider.PROVIDER_NAME,
    },
  };
}

async function _runSdkProviderLoopWithFallback({ provider, conversationMessages, toolSchemas, effectiveMaxToolCalls, allowlist, cwd, deps, currentModel, systemPrompt, telemetry, fallbackOptions, errorContext }) {
  try {
    const loopResult = await _runProviderLoop({
      provider,
      conversationMessages,
      toolSchemas,
      effectiveMaxToolCalls,
      allowlist,
      cwd,
      deps,
      currentModel,
      systemPrompt,
      ...telemetry,
    });
    return { loopResult };
  } catch (err) {
    return _executeFallbackLoopAfterProviderError({ err, provider, conversationMessages, toolSchemas, effectiveMaxToolCalls, allowlist, cwd, deps, currentModel, telemetry, errorContext, ...fallbackOptions });
  }
}

async function _runReactiveLoop({ provider, conversationMessages, toolSchemas, effectiveMaxToolCalls, allowlist, cwd, deps, config, currentTier, currentModel, apiKey, systemPrompt, telemetry, errorContext }) {
  if (typeof provider.runLoop === "function") {
    return _runSdkProviderLoopWithFallback({
      provider,
      conversationMessages,
      toolSchemas,
      effectiveMaxToolCalls,
      allowlist,
      cwd,
      deps,
      currentModel,
      systemPrompt,
      telemetry,
      errorContext,
      fallbackOptions: { config, currentTier },
    });
  }

  return {
    loopResult: await _executeToolUseLoop({
      provider,
      conversationMessages,
      toolSchemas,
      maxIterations: effectiveMaxToolCalls + 1,
      effectiveMaxToolCalls,
      allowlist,
      cwd,
      deps,
      config,
      currentTier,
      currentModel,
      apiKey,
      fallbackFromTier: null,
      ...telemetry,
    }),
  };
}

// ─── Main Reasoning Loop ────────────────────────────────────────────

/**
 * Run a single reasoning turn: classify → retrieve → loop → reply.
 *
 * @param {{
 *   message: string,
 *   sessionId?: string,
 *   maxToolCalls?: number,
 *   cwd?: string,
 *   tier?: "low"|"medium"|"high",
 *   model?: string,
 * }} input
 * @param {{
 *   provider?: { sendTurn: Function },
 *   dispatcher?: Function,
 *   hub?: { broadcast: Function } | null,
 *   toolMetadata?: Record<string, object>,
 *   callApiWorker?: Function,
 *   detectApiProvider?: Function,
 *   resolveApiKey?: (provider: string) => string | null,
 *   forceKeywordOnly?: boolean, — when true, skip stage-2 router-model in classify()
 *   resolvedAllowlist?: string[], — override computed allowlist (test injection)
 *   sessionId?: string, — file-based session store ID; "ephemeral" suppresses disk writes
 * }} [deps] — injected dependencies for testability
 * @returns {Promise<{
 *   reply: string,
 *   toolCalls: Array<{name: string, args: object, resultSummary: string, costUSD: number}>,
 *   tokensIn: number,
 *   tokensOut: number,
 *   totalCostUSD: number,
 *   truncated: boolean,
 *   error?: string,
 *   requestedTier: string|null,
 *   resolvedModel: string|null,
 *   fallbackFromTier: string|null,
 *   escalated: boolean,
 *   autoEscalated: boolean,
 *   fromTier: string|null,
 *   toTier: string|null,
 *   reason: string|null,
 *   relatedTurns: Array<{turnId:string,sessionId:string,timestamp:string,userMessage:string,lane:string,replyHash:string,score:number}>,
 * }>}
 */
async function _prepareTurn(input, deps) {
  const norm = normalizeTurnInput(input);
  if (!norm.ok) return { done: true, result: invalidInputResult(norm) };
  input = norm.input;
  const { message, cwd } = input;
  const config = deps.config ?? getForgeMasterConfig({ cwd });
  const effectiveSessionId = ensureSessionId(deps.sessionId ?? input.sessionId);
  const isEphemeral = !effectiveSessionId || effectiveSessionId === "ephemeral";
  const priorTurns = await _loadPriorTurns(effectiveSessionId, isEphemeral, cwd);
  const tierState = _resolveTierState(input, config);
  const { inputModel, requestedTier } = tierState;
  const { currentModel } = tierState;

  const classification = await classify(message, { cwd, keywordOnly: deps.forceKeywordOnly || false, callApiWorker: deps.callApiWorker, detectApiProvider: deps.detectApiProvider, priorTurns });
  _notifyClassification(deps, classification);

  if (classification.lane === LANES.OFFTOPIC) {
    return {
      done: true,
      result: await _handleOfftopicTurn({ isEphemeral, effectiveSessionId, message, classification, requestedTier, currentModel, cwd }),
    };
  }
  return { done: false, input, inputTruncated: norm.truncated, deps, config, effectiveSessionId, isEphemeral, priorTurns, tierState, classification };
}

async function _runPreparedTurn({ input, deps, config, effectiveSessionId, isEphemeral, priorTurns, tierState, classification }) {
  const { message, cwd } = input;
  const { inputModel, requestedTier } = tierState;
  let { currentTier, currentModel } = tierState;

  // ── Auto-escalation ───────────────────────────────────────────────
  const esc = _applyAutoEscalation({ inputModel: inputModel, currentTier: currentTier, currentModel: currentModel, config: config, classification: classification });
  currentTier = esc.currentTier;
  currentModel = esc.currentModel;
  const autoEscalation = {
    autoEscalated: esc.autoEscalated,
    autoFromTier: esc.autoFromTier,
    autoToTier: esc.autoToTier,
    autoEscalationReason: esc.autoEscalationReason,
  };

  // ── 2. Build context block (memory, recall, patterns, prior turns) ─
  const { contextBlock, relatedTurns } = await _buildContextBlock({ effectiveSessionId, isEphemeral, classification, message, cwd, priorTurns, deps });

  // ── 3. Load system prompt (with lane overlay) ─────────────────────
  const systemPrompt = loadSystemPrompt(contextBlock, _loadPrinciplesBlock(cwd), classification?.lane);

  // ── 4. Resolve allowlist + tool schemas ───────────────────────────
  const allowlist = deps.resolvedAllowlist ?? resolveAllowlist({ toolMetadata: deps.toolMetadata || {}, discoverExtensionTools: config.discoverExtensionTools });
  const toolSchemas = buildToolSchemas(allowlist);

  // ── 4a. Cross-run watcher pre-fetch (operational lane parity) ─────
  await _preFetchCrossRunContext({ classification, message, cwd, allowlist, deps });

  // ── 5. Resolve provider + API key ─────────────────────────────────
  const provider = await _resolveProvider(config, deps);
  if (!provider) {
    return _noProviderResult({ effectiveSessionId, requestedTier, currentModel, autoEscalation, classification, relatedTurns });
  }
  const apiKey = _resolveApiKey(config, deps, provider.PROVIDER_NAME);

  // ── 6a. Proactive planner + executor ──────────────────────────────
  const plannerOut = await _runPlannerPhase({ provider, currentModel, apiKey, message, classification, allowlist, cwd, deps, systemPrompt });
  const effectiveMaxToolCalls = Math.min(input.maxToolCalls ?? config.maxToolCalls, ABSOLUTE_CEILING);

  // ── 6b. Quorum advisory fan-out ───────────────────────────────────
  const quorumOut = await _runQuorumAdvisory({ deps, classification, message, systemPrompt, autoEscalated: autoEscalation.autoEscalated, autoToTier: autoEscalation.autoToTier });

  // ── 7. Tool-use loop ──────────────────────────────────────────────
  const conversationMessages = _buildConversationMessages({ systemPrompt, message, plannerSynthesis: plannerOut.plannerSynthesis });
  const telemetry = _turnTelemetrySeed(plannerOut, quorumOut);
  const errorContext = { effectiveSessionId, requestedTier, autoEscalation, classification, relatedTurns, provider: provider.PROVIDER_NAME };
  const { loopResult, earlyReturn } = await _runReactiveLoop({
    provider,
    conversationMessages,
    toolSchemas,
    effectiveMaxToolCalls,
    allowlist,
    cwd,
    deps,
    config,
    currentTier,
    currentModel,
    apiKey,
    systemPrompt,
    telemetry,
    errorContext,
  });
  if (earlyReturn) return earlyReturn;

  if (loopResult.earlyError) {
    return _earlyLoopErrorResult({ loopResult, effectiveSessionId, requestedTier, provider: provider.PROVIDER_NAME, autoEscalation, classification, relatedTurns });
  }

  // ── 8. Persist + emit ─────────────────────────────────────────────
  await _persistTurnToStores({ isEphemeral, effectiveSessionId, message, classification, finalReply: loopResult.finalReply, allToolCalls: loopResult.allToolCalls, totalTokensIn: loopResult.totalTokensIn, totalTokensOut: loopResult.totalTokensOut, truncated: loopResult.truncated, cwd, deps });
  _emitTurnComplete(deps.hub, { tokensIn: loopResult.totalTokensIn, tokensOut: loopResult.totalTokensOut, toolCallCount: loopResult.allToolCalls.length, truncated: loopResult.truncated, sessionId: effectiveSessionId, timestamp: new Date().toISOString() });

  return _successResult({ loopResult, effectiveSessionId, requestedTier, provider: provider.PROVIDER_NAME, autoEscalation, classification, relatedTurns, quorumResult: quorumOut.quorumResult });
}

export async function runTurn(input, deps = {}) {
  const prepared = await _prepareTurn(input, deps);
  if (prepared.done) return prepared.result;
  return _runPreparedTurn(prepared);
}

// ─── Observer Reasoning Turn ────────────────────────────────────────

function getObserverBudgetFns(opts) {
  return {
    checkBudgetFn: opts._checkBudget ?? checkBudget,
    recordSpendFn: opts._recordSpend ?? recordSpend,
    loadBudgetStateFn: opts._loadBudgetState ?? loadBudgetState,
    saveBudgetStateFn: opts._saveBudgetState ?? saveBudgetState,
  };
}

function resolveObserverConfigBlock(config) {
  return config?.observer && typeof config.observer === "object"
    ? config.observer
    : config;
}

function buildObserverCaps(observerConfig) {
  return {
    maxUsdPerDay: observerConfig.maxUsdPerDay ?? 1.0,
    maxNarrationsPerHour: observerConfig.maxNarrationsPerHour ?? 6,
  };
}

function blockObserverBudget(hub, budgetCheck) {
  console.error(`[observer] budget block: ${budgetCheck.reason}`);
  if (hub && typeof hub.broadcast === "function") {
    hub.broadcast({
      type: "observer:budget-blocked",
      reason: budgetCheck.reason,
      timestamp: new Date().toISOString(),
    });
  }
  return { ok: false, skipped: true, reason: budgetCheck.reason, narration: null };
}

function checkObserverBudgetGate({ opts, cwd, loadBudgetStateFn, checkBudgetFn, caps, hub }) {
  const state = opts.budgetState ?? loadBudgetStateFn({ cwd });
  const budgetCheck = checkBudgetFn(state, caps);
  if (!budgetCheck.ok) {
    return { state: null, blocked: blockObserverBudget(hub, budgetCheck) };
  }
  return { state, blocked: null };
}

async function resolveObserverProvider(opts, config) {
  return opts.provider ?? autoSelectProvider(config, process.env, opts._providers ?? null);
}

function resolveObserverModel(config, observerConfig) {
  const modelTier = observerConfig.modelTier ?? null;
  return (modelTier ? resolveModel(modelTier, config) : null)
    ?? config?.reasoningModel
    ?? null;
}

async function callObserverModel(provider, resolvedModel, batch) {
  const { systemPrompt, userMessage } = buildObserverPrompt(batch);
  if (typeof provider.runLoop === "function") {
    const response = await provider.runLoop({
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: buildToolSchemas(OBSERVER_TOOL_ALLOWLIST),
      dispatchTool: async () => ({ error: "observer_tool_execution_disabled" }),
      maxToolCalls: 0,
      model: resolvedModel,
    });
    return { content: response.reply, tokensIn: response.tokensIn || 0, tokensOut: response.tokensOut || 0 };
  }
  return provider.sendTurn({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    tools: buildToolSchemas(OBSERVER_TOOL_ALLOWLIST),
    model: resolvedModel,
    apiKey: "",
  });
}

function saveObserverBudgetState(saveBudgetStateFn, updatedState, cwd) {
  try {
    saveBudgetStateFn(updatedState, { cwd });
  } catch (err) {
    console.error(`[observer] budget state save failed (non-fatal): ${err?.message ?? err}`);
  }
}

function captureObserverNarration({ observerConfig, rememberFn, batch, narration, usd }) {
  if (observerConfig.brainCapture === false || typeof rememberFn !== "function") return;

  try {
    const captureKey = `project.observer.narration-${Date.now()}`;
    rememberFn(captureKey, {
      timestamp: new Date().toISOString(),
      narration,
      batchEventCount: Array.isArray(batch) ? batch.length : 0,
      usd,
    });
  } catch (err) {
    console.error(`[observer] brain capture failed (non-fatal): ${err?.message ?? err}`);
  }
}

function emitObserverNarration({ hub, batch, narration, usd, observerConfig }) {
  if (!hub || typeof hub.broadcast !== "function") return;

  hub.broadcast({
    type: OBSERVER_NARRATION_EVENT_TYPE,
    timestamp: new Date().toISOString(),
    batchEventCount: Array.isArray(batch) ? batch.length : 0,
    narration,
    usd,
    modelTier: observerConfig.modelTier ?? null,
  });
}

/**
 * Run a single observer narration turn: check budget → call model → capture → emit.
 *
 * Called by the observer loop's `onBatch` callback once per batch flush.
 * The function is strictly fail-closed on budget: it MUST NOT make any LLM call
 * when `checkBudget()` returns `{ ok: false }`.
 *
 * @param {object[]} batch  Hub events from observer-loop's batch flush.
 * @param {{
 *   config?: object,            Forge-Master config (getForgeMasterConfig() result).
 *                               Reads: config.observer.{maxUsdPerDay, maxNarrationsPerHour,
 *                                      modelTier, brainCapture}, config.reasoningModel.
 *   provider?: object,          Pre-resolved provider adapter with sendTurn(). Auto-selected if absent.
 *   hub?: object|null,          Hub for broadcasting observer:narration + observer:budget-blocked.
 *   cwd?: string,               Working directory (for budget state I/O and provider auto-select).
 *   remember?: Function,        brain.remember-compatible fn for L2 narration capture (optional).
 *   budgetState?: object,       Pre-loaded budget state (test injection — skips loadBudgetState).
 *   _checkBudget?: Function,    checkBudget override for testing.
 *   _recordSpend?: Function,    recordSpend override for testing.
 *   _loadBudgetState?: Function loadBudgetState override for testing.
 *   _saveBudgetState?: Function saveBudgetState override for testing.
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: boolean,    true when budget blocked (no LLM call occurred)
 *   reason?: string,      human-readable block/error reason
 *   narration?: string|null,
 *   tokensIn?: number,
 *   tokensOut?: number,
 *   usd?: number,
 * }>}
 */
export async function runObserverTurn(batch, opts = {}) {
  const {
    config = {},
    hub = null,
    cwd = process.cwd(),
    remember: _remember = null,
  } = opts;
  const { checkBudgetFn, recordSpendFn, loadBudgetStateFn, saveBudgetStateFn } = getObserverBudgetFns(opts);
  const observerConfig = resolveObserverConfigBlock(config);
  const budgetGate = checkObserverBudgetGate(
    { opts: opts, cwd: cwd, loadBudgetStateFn: loadBudgetStateFn, checkBudgetFn: checkBudgetFn, caps: buildObserverCaps(observerConfig), hub: hub },
  );

  if (budgetGate.blocked) {
    return budgetGate.blocked;
  }

  const provider = await resolveObserverProvider(opts, config);
  if (!provider) {
    return { ok: false, skipped: false, reason: "no provider available", narration: null };
  }

  const resolvedModel = resolveObserverModel(config, observerConfig);

  let response;
  try {
    response = await callObserverModel(provider, resolvedModel, batch);
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      reason: `model error: ${err?.message ?? String(err)}`,
      narration: null,
    };
  }

  const narration = response.content || "";
  const tokensIn = response.tokensIn || 0;
  const tokensOut = response.tokensOut || 0;
  const usd = computeTurnCost(resolvedModel, tokensIn, tokensOut);
  const updatedState = recordSpendFn(budgetGate.state, { usd, timestamp: Date.now() });

  saveObserverBudgetState(saveBudgetStateFn, updatedState, cwd);
  captureObserverNarration({ observerConfig: observerConfig, rememberFn: _remember, batch: batch, narration: narration, usd: usd });
  emitObserverNarration({ hub: hub, batch: batch, narration: narration, usd: usd, observerConfig: observerConfig });

  return { ok: true, narration, tokensIn, tokensOut, usd };
}
