/**
 * Plan Forge — meta-bug #263: skip did not propagate transitively. The readiness
 * check scored a dependency as unsatisfied only on "failed"/"error"; a slice that
 * was itself skipped behind a failure was added to `completed` and read as
 * success by the next generation. Phase 151 slice 10 — a live money-path
 * verification — ran behind two skipped dependencies and reported passed.
 *
 * A green result from a slice whose inputs were never built is worse than a
 * failure, because it becomes evidence.
 *
 * The fix must distinguish two kinds of skip:
 *   - skipped because a dependency was unsatisfied  → propagates
 *   - skipped because the slice was already complete → does NOT propagate
 *
 * Verifies:
 *   (1) a slice behind a skipped dependency is skipped, not executed.
 *   (2) the skip reason names the root cause as a chain.
 *   (3) an already-completed dependency still satisfies its descendants.
 *   (4) an absent dependency still deadlocks loudly rather than skipping (#225).
 */

import { describe, it, expect } from "vitest";
import { ParallelScheduler } from "../orchestrator.mjs";

function makeNode(number, depends = [], extra = {}) {
  return { number, title: `Slice ${number}`, depends, parallel: false, scope: [], ...extra };
}

function trackingExecuteFn(executed, failIds = []) {
  return async (slice) => {
    executed.push(slice.number);
    return failIds.includes(slice.number)
      ? { status: "failed", error: "gate failed" }
      : { status: "passed" };
  };
}

describe("meta #263 — skip propagates transitively", () => {
  it("(1)+(2) skips a slice behind a skipped dependency and names the chain", async () => {
    // 4 fails → 5 skips behind 4 → 10 must skip behind 5.
    const nodes = new Map([
      ["4", makeNode("4")],
      ["5", makeNode("5", ["4"])],
      ["10", makeNode("10", ["5"])],
    ]);
    const executed = [];
    const scheduler = new ParallelScheduler({ emit() {} }, 3);

    const results = await scheduler.execute(nodes, ["4", "5", "10"], trackingExecuteFn(executed, ["4"]));
    const byId = Object.fromEntries(results.map((r) => [r.sliceId, r]));

    expect(executed).toEqual(["4"]);
    expect(byId["5"].status).toBe("skipped");
    expect(byId["10"].status).toBe("skipped");
    expect(byId["10"].reason).toBe("dependency 5 skipped: dependency 4 failed");
  });

  it("(1) skips a slice when ANY of several dependencies was skipped", async () => {
    const nodes = new Map([
      ["7", makeNode("7")],
      ["9", makeNode("9", ["7"])],
      ["10", makeNode("10", ["9", "7"])],
    ]);
    const executed = [];
    const scheduler = new ParallelScheduler({ emit() {} }, 3);

    const results = await scheduler.execute(nodes, ["7", "9", "10"], trackingExecuteFn(executed, ["7"]));
    const byId = Object.fromEntries(results.map((r) => [r.sliceId, r]));

    expect(executed).toEqual(["7"]);
    expect(byId["10"].status).toBe("skipped");
  });

  it("(3) an already-completed dependency still satisfies its descendants", async () => {
    const nodes = new Map([
      ["1", makeNode("1", [], { status: "completed" })],
      ["2", makeNode("2", ["1"])],
    ]);
    const executed = [];
    const scheduler = new ParallelScheduler({ emit() {} }, 3);

    const results = await scheduler.execute(nodes, ["1", "2"], trackingExecuteFn(executed));
    const byId = Object.fromEntries(results.map((r) => [r.sliceId, r]));

    expect(byId["1"].status).toBe("skipped");
    expect(executed).toEqual(["2"]);
    expect(byId["2"].status).toBe("passed");
  });

  it("(4) a dependency that never produced a result still deadlocks loudly (#225)", async () => {
    const nodes = new Map([["2", makeNode("2", ["ghost"])]]);
    const executed = [];
    const scheduler = new ParallelScheduler({ emit() {} }, 3);

    const results = await scheduler.execute(nodes, ["2"], trackingExecuteFn(executed));

    // An absent dependency is unknown, not skipped — it must not be quietly
    // downgraded to "skipped" by the propagation change.
    expect(executed).toEqual([]);
    expect(results[0].status).toBe("failed");
  });
});
