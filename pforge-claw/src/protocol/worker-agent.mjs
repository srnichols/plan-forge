import { execFile } from "node:child_process";
import {
  createHash, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { ClawError } from "../errors.mjs";
import { assertTransport, challenge, connectForever, enrollmentMac, mac, verifyEnrollmentMac } from "./auth.mjs";
import { createLaneEvent } from "../lanes/lane.mjs";
import {
  CLOSE_CODES, decode, encode, L2_APPLIED_MESSAGE, message, READ_ERRORS,
  PUBLICATION_MESSAGE, PUBLICATION_ACK_MESSAGE, PUBLICATION_ERRORS, PUBLICATION_OPERATIONS,
  PUBLICATION_FENCE_VERSION,
} from "./messages.mjs";
import { createWorkerL2 } from "./worker-l2.mjs";
import { LEASE_GRANT_INVALID } from "./lease-grant.mjs";

export { createL2Receiver } from "./l2-receiver.mjs";

const execFileAsync = promisify(execFile);
const PUBLICATION_TIMEOUT_MS = 10_000;

/**
 * @typedef {object} PublicationOptions
 * @property {object} job Verified current lease job.
 * @property {AbortSignal} [signal]
 * @typedef {object} PublicationScope
 * @property {AbortSignal} signal
 * @property {() => void} confirmSettled Trusted callback confirms every begun operation settled successfully.
 */

class WorkerPublicationAuthority {
  constructor({ send, leaseFor, setTimeoutFn, clearTimeoutFn, logger, timeoutMs = PUBLICATION_TIMEOUT_MS }) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ClawError(PUBLICATION_ERRORS.DENIED);
    Object.assign(this, { send, leaseFor, setTimeoutFn, clearTimeoutFn, logger, timeoutMs });
    this.pending = new Map();
    this.releases = new Map();
  }

  request(identity, operation, signal) {
    const key = `${identity.requestId}:${operation}`;
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (ack, error) => {
        this.clearTimeoutFn(timer);
        signal?.removeEventListener("abort", abort);
        this.pending.delete(key);
        if (error) reject(error);
        else resolve(ack);
      };
      const abort = () => finish(null, new ClawError(PUBLICATION_ERRORS.CANCELLED));
      const packet = message(PUBLICATION_MESSAGE, { ...identity, operation });
      this.pending.set(key, { identity, operation, finish });
      timer = this.setTimeoutFn(() => finish(null, new ClawError(PUBLICATION_ERRORS.TIMEOUT)), this.timeoutMs);
      timer?.unref?.();
      if (signal?.aborted) {
        finish(null, new ClawError(PUBLICATION_ERRORS.CANCELLED, { noReservation: true }));
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      try {
        if (!this.send(packet)) finish(null, new ClawError(PUBLICATION_ERRORS.DENIED, { noReservation: true }));
      } catch {
        finish(null, new ClawError(PUBLICATION_ERRORS.TIMEOUT));
      }
    });
  }

  onAck(packet) {
    const key = `${packet.requestId}:${packet.operation}`;
    const released = this.releases.get(packet.requestId);
    if (packet.operation === PUBLICATION_OPERATIONS.END && packet.ok && released
      && ["jobId", "leaseId", "attempt", "requestId"].every((field) => released[field] === packet[field])) {
      this.releases.delete(packet.requestId);
    }
    const pending = this.pending.get(key);
    if (!pending || !["jobId", "leaseId", "attempt", "requestId"].every(
      (field) => pending.identity[field] === packet[field],
    )) return false;
    pending.finish(packet, packet.ok ? null : new ClawError(packet.code, { noReservation: true }));
    return true;
  }

  replayReleased() {
    for (const identity of this.releases.values()) {
      try {
        this.send(message(PUBLICATION_MESSAGE, { ...identity, operation: PUBLICATION_OPERATIONS.END }));
      } catch (error) {
        this.logger.warn?.("Worker publication release replay failed", { code: getCode(error) });
      }
    }
  }

  async release(identity) {
    this.releases.set(identity.requestId, identity);
    await this.request(identity, PUBLICATION_OPERATIONS.END);
  }

  async releaseSettled(identity, failure) {
    if (failure?.details?.noReservation) return;
    try {
      await this.release(identity);
    } catch (error) {
      if (!failure) throw error;
      this.logger.warn?.("Worker publication release unconfirmed", { code: getCode(error) });
    }
  }

  async withPublication({ job, signal }, publish) {
    const lease = this.leaseFor(job);
    if (!lease || lease.publication || typeof publish !== "function") throw new ClawError(PUBLICATION_ERRORS.DENIED);
    const identity = {
      jobId: job.id, leaseId: lease.leaseId, attempt: lease.attempt, requestId: randomUUID(),
    };
    const scopedSignal = signal
      ? AbortSignal.any([signal, lease.authorityController.signal]) : lease.authorityController.signal;
    lease.publication = identity;
    let failure;
    let started = false;
    let confirmed = false;
    try {
      await this.request(identity, PUBLICATION_OPERATIONS.BEGIN, scopedSignal);
      scopedSignal.throwIfAborted();
      if (this.leaseFor(job) !== lease) throw new ClawError(PUBLICATION_ERRORS.DENIED);
      started = true;
      const published = await publish({ signal: scopedSignal, confirmSettled: () => { confirmed = true; } });
      if (!confirmed) throw new ClawError(PUBLICATION_ERRORS.DENIED, { reason: "settlement" });
      scopedSignal.throwIfAborted();
      return published;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // A lost ACK is uncertain ownership; only settled callbacks may send END.
      try {
        if (!started || confirmed) await this.releaseSettled(identity, failure);
      } finally {
        if (!started || confirmed) lease.publication = null;
      }
    }
  }
}

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

