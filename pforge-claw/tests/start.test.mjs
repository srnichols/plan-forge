import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlacementService, bindPlacementService } from "../src/placement.mjs";
import { bootDispatcher } from "../src/cli/start.mjs";
import { createStore } from "../src/state/store.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createLeasePreparer } from "../src/jobs/lease-payload.mjs";
import { HOME_MCP_BOOTSTRAP_TOOL } from "../src/jobs/bootstrap-mcp.mjs";
import { createProjectClients } from "../src/mcp/project-client.mjs";
import { createRegistry } from "../src/registry.mjs";
import { drain, g1Directory } from "./g1-runner-fixture.mjs";
import {
  createWorkerFixtureTransport, observeWorkerFixtureSocket, prepareWorkerFixtureJob, writeWorkerFixtureMcp,
} from "./worker-authority-fixture.mjs";

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
    await writeWorkerFixtureMcp(checkout);
    const homeId = remoteHome ? "remote-home" : "desktop-home";
    const current = {
      ...config(),
      projects: [{ id: "project", homeLane: homeId, repo: { path: checkout }, models: { work: "fixture-model" } }],
      lanes: [
        { id: homeId, kind: remoteHome ? "remote" : "local", enabled: true },
        { id: "execution-worker", kind: "remote", enabled: true },
      ],
    };
    const jobId = "a3000001";
    const key = "start-history-worker-fixture";
    const workers = createWorkerRegistry({
      requireL2: true, signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    const homeReceiver = createL2Receiver({ config: current, currentLaneId: homeId });
    const bus = new EventEmitter();
    const transport = await createWorkerFixtureTransport({
      root, registry: workers, lanes: ["execution-worker", ...(remoteHome ? [homeId] : [])],
    });
    const secrets = transport.secrets;
    const app = { start: async () => {}, stop: async () => {}, doctor: async () => [] };
    let handles;
    const observed = observeWorkerFixtureSocket({ hold: (packet) => packet.t === "l2-applied" });
    const sourceHome = path.join(root, "execution-checkout", ".forge");
    const historyAgent = createWorkerAgent({
      url: transport.url, workerId: "history-worker", secret: key, laneId: "execution-worker",
      capabilities: { os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["project"] },
      WebSocketImpl: observed.WebSocketImpl,
      verifyLease: (job) => verifyGrant({
        grant: job.leaseGrant, job, subject: "history-worker", laneId: "execution-worker", key,
      }),
      localLane: createLocalLane({ runtime: { run: async () => {
        await mkdir(sourceHome, { recursive: true });
        await writeFile(path.join(sourceHome, "openbrain-queue.jsonl"), '{"id":"history","text":"canonical bytes"}\n');
        return { status: "succeeded" };
      } } }),
      l2: { forgeDirFor: () => sourceHome },
    });
    const homeClients = createProjectClients({
      config: current, registry: createRegistry(current), secrets, env: {}, currentLaneId: homeId,
    });
    const homeAgent = remoteHome ? createWorkerAgent({
      url: transport.url, workerId: "canonical-worker", secret: key, laneId: homeId,
      capabilities: { os: "linux", arch: "x64", macos: false, toolchains: ["node"], projects: ["project"] },
      readHandler: (request, options) => request.tool === HOME_MCP_BOOTSTRAP_TOOL
        ? homeClients.call(request.projectId, request.tool, request.args, options)
        : homeReceiver.read(request, options),
    }) : null;
    try {
      await transport.enrollment.register({ workerId: "history-worker", laneId: "execution-worker", secret: key });
      if (homeAgent) await transport.enrollment.register({ workerId: "canonical-worker", laneId: homeId, secret: key });
      historyAgent.start();
      homeAgent?.start();
      await expect.poll(() => workers.snapshot().byLane["execution-worker"]?.publicationCapable).toBe(1);
      if (homeAgent) await expect.poll(() => workers.snapshot().byLane[homeId]?.connected).toBe(1);
      handles = await bootDispatcher({
        home: path.join(root, "claw-home"), loadedConfig: { ok: true, config: current },
        validateConfig: async () => ({ ok: true }), env: {}, secrets,
        store: createStore(path.join(root, "state")), bus,
        createApp: () => app, logger: { info() {}, warn() {}, error() {} },
        workers: {
          registry: () => workers,
          getLane: (id) => createRemoteLane({ id, registry: workers }),
          preparerFor: (laneConfig, directory) => (job, options) => createLeasePreparer({
            ctx: handles.ctx, laneConfig, directory,
          })(job, options),
        },
      });
      const job = await prepareWorkerFixtureJob({
        root, config: current, laneId: "execution-worker", directory: handles.ctx.lanes,
        job: { id: jobId, projectId: "project", type: "task", mutating: true },
      });
      const stream = workers.enqueue("execution-worker", { kind: "job", job }).iterator;
      const completion = drain(stream);
      await expect.poll(() => observed.held.some((packet) => packet.t === "l2-applied")).toBe(true);
      expect(observed.sent.some((packet) => packet.event?.type === "finished")).toBe(false);
      expect(await readFile(path.join(checkout, ".forge", "openbrain-queue.jsonl"), "utf8"))
        .toBe('{"id":"history","text":"canonical bytes"}\n');
      observed.receive(observed.held.find((packet) => packet.t === "l2-applied"));
      const events = await completion;
      expect(events.at(-1).data.status).toBe("succeeded");
      expect(workers.completion(jobId)).toMatchObject({
        ok: true, applicationAck: { jobId, projectId: "project", ok: true },
      });
      expect(await readFile(path.join(checkout, ".forge", "openbrain-queue.jsonl"), "utf8"))
        .toBe('{"id":"history","text":"canonical bytes"}\n');
      expect(handles.ctx.l2Receiver).toBeTruthy();
      expect(handles.ctx.projectClients).toBe(handles.clients);
    } finally {
      historyAgent.stop();
      homeAgent?.stop();
      await historyAgent.drain();
      await homeAgent?.drain();
      await homeClients.closeAll();
      await transport.close();
      await handles?.stop();
    }
  });
});
