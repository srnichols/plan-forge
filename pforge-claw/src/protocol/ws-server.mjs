import { diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, createPublicKey } from "node:crypto";
import { WebSocketServer } from "ws";
import { ClawError } from "../errors.mjs";
import { challenge, enrollmentMac, verifyEnrollmentMac, verifyMac } from "./auth.mjs";
import { CLOSE_CODES, decode, encode, MAX_FRAME_BYTES, message } from "./messages.mjs";

const SECRET_PREFIX = "PFORGE_CLAW_WORKER_SECRET__";
const HANDSHAKE_STATES = Object.freeze({ HELLO: "AWAIT_HELLO", AUTH: "AWAIT_AUTH", READY: "READY" });

function deriveSecret(privateKey, publicKey, codeHash, workerId) {
  const shared = diffieHellman({ privateKey, publicKey });
  return Buffer.from(hkdfSync(
    "sha256",
    shared,
    Buffer.from(codeHash, "hex"),
    `pforge-claw-worker:${workerId}`,
    32,
  )).toString("hex");
}

function closeWith(socket, code, reason) {
  if (socket.readyState === socket.OPEN) {
    try {
      socket.send(encode(message("bye", { reason })));
    } catch {
      // The socket may have closed between the state check and send.
    }
    socket.close(code);
  } else socket.terminate();
}

function audit(logger, code) {
  logger?.warn?.("Worker protocol event", { code });
}

