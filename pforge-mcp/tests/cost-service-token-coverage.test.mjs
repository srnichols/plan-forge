// Phase-COST-TOKEN-COVERAGE Slice 4: comprehensive vendor-aware billing tests.
// 12 cases per the plan's Acceptance Criterion §Tests, plus subscription-CLI
// regression guard and backward-compatibility test.
import { describe, it, expect } from "vitest";
import * as costService from "../cost-service.mjs";

const EPSILON = 1e-6;

describe("priceSlice: Anthropic cache token classes (Slice 4)", () => {
  it("Anthropic Opus with cache_read_tokens only — 0.10× rate, breakdown populated", () => {
    // Opus 4.7: $5/Mtok input. 10000 cache_read × $5e-6 × 0.10 = $0.005
    const r = costService.priceSlice({
      vendor: "anthropic",
      model: "claude-opus-4.7",
      tokens_in: 0,
      tokens_out: 0,
      cache_read_tokens: 10000,
    }, "api-anthropic");
    expect(r.cost_usd).toBeCloseTo(0.005, 6);
    expect(r.cost_breakdown.input_cache_read).toBeCloseTo(0.005, 6);
    expect(r.cost_breakdown.input_uncached).toBe(0);
    expect(r.cost_breakdown.output_total).toBe(0);
  });

  it("Anthropic Opus with cache_creation_5m_tokens only — 1.25× rate, breakdown populated", () => {
    // Opus 4.7: $5/Mtok. 10000 × $5e-6 × 1.25 = $0.0625
    const r = costService.priceSlice({
      vendor: "anthropic",
      model: "claude-opus-4.7",
      tokens_in: 0,
      tokens_out: 0,
      cache_creation_5m_tokens: 10000,
    }, "api-anthropic");
    expect(r.cost_usd).toBeCloseTo(0.0625, 6);
    expect(r.cost_breakdown.input_cache_write_5m).toBeCloseTo(0.0625, 6);
  });

  it("Anthropic Opus with cache_creation_1h_tokens only — 2.0× rate, breakdown populated", () => {
    // Opus 4.7: $5/Mtok. 10000 × $5e-6 × 2.0 = $0.10
    const r = costService.priceSlice({
      vendor: "anthropic",
      model: "claude-opus-4.7",
      tokens_in: 0,
      tokens_out: 0,
      cache_creation_1h_tokens: 10000,
    }, "api-anthropic");
    expect(r.cost_usd).toBeCloseTo(0.10, 6);
    expect(r.cost_breakdown.input_cache_write_1h).toBeCloseTo(0.10, 6);
  });

  it("Anthropic Opus with cache_creation_input_tokens (combined, no split) — defaults to 5m rate", () => {
    // Per Required Decision 4: when 5m/1h split is unavailable, default the
    // entire combined value to the 5m rate (1.25×).
    const r = costService.priceSlice({
      vendor: "anthropic",
      model: "claude-opus-4.7",
      tokens_in: 0,
      tokens_out: 0,
      cache_creation_input_tokens: 1000,
    }, "api-anthropic");
    // 1000 × $5e-6 × 1.25 = $0.00625
    expect(r.cost_usd).toBeCloseTo(0.00625, 6);
    expect(r.cost_breakdown.input_cache_write_5m).toBeCloseTo(0.00625, 6);
    expect(r.cost_breakdown.input_cache_write_1h).toBe(0);
  });

  it("Anthropic Opus combined: cache_read + 5m write + tokens_out — breakdown sums to cost_usd", () => {
    // Opus 4.7: $5/Mtok in, $25/Mtok out
    // 1000 uncached + 5000 cache_read + 2000 5m write + 500 output
    // = $5e-3 + $5e-6 × 5000 × 0.10 + $5e-6 × 2000 × 1.25 + $25e-6 × 500
    // = $0.005 + $0.0025 + $0.0125 + $0.0125 = $0.0325
    const r = costService.priceSlice({
      vendor: "anthropic",
      model: "claude-opus-4.7",
      tokens_in: 1000,
      tokens_out: 500,
      cache_read_tokens: 5000,
      cache_creation_5m_tokens: 2000,
    }, "api-anthropic");
    expect(r.cost_usd).toBeCloseTo(0.0325, 6);
    const sum = r.cost_breakdown.input_uncached + r.cost_breakdown.input_cache_read +
                r.cost_breakdown.input_cache_write_5m + r.cost_breakdown.input_cache_write_1h +
                r.cost_breakdown.output_total + r.cost_breakdown.subscription_cost;
    expect(sum).toBeCloseTo(r.cost_usd, 6);
  });
});

