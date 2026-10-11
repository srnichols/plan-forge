import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";
import { createStore } from "../src/state/store.mjs";
import { createApprovalService } from "../src/approvals.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createRegistry, resolveMcpLaunch } from "../src/registry.mjs";
import { createProjectClients } from "../src/mcp/project-client.mjs";
import { createSecrets } from "../src/secrets.mjs";

export async function g1Directory(prefix = "g1-") {
  const fixtures = path.resolve("tests", ".g1-fixtures");
  await mkdir(fixtures, { recursive: true });
  return mkdtemp(path.join(fixtures, prefix));
}

export function g1DirectorySync(prefix = "g1-") {
  const fixtures = path.resolve("tests", ".g1-fixtures");
  mkdirSync(fixtures, { recursive: true });
  return mkdtempSync(path.join(fixtures, prefix));
}

export function g1Deferred() {
  return Promise.withResolvers();
}

export function createG1ProjectClients({
  config, env, secrets, currentLaneId = null,
  connect = async () => ({ call: async () => ({ ok: true }), close: async () => {} }),
}) {
  const registry = {
    ...createRegistry(config),
    resolveMcpLaunch: (repo, name, options) => resolveMcpLaunch(repo, name, { ...options, which: async () => true }),
  };
  return createProjectClients({ config, registry, env, secrets, currentLaneId, connect });
}

export async function approveJob(fixture, { id = "a1000001", type = "task", fields = {}, approvalQuorum } = {}) {
  const created = createJob({ id, type, projectId: "project-1" });
  created.job = { ...created.job, callerId: "requester-owner", callerRole: "owner", adapter: "telegram", chatId: "chat", ...fields };
  fixture.store.append(JOBS_STREAM, { ...created.event, job: created.job });
  const awaiting = transition(created.job, "awaiting-approval");
  fixture.store.append(JOBS_STREAM, awaiting.event);
  const approval = fixture.approvals.createApproval(awaiting.job);
  fixture.approvals.issue(awaiting.job, { approval });
  const decision = await fixture.approvals.decide({
    payload: (approvalQuorum ? approval.quorum(approvalQuorum) : approval.approve).slice(2),
    caller: { role: "owner", userId: "owner" },
    chatId: "chat", threadId: null,
  });
  if (!decision.ok) throw new Error(`Fixture approval failed: ${decision.reason}`);
  return currentJobs(fixture.store)[id];
}

export function leaseJob(fixture, job) {
  const updated = transition(job, "leased", { lane: "execution-host" });
  fixture.store.append(JOBS_STREAM, updated.event);
  return updated.job;
}

export async function runnerFixture({ type = "task", fields = {}, changes = true, approvalQuorum } = {}) {
  const root = await g1Directory("g1-runner-");
  const repo = path.join(root, "checkout");
  const home = path.join(root, "claw-home");
  await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
  await mkdir(path.join(repo, ".vscode"), { recursive: true });
  await writeFile(path.join(repo, "docs", "plans", "Phase-1-PLAN.md"), "# Fixture plan\n");
  await writeFile(path.join(repo, ".vscode", "mcp.json"), JSON.stringify({
    servers: { "plan-forge": { command: "node", args: ["entry.mjs"], env: { JOB_VALUE: "${env:G1_JOB_VALUE}" } } },
  }));
  const store = createStore(path.join(root, "state"));
  const unlock = store.lock();
  const bus = new EventEmitter();
  const fixture = { root, repo, home, store, bus };
  const config = {
    allowlist: [{ channel: "telegram", userId: "requester-owner", role: "owner" },
      { channel: "telegram", userId: "owner", role: "owner" }],
    projects: [{
      id: "project-1", homeLane: "execution-host",
      repo: { path: repo, baseBranch: "main" },
      models: { work: "configured-work-model" },
    }],
    lanes: [{ id: "execution-host", kind: "local", enabled: true }],
    bootstrap: { copy: [], env: ["G1_JOB_VALUE"], install: "none" },
    runtimes: { pforgeCommand: [process.execPath], ghCommand: ["fixture-gh"] },
    jobs: { pushOnFailure: false },
  };
  fixture.approvals = createApprovalService({ store, bus, config });
  const calls = [];
  const runner = vi.fn(async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === "git" && args.includes("--show-toplevel")) {
      return { code: 0, stdout: `${repo}\n`, stderr: "" };
    }
    if (command === "git" && args.includes("show-ref")) return { code: 1, stdout: "", stderr: "" };
    if (command === "git" && args.includes("worktree") && args.includes("add")) {
      const target = args.at(-2);
      await mkdir(path.join(target, "docs", "plans"), { recursive: true });
      await mkdir(path.join(target, ".vscode"), { recursive: true });
      await writeFile(path.join(target, "docs", "plans", "Phase-1-PLAN.md"), "# Fixture plan\n");
      await writeFile(path.join(target, ".vscode", "mcp.json"),
        await readFile(path.join(repo, ".vscode", "mcp.json")));
    }
    const stdout = args.includes("--porcelain") ? changes ? "?? result.txt\n" : ""
      : args.includes("rev-list") ? changes ? "1\n" : "0\n"
      : command === "fixture-gh" ? "https://example.test/pr/1\n" : "";
    return { code: 0, stdout, stderr: "" };
  });
  const client = { call: vi.fn(async () => null), close: vi.fn(async () => {}) };
  const mcpInputs = [];
  const secrets = await createSecrets({
    env: { G1_JOB_VALUE: "job-owned-canary" }, trackNames: ["G1_JOB_VALUE"],
  });
  const ctx = {
    home, config, store, bus, runner, features: [],
    env: { ...process.env, G1_BASE_VALUE: "base-value" },
    secrets,
    runtime: {
      run: vi.fn(async ({ cwd }) => {
        await mkdir(path.join(cwd, ".forge", "runs", "job-1"), { recursive: true });
        await writeFile(path.join(cwd, ".forge", "runs", "job-1", "run.json"), '{"id":"job-1"}\n');
        await writeFile(path.join(cwd, ".forge", "openbrain-queue.jsonl"), '{"id":"queued-1","text":"retained"}\n');
        return { ok: true, status: "succeeded", usage: { tokensIn: 7, tokensOut: null } };
      }),
    },
    mcp: async (input) => { mcpInputs.push(input); return client; },
    mcpLaunch: { command: process.execPath, args: ["entry.mjs"] },
    l2Receiver: createL2Receiver({ config, currentLaneId: "execution-host" }),
  };
  ctx.projectClients = createG1ProjectClients({
    config, env: ctx.env, secrets: ctx.secrets,
    connect: async (launch) => { mcpInputs.push(launch); return client; },
  });
  Object.assign(fixture, { config, calls, ctx, client, mcpInputs });
  const choices = typeof fields === "function" ? fields(fixture) : fields;
  fixture.job = leaseJob(fixture, await approveJob(fixture, {
    type, fields: { planPath: path.join("docs", "plans", "Phase-1-PLAN.md"), ...choices }, approvalQuorum,
  }));
  fixture.worktree = path.join(home, "worktrees", "project-1", fixture.job.id);
  fixture.cleanup = async () => {
    await ctx.projectClients?.closeAll?.();
    unlock();
    await rm(root, { recursive: true, force: true });
  };
  return fixture;
}

export function publicationCalls(fixture) {
  return fixture.calls.filter(({ command, args }) => command === "fixture-gh"
    || (command === "git" && ["add", "commit", "push"].some((verb) => args.includes(verb))
      && !args.includes("worktree")));
}

export async function drain(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}
