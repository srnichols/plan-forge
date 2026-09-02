/**
 * Plan Forge — meta-bug #265: --only-slices filtered the execution ORDER but
 * passed the full, unpruned node map to the scheduler. A selected slice that
 * declared a dependency on an excluded slice could never become ready, so the
 * run exited through the #225 deadlock path and reported
 * "failed: unsatisfiable dependencies" — a message describing the flag's own
 * filtering rather than anything wrong with the plan or the code.
 *
 * The flag works only for slices with no declared dependencies, which in a
 * hardened plan is usually just slice 1 — while re-running a single slice after
 * fixing a failure is exactly what an operator reaches for.
 */

import { describe, it, expect } from "vitest";
import { restrictDagToSlices } from "../orchestrator/plan-parser.mjs";
import { ParallelScheduler } from "../orchestrator.mjs";

function makeNode(number, depends = []) {
  return { number, title: `Slice ${number}`, depends, parallel: false, scope: [`src/m${number}/**`] };
}

const fullDag = () => new Map([
  ["1", makeNode("1")],
  ["2", makeNode("2", ["1"])],
  ["3", makeNode("3", ["2"])],
]);

describe("meta #265 — --only-slices prunes dependencies on excluded slices", () => {
  it("drops dependencies that point outside the retained set", () => {
    const restricted = restrictDagToSlices(fullDag(), ["3"]);
    expect([...restricted.keys()]).toEqual(["3"]);
    expect(restricted.get("3").depends).toEqual([]);
  });

  it("keeps dependencies that are inside the retained set", () => {
    const restricted = restrictDagToSlices(fullDag(), ["2", "3"]);
    expect([...restricted.keys()]).toEqual(["2", "3"]);
    expect(restricted.get("2").depends).toEqual([]);
    expect(restricted.get("3").depends).toEqual(["2"]);
  });

  it("does not mutate the source node map", () => {
    const source = fullDag();
    restrictDagToSlices(source, ["3"]);
    expect(source.get("3").depends).toEqual(["2"]);
    expect(source.size).toBe(3);
  });

  it("a dependent slice selected alone now executes instead of deadlocking", async () => {
    const restricted = restrictDagToSlices(fullDag(), ["3"]);
    const executed = [];
    const scheduler = new ParallelScheduler({ emit() {} }, 3);

    const results = await scheduler.execute(restricted, ["3"], async (slice) => {
      executed.push(slice.number);
      return { status: "passed" };
    });

    expect(executed).toEqual(["3"]);
    expect(results[0].status).toBe("passed");
  });

  it("still fails loud for a dependency that exists in neither the plan nor the selection", async () => {
    // Guard: pruning must not turn a genuinely unsatisfiable plan (#225) into a
    // silent pass. "ghost" is absent from the source map, so it is not "excluded
    // by selection" — it is unresolvable, and the deadlock path must still fire.
    const nodes = new Map([["2", makeNode("2", ["ghost"])]]);
    const restricted = restrictDagToSlices(nodes, ["2"]);
    expect(restricted.get("2").depends).toEqual(["ghost"]);

    const scheduler = new ParallelScheduler({ emit() {} }, 3);
    const results = await scheduler.execute(restricted, ["2"], async () => ({ status: "passed" }));
    expect(results[0].status).toBe("failed");
  });
});
