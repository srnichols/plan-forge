import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { ClawError } from "../src/errors.mjs";
import { assertTransport, backoffDelay, connectForever, mac, verifyMac } from "../src/protocol/auth.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { decode, encode, MAX_FRAME_BYTES, message } from "../src/protocol/messages.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createHttpServer } from "../src/http.mjs";

const temps = [];
const insecureLanUrl = "ws://" + "10." + "0.0.5";

afterEach(async () => {
  await Promise.all(temps.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-protocol-"));
  temps.push(directory);
  return directory;
}

function memoryStore() {
  const entries = [];
  return {
    append(_stream, entry) { entries.push(structuredClone(entry)); return entry; },
    fold(_stream, reducer, initial) { return entries.reduce(reducer, initial); },
    entries,
  };
}

const capabilities = { os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["p1"] };

function sampleMessages() {
  const event = { v: 1, jobId: "j1", seq: 1, ts: new Date(0).toISOString(), type: "started", data: {} };
  return [
    message("hello", { mode: "auth", workerId: "w1", laneId: "remote", capabilities }),
    message("hello", { mode: "enroll", laneId: "remote", codeId: "12345678", pub: "pub" }),
    message("challenge", { nonce: "a".repeat(64) }),
    message("auth", { workerId: "w1", mac: "b".repeat(64) }),
    message("enroll-auth", { mac: "b".repeat(64) }),
    message("ready", { leaseMs: 60_000, heartbeatMs: 15_000 }),
    message("ready", { workerId: "w1", pub: "pub", mac: "b".repeat(64) }),
    message("lease", { leaseId: "l1", attempt: 1, kind: "job", expiresAt: 1, job: { id: "j1" } }),
    message("lease", { leaseId: "l2", attempt: 1, kind: "read", expiresAt: 1, request: { tool: "forge_search", args: {} } }),
    message("ack", { leaseId: "l1", attempt: 1 }),
    message("event", { leaseId: "l1", attempt: 1, event }),
    message("cancel", { jobId: "j1" }),
    message("cancel", { leaseId: "l1" }),
    message("heartbeat", { ts: 1, leases: [{ leaseId: "l1", attempt: 1, lastSeq: 1 }] }),
    message("bye", { reason: "SHUTDOWN" }),
  ];
}

function listen(httpServer) {
  return new Promise((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve(httpServer.address().port)));
}

function connectClient(url) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url);
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

async function closeCode(client) {
  return new Promise((resolve) => client.once("close", (code) => resolve(code)));
}

describe("worker protocol codecs", () => {
  it("validates every defined message form and rejects malformed forms", () => {
    for (const packet of sampleMessages()) {
      expect(decode(encode(packet))).toEqual(packet);
      expect(() => decode(JSON.stringify({ ...packet, unexpected: true }))).toThrowError(ClawError);
    }
    for (const packet of [
      { v: 1, t: "hello", mode: "auth", workerId: "w", laneId: "r", capabilities: {} },
      { v: 1, t: "challenge", nonce: "short" },
      { v: 1, t: "auth", workerId: "w", mac: "not-hex" },
      { v: 1, t: "lease", leaseId: "x", attempt: 1, kind: "job", expiresAt: 1, job: {}, request: {} },
      { v: 1, t: "event", leaseId: "x", attempt: 1, event: { v: 1, jobId: "j", seq: 0, ts: "bad", type: "x", data: {} } },
      { v: 1, t: "heartbeat", ts: "now" },
      { v: 1, t: "unknown" },
    ]) expect(() => decode(JSON.stringify(packet))).toThrowError(ClawError);
  });

  it("rejects binary and oversized frames before parsing and reports protocol versions", () => {
    expect(() => decode(Buffer.from("{}"), { isBinary: true })).toThrowError(ClawError);
    expect(() => decode(Buffer.alloc(MAX_FRAME_BYTES + 1))).toThrowError(ClawError);
    expect(() => decode('{"v":2,"t":"bye","reason":"SHUTDOWN"}'))
      .toThrowError(expect.objectContaining({ code: "PROTO_VERSION_MISMATCH" }));
  });
});

describe("worker transport authentication", () => {
  it("verifies MACs without accepting malformed hex", () => {
    const proof = mac("secret", "nonce", "worker");
    expect(verifyMac("secret", "nonce", "worker", proof)).toBe(true);
    expect(verifyMac("wrong", "nonce", "worker", proof)).toBe(false);
    expect(verifyMac("secret", "nonce", "worker", "aa")).toBe(false);
    expect(verifyMac("secret", "nonce", "worker", "z".repeat(64))).toBe(false);
  });

  it("allows only secure or loopback transports unless explicitly warned", () => {
    expect(() => assertTransport(insecureLanUrl)).toThrowError(
      expect.objectContaining({ code: "INSECURE_TRANSPORT" }),
    );
    for (const url of ["ws://127.0.0.1", "ws://[::1]", "wss://example.test"]) {
      expect(() => assertTransport(url)).not.toThrow();
    }
    for (const url of ["http://example.test", "ws://u:p@example.test"]) {
      expect(() => assertTransport(url, { allowInsecureLan: true })).toThrowError(
        expect.objectContaining({ code: "INSECURE_TRANSPORT" }),
      );
    }
    const warnings = [];
    assertTransport(insecureLanUrl, { allowInsecureLan: true, warn: (warning) => warnings.push(warning) });
    assertTransport(insecureLanUrl, { allowInsecureLan: true, warn: (warning) => warnings.push(warning) });
    expect(warnings).toEqual(["INSECURE_TRANSPORT_ALLOWED", "INSECURE_TRANSPORT_ALLOWED"]);
  });

  it("applies deterministic jitter bounds", () => {
    expect(backoffDelay(0, () => 0)).toBe(400);
    expect(backoffDelay(0, () => 1)).toBeCloseTo(600);
  });

  it("rechecks transport policy on reconnect and stops permanently on protocol mismatch", () => {
    const sockets = [];
    const timers = [];
    const warnings = [];
    const permanent = [];
    class FakeSocket extends EventEmitter {
      constructor() {
        super();
        sockets.push(this);
      }
      close() {}
    }
    const controller = connectForever({
      url: insecureLanUrl,
      WebSocketImpl: FakeSocket,
      allowInsecureLan: true,
      beforeConnect: () => {
        assertTransport(insecureLanUrl, {
          allowInsecureLan: true, warn: (warning) => warnings.push(warning),
        });
      },
      rand: () => 0,
      setTimeoutFn: (callback, delay) => {
        const timer = { callback, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeoutFn: () => {},
      onPermanentClose: (code) => permanent.push(code),
    });
    sockets[0].emit("close", 1006);
    expect(timers).toHaveLength(1);
    timers[0].callback();
    expect(sockets).toHaveLength(2);
    expect(warnings).toEqual(["INSECURE_TRANSPORT_ALLOWED", "INSECURE_TRANSPORT_ALLOWED"]);
    sockets[1].emit("close", 4426);
    expect(permanent).toEqual([4426]);
    expect(timers).toHaveLength(1);
    controller.stop();
  });
});

describe("worker enrollment", () => {
  it("enforces single-use expiry and proof without recording the raw code", async () => {
    const store = memoryStore();
    const directory = await tempDirectory();
    let now = 0;
    let randomByte = 0;
    const enrollment = createEnrollment({
      store, secretFile: path.join(directory, "secrets.json"), now: () => now,
      randomBytesFn: (size) => Buffer.alloc(size, ++randomByte),
    });
    const code = enrollment.issue("remote");
    const codeId = store.entries[0].codeId;
    expect(JSON.stringify(store.entries)).not.toContain(code);
    expect(() => enrollment.consume({ codeId, laneId: "remote", verify: () => false }))
      .toThrowError(expect.objectContaining({ code: "ENROLL_BAD_PROOF" }));
    now = 15 * 60_000 - 1;
    const consumed = enrollment.consume({ codeId, laneId: "remote", verify: () => true });
    expect(consumed.laneId).toBe("remote");
    expect(() => enrollment.consume({ codeId, laneId: "remote", verify: () => true }))
      .toThrowError(expect.objectContaining({ code: "ENROLL_CODE_USED" }));
    const expiring = enrollment.issue("remote");
    now += 1;
    expect(() => enrollment.consume({
      codeId: store.entries.at(-1).codeId, laneId: "remote", verify: () => true,
    })).not.toThrow();
    expect(expiring).toBeTruthy();
  });

  it("expires at the exact boundary and revocation deletes the worker secret", async () => {
    const store = memoryStore();
    const directory = await tempDirectory();
    let now = 10;
    const secretFile = path.join(directory, "secrets.json");
    const enrollment = createEnrollment({
      store, secretFile, now: () => now, randomBytesFn: (size) => Buffer.alloc(size, 9),
    });
    enrollment.issue("remote");
    const codeId = store.entries[0].codeId;
    now += 15 * 60_000;
    expect(() => enrollment.consume({ codeId, laneId: "remote", verify: () => true }))
      .toThrowError(expect.objectContaining({ code: "ENROLL_CODE_EXPIRED" }));
    const fresh = createEnrollment({ store, secretFile, now: () => now });
    await fresh.register({ workerId: "w_test", laneId: "remote", secret: "never-log-this-secret" });
    expect(fresh.status("w_test")).toBe("active");
    await fresh.revoke("w_test");
    expect(fresh.status("w_test")).toBe("revoked");
    expect(await readFile(secretFile, "utf8")).not.toContain("never-log-this-secret");
  });
});

describe("worker WebSocket handshake", () => {
  const cleanup = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((close) => close()));
  });

  async function serverFor(enrollment, store, secrets, logger = { warn: () => {} }) {
    const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
    const registry = createWorkerRegistry();
    const server = createWorkerServer({
      registry, enrollment, secrets, logger, allowedLanes: ["remote"], handshakeMs: 1000,
    });
    server.attach(http);
    const { port } = await http.listen();
    cleanup.push(async () => {
      server.close();
      registry.close();
      await http.close();
      void store;
    });
    return `ws://127.0.0.1:${port}/claw/workers`;
  }

  async function handshake(url, workerId, proof) {
    const client = await connectClient(url);
    const incoming = [];
    client.on("message", (raw) => {
      const packet = JSON.parse(raw.toString());
      incoming.push(packet);
      if (packet.t === "challenge") {
        client.send(JSON.stringify({ v: 1, t: "auth", workerId, mac: proof(packet.nonce) }));
      }
    });
    client.send(JSON.stringify({
      v: 1, t: "hello", mode: "auth", workerId, laneId: "remote", capabilities,
    }));
    const closed = closeCode(client);
    return { client, incoming, closed };
  }

  it("rejects bad authentication, revoked workers, and pre-auth messages", async () => {
    const store = memoryStore();
    const directory = await tempDirectory();
    const enrollment = createEnrollment({ store, secretFile: path.join(directory, "secrets.json") });
    await enrollment.register({ workerId: "w_bad", laneId: "remote", secret: "right-secret" });
    const secrets = { get: () => "right-secret" };
    const url = await serverFor(enrollment, store, secrets);
    const bad = await handshake(url, "w_bad", () => "f".repeat(64));
    expect(await bad.closed).toBe(4401);
    expect(bad.incoming.some((packet) => packet.t === "ready")).toBe(false);

    await enrollment.revoke("w_bad");
    const revoked = await handshake(url, "w_bad", (nonce) => mac("right-secret", nonce, "w_bad"));
    expect(await revoked.closed).toBe(4403);

    const early = await connectClient(url);
    const earlyClosed = closeCode(early);
    early.send(JSON.stringify({ v: 1, t: "ack", leaseId: "x", attempt: 1 }));
    expect(await earlyClosed).toBe(4401);
  });

  it("rejects a changed protocol version with the permanent close code", async () => {
    const server = createServer();
    const port = await listen(server);
    const registry = createWorkerRegistry();
    const store = memoryStore();
    const enrollment = createEnrollment({ store, secretFile: path.join(await tempDirectory(), "secrets.json") });
    const wsServer = createWorkerServer({ registry, enrollment, secrets: { get: () => null } });
    wsServer.attach(server);
    cleanup.push(async () => {
      wsServer.close();
      registry.close();
      await new Promise((resolve) => server.close(resolve));
    });
    const client = await connectClient(`ws://127.0.0.1:${port}/claw/workers`);
    client.send(JSON.stringify({ v: 2, t: "hello" }));
    expect(await closeCode(client)).toBe(4426);
  });
});