describe("priceSlice: OpenAI mirror-opposite math (Slice 4)", () => {
  it("OpenAI o3 with reasoning_tokens — informational only, NOT double-counted", () => {
    // o3: $2/Mtok in, $8/Mtok out. tokens_out=1000 INCLUDES reasoning_tokens=700.
    // Cost: 100 × $2e-6 + 1000 × $8e-6 = $0.0082 (reasoning NOT added on top)
    const r = costService.priceSlice({
      vendor: "openai",
      model: "o3",
      tokens_in: 100,
      tokens_out: 1000,
      reasoning_tokens: 700,
    }, "api-openai");
    expect(r.cost_usd).toBeCloseTo(0.0082, 6);
    expect(r.cost_breakdown.reasoning_tokens).toBe(700); // informational
    expect(r.cost_breakdown.output_total).toBeCloseTo(0.008, 6); // bills full tokens_out, not just visible
  });

  it("OpenAI gpt-5.5 with cache_read_tokens — 0.10× rate, mirror-opposite of Anthropic", () => {
    // gpt-5.5: $5/Mtok in, $30/Mtok out, cache 0.10×.
    // tokens_in=2000 INCLUDES cache_read_tokens=1500. Uncached = 500.
    // Cost: 500 × $5e-6 + 1500 × $5e-6 × 0.10 + 500 × $30e-6
    //     = $0.0025 + $0.00075 + $0.015 = $0.01825
    const r = costService.priceSlice({
      vendor: "openai",
      model: "gpt-5.5",
      tokens_in: 2000,
      tokens_out: 500,
      cache_read_tokens: 1500,
    }, "api-openai");
    expect(r.cost_usd).toBeCloseTo(0.01825, 6);
    // Critical: uncached = (tokens_in - cache_read), NOT tokens_in
    expect(r.cost_breakdown.input_uncached).toBeCloseTo(0.0025, 6);
    expect(r.cost_breakdown.input_cache_read).toBeCloseTo(0.00075, 6);
  });

  it("OpenAI o1 with cache_read_tokens — 0.50× rate (per-model multiplier varies)", () => {
    // o1: $15/Mtok in, cache 0.50× (NOT 0.10× like gpt-5.x)
    // 1000 cached × $15e-6 × 0.50 = $0.0075
    const r = costService.priceSlice({
      vendor: "openai",
      model: "o1",
      tokens_in: 1000,
      tokens_out: 0,
      cache_read_tokens: 1000,
    }, "api-openai");
    expect(r.cost_usd).toBeCloseTo(0.0075, 6);
  });

  it("OpenAI gpt-5.4 with service_tier='flex' — 0.5× input AND 0.5× output", () => {
    // gpt-5.4 std: 1000 × $2.5e-6 + 500 × $15e-6 = $0.0025 + $0.0075 = $0.01
    // flex (0.5× both): $0.005
    const r = costService.priceSlice({
      vendor: "openai",
      model: "gpt-5.4",
      tokens_in: 1000,
      tokens_out: 500,
      service_tier: "flex",
    }, "api-openai");
    expect(r.cost_usd).toBeCloseTo(0.005, 6);
    // tier_adjustment: active − standard = 0.005 − 0.01 = −0.005 (savings)
    expect(r.cost_breakdown.tier_adjustment).toBeCloseTo(-0.005, 6);
  });

  it("OpenAI gpt-5.4 with service_tier='priority' — 2.0× input, 1.5× output (asymmetric)", () => {
    // priority: 1000 × $2.5e-6 × 2.0 + 500 × $15e-6 × 1.5
    //         = $0.005 + $0.01125 = $0.01625
    const r = costService.priceSlice({
      vendor: "openai",
      model: "gpt-5.4",
      tokens_in: 1000,
      tokens_out: 500,
      service_tier: "priority",
    }, "api-openai");
    expect(r.cost_usd).toBeCloseTo(0.01625, 6);
    expect(r.cost_breakdown.tier_adjustment).toBeGreaterThan(0); // surcharge
  });
});

