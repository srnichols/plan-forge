/**
 * Plan Forge — ParallelScheduler ignored --resume-from.
 *
 * SequentialScheduler and CompetitiveScheduler skip every slice before
 * resumeFrom in topological order; ParallelScheduler never read the option.
 * Any plan with a [P] slice therefore re-ran its completed slices on resume:
 * Phase-PRESET-BUILD-CHECKS `--resume-from 2` re-executed slice 1 (and paid
 * for it again).
 */

import { describe, it, expect } from "vitest";
import { ParallelScheduler } from "../orchestrator.mjs";

// Distinct scopes so detectScopeConflicts keeps parallel slices in one batch.
function makeNode(number, extra = {}) {
  return { number, title: `Slice ${number}`, depends: [], parallel: true, scope: [`src/m${number}/**`], ...extra };
}

async function runWith(nodes, order, resumeFrom) {
  const executed = [];
  const scheduler = new ParallelScheduler({ emit() {} }, 3);
  const results = await scheduler.execute(nodes, order, async (slice) => {
    executed.push(slice.number);
    return { status: "passed" };
  }, { resumeFrom });
  return { executed, byId: Object.fromEntries(results.map((r) => [r.sliceId, r])) };
}

describe("ParallelScheduler honours resumeFrom", () => {
  it("skips the slices before resumeFrom and runs the rest, including a parallel batch", async () => {
    const nodes = new Map([
      ["1", makeNode("1", { parallel: false })],
      ["2", makeNode("2", { depends: ["1"] })],
      ["3", makeNode("3", { depends: ["1"] })],
      ["4", makeNode("4", { parallel: false, depends: ["2", "3"] })],
    ]);

    const { executed, byId } = await runWith(nodes, ["1", "2", "3", "4"], "2");

    expect(executed).not.toContain("1");
    expect(executed.sort()).toEqual(["2", "3", "4"]);
    expect(byId["1"].status).toBe("skipped");
    expect(byId["4"].status).toBe("passed");
  });

  it("a skipped earlier slice does not block its dependents", async () => {
    const nodes = new Map([
      ["1", makeNode("1", { parallel: false })],
      ["2", makeNode("2", { parallel: false, depends: ["1"] })],
      ["3", makeNode("3", { parallel: false, depends: ["2"] })],
    ]);

    const { executed } = await runWith(nodes, ["1", "2", "3"], "3");

    expect(executed).toEqual(["3"]);
  });

  it("runs everything when resumeFrom is null", async () => {
    const nodes = new Map([["1", makeNode("1")], ["2", makeNode("2")]]);

    const { executed } = await runWith(nodes, ["1", "2"], null);

    expect(executed.sort()).toEqual(["1", "2"]);
  });
});
