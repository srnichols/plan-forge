import { describe, it, expect } from "vitest";
import * as costService from "../cost-service.mjs";
import { calculateSliceCost, buildCostBreakdown } from "../orchestrator.mjs";

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

describe("cost-service: priceSlice parity (Slice 2)", () => {
  const fixtures = [
    {
      name: "API worker with sonnet tokens",
      tokens: { tokens_in: 10000, tokens_out: 3000, model: "claude-sonnet-4.5" },
      worker: "api-anthropic",
    },
    {
      name: "API worker with opus tokens",
      tokens: { tokens_in: 5000, tokens_out: 8000, model: "claude-opus-4.6" },
      worker: "api-anthropic",
    },
    {
      name: "API worker with unknown model falls to default",
      tokens: { tokens_in: 1000, tokens_out: 500, model: "mystery-model" },
      worker: "api-other",
    },
    {
      name: "CLI worker uses premium request rate",
      tokens: { tokens_in: 99999, tokens_out: 99999, model: "claude-sonnet-4.5", premiumRequests: 5 },
      worker: "gh-copilot",
    },
    {
      name: "CLI worker with no premium requests costs 0",
      tokens: { tokens_in: 10000, tokens_out: 5000, model: "claude-sonnet-4.5" },
      worker: "claude",
    },
    {
      name: "missing tokens defaults to 0",
      tokens: { model: "gpt-5.4" },
      worker: "api-openai",
    },
    {
      name: "null worker treated as API path",
      tokens: { tokens_in: 2000, tokens_out: 1000, model: "grok-4.20" },
      worker: undefined,
    },
  ];

  for (const f of fixtures) {
    it(`priceSlice matches calculateSliceCost — ${f.name}`, () => {
      const newResult = costService.priceSlice(f.tokens, f.worker);
      const oldResult = calculateSliceCost(f.tokens, f.worker);
      expect(newResult).toEqual(oldResult);
    });
  }
});

describe("cost-service: priceRun parity (Slice 2)", () => {
  it("priceRun matches buildCostBreakdown on a mixed slice set", () => {
    const sliceResults = [
      {
        number: 1,
        worker: "api-anthropic",
        status: "passed",
        tokens: { tokens_in: 5000, tokens_out: 2000, model: "claude-sonnet-4.5" },
      },
      {
        number: 2,
        worker: "gh-copilot",
        status: "passed",
        tokens: { tokens_in: 100, tokens_out: 50, model: "claude-sonnet-4.5", premiumRequests: 3 },
      },
      {
        number: 3,
        worker: "api-openai",
        status: "skipped",
        tokens: { tokens_in: 1000, tokens_out: 500, model: "gpt-5.4" },
      },
      {
        number: 4,
        worker: "api-anthropic",
        status: "passed",
        tokens: { tokens_in: 8000, tokens_out: 6000, model: "claude-opus-4.6" },
      },
    ];
    const newResult = costService.priceRun(sliceResults);
    const oldResult = buildCostBreakdown(sliceResults);
    expect(newResult).toEqual(oldResult);
  });

  it("priceRun returns zeros for empty slice set", () => {
    const result = costService.priceRun([]);
    expect(result.total_cost_usd).toBe(0);
    expect(result.total_tokens_in).toBe(0);
    expect(result.total_tokens_out).toBe(0);
    expect(result.by_slice).toEqual([]);
    expect(result.by_model).toEqual({});
  });
});
