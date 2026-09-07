import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyWorktreeInputs } from "../orchestrator/worktree-inputs.mjs";

describe("worktree input boundaries", () => {
  let fixtureDir;
  let projectDir;
  let worktreePath;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "pforge-worktree-inputs-"));
    projectDir = join(fixtureDir, "project");
    worktreePath = join(projectDir, ".forge", "worktrees", "batch", "1", "variant-1");
    mkdirSync(worktreePath, { recursive: true });
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("remaps dependency junctions to copied directories, not the parent worktree", async () => {
    const modules = join(projectDir, "node_modules");
    const packageDir = join(modules, "package");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "index.js"), "original");
    symlinkSync(packageDir, join(modules, "linked"), process.platform === "win32" ? "junction" : "dir");

    await copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths: ["node_modules"] });

    const copiedLink = join(worktreePath, "node_modules", "linked");
    expect(realpathSync(copiedLink)).toBe(realpathSync(join(worktreePath, "node_modules", "package")));
    writeFileSync(join(copiedLink, "index.js"), "worker only");
    expect(readFileSync(join(packageDir, "index.js"), "utf8")).toBe("original");
  });

  it("rejects ignored links outside the project instead of sharing their targets", async () => {
    const outside = join(fixtureDir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "untouched.txt"), "outside");
    symlinkSync(outside, join(projectDir, "dependency"), process.platform === "win32" ? "junction" : "dir");

    await expect(copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths: ["dependency"] }))
      .rejects.toThrow("outside the project");
    expect(readFileSync(join(outside, "untouched.txt"), "utf8")).toBe("outside");
    expect(existsSync(join(worktreePath, "dependency"))).toBe(false);
  });

  it("copies configuration but excludes recursive worktrees, run history and Git metadata", async () => {
    mkdirSync(join(projectDir, ".forge", "runs"), { recursive: true });
    writeFileSync(join(projectDir, ".forge", "runs", "old.json"), "{}");
    writeFileSync(join(projectDir, ".forge", "config.json"), "{}");
    writeFileSync(join(projectDir, ".forge", ".git"), "must not copy");

    await copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths: [".forge"] });

    expect(existsSync(join(worktreePath, ".forge", "config.json"))).toBe(true);
    for (const excluded of ["runs", "worktrees", ".git"]) {
      expect(existsSync(join(worktreePath, ".forge", excluded))).toBe(false);
    }
  });

  it("rejects traversal and honours cancellation before copying", async () => {
    await expect(copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths: [join("..", "outside")] }))
      .rejects.toThrow("escapes the project");
    const controller = new AbortController();
    controller.abort();
    await expect(copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths: [".forge"], abortSignal: controller.signal }))
      .rejects.toThrow();
  });
});
