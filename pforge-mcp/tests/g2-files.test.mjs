import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  appendForgeJsonl,
  readForgeJsonl,
  pruneForgeRuns,
  auditOrphanForgeFiles,
} from "../orchestrator.mjs";
import {
  shapeQueueRecord,
  nextBackoffTimestamp,
  applyDeliveryFailure,
  partitionByBackoff,
  buildDrainStatsRecord,
} from "../memory.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-g2-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("appendForgeJsonl — G2.2 schema versioning", () => {
  it("auto-stamps every record with _v: 1", () => {
    appendForgeJsonl("things.jsonl", { score: 90 }, tmpDir);
    appendForgeJsonl("things.jsonl", { score: 80 }, tmpDir);
    const records = readForgeJsonl("things.jsonl", [], tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0]._v).toBe(1);
    expect(records[1]._v).toBe(1);
    expect(records[0].score).toBe(90);
  });

  it("does not overwrite an existing _v on the record", () => {
    appendForgeJsonl("things.jsonl", { _v: 99, x: 1 }, tmpDir);
    const records = readForgeJsonl("things.jsonl", [], tmpDir);
    // The spread order in helper means caller's _v wins (record spread last)
    expect(records[0]._v).toBe(99);
  });
});

describe("appendForgeJsonl — G2.4 correlationId", () => {
  it("adds _correlationId when provided in opts", () => {
    appendForgeJsonl("things.jsonl", { score: 90 }, tmpDir, { correlationId: "run-abc" });
    const records = readForgeJsonl("things.jsonl", [], tmpDir);
    expect(records[0]._correlationId).toBe("run-abc");
  });

  it("omits _correlationId when not provided", () => {
    appendForgeJsonl("things.jsonl", { score: 90 }, tmpDir);
    const records = readForgeJsonl("things.jsonl", [], tmpDir);
    expect(records[0]._correlationId).toBeUndefined();
  });
});

describe("readForgeJsonl — G2.1 backward-compat shim", () => {
  it("falls back to legacy .json file when .jsonl is absent", () => {
    // Simulate v2.35 project: only the .json variant exists
    mkdirSync(resolve(tmpDir, ".forge"), { recursive: true });
    writeFileSync(
      resolve(tmpDir, ".forge", "drift-history.json"),
      JSON.stringify({ score: 95 }) + "\n" + JSON.stringify({ score: 85 }) + "\n"
    );
    const records = readForgeJsonl("drift-history.jsonl", [], tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0].score).toBe(95);
  });

  it("prefers .jsonl when both exist", () => {
    mkdirSync(resolve(tmpDir, ".forge"), { recursive: true });
    writeFileSync(resolve(tmpDir, ".forge", "drift-history.json"), JSON.stringify({ score: 50 }) + "\n");
    writeFileSync(resolve(tmpDir, ".forge", "drift-history.jsonl"), JSON.stringify({ score: 90 }) + "\n");
    const records = readForgeJsonl("drift-history.jsonl", [], tmpDir);
    expect(records[0].score).toBe(90);
  });

  it("returns defaultValue when neither variant exists", () => {
    expect(readForgeJsonl("drift-history.jsonl", [], tmpDir)).toEqual([]);
    expect(readForgeJsonl("drift-history.jsonl", null, tmpDir)).toBeNull();
  });
});

