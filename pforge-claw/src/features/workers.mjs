import path from "node:path";
import { createHttpServer } from "../http.mjs";
import { createRemoteLane } from "../lanes/remote-lane.mjs";
import { createEnrollment } from "../protocol/enrollment.mjs";
import { createWorkerRegistry } from "../protocol/worker-registry.mjs";
import { createWorkerServer } from "../protocol/ws-server.mjs";

let runtime = null;

async function stopRuntime(state) {
  if (!state || state.stopped) return;
  state.stopped = true;
  const errors = [];
  for (const close of [...state.closeables].reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  state.lanes.clear();
  if (runtime === state) runtime = null;
  if (errors.length) throw new AggregateError(errors, "Worker feature shutdown was incomplete.");
}

async function start(ctx) {
  if (runtime) return;
  const remoteLanes = (ctx.config.lanes ?? [])
    .filter((lane) => lane.kind === "remote" && lane.enabled !== false);
  if (remoteLanes.length === 0) return;
  const state = { lanes: new Map(), closeables: [], registry: null, stopped: false };
  runtime = state;
  try {
    const http = createHttpServer({
      bind: ctx.config.http?.bind ?? "127.0.0.1",
      port: ctx.config.http?.port ?? 3190,
    });
    state.closeables.push(() => http.close());
    const registry = createWorkerRegistry({
      onEvent: (event) => ctx.bus?.emit("lane.event", event),
    });
    state.registry = registry;
    state.closeables.push(() => registry.close());
    const enrollment = createEnrollment({
      store: ctx.store,
      secretFile: path.join(ctx.home, "secrets.json"),
    });
    const server = createWorkerServer({
      registry,
      enrollment,
      secrets: ctx.secrets,
      logger: ctx.logger,
      allowedLanes: remoteLanes.map((lane) => lane.id),
    });
    state.closeables.push(() => server.close());
    server.attach(http);
    await http.listen();
    for (const laneConfig of remoteLanes) {
      state.lanes.set(laneConfig.id, createRemoteLane({ id: laneConfig.id, registry }));
    }
  } catch (error) {
    try {
      await stopRuntime(state);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Worker feature startup rollback was incomplete.");
    }
    throw error;
  }
}

async function stop() {
  await stopRuntime(runtime);
}

function snapshot() {
  return runtime?.registry?.snapshot() ?? null;
}

function getLane(id) {
  return runtime?.lanes.get(id);
}

function lanes() {
  return [...(runtime?.lanes.values() ?? [])];
}

export default {
  name: "workers",
  available: true,
  start,
  stop,
  snapshot,
  getLane,
  lanes,
};
