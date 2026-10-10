import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { computeDelta, encodeDeltaChunks, L2_SYNC_INCOMPLETE, snapshotForge } from "../memory/l2-sync.mjs";
import { applicationIdentity, EMPTY_L2_DELTA, matchesApplicationAck } from "../protocol/l2-ack.mjs";
import { L2_ACK_ERRORS } from "../protocol/messages.mjs";

export const DEFAULT_HISTORY_TIMEOUT_MS = 30_000;

async function updateMarker({ job, worktree, pending, applicationAck }) {
  const markerPath = path.join(worktree, ".claw-job.json");
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    marker = { jobId: job.id, projectId: job.projectId };
  }
  if (marker.jobId !== job.id || marker.projectId !== job.projectId) {
    throw new ClawError("WORKSPACE_BAD_CONTRACT");
  }
  await writeFile(markerPath, JSON.stringify({
    ...marker, l2Pending: pending, ...(applicationAck ? { applicationAck } : {}),
  }));
}

/** Snapshot after bootstrap, marking the sole history copy as non-disposable. */
export async function beginJobHistory({ job, worktree }) {
  await updateMarker({ job, worktree, pending: true });
  return snapshotForge({ forgeDir: path.join(worktree, ".forge") });
}

async function waitForApplication(operation, { timeoutMs, signal }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ClawError("L2_MALFORMED");
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ClawError(L2_ACK_ERRORS.TIMEOUT)), timeoutMs);
        timer.unref?.();
        onAbort = () => reject(new ClawError("JOB_CANCELLED"));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Success requires the receiver's exact positive application identity, even for an empty delta.
 * @param {{job: object, worktree: string, snapshot: object, receiver: object, signal?: AbortSignal, timeoutMs?: number}} options
 * @returns {Promise<{identity: object, applicationAck: object}>}
 */
export async function synchronizeJobHistory({
  job, worktree, snapshot, receiver, signal, timeoutMs = DEFAULT_HISTORY_TIMEOUT_MS,
}) {
  if (signal?.aborted) throw new ClawError("JOB_CANCELLED");
  if (typeof receiver?.receive !== "function") {
    throw new ClawError(L2_ACK_ERRORS.HOME_UNAVAILABLE, { reason: L2_SYNC_INCOMPLETE });
  }
  const delta = await computeDelta({ forgeDir: path.join(worktree, ".forge"), snapshot }) ?? EMPTY_L2_DELTA;
  const chunks = encodeDeltaChunks({ delta, deltaId: job.id });
  const identity = applicationIdentity({
    jobId: job.id, projectId: job.projectId, deltaId: chunks[0].deltaId, sha256Total: chunks[0].sha256Total,
  });
  if (signal?.aborted) throw new ClawError("JOB_CANCELLED");
  const received = await waitForApplication(receiver.receive({ ...identity, chunks }, { signal }), { timeoutMs, signal });
  if (signal?.aborted) throw new ClawError("JOB_CANCELLED");
  if (!matchesApplicationAck(identity, received)) {
    throw new ClawError(L2_ACK_ERRORS.UNCONFIRMED, { reason: L2_SYNC_INCOMPLETE });
  }
  if (!received.ok) throw new ClawError(received.code, { reason: L2_SYNC_INCOMPLETE });
  const applicationAck = { ...identity, ok: true };
  await updateMarker({ job, worktree, pending: false, applicationAck });
  if (signal?.aborted) throw new ClawError("JOB_CANCELLED");
  return { identity, applicationAck };
}
