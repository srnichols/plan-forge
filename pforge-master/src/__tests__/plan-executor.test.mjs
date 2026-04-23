/**
 * Tests for plan-executor.mjs — Phase-38.4, Slice 2.
 *
 * Covers: sequential execution, parallel branches, error isolation,
 * dependency-failed short-circuit, timeout enforcement, cycle detection,
 * and empty plan handling.
 */

import { describe, it, expect, vi } from "vitest";
import { executePlan, topoSort, TIMEOUT_MS } from "../plan-executor.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

function step(id, tool, dependsOn) {
  return {
    id,
    tool,
    args: {},
    rationale: `Rationale for ${id}`,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

function makeDispatch(results = {}, delayMs = 0) {
  return vi.fn(async (s) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (s.id in results) return results[s.id];
    return { ok: true, data: `result-${s.id}` };
  });
}

// ─── Topological Sort ───────────────────────────────────────────────

describe("topoSort", () => {
  it("(1) single step with no dependencies produces one batch", () => {
    const steps = [step("step-0", "forge_status")];
    const batches = topoSort(steps);
    expect(batches).toEqual([["step-0"]]);
  });

  it("(2) linear chain produces sequential batches", () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report", ["step-0"]),
      step("step-2", "forge_plan_status", ["step-1"]),
    ];
    const batches = topoSort(steps);
    expect(batches).toEqual([["step-0"], ["step-1"], ["step-2"]]);
  });

  it("(3) independent steps go in same batch", () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report"),
      step("step-2", "forge_plan_status"),
    ];
    const batches = topoSort(steps);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
    expect(batches[0]).toContain("step-0");
    expect(batches[0]).toContain("step-1");
    expect(batches[0]).toContain("step-2");
  });

  it("(4) diamond dependency produces correct batch order", () => {
    // step-0 → step-1, step-2 → step-3
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report", ["step-0"]),
      step("step-2", "forge_plan_status", ["step-0"]),
      step("step-3", "forge_watch", ["step-1", "step-2"]),
    ];
    const batches = topoSort(steps);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toEqual(["step-0"]);
    expect(batches[1]).toHaveLength(2);
    expect(batches[1]).toContain("step-1");
    expect(batches[1]).toContain("step-2");
    expect(batches[2]).toEqual(["step-3"]);
  });

  it("(5) throws on dependency cycle", () => {
    const steps = [
      step("step-0", "forge_status", ["step-1"]),
      step("step-1", "forge_cost_report", ["step-0"]),
    ];
    expect(() => topoSort(steps)).toThrow(/cycle/i);
  });

  it("(6) ignores unknown dependency references", () => {
    const steps = [
      step("step-0", "forge_status", ["nonexistent"]),
    ];
    const batches = topoSort(steps);
    expect(batches).toEqual([["step-0"]]);
  });
});

// ─── Sequential Execution ───────────────────────────────────────────

describe("executePlan sequential", () => {
  it("(7) executes linear chain in order", async () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report", ["step-0"]),
      step("step-2", "forge_plan_status", ["step-1"]),
    ];
    const callOrder = [];
    const dispatch = vi.fn(async (s) => {
      callOrder.push(s.id);
      return `output-${s.id}`;
    });

    const { results, totalDurationMs } = await executePlan(
      { steps },
      { dispatch },
    );

    expect(results).toHaveLength(3);
    expect(results[0].output).toBe("output-step-0");
    expect(results[1].output).toBe("output-step-1");
    expect(results[2].output).toBe("output-step-2");
    expect(results.every((r) => r.error === undefined)).toBe(true);

    // Verify execution order: step-0 before step-1 before step-2
    expect(callOrder.indexOf("step-0")).toBeLessThan(callOrder.indexOf("step-1"));
    expect(callOrder.indexOf("step-1")).toBeLessThan(callOrder.indexOf("step-2"));
    expect(typeof totalDurationMs).toBe("number");
  });

  it("(8) provides prior results to dispatch", async () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report", ["step-0"]),
    ];
    const dispatch = vi.fn(async (s, priorResults) => {
      if (s.id === "step-1") {
        // Verify step-0 result is available
        expect(priorResults.get("step-0")).toBe("data-from-step-0");
      }
      return s.id === "step-0" ? "data-from-step-0" : "done";
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results[0].output).toBe("data-from-step-0");
    expect(results[1].output).toBe("done");
  });
});

