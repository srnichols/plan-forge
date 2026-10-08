import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureRepos } from "./helpers/fixture-repos.mjs";
import { createLeaseExecution, enrollCommand, leasedJob, runOneShot } from "../src/cli/worker.mjs";
import { createJobExecutor, resolveJobRuntime } from "../src/jobs/executor.mjs";
import { createLeaseJobSource } from "../src/jobs/lease-jobs.mjs";
import { buildLeaseGrant, signGrant } from "../src/protocol/lease-grant.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createHttpServer } from "../src/http.mjs";
import { run } from "../src/jobs/worktree.mjs";
import { collectCopySet } from "../src/jobs/bootstrap.mjs";

// Spawns real git / shell processes; the default 5 s budget flakes under full-suite load.
const PROCESS_TEST_TIMEOUT_MS = 30_000;

const cleanups = [];
const key = "b".repeat(64);
const runtimeFactory = ({ id }) => ({ id, run: async () => ({ status: "succeeded" }) });
const payload = (id = "j1") => ({ id, projectId: "fixture-1", type: "skill", skill: "check", mutating: false, runtime: "copilot-sdk" });
function signed(job, subject = "w1", laneId = "remote") {
  return { ...job, leaseGrant: signGrant({
    grant: buildLeaseGrant({
      leaseJob: job, laneId,
      proof: job.mutating ? { kind: "consumed", ref: "fixture-approval", decidedAt: 0 }
        : { kind: "read-only", ref: null, decidedAt: null },
    }), subject, key,
  }) };
}
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const repos = await createFixtureRepos(1, { withForge: true, ghShim: true });
  cleanups.push(() => repos.cleanup());
  const project = {
    id: "fixture-1", homeLane: "remote", models: { work: "fixture-model" },
    repo: { path: repos.projects[0].repoPath, baseBranch: "main" },
  };
  const home = path.join(repos.directory, "worker-home");
  await mkdir(home);
  const config = {
    projects: [project], bootstrap: { copy: [], install: "none" },
    runtimes: { ghCommand: repos.ghShim.command },
  };
  await writeFile(path.join(project.repo.path, ".forge.json"), JSON.stringify({
    v: 1, models: project.models, runtimes: config.runtimes,
  }));
  for (const args of [["add", ".forge.json"], ["commit", "-m", "fixture model config"], ["push", "origin", "main"]]) {
    expect((await run("git", ["-C", project.repo.path, ...args])).code).toBe(0);
  }
  const runner = async (command, args, options) => {
    if (args.includes("smith") || args.at(-1) === "ci") return { code: 0, stdout: "", stderr: "" };
    if (command === "git") return run(command, ["-c", "user.name=Claw fixture", "-c", "user.email=claw@example.test", ...args], options);
    return run(command, args, options);
  };
  const ctx = {
    home, config, runner, bus: new EventEmitter(), features: [],
    secrets: { redact: (text) => text }, registry: undefined,
  };
  return { repos, project, ctx, runner, home };
}

