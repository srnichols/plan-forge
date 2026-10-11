import { createHash } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { L2_PACKET_KIND, L2_ACK_ERRORS } from "./messages.mjs";
import { CHUNK_RAW_BYTES, encodeDeltaChunks, L2_MAX_DELTA_BYTES, L2_ERROR_CODES } from "../memory/l2-sync.mjs";

const IDENTITY_FIELDS = Object.freeze(["jobId", "projectId", "deltaId", "sha256Total"]);
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
export const L2_MAX_CHUNKS = 1000;
const MAX_DELTA_ID_LENGTH = 256;
export const EMPTY_L2_DELTA = Object.freeze({
  files: Object.freeze([]), jsonl: Object.freeze({}), maps: Object.freeze({}),
});

export function applicationIdentity({ jobId, projectId, deltaId, sha256Total }) {
  if (typeof jobId !== "string" || !IDENTIFIER.test(jobId)
    || typeof projectId !== "string" || !IDENTIFIER.test(projectId)
    || typeof deltaId !== "string" || !deltaId || deltaId.length > MAX_DELTA_ID_LENGTH
    || typeof sha256Total !== "string" || !HEX_DIGEST.test(sha256Total)) {
    throw new ClawError(L2_ACK_ERRORS.SCOPE);
  }
  return { jobId, projectId, deltaId, sha256Total };
}

export function matchesApplicationAck(identity, ack) {
  return Boolean(ack && typeof ack.ok === "boolean" && IDENTITY_FIELDS.every((key) => ack[key] === identity[key])
    && (ack.ok ? ack.code === undefined : typeof ack.code === "string" && /^[A-Z0-9_]{1,64}$/.test(ack.code)));
}

/**
 * Wire lease binding is separate from the frozen application identity.
 * @param {{leaseId?: string, attempt?: number}|null|undefined} identity
 * @param {{leaseId?: string, attempt?: number}|null|undefined} ack
 * @returns {boolean}
 */
export function matchesLeaseAck(identity, ack) {
  return Boolean(identity && typeof identity.leaseId === "string" && identity.leaseId
    && Number.isSafeInteger(identity.attempt) && identity.attempt > 0
    && ack?.leaseId === identity.leaseId && ack.attempt === identity.attempt);
}

/** The checksum covers the canonical serialized delta, including a verified empty transfer. */
export function deltaApplicationIdentity({ jobId, projectId, deltaId = jobId, delta }) {
  const chunk = encodeDeltaChunks({ delta: delta ?? EMPTY_L2_DELTA, deltaId })[0];
  return applicationIdentity({ jobId, projectId, deltaId, sha256Total: chunk.sha256Total });
}

export function createApplicationTransfer({ jobId, projectId, chunk, maxChunks = L2_MAX_CHUNKS }) {
  const identity = applicationIdentity({
    jobId, projectId, deltaId: chunk?.deltaId, sha256Total: chunk?.sha256Total,
  });
  if (!Number.isSafeInteger(maxChunks) || maxChunks < 1 || maxChunks > L2_MAX_CHUNKS
    || !Number.isSafeInteger(chunk.total) || chunk.total < 1 || chunk.total > maxChunks) {
    throw new ClawError(L2_ERROR_CODES.DELTA_TOO_LARGE);
  }
  return { identity, total: chunk.total, chunks: new Map(), bytes: 0, ack: null, pending: null };
}

export function collectApplicationChunk(transfer, chunk) {
  if (!chunk || chunk.kind !== L2_PACKET_KIND || chunk.deltaId !== transfer.identity.deltaId
    || chunk.sha256Total !== transfer.identity.sha256Total || chunk.total !== transfer.total
    || !Number.isSafeInteger(chunk.index) || chunk.index < 0 || chunk.index >= transfer.total
    || typeof chunk.data !== "string" || !HEX_DIGEST.test(chunk.sha256Chunk ?? "")) {
    throw new ClawError(L2_ERROR_CODES.MALFORMED);
  }
  const bytes = Buffer.from(chunk.data, "base64");
  if (bytes.toString("base64") !== chunk.data
    || createHash("sha256").update(bytes).digest("hex") !== chunk.sha256Chunk) {
    throw new ClawError(L2_ERROR_CODES.CHECKSUM_MISMATCH);
  }
  const prior = transfer.chunks.get(chunk.index);
  if (prior) {
    if (prior.sha256Chunk !== chunk.sha256Chunk || prior.data !== chunk.data) throw new ClawError(L2_ERROR_CODES.CHUNK_DUP);
    return transfer.chunks.size === transfer.total;
  }
  if (bytes.byteLength > CHUNK_RAW_BYTES || transfer.bytes + bytes.byteLength > L2_MAX_DELTA_BYTES) {
    throw new ClawError(L2_ERROR_CODES.DELTA_TOO_LARGE);
  }
  transfer.chunks.set(chunk.index, structuredClone(chunk));
  transfer.bytes += bytes.byteLength;
  return transfer.chunks.size === transfer.total;
}
