import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { createLocalLane } from "../../src/lanes/local-lane.mjs";
import { createLeaseExecution } from "../../src/cli/worker.mjs";
import { collectCopySet } from "../../src/jobs/bootstrap.mjs";
import { createProjectClients } from "../../src/mcp/project-client.mjs";
import { createRegistry, resolveMcpLaunch } from "../../src/registry.mjs";
import { createHttpServer } from "../../src/http.mjs";
import { signGrant } from "../../src/protocol/lease-grant.mjs";
import { createEnrollment, SECRET_PREFIX } from "../../src/protocol/enrollment.mjs";
import { createL2Receiver, L2_APPLY_READ } from "../../src/protocol/l2-receiver.mjs";
import { createWorkerAgent, enrollWorker } from "../../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../../src/protocol/ws-server.mjs";
import { createSecrets } from "../../src/secrets.mjs";
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

function trackPackets(WebSocketImpl) {
  const sockets = [];
  const packets = [];
  const waiting = new Set();
  function record(direction, bytes) {
    let packet;
    try {
      packet = JSON.parse(String(bytes));
    } catch {
      return;
    }
    if (!["ready", "lease", "event", "heartbeat", "l2-applied"].includes(packet.t)) return;
    const entry = { direction, packet };
    packets.push(entry);
    for (const waiter of waiting) {
      if (!waiter.predicate(entry)) continue;
      waiting.delete(waiter);
      waiter.resolve(entry);
    }
  }
  class TrackedWebSocket extends WebSocketImpl {
    constructor(...args) {
      super(...args);
      sockets.push(this);
      this.on("message", (bytes) => record("inbound", bytes));
    }
    send(bytes, ...args) {
      record("outbound", bytes);
      return super.send(bytes, ...args);
    }
  }
  return {
    sockets, packets, WebSocketImpl: TrackedWebSocket,
    waitForPacket(predicate) {
      const match = packets.find(predicate);
      if (match) return Promise.resolve(match);
      return new Promise((resolve) => waiting.add({ predicate, resolve }));
    },
  };
}

async function workerContext({ ctx, config, workerHome, logger, clients, laneId }) {
  const secrets = await createSecrets({ env: {}, file: path.join(workerHome, "secrets.json") });
  const registry = { ...createRegistry(config), resolveMcpLaunch };
  const ownClients = clients ?? createProjectClients({
    config, registry, logger, secrets,
    directory: ctx.lanes, currentLaneId: laneId,
  });
  return {
    clients: ownClients,
    ownsClients: !clients,
    ctx: {
      ...ctx, home: workerHome, config, secrets, registry, logger, bus: new EventEmitter(),
      store: createStore(path.join(workerHome, "state"), { redact: secrets.redact }),
    },
  };
}

