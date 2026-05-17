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
import { pushSliceSnapshot, popSliceSnapshot, cleanupStaleSnapshots } from "../orchestrator.mjs";

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

  it("#202 — calls `git stash push -u -m <ref>` and returns pushed:true when dirty", () => {
    execSync
      .mockReturnValueOnce(" M file.ts\n")  // git status --porcelain
      .mockReturnValueOnce("");                // git stash push -u

    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 4 });
    expect(result.pushed).toBe(true);
    expect(result.stashRef).toBe("pforge-slice-4-snapshot");
    expect(execSync).toHaveBeenCalledTimes(2);
    // #202: must include -u so untracked-only working trees still get stashed.
    expect(execSync.mock.calls[1][0]).toBe(`git stash push -u -m "pforge-slice-4-snapshot"`);
  });

  it("#202 — captures untracked-only working tree (passes -u to git stash)", () => {
    // `git status --porcelain` shows untracked files with `??`. Without `-u`,
    // `git stash push` would no-op and the caller would never know — pop
    // would later report "snapshot stash not found".
    execSync
      .mockReturnValueOnce("?? new-file.ts\n?? .forge/runtime.log\n")  // untracked-only
      .mockReturnValueOnce("");

    const result = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 6 });
    expect(result.pushed).toBe(true);
    expect(result.stashRef).toBe("pforge-slice-6-snapshot");
    // Critical assertion: the -u flag must be present.
    expect(execSync.mock.calls[1][0]).toMatch(/^git stash push -u\b/);
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

describe("Issue #178 / #201 — popSliceSnapshot (apply-then-drop)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // Helper: simulate a `git stash list` line for slice N at index I.
  const listLine = (idx, slice) => `stash@{${idx}}: On master: pforge-slice-${slice}-snapshot`;

  it("returns restored:true and uses apply-then-drop on success", () => {
    execSync
      .mockReturnValueOnce(listLine(0, 3))  // git stash list
      .mockReturnValueOnce("")               // git stash apply stash@{0}
      .mockReturnValueOnce("");              // git stash drop stash@{0}

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });

    expect(result.restored).toBe(true);
    expect(result.stashRef).toBe("stash@{0}");
    expect(execSync).toHaveBeenCalledTimes(3);
    expect(execSync.mock.calls[0][0]).toBe("git stash list");
    expect(execSync.mock.calls[1][0]).toBe("git stash apply stash@{0}");
    expect(execSync.mock.calls[2][0]).toBe("git stash drop stash@{0}");
  });

  it("finds the right stash by message even when not at top of stack", () => {
    // Top of stack is an unrelated operator stash; ours is at index 2.
    const list = [
      "stash@{0}: WIP on master: scratch work",
      "stash@{1}: On feature: pforge-slice-99-snapshot",  // wrong slice
      "stash@{2}: On master: pforge-slice-3-snapshot",
    ].join("\n");
    execSync
      .mockReturnValueOnce(list)
      .mockReturnValueOnce("")
      .mockReturnValueOnce("");

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });

    expect(result.restored).toBe(true);
    expect(result.stashRef).toBe("stash@{2}");
    expect(execSync.mock.calls[1][0]).toBe("git stash apply stash@{2}");
    expect(execSync.mock.calls[2][0]).toBe("git stash drop stash@{2}");
  });

  it("returns restored:false when no matching stash exists (push reported clean-tree)", () => {
    execSync.mockReturnValueOnce("stash@{0}: WIP on master: unrelated\n");
    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 4 });
    expect(result.restored).toBe(false);
    expect(result.error).toContain("not found");
    // Must not attempt apply or drop.
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it("Issue #201 — dirty tree leaves stash intact, returns recovery hint", () => {
    const err = new Error("error: Your local changes to the following files would be overwritten by merge");
    err.stderr = Buffer.from("error: Your local changes to the following files would be overwritten by merge:\n\t.forge/watch-history.jsonl");
    execSync
      .mockReturnValueOnce(listLine(0, 5))
      .mockImplementationOnce(() => { throw err; });  // apply fails

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 5 });

    expect(result.restored).toBe(false);
    expect(result.dirtyTree).toBe(true);
    expect(result.conflict).toBe(false);
    expect(result.stashRef).toBe("stash@{0}");
    expect(result.error).toContain("would be overwritten");
    expect(result.error).toContain("git stash apply stash@{0}");
    // Critical: drop must NOT be called when apply failed.
    expect(execSync).toHaveBeenCalledTimes(2);
    expect(execSync.mock.calls.some((c) => c[0].startsWith("git stash drop"))).toBe(false);
  });

  it("returns conflict:true on merge conflict, stash preserved", () => {
    const err = new Error("CONFLICT (content): Merge conflict in src/a.ts");
    err.stderr = Buffer.from("CONFLICT (content): Merge conflict in src/a.ts");
    execSync
      .mockReturnValueOnce(listLine(0, 3))
      .mockImplementationOnce(() => { throw err; });

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 3 });

    expect(result.restored).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.error).toContain("CONFLICT");
    // Stash must remain in list — no drop attempted.
    expect(execSync).toHaveBeenCalledTimes(2);
  });

  it("treats drop failure after successful apply as non-fatal", () => {
    execSync
      .mockReturnValueOnce(listLine(0, 7))
      .mockReturnValueOnce("")  // apply succeeds
      .mockImplementationOnce(() => { throw new Error("drop refused"); });  // drop fails

    const result = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 7 });
    expect(result.restored).toBe(true);
    expect(result.stashRef).toBe("stash@{0}");
  });

  it("never throws even when `git stash list` itself fails", () => {
    execSync.mockImplementationOnce(() => { throw new Error("git: command not found"); });
    expect(() => popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 1 })).not.toThrow();
  });
});

