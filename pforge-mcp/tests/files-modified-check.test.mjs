/**
 * Plan Forge — Issue #152: Files Modified (Exhaustive) verification
 *
 * Verifies extractFilesModifiedExhaustive parses the table out of a slice's
 * rawLines, and verifyFilesModified flags missing entries against the
 * working-tree diff without throwing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import {
  extractFilesModifiedExhaustive,
  verifyFilesModified,
} from "../orchestrator.mjs";

describe("extractFilesModifiedExhaustive — Issue #152 parser", () => {
  it("parses a standard backtick-wrapped table under **Files Modified (Exhaustive)**", () => {
    const slice = {
      rawLines: [
        "**Files Modified (Exhaustive)**:",
        "",
        "| File | Change |",
        "|------|--------|",
        "| `TimeTracker.slnx` | Add Web project references |",
        "| `README.md` | Add quick-start line |",
        "| `docs/plans/DEPLOYMENT-ROADMAP.md` | Mark Phase 6 status |",
        "",
        "**Validation Gate**:",
      ],
    };
    const result = extractFilesModifiedExhaustive(slice);
    expect(result).toEqual([
      "TimeTracker.slnx",
      "README.md",
      "docs/plans/DEPLOYMENT-ROADMAP.md",
    ]);
  });

  it("accepts the unadorned 'Files Modified' header (no Exhaustive suffix)", () => {
    const slice = {
      rawLines: [
        "**Files Modified**:",
        "| File | Change |",
        "|------|--------|",
        "| `src/foo.ts` | edit |",
      ],
    };
    expect(extractFilesModifiedExhaustive(slice)).toEqual(["src/foo.ts"]);
  });

  it("accepts bare path tokens when backticks are absent", () => {
    const slice = {
      rawLines: [
        "**Files Modified**",
        "| File | Change |",
        "|------|--------|",
        "| src/a.ts | edit |",
        "| docs/b.md | new |",
      ],
    };
    expect(extractFilesModifiedExhaustive(slice)).toEqual(["src/a.ts", "docs/b.md"]);
  });

  it("returns [] when the slice has no Files Modified table", () => {
    const slice = {
      rawLines: [
        "**Validation Gate**:",
        "```bash",
        "npm test",
        "```",
      ],
    };
    expect(extractFilesModifiedExhaustive(slice)).toEqual([]);
  });

  it("returns [] for an empty / missing rawLines", () => {
    expect(extractFilesModifiedExhaustive({})).toEqual([]);
    expect(extractFilesModifiedExhaustive({ rawLines: [] })).toEqual([]);
    expect(extractFilesModifiedExhaustive(null)).toEqual([]);
  });

  it("stops at the next bold section heading", () => {
    const slice = {
      rawLines: [
        "**Files Modified (Exhaustive)**:",
        "| File | Change |",
        "|------|--------|",
        "| `a.ts` | one |",
        "**Validation Gate**:",
        "| `should-not-be-included.ts` | nope |",
      ],
    };
    expect(extractFilesModifiedExhaustive(slice)).toEqual(["a.ts"]);
  });

  it("does not include the header row 'File' as a path", () => {
    const slice = {
      rawLines: [
        "**Files Modified**:",
        "| File | Change |",
        "|------|--------|",
        "| `x.ts` | edit |",
      ],
    };
    const result = extractFilesModifiedExhaustive(slice);
    expect(result).not.toContain("File");
    expect(result).toEqual(["x.ts"]);
  });
});

describe("verifyFilesModified — Issue #152 verifier", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns enforced:false when the slice declares no table", () => {
    const slice = { number: 1, title: "noop", rawLines: ["just prose"] };
    const result = verifyFilesModified({ slice, cwd: "/fake/cwd", startSha: "abc" });
    expect(result).toEqual({ enforced: false, declared: [], actual: [], missing: [] });
    expect(execSync).not.toHaveBeenCalled();
  });

  it("flags declared paths missing from both diff and porcelain", () => {
    const slice = {
      number: 7,
      title: "Slice 7",
      rawLines: [
        "**Files Modified (Exhaustive)**:",
        "| File | Change |",
        "|------|--------|",
        "| `TimeTracker.slnx` | add Web |",
        "| `tests/TimeTracker.Web.Tests/TimeTracker.Web.Tests.csproj` | new project |",
      ],
    };

    execFileSync.mockReturnValueOnce("TimeTracker.slnx\n");  // git diff --name-only <sha> HEAD (execFileSync)
    execSync.mockReturnValueOnce("");                         // git status --porcelain (clean)

    const result = verifyFilesModified({ slice, cwd: "/fake/cwd", startSha: "abc123" });

    expect(result.enforced).toBe(true);
    expect(result.declared).toHaveLength(2);
    expect(result.actual).toEqual(["TimeTracker.slnx"]);
    expect(result.missing).toEqual([
      "tests/TimeTracker.Web.Tests/TimeTracker.Web.Tests.csproj",
    ]);
  });

  it("counts uncommitted (porcelain) edits as actual", () => {
    const slice = {
      number: 2,
      title: "Slice 2",
      rawLines: [
        "**Files Modified**:",
        "| File | Change |",
        "|------|--------|",
        "| `pending.ts` | uncommitted edit |",
      ],
    };

    execFileSync.mockReturnValueOnce("");             // diff: nothing committed (execFileSync)
    execSync.mockReturnValueOnce(" M pending.ts\n"); // porcelain: dirty

    const result = verifyFilesModified({ slice, cwd: "/fake/cwd", startSha: "abc" });
    expect(result.missing).toEqual([]);
  });

  it("normalises backslash declarations against forward-slash git output", () => {
    const slice = {
      number: 3,
      title: "Slice 3",
      rawLines: [
        "**Files Modified**:",
        "| File | Change |",
        "|------|--------|",
        "| `docs\\plans\\WIN.md` | windows-style declaration |",
      ],
    };

    execFileSync.mockReturnValueOnce("docs/plans/WIN.md\n");
    execSync.mockReturnValueOnce("");

    const result = verifyFilesModified({ slice, cwd: "/fake/cwd", startSha: "abc" });
    expect(result.missing).toEqual([]);
  });

  it("never throws when git fails (returns possibly-incomplete actual)", () => {
    const slice = {
      number: 4,
      title: "Slice 4",
      rawLines: [
        "**Files Modified**:",
        "| File | Change |",
        "|------|--------|",
        "| `x.ts` | edit |",
      ],
    };

    execSync.mockImplementation(() => { throw new Error("git unavailable"); });
    execFileSync.mockImplementation(() => { throw new Error("git unavailable"); });

    const result = verifyFilesModified({ slice, cwd: "/fake/cwd", startSha: "abc" });
    expect(result.enforced).toBe(true);
    expect(result.declared).toEqual(["x.ts"]);
    expect(result.actual).toEqual([]);
    expect(result.missing).toEqual(["x.ts"]);
  });

  it("works without startSha (skip diff, use porcelain only)", () => {
    const slice = {
      number: 5,
      title: "Slice 5",
      rawLines: [
        "**Files Modified**:",
        "| File | Change |",
        "|------|--------|",
        "| `pending.ts` | uncommitted |",
      ],
    };

    execSync.mockReturnValueOnce(" M pending.ts\n");

    const result = verifyFilesModified({ slice, cwd: "/fake/cwd", startSha: null });
    expect(result.missing).toEqual([]);
    // Only one execSync — porcelain — because startSha was null
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync.mock.calls[0][0]).toContain("git status --porcelain");
  });
});
