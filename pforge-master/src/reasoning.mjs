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

// ─── Recall-eligible lanes ────────────────────────────────────────────

const RECALL_LANES = new Set([LANES.OPERATIONAL, LANES.TROUBLESHOOT, LANES.ADVISORY]);

// ─── Quorum advisory — model set for multi-model fan-out ────────────

const QUORUM_MODELS = [
  { model: "claude-sonnet-4-20250514", provider: "anthropic" },
  { model: "gpt-5.2", provider: "openai" },
  { model: "grok-4.20", provider: "xai" },
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
  "Install GitHub CLI and run 'gh auth login', or set GITHUB_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, or XAI_API_KEY";

const AUTO_SELECT_ORDER = ["githubCopilot", "anthropic", "openai", "xai"];

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
 * Iterates `["githubCopilot", "anthropic", "openai", "xai"]` unless
 * `config.defaultProvider` overrides the starting position.
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
      isAvailable: () => githubCopilotProvider.isAvailable(),
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
 * Substitutes {principles_block} first (non-negotiable, never truncated),
 * then {context_block} (may have been pre-trimmed by retrieval.mjs).
 *
 * @param {string} contextBlock   — pre-fetched and truncated memory context
 * @param {string} principlesBlock — active principles (from loadPrinciples or UNIVERSAL_BASELINE)
 * @returns {string}
 */
function loadSystemPrompt(contextBlock, principlesBlock) {
  try {
    const raw = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
    return raw
      .replace("{principles_block}", principlesBlock || UNIVERSAL_BASELINE)
      .replace("{context_block}", contextBlock || "(no context available)");
  } catch {
    return `You are Forge-Master, a Plan Forge reasoning assistant.\n\n## Philosophy & Guardrails\n\n${principlesBlock || UNIVERSAL_BASELINE}\n\n## Current Context\n\n${contextBlock || "(no context available)"}`;
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

function _applyAutoEscalation(inputModel, currentTier, currentModel, config, classification) {
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
    provider = config.reasoningProvider
      ? await selectProvider(config.reasoningProvider)
      : await autoSelectProvider(config, process.env, deps._providers || null);
  }
  return provider;
}

function _resolveApiKey(config, deps) {
  if (deps.resolveApiKey) return deps.resolveApiKey(config.reasoningProvider);
  if (deps.detectApiProvider) return deps.detectApiProvider(config.reasoningModel)?.apiKey || null;
  return null;
}

async function _runPlannerPhase({ provider, currentModel, apiKey, message, classification, allowlist, cwd, deps, systemPrompt }) {
  if (deps.skipPlanner) return { plannerSynthesis: null, plannerToolCalls: [], tokensIn: 0, tokensOut: 0, costUSD: 0 };
  let tokensIn = 0, tokensOut = 0, costUSD = 0;
  try {
    const callPlannerModel = async ({ systemPrompt: sp, userMessage: um }) => {
      const planResp = await provider.sendTurn({
        messages: [{ role: "system", content: sp }, { role: "user", content: um }],
        tools: [],
        model: currentModel,
        apiKey: apiKey || "",
        signal: undefined,
      });
      tokensIn += planResp.tokensIn || 0;
      tokensOut += planResp.tokensOut || 0;
      costUSD += computeTurnCost(currentModel, planResp.tokensIn || 0, planResp.tokensOut || 0);
      return planResp.content || "";
    };
    const planResult = await runPlanner({ userMessage: message, classification, lane: classification.lane, allowedTools: allowlist, deps: { callPlannerModel } });
    try { if (typeof deps.onPlan === "function") deps.onPlan(planResult); } catch { /* observer */ }
    if (!planResult.steps || planResult.steps.length === 0) return { plannerSynthesis: null, plannerToolCalls: [], tokensIn, tokensOut, costUSD };

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
    return { plannerSynthesis: lines.join("\n\n"), plannerToolCalls, tokensIn, tokensOut, costUSD };
  } catch {
    return { plannerSynthesis: null, plannerToolCalls: [], tokensIn, tokensOut, costUSD };
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

async function _executeToolUseLoop({ provider, conversationMessages, toolSchemas, maxIterations, effectiveMaxToolCalls, allowlist, cwd, deps, config, currentTier, currentModel, apiKey, fallbackFromTier, allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD }) {
  let finalReply = "", truncated = false, iterationCount = 0;
  let _currentTier = currentTier, _currentModel = currentModel, _fallbackFromTier = fallbackFromTier;

  while (iterationCount < maxIterations) {
    iterationCount++;
    const callResult = await _callWithTierFallback({ provider, messages: conversationMessages, toolSchemas, currentTier: _currentTier, currentModel: _currentModel, config, apiKey, fallbackFromTier: _fallbackFromTier, partialReply: finalReply });
    if (!callResult.ok) {
      return { earlyError: callResult.earlyError, currentTier: callResult.currentTier, currentModel: callResult.currentModel, fallbackFromTier: callResult.fallbackFromTier, allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD, finalReply: callResult.finalReply };
    }
    _currentTier = callResult.currentTier;
    _currentModel = callResult.currentModel;
    _fallbackFromTier = callResult.fallbackFromTier;
    const { response } = callResult;
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
  return { allToolCalls, totalTokensIn, totalTokensOut, totalCostUSD, finalReply, truncated, currentTier: _currentTier, currentModel: _currentModel, fallbackFromTier: _fallbackFromTier };
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
  return { reply: OFFTOPIC_REDIRECT, toolCalls: [], tokensIn: 0, tokensOut: 0, totalCostUSD: 0, truncated: false, sessionId: effectiveSessionId, requestedTier, resolvedModel: currentModel, fallbackFromTier: null, escalated: false, autoEscalated: false, fromTier: null, toTier: null, reason: null, classification: classification ?? null, relatedTurns: [] };
}

async function _preFetchCrossRunContext({ classification, message, cwd, allowlist, deps }) {
  if (classification.lane !== LANES.OPERATIONAL) return;
  if (!/\b(health|audit|failure|retry|gate|slice|plan.health|watcher)\b/i.test(message)) return;
  if (!deps.dispatcher) return;
  // Behavioral parity: original code fetched cross-run context here but systemPrompt was already built.
  // The fetch is preserved for side-effects (watcher cache warm-up); result is not injected.
  try {
    const watchResult = await invokeAllowlisted({ tool: "forge_watch", args: { targetPath: cwd || ".", mode: "cross-run" }, cwd }, { resolvedAllowlist: allowlist, dispatcher: deps.dispatcher, hub: deps.hub || null });
    const snap = watchResult?.result ?? watchResult;
    if (snap && snap.ok !== false && snap.mode === "cross-run") {
      const cr = snap.crossRun || snap.snapshot?.crossRun || {};
      const anomalyLines = Array.isArray(snap.anomalies) && snap.anomalies.length > 0 ? snap.anomalies.slice(0, 4).map((a) => `  - ${a.code}: ${a.message || ""}`) : ["  (none in window)"];
      // Build the string for parity; not injected into systemPrompt (already frozen above).
      void (`${snap.totalRuns ?? 0} runs — ${snap.failedRuns ?? 0} failed${cr.retryRateSpike ? " — ⚠" : ""}${cr.costTrend === "up" ? " — ⚠ cost" : ""}\n${anomalyLines.join("\n")}`);
    }
  } catch { /* non-fatal */ }
}

function _emitTurnComplete(hub, payload) {
  if (hub && typeof hub.broadcast === "function") hub.broadcast({ type: "forge-master.turn-complete", source: "forge-master", worker: "forge-master-reasoning", ...payload });
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
export async function runTurn(input, deps = {}) {
  const { message, cwd } = input;
  const config = getForgeMasterConfig({ cwd });
  const effectiveSessionId = ensureSessionId(deps.sessionId ?? input.sessionId);
  const isEphemeral = !effectiveSessionId || effectiveSessionId === "ephemeral";

  const priorTurns = await _loadPriorTurns(effectiveSessionId, isEphemeral, cwd);
  const tierState = _resolveTierState(input, config);
  const { inputModel, requestedTier } = tierState;
  let { currentTier, currentModel } = tierState;

  // ── 1. Intent classification ──────────────────────────────────────
  const classification = await classify(message, { cwd, keywordOnly: deps.forceKeywordOnly || false, callApiWorker: deps.callApiWorker, detectApiProvider: deps.detectApiProvider, priorTurns });
  _notifyClassification(deps, classification);

  if (classification.lane === LANES.OFFTOPIC) {
    return _handleOfftopicTurn({ isEphemeral, effectiveSessionId, message, classification, requestedTier, currentModel, cwd });
  }

  // ── Auto-escalation ───────────────────────────────────────────────
  const esc = _applyAutoEscalation(inputModel, currentTier, currentModel, config, classification);
  currentTier = esc.currentTier;
  currentModel = esc.currentModel;
  const { autoEscalated, autoFromTier, autoToTier, autoEscalationReason } = esc;

  // ── 2. Build context block (memory, recall, patterns, prior turns) ─
  const { contextBlock, relatedTurns } = await _buildContextBlock({ effectiveSessionId, isEphemeral, classification, message, cwd, priorTurns, deps });

  // ── 3. Load system prompt ─────────────────────────────────────────
  const systemPrompt = loadSystemPrompt(contextBlock, _loadPrinciplesBlock(cwd));

  // ── 4. Resolve allowlist + tool schemas ───────────────────────────
  const allowlist = deps.resolvedAllowlist ?? resolveAllowlist({ toolMetadata: deps.toolMetadata || {}, discoverExtensionTools: config.discoverExtensionTools });
  const toolSchemas = buildToolSchemas(allowlist);

  // ── 4a. Cross-run watcher pre-fetch (operational lane parity) ─────
  await _preFetchCrossRunContext({ classification, message, cwd, allowlist, deps });

  // ── 5. Resolve provider + API key ─────────────────────────────────
  const provider = await _resolveProvider(config, deps);
  if (!provider) {
    return { reply: "", toolCalls: [], tokensIn: 0, tokensOut: 0, totalCostUSD: 0, truncated: false, error: "no provider available", suggestion: NO_PROVIDER_SUGGESTION, sessionId: effectiveSessionId, requestedTier, resolvedModel: currentModel, fallbackFromTier: null, escalated: false, autoEscalated, fromTier: autoFromTier, toTier: autoToTier, reason: autoEscalationReason, classification: classification ?? null, relatedTurns };
  }
  const apiKey = _resolveApiKey(config, deps);

  // ── 6a. Proactive planner + executor ──────────────────────────────
  const plannerOut = await _runPlannerPhase({ provider, currentModel, apiKey, message, classification, allowlist, cwd, deps, systemPrompt });
  const allToolCalls = [...plannerOut.plannerToolCalls];
  const effectiveMaxToolCalls = Math.min(input.maxToolCalls ?? config.maxToolCalls, ABSOLUTE_CEILING);

  // ── 6b. Quorum advisory fan-out ───────────────────────────────────
  const quorumOut = await _runQuorumAdvisory({ deps, classification, message, systemPrompt, autoEscalated, autoToTier });

  // ── 7. Tool-use loop ──────────────────────────────────────────────
  const conversationMessages = [{ role: "system", content: systemPrompt }, { role: "user", content: message }];
  if (plannerOut.plannerSynthesis) {
    conversationMessages.push({ role: "user", content: `The following tool results were pre-fetched to help answer the query:\n\n${plannerOut.plannerSynthesis}\n\nUse these results to formulate your response. You may call additional tools if needed.` });
  }

  const loopResult = await _executeToolUseLoop({ provider, conversationMessages, toolSchemas, maxIterations: effectiveMaxToolCalls + 1, effectiveMaxToolCalls, allowlist, cwd, deps, config, currentTier, currentModel, apiKey, fallbackFromTier: null, allToolCalls, totalTokensIn: plannerOut.tokensIn, totalTokensOut: plannerOut.tokensOut, totalCostUSD: plannerOut.costUSD + quorumOut.costUSD });

  if (loopResult.earlyError) {
    return { reply: loopResult.finalReply || "", toolCalls: loopResult.allToolCalls, tokensIn: loopResult.totalTokensIn, tokensOut: loopResult.totalTokensOut, totalCostUSD: loopResult.totalCostUSD, truncated: false, error: loopResult.earlyError, sessionId: effectiveSessionId, requestedTier, resolvedModel: loopResult.currentModel, fallbackFromTier: loopResult.fallbackFromTier, escalated: false, autoEscalated, fromTier: autoFromTier, toTier: autoToTier, reason: autoEscalationReason, classification: classification ?? null, relatedTurns };
  }

  // ── 8. Persist + emit ─────────────────────────────────────────────
  await _persistTurnToStores({ isEphemeral, effectiveSessionId, message, classification, finalReply: loopResult.finalReply, allToolCalls: loopResult.allToolCalls, totalTokensIn: loopResult.totalTokensIn, totalTokensOut: loopResult.totalTokensOut, truncated: loopResult.truncated, cwd, deps });
  _emitTurnComplete(deps.hub, { tokensIn: loopResult.totalTokensIn, tokensOut: loopResult.totalTokensOut, toolCallCount: loopResult.allToolCalls.length, truncated: loopResult.truncated, sessionId: effectiveSessionId, timestamp: new Date().toISOString() });

  return {
    reply: loopResult.finalReply,
    toolCalls: loopResult.allToolCalls,
    tokensIn: loopResult.totalTokensIn,
    tokensOut: loopResult.totalTokensOut,
    totalCostUSD: loopResult.totalCostUSD,
    truncated: loopResult.truncated,
    sessionId: effectiveSessionId,
    requestedTier,
    resolvedModel: loopResult.currentModel,
    fallbackFromTier: loopResult.fallbackFromTier,
    escalated: false,
    autoEscalated,
    fromTier: autoFromTier,
    toTier: autoToTier,
    reason: autoEscalationReason,
    classification: classification ?? null,
    relatedTurns,
    quorumResult: quorumOut.quorumResult,
  };
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

function checkObserverBudgetGate(opts, cwd, loadBudgetStateFn, checkBudgetFn, caps, hub) {
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

function captureObserverNarration(observerConfig, rememberFn, batch, narration, usd) {
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

function emitObserverNarration(hub, batch, narration, usd, observerConfig) {
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
    opts,
    cwd,
    loadBudgetStateFn,
    checkBudgetFn,
    buildObserverCaps(observerConfig),
    hub,
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
  captureObserverNarration(observerConfig, _remember, batch, narration, usd);
  emitObserverNarration(hub, batch, narration, usd, observerConfig);

  return { ok: true, narration, tokensIn, tokensOut, usd };
}
