/**
 * brain-recall.test.mjs — Tests for brain.recall()
 *
 * Covers: scope routing, freshness, fallback, L3 outage, key validation,
 * path-traversal guards, L2 route table.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { recall, remember, validateKey, BrainKeyError, _resetL1, describeKey } from "../brain.mjs";

function makeTempDir() {
  const dir = resolve(tmpdir(), `brain-recall-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("brain.recall", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTempDir();
    _resetL1();
  });
  afterEach(() => cleanup(tmpDir));

  // ── Scope: session (L1 only) ──

  it("scope session — reads L1 only, never touches L2/L3", async () => {
    const loadBug = () => { throw new Error("should not be called"); };
    const searchMemory = () => { throw new Error("should not be called"); };

    // Write to L1 first
    const runId = "run-001";
    remember("session.context", { mode: "auto" }, { runId, scope: "session" }, { cwd: tmpDir });

    const result = await recall("session.context", { runId }, { cwd: tmpDir, loadBug, searchMemory });
    expect(result).toEqual({ mode: "auto" });
  });

  it("scope session — returns null on L1 miss (no fallback)", async () => {
    const result = await recall("session.missing", { runId: "run-x" }, { cwd: tmpDir });
    expect(result).toBeNull();
  });

  // ── Scope: project (L2 first) ──

  it("scope project — reads L2, returns value", async () => {
    const readTemperingState = () => ({ totalScans: 5, stale: false });
    const result = await recall("project.tempering.state", {}, {
      cwd: tmpDir,
      readTemperingState,
    });
    expect(result).toEqual({ totalScans: 5, stale: false });
  });

  it("scope project — L2 miss with fallback l3 → calls L3", async () => {
    const searchMemory = async () => ({ content: "cross-run pattern" });
    const result = await recall("project.tempering.state", { fallback: "l3" }, {
      cwd: tmpDir,
      readTemperingState: () => null,
      searchMemory,
    });
    expect(result).toEqual({ content: "cross-run pattern" });
  });

  it("scope project — L2 miss with fallback none → returns null", async () => {
    const result = await recall("project.tempering.state", { fallback: "none" }, {
      cwd: tmpDir,
      readTemperingState: () => null,
    });
    expect(result).toBeNull();
  });

  it("scope project — L2 hit within freshness → returns L2 value (no L3 call)", async () => {
    const readTemperingState = () => ({ totalScans: 10 });
    const searchMemory = () => { throw new Error("should not call L3"); };

    const result = await recall("project.tempering.state", {
      freshnessMs: 60000,
      fallback: "l3",
    }, {
      cwd: tmpDir,
      readTemperingState,
      searchMemory,
    });
    expect(result).toEqual({ totalScans: 10 });
  });

  // ── Scope: cross-project (L3 only) ──

  it("scope cross-project — reads L3 only", async () => {
    const searchMemory = async () => ({ pattern: "auth-flow" });
    const result = await recall("cross.pattern.auth", { scope: "cross-project" }, {
      cwd: tmpDir,
      searchMemory,
    });
    expect(result).toEqual({ pattern: "auth-flow" });
  });

  it("scope cross-project — L3 unavailable → returns null", async () => {
    const result = await recall("cross.pattern.auth", { scope: "cross-project" }, {
      cwd: tmpDir,
      searchMemory: null,
    });
    expect(result).toBeNull();
  });

  // ── Key Validation ──

  it("rejects spaces → throws BrainKeyError", () => {
    expect(() => validateKey("project.bug .001")).toThrow(BrainKeyError);
  });

  it("rejects .. path traversal → throws BrainKeyError", () => {
    expect(() => validateKey("project.bug..001")).toThrow(BrainKeyError);
    expect(() => validateKey("project.bug.../../etc/passwd")).toThrow(BrainKeyError);
  });

  it("rejects unknown scope prefix → throws", () => {
    expect(() => validateKey("unknown.foo")).toThrow(BrainKeyError);
    expect(() => validateKey("admin.secret")).toThrow(BrainKeyError);
  });

  it("rejects empty key → throws", () => {
    expect(() => validateKey("")).toThrow(BrainKeyError);
    expect(() => validateKey(null)).toThrow(BrainKeyError);
    expect(() => validateKey(undefined)).toThrow(BrainKeyError);
  });

  it("accepts valid dotted path project.bug.BUG-001", () => {
    expect(() => validateKey("project.bug.BUG-001")).not.toThrow();
  });

  // ── L3 outage ──

  it("L3 outage — searchMemory throws → recall returns null (does not throw)", async () => {
    const searchMemory = async () => { throw new Error("OpenBrain down"); };
    const result = await recall("cross.pattern.auth", { scope: "cross-project" }, {
      cwd: tmpDir,
      searchMemory,
    });
    expect(result).toBeNull();
  });

  // ── L2 Route Table ──

  it("L2 route: project.bug.<id> → calls loadBug with correct args", async () => {
    const loadBug = (cwd, id) => {
      expect(cwd).toBe(tmpDir);
      expect(id).toBe("BUG-001");
      return { bugId: "BUG-001", title: "test bug" };
    };
    const result = await recall("project.bug.BUG-001", {}, { cwd: tmpDir, loadBug });
    expect(result).toEqual({ bugId: "BUG-001", title: "test bug" });
  });

  it("L2 route: project.review.<id> → calls readReviewItem", async () => {
    const readReviewItem = (cwd, id) => {
      expect(id).toBe("REV-001");
      return { itemId: "REV-001", status: "open" };
    };
    const result = await recall("project.review.REV-001", {}, { cwd: tmpDir, readReviewItem });
    expect(result).toEqual({ itemId: "REV-001", status: "open" });
  });

  it("L2 route: project.tempering.state → calls readTemperingState", async () => {
    const readTemperingState = (cwd) => {
      expect(cwd).toBe(tmpDir);
      return { totalScans: 42 };
    };
    const result = await recall("project.tempering.state", {}, { cwd: tmpDir, readTemperingState });
    expect(result).toEqual({ totalScans: 42 });
  });

  it("L2 route: project.run.<id> → calls findLatestRun", async () => {
    const findLatestRun = (cwd, id) => {
      expect(id).toBe("run-123");
      return { runDir: "/path/to/run", runId: "run-123" };
    };
    const result = await recall("project.run.run-123", {}, { cwd: tmpDir, findLatestRun });
    expect(result).toEqual({ runDir: "/path/to/run", runId: "run-123" });
  });

  // ── Return type guarantees ──

  it("returns parsed JSON objects, never raw buffers", async () => {
    const loadBug = () => ({ bugId: "B1", title: "test" });
    const result = await recall("project.bug.B1", {}, { cwd: tmpDir, loadBug });
    expect(typeof result).toBe("object");
    expect(result).not.toBeInstanceOf(Buffer);
  });

  // ── describeKey ──

  it("describeKey returns valid layout for session-scoped key", () => {
    const desc = describeKey("session.run.abc123");
    expect(desc.layout.scope).toBe("session");
    expect(desc.layout.entity).toBe("run");
    expect(desc.layout.id).toBe("abc123");
    expect(desc.examples.length).toBeGreaterThan(0);
  });

  it("describeKey returns valid layout for project-scoped key", () => {
    const desc = describeKey("project.bug.BUG-001");
    expect(desc.layout.scope).toBe("project");
    expect(desc.layout.entity).toBe("bug");
    expect(desc.layout.id).toBe("BUG-001");
    expect(desc.examples.length).toBeGreaterThan(0);
  });

  it("L2 route: project.hub-events → calls readHubEvents", async () => {
    const readHubEvents = (cwd, filters) => {
      expect(cwd).toBe(tmpDir);
      return [{ ts: "2026-01-01", source: "hub-event", event: "test" }];
    };
    const result = await recall("project.hub-events", {}, { cwd: tmpDir, readHubEvents });
    expect(result).toEqual([{ ts: "2026-01-01", source: "hub-event", event: "test" }]);
  });
});
