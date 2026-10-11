import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { buildLeaseGrant, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { encode, message } from "../src/protocol/messages.mjs";
import { encodeDeltaChunks } from "../src/memory/l2-sync.mjs";

const key = "worker-recovery-fixture-key";
const capabilities = { os: "linux", arch: "x64", macos: false, toolchains: [], projects: ["p1"] };
const cleanups = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});

function event(jobId, seq, type = "progress", data = {}) {
  return { v: 1, jobId, seq, ts: new Date(0).toISOString(), type, data };
}

function workerPipe({ registry, workerId, runtime, verifyLease, readHandler, jobScope }) {
  let socket;
  const outbound = [];
  class Socket extends EventEmitter {
    OPEN = 1;
    readyState = 1;
    constructor() { super(); socket = this; }
    send(raw) {
      const packet = JSON.parse(raw);
      outbound.push(packet);
      if (packet.t === "ack") registry.onAck({ ...packet, workerId });
      if (packet.t === "event") registry.onEvent({ ...packet, workerId });
      if (packet.t === "heartbeat") {
        const leases = registry.onHeartbeat({ ...packet, workerId });
        this.emit("message", Buffer.from(encode(message("heartbeat", { ts: 0, leases }))), false);
      }
    }
    close() { this.readyState = 3; }
  }
  const agent = createWorkerAgent({
    url: "ws://127.0.0.1/claw/workers", workerId, laneId: "remote", secret: key,
    capabilities, localLane: createLocalLane({ id: "remote", runtime }),
    WebSocketImpl: Socket, verifyLease, readHandler, jobScope, logger: { warn() {}, error() {} }, rand: () => 0,
  });
  agent.start();
  socket.emit("open");
  const connect = () => registry.connect(workerId, {
    laneId: "remote", capabilities,
    send: (packet) => socket.emit("message", Buffer.from(encode(packet)), false),
  });
  connect();
  cleanups.push(async () => { agent.stop(); await agent.drain(); });
  return {
    agent, outbound, connect,
    receive: (packet) => socket.emit("message", Buffer.from(encode(packet)), false),
  };
}

