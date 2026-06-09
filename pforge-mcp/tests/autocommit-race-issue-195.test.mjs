/**
 * Plan Forge — Issue #195: orchestrator/extension auto-commit race produces
 * ghost-pass slice with codeChanges=null.
 *
 * Repro from Phase-3 slice-4 (v3.1.1 testbed run):
 *   - VS Code Copilot extension auto-committed the worker's real edits
 *     (2c8a796) 22 seconds BEFORE autoCommitSliceIfDirty ran.
 *   - The orchestrator's own commit (f5ec644) saw a tree dirty with only
 *     `.forge/` housekeeping files, but stamped "feat(slice-4):
 *     InvoicesController — HTTP endpoints" anyway.
 *   - slice-4.json on disk had autoCommit: {} and codeChanges: null,
 *     even though events.log emitted the correct values 200 ms later.
 *
 * Acceptance (from issue body):
 *   1. tokens.codeChanges is never null on a completed slice
 *   2. New field absorbedCommits[] (sha, author, subject, diffstat) for
 *      non-orchestrator commits in the slice window
 *   3. New field raceDetected: boolean — true when external commits landed
 *   4. Commit message changes to "chore(slice-N): housekeeping
 *      (source absorbed by <sha>)" when zero-source race detected
 *   5. Re-persist slice-N.json after autoCommit (so on-disk record matches
 *      events.log emission)
 *
 * Tests are unit-level: child_process is mocked so we never touch a real
 * git repo. Coverage of the persistence-after-autoCommit path is asserted
 * by inspecting the orchestrator.mjs source (same pattern used by
 * cli-capture-encoding-issue-196.test.mjs).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  autoCommitSliceIfDirty,
  captureAbsorbedCommits,
} from "../orchestrator.mjs";

const START_SHA = "1111111111111111111111111111111111111111";
const ABSORBED_SHA = "2c8a7960000000000000000000000000000000aa";
const OUR_SHA = "f5ec64440000000000000000000000000000bbcc";

describe("captureAbsorbedCommits — Issue #195 enumeration helper", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns [] when fromSha is missing", () => {
    const out = captureAbsorbedCommits({ cwd: "/x", fromSha: null });
    expect(out).toEqual([]);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("returns [] when git log throws", () => {
    execFileSync.mockImplementationOnce(() => { throw new Error("not a git repo"); });
    expect(captureAbsorbedCommits({ cwd: "/x", fromSha: START_SHA })).toEqual([]);
  });

  it("parses tab-delimited git log into {sha, author, subject, diffstat}", () => {
    execFileSync
      .mockReturnValueOnce(
        `${ABSORBED_SHA}\tCopilot\tfeat: implement InvoicesController endpoints\n`
      ) // git log
      .mockReturnValueOnce(" 3 files changed, 84 insertions(+), 2 deletions(-)\n"); // git show --shortstat

    const out = captureAbsorbedCommits({ cwd: "/x", fromSha: START_SHA });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      sha: ABSORBED_SHA,
      author: "Copilot",
      subject: "feat: implement InvoicesController endpoints",
      diffstat: { filesChanged: 3, linesAdded: 84, linesRemoved: 2 },
    });
  });

  it("survives a per-commit shortstat failure and still records the commit", () => {
    execFileSync
      .mockReturnValueOnce(`${ABSORBED_SHA}\tCopilot\tfix something\n`)
      .mockImplementationOnce(() => { throw new Error("show failed"); });

    const out = captureAbsorbedCommits({ cwd: "/x", fromSha: START_SHA });
    expect(out).toHaveLength(1);
    expect(out[0].sha).toBe(ABSORBED_SHA);
    expect(out[0].diffstat).toBeNull();
  });
});

describe("autoCommitSliceIfDirty — Issue #195 race & housekeeping detection", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("clean tree + worker advanced HEAD: surfaces absorbedCommits and codeChanges", () => {
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("status --porcelain")) return "";          // clean tree
      if (cmd.includes("rev-parse")) return `${ABSORBED_SHA}\n`;  // HEAD advanced by worker
      return "";
    });
    execFileSync.mockImplementation((file, args = []) => {
      if (args[0] === "log") return `${ABSORBED_SHA}\tCopilot\tfeat: real work\n`;
      if (args[0] === "show") return " 2 files changed, 10 insertions(+)\n"; // shortstat
      return "";
    });

    const slice = { number: 4, title: "InvoicesController — HTTP endpoints" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake", mode: "auto", startSha: START_SHA,
    });

    expect(result.committed).toBe(true);
    expect(result.source).toBe("worker");
    expect(result.sha).toBe(ABSORBED_SHA);
    expect(result.absorbedCommits).toHaveLength(1);
    expect(result.absorbedCommits[0].sha).toBe(ABSORBED_SHA);
    // raceDetected on the clean-tree branch means "more than one external commit",
    // which is the ambiguous case. A single absorbed commit IS the worker's own.
    expect(result.raceDetected).toBe(false);
    expect(result.codeChanges).toEqual({ filesChanged: 2, linesAdded: 10, linesRemoved: 0 });
  });

  it("dirty .forge-only tree + absorbed commit: relabels to chore(housekeeping)", () => {
    // Worker paths are ALL inside .forge/ — housekeeping commit
    // git status --porcelain → all .forge/ entries
    const dirtyForge = " M .forge/skills-auto/abc.md\n M .forge/quorum-history.jsonl\n";
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("status --porcelain")) return dirtyForge;
      if (cmd.includes("rev-parse")) return `${OUR_SHA}\n`;
      return "";
    });
    execFileSync.mockImplementation((file, args = []) => {
      if (args[0] === "log") return `${ABSORBED_SHA}\tCopilot\tfeat: implement endpoints\n`;
      if (args[0] === "show" && args[3] === ABSORBED_SHA) return " 5 files changed, 84 insertions(+), 2 deletions(-)\n";
      if (args[0] === "show") return " 2 files changed, 3 insertions(+)\n"; // OUR_SHA shortstat
      return ""; // git add, git commit
    });

    // preSliceState must be a Map for the worker-paths split to engage
    const preSliceState = new Map(); // empty → all current paths are "worker-owned"

    const slice = { number: 4, title: "InvoicesController — HTTP endpoints" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake", mode: "auto",
      startSha: START_SHA, preSliceState,
    });

    expect(result.committed).toBe(true);
    expect(result.raceDetected).toBe(true);
    expect(result.housekeepingOnly).toBe(true);
    expect(result.absorbedCommits).toHaveLength(1);
    expect(result.absorbedCommits[0].sha).toBe(ABSORBED_SHA);

    // The commit message MUST be relabeled
    const commitCall = execFileSync.mock.calls.find(
      (c) => c[0] === "git" && c[1]?.[0] === "commit"
    );
    expect(commitCall).toBeDefined();
    const msg = commitCall[1][2]; // ["commit", "-m", <msg>]
    expect(msg).toMatch(/^chore\(slice-4\): housekeeping/);
    expect(msg).toContain(ABSORBED_SHA.slice(0, 7));
    expect(msg).not.toContain("InvoicesController"); // no longer claims feature work
    expect(result.message).toBe(msg);
  });

  it("dirty source tree + no absorbed commit: keeps feat(slice-N) message, no race", () => {
    const dirtySource = " M src/InvoicesController.cs\n";
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("status --porcelain")) return dirtySource;
      if (cmd.includes("rev-parse")) return `${OUR_SHA}\n`;
      return "";
    });
    execFileSync.mockImplementation((file, args = []) => {
      if (args[0] === "log") return "";                                  // no absorbed commits
      if (args[0] === "show") return " 1 file changed, 50 insertions(+)\n"; // shortstat OUR_SHA
      return "";
    });

    const preSliceState = new Map();
    const slice = { number: 4, title: "InvoicesController — HTTP endpoints" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake", mode: "auto",
      startSha: START_SHA, preSliceState,
    });

    expect(result.committed).toBe(true);
    expect(result.raceDetected).toBeUndefined();
    expect(result.housekeepingOnly).toBeUndefined();
    expect(result.absorbedCommits).toBeUndefined();
    expect(result.message).toBe("feat(slice-4): InvoicesController — HTTP endpoints");
    expect(result.codeChanges).toEqual({ filesChanged: 1, linesAdded: 50, linesRemoved: 0 });
  });

  it("dirty source tree + absorbed commit: keeps feat message but records race", () => {
    const dirtySource = " M src/InvoicesController.cs\n";
    execSync.mockImplementation((cmd) => {
      if (cmd.includes("status --porcelain")) return dirtySource;
      if (cmd.includes("rev-parse")) return `${OUR_SHA}\n`;
      return "";
    });
    execFileSync.mockImplementation((file, args = []) => {
      if (args[0] === "log") return `${ABSORBED_SHA}\tCopilot\tfix: tiny patch\n`;
      if (args[0] === "show" && args[3] === ABSORBED_SHA) return " 1 file changed, 2 insertions(+)\n";
      if (args[0] === "show") return " 1 file changed, 50 insertions(+)\n";
      return "";
    });

    const preSliceState = new Map();
    const slice = { number: 4, title: "InvoicesController — HTTP endpoints" };
    const result = autoCommitSliceIfDirty({
      slice, cwd: "/fake", mode: "auto",
      startSha: START_SHA, preSliceState,
    });

    expect(result.committed).toBe(true);
    expect(result.raceDetected).toBe(true);
    expect(result.housekeepingOnly).toBeUndefined(); // src/ ≠ housekeeping
    expect(result.message).toBe("feat(slice-4): InvoicesController — HTTP endpoints");
    expect(result.absorbedCommits).toHaveLength(1);
  });
});

describe("Issue #195 — slice-N.json re-persist after autoCommit (source invariants)", () => {
  const orchestratorSrc = readFileSync(
    resolve(import.meta.dirname, "..", "orchestrator.mjs"),
    "utf-8"
  );

  it("slice loop re-writes slice-N.json after autoCommitSliceIfDirty runs", () => {
    // The fix: after assigning result.autoCommit + bubbling tokens.codeChanges,
    // the callback writes slice-N.json again so the on-disk record matches
    // the slice-completed event.
    const fixMarker = /writeFileSync\(\s*resolve\(runDir, `slice-\$\{slice\.number\}\.json`\)/g;
    const occurrences = orchestratorSrc.match(fixMarker) || [];
    // One in buildSliceResult/runSlice (pre-autoCommit) + one in the
    // scheduler callback (post-autoCommit) = 2 total.
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("re-persist call is inside the result.status === 'passed' branch", () => {
    // Locate the slice-loop branch that calls autoCommitSliceIfDirty and
    // verify the re-write is part of it. There are many `result.status ===
    // "passed"` checks in the file — find the specific one paired with
    // autoCommitSliceIfDirty.
    const autoCommitIdx = orchestratorSrc.indexOf("autoCommitSliceIfDirty({ slice, cwd, mode, eventBus, startSha, preSliceState })");
    expect(autoCommitIdx).toBeGreaterThan(-1);
    // Capture a window starting ~400 chars before and ending ~2000 chars after.
    const window = orchestratorSrc.slice(Math.max(0, autoCommitIdx - 400), autoCommitIdx + 2000);
    expect(window).toContain('result.status === "passed"');
    expect(window).toMatch(
      /writeFileSync\(\s*resolve\(runDir, `slice-\$\{slice\.number\}\.json`\)/
    );
  });

  it("absorbedCommits fallback for tokens.codeChanges is present", () => {
    // When the orchestrator's own commit was housekeeping, the worker's real
    // diffstat lives on the absorbed commit. Falling back to that diffstat
    // is what prevents tokens.codeChanges from being null on a passing slice.
    expect(orchestratorSrc).toMatch(/absorbedCommits\?\.length/);
    expect(orchestratorSrc).toMatch(/c\.diffstat/);
  });
});
