/**
 * Issue #178 — orchestrator was stashing pre-slice WIP at slice start but
 * never popping it, silently capturing operator edits. These tests verify
 * the pushSliceSnapshot / popSliceSnapshot helpers are symmetric and that
 * popSliceSnapshot surfaces conflicts as a non-fatal warning.
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

import { execSync } from "node:child_process";
import { pushSliceSnapshot, popSliceSnapshot } from "../orchestrator.mjs";

describe("Issue #178 — pushSliceSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns pushed:false with reason 'clean-tree' when status is empty", () => {
    execSync.mockReturnValueOnce("");
    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });
    expect(result).toEqual({ pushed: false, stashRef: null, reason: "clean-tree" });
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync.mock.calls[0][0]).toBe("git status --porcelain");
  });

  it("returns pushed:false when status is whitespace-only", () => {
    execSync.mockReturnValueOnce("   \n  \n");
    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });
    expect(result.pushed).toBe(false);
    expect(result.reason).toBe("clean-tree");
  });

  it("calls `git stash push -m <ref>` and returns pushed:true when dirty", () => {
    execSync
      .mockReturnValueOnce(" M file.ts\n")  // git status --porcelain
      .mockReturnValueOnce("");                // git stash push

    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 4 });
    expect(result.pushed).toBe(true);
    expect(result.stashRef).toBe("pforge-slice-4-snapshot");
    expect(execSync).toHaveBeenCalledTimes(2);
    expect(execSync.mock.calls[1][0]).toContain(`git stash push -m "pforge-slice-4-snapshot"`);
  });

  it("returns pushed:false on git failure (not-a-repo)", () => {
    execSync.mockImplementationOnce(() => { throw new Error("not a git repository"); });
    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 1 });
    expect(result.pushed).toBe(false);
    expect(result.reason).toContain("not a git repository");
  });

  it("returns pushed:false when stash push itself fails", () => {
    execSync
      .mockReturnValueOnce(" M file.ts\n")
      .mockImplementationOnce(() => { throw new Error("stash refused"); });
    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 7 });
    expect(result.pushed).toBe(false);
    expect(result.reason).toContain("stash refused");
  });
});

describe("Issue #178 — popSliceSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns restored:true on success", () => {
    execSync.mockReturnValueOnce("");
    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });
    expect(result).toEqual({ restored: true });
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(execSync.mock.calls[0][0]).toBe("git stash pop");
  });

  it("returns restored:false + conflict:true when pop fails with merge conflict", () => {
    const err = new Error("CONFLICT (content): Merge conflict in src/a.ts");
    err.stderr = Buffer.from("CONFLICT (content): Merge conflict in src/a.ts");
    execSync.mockImplementationOnce(() => { throw err; });

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });
    expect(result.restored).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.error).toContain("CONFLICT");
  });

  it("returns restored:false + conflict:false when stash is empty (no stash to pop)", () => {
    const err = new Error("No stash entries found.");
    err.stderr = Buffer.from("No stash entries found.");
    execSync.mockImplementationOnce(() => { throw err; });

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });
    expect(result.restored).toBe(false);
    expect(result.conflict).toBe(false);
    expect(result.error).toContain("No stash");
  });

  it("never throws even when git is missing", () => {
    execSync.mockImplementationOnce(() => { throw new Error("git: command not found"); });
    expect(() => popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 1 })).not.toThrow();
  });
});

describe("Issue #178 — push/pop symmetry", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("push then pop is a no-op round-trip on the call sequence", () => {
    // Simulate: dirty pre-slice → push → worker runs → pop succeeds
    execSync
      .mockReturnValueOnce(" M scratch.ts\n")  // status
      .mockReturnValueOnce("")                   // stash push
      .mockReturnValueOnce("");                  // stash pop

    const push = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 9 });
    expect(push.pushed).toBe(true);

    const pop = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 9 });
    expect(pop.restored).toBe(true);

    expect(execSync).toHaveBeenCalledTimes(3);
    expect(execSync.mock.calls[0][0]).toBe("git status --porcelain");
    expect(execSync.mock.calls[1][0]).toContain("git stash push");
    expect(execSync.mock.calls[2][0]).toBe("git stash pop");
  });
});
