/**
 * parser-h2-slice-and-zero-guard.test.mjs — Bug #124: h2 slice headers + zero-slice guard
 *
 * Verifies:
 *   (a) h2 slice headers (## Slice N: ...) are parsed correctly
 *   (b) h3 slice headers still parsed (no regression)
 *   (c) h4 slice headers still parsed (no regression)
 *   (d) h1 (# Slice 1) is NOT matched
 *   (e) h5 (##### Slice 1) is NOT matched
 *   (f) zero-slice plan → runPlan returns { status:"failed", code:"NO_SLICES" } (normal run)
 *   (g) zero-slice plan → runPlan returns { status:"failed", code:"NO_SLICES" } (dryRun:true)
 *   (h) zero-slice plan → runPlan returns { status:"failed", code:"NO_SLICES" } (estimate:true)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePlan, runPlan } from "../orchestrator.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "pforge-parser-h2-"));
}

function writePlanFile(dir, content, name = "plan.md") {
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

/** Minimal zero-slice plan content (no ### Slice N: headers) */
const ZERO_SLICE_CONTENT =
  "---\ncrucibleId: test-zero-slice\n---\n# Zero Slice Plan\n\nNo slice headers here.\n";

/** Minimal plan content with h2 slice headers */
function h2PlanContent() {
  return [
    "---",
    "crucibleId: test-h2-plan",
    "---",
    "# H2 Slice Plan",
    "",
    "## Slice 1: First Step",
    "",
    "Task 1.",
    "",
    "## Slice 2: Second Step",
    "",
    "Task 2.",
    "",
  ].join("\n");
}

/** Minimal plan content with h3 slice headers */
function h3PlanContent() {
  return [
    "---",
    "crucibleId: test-h3-plan",
    "---",
    "# H3 Slice Plan",
    "",
    "### Slice 1: Alpha",
    "",
    "Task alpha.",
    "",
    "### Slice 2: Beta",
    "",
    "Task beta.",
    "",
  ].join("\n");
}

/** Minimal plan content with h4 slice headers */
function h4PlanContent() {
  return [
    "---",
    "crucibleId: test-h4-plan",
    "---",
    "# H4 Slice Plan",
    "",
    "#### Slice 1: Deep One",
    "",
    "Task deep.",
    "",
  ].join("\n");
}

/** Plan content with h1 slice header only (should NOT be parsed) */
function h1PlanContent() {
  return [
    "---",
    "crucibleId: test-h1-plan",
    "---",
    "# Slice 1: Should Not Match",
    "",
    "Task here.",
    "",
  ].join("\n");
}

/** Plan content with h5 slice header only (should NOT be parsed) */
function h5PlanContent() {
  return [
    "---",
    "crucibleId: test-h5-plan",
    "---",
    "# H5 Slice Plan",
    "",
    "##### Slice 1: Too Deep",
    "",
    "Task here.",
    "",
  ].join("\n");
}

// ─── Suite: parsePlan — h-level matching ──────────────────────────────────────

describe("Bug #124 — parsePlan h-level slice header matching", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(a) parses ## Slice N: (h2) headers correctly", () => {
    const planPath = writePlanFile(tmpDir, h2PlanContent());
    const result = parsePlan(planPath, tmpDir);
    expect(result.slices).toHaveLength(2);
    expect(result.slices[0].number).toBe("1");
    expect(result.slices[0].title).toBe("First Step");
    expect(result.slices[1].number).toBe("2");
    expect(result.slices[1].title).toBe("Second Step");
  });

  it("(b) still parses ### Slice N: (h3) headers — no regression", () => {
    const planPath = writePlanFile(tmpDir, h3PlanContent());
    const result = parsePlan(planPath, tmpDir);
    expect(result.slices).toHaveLength(2);
    expect(result.slices[0].number).toBe("1");
    expect(result.slices[0].title).toBe("Alpha");
    expect(result.slices[1].number).toBe("2");
    expect(result.slices[1].title).toBe("Beta");
  });

  it("(c) still parses #### Slice N: (h4) headers — no regression", () => {
    const planPath = writePlanFile(tmpDir, h4PlanContent());
    const result = parsePlan(planPath, tmpDir);
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].number).toBe("1");
    expect(result.slices[0].title).toBe("Deep One");
  });

  it("(d) does NOT match # Slice N: (h1) — h1 is plan title, not a slice", () => {
    const planPath = writePlanFile(tmpDir, h1PlanContent());
    const result = parsePlan(planPath, tmpDir);
    expect(result.slices).toHaveLength(0);
  });

  it("(e) does NOT match ##### Slice N: (h5) — below accepted h-level range", () => {
    const planPath = writePlanFile(tmpDir, h5PlanContent());
    const result = parsePlan(planPath, tmpDir);
    expect(result.slices).toHaveLength(0);
  });
});

// ─── Suite: runPlan — zero-slice guard ────────────────────────────────────────

describe("Bug #124 — runPlan zero-slice guard", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(f) zero-slice plan → { status:'failed', code:'NO_SLICES' } on normal run", async () => {
    const planPath = writePlanFile(tmpDir, ZERO_SLICE_CONTENT);
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      manualImportSource: "human",
    });
    expect(result.status).toBe("failed");
    expect(result.code).toBe("NO_SLICES");
    expect(result.error).toMatch(/no slices found/i);
    expect(result.planPath).toBe(planPath);
  });

  it("(g) zero-slice plan → { status:'failed', code:'NO_SLICES' } with dryRun:true", async () => {
    const planPath = writePlanFile(tmpDir, ZERO_SLICE_CONTENT);
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      dryRun: true,
      manualImport: true,
      manualImportSource: "human",
    });
    expect(result.status).toBe("failed");
    expect(result.code).toBe("NO_SLICES");
  });

  it("(h) zero-slice plan → { status:'failed', code:'NO_SLICES' } with estimate:true", async () => {
    const planPath = writePlanFile(tmpDir, ZERO_SLICE_CONTENT);
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      estimate: true,
      manualImport: true,
      manualImportSource: "human",
    });
    expect(result.status).toBe("failed");
    expect(result.code).toBe("NO_SLICES");
  });
});
