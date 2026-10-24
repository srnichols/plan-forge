import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parsePlan } from "../orchestrator/plan-parser.mjs";
import { PLAN_CORPUS, PLAN_CORPUS_ROOT, PLANS_DIR } from "./helpers/plan-corpus.mjs";

/**
 * Meta-bug #374 — `**Context Files**:` was read only when its files sat on the
 * same line as the label. A list written the way Scope is (the label on its own
 * line, one bullet per file) was ignored, and the slice ran with
 * `contextFiles = []`: the worker was never told about the read-only references
 * the plan author listed. In `docs/plans`, 37 of the 186 slices that carry the
 * label were affected.
 */

describe("Context Files written as a bullet list (#374)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-374-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const TAIL = ["1. Do it", "", "**Validation Gate**:", "```bash", "npm test", "```", ""];
  function parse(...slices) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, ["# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices", ...slices.flat()].join("\n"));
    return parsePlan(planPath, dir).slices;
  }
  const slice = (number, ...body) => [`### Slice ${number}: Work ${number}`, ...body, ...TAIL];
  const contextOf = (...body) => parse(slice("1", ...body))[0].contextFiles;

  it("reads one bullet per file under the label", () => {
    expect(contextOf("**Context Files**:", "- `docs/a.md`", "- `docs/b.md`", "")).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("reads a list that starts after a blank line, the way Prettier writes it", () => {
    expect(contextOf("**Context Files**:", "", "- `docs/a.md`", "- `docs/b.md`", "")).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("takes the path from a bullet that carries a description", () => {
    expect(contextOf("**Context Files**:", "- docs/a.md (the contract)", "- `docs/b.md` — the schema", "")).toEqual(["docs/a.md", "docs/b.md"]);
  });

  it("accepts the label with the colon inside the bold span, and a bulleted label", () => {
    expect(contextOf("**Context Files:**", "- `docs/a.md`", "")).toEqual(["docs/a.md"]);
    expect(contextOf("- **Context Files**:", "  - `docs/a.md`", "")).toEqual(["docs/a.md"]);
  });

  it("stops at the next bold label", () => {
    expect(contextOf("**Context Files**:", "- `docs/a.md`", "**Notes**:", "- `docs/not-context.md`", "")).toEqual(["docs/a.md"]);
  });

  it("stops at a blank line after the list", () => {
    expect(contextOf("**Context Files**:", "- `docs/a.md`", "", "- `docs/later.md`", "")).toEqual(["docs/a.md"]);
  });

  it("stops at a bullet that is itself a labelled field, and that field is still read", () => {
    const [first] = parse(slice("1", "**Context Files**:", "- `docs/a.md`", "- **Scope**: `src/x.ts`", ""));
    expect(first.contextFiles).toEqual(["docs/a.md"]);
    expect(first.scope).toEqual(["src/x.ts"]);
  });

  it("keeps the same-line forms exactly as they were", () => {
    expect(contextOf("**Context Files**: `docs/a.md`, `docs/b.md`", "")).toEqual(["docs/a.md", "docs/b.md"]);
    expect(contextOf("**Context Files**: (none — nothing to read first)", "- `docs/not-context.md`", "")).toEqual([]);
  });

  it("leaves the list empty when the label is followed by prose", () => {
    expect(contextOf("**Context Files**:", "Read the design notes first.", "")).toEqual([]);
  });

  it("keeps the files out of scope, and a scope list out of the context files", () => {
    const [first] = parse(slice("1", "**Files in scope**:", "- `src/a.ts`", "", "**Context Files**:", "- `docs/a.md`", ""));
    expect(first.scope).toEqual(["src/a.ts"]);
    expect(first.contextFiles).toEqual(["docs/a.md"]);
  });

  it("does not let a Context Files line that follows a scope list widen the scope", () => {
    const [first] = parse(slice("1", "**Files in scope**:", "- `src/a.ts`", "- **Context Files**: `docs/a.md`", ""));
    expect(first.scope).toEqual(["src/a.ts"]);
    expect(first.contextFiles).toEqual(["docs/a.md"]);
  });

  it("does not carry an open list into the next slice", () => {
    const [first, second] = parse(slice("1", "**Context Files**:", "- `docs/a.md`"), slice("2", "- `docs/leak.md`", ""));
    expect(first.contextFiles).toEqual(["docs/a.md"]);
    expect(second.contextFiles).toEqual([]);
  });

  it("does not read bullets inside a code fence as context files", () => {
    expect(contextOf("**Context Files**:", "```text", "- `docs/example.md`", "```", "")).toEqual([]);
  });
});

/** A slice whose Context Files label has no files after it on its line but a file bullet on a later one. */
function declaresBulletList(rawLines) {
  const labelAt = rawLines.findIndex((line) => /\*\*Context Files:?\*\*:?\s*$/i.test(line));
  if (labelAt === -1) return false;
  const next = rawLines.slice(labelAt + 1).find((line) => line.trim() !== "");
  // "- (No instruction files — pure asset creation)" says there are none.
  return /^\s*[-*]\s+(?!\()\S/.test(next ?? "");
}

// The corpus is the framework's own phase plans: planning/main has them, master and an installed project do not (#398).
describe.skipIf(PLAN_CORPUS.length === 0)("every Context Files bullet list in docs/plans is read (#374)", () => {
  const slices = PLAN_CORPUS.flatMap((file) => parsePlan(file, PLAN_CORPUS_ROOT).slices.map((parsed) => ({ plan: relative(PLANS_DIR, file).replace(/\\/g, "/"), parsed })));

  it("reads a corpus large enough to mean something", () => {
    expect(slices.length).toBeGreaterThan(100);
    expect(slices.filter(({ parsed }) => declaresBulletList(parsed.rawLines)).length).toBeGreaterThan(10);
  });

  it("leaves no slice with a bullet list under the label and no context files", () => {
    const dropped = slices
      .filter(({ parsed }) => declaresBulletList(parsed.rawLines) && parsed.contextFiles.length === 0)
      .map(({ plan, parsed }) => `${plan}: slice ${parsed.number}`);
    expect(dropped).toEqual([]);
  });
});
