import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDAG, dependencyListText, parsePlan, unreadDependencyEntries } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";

/**
 * Meta-bug #453 — a `**Depends On**:` list ran to the end of its line, so a
 * second bold label after it was read as more of the list:
 *
 *   **Depends On**: Prereqs green. **Blocks**: 2, 3.
 *
 * The list split at the commas, "Prereqs green. **Blocks**: 2" began with no
 * slice id and was dropped, and "3." was read as a dependency on slice 3. Slice 1
 * then waited on slice 3 while slice 3 waited on slice 1, and the whole plan
 * failed with "Cycle detected" and no slice named. The step-2 hardener adds the
 * second label on its own, as the counterpart of "Depends On". Same family as
 * #362, where a comma inside parentheses leaked a dependency.
 */

const slice = (number, depends = []) => ({ number, title: `Work ${number}`, depends, parallel: false, scope: [], tasks: [] });

function cycleMessage(slices) {
  try {
    buildDAG(slices);
  } catch (error) {
    return error.message;
  }
  throw new Error("buildDAG did not throw");
}

describe("a second bold label ends the Depends On list (#453)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-453-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function parse(...slices) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      ...slices.flatMap(([heading, ...body]) => [`### Slice ${heading}`, "1. Do it", ...body, ""]),
    ].join("\n"));
    return parsePlan(planPath, dir);
  }

  const depsOf = (text) => parse(["9 — Join", `**Depends On**: ${text}`]).slices[0].depends;

  it("builds the plan from the report, where slice 1 blocks the two slices that wait on it", () => {
    const plan = parse(
      ["1 — First", "**Depends On**: Prereqs green. **Blocks**: 2, 3."],
      ["2 — Second", "**Depends On**: Slice 1."],
      ["3 — Third", "**Depends On**: Slice 1."],
    );
    expect(plan.slices.map(({ depends }) => depends)).toEqual([[], ["1"], ["1"]]);
    expect(plan.dag.order).toEqual(["1", "2", "3"]);
  });

  it("builds an 8-slice plan whose slice 1 blocks five of the others", () => {
    const waits = (number) => [`${number} — Work`, "**Depends On**: Slice 1."];
    const plan = parse(
      ["1 — First", "**Depends On**: Prereqs green. **Blocks**: 2, 4, 5, 6, 7."],
      waits(2), ["3 — Work", "**Depends On**: Slice 2."], waits(4), waits(5), waits(6), waits(7), ["8 — Last", "**Depends On**: Slices 3, 7."],
    );
    expect(plan.slices[0].depends).toEqual([]);
    expect(plan.dag.order[0]).toBe("1");
    expect(plan.dag.order).toHaveLength(8);
  });

  it.each([
    ["Slice 1. **Blocks**: 2, 3.", ["1"]],
    ["none. **Blocks**: 2, 3.", []],
    ["Slice 1 **Blocks**: 2, 3", ["1"]],
    ["Slice 1, **Blocks**: 2, 3", ["1"]],
    ["Slices 1 and 2. **Blocks**: 4, 5.", ["1", "2"]],
    ["Slice 1. **Blocks:** 2, 3.", ["1"]],
    ["Slice 1. **Blocks**: Slice 2, Slice 3.", ["1"]],
    ["Slice 1. **Blocks**: Slices 2–4.", ["1"]],
    ["Prereqs green. **Blocks**: Slice 5.", []],
    ["Slice 1. **Parallel Group**: A, B", ["1"]],
    ["**Slice 1**: setup, Slice 2", ["2"]],
    ["Slice 1, **Slice 2**: x, Slice 3", ["1", "3"]],
    ["Slice 1, **Slice 2:** x, Slice 3", ["1", "3"]],
    ["Slice 1, **slice 2**: x, Slice 3", ["1", "3"]],
    ["Slice 1, **Slices 2–3**: x, Slice 4", ["1", "4"]],
    ["Slice 1, **Slice 2**: x. **Blocks**: 5, 6.", ["1"]],
    ["**S1**: setup, S2", ["2"]],
    ["Slice 1, **S2**: x, Slice 3", ["1", "3"]],
    ["Slice 1, **s2:** x, Slice 3", ["1", "3"]],
    ["Slice 1, **Slice2**: x, Slice 3", ["1", "3"]],
    ["Slice 1, ** Slice 2**: x, Slice 3", ["1", "3"]],
    ["Slice 1, **S2a**: x, Slice 3", ["1", "3"]],
    // Not slice ids, or a bare number that nothing marks as one: labels, so the list ends there.
    ["Slice 1, **Sprint 2**: x, Slice 3", ["1"]],
    ["Slice 1, **Security**: x, Slice 3", ["1"]],
    ["Slice 1, **Slice A**: x, Slice 3", ["1"]],
    ["Slice 1, **D1**: x, Slice 3", ["1"]],
    ["Slice 1, **Blocks Slice 2**: x, Slice 3", ["1"]],
    ["Slice 1, **2**: x, Slice 3", ["1"]],
  ])("reads %s as %j", (text, expected) => {
    expect(depsOf(text)).toEqual(expected);
  });

  it("does not take a bold slice id for a label, so the list is cut only at a real label", () => {
    expect(dependencyListText("Slice 1, **Slice 2**: x, Slice 3")).toBe("Slice 1, **Slice 2**: x, Slice 3");
    expect(dependencyListText("Slice 1, **S2**: x, Slice 3")).toBe("Slice 1, **S2**: x, Slice 3");
    expect(dependencyListText("Slice 1, **Blocks**: 2, 3")).toBe("Slice 1, ");
    expect(dependencyListText("**Slice Files**: a, Slice 2")).toBe("");
    expect(dependencyListText("Slice 1, **Step 2**: x")).toBe("Slice 1, ");
  });

  it("ends the list at a label and at no other bold text: a decision reference has no colon", () => {
    expect(depsOf("Slice 1 (see **D-C1**), Slice 2")).toEqual(["1", "2"]);
    expect(depsOf("Slice 1, Slice 2 (**must** finish first), Slice 3")).toEqual(["1", "2", "3"]);
  });

  it("keeps reading after bold text that is not a label and is not in parentheses", () => {
    expect(depsOf("Slice 1 **core**, Slice 2")).toEqual(["1", "2"]);
  });

  it("is not thrown off by a close parenthesis that has no open one before the label", () => {
    expect(depsOf("Slice 1) **Blocks**: 2, 3.")).toEqual(["1"]);
  });

  it("reads past a label inside parentheses, which is commentary like the rest of the parentheses", () => {
    expect(depsOf("Slice 1 (reads the **Scope**: list), Slice 2")).toEqual(["1", "2"]);
  });

  it("keeps a range written after the label out of the slice's dependency ranges", () => {
    const [only] = parse(["9 — Join", "**Depends On**: Slice 1. **Blocks**: Slices 2–4."]).slices;
    expect(only.depends).toEqual(["1"]);
    expect(only.dependencyRanges).toBeUndefined();
  });

  it("still reads a range written before the label", () => {
    const plan = parse(["1 — A"], ["2 — B"], ["3 — C"], ["4 — D", "**Depends On**: Slices 1–3. **Blocks**: 5."]);
    expect(plan.slices[3].depends).toEqual(["1", "2", "3"]);
  });
});