function newLease(packet, job) {
  const cleanup = Promise.withResolvers();
  return {
    ...packet, job, replay: [], sequence: packet.lastSeq ?? packet.seqBase ?? 0,
    completed: false, completedSeq: null, expiryTimer: null,
    authorityController: new AbortController(),
    readController: packet.kind === "read" ? new AbortController() : null,
    afterJobPromise: cleanup.promise, resolveAfterJob: cleanup.resolve,
  };
}

function verifiedLeaseJob(packet, verifyLease) {
  if (packet.kind !== "job") return null;
  const job = { ...packet.job, leaseGrant: packet.grant };
  const verified = verifyLease?.(job);
  if (verified === false) throw new ClawError(LEASE_GRANT_INVALID);
  if ((packet.grant?.leaseId !== undefined && packet.grant.leaseId !== packet.leaseId)
    || (packet.grant?.attempt !== undefined && packet.grant.attempt !== packet.attempt)) {
    throw new ClawError(LEASE_GRANT_INVALID);
  }
  return verified && typeof verified === "object" ? verified : job;
}

function findExistingLease({ active, packet }) {
  return [...active.values()].find((lease) => (
    packet.kind === "job"
      ? lease.kind === "job" && lease.job.id === packet.job.id
      : lease.kind === "read" && lease.request.requestId === packet.request?.requestId
  ));
}

function assertUnchangedLeaseChoices(existing, verified) {
  const previousDigest = existing?.job?.leaseGrant?.jobDigest;
  if (previousDigest && previousDigest !== verified?.leaseGrant?.jobDigest) throw new ClawError(LEASE_GRANT_INVALID);
}

function verifyWorkerLease({ packet, verifyLease, existing, publicationReady }) {
  const job = verifiedLeaseJob(packet, verifyLease);
  assertUnchangedLeaseChoices(existing, job);
  if (packet.kind === "job" && !publicationReady) throw new ClawError(PUBLICATION_ERRORS.DENIED, { reason: "unsupported-worker" });
  return job;
}

