import { LANE_EVENT_TYPES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1_048_576;
export const MESSAGE_TYPES = Object.freeze([
  "hello", "challenge", "auth", "enroll-auth", "ready", "lease", "ack", "event",
  "cancel", "heartbeat", "bye",
]);
export const LEASE_KINDS = Object.freeze(["job", "read"]);
export const CLOSE_CODES = Object.freeze({
  BAD_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  REVOKED: 4403,
  VERSION: 4426,
  SHUTDOWN: 1001,
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string" && value.length > 0;
const isNonNegativeInt = (value) => Number.isInteger(value) && value >= 0;
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;
const isHex64 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const exact = (object, required, optional = []) => isObject(object)
  && required.every((key) => Object.hasOwn(object, key))
  && Object.keys(object).every((key) => required.includes(key) || optional.includes(key));
const stringArray = (value) => Array.isArray(value) && value.every(isString);

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

const validators = {
  hello: (m) => (exact(m, ["v", "t", "mode", "workerId", "laneId", "capabilities"])
    && m.mode === "auth" && isString(m.workerId) && isString(m.laneId) && validateCapabilities(m.capabilities))
    || (exact(m, ["v", "t", "mode", "laneId", "codeId", "pub"])
      && m.mode === "enroll" && isString(m.laneId) && /^[0-9a-f]{8}$/.test(m.codeId) && isString(m.pub)),
  challenge: (m) => exact(m, ["v", "t", "nonce"]) && isHex64(m.nonce),
  auth: (m) => exact(m, ["v", "t", "workerId", "mac"])
    && typeof m.workerId === "string" && isHex64(m.mac),
  "enroll-auth": (m) => exact(m, ["v", "t", "mac"]) && isHex64(m.mac),
  ready: (m) => (exact(m, ["v", "t", "leaseMs", "heartbeatMs"])
    && isPositiveInt(m.leaseMs) && isPositiveInt(m.heartbeatMs))
    || (exact(m, ["v", "t", "workerId", "pub", "mac"])
      && isString(m.workerId) && isString(m.pub) && isHex64(m.mac)),
  lease: (m) => {
    if (!exact(m, ["v", "t", "leaseId", "attempt", "kind", "expiresAt"], ["job", "request"])
      || !isString(m.leaseId) || !isPositiveInt(m.attempt) || !LEASE_KINDS.includes(m.kind)
      || !Number.isFinite(m.expiresAt)) return false;
    return m.kind === "job"
      ? Object.hasOwn(m, "job") && !Object.hasOwn(m, "request") && isObject(m.job)
      : Object.hasOwn(m, "request") && !Object.hasOwn(m, "job") && isObject(m.request)
        && isString(m.request.tool) && isObject(m.request.args);
  },
  ack: (m) => exact(m, ["v", "t", "leaseId", "attempt"])
    && isString(m.leaseId) && isPositiveInt(m.attempt),
  event: (m) => exact(m, ["v", "t", "leaseId", "attempt", "event"])
    && isString(m.leaseId) && isPositiveInt(m.attempt) && validateEvent(m.event),
  cancel: (m) => (exact(m, ["v", "t", "jobId"]) && isString(m.jobId))
    || (exact(m, ["v", "t", "leaseId"]) && isString(m.leaseId)),
  heartbeat: (m) => exact(m, ["v", "t", "ts"], ["leases"])
    && Number.isFinite(m.ts) && (m.leases === undefined || (Array.isArray(m.leases)
      && m.leases.every((lease) => exact(lease, ["leaseId", "attempt", "lastSeq"])
        && isString(lease.leaseId) && isPositiveInt(lease.attempt) && isNonNegativeInt(lease.lastSeq)))),
  bye: (m) => exact(m, ["v", "t", "reason"]) && /^[A-Z0-9_]{1,64}$/.test(m.reason),
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
  return JSON.stringify(message);
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
