import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { decode, encode, message } from "../src/protocol/messages.mjs";
import { matchesLeaseAck } from "../src/protocol/l2-ack.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { snapshotForge, computeDelta, encodeDeltaChunks } from "../src/memory/l2-sync.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const cleanups = [];

afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  vi.useRealTimers();
});

async function fixture({
  registry, ackTimeoutMs = 30_000, afterJob, onLeaseAcked, jobType = "task", runtimeResult = {},
} = {}) {
  const root = await mkdtemp(path.join(TEST_DIRECTORY, ".worker-ack-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const forgeDir = path.join(root, "source", ".forge");
  const canonical = path.join(root, "canonical", ".forge");
  await mkdir(forgeDir, { recursive: true });
  let socket;
  const sent = [];
  const receive = (packet) => socket.emit("message", Buffer.from(encode(packet)), false);
  class Socket extends EventEmitter {
    OPEN = 1;
    readyState = 1;
    constructor() { super(); socket = this; }
    send(raw) {
      const packet = JSON.parse(raw);
      sent.push(packet);
      if (packet.t === "ack") registry?.onAck({ ...packet, workerId: "w1" });
      if (packet.t === "event") registry?.onEvent({ ...packet, workerId: "w1" });
    }
    close() { this.readyState = 3; }
  }
  const localLane = createLocalLane({
    id: "remote",
    runtime: { async run({ emit }) {
      await mkdir(path.join(forgeDir, "runs", "j1"), { recursive: true });
      await writeFile(path.join(forgeDir, "runs", "j1", "run.json"), '{"source":"only-copy"}');
      emit("artifact", { kind: "pr", url: "https://fixture.test/pr/1" });
      return { status: "succeeded", ...runtimeResult };
    } },
  });
  const agent = createWorkerAgent({
    url: "ws://127.0.0.1/claw/workers", workerId: "w1", secret: "fixture", laneId: "remote",
    capabilities: { os: "linux", arch: "x64", macos: false, toolchains: [], projects: ["p1"] },
    localLane, readHandler: async () => ({}), WebSocketImpl: Socket,
    logger: { warn() {}, error() {} }, l2: { forgeDirFor: () => forgeDir, ackTimeoutMs },
    afterJob, onLeaseAcked,
  });
  agent.start();
  socket.emit("open");
  const job = {
    id: "j1", projectId: "p1", type: jobType,
    ...(jobType === "plan" ? { planPath: path.join("docs", "plans", "Phase-example-PLAN.md") } : {}),
  };
  let lease;
  if (registry) {
    const serverPackets = [];
    registry.connect("w1", {
      laneId: "remote", capabilities: { projects: ["p1"] },
      send: (packet) => { serverPackets.push(packet); receive(packet); },
    });
    registry.enqueue("remote", { kind: "job", job });
    lease = serverPackets.find((packet) => packet.t === "lease");
  } else {
    lease = message("lease", {
      leaseId: "l1", attempt: 1, kind: "job", expiresAt: Date.now() + 60_000, job,
    });
    receive(lease);
  }
  cleanups.push(async () => { agent.stop(); await agent.drain(); });
  await vi.waitFor(() => expect(sent.some((packet) => packet.event?.data.kind === "l2-delta")).toBe(true));
  return { root, forgeDir, canonical, agent, sent, receive, lease };
}

async function actualsFixture({ jobType = "plan", runtimeResult = {} } = {}) {
  const ready = Promise.withResolvers();
  let receiver;
  const registry = createWorkerRegistry({
    requireL2: true, applyL2: async (transfer) => {
      await ready.promise;
      if (!receiver) throw new Error("Fixture canonical receiver unavailable");
      return receiver.receive(transfer);
    },
  });
  cleanups.push(() => registry.close());
  const system = await fixture({ registry, jobType, runtimeResult });
  cleanups.push(() => ready.resolve());
  const checkout = path.dirname(system.canonical);
  await mkdir(checkout, { recursive: true });
  receiver = createL2Receiver({
    config: {
      projects: [{ id: "p1", homeLane: "home", repo: { path: checkout } }],
      lanes: [{ id: "home", kind: "local" }],
    }, currentLaneId: "home",
  });
  ready.resolve();
  await system.agent.drain();
  const packet = system.sent.find((item) => item.event?.type === "finished");
  const decoded = decode(Buffer.from(encode(packet)));
  const completion = registry.completion("j1");
  expect(completion).toMatchObject({ ok: true, applicationAck: { ok: true } });
  expect(completion.event.data.l2).toMatchObject(completion.applicationAck);
  expect(await readFile(path.join(system.canonical, "runs", "j1", "run.json"), "utf8"))
    .toBe('{"source":"only-copy"}');
  return { terminal: decoded.event.data, completion };
}

function planActuals(usage = { costUSD: 0, premiumRequests: null }) {
  return {
    jobId: "j1", projectId: "p1", runId: "run-1", plan: "Phase-example-PLAN.md",
    endedAt: "1970-01-01T00:00:00.000Z", usage,
  };
}

describe("worker application acknowledgements", () => {
  it("does not accept missing or unsafe lease identity as a current wire ACK", () => {
    expect(matchesLeaseAck({}, {})).toBe(false);
    expect(matchesLeaseAck({ leaseId: "l1", attempt: 1.5 }, { leaseId: "l1", attempt: 1.5 })).toBe(false);
    expect(matchesLeaseAck({ leaseId: "l1", attempt: 0 }, { leaseId: "l1", attempt: 0 })).toBe(false);
    expect(matchesLeaseAck({ leaseId: "l1", attempt: 1 }, { leaseId: "l1", attempt: 1 })).toBe(true);
  });

  it.each([
    { costUSD: 0, premiumRequests: null },
    { costUSD: null, premiumRequests: 0 },
    { costUSD: 0 },
  ])("preserves bounded native planActuals through wire, canonical ACK and completion (%j)", async (usage) => {
    const actuals = planActuals(usage);
    const { terminal, completion } = await actualsFixture({ runtimeResult: { planActuals: actuals } });
    const expected = { ...actuals, usage: { ...usage, premiumRequests: usage.premiumRequests ?? null } };
    expect(terminal.planActuals).toEqual(expected);
    expect(completion.event.data.planActuals).toEqual(expected);
    expect(terminal).not.toHaveProperty("result");
    expect(terminal).not.toHaveProperty("runId");
  });

  it("preserves explicit unknown plan actuals without flattening nested SDK or native aggregate data", async () => {
    for (const runtimeResult of [
      {},
      { result: { planActuals: planActuals() } },
      { planActuals: { latest: { plan: "another-plan" }, total_cost_usd: 100 } },
    ]) {
      const { terminal, completion } = await actualsFixture({ runtimeResult });
      expect(terminal.planActuals).toBeNull();
      expect(terminal.planActualsError).toMatch(/^[A-Z0-9_]{1,64}$/);
      expect(completion.event.data.planActuals).toBeNull();
      expect(terminal).not.toHaveProperty("costUSD");
    }
  });

  it("does not promote SDK/task-invented plan actuals into non-plan terminal metadata", async () => {
    const { terminal, completion } = await actualsFixture({
      jobType: "task", runtimeResult: { planActuals: planActuals() },
    });
    expect(terminal).not.toHaveProperty("planActuals");
    expect(terminal).not.toHaveProperty("planActualsError");
    expect(completion.event.data).not.toHaveProperty("planActuals");
  });

  it("does not finish or run cleanup merely because all artifact sequences were received", async () => {
    const cleaned = vi.fn();
    const system = await fixture({ afterJob: cleaned });
    const artifact = system.sent.find((packet) => packet.event?.data.kind === "l2-delta");
    system.receive(message("heartbeat", {
      ts: 0, leases: [{ leaseId: "l1", attempt: 1, lastSeq: artifact.event.seq }],
    }));
    await Promise.resolve();
    expect(system.sent.filter((packet) => packet.event?.type === "finished")).toEqual([]);
    expect(cleaned).not.toHaveBeenCalled();
    expect(await readFile(path.join(system.forgeDir, "runs", "j1", "run.json"), "utf8"))
      .toBe('{"source":"only-copy"}');
  });

  it("accepts only a matching job, project, delta, checksum and current-attempt application ACK", async () => {
    const cleaned = vi.fn();
    const system = await fixture({ afterJob: cleaned });
    const chunk = system.sent.find((packet) => packet.event?.data.kind === "l2-delta").event.data;
    const ack = {
      leaseId: "l1", attempt: 1, jobId: "j1", projectId: "p1",
      deltaId: chunk.deltaId, sha256Total: chunk.sha256Total, ok: true,
    };
    for (const changed of [
      { leaseId: "other" }, { attempt: 2 }, { jobId: "other" }, { projectId: "other" },
      { deltaId: "other" }, { sha256Total: "a".repeat(64) },
    ]) system.receive(message("l2-applied", { ...ack, ...changed }));
    await Promise.resolve();
    expect(cleaned).not.toHaveBeenCalled();
    system.receive(message("l2-applied", ack));
    await system.agent.drain();
    expect(system.sent.find((packet) => packet.event?.type === "finished").event.data)
      .toMatchObject({ status: "succeeded", l2: { ok: true, deltaId: chunk.deltaId } });
    expect(cleaned).toHaveBeenCalledOnce();
    expect(cleaned.mock.calls[0][0].applicationAck).toEqual(ack);
    system.receive(message("l2-applied", ack));
    expect(cleaned).toHaveBeenCalledOnce();
  });

  it("requires a fresh current-lease ACK when a verified checkpoint is rebound before terminal cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cleaned = vi.fn();
    const system = await fixture({ afterJob: cleaned });
    const chunk = system.sent.find((packet) => packet.event?.data.kind === "l2-delta").event.data;
    const acknowledged = {
      leaseId: "l1", attempt: 1, jobId: "j1", projectId: "p1",
      deltaId: chunk.deltaId, sha256Total: chunk.sha256Total, ok: true,
    };
    system.receive(message("l2-applied", acknowledged));
    system.receive(message("lease", { ...system.lease, leaseId: "l2", attempt: 2 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(system.sent.filter((packet) => packet.event?.type === "finished")).toEqual([]);
    expect(cleaned).not.toHaveBeenCalled();
    system.receive(message("l2-applied", acknowledged));
    await vi.advanceTimersByTimeAsync(0);
    expect(cleaned).not.toHaveBeenCalled();
    const current = { ...acknowledged, leaseId: "l2", attempt: 2 };
    system.receive(message("l2-applied", current));
    await system.agent.drain();
    expect(system.sent.find((packet) => packet.event?.type === "finished").event.data)
      .toMatchObject({ status: "succeeded", l2: { ok: true, sha256Total: chunk.sha256Total } });
    expect(cleaned).toHaveBeenCalledOnce();
    expect(cleaned.mock.calls[0][0].applicationAck).toEqual(current);
  });

  it("retains source history and fails closed when canonical application fails", async () => {
    const cleaned = vi.fn();
    const system = await fixture({ afterJob: cleaned });
    const chunk = system.sent.find((packet) => packet.event?.data.kind === "l2-delta").event.data;
    system.receive(message("l2-applied", {
      leaseId: "l1", attempt: 1, jobId: "j1", projectId: "p1",
      deltaId: chunk.deltaId, sha256Total: chunk.sha256Total, ok: false, code: "L2_CONFLICT",
    }));
    await system.agent.drain();
    const finished = system.sent.find((packet) => packet.event?.type === "finished").event;
    expect(finished.data).toMatchObject({
      status: "failed", reason: "l2-sync-incomplete", l2: { ok: false, code: "L2_CONFLICT" },
    });
    expect(cleaned.mock.calls[0][0].applicationAck.ok).toBe(false);
    expect(await readFile(path.join(system.forgeDir, "runs", "j1", "run.json"), "utf8"))
      .toBe('{"source":"only-copy"}');
  });

  it("marks an unreachable home incomplete at the ACK deadline while retaining its delta", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const system = await fixture({ ackTimeoutMs: 30_000 });
    const draining = system.agent.drain();
    await vi.advanceTimersByTimeAsync(30_000);
    await draining;
    const terminal = system.sent.find((packet) => packet.event?.type === "finished").event;
    expect(terminal.data).toMatchObject({
      status: "failed", reason: "l2-sync-incomplete", l2: { ok: false, code: "L2_APPLY_TIMEOUT" },
    });
    const delta = await computeDelta({
      forgeDir: system.forgeDir, snapshot: await snapshotForge({ forgeDir: system.canonical }),
    });
    expect(encodeDeltaChunks({ delta, deltaId: "j1" })[0].sha256Total)
      .toBe(system.sent.find((packet) => packet.event?.data.kind === "l2-delta").event.data.sha256Total);
  });

  it("cancels an ACK wait without converting a late ACK into success or removing source history", async () => {
    const cleaned = vi.fn();
    const system = await fixture({ afterJob: cleaned });
    const chunk = system.sent.find((packet) => packet.event?.data.kind === "l2-delta").event.data;
    system.receive(message("cancel", { leaseId: "l1" }));
    system.receive(message("l2-applied", {
      leaseId: "l1", attempt: 1, jobId: "j1", projectId: "p1",
      deltaId: chunk.deltaId, sha256Total: chunk.sha256Total, ok: true,
    }));
    await system.agent.drain();
    expect(system.sent.find((packet) => packet.event?.type === "finished").event.data)
      .toMatchObject({ status: "cancelled", l2: { ok: false, code: "L2_APPLY_CANCELLED" } });
    expect(cleaned.mock.calls[0][0].applicationAck.ok).toBe(false);
    expect(await readFile(path.join(system.forgeDir, "runs", "j1", "run.json"), "utf8"))
      .toBe('{"source":"only-copy"}');
  });

  it("settles outstanding ACK waits on stop with negative application proof", async () => {
    const cleaned = vi.fn();
    const system = await fixture({ afterJob: cleaned });
    system.agent.stop();
    await system.agent.drain();
    expect(cleaned).toHaveBeenCalledOnce();
    expect(cleaned.mock.calls[0][0].applicationAck).toMatchObject({ ok: false, code: "L2_APPLY_CANCELLED" });
    expect(await readFile(path.join(system.forgeDir, "runs", "j1", "run.json"), "utf8"))
      .toBe('{"source":"only-copy"}');
  });

  it("keeps the terminal receipt hook behind completion of asynchronous cleanup", async () => {
    const cleanup = Promise.withResolvers();
    const notified = vi.fn();
    cleanups.push(() => cleanup.resolve());
    const system = await fixture({
      afterJob: () => cleanup.promise, onLeaseAcked: notified,
    });
    const chunk = system.sent.find((packet) => packet.event?.data.kind === "l2-delta").event.data;
    system.receive(message("l2-applied", {
      leaseId: "l1", attempt: 1, jobId: "j1", projectId: "p1",
      deltaId: chunk.deltaId, sha256Total: chunk.sha256Total, ok: true,
    }));
    await vi.waitFor(() => expect(system.sent.some((packet) => packet.event?.type === "finished")).toBe(true));
    const terminal = system.sent.find((packet) => packet.event?.type === "finished").event;
    system.receive(message("heartbeat", {
      ts: 0, leases: [{ leaseId: "l1", attempt: 1, lastSeq: terminal.seq }],
    }));
    await Promise.resolve();
    expect(notified).not.toHaveBeenCalled();
    cleanup.resolve();
    await system.agent.drain();
    expect(notified).toHaveBeenCalledOnce();
    expect(notified.mock.calls[0][0].applicationAck.ok).toBe(true);
  });

  it("shares an explicit finalizer history sync with terminal delivery without duplicate chunks", async () => {
    const system = await fixture();
    const artifact = system.sent.find((packet) => packet.event?.data.kind === "l2-delta");
    const delta = await computeDelta({
      forgeDir: system.forgeDir, snapshot: await snapshotForge({ forgeDir: system.canonical }),
    });
    const syncing = system.agent.syncHistory({ jobId: "j1", delta });
    expect(system.sent.filter((packet) => packet.event?.data.kind === "l2-delta")).toHaveLength(1);
    const ack = {
      leaseId: "l1", attempt: 1, jobId: "j1", projectId: "p1",
      deltaId: artifact.event.data.deltaId, sha256Total: artifact.event.data.sha256Total, ok: true,
    };
    system.receive(message("l2-applied", ack));
    expect(await syncing).toEqual(ack);
    await system.agent.drain();
    expect(system.sent.filter((packet) => packet.event?.data.kind === "l2-delta")).toHaveLength(1);
    expect(system.sent.filter((packet) => packet.event?.type === "finished")).toHaveLength(1);
  });

  it("refuses success-shaped registry completion without canonical application proof", () => {
    const sent = [];
    const delivered = [];
    const registry = createWorkerRegistry({ requireL2: true, onEvent: (event) => delivered.push(event) });
    cleanups.push(() => registry.close());
    registry.connect("w1", {
      laneId: "remote", capabilities: { projects: ["p1"] }, send: (packet) => sent.push(packet),
    });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1" } });
    const lease = sent[0];
    registry.onEvent({
      leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1",
      event: { v: 1, jobId: "j1", seq: 1, ts: new Date(0).toISOString(), type: "finished", data: { status: "succeeded" } },
    });
    expect(delivered.at(-1).data).toMatchObject({
      status: "failed", reason: "l2-sync-incomplete", l2: { ok: false, code: "L2_APPLY_UNCONFIRMED" },
    });
  });

  it("never upgrades a rejected transfer when an earlier application callback resolves later", async () => {
    const application = Promise.withResolvers();
    const sent = [];
    const registry = createWorkerRegistry({ requireL2: true, applyL2: () => application.promise });
    cleanups.push(() => registry.close());
    registry.connect("w1", {
      laneId: "remote", capabilities: { projects: ["p1"] }, send: (packet) => sent.push(packet),
    });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1" } });
    const lease = sent[0];
    registry.onAck({ leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1" });
    const chunk = encodeDeltaChunks({ delta: { files: [], jsonl: {}, maps: {} }, deltaId: "j1" })[0];
    const artifact = (seq, data) => registry.onEvent({
      leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1",
      event: { v: 1, jobId: "j1", seq, ts: new Date(0).toISOString(), type: "artifact", data },
    });
    artifact(1, chunk);
    artifact(2, { ...chunk, total: 2 });
    application.resolve({ jobId: "j1", projectId: "p1", deltaId: "j1", sha256Total: chunk.sha256Total, ok: true });
    await Promise.resolve();
    await Promise.resolve();
    const acks = sent.filter((packet) => packet.t === "l2-applied");
    expect(acks.length).toBeGreaterThan(0);
    expect(acks.every((ack) => ack.ok === false)).toBe(true);
  });

  it("returns only verified application completion and honors cancellation even for cached results", async () => {
    const sent = [];
    const registry = createWorkerRegistry({
      requireL2: true,
      applyL2: async ({ chunks, ...identity }) => { expect(chunks).toHaveLength(1); return { ...identity, ok: true }; },
    });
    cleanups.push(() => registry.close());
    registry.connect("w1", {
      laneId: "remote", capabilities: { projects: ["p1"] }, send: (packet) => sent.push(packet),
    });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1" } });
    const waiting = registry.waitForCompletion({ jobId: "j1" });
    const lease = sent[0];
    registry.onAck({ leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1" });
    const chunk = encodeDeltaChunks({ delta: { files: [], jsonl: {}, maps: {} }, deltaId: "j1" })[0];
    const identity = { jobId: "j1", projectId: "p1", deltaId: "j1", sha256Total: chunk.sha256Total };
    const emit = (seq, type, data) => registry.onEvent({
      leaseId: lease.leaseId, attempt: lease.attempt, workerId: "w1",
      event: { v: 1, jobId: "j1", seq, ts: new Date(0).toISOString(), type, data },
    });
    emit(1, "artifact", chunk);
    await vi.waitFor(() => expect(sent.some((packet) => packet.t === "l2-applied" && packet.ok)).toBe(true));
    emit(2, "finished", { status: "succeeded", l2: { ...identity, ok: true } });
    expect(await waiting).toMatchObject({ ok: true, applicationAck: { ...identity, ok: true } });
    const controller = new AbortController();
    controller.abort();
    await expect(registry.waitForCompletion({ jobId: "j1", signal: controller.signal }))
      .rejects.toMatchObject({ code: "JOB_CANCELLED" });
  });

  it("times out or aborts completion waiters without treating receipt sequences as success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = createWorkerRegistry({ requireL2: true });
    cleanups.push(() => registry.close());
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1" } });
    const timeout = expect(registry.waitForCompletion({ jobId: "j1", timeoutMs: 1000 }))
      .rejects.toMatchObject({ code: "L2_APPLY_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000);
    await timeout;
    const controller = new AbortController();
    const aborted = expect(registry.waitForCompletion({ jobId: "j1", signal: controller.signal }))
      .rejects.toMatchObject({ code: "JOB_CANCELLED" });
    controller.abort();
    await aborted;
    await expect(registry.waitForCompletion({ jobId: "unknown" })).rejects.toMatchObject({ code: "JOB_UNKNOWN" });
    await expect(registry.waitForCompletion({ jobId: "j1", timeoutMs: 0 })).rejects.toMatchObject({ code: "L2_MALFORMED" });
  });
});
