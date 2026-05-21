/**
 * Plan Forge — Phase-59 S3: buildFrontmatter + handleFinalize frontmatter gate.
 *
 * Tests:
 *   1. No bugId + no linked-bugs answer → no linkedBugs/bugId in frontmatter
 *   2. bugId only → bugId + linkedBugs: [bugId] in frontmatter
 *   3. bugId + linked-bugs answer → linkedBugs deduped from both, bugId present
 *   4. phaseId always emitted post-finalize
 *   5. handleFinalize integration: frontmatter written to plan file
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { buildFrontmatter } from "../crucible/core/finalize.mjs";
import { handleSubmit, handleFinalize } from "../crucible-server.mjs";

// ─── buildFrontmatter pure-function tests ─────────────────────────────

describe("buildFrontmatter (pure)", () => {
  const baseSmelt = {
    id: "smelt-abc",
    lane: "feature",
    source: "human",
    answers: [],
  };

  it("emits required keys without linkedBugs/bugId when neither is provided", () => {
    const fm = buildFrontmatter(baseSmelt, "Phase-99");
    expect(fm).toContain("crucibleId: smelt-abc");
    expect(fm).toContain("lane: feature");
    expect(fm).toContain("source: human");
    expect(fm).toContain("phaseId: Phase-99");
    expect(fm).not.toContain("linkedBugs");
    expect(fm).not.toContain("bugId");
  });

  it("emits bugId and linkedBugs:[bugId] when only bugId is set", () => {
    const smelt = { ...baseSmelt, bugId: "RMG-0035" };
    const fm = buildFrontmatter(smelt, "Phase-99");
    expect(fm).toContain("bugId: RMG-0035");
    expect(fm).toContain("linkedBugs: [RMG-0035]");
  });

  it("deduplicates bugId from linked-bugs answer", () => {
    const smelt = {
      ...baseSmelt,
      bugId: "RMG-0035",
      answers: [
        { questionId: "linked-bugs", answer: "RMG-0035, RMG-0041" },
      ],
    };
    const fm = buildFrontmatter(smelt, "Phase-99");
    expect(fm).toContain("linkedBugs: [RMG-0035, RMG-0041]");
    expect(fm).toContain("bugId: RMG-0035");
    // RMG-0035 must not appear twice in linkedBugs
    const match = fm.match(/linkedBugs:\s*\[([^\]]+)\]/);
    expect(match).toBeTruthy();
    const ids = match[1].split(",").map((s) => s.trim());
    expect(ids.filter((id) => id === "RMG-0035")).toHaveLength(1);
  });

  it("collects linked-bugs answer without bugId", () => {
    const smelt = {
      ...baseSmelt,
      answers: [
        { questionId: "linked-bugs", answer: "RMG-0041\nRMG-0042" },
      ],
    };
    const fm = buildFrontmatter(smelt, "Phase-99");
    expect(fm).toContain("linkedBugs: [RMG-0041, RMG-0042]");
    expect(fm).not.toContain("bugId:");
  });

  it("returns a valid YAML frontmatter block (starts/ends with ---)", () => {
    const fm = buildFrontmatter(baseSmelt, "Phase-99");
    expect(fm.startsWith("---\n")).toBe(true);
    expect(fm).toContain("\n---\n");
  });
});

// ─── handleFinalize integration — frontmatter written to plan file ────

describe("handleFinalize frontmatter integration", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pforge-test-${randomUUID()}`);
    mkdirSync(join(projectDir, "docs", "plans"), { recursive: true });
    // Write a minimal PROJECT-PRINCIPLES.md so inferLane and related helpers don't crash
    writeFileSync(join(projectDir, "docs", "plans", "PROJECT-PRINCIPLES.md"), "# Principles\n", "utf-8");
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  function fullSmelt(overrides = {}) {
    // Submit a smelt with all critical fields answered so handleFinalize can proceed.
    const submitResult = handleSubmit({
      rawIdea: "Test feature for frontmatter gate",
      lane: "tweak",
      projectDir,
      ...overrides,
    });
    return submitResult;
  }

  it("phaseId is always present in the written plan file", () => {
    const { id } = fullSmelt();
    // Answer required critical fields for tweak lane (scope-file, validation, forbidden-actions)
    const { updateSmelt } = require_store();
    updateSmelt(id, {
      answers: [
        { questionId: "scope-file", answer: "src/foo.mjs", recordedAt: new Date().toISOString() },
        { questionId: "validation", answer: "npm test", recordedAt: new Date().toISOString() },
        { questionId: "forbidden-actions", answer: "do not touch prod", recordedAt: new Date().toISOString() },
      ],
    }, projectDir);

    const result = handleFinalize({ id, projectDir });
    const content = readFileSync(result.planPath, "utf-8");
    expect(content).toContain("phaseId:");
  });

  it("bugId stored at submit surfaces in plan frontmatter", () => {
    const { id } = fullSmelt({ bugId: "RMG-0035" });
    const { updateSmelt } = require_store();
    updateSmelt(id, {
      answers: [
        { questionId: "scope-file", answer: "src/foo.mjs", recordedAt: new Date().toISOString() },
        { questionId: "validation", answer: "npm test", recordedAt: new Date().toISOString() },
        { questionId: "forbidden-actions", answer: "do not touch prod", recordedAt: new Date().toISOString() },
      ],
    }, projectDir);

    const result = handleFinalize({ id, projectDir });
    const content = readFileSync(result.planPath, "utf-8");
    expect(content).toContain("bugId: RMG-0035");
    expect(content).toContain("linkedBugs: [RMG-0035]");
  });
});

// Helper: lazily import crucible-store to avoid top-level side-effects in test module
function require_store() {
  // Dynamic import not available synchronously; use a cached static import instead.
  // We need updateSmelt here for test setup — import it at top via a named binding.
  return _storeRef;
}

// Resolve the store at module init time via a static import.
import { updateSmelt as _updateSmelt } from "../crucible-store.mjs";
const _storeRef = { updateSmelt: _updateSmelt };
