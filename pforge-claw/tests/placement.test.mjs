import { rmSync, writeFileSync } from "node:fs";
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
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { g1DirectorySync } from "./g1-runner-fixture.mjs";

const directories = [];

function makeStore() {
  const directory = g1DirectorySync("g1-placement-");
  directories.push(directory);
  return { directory, store: createStore(directory) };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("placeJob table", () => {
  it("does not confuse lane connectivity with eligibility for the requested project", () => {
    const project = { id: "one", homeLane: "home" };
    const lanes = [{ id: "home", kind: "remote" }, { id: "other", kind: "remote" }];
    const unavailable = placeJob({
      project, lanes,
      health: { home: { ok: false }, other: { ok: true, projectEligible: false } },
    });
    expect(unavailable).toMatchObject({ ok: false, error: PLACEMENT_ERRORS.NO_ELIGIBLE_LANE });
    expect(unavailable.skipped).toContainEqual({ id: "other", reason: "project unavailable" });
    expect(placeJob({
      project, lanes,
      health: { home: { ok: false }, other: { ok: true, projectEligible: true } },
    })).toMatchObject({ ok: true, laneId: "other" });
  });

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

// Meta-bug #385: `listStatuses` called a function-typed health as health(laneId, lane) and read
// one lane's health from the result, while dispatcher-startup wires `(options) =>
// directory.snapshot(options)`, which returns the whole map. So /lanes showed every healthy
// remote lane as offline with no queue depth, and an unhealthy local lane as online.
describe("lane statuses from the lane directory the dispatcher wires in (#385)", () => {
  const fakeLane = (id, kind, health) => ({
    id, kind, capabilities: {}, submit: async function* submit() {}, cancel: async () => ({ ok: true }), health: () => health,
  });
  const LANES = [
    { id: "remote-1", kind: "remote", enabled: true },
    { id: "remote-2", kind: "remote", enabled: true },
    { id: "home", kind: "local", enabled: true },
  ];

  function wire(store) {
    const directory = createLaneDirectory();
    directory.configure(LANES);
    directory.register(fakeLane("remote-1", "remote", { ok: true, pending: 2 }));
    directory.register(fakeLane("remote-2", "remote", { ok: false, pending: 0 }));
    directory.register(fakeLane("home", "local", { ok: false, queued: 3 }));
    return createPlacementService({ store, config: { lanes: LANES }, health: (options) => directory.snapshot(options) });
  }

  it("lists each lane with its own health: online with a queue depth, or offline", () => {
    const { store } = makeStore();
    expect(wire(store).listStatuses()).toEqual([
      { id: "remote-1", kind: "remote", labels: [], status: "online", queueDepth: 2 },
      { id: "remote-2", kind: "remote", labels: [], status: "offline", queueDepth: 0 },
      { id: "home", kind: "local", labels: [], status: "offline", queueDepth: 3 },
    ]);
  });

  it("places a job on a healthy remote lane when health is a function returning the map", () => {
    const placed = placeJob({
      project: { id: "p", homeLane: "remote-1" },
      lanes: LANES,
      health: () => ({ "remote-1": { ok: true, pending: 0 }, "remote-2": { ok: false } }),
    });
    expect(placed).toMatchObject({ ok: true, laneId: "remote-1" });
  });

  it("still previews with the same wiring, as before", () => {
    const { store } = makeStore();
    expect(wire(store).preview({ project: { id: "p", homeLane: "remote-1" } })).toMatchObject({ ok: true, laneId: "remote-1" });
  });
});
