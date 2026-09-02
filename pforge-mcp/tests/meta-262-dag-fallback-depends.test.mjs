/**
 * Plan Forge — meta-bug #262 (mechanism): buildDAG's sequential fallback wrote
 * its edges only to inDegree/children, but ParallelScheduler reads node.depends.
 * A plan whose dependency declarations failed to parse therefore presented as N
 * independent roots, and every [parallel-safe] slice launched at once against
 * prerequisites that had not been built.
 *
 * buildDAG's own contract says "If no explicit dependencies, assume sequential",
 * so the scheduler was contradicting the documented behaviour.
 *
 * Verifies:
 *   (1) fallback edges land on node.depends, not only inDegree.
 *   (2) buildDAG does not mutate the caller's slice objects.
 *   (3) explicit-dependency mode is untouched (siblings stay parallel).
 *   (4) parallel-safe slices with unparsed deps execute one at a time.
 */

import { describe, it, expect } from "vitest";
import { buildDAG } from "../orchestrator/plan-parser.mjs";
import { ParallelScheduler } from "../orchestrator.mjs";

// Distinct, non-overlapping scopes are required: detectScopeConflicts() treats an
// empty scope as global and forces those slices sequential, which would mask the
// very concurrency this file is measuring.
function makeSlice(number, extra = {}) {
  return { number, title: `Slice ${number}`, depends: [], parallel: true, scope: [`src/m${number}/**`], ...extra };
}

describe("meta #262 — buildDAG sequential fallback is visible to the scheduler", () => {
  it("(1) populates node.depends when no dependencies parsed", () => {
    const { nodes } = buildDAG([makeSlice("1"), makeSlice("2"), makeSlice("3")]);
    expect(nodes.get("1").depends).toEqual([]);
    expect(nodes.get("2").depends).toEqual(["1"]);
    expect(nodes.get("3").depends).toEqual(["2"]);
  });

  it("(2) does not mutate the caller's slice objects", () => {
    const slices = [makeSlice("1"), makeSlice("2")];
    buildDAG(slices);
    expect(slices[1].depends).toEqual([]);
  });

  it("(3) leaves explicit dependency mode untouched", () => {
    const { nodes } = buildDAG([
      makeSlice("1"),
      makeSlice("2", { depends: ["1"] }),
      makeSlice("3", { depends: ["1"] }),
    ]);
    expect(nodes.get("2").depends).toEqual(["1"]);
    // Siblings must NOT gain a fabricated 2→3 edge; they are genuinely parallel.
    expect(nodes.get("3").depends).toEqual(["1"]);
  });

  it("(4) serializes parallel-safe slices whose dependencies failed to parse", async () => {
    const { nodes, order } = buildDAG([makeSlice("1"), makeSlice("2"), makeSlice("3")]);

    let inFlight = 0;
    let peakInFlight = 0;
    // Timer-free concurrency probe: every worker increments before its first
    // await, so a batched launch is observable as peakInFlight > 1.
    const executeFn = async () => {
      peakInFlight = Math.max(peakInFlight, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return { status: "passed" };
    };

    const scheduler = new ParallelScheduler({ emit() {} }, 3);
    const results = await scheduler.execute(nodes, order, executeFn);

    expect(results.map((r) => r.sliceId)).toEqual(["1", "2", "3"]);
    expect(peakInFlight).toBe(1);
  });
});
