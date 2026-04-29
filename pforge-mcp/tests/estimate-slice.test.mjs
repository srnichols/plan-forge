import { describe, it, expect } from "vitest";
import {
  estimateSlice,
  estimatePlan,
  buildQuorumConfigForMode,
  getPricing,
} from "../cost-service.mjs";

// Hermetic cwd with no .forge/ — ensures heuristic tokens and no history
const CLEAN_CWD = import.meta.dirname;

function makePlan(sliceCount, opts = {}) {
  const slices = [];
  const order = [];
  for (let i = 1; i <= sliceCount; i++) {
    slices.push({
      number: opts.alphanumeric ? `${i}A` : i,
      title: `Slice ${i}`,
      depends: i === 1 ? [] : [String(opts.alphanumeric ? `${i - 1}A` : i - 1)],
      parallel: false,
      scope: opts.scope || [`src/file${i}.mjs`],
      tasks: opts.tasks || [],
    });
    order.push(String(opts.alphanumeric ? `${i}A` : i));
  }
  return { slices, dag: { order } };
}

describe("cost-service: estimateSlice (Phase-27.2 Slice 1)", () => {
  it("returns a finite cost for a valid sliceNumber", () => {
    const plan = makePlan(5);
    const result = estimateSlice({ plan, sliceNumber: 3, cwd: CLEAN_CWD });
    expect(typeof result.estimatedCostUSD).toBe("number");
    expect(Number.isFinite(result.estimatedCostUSD)).toBe(true);
    expect(result.estimatedCostUSD).toBeGreaterThan(0);
    expect(typeof result.baseCostUSD).toBe("number");
    expect(typeof result.overheadUSD).toBe("number");
    expect(typeof result.complexityScore).toBe("number");
    expect(result.model).toBe("claude-sonnet-4.5");
    expect(typeof result.quorumEligible).toBe("boolean");
    expect(typeof result.rationale).toBe("string");
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("mode 'false' returns overheadUSD: 0 and quorumEligible: false", () => {
    const plan = makePlan(3);
    const result = estimateSlice({ plan, sliceNumber: 1, mode: "false", cwd: CLEAN_CWD });
    expect(result.overheadUSD).toBe(0);
    expect(result.quorumEligible).toBe(false);
    expect(result.rationale).toContain("false");
  });

  it("mode 'power' on a trivially-scored slice returns quorumEligible: true", () => {
    const plan = makePlan(3);
    const result = estimateSlice({ plan, sliceNumber: 1, mode: "power", cwd: CLEAN_CWD });
    expect(result.quorumEligible).toBe(true);
    expect(result.overheadUSD).toBeGreaterThan(0);
    expect(result.rationale).toContain("power");
  });

  it("mode 'speed' on a trivially-scored slice returns quorumEligible: true", () => {
    const plan = makePlan(3);
    const result = estimateSlice({ plan, sliceNumber: 2, mode: "speed", cwd: CLEAN_CWD });
    expect(result.quorumEligible).toBe(true);
    expect(result.overheadUSD).toBeGreaterThan(0);
  });

  it("mode 'auto' on a trivially-scored slice returns quorumEligible: false with threshold rationale", () => {
    // Trivial slice: 1 scope file, 0 tasks, no security/db keywords
    const plan = makePlan(3, { scope: ["src/simple.mjs"], tasks: [] });
    const result = estimateSlice({ plan, sliceNumber: 1, mode: "auto", cwd: CLEAN_CWD });
    expect(result.quorumEligible).toBe(false);
    expect(result.rationale).toMatch(/threshold \d+ not met/);
  });

  it("throws with a clear error if sliceNumber is not in plan.slices", () => {
    const plan = makePlan(3);
    expect(() => estimateSlice({ plan, sliceNumber: 99, cwd: CLEAN_CWD })).toThrow(/sliceNumber "99" not found/);
  });

  it("throws on missing plan", () => {
    expect(() => estimateSlice({ plan: null, sliceNumber: 1 })).toThrow();
    expect(() => estimateSlice({})).toThrow();
  });

  it("throws on unknown mode", () => {
    const plan = makePlan(3);
    expect(() => estimateSlice({ plan, sliceNumber: 1, mode: "turbo", cwd: CLEAN_CWD })).toThrow(/unknown mode/);
  });

  it("supports alphanumeric slice IDs", () => {
    const plan = makePlan(3, { alphanumeric: true });
    const result = estimateSlice({ plan, sliceNumber: "2A", cwd: CLEAN_CWD });
    expect(result.estimatedCostUSD).toBeGreaterThan(0);
  });

  it("uses the specified model for pricing", () => {
    const plan = makePlan(3);
    const opusResult = estimateSlice({ plan, sliceNumber: 1, mode: "false", model: "claude-opus-4.6", cwd: CLEAN_CWD });
    const sonnetResult = estimateSlice({ plan, sliceNumber: 1, mode: "false", model: "claude-sonnet-4.5", cwd: CLEAN_CWD });
    expect(opusResult.model).toBe("claude-opus-4.6");
    expect(sonnetResult.model).toBe("claude-sonnet-4.5");
    // Opus is more expensive than sonnet
    expect(opusResult.baseCostUSD).toBeGreaterThan(sonnetResult.baseCostUSD);
  });
});

describe("cost-service: estimateSlice parity with estimatePlan (Phase-27.2 Slice 1)", () => {
  // When there is no cost history (correction factor == 1.0), summing estimateSlice
  // over every slice should equal estimatePlan's total. This holds for each quorum mode.
  // estimatePlan rounds at different precision (hundredths), so we compare within tolerance.
  // ANTHROPIC_API_KEY is set to force token-based pricing in both estimatePlan and estimateSlice
  // so the parity comparison is meaningful (Phase-34 Slice 2: provider-aware estimatePlan).

  for (const mode of ["auto", "power", "speed", "false"]) {
    it(`parity: sum(estimateSlice) ≈ estimatePlan total — mode "${mode}"`, () => {
      const origKey = process.env.ANTHROPIC_API_KEY;
      const origCostModel = process.env.PFORGE_COST_MODEL;
      try {
        process.env.ANTHROPIC_API_KEY = "test-key-for-parity";
        delete process.env.PFORGE_COST_MODEL;

        const plan = makePlan(5);
        const quorumConfig = buildQuorumConfigForMode(mode);

        const sliceSum = plan.slices.reduce((acc, s) => {
          const est = estimateSlice({ plan, sliceNumber: s.number, mode, cwd: CLEAN_CWD });
          return acc + est.estimatedCostUSD;
        }, 0);

        const planEst = estimatePlan(plan, "claude-sonnet-4.5", CLEAN_CWD, quorumConfig, null);
        const planTotal = planEst.totalCostWithQuorumUSD ?? planEst.estimatedCostUSD;

        // estimatePlan rounds to 2 decimals; estimateSlice to 6. Allow 1 cent tolerance.
        expect(Math.abs(sliceSum - planTotal)).toBeLessThan(0.01);
      } finally {
        if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = origKey;
        if (origCostModel === undefined) delete process.env.PFORGE_COST_MODEL;
        else process.env.PFORGE_COST_MODEL = origCostModel;
      }
    });
  }
});
