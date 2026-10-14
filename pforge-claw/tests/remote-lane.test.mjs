import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { JOB_STATES, LANE_EVENT_TYPES } from "../src/enums.mjs";
import { assertLane } from "../src/lanes/lane.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createHttpServer } from "../src/http.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { createWorkerAgent, enrollWorker } from "../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { computeDelta, snapshotForge } from "../src/memory/l2-sync.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { LEASE_GRANT_INVALID } from "../src/protocol/lease-grant.mjs";
import { createSecrets } from "../src/secrets.mjs";
import workersFeature from "../src/features/workers.mjs";
import { buildLanes, createLaneDirectory } from "../src/lanes/directory.mjs";
import { decode, encode, L2_ACK_ERRORS, PUBLICATION_ERRORS, READ_ERRORS } from "../src/protocol/messages.mjs";

const directories = [];
const cleanups = [];
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPLAY_EVENT_LIMIT = 8;
const REPLAY_LIFECYCLE_LIMIT = 32;
const REPLAY_PAYLOAD_LIMIT = 8192;
const REPLAY_OBSERVED_MESSAGES = Object.freeze(["ready", "lease", "ack", "event"]);
const REPLAY_PHASES = Object.freeze([
  ...REPLAY_OBSERVED_MESSAGES, "socket-open", "socket-close", "frame-rejected",
  "runtime-start", "runtime-resume", "runtime-abort", "terminate-release",
]);
const REPLAY_SCALAR_FIELDS = Object.freeze(["connection", "attempt", "lastSeq", "seq", "ageMs", "closeCode"]);
const REPLAY_SAFE_CODES = Object.freeze([
  ...Object.values(PUBLICATION_ERRORS), ...Object.values(L2_ACK_ERRORS), ...Object.values(READ_ERRORS),
  LEASE_GRANT_INVALID, "JOB_CANCELLED", "JOB_BAD_FIELD", "JOB_DUPLICATE", "LANE_BAD_EVENT",
  "RUNTIME_BAD_CONTRACT", "RUNTIME_FAILED", "WORKER_FAILED", "WORKER_JOB_MODE_DENIED",
  "PROTO_BAD_MESSAGE", "PROTO_VERSION_MISMATCH", "PROTOCOL_FRAME_TOO_LARGE", "LEASE_LOST", "SERVER_CLOSED",
]);
const workerCapabilities = {
  os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["p1"],
};

async function tempDirectory() {
  const directory = await mkdtemp(path.join(TEST_DIRECTORY, ".claw-remote-lane-"));
  directories.push(directory);
  return directory;
}

