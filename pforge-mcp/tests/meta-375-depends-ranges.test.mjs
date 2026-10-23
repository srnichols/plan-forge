import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parsePlan, buildDAG } from "../orchestrator/plan-parser.mjs";

/**
 * Meta-bug #375 — a dependency range was read as its first id. `**Depends On**:
 * S0–S8 all green` parsed to `["0"]`, so the join slice depended on slice 0 only
 * and could start before slices 1–8 had passed: because a slice with any parsed
 * dependency skips the sequential fallback, nothing else ordered it. #362 made
 * the plural form `Slices 1–5` loud by leaving it unparsed; this reads both
 * forms, once every slice heading is known. In `docs/plans`, 11 slices in 10
 * plans carried the bare `Sa–Sb` form.
 */

describe("a dependency range names every slice it spans (#375)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-375-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function parse(...slices) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      ...slices.flatMap(([number, ...body]) => [`### Slice ${number}: Work ${number}`, ...body, "1. Do it", ""]),
    ].join("\n"));
    return parsePlan(planPath, dir).slices;
  }
  const depsOf = (...slices) => Object.fromEntries(parse(...slices).map((slice) => [slice.number, slice.depends]));
  /** Slices 0..last-1 with no dependency declared, then a final slice with `declaration`. */
  const withFinal = (last, declaration) => [...Array.from({ length: last }, (_, i) => [String(i)]), [String(last), declaration]];
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

  it("expands S0–S8 against the slices before the one that declares it", () => {
    expect(depsOf(...withFinal(9, "**Depends On**: S0–S8 all green"))["9"]).toEqual(range(0, 8));
  });

  it.each([
    ["a hyphen", "**Depends On**: S0-S3 all green"],
    ["an en dash", "**Depends On**: S0–S3 all green."],
    ["an em dash", "**Depends On**: S0—S3"],
    ["spaces around the dash", "**Depends On**: S0 – S3"],
    ["the word through", "**Depends On**: Slice 0 through Slice 3"],
    ["the word to", "**Depends On**: S0 to S3"],
    ["the plural keyword", "**Depends On**: Slices 0–3"],
  ])("reads a range written with %s", (_label, declaration) => {
    expect(depsOf(...withFinal(5, declaration))["5"]).toEqual(range(0, 3));
  });

  it("reads a range inside a list, next to single ids", () => {
    const deps = depsOf(...withFinal(6, "**Depends On**: Slices 1–3, 5"));
    expect([...deps["6"]].sort()).toEqual(["1", "2", "3", "5"]);
  });

  it("reads a range in the heading tag", () => {
    const planPath = join(dir, "tagged.md");
    writeFileSync(planPath, [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      "### Slice 0: A", "1. Do it", "", "### Slice 1: B", "1. Do it", "", "### Slice 2: C", "1. Do it", "",
      "### Slice 3: Join [depends: S0–S2]", "1. Do it", "",
    ].join("\n"));
    expect(parsePlan(planPath, dir).slices[3].depends).toEqual(["0", "1", "2"]);
  });

  it("includes the sub-slices that fall between the ends", () => {
    const deps = depsOf(["1"], ["1.1"], ["1.2"], ["2"], ["3"], ["4", "**Depends On**: S1–S2"]);
    expect(deps["4"]).toEqual(["1", "1.1", "1.2", "2"]);
  });

  it("only depends on slices that come before it", () => {
    expect(depsOf(...Array.from({ length: 10 }, (_, i) => (i === 3 ? ["3", "**Depends On**: S0–S8"] : [String(i)])))["3"]).toEqual(["0", "1", "2"]);
  });

  it("keeps the explicit ids and does not repeat one the range also covers", () => {
    const deps = depsOf(...withFinal(5, "**Depends On**: Slice 3, S0–S3"));
    expect([...deps["5"]].sort()).toEqual(["0", "1", "2", "3"]);
  });

  it("does not read a range written as commentary in parentheses", () => {
    const deps = depsOf(...withFinal(9, "**Depends On**: Slice 0 (does NOT require S4–S7; can run any time after baselines exist)"));
    expect(deps["9"]).toEqual(["0"]);
  });

  it("gives a reversed range no dependency rather than a wrong one", () => {
    expect(depsOf(...withFinal(9, "**Depends On**: S8–S2"))["9"]).toEqual([]);
  });

  it("gives a range that spans no earlier slice no dependency", () => {
    expect(depsOf(["6", "**Depends On**: Slices 1–5"])["6"]).toEqual([]);
  });

  it("orders the join slice after every slice it spans, not after slice 0 alone", () => {
    const { nodes, order } = buildDAG(parse(...withFinal(9, "**Depends On**: S0–S8 all green")));
    expect([...nodes.get("9").depends].sort()).toEqual(range(0, 8));
    expect(order.indexOf("9")).toBe(order.length - 1);
  });

  it("leaves no working field on the slice", () => {
    const [first, , , , , last] = parse(...withFinal(5, "**Depends On**: S0–S3"));
    expect(Object.keys(last)).not.toContain("dependencyRanges");
    expect(Object.keys(first)).not.toContain("dependencyRanges");
  });
});

const PLANS_DIR = resolve(import.meta.dirname, "..", "..", "docs", "plans");
const BARE_RANGE = /\*\*Depends\s+On:?\*\*:?\s*S\d+(?:\.\d+)?\s*[-–—]\s*S\d+/i;

function planFiles(path) {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (statSync(full).isDirectory()) return planFiles(full);
    return /PLAN\.md$/i.test(name) ? [full] : [];
  });
}

// The corpus lives in the source repository, not in a project that installed pforge-mcp.
describe.skipIf(!existsSync(PLANS_DIR))("the bare ranges in docs/plans are read (#375)", () => {
  const root = resolve(PLANS_DIR, "..", "..");
  const slices = existsSync(PLANS_DIR)
    ? planFiles(PLANS_DIR).flatMap((file) => parsePlan(file, root).slices.map((parsed, index, all) => ({ plan: relative(PLANS_DIR, file).replace(/\\/g, "/"), parsed, before: all.slice(0, index) })))
    : [];
  const withRange = slices.filter(({ parsed }) => parsed.rawLines.some((line) => BARE_RANGE.test(line)));

  it("finds the slices that declare one", () => {
    expect(withRange.length).toBeGreaterThan(5);
  });

  it("gives each of them more than the first id of its range, when slices precede it", () => {
    const truncated = withRange
      .filter(({ parsed, before }) => before.length > 1 && parsed.depends.length <= 1)
      .map(({ plan, parsed }) => `${plan}: slice ${parsed.number} depends on ${JSON.stringify(parsed.depends)}`);
    expect(truncated).toEqual([]);
  });
});
