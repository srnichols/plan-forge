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
  execFileSync: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
  })),
}));

import { execSync, execFileSync } from "node:child_process";
import { autoCommitSliceIfDirty, parseGitPorcelain, snapshotPreSliceState } from "../orchestrator.mjs";

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
      .mockReturnValueOnce(FAKE_SHA + "\n");// git rev-parse HEAD

    const slice = { number: 3, title: "Bug #123 auto-commit determinism" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto" });

    expect(result.committed).toBe(true);
    expect(result.sha).toBe(FAKE_SHA);
    // Title begins with "Bug" → conventionalType should be "fix"
    expect(result.message).toBe("fix(slice-3): auto-commit determinism");
    // Issue #162: commit must go through execFileSync (not execSync) so shell
    // never sees the raw title string — prevents breakage on ", ', `, $()
    expect(execFileSync).toHaveBeenCalledWith(
      "git", ["commit", "-m", "fix(slice-3): auto-commit determinism"],
      expect.any(Object),
    );
  });

  it("(C2) uses 'feat' for titles that don't start with Bug/Fix", () => {
    execSync
      .mockReturnValueOnce("?? new-file.ts\n")
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
      .mockReturnValueOnce(undefined); // git add -A succeeds
    execFileSync.mockImplementationOnce(() => { throw new Error("nothing to commit"); }); // git commit fails

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

// ─── Issue #151: pre-slice snapshot prevents foreign-file bleed ─────────────

describe("autoCommitSliceIfDirty — Issue #151 pre-slice snapshot", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("parseGitPorcelain produces a path→line map that distinguishes status changes", () => {
    const out = " M src/a.ts\n?? scratch.md\nMM lib/b.ts\n";
    const map = parseGitPorcelain(out);
    expect(map.size).toBe(3);
    expect(map.get("src/a.ts")).toBe(" M src/a.ts");
    expect(map.get("scratch.md")).toBe("?? scratch.md");
    expect(map.get("lib/b.ts")).toBe("MM lib/b.ts");
  });

  it("parseGitPorcelain handles renames (tracks new path)", () => {
    const out = "R  old.ts -> new.ts\n";
    const map = parseGitPorcelain(out);
    expect(map.has("new.ts")).toBe(true);
    expect(map.has("old.ts")).toBe(false);
  });

  it("snapshotPreSliceState returns null on git failure (legacy fallback)", () => {
    execSync.mockImplementationOnce(() => { throw new Error("not a repo"); });
    const result = snapshotPreSliceState({ cwd: "/fake/cwd" });
    expect(result).toBeNull();
  });

  it("snapshotPreSliceState returns parsed Map on success", () => {
    execSync.mockReturnValueOnce(" M file.ts\n?? other.md\n");
    const result = snapshotPreSliceState({ cwd: "/fake/cwd" });
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("file.ts")).toBe(" M file.ts");
  });

  it("(151-A) only stages worker-touched paths, leaves operator dirt alone", () => {
    // Pre-slice: operator already had foreign.md and scratch.ts dirty
    const preSliceState = parseGitPorcelain("?? foreign.md\n M scratch.ts\n");

    // Post-slice: operator dirt still there + worker created worker-new.ts
    execSync
      .mockReturnValueOnce("?? foreign.md\n M scratch.ts\n?? worker-new.ts\n") // git status --porcelain
      // git add -- <paths> now goes through execFileSync (returns undefined by default)
      .mockReturnValueOnce(FAKE_SHA + "\n");                                     // git rev-parse HEAD

    const eventBus = { emit: vi.fn() };
    const slice = { number: 5, title: "Add new worker file" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake/cwd", mode: "auto", eventBus, preSliceState,
    });

    expect(result.committed).toBe(true);
    expect(result.foreignFiles).toEqual(["foreign.md", "scratch.ts"]);

    // git add must target worker-new.ts only (NOT foreign.md or scratch.ts)
    const addCall = execFileSync.mock.calls.find(
      (c) => c[0] === "git" && c[1]?.[0] === "add"
    );
    expect(addCall).toBeDefined();
    const addedPaths = addCall[1].slice(2); // skip ["add", "--"]
    expect(addedPaths).toContain("worker-new.ts");
    expect(addedPaths).not.toContain("foreign.md");
    expect(addedPaths).not.toContain("scratch.ts");

    // Foreign-files event fired
    expect(eventBus.emit).toHaveBeenCalledWith(
      "slice-foreign-files-detected",
      expect.objectContaining({ sliceNumber: 5, foreignFiles: ["foreign.md", "scratch.ts"] }),
    );
  });

  it("(151-B) treats a status-line change as a worker touch", () => {
    // file.ts was " M" (modified, not staged) — worker further modifies it to "MM" (staged + new mods)
    const preSliceState = parseGitPorcelain(" M file.ts\n");

    execSync
      .mockReturnValueOnce("MM file.ts\n")
      // git add -- now goes through execFileSync
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const slice = { number: 2, title: "tweak file" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake/cwd", mode: "auto", preSliceState,
    });

    expect(result.committed).toBe(true);
    expect(result.foreignFiles).toBeUndefined();
    const addCall = execFileSync.mock.calls.find(
      (c) => c[0] === "git" && c[1]?.[0] === "add"
    );
    expect(addCall).toBeDefined();
    expect(addCall[1].slice(2)).toContain("file.ts");
  });

  it("(151-C) returns no-worker-changes when only foreign files are dirty", () => {
    // Pre-slice = post-slice (worker did nothing on disk)
    const preSliceState = parseGitPorcelain("?? operator-scratch.md\n");

    execSync.mockReturnValueOnce("?? operator-scratch.md\n");

    const eventBus = { emit: vi.fn() };
    const slice = { number: 1, title: "noop slice" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake/cwd", mode: "auto", eventBus, preSliceState,
    });

    expect(result).toMatchObject({
      committed: false,
      reason: "no-worker-changes",
      foreignFiles: ["operator-scratch.md"],
    });
    // No git add / commit attempted
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(eventBus.emit).toHaveBeenCalledWith(
      "slice-foreign-files-detected",
      expect.objectContaining({ foreignFiles: ["operator-scratch.md"] }),
    );
  });

  it("(151-D) falls back to git add -A when no preSliceState provided (back-compat)", () => {
    execSync
      .mockReturnValueOnce(" M legacy.ts\n")
      .mockReturnValueOnce(undefined) // git add -A
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const slice = { number: 1, title: "feat: legacy" };
    const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto" });

    expect(result.committed).toBe(true);
    expect(execSync.mock.calls[1][0]).toBe("git add -A");
  });

  it("(151-E) chunks large worker-path lists across multiple git add calls", () => {
    // 75 worker paths → expect 2 git add calls (50 + 25) + commit + rev-parse
    const preSliceState = new Map();
    const lines = Array.from({ length: 75 }, (_, i) => `?? new-${i}.ts`);
    execSync
      .mockReturnValueOnce(lines.join("\n") + "\n")
      // git add calls now go through execFileSync (returns undefined by default)
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const slice = { number: 9, title: "big slice" };
    autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto", preSliceState });

    const addCalls = execFileSync.mock.calls.filter(
      (c) => c[0] === "git" && c[1]?.[0] === "add"
    );
    expect(addCalls.length).toBe(2);
  });
});

