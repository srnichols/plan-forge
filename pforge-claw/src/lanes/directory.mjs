import { ClawError } from "../errors.mjs";
import { createLocalLane } from "./local-lane.mjs";
import { assertLane } from "./lane.mjs";
import workersFeature from "../features/workers.mjs";
import { createK8sClient } from "../k8s/api.mjs";
import { createK8sJobLane } from "./k8s-job-lane.mjs";
import { wrapPreparedLane } from "../jobs/lease-payload.mjs";

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

function localLane({ laneCfg, bus, runtimeFor }) {
  const local = createLocalLane({
    id: laneCfg.id,
    config: { lanes: [{ ...laneCfg, maxHeavy: laneCfg.concurrency ?? laneCfg.maxHeavy }] },
    bus, runtimeFor,
  });
  return {
    ...local,
    submit(job) {
      if (job.runtime !== undefined || job.provider !== undefined) throw new ClawError("RUNTIME_POLICY_DENIED");
      return local.submit(job);
    },
  };
}

function workerLane({ laneCfg, config, workers, k8sApiFactory }) {
  if (laneCfg.kind === "remote") return workers.getLane(laneCfg.id);
  if (laneCfg.kind !== "k8s") throw new ClawError("LANE_BAD_CONFIG");
  return createK8sJobLane({
    id: laneCfg.id, config, api: k8sApiFactory(laneCfg), registry: workers.registry(),
    jobKeyFor: (jobId) => workers.jobKeyFor(laneCfg.id, jobId),
    canDeriveJobKeys: () => workers.hasLaneSecret(laneCfg.id),
  });
}

export function buildLanes({
  directory, config = {}, bus, runtimeFor, logger, workers, k8sApiFactory, ctx,
} = {}) {
  workers ??= ctx?.features?.workers ?? workersFeature;
  k8sApiFactory ??= createK8sClient;
  directory.configure?.(config.lanes ?? []);
  for (const laneCfg of config.lanes ?? []) {
    if (laneCfg.enabled === false) continue;
    if (laneCfg.kind === "local") {
      directory.register(localLane({ laneCfg, bus, runtimeFor }));
      continue;
    }
    if (!workers?.registry?.()) {
      logger?.warn?.("LANE_NO_REGISTRY", { laneId: laneCfg.id });
      continue;
    }
    const lane = workerLane({ laneCfg, config, workers, k8sApiFactory });
    if (lane) directory.register(wrapPreparedLane(lane, workers.preparerFor(laneCfg, directory)));
  }
  return directory;
}
