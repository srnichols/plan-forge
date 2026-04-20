/**
 * Plan Forge — Phase-25 Slice 2 (L8 Trajectory) unit tests
 *
 * Covers the trajectory-note helpers in memory.mjs:
 *   - buildTrajectorySuffix()
 *   - extractTrajectory()
 *   - capTrajectoryWords()
 *   - writeTrajectory()
 *   - readTrajectory()
 *   - listTrajectories()
 *
 * MUST #2 (docs/plans/Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md):
 * after every passing slice a trajectory note is written to
 * .forge/trajectories/<plan-basename>/slice-<id>.md, ≤500 words, prose.
 * D2: exceeding the cap truncates with a `[truncated]` marker.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  buildTrajectorySuffix,
  extractTrajectory,
  capTrajectoryWords,
  writeTrajectory,
  readTrajectory,
  listTrajectories,
  TRAJECTORY_BEGIN_SENTINEL,
  TRAJECTORY_END_SENTINEL,
  TRAJECTORY_MAX_WORDS,
} from "../memory.mjs";

describe("buildTrajectorySuffix (Phase-25 L8)", () => {
  it("includes both sentinels and the word cap", () => {
    const suffix = buildTrajectorySuffix();
    expect(suffix).toContain(TRAJECTORY_BEGIN_SENTINEL);
    expect(suffix).toContain(TRAJECTORY_END_SENTINEL);
    expect(suffix).toContain(String(TRAJECTORY_MAX_WORDS));
  });

  it("forbids code blocks / commands in the worker output (prose-only contract)", () => {
    const suffix = buildTrajectorySuffix();
    expect(suffix.toLowerCase()).toContain("prose only");
  });
});

describe("extractTrajectory", () => {
  it("returns the trimmed body between sentinels", () => {
    const out = [
      "Some worker stdout.",
      TRAJECTORY_BEGIN_SENTINEL,
      "  I chose approach A because of reason X.  ",
      TRAJECTORY_END_SENTINEL,
      "tail junk",
    ].join("\n");
    expect(extractTrajectory(out)).toBe("I chose approach A because of reason X.");
  });

  it("returns null when no sentinels are present", () => {
    expect(extractTrajectory("worker said nothing interesting")).toBeNull();
  });

  it("returns null when only the BEGIN sentinel is present", () => {
    expect(extractTrajectory(`stuff ${TRAJECTORY_BEGIN_SENTINEL} some content`)).toBeNull();
  });

  it("returns null when sentinels are reversed", () => {
    const out = `${TRAJECTORY_END_SENTINEL}\nbody\n${TRAJECTORY_BEGIN_SENTINEL}`;
    expect(extractTrajectory(out)).toBeNull();
  });

  it("returns null when the block is empty or whitespace-only", () => {
    const out = `${TRAJECTORY_BEGIN_SENTINEL}\n   \n${TRAJECTORY_END_SENTINEL}`;
    expect(extractTrajectory(out)).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    expect(extractTrajectory(null)).toBeNull();
    expect(extractTrajectory(undefined)).toBeNull();
    expect(extractTrajectory(42)).toBeNull();
  });

  it("picks the FIRST block when multiple are present (deterministic)", () => {
    const out = [
      TRAJECTORY_BEGIN_SENTINEL,
      "first note",
      TRAJECTORY_END_SENTINEL,
      TRAJECTORY_BEGIN_SENTINEL,
      "second note",
      TRAJECTORY_END_SENTINEL,
    ].join("\n");
    expect(extractTrajectory(out)).toBe("first note");
  });
});

describe("capTrajectoryWords (Phase-25 D2)", () => {
  it("returns content unchanged when under the cap", () => {
    const out = capTrajectoryWords("Only a handful of words here.");
    expect(out).toBe("Only a handful of words here.");
    expect(out).not.toContain("[truncated]");
  });

  it("truncates to exactly maxWords and appends the [truncated] marker", () => {
    const words = Array.from({ length: 600 }, (_, i) => `w${i}`).join(" ");
    const out = capTrajectoryWords(words, 10);
    expect(out.endsWith("[truncated]")).toBe(true);
    // Keep the first 10 words; next word should not appear
    const head = out.split(/\s+/).slice(0, 10).join(" ");
    expect(head).toBe("w0 w1 w2 w3 w4 w5 w6 w7 w8 w9");
    expect(out).not.toContain("w10 ");
  });

  it("defaults to TRAJECTORY_MAX_WORDS when no cap is provided", () => {
    const words = Array.from({ length: TRAJECTORY_MAX_WORDS + 20 }, () => "w").join(" ");
    const out = capTrajectoryWords(words);
    expect(out).toContain("[truncated]");
  });

  it("handles empty / non-string input safely", () => {
    expect(capTrajectoryWords("")).toBe("");
    expect(capTrajectoryWords("   ")).toBe("");
    expect(capTrajectoryWords(null)).toBe("");
    expect(capTrajectoryWords(undefined)).toBe("");
  });

  it("preserves paragraph layout up to the cut", () => {
    const content = "First paragraph one two three.\n\nSecond paragraph four five six seven eight.";
    const out = capTrajectoryWords(content, 5);
    expect(out.startsWith("First paragraph one two three.")).toBe(true);
    expect(out.endsWith("[truncated]")).toBe(true);
  });
});

describe("writeTrajectory / readTrajectory / listTrajectories (filesystem)", () => {
  let cwd;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-traj-"));
  });

  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("writes to .forge/trajectories/<plan>/slice-<id>.md", () => {
    const path = writeTrajectory({
      cwd,
      planBasename: "Phase-99-EXAMPLE",
      sliceId: 3,
      content: "The worker chose approach A.",
    });
    expect(path).toContain(resolve(cwd, ".forge", "trajectories", "Phase-99-EXAMPLE"));
    expect(path.endsWith("slice-3.md")).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("The worker chose approach A.");
  });

  it("readTrajectory round-trips a written note", () => {
    writeTrajectory({ cwd, planBasename: "p", sliceId: 1, content: "hello" });
    expect(readTrajectory({ cwd, planBasename: "p", sliceId: 1 })).toBe("hello");
  });

  it("readTrajectory returns null for missing files", () => {
    expect(readTrajectory({ cwd, planBasename: "p", sliceId: 999 })).toBeNull();
  });

  it("enforces the TRAJECTORY_MAX_WORDS cap on disk", () => {
    const longBody = Array.from({ length: TRAJECTORY_MAX_WORDS + 50 }, () => "w").join(" ");
    const path = writeTrajectory({ cwd, planBasename: "p", sliceId: 2, content: longBody });
    const onDisk = readFileSync(path, "utf-8");
    expect(onDisk.endsWith("[truncated]")).toBe(true);
  });

  it("rejects missing planBasename or sliceId", () => {
    expect(() => writeTrajectory({ cwd, planBasename: "", sliceId: 1, content: "x" })).toThrow();
    expect(() => writeTrajectory({ cwd, planBasename: "p", sliceId: "", content: "x" })).toThrow();
    expect(() => writeTrajectory({ cwd, planBasename: "p", sliceId: null, content: "x" })).toThrow();
  });

  it("sanitizes unsafe path characters in planBasename and sliceId", () => {
    // Must not escape the .forge/trajectories/ root
    const path = writeTrajectory({
      cwd,
      planBasename: "../../../etc/passwd",
      sliceId: "../hax",
      content: "nope",
    });
    expect(path.startsWith(resolve(cwd, ".forge", "trajectories"))).toBe(true);
    expect(path).not.toContain("..");
  });

  it("listTrajectories returns entries sorted by numeric slice id", () => {
    writeTrajectory({ cwd, planBasename: "p", sliceId: 10, content: "ten" });
    writeTrajectory({ cwd, planBasename: "p", sliceId: 2, content: "two" });
    writeTrajectory({ cwd, planBasename: "p", sliceId: 1, content: "one" });
    const list = listTrajectories({ cwd, planBasename: "p" });
    expect(list.map((e) => e.sliceId)).toEqual(["1", "2", "10"]);
    expect(list[0].content).toBe("one");
  });

  it("listTrajectories returns [] when the plan has no notes yet", () => {
    expect(listTrajectories({ cwd, planBasename: "absent-plan" })).toEqual([]);
  });
});
