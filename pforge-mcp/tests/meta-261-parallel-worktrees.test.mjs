import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ParallelScheduler } from "../orchestrator/schedulers.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Isolation Test",
      GIT_AUTHOR_EMAIL: "isolation@example.invalid",
      GIT_COMMITTER_NAME: "Isolation Test",
      GIT_COMMITTER_EMAIL: "isolation@example.invalid",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: "/dev/null",
      GIT_CONFIG_KEY_1: "commit.gpgsign",
      GIT_CONFIG_VALUE_1: "false",
    },
  }).trim();
}

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

function makeNodes() {
  return new Map(["1", "2"].map((number) => [number, {
    number,
    title: `Worker ${number}`,
    depends: [],
    parallel: true,
    scope: [`worker-${number}.txt`],
  }]));
}

function commitFile(cwd, filename, content) {
  writeFileSync(join(cwd, filename), content);
  git(cwd, "add", "--", filename);
  git(cwd, "commit", "--quiet", "-m", `write ${filename}`);
}

function runBatch(projectDir, executeFn, options = {}) {
  const { nodes = makeNodes(), eventBus = { emit() {} }, ...executionOptions } = options;
  return new ParallelScheduler(eventBus, 2).execute(
    nodes, [...nodes.keys()], executeFn, { projectDir, ...executionOptions },
  );
}

