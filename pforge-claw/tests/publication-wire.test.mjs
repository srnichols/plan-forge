import { describe, expect, it } from "vitest";
import * as protocol from "../src/protocol/messages.mjs";
import { applicationIdentity, matchesApplicationAck } from "../src/protocol/l2-ack.mjs";

const request = (operation = "begin") => ({
  v: 1, t: "publication", operation, leaseId: "lease-one",
  attempt: 1, jobId: "job-one", requestId: "request-one",
});
const ack = (ok = true, operation = "begin") => ({
  ...request(operation), t: "publication-ack", ok,
  ...(ok ? {} : { code: "LEASE_PUBLICATION_DENIED" }),
});

describe("Guard: publication authority has an exact bounded native wire contract", () => {
  it("exports one frozen operation and error vocabulary", () => {
    expect(protocol.PUBLICATION_MESSAGE).toBe("publication");
    expect(protocol.PUBLICATION_ACK_MESSAGE).toBe("publication-ack");
    expect(protocol.PUBLICATION_FENCE_VERSION).toBe(1);
    expect(protocol.PUBLICATION_OPERATIONS).toEqual({ BEGIN: "begin", END: "end" });
    expect(protocol.PUBLICATION_ERRORS).toEqual({
      DENIED: "LEASE_PUBLICATION_DENIED",
      TIMEOUT: "LEASE_PUBLICATION_TIMEOUT",
      CANCELLED: "LEASE_PUBLICATION_CANCELLED",
    });
    expect(Object.isFrozen(protocol.PUBLICATION_OPERATIONS)).toBe(true);
    expect(Object.isFrozen(protocol.PUBLICATION_ERRORS)).toBe(true);
    expect(protocol.MESSAGE_TYPES).toContain(protocol.PUBLICATION_MESSAGE);
    expect(protocol.MESSAGE_TYPES).toContain(protocol.PUBLICATION_ACK_MESSAGE);
  });

  it.each(["begin", "end"])("round-trips the exact %s request without serializing execution context", (operation) => {
    const packet = request(operation);
    expect(protocol.decode(protocol.encode(packet))).toEqual(packet);
  });

  it.each([[true, "begin"], [false, "begin"], [true, "end"], [false, "end"]])(
    "round-trips a typed acknowledgement ok=%s operation=%s",
    (ok, operation) => {
      const packet = ack(ok, operation);
      expect(protocol.decode(protocol.encode(packet))).toEqual(packet);
    },
  );

  it.each([
    { operation: "publish" }, { operation: "begin " }, { leaseId: "" },
    { attempt: 0 }, { attempt: -1 }, { attempt: 1.5 }, { attempt: Number.MAX_SAFE_INTEGER + 1 },
    { jobId: "" }, { jobId: "another job" }, { requestId: "" }, { requestId: "x".repeat(82) },
    { workerId: "forged-worker" }, { signal: {} }, { provider: {} }, { command: "git push" },
    { root: "outside" }, { ok: true },
  ])("rejects malformed or injected request fields %j", (fields) => {
    expect(() => protocol.encode({ ...request(), ...fields })).toThrowError("PROTO_BAD_MESSAGE");
  });

  it.each([
    { ok: "true" }, { ok: null }, { ok: true, code: "LEASE_PUBLICATION_DENIED" },
    { ok: false, code: undefined }, { ok: false, code: "" }, { ok: false, code: "raw private error" },
    { ok: false, code: "X".repeat(65) }, { operation: "publish" }, { attempt: 0 },
    { requestId: "" }, { workerId: "forged-worker" }, { signal: {} },
  ])("rejects malformed or secret-shaped acknowledgement fields %j", (fields) => {
    expect(() => protocol.encode({ ...ack(), ...fields })).toThrowError("PROTO_BAD_MESSAGE");
  });

  it("never treats a publication receipt as canonical history application proof", () => {
    const identity = applicationIdentity({
      jobId: "job-one", projectId: "project-one", deltaId: "delta-one", sha256Total: "a".repeat(64),
    });
    expect(matchesApplicationAck(identity, ack())).toBe(false);
    expect(matchesApplicationAck(identity, { ...identity, ok: true })).toBe(true);
  });
});

describe("Guard: v1 publication capability negotiation never implies legacy mutation authority", () => {
  const hello = (mode) => ({
    v: 1, t: "hello", mode, laneId: "lane-one",
    ...(mode === "job" ? { jobId: "job-one" } : {
      workerId: "worker-one",
      capabilities: { os: "fixture", arch: "fixture", macos: false, toolchains: [], projects: [] },
    }),
  });
  const ready = { v: 1, t: "ready", leaseMs: 60_000, heartbeatMs: 15_000 };

  it.each(["auth", "job"])("keeps legacy %s HELLO valid but requires exact explicit support when supplied", (mode) => {
    const legacy = hello(mode);
    expect(protocol.decode(protocol.encode(legacy))).toEqual(legacy);
    const capable = { ...legacy, publicationFence: 1 };
    expect(protocol.decode(protocol.encode(capable))).toEqual(capable);
  });

  it("keeps legacy READY valid without inventing publication support", () => {
    expect(protocol.decode(protocol.encode(ready))).toEqual(ready);
    expect(protocol.decode(protocol.encode({ ...ready, publicationFence: 1 })))
      .toEqual({ ...ready, publicationFence: 1 });
  });

  it.each([0, 2, -1, 1.5, "1", true, null])("rejects a present unsupported negotiation value %s", (publicationFence) => {
    for (const packet of [hello("auth"), hello("job"), ready]) {
      expect(() => protocol.encode({ ...packet, publicationFence })).toThrowError("PROTO_BAD_MESSAGE");
    }
  });

  it("never widens enrollment packet shapes with mutation support", () => {
    expect(() => protocol.encode({
      v: 1, t: "hello", mode: "enroll", laneId: "lane-one", codeId: "12345678",
      pub: "public-fixture", publicationFence: 1,
    })).toThrowError("PROTO_BAD_MESSAGE");
    expect(() => protocol.encode({
      v: 1, t: "ready", workerId: "worker-one", pub: "public-fixture",
      mac: "a".repeat(64), publicationFence: 1,
    })).toThrowError("PROTO_BAD_MESSAGE");
  });
});
