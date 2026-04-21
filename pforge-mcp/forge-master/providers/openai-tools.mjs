/**
 * Plan Forge — Forge-Master OpenAI Function-Calling Adapter (Phase-28, Slice 5).
 *
 * Translates between the reasoning loop's generic interface and the
 * OpenAI Chat Completions API function-calling format.
 *
 * OpenAI specifics:
 *   - POST /v1/chat/completions
 *   - Header: Authorization: Bearer
 *   - Tools: {type:"function", function:{name, description, parameters}}
 *   - Response: choices[0].message.tool_calls[{id, function:{name, arguments}}]
 *   - Tool results: {role:"tool", tool_call_id, content}
 *
 * @module forge-master/providers/openai-tools
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Build OpenAI-format tool definitions from generic tool schemas.
 * @param {Array<{name, description, parameters?}>} tools
 * @returns {Array<object>}
 */
export function buildOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.parameters || { type: "object", properties: {} },
    },
  }));
}

/**
 * Convert generic messages to OpenAI format.
 *
 * @param {Array<{role, content, toolCalls?, toolCallId?}>} messages
 * @returns {Array<object>}
 */
export function formatMessages(messages) {
  const formatted = [];

  for (const msg of messages) {
    if (msg.role === "tool_result") {
      formatted.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      });
      continue;
    }

    if (msg.role === "assistant" && msg.toolCalls) {
      const entry = {
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args || {}),
          },
        })),
      };
      formatted.push(entry);
      continue;
    }

    formatted.push({
      role: msg.role,
      content: msg.content || "",
    });
  }

  return formatted;
}

/**
 * Parse OpenAI response into the generic format.
 * @param {object} data - OpenAI API response
 * @returns {{ type: "reply"|"tool_calls", content?: string, toolCalls?: Array, tokensIn: number, tokensOut: number }}
 */
export function parseResponse(data) {
  const usage = data.usage || {};
  const tokensIn = usage.prompt_tokens || 0;
  const tokensOut = usage.completion_tokens || 0;

  const choice = data.choices?.[0];
  if (!choice) {
    return { type: "reply", content: "", tokensIn, tokensOut };
  }

  const message = choice.message || {};

  if (message.tool_calls && message.tool_calls.length > 0) {
    return {
      type: "tool_calls",
      content: message.content || undefined,
      toolCalls: message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: safeParseArgs(tc.function.arguments),
      })),
      tokensIn,
      tokensOut,
    };
  }

  return {
    type: "reply",
    content: message.content || "",
    tokensIn,
    tokensOut,
  };
}

function safeParseArgs(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

/**
 * Send a turn to the OpenAI Chat Completions API with function-calling support.
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
  const body = {
    model,
    messages: formatted,
  };

  const openAITools = buildOpenAITools(tools);
  if (openAITools.length > 0) body.tools = openAITools;

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
    const errBody = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  return parseResponse(data);
}

export const PROVIDER_NAME = "openai";
