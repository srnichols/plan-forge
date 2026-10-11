import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, onTestFailed, vi } from "vitest";
import { createFixtureRepos } from "./helpers/fixture-repos.mjs";
import { createLeaseExecution, enrollCommand, leasedJob, runOneShot } from "../src/cli/worker.mjs";
import { createJobExecutor, resolveJobRuntime } from "../src/jobs/executor.mjs";
import { createLeaseJobSource } from "../src/jobs/lease-jobs.mjs";
import { buildLeaseGrant, signGrant } from "../src/protocol/lease-grant.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { run } from "../src/jobs/worktree.mjs";
import { assembleDeltaChunks, encodeDeltaChunks } from "../src/memory/l2-sync.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { matchesApplicationAck } from "../src/protocol/l2-ack.mjs";
import { createG1ProjectClients, drain } from "./g1-runner-fixture.mjs";
import {
  createWorkerFixtureTransport, observeWorkerFixtureSocket, prepareWorkerFixtureJob, writeWorkerFixtureMcp,
} from "./worker-authority-fixture.mjs";

// Spawns real git / shell processes; the default 5 s budget flakes under full-suite load.
const PROCESS_TEST_TIMEOUT_MS = 30_000;
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

const cleanups = [];
const key = "b".repeat(64);
const WORKER_JOB_ID = "a1000001";
const POD_JOB_ID = "b1000001";
const runtimeFactory = ({ id }) => ({ id, run: async () => ({ status: "succeeded" }) });
const payload = (id = WORKER_JOB_ID) => ({ id, projectId: "fixture-1", type: "skill", skill: "check", mutating: false, runtime: "copilot-sdk" });
function signed(job, subject = "w1", laneId = "remote") {
  return { ...job, leaseGrant: signGrant({
    grant: {
      ...buildLeaseGrant({
        leaseJob: job, laneId,
        proof: job.mutating ? { kind: "consumed", ref: "fixture-approval", decidedAt: 0 }
          : { kind: "read-only", ref: null, decidedAt: null },
      }),
      leaseId: "l1", attempt: 1,
    }, subject, key,
  }) };
}
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}, PROCESS_TEST_TIMEOUT_MS);