// ─── Parallel Execution ─────────────────────────────────────────────

describe("executePlan parallel", () => {
  it("(9) executes independent steps concurrently", async () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report"),
      step("step-2", "forge_plan_status"),
    ];
    const startTimes = {};
    const dispatch = vi.fn(async (s) => {
      startTimes[s.id] = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      return `output-${s.id}`;
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.error === undefined)).toBe(true);

    // All three should start at roughly the same time (within 30ms)
    const times = Object.values(startTimes);
    const maxDiff = Math.max(...times) - Math.min(...times);
    expect(maxDiff).toBeLessThan(30);
  });

  it("(10) executes diamond: parallel middle, sequential ends", async () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report", ["step-0"]),
      step("step-2", "forge_plan_status", ["step-0"]),
      step("step-3", "forge_watch", ["step-1", "step-2"]),
    ];
    const callOrder = [];
    const dispatch = vi.fn(async (s) => {
      callOrder.push(s.id);
      return `output-${s.id}`;
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.error === undefined)).toBe(true);

    // step-0 runs first
    expect(callOrder.indexOf("step-0")).toBe(0);
    // step-1 and step-2 run in parallel (both before step-3)
    expect(callOrder.indexOf("step-1")).toBeLessThan(callOrder.indexOf("step-3"));
    expect(callOrder.indexOf("step-2")).toBeLessThan(callOrder.indexOf("step-3"));
    // step-3 runs last
    expect(callOrder.indexOf("step-3")).toBe(3);
  });
});

// ─── Error Isolation ────────────────────────────────────────────────

