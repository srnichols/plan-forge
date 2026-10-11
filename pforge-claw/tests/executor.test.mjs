import { EventEmitter } from "node:events";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJobExecutor, resolveJobRuntime } from "../src/jobs/executor.mjs";
import { createLeaseJobSource } from "../src/jobs/lease-jobs.mjs";
import { buildLeaseGrant, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { createAgentRuntime } from "../src/runtime/agent-runtime.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createG1ProjectClients } from "./g1-runner-fixture.mjs";
import { buildWorktreeLaunch } from "../src/mcp/project-client.mjs";
import { collectLeaseMcpBootstrap } from "../src/jobs/bootstrap-mcp.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { decode, encode, message, PUBLICATION_MESSAGE, PUBLICATION_FENCE_VERSION } from "../src/protocol/messages.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SIGNING_KEY = "fixture-signing-key";
const HEARTBEAT_MS = 15_000;
let root;
let ctx;
let sessions;
let authority;

beforeEach(async () => {
  root = await mkdtemp(path.join(TEST_DIRECTORY, ".claw-executor-"));
  const repoPath = path.join(root, "home");
  await mkdir(path.join(repoPath, ".vscode"), { recursive: true });
  await writeFile(path.join(repoPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: { "plan-forge": { type: "stdio", command: process.execPath, args: [] } },
  }));
  sessions = [];
  ctx = {
    config: {
      allowlist: [{ userId: "owner1", role: "owner" }, { userId: "approver1", role: "approver" }],
      policy: { ghcpRoles: ["owner"] },
      lanes: [{ id: "remote1", kind: "remote", runtime: "openai" }, { id: "fixture-home", kind: "local" }],
      runtimes: {
        default: "copilot-sdk",
        byok: { openai: { endpoint: "https://stale.example", keySecret: "STALE_KEY" } },
      },
      projects: [{ id: "p1", homeLane: "fixture-home", repo: { path: repoPath, baseBranch: "main" }, models: { work: "stale-model" } }],
    },
    secrets: await createSecrets({
      env: { APPROVED_KEY: "approved-key-canary", SECOND_KEY: "second-key-canary", STALE_KEY: "stale-key-canary" },
    }),
    features: [],
    bus: new EventEmitter(),
    runner: async (_command, args, options = {}) => {
      const completed = { code: 0, stdout: "", stderr: "",
        ...(options.requireSettlement === true ? { settlementConfirmed: true } : {}) };
      if (args.includes("status")) return completed;
      if (args.includes("rev-list")) return { ...completed, stdout: "0" };
      throw new Error("Unexpected external command");
    },
  };
  ctx.projectClients = createG1ProjectClients({ config: ctx.config, env: {}, secrets: ctx.secrets });
  ctx.l2Receiver = createL2Receiver({ config: ctx.config, currentLaneId: "fixture-home" });
  authority = createLeaseAuthority();
  ctx.withPublication = authority.withPublication;
});

afterEach(async () => {
  await authority.close();
  await ctx.projectClients.closeAll();
  await rm(root, { recursive: true, force: true });
});

