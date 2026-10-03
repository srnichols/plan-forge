import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleWorktrees } from "../orchestrator/worktree-janitor.mjs";
import { gitLongPathArgs } from "../worktree-manager.mjs";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-10-03T12:00:00Z");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function age(path, days) {
  const when = new Date(NOW.getTime() - days * DAY_MS);
  utimesSync(path, when, when);
}

describe("cleanupStaleWorktrees", () => {
  let repo;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "pf-wt-janitor-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@t"]);
    git(repo, ["config", "user.name", "t"]);
    writeFileSync(join(repo, "file.txt"), "keep me\n");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-qm", "init"]);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const addWorktree = (rel) => {
    const path = join(repo, ".forge", "worktrees", ...rel.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    git(repo, ["worktree", "add", "--detach", path, "HEAD"]);
    return path;
  };

  it("removes registered worktrees older than the retention and prunes git's record", () => {
    const stale = addWorktree("parallel-a/1/variant-1");
    age(stale, 10);
    const r = cleanupStaleWorktrees({ cwd: repo, now: NOW });
    expect(r.removed).toEqual([stale]);
    expect(existsSync(stale)).toBe(false);
    expect(git(repo, ["worktree", "list"])).not.toContain("variant-1");
  });

  it("keeps worktrees inside the retention (a run may still be using them)", () => {
    const fresh = addWorktree("parallel-b/2/variant-1");
    age(fresh, 1);
    const r = cleanupStaleWorktrees({ cwd: repo, now: NOW });
    expect(r.removed).toEqual([]);
    expect(r.kept).toEqual([fresh]);
    expect(existsSync(fresh)).toBe(true);
  });

  it("removes an unregistered stale variant without following links inside it", () => {
    const orphan = join(repo, ".forge", "worktrees", "parallel-c", "3", "variant-1");
    mkdirSync(orphan, { recursive: true });
    // A dependency link pointing back at the project, as copyWorktreeInputs creates.
    symlinkSync(repo, join(orphan, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    age(orphan, 10);
    const r = cleanupStaleWorktrees({ cwd: repo, now: NOW });
    expect(r.removed).toEqual([orphan]);
    expect(existsSync(orphan)).toBe(false);
    expect(readFileSync(join(repo, "file.txt"), "utf8")).toBe("keep me\n");
  });

  it("removes aged archives too", () => {
    const archived = join(repo, ".forge", "worktrees-archive", "plan", "1", "variant-2");
    mkdirSync(archived, { recursive: true });
    age(archived, 30);
    const r = cleanupStaleWorktrees({ cwd: repo, now: NOW });
    expect(r.archivesRemoved).toEqual([archived]);
    expect(existsSync(archived)).toBe(false);
  });

  it("honours a custom retention", () => {
    const wt = addWorktree("parallel-d/4/variant-1");
    age(wt, 3);
    expect(cleanupStaleWorktrees({ cwd: repo, now: NOW, retentionDays: 2 }).removed).toEqual([wt]);
  });

  it("is a no-op without .forge/worktrees", () => {
    expect(cleanupStaleWorktrees({ cwd: repo, now: NOW })).toMatchObject({ removed: [], kept: [], archivesRemoved: [], errors: [] });
  });
});

describe("gitLongPathArgs", () => {
  it("enables core.longpaths on Windows only", () => {
    expect(gitLongPathArgs("win32")).toEqual(["-c", "core.longpaths=true"]);
    expect(gitLongPathArgs("linux")).toEqual([]);
    expect(gitLongPathArgs("darwin")).toEqual([]);
  });
});
