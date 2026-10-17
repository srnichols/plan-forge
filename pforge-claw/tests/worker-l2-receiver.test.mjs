import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as protocol from "../src/protocol/worker-agent.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { snapshotForge, computeDelta, encodeDeltaChunks } from "../src/memory/l2-sync.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.useRealTimers();
});

async function fixture(homeLane = "local") {
  const root = await mkdtemp(path.join(TEST_DIRECTORY, ".l2-receiver-"));
  directories.push(root);
  const source = path.join(root, "source", ".forge");
  const checkout = path.join(root, "home-checkout");
  const otherCheckout = path.join(root, "other-checkout");
  await mkdir(source, { recursive: true });
  await mkdir(checkout);
  await mkdir(otherCheckout);
  const snapshot = await snapshotForge({ forgeDir: source });
  await mkdir(path.join(source, "runs", "j1"), { recursive: true });
  await writeFile(path.join(source, "runs", "j1", "run.json"), '{"original":true}\r\n');
  const delta = await computeDelta({ forgeDir: source, snapshot });
  const chunks = encodeDeltaChunks({ delta, deltaId: "j1", chunkBytes: 90 });
  const identity = { jobId: "j1", projectId: "p1", deltaId: "j1", sha256Total: chunks[0].sha256Total };
  const config = {
    lanes: [{ id: "local", kind: "local" }, { id: "home", kind: "remote" }],
    projects: [
      { id: "p1", homeLane, repo: { path: checkout } },
      { id: "p2", homeLane, repo: { path: otherCheckout } },
    ],
  };
  return { root, source, checkout, otherCheckout, config, delta, chunks, identity };
}

