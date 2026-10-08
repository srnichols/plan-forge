import { execFile } from "node:child_process";
import {
  createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync,
} from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import { WebSocket } from "ws";
import { ClawError } from "../errors.mjs";
import { assertTransport, challenge, connectForever, enrollmentMac, mac, verifyEnrollmentMac } from "./auth.mjs";
import { createLaneEvent } from "../lanes/lane.mjs";
import { decode, encode, message } from "./messages.mjs";
import {
  applyDelta, computeDelta, encodeDeltaChunks, L2_ERROR_CODES, L2_SYNC_INCOMPLETE, snapshotForge,
} from "../memory/l2-sync.mjs";

const execFileAsync = promisify(execFile);

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

export async function enrollWorker({
  url, code, laneId, allowInsecureLan = false, logger = console,
  WebSocketImpl = WebSocket, setTimeoutFn = setTimeout,
} = {}) {
  assertTransport(url, { allowInsecureLan, warn: (codeName) => logger.warn?.(codeName) });
  if (typeof code !== "string" || !code || typeof laneId !== "string" || !laneId) {
    throw new ClawError("ENROLL_BAD_INPUT");
  }
  const codeHash = createHash("sha256").update(code).digest("hex");
  const pair = generateKeyPairSync("x25519");
  const publicWorker = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const ws = new WebSocketImpl(url);
  const timeout = new Promise((_, reject) => {
    const timer = setTimeoutFn(() => reject(new ClawError("WORKER_HANDSHAKE_TIMEOUT")), 10_000);
    timer?.unref?.();
    ws.once("close", () => clearTimeout(timer));
  });
  const result = new Promise((resolve, reject) => {
    let nonce = null;
    ws.once("open", () => ws.send(encode(message("hello", {
      mode: "enroll", laneId, codeId: codeHash.slice(0, 8), pub: publicWorker,
    }))));
    ws.on("message", (raw, isBinary) => {
      try {
        const packet = decode(raw, { isBinary });
        if (packet.t === "challenge") {
          nonce = packet.nonce;
          ws.send(encode(message("auth", {
            workerId: "", mac: enrollmentMac(codeHash, nonce, publicWorker),
          })));
          return;
        }
        if (packet.t !== "ready" || !nonce) throw new ClawError("WORKER_ENROLL_FAILED");
        if (!verifyEnrollmentMac(codeHash, packet.mac, nonce, packet.pub, packet.workerId)) {
          throw new ClawError("WORKER_ENROLL_PROOF_FAILED");
        }
        const serverPublic = createPublicKey({
          key: Buffer.from(packet.pub, "base64"), type: "spki", format: "der",
        });
        const secret = deriveSecret(pair.privateKey, serverPublic, codeHash, packet.workerId);
        resolve({ workerId: packet.workerId, secret });
        ws.close(1000, "ENROLLED");
      } catch (error) {
        reject(error instanceof ClawError ? error : new ClawError("WORKER_ENROLL_FAILED"));
        ws.close();
      }
    });
    ws.once("error", () => reject(new ClawError("WORKER_CONNECT_FAILED")));
    ws.once("close", (codeValue) => {
      if (codeValue !== 1000) reject(new ClawError("WORKER_ENROLL_FAILED"));
    });
  });
  try {
    return await Promise.race([result, timeout]);
  } finally {
    ws.close();
  }
}

function getCode(error) {
  return error instanceof ClawError ? error.code : "WORKER_FAILED";
}