export async function startE2EWorker({
  url, registry, enrollment, id, laneId, workerHome, capabilities, runtimeFactory, config, ctx, clients,
  readHandler, beforeRead, timers, logger = { warn() {}, error() {} }, WebSocketImpl = WebSocket,
} = {}) {
  if (!url || !registry || !enrollment || !id || !laneId || !workerHome) {
    throw new TypeError("a real dispatcher connection and worker identity are required");
  }
  if (!runtimeFactory && !ctx) throw new TypeError("runtimeFactory or execution context is required");
  await mkdir(path.join(workerHome, "state"), { recursive: true });
  const joined = await enrollWorker({ url, code: enrollment.issue(laneId), laneId, logger, WebSocketImpl });
  await writeFile(path.join(workerHome, "secrets.json"), JSON.stringify({
    PFORGE_CLAW_WORKER_SECRET: joined.secret,
  }), { mode: 0o600 });
  await writeFile(path.join(workerHome, "state", "worker.json"), JSON.stringify({
    v: 1, workerId: joined.workerId, laneId,
  }));
  const worker = ctx && config ? await workerContext({ ctx, config, workerHome, logger, clients, laneId }) : null;
  const execution = worker ? createLeaseExecution({
    ctx: worker.ctx, clients: worker.clients, subject: joined.workerId, laneId, key: joined.secret, runtimeFactory,
  }) : null;
  const receiver = worker ? createL2Receiver({ config, currentLaneId: laneId, directory: ctx.lanes }) : null;
  const localLane = createLocalLane({
    id: laneId, config, maxHeavy: 1, runtimeFor: execution?.runtimeFor ?? runtimeFactory,
  });
  const tracked = trackPackets(WebSocketImpl);
  const l2Acks = [];
  const appliedReads = [];
  const afterJobs = new Map();
  const afterJobWaiters = new Map();
  const agent = createWorkerAgent({
    url, workerId: joined.workerId, secret: joined.secret, laneId, capabilities, localLane,
    logger, WebSocketImpl: tracked.WebSocketImpl,
    ...(timers ? {
      setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn, rand: () => 0,
    } : {}),
    readHandler: readHandler ?? (worker ? async (request) => {
      await beforeRead?.(request);
      if (request.tool === L2_APPLY_READ) {
        const ack = await receiver.read(request);
        appliedReads.push(ack);
        return ack;
      }
      if (request.tool === "claw.bootstrap.copySet") {
        const project = config.projects.find((entry) => entry.id === request.projectId);
        return collectCopySet({ repoPath: project.repo.path, paths: request.args?.paths });
      }
      return worker.clients.call(request.projectId, request.tool, request.args ?? {});
    } : undefined),
    ...(execution ? {
      verifyLease: execution.verifyLease,
      l2: execution.l2,
      afterJob: async (context) => {
        await execution.afterJob(context);
        afterJobs.set(context.job.id, context);
        afterJobWaiters.get(context.job.id)?.resolve(context);
      },
    } : {}),
    onLeaseAcked: (ack) => l2Acks.push(ack),
  });
  agent.start();
  await waitForWorker(registry, joined.workerId);
  let stopped = false;
  async function disconnected() {
    while (registry.current(joined.workerId)) await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    id, workerId: joined.workerId, laneId, home: workerHome,
    env: { PFORGE_CLAW_HOME: workerHome }, agent, l2Acks, appliedReads, ...tracked,
    waitForAfterJob(jobId) {
      if (afterJobs.has(jobId)) return Promise.resolve(afterJobs.get(jobId));
      if (!afterJobWaiters.has(jobId)) afterJobWaiters.set(jobId, Promise.withResolvers());
      return afterJobWaiters.get(jobId).promise;
    },
    async syncHistory(jobId) {
      const forgeDir = execution.l2.forgeDirFor({ id: jobId });
      const delta = await execution.l2.collect({ forgeDir });
      return agent.syncHistory({ jobId, delta });
    },
    secretAppearsInPackets: () => JSON.stringify(tracked.packets).includes(joined.secret),
    secretAppearsInArtifacts: (checker) => checker(joined.secret),
    async killWorker() {
      tracked.sockets.at(-1)?.terminate();
      await disconnected();
    },
    async reconnectWorker() { await waitForWorker(registry, joined.workerId); },
    async crashWorker() {
      tracked.sockets.at(-1)?.terminate();
      agent.stop();
      await disconnected();
      await agent.drain();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      agent.stop();
      await agent.drain();
      if (worker?.ownsClients) await worker.clients.closeAll();
    },
  };
}

export async function createE2EWorkerServer({ home, lanes, leaseMs } = {}) {
  if (!home || !Array.isArray(lanes) || lanes.length === 0) {
    throw new TypeError("home and at least one worker lane are required");
  }
  await mkdir(path.join(home, "state"), { recursive: true });
  const secretsFile = path.join(home, "secrets.json");
  const secrets = await createSecrets({ env: {}, file: secretsFile });
  const store = createStore(path.join(home, "state"), { redact: secrets.redact });
  const enrollment = createEnrollment({ store, secretFile: secretsFile });
  const events = [];
  const registry = createWorkerRegistry({
    ...(leaseMs === undefined ? {} : { leaseMs }),
    onEvent: (event) => events.push(event),
    signLease: ({ worker, grant }) => {
      const key = secrets.get(`${SECRET_PREFIX}${worker.id}`);
      if (!key || !grant) throw new Error("LEASE_GRANT_UNAVAILABLE");
      return signGrant({ grant, subject: worker.id, key });
    },
  });
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({
    registry,
    enrollment,
    secrets,
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
    const connected = await startE2EWorker({
      url, registry, enrollment, id, laneId, workerHome, capabilities, runtimeFactory,
      config, ctx, clients, readHandler, logger, WebSocketImpl,
    });
    const record = {
      ...connected,
      async stop() {
        await connected.stop();
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
