import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  L2_COPY_DIRS,
  L2_DENY,
  L2_JSONL_STREAMS,
  L2_JSON_MAPS,
  L2_SYNC_INCOMPLETE,
  applyDelta,
  assembleDeltaChunks,
  computeDelta,
  doctorCheckIncompleteSync,
  encodeDeltaChunks,
  forwardDelta,
  recordIdentity,
  resolveForgeHome,
  snapshotForge,
  verifyHallmark,
} from "../src/memory/l2-sync.mjs";
import {
  buildJobSpec, createK8sJobLane, finalizePodJob, startPodMcp, awaitSyncAck,
} from "../src/lanes/k8s-job-lane.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createHttpServer } from "../src/http.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { encode, message } from "../src/protocol/messages.mjs";

const directories = [];
const cleanups = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-l2-sync-"));
  directories.push(directory);
  return directory;
}

async function writeForgeFile(forgeHome, relative, contents) {
  const target = path.join(forgeHome, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

function fileDelta(rel, contents) {
  const bytes = Buffer.from(contents);
  return {
    rel,
    dataB64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("L2 synchronization contracts", () => {
  it("pins frozen allow-lists and fallback forge home resolution", () => {
    expect(Object.isFrozen(L2_COPY_DIRS)).toBe(true);
    expect(Object.isFrozen(L2_JSONL_STREAMS)).toBe(true);
    expect(Object.isFrozen(L2_JSON_MAPS)).toBe(true);
    expect(Object.isFrozen(L2_DENY)).toBe(true);
    expect(L2_COPY_DIRS).toEqual(["runs", "trajectories", "hallmarks", "bugs", "skills-auto"]);
    expect(L2_JSONL_STREAMS).toEqual([
      "openbrain-queue.jsonl", "openbrain-dlq.jsonl", "openbrain-queue.archive.jsonl",
      "liveguard-memories.jsonl", "quorum-history.jsonl", "watch-history.jsonl",
      "drift-history.jsonl", "incidents.jsonl", "regression-history.jsonl",
      "team-activity.jsonl", "hub-events.jsonl",
    ]);
    expect(L2_JSON_MAPS).toEqual(["cost-history.json", "model-performance.json", "skills-auto/state.json"]);
    expect(L2_DENY).toEqual([
      "secrets.json", "bridge-secret", "fm-prefs.json", "server-ports.json", "cache", "worktrees",
    ]);
    expect(resolveForgeHome({
      project: { id: "p1", homeLane: "local", repo: { path: "/repo" } },
      config: { lanes: [{ id: "local" }] },
    })).toEqual({ laneId: "local", path: path.join("/repo", ".forge") });
    expect(resolveForgeHome({
      project: { homeLane: "local", repo: { path: "/repo", forgeHome: "mac-1:/canonical/.forge" } },
      config: { lanes: [{ id: "local" }, { id: "mac-1" }] },
    })).toEqual({ laneId: "mac-1", path: "/canonical/.forge" });
    expect(recordIdentity("not-json \n")).toBe(recordIdentity("not-json"));
  });

  it("applies the same delta idempotently across files, JSONL, and maps", async () => {
    const forgeHome = await temporaryDirectory();
    const delta = {
      files: [fileDelta("runs/job-1/run.json", "run-bytes")],
      jsonl: { "openbrain-queue.jsonl": ['{"id":"queue-1","text":"queued"}\r\n'] },
      maps: {
        "cost-history.json": { "2026-10-07|plan-a": { date: "2026-10-07", plan: "plan-a", cost: 2 } },
        "model-performance.json": { modelA: { score: 3 } },
      },
    };
    const first = await applyDelta({ forgeHome, delta });
    const second = await applyDelta({ forgeHome, delta });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(await readFile(path.join(forgeHome, "runs", "job-1", "run.json"), "utf8")).toBe("run-bytes");
    expect(await readFile(path.join(forgeHome, "openbrain-queue.jsonl"), "utf8"))
      .toBe('{"id":"queue-1","text":"queued"}\r\n');
    expect(JSON.parse(await readFile(path.join(forgeHome, "cost-history.json"), "utf8"))).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(forgeHome, "model-performance.json"), "utf8")))
      .toEqual({ modelA: { score: 3 } });
    expect(second.applied).toEqual({ files: 0, lines: 0, keys: 0 });
  });

  it("never-overwrites canonical files or differing cost and bug records", async () => {
    const forgeHome = await temporaryDirectory();
    await writeForgeFile(forgeHome, "runs/job-1/run.json", "canonical");
    await writeForgeFile(forgeHome, "cost-history.json", JSON.stringify([
      { date: "2026-10-07", plan: "plan-a", cost: 1 },
    ]));
    await writeForgeFile(forgeHome, "bugs/bug1.json", JSON.stringify({ title: "canonical" }));
    const result = await applyDelta({
      forgeHome,
      delta: {
        jsonl: {},
        maps: {
          "cost-history.json": { "2026-10-07|plan-a": { date: "2026-10-07", plan: "plan-a", cost: 9 } },
        },
        files: [
          fileDelta("runs/job-1/run.json", "remote"),
          fileDelta("bugs/bug1.json", '{"title":"remote"}'),
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(3);
    expect(result.conflicts.map((conflict) => conflict.code)).toEqual(["L2_CONFLICT", "L2_CONFLICT", "L2_CONFLICT"]);
    expect(await readFile(path.join(forgeHome, "runs", "job-1", "run.json"), "utf8")).toBe("canonical");
    expect(JSON.parse(await readFile(path.join(forgeHome, "cost-history.json"), "utf8"))[0].cost).toBe(1);
    expect(JSON.parse(await readFile(path.join(forgeHome, "bugs", "bug1.json"), "utf8")).title).toBe("canonical");
  });

  it("copies hallmark sources byte-for-byte and verifies source hashes without drift", async () => {
    const sourceHome = await temporaryDirectory();
    const canonicalHome = await temporaryDirectory();
    const source = Buffer.from("original\r\nrun bytes\n");
    const sourceHash = createHash("sha256").update(source).digest("hex");
    await writeForgeFile(sourceHome, "runs/job-7/result.bin", source);
    await writeForgeFile(sourceHome, "hallmarks/job-7.json", JSON.stringify({
      id: "job-7", source: "runs/job-7/result.bin", sourceHash,
    }));
    const delta = await computeDelta({
      forgeDir: sourceHome,
      snapshot: { files: {}, lines: {} },
    });
    await applyDelta({ forgeHome: canonicalHome, delta });
    expect(await readFile(path.join(canonicalHome, "runs", "job-7", "result.bin"))).toEqual(source);
    expect(await verifyHallmark({ forgeHome: canonicalHome, id: "job-7" })).toEqual({ ok: true, drift: false });
  });

  it("rejects tampered, wrong-total, missing, and duplicate chunks by checksum", () => {
    const chunks = encodeDeltaChunks({
      delta: { files: [], jsonl: {}, maps: {} }, deltaId: "delta-1", chunkBytes: 5,
    });
    const tampered = chunks.map((chunk) => ({ ...chunk }));
    tampered[0].data = Buffer.from("tampered").toString("base64");
    expect(() => assembleDeltaChunks({ chunks: tampered })).toThrowError(
      expect.objectContaining({ code: "L2_CHECKSUM_MISMATCH" }),
    );
    expect(() => assembleDeltaChunks({
      chunks: chunks.map((chunk, index) => index ? chunk : { ...chunk, sha256Total: "0".repeat(64) }),
    })).toThrowError(expect.objectContaining({ code: "L2_CHECKSUM_MISMATCH" }));
    expect(() => assembleDeltaChunks({ chunks: chunks.slice(1) }))
      .toThrowError(expect.objectContaining({ code: "L2_CHUNK_MISSING" }));
    expect(() => assembleDeltaChunks({ chunks: [...chunks, chunks[0]] }))
      .toThrowError(expect.objectContaining({ code: "L2_CHUNK_DUP" }));
  });

  it("does not write any file when path preflight rejects a delta", async () => {
    const forgeHome = await temporaryDirectory();
    await expect(applyDelta({
      forgeHome,
      delta: {
        files: [
          fileDelta("runs/job-1/run.json", "must-not-write"),
          fileDelta("../outside.json", "rejected"),
        ],
        jsonl: {},
        maps: {},
      },
    })).rejects.toMatchObject({ code: "L2_PATH_REJECTED" });
    await expect(readFile(path.join(forgeHome, "runs", "job-1", "run.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses traversal, absolute, secrets, and bridge-secret paths before applying", async () => {
    const forgeHome = await temporaryDirectory();
    for (const rel of ["../escape", path.resolve(forgeHome, "outside"), "secrets.json", "bridge-secret"]) {
      await expect(applyDelta({
        forgeHome,
        delta: { files: [fileDelta(rel, "blocked")], jsonl: {}, maps: {} },
      })).rejects.toMatchObject({ code: "L2_PATH_REJECTED" });
    }
    expect(await readFile(forgeHome, "utf8").catch(() => "")).toBe("");
  });

  it("forwards to the canonical home lane and identifies incomplete sync records", async () => {
    const delta = { files: [], jsonl: {}, maps: {} };
    const applyLocal = vi.fn();
    const sendToLane = vi.fn(async () => ({ ok: true }));
    await forwardDelta({
      project: { homeLane: "local", repo: { path: "/repo", forgeHome: "mac-1:/canonical/.forge" } },
      config: { lanes: [{ id: "local" }, { id: "mac-1" }] },
      delta,
      currentLaneId: "local",
      applyLocal,
      sendToLane,
    });
    expect(applyLocal).not.toHaveBeenCalled();
    expect(sendToLane).toHaveBeenCalledWith("mac-1", {
      tool: "l2.apply", args: { forgeHome: "/canonical/.forge", delta },
    });
    expect(doctorCheckIncompleteSync({ records: [
      { jobId: "job-1", laneId: "k8s", reason: L2_SYNC_INCOMPLETE },
      { jobId: "job-2", laneId: "local", reason: "deadline" },
    ] })).toEqual({ ok: false, failing: [{ jobId: "job-1", laneId: "k8s" }] });
  });

  it("orders worker artifacts before finished", async () => {
    const directory = await temporaryDirectory();
    const secret = "l2-worker-secret";
    const store = {
      records: [],
      append(_stream, record) { this.records.push(record); return record; },
      fold(_stream, reducer, initial) { return this.records.reduce(reducer, initial); },
    };
    const enrollment = createEnrollment({ store, secretFile: path.join(directory, "secrets.json") });
    await enrollment.register({ workerId: "worker-l2", laneId: "remote", secret });
    const registry = createWorkerRegistry();
    const server = createWorkerServer({
      registry, enrollment, secrets: { get: () => secret }, allowedLanes: ["remote"], heartbeatMs: 50,
    });
    const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
    server.attach(http);
    const { port } = await http.listen();
    const localLane = {
      async *submit(job) {
        yield { v: 1, jobId: job.id, seq: 1, ts: new Date(0).toISOString(), type: "started", data: {} };
        yield { v: 1, jobId: job.id, seq: 2, ts: new Date(0).toISOString(), type: "finished", data: { status: "succeeded" } };
      },
      async cancel() { return { ok: true }; },
    };
    const apply = vi.fn(async (args) => ({ ok: true, path: args.forgeHome }));
    const agent = createWorkerAgent({
      url: `ws://127.0.0.1:${port}/claw/workers`,
      workerId: "worker-l2",
      secret,
      laneId: "remote",
      capabilities: { os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["p1"] },
      localLane,
      readHandler: async () => ({ ok: true }),
      heartbeatMs: 50,
      l2: {
        forgeDirFor: () => "/worker/.forge",
        forgeHome: "/canonical/.forge",
        snapshot: vi.fn(async () => ({ files: {}, lines: {} })),
        collect: vi.fn(async () => ({ files: [], jsonl: {}, maps: {} })),
        encode: vi.fn(() => [
          { kind: "l2-delta", deltaId: "job-l2", index: 0, total: 2, sha256Chunk: "a", sha256Total: "t", data: "one" },
          { kind: "l2-delta", deltaId: "job-l2", index: 1, total: 2, sha256Chunk: "b", sha256Total: "t", data: "two" },
        ]),
        apply,
      },
    });
    const lane = createRemoteLane({ id: "remote", registry });
    agent.start();
    cleanups.push(async () => {
      agent.stop();
      server.close();
      registry.close();
      await http.close();
    });
    await expect.poll(() => registry.snapshot().byLane.remote?.connected ?? 0).toBe(1);
    const jobEvents = [];
    for await (const event of lane.submit({ id: "job-l2", projectId: "p1" })) jobEvents.push(event);
    expect(jobEvents.map((event) => event.type)).toEqual(["started", "artifact", "artifact", "finished"]);
    expect(jobEvents.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(jobEvents.at(-1).seq).toBeGreaterThan(jobEvents.at(-2).seq);
    await expect(lane.read({
      projectId: "p1",
      tool: "l2.apply",
      args: { forgeHome: "/canonical/.forge", delta: { files: [], jsonl: {}, maps: {} } },
    })).resolves.toEqual({ ok: true, path: "/canonical/.forge" });
    expect(apply).toHaveBeenCalledOnce();
  });

  it("ships queued OpenBrain lines after a failed drain and reports an unacknowledged drain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const repoDir = await temporaryDirectory();
    const sourceHome = path.join(repoDir, ".forge");
    const canonicalHome = await temporaryDirectory();
    const snapshot = await snapshotForge({ forgeDir: sourceHome });
    await writeForgeFile(sourceHome, "openbrain-queue.jsonl", '{"id":"queue-1","text":"pending"}\n');
    const delta = await computeDelta({ forgeDir: sourceHome, snapshot });
    const runner = vi.fn(async () => ({ code: 1, stdout: "", stderr: "secret-fixture" }));
    const stopMcp = vi.fn();
    const result = await finalizePodJob({
      repoDir,
      runner,
      env: { PFORGE_BRIDGE_SECRET: "secret-fixture", runtimes: { pforgeCommand: ["pforge"] } },
      startMcp: async () => ({ stop: stopMcp }),
      collectDelta: async () => delta,
      awaitAck: async ({ delta: sent }) => applyDelta({ forgeHome: canonicalHome, delta: sent }),
      deadlineMs: 1000,
    });
    expect(result).toEqual({ status: "ok" });
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][1]).toContain("drain-memory");
    expect(runner.mock.calls[0][2].env.PFORGE_BRIDGE_SECRET).toBe("secret-fixture");
    expect(stopMcp).toHaveBeenCalledOnce();
    expect(await readFile(path.join(canonicalHome, "openbrain-queue.jsonl"), "utf8"))
      .toBe('{"id":"queue-1","text":"pending"}\n');
    expect(JSON.stringify(result)).not.toContain("secret-fixture");

    const failed = await finalizePodJob({
      repoDir,
      runner: async () => ({ code: 1 }),
      startMcp: async () => ({ stop: stopMcp }),
      collectDelta: async () => delta,
      awaitAck: async () => false,
      deadlineMs: 1000,
    });
    expect(failed).toEqual({ status: "failed", reason: L2_SYNC_INCOMPLETE });
    expect(stopMcp).toHaveBeenCalledTimes(2);
  });

  it("polls sync acknowledgements until a fake deadline expires", async () => {
    let clock = 0;
    const sleep = vi.fn(async (ms) => { clock += ms; });
    await expect(awaitSyncAck({
      getAckedSeq: async () => 2,
      targetSeq: 3,
      deadlineMs: 30,
      now: () => clock,
      sleep,
    })).resolves.toBe(false);
    expect(clock).toBe(30);
  });

  it("starts the pod MCP server on port 3100 and exposes a stop handle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      child.emit("exit", 0, null);
    });
    const spawnFn = vi.fn(() => child);
    const server = await startPodMcp({ repoDir: "/pod/repo", spawnFn, now: () => 0, sleep: async () => {} });
    expect(spawnFn).toHaveBeenCalledWith(process.execPath, [
      path.join("/pod/repo", "pforge-mcp", "server.mjs"), "--port", "3100",
    ], expect.objectContaining({ cwd: "/pod/repo" }));
    await server.stop();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("classifies a K8s deadline during an L2 artifact transfer as incomplete sync", async () => {
    const registry = {
      registerPending: () => {}, revoke: () => {},
      enqueue: () => ({
        iterator: {
          [Symbol.asyncIterator]() {
            let first = true;
            let resolvePending;
            return {
              next: () => {
                if (first) {
                  first = false;
                  return Promise.resolve({
                    value: {
                      v: 1, jobId: "job-transfer", seq: 1, ts: new Date(0).toISOString(),
                      type: "artifact", data: { kind: "l2-delta" },
                    },
                    done: false,
                  });
                }
                return new Promise((resolve) => { resolvePending = resolve; });
              },
              return: async () => {
                resolvePending?.({ done: true });
                return { done: true };
              },
            };
          },
        },
      }),
      cancel: async () => ({ ok: true }),
      snapshot: () => ({ byLane: {} }),
    };
    const lane = createK8sJobLane({
      id: "jobs",
      jobKeyFor: () => "b".repeat(64), canDeriveJobKeys: () => true,
      config: {
        lanes: [{ id: "jobs", kind: "k8s", k8s: { namespace: "claw" } }],
        projects: [{
          id: "project-one", image: "example/worker:latest",
          repo: { remote: "https://example.test/repo.git", baseBranch: "main" },
        }],
        worker: { dispatcherUrl: "wss://dispatcher.example/claw/workers" },
      },
      registry,
      api: {
        createJob: async () => ({}),
        deleteJob: async () => ({}),
        getJob: async () => ({}),
        watchJob: async function* watch() {
          yield { object: { status: { conditions: [
            { type: "Failed", status: "True", reason: "DeadlineExceeded" },
          ] } } };
        },
      },
    });

    const events = [];
    for await (const event of lane.submit({ id: "job-transfer", projectId: "project-one" })) events.push(event);
    expect(events.at(-1).data).toEqual({ status: "failed", reason: L2_SYNC_INCOMPLETE });
    expect(lane.health()).toMatchObject({
      incompleteSyncs: 1,
      lastError: { code: L2_SYNC_INCOMPLETE, reason: L2_SYNC_INCOMPLETE },
    });
  });

    describe("worker L2 terminal hooks", () => {
      function agentFixture({ collect = async () => ({ files: [], jsonl: {}, maps: {} }) } = {}) {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        let socket;
        const sent = [];
        const hooks = [];
        class FakeSocket extends EventEmitter {
          OPEN = 1;
          readyState = 1;
          constructor() { super(); socket = this; }
          send(raw) { sent.push(JSON.parse(raw)); }
          close() { this.readyState = 3; }
        }
        const acked = vi.fn(() => hooks.push("acked"));
        const agent = createWorkerAgent({
          url: "ws://127.0.0.1/claw/workers", workerId: "w1", secret: "fixture",
          laneId: "remote", capabilities: { os: "linux", arch: "x64", macos: false, toolchains: [], projects: ["p1"] },
          WebSocketImpl: FakeSocket,
          localLane: {
            async *submit(job) {
              yield { v: 1, jobId: job.id, seq: 1, ts: new Date(0).toISOString(), type: "finished", data: { status: "succeeded" } };
            },
            cancel: async () => ({ ok: true }),
          },
          l2: { forgeDirFor: () => "/fixture", snapshot: async () => null, collect },
          afterJob: () => {
            expect(sent.at(-2).event.type).toBe("finished");
            hooks.push("after");
          },
          onLeaseAcked: acked,
        });
        agent.start();
        cleanups.push(() => agent.stop());
        socket.emit("open");
        const receive = (packet) => socket.emit("message", Buffer.from(encode(packet)), false);
        receive(message("lease", { leaseId: "l1", attempt: 1, kind: "job", expiresAt: 60_000, job: { id: "j1", projectId: "p1" } }));
        return { receive, sent, hooks, acked };
      }
      it("afterJob runs after the delta and finished are emitted and onLeaseAcked fires exactly once", async () => {
        const fixture = agentFixture();
        await vi.advanceTimersByTimeAsync(1);
        const events = fixture.sent.filter((packet) => packet.t === "event").map((packet) => packet.event);
        expect(events.map((event) => event.type)).toEqual(["artifact", "finished"]);
        expect(fixture.hooks).toEqual(["after"]);
        const ack = message("heartbeat", { ts: 1, leases: [{ leaseId: "l1", attempt: 1, lastSeq: 2 }] });
        fixture.receive(message("heartbeat", { ts: 1, leases: [{ leaseId: "l1", attempt: 2, lastSeq: 2 }] }));
        expect(fixture.acked).not.toHaveBeenCalled();
        fixture.receive(ack);
        fixture.receive(ack);
        await vi.advanceTimersByTimeAsync(1);
        expect(fixture.hooks).toEqual(["after", "acked"]);
        expect(fixture.acked).toHaveBeenCalledOnce();
      });
      it("reports collection failure as l2-sync-incomplete, never a success advisory", async () => {
        const fixture = agentFixture({ collect: async () => { throw new Error("fixture collection failure"); } });
        await vi.advanceTimersByTimeAsync(1);
        const terminal = fixture.sent.find((packet) => packet.event?.type === "finished");
        expect(terminal.event.data).toMatchObject({ status: "failed", reason: "l2-sync-incomplete" });
      });
    });
  it("adds the bridge secret only when configured for a pod", () => {
    const fixture = {
      jobKey: "b".repeat(64),
      job: { id: "job-bridge", projectId: "project-one" },
      project: { id: "project-one", image: "example/worker:latest" },
      lane: {
        id: "jobs", kind: "k8s",
        k8s: { secrets: { bridge: { name: "bridge-auth", key: "shared-secret" } } },
      },
      dispatcherUrl: "https://dispatcher.example",
    };
    const env = buildJobSpec(fixture).spec.template.spec.containers[0].env;
    expect(env.find((entry) => entry.name === "PFORGE_BRIDGE_SECRET")).toEqual({
      name: "PFORGE_BRIDGE_SECRET",
      valueFrom: { secretKeyRef: { name: "bridge-auth", key: "shared-secret" } },
    });
    const absent = buildJobSpec({
      ...fixture,
      lane: { ...fixture.lane, k8s: { secrets: {} } },
    }).spec.template.spec.containers[0].env;
    expect(absent.some((entry) => entry.name === "PFORGE_BRIDGE_SECRET")).toBe(false);
  });

  it("keeps protocol source free of shell execution and secret-bearing output", async () => {
    const { readFile: readText } = await import("node:fs/promises");
    const sourceFiles = [
      new URL("../src/memory/l2-sync.mjs", import.meta.url),
      new URL("../src/protocol/worker-agent.mjs", import.meta.url),
      new URL("../src/lanes/k8s-job-lane.mjs", import.meta.url),
    ];
    for (const file of sourceFiles) {
      const source = await readText(file, "utf8");
      expect(source).not.toMatch(/shell\s*:\s*true/);
      expect(source).not.toMatch(/\bexec\s*\(/);
    }
  });
});
