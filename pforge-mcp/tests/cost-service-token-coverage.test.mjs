import { describe, it, expect, vi, afterEach } from "vitest";
import * as costService from "../cost-service.mjs";

function sumBreakdown(breakdown) {
  return breakdown.input_uncached +
    breakdown.input_cache_read +
    breakdown.input_cache_write_5m +
    breakdown.input_cache_write_1h +
    breakdown.output_total +
    breakdown.subscription_cost;
}

afterEach(() => {
  delete process.env.PFORGE_LOG_LEVEL;
  vi.restoreAllMocks();
});

describe("priceSlice token coverage (Slice 4)", () => {
  it("Anthropic Opus with cache_read_tokens only", () => {
    const r = costService.priceSlice({
      tokens_in: 10000,
      tokens_out: 500,
      model: "claude-opus-4.7",
      vendor: "anthropic",
      cache_read_tokens: 5000,
    }, "api-anthropic");

    expect(r.cost_breakdown.input_uncached).toBeCloseTo(0.05, 6);
    expect(r.cost_breakdown.input_cache_read).toBeCloseTo(0.0025, 6);
    expect(r.cost_breakdown.output_total).toBeCloseTo(0.0125, 6);
    expect(r.cost_usd).toBeCloseTo(0.065, 6);
  });

  it("Anthropic Opus with cache_creation_5m_tokens only", () => {
    const r = costService.priceSlice({
      tokens_in: 5000,
      tokens_out: 500,
      model: "claude-opus-4.7",
      vendor: "anthropic",
      cache_creation_5m_tokens: 2000,
    }, "api-anthropic");

    expect(r.cost_breakdown.input_cache_write_5m).toBeCloseTo(0.0125, 6);
    expect(r.cost_usd).toBeCloseTo(0.05, 6);
  });

  it("Anthropic Opus with cache_creation_1h_tokens only", () => {
    const r = costService.priceSlice({
      tokens_in: 5000,
      tokens_out: 500,
      model: "claude-opus-4.7",
      vendor: "anthropic",
      cache_creation_1h_tokens: 2000,
    }, "api-anthropic");

    expect(r.cost_breakdown.input_cache_write_1h).toBeCloseTo(0.02, 6);
    expect(r.cost_usd).toBeCloseTo(0.0575, 6);
  });

  it("Anthropic Opus with cache_creation_input_tokens defaults to 5m rate and logs in debug", () => {
    process.env.PFORGE_LOG_LEVEL = "debug";
    const debugSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const r = costService.priceSlice({
      tokens_in: 5000,
      tokens_out: 500,
      model: "claude-opus-4.7",
      vendor: "anthropic",
      cache_creation_input_tokens: 2000,
    }, "api-anthropic");

    expect(r.cost_breakdown.input_cache_write_5m).toBeCloseTo(0.0125, 6);
    expect(r.cost_breakdown.input_cache_write_1h).toBe(0);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("defaulted 2000 tokens to 5m pricing"));
  });

  it("Anthropic Opus combined cache classes sum to cost_usd", () => {
    const r = costService.priceSlice({
      tokens_in: 10000,
      tokens_out: 500,
      model: "claude-opus-4.7",
      vendor: "anthropic",
      cache_read_tokens: 5000,
      cache_creation_5m_tokens: 2000,
    }, "api-anthropic");

    expect(sumBreakdown(r.cost_breakdown)).toBeCloseTo(r.cost_usd, 6);
  });

  it("OpenAI o3 with reasoning_tokens keeps reasoning informational only", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "o3",
      vendor: "openai",
      reasoning_tokens: 300,
    }, "api-openai");

    expect(r.cost_usd).toBeCloseTo(0.006, 6);
    expect(r.cost_breakdown.reasoning_tokens).toBe(300);
    expect(r.cost_breakdown.output_total).toBeCloseTo(0.004, 6);
  });

  it("OpenAI gpt-5.5 with cache_read_tokens uses 0.10× and subtracts cached input", () => {
    const r = costService.priceSlice({
      tokens_in: 2000,
      tokens_out: 500,
      model: "gpt-5.5",
      vendor: "openai",
      cache_read_tokens: 1500,
    }, "api-openai");

    expect(r.cost_breakdown.input_uncached).toBeCloseTo(0.0025, 6);
    expect(r.cost_breakdown.input_cache_read).toBeCloseTo(0.00075, 6);
    expect(r.cost_usd).toBeCloseTo(0.01825, 6);
  });

  it("OpenAI o1 with cache_read_tokens uses 0.50× rate", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 0,
      model: "o1",
      vendor: "openai",
      cache_read_tokens: 500,
    }, "api-openai");

    expect(r.cost_breakdown.input_uncached).toBeCloseTo(0.0075, 6);
    expect(r.cost_breakdown.input_cache_read).toBeCloseTo(0.00375, 6);
    expect(r.cost_usd).toBeCloseTo(0.01125, 6);
  });

  it("OpenAI gpt-5.4 with service_tier='flex' applies 0.5× input and output", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "gpt-5.4",
      vendor: "openai",
      service_tier: "flex",
    }, "api-openai");

    expect(r.cost_usd).toBeCloseTo(0.005, 6);
    expect(r.cost_breakdown.tier_adjustment).toBeCloseTo(-0.005, 6);
  });

  it("OpenAI gpt-5.4 with service_tier='priority' applies asymmetric uplift", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "gpt-5.4",
      vendor: "openai",
      service_tier: "priority",
    }, "api-openai");

    expect(r.cost_usd).toBeCloseTo(0.01625, 6);
    expect(r.cost_breakdown.tier_adjustment).toBeCloseTo(0.00625, 6);
  });

  it("xAI grok-4.3 with cost_in_usd_ticks bypasses computed math", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "grok-4.3",
      vendor: "xai",
      cost_in_usd_ticks: 12345,
    }, "api-xai");

    expect(r.cost_usd).toBeCloseTo(0.000001, 6);
    expect(r.cost_breakdown.authoritative_source).toBe("cost_in_usd_ticks");
  });

  it("xAI grok-4.3 without cost_in_usd_ticks falls back to multiplier math", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "grok-4.3",
      vendor: "xai",
      cache_read_tokens: 200,
    }, "api-xai");

    expect(r.cost_usd).toBeCloseTo(0.002313, 6);
    expect(r.cost_breakdown.authoritative_source).toBeUndefined();
  });

  it("Subscription-CLI regression guard remains unchanged", () => {
    const r = costService.priceSlice({ model: "gh-copilot", premiumRequests: 5 }, "gh-copilot");
    expect(r.cost_usd).toBe(0.05);
  });

  it("Backward compatibility without vendor still uses corrected legacy math", () => {
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "claude-sonnet-4.6",
    }, "api-anthropic");

    expect(r.cost_usd).toBeCloseTo(0.0105, 6);
    expect(r.cost_breakdown.input_cache_read).toBe(0);
  });
});