describe("lease-scoped runner execution", () => {
  it("runs in a worktree, never the checkout, then publishes and defers cleanup until L2", async () => {
    const { repos, project, ctx, home } = await fixture();
    const before = await run("git", ["-C", project.repo.path, "rev-parse", "HEAD"]);
    let cwd;
    const execution = createLeaseExecution({
      ctx, subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id }) => ({ id, async run(input) {
        cwd = input.cwd;
        expect(input.prompt).toBe("fixture task");
        expect(input.model).toBe("fixture-model");
        await writeFile(path.join(cwd, "remote-output.txt"), "runner output");
        await mkdir(path.join(cwd, ".forge", "runs", "j1"), { recursive: true });
        await writeFile(path.join(cwd, ".forge", "runs", "j1", "result.json"), '{"ok":true}');
        return { status: "succeeded" };
      } }),
      clients: { call: async () => ({ ok: true }) },
    });
    const job = signed({ ...payload(), type: "task", mutating: true, prompt: "fixture task" });
    const runtime = await execution.runtimeFor(job);
    const result = await runtime.run(job);
    expect(result.status).toBe("succeeded");
    expect(result.result.publish.prUrl).toMatch(/^https:\/\//);
    expect(cwd.startsWith(home + path.sep)).toBe(true);
    expect((await run("git", ["-C", project.repo.path, "status", "--porcelain"])).stdout).toBe("");
    expect((await run("git", ["-C", project.repo.path, "rev-parse", "HEAD"])).stdout).toBe(before.stdout);
    expect((await run("git", ["--git-dir", repos.projects[0].originPath, "show-ref", "--verify", "refs/heads/claw/j1"])).code).toBe(0);
    const delta = await execution.l2.collect({ forgeDir: execution.l2.forgeDirFor(job) });
    expect(delta.files.some((file) => file.rel === "runs/j1/result.json")).toBe(true);
    await access(cwd);
    await execution.afterJob({ job, event: { data: { status: "succeeded" } } });
    await expect(access(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  }, PROCESS_TEST_TIMEOUT_MS);
  it("refuses execution without a valid approval grant before a workspace exists", async () => {
    const { ctx, home } = await fixture();
    const execution = createLeaseExecution({ ctx, clients: {}, subject: "w1", laneId: "remote", key, runtimeFactory });
    expect(() => execution.runtimeFor(payload())).toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    await expect(access(path.join(home, "worktrees"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => leasedJob(signed(payload()), { subject: "w2", laneId: "remote", key })).toThrow();
  });
  it("lease runtime skips caller-role check only when pre-resolved and local lanes reject supplied runtime", async () => {
    const config = { runtimes: { default: "copilot-sdk" } };
    await expect(resolveJobRuntime({ job: {}, config, runtimeFactory })).rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
    await expect(resolveJobRuntime({ job: { runtime: "copilot-sdk" }, config, runtimeFactory })).resolves.toMatchObject({ id: "copilot-sdk" });
    const executor = createJobExecutor({ ctx: { config }, clients: {}, runtimeFactory });
    await expect(executor.runtimeFor({ runtime: "copilot-sdk" })).rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
  });
  it("rejects foreign jobs and stale lease-source transitions without a dispatcher store", () => {
    const source = createLeaseJobSource(payload());
    const initial = source.get("j1");
    source.append(initial, "running");
    expect(source.get("other")).toBeNull();
    expect(() => source.append(initial, "failed")).toThrowError(expect.objectContaining({ code: "JOB_REPLAY_MISMATCH" }));
    expect(() => source.append({ ...initial, id: "other" }, "running")).toThrow();
  });
  it("generates and rotates a lane secret without printing it", async () => {
    const { home } = await fixture();
    const output = [];
    vi.spyOn(process.stdout, "write").mockImplementation((text) => { output.push(String(text)); return true; });
    const config = { lanes: [{ id: "pods", kind: "k8s", k8s: { laneSecret: "FIXTURE_LANE_KEY" } }] };
    await enrollCommand({ home, config, laneId: "pods" });
    const first = JSON.parse(await readFile(path.join(home, "secrets.json"), "utf8")).FIXTURE_LANE_KEY;
    expect(first).toHaveLength(64);
    expect(output.join("")).not.toContain(first);
    expect(output).toEqual(["FIXTURE_LANE_KEY\n"]);
    await expect(enrollCommand({ home, config, laneId: "pods" })).rejects.toMatchObject({ code: "K8S_LANE_SECRET_EXISTS" });
    await enrollCommand({ home, config, laneId: "pods", rotate: true });
    expect(JSON.parse(await readFile(path.join(home, "secrets.json"), "utf8")).FIXTURE_LANE_KEY).not.toBe(first);
  });
  it.each([false, true])("runs a one-shot job end to end or refuses it without a valid approval grant (tampered: %s)", async (tampered) => {
    const { repos, runner } = await fixture();
    const workdir = path.join(repos.directory, "pod");
    await mkdir(workdir);
    const root = repos.projects[0].repoPath;
    const plain = {
      ...payload("pod1"), type: "task", mutating: true, prompt: "pod task",
      project: { id: "fixture-1", repo: { url: repos.projects[0].originPath, defaultBranch: "main" }, bootstrap: {} },
      bootstrapFiles: await collectCopySet({ repoPath: root }),
    };
    const registry = createWorkerRegistry({
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
    const server = createWorkerServer({ registry, enrollment: {}, secrets: {}, jobLanes: ["pods"], jobKeyFor: () => key });
    server.attach(http);
    const { port } = await http.listen();
    cleanups.push(async () => { server.close(); registry.close(); await http.close(); });
    registry.registerPending("pods", "pod1", { deadlineMs: Date.now() + 60_000 });
    const prepared = signed(plain, "job:pod1", "pods");
    if (tampered) prepared.leaseGrant.jobDigest = "a".repeat(64);
    const { iterator } = registry.enqueue("pods", { kind: "job", job: prepared });
    const env = {
      PFORGE_CLAW_JOB_ID: "pod1", PFORGE_CLAW_JOB_KEY: key, PFORGE_CLAW_LANE_ID: "pods",
      PFORGE_CLAW_JOB_DEADLINE_SECONDS: "60", PFORGE_CLAW_DISPATCHER_URL: `ws://127.0.0.1:${port}/claw/workers`,
    };
    const code = runOneShot(env, {
      workdir, runner, finalize: async () => ({ status: "ok" }),
      runtimeFactory: ({ id }) => ({ id, async run(input) {
        expect(input.prompt).toBe("pod task");
        await writeFile(path.join(input.cwd, "pod-output.txt"), "pod runtime output");
        await mkdir(path.join(input.cwd, ".forge", "runs", "pod1"), { recursive: true });
        await writeFile(path.join(input.cwd, ".forge", "runs", "pod1", "run.json"), '{"ok":true}');
        return { status: "succeeded" };
      } }),
      clientsFactory: () => ({ call: async () => ({ ok: true }), closeAll: async () => {} }),
    });
    const events = [];
    for await (const event of iterator) events.push(event);
    if (tampered) {
      expect(await code).toBe(1);
      expect(events.at(-1).data).toMatchObject({ status: "failed", error: "LEASE_GRANT_INVALID" });
      await expect(access(path.join(workdir, "repo"))).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    expect(await code).toBe(0);
    expect(events.at(-1).data.status).toBe("succeeded");
    expect(events.some((event) => event.type === "artifact" && event.data.kind === "l2-delta")).toBe(true);
    expect(events.some((event) => event.type === "artifact" && event.data.kind === "pr")).toBe(true);
    expect((await run("git", ["-C", path.join(workdir, "repo"), "branch", "--show-current"])).stdout.trim()).toBe("claw/pod1");
    expect((await run("git", ["-C", root, "status", "--porcelain"])).stdout).toBe("");
  });
  it("fails with l2-sync-incomplete when a one-shot ack misses its deadline", async () => {
    const { repos } = await fixture();
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const execution = runOneShot({
      PFORGE_CLAW_JOB_ID: "pod1", PFORGE_CLAW_JOB_KEY: key, PFORGE_CLAW_LANE_ID: "pods",
      PFORGE_CLAW_JOB_DEADLINE_SECONDS: "1", PFORGE_CLAW_DISPATCHER_URL: "ws://127.0.0.1:1/claw/workers",
    }, { workdir: repos.directory });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await execution).toBe(1);
    expect(error).toHaveBeenCalledWith("l2-sync-incomplete");
  });
});