export function createWorkerAgent({
  url, workerId, secret, laneId, capabilities, localLane, readHandler,
  allowInsecureLan = false, logger = console, WebSocketImpl = WebSocket,
  rand = Math.random, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
  heartbeatMs = 15_000, maxReplay = 1000, l2 = null,
  jobScope, verifyLease, afterJob, onLeaseAcked, onPermanentClose,
} = {}) {
  const l2Options = l2 ? {
    forgeDirFor: l2.forgeDirFor ?? ((job) => path.join(job.worktree ?? process.cwd(), ".forge")),
    snapshot: l2.snapshot ?? snapshotForge,
    collect: l2.collect ?? computeDelta,
    encode: l2.encode ?? encodeDeltaChunks,
    apply: l2.apply ?? applyDelta,
    forgeHome: l2.forgeHome,
  } : null;
  const active = new Map();
  const running = new Set();
  let socket = null;
  let reconnect = null;
  let heartbeatTimer = null;
  let heartbeatPeriod = heartbeatMs;
  let leaseDuration = 60_000;
  let started = false;
  let stopped = false;

  function send(packet) {
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(encode(packet));
      return true;
    }
    return false;
  }

  function remember(lease, event) {
    if (lease.discarded) return;
    lease.replay.push(event);
    if (lease.replay.length > maxReplay) lease.replay.shift();
    if (event.type === "finished") {
      lease.completed = true;
      lease.completedSeq = event.seq;
    }
    send(message("event", {
      leaseId: lease.leaseId, attempt: lease.attempt, event,
    }));
    if (event.type === "finished") send(message("heartbeat", {
      ts: Date.now(), leases: [{ leaseId: lease.leaseId, attempt: lease.attempt, lastSeq: event.seq }],
    }));
  }

  function finishLease(lease) {
    clearTimeoutFn(lease.expiryTimer);
    active.delete(lease.leaseId);
  }

  function armExpiry(lease) {
    clearTimeoutFn(lease.expiryTimer);
    const remaining = Math.max(0, lease.expiresAt - Date.now());
    lease.expiryTimer = setTimeoutFn(() => {
      if (!lease.completed && lease.kind === "job") void localLane.cancel(lease.job.id);
      finishLease(lease);
    }, remaining);
    lease.expiryTimer?.unref?.();
  }

  function notifyAfterJob(lease) {
    lease.afterJobPromise = Promise.resolve().then(() => afterJob?.({
      job: lease.job, event: lease.replay.at(-1),
    })).catch((error) => logger.error?.("Worker cleanup failed", { code: getCode(error) }));
  }

  function rejectLease(packet, job, error) {
    for (const previous of active.values()) {
      if (previous.job?.id !== job.id) continue;
      previous.discarded = true;
      clearTimeoutFn(previous.expiryTimer);
      active.delete(previous.leaseId);
      if (!previous.completed) void localLane.cancel(job.id);
    }
    const lease = { ...packet, job, replay: [], completed: false, expiryTimer: null };
    active.set(lease.leaseId, lease);
    send(message("ack", { leaseId: lease.leaseId, attempt: lease.attempt }));
    remember(lease, createLaneEvent({
      jobId: job.id, seq: 1, type: "finished",
      data: { status: "failed", error: getCode(error) },
    }));
    notifyAfterJob(lease);
  }

  async function emitL2Finished(lease, event, snap) {
    try {
      const forgeDir = l2Options.forgeDirFor(lease.job);
      const delta = await l2Options.collect({ forgeDir, snapshot: snap });
      const chunks = delta
        ? l2Options.encode({ delta, deltaId: lease.job.id })
        : [];
      if (chunks.length + lease.replay.length + 1 > maxReplay) {
        const finishedEvent = createLaneEvent({
          jobId: event.jobId,
          seq: (lease.replay.at(-1)?.seq ?? 0) + 1,
          type: "finished",
          data: {
            ...event.data,
            status: "failed",
            reason: L2_SYNC_INCOMPLETE,
            l2: { ok: false, code: L2_ERROR_CODES.DELTA_TOO_LARGE },
          },
        });
        remember(lease, finishedEvent);
        return;
      }
      let sequence = lease.replay.at(-1)?.seq ?? 0;
      for (const chunk of chunks) {
        remember(lease, createLaneEvent({
          jobId: event.jobId, seq: ++sequence, type: "artifact", data: chunk,
        }));
      }
      remember(lease, createLaneEvent({
        jobId: event.jobId,
        seq: sequence + 1,
        type: "finished",
        data: event.data,
      }));
    } catch (error) {
      remember(lease, createLaneEvent({
        jobId: event.jobId,
        seq: (lease.replay.at(-1)?.seq ?? 0) + 1,
        type: "finished",
        data: {
          ...event.data, status: "failed", reason: L2_SYNC_INCOMPLETE,
          l2: { ok: false, code: getCode(error) },
        },
      }));
    }
  }

  async function runJob(lease) {
    try {
      const forgeDir = l2Options?.forgeDirFor(lease.job);
      const snap = l2Options ? await l2Options.snapshot({ forgeDir }) : null;
      for await (const event of localLane.submit(lease.job)) {
        if (event.type === "finished" && l2Options) {
          await emitL2Finished(lease, event, snap);
          break;
        }
        remember(lease, event);
        if (event.type === "finished") break;
      }
    } catch (error) {
      const event = createLaneEvent({
        jobId: lease.job.id,
        seq: (lease.replay.at(-1)?.seq ?? 0) + 1,
        type: "finished",
        data: { status: "failed", code: getCode(error) },
      });
      remember(lease, event);
    } finally {
      lease.completed = lease.replay.at(-1)?.type === "finished";
      if (!lease.discarded) notifyAfterJob(lease);
    }
  }

  async function runRead(lease) {
    try {
      let result;
      if (lease.request.tool === "l2.apply" && l2Options?.apply) {
        const configuredHome = typeof l2Options.forgeHome === "function"
          ? l2Options.forgeHome(lease.request)
          : l2Options.forgeHome;
        if (typeof configuredHome !== "string" || typeof lease.request.args?.forgeHome !== "string"
          || path.resolve(lease.request.args.forgeHome) !== path.resolve(configuredHome)) {
          throw new ClawError("L2_PATH_REJECTED");
        }
        result = await l2Options.apply(lease.request.args);
      } else {
        result = await readHandler(lease.request);
      }
      remember(lease, createLaneEvent({
        jobId: lease.request.requestId ?? lease.leaseId,
        seq: 1, type: "finished", data: { status: "ok", result },
      }));
    } catch (error) {
      remember(lease, createLaneEvent({
        jobId: lease.request.requestId ?? lease.leaseId, seq: 1, type: "finished",
        data: { status: "failed", code: getCode(error) },
      }));
    } finally {
      lease.completed = lease.replay.at(-1)?.type === "finished";
    }
  }

  function replay(lastSeqByLease = new Map()) {
    for (const lease of active.values()) {
      const lastSeq = lastSeqByLease.get(lease.leaseId) ?? 0;
      for (const event of lease.replay) {
        if (event.seq > lastSeq) send(message("event", {
          leaseId: lease.leaseId, attempt: lease.attempt, event,
        }));
      }
    }
  }

  function scheduleHeartbeat() {
    clearTimeoutFn(heartbeatTimer);
    if (stopped) return;
    heartbeatTimer = setTimeoutFn(() => {
      const leases = [...active.values()].map((lease) => ({
        leaseId: lease.leaseId, attempt: lease.attempt,
        lastSeq: lease.replay.at(-1)?.seq ?? 0,
      }));
      send(message("heartbeat", { ts: Date.now(), leases }));
      scheduleHeartbeat();
    }, heartbeatPeriod);
    heartbeatTimer?.unref?.();
  }

  function handlePacket(packet) {
    if (packet.t === "challenge") {
      send(message("auth", { workerId, mac: mac(secret, packet.nonce, workerId) }));
      return;
    }
    if (packet.t === "ready") {
      if (!packet.leaseMs) return;
      reconnect?.resetBackoff();
      heartbeatPeriod = packet.heartbeatMs;
      leaseDuration = packet.leaseMs;
      scheduleHeartbeat();
      return;
    }
    if (packet.t === "lease") {
      if (jobScope && (packet.kind !== "job" || packet.job.id !== jobScope.jobId)) {
        throw new ClawError("WORKER_JOB_MODE_DENIED");
      }
      const leasedJob = packet.kind === "job" ? { ...packet.job, leaseGrant: packet.grant } : null;
      if (leasedJob) {
        try {
          verifyLease?.(leasedJob);
        } catch (error) {
          logger.warn?.("Worker lease rejected", { code: getCode(error) });
          rejectLease(packet, leasedJob, error);
          return;
        }
      }
      const requestId = packet.request?.requestId;
      const existing = [...active.values()].find((item) => (
        packet.kind === "job"
          ? item.kind === "job" && item.job.id === packet.job.id
          : item.kind === "read" && item.request.requestId === requestId
      ));
      if (existing) {
        active.delete(existing.leaseId);
        clearTimeoutFn(existing.expiryTimer);
        existing.leaseId = packet.leaseId;
        existing.attempt = packet.attempt;
        existing.expiresAt = packet.expiresAt;
        existing.job = leasedJob ?? existing.job;
        active.set(existing.leaseId, existing);
        send(message("ack", { leaseId: existing.leaseId, attempt: existing.attempt }));
        armExpiry(existing);
        for (const event of existing.replay) {
          send(message("event", {
            leaseId: existing.leaseId, attempt: existing.attempt, event,
          }));
        }
        return;
      }
      const lease = {
        leaseId: packet.leaseId, attempt: packet.attempt, kind: packet.kind,
        job: leasedJob, request: packet.request, expiresAt: packet.expiresAt,
        replay: [], expiryTimer: null, completed: false, completedSeq: null,
      };
      active.set(lease.leaseId, lease);
      send(message("ack", { leaseId: lease.leaseId, attempt: lease.attempt }));
      armExpiry(lease);
      const task = lease.kind === "job" ? runJob(lease) : runRead(lease);
      running.add(task);
      void task.finally(() => running.delete(task));
      return;
    }
    if (packet.t === "heartbeat") {
      const lastSeqByLease = new Map(packet.leases.map((item) => [item.leaseId, item.lastSeq]));
      for (const item of packet.leases) {
        const lease = active.get(item.leaseId);
        if (!lease || lease.attempt !== item.attempt) continue;
        if (lease.completed && item.lastSeq >= lease.completedSeq) {
          finishLease(lease);
          if (!lease.ackNotified) {
            lease.ackNotified = true;
            void Promise.resolve(lease.afterJobPromise).then(() => onLeaseAcked?.({
              job: lease.job, leaseId: lease.leaseId, attempt: lease.attempt, event: lease.replay.at(-1),
            })).catch((error) => logger.error?.("Worker acknowledgement hook failed", { code: getCode(error) }));
          }
          continue;
        }
        lease.expiresAt = Date.now() + leaseDuration;
        armExpiry(lease);
      }
      replay(lastSeqByLease);
      return;
    }
    if (packet.t === "cancel") {
      const lease = packet.leaseId ? active.get(packet.leaseId)
        : [...active.values()].find((item) => item.job?.id === packet.jobId);
      if (lease?.kind === "job") void localLane.cancel(lease.job.id);
      return;
    }
    if (packet.t === "bye") stop();
  }

  function start() {
    if (started) return reconnect;
    started = true;
    stopped = false;
    const warnTransport = (code) => logger.warn?.(code);
    assertTransport(url, { allowInsecureLan, warn: warnTransport });
    let firstAttempt = true;
    reconnect = connectForever({
      url, WebSocketImpl, rand, setTimeoutFn,
      beforeConnect: () => {
        if (firstAttempt) {
          firstAttempt = false;
          return;
        }
        assertTransport(url, { allowInsecureLan, warn: warnTransport });
      },
      onOpen: (ws) => {
        socket = ws;
        ws.send(encode(message("hello", jobScope
          ? { mode: "job", laneId, jobId: jobScope.jobId }
          : { mode: "auth", workerId, laneId, capabilities })));
        ws.on("message", (raw, isBinary) => {
          try {
            handlePacket(decode(raw, { isBinary }));
          } catch (error) {
            logger.warn?.("Worker protocol message rejected", { code: getCode(error) });
            ws.close(4400, "PROTO_BAD_MESSAGE");
          }
        });
      },
      onPermanentClose: (code) => {
        logger.warn?.("Worker connection permanently rejected", { code });
        stop();
        onPermanentClose?.(code);
      },
      onError: (code) => logger.warn?.("Worker connection error", { code }),
    });
    return reconnect;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeoutFn(heartbeatTimer);
    for (const lease of active.values()) {
      clearTimeoutFn(lease.expiryTimer);
      if (lease.kind === "job") void localLane.cancel(lease.job.id);
    }
    active.clear();
    if (socket && socket.readyState === socket.OPEN) {
      try {
        socket.send(encode(message("bye", { reason: "SHUTDOWN" })));
      } finally {
        socket.close(1000, "SHUTDOWN");
      }
    }
    reconnect?.stop();
  }

  return {
    start, stop, drain: () => Promise.allSettled([...running]),
    get activeLeases() { return active.size; },
  };
}

export async function detectCapabilities({ config, laneId, execFileFn = execFileAsync } = {}) {
  const toolchains = [];
  for (const [name, args] of [["node", ["--version"]], ["git", ["--version"]], ["gh", ["--version"]]]) {
    try {
      await execFileFn(name, args, { timeout: 5000, windowsHide: true });
      toolchains.push(name);
    } catch {
      continue;
    }
  }
  return {
    os: process.platform,
    arch: process.arch,
    macos: process.platform === "darwin",
    toolchains,
    projects: (config?.projects ?? []).filter((project) => project.homeLane === laneId).map((project) => project.id),
  };
}

export { challenge };