async function fixture() {
  const directory = await mkdtemp(path.join(TEST_DIRECTORY, ".worker-execution-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const repos = await createFixtureRepos(1, { directory, withForge: true, ghShim: true });
  cleanups.push(() => repos.cleanup());
  const project = {
    id: "fixture-1", homeLane: "canonical", models: { work: "fixture-model" },
    repo: { path: repos.projects[0].repoPath, baseBranch: "main" },
  };
  const home = path.join(repos.directory, "worker-home");
  await mkdir(home);
  const config = {
    allowlist: [{ channel: "telegram", userId: "owner", role: "owner" }],
    lanes: [{ id: "canonical", kind: "local" }, { id: "remote", kind: "remote" }, { id: "pods", kind: "k8s" }],
    projects: [project], bootstrap: { copy: [], install: "none" },
    runtimes: { ghCommand: repos.ghShim.command },
  };
  await writeFile(path.join(project.repo.path, ".forge.json"), JSON.stringify({
    v: 1, models: project.models, runtimes: config.runtimes,
  }));
  await writeWorkerFixtureMcp(project.repo.path);
  for (const args of [["add", ".forge.json", ".vscode/mcp.json"], ["commit", "-m", "fixture model config"], ["push", "origin", "main"]]) {
    expect((await run("git", ["-C", project.repo.path, ...args])).code).toBe(0);
  }
  const controller = new AbortController();
  const pending = new Set();
  const operations = [];
  const runner = (command, args, options = {}) => {
    if (args.includes("smith") || args.at(-1) === "ci") return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    const operation = { command, args, requireSettlement: options.requireSettlement === true, state: "pending" };
    operations.push(operation);
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const argv = command === "git" ? ["-c", "user.name=Claw fixture", "-c", "user.email=claw@example.test", ...args] : args;
    const execution = run(command, argv, {
      ...options, signal, onRootReady: async (root) => {
        operation.root = root;
        await options.onRootReady?.(root);
      },
    }).then((completed) => {
      Object.assign(operation, {
        state: "settled", code: completed.code, settlementConfirmed: completed.settlementConfirmed,
      });
      return completed;
    }).finally(() => pending.delete(execution));
    pending.add(execution);
    return execution;
  };
  cleanups.push(async () => {
    controller.abort();
    await Promise.allSettled([...pending]);
  });
  onTestFailed(() => console.error("Owned external runner evidence", JSON.stringify(operations.slice(-4))));
  const ctx = {
    home, config, runner, bus: new EventEmitter(), features: [],
    secrets: { redact: (text) => text }, registry: undefined,
  };
  return { repos, project, ctx, runner, home, controller };
}

function fixtureClients(config, { env = {} } = {}) {
  const clients = createG1ProjectClients({ config, env });
  cleanups.push(() => clients.closeAll());
  return clients;
}

describe("lease-scoped runner execution", () => {
  it("runs in a worktree, never the checkout, then publishes and defers cleanup until L2", async () => {
    const { repos, project, ctx, home } = await fixture();
    const before = await run("git", ["-C", project.repo.path, "rev-parse", "HEAD"]);
    const receiver = createL2Receiver({ config: ctx.config, currentLaneId: "canonical" });
    const registry = createWorkerRegistry({
      requireL2: true, applyL2: receiver.receive,
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    const transport = await createWorkerFixtureTransport({ root: home, registry, lanes: ["remote"] });
    await transport.enrollment.register({ workerId: "w1", laneId: "remote", secret: key });
    const observed = observeWorkerFixtureSocket({ hold: (packet) => packet.t === "l2-applied" });
    const runtimeCompleted = Promise.withResolvers();
    const cleanupRequested = Promise.withResolvers();
    const allowCleanup = Promise.withResolvers();
    const cleanupCompleted = Promise.withResolvers();
    let agent;
    let cwd;
    const execution = createLeaseExecution({
      ctx: {
        ...ctx, isCurrentLease: (job) => agent.isCurrentLease(job),
        withPublication: (options, publish) => agent.withPublication(options, publish),
      },
      subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id }) => ({ id, async run(input) {
        cwd = input.cwd;
        expect(input.prompt).toBe("fixture task");
        expect(input.model).toBe("fixture-model");
        await writeFile(path.join(cwd, "remote-output.txt"), "runner output");
        await mkdir(path.join(cwd, ".forge", "runs", WORKER_JOB_ID), { recursive: true });
        await writeFile(path.join(cwd, ".forge", "runs", WORKER_JOB_ID, "result.json"), '{"ok":true}');
        return { status: "succeeded" };
      } }),
      clients: fixtureClients(ctx.config),
    });
    agent = createWorkerAgent({
      url: transport.url, workerId: "w1", secret: key, laneId: "remote",
      capabilities: { os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: [project.id] },
      WebSocketImpl: observed.WebSocketImpl, verifyLease: execution.verifyLease, l2: execution.l2,
      localLane: createLocalLane({ runtimeFor: async (job) => {
        let runtime;
        try {
          runtime = await execution.runtimeFor(job);
        } catch (error) {
          runtimeCompleted.reject(error);
          throw error;
        }
        return { id: runtime.id, async run(input, options) {
          try {
            const result = await runtime.run(input, options);
            runtimeCompleted.resolve({ job, result });
            return result;
          } catch (error) {
            runtimeCompleted.reject(error);
            throw error;
          }
        } };
      } }),
      afterJob: async (hook) => {
        cleanupRequested.resolve(hook);
        await allowCleanup.promise;
        const completed = await execution.afterJob(hook);
        cleanupCompleted.resolve(completed);
        return completed;
      },
    });
    cleanups.push(async () => {
      allowCleanup.resolve();
      agent.stop();
      await agent.drain();
      await transport.close();
    });
    agent.start();
    await expect.poll(() => registry.snapshot().byLane.remote?.publicationCapable).toBe(1);
    const prepared = await prepareWorkerFixtureJob({
      root: home, config: ctx.config, laneId: "remote",
      job: { id: WORKER_JOB_ID, projectId: project.id, type: "task", mutating: true, prompt: "fixture task" },
    });
    const eventsCompleted = drain(registry.enqueue("remote", { kind: "job", job: prepared }).iterator);
    const { job, result } = await runtimeCompleted.promise;
    expect(result.status).toBe("succeeded");
    expect(result.result.publish.prUrl).toMatch(/^https:\/\//);
    expect(cwd.startsWith(home + path.sep)).toBe(true);
    expect((await run("git", ["-C", project.repo.path, "status", "--porcelain"])).stdout).toBe("");
    expect((await run("git", ["-C", project.repo.path, "rev-parse", "HEAD"])).stdout).toBe(before.stdout);
    expect((await run("git", ["--git-dir", repos.projects[0].originPath, "show-ref", "--verify", `refs/heads/claw/${job.id}`])).code).toBe(0);
    await expect.poll(() => observed.held.some((packet) => packet.t === "l2-applied")).toBe(true);
    const chunks = observed.sent.filter((packet) => packet.event?.data?.kind === "l2-delta").map((packet) => packet.event.data);
    const delta = assembleDeltaChunks({ chunks });
    expect(delta.files.some((file) => file.rel === `runs/${job.id}/result.json`)).toBe(true);
    await access(cwd);
    await execution.afterJob({ job, event: { data: { status: "succeeded" } } });
    await expect(access(cwd)).resolves.toBeUndefined();
    expect(observed.sent.some((packet) => packet.event?.type === "finished")).toBe(false);
    const applied = await receiver.receive({
      jobId: job.id, projectId: job.projectId, deltaId: chunks[0].deltaId,
      sha256Total: chunks[0].sha256Total, chunks,
    });
    expect(applied.ok).toBe(true);
    expect(await readFile(path.join(project.repo.path, ".forge", "runs", job.id, "result.json"), "utf8"))
      .toBe('{"ok":true}');
    const applicationAck = observed.held.find((packet) => packet.t === "l2-applied");
    expect(matchesApplicationAck(applied, applicationAck)).toBe(true);
    observed.receive(applicationAck);
    const hook = await cleanupRequested.promise;
    expect(await execution.afterJob({
      ...hook, applicationAck: { ...hook.applicationAck, attempt: hook.applicationAck.attempt + 1 },
    })).toMatchObject({ ok: false });
    await expect(access(cwd)).resolves.toBeUndefined();
    allowCleanup.resolve();
    expect(await cleanupCompleted.promise).toEqual({ ok: true });
    const events = await eventsCompleted;
    expect(events.at(-1).data).toMatchObject({ status: "succeeded", l2: { ok: true } });
    expect(registry.completion(job.id)).toMatchObject({ ok: true, applicationAck: { jobId: job.id, projectId: job.projectId, ok: true } });
    await expect(access(cwd)).rejects.toMatchObject({ code: "ENOENT" });
  }, PROCESS_TEST_TIMEOUT_MS);
  it("refuses execution without a valid approval grant before a workspace exists", async () => {
    const { ctx, home } = await fixture();
    const execution = createLeaseExecution({ ctx, clients: {}, subject: "w1", laneId: "remote", key, runtimeFactory });
    expect(() => execution.runtimeFor(payload())).toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    await expect(access(path.join(home, "worktrees"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => leasedJob(signed(payload()), { subject: "w2", laneId: "remote", key })).toThrow();
  }, PROCESS_TEST_TIMEOUT_MS);
  it("lease runtime skips caller-role check only when pre-resolved and local lanes reject supplied runtime", async () => {
    const config = { runtimes: { default: "copilot-sdk" } };
    await expect(resolveJobRuntime({ job: {}, config, runtimeFactory })).rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
    await expect(resolveJobRuntime({ job: { runtime: "copilot-sdk" }, config, runtimeFactory })).resolves.toMatchObject({ id: "copilot-sdk" });
    const executor = createJobExecutor({ ctx: { config }, clients: {}, runtimeFactory });
    await expect(executor.runtimeFor({ runtime: "copilot-sdk" })).rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
  });
  it("rejects foreign jobs and stale lease-source transitions without a dispatcher store", () => {
    const source = createLeaseJobSource(payload());
    const initial = source.get(WORKER_JOB_ID);
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
  }, PROCESS_TEST_TIMEOUT_MS);
  it.each([[false, false], [true, false], [false, true]])(
    "runs a one-shot job end to end or retains an unsafe source (tampered: %s, native-unconfirmed: %s)", async (
      tampered, nativeUnconfirmed,
    ) => {
    const { repos, project, ctx, runner, home } = await fixture();
    const workdir = path.join(repos.directory, "pod");
    await mkdir(workdir);
    const root = repos.projects[0].repoPath;
    const podConfig = {
      ...ctx.config,
      projects: [{
        ...project, repo: { ...project.repo, url: "https://fixture.test/repository.git", defaultBranch: "main" },
        models: { work: "signed-pod-model" },
        bootstrap: { copy: [".forge.json", ".forge/fm-prefs.json"], env: ["POD_BOOTSTRAP_CANARY"], install: "none" },
      }],
    };
    const receiver = createL2Receiver({
      config: {
        projects: [{ id: "fixture-1", homeLane: "canonical", repo: { path: root } }],
        lanes: [{ id: "canonical", kind: "local" }, { id: "pods", kind: "k8s" }],
      }, currentLaneId: "canonical",
    });
    const registry = createWorkerRegistry({
      requireL2: true, applyL2: receiver.receive,
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    const transport = await createWorkerFixtureTransport({ root: home, registry, jobLanes: ["pods"], jobKeyFor: () => key });
    cleanups.push(() => transport.close());
    registry.registerPending("pods", POD_JOB_ID, { deadlineMs: Date.now() + 60_000 });
    const prepared = await prepareWorkerFixtureJob({
      root: home, config: podConfig, laneId: "pods",
      job: { id: POD_JOB_ID, projectId: project.id, type: "task", mutating: true, prompt: "pod task" },
    });
    const queued = tampered ? { ...prepared, leaseGrant: { ...prepared.leaseGrant, jobDigest: "a".repeat(64) } } : prepared;
    const { iterator } = registry.enqueue("pods", { kind: "job", job: queued });
    const env = {
      PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SYSTEMROOT: process.env.SYSTEMROOT,
      PFORGE_CLAW_JOB_ID: POD_JOB_ID, PFORGE_CLAW_JOB_KEY: key, PFORGE_CLAW_LANE_ID: "pods",
      PFORGE_CLAW_JOB_DEADLINE_SECONDS: "60", PFORGE_CLAW_DISPATCHER_URL: transport.url,
      POD_BOOTSTRAP_CANARY: "pod-bootstrap-only-canary",
    };
    let finalized;
    const code = runOneShot(env, {
      workdir,
      runner: async (command, args, options) => {
        const completed = await runner(command, args[0] === "clone"
          ? args.map((argument) => argument === "https://fixture.test/repository.git" ? repos.projects[0].originPath : argument)
          : args, options);
        return nativeUnconfirmed && args.includes("push") ? { ...completed, settlementConfirmed: false } : completed;
      },
      finalize: async (options) => {
        finalized = options;
        expect(options.env.POD_BOOTSTRAP_CANARY).toBe("pod-bootstrap-only-canary");
        const delta = await options.collectDelta();
        const chunks = encodeDeltaChunks({ delta, deltaId: `${POD_JOB_ID}:pod-finalize:v1` });
        const transfer = {
          jobId: POD_JOB_ID, projectId: "fixture-1", deltaId: `${POD_JOB_ID}:pod-finalize:v1`,
          sha256Total: chunks[0].sha256Total, chunks,
        };
        const ack = await options.awaitAck({ delta, transfer });
        expect(ack).toMatchObject({ jobId: POD_JOB_ID, projectId: "fixture-1", deltaId: `${POD_JOB_ID}:pod-finalize:v1`, ok: true });
        return { status: "ok" };
      },
      runtimeFactory: ({ id }) => ({ id, async run(input) {
        expect(input.prompt).toBe("pod task");
        expect(input.model).toBe("signed-pod-model");
        await writeFile(path.join(input.cwd, "pod-output.txt"), "pod runtime output");
        await mkdir(path.join(input.cwd, ".forge", "runs", POD_JOB_ID), { recursive: true });
        await writeFile(path.join(input.cwd, ".forge", "runs", POD_JOB_ID, "run.json"), '{"ok":true}');
        return { status: "succeeded" };
      } }),
      clientsFactory: ({ config, env: clientEnv }) => {
        expect(clientEnv.POD_BOOTSTRAP_CANARY).toBe("pod-bootstrap-only-canary");
        return fixtureClients(config, { env: clientEnv });
      },
    });
    const events = [];
    for await (const event of iterator) {
      if (event.type === "started") expect(registry.snapshot().byLane.pods.publicationCapable).toBe(1);
      events.push(event);
    }
    if (tampered) {
      expect(await code).toBe(1);
      expect(events.at(-1).data).toMatchObject({ status: "failed", error: "LEASE_GRANT_INVALID" });
      await expect(access(path.join(workdir, "repo"))).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    if (nativeUnconfirmed) {
      expect(await code).toBe(1);
      expect(events.at(-1).data).toMatchObject({
        status: "failed", error: "LEASE_PUBLICATION_DENIED", settlementConfirmed: false,
      });
      expect(finalized).toBeUndefined();
      expect(events.some((event) => event.type === "artifact" && event.data.kind === "l2-delta")).toBe(false);
      expect(registry.completion(POD_JOB_ID)).toMatchObject({ ok: false, applicationAck: null });
      expect(await readFile(path.join(workdir, "repo", ".forge", "runs", POD_JOB_ID, "run.json"), "utf8"))
        .toBe('{"ok":true}');
      await expect(access(path.join(root, ".forge", "runs", POD_JOB_ID, "run.json")))
        .rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    expect(await code).toBe(0);
    expect(events.at(-1).data.status).toBe("succeeded");
    expect(events.some((event) => event.type === "artifact" && event.data.kind === "l2-delta")).toBe(true);
    expect(events.some((event) => event.type === "artifact" && event.data.kind === "pr")).toBe(true);
    expect(events.filter((event) => event.type === "artifact" && event.data.kind === "l2-delta")).toHaveLength(1);
    expect(finalized).toMatchObject({ jobId: POD_JOB_ID, projectId: "fixture-1" });
    expect(registry.completion(POD_JOB_ID)).toMatchObject({ ok: true, applicationAck: { ok: true } });
    expect(await readFile(path.join(root, ".forge", "runs", POD_JOB_ID, "run.json"), "utf8")).toBe('{"ok":true}');
    expect((await run("git", ["-C", path.join(workdir, "repo"), "branch", "--show-current"])).stdout.trim()).toBe(`claw/${POD_JOB_ID}`);
    expect((await run("git", ["-C", root, "check-ignore", path.join(".forge", "runs", POD_JOB_ID, "run.json")]))
      .stdout.trim()).toContain("run.json");
    expect((await run("git", ["-C", root, "status", "--porcelain"])).stdout.trim()).toBe("");
  }, PROCESS_TEST_TIMEOUT_MS);
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
  }, PROCESS_TEST_TIMEOUT_MS);
});
