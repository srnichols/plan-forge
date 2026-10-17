import { once } from "node:events";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer } from "../src/http.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { mac } from "../src/protocol/auth.mjs";
import { decode, encode, message } from "../src/protocol/messages.mjs";

const WORKER_ID = "worker-publication";
const SECRET = "publication-protocol-fixture-secret";
const FENCE_VERSION = 1;
const leases = {
  leaseMs: 60_000,
  currentConnection: null,
  current() { return this.currentConnection; },
  connect(_workerId, { connection }) { this.currentConnection = connection; },
  disconnect() {},
};
const cleanups = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function authenticate({
  completeHandshake = true, workerFence = FENCE_VERSION, registryFence = FENCE_VERSION,
} = {}) {
  const registry = {
    ...leases,
    publicationFence: registryFence,
    onPublication: vi.fn((packet) => message("publication-ack", {
      operation: packet.operation, leaseId: packet.leaseId, attempt: packet.attempt,
      jobId: packet.jobId, requestId: packet.requestId, ok: true,
    })),
  };
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({
    registry,
    enrollment: { status: () => "active", worker: () => ({ status: "active", laneId: "worker-lane" }) },
    secrets: { get: () => SECRET },
    allowedLanes: ["worker-lane"],
  });
  server.attach(http);
  const { port } = await http.listen();
  cleanups.push(async () => { server.close(); await http.close(); });
  const socket = new WebSocket(`ws://127.0.0.1:${port}/claw/workers`);
  const packets = [];
  const waits = [];
  socket.on("message", (raw) => {
    const packet = decode(raw);
    if (waits.length) waits.shift()(packet);
    else packets.push(packet);
  });
  const next = () => packets.length ? Promise.resolve(packets.shift()) : new Promise((resolve) => waits.push(resolve));
  cleanups.push(async () => {
    if (socket.readyState === WebSocket.CLOSED) return;
    const closed = once(socket, "close");
    socket.terminate();
    await closed;
  });
  await once(socket, "open");
  if (!completeHandshake) return { registry, socket, next };
  socket.send(encode(message("hello", {
    mode: "auth", workerId: WORKER_ID, laneId: "worker-lane",
    capabilities: { os: "fixture", arch: "fixture", macos: false, toolchains: ["node"], projects: [] },
    ...(workerFence === null ? {} : { publicationFence: workerFence }),
  })));
  const challenge = await next();
  socket.send(encode(message("auth", { workerId: WORKER_ID, mac: mac(SECRET, challenge.nonce, WORKER_ID) })));
  const ready = await next();
  expect(ready).toMatchObject({ t: "ready" });
  return { registry, socket, next, ready };
}

function publication(operation) {
  return message("publication", {
    operation, leaseId: "lease-one", attempt: 1, jobId: "job-one", requestId: "request-one",
  });
}

describe("Guard: publication frames are dispatched only through authenticated connection authority", () => {
  it("advertises mutation support only when both the authenticated worker and registry support it", async () => {
    const { registry, ready } = await authenticate();
    expect(ready.publicationFence).toBe(FENCE_VERSION);
    expect(registry.currentConnection.publicationFence).toBe(true);
  });

  it.each(["legacy-worker", "legacy-registry"])("keeps %s connected without granting mutation capability", async (legacy) => {
    const { registry, ready } = await authenticate({
      workerFence: legacy === "legacy-worker" ? null : FENCE_VERSION,
      registryFence: legacy === "legacy-registry" ? null : FENCE_VERSION,
    });
    expect(ready).not.toHaveProperty("publicationFence");
    expect(registry.currentConnection.publicationFence).toBe(false);
  });

  it("refuses publication before authentication rather than dispatching a reservation", async () => {
    const { registry, socket, next } = await authenticate({ completeHandshake: false });
    socket.send(encode(publication("begin")));
    expect(await next()).toMatchObject({ t: "bye", reason: "WORKER_EXPECTED_HELLO" });
    expect(registry.onPublication).not.toHaveBeenCalled();
  });

  it("rejects a caller-supplied worker identity on an authenticated publication frame", async () => {
    const { registry, socket, next } = await authenticate();
    socket.send(JSON.stringify({ ...publication("end"), workerId: "another-worker" }));
    expect(await next()).toMatchObject({ t: "bye", reason: "PROTO_BAD_MESSAGE" });
    expect(registry.onPublication).not.toHaveBeenCalled();
  });

  it.each(["begin", "end"])("routes a current authenticated %s frame and returns its validated ACK", async (operation) => {
    const { registry, socket, next } = await authenticate();
    const packet = publication(operation);
    socket.send(encode(packet));
    const answer = await next();
    expect(answer).toMatchObject({ t: "publication-ack", operation, ok: true, requestId: packet.requestId });
    expect(registry.onPublication).toHaveBeenCalledExactlyOnceWith({ ...packet, workerId: WORKER_ID });
  });

  it("allows an authenticated retired END to settle its retained reservation but never a new BEGIN", async () => {
    const { registry, socket, next } = await authenticate();
    registry.currentConnection = { replaced: true };
    socket.send(encode(publication("begin")));
    socket.send(encode(publication("end")));
    expect(await next()).toMatchObject({ t: "publication-ack", operation: "end", ok: true });
    expect(registry.onPublication).toHaveBeenCalledExactlyOnceWith({
      ...publication("end"), workerId: WORKER_ID,
    });
  });
});
