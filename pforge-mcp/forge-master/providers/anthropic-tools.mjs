/**
 * Plan Forge — Forge-Master Anthropic Tool-Use Adapter (Phase-28, Slice 5).
 *
 * Translates between the reasoning loop's generic interface and the
 * Anthropic Messages API tool-use format.
 *
 * Anthropic specifics:
 *   - POST /v1/messages
 *   - Header: x-api-key, anthropic-version
 *   - Tools use `input_schema` (JSON Schema)
 *   - Response content blocks: {type:"text"} or {type:"tool_use"}
 *   - Tool results: {role:"user", content:[{type:"tool_result", ...}]}
 *
 * @module forge-master/providers/anthropic-tools
 */

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Build Anthropic-format tool definitions from generic tool schemas.
 * @param {Array<{name, description, parameters?}>} tools
 * @returns {Array<object>}
 */
export function buildAnthropicTools(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description || "",
    input_schema: t.parameters || { type: "object", properties: {} },
  }));
}

/**
 * Convert generic messages to Anthropic format.
 * Separates out system messages (Anthropic uses a top-level `system` param).
 *
 * @param {Array<{role, content, toolCalls?, toolCallId?}>} messages
 * @returns {{ system: string, messages: Array<object> }}
 */
export function formatMessages(messages) {
  let system = "";
  const formatted = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system += (system ? "\n\n" : "") + msg.content;
      continue;
    }

    if (msg.role === "tool_result") {
      formatted.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.toolCallId,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          },
        ],
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls) {
      const content = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      for (const tc of msg.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.args || {},
        });
      }
      formatted.push({ role: "assistant", content });
      continue;
    }

    formatted.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content || "",
    });
  }

  return { system, messages: formatted };
}

/**
 * Parse Anthropic response into the generic format.
 * @param {object} data - Anthropic API response
 * @returns {{ type: "reply"|"tool_calls", content?: string, toolCalls?: Array, tokensIn: number, tokensOut: number }}
 */
export function parseResponse(data) {
  const usage = data.usage || {};
  const tokensIn = usage.input_tokens || 0;
  const tokensOut = usage.output_tokens || 0;

  const contentBlocks = data.content || [];
  const toolUseBlocks = contentBlocks.filter((b) => b.type === "tool_use");
  const textBlocks = contentBlocks.filter((b) => b.type === "text");
  const textContent = textBlocks.map((b) => b.text).join("\n").trim();

  if (toolUseBlocks.length > 0) {
    return {
      type: "tool_calls",
      content: textContent || undefined,
      toolCalls: toolUseBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        args: b.input || {},
      })),
      tokensIn,
      tokensOut,
    };
  }

  return {
    type: "reply",
    content: textContent || data.content?.[0]?.text || "",
    tokensIn,
    tokensOut,
  };
}

/**
 * Send a turn to the Anthropic Messages API with tool-use support.
 *
 * @param {{
 *   messages: Array<{role, content, toolCalls?, toolCallId?}>,
 *   tools: Array<{name, description, parameters?}>,
 *   model: string,
 *   apiKey: string,
 *   baseUrl?: string,
 *   signal?: AbortSignal,
 *   maxTokens?: number,
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
    maxTokens = DEFAULT_MAX_TOKENS,
  } = opts;

  const { system, messages: formatted } = formatMessages(messages);
  const anthropicTools = buildAnthropicTools(tools);

  const body = {
    model,
    max_tokens: maxTokens,
    messages: formatted,
  };
  if (system) body.system = system;
  if (anthropicTools.length > 0) body.tools = anthropicTools;

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return parseResponse(data);
}

export const PROVIDER_NAME = "anthropic";
