// Phase-COST-TOKEN-COVERAGE Slice 8: parseResponse() extraction tests
// for the three provider modules. Fixtures drawn from vendor docs.
import { describe, it, expect } from "vitest";
import { parseResponse as parseAnthropic } from "../../pforge-master/src/providers/anthropic-tools.mjs";
import { parseResponse as parseOpenAI } from "../../pforge-master/src/providers/openai-tools.mjs";
import { parseResponse as parseXAI } from "../../pforge-master/src/providers/xai-tools.mjs";

describe("Anthropic parseResponse cache extraction (Slice 8)", () => {
  it("extracts cache_creation.ephemeral_5m_input_tokens and cache_read_input_tokens", () => {
    // Fixture from Anthropic prompt-caching docs (2026-05-06):
    // tokens_in is uncached (post-breakpoint); cache reads + creation are
    // reported separately with 5m/1h split when 1h is used.
    const data = {
      content: [{ type: "text", text: "hello" }],
      usage: {
        input_tokens: 50,
        output_tokens: 503,
        cache_read_input_tokens: 100000,
        cache_creation_input_tokens: 556,
        cache_creation: {
          ephemeral_5m_input_tokens: 456,
          ephemeral_1h_input_tokens: 100,
        },
      },
    };
    const r = parseAnthropic(data);
    expect(r.tokensIn).toBe(50);
    expect(r.tokensOut).toBe(503);
    expect(r.cacheReadTokens).toBe(100000);
    expect(r.cacheCreationInputTokens).toBe(556);
    expect(r.cacheCreation5mTokens).toBe(456);
    expect(r.cacheCreation1hTokens).toBe(100);
    expect(r.vendor).toBe("anthropic");
  });

  it("extracts cache_creation_input_tokens without 5m/1h split (older response shape)", () => {
    // Older Anthropic responses (or 5m-only requests) carry cache_creation_input_tokens
    // without the cache_creation breakdown object.
    const data = {
      content: [{ type: "text", text: "hi" }],
      usage: {
        input_tokens: 10,
        output_tokens: 50,
        cache_creation_input_tokens: 200,
      },
    };
    const r = parseAnthropic(data);
    expect(r.cacheCreationInputTokens).toBe(200);
    expect(r.cacheCreation5mTokens).toBe(0);
    expect(r.cacheCreation1hTokens).toBe(0);
    expect(r.vendor).toBe("anthropic");
  });

  it("defaults all cache fields to 0 when usage block lacks them", () => {
    const data = {
      content: [{ type: "text", text: "no cache" }],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const r = parseAnthropic(data);
    expect(r.cacheReadTokens).toBe(0);
    expect(r.cacheCreationInputTokens).toBe(0);
    expect(r.cacheCreation5mTokens).toBe(0);
    expect(r.cacheCreation1hTokens).toBe(0);
    expect(r.vendor).toBe("anthropic");
  });

  it("preserves tool_calls and content fields alongside cache extraction", () => {
    // Backward compatibility: existing readers of type/content/toolCalls/tokens
    // see no behavior change.
    const data = {
      content: [
        { type: "text", text: "calling tool" },
        { type: "tool_use", id: "toolu_1", name: "search", input: { q: "foo" } },
      ],
      usage: {
        input_tokens: 20,
        output_tokens: 30,
        cache_read_input_tokens: 1000,
      },
    };
    const r = parseAnthropic(data);
    expect(r.type).toBe("tool_calls");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].name).toBe("search");
    expect(r.cacheReadTokens).toBe(1000);
    expect(r.vendor).toBe("anthropic");
  });
});

describe("OpenAI parseResponse cache + reasoning + tier extraction (Slice 8)", () => {
  it("Chat Completions API shape: prompt_tokens_details.cached_tokens + completion_tokens_details.reasoning_tokens", () => {
    const data = {
      choices: [{ message: { content: "answer" } }],
      usage: {
        prompt_tokens: 2000,
        completion_tokens: 500,
        total_tokens: 2500,
        prompt_tokens_details: { cached_tokens: 1500 },
        completion_tokens_details: { reasoning_tokens: 300 },
      },
    };
    const r = parseOpenAI(data);
    expect(r.tokensIn).toBe(2000);
    expect(r.tokensOut).toBe(500);
    expect(r.cacheReadTokens).toBe(1500);
    expect(r.reasoningTokens).toBe(300);
    expect(r.serviceTier).toBeNull();
    expect(r.vendor).toBe("openai");
  });

  it("Responses API shape: input_tokens + input_tokens_details.cached_tokens", () => {
    // Responses API (used by GPT-5.x and o-series) uses different field names.
    // Fixture mirrors the example in the OpenAI Responses API docs.
    const data = {
      choices: [{ message: { content: "deep answer" } }],
      usage: {
        input_tokens: 75,
        output_tokens: 1186,
        total_tokens: 1261,
        input_tokens_details: { cached_tokens: 50 },
        output_tokens_details: { reasoning_tokens: 1024 },
      },
    };
    const r = parseOpenAI(data);
    expect(r.tokensIn).toBe(75);
    expect(r.tokensOut).toBe(1186);
    expect(r.cacheReadTokens).toBe(50);
    expect(r.reasoningTokens).toBe(1024);
    expect(r.vendor).toBe("openai");
  });

  it("extracts service_tier='flex' from the response object", () => {
    const data = {
      choices: [{ message: { content: "flex reply" } }],
      service_tier: "flex",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const r = parseOpenAI(data);
    expect(r.serviceTier).toBe("flex");
    expect(r.vendor).toBe("openai");
  });

  it("preserves tool_calls alongside cache + reasoning extraction", () => {
    const data = {
      choices: [{
        message: {
          content: null,
          tool_calls: [
            { id: "call_1", function: { name: "fetch", arguments: '{"url":"x"}' } },
          ],
        },
      }],
      usage: {
        prompt_tokens: 100, completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    };
    const r = parseOpenAI(data);
    expect(r.type).toBe("tool_calls");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.cacheReadTokens).toBe(80);
    expect(r.vendor).toBe("openai");
  });

  it("defaults cache + reasoning to 0 when usage details absent", () => {
    const data = {
      choices: [{ message: { content: "plain" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const r = parseOpenAI(data);
    expect(r.cacheReadTokens).toBe(0);
    expect(r.reasoningTokens).toBe(0);
    expect(r.serviceTier).toBeNull();
    expect(r.vendor).toBe("openai");
  });
});

describe("xAI parseResponse — OpenAI-compatible plus cost_in_usd_ticks (Slice 8)", () => {
  it("extracts cost_in_usd_ticks from usage", () => {
    // xAI authoritative billed amount per response. priceSlice() uses this
    // directly when present, bypassing computed multiplier math.
    const data = {
      choices: [{ message: { content: "grok says hi" } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 100 },
        cost_in_usd_ticks: 12345,
      },
    };
    const r = parseXAI(data);
    expect(r.tokensIn).toBe(1000);
    expect(r.tokensOut).toBe(500);
    expect(r.cacheReadTokens).toBe(200);
    expect(r.reasoningTokens).toBe(100);
    expect(r.costInUsdTicks).toBe(12345);
    // Critical: vendor is "xai" not "openai" (xAI parser overrides the OpenAI default)
    expect(r.vendor).toBe("xai");
  });

  it("returns costInUsdTicks=null when usage lacks cost_in_usd_ticks", () => {
    const data = {
      choices: [{ message: { content: "no ticks" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    };
    const r = parseXAI(data);
    expect(r.costInUsdTicks).toBeNull();
    expect(r.vendor).toBe("xai");
  });
});
