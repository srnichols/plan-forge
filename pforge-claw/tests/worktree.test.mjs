import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { addWorktree, assertInside, isInside, removeWorktree, resolveCommand, resolveGhCommand, resolvePforgeCommand, run, sweepWorktrees } from "../src/jobs/worktree.mjs";
import { createStore } from "../src/state/store.mjs";
import { JOBS_STREAM, createJob, transition } from "../src/jobs/model.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => {
  const actual = await original();
  return { ...actual, spawn: (...args) => spawn.getMockImplementation() ? spawn(...args) : actual.spawn(...args) };
});

const dirs = [];
async function tempDir() {
  const dir = await g1Directory("g1-worktree-");
  dirs.push(dir);
  return dir;
}

async function git(cwd, args) {
  const result = await run("git", args, { cwd, env: process.env, exists: existsSync });
  if (result.code !== 0) throw new Error(result.stderr);
  return result;
}

afterEach(async () => {
  spawn.mockReset();
  vi.useRealTimers();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("worktree helpers", () => {
  it("creates and removes a real isolated git worktree with argument-array execution", async () => {
    const root = await tempDir();
    const repo = path.join(root, "repo");
    await mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@local"]);
    await git(repo, ["config", "user.name", "Test"]);
    await writeFile(path.join(repo, "README.md"), "initial\n");
    await git(repo, ["add", "README.md"]);
    await git(repo, ["commit", "-m", "initial"]);
    const calls = [];
    const runner = (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return run(cmd, args, { ...options, env: process.env, exists: existsSync });
    };

    const created = await addWorktree({
      home: path.join(root, "claw-home"),
      project: { id: "p1", repo: { path: repo, baseBranch: "main" } },
      job: { id: "j1" },
      runner,
    });
    expect(created.branch).toBe("claw/j1");
    expect(await readFile(path.join(created.path, ".claw-job.json"), "utf8")).toContain('"jobId":"j1"');
    expect(calls.some(({ args }) => args.includes("worktree")
      && args.includes("add") && args.includes("-b") && args.includes("claw/j1"))).toBe(true);
    expect(calls.every(({ options }) => options?.shell !== true)).toBe(true);
    expect(await removeWorktree({ repoPath: repo, path: created.path, runner })).toEqual({ ok: true });
  });

  it.each(["../x", path.resolve("tests", ".g1-fixtures", "escape"), "a/b"])("rejects unsafe job id %s", async (id) => {
    await expect(addWorktree({
      home: path.resolve("tests", ".g1-fixtures"),
      project: { id: "p1", repo: { path: path.resolve("tests", ".g1-fixtures") } },
      job: { id },
    })).rejects.toMatchObject({ code: "WORKTREE_BAD_IDENTIFIER" });
  });

  it("rejects targets inside the operator checkout and sibling-prefix escapes", async () => {
    const root = await tempDir();
    await expect(addWorktree({
      home: path.join(root, "inside"),
      project: { id: "p1", repo: { path: root } },
      job: { id: "j1" },
      runner: async (_cmd, args) => ({ code: 0, stdout: args.at(-1) === "--show-toplevel" ? `${root}\n` : "" }),
    })).rejects.toMatchObject({ code: "WORKTREE_IN_OPERATOR_TREE" });
    expect(await isInside("C:\\x", "C:\\x2")).toBe(false);
    await expect(assertInside("C:\\x", "C:\\x2")).rejects.toMatchObject({ code: "PATH_OUTSIDE_ROOT" });
  });

  it("rejects command shims and resolves automatic pforge launch by platform", () => {
    expect(() => resolveCommand("pforge.cmd")).toThrowError(expect.objectContaining({ code: "CMD_SHIM_REFUSED" }));
    expect(() => resolvePforgeCommand({ config: { runtimes: { pforgeCommand: ["pforge.bat"] } } }))
      .toThrowError(expect.objectContaining({ code: "CMD_SHIM_REFUSED" }));
    expect(resolvePforgeCommand({ config: {}, cwd: "C:\\repo", platform: "win32" }))
      .toEqual(["pwsh", "-NoProfile", "-File", path.join("C:\\repo", "pforge.ps1")]);
    expect(resolvePforgeCommand({ config: {}, cwd: "/repo", platform: "linux" }))
      .toEqual(["bash", path.join("/repo", "pforge.sh")]);
  });

  it("prefers executable Windows commands and refuses cmd shims with injected lookup", () => {
    const files = new Set([
      path.win32.join("C:\\tools", "git.cmd"),
      path.win32.join("C:\\tools", "git.exe"),
    ]);
    expect(resolveCommand("git", {
      platform: "win32",
      env: { PATH: "C:\\tools", PATHEXT: ".cmd;.exe;.com;.bat" },
      exists: (candidate) => files.has(candidate),
    })).toEqual([path.win32.join("C:\\tools", "git.exe")]);
    expect(() => resolveCommand("gh", {
      platform: "win32",
      env: { PATH: "C:\\tools", PATHEXT: ".exe;.cmd;.bat" },
      exists: (candidate) => candidate.endsWith(".cmd"),
    })).toThrowError(expect.objectContaining({
      code: "CMD_SHIM_REFUSED",
      details: { hint: expect.stringContaining("runtimes.ghCommand") },
    }));
    expect(() => resolveCommand("missing", {
      platform: "win32",
      env: { PATH: "C:\\empty", PATHEXT: ".exe;.com" },
      exists: () => false,
    })).toThrowError(expect.objectContaining({ code: "COMMAND_NOT_FOUND" }));
  });

  it("resolves detached Windows Path and PathExt keys without mutating the environment", () => {
    const env = { Path: "C:\\tools", PathExt: ".exe;.cmd" };
    const before = { ...env };
    expect(resolveCommand("git", {
      platform: "win32", env, exists: (candidate) => candidate === path.win32.join("C:\\tools", "git.exe"),
    })).toEqual([path.win32.join("C:\\tools", "git.exe")]);
    expect(env).toEqual(before);
  });

  it("validates ghCommand configuration without allowing command shims", () => {
    expect(resolveGhCommand({ config: {} })).toEqual(["gh"]);
    expect(resolveGhCommand({ config: { runtimes: { ghCommand: [process.execPath, "gh.mjs"] } } }))
      .toEqual([process.execPath, "gh.mjs"]);
    expect(() => resolveGhCommand({ config: { runtimes: { ghCommand: ["gh.cmd"] } } }))
      .toThrowError(expect.objectContaining({ code: "CMD_SHIM_REFUSED" }));
    expect(() => resolveGhCommand({ config: { runtimes: { ghCommand: [] } } }))
      .toThrowError(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });

  it("sweeps only old failed or cancelled worktrees, never running jobs", async () => {
    const root = await tempDir();
    const home = path.join(root, "home");
    const projectRoot = path.join(home, "worktrees", "p1");
    const failedPath = path.join(projectRoot, "failed");
    const runningPath = path.join(projectRoot, "running");
    await mkdir(failedPath, { recursive: true });
    await mkdir(runningPath, { recursive: true });
    await writeFile(path.join(failedPath, ".claw-job.json"), JSON.stringify({ jobId: "failed", projectId: "p1" }));
    await writeFile(path.join(runningPath, ".claw-job.json"), JSON.stringify({ jobId: "running", projectId: "p1" }));
    const store = createStore(path.join(root, "state"));
    for (const id of ["failed", "running"]) {
      const created = createJob({ id, type: "task", projectId: "p1" });
      store.append(JOBS_STREAM, created.event);
      let job = created.job;
      for (const state of ["awaiting-approval", "approved", "leased", "running"]) {
        const updated = transition(job, state);
        store.append(JOBS_STREAM, updated.event);
        job = updated.job;
      }
      if (id === "failed") {
        const failed = transition(job, "failed");
        store.append(JOBS_STREAM, failed.event);
      }
    }
    const removed = await sweepWorktrees({
      home,
      store,
      now: () => Date.now() + 10 * 24 * 60 * 60 * 1000,
      keepHours: 1,
      runner: async () => ({ code: 0 }),
    });
    expect(removed).toEqual([failedPath]);
    expect((await readFile(path.join(runningPath, ".claw-job.json"), "utf8"))).toContain("running");
  });

  it("awaits child termination after abort instead of treating its early error as cleanup proof", async () => {
    const child = new EventEmitter();
    child.pid = 101;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      child.emit("error", Object.assign(new Error("aborted"), { code: "ABORT_ERR" }));
      return true;
    });
    spawn.mockReturnValue(child);
    const controller = new AbortController();
    let settled = false;
    const pending = run(process.execPath, ["fixture-command"], { signal: controller.signal })
      .then((completed) => { settled = true; return completed; });
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    child.emit("close", null);
    expect((await pending).code).toBe(-1);
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("awaits timeout termination before returning COMMAND_TIMEOUT", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const child = new EventEmitter();
    child.pid = 102;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => true);
    spawn.mockReturnValue(child);
    let settled = false;
    const pending = run(process.execPath, ["fixture-command"], { timeoutMs: 1000 })
      .then((completed) => { settled = true; return completed; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    child.emit("close", null);
    expect(await pending).toMatchObject({ code: -1, error: { code: "COMMAND_TIMEOUT" } });
  });

  it("never sweeps the only undelivered canonical-history copy even after retention expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const root = await tempDir();
    const home = path.join(root, "home");
    const pendingPath = path.join(home, "worktrees", "p1", "pending-history");
    await mkdir(path.join(pendingPath, ".forge"), { recursive: true });
    await writeFile(path.join(pendingPath, ".claw-job.json"), JSON.stringify({
      jobId: "pending-history", projectId: "p1", l2Pending: true,
    }));
    await writeFile(path.join(pendingPath, ".forge", "openbrain-queue.jsonl"), '{"id":"sole-copy"}\n');
    const store = createStore(path.join(root, "state"));
    const created = createJob({ id: "pending-history", type: "task", projectId: "p1" });
    store.append(JOBS_STREAM, created.event);
    let job = created.job;
    for (const state of ["awaiting-approval", "approved", "leased", "running", "cancelled"]) {
      const updated = transition(job, state);
      store.append(JOBS_STREAM, updated.event);
      job = updated.job;
    }
    const runner = vi.fn(async () => ({ code: 0 }));
    expect(await sweepWorktrees({ home, store, runner, now: () => 10 * 24 * 60 * 60 * 1000, keepHours: 1 })).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
    expect(await readFile(path.join(pendingPath, ".forge", "openbrain-queue.jsonl"), "utf8")).toContain("sole-copy");
  });
});