describe("pruneForgeRuns — G2.3", () => {
  function makeRunDir(name, ageMs = 0) {
    const dir = resolve(tmpDir, ".forge", "runs", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "events.log"), "[2024-01-01] x: {}\n");
    if (ageMs > 0) {
      const t = (Date.now() - ageMs) / 1000;
      utimesSync(dir, t, t);
    }
  }

  it("returns empty when runs directory doesn't exist", () => {
    const result = pruneForgeRuns(tmpDir);
    expect(result.kept).toEqual([]);
    expect(result.pruned).toEqual([]);
  });

  it("prunes by maxRuns — newest N kept", () => {
    for (let i = 0; i < 5; i++) makeRunDir(`2024-01-0${i + 1}T00-00-00`);
    const result = pruneForgeRuns(tmpDir, { maxRuns: 3, maxAgeDays: 365 });
    expect(result.kept).toHaveLength(3);
    expect(result.pruned).toHaveLength(2);
    // Pruned should be the oldest two
    expect(result.pruned).toContain("2024-01-01T00-00-00");
    expect(result.pruned).toContain("2024-01-02T00-00-00");
  });

  it("prunes by maxAgeDays", () => {
    makeRunDir("2024-01-01T00-00-00");                             // newest, never pruned
    makeRunDir("2023-01-01T00-00-00", 60 * 24 * 60 * 60 * 1000);   // 60 days old
    const result = pruneForgeRuns(tmpDir, { maxRuns: 100, maxAgeDays: 30 });
    expect(result.pruned).toEqual(["2023-01-01T00-00-00"]);
  });

  it("dryRun reports without deleting", () => {
    makeRunDir("a");
    makeRunDir("b");
    makeRunDir("c");
    const result = pruneForgeRuns(tmpDir, { maxRuns: 1, maxAgeDays: 365, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.pruned.length).toBeGreaterThan(0);
    // Files still exist
    expect(existsSync(resolve(tmpDir, ".forge", "runs", "a"))).toBe(true);
  });

  it("always keeps the newest run regardless of age", () => {
    makeRunDir("2020-01-01T00-00-00", 1000 * 24 * 60 * 60 * 1000); // 1000 days old
    const result = pruneForgeRuns(tmpDir, { maxRuns: 100, maxAgeDays: 1 });
    expect(result.kept).toEqual(["2020-01-01T00-00-00"]);
    expect(result.pruned).toEqual([]);
  });
});

describe("auditOrphanForgeFiles — G2.5", () => {
  it("returns empty when .forge does not exist", () => {
    const result = auditOrphanForgeFiles(tmpDir);
    expect(result.known).toEqual([]);
    expect(result.orphan).toEqual([]);
    expect(result.whitelist).toBeInstanceOf(Array);
  });

  it("classifies known files vs orphans", () => {
    const dir = resolve(tmpDir, ".forge");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "incidents.jsonl"), "");
    writeFileSync(resolve(dir, "drift-history.jsonl"), "");
    writeFileSync(resolve(dir, "mystery-file.json"), ""); // orphan
    mkdirSync(resolve(dir, "runs"));                      // known dir
    mkdirSync(resolve(dir, "weird-dir"));                 // orphan dir

    const result = auditOrphanForgeFiles(tmpDir);
    expect(result.known).toContain("incidents.jsonl");
    expect(result.known).toContain("drift-history.jsonl");
    expect(result.known).toContain("runs/");
    expect(result.orphan).toContain("mystery-file.json");
    expect(result.orphan).toContain("weird-dir/");
  });

  it("legacy .json variants are still on the whitelist", () => {
    const dir = resolve(tmpDir, ".forge");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "drift-history.json"), "");      // legacy name
    writeFileSync(resolve(dir, "regression-history.json"), "");
    const result = auditOrphanForgeFiles(tmpDir);
    expect(result.orphan).not.toContain("drift-history.json");
    expect(result.orphan).not.toContain("regression-history.json");
  });
});

describe("shapeQueueRecord — G2.6", () => {
  it("stamps a fresh queue record with bookkeeping fields", () => {
    const r = shapeQueueRecord({ content: "hi", type: "lesson", source: "forge_drift_report" });
    expect(r._v).toBe(1);
    expect(r._status).toBe("pending");
    expect(r._attempts).toBe(0);
    expect(r._enqueuedAt).toBeDefined();
    expect(r._nextAttemptAt).toBeDefined();
    expect(r.content).toBe("hi");
    expect(r.source).toBe("forge_drift_report");
  });
});

