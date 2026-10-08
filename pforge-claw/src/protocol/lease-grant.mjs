import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ClawError } from "../errors.mjs";

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
  throw new ClawError("LEASE_GRANT_INVALID", { reason });
}

export function verifyGrant({ grant, job, subject, laneId, key, expectJobId, now = Date.now }) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant) || grant.v !== 1
    || !IDENTIFIER.test(grant.jobId ?? "") || !IDENTIFIER.test(grant.projectId ?? "")
    || !IDENTIFIER.test(grant.laneId ?? "") || typeof grant.type !== "string"
    || typeof grant.mutating !== "boolean" || typeof grant.subject !== "string"
    || !HEX_DIGEST.test(grant.jobDigest ?? "") || !Number.isFinite(grant.issuedAt)
    || !Number.isFinite(grant.exp) || grant.exp <= grant.issuedAt
    || !grant.approval || typeof grant.approval !== "object" || !job) invalid("SHAPE");
  if (!HEX_DIGEST.test(grant.mac ?? "") || typeof key !== "string" || !key) invalid("MAC");
  const { mac, subject: signedSubject, ...unsigned } = grant;
  if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(grantMac(unsigned, signedSubject, key), "hex"))) invalid("MAC");
  if (signedSubject !== subject) invalid("SUBJECT");
  if (grant.laneId !== laneId) invalid("LANE");
  if (grant.jobId !== job.id || (expectJobId !== undefined && job.id !== expectJobId)) invalid("JOB");
  if (grant.jobDigest !== digest(job) || grant.projectId !== job.projectId
    || grant.type !== job.type || grant.mutating !== job.mutating) invalid("DIGEST");
  if (grant.exp <= (typeof now === "function" ? now() : now)) invalid("EXPIRED");
  const approval = grant.approval;
  if (approval.kind === "read-only") {
    if (job.type !== "skill" || job.mutating !== false) invalid("APPROVAL");
  } else if (!["consumed", "parent-consumed"].includes(approval.kind)
    || typeof approval.ref !== "string" || !approval.ref || approval.decidedAt == null) invalid("APPROVAL");
  return true;
}
