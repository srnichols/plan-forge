import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../src/state/store.mjs";
import {
  createDirectClient,
  nextBackoffAt,
  QUEUE_STREAM,
} from "../src/memory/openbrain-direct.mjs";

const directories = [];
const fixturePrefix = path.join(path.dirname(fileURLToPath(import.meta.url)), "openbrain-direct-fixture-");

async function makeStore() {
  const directory = await mkdtemp(fixturePrefix);
  directories.push(directory);
  return { directory, store: createStore(directory) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
});

afterEach(async () => {
  vi.useRealTimers();
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

function transport(overrides = {}) {
  return {
    callTool: vi.fn(async () => ({ structuredContent: { ok: true, hits: [] } })),
    listTools: vi.fn(async () => ({ tools: [{
      name: "forget_thought",
      inputSchema: { required: ["id"], properties: { id: { type: "string" } } },
    }] })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

async function lifecycleClient(options = {}) {
  const fixture = await makeStore();
  const direct = createDirectClient({
    config: currentConfig(),
    secrets: secretReader(),
    store: fixture.store,
    ...options,
  });
  return { ...fixture, direct };
}

function observeSettlement(promise) {
  const observation = { settled: false };
  promise.then(
    () => { observation.settled = true; },
    () => { observation.settled = true; },
  );
  return observation;
}

async function queuePair(direct) {
  await direct.writeBot({ project: "pforge-claw:instance-a", content: "first accepted thought" });
  await direct.writeBot({ project: "pforge-claw:instance-a", content: "second accepted thought" });
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

describe("OpenBrain direct shutdown ownership (CP18)", () => {
  it.each(["resolve", "reject"])("settles a search closed during pending connect: %s", async (outcome) => {
    const connecting = deferred();
    const entered = deferred();
    const active = transport();
    const connect = vi.fn(() => { entered.resolve(); return connecting.promise; });
    const { direct } = await lifecycleClient({ connect });
    const searching = direct.searchAcross("query");
    await entered.promise;
    const searchSettlement = observeSettlement(searching);
    const closing = direct.close();
    await vi.advanceTimersByTimeAsync(0);
    const cancelledBeforeConnect = searchSettlement.settled;
    if (outcome === "resolve") connecting.resolve(active);
    else connecting.reject(new Error("connect failed with sensitive-test-token"));
    const [searchResult] = await Promise.all([searching, closing]);
    await direct.close();

    expect(cancelledBeforeConnect).toBe(true);
    expect(searchResult).toEqual({ ok: false, code: "OPENBRAIN_CLOSED", hits: [] });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(active.callTool).not.toHaveBeenCalled();
    expect(active.close).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
  });

  it.each(["resolve", "reject"])("keeps the durable queue unchanged when connect stops during drain: %s", async (outcome) => {
    const connecting = deferred();
    const entered = deferred();
    const active = transport();
    const connect = vi.fn(() => { entered.resolve(); return connecting.promise; });
    const { direct, store } = await lifecycleClient({ connect });
    await queuePair(direct);
    const before = queueState(store);
    const draining = direct.drain();
    expect(direct.drain()).toBe(draining);
    await entered.promise;
    const drainSettlement = observeSettlement(draining);
    const closing = direct.close();
    await vi.advanceTimersByTimeAsync(0);
    const cancelledBeforeConnect = drainSettlement.settled;
    if (outcome === "resolve") connecting.resolve(active);
    else connecting.reject(new Error("connect failed with sensitive-test-token"));
    const [drainResult] = await Promise.all([draining, closing]);

    expect(cancelledBeforeConnect).toBe(true);
    expect(drainResult).toEqual({
      ok: false, code: "OPENBRAIN_CLOSED", delivered: 0, retried: 0, deadLettered: 0,
    });
    expect(queueState(store)).toEqual(before);
    expect(active.callTool).not.toHaveBeenCalled();
    expect(active.close).toHaveBeenCalledTimes(outcome === "resolve" ? 1 : 0);
  });

  it.each(["resolve", "reject"])("cancels an active delivery without waiting for its remote outcome: %s", async (outcome) => {
    const delivery = deferred();
    const entered = deferred();
    const active = transport({
      callTool: vi.fn(() => { entered.resolve(); return delivery.promise; }),
    });
    const { direct, store } = await lifecycleClient({ connect: async () => active });
    await queuePair(direct);
    const before = queueState(store);
    const draining = direct.drain();
    await entered.promise;
    const drainSettlement = observeSettlement(draining);
    await direct.close();
    await vi.advanceTimersByTimeAsync(0);
    const cancelledBeforeDelivery = drainSettlement.settled;
    if (outcome === "resolve") delivery.resolve({ structuredContent: { ok: true } });
    else delivery.reject(new Error("delivery failed with sensitive-test-token"));
    const drainResult = await draining;
    await vi.advanceTimersByTimeAsync(0);

    expect(cancelledBeforeDelivery).toBe(true);
    expect(drainResult).toEqual({
      ok: false, code: "OPENBRAIN_CLOSED", delivered: 0, retried: 0, deadLettered: 0,
    });
    expect(queueState(store)).toEqual(before);
    expect(direct.queueCounts()).toEqual({ pending: 2, deadLetters: 0 });
    expect(active.callTool).toHaveBeenCalledTimes(1);
    expect(active.close).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"])("cancels a write waiting on sanitization without enqueueing: %s", async (outcome) => {
    const sanitizing = deferred();
    const entered = deferred();
    const connect = vi.fn(async () => transport());
    const idFactory = vi.fn(() => "must-not-be-queued");
    const { direct, store } = await lifecycleClient({
      connect,
      idFactory,
      sanitize: () => { entered.resolve(); return sanitizing.promise; },
    });
    const writing = direct.writeBot({ project: "pforge-claw:instance-a", content: "pending sanitize" });
    await entered.promise;
    const writeSettlement = observeSettlement(writing);
    await direct.close();
    await vi.advanceTimersByTimeAsync(0);
    const cancelledBeforeSanitize = writeSettlement.settled;
    if (outcome === "resolve") sanitizing.resolve("safe content");
    else sanitizing.reject(new Error("sanitize failed with sensitive-test-token"));
    const writeResult = await writing;
    await vi.advanceTimersByTimeAsync(0);

    expect(cancelledBeforeSanitize).toBe(true);
    expect(writeResult).toEqual({ ok: false, code: "OPENBRAIN_CLOSED" });
    expect(queueState(store).size).toBe(0);
    expect(idFactory).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ["search", (direct) => direct.searchAcross("query")],
    ["drain", (direct) => direct.drain()],
  ])("does not start a scheduled connection after immediate close: %s", async (_name, operation) => {
    const active = transport();
    const connect = vi.fn(async () => active);
    const { direct } = await lifecycleClient({ connect });
    const pending = operation(direct);
    await direct.close();
    const result = await pending;

    expect(result).toMatchObject({ ok: false, code: "OPENBRAIN_CLOSED" });
    expect(connect).not.toHaveBeenCalled();
    expect(active.callTool).not.toHaveBeenCalled();
  });

  it.each([
    ["search", (direct) => direct.searchAcross("query")],
    ["capabilities", (direct) => direct.capabilities()],
    ["remove", (direct) => direct.remove("memory-1")],
    ["health", (direct) => direct.health()],
  ])("explicitly cancels a pending remote operation on close: %s", async (name, operation) => {
    const response = deferred();
    const entered = deferred();
    const active = transport();
    active.callTool = vi.fn(() => { entered.resolve(); return response.promise; });
    if (name !== "remove") {
      active.listTools = vi.fn(() => { entered.resolve(); return response.promise; });
    }
    const { direct } = await lifecycleClient({ connect: async () => active });
    const pending = operation(direct);
    await entered.promise;
    const pendingSettlement = observeSettlement(pending);
    await direct.close();
    await vi.advanceTimersByTimeAsync(0);
    const cancelledBeforeResponse = pendingSettlement.settled;
    response.resolve({ structuredContent: { ok: true, hits: [] }, tools: [] });
    const result = await pending;
    await vi.advanceTimersByTimeAsync(0);

    expect(cancelledBeforeResponse).toBe(true);
    expect(result).toMatchObject({ ok: false, code: "OPENBRAIN_CLOSED" });
    expect(active.close).toHaveBeenCalledTimes(1);
    expect(active.callTool).toHaveBeenCalledTimes(name === "search" || name === "remove" ? 1 : 0);
    if (name === "capabilities" || name === "health") expect(active.listTools).toHaveBeenCalledTimes(1);
  });

  it("rejects all new operations after close without connecting or writing", async () => {
    const active = transport();
    const connect = vi.fn(async () => active);
    const sanitize = vi.fn((content) => content);
    const { direct, store } = await lifecycleClient({ connect, sanitize });
    await direct.close();
    const results = await Promise.all([
      direct.writeBot({ project: "pforge-claw:instance-a", content: "post-stop write" }),
      direct.drain(),
      direct.searchAcross("post-stop query"),
      direct.capabilities(),
      direct.remove("memory-1"),
      direct.health(),
    ]);

    for (const result of results) expect(result).toMatchObject({ ok: false, code: "OPENBRAIN_CLOSED" });
    expect(queueState(store).size).toBe(0);
    expect(connect).not.toHaveBeenCalled();
    expect(sanitize).not.toHaveBeenCalled();
  });

  it("shares concurrent and repeated close ownership until release settles", async () => {
    const releasing = deferred();
    const entered = deferred();
    const active = transport({
      close: vi.fn(() => { entered.resolve(); return releasing.promise; }),
    });
    const { direct } = await lifecycleClient({ connect: async () => active });
    expect(await direct.searchAcross("warm connection")).toEqual({ ok: true, hits: [] });
    const first = direct.close();
    const second = direct.close();
    const closeSettlement = observeSettlement(first);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(0);
    const settledBeforeRelease = closeSettlement.settled;
    releasing.resolve();
    await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(direct.close()).toBe(first);
    expect(settledBeforeRelease).toBe(false);
    expect(active.close).toHaveBeenCalledTimes(1);
  });

  it("reports a sanitized close failure once and remains terminal", async () => {
    const active = transport({
      close: vi.fn(async () => { throw new Error("release failed with sensitive-test-token"); }),
    });
    const connect = vi.fn(async () => active);
    const { direct } = await lifecycleClient({ connect });
    await direct.searchAcross("warm connection");
    const closing = direct.close();
    const failure = await closing.then(() => null, (error) => error);
    const repeatedFailure = await direct.close().then(() => null, (error) => error);

    expect(failure).toMatchObject({
      name: "ClawError", code: "OPENBRAIN_CLOSE_FAILED", message: "OPENBRAIN_CLOSE_FAILED",
    });
    expect(repeatedFailure).toBe(failure);
    expect(JSON.stringify(failure)).not.toContain("sensitive-test-token");
    expect(await direct.searchAcross("closed")).toEqual({ ok: false, code: "OPENBRAIN_CLOSED", hits: [] });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(active.close).toHaveBeenCalledTimes(1);
  });
});
