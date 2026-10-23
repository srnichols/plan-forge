import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan, unreadDependencyEntries } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

/**
 * Meta-bug #368 — a `**Depends On**:` list is read entry by entry, and an entry
 * only yields a dependency when it starts with a slice id. In
 *
 *   **Depends On**: Slice 3 and the generated Slice 4 output
 *
 * "Slice 3" is read and "the generated Slice 4 output" is not, so the slice is
 * ordered after 3 only and can run before 4. The depends-not-parsed lint fires
 * when NOTHING parsed, so a half-read list raised nothing. The report's own
 * example, "Slices 3, 4", is parsed in full since #362; this is the lint for the
 * lists that are still half-read.
 *
 * The rule is narrow on purpose. A first version that flagged every slice a
 * Depends On line names and the plan does not list as a dependency fired four
 * times over docs/plans, all wrong: two "Independent of Slice 4 (different file)"
 * comments and two references to another plan's slice. It now looks only at the
 * entries the parser could not read.
 */

const RULE = "depends-entry-not-parsed";
const found = (result) => result.warnings.filter((warning) => warning.rule === RULE);

const sliceOf = (number, extra = {}) => ({ number, title: `Work ${number}`, validationGate: "npm test", depends: [], rawLines: [], ...extra });

/** A plan whose slice `number` declares `line` and parsed `depends`; `before` and `after` are the other slices. */
function lintDeclaration({ line, depends, number = "5", before = ["1", "2", "3", "4"], after = [] }) {
  return lintGateCommands({
    slices: [...before.map((n) => sliceOf(n)), sliceOf(number, { title: "Join", depends, rawLines: [line] }), ...after.map((n) => sliceOf(n))],
  });
}

describe("unreadDependencyEntries (#368)", () => {
  it("returns the entries of a Depends On line that start with no slice id", () => {
    expect(unreadDependencyEntries("**Depends On**: Slice 3 and the generated Slice 4 output")).toEqual(["the generated Slice 4 output"]);
    expect(unreadDependencyEntries("**Depends On**: Slice 1, the output of Slice 2, and the Slice 3 fixtures")).toEqual([
      "the output of Slice 2", "the Slice 3 fixtures",
    ]);
  });

  it.each([
    "**Depends On**: Slices 3, 4",
    "**Depends On**: Slice 3 and Slice 4",
    "**Depends On**: Slices 1–5",
    "**Depends On**: S3 + S4",
    "**Depends On:** Slice 3",
  ])("returns nothing for a list read in full: %s", (line) => {
    expect(unreadDependencyEntries(line)).toEqual([]);
  });

  it("keeps an open plural range, which the parser cannot read", () => {
    expect(unreadDependencyEntries("**Depends On**: Slices 1 through")).toEqual(["Slices 1 through"]);
  });

  it("does not split at a comma inside parentheses, as the parser does not", () => {
    expect(unreadDependencyEntries("**Depends On**: Slice 3 (not Slice 4, which is independent)")).toEqual([]);
  });

  it("returns nothing for a line with no Depends On label, and skips an empty entry", () => {
    expect(unreadDependencyEntries("Slice 3 and the generated Slice 4 output")).toEqual([]);
    expect(unreadDependencyEntries("**Depends On**: Slice 3,")).toEqual([]);
  });
});

