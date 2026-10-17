import { describe, expect, it } from "vitest";
import { buildLeaseGrant, canonical, deriveJobKey, renewGrant, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";

const key = "fixture-grant-key";
const job = { id: "j1", projectId: "p1", type: "task", mutating: true, runtime: "copilot-sdk", prompt: "work" };
const proof = { kind: "consumed", ref: "approval1", decidedAt: 0 };
function signed(overrides = {}) {
  return signGrant({
    grant: buildLeaseGrant({ leaseJob: job, laneId: "pods", proof, now: 0, ...overrides }),
    subject: "job:j1", key,
  });
}
function verify(grant, options = {}) {
  return verifyGrant({ grant, job, subject: "job:j1", laneId: "pods", key, now: 1, ...options });
}

describe("lease grants", () => {
  it("isolates each per-job key by both job and lane", () => {
    const derive = (laneId, jobId) => deriveJobKey({ laneSecret: key, laneId, jobId });
    expect(new Set([derive("a", "j1"), derive("b", "j1"), derive("a", "j2")]).size).toBe(3);
    expect(derive("a", "j1")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("canonicalizes nested keys and drops undefined values", () => {
    expect(canonical({ z: undefined, b: [2, undefined, { z: 1, a: 2 }], a: 1 }))
      .toBe('{"a":1,"b":[2,{"a":2,"z":1}]}');
    expect(verify(signed())).toBe(true);
  });
  it("rejects a tampered job payload including its runtime", () => {
    for (const payload of [{ ...job, prompt: "tampered" }, { ...job, runtime: "byok:openai" }]) {
      expect(() => verify(signed(), { job: payload })).toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    }
  });
  it("rejects another subject even with the same key", () => {
    expect(() => verify(signed(), { subject: "job:j2" })).toThrowError(expect.objectContaining({ details: { reason: "SUBJECT" } }));
  });
  it("rejects an expired grant at the exact boundary", () => {
    expect(() => verify(signed(), { now: 300_000 })).toThrowError(expect.objectContaining({ details: { reason: "EXPIRED" } }));
  });
  it("rejects future-issued grants or an invalid verification clock without trusting the MAC alone", () => {
    expect(() => verify(signed({ now: 100 }), { now: 99 }))
      .toThrowError(expect.objectContaining({ details: { reason: "NOT_YET_VALID" } }));
    for (const now of [NaN, Infinity, -Infinity]) {
      expect(() => verify(signed(), { now }))
        .toThrowError(expect.objectContaining({ details: { reason: "CLOCK" } }));
    }
  });
  it("caps renewed grants at the job deadline without mutating approved digests or proofs", () => {
    const original = signed();
    const renewed = renewGrant({ grant: original, now: 310_000, deadlineMs: 315_000 });
    expect(renewed).toMatchObject({
      issuedAt: 310_000, exp: 315_000, jobDigest: original.jobDigest, approval: original.approval,
    });
    expect(original).toMatchObject({ issuedAt: 0, exp: 300_000, subject: "job:j1" });
    expect(verify(signGrant({ grant: renewed, subject: "job:j1", key }), { now: 310_000 })).toBe(true);
    expect(() => renewGrant({ grant: original, now: 315_000, deadlineMs: 315_000 }))
      .toThrowError(expect.objectContaining({ details: { reason: "EXPIRED" } }));
  });
  it("rejects a mutating job without approval proof", () => {
    expect(() => verify(signed({ proof: { kind: "read-only", ref: null, decidedAt: null } })))
      .toThrowError(expect.objectContaining({ details: { reason: "APPROVAL" } }));
    expect(() => verify(signed({ proof: { kind: "approved" } }))).toThrow();
  });
  it("permits the read-only skill exception only", () => {
    const skill = { ...job, type: "skill", mutating: false };
    const grant = signGrant({
      grant: buildLeaseGrant({ leaseJob: skill, laneId: "pods", now: 0, proof: { kind: "read-only", ref: null, decidedAt: null } }),
      subject: "job:j1", key,
    });
    expect(verify(grant, { job: skill })).toBe(true);
  });
  it("rejects malformed or short MACs without revealing credentials", () => {
    for (const mac of ["aa", "z".repeat(64), "a".repeat(64)]) {
      expect(() => verify({ ...signed(), mac })).toThrowError(expect.objectContaining({ details: { reason: "MAC" } }));
    }
  });
});
