import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import fanoutCommand from "../../src/commands/fanout.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";
import { createSecrets } from "../../src/secrets.mjs";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const config = {
  allowlist: [{ channel: "telegram", userId: "requester", role: "owner" }],
  policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
  runtimes: { default: "copilot-sdk", byok: {} },
  lanes: [{ id: "local", kind: "local", runtime: "copilot-sdk" }],
  projects: [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
    { id: "secret-canary-x", visibility: "restricted" },
  ],
};

const fixtureDirectories = new Set();

function makeStore() {
  const directory = join(process.cwd(), ".test-fixtures", `fp03-command-${randomUUID()}`);
  fixtureDirectories.add(directory);
  return Object.assign(createStore(directory, { now: () => new Date(NOW) }), { fixtureDirectory: directory });
}

function makeContext(store, runtimeConfig = config) {
  return {
    scope: "general",
    services: { store, config: runtimeConfig, registry: { all: () => runtimeConfig.projects }, now: () => NOW },
  };
}

function makeInput(changes = {}) {
  return {
    argsText: "check dependencies -- alpha beta",
    caller: { userId: "requester", role: "owner" },
    chatId: "general-chat",
    threadId: "general-topic",
    adapter: "telegram",
    updateId: "update-3",
    ...changes,
  };
}

afterEach(() => {
  for (const directory of fixtureDirectories) rmSync(directory, { recursive: true, force: true });
  fixtureDirectories.clear();
});

