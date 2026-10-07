import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../src/state/store.mjs";
import {
  createDirectClient,
  nextBackoffAt,
  QUEUE_STREAM,
} from "../src/memory/openbrain-direct.mjs";

const directories = [];

async function makeStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pforge-claw-openbrain-"));
  directories.push(directory);
  return { directory, store: createStore(directory) };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function currentConfig(memory = { openbrain: { endpoint: "http://127.0.0.1:9123/sse" } }) {
  return {
    instanceId: "instance-a",
    memory,
    projects: [
      { id: "project-a", visibility: "normal" },
      { id: "private-project", visibility: "restricted" },
    ],
  };
}

function secretReader(token = "test-token") {
  return { get: () => token };
}

function queueState(store) {
  return store.fold(QUEUE_STREAM, (records, record) => {
    const previous = records.get(record.id) ?? {};
    records.set(record.id, { ...previous, ...record });
    return records;
  }, new Map());
}

describe("OpenBrain direct client without endpoint", () => {
  it("is disabled and never connects", async () => {
    const { store } = await makeStore();
    let connectCalls = 0;
    const direct = createDirectClient({
      config: currentConfig({}),
      store,
      connect: async () => { connectCalls += 1; },
    });
    expect(direct.enabled).toBe(false);
    expect(await direct.writeBot({ project: "pforge-claw:instance-a", content: "x" }))
      .toEqual({ ok: false, code: "OPENBRAIN_NO_ENDPOINT" });
    expect(await direct.searchAcross("query")).toEqual({
      ok: false, code: "OPENBRAIN_NO_ENDPOINT", hits: [],
    });
    expect(await direct.drain()).toMatchObject({ ok: false, code: "OPENBRAIN_NO_ENDPOINT" });
    expect(await direct.health()).toMatchObject({ enabled: false, reachable: false });
    expect(connectCalls).toBe(0);
  });
});

describe("OpenBrain direct project-write boundary", () => {
  it("rejects project writes but queues writes in the bot namespace", async () => {
    const { store } = await makeStore();
    const direct = createDirectClient({
      config: currentConfig(),
      secrets: secretReader(),
      store,
      connect: async () => { throw new Error("queue should not connect"); },
      idFactory: () => "queue-1",
    });
    expect(await direct.writeBot({ project: "project-a", content: "forbidden" }))
      .toEqual({ ok: false, code: "DIRECT_PROJECT_WRITE_FORBIDDEN" });
    expect(await direct.writeBot({
      project: "pforge-claw:instance-a",
      type: "lesson",
      content: "bot thought",
      source: "pforge-claw/instance-a/task/job-1",
    })).toEqual({ ok: true, queued: "queue-1" });
    expect(queueState(store).get("queue-1")).toMatchObject({
      _status: "pending",
      _attempts: 0,
      record: { project: "pforge-claw:instance-a", content: "bot thought" },
    });
    expect(direct.queueCounts()).toEqual({ pending: 1, deadLetters: 0 });
  });
});

describe("OpenBrain exponential backoff", () => {
  it("uses the deterministic minus and plus twenty-percent jitter bounds", () => {
    expect(nextBackoffAt(1, () => 1000, () => 0)).toBe(25_000);
    expect(nextBackoffAt(1, () => 1000, () => 1)).toBe(37_000);
  });
});

