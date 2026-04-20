/**
 * Plan Forge — Phase-26 Slice 11 (Trajectory federation in cross.*) tests
 *
 * Covers `federationReadTrajectories` extension to brain.mjs's Phase-25
 * Slice-6 federation reader. Reads `.forge/trajectories/<plan>/slice-*.md`
 * across allowlisted sibling repos, rate-limited to 100 files per query,
 * sorted by mtime descending, source-tagged per-repo.
 *
 * MUST (docs/plans/Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md §Slice 11):
 *   - Read-only access to sibling `.forge/trajectories/`
 *   - Allowlist enforcement (reuse validateFederationRepo)
 *   - Rate limit 100 files per query
 *   - Sort by mtime desc, newest wins
 *   - Source-tagged entries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  federationReadTrajectories,
  TRAJECTORY_FEDERATION_LIMIT,
} from "../brain.mjs";

function seedTrajectory(repoRoot, { planBasename, sliceId, content = "note", mtime }) {
  const dir = resolve(repoRoot, ".forge", "trajectories", planBasename);
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `slice-${sliceId}.md`);
  writeFileSync(path, content, "utf-8");
  if (mtime) {
    const t = mtime instanceof Date ? mtime : new Date(mtime);
    utimesSync(path, t, t);
  }
  return path;
}

describe("federationReadTrajectories (Phase-26 Slice 11)", () => {
  let root;
  let repoA;
  let repoB;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pforge-fed-traj-"));
    repoA = mkdtempSync(join(tmpdir(), "pforge-fed-traj-A-"));
    repoB = mkdtempSync(join(tmpdir(), "pforge-fed-traj-B-"));
  });

  afterEach(() => {
    for (const p of [root, repoA, repoB]) {
      try { rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it("returns [] when federation is disabled", () => {
    const config = { enabled: false, repos: [repoA] };
    seedTrajectory(repoA, { planBasename: "p1", sliceId: "1" });
    expect(federationReadTrajectories({ cwd: root, config })).toEqual([]);
  });

  it("returns [] when repos[] is empty", () => {
    expect(federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [] },
    })).toEqual([]);
  });

  it("reads trajectories from a single allowlisted repo", () => {
    seedTrajectory(repoA, { planBasename: "Phase-99", sliceId: "3", content: "hello" });
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      repo: repoA,
      planBasename: "Phase-99",
      sliceId: "3",
      content: "hello",
    });
    expect(res[0].path).toContain("slice-3.md");
    expect(typeof res[0].mtimeMs).toBe("number");
  });

  it("aggregates trajectories across multiple repos with source tag", () => {
    seedTrajectory(repoA, { planBasename: "p1", sliceId: "1" });
    seedTrajectory(repoB, { planBasename: "p2", sliceId: "2" });
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA, repoB] },
    });
    expect(res).toHaveLength(2);
    const repos = res.map((r) => r.repo).sort();
    expect(repos).toEqual([repoA, repoB].sort());
  });

  it("sorts by mtimeMs descending (newest first)", () => {
    seedTrajectory(repoA, { planBasename: "p1", sliceId: "old", mtime: new Date("2024-01-01T00:00:00Z") });
    seedTrajectory(repoA, { planBasename: "p1", sliceId: "new", mtime: new Date("2026-04-20T00:00:00Z") });
    seedTrajectory(repoA, { planBasename: "p1", sliceId: "mid", mtime: new Date("2025-06-15T00:00:00Z") });
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    });
    expect(res.map((r) => r.sliceId)).toEqual(["new", "mid", "old"]);
  });

  it("caps at 100 files by default (TRAJECTORY_FEDERATION_LIMIT)", () => {
    for (let i = 0; i < 150; i++) {
      seedTrajectory(repoA, { planBasename: "big", sliceId: String(i) });
    }
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    });
    expect(res).toHaveLength(TRAJECTORY_FEDERATION_LIMIT);
    expect(TRAJECTORY_FEDERATION_LIMIT).toBe(100);
  });

  it("honours custom limit (never exceeds TRAJECTORY_FEDERATION_LIMIT)", () => {
    for (let i = 0; i < 20; i++) {
      seedTrajectory(repoA, { planBasename: "p", sliceId: String(i) });
    }
    expect(federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
      limit: 5,
    })).toHaveLength(5);
    // Caller-requested 500 must still clamp to 100 hard ceiling.
    for (let i = 20; i < 120; i++) {
      seedTrajectory(repoA, { planBasename: "p", sliceId: String(i) });
    }
    const big = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
      limit: 500,
    });
    expect(big.length).toBeLessThanOrEqual(TRAJECTORY_FEDERATION_LIMIT);
  });

  it("silently skips invalid repo allowlist entries (URLs, traversal, non-absolute)", () => {
    seedTrajectory(repoA, { planBasename: "p", sliceId: "1" });
    const res = federationReadTrajectories({
      cwd: root,
      config: {
        enabled: true,
        repos: [
          "https://github.com/x/y",   // URL rejected
          "../evil",                    // traversal rejected
          "relative/path",              // non-absolute rejected
          repoA,                        // valid
        ],
      },
    });
    expect(res).toHaveLength(1);
    expect(res[0].repo).toBe(repoA);
  });

  it("returns [] when no repo has a .forge/trajectories/ dir", () => {
    // repoA has no trajectories dir
    expect(federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    })).toEqual([]);
  });

  it("ignores non-slice files in the trajectories dir", () => {
    seedTrajectory(repoA, { planBasename: "p", sliceId: "1" });
    // Unexpected file at same depth:
    const unexpected = resolve(repoA, ".forge", "trajectories", "p", "README.md");
    writeFileSync(unexpected, "not a slice", "utf-8");
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    });
    expect(res).toHaveLength(1);
    expect(res[0].sliceId).toBe("1");
  });

  it("returns content field with the full trajectory text", () => {
    seedTrajectory(repoA, { planBasename: "p", sliceId: "1", content: "line1\nline2\nline3" });
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    });
    expect(res[0].content).toBe("line1\nline2\nline3");
  });

  it("does not write anything to federated repos (read-only)", () => {
    seedTrajectory(repoA, { planBasename: "p", sliceId: "1", content: "orig" });
    federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA] },
    });
    // Re-read directly to verify untouched
    const path = resolve(repoA, ".forge", "trajectories", "p", "slice-1.md");
    expect(readFileSync(path, "utf-8")).toBe("orig");
  });

  it("aggregates and sorts ACROSS repos by mtime", () => {
    seedTrajectory(repoA, { planBasename: "p", sliceId: "a-old", mtime: new Date("2024-01-01T00:00:00Z") });
    seedTrajectory(repoB, { planBasename: "p", sliceId: "b-new", mtime: new Date("2026-04-20T00:00:00Z") });
    seedTrajectory(repoA, { planBasename: "p", sliceId: "a-new", mtime: new Date("2025-06-15T00:00:00Z") });
    const res = federationReadTrajectories({
      cwd: root,
      config: { enabled: true, repos: [repoA, repoB] },
    });
    expect(res.map((r) => r.sliceId)).toEqual(["b-new", "a-new", "a-old"]);
  });
});