describe("nextBackoffTimestamp — G2.6 exponential backoff", () => {
  it("attempt 1 is around 30s out", () => {
    const now = Date.now();
    const next = Date.parse(nextBackoffTimestamp(1, now));
    const delta = next - now;
    expect(delta).toBeGreaterThanOrEqual(30_000 * 0.8);
    expect(delta).toBeLessThanOrEqual(30_000 * 1.2);
  });

  it("attempt 4 is around 240s out (exponential)", () => {
    const now = Date.now();
    const next = Date.parse(nextBackoffTimestamp(4, now));
    const delta = next - now;
    expect(delta).toBeGreaterThanOrEqual(240_000 * 0.8);
    expect(delta).toBeLessThanOrEqual(240_000 * 1.2);
  });
});

describe("applyDeliveryFailure — G2.6 retry vs DLQ", () => {
  it("returns retry with bumped attempt count when under maxAttempts", () => {
    const rec = shapeQueueRecord({ content: "x" });
    const result = applyDeliveryFailure(rec, { maxAttempts: 5, error: "timeout" });
    expect(result.action).toBe("retry");
    expect(result.record._attempts).toBe(1);
    expect(result.record._status).toBe("pending");
    expect(result.record._lastError).toBe("timeout");
    expect(result.record._nextAttemptAt).toBeDefined();
  });

  it("returns dlq once attempts hit maxAttempts", () => {
    const rec = { ...shapeQueueRecord({ content: "x" }), _attempts: 4 };
    const result = applyDeliveryFailure(rec, { maxAttempts: 5, error: "permanent failure" });
    expect(result.action).toBe("dlq");
    expect(result.record._status).toBe("failed");
    expect(result.record._attempts).toBe(5);
    expect(result.record._failedAt).toBeDefined();
    expect(result.record._lastError).toBe("permanent failure");
  });

  it("truncates very long error messages", () => {
    const rec = shapeQueueRecord({ content: "x" });
    const longErr = "x".repeat(2000);
    const result = applyDeliveryFailure(rec, { error: longErr });
    expect(result.record._lastError.length).toBeLessThanOrEqual(500);
  });
});

describe("partitionByBackoff — G2.6", () => {
  it("ready vs deferred based on _nextAttemptAt", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const records = [
      { _status: "pending", _nextAttemptAt: past, content: "a" },
      { _status: "pending", _nextAttemptAt: future, content: "b" },
      { _status: "delivered", _nextAttemptAt: past, content: "c" },
      { _status: "failed", _nextAttemptAt: past, content: "d" },
    ];
    const { ready, deferred } = partitionByBackoff(records);
    expect(ready.map((r) => r.content)).toEqual(["a"]);
    expect(deferred.map((r) => r.content)).toEqual(["b"]);
  });

  it("handles empty / non-array input", () => {
    expect(partitionByBackoff(null)).toEqual({ ready: [], deferred: [] });
    expect(partitionByBackoff([])).toEqual({ ready: [], deferred: [] });
  });
});

describe("buildDrainStatsRecord — G2.8", () => {
  it("shapes a stats record with _v: 1 and timestamp", () => {
    const r = buildDrainStatsRecord({
      attempted: 10,
      delivered: 8,
      deferred: 1,
      dlq: 1,
      durationMs: 250,
    });
    expect(r._v).toBe(1);
    expect(r.timestamp).toBeDefined();
    expect(r.attempted).toBe(10);
    expect(r.delivered).toBe(8);
    expect(r.deferred).toBe(1);
    expect(r.dlq).toBe(1);
    expect(r.durationMs).toBe(250);
    expect(r.source).toBe("drain");
  });

  it("coerces missing numeric fields to 0", () => {
    const r = buildDrainStatsRecord({});
    expect(r.attempted).toBe(0);
    expect(r.delivered).toBe(0);
  });
});
