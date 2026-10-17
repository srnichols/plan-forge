import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addWorktree, removeWorktree, run } from "../src/jobs/worktree.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const roots = [];

async function isolatedRepository() {
  const root = await g1Directory("worktree-disposal-");
  roots.push(root);
  const repo = path.join(root, "surviving repo");
  await mkdir(repo);
  const calls = [];
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    return run(command, args, { ...options, env: process.env, exists: existsSync });
  };
  const git = async (args) => {
    const result = await runner("git", ["-C", repo, ...args]);
    if (result.code !== 0) throw new Error(result.stderr);
  };
  await git(["init", "-b", "main"]);
  await writeFile(path.join(repo, "README.md"), "disposal fixture\n");
  await git(["add", "README.md"]);
  await git(["-c", "user.name=Claw fixture", "-c", "user.email=fixture@local", "commit", "-m", "fixture"]);
  const worktree = await addWorktree({
    home: path.join(root, "home"),
    project: { id: "project", repo: { path: repo, baseBranch: "main" } },
    job: { id: "disposal" }, runner,
  });
  calls.length = 0;
  return { repo, worktree, runner, calls };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("owned worktree disposal from a surviving Git directory", () => {
  it("removes a real linked worktree when only that worktree is the repository anchor", async () => {
    const fixture = await isolatedRepository();
    expect(await removeWorktree({
      repoPath: fixture.worktree.path, path: fixture.worktree.path, runner: fixture.runner,
    })).toEqual({ ok: true });
    expect(existsSync(fixture.worktree.path)).toBe(false);
    expect(await readFile(path.join(fixture.repo, "README.md"), "utf8")).toBe("disposal fixture\n");
    const removal = fixture.calls.find(({ args }) => args.includes("remove"));
    expect(removal.args).toEqual([
      "--git-dir", path.join(fixture.repo, ".git"), "worktree", "remove", "--force", fixture.worktree.path,
    ]);
    expect(removal.options.cwd).toBe(path.join(fixture.repo, ".git"));
  });

  it("preserves the existing argument-array removal from an external surviving repository", async () => {
    const fixture = await isolatedRepository();
    expect(await removeWorktree({
      repoPath: fixture.repo, path: fixture.worktree.path, runner: fixture.runner,
    })).toEqual({ ok: true });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0].args).toEqual([
      "-C", fixture.repo, "worktree", "remove", "--force", fixture.worktree.path,
    ]);
  });

  it.each(["missing", "relative", "inside", "multiline"])(
    "retains the exact target instead of falling back when the common Git directory is %s",
    async (condition) => {
      const root = await g1Directory("worktree-disposal-denied-");
      roots.push(root);
      const target = path.join(root, "target");
      await mkdir(target);
      await writeFile(path.join(target, "retained.txt"), "sole copy\n");
      const values = {
        missing: { code: 1, stdout: "", stderr: "fixture denied" },
        relative: { code: 0, stdout: ".git\n", stderr: "" },
        inside: { code: 0, stdout: `${path.join(target, ".git")}\n`, stderr: "" },
        multiline: { code: 0, stdout: `${path.join(root, ".git")}\nextra\n`, stderr: "" },
      };
      const calls = [];
      const runner = async (_command, args) => {
        calls.push(args);
        return values[condition];
      };
      expect(await removeWorktree({ repoPath: target, path: target, runner }))
        .toEqual({ ok: false, code: "WORKTREE_REMOVE_FAILED" });
      expect(calls).toEqual([["-C", target, "rev-parse", "--path-format=absolute", "--git-common-dir"]]);
      expect(await readFile(path.join(target, "retained.txt"), "utf8")).toBe("sole copy\n");
    },
  );
});