describe("OpenBrain delivery queue durability", () => {
  it("dead-letters on the fifth failure and never retries failed or delivered records", async () => {
    const { directory, store } = await makeStore();
    let nowValue = 1_000_000;
    let fail = true;
    let calls = 0;
    const direct = createDirectClient({
      config: currentConfig(),
      secrets: secretReader(),
      store,
      now: () => nowValue,
      random: () => 0.5,
      idFactory: (() => {
        let counter = 0;
        return () => `queue-${++counter}`;
      })(),
      connect: async () => ({
        callTool: async () => {
          calls += 1;
          if (fail) throw new Error("remote down");
          return { ok: true };
        },
        listTools: async () => ({ tools: [] }),
        close: async () => {},
      }),
    });
    await direct.writeBot({ project: "pforge-claw:instance-a", content: "dead-letter" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await direct.drain();
      nowValue += 1_000_000;
      if (attempt < 4) expect(result.retried).toBe(1);
      else expect(result.deadLettered).toBe(1);
    }
    fail = false;
    await direct.writeBot({ project: "pforge-claw:instance-a", content: "delivered" });
    expect((await direct.drain()).delivered).toBe(1);
    const callsAfterTerminal = calls;
    expect(await direct.drain()).toEqual({ delivered: 0, retried: 0, deadLettered: 0 });
    expect(calls).toBe(callsAfterTerminal);
    expect(direct.queueCounts()).toEqual({ pending: 0, deadLetters: 1 });

    const reopened = createStore(directory);
    const records = queueState(reopened);
    expect(records.get("queue-1")._status).toBe("failed");
    expect(records.get("queue-2")._status).toBe("delivered");
    await direct.close();
  });

  it("serializes concurrent drains into one remote delivery", async () => {
    const { store } = await makeStore();
    let calls = 0;
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const direct = createDirectClient({
      config: currentConfig(),
      secrets: secretReader(),
      store,
      connect: async () => ({
        callTool: async () => { calls += 1; await blocked; return { ok: true }; },
        listTools: async () => ({ tools: [] }),
        close: async () => {},
      }),
    });
    await direct.writeBot({ project: "pforge-claw:instance-a", content: "one record" });
    const first = direct.drain();
    const second = direct.drain();
    await Promise.resolve();
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ delivered: 1, retried: 0, deadLettered: 0 });
    expect(secondResult).toBe(firstResult);
    expect(calls).toBe(1);
  });
});

describe("OpenBrain restricted search filter", () => {
  it("omits restricted projects from filters and drops leaked restricted results", async () => {
    const { store } = await makeStore();
    let args;
    const direct = createDirectClient({
      config: currentConfig(),
      secrets: secretReader(),
      store,
      registry: { all: () => currentConfig().projects },
      connect: async () => ({
        callTool: async (request) => {
          args = request.arguments;
          return { hits: [
            { id: "allowed", project: "project-a", content: "safe" },
            { id: "restricted-project", project: "private-project", content: "private" },
            { id: "restricted-record", project: "project-a", visibility: "restricted" },
            { id: "unscoped", content: "not allowlisted" },
          ] };
        },
        listTools: async () => ({ tools: [] }),
        close: async () => {},
      }),
    });
    const result = await direct.searchAcross("query", { limit: 4 });
    expect(args.projects).toEqual(["project-a"]);
    expect(result.hits.map((hit) => hit.id)).toEqual(["allowed"]);
  });
});

describe("OpenBrain verified delete capability", () => {
  it("requires a matching tool with a required string id property", async () => {
    const { store } = await makeStore();
    let tools = [];
    let deleteCalls = 0;
    const direct = createDirectClient({
      config: currentConfig(),
      secrets: secretReader(),
      store,
      connect: async () => ({
        callTool: async () => { deleteCalls += 1; return { ok: true }; },
        listTools: async () => ({ tools }),
        close: async () => {},
      }),
    });
    expect(await direct.capabilities()).toEqual({ canDelete: false });
    expect(await direct.remove("memory-1")).toEqual({ ok: false, code: "NOT_SUPPORTED" });
    tools = [{ name: "delete_thought", inputSchema: { required: ["id"], properties: { id: { type: "number" } } } }];
    expect(await direct.capabilities()).toEqual({ canDelete: false });
    expect(await direct.remove("memory-1")).toEqual({ ok: false, code: "NOT_SUPPORTED" });
    expect(deleteCalls).toBe(0);
    tools = [{ name: "forget_thought", inputSchema: { required: ["id"], properties: { id: { type: "string" } } } }];
    expect(await direct.capabilities()).toEqual({ canDelete: true });
    expect(await direct.remove("memory-1")).toEqual({ ok: true });
    expect(deleteCalls).toBe(1);
  });
});

describe("OpenBrain error redaction", () => {
  it("never includes a configured token in returned errors", async () => {
    const { store } = await makeStore();
    const token = "sensitive-test-token";
    const direct = createDirectClient({
      config: currentConfig(),
      secrets: secretReader(token),
      store,
      connect: async () => { throw new Error(`connection failed with ${token}`); },
    });
    const result = await direct.drain();
    const health = await direct.health();
    expect(JSON.stringify([result, health, await direct.capabilities()])).not.toContain(token);
    expect(result).toMatchObject({ ok: false, code: "OPENBRAIN_UNREACHABLE" });
  });
});