describe("/fanout", () => {
  it("exposes the registry metadata required by command discovery", () => {
    expect(fanoutCommand).toMatchObject({
      name: "fanout",
      args: "<task> [-- projects…]",
      scope: "general",
      mutating: true,
      available: true,
    });
    expect(fanoutCommand.roles).toEqual(["owner", "approver"]);
    expect(fanoutCommand.summary).toContain("across projects");
    expect(fanoutCommand.details).toContain("One approval covers all targets");
    expect(fanoutCommand.examples[1]).toContain("-- alpha beta");
  });

  it("creates jobs through injected services and returns safe errors", async () => {
    const store = makeStore();
    const services = { store, config, registry: { all: () => config.projects } };
    const result = await fanoutCommand.handle({ services }, {
      argsText: "check dependencies -- alpha beta",
      caller: { userId: "requester", role: "owner" },
      adapter: "telegram",
      chatId: "general-chat",
      threadId: "general-topic",
    });
    expect(result.text).toContain("awaiting approval for 2 projects");
    expect(Object.values(currentJobs(store)).filter((job) => job.type === "task")).toHaveLength(2);

    const restricted = await fanoutCommand.handle({ services }, {
      argsText: "check dependencies -- secret-canary-x",
      caller: { userId: "requester" },
      chatId: "general-chat",
    });
    const unknown = await fanoutCommand.handle({ services }, {
      argsText: "check dependencies -- unknown-project",
      caller: { userId: "requester" },
      chatId: "general-chat",
    });
    expect(restricted.text).toBe("FANOUT_UNKNOWN_PROJECT: Fan-out was not created.");
    expect(unknown.text).toBe(restricted.text);
    expect(restricted.text).not.toContain("secret-canary-x");
  });

  it("recovers one durable fanout family through five receipt failures and a restarted store", async () => {
    const store = makeStore();
    const input = makeInput();
    const channel = { send: vi.fn(async () => { throw new Error("receipt unavailable"); }) };
    const receipts = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const receipt = await fanoutCommand.handle(makeContext(store), input);
      receipts.push(receipt);
      await expect(channel.send(receipt)).rejects.toThrow("receipt unavailable");
    }
    const restartedStore = createStore(store.fixtureDirectory, { now: () => new Date(NOW) });
    const recovered = await fanoutCommand.handle(makeContext(restartedStore), input);
    const jobs = Object.values(currentJobs(restartedStore));
    expect(jobs.filter((job) => job.type === "fanout")).toHaveLength(1);
    expect(jobs.filter((job) => job.type === "task")).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.jobId === recovered.jobId)).toBe(true);
    expect(recovered).toMatchObject({ jobId: jobs.find((job) => job.type === "fanout").id, state: "awaiting-approval" });
    for (const child of jobs.filter((job) => job.type === "task")) {
      expect(child).toMatchObject({
        callerId: "requester", callerRole: "owner", adapter: "telegram", updateId: "update-3",
        chatId: "general-chat", threadId: "general-topic", parentId: recovered.jobId, state: "queued",
      });
      expect(child).not.toHaveProperty("runtime");
      expect(child).not.toHaveProperty("provider");
    }
  });

  it("recovers the declared missing children of a partially committed parent exactly once", async () => {
    const store = makeStore();
    const input = makeInput();
    const receipt = await fanoutCommand.handle(makeContext(store), input);
    const parent = Object.values(currentJobs(store)).find((job) => job.type === "fanout");
    const committed = [...store.read("jobs")].filter(({ record }) => record.kind === "job.created");
    const file = join(store.fixtureDirectory, "jobs.jsonl");
    writeFileSync(file, readFileSync(file).subarray(0, committed[1].end));
    const restartedStore = createStore(store.fixtureDirectory, { now: () => new Date(NOW) });
    const recovered = await fanoutCommand.handle(makeContext(restartedStore), input);
    await fanoutCommand.handle(makeContext(restartedStore), input);
    const jobs = Object.values(currentJobs(restartedStore));
    expect(jobs).toHaveLength(3);
    expect(jobs.filter((job) => job.type === "fanout")).toHaveLength(1);
    expect(recovered).toMatchObject({ jobId: parent.id, state: "awaiting-approval" });
    expect(jobs.filter((job) => job.type === "task").map((job) => job.id).sort())
      .toEqual(parent.targets.map((target) => target.childId).sort());
    expect(jobs.filter((job) => job.type === "task").every((job) => job.state === "queued")).toBe(true);
    expect(receipt.text).toBe(recovered.text);
  });

  it("uses the full request scope while preserving distinct direct calls without updateId", async () => {
    const store = makeStore();
    const context = makeContext(store);
    const first = await fanoutCommand.handle(context, makeInput());
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => fanoutCommand.handle(context, makeInput())));
    expect(duplicates.map((receipt) => receipt.jobId)).toEqual(Array(4).fill(first.jobId));
    const differentTopic = await fanoutCommand.handle(context, makeInput({ threadId: "other-topic" }));
    expect(differentTopic.jobId).not.toBe(first.jobId);
    const direct = await fanoutCommand.handle(context, makeInput({ updateId: undefined }));
    const nextDirect = await fanoutCommand.handle(context, makeInput({ updateId: undefined }));
    expect(nextDirect.jobId).not.toBe(direct.jobId);
    expect(Object.values(currentJobs(store)).filter((job) => job.type === "fanout")).toHaveLength(4);
  });

  it("does not trust a claimed owner or input-selected unsigned runtime/provider", async () => {
    const store = makeStore();
    const deniedConfig = {
      ...config,
      allowlist: [{ channel: "telegram", userId: "requester", role: "approver" }],
    };
    const denied = await fanoutCommand.handle(makeContext(store, deniedConfig), makeInput({
      runtime: "openai", provider: { type: "openai", keySecret: "FAKE_KEY_REFERENCE" },
    }));
    expect(denied).toMatchObject({ jobId: null, state: null });
    expect(denied.text).toContain("RUNTIME_POLICY_DENIED");
    expect(Object.values(currentJobs(store))).toHaveLength(0);
  });

  it("requires usable configured BYOK on every target and preserves the actual caller", async () => {
    const store = makeStore();
    const runtimeConfig = structuredClone(config);
    runtimeConfig.allowlist[0].role = "approver";
    runtimeConfig.runtimes.byok.openai = { keySecret: "FP03_FIXTURE_KEY", endpoint: "https://provider.example" };
    runtimeConfig.projects[0].runtime = "openai";
    const secrets = await createSecrets({ env: { FP03_FIXTURE_KEY: randomUUID() } });
    const context = makeContext(store, runtimeConfig);
    context.services.secrets = secrets;
    const mixed = await fanoutCommand.handle(context, makeInput());
    expect(mixed).toMatchObject({ jobId: null, state: null });
    expect(mixed.text).toContain("RUNTIME_POLICY_DENIED");
    expect(Object.values(currentJobs(store))).toHaveLength(0);
    runtimeConfig.projects[1].runtime = "openai";
    const accepted = await fanoutCommand.handle(context, makeInput({
      runtime: "copilot-sdk", provider: { type: "copilot-sdk" },
    }));
    expect(accepted).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
    const jobs = Object.values(currentJobs(store));
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.callerId === "requester" && job.callerRole === "approver")).toBe(true);
    expect(jobs.every((job) => !Object.hasOwn(job, "runtime") && !Object.hasOwn(job, "provider"))).toBe(true);
    expect(JSON.stringify(jobs)).not.toContain(secrets.get("FP03_FIXTURE_KEY"));
    context.services.secrets = await createSecrets({ env: {} });
    const missing = await fanoutCommand.handle(context, makeInput({ updateId: "other-update" }));
    expect(missing).toMatchObject({ jobId: null, state: null });
    expect(missing.text).toContain("BYOK_KEY_MISSING");
    expect(Object.values(currentJobs(store))).toHaveLength(3);
  });

  it("does not lose an uncommitted request after a real store-path failure", async () => {
    const store = makeStore();
    const path = join(store.fixtureDirectory, "jobs.jsonl");
    mkdirSync(path);
    const refused = await fanoutCommand.handle(makeContext(store), makeInput());
    expect(refused).toMatchObject({ jobId: null, state: null });
    rmSync(path, { recursive: true });
    const accepted = await fanoutCommand.handle(makeContext(store), makeInput());
    expect(accepted).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
    const repeated = await fanoutCommand.handle(makeContext(store), makeInput());
    expect(repeated.jobId).toBe(accepted.jobId);
    expect(Object.values(currentJobs(store))).toHaveLength(3);
  });

  it("never coalesces different callers or chats with the same update", async () => {
    const store = makeStore();
    const runtimeConfig = structuredClone(config);
    runtimeConfig.allowlist.push({ channel: "telegram", userId: "other-owner", role: "owner" });
    const context = makeContext(store, runtimeConfig);
    const original = await fanoutCommand.handle(context, makeInput());
    const otherCaller = await fanoutCommand.handle(context, makeInput({
      caller: { userId: "other-owner", role: "owner" },
    }));
    const otherChat = await fanoutCommand.handle(context, makeInput({ chatId: "other-chat" }));
    expect(new Set([original.jobId, otherCaller.jobId, otherChat.jobId]).size).toBe(3);
    expect(Object.values(currentJobs(store))).toHaveLength(9);
  });

  it("preserves the current authority reference when the caller supplies callerId", async () => {
    const store = makeStore();
    const receipt = await fanoutCommand.handle(makeContext(store), makeInput({
      caller: { callerId: "requester", role: "viewer" },
    }));
    expect(receipt).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
    expect(Object.values(currentJobs(store)).every((job) => job.callerId === "requester" && job.callerRole === "owner"))
      .toBe(true);
  });

  it.each(["updateId", "chatId", "threadId"])("rejects non-scalar %s before it can collapse the request identity", async (field) => {
    const store = makeStore();
    const receipt = await fanoutCommand.handle(makeContext(store), makeInput({ [field]: { id: "not-a-scalar" } }));
    expect(receipt).toMatchObject({ jobId: null, state: null });
    expect(receipt.text).toContain("REQUEST_BAD_IDENTITY");
    expect(Object.values(currentJobs(store))).toHaveLength(0);
  });

  it.each(["chatId", "threadId"])("rejects non-scalar direct %s without inventing a delivery identity", async (field) => {
    const store = makeStore();
    const receipt = await fanoutCommand.handle(makeContext(store), makeInput({
      updateId: undefined, [field]: { id: "not-a-scalar" },
    }));
    expect(receipt).toMatchObject({ jobId: null, state: null });
    expect(receipt.text).toContain("REQUEST_BAD_IDENTITY");
    expect(Object.values(currentJobs(store))).toHaveLength(0);
  });
});
