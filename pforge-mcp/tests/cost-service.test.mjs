import { describe, it, expect } from "vitest";
import * as costService from "../cost-service.mjs";
import { calculateSliceCost, buildCostBreakdown, buildEstimate } from "../orchestrator.mjs";

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

// ─── Slice 3 fixtures ─────────────────────────────────────────────────
function makePlan(sliceCount, opts = {}) {
  const slices = [];
  const order = [];
  for (let i = 1; i <= sliceCount; i++) {
    slices.push({
      number: i,
      title: `Slice ${i}`,
      depends: i === 1 ? [] : [String(i - 1)],
      parallel: false,
      scope: opts.scope || [`src/file${i}.mjs`],
      tasks: opts.tasks || [],
    });
    order.push(String(i));
  }
  return { slices, dag: { order } };
}

describe("cost-service: estimatePlan parity (Slice 3)", () => {
  it("estimatePlan matches buildEstimate — simple 3-slice plan, no quorum, no cwd", () => {
    const plan = makePlan(3);
    const a = costService.estimatePlan(plan, "claude-sonnet-4.5", null, null, null);
    const b = buildEstimate(plan, "claude-sonnet-4.5", null, null, null);
    expect(a).toEqual(b);
  });

  it("estimatePlan matches buildEstimate — 5-slice plan with resumeFrom=3", () => {
    const plan = makePlan(5);
    const a = costService.estimatePlan(plan, "claude-opus-4.6", null, null, "3");
    const b = buildEstimate(plan, "claude-opus-4.6", null, null, "3");
    expect(a).toEqual(b);
  });

  it("estimatePlan matches buildEstimate — with quorum config enabled", () => {
    const plan = makePlan(4);
    const quorumConfig = {
      enabled: true,
      auto: false,
      threshold: 5,
      models: ["claude-opus-4.6", "gpt-5.3-codex"],
      reviewerModel: "claude-opus-4.7",
      preset: "power",
    };
    // Note: quorum paths call scoreSliceComplexity → requires non-null cwd.
    // Use process.cwd() since buildEstimate has the same constraint.
    const cwd = process.cwd();
    const a = costService.estimatePlan(plan, "claude-sonnet-4.5", cwd, quorumConfig, null);
    const b = buildEstimate(plan, "claude-sonnet-4.5", cwd, quorumConfig, null);
    expect(a).toEqual(b);
  });
});

describe("cost-service: estimateQuorum regression (Slice 3)", () => {
  it("returns all four modes with numeric estimates for a 6-slice heuristic plan", () => {
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });

    expect(result.auto).toBeDefined();
    expect(result.power).toBeDefined();
    expect(result.speed).toBeDefined();
    expect(result["false"]).toBeDefined();
    expect(["auto", "power", "speed", "false"]).toContain(result.recommended);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (const mode of ["auto", "power", "speed", "false"]) {
      const s = result[mode];
      expect(typeof s.estimatedCostUSD).toBe("number");
      expect(s.estimatedCostUSD).toBeGreaterThanOrEqual(0);
      expect(typeof s.baseCostUSD).toBe("number");
      expect(typeof s.overheadUSD).toBe("number");
      expect(s.totalSliceCount).toBe(6);
      expect(s.confidence).toBe("heuristic");
    }
  });

  it("REGRESSION GUARD: power mode on 6 trivial heuristic slices stays under $25 (fabrication catcher)", () => {
    // This test exists because on 2026-04-20 an agent hallucinated a quorum picker
    // claiming "power: $146.57" for 6 slices. Real pforge math on the same input
    // produces ~$10-15. Any change that pushes this above $25 either broke the
    // pricing table or broke the quorum overhead formula — investigate before shipping.
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });

    expect(result.power.estimatedCostUSD).toBeLessThan(25);
    expect(result["false"].estimatedCostUSD).toBeLessThan(5); // no quorum → just base
  });

  it("throws on missing plan", () => {
    expect(() => costService.estimateQuorum({ plan: null })).toThrow();
    expect(() => costService.estimateQuorum({})).toThrow();
  });
});
