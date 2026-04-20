/**
 * Plan Forge — Phase FORGE-SHOP-05 Slice 05.2: Timeline smoke tests.
 *
 * End-to-end tests through the timeline core with fixture data.
 * Tests the API-layer contract: time-window filtering, correlation grouping,
 * source filtering, truncation, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { timeline, clearTimelineCache } from "../timeline/core.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-timeline-smoke-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupForge(tmpDir) {
  mkdirSync(resolve(tmpDir, ".forge", "runs", "run-001"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "bugs"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "incidents"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "tempering"), { recursive: true });
}

function writeJsonl(filePath, records) {
  writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function isoAgo(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

let tmpDir;

beforeEach(() => {
  tmpDir = makeTmpDir();
  setupForge(tmpDir);
  clearTimelineCache();
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe("Timeline smoke tests", () => {
  it("returns events from multiple sources sorted by ts", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(2), type: "slice-completed", slice: 1, _correlationId: "run-001" },
      { timestamp: isoAgo(1), type: "run-completed", _correlationId: "run-001" },
    ]);
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1.5), type: "liveguard-drift", data: { score: 85 }, correlationId: "corr-abc" },
    ]);

    const result = await timeline({ from: "24h", groupBy: "time" }, { cwd: tmpDir });
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("truncated");
    expect(result.events.length).toBeGreaterThanOrEqual(2);
    // Events should be sorted by ts ascending
    for (let i = 1; i < result.events.length; i++) {
      expect(new Date(result.events[i].ts).getTime()).toBeGreaterThanOrEqual(
        new Date(result.events[i - 1].ts).getTime()
      );
    }
  });

  it("groupBy=correlation returns threads ordered by lastTs descending", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(3), type: "run-started", _correlationId: "old-corr" },
      { timestamp: isoAgo(0.5), type: "slice-completed", _correlationId: "new-corr" },
    ]);
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(2), type: "hub-ping", correlationId: "old-corr" },
      { timestamp: isoAgo(0.2), type: "hub-ping", correlationId: "new-corr" },
    ]);

    const result = await timeline({ from: "24h", groupBy: "correlation" }, { cwd: tmpDir });
    expect(result).toHaveProperty("threads");
    expect(result.threads.length).toBeGreaterThanOrEqual(2);
    // Threads sorted by most-recent lastTs descending
    for (let i = 1; i < result.threads.length; i++) {
      expect(new Date(result.threads[i].lastTs).getTime()).toBeLessThanOrEqual(
        new Date(result.threads[i - 1].lastTs).getTime()
      );
    }
    // Each thread has events sorted by ts ascending
    for (const thread of result.threads) {
      for (let i = 1; i < thread.events.length; i++) {
        expect(new Date(thread.events[i].ts).getTime()).toBeGreaterThanOrEqual(
          new Date(thread.events[i - 1].ts).getTime()
        );
      }
    }
  });

  it("correlationId filter returns only matching events", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(1), type: "slice-started", _correlationId: "target-corr" },
      { timestamp: isoAgo(0.5), type: "slice-completed", _correlationId: "target-corr" },
      { timestamp: isoAgo(0.3), type: "other-event", _correlationId: "other-corr" },
    ]);

    const result = await timeline({ from: "24h", correlationId: "target-corr", groupBy: "time" }, { cwd: tmpDir });
    expect(result.events.length).toBe(2);
    for (const evt of result.events) {
      expect(evt.correlationId).toBe("target-corr");
    }
  });

  it("source filtering returns only requested sources", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(1), type: "run-started", _correlationId: "r1" },
    ]);
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(0.5), type: "hub-ping", correlationId: "h1" },
    ]);

    const result = await timeline({ from: "24h", sources: ["run"], groupBy: "time" }, { cwd: tmpDir });
    expect(result.sourcesQueried).toEqual(["run"]);
    for (const evt of result.events) {
      expect(evt.source).toBe("run");
    }
  });

  it("truncation: limit enforced and truncated flag set", async () => {
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({ timestamp: isoAgo(i * 0.1), type: `evt-${i}`, _correlationId: "r1" });
    }
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), events);

    const result = await timeline({ from: "24h", limit: 5, groupBy: "time" }, { cwd: tmpDir });
    expect(result.events.length).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(10);
  });

  it("empty .forge/ directory returns zero events", async () => {
    const result = await timeline({ from: "24h", groupBy: "time" }, { cwd: tmpDir });
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("correlation deep-link: single correlationId with groupBy=correlation returns one thread", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(2), type: "run-started", _correlationId: "deep-link-corr" },
      { timestamp: isoAgo(1), type: "slice-completed", _correlationId: "deep-link-corr" },
      { timestamp: isoAgo(0.5), type: "other", _correlationId: "other-corr" },
    ]);

    const result = await timeline({ from: "24h", correlationId: "deep-link-corr", groupBy: "correlation" }, { cwd: tmpDir });
    expect(result.threads.length).toBe(1);
    expect(result.threads[0].correlationId).toBe("deep-link-corr");
    expect(result.threads[0].events.length).toBe(2);
  });

  it("invalid correlationId returns zero results (not an error)", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(1), type: "run-started", _correlationId: "real" },
    ]);

    const result = await timeline({ from: "24h", correlationId: "nonexistent", groupBy: "time" }, { cwd: tmpDir });
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("result includes windowFrom, windowTo, and sourcesQueried", async () => {
    const result = await timeline({ from: "1h", groupBy: "time" }, { cwd: tmpDir });
    expect(result).toHaveProperty("windowFrom");
    expect(result).toHaveProperty("windowTo");
    expect(result).toHaveProperty("sourcesQueried");
    expect(result.sourcesQueried.length).toBe(8);
  });
});
