/**
 * Plan Forge — Forge-Master XAI (Grok) Tool-Use Adapter (Phase-28, Slice 5).
 *
 * XAI Grok uses an OpenAI-compatible endpoint. This adapter attempts
 * tool-use via the OpenAI format and falls back to reply-only mode
 * if tool-use is not supported (HTTP 400/422 on tools param).
 *
 * Exports:
 *   - sendTurn(opts) — try tool-use, fallback to reply-only
 *   - sendReplyOnly(opts) — no tool schemas, reply-only
 *   - PROVIDER_NAME — "xai"
 *
 * @module forge-master/providers/xai-tools
 */

import {
  buildOpenAITools,
  formatMessages,
  parseResponse,
} from "./openai-tools.mjs";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";

/**
 * Send a reply-only request (no tool schemas).
 * Used as fallback when tool-use is unsupported by XAI.
 */
export async function sendReplyOnly(opts) {
  const {
    messages,
    model,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    signal,
  } = opts;

  const formatted = formatMessages(messages);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages: formatted }),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`XAI API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const parsed = parseResponse(data);
  // Force reply type — no tool calls in reply-only mode
  return { ...parsed, type: "reply", toolCalls: undefined };
}

/**
 * Send a turn to the XAI (Grok) API with tool-use support.
 * Falls back to reply-only if the API rejects the tools parameter.
 *
 * @param {{
 *   messages: Array<{role, content, toolCalls?, toolCallId?}>,
 *   tools: Array<{name, description, parameters?}>,
 *   model: string,
 *   apiKey: string,
 *   baseUrl?: string,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ type: "reply"|"tool_calls", content?: string, toolCalls?: Array, tokensIn: number, tokensOut: number }>}
 */
export async function sendTurn(opts) {
  const {
    messages,
    tools,
    model,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    signal,
  } = opts;

  const formatted = formatMessages(messages);
  const body = { model, messages: formatted };

  const openAITools = buildOpenAITools(tools);
  if (openAITools.length > 0) body.tools = openAITools;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const status = response.status;
      // 400 or 422 with tools may mean tool-use unsupported — fallback
      if ((status === 400 || status === 422) && openAITools.length > 0) {
        return sendReplyOnly(opts);
      }
      const errBody = await response.text();
      throw new Error(`XAI API error ${status}: ${errBody}`);
    }

    const data = await response.json();
    return parseResponse(data);
  } catch (err) {
    // If the error is about tools, try reply-only fallback
    if (err.message && /tool/i.test(err.message) && openAITools.length > 0) {
      return sendReplyOnly(opts);
    }
    throw err;
  }
}

export const PROVIDER_NAME = "xai";
