import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import laneCommand from "../../src/commands/lane.mjs";
import {
  bindPlacementService,
  createPlacementService,
} from "../../src/placement.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
let unbind = null;

function makeService({ lanes = [{ id: "remote-1", kind: "remote", optIn: true }] } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-lane-command-"));
  directories.push(directory);
  const store = createStore(directory);
  unbind = bindPlacementService(createPlacementService({ store, config: { lanes } }));
  return store;
}

afterEach(() => {
  unbind?.();
  unbind = null;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("/lane", () => {
  it("is available, mutating, and owner-only", () => {
    expect(laneCommand).toMatchObject({ available: true, mutating: true, roles: ["owner"] });
  });

  it("rejects non-owners and bad arguments", async () => {
    expect((await laneCommand.handle({}, { caller: { role: "approver" }, args: ["remote-1", "off"] })).text)
      .toBe("FORBIDDEN");
    expect((await laneCommand.handle({}, { caller: { role: "owner" }, args: ["remote-1"] })).text)
      .toBe("Usage: /lane <id> <on|off>");
    expect((await laneCommand.handle({}, { caller: { role: "owner" }, args: ["remote-1", "maybe"] })).text)
      .toBe("Usage: /lane <id> <on|off>");
  });

  it("reports unavailable service, unknown lane, and lanes without optIn", async () => {
    expect((await laneCommand.handle({}, {
      caller: { role: "owner" }, args: ["remote-1", "on"],
    })).text).toBe("SERVICE_UNAVAILABLE: placement");
    makeService({ lanes: [{ id: "fixed", kind: "local" }] });
    expect((await laneCommand.handle({}, {
      caller: { role: "owner" }, args: ["missing", "on"],
    })).text).toBe("Unknown lane: missing");
    expect((await laneCommand.handle({}, {
      caller: { role: "owner" }, args: ["fixed", "off"],
    })).text).toBe("Lane fixed: toggle via `enabled` in config");
  });

  it("persists and audits a toggle before returning success", async () => {
    const store = makeService();
    const result = await laneCommand.handle({}, {
      caller: { role: "owner", userId: "owner-1" },
      args: ["remote-1", "off"],
    });
    expect(result.text).toContain("Lane remote-1 is off for new jobs");
    expect(store.readJson("lanes.json")).toMatchObject({ lanes: { "remote-1": { on: false } } });
    expect([...store.read("audit")].map(({ record }) => record)).toContainEqual(expect.objectContaining({
      kind: "lane.opt-in", laneId: "remote-1", on: false, by: "owner-1",
    }));
  });

  it("bounds an unknown lane id before echoing it", async () => {
    makeService();
    const result = await laneCommand.handle({}, {
      caller: { role: "owner" }, args: ["x".repeat(80), "on"],
    });
    expect(result.text).toBe(`Unknown lane: ${"x".repeat(64)}`);
  });

  it("toggles the exact configured 81-character lane identifier", async () => {
    const laneId = "b".repeat(81);
    const store = makeService({ lanes: [{ id: laneId, kind: "remote", optIn: true }] });
    const result = await laneCommand.handle({}, {
      caller: { role: "owner", userId: "owner-1" }, args: [laneId, "off"],
    });
    expect(result.text).toContain(`Lane ${laneId} is off for new jobs`);
    expect(store.readJson("lanes.json").lanes[laneId]).toMatchObject({ on: false });
    expect([...store.read("audit")].map(({ record }) => record.laneId)).toEqual([laneId]);
  });

  it("does not toggle a shorter registered lane that shares an unknown identifier's preview", async () => {
    const prefix = "b".repeat(64);
    const store = makeService({ lanes: [{ id: prefix, kind: "remote", optIn: true }] });
    const result = await laneCommand.handle({}, {
      caller: { role: "owner", userId: "owner-1" }, args: [`${prefix}extra`, "off"],
    });
    expect(result.text).toBe(`Unknown lane: ${prefix}`);
    expect(store.readJson("lanes.json", null)).toBeNull();
    expect([...store.read("audit")]).toEqual([]);
  });
});
