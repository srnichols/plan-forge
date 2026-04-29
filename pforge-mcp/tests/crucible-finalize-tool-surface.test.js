/**
 * Plan Forge — forge_crucible_finalize tool surface tests (Phase-35 Slice 4).
 *
 * Verifies that the MCP tool handler maps CrucibleFinalizeRefusedError to a
 * structured { ok, refused, criticalGaps, hint } response instead of a raw error,
 * and that a successful finalize still returns ok/phaseName/planPath.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createSmelt, updateSmelt } from "../crucible-store.mjs";
import { handleFinalize, CrucibleFinalizeRefusedError } from "../crucible-server.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pforge-tool-surface-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function now() {
  return new Date().toISOString();
}

/**
 * Simulate the forge_crucible_finalize MCP handler's try/catch mapping.
 * This mirrors server.mjs: handleFinalize → structured response on refusal.
 */
function simulateToolHandler(args, projectDir) {
  try {
    const result = handleFinalize({ id: args.id, projectDir });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof CrucibleFinalizeRefusedError) {
      const payload = { ok: false, refused: true, criticalGaps: err.payload.criticalGaps, hint: err.payload.hint };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
    return { content: [{ type: "text", text: `Crucible finalize error: ${err.message}` }], isError: true };
  }
}

// ─── Refusal shape ────────────────────────────────────────────────────────────

describe("forge_crucible_finalize tool surface — refusal shape", () => {
  it("returns { ok: false, refused: true, criticalGaps, hint } when validation-gates is missing", () => {
    const smelt = createSmelt({ lane: "feature", rawIdea: "Login feature", projectDir: tmpDir });
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "scope-files", answer: "src/auth.mjs", recordedAt: now() },
        { questionId: "forbidden-actions", answer: "Do not drop tables", recordedAt: now() },
        // validation-gates intentionally omitted → critical gap
      ],
    }, tmpDir);

    const response = simulateToolHandler({ id: smelt.id }, tmpDir);
    expect(response.isError).toBeUndefined();

    const payload = JSON.parse(response.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.refused).toBe(true);
    expect(Array.isArray(payload.criticalGaps)).toBe(true);
    expect(payload.criticalGaps).toContain("validation-gates");
    expect(typeof payload.hint).toBe("string");
    expect(payload.hint.length).toBeGreaterThan(0);
  });

  it("returns { ok: false, refused: true, criticalGaps } containing scope-files when absent", () => {
    const smelt = createSmelt({ lane: "feature", rawIdea: "Dashboard", projectDir: tmpDir });
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "validation-gates", answer: "All tests pass", recordedAt: now() },
        { questionId: "forbidden-actions", answer: "Do not rename exports", recordedAt: now() },
        // scope-files intentionally omitted
      ],
    }, tmpDir);

    const response = simulateToolHandler({ id: smelt.id }, tmpDir);
    const payload = JSON.parse(response.content[0].text);

    expect(payload.ok).toBe(false);
    expect(payload.refused).toBe(true);
    const hasScope = payload.criticalGaps.includes("scope-files") || payload.criticalGaps.includes("scope-in");
    expect(hasScope).toBe(true);
  });

  it("does not set isError on the response when refusing (structured, not raw error)", () => {
    const smelt = createSmelt({ lane: "feature", rawIdea: "Export CSV", projectDir: tmpDir });
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "scope-files", answer: "src/export.mjs", recordedAt: now() },
        // validation-gates and forbidden-actions omitted
      ],
    }, tmpDir);

    const response = simulateToolHandler({ id: smelt.id }, tmpDir);
    expect(response.isError).toBeUndefined();
  });
});

// ─── Success shape ────────────────────────────────────────────────────────────

describe("forge_crucible_finalize tool surface — success shape", () => {
  it("returns phaseName and planPath on success with all critical fields + package.json", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = createSmelt({ lane: "feature", rawIdea: "Login flow", projectDir: tmpDir });
    updateSmelt(smelt.id, {
      answers: [
        { questionId: "scope-files", answer: "src/auth.mjs, src/routes/login.mjs", recordedAt: now() },
        { questionId: "validation-gates", answer: "All tests pass\nLogin returns 200", recordedAt: now() },
        { questionId: "forbidden-actions", answer: "Do not change schema", recordedAt: now() },
      ],
    }, tmpDir);

    const response = simulateToolHandler({ id: smelt.id }, tmpDir);
    expect(response.isError).toBeUndefined();

    const result = JSON.parse(response.content[0].text);
    expect(result.phaseName).toBeTruthy();
    expect(result.planPath).toBeTruthy();
    expect(result.inferred).toBeDefined();
    expect(result.inferred.buildCommand).toBe("npm run build");
  });
});