describe("worker replacement and continuation", () => {
  it("refuses differently approved choices on an existing one-shot lease rather than replacing frozen execution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    const blocked = Promise.withResolvers();
    let runs = 0;
    const pipe = workerPipe({
      registry, workerId: "job:j1", jobScope: { jobId: "j1" },
      verifyLease: (job) => verifyGrant({
        grant: job.leaseGrant, job, subject: "job:j1", laneId: "remote", key,
      }),
      runtime: { async run() {
        runs += 1;
        await blocked.promise;
        return { status: "succeeded" };
      } },
    });
    cleanups.push(() => blocked.resolve());
    const leaseFor = (job, leaseId, attempt) => message("lease", {
      leaseId, attempt, kind: "job", expiresAt: 60_000, job,
      grant: signGrant({
        grant: {
          ...buildLeaseGrant({ leaseJob: job, laneId: "remote", proof: { kind: "consumed", ref: "approved", decidedAt: 0 } }),
          leaseId, attempt,
        }, subject: "job:j1", key,
      }),
    });
    const job = {
      id: "j1", projectId: "p1", type: "plan", mutating: true, runtime: "openai",
      quorum: "auto", resumeFrom: 1, project: { models: { work: "approved-model" } },
    };
    pipe.receive(leaseFor(job, "l1", 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    pipe.receive(leaseFor({ ...job, quorum: "power", resumeFrom: 2 }, "l2", 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(pipe.outbound.find((packet) => packet.event?.type === "finished")?.event.data)
      .toMatchObject({ status: "failed", error: "LEASE_GRANT_INVALID" });
    blocked.resolve();
    await pipe.agent.drain();
    expect(runs).toBe(1);
  });

  it("passes pending home-read cancellation to the worker handler and refuses its late success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    const completion = Promise.withResolvers();
    const signals = [];
    const pipe = workerPipe({
      registry, workerId: "A", runtime: { run: async () => ({ status: "succeeded" }) },
      readHandler: (_request, { signal } = {}) => {
        signals.push(signal);
        signal?.addEventListener("abort", () => completion.resolve({ ok: true }), { once: true });
        return completion.promise;
      },
    });
    cleanups.push(() => completion.resolve({ ok: true }));
    const { jobId } = registry.enqueue("remote", {
      kind: "read", request: { projectId: "p1", tool: "forge_status", args: {} },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    registry.cancel(jobId);
    expect(signals[0].aborted).toBe(true);
    await pipe.agent.drain();
    expect(pipe.outbound.find((packet) => packet.event?.type === "finished").event.data)
      .toMatchObject({ status: "failed", code: "READ_CANCELLED" });
    expect(registry.snapshot().byLane.remote).toMatchObject({ pending: 0, active: 0 });
  });

  it("does not start runtime when the lease verifier returns an explicit rejection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const received = [];
    const run = vi.fn(async () => ({ status: "succeeded" }));
    const registry = createWorkerRegistry({ onEvent: (item) => received.push(item) });
    cleanups.push(() => registry.close());
    const pipe = workerPipe({
      registry, workerId: "A", verifyLease: () => false, runtime: { run },
    });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1", type: "task" } });
    await pipe.agent.drain();
    expect(run).not.toHaveBeenCalled();
    expect(received.at(-1).data).toMatchObject({ status: "failed", error: "LEASE_GRANT_INVALID" });
  });
  it("keeps progress, PR and L2 events monotonic after replacement following substantial progress", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const received = [];
    const registry = createWorkerRegistry({ onEvent: (item) => received.push(item) });
    cleanups.push(() => registry.close());
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    workerPipe({
      registry, workerId: "A",
      runtime: { async run({ emit }) {
        for (let index = 0; index < 40; index += 1) emit("progress", { index });
        await blocked;
        return { status: "succeeded" };
      } },
    });
    cleanups.push(() => release());
    workerPipe({
      registry, workerId: "B",
      runtime: { async run({ emit }) {
        emit("progress", { replacement: true });
        emit("artifact", { kind: "pr", url: "https://fixture.test/replacement" });
        emit("artifact", encodeDeltaChunks({
          delta: { files: [], jsonl: {}, maps: {} }, deltaId: "j1",
        })[0]);
        return { status: "succeeded" };
      } },
    });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1", type: "task" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(received).toHaveLength(41);
    registry.disconnect("A");
    await vi.advanceTimersByTimeAsync(0);
    expect(received.some((item) => item.data.replacement)).toBe(true);
    expect(received.some((item) => item.data.kind === "pr")).toBe(true);
    expect(received.some((item) => item.data.kind === "l2-delta")).toBe(true);
    expect(received.map((item) => item.seq)).toEqual(Array.from({ length: 46 }, (_, index) => index + 1));
    expect(received.at(-1)).toMatchObject({ type: "finished", seq: 46 });
  });

  it("renews grant authorization at reissue after the original TTL without changing approved content", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const sentA = [];
    const sentB = [];
    const job = { id: "j1", projectId: "p1", type: "skill", mutating: false, prompt: "approved" };
    const leaseGrant = buildLeaseGrant({
      leaseJob: job, laneId: "remote", proof: { kind: "read-only", ref: null, decidedAt: null },
    });
    const registry = createWorkerRegistry({
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    cleanups.push(() => registry.close());
    registry.connect("A", { laneId: "remote", capabilities, send: (packet) => sentA.push(packet) });
    registry.connect("B", { laneId: "remote", capabilities, send: (packet) => sentB.push(packet) });
    registry.enqueue("remote", { kind: "job", job: { ...job, leaseGrant } });
    vi.setSystemTime(310_000);
    registry.disconnect("A");
    const replacement = sentB.find((packet) => packet.t === "lease");
    expect(replacement.job).toEqual(job);
    expect(replacement.grant.jobDigest).toBe(leaseGrant.jobDigest);
    expect(replacement.grant.approval).toEqual(leaseGrant.approval);
    expect(verifyGrant({
      grant: replacement.grant, job: replacement.job, subject: "B", laneId: "remote", key,
    })).toBe(true);
    expect(replacement.grant.issuedAt).toBe(310_000);
    expect(replacement.grant.exp).toBeGreaterThan(310_000);
    expect(sentA[0].grant.issuedAt).toBe(0);
  });

  it("continues an existing worker without restarting its runtime after reconnect past the grant TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const registry = createWorkerRegistry({
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    cleanups.push(() => registry.close());
    const received = [];
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let runs = 0;
    const pipe = workerPipe({
      registry, workerId: "A",
      verifyLease: (job) => verifyGrant({
        grant: job.leaseGrant, job, subject: "A", laneId: "remote", key,
      }),
      runtime: { async run({ emit }) {
        runs += 1;
        emit("progress", { before: true });
        await blocked;
        emit("progress", { after: true });
        return { status: "succeeded" };
      } },
    });
    cleanups.push(() => release());
    const job = { id: "j1", projectId: "p1", type: "skill", skill: "check", mutating: false };
    const { iterator } = registry.enqueue("remote", {
      kind: "job", job: { ...job, leaseGrant: buildLeaseGrant({
        leaseJob: job, laneId: "remote", proof: { kind: "read-only", ref: null, decidedAt: null },
      }) },
    });
    const consuming = (async () => { for await (const item of iterator) received.push(item); })();
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(310_000);
    registry.disconnect("A");
    pipe.connect();
    release();
    await vi.advanceTimersByTimeAsync(0);
    await consuming;
    expect(runs).toBe(1);
    expect(received.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    expect(received.at(-1).data.status).toBe("succeeded");
  });

  it("rejects lower-sequence terminal events as duplicates, including from a current attempt", () => {
    const sent = [];
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    registry.connect("A", { laneId: "remote", capabilities, send: (packet) => sent.push(packet) });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1" } });
    const lease = sent[0];
    const receive = (workerId, attempt, item) => registry.onEvent({
      leaseId: lease.leaseId, workerId, attempt, event: item,
    });
    expect(receive("A", 1, event("j1", 1))).toBe(true);
    expect(receive("A", 1, event("j1", 2))).toBe(true);
    expect(receive("A", 1, event("j1", 1, "finished", { status: "succeeded" }))).toBe(false);
    expect(receive("B", 1, event("j1", 3, "finished"))).toBe(false);
    expect(receive("A", 2, event("j1", 3, "finished"))).toBe(false);
    expect(receive("A", 1, event("other-job", 3, "finished"))).toBe(false);
    expect(receive("A", 1, event("j1", 3, "finished", { status: "succeeded" }))).toBe(true);
  });

  it("fences a success event after cancellation even if the worker reports it on the current lease", () => {
    const sent = [];
    const received = [];
    const registry = createWorkerRegistry({ onEvent: (item) => received.push(item) });
    cleanups.push(() => registry.close());
    registry.connect("A", { laneId: "remote", capabilities, send: (packet) => sent.push(packet) });
    registry.enqueue("remote", { kind: "job", job: { id: "j1", projectId: "p1" } });
    const lease = sent[0];
    registry.cancel("j1");
    registry.onEvent({
      leaseId: lease.leaseId, attempt: lease.attempt, workerId: "A",
      event: event("j1", 1, "finished", { status: "succeeded" }),
    });
    expect(received.at(-1).data.status).toBe("cancelled");
    expect(registry.completion("j1").ok).toBe(false);
  });
});