function createLeaseAuthority() {
  const held = new Map();
  const registry = createWorkerRegistry({
    requireL2: true, applyL2: ctx.l2Receiver.receive,
    signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key: SIGNING_KEY }),
  });
  const capabilities = {
    os: process.platform, arch: process.arch, macos: process.platform === "darwin", toolchains: [], projects: ["p1"],
  };
  let socket;
  const receive = (packet) => socket.emit("message", Buffer.from(encode(packet)), false);
  class Socket extends EventEmitter {
    OPEN = 1;
    readyState = 1;
    constructor() { super(); socket = this; }
    send(raw) {
      const packet = decode(raw);
      if (packet.t === "ack") registry.onAck({ ...packet, workerId: "worker1" });
      if (packet.t === "event") registry.onEvent({ ...packet, workerId: "worker1" });
      if (packet.t === PUBLICATION_MESSAGE) receive(registry.onPublication({ ...packet, workerId: "worker1" }));
      if (packet.t === "heartbeat") receive(message("heartbeat", {
        ts: 1, leases: registry.onHeartbeat({ ...packet, workerId: "worker1" }),
      }));
    }
    close() { this.readyState = 3; this.emit("close", 1000); }
  }
  const localLane = createLocalLane({
    id: "remote1", maxHeavy: 2,
    runtimeFor: async (job) => {
      const lease = held.get(job.id);
      lease.ready.resolve(structuredClone(job));
      return { run: () => lease.release.promise };
    },
  });
  const agent = createWorkerAgent({
    url: "ws://127.0.0.1/claw/workers", workerId: "worker1", laneId: "remote1", secret: SIGNING_KEY,
    capabilities, localLane, WebSocketImpl: Socket, rand: () => 0,
    verifyLease: (job) => verifyGrant({
      grant: job.leaseGrant, job, subject: "worker1", laneId: "remote1", key: SIGNING_KEY,
    }),
  });
  agent.start();
  socket.emit("open");
  receive(message("ready", { leaseMs: registry.leaseMs, heartbeatMs: HEARTBEAT_MS, publicationFence: PUBLICATION_FENCE_VERSION }));
  registry.connect("worker1", { laneId: "remote1", capabilities, publicationFence: true, send: receive });
  return {
    withPublication: agent.withPublication.bind(agent),
    async accept(job) {
      const lease = { ready: Promise.withResolvers(), release: Promise.withResolvers() };
      held.set(job.id, lease);
      registry.enqueue("remote1", { kind: "job", job });
      return lease.ready.promise;
    },
    async release(jobId) {
      held.get(jobId).release.resolve({ ok: false, status: "cancelled" });
      await agent.drain();
    },
    async close() {
      agent.stop();
      for (const lease of held.values()) lease.release.resolve({ ok: false, status: "cancelled" });
      await agent.drain();
      registry.close();
    },
  };
}

async function lease(overrides = {}) {
  const payload = {
    id: "j1", projectId: "p1", type: "task", mutating: true, prompt: "approved prompt",
    runtime: "openai",
    provider: { type: "openai", endpoint: "https://approved.example", keySecret: "APPROVED_KEY" },
    project: {
      id: "p1", models: { chat: "approved-chat-model", work: "approved-work-model" },
      bootstrap: { env: ["APPROVED_KEY"], copy: [".forge.json"], install: "link" },
    },
    ...overrides,
  };
  payload.mcpBootstrap = await collectLeaseMcpBootstrap({ project: ctx.config.projects[0], config: ctx.config });
  payload.leaseGrant = signGrant({
    grant: buildLeaseGrant({
      leaseJob: payload, laneId: "remote1",
      proof: { kind: "consumed", ref: "a1", decidedAt: 0 },
    }),
    subject: "worker1", key: SIGNING_KEY,
  });
  verifyGrant({
    grant: payload.leaseGrant, job: payload, subject: "worker1",
    laneId: "remote1", key: SIGNING_KEY,
  });
  return authority.accept(payload);
}

function executor() {
  return createJobExecutor({
    ctx,
    clients: ctx.projectClients,
    createSession: async ({ clientOptions, sessionConfig }) => {
      sessions.push({ clientOptions, sessionConfig });
      return {
        client: { stop: async () => [] },
        session: { sendAndWait: async () => {}, disconnect: async () => {} },
      };
    },
    jobsFor: createLeaseJobSource,
    workspaceFor: (job) => ({
      prepare: async () => {
        const workspacePath = path.join(root, "workspaces", job.id);
        await mkdir(path.join(workspacePath, ".vscode"), { recursive: true });
        await copyFile(
          path.join(ctx.config.projects[0].repo.path, ".vscode", "mcp.json"),
          path.join(workspacePath, ".vscode", "mcp.json"),
        );
        return { handle: { path: workspacePath, branch: `claw/${job.id}` }, env: {} };
      },
      release: async () => {},
    }),
  });
}