function openWorkerConnection({ ws, workerId, laneId, capabilities, jobScope, handlePacket, onDisconnect, logger }) {
  ws.send(encode(message("hello", jobScope
    ? { mode: "job", laneId, jobId: jobScope.jobId, publicationFence: PUBLICATION_FENCE_VERSION }
    : { mode: "auth", workerId, laneId, capabilities, publicationFence: PUBLICATION_FENCE_VERSION })));
  ws.on("message", (raw, isBinary) => {
    try {
      handlePacket(decode(raw, { isBinary }));
    } catch (error) {
      logger.warn?.("Worker protocol message rejected", { code: getCode(error) });
      ws.close(CLOSE_CODES.BAD_MESSAGE, "PROTO_BAD_MESSAGE");
    }
  });
  ws.on("close", () => onDisconnect(ws));
}

function cancelWorkerLease(lease, { history, localLane }) {
  if (!lease) return Promise.resolve();
  lease.authorityController.abort();
  if (lease.completed) return Promise.resolve();
  if (lease.kind === "read") {
    lease.readController.abort();
    return Promise.resolve();
  }
  lease.cancelled = true;
  history?.cancel(lease);
  lease.cancellation ??= Promise.resolve().then(() => localLane.cancel(lease.job.id));
  return lease.cancellation;
}

function syncWorkerHistory({ active, history, jobId, delta, deltaId }) {
  const lease = [...active.values()].find((item) => item.kind === "job" && item.job.id === jobId && !item.completed);
  if (!lease || !history) return Promise.reject(new ClawError("L2_WORKSPACE_MISSING"));
  return history.deliver(lease, delta, { deltaId });
}

function notifyWorkerCleanup(lease, { afterJob, logger }) {
  if (lease.cleanupStarted) return lease.afterJobPromise;
  lease.cleanupStarted = true;
  const cleanup = Promise.resolve().then(() => afterJob?.({
    job: lease.job, event: lease.replay.at(-1), applicationAck: lease.application?.ack ?? null,
  })).catch((error) => logger.error?.("Worker cleanup failed", { code: getCode(error) }));
  void cleanup.finally(() => lease.resolveAfterJob());
  return lease.afterJobPromise;
}

async function finishWorkerJob({ lease, history, terminal, snapshot, remember }) {
  if (history) return history.finish(lease, terminal, snapshot);
  remember(lease, lease.cancelled
    ? { ...terminal, data: { ...terminal.data, status: "cancelled" } } : terminal);
}

function ownsWorkerLease(lease, job) {
  return lease?.kind === "job" && lease.job.id === job.id && lease.attempt === job.leaseGrant.attempt
    && !lease.completed && !lease.cancelled && !lease.discarded && lease.expiresAt > Date.now();
}

async function runWorkerJob({ lease, history, localLane, remember, notifyAfterJob }) {
  try {
    const snap = history ? await history.snapshot(lease.job) : null;
    if (lease.cancelled) throw new ClawError("JOB_CANCELLED");
    let terminal;
    for await (const event of localLane.submit(lease.job)) {
      if (event.type === "finished") {
        terminal = event;
        break;
      }
      remember(lease, event);
    }
    if (terminal) await finishWorkerJob({ lease, history, terminal, snapshot: snap, remember });
  } catch (error) {
    remember(lease, createLaneEvent({
      jobId: lease.job.id, seq: (lease.replay.at(-1)?.seq ?? 0) + 1, type: "finished",
      data: { status: lease.cancelled ? "cancelled" : "failed", code: getCode(error) },
    }));
  } finally {
    lease.completed = lease.replay.at(-1)?.type === "finished";
    if (!lease.discarded) await notifyAfterJob(lease);
    else lease.resolveAfterJob();
  }
}

async function runWorkerRead({ lease, readHandler, remember }) {
  try {
    const result = await readHandler(lease.request, { signal: lease.readController.signal });
    if (lease.readController.signal.aborted) throw new ClawError(READ_ERRORS.CANCELLED);
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
    lease.resolveAfterJob();
  }
}

