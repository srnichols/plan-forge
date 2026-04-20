/**
 * Plan Forge — Phase-26 Slice 10 (Cost-anomaly detector + escalation re-rank) tests
 *
 * Covers pure helpers in orchestrator.mjs:
 *   - computeMedian()
 *   - detectCostAnomaly()
 *   - rerankEscalationChain()
 *
 * MUST (docs/plans/Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md §Slice 10):
 *   - Detect attempt.cost_usd > 2 × median(plan.sliceCosts) as anomaly
 *   - Re-rank next retry's escalation chain by avg_cost_usd ascending
 *   - Per-plan scope (caller resets sliceCosts at plan start)
 */

import { describe, it, expect } from "vitest";
import {
  computeMedian,
  detectCostAnomaly,
  rerankEscalationChain,
  COST_ANOMALY_MULTIPLIER,
} from "../orchestrator.mjs";

// ─── computeMedian ────────────────────────────────────────────────────

describe("computeMedian", () => {
  it("returns 0 for empty / non-array input", () => {
    expect(computeMedian([])).toBe(0);
    expect(computeMedian(null)).toBe(0);
    expect(computeMedian(undefined)).toBe(0);
    expect(computeMedian("nope")).toBe(0);
  });

  it("returns the middle element for odd-length arrays", () => {
    expect(computeMedian([1, 3, 2])).toBe(2);
    expect(computeMedian([0.5, 0.1, 0.9, 0.3, 0.7])).toBeCloseTo(0.5, 10);
  });

  it("averages the two middle elements for even-length arrays", () => {
    expect(computeMedian([1, 2, 3, 4])).toBe(2.5);
    expect(computeMedian([0.1, 0.2])).toBeCloseTo(0.15, 10);
  });

  it("ignores non-finite values", () => {
    expect(computeMedian([NaN, Infinity, 1, 2, 3])).toBe(2);
    // Number("abc") → NaN (filtered); other finite numbers pass through.
    expect(computeMedian(["abc", 1, 3, 5])).toBe(3);
  });
});

// ─── detectCostAnomaly ────────────────────────────────────────────────

describe("detectCostAnomaly", () => {
  it("returns isAnomaly:false when the sample is empty (no signal yet)", () => {
    const r = detectCostAnomaly({ sliceCosts: [], currentCost: 100 });
    expect(r.isAnomaly).toBe(false);
    expect(r.median).toBe(0);
    expect(r.ratio).toBeNull();
  });

  it("flags current cost > 2 × median (default multiplier)", () => {
    const r = detectCostAnomaly({ sliceCosts: [1, 1, 1, 1, 1], currentCost: 2.5 });
    expect(r.isAnomaly).toBe(true);
    expect(r.median).toBe(1);
    expect(r.ratio).toBeCloseTo(2.5, 10);
    expect(r.threshold).toBe(COST_ANOMALY_MULTIPLIER);
  });

  it("does NOT flag current cost exactly 2 × median (strict >)", () => {
    const r = detectCostAnomaly({ sliceCosts: [1, 1, 1], currentCost: 2 });
    expect(r.isAnomaly).toBe(false);
    expect(r.ratio).toBe(2);
  });

  it("does NOT flag cost within 2×", () => {
    const r = detectCostAnomaly({ sliceCosts: [1, 2, 3], currentCost: 3 });
    expect(r.isAnomaly).toBe(false);
  });

  it("honours custom threshold", () => {
    const r = detectCostAnomaly({ sliceCosts: [1, 1, 1], currentCost: 1.6, threshold: 1.5 });
    expect(r.isAnomaly).toBe(true);
  });

  it("returns isAnomaly:false for zero/negative current cost", () => {
    expect(detectCostAnomaly({ sliceCosts: [1, 1], currentCost: 0 }).isAnomaly).toBe(false);
    expect(detectCostAnomaly({ sliceCosts: [1, 1], currentCost: -5 }).isAnomaly).toBe(false);
  });

  it("falls back to default multiplier for invalid threshold", () => {
    const r = detectCostAnomaly({ sliceCosts: [1, 1], currentCost: 3, threshold: -1 });
    expect(r.threshold).toBe(COST_ANOMALY_MULTIPLIER);
    expect(r.isAnomaly).toBe(true);
  });

  it("handles single-sample median correctly", () => {
    const r = detectCostAnomaly({ sliceCosts: [2], currentCost: 5 });
    expect(r.median).toBe(2);
    expect(r.isAnomaly).toBe(true);
  });
});

// ─── rerankEscalationChain ────────────────────────────────────────────

