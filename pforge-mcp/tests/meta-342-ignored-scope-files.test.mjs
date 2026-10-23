import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyScopeFilesTrackable } from "../orchestrator/git-safety.mjs";
import { failIgnoredScopeSlice } from "../orchestrator/run-plan/slice-evidence-checks.mjs";

/**
 * Meta-bug #342 — Phase-62 imported `pforge-claw/src/mcp/project-client.mjs`
 * from boot, worker and executor, but an unanchored `mcp/` ignore rule hid the
 * directory. The file existed on disk, the filesystem-based gates passed, and
 * auto-commit (which stages from `git status --porcelain`, an output that omits
 * ignored files) never committed it: a clean checkout could not contain the
 * module. The ignore rule itself was fixed in a60325e4; nothing guarded the
 * class, so any slice whose deliverable lands under an ignore rule passes the
 * same way.
 */

describe("verifyScopeFilesTrackable (#342, real repository)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const git = (cwd, ...args) => execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "user.email=t@example.test", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf-8" },
  ).trim();

  function makeRepo(gitignore) {
    const dir = mkdtempSync(join(tmpdir(), "pf-meta-342-"));
    dirs.push(dir);
    git(dir, "init", "-q");
    writeFileSync(join(dir, ".gitignore"), gitignore);
    mkdirSync(join(dir, "pkg", "src", "mcp"), { recursive: true });
    writeFileSync(join(dir, "pkg", "src", "mcp", "client.mjs"), "export const client = 1;\n");
    return dir;
  }

  const slice = (...scope) => ({ number: "1", title: "Add the project client", scope });

  it("flags a declared file that exists but sits under an unanchored ignore rule", () => {
    const dir = makeRepo("mcp/\n");
    const result = verifyScopeFilesTrackable({ slice: slice("pkg/src/mcp/client.mjs"), cwd: dir });
    expect(result.applicable).toBe(true);
    expect(result.ignored).toEqual([
      { path: "pkg/src/mcp/client.mjs", source: ".gitignore", line: 1, pattern: "mcp/" },
    ]);
  });

  it("passes once the rule is anchored so it no longer matches the nested directory", () => {
    const dir = makeRepo("/mcp/\n");
    expect(verifyScopeFilesTrackable({ slice: slice("pkg/src/mcp/client.mjs"), cwd: dir })).toEqual({ applicable: true, ignored: [] });
  });

  it("does not flag a file that is already tracked even though a rule matches it", () => {
    const dir = makeRepo("mcp/\n");
    git(dir, "add", "-f", "pkg/src/mcp/client.mjs");
    expect(verifyScopeFilesTrackable({ slice: slice("pkg/src/mcp/client.mjs"), cwd: dir }).ignored).toEqual([]);
  });

  it("does not report a path that only matches a negated rule", () => {
    const dir = makeRepo("*.mjs\n!client.mjs\n");
    expect(verifyScopeFilesTrackable({ slice: slice("pkg/src/mcp/client.mjs"), cwd: dir }).ignored).toEqual([]);
  });

  it("skips declared files that do not exist yet", () => {
    const dir = makeRepo("mcp/\n");
    expect(verifyScopeFilesTrackable({ slice: slice("pkg/src/mcp/missing.mjs"), cwd: dir }).applicable).toBe(false);
  });

  it("is not applicable when the scope names no concrete file", () => {
    const dir = makeRepo("mcp/\n");
    expect(verifyScopeFilesTrackable({ slice: slice("pkg/src/**", "pkg/"), cwd: dir }).applicable).toBe(false);
    expect(verifyScopeFilesTrackable({ slice: { number: "2", title: "x" }, cwd: dir }).applicable).toBe(false);
  });

  it("still checks the in-repo files when the scope also names a path outside the repository", () => {
    const dir = makeRepo("mcp/\n");
    const outside = process.platform === "win32" ? "C:/definitely/outside/file.mjs" : "/definitely/outside/file.mjs";
    const result = verifyScopeFilesTrackable({ slice: slice(outside, "../sibling/file.mjs", "pkg/src/mcp/client.mjs"), cwd: dir });
    expect(result.ignored.map((entry) => entry.path)).toEqual(["pkg/src/mcp/client.mjs"]);
  });

  it("is not applicable outside a git repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "pf-meta-342-plain-"));
    dirs.push(plain);
    mkdirSync(join(plain, "src"), { recursive: true });
    writeFileSync(join(plain, "src", "a.mjs"), "x");
    expect(verifyScopeFilesTrackable({ slice: slice("src/a.mjs"), cwd: plain }).applicable).toBe(false);
  });
});

describe("failIgnoredScopeSlice (#342)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function repoWithIgnoredFile() {
    const dir = mkdtempSync(join(tmpdir(), "pf-meta-342-wire-"));
    dirs.push(dir);
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, ".gitignore"), "mcp/\n");
    mkdirSync(join(dir, "src", "mcp"), { recursive: true });
    writeFileSync(join(dir, "src", "mcp", "client.mjs"), "export const c = 1;\n");
    return dir;
  }

  const slice = { number: "7", title: "Add the project client", scope: ["src/mcp/client.mjs"] };

  it("turns a passed slice into a failed one and names the file and the rule", () => {
    const cwd = repoWithIgnoredFile();
    const sliceResult = { status: "passed" };
    failIgnoredScopeSlice({ sliceResult, slice, cwd });
    expect(sliceResult.status).toBe("failed");
    expect(sliceResult.statusReason).toContain("ignored-scope-file");
    expect(sliceResult.statusReason).toContain("src/mcp/client.mjs");
    expect(sliceResult.statusReason).toContain(".gitignore:1");
    expect(sliceResult.ignoredScopeFiles).toHaveLength(1);
  });

  it("leaves a slice that already failed alone", () => {
    const cwd = repoWithIgnoredFile();
    const sliceResult = { status: "failed", statusReason: "validation gate failed: x" };
    failIgnoredScopeSlice({ sliceResult, slice, cwd });
    expect(sliceResult).toEqual({ status: "failed", statusReason: "validation gate failed: x" });
  });

  it("leaves a slice with nothing ignored alone", () => {
    const cwd = repoWithIgnoredFile();
    writeFileSync(join(cwd, ".gitignore"), "/mcp/\n");
    const sliceResult = { status: "passed" };
    failIgnoredScopeSlice({ sliceResult, slice, cwd });
    expect(sliceResult).toEqual({ status: "passed" });
  });
});
