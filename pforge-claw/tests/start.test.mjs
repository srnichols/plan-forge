import { mkdir, readFile, rm } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlacementService, bindPlacementService } from "../src/placement.mjs";
import { bootDispatcher } from "../src/cli/start.mjs";
import { createStore } from "../src/state/store.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { applicationIdentity } from "../src/protocol/l2-ack.mjs";
import { encodeDeltaChunks } from "../src/memory/l2-sync.mjs";
import { drain, g1Directory } from "./g1-runner-fixture.mjs";

const directories = [];

async function makeHome() {
  const home = await g1Directory("g1-start-");
  directories.push(home);
  return home;
}

function config() {
  return {
    v: 1,
    instanceId: "test-instance",
    timezone: "Etc/UTC",
    allowlist: [{ channel: "telegram", userId: "owner", role: "owner" }],
    lanes: [{ id: "local", kind: "local", enabled: true }],
    projects: [{
      id: "project",
      homeLane: "local",
      repo: { path: "/repo" },
      channel: { adapter: "telegram", chatId: "chat" },
    }],
  };
}

function optionsFor(home, order, extras = {}) {
  const store = {
    readJson: () => null,
    lock() {
      order.push("lock");
      return () => order.push("unlock");
    },
  };
  const clients = { closeAll: vi.fn(async () => order.push("clients.close")) };
  const app = {
    async start() {
      order.push("app.start");
      expect(getPlacementService()).toBeTruthy();
    },
    async stop() { order.push("app.stop"); },
    async doctor() { return []; },
  };
  const dispatcher = {
    async start() { order.push("dispatcher.start"); },
    async stop() { order.push("dispatcher.stop"); },
  };
  const runtimeOverride = vi.fn(async () => ({ id: "copilot-sdk", run: async () => ({}) }));
  const unbind = bindPlacementService(null);
  unbind();
  return {
    home,
    loadedConfig: { ok: true, config: config() },
    validateConfig: async () => ({ ok: true }),
    secrets: { has: () => true, redact: (value) => String(value) },
    store,
    createRegistry: () => ({ byId: () => null }),
    createProjectClients: () => { order.push("clients.create"); return clients; },
    createLaneDirectory: () => ({ snapshot: () => ({}) }),
    createApp: () => app,
    createJobExecutor: (options) => {
      order.push("executor.create");
      extras.onExecutor?.(options);
      return { runtimeFor: vi.fn() };
    },
    buildLanes: () => order.push("lanes.build"),
    createDispatcher: () => dispatcher,
    bindPlacementService(service) {
      order.push("placement.bind");
      const unbindService = bindPlacementService(service);
      return () => {
        order.push("placement.unbind");
        unbindService();
      };
    },
    runtimeFactory: runtimeOverride,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...extras,
  };
}

