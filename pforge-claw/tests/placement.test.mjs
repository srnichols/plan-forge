import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLACEMENT_ERRORS,
  placeJob,
  readLaneState,
  createPlacementService,
  setLaneOptIn,
} from "../src/placement.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];

function makeStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-placement-"));
  directories.push(directory);
  return { directory, store: createStore(directory) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("placeJob table", () => {
  it.each([
    {
      name: "chooses the preferred lane",
      project: { id: "one", homeLane: "home", placement: { prefer: ["preferred"] } },
      lanes: [
        { id: "home", kind: "remote" },
        { id: "preferred", kind: "remote" },
      ],
      health: { preferred: { ok: true }, home: { ok: true } },
      expectedLane: "preferred",
    },
    {
      name: "falls back after an offline preference",
      project: { id: "one", homeLane: "k8s-jobs", placement: { prefer: ["mac-1"] } },
      lanes: [
        { id: "mac-1", kind: "remote" },
        { id: "k8s-jobs", kind: "k8s" },
      ],
      health: { "mac-1": { ok: false } },
      expectedLane: "k8s-jobs",
      explanation: "k8s-jobs (mac-1 offline)",
    },
    {
      name: "matches every required label",
      project: { id: "one", homeLane: "worker", placement: { requires: ["macos"] } },
      lanes: [{ id: "worker", kind: "remote", labels: ["macos"] }],
      health: { worker: { ok: true } },
      expectedLane: "worker",
    },
    {
      name: "skips a lane missing a required label",
      project: { id: "one", homeLane: "worker", placement: { requires: ["macos"] } },
      lanes: [{ id: "worker", kind: "remote", labels: ["linux"] }],
      health: { worker: { ok: true } },
      expectedError: PLACEMENT_ERRORS.NO_ELIGIBLE_LANE,
      expectedSkip: { id: "worker", reason: "missing labels" },
    },
    {
      name: "never relaxes required labels when the matching lane is offline",
      project: { id: "one", homeLane: "worker", placement: { requires: ["macos"] } },
      lanes: [
        { id: "worker", kind: "remote", labels: ["macos"] },
        { id: "fallback", kind: "local", labels: ["linux"] },
      ],
      health: { worker: { ok: false } },
      expectedError: PLACEMENT_ERRORS.NO_ELIGIBLE_LANE,
      expectedSkip: { id: "worker", reason: "offline" },
    },
    {
      name: "skips disabled lanes",
      project: { id: "one", homeLane: "worker" },
      lanes: [{ id: "worker", kind: "local", enabled: false }],
      expectedError: PLACEMENT_ERRORS.NO_ELIGIBLE_LANE,
      expectedSkip: { id: "worker", reason: "disabled" },
    },
    {
      name: "pins restricted projects to dedicated preferred or home lanes",
      project: {
        id: "one",
        visibility: "restricted",
        homeLane: "private",
        placement: { prefer: ["shared"] },
      },
      projects: [
        { id: "one", visibility: "restricted", homeLane: "private", placement: { prefer: ["shared"] } },
        { id: "two", homeLane: "shared" },
        { id: "three", placement: { prefer: ["shared"] } },
      ],
      lanes: [
        { id: "shared", kind: "local" },
        { id: "private", kind: "local" },
      ],
      expectedLane: "private",
      expectedSkip: { id: "shared", reason: "not dedicated" },
    },
    {
      name: "does not place restricted projects on a shared lane",
      project: { id: "one", visibility: "restricted", homeLane: "shared" },
      projects: [
        { id: "one", visibility: "restricted", homeLane: "shared" },
        { id: "two", homeLane: "shared" },
      ],
      lanes: [{ id: "shared", kind: "local" }],
      expectedError: PLACEMENT_ERRORS.NO_DEDICATED_LANE,
      expectedSkip: { id: "shared", reason: "not dedicated" },
    },
    {
      name: "deduplicates preferred lanes",
      project: { id: "one", homeLane: "fallback", placement: { prefer: ["preferred", "preferred"] } },
      lanes: [
        { id: "preferred", kind: "remote" },
        { id: "fallback", kind: "local" },
      ],
      health: { preferred: { ok: true } },
      expectedLane: "preferred",
    },
    {
      name: "allows an empty requires list",
      project: { id: "one", homeLane: "worker", placement: { requires: [] } },
      lanes: [{ id: "worker", kind: "local" }],
      expectedLane: "worker",
    },
  ])("$name", ({
    project, projects = [project], lanes, health, expectedLane, expectedError, expectedSkip, explanation,
  }) => {
    const result = placeJob({ project, projects, lanes, health });
    if (expectedLane) {
      expect(result).toMatchObject({ ok: true, laneId: expectedLane });
      if (explanation) expect(result.explanation).toBe(explanation);
    } else {
      expect(result).toMatchObject({ ok: false, error: expectedError });
    }
    if (expectedSkip) expect(result.skipped).toContainEqual(expectedSkip);
  });
});

describe("lane opt-in state", () => {
  it("keeps an opt-in lane off until toggled, and persists the audited choice", () => {
    const { store } = makeStore();
    const project = { id: "one", homeLane: "worker" };
    const lanes = [{ id: "worker", kind: "remote", optIn: true }];

    expect(placeJob({ project, lanes, health: { worker: { ok: true } } }).error)
      .toBe(PLACEMENT_ERRORS.NO_ELIGIBLE_LANE);
    setLaneOptIn({ store, laneId: "worker", on: true, by: "owner-1", now: 1234 });
    expect(placeJob({
      project, lanes, laneState: readLaneState(store), health: { worker: { ok: true } },
    })).toMatchObject({ ok: true, laneId: "worker" });
    expect(readLaneState(store)).toMatchObject({ v: 1, lanes: { worker: { on: true } } });
    expect([...store.read("audit")].map(({ record }) => record)).toContainEqual(expect.objectContaining({
      kind: "lane.opt-in",
      laneId: "worker",
      on: true,
      by: "owner-1",
    }));
  });

  describe("placement preview", () => {
    it("returns null with no lanes and skips configured lanes that are offline", () => {
      const { store } = makeStore();
      expect(createPlacementService({ store, config: { lanes: [] } }).preview({ project: {} })).toBeNull();
      const service = createPlacementService({
        store,
        config: {
          projects: [{ id: "p", homeLane: "offline" }],
          lanes: [
            { id: "offline", kind: "remote" },
            { id: "local", kind: "local" },
          ],
        },
        health: () => ({
          offline: { ok: false },
          local: { ok: true, queued: 0 },
        }),
      });
      expect(service.preview({ project: { id: "p", homeLane: "offline" } }))
        .toMatchObject({
          ok: true,
          laneId: "local",
          skipped: [{ id: "offline", reason: "offline" }],
        });
    });

    it("never throws when lane preview health cannot be read", () => {
      const { store } = makeStore();
      const service = createPlacementService({
        store,
        config: { lanes: [{ id: "local", kind: "local" }] },
        health: () => { throw new Error("health unavailable"); },
      });
      expect(service.preview({ project: { id: "p", homeLane: "local" } })).toBeNull();
    });
  });

  it("fails closed when lanes.json is corrupt", () => {
    const { directory, store } = makeStore();
    writeFileSync(path.join(directory, "lanes.json"), "{broken");
    expect(readLaneState(store)).toEqual({ v: 1, lanes: {} });
    expect(placeJob({
      project: { id: "one", homeLane: "worker" },
      lanes: [{ id: "worker", kind: "remote", optIn: true }],
      laneState: readLaneState(store),
      health: { worker: { ok: true } },
    })).toMatchObject({ ok: false, error: PLACEMENT_ERRORS.NO_ELIGIBLE_LANE });
  });
});