describe("the Depends On lint reads the same list as the parser (#453)", () => {
  const sliceOf = (number, extra = {}) => ({ number, title: `Work ${number}`, validationGate: "npm test", depends: [], rawLines: [], ...extra });
  const warningsFor = (rule, line) =>
    lintGateCommands({ slices: [sliceOf("1", { title: "First", rawLines: [line] }), sliceOf("2"), sliceOf("3")] })
      .warnings.filter((warning) => warning.rule === rule);

  it("returns only the entries before the label from unreadDependencyEntries", () => {
    expect(unreadDependencyEntries("**Depends On**: Prereqs green. **Blocks**: 2, 3.")).toEqual(["Prereqs green."]);
    expect(unreadDependencyEntries("**Depends On**: Slice 3 and the generated Slice 4 output. **Blocks**: Slice 5.")).toEqual([
      "the generated Slice 4 output.",
    ]);
    expect(unreadDependencyEntries("**Depends On**: Slice 3. **Blocks**: Slices 4 through")).toEqual([]);
  });

  it("does not report a slice the Blocks clause names as a dependency the parser missed", () => {
    expect(warningsFor("depends-not-parsed", "**Depends On**: Prereqs green. **Blocks**: Slice 2, Slice 3.")).toEqual([]);
    expect(warningsFor("depends-not-parsed", "**Depends On**: none. **Blocks**: Slice 2.")).toEqual([]);
  });

  it.each([
    ["**Slice 1**: setup, Slice 2", "**Slice 1**: setup"],
    ["**S1**: setup, S2", "**S1**: setup"],
    ["**s1:** setup, S2", "**s1:** setup"],
  ])("still reports %s as an entry the parser did not read, as before the label rule", (list, entry) => {
    expect(unreadDependencyEntries(`**Depends On**: ${list}`)).toEqual([entry]);
    const found = warningsFor("depends-not-parsed", `**Depends On**: ${list}`);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain(entry);
  });

  it("still reports a declaration that named a slice before the label and parsed to nothing", () => {
    const found = warningsFor("depends-not-parsed", "**Depends On**: Slices 1–5. **Blocks**: Slice 7.");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("Slices 1–5");
    expect(found[0].message).not.toContain("Blocks");
  });
});