describe("registered canonical-home application receiver", () => {
  it("rejects an already-aborted application transfer or read before forwarding or writing locally", async () => {
    const current = await fixture();
    const controller = new AbortController();
    controller.abort();
    const requests = [];
    const directory = new Map([["local", { read: (request) => {
      requests.push(request);
      return { ...current.identity, ok: true };
    } }]]);
    for (const currentLaneId of [null, "local"]) {
      const receiver = createL2Receiver({ config: current.config, currentLaneId, directory });
      const options = { signal: controller.signal };
      expect(await receiver.receive({ ...current.identity, chunks: current.chunks }, options))
        .toEqual({ ...current.identity, ok: false, code: "L2_APPLY_CANCELLED" });
      expect(await receiver.read({
        projectId: "p1", tool: "l2.apply", args: { ...current.identity, delta: current.delta },
      }, options)).toEqual({ ...current.identity, ok: false, code: "L2_APPLY_CANCELLED" });
    }
    expect(requests).toEqual([]);
    await expect(access(path.join(current.checkout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates cancellation out-of-band through the authenticated forwarding-only remote read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const current = await fixture("home");
    const registry = createWorkerRegistry();
    try {
      const sent = [];
      registry.connect("home-worker", {
        laneId: "home", capabilities: { projects: ["p1"] }, send: (packet) => sent.push(packet),
      });
      const lane = createRemoteLane({ id: "home", registry });
      const dispatcher = createL2Receiver({
        config: current.config, currentLaneId: null, directory: new Map([["home", lane]]),
      });
      const controller = new AbortController();
      const applying = dispatcher.receive({ ...current.identity, chunks: current.chunks }, { signal: controller.signal });
      const lease = sent.find((packet) => packet.t === "lease");
      expect(lease.request).toMatchObject({
        projectId: "p1", tool: "l2.apply", args: { ...current.identity, delta: current.delta },
      });
      expect(lease.request).not.toHaveProperty("signal");
      expect(lease.request.args).not.toHaveProperty("signal");
      controller.abort();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await applying).toEqual({ ...current.identity, ok: false, code: "L2_APPLY_CANCELLED" });
      expect(sent).toContainEqual(expect.objectContaining({ t: "cancel", leaseId: lease.leaseId }));
      expect(registry.snapshot().byLane.home).toMatchObject({ pending: 0, active: 0 });
      await expect(access(path.join(current.checkout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(path.join(current.source, "runs", "j1", "run.json"), "utf8")).toBe('{"original":true}\r\n');
    } finally {
      registry.close();
    }
  });

  it("forwards from a dispatcher with no local lane and acknowledges only the registered remote application", async () => {
    const current = await fixture("home");
    current.config.lanes = [{ id: "home", kind: "remote" }];
    const home = createL2Receiver({ config: current.config, currentLaneId: "home" });
    const requests = [];
    const directory = new Map([["home", { read: async (request) => {
      requests.push(request);
      return home.read(request);
    } }]]);
    const dispatcher = createL2Receiver({ config: current.config, currentLaneId: null, directory });
    const ack = await dispatcher.receive({ ...current.identity, chunks: current.chunks });
    expect(ack).toEqual({ ...current.identity, ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      projectId: "p1", tool: "l2.apply",
      args: { ...current.identity, forgeHome: path.join(current.checkout, ".forge"), delta: current.delta },
    });
    expect(await readFile(path.join(current.checkout, ".forge", "runs", "j1", "run.json"), "utf8"))
      .toBe('{"original":true}\r\n');
    await expect(access(path.join(current.otherCheckout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("explicitly refuses local reads in forwarding-only mode without creating canonical directories", async () => {
    const current = await fixture();
    const dispatcher = createL2Receiver({ config: current.config, currentLaneId: null, directory: new Map() });
    expect(await dispatcher.read({
      projectId: "p1", tool: "l2.apply", args: { ...current.identity, delta: current.delta },
    })).toEqual({ ...current.identity, ok: false, code: "L2_SCOPE_REJECTED" });
    expect(await dispatcher.receive({ ...current.identity, chunks: current.chunks }))
      .toEqual({ ...current.identity, ok: false, code: "L2_HOME_UNAVAILABLE" });
    await expect(access(path.join(current.checkout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(current.otherCheckout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps transfer and configured-home validation in forwarding-only mode before any authenticated forwarding", async () => {
    const current = await fixture("home");
    const requests = [];
    const dispatcher = createL2Receiver({
      config: current.config, currentLaneId: null,
      directory: new Map([["home", { read: (request) => { requests.push(request); return { ok: true }; } }]]),
    });
    expect(await dispatcher.receive({ ...current.identity, chunks: current.chunks.slice(1) }))
      .toMatchObject({ ok: false, code: "L2_CHUNK_MISSING" });
    expect(await dispatcher.receive({ ...current.identity, projectId: "unknown", chunks: current.chunks }))
      .toMatchObject({ ok: false, code: "PROJECT_NOT_FOUND" });
    expect(requests).toEqual([]);
    expect(await dispatcher.receive({ ...current.identity, chunks: current.chunks }))
      .toEqual({ ...current.identity, ok: false, code: "L2_APPLY_UNCONFIRMED" });
    await expect(access(path.join(current.checkout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
    current.config.projects[0].repo.forgeHome = "unknown-lane:relative";
    expect(() => createL2Receiver({ config: current.config, currentLaneId: null }))
      .toThrowError(expect.objectContaining({ code: "L2_PATH_REJECTED" }));
    expect(() => createL2Receiver({ config: { lanes: [], projects: [] }, currentLaneId: undefined }))
      .toThrowError(expect.objectContaining({ code: "L2_MALFORMED" }));
  });

  it("assembles real chunks and positively acknowledges only after canonical bytes exist", async () => {
    const current = await fixture();
    const receiver = protocol.createL2Receiver({ config: current.config, currentLaneId: "local" });
    const ack = await receiver.receive({ ...current.identity, chunks: current.chunks });
    expect(ack).toEqual({ ...current.identity, ok: true });
    const target = path.join(current.checkout, ".forge", "runs", "j1", "run.json");
    expect(await readFile(target, "utf8")).toBe('{"original":true}\r\n');
    expect(await receiver.receive({ ...current.identity, chunks: current.chunks })).toEqual(ack);
    await expect(access(path.join(current.otherCheckout, ".forge"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("routes a non-dispatcher canonical home through a scoped l2.apply read roundtrip", async () => {
    const current = await fixture("home");
    const home = protocol.createL2Receiver({ config: current.config, currentLaneId: "home" });
    const requests = [];
    const directory = new Map([["home", { read: async (request) => {
      requests.push(request);
      return home.read(request);
    } }]]);
    const dispatcher = protocol.createL2Receiver({ config: current.config, currentLaneId: "local", directory });
    expect(await dispatcher.receive({ ...current.identity, chunks: current.chunks }))
      .toEqual({ ...current.identity, ok: true });
    expect(requests[0]).toMatchObject({
      projectId: "p1", tool: "l2.apply", args: { ...current.identity, delta: current.delta },
    });
    expect(await readFile(path.join(current.checkout, ".forge", "runs", "j1", "run.json"), "utf8"))
      .toBe('{"original":true}\r\n');
  });

  it("does not ACK checksum failures, conflicts, missing chunks or an unreachable home as applied", async () => {
    const current = await fixture("home");
    const receiver = protocol.createL2Receiver({ config: current.config, currentLaneId: "local", directory: new Map() });
    expect(await receiver.receive({ ...current.identity, chunks: current.chunks }))
      .toMatchObject({ ok: false, code: "L2_HOME_UNAVAILABLE" });
    expect(await receiver.receive({ ...current.identity, chunks: current.chunks.slice(1) }))
      .toMatchObject({ ok: false, code: "L2_CHUNK_MISSING" });
    const tampered = current.chunks.map((chunk) => ({ ...chunk }));
    tampered[0].data = Buffer.from("tampered").toString("base64");
    expect(await receiver.receive({ ...current.identity, chunks: tampered }))
      .toMatchObject({ ok: false, code: "L2_CHECKSUM_MISMATCH" });
    current.config.projects[0].homeLane = "local";
    const local = protocol.createL2Receiver({ config: current.config, currentLaneId: "local" });
    const target = path.join(current.checkout, ".forge", "runs", "j1", "run.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "canonical-conflict");
    expect(await local.receive({ ...current.identity, chunks: current.chunks })).toMatchObject({ ok: false, code: "L2_CONFLICT" });
    expect(await readFile(target, "utf8")).toBe("canonical-conflict");
    expect(await readFile(path.join(current.source, "runs", "j1", "run.json"), "utf8")).toBe('{"original":true}\r\n');
  });

  it("validates every configured project home and refuses foreign or worker-supplied canonical paths", async () => {
    const current = await fixture();
    const receiver = protocol.createL2Receiver({ config: current.config, currentLaneId: "local" });
    const request = {
      projectId: "p1", tool: "l2.apply",
      args: { ...current.identity, delta: current.delta, forgeHome: path.join(current.otherCheckout, ".forge") },
    };
    expect(await receiver.read(request)).toMatchObject({ ok: false, code: "L2_PATH_REJECTED" });
    expect(await receiver.receive({ ...current.identity, projectId: "unknown", chunks: current.chunks }))
      .toMatchObject({ ok: false, code: "PROJECT_NOT_FOUND" });
    current.config.projects[1].repo.forgeHome = "unknown-lane:relative-path";
    expect(() => protocol.createL2Receiver({ config: current.config, currentLaneId: "local" }))
      .toThrowError(expect.objectContaining({ code: "L2_PATH_REJECTED" }));
  });

  it("accepts bounded identical retransmissions but rejects conflicting chunk copies", async () => {
    const current = await fixture();
    const receiver = createL2Receiver({ config: current.config, currentLaneId: "local" });
    const retried = [...current.chunks, structuredClone(current.chunks[0])];
    expect(await receiver.receive({ ...current.identity, chunks: retried }))
      .toEqual({ ...current.identity, ok: true });
    const bytes = Buffer.from("conflicting chunk");
    const conflict = {
      ...current.chunks[0], data: bytes.toString("base64"),
      sha256Chunk: createHash("sha256").update(bytes).digest("hex"),
    };
    expect(await receiver.receive({ ...current.identity, chunks: [...current.chunks, conflict] }))
      .toMatchObject({ ok: false, code: "L2_CHUNK_DUP" });
  });

  it("bounds transfer declarations and refuses a symlinked canonical home before applying bytes", async () => {
    const current = await fixture();
    const receiver = createL2Receiver({ config: current.config, currentLaneId: "local" });
    expect(await receiver.receive({
      ...current.identity, chunks: [{ ...current.chunks[0], total: 1001 }],
    })).toMatchObject({ ok: false, code: "L2_DELTA_TOO_LARGE" });
    const foreign = path.join(current.otherCheckout, ".forge");
    await mkdir(foreign);
    await symlink(foreign, path.join(current.checkout, ".forge"), process.platform === "win32" ? "junction" : "dir");
    expect(await receiver.receive({ ...current.identity, chunks: current.chunks }))
      .toMatchObject({ ok: false, code: "L2_PATH_REJECTED" });
    await expect(access(path.join(foreign, "runs"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
