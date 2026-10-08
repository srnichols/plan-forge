import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlacementService, bindPlacementService } from "../src/placement.mjs";
import { bootDispatcher } from "../src/cli/start.mjs";

const directories = [];

async function makeHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), "claw-start-"));
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
});