describe("lane-aware runtime resolution", () => {
  it("uses the selected lane before the global runtime default and keeps the public factory signature", async () => {
    let supplied;
    const runtime = await resolveJobRuntime({
      job: { projectId: "p1", callerId: "approver1" },
      config: ctx.config,
      lane: ctx.config.lanes[0],
      runtimeFactory: async (options) => {
        supplied = options;
        return createAgentRuntime({ ...options, secrets: ctx.secrets });
      },
    });
    expect(runtime.id).toBe("openai");
    expect(supplied).toMatchObject({ id: "openai", lane: ctx.config.lanes[0], project: ctx.config.projects[0] });
  });

  it("looks up a stored job's selected lane when no explicit lane option is supplied", async () => {
    const runtime = await resolveJobRuntime({
      job: { projectId: "p1", callerId: "approver1", lane: "remote1" },
      config: ctx.config,
      runtimeFactory: (options) => createAgentRuntime({ ...options, secrets: ctx.secrets }),
    });
    expect(runtime.id).toBe("openai");
  });
});

describe("verified lease execution configuration", () => {
  it("Guard: workspace MCP launch never invents a canonical local home", async () => {
    const source = await readFile(new URL("../src/jobs/executor.mjs", import.meta.url), "utf8");
    expect(source).not.toContain('homeLane: "local"');
    expect(source).toContain("buildWorktreeLaunch");
    expect(typeof buildWorktreeLaunch).toBe("function");
  });

  it("uses signed project models and provider secret references rather than stale worker config", async () => {
    const job = await lease();
    const before = JSON.stringify(job);
    const runtime = await executor().runtimeFor(job);
    const result = await runtime.run({ ...job });
    expect(result.status, result.reason ?? result.error).toBe("succeeded");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionConfig).toMatchObject({
      model: "approved-work-model",
      workingDirectory: path.join(root, "workspaces", "j1"),
      provider: { type: "openai", baseUrl: "https://approved.example", apiKey: "approved-key-canary" },
    });
    expect(JSON.stringify(job)).toBe(before);
    expect(JSON.stringify({ result, runtime, job })).not.toMatch(/(?:approved|stale)-key-canary/);
    expect(ctx.config.projects[0].models.work).toBe("stale-model");
  });

  it("does not reuse a cached provider across distinct signed execution choices", async () => {
    const run = executor();
    const first = await lease();
    const firstResult = await (await run.runtimeFor(first)).run(first);
    await authority.release(first.id);
    const second = await lease({
      id: "j2", provider: { type: "openai", endpoint: "https://second.example", keySecret: "SECOND_KEY" },
      project: { id: "p1", models: { work: "second-work-model" } },
    });
    const secondResult = await (await run.runtimeFor(second)).run(second);
    expect(firstResult.status, firstResult.reason ?? firstResult.error).toBe("succeeded");
    expect(secondResult.status, secondResult.reason ?? secondResult.error).toBe("succeeded");
    expect(sessions.map(({ sessionConfig }) => ({
      model: sessionConfig.model, endpoint: sessionConfig.provider.baseUrl, key: sessionConfig.provider.apiKey,
    }))).toEqual([
      { model: "approved-work-model", endpoint: "https://approved.example", key: "approved-key-canary" },
      { model: "second-work-model", endpoint: "https://second.example", key: "second-key-canary" },
    ]);
  });

  it("retains an immutable verified job snapshot across runtime handoff", async () => {
    const job = await lease();
    const runtime = await executor().runtimeFor(job);
    job.prompt = "changed after verification";
    job.provider.endpoint = "https://changed.example";
    job.project.models.work = "changed-model";
    const result = await runtime.run({ ...job });
    expect(result.status, result.reason ?? result.error).toBe("succeeded");
    expect(sessions[0].sessionConfig.model).toBe("approved-work-model");
    expect(sessions[0].sessionConfig.provider.baseUrl).toBe("https://approved.example");
  });

  it("refuses unsigned explicit runtime choices rather than relying on a cached runtime", async () => {
    const run = executor();
    await run.runtimeFor(await lease());
    await expect(run.runtimeFor({ id: "unsigned", projectId: "p1", runtime: "openai" }))
      .rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
  });
});
