import { describe, it, expect } from "vitest";
import * as costService from "../cost-service.mjs";

describe("cost-service: MODEL_PRICING + getPricing (Slice 1)", () => {
  it("exports MODEL_PRICING as an object with a default rate", () => {
    expect(costService.MODEL_PRICING).toBeTypeOf("object");
    expect(costService.MODEL_PRICING.default).toBeDefined();
    expect(costService.MODEL_PRICING.default.input).toBeGreaterThan(0);
    expect(costService.MODEL_PRICING.default.output).toBeGreaterThan(0);
  });

  it("includes canonical flagship models", () => {
    expect(costService.MODEL_PRICING["claude-opus-4.6"]).toBeDefined();
    expect(costService.MODEL_PRICING["claude-sonnet-4.5"]).toBeDefined();
    expect(costService.MODEL_PRICING["gpt-5.4"]).toBeDefined();
    expect(costService.MODEL_PRICING["grok-4.20"]).toBeDefined();
    expect(costService.MODEL_PRICING["gemini-3-pro-preview"]).toBeDefined();
  });

  it("getPricing returns the model's pricing when known", () => {
    const pricing = costService.getPricing("claude-opus-4.6");
    expect(pricing.input).toBe(15 / 1_000_000);
    expect(pricing.output).toBe(75 / 1_000_000);
  });

  it("getPricing falls back to default for unknown models", () => {
    const pricing = costService.getPricing("nonexistent-model-xyz");
    expect(pricing).toBe(costService.MODEL_PRICING.default);
  });

  it("getPricing handles null/undefined model safely", () => {
    expect(costService.getPricing(null)).toBe(costService.MODEL_PRICING.default);
    expect(costService.getPricing(undefined)).toBe(costService.MODEL_PRICING.default);
  });
});
