import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan, normalizeSliceId } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

/**
 * Meta-bug #362 — the plan parser silently dropped slice ids from the
 * `**Depends On**` forms hand-written hardened plans use most:
 *
 *   "Slices 1, 3, 4"      -> ["3","4"]   (the plural keyword defeated the first id)
 *   "Slices 5 and 6"      -> []          (no "and" separator)
 *   "Slice 5 and Slice 6" -> ["5"]
 *
 * A [parallel-safe] slice could then be scheduled before a prerequisite and a
 * join slice could end up with no dependencies, and nothing reported it: the
 * only guard fires when NO id parsed. Same family as the closed #225 and #262.
 */

describe("Depends On lists (#362)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-362-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function depsOf(...slices) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      ...slices.flatMap(([number, depends]) => [`### Slice ${number}: Work ${number}`, "1. Do it", ...(depends ? [depends] : []), ""]),
    ].join("\n"));
    return Object.fromEntries(parsePlan(planPath, dir).slices.map((slice) => [slice.number, slice.depends]));
  }

  it("parses the three forms measured in the report on a 7-slice plan", () => {
    const deps = depsOf(
      ["1"], ["2", "**Depends On**: Slice 1"], ["3", "**Depends On**: Slice 1"], ["4", "**Depends On**: Slice 1"],
      ["5", "**Depends On**: Slices 1, 3, 4"],
      ["6", "**Depends On**: Slice 1, Slice 3, Slice 4"],
      ["7", "**Depends On**: Slices 5 and 6"],
    );
    expect(deps["5"]).toEqual(["1", "3", "4"]);
    expect(deps["6"]).toEqual(["1", "3", "4"]);
    expect(deps["7"]).toEqual(["5", "6"]);
  });

  it.each([
    ["Slice 5 and Slice 6", ["5", "6"]],
    ["Slice 5 & Slice 6", ["5", "6"]],
    ["S2 and S3", ["2", "3"]],
    ["Slices 3 + 4", ["3", "4"]],
    ["Slices 2; 3", ["2", "3"]],
    ["Slices 2.1, 2.2A and 3", ["2.1", "2.2A", "3"]],
    ["Slice 1 and 2", ["1", "2"]],
    ["slices 1, 3", ["1", "3"]],
  ])("parses %s", (text, expected) => {
    expect(depsOf(["9", `**Depends On**: ${text}`])["9"]).toEqual(expected);
  });

  it("keeps parenthetical commentary out of the dependencies, as before", () => {
    const deps = depsOf(
      ["2", "**Depends On**: S1 (consumes `presets.ts`)."],
      ["6", "**Depends On**: S2 (redirect targets must exist), and Group B merge checkpoint."],
      ["8", "**Depends On**: Slice 1, Slice 2A (auth + items required)"],
    );
    expect(deps["2"]).toEqual(["1"]);
    expect(deps["6"]).toEqual(["2"]);
    expect(deps["8"]).toEqual(["1", "2A"]);
  });

  it("no longer invents a dependency from a number inside a parenthetical", () => {
    expect(depsOf(["6", "**Depends On**: none (parallel to Slices 4, 5)"])["6"]).toEqual([]);
    expect(depsOf(["6", "**Depends On**: (none — independent; parallel to Slices 4, 5)"])["6"]).toEqual([]);
  });

  it("keeps a parenthetical with a list inside it from splitting the outer list", () => {
    expect(depsOf(["9", "**Depends On**: Slice 2 (and Slice 3, for the schema), Slice 4"])["9"]).toEqual(["2", "4"]);
  });

  it("still yields no dependency for an explicit none", () => {
    expect(depsOf(["1", "**Depends On**: none (foundation)"])["1"]).toEqual([]);
  });

  it("leaves a plural range unparsed rather than ordering the slice after its first id", () => {
    expect(depsOf(["6", "**Depends On**: Slices 1–5"])["6"]).toEqual([]);
    expect(depsOf(["6", "**Depends On**: Slices 1-5"])["6"]).toEqual([]);
    expect(depsOf(["6", "**Depends On**: Slices 1 through 5"])["6"]).toEqual([]);
  });

  it("parses the plural and 'and' forms in the heading tag too, leaving no junk ids", () => {
    const planPath = join(dir, "tagged.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      "### Slice 5: Join [depends: Slices 1, 3 and 4]", "1. Do it", "",
      "### Slice 6: Other [depends: Slices 5, 5.1]", "1. Do it", "",
    ].join("\n"));
    const deps = Object.fromEntries(parsePlan(planPath, dir).slices.map((slice) => [slice.number, slice.depends]));
    expect(deps["5"]).toEqual(["1", "3", "4"]);
    expect(deps["6"]).toEqual(["5", "5.1"]);
  });
});

describe("normalizeSliceId (#362)", () => {
  it("strips the plural keyword as well as the singular", () => {
    expect(normalizeSliceId("Slices 5")).toBe("5");
    expect(normalizeSliceId("Slice 2a")).toBe("2A");
    expect(normalizeSliceId(" 3 ")).toBe("3");
  });
});

describe("depends-not-parsed still reports what the parser cannot read (#362)", () => {
  const lintSlice = (slice) => lintGateCommands({ slices: [{ number: "5", title: "Join", validationGate: "npm test", ...slice }] });
  const dependsWarnings = (result) => result.warnings.filter((warning) => warning.rule === "depends-not-parsed");

  it("keeps warning on a plural range, which stays unparsed", () => {
    const found = dependsWarnings(lintSlice({ depends: [], rawLines: ["**Depends On**: Slices 1–5"] }));
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("Slices 1–5");
  });

  it("does not warn on an explicit none written inside parentheses", () => {
    expect(dependsWarnings(lintSlice({ depends: [], rawLines: ["**Depends On**: (none — independent; parallel to Slices 4, 5)"] }))).toEqual([]);
  });

  it("does not warn once the declaration parsed", () => {
    expect(dependsWarnings(lintSlice({ depends: ["1", "3", "4"], rawLines: ["**Depends On**: Slices 1, 3, 4"] }))).toEqual([]);
  });
});
