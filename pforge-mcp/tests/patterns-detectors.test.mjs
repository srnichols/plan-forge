import { describe, it, expect } from "vitest";
import detectModelFailure, { buildModelStats } from "../patterns/detectors/model-failure-rate-by-complexity.mjs";
import detectFlap, { countFlaps, resolveStatus } from "../patterns/detectors/slice-flap-pattern.mjs";
import detectCostAnomaly, { groupBySliceType, rollingAverage } from "../patterns/detectors/cost-anomaly.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Build a run with slice results containing model + complexity info. */
function makeRun(plan, slices) {
  return {
    plan,
    results: slices.map((s, i) => ({
      number: i + 1,
      title: s.title || `Slice ${i + 1}`,
      status: s.status || (s.gateStatus === "failed" ? "failed" : "passed"),
      gateStatus: s.gateStatus || "passed",
      model: s.model || null,
      complexity: s.complexity ?? null,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// model-failure-rate-by-complexity
// ═══════════════════════════════════════════════════════════════════════

describe("model-failure-rate-by-complexity detector", () => {
  it("surfaces model with > 25% failure rate on complexity ≥ 4", () => {
    const runs = [
      makeRun("Plan-A", [
        { model: "gpt-4o", complexity: 5, gateStatus: "failed" },
        { model: "gpt-4o", complexity: 4, gateStatus: "passed" },
        { model: "gpt-4o", complexity: 4, gateStatus: "failed" },
      ]),
    ];
    // 2 failed out of 3 → 66% > 25%
    const patterns = detectModelFailure({ runs });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].id).toBe("model-failure-rate-by-complexity:gpt-4o");
    expect(patterns[0].occurrences).toBe(2);
    expect(patterns[0].severity).toBe("error"); // 66% ≥ 50%
    expect(patterns[0].plans).toContain("Plan-A");
  });

  it("does NOT surface model with ≤ 25% failure rate", () => {
    const runs = [
      makeRun("Plan-A", [
        { model: "claude-sonnet", complexity: 5, gateStatus: "passed" },
        { model: "claude-sonnet", complexity: 4, gateStatus: "passed" },
        { model: "claude-sonnet", complexity: 4, gateStatus: "passed" },
        { model: "claude-sonnet", complexity: 5, gateStatus: "failed" },
      ]),
    ];
    // 1 failed out of 4 → 25%, not > 25%
    const patterns = detectModelFailure({ runs });
    expect(patterns).toHaveLength(0);
  });

  it("ignores slices with complexity < 4", () => {
    const runs = [
      makeRun("Plan-A", [
        { model: "gpt-4o-mini", complexity: 2, gateStatus: "failed" },
        { model: "gpt-4o-mini", complexity: 3, gateStatus: "failed" },
        { model: "gpt-4o-mini", complexity: 1, gateStatus: "failed" },
      ]),
    ];
    const patterns = detectModelFailure({ runs });
    expect(patterns).toHaveLength(0);
  });

  it("returns [] on empty/fresh data", () => {
    expect(detectModelFailure({ runs: [] })).toHaveLength(0);
    expect(detectModelFailure({})).toHaveLength(0);
    expect(detectModelFailure()).toHaveLength(0);
  });

  it("tracks failures across multiple plans", () => {
    const runs = [
      makeRun("Plan-X", [
        { model: "grok-3", complexity: 5, gateStatus: "failed" },
      ]),
      makeRun("Plan-Y", [
        { model: "grok-3", complexity: 4, gateStatus: "failed" },
      ]),
    ];
    const patterns = detectModelFailure({ runs });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].plans).toContain("Plan-X");
    expect(patterns[0].plans).toContain("Plan-Y");
  });

  it("buildModelStats filters by complexity ≥ 4", () => {
    const runs = [
      makeRun("P", [
        { model: "m1", complexity: 3 },
        { model: "m1", complexity: 4 },
        { model: "m1", complexity: 5 },
      ]),
    ];
    const stats = buildModelStats(runs);
    expect(stats.get("m1").total).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// slice-flap-pattern
// ═══════════════════════════════════════════════════════════════════════

describe("slice-flap-pattern detector", () => {
  it("detects slice flapping ≥ 3 times", () => {
    // pass→fail→pass→fail = 3 flaps
    const runs = [
      makeRun("Plan-A", [{ title: "Build API", gateStatus: "passed" }]),
      makeRun("Plan-A", [{ title: "Build API", gateStatus: "failed" }]),
      makeRun("Plan-A", [{ title: "Build API", gateStatus: "passed" }]),
      makeRun("Plan-A", [{ title: "Build API", gateStatus: "failed" }]),
    ];
    const patterns = detectFlap({ runs });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].id).toContain("slice-flap-pattern:");
    expect(patterns[0].occurrences).toBe(3);
    expect(patterns[0].severity).toBe("warning");
  });

  it("does NOT surface with < 3 flaps", () => {
    // pass→fail→pass = 2 flaps
    const runs = [
      makeRun("Plan-A", [{ title: "Auth", gateStatus: "passed" }]),
      makeRun("Plan-A", [{ title: "Auth", gateStatus: "failed" }]),
      makeRun("Plan-A", [{ title: "Auth", gateStatus: "passed" }]),
    ];
    const patterns = detectFlap({ runs });
    expect(patterns).toHaveLength(0);
  });

  it("escalates to error at ≥ 5 flaps", () => {
    const runs = [
      makeRun("Plan-B", [{ title: "Deploy", gateStatus: "passed" }]),
      makeRun("Plan-B", [{ title: "Deploy", gateStatus: "failed" }]),
      makeRun("Plan-B", [{ title: "Deploy", gateStatus: "passed" }]),
      makeRun("Plan-B", [{ title: "Deploy", gateStatus: "failed" }]),
      makeRun("Plan-B", [{ title: "Deploy", gateStatus: "passed" }]),
      makeRun("Plan-B", [{ title: "Deploy", gateStatus: "failed" }]),
    ];
    const patterns = detectFlap({ runs });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(5);
    expect(patterns[0].severity).toBe("error");
  });

  it("returns [] on empty/fresh data", () => {
    expect(detectFlap({ runs: [] })).toHaveLength(0);
    expect(detectFlap({})).toHaveLength(0);
    expect(detectFlap()).toHaveLength(0);
  });

  it("countFlaps counts state transitions correctly", () => {
    expect(countFlaps(["pass", "fail", "pass"])).toBe(2);
    expect(countFlaps(["pass", "pass", "pass"])).toBe(0);
    expect(countFlaps(["fail"])).toBe(0);
    expect(countFlaps([])).toBe(0);
  });

  it("resolveStatus normalises status strings", () => {
    expect(resolveStatus({ gateStatus: "passed" })).toBe("pass");
    expect(resolveStatus({ gateStatus: "failed" })).toBe("fail");
    expect(resolveStatus({ status: "passed" })).toBe("pass");
    expect(resolveStatus({ status: "failed" })).toBe("fail");
    expect(resolveStatus({})).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// cost-anomaly
// ═══════════════════════════════════════════════════════════════════════

describe("cost-anomaly detector", () => {
  it("detects cost spike > 2× rolling average", () => {
    const costs = [
      { sliceType: "vitest", cost: 0.50, plan: "Plan-A" },
      { sliceType: "vitest", cost: 0.60, plan: "Plan-A" },
      { sliceType: "vitest", cost: 0.55, plan: "Plan-B" },
      { sliceType: "vitest", cost: 3.00, plan: "Plan-B" }, // spike: avg ≈ 0.55, 3.0 > 2×0.55
    ];
    const patterns = detectCostAnomaly({ costs });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].id).toBe("cost-anomaly:vitest");
    expect(patterns[0].severity).toBe("error"); // 3.0/0.55 ≈ 5.5× ≥ 4
    expect(patterns[0].plans).toContain("Plan-B");
  });

  it("does NOT surface when costs are stable", () => {
    const costs = [
      { sliceType: "build", cost: 1.00, plan: "Plan-A" },
      { sliceType: "build", cost: 1.10, plan: "Plan-A" },
      { sliceType: "build", cost: 0.95, plan: "Plan-B" },
      { sliceType: "build", cost: 1.05, plan: "Plan-B" },
    ];
    const patterns = detectCostAnomaly({ costs });
    expect(patterns).toHaveLength(0);
  });

  it("returns [] on empty/fresh data", () => {
    expect(detectCostAnomaly({ costs: [] })).toHaveLength(0);
    expect(detectCostAnomaly({})).toHaveLength(0);
    expect(detectCostAnomaly()).toHaveLength(0);
  });

  it("needs at least 2 entries per slice type to detect anomaly", () => {
    const costs = [
      { sliceType: "deploy", cost: 100.00, plan: "Plan-A" },
    ];
    const patterns = detectCostAnomaly({ costs });
    expect(patterns).toHaveLength(0);
  });

  it("rollingAverage computes correctly", () => {
    const entries = [{ cost: 1 }, { cost: 2 }, { cost: 3 }];
    expect(rollingAverage(entries, 0)).toBe(0);
    expect(rollingAverage(entries, 1)).toBe(1);
    expect(rollingAverage(entries, 2)).toBe(1.5);
    expect(rollingAverage(entries, 3)).toBe(2);
  });

  it("groupBySliceType groups and skips zero-cost entries", () => {
    const costs = [
      { sliceType: "a", cost: 1 },
      { sliceType: "a", cost: 0 },
      { sliceType: "b", cost: 2 },
    ];
    const groups = groupBySliceType(costs);
    expect(groups.get("a")).toHaveLength(1);
    expect(groups.get("b")).toHaveLength(1);
  });
});
