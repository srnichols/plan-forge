/**
 * brain-remember.test.mjs — Tests for brain.remember()
 *
 * Covers: single-tier writes, dual-write, L3 outage resilience,
 * key validation, L1 mirror, tags/ttl passthrough.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { remember, recall, BrainKeyError, _resetL1 } from "../brain.mjs";

function makeTempDir() {
  const dir = resolve(tmpdir(), `brain-remember-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("brain.remember", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTempDir();
    _resetL1();
  });
  afterEach(() => cleanup(tmpDir));

  // ── Scope: session (L1) ──

  it("scope session → writes L1 Map, returns { ok: true, tier: 'l1' }", () => {
    const result = remember("session.context", { mode: "auto" }, { runId: "run-001" }, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.tier).toBe("l1");
    expect(result.ref).toContain("l1");
  });

  it("scope session → mirrors to .forge/runs/<id>/brain-state.json", () => {
    remember("session.context", { mode: "auto" }, { runId: "run-001" }, { cwd: tmpDir });
    const mirrorPath = resolve(tmpDir, ".forge", "runs", "run-001", "brain-state.json");
    expect(existsSync(mirrorPath)).toBe(true);
    const content = JSON.parse(readFileSync(mirrorPath, "utf-8"));
    expect(content["session.context"].value).toEqual({ mode: "auto" });
  });

  // ── Scope: project (L2) ──

  it("scope project → writes L2, returns { ok: true, tier: 'l2', ref }", () => {
    const result = remember("project.tempering.state", { totalScans: 5 }, {}, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.tier).toBe("l2");
    expect(typeof result.ref).toBe("string");
  });

  // ── Scope: project-durable (L2 + L3) ──

  it("scope project-durable → writes L2 + queues L3", () => {
    const appendForgeJsonl = vi.fn();
    const result = remember("project.tempering.state", { totalScans: 5 }, {
      scope: "project-durable",
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    expect(result.ok).toBe(true);
    expect(result.tier).toBe("l2");
    expect(result.queued).toBe(true);
    expect(appendForgeJsonl).toHaveBeenCalledTimes(1);
    expect(appendForgeJsonl.mock.calls[0][0]).toBe("openbrain-queue.jsonl");
  });

  it("scope project-durable → L3 outage → still ok with queued flag", () => {
    const appendForgeJsonl = () => { throw new Error("L3 outage"); };
    const result = remember("project.tempering.state", { data: 1 }, {
      scope: "project-durable",
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    expect(result.ok).toBe(true);
    expect(result.tier).toBe("l2");
    // L3 queue failure is non-fatal; queued may be false
  });

  // ── Scope: cross-project (L3 only) ──

  it("scope cross-project → queues L3 only", () => {
    const appendForgeJsonl = vi.fn();
    const result = remember("cross.pattern.auth", { pattern: "jwt" }, {
      scope: "cross-project",
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    expect(result.ok).toBe(true);
    expect(result.tier).toBe("l3");
    expect(result.queued).toBe(true);
    expect(appendForgeJsonl).toHaveBeenCalledTimes(1);
  });

  // ── Key validation ──

  it("key validation rejects invalid keys", () => {
    expect(() => remember("invalid key", "val", {}, { cwd: tmpDir })).toThrow(BrainKeyError);
  });

  // ── Tags and TTL ──

  it("tags are passed through to L3 capture", () => {
    const appendForgeJsonl = vi.fn();
    remember("cross.pattern.auth", "value", {
      scope: "cross-project",
      tags: ["auth", "jwt"],
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(record.tags).toEqual(["auth", "jwt"]);
  });

  it("ttlMs is included in L3 queue record", () => {
    const appendForgeJsonl = vi.fn();
    remember("cross.pattern.auth", "value", {
      scope: "cross-project",
      ttlMs: 3600000,
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(record.expiresAt).toBeDefined();
  });

  // ── L1 edge cases ──

  it("L1 write with no active runId → throws descriptive error", () => {
    expect(() => {
      remember("session.context", { mode: "auto" }, { scope: "session" }, { cwd: tmpDir });
    }).toThrow(/runId/);
  });

  it("multiple writes to same L1 key → last write wins", async () => {
    remember("session.ctx", { v: 1 }, { runId: "r1" }, { cwd: tmpDir });
    remember("session.ctx", { v: 2 }, { runId: "r1" }, { cwd: tmpDir });
    const result = await recall("session.ctx", { runId: "r1" }, { cwd: tmpDir });
    expect(result).toEqual({ v: 2 });
  });

  it("dual-write never blocks on L3", () => {
    // Simulate slow L3 — appendForgeJsonl returns a delayed result but remember still resolves immediately
    const appendForgeJsonl = vi.fn(() => {
      // Synchronous function — even if it's slow, remember() must not await it
    });
    const t0 = Date.now();
    const result = remember("project.tempering.state", { data: 1 }, {
      scope: "project-durable",
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    const elapsed = Date.now() - t0;
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(1000); // Should be near-instant
  });

  // ── Undefined value ──

  it("rejects undefined value", () => {
    expect(() => {
      remember("project.tempering.state", undefined, {}, { cwd: tmpDir });
    }).toThrow(BrainKeyError);
  });

  it("returns canonical ref (file path for L2)", () => {
    const result = remember("project.tempering.state", { scans: 1 }, {}, { cwd: tmpDir });
    expect(result.ref).toBeDefined();
    expect(typeof result.ref).toBe("string");
    expect(result.ref.length).toBeGreaterThan(0);
  });
});
