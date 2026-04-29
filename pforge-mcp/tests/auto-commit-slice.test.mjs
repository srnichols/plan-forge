/**
 * Plan Forge — Phase-33.3 Slice 3: Bug #123 auto-commit determinism
 *
 * Verifies autoCommitSliceIfDirty covers all three branches:
 *   Branch A: mode === "assisted" → returns { committed: false, reason: "assisted-mode" }, no execSync calls.
 *   Branch B: git status --porcelain returns empty → returns { committed: false, reason: "clean-tree" }.
 *   Branch C: git status --porcelain returns dirty output, git commit succeeds
 *             → returns { committed: true, sha, message } with correct conventional-commit form.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock child_process BEFORE importing orchestrator ────────────────────────

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
  })),
}));

import { execSync } from "node:child_process";
import { autoCommitSliceIfDirty } from "../orchestrator.mjs";

const FAKE_SHA = "abc1234def5678";

describe("autoCommitSliceIfDirty — Bug #123 auto-commit determinism", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Branch A: assisted mode ─────────────────────────────────────────────

  it("(A) returns assisted-mode skip when mode === 'assisted', makes no execSync calls", () => {
    const slice = { number: 3, title: "Bug #123 auto-commit determinism" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "assisted" });

    expect(result).toEqual({ committed: false, reason: "assisted-mode" });
    expect(execSync).not.toHaveBeenCalled();
  });

  // ─── Branch B: clean working tree ────────────────────────────────────────

  it("(B) returns clean-tree skip when git status --porcelain is empty", () => {
    execSync.mockReturnValueOnce(""); // git status --porcelain → empty

    const slice = { number: 3, title: "feat: add something" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto" });

    expect(result).toEqual({ committed: false, reason: "clean-tree" });
    // Only git status should have been called
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync.mock.calls[0][0]).toContain("git status --porcelain");
  });

  it("(B2) returns clean-tree skip when git status --porcelain is whitespace-only", () => {
    execSync.mockReturnValueOnce("   \n");

    const slice = { number: 3, title: "feat: add something" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd" });

    expect(result).toEqual({ committed: false, reason: "clean-tree" });
  });

  // ─── Branch C: dirty tree — commit succeeds ──────────────────────────────

  it("(C) commits when tree is dirty and returns { committed: true, sha, message }", () => {
    execSync
      .mockReturnValueOnce(" M file.ts\n") // git status --porcelain → dirty
      .mockReturnValueOnce(undefined)       // git add -A
      .mockReturnValueOnce(undefined)       // git commit -m "..."
      .mockReturnValueOnce(FAKE_SHA + "\n");// git rev-parse HEAD

    const slice = { number: 3, title: "Bug #123 auto-commit determinism" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto" });

    expect(result.committed).toBe(true);
    expect(result.sha).toBe(FAKE_SHA);
    // Title begins with "Bug" → conventionalType should be "fix"
    expect(result.message).toBe("fix(slice-3): auto-commit determinism");
  });

  it("(C2) uses 'feat' for titles that don't start with Bug/Fix", () => {
    execSync
      .mockReturnValueOnce("?? new-file.ts\n")
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const slice = { number: 5, title: "Add dashboard tile for quorum stats" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd" });

    expect(result.committed).toBe(true);
    expect(result.message).toBe("feat(slice-5): Add dashboard tile for quorum stats");
  });

  it("(C3) uses 'fix' for titles starting with 'Fix'", () => {
    execSync
      .mockReturnValueOnce(" M thing.ts\n")
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const slice = { number: 7, title: "Fix null reference in orchestrator" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd" });

    expect(result.committed).toBe(true);
    expect(result.message).toBe("fix(slice-7): Fix null reference in orchestrator");
  });

  it("(C4) emits slice-auto-committed event on successful commit", () => {
    execSync
      .mockReturnValueOnce(" M x.ts\n")
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const eventBus = { emit: vi.fn() };
    const slice = { number: 3, title: "Bug #123 auto-commit determinism" };
    autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", eventBus });

    expect(eventBus.emit).toHaveBeenCalledWith(
      "slice-auto-committed",
      expect.objectContaining({ sliceNumber: 3, sha: FAKE_SHA }),
    );
  });

  it("(C5) emits slice-dirty-tree-warning on git commit failure", () => {
    execSync
      .mockReturnValueOnce(" M x.ts\n")
      .mockReturnValueOnce(undefined) // git add -A succeeds
      .mockImplementationOnce(() => { throw new Error("nothing to commit"); }); // git commit fails

    const eventBus = { emit: vi.fn() };
    const slice = { number: 3, title: "feat: something" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", eventBus });

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("git-failed");
    expect(eventBus.emit).toHaveBeenCalledWith(
      "slice-dirty-tree-warning",
      expect.objectContaining({ sliceNumber: 3 }),
    );
  });
});
