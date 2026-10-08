import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { createLocalLane } from "../../src/lanes/local-lane.mjs";
import { createLeaseExecution } from "../../src/cli/worker.mjs";
import { createHttpServer } from "../../src/http.mjs";
import { signGrant } from "../../src/protocol/lease-grant.mjs";
import { createEnrollment, SECRET_PREFIX } from "../../src/protocol/enrollment.mjs";
import { createWorkerAgent, enrollWorker } from "../../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../../src/protocol/ws-server.mjs";
import { createStore } from "../../src/state/store.mjs";

const READY_TIMEOUT_MS = 5000;

async function waitForWorker(registry, workerId, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = Boolean(registry.current(workerId));
    if (connected) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Worker ${workerId} did not authenticate before timeout`);
}

export async function createE2EWorkerServer({ home, lanes, leaseMs } = {}) {
  if (!home || !Array.isArray(lanes) || lanes.length === 0) {
    throw new TypeError("home and at least one worker lane are required");
  }
  await mkdir(path.join(home, "state"), { recursive: true });
  const secretsFile = path.join(home, "secrets.json");
  const store = createStore(path.join(home, "state"));
  const enrollment = createEnrollment({ store, secretFile: secretsFile });
  const events = [];
  const registry = createWorkerRegistry({
    ...(leaseMs === undefined ? {} : { leaseMs }),
    onEvent: (event) => events.push(event),
    signLease: ({ worker, grant }) => {
      const secrets = JSON.parse(readFileSync(secretsFile, "utf8"));
      const key = secrets[`${SECRET_PREFIX}${worker.id}`];
      if (!key || !grant) throw new Error("LEASE_GRANT_UNAVAILABLE");
      return signGrant({ grant, subject: worker.id, key });
    },
  });
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({
    registry,
    enrollment,
    secrets: { get: (name) => JSON.parse(readFileSync(secretsFile, "utf8"))[name] ?? null },
    allowedLanes: lanes,
  });
  server.attach(http);
  const address = await http.listen();
  const url = `ws://127.0.0.1:${address.port}/claw/workers`;
  const workers = new Map();
  let stopped = false;

  async function startWorker({
    id, laneId, workerHome, capabilities, runtimeFactory, config, ctx, clients,
    readHandler, logger = { warn() {}, error() {} }, WebSocketImpl = WebSocket,
  } = {}) {
    if (stopped) throw new Error("Worker server has stopped");
    if (!id || !lanes.includes(laneId) || !workerHome) {
      throw new TypeError("id, configured laneId, and workerHome are required");
    }
    if (workers.has(id)) throw new Error(`Worker ${id} is already active`);
    if (!runtimeFactory && !ctx) throw new TypeError("runtimeFactory or execution context is required");
    await mkdir(path.join(workerHome, "state"), { recursive: true });
    const code = enrollment.issue(laneId);
    const joined = await enrollWorker({ url, code, laneId, logger, WebSocketImpl });
    await writeFile(path.join(workerHome, "secrets.json"), JSON.stringify({
      PFORGE_CLAW_WORKER_SECRET: joined.secret,
    }), { mode: 0o600 });
    await writeFile(path.join(workerHome, "state", "worker.json"), JSON.stringify({
      v: 1, workerId: joined.workerId, laneId,
    }));

    const sockets = [];
    class TrackedWebSocket extends WebSocketImpl {
      constructor(...args) {
        super(...args);
        sockets.push(this);
      }
    }
    const execution = ctx && config
      ? createLeaseExecution({
        ctx: { ...ctx, home: workerHome, config },
        clients,
        subject: joined.workerId,
        laneId,
        key: joined.secret,
        runtimeFactory,
      })
      : null;
    const localLane = createLocalLane({
      id: laneId,
      config,
      runtimeFor: execution?.runtimeFor ?? runtimeFactory,
    });
    const agent = createWorkerAgent({
      url,
      workerId: joined.workerId,
      secret: joined.secret,
      laneId,
      capabilities,
      localLane,
      readHandler,
      logger,
      WebSocketImpl: TrackedWebSocket,
      ...(execution ? { l2: execution.l2, afterJob: execution.afterJob } : {}),
      onLeaseAcked: (ack) => l2Acks.push(ack),
    });
    const l2Acks = [];
    agent.start();
    await waitForWorker(registry, joined.workerId);
    const record = {
      id,
      workerId: joined.workerId,
      laneId,
      home: workerHome,
      env: { PFORGE_CLAW_HOME: workerHome },
      agent,
      sockets,
      l2Acks,
      async killWorker() {
        const socket = sockets.at(-1);
        if (socket?.readyState === socket.OPEN) socket.terminate();
        const deadline = Date.now() + READY_TIMEOUT_MS;
        while (Date.now() < deadline && registry.current(joined.workerId)) {
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (registry.current(joined.workerId)) {
          throw new Error(`Worker ${id} did not disconnect before timeout`);
        }
      },
      async reconnectWorker() {
        const deadline = Date.now() + READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
          if (registry.current(joined.workerId)) return;
          await new Promise((resolve) => setImmediate(resolve));
        }
        throw new Error(`Worker ${id} did not reconnect before timeout`);
      },
      async stop() {
        agent.stop();
        await agent.drain();
        workers.delete(id);
      },
    };
    workers.set(id, record);
    return record;
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    const failures = [];
    for (const worker of [...workers.values()].reverse()) {
      try {
        await worker.stop();
      } catch (error) {
        failures.push(error);
      }
    }
    server.close();
    registry.close();
    try {
      await http.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) throw new AggregateError(failures, "E2E worker shutdown was incomplete.");
  }

  return {
    url,
    home,
    store,
    enrollment,
    registry,
    events,
    workers,
    startWorker,
    stop,
  };
}