describe("executePlan error isolation", () => {
  it("(11) failed step does not abort independent steps", async () => {
    const steps = [
      step("step-0", "forge_status"),  // will fail
      step("step-1", "forge_cost_report"),  // independent — should succeed
    ];
    const dispatch = vi.fn(async (s) => {
      if (s.id === "step-0") throw new Error("connection failed");
      return `output-${s.id}`;
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results[0].error).toBe("connection failed");
    expect(results[0].output).toBeNull();
    expect(results[1].output).toBe("output-step-1");
    expect(results[1].error).toBeUndefined();
  });

  it("(12) dependent step gets dependency-failed error", async () => {
    const steps = [
      step("step-0", "forge_status"),  // will fail
      step("step-1", "forge_cost_report", ["step-0"]),  // depends on step-0
    ];
    const dispatch = vi.fn(async (s) => {
      if (s.id === "step-0") throw new Error("boom");
      return `output-${s.id}`;
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results[0].error).toBe("boom");
    expect(results[1].error).toBe("dependency-failed: step-0");
    expect(results[1].output).toBeNull();
    // dispatch should not be called for the dependent step
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("(13) transitive dependency failure propagates", async () => {
    const steps = [
      step("step-0", "forge_status"),  // will fail
      step("step-1", "forge_cost_report", ["step-0"]),
      step("step-2", "forge_plan_status", ["step-1"]),
    ];
    const dispatch = vi.fn(async (s) => {
      if (s.id === "step-0") throw new Error("root failure");
      return `output-${s.id}`;
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results[0].error).toBe("root failure");
    expect(results[1].error).toBe("dependency-failed: step-0");
    expect(results[2].error).toBe("dependency-failed: step-1");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("(14) mixed: failure in one branch, other branch succeeds", async () => {
    // step-0 (ok) → step-2 (ok)
    // step-1 (fail) → step-3 (dep-fail)
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report"),
      step("step-2", "forge_plan_status", ["step-0"]),
      step("step-3", "forge_watch", ["step-1"]),
    ];
    const dispatch = vi.fn(async (s) => {
      if (s.id === "step-1") throw new Error("branch B failed");
      return `output-${s.id}`;
    });

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results[0].error).toBeUndefined();
    expect(results[0].output).toBe("output-step-0");
    expect(results[1].error).toBe("branch B failed");
    expect(results[2].error).toBeUndefined();
    expect(results[2].output).toBe("output-step-2");
    expect(results[3].error).toBe("dependency-failed: step-1");
  });
});

// ─── Timeout ────────────────────────────────────────────────────────

describe("executePlan timeout", () => {
  it("(15) marks remaining steps as timeout when hard limit exceeded", async () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report", ["step-0"]),
    ];
    // step-0 takes longer than TIMEOUT_MS
    const dispatch = vi.fn(async (s) => {
      await new Promise((r) => setTimeout(r, TIMEOUT_MS + 500));
      return `output-${s.id}`;
    });

    const t0 = Date.now();
    const { results, totalDurationMs } = await executePlan(
      { steps },
      { dispatch },
    );
    const elapsed = Date.now() - t0;

    // Should not wait for the full dispatch delay
    // (timeout sentinel fires at ~30s, not 30.5s)
    expect(elapsed).toBeLessThan(TIMEOUT_MS + 2000);

    // step-1 should be timeout since step-0 didn't finish in time
    // (step-0 may or may not have a result depending on race)
    const timeoutResults = results.filter((r) => r.error === "timeout");
    expect(timeoutResults.length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT_MS + 5000);

  it("(16) fast plan completes well under timeout", async () => {
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report"),
    ];
    const dispatch = makeDispatch({}, 5);

    const { results, totalDurationMs } = await executePlan(
      { steps },
      { dispatch },
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.error === undefined)).toBe(true);
    expect(totalDurationMs).toBeLessThan(1000);
  });

  it("(17) TIMEOUT_MS is 30000", () => {
    expect(TIMEOUT_MS).toBe(30_000);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────

describe("executePlan edge cases", () => {
  it("(18) empty plan returns empty results", async () => {
    const dispatch = vi.fn();

    const { results, totalDurationMs } = await executePlan(
      { steps: [] },
      { dispatch },
    );

    expect(results).toEqual([]);
    expect(typeof totalDurationMs).toBe("number");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("(19) null plan returns empty results", async () => {
    const dispatch = vi.fn();

    const { results } = await executePlan(null, { dispatch });

    expect(results).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("(20) results preserve original step order", async () => {
    // step-1 has no deps, step-0 has no deps — both in batch 1
    // But results should be in the original plan order
    const steps = [
      step("step-0", "forge_status"),
      step("step-1", "forge_cost_report"),
    ];
    const dispatch = makeDispatch();

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results[0].step.id).toBe("step-0");
    expect(results[1].step.id).toBe("step-1");
  });

  it("(21) cycle in dependencies marks all steps as errored", async () => {
    const steps = [
      step("step-0", "forge_status", ["step-1"]),
      step("step-1", "forge_cost_report", ["step-0"]),
    ];
    const dispatch = vi.fn();

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results).toHaveLength(2);
    expect(results[0].error).toMatch(/cycle/i);
    expect(results[1].error).toMatch(/cycle/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("(22) single step plan executes and returns", async () => {
    const steps = [step("step-0", "forge_status")];
    const dispatch = vi.fn(async () => "single-result");

    const { results } = await executePlan({ steps }, { dispatch });

    expect(results).toHaveLength(1);
    expect(results[0].output).toBe("single-result");
    expect(results[0].error).toBeUndefined();
    expect(results[0].step.id).toBe("step-0");
  });
});
