import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { createApprovalService } from "../src/approvals.mjs";
import { createLeasePreparer } from "../src/jobs/lease-payload.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { mac } from "../src/protocol/auth.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { decode, encode, message, PUBLICATION_FENCE_VERSION } from "../src/protocol/messages.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createHttpServer } from "../src/http.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createStore } from "../src/state/store.mjs";

/** Configure the registered fixture home before the real metadata collector reads it. */
export async function writeWorkerFixtureMcp(repoPath) {
  await mkdir(path.join(repoPath, ".vscode"), { recursive: true });
  await writeFile(path.join(repoPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: {
      "plan-forge": {
        command: "node",
        args: ["${workspaceFolder}/pforge-mcp/server.mjs"],
        cwd: "${workspaceFolder}",
        env: {},
      },
    },
  }));
}

/** Consume a real configured-owner approval and collect the descriptor before granting. */
export async function prepareWorkerFixtureJob({ root, config, laneId, job, directory }) {
  const store = createStore(path.join(root, `worker-approval-${job.id}`));
  const unlock = store.lock();
  try {
    const created = createJob({
      id: job.id, type: job.type, projectId: job.projectId, readOnly: job.mutating === false,
    });
    const queued = {
      ...created.job, ...job, callerId: "owner", callerRole: "owner",
      adapter: "telegram", chatId: "chat", threadId: null,
    };
    store.append(JOBS_STREAM, { ...created.event, job: queued });
    if (queued.mutating) {
      const awaiting = transition(queued, "awaiting-approval");
      store.append(JOBS_STREAM, awaiting.event);
      const approvals = createApprovalService({ store, config });
      const approval = approvals.createApproval(awaiting.job);
      approvals.issue(awaiting.job, { approval });
      const decision = await approvals.decide({
        payload: approval.approve.slice(2),
        caller: { role: "owner", userId: "owner" }, chatId: "chat", threadId: null,
      });
      if (!decision.ok) throw new Error(`Worker fixture approval failed: ${decision.reason}`);
    }
    const lane = config.lanes.find((entry) => entry.id === laneId);
    if (!lane) throw new TypeError("A configured execution lane is required");
    const leased = transition(currentJobs(store)[job.id], "leased", { lane: laneId });
    store.append(JOBS_STREAM, leased.event);
    return await createLeasePreparer({ ctx: { config, store }, laneConfig: lane, directory })(leased.job);
  } finally {
    unlock();
  }
}

/** Use the real enrollment, authentication, negotiation, and current-connection routing. */
export async function createWorkerFixtureTransport({
  root, registry, lanes = [], jobLanes = [], jobKeyFor,
}) {
  const store = createStore(path.join(root, "worker-transport-state"));
  const unlock = store.lock();
  const secretFile = path.join(root, "worker-transport-secrets.json");
  const secrets = await createSecrets({ env: {}, file: secretFile });
  const enrollment = createEnrollment({ store, secretFile, secrets });
  const server = createWorkerServer({
    registry, enrollment, secrets, allowedLanes: lanes, jobLanes, jobKeyFor,
  });
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    server.close();
    registry.close();
    await http.close();
    unlock();
  }
  try {
    server.attach(http);
    const { port } = await http.listen();
    return { url: `ws://127.0.0.1:${port}/claw/workers`, enrollment, secrets, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Observe or delay only the external WebSocket edge; production handlers remain real. */
export function observeWorkerFixtureSocket({ hold = () => false } = {}) {
  const sent = [];
  const received = [];
  const held = [];
  let socket;
  class FixtureSocket extends WebSocket {
    constructor(...args) {
      super(...args);
      socket = this;
    }
    send(raw, ...args) {
      sent.push(decode(raw));
      return super.send(raw, ...args);
    }
    emit(event, ...args) {
      if (event === "message") {
        const packet = decode(args[0], { isBinary: args[1] });
        received.push(packet);
        if (hold(packet)) {
          held.push(packet);
          return true;
        }
      }
      return super.emit(event, ...args);
    }
  }
  return {
    WebSocketImpl: FixtureSocket, sent, received, held,
    receive(packet) {
      return WebSocket.prototype.emit.call(socket, "message", Buffer.from(encode(packet)), false);
    },
  };
}

/** Authenticate a wire peer, including a genuinely legacy or job-scoped HELLO. */
export async function authenticateWorkerFixture({
  url, workerId, laneId, key, capabilities, jobId, legacy = false,
}) {
  const client = new WebSocket(url);
  const received = [];
  const ready = Promise.withResolvers();
  client.once("open", () => {
    const identity = jobId === undefined
      ? { mode: "auth", workerId, laneId, capabilities }
      : { mode: "job", laneId, jobId };
    client.send(encode(message("hello", {
      ...identity, ...(legacy ? {} : { publicationFence: PUBLICATION_FENCE_VERSION }),
    })));
  });
  client.on("message", (raw, isBinary) => {
    try {
      const packet = decode(raw, { isBinary });
      received.push(packet);
      if (packet.t === "challenge") client.send(encode(message("auth", {
        workerId, mac: mac(key, packet.nonce, workerId),
      })));
      if (packet.t === "ready") ready.resolve();
      if (packet.t === "bye") ready.reject(new Error(packet.reason));
    } catch (error) {
      ready.reject(error);
      client.close();
    }
  });
  client.once("error", ready.reject);
  client.once("close", () => ready.reject(new Error("Worker fixture closed before READY")));
  await ready.promise;
  return { client, received };
}
