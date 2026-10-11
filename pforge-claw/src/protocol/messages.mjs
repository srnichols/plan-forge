import { LANE_EVENT_TYPES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1_048_576;
export const PUBLICATION_MESSAGE = "publication";
export const PUBLICATION_ACK_MESSAGE = "publication-ack";
export const PUBLICATION_FENCE_VERSION = 1;
export const PUBLICATION_OPERATIONS = Object.freeze({ BEGIN: "begin", END: "end" });
export const PUBLICATION_ERRORS = Object.freeze({
  DENIED: "LEASE_PUBLICATION_DENIED",
  TIMEOUT: "LEASE_PUBLICATION_TIMEOUT",
  CANCELLED: "LEASE_PUBLICATION_CANCELLED",
});
export const MESSAGE_TYPES = Object.freeze([
  "hello", "challenge", "auth", "enroll-auth", "ready", "lease", "ack", "event",
  "cancel", "heartbeat", "bye", "l2-applied", PUBLICATION_MESSAGE, PUBLICATION_ACK_MESSAGE,
]);
export const LEASE_KINDS = Object.freeze(["job", "read"]);
export const L2_PACKET_KIND = "l2-delta";
export const L2_APPLIED_MESSAGE = "l2-applied";
export const L2_ACK_ERRORS = Object.freeze({
  UNCONFIRMED: "L2_APPLY_UNCONFIRMED",
  TIMEOUT: "L2_APPLY_TIMEOUT",
  HOME_UNAVAILABLE: "L2_HOME_UNAVAILABLE",
  SCOPE: "L2_SCOPE_REJECTED",
  CANCELLED: "L2_APPLY_CANCELLED",
  BUFFER_FULL: "L2_EVENT_BUFFER_FULL",
});
export const READ_ERRORS = Object.freeze({
  FAILED: "READ_FAILED",
  TIMEOUT: "READ_TIMEOUT",
  CANCELLED: "READ_CANCELLED",
});
export const CLOSE_CODES = Object.freeze({
  BAD_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  REVOKED: 4403,
  VERSION: 4426,
  SHUTDOWN: 1001,
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string" && value.length > 0;
const isNonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0;
const isPositiveInt = (value) => Number.isSafeInteger(value) && value > 0;
const isHex64 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const exact = (object, required, optional = []) => isObject(object)
  && required.every((key) => Object.hasOwn(object, key))
  && Object.keys(object).every((key) => required.includes(key) || optional.includes(key));
const stringArray = (value) => Array.isArray(value) && value.every(isString);
const isIdentifier = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value);
const PUBLICATION_FIELDS = Object.freeze(["v", "t", "operation", "leaseId", "attempt", "jobId", "requestId"]);
const isErrorCode = (value) => typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value);

function validatePublicationIdentity(packet) {
  return Object.values(PUBLICATION_OPERATIONS).includes(packet.operation)
    && isString(packet.leaseId) && isPositiveInt(packet.attempt)
    && isIdentifier(packet.jobId) && isIdentifier(packet.requestId);
}

function validatePublicationAck(packet) {
  return exact(packet, [...PUBLICATION_FIELDS, "ok"], ["code"])
    && validatePublicationIdentity(packet) && typeof packet.ok === "boolean"
    && (packet.ok ? packet.code === undefined : isErrorCode(packet.code));
}

function validateCapabilities(value) {
  return exact(value, ["os", "arch", "macos", "toolchains", "projects"])
    && isString(value.os) && isString(value.arch) && typeof value.macos === "boolean"
    && stringArray(value.toolchains) && stringArray(value.projects);
}

function validateEvent(value) {
  return exact(value, ["v", "jobId", "seq", "ts", "type", "data"])
    && value.v === 1 && isString(value.jobId) && isPositiveInt(value.seq)
    && isString(value.ts) && Number.isFinite(Date.parse(value.ts))
    && LANE_EVENT_TYPES.includes(value.type) && isObject(value.data);
}

function validateLeaseResume(lease) {
  if (lease.seqBase !== undefined && !isNonNegativeInt(lease.seqBase)) return false;
  if (lease.lastSeq !== undefined && !isNonNegativeInt(lease.lastSeq)) return false;
  if (lease.resume !== undefined && typeof lease.resume !== "boolean") return false;
  return lease.seqBase === undefined || lease.lastSeq === undefined || lease.seqBase <= lease.lastSeq;
}

function validateLeasePayload(lease) {
  if (lease.kind === LEASE_KINDS[0]) {
    return Object.hasOwn(lease, "job") && !Object.hasOwn(lease, "request") && isObject(lease.job)
      && (lease.grant === undefined || isObject(lease.grant));
  }
  return Object.hasOwn(lease, "request") && !Object.hasOwn(lease, "job") && isObject(lease.request)
    && !Object.hasOwn(lease, "grant") && isString(lease.request.tool) && isObject(lease.request.args);
}

function validateLease(lease) {
  return exact(lease, ["v", "t", "leaseId", "attempt", "kind", "expiresAt"],
    ["job", "request", "grant", "seqBase", "resume", "lastSeq"])
    && isString(lease.leaseId) && isPositiveInt(lease.attempt) && LEASE_KINDS.includes(lease.kind)
    && Number.isFinite(lease.expiresAt) && validateLeaseResume(lease) && validateLeasePayload(lease);
}

function validPublicationFence(packet) {
  return !Object.hasOwn(packet, "publicationFence") || packet.publicationFence === PUBLICATION_FENCE_VERSION;
}

function validateAuthHello(packet) {
  return exact(packet, ["v", "t", "mode", "workerId", "laneId", "capabilities"], ["publicationFence"])
    && packet.mode === "auth" && isString(packet.workerId) && isString(packet.laneId)
    && validateCapabilities(packet.capabilities) && validPublicationFence(packet);
}

function validateJobHello(packet) {
  return exact(packet, ["v", "t", "mode", "laneId", "jobId"], ["publicationFence"])
    && packet.mode === "job" && isIdentifier(packet.laneId) && isIdentifier(packet.jobId)
    && validPublicationFence(packet);
}

function validateEnrollmentHello(packet) {
  return exact(packet, ["v", "t", "mode", "laneId", "codeId", "pub"])
    && packet.mode === "enroll" && isString(packet.laneId)
    && /^[0-9a-f]{8}$/.test(packet.codeId) && isString(packet.pub);
}

function validateReady(packet) {
  return (exact(packet, ["v", "t", "leaseMs", "heartbeatMs"], ["publicationFence"])
    && isPositiveInt(packet.leaseMs) && isPositiveInt(packet.heartbeatMs) && validPublicationFence(packet))
    || (exact(packet, ["v", "t", "workerId", "pub", "mac"])
      && isString(packet.workerId) && isString(packet.pub) && isHex64(packet.mac));
}

const validators = {
  hello: (m) => validateAuthHello(m) || validateJobHello(m) || validateEnrollmentHello(m),
  challenge: (m) => exact(m, ["v", "t", "nonce"]) && isHex64(m.nonce),
  auth: (m) => exact(m, ["v", "t", "workerId", "mac"])
    && typeof m.workerId === "string" && isHex64(m.mac),
  "enroll-auth": (m) => exact(m, ["v", "t", "mac"]) && isHex64(m.mac),
  ready: validateReady,
  lease: validateLease,
  ack: (m) => exact(m, ["v", "t", "leaseId", "attempt"], ["seqBase"])
    && isString(m.leaseId) && isPositiveInt(m.attempt)
    && (m.seqBase === undefined || isNonNegativeInt(m.seqBase)),
  event: (m) => exact(m, ["v", "t", "leaseId", "attempt", "event"])
    && isString(m.leaseId) && isPositiveInt(m.attempt) && validateEvent(m.event),
  cancel: (m) => (exact(m, ["v", "t", "jobId"]) && isString(m.jobId))
    || (exact(m, ["v", "t", "leaseId"]) && isString(m.leaseId)),
  heartbeat: (m) => exact(m, ["v", "t", "ts"], ["leases"])
    && Number.isFinite(m.ts) && (m.leases === undefined || (Array.isArray(m.leases)
      && m.leases.every((lease) => exact(lease, ["leaseId", "attempt", "lastSeq"])
        && isString(lease.leaseId) && isPositiveInt(lease.attempt) && isNonNegativeInt(lease.lastSeq)))),
  bye: (m) => exact(m, ["v", "t", "reason"]) && /^[A-Z0-9_]{1,64}$/.test(m.reason),
  [L2_APPLIED_MESSAGE]: (m) => exact(m,
    ["v", "t", "leaseId", "attempt", "jobId", "projectId", "deltaId", "sha256Total", "ok"], ["code"])
    && isString(m.leaseId) && isPositiveInt(m.attempt) && isIdentifier(m.jobId)
    && isIdentifier(m.projectId) && isString(m.deltaId) && isHex64(m.sha256Total)
    && typeof m.ok === "boolean" && (m.ok
      ? m.code === undefined : typeof m.code === "string" && /^[A-Z0-9_]{1,64}$/.test(m.code)),
  [PUBLICATION_MESSAGE]: (m) => exact(m, PUBLICATION_FIELDS) && validatePublicationIdentity(m),
  [PUBLICATION_ACK_MESSAGE]: validatePublicationAck,
};

function fail(field, type) {
  throw new ClawError("PROTO_BAD_MESSAGE", { t: type, field });
}

export function validateMessage(message) {
  if (!isObject(message)) fail("message", undefined);
  const type = message.t;
  if (!MESSAGE_TYPES.includes(type)) fail("t", type);
  if (message.v !== PROTOCOL_VERSION) {
    throw new ClawError("PROTO_VERSION_MISMATCH", { version: message.v });
  }
  if (!validators[type](message)) fail("shape", type);
  return message;
}

export function encode(message) {
  validateMessage(message);
  const encoded = JSON.stringify(message);
  if (Buffer.byteLength(encoded) > MAX_FRAME_BYTES) throw new ClawError("PROTOCOL_FRAME_TOO_LARGE");
  return encoded;
}

export function decode(raw, { isBinary = false } = {}) {
  if (isBinary) fail("binary", undefined);
  const size = Buffer.isBuffer(raw) ? raw.byteLength : Buffer.byteLength(String(raw));
  if (size > MAX_FRAME_BYTES) fail("size", undefined);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  let message;
  try {
    message = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("json", undefined);
  }
  return validateMessage(message);
}

export function message(type, fields = {}) {
  const result = { v: PROTOCOL_VERSION, t: type, ...fields };
  return validateMessage(result);
}