describe("the cycle error names the slices on the loop (#453)", () => {
  it("names the two slices of the loop in the report and not the slice that only waits on it", () => {
    const message = cycleMessage([slice("1", ["3"]), slice("2", ["1"]), slice("3", ["1"])]);
    expect(message).toMatch(/^Cycle detected in slice dependencies/);
    expect(message).toContain("slice 1 depends on slice 3, which depends on slice 1");
    expect(message).not.toContain("slice 2");
  });

  it("names every slice of a longer loop, in the order the dependencies lead", () => {
    const message = cycleMessage([slice("1"), slice("2", ["5"]), slice("3", ["2"]), slice("4", ["3"]), slice("5", ["3", "1"])]);
    expect(message).toContain("slice 2 depends on slice 5, which depends on slice 3, which depends on slice 2");
    expect(message).not.toContain("slice 4");
    expect(message).not.toContain("slice 1");
  });

  it("starts at the lowest slice id by number, not by text", () => {
    const message = cycleMessage([slice("9", ["10"]), slice("10", ["9"])]);
    expect(message).toContain("slice 9 depends on slice 10, which depends on slice 9");
  });

  it("starts at the lowest slice id left over, whatever order the slices are declared in", () => {
    const message = cycleMessage([slice("3", ["2"]), slice("2", ["3"]), slice("1", ["2"])]);
    expect(message).toContain("slice 2 depends on slice 3, which depends on slice 2");
  });

  it("follows the lowest dependency when a slice waits on two that each close a loop", () => {
    const message = cycleMessage([slice("1", ["2", "3"]), slice("2", ["1"]), slice("3", ["1"])]);
    expect(message).toContain("slice 1 depends on slice 2, which depends on slice 1");
    expect(message).not.toContain("slice 3");
  });

  it("says a slice that depends on itself depends on itself", () => {
    const message = cycleMessage([slice("1"), slice("2", ["2"])]);
    expect(message).toContain("slice 2 depends on itself");
  });

  it("finds the loop from the lowest slice left over even when that slice is not on it", () => {
    const message = cycleMessage([slice("1", ["3"]), slice("2", ["1"]), slice("3", ["4"]), slice("4", ["3"])]);
    expect(message).toContain("slice 3 depends on slice 4, which depends on slice 3");
    expect(message).not.toContain("slice 1");
    expect(message).not.toContain("slice 2");
  });

  it("names the slices when parsePlan reads the loop from the plan text", () => {
    const dir = mkdtempSync(join(tmpdir(), "pf-meta-453-"));
    try {
      const planPath = join(dir, "plan.md");
      writeFileSync(planPath, [
        "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
        "### Slice 1 — First", "1. Do it", "**Depends On**: Slice 2.", "",
        "### Slice 2 — Second", "1. Do it", "**Depends On**: Slice 1.", "",
      ].join("\n"));
      expect(() => parsePlan(planPath, dir)).toThrow(/Cycle detected in slice dependencies.*slice 1 depends on slice 2, which depends on slice 1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the slices it could not order when a repeated slice number hides the loop", () => {
    const message = cycleMessage([slice("2", ["3"]), slice("3", ["2"]), slice("2")]);
    expect(message).toMatch(/^Cycle detected in slice dependencies/);
    expect(message).toContain("slices 2, 3 cannot be ordered");
  });

  it("tells the author where the dependencies are written", () => {
    expect(cycleMessage([slice("1", ["2"]), slice("2", ["1"])])).toContain("Depends On line or [depends: ...] tag");
  });

  it("does not throw for slices that depend on each other in a line", () => {
    expect(buildDAG([slice("1"), slice("2", ["1"]), slice("3", ["2"])]).order).toEqual(["1", "2", "3"]);
  });
});
