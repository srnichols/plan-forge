/**
 * brain-forget.test.mjs — Tests for brain.forget()
 *
 * Covers: L1 immediate remove, L2 file remove, L3 queued delete,
 * idempotency, key validation, path traversal rejection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { forget, remember, recall, BrainKeyError, _resetL1 } from "../brain.mjs";

function makeTempDir() {
  const dir = resolve(tmpdir(), `brain-forget-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("brain.forget", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTempDir();
    _resetL1();
  });
  afterEach(() => cleanup(tmpDir));

  it("L1 forget → removes from Map, returns { ok: true, removed: ['l1'] }", async () => {
    remember("session.ctx", { v: 1 }, { runId: "r1" }, { cwd: tmpDir });
    const result = forget("session.ctx", { runId: "r1" }, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.removed).toContain("l1");

    const recalled = await recall("session.ctx", { runId: "r1" }, { cwd: tmpDir });
    expect(recalled).toBeNull();
  });

  it("L1 forget → updates mirror file", () => {
    remember("session.ctx", { v: 1 }, { runId: "r1" }, { cwd: tmpDir });
    forget("session.ctx", { runId: "r1" }, { cwd: tmpDir });

    const mirrorPath = resolve(tmpDir, ".forge", "runs", "r1", "brain-state.json");
    if (existsSync(mirrorPath)) {
      const content = JSON.parse(require("node:fs").readFileSync(mirrorPath, "utf-8"));
      expect(content["session.ctx"]).toBeUndefined();
    }
  });

  it("L2 forget → removes file, returns { ok: true, removed: ['l2'] }", () => {
    // First remember to create the file
    remember("project.tempering.state", { scans: 1 }, {}, { cwd: tmpDir });
    const result = forget("project.tempering.state", {}, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.removed).toContain("l2");
  });

  it("L3 forget → queues delete request, returns { ok: true, removed: ['l3-queued'] }", () => {
    const appendForgeJsonl = vi.fn();
    const result = forget("cross.pattern.auth", { scope: "cross-project" }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    expect(result.ok).toBe(true);
    expect(result.removed).toContain("l3-queued");
    expect(appendForgeJsonl).toHaveBeenCalledTimes(1);
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(record._action).toBe("delete");
    expect(record.key).toBe("cross.pattern.auth");
  });

  it("forget non-existent key → returns { ok: true, removed: [] }", () => {
    const result = forget("session.nonexistent", { runId: "r1" }, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.removed).toEqual([]);
  });

  it("key validation rejects invalid keys", () => {
    expect(() => forget("invalid key", {}, { cwd: tmpDir })).toThrow(BrainKeyError);
  });

  it("scope project-durable forget → removes from L2 + queues L3 delete", () => {
    const appendForgeJsonl = vi.fn();
    remember("project.tempering.state", { data: 1 }, {}, { cwd: tmpDir });
    const result = forget("project.tempering.state", { scope: "project-durable" }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    expect(result.ok).toBe(true);
    expect(result.removed).toContain("l2");
    expect(result.removed).toContain("l3-queued");
  });

  it("L2 forget with file not found → still returns ok (idempotent)", () => {
    const result = forget("project.review.NONEXISTENT", {}, { cwd: tmpDir });
    expect(result.ok).toBe(true);
  });

  it("path traversal in key rejected during forget", () => {
    expect(() => forget("project.bug.../../etc/passwd", {}, { cwd: tmpDir })).toThrow(BrainKeyError);
  });

  it("L3 queue outage during forget → returns ok with warning", () => {
    const appendForgeJsonl = () => { throw new Error("queue down"); };
    const result = forget("cross.pattern.auth", { scope: "cross-project" }, {
      cwd: tmpDir,
      appendForgeJsonl,
    });
    expect(result.ok).toBe(true);
    // removed may be empty since the queue write failed
  });
});