describe("priceSlice: xAI authoritative ticks (Slice 4)", () => {
  it("xAI grok-4.3 with cost_in_usd_ticks — bypasses computed math, breakdown carries authoritative_source", () => {
    // Use a tick value clear of the 6-decimal rounding threshold.
    // 1_234_500_000 ticks × 1e-10 = 0.12345 USD (cleanly representable).
    const r = costService.priceSlice({
      vendor: "xai",
      model: "grok-4.3",
      tokens_in: 99999, // ignored
      tokens_out: 99999, // ignored
      cost_in_usd_ticks: 1_234_500_000,
    }, "api-xai");
    expect(r.cost_usd).toBeCloseTo(0.12345, 6);
    expect(r.cost_breakdown.authoritative_source).toBe("cost_in_usd_ticks");
  });

  it("xAI grok-4.3 without cost_in_usd_ticks — falls back to multiplier math (0.25× cache)", () => {
    // grok-4.3: $1.25/Mtok in, $2.5/Mtok out, cache 0.25×
    // 1000 in INCLUDES 200 cache_read. Uncached = 800.
    // 800 × $1.25e-6 + 200 × $1.25e-6 × 0.25 + 500 × $2.5e-6
    // = $0.001 + $0.0000625 + $0.00125 = $0.0023125 unrounded
    // After roundUsd() (6 decimal places): $0.002313 (0.0023125 rounds up at the
    // 7th digit per JS Math.round half-away-from-zero rule for positive numbers).
    const r = costService.priceSlice({
      vendor: "xai",
      model: "grok-4.3",
      tokens_in: 1000,
      tokens_out: 500,
      cache_read_tokens: 200,
    }, "api-xai");
    expect(r.cost_usd).toBeCloseTo(0.002313, 6);
    expect(r.cost_breakdown.authoritative_source).toBeUndefined();
  });
});

describe("priceSlice: Backward compatibility + regression guards (Slice 4)", () => {
  it("Subscription-CLI worker — gh-copilot UNCHANGED (v2.83.0 fix protected)", () => {
    // Forbidden Action #1: subscription path must not regress.
    const r = costService.priceSlice({
      model: "gh-copilot",
      premiumRequests: 5,
    }, "gh-copilot");
    expect(r.cost_usd).toBe(0.05);
    expect(r.cost_breakdown.subscription_cost).toBe(0.05);
  });

  it("Backward compatibility — caller without vendor field uses corrected legacy math", () => {
    // Existing callers that pass { tokens_in, tokens_out, model } without vendor
    // get the legacy backward-compatible path. New cache fields are ignored.
    // After Slice 2 rate corrections, sonnet-4.6 is $3/Mtok in, $15/Mtok out.
    // 1000 × $3e-6 + 500 × $15e-6 = $0.0105
    const r = costService.priceSlice({
      tokens_in: 1000,
      tokens_out: 500,
      model: "claude-sonnet-4.6",
      // Even with cache fields set, they're ignored without vendor identification
      cache_read_tokens: 5000, // should be ignored
    }, "api-anthropic");
    expect(r.cost_usd).toBeCloseTo(0.0105, 6);
    expect(r.cost_breakdown.input_cache_read).toBe(0); // confirmed ignored
  });
});
