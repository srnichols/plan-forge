/**
 * Plan Forge — Phase-59 S4: bug-batch mode contract tests.
 *
 * Tests:
 *   - Bank: 8 questions, all required IDs present
 *   - criticalFields: covers the 4 required names
 *   - frontmatterExtras shape for with/without bugId
 *   - Render: fixture smelt with all 8 answers produces Root Cause + 2 slices
 *   - Refuse: smelt missing slice-breakdown causes finalize to throw
 *   - No-regression: rendered output matches stored fixture
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Import bug-batch FIRST to register the mode before any renderDraft calls.
import bugBatch, { parseSliceBreakdown, renderBody } from "../../crucible/modes/bug-batch.mjs";
import { handleFinalize } from "../../crucible-server.mjs";
import { CrucibleFinalizeRefusedError } from "../../crucible/core/finalize.mjs";
import { updateSmelt, createSmelt } from "../../crucible-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "..", "fixtures", "crucible-baseline");

// ─── Mode contract ────────────────────────────────────────────────────

describe("bug-batch mode — contract", () => {
  it("has exactly 8 questions in the bank", () => {
    expect(bugBatch.bank).toHaveLength(8);
    expect(bugBatch.questionBank()).toHaveLength(8);
  });

  it("bank contains all required question IDs", () => {
    const ids = bugBatch.bank.map((q) => q.id);
    const required = [
      "symptom-observed", "expected-behavior", "suspected-component",
      "scope-files", "slice-breakdown", "validation-gates",
      "forbidden-actions", "rollback",
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  it("criticalFields contains the 4 required names", () => {
    const crit = Array.from(bugBatch.criticalFields).sort();
    expect(crit).toEqual(["forbidden-actions", "scope-files", "slice-breakdown", "validation-gates"]);
  });

  it("bugId present → linkedBugs and bugId in frontmatter output", () => {
    const { buildFrontmatter } = await_fmRef();
    const smelt = {
      id: "s1", lane: "bug-batch", source: "human", answers: [],
      bugId: "RMG-0035",
    };
    const fm = buildFrontmatter(smelt, "Phase-77");
    expect(fm).toContain("linkedBugs: [RMG-0035]");
    expect(fm).toContain("bugId: RMG-0035");
  });

  it("no bugId → no linkedBugs/bugId in frontmatter", () => {
    const { buildFrontmatter } = await_fmRef();
    const smelt = { id: "s2", lane: "bug-batch", source: "human", answers: [] };
    const fm = buildFrontmatter(smelt, "Phase-78");
    expect(fm).not.toContain("linkedBugs");
    expect(fm).not.toContain("bugId");
  });
});

// ─── parseSliceBreakdown ──────────────────────────────────────────────

describe("parseSliceBreakdown", () => {
  it("parses two well-formed lines into 2 slices", () => {
    const raw = "Guard empty | plan-parser.mjs | npm test\nAdd regression | tests/plan-parser.test.mjs | npm test";
    const slices = parseSliceBreakdown(raw);
    expect(slices).toHaveLength(2);
    expect(slices[0]).toEqual({ name: "Guard empty", files: "plan-parser.mjs", testCmd: "npm test" });
    expect(slices[1].name).toBe("Add regression");
  });

  it("trims whitespace from each part", () => {
    const raw = "  Fix  |  src/file.mjs  |  npm run test  ";
    const slices = parseSliceBreakdown(raw);
    expect(slices[0].name).toBe("Fix");
    expect(slices[0].files).toBe("src/file.mjs");
    expect(slices[0].testCmd).toBe("npm run test");
  });

  it("throws INVALID_SLICE_BREAKDOWN when a line has fewer than 3 parts", () => {
    expect(() => parseSliceBreakdown("Only one part")).toThrow(/fewer than 3 parts/);
    try {
      parseSliceBreakdown("name | files");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err.code).toBe("INVALID_SLICE_BREAKDOWN");
    }
  });

  it("returns [] for empty/null input", () => {
    expect(parseSliceBreakdown("")).toEqual([]);
    expect(parseSliceBreakdown(null)).toEqual([]);
  });
});

// ─── renderBody ───────────────────────────────────────────────────────

describe("bug-batch renderBody", () => {
  function fixtureSmelt() {
    return JSON.parse(readFileSync(join(FIXTURE_DIR, "bug-batch-smelt.json"), "utf-8"));
  }

  it("renders ## Root Cause Hypothesis section", () => {
    const rendered = renderBody(fixtureSmelt());
    expect(rendered).toContain("## Root Cause Hypothesis");
    expect(rendered).toContain("**Symptom observed**:");
    expect(rendered).toContain("**Expected behavior**:");
    expect(rendered).toContain("**Suspected component**:");
  });

  it("renders at least 2 synthesized slices with [scope:] clause", () => {
    const rendered = renderBody(fixtureSmelt());
    const headers = rendered.match(/^### Slice \d+ — /gm) || [];
    expect(headers.length).toBeGreaterThanOrEqual(2);
    const scopeClauses = rendered.match(/\[scope:[^\]]+\]/g) || [];
    expect(scopeClauses.length).toBeGreaterThanOrEqual(2);
  });

  it("matches stored fixture (no-regression)", () => {
    const smelt = fixtureSmelt();
    const rendered = renderBody(smelt);
    const expected = readFileSync(join(FIXTURE_DIR, "bug-batch-rendered.md"), "utf-8").replace(/\r\n/g, "\n");
    expect(rendered.replace(/\r\n/g, "\n")).toBe(expected);
  });

  it("emits {{TBD: slice-breakdown}} when answer is missing", () => {
    const smelt = { id: "s3", lane: "bug-batch", source: "human", status: "in-progress", rawIdea: "test", answers: [] };
    const rendered = renderBody(smelt);
    expect(rendered).toContain("{{TBD: slice-breakdown}}");
  });
});

// ─── handleFinalize integration — refuse on missing slice-breakdown ───

describe("handleFinalize bug-batch — refuse on missing criticalFields", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pforge-test-${randomUUID()}`);
    mkdirSync(join(projectDir, "docs", "plans"), { recursive: true });
    writeFileSync(join(projectDir, "docs", "plans", "PROJECT-PRINCIPLES.md"), "# Principles\n", "utf-8");
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("throws CrucibleFinalizeRefusedError with slice-breakdown in criticalGaps", () => {
    const smelt = createSmelt({ lane: "bug-batch", rawIdea: "fix bug", source: "human", projectDir });
    // Answer everything EXCEPT slice-breakdown
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "scope-files",       answer: "src/foo.mjs",        recordedAt: new Date().toISOString() },
        { questionId: "validation-gates",  answer: "npm test",            recordedAt: new Date().toISOString() },
        { questionId: "forbidden-actions", answer: "no prod changes",     recordedAt: new Date().toISOString() },
      ],
    }, projectDir);

    expect(() => handleFinalize({ id: smelt.id, projectDir }))
      .toThrow(CrucibleFinalizeRefusedError);

    try {
      handleFinalize({ id: smelt.id, projectDir });
    } catch (err) {
      expect(err.payload.criticalGaps).toContain("slice-breakdown");
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

import { buildFrontmatter as _buildFrontmatter } from "../../crucible/core/finalize.mjs";
const _fmRef = { buildFrontmatter: _buildFrontmatter };
function await_fmRef() { return _fmRef; }