export function createWorkerServer({
  registry,
  enrollment,
  secrets,
  logger,
  handshakeMs = 10_000,
  heartbeatMs = 15_000,
  allowedLanes = [],
  jobLanes = [],
  jobKeyFor,
} = {}) {
  if (!registry || !enrollment || !secrets) throw new ClawError("WORKER_SERVER_BAD_CONFIG");
  const allowed = new Set(allowedLanes);
  const allowedJobs = new Set(jobLanes);
  let wss = null;
  let attached = false;
  let detachUpgrade = null;
  const contexts = new Set();

  function attach(httpServer) {
    if (attached) throw new ClawError("WORKER_SERVER_ALREADY_ATTACHED");
    attached = true;
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
    const upgrade = (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
    };
    const handleUpgrade = (request, socket, head) => {
      let pathname;
      try {
        pathname = new URL(request.url, "http://localhost").pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== "/claw/workers") {
        socket.destroy();
        return;
      }
      upgrade(request, socket, head);
    };
    detachUpgrade = typeof httpServer.onUpgrade === "function"
      ? httpServer.onUpgrade("/claw/workers", upgrade)
      : (httpServer.on("upgrade", handleUpgrade), () => httpServer.off("upgrade", handleUpgrade));
    wss.on("connection", (socket) => handleConnection(socket));
    return detachUpgrade;
  }

  function handleConnection(socket) {
    const context = {
      socket, state: HANDSHAKE_STATES.HELLO, nonce: null, mode: null,
      laneId: null, workerId: null, capabilities: null, hello: null, timer: null,
    };
    contexts.add(context);
    const timeout = () => {
      audit(logger, "WORKER_HANDSHAKE_TIMEOUT");
      closeWith(socket, CLOSE_CODES.UNAUTHORIZED, "HANDSHAKE_TIMEOUT");
    };
    context.timer = setTimeout(timeout, handshakeMs);
    context.timer?.unref?.();
    const send = (payload) => {
      if (payload?.closeCode) {
        closeWith(socket, payload.closeCode, payload.message?.reason ?? "WORKER_REVOKED");
        return;
      }
      if (socket.readyState === socket.OPEN) socket.send(encode(payload));
    };

    function failHandshake(code = "WORKER_AUTH_FAILED", closeCode = CLOSE_CODES.UNAUTHORIZED) {
      logger?.warn?.("Worker protocol event", { code, laneId: context.laneId, jobId: context.hello?.jobId });
      closeWith(socket, closeCode, code);
    }

    function startAuthentication(hello) {
      context.mode = hello.mode;
      context.laneId = hello.laneId;
      context.hello = hello;
      context.nonce = challenge();
      context.state = HANDSHAKE_STATES.AUTH;
      send(message("challenge", { nonce: context.nonce }));
    }

    async function enroll(authMessage) {
      const { codeHash, laneId } = enrollment.consume({
        codeId: context.hello.codeId,
        laneId: context.laneId,
        verify: (hash) => verifyEnrollmentMac(hash, authMessage.mac, context.nonce, context.hello.pub),
      });
      const pair = generateKeyPairSync("x25519");
      const publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
      const workerId = `w_${randomBytes(8).toString("hex")}`;
      const publicWorkerKey = createPublicKey({
        key: Buffer.from(context.hello.pub, "base64"), type: "spki", format: "der",
      });
      const secret = deriveSecret(pair.privateKey, publicWorkerKey, codeHash, workerId);
      await enrollment.register({ workerId, laneId, secret });
      const proof = enrollmentMac(codeHash, context.nonce, publicKey, workerId);
      context.nonce = null;
      send(message("ready", { workerId, pub: publicKey, mac: proof }));
      socket.close(1000, "ENROLLED");
    }

    async function authenticate(authMessage) {
      const workerId = authMessage.workerId;
      if (context.mode === "job") {
        const jobId = context.hello.jobId;
        if (!allowedJobs.has(context.laneId)) return failHandshake("WORKER_JOB_MODE_DENIED");
        if (!registry.hasActiveJob(context.laneId, jobId)) return failHandshake("WORKER_JOB_UNKNOWN");
        const key = jobKeyFor?.(context.laneId, jobId);
        if (workerId !== `job:${jobId}` || !key || !verifyMac(key, context.nonce, workerId, authMessage.mac)) {
          return failHandshake("WORKER_AUTH_FAILED");
        }
        context.jobScope = { laneId: context.laneId, jobId };
      } else {
        const registered = enrollment.worker?.(workerId);
        if (enrollment.status(workerId) !== "active" || registered?.status !== "active") {
          failHandshake(enrollment.status(workerId) === "revoked" ? "WORKER_REVOKED" : "WORKER_UNKNOWN",
            enrollment.status(workerId) === "revoked" ? CLOSE_CODES.REVOKED : CLOSE_CODES.UNAUTHORIZED);
          return;
        }
        const secret = secrets.get(`${SECRET_PREFIX}${workerId}`);
        if (!secret || !verifyMac(secret, context.nonce, workerId, authMessage.mac)) {
          failHandshake("WORKER_AUTH_FAILED");
          return;
        }
        if (!allowed.has(context.laneId) || registered.laneId !== context.laneId) {
          failHandshake("WORKER_LANE_DENIED");
          return;
        }
      }
      context.workerId = workerId;
      context.nonce = null;
      context.state = HANDSHAKE_STATES.READY;
      clearTimeout(context.timer);
      send(message("ready", { leaseMs: registry.leaseMs ?? 60_000, heartbeatMs }));
      registry.connect(workerId, {
        laneId: context.laneId,
        capabilities: context.capabilities,
        send,
        jobScope: context.jobScope,
        connection: context,
      });
      audit(logger, "WORKER_AUTHENTICATED");
    }

    socket.on("message", (raw, isBinary) => {
      let packet;
      try {
        packet = decode(raw, { isBinary });
      } catch (error) {
        const version = error instanceof ClawError && error.code === "PROTO_VERSION_MISMATCH";
        closeWith(socket, version ? CLOSE_CODES.VERSION : CLOSE_CODES.BAD_MESSAGE,
          version ? "PROTO_VERSION_MISMATCH" : "PROTO_BAD_MESSAGE");
        return;
      }
      if (context.state === HANDSHAKE_STATES.HELLO) {
        if (packet.t !== "hello") return failHandshake("WORKER_EXPECTED_HELLO");
        if (packet.mode === "auth") {
          context.workerId = packet.workerId;
          context.capabilities = packet.capabilities;
        }
        startAuthentication(packet);
        return;
      }
      if (context.state === HANDSHAKE_STATES.AUTH) {
        if (["auth", "job"].includes(context.mode) && packet.t === "auth") {
          void authenticate(packet).catch(() => failHandshake("WORKER_AUTH_FAILED"));
          return;
        }
        if (context.mode === "enroll" && (packet.t === "auth" || packet.t === "enroll-auth")) {
          void enroll(packet).catch((error) => failHandshake(error?.code ?? "WORKER_ENROLL_FAILED"));
          return;
        }
        failHandshake("WORKER_EXPECTED_AUTH");
        return;
      }
      if (context.state !== HANDSHAKE_STATES.READY) return failHandshake("WORKER_BAD_STATE");
      if (registry.current(context.workerId) !== context) return;
      if (packet.t === "ack") {
        registry.onAck({ ...packet, workerId: context.workerId });
      } else if (packet.t === "event") {
        registry.onEvent({ ...packet, workerId: context.workerId });
      } else if (packet.t === "heartbeat") {
        const reports = registry.onHeartbeat({ workerId: context.workerId, leases: packet.leases });
        send(message("heartbeat", { ts: Date.now(), leases: reports }));
      } else if (packet.t === "bye") {
        socket.close(1000, packet.reason);
      } else failHandshake("WORKER_UNEXPECTED_MESSAGE", CLOSE_CODES.BAD_MESSAGE);
    });

    socket.on("close", () => {
      clearTimeout(context.timer);
      contexts.delete(context);
      if (context.workerId && context.state === HANDSHAKE_STATES.READY
        && registry.current(context.workerId) === context) {
        registry.disconnect(context.workerId, "SOCKET_CLOSED");
      }
    });
    socket.on("error", (error) => audit(logger, error?.code ?? "WS_ERROR"));
  }

  function close() {
    detachUpgrade?.();
    detachUpgrade = null;
    for (const context of contexts) {
      clearTimeout(context.timer);
      closeWith(context.socket, CLOSE_CODES.SHUTDOWN, "SERVER_SHUTDOWN");
    }
    contexts.clear();
    if (wss) {
      for (const client of wss.clients) client.close(CLOSE_CODES.SHUTDOWN, "SERVER_SHUTDOWN");
      wss.close();
      wss = null;
    }
  }

  return { attach, close };
}
