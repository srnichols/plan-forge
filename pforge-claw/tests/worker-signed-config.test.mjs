import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLeaseExecution, leasedJob } from "../src/cli/worker.mjs";
import { buildLeaseGrant, signGrant } from "../src/protocol/lease-grant.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createAgentRuntime } from "../src/runtime/agent-runtime.mjs";
import { encodeDeltaChunks } from "../src/memory/l2-sync.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createG1ProjectClients } from "./g1-runner-fixture.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const key = "signed-worker-fixture-key";
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function signed(job) {
  return { ...job, leaseGrant: signGrant({
    grant: {
      ...buildLeaseGrant({
        leaseJob: job, laneId: "remote", proof: { kind: "consumed", ref: "approved", decidedAt: 0 },
      }),
      leaseId: "l1", attempt: 1,
    }, subject: "w1", key,
  }) };
}

async function fixture() {
  const home = await mkdtemp(path.join(TEST_DIRECTORY, ".worker-config-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const repoPath = path.join(home, "checkout");
  await mkdir(repoPath);
  await writeFile(path.join(repoPath, "local.txt"), "local-choice");
  await writeFile(path.join(repoPath, "approved.txt"), "approved-choice");
  const calls = [];
  const runner = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (args.includes("--show-toplevel")) return { code: 0, stdout: repoPath, stderr: "" };
    if (args.includes("show-ref")) return { code: 1, stdout: "", stderr: "" };
    if (args.includes("worktree") && args.includes("add")) {
      const worktree = args.at(-2);
      await mkdir(path.join(worktree, ".vscode"), { recursive: true });
      await writeFile(path.join(worktree, ".vscode", "mcp.json"), JSON.stringify({
        servers: { "plan-forge": { command: process.execPath, args: ["fixture-mcp.mjs"] } },
      }));
    }
    if (args.includes("worktree") && args.includes("remove")) await rm(args.at(-1), { recursive: true });
    return { code: 0, stdout: args.includes("--count") ? "0" : "", stderr: "" };
  };
  const env = { LANE_BOOTSTRAP_KEY: "bootstrap-lane-canary", APPROVED_PROVIDER_KEY: "provider-lane-canary" };
  const secrets = await createSecrets({ env, trackNames: Object.keys(env) });
  const config = {
    projects: [{
      id: "p1", homeLane: "remote", models: { work: "local-model" },
      repo: { path: repoPath, baseBranch: "local-branch" },
      bootstrap: { copy: ["local.txt"], env: [], install: "none" },
    }],
    runtimes: { byok: { openai: { keySecret: "LOCAL_KEY", endpoint: "https://local.example" } } },
  };
  const ctx = { home, config, secrets, runner, bus: new EventEmitter(), features: [] };
  const job = signed({
    id: "j1", projectId: "p1", type: "task", prompt: "approved task", mutating: true,
    runtime: "openai", provider: { type: "openai", keySecret: "APPROVED_PROVIDER_KEY", endpoint: "https://approved.example" },
    project: {
      id: "p1", repo: { defaultBranch: "approved-branch" }, models: { work: "approved-model" },
      bootstrap: { copy: ["approved.txt"], env: ["LANE_BOOTSTRAP_KEY"], install: "ci" },
    },
  });
  return { home, repoPath, calls, secrets, config, ctx, job, env };
}

function fixtureClients(ctx) {
  const clients = createG1ProjectClients({
    config: ctx.config,
    env: {}, secrets: ctx.secrets,
  });
  cleanups.push(() => clients.closeAll());
  return clients;
}

describe("Guard: only verified worker composition owns external history delivery", () => {
  it("uses the verified home-worker lane without synthesizing a local canonical home", async () => {
    const source = await readFile(path.join(TEST_DIRECTORY, "..", "src", "cli", "worker.mjs"), "utf8");
    const composition = source.slice(source.indexOf("async function runWorker"), source.indexOf("function oneShotEnvironment"));
    expect(composition).toContain("if (identity.laneId !== laneId)");
    expect(composition).toMatch(/createProjectClients\(\{\s*config,\s*registry,\s*logger,\s*currentLaneId: laneId,/);
    expect(composition).toMatch(/buildLaunch\(\s*project, currentConfig, \{[\s\S]*?currentLaneId: laneId/);
    expect(composition).not.toMatch(/homeLane: ["']local["']/);
  });

  it("constructs the leased executor's literal trusted flag only after grant verification", async () => {
    const source = await readFile(path.join(TEST_DIRECTORY, "..", "src", "cli", "worker.mjs"), "utf8");
    const composition = source.slice(source.indexOf("export function createLeaseExecution"), source.indexOf("function createWorkerLogger"));
    const execution = composition.slice(composition.indexOf("runtimeFor: (job)"));
    expect(execution).toMatch(/const verified = leasedJob\([\s\S]*?ctx: \{ \.\.\.executionCtx, externalHistoryDelivery: true \}/);
    expect(composition).toContain("const executionCtx = { ...ctx, projectClients: clients }");
    expect(execution).toContain("executor.runtimeFor(verified)");
    expect(composition).not.toMatch(/(?:job|config|env)\.externalHistoryDelivery/);
  });

  it("constructs the one-shot executor's literal trusted flag only after grant verification", async () => {
    const source = await readFile(path.join(TEST_DIRECTORY, "..", "src", "cli", "worker.mjs"), "utf8");
    const execution = source.slice(source.indexOf("async function runPodLease"), source.indexOf("const agent = createWorkerAgent", source.indexOf("async function runPodLease")));
    expect(execution).toMatch(/const verified = leasedJob\([\s\S]*?ctx: \{[^\n]*externalHistoryDelivery: true/);
    expect(execution).toContain("executor.runtimeFor(verified)");
    expect(execution).not.toMatch(/(?:job|config|env)\.externalHistoryDelivery/);
  });
});

describe("signed worker execution configuration", () => {
  it.each([
    ["runtime", (job) => ({ runtime: "anthropic", provider: { ...job.provider, type: "anthropic" } })],
    ["provider", (job) => ({ provider: { ...job.provider, endpoint: "https://different.example" } })],
    ["models", (job) => ({ project: { ...job.project, models: { work: "different-approved-model" } } })],
    ["bootstrap", (job) => ({ project: { ...job.project, bootstrap: { ...job.project.bootstrap, install: "none" } } })],
    ["quorum", () => ({ quorum: "power" })],
    ["resume", () => ({ resumeFrom: 2 })],
  ])("keeps %s immutable when a reissued grant signs changed in-flight choices", async (_field, changed) => {
    const { ctx, job, calls } = await fixture();
    const execution = createLeaseExecution({
      ctx, clients: fixtureClients(ctx), subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id }) => ({ id, run: async () => ({ status: "succeeded" }) }),
    });
    await execution.runtimeFor(job);
    const reissued = signed({ ...job, ...changed(job) });
    expect(() => execution.verifyLease(reissued))
      .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    expect(calls).toEqual([]);
    expect(leasedJob(job, { subject: "w1", laneId: "remote", key }).project.models.work)
      .toBe("approved-model");
  });

  it("does not accept unsigned job/config/environment deferral requests or mutate the caller's trusted context", async () => {
    const { ctx, job, calls } = await fixture();
    ctx.config.externalHistoryDelivery = true;
    ctx.env = { externalHistoryDelivery: "true" };
    ctx.externalHistoryDelivery = false;
    const execution = createLeaseExecution({
      ctx, clients: {}, subject: "w1", laneId: "remote", key,
    });
    const { leaseGrant, ...unsigned } = job;
    expect(leaseGrant).toBeDefined();
    expect(() => execution.runtimeFor({ ...unsigned, externalHistoryDelivery: true }))
      .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    expect(() => execution.runtimeFor({ ...job, externalHistoryDelivery: true }))
      .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    expect(ctx.externalHistoryDelivery).toBe(false);
    expect(calls).toEqual([]);
  });

  it("uses signed models, branch, bootstrap files, environment and install before preparing a worker workspace", async () => {
    const { calls, secrets, ctx, job, env } = await fixture();
    let executionInput;
    let suppliedProvider;
    const execution = createLeaseExecution({
      ctx, clients: fixtureClients(ctx), subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id, config }) => createAgentRuntime({
        id, config, secrets,
        createSession: async ({ sessionConfig }) => {
          suppliedProvider = sessionConfig.provider;
          return {
            client: { stop: async () => [] },
            session: { async sendAndWait(input) { executionInput = input; }, disconnect: async () => {} },
          };
        },
      }),
    });

    const runtime = await execution.runtimeFor(job);
    env.APPROVED_PROVIDER_KEY = "rotated-provider-canary";
    const outcome = await runtime.run(job);
    expect(outcome.status).toBe("succeeded");
    const worktree = calls.find((call) => call.args.includes("worktree") && call.args.includes("add")).args.at(-2);
    expect(await readFile(path.join(worktree, "approved.txt"), "utf8")).toBe("approved-choice");
    await expect(access(path.join(worktree, "local.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls.find((call) => call.args.includes("worktree") && call.args.includes("add")).args.at(-1))
      .toBe("approved-branch");
    const install = calls.find((call) => call.args.at(-1) === "ci");
    expect(install.options.env.LANE_BOOTSTRAP_KEY).toBe("bootstrap-lane-canary");
    expect(suppliedProvider).toMatchObject({
      apiKey: "rotated-provider-canary", baseUrl: "https://approved.example",
    });
    expect(executionInput.prompt).toBe("approved task");
    expect(JSON.stringify(job)).not.toContain("provider-canary");
    expect(JSON.stringify(outcome)).not.toContain("provider-canary");
  });

  it("returns detached immutable verified choices and rejects tampering before any workspace or provider resolution", async () => {
    const { ctx, job, calls } = await fixture();
    const verified = leasedJob(job, { subject: "w1", laneId: "remote", key });
    expect(verified).not.toBe(job);
    expect(Object.isFrozen(verified.project.bootstrap.copy)).toBe(true);
    expect(Object.isFrozen(verified.provider)).toBe(true);
    const execution = createLeaseExecution({ ctx, clients: {}, subject: "w1", laneId: "remote", key });
    expect(() => execution.runtimeFor({ ...job, quorum: "power" }))
      .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    expect(calls).toEqual([]);
  });

  it("does not remove a successful worker workspace without a matching application ACK", async () => {
    const { ctx, job, calls } = await fixture();
    const execution = createLeaseExecution({
      ctx, clients: fixtureClients(ctx), subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id }) => ({ id, run: async () => ({ status: "succeeded" }) }),
    });
    const runtime = await execution.runtimeFor(job);
    const outcome = await runtime.run(job);
    expect(outcome.status).toBe("succeeded");
    const worktree = calls.find((call) => call.args.includes("worktree") && call.args.includes("add")).args.at(-2);
    await execution.afterJob({ job, event: { data: { status: "succeeded" } } });
    await expect(access(worktree)).resolves.toBeUndefined();
    expect(calls.filter((call) => call.args.includes("remove"))).toEqual([]);
  });

  it("retains its workspace through false, foreign or uncollected proof and settles only its exact applied delta", async () => {
    const { ctx, job, calls } = await fixture();
    const execution = createLeaseExecution({
      ctx, clients: fixtureClients(ctx), subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id }) => ({ id, run: async () => ({ status: "succeeded" }) }),
    });
    const outcome = await (await execution.runtimeFor(job)).run(job);
    expect(outcome.error).toBeUndefined();
    expect(outcome).toMatchObject({ status: "succeeded" });
    const worktree = calls.find((call) => call.args.includes("worktree") && call.args.includes("add")).args.at(-2);
    const chunks = encodeDeltaChunks({ delta: { files: [], jsonl: {}, maps: {} }, deltaId: job.id });
    const ack = {
      jobId: job.id, projectId: job.projectId, deltaId: job.id, sha256Total: chunks[0].sha256Total, ok: true,
    };
    const finished = (applicationAck) => execution.afterJob({
      job, event: { jobId: job.id, type: "finished", data: { status: "succeeded", l2: applicationAck } },
      applicationAck: { ...applicationAck, leaseId: job.leaseGrant.leaseId, attempt: job.leaseGrant.attempt },
    });
    await finished(ack);
    await expect(access(worktree)).resolves.toBeUndefined();
    expect(await execution.l2.collect({ forgeDir: execution.l2.forgeDirFor(job) })).toBeNull();
    for (const changed of [
      { jobId: "other" }, { projectId: "other" }, { deltaId: "other" },
      { sha256Total: "f".repeat(64) }, { ok: false, code: "L2_CONFLICT" },
    ]) {
      await finished({ ...ack, ...changed });
      await expect(access(worktree)).resolves.toBeUndefined();
    }
    const receiver = createL2Receiver({
      config: { ...ctx.config, lanes: [{ id: "remote", kind: "remote" }] }, currentLaneId: "remote",
    });
    const applied = await receiver.receive({ ...ack, chunks });
    expect(applied).toEqual(ack);
    await finished(applied);
    await expect(access(worktree)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("binds cleanup to the exact collected hash and signed current lease attempt, never to a receipt", async () => {
    const { ctx, job, calls, repoPath } = await fixture();
    const execution = createLeaseExecution({
      ctx, clients: fixtureClients(ctx), subject: "w1", laneId: "remote", key,
      runtimeFactory: ({ id }) => ({ id, async run({ cwd }) {
        await mkdir(path.join(cwd, ".forge", "runs", job.id), { recursive: true });
        await writeFile(path.join(cwd, ".forge", "runs", job.id, "run.json"), '{"checkpoint":1}');
        return { status: "succeeded" };
      } }),
    });
    const outcome = await (await execution.runtimeFor(job)).run(job);
    expect(outcome.error).toBeUndefined();
    expect(outcome).toMatchObject({ status: "succeeded" });
    const worktree = calls.find((call) => call.args.includes("worktree") && call.args.includes("add")).args.at(-2);
    const forgeDir = execution.l2.forgeDirFor(job);
    expect(await readFile(path.join(forgeDir, "runs", job.id, "run.json"), "utf8")).toBe('{"checkpoint":1}');
    const deltaId = `${job.id}:final`;
    const checkpoint = await execution.l2.collect({ forgeDir, deltaId });
    expect(checkpoint).not.toBeNull();
    const prior = encodeDeltaChunks({ delta: checkpoint, deltaId })[0];
    await writeFile(path.join(forgeDir, "runs", job.id, "run.json"), '{"checkpoint":2}');
    const delta = await execution.l2.collect({ forgeDir, deltaId });
    const chunks = encodeDeltaChunks({ delta, deltaId });
    const identity = {
      jobId: job.id, projectId: job.projectId, deltaId, sha256Total: chunks[0].sha256Total,
    };
    const applied = { ...identity, ok: true };
    const applicationAck = { ...applied, leaseId: job.leaseGrant.leaseId, attempt: job.leaseGrant.attempt };
    const event = { jobId: job.id, type: "finished", data: { status: "succeeded", l2: applied } };
    for (const rejected of [
      { applicationAck: { ok: true, lastSeq: 100 } },
      { applicationAck: applied },
      { applicationAck: { ...applicationAck, leaseId: "other" } },
      { applicationAck: { ...applicationAck, attempt: 2 } },
      { applicationAck: { ...applicationAck, sha256Total: prior.sha256Total } },
      { event: { ...event, jobId: "other" } },
      { event: { ...event, type: "progress" } },
      { event: { ...event, data: { ...event.data, l2: { ...identity, ok: false, code: "L2_CONFLICT" } } } },
      { job: { ...job, leaseGrant: { ...job.leaseGrant, attempt: 2 } } },
    ]) {
      expect(await execution.afterJob({ job, event, applicationAck, ...rejected }))
        .toEqual({ ok: false, code: "L2_APPLY_UNCONFIRMED" });
      await expect(access(worktree)).resolves.toBeUndefined();
      await expect(access(path.join(repoPath, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(calls.filter((call) => call.args.includes("worktree") && call.args.includes("remove"))).toEqual([]);
    const receiver = createL2Receiver({
      config: { ...ctx.config, lanes: [{ id: "remote", kind: "remote" }] }, currentLaneId: "remote",
    });
    expect(await receiver.receive({ ...identity, chunks })).toEqual(applied);
    expect(await readFile(path.join(repoPath, ".forge", "runs", job.id, "run.json"), "utf8"))
      .toBe('{"checkpoint":2}');
    const renewedJob = {
      ...job, leaseGrant: signGrant({
        grant: { ...job.leaseGrant, leaseId: "l2", attempt: 2 }, subject: "w1", key,
      }),
    };
    expect(execution.verifyLease(renewedJob)).toMatchObject({ leaseGrant: { leaseId: "l2", attempt: 2 } });
    expect(await execution.afterJob({ job, event, applicationAck }))
      .toEqual({ ok: false, code: "L2_APPLY_UNCONFIRMED" });
    await expect(access(worktree)).resolves.toBeUndefined();
    expect(await execution.afterJob({
      job: renewedJob, event, applicationAck: { ...applied, leaseId: "l2", attempt: 2 },
    })).toEqual({ ok: true });
    await expect(access(worktree)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