describe("meta #261 - parallel slice commit isolation", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "pforge-parallel-"));
    git(projectDir, "init", "--quiet");
    git(projectDir, "config", "user.name", "Isolation Test");
    git(projectDir, "config", "user.email", "isolation@example.invalid");
    git(projectDir, "config", "commit.gpgsign", "false");
    git(projectDir, "config", "core.autocrlf", "false");
    git(projectDir, "config", "core.hooksPath", join(projectDir, "no-hooks"));
    writeFileSync(join(projectDir, ".gitignore"), ".forge/\nnode_modules/\n.env\n");
    writeFileSync(join(projectDir, "shared.txt"), "base\n");
    git(projectDir, "add", ".gitignore");
    git(projectDir, "add", "shared.txt");
    git(projectDir, "commit", "--quiet", "-m", "fixture");
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("keeps simultaneous staging out of the other worker's commit", async () => {
    const bothStaged = deferred();
    const firstCommitted = deferred();
    const workingDirectories = new Set();
    let stagedCount = 0;
    const nodes = makeNodes();

    const results = await new ParallelScheduler({ emit() {} }, 2).execute(
      nodes,
      ["1", "2"],
      async (slice) => {
        const cwd = slice.worktreePath || projectDir;
        workingDirectories.add(cwd);
        const filename = `worker-${slice.number}.txt`;
        writeFileSync(join(cwd, filename), `worker ${slice.number}\n`);
        git(cwd, "add", "--", filename);
        if (++stagedCount === nodes.size) bothStaged.resolve();
        await bothStaged.promise;
        if (slice.number === "2") await firstCommitted.promise;
        let committedFiles = [];
        if (git(cwd, "diff", "--cached", "--name-only")) {
          git(cwd, "commit", "--quiet", "-m", `worker ${slice.number}`);
          committedFiles = git(cwd, "show", "--pretty=format:", "--name-only", "HEAD").split("\n");
        }
        if (slice.number === "1") firstCommitted.resolve();
        return { status: "passed", committedFiles };
      },
      { projectDir },
    );

    expect(results.map(({ status }) => status)).toEqual(["passed", "passed"]);
    expect(results.map(({ committedFiles }) => committedFiles)).toEqual([
      ["worker-1.txt"],
      ["worker-2.txt"],
    ]);
    expect(workingDirectories.size).toBe(2);
    expect(workingDirectories.has(projectDir)).toBe(false);
    expect(git(projectDir, "ls-files", "worker-*.txt").split("\n")).toEqual([
      "worker-1.txt",
      "worker-2.txt",
    ]);
    expect(git(projectDir, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree "))).toHaveLength(1);
  });

  it("refuses a dirty parent without running workers or consuming staged work", async () => {
    const originalHead = git(projectDir, "rev-parse", "HEAD");
    writeFileSync(join(projectDir, "operator.txt"), "operator work\n");
    git(projectDir, "add", "operator.txt");
    let invoked = false;
    const results = await runBatch(projectDir, async () => { invoked = true; return { status: "passed" }; });

    expect(invoked).toBe(false);
    expect(results.every((outcome) => outcome.status === "failed" && outcome.error.includes("clean parent"))).toBe(true);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(projectDir, "diff", "--cached", "--name-only")).toBe("operator.txt");
  });

  it("retains a failed worker's staged files and skips its descendants", async () => {
    const nodes = makeNodes();
    nodes.set("3", { number: "3", title: "Depends on failed worker", depends: ["1"] });
    const results = await runBatch(projectDir, async (slice) => {
      if (slice.number === "1") {
        writeFileSync(join(slice.worktreePath, "worker-1.txt"), "unfinished\n");
        git(slice.worktreePath, "add", "worker-1.txt");
        return { status: "failed", error: "gate failed" };
      }
      commitFile(slice.worktreePath, "worker-2.txt", "finished\n");
      return { status: "passed" };
    }, { nodes });

    expect(results.map(({ status }) => status)).toEqual(["failed", "passed", "skipped"]);
    expect(existsSync(join(projectDir, "worker-1.txt"))).toBe(false);
    expect(readFileSync(join(projectDir, "worker-2.txt"), "utf8")).toBe("finished\n");
    expect(git(results[0].worktreePath, "diff", "--cached", "--name-only")).toBe("worker-1.txt");
  });

  it("does not promote success with uncommitted work", async () => {
    const results = await runBatch(projectDir, async (slice) => {
      writeFileSync(join(slice.worktreePath, `worker-${slice.number}.txt`), "not committed\n");
      return { status: "passed" };
    });

    expect(results.every((outcome) => outcome.status === "failed" && outcome.error.includes("uncommitted"))).toBe(true);
    for (const outcome of results) expect(existsSync(join(outcome.worktreePath, `worker-${outcome.sliceId}.txt`))).toBe(true);
    expect(git(projectDir, "ls-files", "worker-*.txt")).toBe("");
  });

  it("resolves missed scope conflicts only in a disposable integration worktree", async () => {
    const completions = [];
    const runDir = join(projectDir, ".forge", "runs", "fixture");
    mkdirSync(runDir, { recursive: true });
    const results = await runBatch(projectDir, async (slice) => {
      commitFile(slice.worktreePath, "shared.txt", `worker ${slice.number}\n`);
      writeFileSync(join(runDir, `slice-${slice.number}.json`), JSON.stringify({ status: "passed" }));
      return { status: "passed" };
    }, {
      runDir,
      eventBus: { emit(event, payload) { if (event === "slice-completed") completions.push(payload.sliceId); } },
    });

    expect(results.map(({ status }) => status)).toEqual(["passed", "failed"]);
    expect(results[1].error).toContain("Promotion conflict");
    expect(existsSync(results[1].worktreePath)).toBe(true);
    expect(completions).toEqual(["1"]);
    expect(JSON.parse(readFileSync(join(runDir, "slice-2.json"), "utf8")).status).toBe("failed");
    expect(readFileSync(join(projectDir, "shared.txt"), "utf8")).toBe("worker 1\n");
    expect(git(projectDir, "status", "--porcelain")).toBe("");
  });

  it("rejects promotion when another process commits to the parent", async () => {
    const results = await runBatch(projectDir, async (slice) => {
      commitFile(slice.worktreePath, `worker-${slice.number}.txt`, "worker\n");
      if (slice.number === "1") commitFile(projectDir, "operator.txt", "operator\n");
      return { status: "passed" };
    });

    expect(results.every((outcome) => outcome.status === "failed" && outcome.error.includes("Parent HEAD changed"))).toBe(true);
    expect(git(projectDir, "ls-files", "worker-*.txt")).toBe("");
    expect(readFileSync(join(projectDir, "operator.txt"), "utf8")).toBe("operator\n");
    for (const outcome of results) expect(existsSync(outcome.worktreePath)).toBe(true);
  });

  it("retains worker commits and leaves the parent unchanged on abort", async () => {
    const controller = new AbortController();
    const originalHead = git(projectDir, "rev-parse", "HEAD");
    const results = await runBatch(projectDir, async (slice) => {
      commitFile(slice.worktreePath, `worker-${slice.number}.txt`, "worker\n");
      controller.abort();
      return { status: "passed" };
    }, { abortSignal: controller.signal });

    expect(results.every((outcome) => outcome.status === "failed" && outcome.error.includes("aborted"))).toBe(true);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(originalHead);
    for (const outcome of results) expect(existsSync(outcome.worktreePath)).toBe(true);
  });

  it("copies ignored dependencies and local configuration without sharing writable files", async () => {
    const dependencyPath = join("node_modules", "fixture", "index.js");
    mkdirSync(join(projectDir, "node_modules", "fixture"), { recursive: true });
    mkdirSync(join(projectDir, ".forge"), { recursive: true });
    writeFileSync(join(projectDir, dependencyPath), "original dependency\n");
    writeFileSync(join(projectDir, ".env"), "TEST_ENV=enabled\n");
    writeFileSync(join(projectDir, ".forge", "local.json"), '{"sample":true}\n');

    const results = await runBatch(projectDir, async (slice) => {
      expect(readFileSync(join(slice.worktreePath, dependencyPath), "utf8")).toBe("original dependency\n");
      expect(readFileSync(join(slice.worktreePath, ".env"), "utf8")).toBe("TEST_ENV=enabled\n");
      expect(readFileSync(join(slice.worktreePath, ".forge", "local.json"), "utf8")).toBe('{"sample":true}\n');
      writeFileSync(join(slice.worktreePath, dependencyPath), "changed only in this worker\n");
      return { status: "passed" };
    });

    expect(results.map(({ error }) => error)).toEqual([undefined, undefined]);
    expect(results.map(({ status }) => status)).toEqual(["passed", "passed"]);
    expect(readFileSync(join(projectDir, dependencyPath), "utf8")).toBe("original dependency\n");
  });

  it("does not promote branches whose gates pass alone but fail together", async () => {
    const nodes = makeNodes();
    const gateScript = "const fs = require('node:fs'); process.exit(Number(fs.existsSync('worker-1.txt') && fs.existsSync('worker-2.txt')))";
    for (const slice of nodes.values()) slice.validationGate = `node -e "${gateScript}"`;
    const originalHead = git(projectDir, "rev-parse", "HEAD");
    const results = await runBatch(projectDir, async (slice) => {
      commitFile(slice.worktreePath, `worker-${slice.number}.txt`, "worker\n");
      execFileSync(process.execPath, ["-e", gateScript], { cwd: slice.worktreePath, windowsHide: true });
      return { status: "passed" };
    }, { nodes });

    expect(results.map(({ status }) => status)).toEqual(["failed", "failed"]);
    expect(results.every((outcome) => outcome.status === "failed" && outcome.error.includes("integrated gate failed"))).toBe(true);
    expect(git(projectDir, "rev-parse", "HEAD")).toBe(originalHead);
    for (const outcome of results) expect(existsSync(outcome.worktreePath)).toBe(true);
  });
});

describe("Guard: parallel execution directories and orchestration artifacts stay separate", () => {
  const source = readFileSync(new URL("../orchestrator/run-plan.mjs", import.meta.url), "utf8");

  it("passes the isolated cwd and the parent artifact directory to the worker callback", () => {
    expect(source).toContain("cwd: slice.worktreePath ?? sliceCtx.cwd, artifactCwd: sliceCtx.cwd");
    expect(source).toContain("cwd, artifactCwd, model: effectiveModel");
    expect(source).toContain("projectDir: sliceCtx.dryRunWorker ? null : sliceCtx.cwd");
  });

  it("persists trajectories and model history outside temporary worktrees", () => {
    expect(source).toContain("_executeSlicePersistTrajectory({ sliceResult, workerResult, planName, slice, cwd: artifactCwd");
    expect(source).toContain("_executeSliceRecordModelPerf({ sliceResult, cwd: artifactCwd");
    expect(source).toContain("writeAutoSkill({ cwd: artifactCwd, record })");
  });
});