afterEach(async () => {
  if (getPlacementService()) bindPlacementService(null)();
  await Promise.all(directories.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe("dispatcher composition root", () => {
  it("stops dependencies in reverse order", async () => {
    const order = [];
    const handles = await bootDispatcher(optionsFor(await makeHome(), order));
    await handles.stop();
    expect(order).toEqual([
      "lock", "clients.create", "placement.bind", "app.start", "executor.create",
      "lanes.build", "dispatcher.start", "dispatcher.stop", "app.stop",
      "placement.unbind", "clients.close", "unlock",
    ]);
    await handles.stop();
    expect(order.filter((entry) => entry === "unlock")).toHaveLength(1);
  });

  it("binds the placement service at start and unbinds it at stop", async () => {
    const order = [];
    const handles = await bootDispatcher(optionsFor(await makeHome(), order));
    expect(getPlacementService()).toBeTruthy();
    await handles.stop();
    expect(getPlacementService()).toBeNull();
  });

  it("uses the runtime override from opts and never reads it from env", async () => {
    const order = [];
    let captured;
    const runtimeFactory = vi.fn(async () => ({ id: "copilot-sdk", run: async () => ({}) }));
    const handles = await bootDispatcher(optionsFor(await makeHome(), order, {
      env: { PFORGE_CLAW_RUNTIME_FACTORY: "must-not-be-used" },
      runtimeFactory,
      onExecutor(options) { captured = options.runtimeFactory; },
    }));
    expect(captured).toBe(runtimeFactory);
    expect(captured).not.toBe("must-not-be-used");
    await handles.stop();
  });

  it("rolls back every started component after a partial startup failure", async () => {
    const order = [];
    const options = optionsFor(await makeHome(), order, {
      buildLanes() {
        order.push("lanes.build");
        throw new Error("lane boot failed");
      },
    });
    await expect(bootDispatcher(options)).rejects.toThrow("lane boot failed");
    expect(order.slice(-4)).toEqual([
      "app.stop", "placement.unbind", "clients.close", "unlock",
    ]);
    expect(getPlacementService()).toBeNull();
  });

  it.each([false, true])("installs a real application receiver after directory construction (remote home: %s)", async (remoteHome) => {
    const root = await makeHome();
    const checkout = path.join(root, "canonical-checkout");
    await mkdir(checkout);
    const homeId = remoteHome ? "remote-home" : "desktop-home";
    const current = {
      ...config(),
      projects: [{ id: "project", homeLane: homeId, repo: { path: checkout }, models: { work: "fixture-model" } }],
      lanes: [
        { id: homeId, kind: remoteHome ? "remote" : "local", enabled: true },
        { id: "execution-worker", kind: "remote", enabled: true },
      ],
    };
    const workers = createWorkerRegistry({ requireL2: true });
    const homeReceiver = createL2Receiver({ config: current, currentLaneId: homeId });
    const bus = new EventEmitter();
    const secrets = await createSecrets({ env: {} });
    const app = { start: async () => {}, stop: async () => {}, doctor: async () => [] };
    let handles;
    workers.connect("history-worker", {
      laneId: "execution-worker", capabilities: { projects: ["project"] },
      send(packet) {
        if (packet.t === "lease") queueMicrotask(() => {
          workers.onAck({ leaseId: packet.leaseId, attempt: packet.attempt, workerId: "history-worker" });
          const chunks = encodeDeltaChunks({
            delta: { files: [], jsonl: { "openbrain-queue.jsonl": ['{"id":"history","text":"canonical bytes"}\n'] }, maps: {} },
            deltaId: "history-job",
          });
          for (const [index, chunk] of chunks.entries()) workers.onEvent({
            leaseId: packet.leaseId, attempt: packet.attempt, workerId: "history-worker",
            event: { v: 1, jobId: "history-job", seq: index + 1, ts: new Date(0).toISOString(),
              type: "artifact", data: { ...chunk, jobId: "history-job", projectId: "project" } },
          });
        });
        if (packet.t === "l2-applied") queueMicrotask(() => workers.onEvent({
          leaseId: packet.leaseId, attempt: packet.attempt, workerId: "history-worker",
          event: { v: 1, jobId: "history-job", seq: 2, ts: new Date(0).toISOString(),
            type: "finished", data: { status: "succeeded", l2: { ...applicationIdentity(packet), ok: packet.ok } } },
        }));
      },
    });
    if (remoteHome) workers.connect("canonical-worker", {
      laneId: homeId, capabilities: { projects: ["project"] },
      send(packet) {
        if (packet.t !== "lease") return;
        void homeReceiver.read(packet.request).then((ack) => workers.onEvent({
          leaseId: packet.leaseId, attempt: packet.attempt, workerId: "canonical-worker",
          event: { v: 1, jobId: packet.request.requestId, seq: 1, ts: new Date(0).toISOString(),
            type: "finished", data: { status: "ok", result: ack } },
        }));
      },
    });
    try {
      handles = await bootDispatcher({
        home: path.join(root, "claw-home"), loadedConfig: { ok: true, config: current },
        validateConfig: async () => ({ ok: true }), env: {}, secrets,
        store: createStore(path.join(root, "state")), bus,
        createApp: () => app, logger: { info() {}, warn() {}, error() {} },
        workers: {
          registry: () => workers,
          getLane: (id) => createRemoteLane({ id, registry: workers }),
          preparerFor: () => async (job) => job,
        },
      });
      const stream = workers.enqueue("execution-worker", {
        kind: "job", job: { id: "history-job", projectId: "project", type: "task" },
      }).iterator;
      const events = await drain(stream);
      expect(events.at(-1).data.status).toBe("succeeded");
      expect(workers.completion("history-job")).toMatchObject({
        ok: true, applicationAck: { jobId: "history-job", projectId: "project", ok: true },
      });
      expect(await readFile(path.join(checkout, ".forge", "openbrain-queue.jsonl"), "utf8"))
        .toBe('{"id":"history","text":"canonical bytes"}\n');
      expect(handles.ctx.l2Receiver).toBeTruthy();
      expect(handles.ctx.projectClients).toBe(handles.clients);
    } finally {
      workers.close();
      await handles?.stop();
    }
  });
});
