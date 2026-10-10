import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ClawError } from "../errors.mjs";

export const LEASE_GRANT_INVALID = "LEASE_GRANT_INVALID";
const GRANT_TTL_MS = 300_000;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.filter((item) => item !== undefined).map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function deriveJobKey({ laneSecret, laneId, jobId }) {
  return createHmac("sha256", laneSecret)
    .update(`pforge-claw/job-key/v1\0${laneId}\0${jobId}`).digest("hex");
}

function digest(job) {
  const { leaseGrant, ...plain } = job;
  void leaseGrant;
  return createHash("sha256").update(canonical(plain)).digest("hex");
}

export function buildLeaseGrant({ leaseJob, laneId, proof, now = Date.now, ttlMs = GRANT_TTL_MS }) {
  const issuedAt = typeof now === "function" ? now() : now;
  return {
    v: 1, jobId: leaseJob.id, projectId: leaseJob.projectId, type: leaseJob.type,
    mutating: leaseJob.mutating, laneId, approval: proof,
    jobDigest: digest(leaseJob), issuedAt, exp: issuedAt + ttlMs,
  };
}

function grantMac(grant, subject, key) {
  return createHmac("sha256", key)
    .update(`pforge-claw/lease/v1\0${subject}\0${canonical(grant)}`).digest("hex");
}

export function signGrant({ grant, subject, key }) {
  const { subject: previousSubject, mac: previousMac, ...unsigned } = grant;
  void previousSubject;
  void previousMac;
  return { ...unsigned, subject, mac: grantMac(unsigned, subject, key) };
}

function invalid(reason) {
  throw new ClawError(LEASE_GRANT_INVALID, { reason });
}

function validateGrantShape(grant, job) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant) || grant.v !== 1 || !job) invalid("SHAPE");
  for (const name of ["jobId", "projectId", "laneId"]) {
    if (!IDENTIFIER.test(grant[name] ?? "")) invalid("SHAPE");
  }
  if (typeof grant.type !== "string" || typeof grant.mutating !== "boolean"
    || typeof grant.subject !== "string" || !HEX_DIGEST.test(grant.jobDigest ?? "")) invalid("SHAPE");
  if (!Number.isFinite(grant.issuedAt) || !Number.isFinite(grant.exp) || grant.exp <= grant.issuedAt
    || !grant.approval || typeof grant.approval !== "object" || Array.isArray(grant.approval)) invalid("SHAPE");
}

function validateGrantMac(grant, key) {
  if (!HEX_DIGEST.test(grant.mac ?? "") || typeof key !== "string" || !key) invalid("MAC");
  const { mac, subject: signedSubject, ...unsigned } = grant;
  if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(grantMac(unsigned, signedSubject, key), "hex"))) invalid("MAC");
}

function validateApproval(approval, job) {
  if (approval.kind === "read-only") {
    if (job.type !== "skill" || job.mutating !== false) invalid("APPROVAL");
  } else if (!["consumed", "parent-consumed"].includes(approval.kind)
    || typeof approval.ref !== "string" || !approval.ref || approval.decidedAt == null) invalid("APPROVAL");
}

/** Renew authorization metadata only; the approved digest and consumed proof remain unchanged. */
export function renewGrant({ grant, now = Date.now, deadlineMs } = {}) {
  const issuedAt = typeof now === "function" ? now() : now;
  const lifetime = grant?.exp - grant?.issuedAt;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(lifetime) || lifetime <= 0) invalid("SHAPE");
  const exp = deadlineMs === undefined ? issuedAt + lifetime : Math.min(issuedAt + lifetime, deadlineMs);
  if (!Number.isFinite(exp) || exp <= issuedAt) invalid("EXPIRED");
  const { mac, subject, ...unsigned } = grant;
  void mac;
  void subject;
  return { ...unsigned, issuedAt, exp };
}

export function verifyGrant({ grant, job, subject, laneId, key, expectJobId, now = Date.now }) {
  const timestamp = typeof now === "function" ? now() : now;
  if (!Number.isFinite(timestamp)) invalid("CLOCK");
  validateGrantShape(grant, job);
  validateGrantMac(grant, key);
  if (grant.subject !== subject) invalid("SUBJECT");
  if (grant.laneId !== laneId) invalid("LANE");
  if (grant.jobId !== job.id || (expectJobId !== undefined && job.id !== expectJobId)) invalid("JOB");
  if (grant.jobDigest !== digest(job) || grant.projectId !== job.projectId
    || grant.type !== job.type || grant.mutating !== job.mutating) invalid("DIGEST");
  if (grant.issuedAt > timestamp) invalid("NOT_YET_VALID");
  if (grant.exp <= timestamp) invalid("EXPIRED");
  validateApproval(grant.approval, job);
  return true;
}
