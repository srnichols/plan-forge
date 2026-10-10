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

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
let root;
let ctx;
let sessions;

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
    runner: async (_command, args) => {
      if (args.includes("status")) return { code: 0, stdout: "", stderr: "" };
      if (args.includes("rev-list")) return { code: 0, stdout: "0", stderr: "" };
      throw new Error("Unexpected external command");
    },
  };
  ctx.projectClients = createG1ProjectClients({ config: ctx.config, env: {}, secrets: ctx.secrets });
  ctx.l2Receiver = createL2Receiver({ config: ctx.config, currentLaneId: "fixture-home" });
});

afterEach(async () => {
  await ctx.projectClients.closeAll();
  await rm(root, { recursive: true, force: true });
});

function lease(overrides = {}) {
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
  payload.leaseGrant = signGrant({
    grant: buildLeaseGrant({
      leaseJob: payload, laneId: "remote1", now: () => 0,
      proof: { kind: "consumed", ref: "a1", decidedAt: 0 },
    }),
    subject: "worker1", key: "fixture-signing-key",
  });
  verifyGrant({
    grant: payload.leaseGrant, job: payload, subject: "worker1",
    laneId: "remote1", key: "fixture-signing-key", now: () => 1,
  });
  return payload;
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
    const job = lease();
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
    const first = lease();
    const second = lease({
      id: "j2", provider: { type: "openai", endpoint: "https://second.example", keySecret: "SECOND_KEY" },
      project: { id: "p1", models: { work: "second-work-model" } },
    });
    const firstResult = await (await run.runtimeFor(first)).run(first);
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
    const job = lease();
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
    await run.runtimeFor(lease());
    await expect(run.runtimeFor({ id: "unsigned", projectId: "p1", runtime: "openai" }))
      .rejects.toMatchObject({ code: "RUNTIME_POLICY_DENIED" });
  });
});
