/**
 * Request-shape tests for the direct-API provider adapters (2026-09-30 model refresh).
 *
 * Forge-Master names models the way GitHub Copilot does (claude-sonnet-5.5);
 * these tests pin the HTTP request each vendor actually receives.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTurn as sendAnthropicTurn, toAnthropicModelId } from "../anthropic-tools.mjs";
import { sendTurn as sendOpenAITurn } from "../openai-tools.mjs";

const TOOLS = [{ name: "forge_plan_status", description: "Plan status" }];
const MESSAGES = [{ role: "user", content: "status?" }];

function stubFetch(body) {
  const spy = vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sentBody(spy) {
  return JSON.parse(spy.mock.calls[0][1].body);
}

afterEach(() => vi.unstubAllGlobals());

describe("anthropic-tools request shape", () => {
  const ANTHROPIC_REPLY = { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } };

  it("posts to /v1/messages exactly once in the path", async () => {
    const spy = stubFetch(ANTHROPIC_REPLY);
    await sendAnthropicTurn({ messages: MESSAGES, tools: TOOLS, model: "claude-sonnet-5.5", apiKey: "test-key" });
    expect(spy.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("sends the hyphenated Anthropic API ID for a dotted Copilot-style ID", async () => {
    const spy = stubFetch(ANTHROPIC_REPLY);
    await sendAnthropicTurn({ messages: MESSAGES, tools: TOOLS, model: "claude-sonnet-5.5", apiKey: "test-key" });
    expect(sentBody(spy).model).toBe("claude-sonnet-5-5");
  });

  it("toAnthropicModelId leaves hyphenated, dated and non-Claude IDs unchanged", () => {
    expect(toAnthropicModelId("claude-opus-5.5")).toBe("claude-opus-5-5");
    expect(toAnthropicModelId("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(toAnthropicModelId("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5-20250929");
    expect(toAnthropicModelId("gpt-6-sol")).toBe("gpt-6-sol");
  });
});

describe("openai-tools request shape", () => {
  const OPENAI_REPLY = { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };

  it("turns reasoning off for GPT-6 when tools are sent (Chat Completions tool requirement)", async () => {
    const spy = stubFetch(OPENAI_REPLY);
    await sendOpenAITurn({ messages: MESSAGES, tools: TOOLS, model: "gpt-6-sol", apiKey: "test-key" });
    const body = sentBody(spy);
    expect(body.tools).toHaveLength(1);
    expect(body.reasoning_effort).toBe("none");
  });

  it("leaves reasoning_effort unset for GPT-6 without tools and for other models", async () => {
    let spy = stubFetch(OPENAI_REPLY);
    await sendOpenAITurn({ messages: MESSAGES, tools: [], model: "gpt-6-sol", apiKey: "test-key" });
    expect(sentBody(spy)).not.toHaveProperty("reasoning_effort");

    spy = stubFetch(OPENAI_REPLY);
    await sendOpenAITurn({ messages: MESSAGES, tools: TOOLS, model: "gpt-5.3-codex", apiKey: "test-key" });
    expect(sentBody(spy)).not.toHaveProperty("reasoning_effort");
  });
});
