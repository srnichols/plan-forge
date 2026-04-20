/**
 * Phase-26 Slice 1 — worktree-manager tests.
 *
 * Covers:
 *   - sanitizeComponent strips traversal + path separators
 *   - variantPath / archivePath stay inside their roots
 *   - clampMaxVariants enforces [MIN_VARIANTS, MAX_VARIANTS]
 *   - createWorktree invokes `git worktree add --detach` with the right args
 *   - archiveWorktree moves variant dir + calls `git worktree remove --force`
 *   - cleanupAgedArchives removes aged dirs and keeps fresh ones
 *   - listLiveVariants enumerates per-plan/slice/variant structure
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sanitizeComponent,
  variantPath,
  archivePath,
  clampMaxVariants,
  createWorktree,
  archiveWorktree,
  cleanupAgedArchives,
  listLiveVariants,
  WORKTREES_DIR,
  WORKTREES_ARCHIVE_DIR,
  DEFAULT_MAX_VARIANTS,
  MIN_VARIANTS,
  MAX_VARIANTS,
} from "../worktree-manager.mjs";

function makeTempDir() {
  const dir = join(tmpdir(), `pforge-wt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("sanitizeComponent", () => {
  it("strips traversal sequences", () => {
    expect(sanitizeComponent("../../etc")).not.toContain("..");
    expect(sanitizeComponent("..")).not.toContain("..");
  });

  it("replaces path separators", () => {
    expect(sanitizeComponent("a/b/c")).toBe("a_b_c");
    expect(sanitizeComponent("a\\b\\c")).toBe("a_b_c");
  });

  it("replaces control chars and spaces", () => {
    expect(sanitizeComponent("a b")).toBe("a_b");
    expect(sanitizeComponent("a\nb")).toBe("a_b");
  });

  it("preserves allowed chars", () => {
    expect(sanitizeComponent("slice-1_v2.plan")).toBe("slice-1_v2.plan");
  });

  it("falls back to _ for empty input", () => {
    expect(sanitizeComponent("")).toBe("_");
    expect(sanitizeComponent(null)).toBe("_");
    expect(sanitizeComponent(undefined)).toBe("_");
  });

  it("caps length at 128", () => {
    const long = "a".repeat(500);
    expect(sanitizeComponent(long).length).toBe(128);
  });
});

describe("variantPath / archivePath containment", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

  it("places variant under .forge/worktrees/<plan>/<slice>/variant-<n>", () => {
    const p = variantPath(projectDir, "my-plan", "slice-1", 1);
    expect(p.startsWith(join(projectDir, WORKTREES_DIR))).toBe(true);
    expect(p.endsWith(join("my-plan", "slice-1", "variant-1"))).toBe(true);
  });

  it("places archive under .forge/worktrees-archive/<plan>/<slice>/variant-<n>", () => {
    const p = archivePath(projectDir, "my-plan", "slice-1", 1);
    expect(p.startsWith(join(projectDir, WORKTREES_ARCHIVE_DIR))).toBe(true);
  });

  it("rejects non-absolute projectDir", () => {
    expect(() => variantPath("relative/path", "p", "s", 1)).toThrow(/absolute/);
    expect(() => archivePath("relative/path", "p", "s", 1)).toThrow(/absolute/);
  });

  it("rejects variant index out of range", () => {
    expect(() => variantPath(projectDir, "p", "s", 0)).toThrow();
    expect(() => variantPath(projectDir, "p", "s", MAX_VARIANTS + 1)).toThrow();
    expect(() => variantPath(projectDir, "p", "s", 1.5)).toThrow();
  });

  it("sanitizes traversal in plan and slice names", () => {
    const p = variantPath(projectDir, "../../evil", "../evil-slice", 1);
    expect(p.startsWith(join(projectDir, WORKTREES_DIR))).toBe(true);
    expect(p).not.toContain("..");
  });
});

describe("clampMaxVariants", () => {
  it("returns default for non-finite", () => {
    expect(clampMaxVariants(undefined)).toBe(DEFAULT_MAX_VARIANTS);
    expect(clampMaxVariants(null)).toBe(DEFAULT_MAX_VARIANTS);
    expect(clampMaxVariants("abc")).toBe(DEFAULT_MAX_VARIANTS);
  });

  it("clamps below MIN_VARIANTS", () => {
    expect(clampMaxVariants(1)).toBe(MIN_VARIANTS);
    expect(clampMaxVariants(0)).toBe(MIN_VARIANTS);
    expect(clampMaxVariants(-5)).toBe(MIN_VARIANTS);
  });

  it("clamps above MAX_VARIANTS", () => {
    expect(clampMaxVariants(MAX_VARIANTS + 1)).toBe(MAX_VARIANTS);
    expect(clampMaxVariants(100)).toBe(MAX_VARIANTS);
  });

  it("preserves in-range integers", () => {
    expect(clampMaxVariants(3)).toBe(3);
    expect(clampMaxVariants(4)).toBe(4);
  });

  it("truncates floats", () => {
    expect(clampMaxVariants(3.9)).toBe(3);
  });
});

describe("createWorktree", () => {
  let projectDir;
  let spawnCalls;
  let fakeSpawn;
  beforeEach(() => {
    projectDir = makeTempDir();
    spawnCalls = [];
    fakeSpawn = (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      // Simulate successful `git worktree add`: create the directory.
      if (args[0] === "worktree" && args[1] === "add") {
        mkdirSync(args[args.length - 2], { recursive: true });
      }
      return { status: 0, stdout: "", stderr: "" };
    };
  });
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

  it("calls git worktree add --detach with the computed path", () => {
    const { path } = createWorktree({
      projectDir, planBasename: "plan-a", sliceId: "s1", variant: 1, spawn: fakeSpawn,
    });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("git");
    expect(spawnCalls[0].args.slice(0, 3)).toEqual(["worktree", "add", "--detach"]);
    expect(spawnCalls[0].args[3]).toBe(path);
    expect(spawnCalls[0].args[4]).toBe("HEAD");
  });

  it("respects baseRef override", () => {
    createWorktree({
      projectDir, planBasename: "p", sliceId: "s", variant: 2, baseRef: "main", spawn: fakeSpawn,
    });
    expect(spawnCalls[0].args[4]).toBe("main");
  });

  it("throws when git worktree add fails", () => {
    const failSpawn = () => ({ status: 128, stderr: "fatal: not a git repo" });
    expect(() =>
      createWorktree({
        projectDir, planBasename: "p", sliceId: "s", variant: 1, spawn: failSpawn,
      }),
    ).toThrow(/git worktree add failed/);
  });

  it("refuses to overwrite an existing variant directory", () => {
    const p = variantPath(projectDir, "p", "s", 1);
    mkdirSync(p, { recursive: true });
    expect(() =>
      createWorktree({ projectDir, planBasename: "p", sliceId: "s", variant: 1, spawn: fakeSpawn }),
    ).toThrow(/already exists/);
  });
});

describe("archiveWorktree", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

  it("moves variant dir to archive and calls git worktree remove", () => {
    const from = variantPath(projectDir, "p", "s1", 1);
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, "marker.txt"), "hello");
    const spawnCalls = [];
    const spawn = (cmd, args) => { spawnCalls.push({ cmd, args }); return { status: 0 }; };

    const result = archiveWorktree({
      projectDir, planBasename: "p", sliceId: "s1", variant: 1, spawn,
    });

    expect(result.archived).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(existsSync(result.to)).toBe(true);
    expect(existsSync(join(result.to, "marker.txt"))).toBe(true);
    expect(spawnCalls[0].args).toEqual(["worktree", "remove", "--force", from]);
  });

  it("is a no-op when variant does not exist", () => {
    const result = archiveWorktree({
      projectDir, planBasename: "p", sliceId: "s1", variant: 1,
      spawn: () => ({ status: 0 }),
    });
    expect(result.archived).toBe(false);
  });

  it("replaces existing archive target if present", () => {
    const from = variantPath(projectDir, "p", "s1", 1);
    const to = archivePath(projectDir, "p", "s1", 1);
    mkdirSync(from, { recursive: true });
    writeFileSync(join(from, "new.txt"), "new");
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, "stale.txt"), "stale");

    archiveWorktree({
      projectDir, planBasename: "p", sliceId: "s1", variant: 1,
      spawn: () => ({ status: 0 }),
    });

    expect(existsSync(join(to, "stale.txt"))).toBe(false);
    expect(existsSync(join(to, "new.txt"))).toBe(true);
  });
});

describe("cleanupAgedArchives", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

  it("returns empty result when archive root does not exist", () => {
    const r = cleanupAgedArchives({ projectDir });
    expect(r.removed).toEqual([]);
    expect(r.kept).toEqual([]);
  });

  it("removes archive older than archiveDays and keeps fresh", () => {
    const oldDir = archivePath(projectDir, "p", "s1", 1);
    const freshDir = archivePath(projectDir, "p", "s1", 2);
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(freshDir, { recursive: true });
    // Backdate oldDir mtime 30 days into the past
    const thirtyDaysAgo = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(oldDir, thirtyDaysAgo, thirtyDaysAgo);

    const r = cleanupAgedArchives({ projectDir, archiveDays: 7 });

    expect(r.removed).toContain(oldDir);
    expect(r.kept).toContain(freshDir);
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
  });

  it("respects custom archiveDays", () => {
    const dir = archivePath(projectDir, "p", "s1", 1);
    mkdirSync(dir, { recursive: true });
    const twoDaysAgo = (Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(dir, twoDaysAgo, twoDaysAgo);

    // archiveDays=1 → 2-day-old dir should be removed
    const r = cleanupAgedArchives({ projectDir, archiveDays: 1 });
    expect(r.removed).toContain(dir);
  });

  it("rejects non-absolute projectDir", () => {
    expect(() => cleanupAgedArchives({ projectDir: "relative" })).toThrow(/absolute/);
  });
});

describe("listLiveVariants", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });
  afterEach(() => { rmSync(projectDir, { recursive: true, force: true }); });

  it("returns empty when worktrees root does not exist", () => {
    expect(listLiveVariants(projectDir)).toEqual([]);
  });

  it("enumerates every variant across plans and slices", () => {
    const a = variantPath(projectDir, "plan-a", "s1", 1);
    const b = variantPath(projectDir, "plan-a", "s1", 2);
    const c = variantPath(projectDir, "plan-b", "s7", 3);
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    mkdirSync(c, { recursive: true });

    const list = listLiveVariants(projectDir);
    expect(list).toContain(a);
    expect(list).toContain(b);
    expect(list).toContain(c);
    expect(list).toHaveLength(3);
  });

  it("rejects non-absolute projectDir", () => {
    expect(() => listLiveVariants("relative")).toThrow(/absolute/);
  });
});
