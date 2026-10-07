import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { assertLane } from "../src/lanes/lane.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createHttpServer } from "../src/http.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { createWorkerAgent, enrollWorker } from "../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import workersFeature from "../src/features/workers.mjs";

const directories = [];
const cleanups = [];
const workerCapabilities = {
  os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["p1"],
};

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-remote-lane-"));
  directories.push(directory);
  return directory;
}

async function eventually(assertion, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await assertion();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return assertion();
}

async function connectedSystem({
  runtime, readHandler = async () => ({ ok: true }), WebSocketImpl = WebSocket,
  logger = { warn: () => {}, error: () => {} },
  heartbeatMs = 100,
} = {}) {
  const directory = await tempDirectory();
  const secret = "fixture-worker-secret";
  const secretsFile = path.join(directory, "secrets.json");
  const records = [];
  const store = {
    append(_stream, record) { records.push(record); return record; },
    fold(_stream, reducer, initial) { return records.reduce(reducer, initial); },
  };
  const enrollment = createEnrollment({ store, secretFile: secretsFile });
  await enrollment.register({ workerId: "w_remote", laneId: "remote", secret });
  const registry = createWorkerRegistry();
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({
    registry,
    enrollment,
    secrets: { get: () => secret },
    allowedLanes: ["remote"],
    heartbeatMs,
  });
  server.attach(http);
  const { port } = await http.listen();
  const localLane = createLocalLane({
    id: "remote",
    maxHeavy: 1,
    runtime: runtime ?? {
      async run({ emit }) {
        emit("progress", { text: "working" });
        return { status: "succeeded" };
      },
    },
  });
  const agent = createWorkerAgent({
    url: `ws://127.0.0.1:${port}/claw/workers`,
    workerId: "w_remote",
    secret,
    laneId: "remote",
    capabilities: workerCapabilities,
    localLane,
    readHandler,
    heartbeatMs: 100,
    WebSocketImpl,
    logger,
  });
  const lane = createRemoteLane({ id: "remote", registry });
  agent.start();
  await eventually(() => {
    expect(lane.health().ok).toBe(true);
  });
  const close = async () => {
    agent.stop();
    server.close();
    registry.close();
    await http.close();
  };
  cleanups.push(close);
  return { agent, lane, localLane, registry, server, http, close };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("remote lane contract and transport", () => {
  it("satisfies the lane contract and carries local job events in order", async () => {
    const { lane } = await connectedSystem();
    expect(assertLane(lane)).toBe(lane);
    const events = [];
    for await (const event of lane.submit({
      id: "job-1", projectId: "p1", type: "ask", prompt: "test prompt",
    })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["started", "progress", "finished"]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
  });

  it("answers lightweight read leases and keeps them independent of a blocked job", async () => {
    let unblock;
    let cancellationObserved = false;
    const blocked = new Promise((resolve) => { unblock = resolve; });
    const { lane } = await connectedSystem({
      runtime: {
        run: async ({ signal }) => {
          signal.addEventListener("abort", () => { cancellationObserved = true; }, { once: true });
          await blocked;
          return { status: "succeeded" };
        },
      },
      readHandler: async ({ args }) => ({ toolResult: args.value }),
    });
    const jobEvents = lane.submit({
      id: "blocked-job", projectId: "p1", type: "task", prompt: "long",
    })[Symbol.asyncIterator]();
    await eventually(async () => {
      const next = await jobEvents.next();
      if (next.value?.type !== "started") throw new Error("not started");
    });
    const result = await lane.read({
      projectId: "p1", tool: "forge_search", args: { value: "ready" },
    }, { timeoutMs: 2000 });
    expect(result).toEqual({ toolResult: "ready" });
    expect(await lane.cancel("blocked-job")).toMatchObject({ ok: true, state: "cancelling" });
    await eventually(() => expect(cancellationObserved).toBe(true));
    unblock();
    const cancelledEvents = [];
    while (true) {
      const next = await jobEvents.next();
      if (next.done) break;
      cancelledEvents.push(next.value);
      if (next.value.type === "finished") break;
    }
    expect(cancelledEvents.at(-1).data.status).toBe("cancelled");
  });

  it("keeps read round trips within the platform latency budget", async () => {
    const { lane } = await connectedSystem({ readHandler: async () => ({ ok: true }) });
    await lane.read({ projectId: "p1", tool: "forge_search", args: {} });
    const durations = [];
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      await lane.read({ projectId: "p1", tool: "forge_search", args: { index } });
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    // The additional 50 ms on Windows accommodates local socket scheduling variance.
    expect(durations[2]).toBeLessThan(process.platform === "win32" ? 300 : 250);
  });

  it("completes enrollment, authentication, and a job without putting secrets on the wire", async () => {
    const directory = await tempDirectory();
    const secretFile = path.join(directory, "secrets.json");
    const records = [];
    let nonceByte = 1;
    const store = {
      append(_stream, record) { records.push(record); return record; },
      fold(_stream, reducer, initial) { return records.reduce(reducer, initial); },
    };
    const enrollment = createEnrollment({
      store, secretFile, randomBytesFn: (size) => Buffer.alloc(size, nonceByte++),
    });
    const code = enrollment.issue("remote");
    const registry = createWorkerRegistry();
    const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
    const logOutput = [];
    const logger = {
      warn: (...values) => logOutput.push(JSON.stringify(values)),
      error: (...values) => logOutput.push(JSON.stringify(values)),
    };
    const server = createWorkerServer({
      registry,
      enrollment,
      secrets: { get: (name) => JSON.parse(readFileSync(secretFile, "utf8"))[name] ?? null },
      allowedLanes: ["remote"],
      logger,
    });
    server.attach(http);
    const { port } = await http.listen();
    const wire = [];
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function captureSend(data, ...args) {
      wire.push(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
      return originalSend.call(this, data, ...args);
    };
    const localLane = createLocalLane({
      id: "remote",
      runtime: { async run({ emit }) { emit("progress", { step: 1 }); return { status: "succeeded" }; } },
    });
    let agent;
    try {
      const joined = await enrollWorker({
        url: `ws://127.0.0.1:${port}/claw/workers`, code, laneId: "remote",
      });
      agent = createWorkerAgent({
        url: `ws://127.0.0.1:${port}/claw/workers`,
        workerId: joined.workerId,
        secret: joined.secret,
        laneId: "remote",
        capabilities: workerCapabilities,
        localLane,
        readHandler: async () => ({}),
        heartbeatMs: 100,
        logger,
      });
      const lane = createRemoteLane({ id: "remote", registry });
      agent.start();
      await eventually(() => expect(lane.health().ok).toBe(true));
      const result = [];
      for await (const event of lane.submit({
        id: "enrolled-job", projectId: "p1", type: "ask", prompt: "hello",
      })) result.push(event);
      expect(result.at(-1).type).toBe("finished");
      const secretForms = [
        joined.secret,
        Buffer.from(joined.secret, "hex").toString("base64"),
        Buffer.from(joined.secret, "hex").toString("utf8"),
        code,
      ];
      for (const captured of [...wire, ...logOutput]) {
        for (const form of secretForms) expect(captured).not.toContain(form);
      }
    } finally {
      WebSocket.prototype.send = originalSend;
      agent?.stop();
      server.close();
      registry.close();
      await http.close();
    }
  });

  it("replays unacknowledged events after reconnect without duplicate consumer events", async () => {
    let releaseRuntime;
    const runtimeGate = new Promise((resolve) => { releaseRuntime = resolve; });
    const sockets = [];
    class CapturedWebSocket extends WebSocket {
      constructor(...args) {
        super(...args);
        sockets.push(this);
      }
    }
    const system = await connectedSystem({
      WebSocketImpl: CapturedWebSocket,
      runtime: {
        async run({ emit }) {
          emit("progress", { step: 1 });
          await runtimeGate;
          emit("progress", { step: 2 });
          return { status: "succeeded" };
        },
      },
    });
    try {
      const lane = system.lane;
      const stream = lane.submit({
        id: "replay-job", projectId: "p1", type: "task", prompt: "continue",
      })[Symbol.asyncIterator]();
      const nextWithin = async () => {
        const next = stream.next();
        let timer;
        try {
          return await Promise.race([
            next,
            new Promise((resolve) => { timer = setTimeout(() => resolve(null), 1500); }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      const first = await nextWithin();
      if (!first) throw new Error(JSON.stringify({ phase: "first-event", snapshot: system.registry.snapshot() }));
      expect(first.value.type).toBe("started");
      const second = await nextWithin();
      if (!second) throw new Error(JSON.stringify({ phase: "second-event", snapshot: system.registry.snapshot() }));
      expect(second.value.type).toBe("progress");
      sockets[0].terminate();
      releaseRuntime();
      await eventually(() => expect(sockets.length).toBeGreaterThan(1), 3000);
      const events = [first.value, second.value];
      while (true) {
        const next = await nextWithin();
        if (!next) throw new Error(JSON.stringify({
          phase: "replay-event", snapshot: system.registry.snapshot(), connections: sockets.length,
          leases: system.agent.activeLeases,
        }));
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === "finished") break;
      }
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
      expect(new Set(events.map((event) => event.seq)).size).toBe(events.length);
      await stream.return?.();
    } finally {
      releaseRuntime();
    }
  });

  it("reports no-worker health and then reflects a connected worker", async () => {
    const registry = createWorkerRegistry();
    const lane = createRemoteLane({ id: "remote", registry });
    expect(lane.health()).toMatchObject({ ok: false, code: "NO_WORKER" });
    registry.connect("w1", { laneId: "remote", capabilities: workerCapabilities, send: () => {} });
    expect(lane.health()).toMatchObject({ ok: true, workers: 1 });
    registry.close();
  });

  it("returns a structured timeout and removes an unread queued lease", async () => {
    vi.useFakeTimers();
    try {
      const registry = createWorkerRegistry();
      const lane = createRemoteLane({ id: "remote", registry });
      const read = lane.read({ tool: "forge_search", args: {} }, { timeoutMs: 500 });
      const assertion = expect(read).rejects.toMatchObject({ code: "READ_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(500);
      await assertion;
      expect(registry.snapshot().byLane.remote.pending).toBe(0);
      registry.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("lease recovery and fencing", () => {
  function fakeTimers() {
    let now = 0;
    let id = 0;
    const timers = new Map();
    return {
      now: () => now,
      setTimeoutFn(fn, delay) {
        const timer = { id: ++id, fn, due: now + delay, cleared: false };
        timers.set(timer.id, timer);
        return timer;
      },
      clearTimeoutFn(timer) {
        if (timer) timers.delete(timer.id);
      },
      advance(ms) {
        now += ms;
        while (true) {
          const due = [...timers.values()].filter((timer) => timer.due <= now).sort((a, b) => a.due - b.due)[0];
          if (!due) break;
          timers.delete(due.id);
          due.fn();
        }
      },
    };
  }

  it("requeues leases with a new attempt and ignores stale events until lease loss", async () => {
    const clock = fakeTimers();
    const messagesA = [];
    const messagesB = [];
    const registry = createWorkerRegistry({
      now: clock.now, setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn,
      ackMs: 10_000, leaseMs: 60_000, maxAttempts: 2,
    });
    registry.connect("A", { laneId: "remote", capabilities: workerCapabilities, send: (packet) => messagesA.push(packet) });
    registry.connect("B", { laneId: "remote", capabilities: workerCapabilities, send: (packet) => messagesB.push(packet) });
    const { iterator } = registry.enqueue("remote", {
      kind: "job", job: { id: "retry-job", projectId: "p1" },
    });
    const first = messagesA.find((packet) => packet.t === "lease");
    registry.onAck({ leaseId: first.leaseId, attempt: 1, workerId: "A" });
    clock.advance(60_000);
    const second = messagesB.find((packet) => packet.t === "lease");
    expect(second).toMatchObject({ attempt: 2, job: { id: "retry-job" } });
    expect(registry.onEvent({
      leaseId: first.leaseId, attempt: 1, workerId: "A",
      event: { v: 1, jobId: "retry-job", seq: 1, ts: new Date(0).toISOString(), type: "started", data: {} },
    })).toBe(false);
    registry.onAck({ leaseId: second.leaseId, attempt: 2, workerId: "B" });
    clock.advance(60_000);
    const events = [];
    for await (const event of iterator) events.push(event);
    expect(events.at(-1).data).toMatchObject({ status: "failed", code: "LEASE_LOST" });
    expect(registry.stats.staleDropped).toBe(1);
    registry.close();
  });

  it("drops duplicate sequence numbers and routes cancellation", async () => {
    const sent = [];
    const registry = createWorkerRegistry();
    registry.connect("w1", { laneId: "remote", capabilities: workerCapabilities, send: (packet) => sent.push(packet) });
    const { jobId } = registry.enqueue("remote", {
      kind: "job", job: { id: "cancel-me", projectId: "p1" },
    });
    const lease = sent.find((packet) => packet.t === "lease");
    registry.onAck({ leaseId: lease.leaseId, attempt: 1, workerId: "w1" });
    const event = {
      v: 1, jobId, seq: 1, ts: new Date(0).toISOString(), type: "started", data: {},
    };
    expect(registry.onEvent({ leaseId: lease.leaseId, attempt: 1, workerId: "w1", event })).toBe(true);
    expect(registry.onEvent({ leaseId: lease.leaseId, attempt: 1, workerId: "w1", event })).toBe(false);
    await registry.cancel(jobId);
    expect(sent.some((packet) => packet.t === "cancel" && packet.jobId === jobId)).toBe(true);
    expect(registry.stats.duplicatesDropped).toBe(1);
    registry.close();
  });

  it("settles iterators and releases the feature listener on close", async () => {
    const registry = createWorkerRegistry();
    const { iterator } = registry.enqueue("remote", {
      kind: "job", job: { id: "close-job", projectId: "p1" },
    });
    const reading = iterator[Symbol.asyncIterator]().next();
    registry.close();
    await expect(reading).resolves.toMatchObject({ value: { type: "finished" }, done: false });
  });
});

describe("workers feature lifecycle", () => {
  it("starts and stops a remote lane without leaving its listener running", async () => {
    const directory = await tempDirectory();
    const entries = [];
    const context = {
      home: directory,
      config: { lanes: [{ id: "remote", kind: "remote" }], http: { bind: "127.0.0.1", port: 0 } },
      store: {
        append(_stream, record) { entries.push(record); return record; },
        fold(_stream, reducer, initial) { return entries.reduce(reducer, initial); },
      },
      secrets: { get: () => null },
      logger: { warn: () => {} },
      bus: { emit: () => {} },
    };
    await workersFeature.start(context);
    expect(workersFeature.getLane("remote")?.health()).toMatchObject({ ok: false, code: "NO_WORKER" });
    await workersFeature.stop();
    await workersFeature.stop();
    expect(workersFeature.lanes()).toEqual([]);
  });
});
