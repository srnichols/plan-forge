import { describe, it, expect } from "vitest";
import { parseResponse as parseAnthropic } from "../../pforge-master/src/providers/anthropic-tools.mjs";
import { parseResponse as parseOpenAI } from "../../pforge-master/src/providers/openai-tools.mjs";
import { parseResponse as parseXAI } from "../../pforge-master/src/providers/xai-tools.mjs";

describe("parseResponse cache-field coverage (Slice 8)", () => {
  it("Anthropic with 5m+1h split + cache_read", () => {
    const r = parseAnthropic({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 500,
        cache_creation: {
          ephemeral_5m_input_tokens: 200,
          ephemeral_1h_input_tokens: 100,
        },
      },
      content: [{ type: "text", text: "result" }],
    });

    expect(r.cacheReadTokens).toBe(500);
    expect(r.cacheCreation5mTokens).toBe(200);
    expect(r.cacheCreation1hTokens).toBe(100);
    expect(r.vendor).toBe("anthropic");
  });

  it("Anthropic with only cache_creation_input_tokens (no breakdown)", () => {
    const r = parseAnthropic({
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 300,
      },
      content: [{ type: "text", text: "result" }],
    });

    expect(r.cacheCreationInputTokens).toBe(300);
    expect(r.cacheCreation5mTokens).toBe(0);
    expect(r.vendor).toBe("anthropic");
  });

  it("OpenAI Chat Completions with cached_tokens and reasoning_tokens", () => {
    const r = parseOpenAI({
      usage: {
        prompt_tokens: 2000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 1500 },
        completion_tokens_details: { reasoning_tokens: 300 },
      },
      service_tier: "standard",
      choices: [{ message: { content: "result", role: "assistant" } }],
    });

    expect(r.cacheReadTokens).toBe(1500);
    expect(r.reasoningTokens).toBe(300);
    expect(r.serviceTier).toBe("standard");
    expect(r.vendor).toBe("openai");
  });

  it("OpenAI Responses API with input_tokens_details", () => {
    const r = parseOpenAI({
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        input_tokens_details: { cached_tokens: 800 },
        output_tokens_details: { reasoning_tokens: 50 },
      },
      choices: [{ message: { content: "result", role: "assistant" } }],
    });

    expect(r.cacheReadTokens).toBe(800);
    expect(r.reasoningTokens).toBe(50);
    expect(r.vendor).toBe("openai");
  });

  it("OpenAI with service_tier='flex'", () => {
    const r = parseOpenAI({
      usage: { prompt_tokens: 500, completion_tokens: 100 },
      service_tier: "flex",
      choices: [{ message: { content: "result", role: "assistant" } }],
    });

    expect(r.serviceTier).toBe("flex");
    expect(r.cacheReadTokens).toBe(0);
    expect(r.vendor).toBe("openai");
  });

  it("xAI with cost_in_usd_ticks", () => {
    const r = parseXAI({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 200 },
        cost_in_usd_ticks: 99999,
      },
      choices: [{ message: { content: "result", role: "assistant" } }],
    });

    expect(r.cacheReadTokens).toBe(200);
    expect(r.costInUsdTicks).toBe(99999);
    expect(r.vendor).toBe("xai");
  });
});
