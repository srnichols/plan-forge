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

  // ── Session store: load prior turns for context ───────────────────
  // Non-ephemeral sessions surface the last 10 turns before classification.
  let priorTurns = [];
  if (!isEphemeral) {
    try {
      const all = await loadSession(effectiveSessionId, cwd);
      priorTurns = all.slice(-10);
    } catch { /* non-fatal — proceed without prior context */ }
  }

  // ── Tier / model resolution ───────────────────────────────────────
  // Explicit `input.model` takes precedence and bypasses tier logic entirely.
  const inputModel = typeof input.model === "string" ? input.model : null;
  const rawInputTier = input.tier ?? null;
  const requestedTier = !inputModel && rawInputTier && VALID_TIERS.includes(rawInputTier)
    ? rawInputTier
    : (!inputModel && config.defaultTier ? config.defaultTier : null);
  let currentTier = requestedTier;
  let currentModel = inputModel ?? resolveModel(currentTier, config);
  let fallbackFromTier = null;

  const effectiveMaxToolCalls = Math.min(
    input.maxToolCalls ?? config.maxToolCalls,
    ABSOLUTE_CEILING,
  );

  // ── Auto-escalation state ────────────────────────────────────────
  let autoEscalated = false;
  let autoFromTier = null;
  let autoToTier = null;
  let autoEscalationReason = null;

  // ── 1. Intent classification ──────────────────────────────────────
  const classification = await classify(message, {
    cwd,
    keywordOnly: deps.forceKeywordOnly || false,
    callApiWorker: deps.callApiWorker,
    detectApiProvider: deps.detectApiProvider,
    priorTurns,
  });

  // Notify observer (non-fatal — SSE/observability hook)
  try {
    if (typeof deps.onClassification === "function") {
      deps.onClassification(classification);
    }
  } catch { /* observer errors must not affect reasoning */ }

  // Off-topic short-circuit — no model call, no tool calls, near-zero cost
  if (classification.lane === LANES.OFFTOPIC) {
    // Persist offtopic turns so conversation history is accurate
    if (!isEphemeral) {
      try {
        await storeAppendTurn(effectiveSessionId, {
          userMessage: message,
          classification,
          replyHash: hashReply(OFFTOPIC_REDIRECT),
          toolCalls: [],
        }, cwd);
      } catch { /* non-fatal */ }
    }
    return {
      reply: OFFTOPIC_REDIRECT,
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      totalCostUSD: 0,
      truncated: false,
      sessionId: effectiveSessionId,
      requestedTier,
      resolvedModel: currentModel,
      fallbackFromTier: null,
      escalated: false,
      autoEscalated: false,
      fromTier: null,
      toTier: null,
      reason: null,
      classification: classification ?? null,
      relatedTurns: [],
    };
  }

  // ── Auto-escalation for high-stakes lanes ─────────────────────────
  if (!inputModel && currentTier && config.autoEscalate &&
      LANE_DESCRIPTORS[classification.lane]?.recommendedTierBump > 0) {
    const escalated = escalateTier(currentTier);
    if (escalated) {
      autoEscalated = true;
      autoFromTier = currentTier;
      autoToTier = escalated;
      autoEscalationReason = `high-stakes lane: ${classification.lane}`;
      currentTier = escalated;
      currentModel = resolveModel(currentTier, config);
    }
  }

  // ── 2. Fetch memory context ───────────────────────────────────────
  let contextBlock = "";
  try {
    const ctx = await fetchContext(
      { sessionId: effectiveSessionId, lane: classification.lane, cwd },
      deps,
    );
    contextBlock = ctx.contextBlock;
  } catch { /* non-fatal — proceed without context */ }

  // ── 2a. Cross-session recall (advisory context injection) ─────────
  // Query the BM25 recall index for top-3 prior turns semantically
  // related to this message. Only active for non-ephemeral sessions
  // on recall-eligible lanes (operational, troubleshoot, advisory).
  // Recall failure is always non-fatal — it must never fail the turn.
  let relatedTurns = [];
  if (!isEphemeral && RECALL_LANES.has(classification.lane)) {
    try {
      await loadIndex(cwd);
      relatedTurns = await queryIndex(message, { topK: 3, projectDir: cwd });
    } catch (err) {
      console.warn("[forge-master] recall-index query failed (non-fatal):", err?.message);
      relatedTurns = [];
    }
    if (relatedTurns.length > 0) {
      const recallLines = relatedTurns.map((r) => {
        const ts = r.timestamp ? r.timestamp.slice(0, 10) : "unknown";
        return `- [${ts} · ${r.lane}] "${r.userMessage}"`;
      });
      const recallBlock = `> **Recall (advisory):**\n${recallLines.join("\n")}`;
      contextBlock = `${contextBlock}\n\n${recallBlock}`.trimStart();
    }
  }

  // ── 2b. Pattern surfacing (troubleshoot context injection) ─────────
  // When the troubleshoot lane fires, run pattern detectors over run
  // history. If ≥ 1 recurring pattern is found, inject summaries into
  // the context block as advisory observations.
  // Pattern failure is always non-fatal — it must never fail the turn.
  let surfacedPatterns = [];
  if (classification.lane === LANES.TROUBLESHOOT) {
    try {
      const detectPatterns = deps.detectPatterns || null;
      if (typeof detectPatterns === "function") {
        surfacedPatterns = await detectPatterns({ cwd });
      }
    } catch {
      surfacedPatterns = [];
    }
    if (surfacedPatterns.length > 0) {
      const patternLines = surfacedPatterns.slice(0, 3).map(
        (p) => `> **Recurring pattern observed:** ${p.title || p.summary || p.id}`
      );
      contextBlock = `${contextBlock}\n\n${patternLines.join("\n")}`.trimStart();
    }
  }

  // Inject prior conversation turns into the context block so the model
  // has awareness of the current session history (user messages only;
  // reply text is not stored — only its hash).
  if (priorTurns.length > 0) {
    const priorBlock = priorTurns
      .map((t) => `Turn ${t.turn}: User: "${t.userMessage}"`)
      .join("\n");
    contextBlock = `## Prior conversation turns (oldest first)\n\n${priorBlock}\n\n${contextBlock}`;
  }

  // ── 3. Load system prompt ─────────────────────────────────────────
  // Principles are loaded separately and substituted before context_block;
  // they are NOT subject to the 4000-token context cap in retrieval.mjs.
  let principlesBlock = UNIVERSAL_BASELINE;
  try {
    const { block } = loadPrinciples({ cwd });
    principlesBlock = block;
  } catch (err) {
    console.warn("[forge-master] principles loader failed, using universal baseline:", err?.message);
  }
  const systemPrompt = loadSystemPrompt(contextBlock, principlesBlock);

  // ── 4. Resolve allowlist + tool schemas ───────────────────────────
  const allowlist = deps.resolvedAllowlist ?? resolveAllowlist({
    toolMetadata: deps.toolMetadata || {},
    discoverExtensionTools: config.discoverExtensionTools,
  });
  const toolSchemas = buildToolSchemas(allowlist);

  // ── 5. Select provider adapter ────────────────────────────────────
  let provider = deps.provider || null;
  if (!provider) {
    // Explicit reasoningProvider in config → use by name (backward compat).
    // Null/absent reasoningProvider → auto-select by isAvailable() order.
    if (config.reasoningProvider) {
      provider = await selectProvider(config.reasoningProvider);
    } else {
      provider = await autoSelectProvider(config, process.env, deps._providers || null);
    }
    if (!provider) {
      return {
        reply: "",
        toolCalls: [],
        tokensIn: 0,
        tokensOut: 0,
        totalCostUSD: 0,
        truncated: false,
        error: "no provider available",
        suggestion: NO_PROVIDER_SUGGESTION,
        sessionId: effectiveSessionId,
        requestedTier,
        resolvedModel: currentModel,
        fallbackFromTier: null,
        escalated: false,
        autoEscalated,
        fromTier: autoFromTier,
        toTier: autoToTier,
        reason: autoEscalationReason,
        classification: classification ?? null,
        relatedTurns: [],
      };
    }
  }

  // ── 6. Resolve API key ────────────────────────────────────────────
  let apiKey = null;
  if (deps.resolveApiKey) {
    apiKey = deps.resolveApiKey(config.reasoningProvider);
  } else if (deps.detectApiProvider) {
    const providerInfo = deps.detectApiProvider(config.reasoningModel);
    apiKey = providerInfo?.apiKey || null;
  }

  // ── Token / cost accumulators (used by planner + reactive loop) ──
  const allToolCalls = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCostUSD = 0;
  let truncated = false;
  let finalReply = "";

  // ── 6a. Proactive planner + executor ───────────────────────────────
  // After classification, attempt to plan tool-call steps proactively.
  // If the planner returns steps, execute them and inject results as
  // synthesis context before the reactive tool loop.
  // Any failure falls through to the reactive loop unchanged.
  //
  // Tests can opt out via `deps.skipPlanner: true` to avoid the planner
  // sendTurn consuming a scripted MockReasoningClient response (#149 Bucket B).
  let plannerSynthesis = null;
  if (!deps.skipPlanner) {
  try {
    const callPlannerModel = async ({ systemPrompt: sp, userMessage: um }) => {
      const planResp = await provider.sendTurn({
        messages: [
          { role: "system", content: sp },
          { role: "user", content: um },
        ],
        tools: [],
        model: currentModel,
        apiKey: apiKey || "",
        signal: undefined,
      });
      totalTokensIn += planResp.tokensIn || 0;
      totalTokensOut += planResp.tokensOut || 0;
      totalCostUSD += computeTurnCost(currentModel, planResp.tokensIn || 0, planResp.tokensOut || 0);
      return planResp.content || "";
    };

    const planResult = await runPlanner({
      userMessage: message,
      classification,
      lane: classification.lane,
      allowedTools: allowlist,
      deps: { callPlannerModel },
    });

    // Emit plan SSE event before executor fires
    try {
      if (typeof deps.onPlan === "function") {
        deps.onPlan(planResult);
      }
    } catch { /* observer errors must not affect reasoning */ }

    if (planResult.steps && planResult.steps.length > 0) {
      const planDispatch = async (step, priorOutputs) => {
        const result = await invokeAllowlisted(
          { tool: step.tool, args: step.args || {}, cwd },
          {
            resolvedAllowlist: allowlist,
            dispatcher: deps.dispatcher || (async () => ({})),
            hub: deps.hub || null,
          },
        );
        return result;
      };

      const execResult = await executePlan(
        { steps: planResult.steps },
        { dispatch: planDispatch },
      );

      // Build synthesis context from executor results
      const lines = execResult.results.map((r) => {
        const status = r.error ? `ERROR: ${r.error}` : "OK";
        const output = r.error
          ? "(no output)"
          : (typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? null));
        const truncated = output.length > 800 ? output.slice(0, 800) + "…" : output;
        return `[${r.step.id}] ${r.step.tool} → ${status}\n${truncated}`;
      });
      plannerSynthesis = lines.join("\n\n");
    }
  } catch {
    // Planner or executor failure — fall through to reactive loop
    plannerSynthesis = null;
  }
  }

  // ── 6b. Quorum advisory fan-out ──────────────────────────────────
  // When quorum advisory mode is enabled, fan out to multiple models
  // for advisory-lane turns. Hard guard: quorum NEVER fires on
  // operational, troubleshoot, build, or other non-advisory lanes.
  let quorumResult = null;
  const quorumAdvisoryMode = deps.quorumAdvisory || "off";

  if (quorumAdvisoryMode !== "off" && !QUORUM_BLOCKED_LANES.has(classification.lane)) {
    const shouldEngage =
      quorumAdvisoryMode === "always" ||
      (quorumAdvisoryMode === "auto" &&
        classification.lane === LANES.ADVISORY &&
        autoEscalated === true &&
        autoToTier === "high" &&
        (classification.confidence === "medium" || classification.confidence === "high"));

    if (shouldEngage) {
      // Estimate cost and emit quorum-estimate SSE event BEFORE dispatch
      const estimatedCostUSD = QUORUM_MODELS.reduce((sum, m) => {
        return sum + computeTurnCost(m.model, 500, 500);
      }, 0);

      try {
        if (typeof deps.onQuorumEstimate === "function") {
          deps.onQuorumEstimate({
            type: "quorum-estimate",
            models: QUORUM_MODELS.map((m) => m.model),
            estimatedCostUSD,
            canCancel: true,
          });
        }
      } catch { /* observer errors must not affect reasoning */ }

      // Dispatch to multiple models in parallel
      try {
        quorumResult = await dispatchQuorum({
          prompt: message,
          models: QUORUM_MODELS,
          deps: {
            selectProvider,
            systemPrompt,
            timeoutMs: undefined, // use default 60s
          },
        });

        // Accumulate quorum costs
        if (quorumResult?.replies) {
          for (const r of quorumResult.replies) {
            totalCostUSD += r.costUSD || 0;
          }
        }
      } catch {
        // Quorum failure is non-fatal — fall through to single-model path
        quorumResult = null;
      }
    }
  }

  // ── 7. Tool-use loop ──────────────────────────────────────────────
  const conversationMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  // Inject planner synthesis as pre-fetched context if available
  if (plannerSynthesis) {
    conversationMessages.push({
      role: "user",
      content: `The following tool results were pre-fetched to help answer the query:\n\n${plannerSynthesis}\n\nUse these results to formulate your response. You may call additional tools if needed.`,
    });
  }

  let iterationCount = 0;
  const maxIterations = effectiveMaxToolCalls + 1; // allow one extra for final reply

  while (iterationCount < maxIterations) {
    iterationCount++;

    let response;
    // Provider call with tier-based fallback on HTTP 429 (type: "rate_limited").
    // On each rate_limited response, descend one tier (high→medium→low).
    // If no lower tier is available, surface a structured rate_limited error.
    for (;;) {
      try {
        response = await provider.sendTurn({
          messages: conversationMessages,
          tools: toolSchemas,
          model: currentModel,
          apiKey: apiKey || "",
          signal: undefined,
        });
      } catch (err) {
        return {
          reply: finalReply,
          toolCalls: allToolCalls,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          totalCostUSD: totalCostUSD,
          truncated: false,
          error: `reasoning_model_unavailable`,
          sessionId: effectiveSessionId,
          requestedTier,
          resolvedModel: currentModel,
          fallbackFromTier,
          escalated: false,
          autoEscalated,
          fromTier: autoFromTier,
          toTier: autoToTier,
          reason: autoEscalationReason,
          classification: classification ?? null,
          relatedTurns: [],
        };
      }

      if (response.type === "rate_limited") {
        const next = nextTier(currentTier);
        if (next) {
          if (!fallbackFromTier) fallbackFromTier = currentTier;
          currentTier = next;
          currentModel = resolveModel(currentTier, config);
          continue;
        }
        // No lower tier available — surface the error
        return {
          reply: "",
          toolCalls: allToolCalls,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          totalCostUSD: totalCostUSD,
          truncated: false,
          error: "rate_limited",
          sessionId: effectiveSessionId,
          requestedTier,
          resolvedModel: currentModel,
          fallbackFromTier,
          escalated: false,
          autoEscalated,
          fromTier: autoFromTier,
          toTier: autoToTier,
          reason: autoEscalationReason,
          classification: classification ?? null,
          relatedTurns: [],
        };
      }
      break;
    }

    totalTokensIn += response.tokensIn || 0;
    totalTokensOut += response.tokensOut || 0;
    totalCostUSD += computeTurnCost(currentModel, response.tokensIn || 0, response.tokensOut || 0);

    // ── Final reply ──
    if (response.type === "reply") {
      finalReply = response.content || "";
      break;
    }

    // ── Tool calls ──
    if (response.type === "tool_calls" && response.toolCalls) {
      // Check budget
      if (allToolCalls.length + response.toolCalls.length > effectiveMaxToolCalls) {
        // Budget would be exceeded — truncate
        truncated = true;
        finalReply = response.content || "(tool budget exceeded — partial response)";
        break;
      }

      // Execute tool calls through the bridge
      const bridgeCalls = response.toolCalls.map((tc) => ({
        tool: tc.name,
        args: tc.args || {},
        cwd,
      }));

      const results = await invokeMany(bridgeCalls, {
        resolvedAllowlist: allowlist,
        dispatcher: deps.dispatcher || (async () => ({})),
        hub: deps.hub || null,
      });

      // Record tool calls + results in conversation
      const assistantMsg = {
        role: "assistant",
        content: response.content || null,
        toolCalls: response.toolCalls,
      };
      conversationMessages.push(assistantMsg);

      for (let i = 0; i < response.toolCalls.length; i++) {
        const tc = response.toolCalls[i];
        const result = results[i];

        allToolCalls.push({
          name: tc.name,
          args: tc.args || {},
          resultSummary: result?.summary || result?.error || "",
          costUSD: result?.costUSD || 0,
        });

        // Add tool result to conversation for next iteration
        conversationMessages.push({
          role: "tool_result",
          toolCallId: tc.id,
          content: result?.summary || result?.error || "no result",
        });
      }

      continue;
    }

    // Unknown response type — treat as final reply
    finalReply = response.content || "";
    break;
  }

  // Budget check: if we exhausted iterations without a final reply
  if (!finalReply && iterationCount >= maxIterations) {
    truncated = true;
    finalReply = "(tool budget exceeded — partial response)";
  }

  // ── 8. Persist session turn ────────────────────────────────────────
  const brainDeps = {
    recall: deps.recall || (async () => null),
    remember: deps.remember || (() => ({ ok: true })),
    cwd,
  };

  try {
    await appendTurn({
      sessionId: effectiveSessionId,
      turn: {
        role: "turn",
        userMessage: message,
        assistantReply: finalReply,
        toolCalls: allToolCalls,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        truncated,
      },
    }, brainDeps);

    await summarizeIfNeeded({ sessionId: effectiveSessionId }, brainDeps);
  } catch { /* persistence failure is non-fatal */ }

  // ── 8a. File-based session store persistence ──────────────────────
  if (!isEphemeral) {
    try {
      await storeAppendTurn(effectiveSessionId, {
        userMessage: message,
        classification,
        replyHash: hashReply(finalReply),
        toolCalls: allToolCalls,
      }, cwd);
    } catch { /* non-fatal */ }
  }

  // Emit cost event
  if (deps.hub && typeof deps.hub.broadcast === "function") {
    deps.hub.broadcast({
      type: "forge-master.turn-complete",
      source: "forge-master",
      worker: "forge-master-reasoning",
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      toolCallCount: allToolCalls.length,
      truncated,
      sessionId: effectiveSessionId,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    reply: finalReply,
    toolCalls: allToolCalls,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    totalCostUSD,
    truncated,
    sessionId: effectiveSessionId,
    requestedTier,
    resolvedModel: currentModel,
    fallbackFromTier,
    escalated: false,
    autoEscalated,
    fromTier: autoFromTier,
    toTier: autoToTier,
    reason: autoEscalationReason,
    classification: classification ?? null,
    relatedTurns,
    quorumResult,
  };
}