describe("Issue #201 — cleanupStaleSnapshots janitor", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const NOW = new Date("2025-12-15T12:00:00Z");
  const nowSec = Math.floor(NOW.getTime() / 1000);
  const daysAgo = (n) => nowSec - n * 24 * 60 * 60;

  it("drops pforge-slice-N-snapshot stashes older than maxAgeDays", () => {
    const list = [
      `stash@{0}|${daysAgo(1)}|pforge-slice-9-snapshot`,   // 1d old — keep
      `stash@{1}|${daysAgo(8)}|pforge-slice-5-snapshot`,   // 8d old — drop
      `stash@{2}|${daysAgo(30)}|pforge-slice-3-snapshot`,  // 30d old — drop
    ].join("\n");

    execSync
      .mockReturnValueOnce(list)  // stash list
      .mockReturnValueOnce("")     // drop @{2} (reverse order)
      .mockReturnValueOnce("");    // drop @{1}

    const result = cleanupStaleSnapshots({ cwd: "/fake/cwd", maxAgeDays: 7, _now: () => NOW });

    expect(result.scanned).toBe(3);
    expect(result.dropped).toEqual(["stash@{2}", "stash@{1}"]);
    expect(result.errors).toEqual([]);
    // Verify drop commands hit the right refs in reverse order.
    expect(execSync.mock.calls[1][0]).toBe("git stash drop stash@{2}");
    expect(execSync.mock.calls[2][0]).toBe("git stash drop stash@{1}");
  });

  it("ignores non-pforge stashes regardless of age", () => {
    const list = [
      `stash@{0}|${daysAgo(30)}|WIP on master: random work`,
      `stash@{1}|${daysAgo(30)}|some-other-snapshot`,
      `stash@{2}|${daysAgo(30)}|pforge-slice-1-snapshot`,
    ].join("\n");

    execSync
      .mockReturnValueOnce(list)
      .mockReturnValueOnce("");  // drop @{2} only

    const result = cleanupStaleSnapshots({ cwd: "/fake/cwd", maxAgeDays: 7, _now: () => NOW });

    expect(result.scanned).toBe(3);
    expect(result.dropped).toEqual(["stash@{2}"]);
    // Only one drop call total.
    expect(execSync.mock.calls.filter((c) => c[0].startsWith("git stash drop"))).toHaveLength(1);
  });

  it("returns scanned:0, dropped:[] when stash list is empty", () => {
    execSync.mockReturnValueOnce("");
    const result = cleanupStaleSnapshots({ cwd: "/fake/cwd", _now: () => NOW });
    expect(result.scanned).toBe(0);
    expect(result.dropped).toEqual([]);
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it("records error and returns empty when git stash list fails", () => {
    execSync.mockImplementationOnce(() => { throw new Error("not a git repository"); });
    const result = cleanupStaleSnapshots({ cwd: "/fake/cwd", _now: () => NOW });
    expect(result.scanned).toBe(0);
    expect(result.dropped).toEqual([]);
    expect(result.errors[0]).toContain("not a git repository");
  });

  it("continues past individual drop failures", () => {
    const list = [
      `stash@{0}|${daysAgo(10)}|pforge-slice-1-snapshot`,
      `stash@{1}|${daysAgo(10)}|pforge-slice-2-snapshot`,
    ].join("\n");
    execSync
      .mockReturnValueOnce(list)
      .mockImplementationOnce(() => { throw new Error("drop @{1} failed"); })  // first drop fails
      .mockReturnValueOnce("");  // second drop succeeds

    const result = cleanupStaleSnapshots({ cwd: "/fake/cwd", maxAgeDays: 7, _now: () => NOW });
    expect(result.dropped).toEqual(["stash@{0}"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("stash@{1}");
  });
});

describe("Issue #178 — push/pop symmetry", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("push then pop is a no-op round-trip on the call sequence", () => {
    // Simulate: dirty pre-slice → push → worker runs → pop succeeds (list→apply→drop)
    execSync
      .mockReturnValueOnce(" M scratch.ts\n")                                  // status
      .mockReturnValueOnce("")                                                  // stash push
      .mockReturnValueOnce("stash@{0}: On master: pforge-slice-9-snapshot")   // stash list (pop)
      .mockReturnValueOnce("")                                                  // stash apply
      .mockReturnValueOnce("");                                                 // stash drop

    const push = pushSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 9 });
    expect(push.pushed).toBe(true);

    const pop = popSliceSnapshot({ cwd: "/fake/cwd", sliceNumber: 9 });
    expect(pop.restored).toBe(true);

    expect(execSync).toHaveBeenCalledTimes(5);
    expect(execSync.mock.calls[0][0]).toBe("git status --porcelain");
    expect(execSync.mock.calls[1][0]).toContain("git stash push");
    expect(execSync.mock.calls[2][0]).toBe("git stash list");
    expect(execSync.mock.calls[3][0]).toBe("git stash apply stash@{0}");
    expect(execSync.mock.calls[4][0]).toBe("git stash drop stash@{0}");
  });
});
