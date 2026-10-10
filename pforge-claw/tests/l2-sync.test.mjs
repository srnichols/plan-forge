import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { createSecrets } from "../src/secrets.mjs";
import { createStore } from "../src/state/store.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { applicationIdentity, matchesApplicationAck } from "../src/protocol/l2-ack.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { buildLeaseGrant, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";

const directories = [];
const cleanups = [];

async function temporaryDirectory() {
  const directory = await g1Directory("g1-l2-sync-");
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
    const checkout = path.join(directory, "canonical-checkout");
    const worktree = path.join(directory, "worker-checkout");
    await mkdir(checkout);
    await mkdir(worktree);
    const config = {
      lanes: [{ id: "remote", kind: "remote" }],
      projects: [{ id: "p1", homeLane: "remote", repo: { path: checkout } }],
    };
    const receiver = createL2Receiver({ config, currentLaneId: "remote" });
    const store = createStore(path.join(directory, "state"));
    const unlock = store.lock();
    const secrets = await createSecrets({ env: {}, file: path.join(directory, "secrets.json") });
    const enrollment = createEnrollment({ store, secretFile: path.join(directory, "secrets.json"), secrets });
    await enrollment.register({ workerId: "worker-l2", laneId: "remote", secret });
    const registry = createWorkerRegistry({
      requireL2: true, applyL2: receiver.receive,
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key: secret }),
    });
    const server = createWorkerServer({
      registry, enrollment, secrets, allowedLanes: ["remote"], heartbeatMs: 50,
    });
    const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
    server.attach(http);
    const { port } = await http.listen();
    const localLane = createLocalLane({ runtime: { run: async () => {
      await writeForgeFile(path.join(worktree, ".forge"), "openbrain-queue.jsonl", '{"id":"ordered-history"}\n');
      return { status: "succeeded" };
    } } });
    const agent = createWorkerAgent({
      url: `ws://127.0.0.1:${port}/claw/workers`,
      workerId: "worker-l2",
      secret,
      laneId: "remote",
      capabilities: { os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["p1"] },
      localLane,
      readHandler: receiver.read,
      verifyLease: (leased) => verifyGrant({
        grant: leased.leaseGrant, job: leased, subject: "worker-l2", laneId: "remote", key: secret,
      }),
      heartbeatMs: 50,
      l2: {
        forgeDirFor: () => path.join(worktree, ".forge"),
      },
    });
    const lane = createRemoteLane({ id: "remote", registry });
    agent.start();
    cleanups.push(async () => {
      agent.stop();
      server.close();
      registry.close();
      await http.close();
      unlock();
    });
    await expect.poll(() => registry.snapshot().byLane.remote?.connected ?? 0).toBe(1);
    const jobEvents = [];
    const job = { id: "job-l2", projectId: "p1", type: "task", mutating: true, runtime: "copilot-sdk" };
    const leaseGrant = buildLeaseGrant({
      leaseJob: job, laneId: "remote", proof: { kind: "consumed", ref: "fixture-proof", decidedAt: 0 },
    });
    for await (const event of lane.submit({ ...job, leaseGrant })) jobEvents.push(event);
    expect(jobEvents.map((event) => event.type)).toEqual(["started", "artifact", "finished"]);
    expect(jobEvents.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(jobEvents.at(-1).data.status).toBe("succeeded");
    expect(registry.completion(job.id).ok).toBe(true);
    expect(await readFile(path.join(checkout, ".forge", "openbrain-queue.jsonl"), "utf8")).toBe('{"id":"ordered-history"}\n');
    expect(jobEvents.at(-1).seq).toBeGreaterThan(jobEvents.at(-2).seq);
    const [chunk] = encodeDeltaChunks({ deltaId: "empty-read", delta: { files: [], jsonl: {}, maps: {} } });
    const identity = applicationIdentity({ jobId: job.id, projectId: "p1", deltaId: chunk.deltaId, sha256Total: chunk.sha256Total });
    const ack = await lane.read({
      projectId: "p1",
      tool: "l2.apply",
      args: { ...identity, forgeHome: path.join(checkout, ".forge"), delta: { files: [], jsonl: {}, maps: {} } },
    });
    expect(matchesApplicationAck(identity, ack)).toBe(true);
    expect(ack.ok).toBe(true);
  });

  it("ships queued OpenBrain lines after a failed drain and reports an unacknowledged drain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const repoDir = await temporaryDirectory();
    const sourceHome = path.join(repoDir, ".forge");
    const canonicalHome = await temporaryDirectory();
    const projectId = "pod-project";
    const canonicalCheckout = path.dirname(canonicalHome);
    const receiver = createL2Receiver({
      config: {
        lanes: [{ id: "canonical", kind: "local" }],
        projects: [{ id: projectId, homeLane: "canonical", repo: { path: canonicalCheckout, forgeHome: canonicalHome } }],
      },
      currentLaneId: "canonical",
    });
    const snapshot = await snapshotForge({ forgeDir: sourceHome });
    await writeForgeFile(sourceHome, "openbrain-queue.jsonl", '{"id":"queue-1","text":"pending"}\n');
    const delta = await computeDelta({ forgeDir: sourceHome, snapshot });
    const runner = vi.fn(async () => ({ code: 1, stdout: "", stderr: "secret-fixture" }));
    const stopMcp = vi.fn();
    const result = await finalizePodJob({
      repoDir,
      jobId: "pod-job", projectId,
      runner,
      env: { PFORGE_BRIDGE_SECRET: "secret-fixture", runtimes: { pforgeCommand: ["pforge"] } },
      startMcp: async () => ({ stop: stopMcp }),
      collectDelta: async () => delta,
      awaitAck: ({ transfer }) => receiver.receive(transfer),
      deadlineMs: 1000,
    });
    expect(result).toMatchObject({ status: "ok", applicationAck: { jobId: "pod-job", projectId, ok: true } });
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0][1]).toContain("drain-memory");
    expect(runner.mock.calls[0][2].env.PFORGE_BRIDGE_SECRET).toBe("secret-fixture");
    expect(stopMcp).toHaveBeenCalledOnce();
    expect(await readFile(path.join(canonicalHome, "openbrain-queue.jsonl"), "utf8"))
      .toBe('{"id":"queue-1","text":"pending"}\n');
    expect(JSON.stringify(result)).not.toContain("secret-fixture");

    const failed = await finalizePodJob({
      repoDir,
      jobId: "pod-job", projectId,
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
      async function agentFixture({ invalidHistory = false } = {}) {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const root = await temporaryDirectory();
        const worktree = path.join(root, "source");
        const checkout = path.join(root, "canonical");
        await mkdir(worktree);
        await mkdir(checkout);
        const receiver = createL2Receiver({
          config: { lanes: [{ id: "remote", kind: "remote" }],
            projects: [{ id: "p1", homeLane: "remote", repo: { path: checkout } }] },
          currentLaneId: "remote",
        });
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
          localLane: createLocalLane({ runtime: { run: async () => {
            await writeForgeFile(path.join(worktree, ".forge"), invalidHistory ? "cost-history.json" : "openbrain-queue.jsonl",
              invalidHistory ? "invalid JSON" : '{"id":"terminal-history"}\n');
            return { status: "succeeded" };
          } } }),
          l2: { forgeDirFor: () => path.join(worktree, ".forge") },
          afterJob: ({ event, applicationAck }) => {
            expect(event.type).toBe("finished");
            if (!invalidHistory) expect(applicationAck.ok).toBe(true);
            hooks.push("after");
          },
          onLeaseAcked: acked,
        });
        agent.start();
        cleanups.push(() => agent.stop());
        socket.emit("open");
        const receive = (packet) => socket.emit("message", Buffer.from(encode(packet)), false);
        receive(message("lease", { leaseId: "l1", attempt: 1, kind: "job", expiresAt: 60_000,
          job: { id: "j1", projectId: "p1", type: "task" } }));
        return { receive, sent, hooks, acked, receiver, checkout };
      }
      it("afterJob runs only after real application ACK and terminal receipt fires exactly once", async () => {
        const fixture = await agentFixture();
        await vi.waitFor(() => expect(fixture.sent.some((packet) => packet.event?.type === "artifact")).toBe(true));
        expect(fixture.hooks).toEqual([]);
        const chunks = fixture.sent.filter((packet) => packet.event?.type === "artifact").map((packet) => packet.event.data);
        const ack = await fixture.receiver.receive({
          jobId: "j1", projectId: "p1", deltaId: chunks[0].deltaId, sha256Total: chunks[0].sha256Total, chunks,
        });
        expect(ack.ok).toBe(true);
        expect(await readFile(path.join(fixture.checkout, ".forge", "openbrain-queue.jsonl"), "utf8")).toContain("terminal-history");
        fixture.receive(message("l2-applied", { leaseId: "l1", attempt: 1, ...ack }));
        await vi.waitFor(() => expect(fixture.hooks).toEqual(["after"]));
        const events = fixture.sent.filter((packet) => packet.t === "event").map((packet) => packet.event);
        expect(events.map((event) => event.type)).toEqual(["started", "artifact", "finished"]);
        const receipt = message("heartbeat", { ts: 1, leases: [{ leaseId: "l1", attempt: 1, lastSeq: 3 }] });
        fixture.receive(message("heartbeat", { ts: 1, leases: [{ leaseId: "l1", attempt: 2, lastSeq: 3 }] }));
        expect(fixture.acked).not.toHaveBeenCalled();
        fixture.receive(receipt);
        fixture.receive(receipt);
        await vi.advanceTimersByTimeAsync(1);
        expect(fixture.hooks).toEqual(["after", "acked"]);
        expect(fixture.acked).toHaveBeenCalledOnce();
      });
      it("reports collection failure as l2-sync-incomplete, never a success advisory", async () => {
        const fixture = await agentFixture({ invalidHistory: true });
        await vi.waitFor(() => expect(fixture.sent.some((packet) => packet.event?.type === "finished")).toBe(true));
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
