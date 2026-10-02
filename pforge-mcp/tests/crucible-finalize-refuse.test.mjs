/**
 * Plan Forge — crucible-server handleFinalize refuse-on-gaps tests (Phase-35 Slice 3).
 *
 * Covers:
 *   1. Smelt with all critical fields answered + package.json → finalize succeeds,
 *      returned object includes inferred.buildCommand === "npm run build".
 *   2. Smelt missing validation-gates → throws CrucibleFinalizeRefusedError with
 *      criticalGaps containing "validation-gates". No plan file is written.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSmelt, updateSmelt, loadSmelt } from "../crucible-store.mjs";
import { handleFinalize, CrucibleFinalizeRefusedError } from "../crucible-server.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pforge-finalize-refuse-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function now() {
  return new Date().toISOString();
}

/**
 * Create and persist a smelt with all critical fields answered.
 */
function makeCompleteSmelt(dir) {
  const smelt = createSmelt({
    lane: "feature",
    rawIdea: "Add login flow",
    projectDir: dir,
  });
  return updateSmelt(smelt.id, {
    answers: [
      { questionId: "scope-files", answer: "src/auth.mjs, src/routes/login.mjs", recordedAt: now() },
      { questionId: "validation-gates", answer: "All tests pass\nLogin returns 200", recordedAt: now() },
      { questionId: "forbidden-actions", answer: "Do not change schema", recordedAt: now() },
    ],
  }, dir);
}

/**
 * Create and persist a smelt missing validation-gates.
 */
function makeSmeltMissingValidation(dir) {
  const smelt = createSmelt({
    lane: "feature",
    rawIdea: "Add login flow",
    projectDir: dir,
  });
  return updateSmelt(smelt.id, {
    answers: [
      { questionId: "scope-files", answer: "src/auth.mjs", recordedAt: now() },
      { questionId: "forbidden-actions", answer: "Do not change schema", recordedAt: now() },
      // validation-gates intentionally omitted
    ],
  }, dir);
}

// ─── Success: all critical fields present ─────────────────────────────────────

describe("handleFinalize — success when all critical fields are answered", () => {
  it("returns phaseName and inferred.buildCommand from package.json", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = makeCompleteSmelt(tmpDir);

    const result = handleFinalize({ id: smelt.id, projectDir: tmpDir });

    expect(result.phaseName).toBeTruthy();
    expect(result.inferred).toBeDefined();
    expect(result.inferred.buildCommand).toBe("npm run build");
    expect(result.inferred.testCommand).toBe("npm test");
  });

  it("writes a plan file to docs/plans/", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = makeCompleteSmelt(tmpDir);

    const result = handleFinalize({ id: smelt.id, projectDir: tmpDir });

    expect(existsSync(result.planPath)).toBe(true);
  });

  it("returns unresolvedFields as an array (non-critical TBDs only)", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = makeCompleteSmelt(tmpDir);

    const result = handleFinalize({ id: smelt.id, projectDir: tmpDir });

    expect(Array.isArray(result.unresolvedFields)).toBe(true);
    // Critical fields should not appear in unresolvedFields
    const criticals = ["scope-in", "scope-files", "validation-gates", "validation", "forbidden-actions"];
    for (const f of result.unresolvedFields) {
      expect(criticals).not.toContain(f);
    }
  });

  it("includes hardenerHandoff in the return value", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = makeCompleteSmelt(tmpDir);

    const result = handleFinalize({ id: smelt.id, projectDir: tmpDir });

    expect(result.hardenerHandoff).toBeDefined();
    expect(result.hardenerHandoff.nextStep).toBe("step2-harden-plan.prompt.md");
  });
});

// ─── Refusal: missing validation-gates ────────────────────────────────────────

describe("handleFinalize — refuses when validation-gates is missing", () => {
  it("throws CrucibleFinalizeRefusedError", () => {
    const smelt = makeSmeltMissingValidation(tmpDir);

    expect(() => handleFinalize({ id: smelt.id, projectDir: tmpDir }))
      .toThrow(CrucibleFinalizeRefusedError);
  });

  it("includes validation-gates in criticalGaps", () => {
    const smelt = makeSmeltMissingValidation(tmpDir);

    let caught;
    try {
      handleFinalize({ id: smelt.id, projectDir: tmpDir });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CrucibleFinalizeRefusedError);
    expect(caught.payload.criticalGaps).toContain("validation-gates");
    expect(caught.payload.id).toBe(smelt.id);
    expect(typeof caught.payload.hint).toBe("string");
  });

  it("does not write any plan file under docs/plans/", () => {
    const smelt = makeSmeltMissingValidation(tmpDir);

    try {
      handleFinalize({ id: smelt.id, projectDir: tmpDir });
    } catch { /* expected */ }

    const plansDir = join(tmpDir, "docs", "plans");
    if (existsSync(plansDir)) {
      const mdFiles = readdirSync(plansDir).filter((f) => f.endsWith(".md"));
      expect(mdFiles).toHaveLength(0);
    } else {
      // docs/plans/ was never created — that's also acceptable
      expect(existsSync(plansDir)).toBe(false);
    }
  });

  it("leaves smelt status as in-progress after refusal", () => {
    const smelt = makeSmeltMissingValidation(tmpDir);

    try {
      handleFinalize({ id: smelt.id, projectDir: tmpDir });
    } catch { /* expected */ }

    const reloaded = loadSmelt(smelt.id, tmpDir);
    expect(reloaded.status).toBe("in-progress");
  });
});

// ─── Refusal: scope-files missing ─────────────────────────────────────────────

describe("handleFinalize — refuses when scope-files is missing", () => {
  it("throws CrucibleFinalizeRefusedError with scope-files in criticalGaps", () => {
    const smelt = createSmelt({
      lane: "feature",
      rawIdea: "Add login flow",
      projectDir: tmpDir,
    });
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "validation-gates", answer: "All tests pass", recordedAt: now() },
        { questionId: "forbidden-actions", answer: "No schema changes", recordedAt: now() },
        // scope-files intentionally omitted
      ],
    }, tmpDir);

    let caught;
    try {
      handleFinalize({ id: smelt.id, projectDir: tmpDir });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CrucibleFinalizeRefusedError);
    expect(caught.payload.criticalGaps).toContain("scope-files");
  });
});