describe("rerankEscalationChain", () => {
  const modelStats = {
    "claude-opus-4.6":   { total_slices: 10, avg_cost_usd: 0.80 },
    "gpt-5.3-codex":     { total_slices: 10, avg_cost_usd: 0.15 },
    "grok-4.20":         { total_slices: 10, avg_cost_usd: 0.05 },
    "claude-sonnet-4.6": { total_slices: 10, avg_cost_usd: 0.25 },
  };

  it("returns [] for empty / invalid chain", () => {
    expect(rerankEscalationChain({ chain: [] })).toEqual([]);
    expect(rerankEscalationChain({ chain: null })).toEqual([]);
  });

  it("re-ranks known models by avg_cost_usd ascending", () => {
    const chain = ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20", "claude-sonnet-4.6"];
    const result = rerankEscalationChain({ chain, modelStats });
    expect(result).toEqual(["grok-4.20", "gpt-5.3-codex", "claude-sonnet-4.6", "claude-opus-4.6"]);
  });

  it("pins 'auto' at the head regardless of stats", () => {
    const chain = ["auto", "claude-opus-4.6", "gpt-5.3-codex"];
    const result = rerankEscalationChain({ chain, modelStats });
    expect(result[0]).toBe("auto");
    expect(result.slice(1)).toEqual(["gpt-5.3-codex", "claude-opus-4.6"]);
  });

  it("trails unknown models after ranked ones, preserving input order", () => {
    const chain = ["claude-opus-4.6", "unknown-a", "gpt-5.3-codex", "unknown-b"];
    const result = rerankEscalationChain({ chain, modelStats });
    expect(result).toEqual(["gpt-5.3-codex", "claude-opus-4.6", "unknown-a", "unknown-b"]);
  });

  it("honours custom preserveLeading sentinels", () => {
    const chain = ["copilot", "auto", "claude-opus-4.6", "gpt-5.3-codex"];
    const result = rerankEscalationChain({
      chain,
      modelStats,
      preserveLeading: ["copilot", "auto"],
    });
    expect(result.slice(0, 2)).toEqual(["copilot", "auto"]);
    expect(result.slice(2)).toEqual(["gpt-5.3-codex", "claude-opus-4.6"]);
  });

  it("is stable across ties in avg_cost_usd", () => {
    const stats = {
      a: { avg_cost_usd: 0.10 },
      b: { avg_cost_usd: 0.10 },
      c: { avg_cost_usd: 0.10 },
    };
    expect(rerankEscalationChain({ chain: ["a", "b", "c"], modelStats: stats }))
      .toEqual(["a", "b", "c"]);
    expect(rerankEscalationChain({ chain: ["c", "a", "b"], modelStats: stats }))
      .toEqual(["c", "a", "b"]);
  });

  it("treats missing modelStats as all-unknown (identity re-rank)", () => {
    const chain = ["m1", "m2", "m3"];
    expect(rerankEscalationChain({ chain })).toEqual(chain);
    expect(rerankEscalationChain({ chain, modelStats: {} })).toEqual(chain);
  });

  it("ignores models with non-finite avg_cost_usd", () => {
    const stats = {
      a: { avg_cost_usd: "NaN-ish" },
      b: { avg_cost_usd: 0.05 },
    };
    // 'a' has no usable stat → trails 'b'
    expect(rerankEscalationChain({ chain: ["a", "b"], modelStats: stats })).toEqual(["b", "a"]);
  });

  it("filters non-string entries into the trailing group", () => {
    const chain = ["claude-opus-4.6", 42, "gpt-5.3-codex"];
    const result = rerankEscalationChain({ chain, modelStats });
    // 42 is treated as non-string "unknown" → trails
    expect(result[0]).toBe("gpt-5.3-codex");
    expect(result[1]).toBe("claude-opus-4.6");
    expect(result[2]).toBe(42);
  });
});

// ─── Integration: anomaly → re-rank ───────────────────────────────────

describe("anomaly → re-rank integration", () => {
  it("canonical cheaper-preferred flow: median low, current high, chain re-ranked by cost", () => {
    const sliceCosts = [0.10, 0.12, 0.11, 0.09, 0.13];
    const currentCost = 0.40; // > 2 × 0.11 median
    const anomaly = detectCostAnomaly({ sliceCosts, currentCost });
    expect(anomaly.isAnomaly).toBe(true);

    if (anomaly.isAnomaly) {
      const modelStats = {
        "claude-opus-4.6": { avg_cost_usd: 0.80 },
        "gpt-5.3-codex":   { avg_cost_usd: 0.15 },
        "grok-4.20":       { avg_cost_usd: 0.05 },
      };
      const rerank = rerankEscalationChain({
        chain: ["auto", "claude-opus-4.6", "gpt-5.3-codex", "grok-4.20"],
        modelStats,
      });
      // auto pinned, then cheapest-first
      expect(rerank).toEqual(["auto", "grok-4.20", "gpt-5.3-codex", "claude-opus-4.6"]);
    }
  });
});