/**
 * Worker owns current lease cancellation and canonical ACK delivery.
 * `withPublication(PublicationOptions, async(PublicationScope) => value)` reserves
 * the complete publication window; unconfirmed operations quarantine ownership.
 */
export function createWorkerAgent({
  url, workerId, secret, laneId, capabilities, localLane, readHandler,
  allowInsecureLan = false, logger = console, WebSocketImpl = WebSocket,
  rand = Math.random, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
  heartbeatMs = 15_000, maxReplay = 1000, l2 = null,
  publicationTimeoutMs,
  jobScope, verifyLease, afterJob, onLeaseAcked, onPermanentClose,
} = {}) {
  const history = l2 ? createWorkerL2({ l2, maxReplay, remember, setTimeoutFn, clearTimeoutFn }) : null;
  const active = new Map();
  const running = new Set();
  let socket = null;
  let reconnect = null;
  let heartbeatTimer = null;
  let heartbeatPeriod = heartbeatMs;
  let leaseDuration = 60_000;
  let started = false;
  let stopped = false;
  let publicationReady = false;
  const publication = new WorkerPublicationAuthority({
    send, leaseFor, setTimeoutFn, clearTimeoutFn, logger, timeoutMs: publicationTimeoutMs,
  });
  const notifyAfterJob = (lease) => notifyWorkerCleanup(lease, { afterJob, logger });

  function leaseFor(job) {
    if (stopped || !publicationReady || !socket || socket.readyState !== socket.OPEN) return null;
    const lease = active.get(job?.leaseGrant?.leaseId);
    return ownsWorkerLease(lease, job) ? lease : null;
  }

  function send(packet) {
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(encode(packet));
      return true;
    }
    return false;
  }

  function remember(lease, event) {
    if (lease.discarded) return;
    const sequenced = { ...event, seq: ++lease.sequence };
    lease.replay.push(sequenced);
    if (lease.replay.length > maxReplay) lease.replay.shift();
    if (event.type === "finished") {
      lease.completed = true;
      lease.completedSeq = sequenced.seq;
    }
    send(message("event", {
      leaseId: lease.leaseId, attempt: lease.attempt, event: sequenced,
    }));
    if (event.type === "finished") send(message("heartbeat", {
      ts: Date.now(), leases: [{ leaseId: lease.leaseId, attempt: lease.attempt, lastSeq: sequenced.seq }],
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
      track(cancelWorkerLease(lease, { history, localLane }));
      finishLease(lease);
    }, remaining);
    lease.expiryTimer?.unref?.();
  }

  function rejectLease(packet, job, error) {
    for (const previous of active.values()) {
      if (previous.job?.id !== job.id) continue;
      previous.discarded = true;
      history?.cancel(previous);
      clearTimeoutFn(previous.expiryTimer);
      active.delete(previous.leaseId);
      previous.resolveAfterJob();
      if (!previous.completed) void localLane.cancel(job.id);
    }
    const lease = newLease(packet, job);
    active.set(lease.leaseId, lease);
    send(message("ack", { leaseId: lease.leaseId, attempt: lease.attempt, seqBase: lease.sequence }));
    remember(lease, createLaneEvent({
      jobId: job.id, seq: 1, type: "finished",
      data: { status: "failed", error: getCode(error) },
    }));
    track(notifyAfterJob(lease));
  }

  function track(task) {
    const tracked = Promise.resolve(task).catch(
      (error) => logger.error?.("Worker task settlement failed", { code: getCode(error) }),
    ).finally(() => running.delete(tracked));
    running.add(tracked);
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
      publication.replayReleased();
      scheduleHeartbeat();
    }, heartbeatPeriod);
    heartbeatTimer?.unref?.();
  }

  function handleLease(packet) {
    if (jobScope && (packet.kind !== "job" || packet.job.id !== jobScope.jobId)) {
      throw new ClawError("WORKER_JOB_MODE_DENIED");
    }
    const existing = findExistingLease({ active, packet });
    let leasedJob;
    try {
      leasedJob = verifyWorkerLease({ packet, verifyLease, existing, publicationReady });
    } catch (error) {
      logger.warn?.("Worker lease rejected", { code: getCode(error) });
      rejectLease(packet, { ...packet.job, leaseGrant: packet.grant }, error);
      return;
    }
    if (existing) {
      active.delete(existing.leaseId);
      clearTimeoutFn(existing.expiryTimer);
      existing.leaseId = packet.leaseId;
      existing.attempt = packet.attempt;
      existing.expiresAt = packet.expiresAt;
      existing.job = leasedJob ?? existing.job;
      active.set(existing.leaseId, existing);
      history?.rebind(existing);
      send(message("ack", { leaseId: existing.leaseId, attempt: existing.attempt }));
      armExpiry(existing);
      for (const event of existing.replay) {
        send(message("event", {
          leaseId: existing.leaseId, attempt: existing.attempt, event,
        }));
      }
      return;
    }
    const lease = newLease(packet, leasedJob);
    active.set(lease.leaseId, lease);
    send(message("ack", { leaseId: lease.leaseId, attempt: lease.attempt, seqBase: lease.sequence }));
    armExpiry(lease);
    track(lease.kind === "job"
      ? runWorkerJob({ lease, history, localLane, remember, notifyAfterJob })
      : runWorkerRead({ lease, readHandler, remember }));
  }

  function handleHeartbeat(packet) {
      const lastSeqByLease = new Map();
      for (const item of packet.leases ?? []) {
        const lease = active.get(item.leaseId);
        if (!lease || lease.attempt !== item.attempt) continue;
        lastSeqByLease.set(item.leaseId, item.lastSeq);
        if (lease.completed && item.lastSeq >= lease.completedSeq) {
          finishLease(lease);
          if (!lease.ackNotified) {
            lease.ackNotified = true;
            void lease.afterJobPromise.then(() => onLeaseAcked?.({
              job: lease.job, leaseId: lease.leaseId, attempt: lease.attempt, event: lease.replay.at(-1),
              applicationAck: lease.application?.ack ?? null,
            })).catch((error) => logger.error?.("Worker acknowledgement hook failed", { code: getCode(error) }));
          }
          continue;
        }
        lease.expiresAt = Date.now() + leaseDuration;
        armExpiry(lease);
      }
      replay(lastSeqByLease);
  }

  const leaseHandlers = {
    lease: handleLease,
    heartbeat: handleHeartbeat,
    [L2_APPLIED_MESSAGE]: (packet) => history?.onApplied(active.get(packet.leaseId), packet),
    [PUBLICATION_ACK_MESSAGE]: publication.onAck.bind(publication),
  };

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
      publicationReady = packet.publicationFence === PUBLICATION_FENCE_VERSION;
      scheduleHeartbeat();
      publication.replayReleased();
      return;
    }
    if (leaseHandlers[packet.t]) return leaseHandlers[packet.t](packet);
    if (packet.t === "cancel") {
      const lease = packet.leaseId ? active.get(packet.leaseId)
        : [...active.values()].find((item) => item.job?.id === packet.jobId);
      track(cancelWorkerLease(lease, { history, localLane }));
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
        publicationReady = false;
        openWorkerConnection({
          ws, workerId, laneId, capabilities, jobScope, handlePacket, logger,
          onDisconnect: (closedSocket) => {
            if (socket !== closedSocket) return;
            socket = null;
            for (const lease of active.values()) track(cancelWorkerLease(lease, { history, localLane }));
          },
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
      track(cancelWorkerLease(lease, { history, localLane }));
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
    isCurrentLease: (job) => Boolean(leaseFor(job)),
    withPublication: publication.withPublication.bind(publication),
    syncHistory: ({ jobId, delta, deltaId }) => syncWorkerHistory({ active, history, jobId, delta, deltaId }),
    start, stop, async drain() {
      while (running.size) await Promise.allSettled([...running]);
    },
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