describe("the gate linter reports a Depends On entry the parser could not read (#368)", () => {
  it("warns on the report's shape: a list read as Slice 3 only", () => {
    const warnings = found(lintDeclaration({ line: "**Depends On**: Slice 3 and the generated Slice 4 output", depends: ["3"] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ slice: "5", command: null, rule: RULE, severity: "warn" });
    expect(warnings[0].message).toContain('Slice 5 ("Join")');
    expect(warnings[0].message).toContain('"the generated Slice 4 output"');
    expect(warnings[0].message).toMatch(/Slice 4/);
    expect(warnings[0].message).toMatch(/in parentheses/);
  });

  it("names every slice the unread entries of one declaration name, in a single warning", () => {
    const warnings = found(lintDeclaration({ line: "**Depends On**: Slice 1, the output of Slice 2, and the Slice 3 fixtures", depends: ["1"] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('"the output of Slice 2"');
    expect(warnings[0].message).toContain('"the Slice 3 fixtures"');
    expect(warnings[0].message).toMatch(/Slice 2, Slice 3/);
  });

  it("names a slice once, however many entries name it", () => {
    const [warning] = found(lintDeclaration({ line: "**Depends On**: Slice 1, the Slice 4 output, and the Slice 4 fixtures", depends: ["1"] }));
    expect(warning.message).toContain("names Slice 4 but");
    expect(warning.message).toContain('"the Slice 4 output", "the Slice 4 fixtures"');
  });

  it.each([
    ["S4", "**Depends On**: Slice 3 and the S4 output"],
    ["the plural", "**Depends On**: Slice 3 and the output of Slices 4"],
    ["lower case", "**Depends On**: Slice 3 and the output of slice 4"],
    ["a trailing full stop", "**Depends On**: Slice 3 and the Slice 4 output."],
  ])("reads a slice named as %s", (_name, line) => {
    expect(found(lintDeclaration({ line, depends: ["3"] }))).toHaveLength(1);
  });

  it("reads a lettered slice id, in any case", () => {
    const planOf = (line) => lintGateCommands({
      slices: [sliceOf("1"), sliceOf("2A"), sliceOf("3", { depends: ["1"], rawLines: [line] })],
    });
    for (const mention of ["Slice 2A", "slice 2a"]) {
      const result = planOf(`**Depends On**: Slice 1 and the ${mention} output`);
      expect(found(result)).toHaveLength(1);
      expect(found(result)[0].message).toContain("Slice 2A");
    }
  });

  it("applies when a heading tag parsed an id and the body line parsed none", () => {
    const warnings = found(lintDeclaration({ line: "**Depends On**: the Slice 1 output", depends: ["2"] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Slice 1");
  });

  it("reports a long entry by its first 60 characters", () => {
    const long = `the output of Slice 4 ${"produced by the earlier migration ".repeat(5)}`.trim();
    expect(long.length).toBeGreaterThan(150);
    const [warning] = found(lintDeclaration({ line: `**Depends On**: Slice 3 and ${long}`, depends: ["3"] }));
    expect(warning.message).toContain(`"${long.slice(0, 60)}"`);
    expect(warning.message).not.toContain(long);
  });
});

describe("the entries it leaves alone (#368)", () => {
  it.each([
    "**Depends On**: Slice 3, Slice 4",
    "**Depends On**: Slices 3 and 4",
    "**Depends On**: Slice 3 & 4",
    "**Depends On**: Slices 1–3",
    "**Depends On**: S3 + S4",
  ])("a list read in full: %s", (line) => {
    expect(found(lintDeclaration({ line, depends: ["1", "2", "3", "4"] }))).toEqual([]);
  });

  it.each([
    "**Depends On**: Slice 3 (not Slice 4)",
    "**Depends On**: Slice 3, and the output (of Slice 4)",
    "**Depends On**: Slice 3 (the generated Slice 4 output is not needed)",
  ])("a slice named only in parentheses, which is commentary: %s", (line) => {
    expect(found(lintDeclaration({ line, depends: ["3"] }))).toEqual([]);
  });

  it("commentary after an entry that starts with an id, as written in docs/plans", () => {
    // Phase-GROK-BUILD-WORKER-PLAN.md, slices 3 and 4: the first rule written flagged both.
    expect(found(lintDeclaration({
      number: "4", before: ["1", "2", "3"],
      line: "**Depends On**: Slice 2 (routing sets `worker=grok`). Independent of Slice 3 (different file).",
      depends: ["2"],
    }))).toEqual([]);
    expect(found(lintDeclaration({
      number: "3", before: ["1", "2"], after: ["4"],
      line: "**Depends On**: Slice 1 (invocation template). Independent of Slice 4 (different file).",
      depends: ["1"],
    }))).toEqual([]);
  });

  it("another plan's slice, which this plan cannot order", () => {
    // Phase-LATTICE-PLAN.md slice 4 and Phase-ANVIL-PLAN.md slice 3: both flagged by the first rule.
    expect(found(lintDeclaration({ number: "4", before: ["1", "2", "3"], line: "**Depends On**: Slice 3, Phase-ANVIL Slice 1 (need `withAnvil`).", depends: ["3"] }))).toEqual([]);
    expect(found(lintDeclaration({
      number: "3", before: ["1", "2"], after: ["4", "5"],
      line: "**Depends On**: Slice 2, Phase-HALLMARK-CONTRACT Slice 3, Phase-PROVENANCE Slice 5 (release tag).",
      depends: ["2"],
    }))).toEqual([]);
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the Phase 62 Slice 2 output", depends: ["3"] }))).toEqual([]);
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the Phase-62's S2 output", depends: ["3"] }))).toEqual([]);
  });

  it("an entry that names another plan only in parentheses is still read", () => {
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the Slice 4 output (as in Phase-62)", depends: ["3"] }))).toHaveLength(1);
  });

  it("a later slice, since a dependency cannot point forward", () => {
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the output of Slice 7", depends: ["3"], after: ["6", "7"] }))).toEqual([]);
  });

  it("the slice itself, and a slice the plan does not have", () => {
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the output of Slice 5", depends: ["3"] }))).toEqual([]);
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the output of Slice 99", depends: ["3"] }))).toEqual([]);
  });

  it("a slice that is already a dependency", () => {
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3 and the Slice 3 fixtures", depends: ["3"] }))).toEqual([]);
  });

  it("an entry that names no slice", () => {
    expect(found(lintDeclaration({ line: "**Depends On**: Slice 3, Group B merge checkpoint.", depends: ["3"] }))).toEqual([]);
  });

  it("a slice that parsed no dependency, where depends-not-parsed already reports it", () => {
    const result = lintDeclaration({ line: "**Depends On**: the generated Slice 4 output", depends: [] });
    expect(found(result)).toEqual([]);
    expect(result.warnings.filter((warning) => warning.rule === "depends-not-parsed")).toHaveLength(1);
  });

  it("an explicit none", () => {
    expect(found(lintDeclaration({ line: "**Depends On**: none (parallel to Slices 3, 4)", depends: [] }))).toEqual([]);
    expect(found(lintDeclaration({ line: "**Depends On**: (none — independent; parallel to Slices 3, 4)", depends: ["2"] }))).toEqual([]);
  });

  it("a line with no Depends On label", () => {
    expect(found(lintDeclaration({ line: "Slice 3 and the generated Slice 4 output", depends: ["3"] }))).toEqual([]);
  });

  it("a plain-object slice with no depends or rawLines", () => {
    expect(found(lintGateCommands({ slices: [{ number: "1", title: "T", validationGate: "npm test" }, { number: "2", title: "U", validationGate: "npm test", depends: ["1"] }] }))).toEqual([]);
  });
});

describe("with the real parser (#368)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-368-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function planWith(dependsLine) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      ...["1", "2", "3", "4"].flatMap((n) => [`### Slice ${n}: Work ${n}`, "1. Do it", "**Validation Gate**", "```bash", "npm test", "```", ""]),
      "### Slice 5: Join", dependsLine, "1. Do it", "**Validation Gate**", "```bash", "npm test", "```", "",
    ].join("\n"));
    return parsePlan(planPath, dir);
  }

  it("the report's example parses to Slice 3 only, and the lint says so", () => {
    const plan = planWith("**Depends On**: Slice 3 and the generated Slice 4 output");
    expect(plan.slices[4].depends).toEqual(["3"]);
    const warnings = found(lintGateCommands(plan));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("Slice 4");
  });

  it("says nothing once the author writes the entry the parser reads", () => {
    const plan = planWith("**Depends On**: Slice 3, Slice 4 (the generated output)");
    expect(plan.slices[4].depends).toEqual(["3", "4"]);
    expect(found(lintGateCommands(plan))).toEqual([]);
  });

  it("agrees with the parser on a list it reads in full", () => {
    const plan = planWith("**Depends On**: Slices 3, 4");
    expect(plan.slices[4].depends).toEqual(["3", "4"]);
    expect(found(lintGateCommands(plan))).toEqual([]);
  });
});
