/**
 * Plan Forge — meta-bug #266: ParallelScheduler honoured a slice's
 * `status === "completed"` (the ✅ marker) only in its single-execution branch.
 * A completed slice landing in a batch of two or more was handed to executeFn
 * and re-executed. Whether the marker was respected depended on how many other
 * slices happened to be ready in the same tick — scheduling state the plan
 * author cannot see or control.
 *
 * Re-running a completed slice is not a no-op: it produces a worker with no work
 * of its own, which is the precondition meta-bug #261 turns into a commit
 * containing a concurrent neighbour's files.
 */

import { describe, it, expect } from "vitest";
import { ParallelScheduler } from "../orchestrator.mjs";

// Distinct scopes: detectScopeConflicts treats an empty scope as global and
// forces those slices sequential, which would hide the batch branch entirely.
function makeNode(number, extra = {}) {
  return { number, title: `Slice ${number}`, depends: [], parallel: true, scope: [`src/m${number}/**`], ...extra };
}

async function runWith(nodes, order) {
  const executed = [];
  const scheduler = new ParallelScheduler({ emit() {} }, 3);
  const results = await scheduler.execute(nodes, order, async (slice) => {
    executed.push(slice.number);
    return { status: "passed" };
  });
  return { executed, byId: Object.fromEntries(results.map((r) => [r.sliceId, r])) };
}

describe("meta #266 — the completed marker is honoured regardless of batch size", () => {
  it("skips a completed slice inside a parallel batch of three", async () => {
    const nodes = new Map([
      ["1", makeNode("1", { status: "completed" })],
      ["2", makeNode("2")],
      ["3", makeNode("3")],
    ]);

    const { executed, byId } = await runWith(nodes, ["1", "2", "3"]);

    expect(executed).not.toContain("1");
    expect(executed.sort()).toEqual(["2", "3"]);
    expect(byId["1"].status).toBe("skipped");
  });

  it("still skips a completed slice on the single-execution path", async () => {
    const nodes = new Map([
      ["1", makeNode("1", { parallel: false, status: "completed" })],
      ["2", makeNode("2", { parallel: false, depends: ["1"] })],
    ]);

    const { executed, byId } = await runWith(nodes, ["1", "2"]);

    expect(executed).toEqual(["2"]);
    expect(byId["1"].status).toBe("skipped");
  });

  it("a completed slice does not block its descendants", async () => {
    const nodes = new Map([
      ["1", makeNode("1", { status: "completed" })],
      ["2", makeNode("2", { depends: ["1"] })],
      ["3", makeNode("3", { depends: ["1"] })],
    ]);

    const { executed, byId } = await runWith(nodes, ["1", "2", "3"]);

    expect(executed.sort()).toEqual(["2", "3"]);
    expect(byId["2"].status).toBe("passed");
    expect(byId["3"].status).toBe("passed");
  });
});
