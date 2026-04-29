/**
 * Plan Forge — crucible-draft synthesizeSliceBlock tests (Phase-35 Slice 2).
 *
 * Covers:
 *   1. Full synthesis with package.json + scope-files + validation-gates
 *   2. Missing scope-files → returns null, renderDraft falls back to template
 *   3. Missing repoCommands (null buildCommand) → returns null
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { synthesizeSliceBlock, renderDraft } from "../crucible-draft.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pforge-synth-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeSmelt(overrides = {}) {
  return {
    rawIdea: "Add login flow",
    lane: "feature",
    source: "human",
    status: "in-progress",
    answers: [
      { questionId: "feature-name", answer: "Login Flow" },
      { questionId: "scope-files", answer: "src/auth.mjs, src/routes/login.mjs" },
      { questionId: "validation-gates", answer: "All tests pass\nLogin returns 200 with valid creds" },
    ],
    ...overrides,
  };
}

const npmRepoCommands = {
  buildCommand: "npm run build",
  testCommand: "npm test",
  manifestFile: "package.json",
  source: "package.json",
};

const noCommands = {
  buildCommand: null,
  testCommand: null,
  manifestFile: null,
  source: "none",
};

// ─── Case 1: full synthesis ────────────────────────────────────────────────────

describe("synthesizeSliceBlock — full synthesis", () => {
  it("produces a slice block with required sections when all inputs are present", () => {
    const smelt = makeSmelt();
    const result = synthesizeSliceBlock({ smelt, repoCommands: npmRepoCommands });

    expect(result).not.toBeNull();
    expect(result).toContain("### Slice 1 —");
    expect(result).toContain("Build command: npm run build");
    expect(result).toContain("Test command:  npm test");
    expect(result).toContain("**Files**:");
    expect(result).toContain("**Acceptance Criteria**:");
    expect(result).toMatch(/- \[ \]/);
  });

  it("includes the feature-name as the slice title (truncated to 60 chars)", () => {
    const longName = "A".repeat(80);
    const smelt = makeSmelt({
      answers: [
        { questionId: "feature-name", answer: longName },
        { questionId: "scope-files", answer: "src/foo.mjs" },
        { questionId: "validation-gates", answer: "tests pass" },
      ],
    });
    const result = synthesizeSliceBlock({ smelt, repoCommands: npmRepoCommands });
    expect(result).toContain(`### Slice 1 — ${"A".repeat(60)}`);
    expect(result).not.toContain("A".repeat(61));
  });

  it("falls back to rawIdea for title when feature-name is absent", () => {
    const smelt = makeSmelt({
      rawIdea: "My feature idea",
      answers: [
        { questionId: "scope-files", answer: "src/foo.mjs" },
        { questionId: "validation-gates", answer: "tests pass" },
      ],
    });
    const result = synthesizeSliceBlock({ smelt, repoCommands: npmRepoCommands });
    expect(result).toContain("### Slice 1 — My feature idea");
  });

  it("converts validation-gates lines to checkboxes", () => {
    const smelt = makeSmelt();
    const result = synthesizeSliceBlock({ smelt, repoCommands: npmRepoCommands });
    expect(result).toContain("- [ ] All tests pass");
    expect(result).toContain("- [ ] Login returns 200 with valid creds");
  });

  it("converts scope-files answer to bullet list in **Files** section", () => {
    const smelt = makeSmelt();
    const result = synthesizeSliceBlock({ smelt, repoCommands: npmRepoCommands });
    expect(result).toContain("- src/auth.mjs");
    expect(result).toContain("- src/routes/login.mjs");
  });
});

// ─── Case 2: missing scope-files ─────────────────────────────────────────────

describe("synthesizeSliceBlock — missing scope-files", () => {
  it("returns null when no scope-files / scope-in answer exists", () => {
    const smelt = makeSmelt({
      answers: [
        { questionId: "feature-name", answer: "Login Flow" },
        { questionId: "validation-gates", answer: "All tests pass" },
      ],
    });
    const result = synthesizeSliceBlock({ smelt, repoCommands: npmRepoCommands });
    expect(result).toBeNull();
  });

  it("renderDraft falls back to template comment and TBD marker when scope-files is missing", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = makeSmelt({
      answers: [
        { questionId: "feature-name", answer: "Login Flow" },
        { questionId: "validation-gates", answer: "All tests pass" },
      ],
    });
    const draft = renderDraft(smelt, { cwd: tmpDir });
    expect(draft).toContain("> Slice template:");
    expect(draft).toContain("{{TBD: scope-files}}");
  });
});

// ─── Case 3: missing repoCommands ────────────────────────────────────────────

describe("synthesizeSliceBlock — missing repoCommands", () => {
  it("returns null when buildCommand is null", () => {
    const smelt = makeSmelt();
    const result = synthesizeSliceBlock({ smelt, repoCommands: noCommands });
    expect(result).toBeNull();
  });

  it("returns null when testCommand is null", () => {
    const smelt = makeSmelt();
    const result = synthesizeSliceBlock({
      smelt,
      repoCommands: { buildCommand: "npm run build", testCommand: null, manifestFile: "package.json", source: "package.json" },
    });
    expect(result).toBeNull();
  });

  it("returns null when repoCommands itself is null", () => {
    const smelt = makeSmelt();
    const result = synthesizeSliceBlock({ smelt, repoCommands: null });
    expect(result).toBeNull();
  });
});

// ─── renderDraft with cwd — integration ──────────────────────────────────────

describe("renderDraft — synthesis integration", () => {
  it("substitutes synthesized block when cwd has package.json + full answers", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run" } })
    );
    const smelt = makeSmelt();
    const draft = renderDraft(smelt, { cwd: tmpDir });

    expect(draft).toContain("### Slice 1 —");
    expect(draft).toContain("Build command: npm run build");
    expect(draft).toContain("Test command:  npm test");
    expect(draft).toContain("- [ ] All tests pass");
    expect(draft).not.toContain("> Slice template:");
  });

  it("falls back to template when cwd has no manifest (no-manifest dir)", () => {
    const smelt = makeSmelt();
    const draft = renderDraft(smelt, { cwd: tmpDir });
    expect(draft).toContain("> Slice template:");
  });

  it("is backward-compatible when no options are passed", () => {
    const smelt = makeSmelt();
    const draft = renderDraft(smelt);
    expect(draft).toContain("> Slice template:");
  });
});
