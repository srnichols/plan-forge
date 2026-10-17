import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import lanesCommand from "../../src/commands/lanes.mjs";
import {
  bindPlacementService,
  createPlacementService,
} from "../../src/placement.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
let unbind = null;

function bindService(lanes) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-lanes-command-"));
  directories.push(directory);
  const service = createPlacementService({
    store: createStore(directory),
    config: { lanes },
    health: { "remote-1": { ok: true, pending: 2 } },
  });
  unbind = bindPlacementService(service);
}

afterEach(() => {
  unbind?.();
  unbind = null;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("/lanes", () => {
  it("is available to owners and approvers", () => {
    expect(lanesCommand).toMatchObject({ available: true, mutating: false, roles: ["owner", "approver"] });
  });

  it("allows no arguments or status, and rejects other input and unauthorized roles", async () => {
    bindService([{ id: "remote-1", kind: "remote", labels: ["macos"] }]);
    expect((await lanesCommand.handle({}, { caller: { role: "viewer" }, args: [] })).text).toBe("FORBIDDEN");
    expect((await lanesCommand.handle({}, { caller: { role: "owner" }, args: ["other"] })).text)
      .toBe("Usage: /lanes [status]");
    expect((await lanesCommand.handle({}, { caller: { role: "approver" }, args: ["status"] })).text)
      .toContain("remote-1  remote  labels: macos  online  queue: 2");
  });

  it("reports unavailable and empty state", async () => {
    expect((await lanesCommand.handle({}, { caller: { role: "owner" }, args: [] })).text)
      .toBe("SERVICE_UNAVAILABLE: placement");
    bindService([]);
    expect((await lanesCommand.handle({}, { caller: { role: "owner" }, args: [] })).text)
      .toBe("No lanes configured — add `lanes[]` to config.json");
  });

  it("limits the listing to 25 lanes and reports the remainder", async () => {
    bindService(Array.from({ length: 27 }, (_, index) => ({
      id: `lane-${index + 1}`,
      kind: "local",
    })));
    const result = await lanesCommand.handle({}, { caller: { role: "owner" }, args: [] });
    const lines = result.text.split("\n");
    expect(lines).toHaveLength(26);
    expect(lines[0]).toContain("lane-1");
    expect(lines[24]).toContain("lane-25");
    expect(lines[25]).toBe("+2 more");
  });

  it("uses ? when queue depth is not reported", async () => {
    bindService([{ id: "unknown-remote", kind: "remote" }]);
    expect((await lanesCommand.handle({}, { caller: { role: "owner" }, args: [] })).text)
      .toContain("queue: ?");
  });
});
