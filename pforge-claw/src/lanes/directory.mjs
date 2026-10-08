import { ClawError } from "../errors.mjs";
import { createLocalLane } from "./local-lane.mjs";
import { assertLane } from "./lane.mjs";

export function createLaneDirectory() {
  const lanes = new Map();
  let configured = [];

  function register(lane) {
    assertLane(lane);
    if (lane.prepareLease !== undefined && typeof lane.prepareLease !== "function") {
      throw new ClawError("LANE_BAD_CONTRACT", { missing: ["prepareLease"] });
    }
    if (lanes.has(lane.id)) throw new ClawError("LANE_DUPLICATE", { laneId: lane.id });
    lanes.set(lane.id, lane);
    return lane;
  }

  function snapshot() {
    const health = {};
    for (const lane of configured) {
      const registered = lanes.get(lane.id);
      if (!registered) {
        health[lane.id] = { ok: false, id: lane.id, kind: lane.kind, code: "LANE_NOT_REGISTERED" };
        continue;
      }
      try {
        health[lane.id] = registered.health();
      } catch (error) {
        health[lane.id] = {
          ok: false, id: lane.id, kind: lane.kind,
          code: typeof error?.code === "string" ? error.code : "LANE_HEALTH_FAILED",
        };
      }
    }
    return health;
  }

  return {
    register,
    get: (id) => lanes.get(id) ?? null,
    all: () => [...lanes.values()],
    snapshot,
    configure(configuredLanes = []) {
      configured = [...configuredLanes];
    },
  };
}

export function buildLanes({
  directory, config = {}, bus, runtimeFor, logger, workers, k8sApiFactory,
} = {}) {
  void workers;
  void k8sApiFactory;
  const configured = config.lanes ?? [];
  directory.configure?.(configured);
  for (const laneCfg of configured) {
    if (laneCfg.enabled === false) continue;
    if (laneCfg.kind === "local") {
      directory.register(createLocalLane({
        id: laneCfg.id,
        config: { lanes: [{ ...laneCfg, maxHeavy: laneCfg.concurrency ?? laneCfg.maxHeavy }] },
        bus,
        runtimeFor,
      }));
      continue;
    }
    logger?.info?.("LANE_NOT_WIRED", { laneId: laneCfg.id, kind: laneCfg.kind });
  }
  return directory;
}