// ─── Issue #162: auto-commit uses execFileSync — shell-safe for all title chars ─

describe("autoCommitSliceIfDirty — Issue #162 shell-safe commit", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const TITLES_WITH_SPECIAL_CHARS = [
    ["double-quote", 'Add "Discovery Harness" section'],
    ["single-quote", "Fix worker's probe timeout"],
    ["backtick",     "Add `forge_run_plan` handler"],
    ["shell-subst",  "Expand $(cat version.txt) output"],
  ];

  for (const [label, title] of TITLES_WITH_SPECIAL_CHARS) {
    it(`(162-${label}) commits cleanly when title contains ${label} characters`, () => {
      execSync
        .mockReturnValueOnce(" M file.ts\n")
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(FAKE_SHA + "\n");

      const slice = { number: 4, title };
      const result = autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto" });

      expect(result.committed).toBe(true);
      expect(result.sha).toBe(FAKE_SHA);

      // Commit MUST use execFileSync with array args — never execSync with a
      // shell-interpolated string — so the shell never sees the raw title.
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", expect.stringContaining("(slice-4):")],
        expect.any(Object),
      );

      // The raw title characters must NOT appear in any execSync call
      // (which would indicate a shell-interpolated command string).
      const execSyncMessages = execSync.mock.calls.map((c) => c[0]);
      for (const call of execSyncMessages) {
        expect(call).not.toContain(title);
      }
    });
  }

  it("(162-execFileSync-args) passes exact title string as a single array element", () => {
    execSync
      .mockReturnValueOnce(" M x.ts\n")
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(FAKE_SHA + "\n");

    const title = 'Add "Quorum Quality Examples" sub-section';
    const slice = { number: 6, title };
    autoCommitSliceIfDirty({ slice, cwd: "/fake/cwd", mode: "auto" });

    const [cmd, args] = execFileSync.mock.calls[0];
    expect(cmd).toBe("git");
    expect(args[0]).toBe("commit");
    expect(args[1]).toBe("-m");
    // The message should include the title (potentially truncated) as one string,
    // with no shell-breaking quotes injected around it.
    expect(args[2]).toContain("Quorum Quality Examples");
    expect(args.length).toBe(3);
  });
});
