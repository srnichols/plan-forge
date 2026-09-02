/**
 * Plan Forge — meta-bug #262 (remaining half): MIXED plans still produced
 * concurrent roots.
 *
 * `buildDAG` decided sequential-fallback per PLAN via an all-or-nothing
 * `hasAnyDeps`, so a single slice declaring `[depends: Slice 1]` disabled the
 * fallback for every OTHER slice in the plan. Slices whose dependency was
 * written in prose kept `depends: []`, landed at inDegree 0, and stayed
 * concurrently eligible roots — the shape a partial hand-conversion produces.
 *
 * Measured on this repo's 46 parseable plans / 359 slices before the fix:
 *   - 7 mixed plans, 132 undeclared non-first slices
 *   - 0 of those tagged [P]  → per-slice fallback serializes nothing that is
 *     parallel today
 *   - 0 backward deps, 0 plans that build today but cycle under the new rule
 *
 * Verifies:
 *   (1) an undeclared slice inherits its predecessor's edge in a MIXED plan.
 *   (2) declared fan-out stays genuinely concurrent.
 *   (3) [P] does not exempt a slice from the fallback (uniform with the
 *       all-prose case pinned by meta-262-dag-fallback-depends.test.mjs).
 *   (4) a backward declared dep does not become a cycle.
 */

import { describe, it, expect } from "vitest";
import { buildDAG } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";
import { ParallelScheduler } from "../orchestrator.mjs";

function makeSlice(number, extra = {}) {
  return {
    number,
    title: `Slice ${number}`,
    depends: [],
    parallel: true,
    scope: [`src/m${number}/**`],
    ...extra,
  };
}

const rootsOf = (nodes) => [...nodes.values()].filter((n) => n.inDegree === 0).map((n) => n.number);

describe("meta #262 — mixed plans do not produce concurrent roots", () => {
  it("(1) an undeclared slice inherits the sequential edge from its predecessor", () => {
    const { nodes } = buildDAG([
      makeSlice("1"),
      makeSlice("2", { depends: ["1"] }),
      makeSlice("3"),
      makeSlice("4"),
    ]);

    expect(nodes.get("2").depends).toEqual(["1"]);
    expect(nodes.get("3").depends).toEqual(["2"]);
    expect(nodes.get("4").depends).toEqual(["3"]);
    expect(rootsOf(nodes)).toEqual(["1"]);
  });

  it("(1b) the mixed plan executes one slice at a time", async () => {
    const { nodes, order } = buildDAG([
      makeSlice("1"),
      makeSlice("2", { depends: ["1"] }),
      makeSlice("3"),
      makeSlice("4"),
    ]);

    let inFlight = 0;
    let peak = 0;
    const executeFn = async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return { status: "passed" };
    };

    const results = await new ParallelScheduler({ emit() {} }, 4).execute(nodes, order, executeFn);
    expect(results.map((r) => r.sliceId)).toEqual(["1", "2", "3", "4"]);
    expect(peak).toBe(1);
  });

  it("(2) declared fan-out stays concurrent", async () => {
    const { nodes, order } = buildDAG([
      makeSlice("1"),
      makeSlice("2", { depends: ["1"] }),
      makeSlice("3", { depends: ["1"] }),
      makeSlice("4", { depends: ["1"] }),
    ]);

    expect(nodes.get("3").depends).toEqual(["1"]);
    expect(nodes.get("4").depends).toEqual(["1"]);

    let inFlight = 0;
    let peak = 0;
    const executeFn = async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return { status: "passed" };
    };
    await new ParallelScheduler({ emit() {} }, 4).execute(nodes, order, executeFn);
    expect(peak).toBeGreaterThan(1);
  });

  it("(3) [P] does not exempt an undeclared slice from the fallback", () => {
    const { nodes } = buildDAG([
      makeSlice("1"),
      makeSlice("2", { depends: ["1"] }),
      makeSlice("3", { parallel: true }),
    ]);
    expect(nodes.get("3").depends).toEqual(["2"]);
  });

  it("(4) a backward declared dependency does not become a cycle", () => {
    // Slice 3 declares a dep on the LATER slice 4; 4 declares nothing. Adding
    // 3→4 as an inherited edge would close a loop, so it must be skipped.
    const slices = [
      makeSlice("1"),
      makeSlice("2", { depends: ["1"] }),
      makeSlice("3", { depends: ["4"] }),
      makeSlice("4"),
    ];
    expect(() => buildDAG(slices)).not.toThrow();
    const { nodes, order } = buildDAG(slices);
    expect(nodes.get("4").depends).not.toContain("3");
    expect(order).toHaveLength(4);
  });

  it("(5) does not mutate the caller's slice objects", () => {
    const slices = [makeSlice("1"), makeSlice("2", { depends: ["1"] }), makeSlice("3")];
    buildDAG(slices);
    expect(slices[2].depends).toEqual([]);
  });
});

/**
 * The second half of #262: the declaration was not merely unhonoured, it was
 * unreported. Scoped to phrases that NAME a slice — 17 of the 211 declarations
 * in this repo's plans say "nothing"/"none"/"—", and warning on those is noise.
 */
describe("meta #262 — unparsed dependency declarations are reported", () => {
  const lintSlice = (extra) =>
    lintGateCommands({ slices: [{ number: "1", title: "T", depends: [], validationGate: "npm test", ...extra }] });

  const dependsWarnings = (result) => result.warnings.filter((w) => w.rule === "depends-not-parsed");

  it("warns when a declaration names a slice but produced no edge", () => {
    // The live form: docs/plans/Phase-GROK-BUILD-WORKER-PLAN.md slice 6.
    const result = lintSlice({ rawLines: ["**Depends On**: Slices 1–5"] });
    const found = dependsWarnings(result);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("Slices 1–5");
    // A warning must not block the run.
    expect(result.passed).toBe(true);
  });

  it.each([
    "**Depends On**: nothing (foundation slice)",
    "**Depends On**: none",
    "**Depends On:** —",
    "**Depends On**: n/a",
  ])("does not warn on an explicit no-dependency declaration: %s", (line) => {
    expect(dependsWarnings(lintSlice({ rawLines: [line] }))).toHaveLength(0);
  });

  it("does not warn when the declaration parsed successfully", () => {
    const result = lintGateCommands({
      slices: [{ number: "2", title: "T", depends: ["1"], validationGate: "npm test", rawLines: ["**Depends On**: Slice 1"] }],
    });
    expect(dependsWarnings(result)).toHaveLength(0);
  });

  it("warns at most once per slice", () => {
    const result = lintSlice({ rawLines: ["**Depends On**: Slices 1–5", "(depends Slice 2)"] });
    expect(dependsWarnings(result)).toHaveLength(1);
  });
});
