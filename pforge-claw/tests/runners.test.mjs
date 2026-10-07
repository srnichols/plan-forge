import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createRunners, resolvePlan } from "../src/jobs/runners.mjs";
import { createStore } from "../src/state/store.mjs";
import { run } from "../src/jobs/worktree.mjs";

const directories = [];
async function tempDir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-runners-"));
  directories.push(directory);
  return directory;
}

async function command(cmd, args, options = {}) {
  const result = await run(cmd, args, options);
  if (result.code !== 0) throw new Error(result.stderr);
  return result;
}

async function makeFixture({
  type = "task",
  description = "do work",
  state = "approved",
  readOnly = false,
  runtime,
  features,
  jobFields = {},
} = {}) {
  const root = await tempDir();
  const repo = path.join(root, "repo");
  const home = path.join(root, "claw-home");
  await mkdir(repo, { recursive: true });
  await command("git", ["init", "-b", "main"], { cwd: repo });
  await command("git", ["config", "user.email", "test@local"], { cwd: repo });
  await command("git", ["config", "user.name", "Test"], { cwd: repo });
  await writeFile(path.join(repo, "README.md"), "base\n");
  if (type === "plan") {
    await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
    await writeFile(path.join(repo, "docs", "plans", "Phase-1-PLAN.md"), "# Plan\n");
  }
  await command("git", ["add", "-A"], { cwd: repo });
  await command("git", ["commit", "-m", "base"], { cwd: repo });
  const store = createStore(path.join(root, "state"));
  const created = createJob({ id: "j1", type, projectId: "p1", readOnly });
  const job = {
    ...created.job,
    description,
    planPath: type === "plan" ? "docs/plans/Phase-1-PLAN.md" : undefined,
    summary: "slice work",
    ...jobFields,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  let current = job;
  const initialTransitions = readOnly ? [] : (state === "approved"
    ? ["awaiting-approval", "approved"]
    : ["awaiting-approval"]);
  for (const next of initialTransitions) {
    const updated = transition(current, next);
    store.append(JOBS_STREAM, updated.event);
    current = updated.job;
  }
  const events = new EventEmitter();
  const busEvents = [];
  events.on("job.transition", (event) => busEvents.push(`transition:${event.to}`));
  events.on("job.finished", (event) => busEvents.push(`finished:${event.state}`));
  const calls = [];
  const runner = async (cmd, args, options = {}) => {
    const record = { cmd, args: [...args], options };
    calls.push(record);
    if (cmd === "gh") return { code: 0, stdout: "http://localhost/pr/1", stderr: "" };
    if (cmd === process.execPath && args.some((arg) => arg.endsWith("fake-pforge.mjs"))
      && args.at(-1) === "smith") return { code: 0, stdout: "smith ok", stderr: "" };
    if (cmd === "git" && args.includes("show-ref")) return run(cmd, args, options);
    if (cmd === "git" && args.includes("push")) return command(cmd, args, options);
    return command(cmd, args, options);
  };
  const mcpCalls = [];
  const mcp = async () => ({
    async call(name, input) {
      mcpCalls.push({ name, input });
      return name === "forge_watch_live" ? { text: "plan progress" } : { ok: true };
    },
  });
  const context = {
    home,
    config: {
      projects: [{ id: "p1", repo: { path: repo, baseBranch: "main" }, models: { work: "configured-work-model" } }],
      runtimes: { pforgeCommand: [process.execPath, "fake-pforge.mjs"] },
      bootstrap: { install: "none" },
    },
    store,
    bus: events,
    runtime: runtime ?? { run: async () => ({ ok: true, status: "succeeded" }) },
    mcp,
    mcpLaunch: { command: "node", args: [] },
    secrets: { redact: (text) => text },
    runner,
    features: features ?? [],
  };
  return { root, repo, home, store, job, context, calls, busEvents, mcpCalls };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("job runners", () => {
  it("refuses to run before stored approval", async () => {
    const f = await makeFixture({ state: "queued" });
    const runners = createRunners(f.context);
    await expect(runners.runJob(f.job, {})).rejects.toMatchObject({ code: "JOB_NOT_APPROVED" });
  });

  it("persists transitions in order, includes task context, and avoids duplicate lane events", async () => {
    let capturedTurn;
    const f = await makeFixture({
      runtime: { run: async (turn) => { capturedTurn = turn; return { ok: true, status: "succeeded" }; } },
      features: [{ taskContext: async () => ({ summary: "Useful context" }) }],
    });
    const result = await createRunners(f.context).runJob(f.job, { emit: () => {} });
    expect(result.status).toBe("succeeded");
    expect(capturedTurn.prompt).toContain("Useful context");
    expect(capturedTurn.context).toBeUndefined();
    expect(capturedTurn.onPermissionRequest).toBeTypeOf("function");
    expect(f.busEvents).toEqual(["transition:leased", "transition:running", "transition:succeeded", "finished:succeeded"]);
    expect(currentJobs(f.store).j1.state).toBe("succeeded");
  });

  it("fails closed when required feature context throws", async () => {
    const f = await makeFixture({ features: [{ taskContext: async () => { throw new Error("failure"); } }] });
    const result = await createRunners(f.context).task(f.job, {});
    expect(result).toMatchObject({ status: "failed", error: "TASK_CONTEXT_FAILED" });
    expect(f.busEvents.at(-1)).toBe("finished:failed");
  });

  it("runs queued read-only skill jobs on the read transition path", async () => {
    const f = await makeFixture({
      type: "skill",
      readOnly: true,
      jobFields: { skill: "inspect" },
    });
    const result = await createRunners(f.context).runJob(f.job, {});
    expect(result.status).toBe("succeeded");
    expect(f.mcpCalls.find(({ name }) => name === "forge_run_skill")).toMatchObject({
      input: {
        skill: "inspect",
        args: "",
        path: path.join(f.home, "worktrees", "p1", "j1"),
      },
    });
    expect(currentJobs(f.store).j1.state).toBe("succeeded");
  });

  it("does not push a failed task unless pushOnFailure is enabled", async () => {
    const f = await makeFixture({ runtime: { run: async () => { throw new Error("runtime failed"); } } });
    const result = await createRunners(f.context).task(f.job, {});
    expect(result.status).toBe("failed");
    expect(f.calls.some(({ args }) => args.includes("push"))).toBe(false);
  });

  it("publishes task commits through git and gh while preserving PR template headings", async () => {
    const root = await tempDir();
    const bare = path.join(root, "origin.git");
    const f = await makeFixture({
      runtime: { run: async (turn) => {
        await writeFile(path.join(turn.cwd, "result.txt"), "done\n");
        return { ok: true, status: "succeeded" };
      } },
    });
    await mkdir(path.join(f.repo, ".github"), { recursive: true });
    await writeFile(path.join(f.repo, ".github", "pull_request_template.md"), "## Summary\n\n## Tests\n");
    await command("git", ["-C", f.repo, "add", "-A"]);
    await command("git", ["-C", f.repo, "commit", "-m", "template"]);
    await command("git", ["init", "--bare", bare]);
    await command("git", ["-C", f.repo, "remote", "add", "origin", bare]);
    await command("git", ["-C", f.repo, "push", "-u", "origin", "main"]);
    const result = await createRunners(f.context).task(f.job, {});
    expect(result.status).toBe("succeeded");
    const prCall = f.calls.find(({ cmd }) => cmd === "gh");
    expect(prCall.args).toContain("pr");
    expect(prCall.args.at(-1)).toContain("## Summary");
    expect(prCall.args.at(-1)).toContain("Job: j1");
  });

  it("reports bootstrap failures and keeps the worktree", async () => {
    const f = await makeFixture();
    f.context.config.bootstrap.install = "invalid";
    const result = await createRunners(f.context).task(f.job, {});
    expect(result).toMatchObject({ status: "failed", error: "BOOTSTRAP_FAILED" });
    expect(f.busEvents.at(-1)).toBe("finished:failed");
  });

  it("runs plan jobs with the configured pforge argv and aborts through MCP", async () => {
    const f = await makeFixture({ type: "plan" });
    const script = path.join(f.root, "fake-pforge.mjs");
    await writeFile(script, "setInterval(() => {}, 1000);\n");
    f.context.config.runtimes.pforgeCommand = [process.execPath, script];
    const controller = new AbortController();
    const running = createRunners(f.context).plan(f.job, { signal: controller.signal });
    while (!f.mcpCalls.some(({ name }) => name === "forge_watch_live")) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    controller.abort();
    const result = await running;
    expect(result.status).toBe("cancelled");
    expect(f.mcpCalls.find(({ name }) => name === "forge_abort")).toMatchObject({
      input: {},
    });
    expect(f.mcpCalls.find(({ name }) => name === "forge_watch_live")).toMatchObject({
      input: {
        targetPath: path.join(f.home, "worktrees", "p1", "j1"),
        durationMs: 1000,
      },
    });
  });

  it("passes run-plan, quorum, and resume arguments to the configured executable", async () => {
    const f = await makeFixture({ type: "plan", jobFields: { quorum: "power", resumeFrom: 4 } });
    const script = path.join(f.root, "fake-pforge.mjs");
    const argsFile = path.join(f.root, "pforge-args.json");
    await writeFile(script, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));`);
    f.context.config.runtimes.pforgeCommand = [process.execPath, script];
    const result = await createRunners(f.context).plan(f.job, {});
    expect(result.status).toBe("succeeded");
    const args = JSON.parse(await readFile(argsFile, "utf8"));
    expect(args).toEqual([
      "run-plan",
      path.join(f.home, "worktrees", "p1", "j1", "docs", "plans", "Phase-1-PLAN.md"),
      "--quorum=power",
      "--resume-from",
      "4",
    ]);
  });
});

describe("resolvePlan", () => {
  it("returns exact, unique, multiple, and none matches", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "docs", "plans"), { recursive: true });
    await writeFile(path.join(root, "docs", "plans", "Phase-1-PLAN.md"), "one");
    expect(await resolvePlan({ root, input: "docs/plans/Phase-1-PLAN.md" }))
      .toMatchObject({ kind: "exact" });
    expect(await resolvePlan({ root, input: "Phase-1" })).toMatchObject({ kind: "unique" });
    await writeFile(path.join(root, "docs", "plans", "Phase-1-alt-PLAN.md"), "two");
    expect(await resolvePlan({ root, input: "Phase-1" })).toMatchObject({ kind: "multiple" });
    expect(await resolvePlan({ root, input: "absent" })).toEqual({ kind: "none", candidates: [] });
    await expect(resolvePlan({ root, input: "../outside" })).resolves.toMatchObject({ kind: "none" });
  });
});
