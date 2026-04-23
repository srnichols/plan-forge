/**
 * Tests for pforge-master/src/cost.mjs (Phase-38.2).
 *
 * Covers:
 *   (1) getPricing — known models, unknown models fallback
 *   (2) computeTurnCost — zero tokens, positive tokens, mixed-model fallback
 *   (3) All TURN_PRICING entries are positive and finite
 */

import { describe, it, expect } from "vitest";
import { TURN_PRICING, getPricing, computeTurnCost } from "../cost.mjs";

// ─── (1) getPricing ────────────────────────────────────────────────────

describe("getPricing", () => {
  it("returns specific pricing for a known model", () => {
    const p = getPricing("gpt-4o-mini");
    expect(p.input).toBe(0.15 / 1_000_000);
    expect(p.output).toBe(0.6 / 1_000_000);
  });

  it("returns specific pricing for claude-opus models", () => {
    const p = getPricing("claude-opus-4.7");
    expect(p.input).toBe(15 / 1_000_000);
    expect(p.output).toBe(75 / 1_000_000);
  });

  it("falls back to default for an unknown model string", () => {
    const def = getPricing("some-future-model-xyz");
    expect(def).toEqual(TURN_PRICING.default);
  });

  it("falls back to default for null", () => {
    expect(getPricing(null)).toEqual(TURN_PRICING.default);
  });

  it("falls back to default for undefined", () => {
    expect(getPricing(undefined)).toEqual(TURN_PRICING.default);
  });

  it("falls back to default for empty string", () => {
    expect(getPricing("")).toEqual(TURN_PRICING.default);
  });
});

// ─── (2) computeTurnCost ──────────────────────────────────────────────

describe("computeTurnCost", () => {
  it("returns 0 for zero tokens", () => {
    expect(computeTurnCost("gpt-4o-mini", 0, 0)).toBe(0);
  });

  it("computes correct cost for known model", () => {
    // gpt-4o-mini: $0.15/M input, $0.60/M output
    const cost = computeTurnCost("gpt-4o-mini", 1000, 200);
    const expected = (1000 * 0.15 / 1_000_000) + (200 * 0.6 / 1_000_000);
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("computes correct cost for claude-opus (expensive model)", () => {
    // claude-opus-4.7: $15/M input, $75/M output
    const cost = computeTurnCost("claude-opus-4.7", 1000, 500);
    const expected = (1000 * 15 / 1_000_000) + (500 * 75 / 1_000_000);
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("falls back to default pricing for unknown model", () => {
    const defPricing = TURN_PRICING.default;
    const cost = computeTurnCost("unknown-model", 500, 100);
    const expected = (500 * defPricing.input) + (100 * defPricing.output);
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("accumulates correctly across two calls (simulating mixed-model turn)", () => {
    // Simulate: first iteration on high-tier, then fallback to low-tier
    const costHigh = computeTurnCost("claude-opus-4.7", 800, 200);
    const costLow = computeTurnCost("gpt-4o-mini", 400, 100);
    const total = costHigh + costLow;
    expect(total).toBeGreaterThan(costHigh);
    expect(total).toBeGreaterThan(costLow);
    // High tier should dominate
    expect(costHigh).toBeGreaterThan(costLow * 10);
  });

  it("Deep tier is substantially more expensive than Fast for same token count", () => {
    const fastCost = computeTurnCost("gpt-4o-mini", 1000, 500);
    const deepCost = computeTurnCost("claude-opus-4.7", 1000, 500);
    expect(deepCost).toBeGreaterThan(fastCost * 10);
  });
});

// ─── (3) Table integrity ──────────────────────────────────────────────

describe("TURN_PRICING table integrity", () => {
  it("all entries have positive finite input and output rates", () => {
    for (const [model, rates] of Object.entries(TURN_PRICING)) {
      expect(rates.input, `${model}.input`).toBeGreaterThan(0);
      expect(rates.output, `${model}.output`).toBeGreaterThan(0);
      expect(Number.isFinite(rates.input), `${model}.input finite`).toBe(true);
      expect(Number.isFinite(rates.output), `${model}.output finite`).toBe(true);
    }
  });

  it("output rates are always >= input rates (typical LLM pricing pattern)", () => {
    for (const [model, rates] of Object.entries(TURN_PRICING)) {
      expect(rates.output, `${model}: output >= input`).toBeGreaterThanOrEqual(rates.input);
    }
  });

  it("includes the key Forge-Master default models", () => {
    expect(TURN_PRICING["gpt-4o-mini"]).toBeDefined();
    expect(TURN_PRICING["gpt-4o"]).toBeDefined();
    expect(TURN_PRICING["claude-sonnet-4.5"]).toBeDefined();
    expect(TURN_PRICING["grok-3-mini"]).toBeDefined();
    expect(TURN_PRICING.default).toBeDefined();
  });
});