async function eventually(assertion, timeoutMs = 5000) {
  // Generous polling tolerance accommodates Windows scheduling; assert observable state, not elapsed time.
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
  heartbeatMs = 100, l2, afterJob, applyL2, requireL2 = false,
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
  const registry = createWorkerRegistry({ applyL2, requireL2 });
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
    l2, afterJob,
    heartbeatMs: 100,
    WebSocketImpl,
    logger,
  });
  const lane = createRemoteLane({ id: "remote", registry });
  agent.start();
  await eventually(() => {
    expect(registry.snapshot().byLane.remote?.connected).toBe(1);
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

function safeReplayScalars(fields) {
  const scalars = {};
  for (const key of REPLAY_SCALAR_FIELDS) {
    if (Number.isSafeInteger(fields[key]) && fields[key] >= 0) scalars[key] = fields[key];
  }
  if (LANE_EVENT_TYPES.includes(fields.type)) scalars.type = fields.type;
  return scalars;
}

function buildReplayDiagnostics(events, { lifecycle = [], lifecycleTruncated = false, observationFailed = false } = {}) {
  const terminal = events.find((event) => event.type === "finished");
  const diagnostics = {
    events: events.slice(0, REPLAY_EVENT_LIMIT).map(({ seq, type }) => safeReplayScalars({ seq, type })),
    eventCount: events.length,
    eventsTruncated: events.length > REPLAY_EVENT_LIMIT,
    lifecycle: lifecycle.slice(0, REPLAY_LIFECYCLE_LIMIT)
      .filter(({ phase }) => REPLAY_PHASES.includes(phase))
      .map(({ phase, ...fields }) => ({ phase, ...safeReplayScalars(fields) })),
    lifecycleTruncated: lifecycleTruncated || lifecycle.length > REPLAY_LIFECYCLE_LIMIT,
    observationFailed: observationFailed === true,
    terminalCodePresent: Object.hasOwn(terminal?.data ?? {}, "code"),
    terminalErrorPresent: Object.hasOwn(terminal?.data ?? {}, "error"),
  };
  if (JOB_STATES.includes(terminal?.data?.status)) diagnostics.terminalStatus = terminal.data.status;
  if (REPLAY_SAFE_CODES.includes(terminal?.data?.code)) diagnostics.terminalCode = terminal.data.code;
  if (REPLAY_SAFE_CODES.includes(terminal?.data?.error)) diagnostics.terminalErrorCode = terminal.data.error;
  return diagnostics;
}

// Relative ages observe ordering only; the existing socket timing tolerance is unchanged.
function createReplayLifecycle({ now = () => performance.now() } = {}) {
  const started = now();
  const lifecycle = [];
  const observation = { failed: false };
  let lifecycleTruncated = false;
  function record(phase, fields = {}) {
    if (!REPLAY_PHASES.includes(phase)) return;
    if (lifecycle.length >= REPLAY_LIFECYCLE_LIMIT) {
      lifecycleTruncated = true;
      return;
    }
    const ageMs = Math.max(0, Math.round(now() - started));
    lifecycle.push({ phase, ...safeReplayScalars({ ...fields, ageMs }) });
  }
  return {
    record,
    observation,
    snapshot: () => ({ lifecycle: [...lifecycle], lifecycleTruncated, observationFailed: observation.failed }),
  };
}

function createReplayWebSocket({ sockets, record, observation = { failed: false }, WebSocketImpl = WebSocket }) {
  const connections = new WeakMap();
  function recordSafely(phase, fields) {
    try {
      record(phase, fields);
    } catch {
      // Observation must not interrupt native frame handling or send's error/return path.
      observation.failed = true;
      return;
    }
  }
  function observePacket(raw, isBinary, connection) {
    let packet;
    try {
      packet = decode(raw, { isBinary });
    } catch {
      recordSafely("frame-rejected", { connection });
      return;
    }
    if (!REPLAY_OBSERVED_MESSAGES.includes(packet.t)) return;
    recordSafely(packet.t, safeReplayScalars({
      connection, attempt: packet.attempt, lastSeq: packet.lastSeq,
      seq: packet.event?.seq, type: packet.event?.type,
    }));
  }
  return class CapturedWebSocket extends WebSocketImpl {
    constructor(...args) {
      super(...args);
      const connection = sockets.length;
      sockets.push(this);
      connections.set(this, connection);
      this.once("open", () => recordSafely("socket-open", { connection }));
      this.once("close", (closeCode) => recordSafely("socket-close", { connection, closeCode }));
      this.on("message", (raw, isBinary) => observePacket(raw, isBinary, connection));
    }
    send(...args) {
      observePacket(args[0], false, connections.get(this));
      return super.send(...args);
    }
  };
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.useRealTimers();
});

describe("replay diagnostic contract", () => {
  const terminal = (data) => ({ seq: 3, type: "finished", data: { status: "failed", ...data } });

  it("reports a recognized code-only failed terminal", () => {
    const diagnostics = buildReplayDiagnostics([terminal({ code: "LEASE_LOST" })]);
    expect(diagnostics).toMatchObject({
      terminalStatus: "failed", terminalCode: "LEASE_LOST", terminalCodePresent: true, terminalErrorPresent: false,
    });
    expect(diagnostics).not.toHaveProperty("terminalErrorCode");
  });

  it("preserves the recognized error-only terminal path", () => {
    const diagnostics = buildReplayDiagnostics([terminal({ error: PUBLICATION_ERRORS.TIMEOUT })]);
    expect(diagnostics).toMatchObject({
      terminalStatus: "failed", terminalErrorCode: PUBLICATION_ERRORS.TIMEOUT,
      terminalCodePresent: false, terminalErrorPresent: true,
    });
    expect(diagnostics).not.toHaveProperty("terminalCode");
  });

  it("reports recognized code and error fields independently", () => {
    expect(buildReplayDiagnostics([terminal({ code: "WORKER_FAILED", error: PUBLICATION_ERRORS.DENIED })]))
      .toMatchObject({
        terminalCode: "WORKER_FAILED", terminalErrorCode: PUBLICATION_ERRORS.DENIED,
        terminalCodePresent: true, terminalErrorPresent: true,
      });
  });

  it.each(["UNRECOGNIZED_PRIVATE_VALUE", "fixture raw error\nvalue", "X".repeat(200), 7, {}])(
    "omits unrecognized or non-code terminal values",
    (value) => {
      const diagnostics = buildReplayDiagnostics([terminal({ code: value, error: value })]);
      expect(diagnostics).toMatchObject({ terminalCodePresent: true, terminalErrorPresent: true });
      expect(diagnostics).not.toHaveProperty("terminalCode");
      expect(diagnostics).not.toHaveProperty("terminalErrorCode");
    },
  );

  it("distinguishes absent terminal properties from present but omitted values", () => {
    expect(buildReplayDiagnostics([terminal({})]))
      .toMatchObject({ terminalCodePresent: false, terminalErrorPresent: false });
    const diagnostics = buildReplayDiagnostics([terminal({ code: null, error: undefined })]);
    expect(diagnostics).toMatchObject({ terminalCodePresent: true, terminalErrorPresent: true });
    expect(diagnostics).not.toHaveProperty("terminalCode");
    expect(diagnostics).not.toHaveProperty("terminalErrorCode");
  });

  it("bounds events and lifecycle while retaining a terminal beyond the event sample", () => {
    const privateValue = "fixture-private-value";
    const events = Array.from({ length: REPLAY_EVENT_LIMIT * 4 }, (_, index) => ({
      seq: index + 1, type: "progress", jobId: privateValue, data: { text: privateValue },
    }));
    events.push(terminal({ code: "LEASE_LOST" }));
    const lifecycle = Array.from({ length: REPLAY_LIFECYCLE_LIMIT * 4 }, (_, ageMs) => ({
      phase: "event", ageMs, connection: Number.MAX_SAFE_INTEGER,
      attempt: Number.MAX_SAFE_INTEGER, lastSeq: Number.MAX_SAFE_INTEGER,
      seq: Number.MAX_SAFE_INTEGER, type: "artifact", jobId: privateValue, raw: privateValue,
    }));
    const diagnostics = buildReplayDiagnostics(events, { lifecycle, observationFailed: privateValue });
    expect(diagnostics.events).toHaveLength(REPLAY_EVENT_LIMIT);
    expect(diagnostics).toMatchObject({
      eventCount: events.length, eventsTruncated: true, lifecycleTruncated: true, terminalCode: "LEASE_LOST",
      observationFailed: false,
    });
    expect(diagnostics.lifecycle).toHaveLength(REPLAY_LIFECYCLE_LIMIT);
    const payload = JSON.stringify(diagnostics);
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(REPLAY_PAYLOAD_LIMIT);
    expect(payload).not.toContain(privateValue);
  });

  it("omits unrecognized labels, statuses and non-scalar event metadata", () => {
    const privateValue = "fixture-private-value";
    const diagnostics = buildReplayDiagnostics([
      { seq: privateValue, type: privateValue },
      terminal({ status: privateValue }),
    ], {
      lifecycle: [
        { phase: privateValue, ageMs: 0, raw: privateValue },
        { phase: "event", ageMs: 1, connection: privateValue, seq: Infinity, type: privateValue },
      ],
    });
    expect(JSON.stringify(diagnostics)).not.toContain(privateValue);
    expect(diagnostics.lifecycle).toEqual([{ phase: "event", ageMs: 1 }]);
  });

  it("records deterministic relative ages with a bounded lifecycle", () => {
    let now = 100;
    const observer = createReplayLifecycle({ now: () => now });
    now = 125;
    observer.record("runtime-start");
    now = 150;
    observer.record("runtime-resume");
    for (let index = 0; index < REPLAY_LIFECYCLE_LIMIT * 4; index++) observer.record("event", { seq: index });
    const snapshot = observer.snapshot();
    expect(snapshot.lifecycle).toHaveLength(REPLAY_LIFECYCLE_LIMIT);
    expect(snapshot.lifecycle.slice(0, 2)).toEqual([
      { phase: "runtime-start", ageMs: 25 }, { phase: "runtime-resume", ageMs: 50 },
    ]);
    expect(snapshot.lifecycleTruncated).toBe(true);
    expect(snapshot.observationFailed).toBe(false);
  });

  it("observes only allowlisted frame scalars and ignores heartbeat chatter", () => {
    class SendProbe extends EventEmitter {}
    SendProbe.prototype.send = vi.fn();
    const record = vi.fn();
    const CapturedWebSocket = createReplayWebSocket({ sockets: [], record, WebSocketImpl: SendProbe });
    const socket = new CapturedWebSocket();
    const privateValue = "fixture-private-value";
    socket.send(encode({
      v: 1, t: "event", leaseId: privateValue, attempt: 2,
      event: { v: 1, jobId: privateValue, seq: 3, ts: "2000-01-01T00:00:00.000Z",
        type: "progress", data: { text: privateValue } },
    }));
    for (let index = 0; index < REPLAY_LIFECYCLE_LIMIT * 4; index++) {
      socket.emit("message", encode({ v: 1, t: "heartbeat", ts: 0, leases: [] }), false);
    }
    expect(record.mock.calls).toEqual([["event", { connection: 0, attempt: 2, seq: 3, type: "progress" }]]);
    expect(JSON.stringify(record.mock.calls)).not.toContain(privateValue);
  });

  it("attests actual observer exceptions without leaking them or interrupting delivery", () => {
    class SendProbe extends EventEmitter {}
    const returned = {};
    const nativeSend = vi.fn(() => returned);
    SendProbe.prototype.send = nativeSend;
    const observer = createReplayLifecycle({ now: () => 0 });
    const privateValue = "fixture-hidden-observer-failure";
    const record = vi.fn(() => { throw new Error(privateValue); });
    const CapturedWebSocket = createReplayWebSocket({
      sockets: [], record, observation: observer.observation, WebSocketImpl: SendProbe,
    });
    const socket = new CapturedWebSocket();
    const consumer = vi.fn();
    socket.on("message", consumer);
    const raw = encode({ v: 1, t: "ack", leaseId: "fixture-lease", attempt: 1 });
    socket.emit("message", raw, false);
    expect(record).toHaveBeenCalledWith("ack", { connection: 0, attempt: 1 });
    expect(consumer).toHaveBeenCalledWith(raw, false);
    const callback = vi.fn();
    expect(socket.send(raw, callback)).toBe(returned);
    expect(nativeSend.mock.calls[0][0]).toBe(raw);
    expect(nativeSend.mock.calls[0][1]).toBe(callback);
    expect(nativeSend.mock.contexts[0]).toBe(socket);
    expect(callback).not.toHaveBeenCalled();
    const snapshot = observer.snapshot();
    expect(snapshot.observationFailed).toBe(true);
    const diagnostics = buildReplayDiagnostics([terminal({ code: "LEASE_LOST" })], snapshot);
    expect(diagnostics.observationFailed).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain(privateValue);
  });

  it("preserves literal send arguments, callbacks, return, receiver and native errors", () => {
    class SendProbe extends EventEmitter {}
    const returned = {};
    const nativeSend = vi.fn(() => returned);
    SendProbe.prototype.send = nativeSend;
    const record = vi.fn(() => { throw new Error("fixture observation failure"); });
    const CapturedWebSocket = createReplayWebSocket({ sockets: [], record, WebSocketImpl: SendProbe });
    const socket = new CapturedWebSocket();
    const raw = Buffer.from("fixture malformed frame");
    const options = { binary: true };
    const callback = vi.fn();
    expect(socket.send(raw, options, callback)).toBe(returned);
    expect(nativeSend.mock.calls[0][0]).toBe(raw);
    expect(nativeSend.mock.calls[0][1]).toBe(options);
    expect(nativeSend.mock.calls[0][2]).toBe(callback);
    expect(nativeSend.mock.contexts[0]).toBe(socket);
    expect(socket.send(raw, callback)).toBe(returned);
    expect(nativeSend.mock.calls[1][1]).toBe(callback);
    expect(callback).not.toHaveBeenCalled();
    const failure = new Error("fixture native send failure");
    nativeSend.mockImplementationOnce(() => { throw failure; });
    let caught;
    try {
      socket.send(raw, callback);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });
});

describe("remote lane contract and transport", () => {
  it("withholds job placement capacity from an authenticated legacy home worker while retaining its reads", async () => {
    class LegacyWebSocket extends WebSocket {
      send(raw, ...options) {
        const packet = decode(raw);
        if (packet.t === "hello" && packet.mode === "auth") delete packet.publicationFence;
        return super.send(encode(packet), ...options);
      }
    }
    const runtime = { run: vi.fn(async () => ({ status: "succeeded" })) };
    const system = await connectedSystem({
      WebSocketImpl: LegacyWebSocket, runtime,
      readHandler: async () => ({ legacyHome: true }),
    });
    expect(system.registry.snapshot().byLane.remote).toMatchObject({ connected: 1, publicationCapable: 0 });
    expect(await system.lane.read({ projectId: "p1", tool: "forge_search", args: { query: "history" } }))
      .toEqual({ legacyHome: true });
    expect(runtime.run).not.toHaveBeenCalled();
    expect(system.lane.health()).toMatchObject({
      ok: false, readAvailable: true, publicationCapable: 0, workers: 1, code: PUBLICATION_ERRORS.DENIED,
    });
  });

  it("refuses an already-aborted remote read without enqueueing or serializing its signal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    const lane = createRemoteLane({ id: "remote", registry });
    const controller = new AbortController();
    controller.abort();
    const rejected = expect(lane.read({ projectId: "p1", tool: "forge_status", args: {} }, { signal: controller.signal }))
      .rejects.toMatchObject({ code: "READ_CANCELLED" });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(registry.snapshot().byLane).toEqual({});
  });

  it("cancels a pending authenticated remote read and releases its registry lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sent = [];
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    registry.connect("w1", {
      laneId: "remote", capabilities: workerCapabilities, send: (packet) => sent.push(packet),
    });
    const lane = createRemoteLane({ id: "remote", registry });
    const controller = new AbortController();
    const reading = lane.read({ projectId: "p1", tool: "forge_status", args: {} }, { signal: controller.signal });
    const rejected = expect(reading).rejects.toMatchObject({ code: "READ_CANCELLED" });
    const lease = sent.find((packet) => packet.t === "lease");
    expect(lease.request).toMatchObject({ projectId: "p1", tool: "forge_status" });
    expect(lease.request).not.toHaveProperty("signal");
    controller.abort();
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(sent).toContainEqual(expect.objectContaining({ t: "cancel", leaseId: lease.leaseId }));
    expect(registry.snapshot().byLane.remote).toMatchObject({ pending: 0, active: 0 });
  });

  it("applies a verified in-flight checkpoint and a later final delta without replaying stale application ACKs", async () => {
    const root = await tempDirectory();
    const source = path.join(root, "source", ".forge");
    const checkout = path.join(root, "canonical");
    await mkdir(source, { recursive: true });
    await mkdir(checkout);
    const initial = await snapshotForge({ forgeDir: source });
    const receiver = createL2Receiver({
      config: {
        projects: [{ id: "p1", homeLane: "local", repo: { path: checkout } }],
        lanes: [{ id: "local", kind: "local" }, { id: "remote", kind: "remote" }],
      }, currentLaneId: "local",
    });
    let agent;
    let checkpointAck;
    const system = await connectedSystem({
      requireL2: true, applyL2: receiver.receive, l2: { forgeDirFor: () => source },
      runtime: { async run() {
        await mkdir(path.join(source, "runs", "checkpoint-job"), { recursive: true });
        await writeFile(path.join(source, "runs", "checkpoint-job", "checkpoint.json"), '{"checkpoint":true}');
        checkpointAck = await agent.syncHistory({
          jobId: "checkpoint-job", delta: await computeDelta({ forgeDir: source, snapshot: initial }),
        });
        await writeFile(path.join(source, "runs", "checkpoint-job", "final.json"), '{"final":true}');
        return { status: "succeeded" };
      } },
    });
    agent = system.agent;
    const delivered = [];
    for await (const event of system.lane.submit({
      id: "checkpoint-job", projectId: "p1", type: "task", prompt: "checkpoint",
    })) delivered.push(event);
    await agent.drain();
    expect(checkpointAck).toMatchObject({ jobId: "checkpoint-job", projectId: "p1", ok: true });
    expect(delivered.at(-1).data.status).toBe("succeeded");
    const identities = delivered.filter((event) => event.data.kind === "l2-delta").map((event) => event.data.sha256Total);
    expect(new Set(identities).size).toBe(2);
    expect(delivered.at(-1).data.l2.sha256Total).not.toBe(checkpointAck.sha256Total);
    expect(await readFile(path.join(checkout, ".forge", "runs", "checkpoint-job", "checkpoint.json"), "utf8"))
      .toBe('{"checkpoint":true}');
    expect(await readFile(path.join(checkout, ".forge", "runs", "checkpoint-job", "final.json"), "utf8"))
      .toBe('{"final":true}');
  });

  it.each(["local", "remote"])("applies canonical history on the %s home before terminal success and cleanup", async (homeLane) => {
    const root = await tempDirectory();
    const source = path.join(root, "source", ".forge");
    const checkout = path.join(root, "canonical");
    await mkdir(source, { recursive: true });
    await mkdir(checkout);
    const config = {
      projects: [{ id: "p1", homeLane, repo: { path: checkout } }],
      lanes: [{ id: "local", kind: "local" }, { id: "remote", kind: "remote" }],
    };
    const directory = new Map();
    const receiver = createL2Receiver({ config, currentLaneId: "local", directory });
    const home = createL2Receiver({ config, currentLaneId: homeLane });
    const observedCleanup = [];
    const system = await connectedSystem({
      requireL2: true, applyL2: receiver.receive, readHandler: home.read,
      l2: { forgeDirFor: () => source },
      runtime: { async run({ emit }) {
        await mkdir(path.join(source, "runs", "history-job"), { recursive: true });
        await writeFile(path.join(source, "runs", "history-job", "run.json"), '{"original":"canonical-canary"}\r\n');
        emit("artifact", { kind: "pr", url: "https://fixture.test/history" });
        return { status: "succeeded" };
      } },
      afterJob: async ({ event, applicationAck }) => {
        observedCleanup.push({
          event, applicationAck,
          bytes: await readFile(path.join(checkout, ".forge", "runs", "history-job", "run.json"), "utf8"),
        });
      },
    });
    directory.set("remote", system.lane);
    const delivered = [];
    for await (const event of system.lane.submit({
      id: "history-job", projectId: "p1", type: "task", prompt: "history",
    })) delivered.push(event);
    await system.agent.drain();
    const terminal = delivered.at(-1);
    expect(terminal.data).toMatchObject({
      status: "succeeded", l2: { jobId: "history-job", projectId: "p1", deltaId: "history-job", ok: true },
    });
    expect(system.registry.completion("history-job")).toMatchObject({
      ok: true, applicationAck: terminal.data.l2,
    });
    expect(observedCleanup).toHaveLength(1);
    expect(observedCleanup[0].bytes).toBe('{"original":"canonical-canary"}\r\n');
    expect(observedCleanup[0].applicationAck).toMatchObject(terminal.data.l2);
  });

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
    // Existing Windows +50ms latency tolerance accommodates local socket scheduling variance.
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      await lane.read({ projectId: "p1", tool: "forge_search", args: { index } });
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
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
    const secrets = await createSecrets({ env: {}, file: secretFile });
    const server = createWorkerServer({
      registry,
      enrollment,
      secrets,
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
      expect(secrets.get(`PFORGE_CLAW_WORKER_SECRET__${joined.workerId}`)).toBe(joined.secret);
      expect(secrets.redact(joined.secret)).not.toContain(joined.secret);
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
    const observer = createReplayLifecycle();
    const context = (events = []) => JSON.stringify(buildReplayDiagnostics(events, observer.snapshot()));
    const CapturedWebSocket = createReplayWebSocket({
      sockets, record: observer.record, observation: observer.observation,
    });
    const system = await connectedSystem({
      WebSocketImpl: CapturedWebSocket,
      runtime: {
        async run({ emit, signal }) {
          observer.record("runtime-start");
          signal.addEventListener("abort", () => observer.record("runtime-abort"), { once: true });
          emit("progress", { step: 1 });
          await runtimeGate;
          observer.record("runtime-resume");
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
        // Generous delivery tolerance bounds a real socket operation without asserting scheduler precision.
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
      if (!first) expect(first, context()).not.toBeNull();
      expect(first.value.type).toBe("started");
      const second = await nextWithin();
      if (!second) expect(second, context([first.value])).not.toBeNull();
      expect(second.value.type).toBe("progress");
      observer.record("terminate-release");
      sockets[0].terminate();
      releaseRuntime();
      await eventually(() => expect(sockets.length).toBeGreaterThan(1), 3000);
      const events = [first.value, second.value];
      while (true) {
        const next = await nextWithin();
        if (!next) expect(next, context(events)).not.toBeNull();
        if (next.done) break;
        events.push(next.value);
        if (next.value.type === "finished") break;
      }
      const diagnostics = buildReplayDiagnostics(events, observer.snapshot());
      expect(events.map((event) => event.seq), JSON.stringify(diagnostics)).toEqual([1, 2, 3, 4]);
      expect(new Set(events.map((event) => event.seq)).size, JSON.stringify(diagnostics)).toBe(events.length);
      await stream.return?.();
    } finally {
      releaseRuntime();
    }
  });

  it("reports no-worker health and then reflects a connected worker", async () => {
    const registry = createWorkerRegistry();
    const lane = createRemoteLane({ id: "remote", registry });
    expect(lane.health()).toMatchObject({ ok: false, code: "NO_WORKER" });
    registry.connect("w1", { laneId: "remote", capabilities: workerCapabilities, publicationFence: true, send: () => {} });
    expect(lane.health()).toMatchObject({ ok: true, workers: 1 });
    registry.close();
  });

  it("reports project eligibility from the same worker policy used for job leases", () => {
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    const lane = createRemoteLane({ id: "remote", registry });
    const directory = createLaneDirectory();
    directory.configure([{ id: "remote", kind: "remote" }]);
    directory.register(lane);
    registry.connect("unrelated", {
      laneId: "remote", capabilities: { projects: ["p2"] }, publicationFence: true, send: () => {},
    });
    expect(lane.health().ok).toBe(true);
    expect(directory.snapshot({ projectId: "p1" }).remote.projectEligible).toBe(false);
    registry.connect("read-only", {
      laneId: "remote", capabilities: { projects: ["p1"] }, publicationFence: false, send: () => {},
    });
    registry.connect("different-lane", {
      laneId: "another", capabilities: { projects: ["p1"] }, publicationFence: true, send: () => {},
    });
    expect(lane.health({ projectId: "p1" }).projectEligible).toBe(false);
    registry.connect("eligible", {
      laneId: "remote", capabilities: { projects: ["p1"] }, publicationFence: true, send: () => {},
    });
    expect(lane.health({ projectId: "p1" }).projectEligible).toBe(true);
    expect(lane.health()).not.toHaveProperty("projects");
  });

  it("refuses unavailable job admission when a worker disconnects before the first stream read", async () => {
    const registry = createWorkerRegistry();
    registry.connect("eligible", {
      laneId: "remote", capabilities: { projects: ["p1"] }, publicationFence: true, send: () => {},
    });
    const lane = createRemoteLane({ id: "remote", registry });
    const stream = lane.submit({ id: "disconnected-before-submit", projectId: "p1" });
    registry.disconnect("eligible");
    const next = stream.next().then((value) => ({ value }), (error) => ({ error }));
    try {
      await Promise.resolve();
      expect(registry.snapshot().byLane.remote.pending).toBe(0);
      expect((await next).error).toMatchObject({ code: "LANE_PROJECT_UNAVAILABLE" });
    } finally {
      registry.close();
      await next;
      await stream.return();
    }
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
  it.each([false, true])("fails closed without dropping prior artifacts when an unread event buffer fills (subscribed: %s)", async (subscribed) => {
    const sent = [];
    const registry = createWorkerRegistry({ maxReplay: 2 });
    registry.connect("w1", { laneId: "remote", capabilities: workerCapabilities, publicationFence: true, send: (packet) => sent.push(packet) });
    const { iterator } = registry.enqueue("remote", {
      kind: "job", job: { id: "buffer-job", projectId: "p1" },
    });
    const source = subscribed ? iterator[Symbol.asyncIterator]() : null;
    const lease = sent[0];
    for (let sequence = 1; sequence <= 3; sequence += 1) registry.onEvent({
      leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1",
      event: {
        v: 1, jobId: "buffer-job", seq: sequence, ts: new Date(0).toISOString(),
        type: "artifact", data: { kind: "pr", index: sequence },
      },
    });
    registry.onEvent({
      leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1",
      event: { v: 1, jobId: "buffer-job", seq: 4, ts: new Date(0).toISOString(), type: "finished", data: { status: "succeeded" } },
    });
    const delivered = [];
    const events = source ?? iterator[Symbol.asyncIterator]();
    while (true) {
      const next = await events.next();
      if (next.done) break;
      delivered.push(next.value);
    }
    expect(delivered.slice(0, 2).map((event) => event.data.index)).toEqual([1, 2]);
    expect(delivered.at(-1).data).toMatchObject({
      status: "failed", reason: "l2-sync-incomplete", l2: { ok: false, code: "L2_EVENT_BUFFER_FULL" },
    });
    expect(delivered).toHaveLength(3);
    expect(registry.completion("buffer-job").ok).toBe(false);
    expect(sent.some((packet) => packet.t === "cancel")).toBe(true);
    registry.close();
  });

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
    registry.connect("A", { laneId: "remote", capabilities: workerCapabilities, publicationFence: true, send: (packet) => messagesA.push(packet) });
    registry.connect("B", { laneId: "remote", capabilities: workerCapabilities, publicationFence: true, send: (packet) => messagesB.push(packet) });
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
    registry.connect("w1", { laneId: "remote", capabilities: workerCapabilities, publicationFence: true, send: (packet) => sent.push(packet) });
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
  it("starts for k8s-only configs, exposes registry and registers production lanes with fresh job keys", async () => {
    const directory = await tempDirectory();
    let secret = "fixture-first-lane-key";
    const config = {
      lanes: [{ id: "pods", kind: "k8s", k8s: { namespace: "fixture-workers", laneSecret: "FIXTURE_KEY" } }],
      http: { bind: "127.0.0.1", port: 0 },
      worker: { dispatcherUrl: "wss://fixture.example/claw/workers" },
    };
    const context = {
      home: directory, config, store: { append: () => {}, fold: (_stream, _reducer, initial) => initial },
      secrets: { get: () => secret }, logger: { warn: () => {} },
    };
    await workersFeature.start(context);
    cleanups.push(() => workersFeature.stop());
    expect(workersFeature.registry()).not.toBeNull();
    const first = workersFeature.jobKeyFor("pods", "j1");
    secret = "fixture-rotated-key";
    expect(workersFeature.jobKeyFor("pods", "j1")).not.toBe(first);
    const lanes = buildLanes({ directory: createLaneDirectory(), config });
    expect(lanes.get("pods").health()).toMatchObject({ ok: true, active: 0 });
    expect(typeof lanes.get("pods").prepareLease).toBe("function");
    expect(() => lanes.get("pods").submit({ id: "j1" })).toThrowError(expect.objectContaining({ code: "LEASE_NOT_PREPARED" }));
    await workersFeature.stop();
    expect(workersFeature.registry()).toBeNull();
  });
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
