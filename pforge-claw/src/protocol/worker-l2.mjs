import path from "node:path";
import { ClawError } from "../errors.mjs";
import { createLaneEvent } from "../lanes/lane.mjs";
import {
  assembleDeltaChunks, computeDelta, encodeDeltaChunks, L2_ERROR_CODES, L2_SYNC_INCOMPLETE, snapshotForge,
} from "../memory/l2-sync.mjs";
import {
  applicationIdentity, collectApplicationChunk, createApplicationTransfer, EMPTY_L2_DELTA, matchesApplicationAck, matchesLeaseAck,
} from "./l2-ack.mjs";
import { L2_ACK_ERRORS } from "./messages.mjs";

const ACK_TIMEOUT_MS = 30_000;

function failureCode(error) {
  return error instanceof ClawError && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code : L2_ACK_ERRORS.UNCONFIRMED;
}

class WorkerHistory {
  constructor({ l2, remember, maxReplay, setTimeoutFn, clearTimeoutFn }) {
    this.forgeDirFor = l2.forgeDirFor ?? ((job) => path.join(job.worktree ?? process.cwd(), ".forge"));
    this.capture = l2.snapshot ?? snapshotForge;
    this.collect = l2.collect ?? computeDelta;
    this.encode = l2.encode ?? encodeDeltaChunks;
    this.ackTimeoutMs = l2.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    if (!Number.isFinite(this.ackTimeoutMs) || this.ackTimeoutMs <= 0) throw new ClawError(L2_ERROR_CODES.MALFORMED);
    Object.assign(this, { remember, maxReplay, setTimeoutFn, clearTimeoutFn });
  }

  snapshot(job) {
    return this.capture({ forgeDir: this.forgeDirFor(job) });
  }

  settle(lease, ack) {
    const transfer = lease.application;
    if (!transfer || transfer.ack || !matchesApplicationAck(transfer.identity, ack)) return false;
    transfer.ack = {
      ...transfer.identity, leaseId: ack.leaseId, attempt: ack.attempt,
      ok: ack.ok, ...(ack.ok ? {} : { code: ack.code }),
    };
    this.clearTimeoutFn(transfer.timer);
    transfer.resolve(transfer.ack);
    return true;
  }

  onApplied(lease, packet) {
    if (!lease || lease.leaseId !== packet.leaseId || lease.attempt !== packet.attempt) return false;
    return this.settle(lease, packet);
  }

  cancel(lease) {
    lease.cancelled = true;
    if (lease.application) this.settle(lease, {
      ...lease.application.identity, leaseId: lease.leaseId, attempt: lease.attempt,
      ok: false, code: L2_ACK_ERRORS.CANCELLED,
    });
  }

  startWaiting(lease, transfer) {
    this.clearTimeoutFn(transfer.timer);
    const waiting = Promise.withResolvers();
    Object.assign(transfer, { resolve: waiting.resolve, waiting: waiting.promise, timer: null });
    transfer.timer = this.setTimeoutFn(() => this.settle(lease, {
      ...transfer.identity, leaseId: lease.leaseId, attempt: lease.attempt,
      ok: false, code: L2_ACK_ERRORS.TIMEOUT,
    }), this.ackTimeoutMs);
    transfer.timer?.unref?.();
    if (lease.cancelled) this.cancel(lease);
  }

  rebind(lease) {
    const transfer = lease.application;
    if (lease.completed || !transfer?.ack || matchesLeaseAck(lease, transfer.ack)) return;
    if (transfer.ack.ok === false) {
      transfer.ack = { ...transfer.ack, leaseId: lease.leaseId, attempt: lease.attempt };
      transfer.waiting = Promise.resolve(transfer.ack);
      return;
    }
    transfer.ack = null;
    this.startWaiting(lease, transfer);
  }

  async waitForCurrentAck(lease, transfer) {
    while (true) {
      const ack = await transfer.waiting;
      if (matchesLeaseAck(lease, ack)) return ack;
    }
  }

  begin(lease, chunks) {
    const transfer = createApplicationTransfer({
      jobId: lease.job.id, projectId: lease.job.projectId, chunk: chunks[0], maxChunks: this.maxReplay,
    });
    for (const chunk of chunks) collectApplicationChunk(transfer, chunk);
    assembleDeltaChunks({ chunks: [...transfer.chunks.values()] });
    lease.application = transfer;
    this.startWaiting(lease, transfer);
    return transfer;
  }

  async deliver(lease, delta, { deltaId = lease.job.id } = {}) {
    const chunks = this.encode({ delta: delta ?? EMPTY_L2_DELTA, deltaId });
    const identity = applicationIdentity({
      jobId: lease.job.id, projectId: lease.job.projectId,
      deltaId: chunks[0]?.deltaId, sha256Total: chunks[0]?.sha256Total,
    });
    if (lease.application) {
      const matches = Object.keys(identity).every((key) => lease.application.identity[key] === identity[key]);
      if (matches) return this.waitForCurrentAck(lease, lease.application);
      if (lease.application.ack?.ok !== true) throw new ClawError(L2_ACK_ERRORS.SCOPE);
    }
    if (chunks.length + lease.replay.length + 1 > this.maxReplay) throw new ClawError(L2_ERROR_CODES.DELTA_TOO_LARGE);
    const transfer = this.begin(lease, chunks);
    for (const chunk of chunks) this.remember(lease, createLaneEvent({
      jobId: lease.job.id, seq: 1, type: "artifact", data: chunk,
    }));
    return this.waitForCurrentAck(lease, transfer);
  }

  async finish(lease, event, snapshot) {
    let terminalData;
    try {
      const deltaId = lease.application?.identity.deltaId ?? lease.job.id;
      const delta = await this.collect({ forgeDir: this.forgeDirFor(lease.job), snapshot, deltaId });
      const ack = await this.deliver(lease, delta, { deltaId });
      terminalData = {
        ...event.data,
        status: lease.cancelled ? "cancelled" : ack.ok ? event.data.status : "failed",
        ...(ack.ok ? {} : { reason: L2_SYNC_INCOMPLETE }),
        l2: { ...lease.application.identity, ok: ack.ok, ...(ack.ok ? {} : { code: ack.code }) },
      };
    } catch (error) {
      terminalData = {
        ...event.data, status: lease.cancelled ? "cancelled" : "failed",
        reason: L2_SYNC_INCOMPLETE, l2: { ok: false, code: failureCode(error) },
      };
    }
    this.remember(lease, createLaneEvent({
      jobId: lease.job.id, seq: 1, type: "finished", data: terminalData,
    }));
  }
}

/** Worker-side history delivery waits for application, never for transport receipt. */
export function createWorkerL2(options) {
  const history = new WorkerHistory(options);
  return {
    snapshot: history.snapshot.bind(history),
    finish: history.finish.bind(history),
    deliver: history.deliver.bind(history),
    onApplied: history.onApplied.bind(history),
    cancel: history.cancel.bind(history),
    rebind: history.rebind.bind(history),
  };
}
