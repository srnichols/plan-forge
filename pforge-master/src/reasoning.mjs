/**
 * Plan Forge — Forge-Master Reasoning Loop (Phase-28, Slice 5).
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
 *   - selectProvider(providerName) → adapter module
 *   - ABSOLUTE_CEILING — hard ceiling for tool calls (10)
 *
 * @module forge-master/reasoning
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { classify, LANES, OFFTOPIC_REDIRECT } from "./intent-router.mjs";
import { fetchContext } from "./retrieval.mjs";
import { getForgeMasterConfig } from "./config.mjs";
import { resolveAllowlist, USAGE_HINTS } from "./allowlist.mjs";
import { invokeMany } from "./tool-bridge.mjs";
import { ensureSessionId, appendTurn, summarizeIfNeeded } from "./persistence.mjs";

// ─── Constants ──────────────────────────────────────────────────────

export const ABSOLUTE_CEILING = 10;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = resolve(__dirname, "system-prompt.md");

// ─── Provider Selection ─────────────────────────────────────────────

/**
 * Select the appropriate provider adapter based on provider name.
 * Returns a module with `sendTurn(opts)`.
 *
 * @param {"anthropic"|"openai"|"xai"|string|null} providerName
 * @returns {Promise<{ sendTurn: Function, PROVIDER_NAME: string }|null>}
 */
export async function selectProvider(providerName) {
  switch (providerName) {
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

function loadSystemPrompt(contextBlock) {
  try {
    const raw = readFileSync(SYSTEM_PROMPT_PATH, "utf-8");
    return raw.replace("{context_block}", contextBlock || "(no context available)");
  } catch {
    return `You are Forge-Master, a Plan Forge reasoning assistant.\n\n## Current Context\n\n${contextBlock || "(no context available)"}`;
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
 * }} input
 * @param {{
 *   provider?: { sendTurn: Function },
 *   dispatcher?: Function,
 *   hub?: { broadcast: Function } | null,
 *   toolMetadata?: Record<string, object>,
 *   callApiWorker?: Function,
 *   detectApiProvider?: Function,
 *   resolveApiKey?: (provider: string) => string | null,
 * }} [deps] — injected dependencies for testability
 * @returns {Promise<{
 *   reply: string,
 *   toolCalls: Array<{name: string, args: object, resultSummary: string, costUSD: number}>,
 *   tokensIn: number,
 *   tokensOut: number,
 *   totalCostUSD: number,
 *   truncated: boolean,
 *   error?: string,
 * }>}
 */
export async function runTurn(input, deps = {}) {
  const { message, cwd } = input;
  const config = getForgeMasterConfig({ cwd });
  const effectiveSessionId = ensureSessionId(input.sessionId);

  const effectiveMaxToolCalls = Math.min(
    input.maxToolCalls ?? config.maxToolCalls,
    ABSOLUTE_CEILING,
  );

  // ── 1. Intent classification ──────────────────────────────────────
  const classification = await classify(message, {
    cwd,
    callApiWorker: deps.callApiWorker,
    detectApiProvider: deps.detectApiProvider,
  });

  // Off-topic short-circuit — no model call, no tool calls, near-zero cost
  if (classification.lane === LANES.OFFTOPIC) {
    return {
      reply: OFFTOPIC_REDIRECT,
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      totalCostUSD: 0,
      truncated: false,
      sessionId: effectiveSessionId,
    };
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

  // ── 3. Load system prompt ─────────────────────────────────────────
  const systemPrompt = loadSystemPrompt(contextBlock);

  // ── 4. Resolve allowlist + tool schemas ───────────────────────────
  const allowlist = resolveAllowlist({
    toolMetadata: deps.toolMetadata || {},
    discoverExtensionTools: config.discoverExtensionTools,
  });
  const toolSchemas = buildToolSchemas(allowlist);

  // ── 5. Select provider adapter ────────────────────────────────────
  let provider = deps.provider || null;
  if (!provider) {
    const providerName = config.reasoningProvider;
    provider = await selectProvider(providerName);
    if (!provider) {
      return {
        reply: "",
        toolCalls: [],
        tokensIn: 0,
        tokensOut: 0,
        totalCostUSD: 0,
        truncated: false,
        error: "reasoning_model_unavailable",
        sessionId: effectiveSessionId,
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

  // ── 7. Tool-use loop ──────────────────────────────────────────────
  const conversationMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  const allToolCalls = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let truncated = false;
  let finalReply = "";
  let iterationCount = 0;
  const maxIterations = effectiveMaxToolCalls + 1; // allow one extra for final reply

  while (iterationCount < maxIterations) {
    iterationCount++;

    let response;
    try {
      response = await provider.sendTurn({
        messages: conversationMessages,
        tools: toolSchemas,
        model: config.reasoningModel,
        apiKey: apiKey || "",
        signal: undefined,
      });
    } catch (err) {
      return {
        reply: finalReply,
        toolCalls: allToolCalls,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        totalCostUSD: 0,
        truncated: false,
        error: `reasoning_model_unavailable`,
        sessionId: effectiveSessionId,
      };
    }

    totalTokensIn += response.tokensIn || 0;
    totalTokensOut += response.tokensOut || 0;

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
    totalCostUSD: 0,
    truncated,
    sessionId: effectiveSessionId,
  };
}
