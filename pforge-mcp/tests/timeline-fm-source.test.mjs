/**
 * Tests for the forge-master timeline source adapter.
 * Verifies that fm-session JSONL files are read, filtered, and deduplicated correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { timeline, clearTimelineCache } from "../timeline/core.mjs";
import { TIMELINE_SOURCES } from "../timeline/sources.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-fm-timeline-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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
  clearTimelineCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── forge-master source registration ────────────────────────────────

describe("forge-master TIMELINE_SOURCE", () => {
  it("is registered in TIMELINE_SOURCES", () => {
    expect(TIMELINE_SOURCES["forge-master"]).toBeDefined();
    expect(typeof TIMELINE_SOURCES["forge-master"].read).toBe("function");
  });
});

// ─── readForgeMasterSessions — basic read ─────────────────────────────

describe("forge-master source adapter — basic read", () => {
  it("returns empty array when fm-sessions dir missing", async () => {
    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.events).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("reads turns from a session file", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    writeJsonl(resolve(sessDir, "sess-abc.jsonl"), [
      { turn: 1, timestamp: isoAgo(1), userMessage: "how do I run tests?", classification: { lane: "operational" } },
      { turn: 2, timestamp: isoAgo(0.5), userMessage: "thank you", classification: { lane: "offtopic" } },
    ]);

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.total).toBe(2);
    expect(result.events[0].source).toBe("forge-master");
    expect(result.events[0].event).toBe("fm-turn");
    expect(result.events[0].correlationId).toBe("sess-abc");
    expect(result.events[0].payload.lane).toBe("operational");
    expect(result.events[0].payload.userMessage).toBe("how do I run tests?");
  });

  it("sets correlationId to sessionId (filename without extension)", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    writeJsonl(resolve(sessDir, "my.session.123.jsonl"), [
      { turn: 1, timestamp: isoAgo(1), userMessage: "ping", classification: "operational" },
    ]);

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.events[0].correlationId).toBe("my.session.123");
  });

  it("truncates userMessage to 200 chars", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    const longMsg = "x".repeat(300);
    writeJsonl(resolve(sessDir, "s1.jsonl"), [
      { turn: 1, timestamp: isoAgo(1), userMessage: longMsg },
    ]);

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.events[0].payload.userMessage.length).toBe(200);
  });

  it("handles string classification (non-object)", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    writeJsonl(resolve(sessDir, "s1.jsonl"), [
      { turn: 1, timestamp: isoAgo(1), userMessage: "hello", classification: "advisory" },
    ]);

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.events[0].payload.lane).toBe("advisory");
  });

  it("skips malformed lines without crashing", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(
      resolve(sessDir, "s1.jsonl"),
      [
        JSON.stringify({ turn: 1, timestamp: isoAgo(1), userMessage: "ok" }),
        "not-json",
        JSON.stringify({ turn: 2, timestamp: isoAgo(0.5), userMessage: "also ok" }),
      ].join("\n") + "\n",
    );

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.total).toBe(2);
  });
});

// ─── Deduplication across archive + active ────────────────────────────

describe("forge-master source adapter — rotation deduplication", () => {
  it("deduplicates turns that appear in both active and archive files", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    // Archive has turns 1-3; active has turns 2-4 (overlap at 2,3 simulates mid-rotation)
    writeJsonl(resolve(sessDir, "s1.archive.jsonl"), [
      { turn: 1, timestamp: isoAgo(3), userMessage: "first" },
      { turn: 2, timestamp: isoAgo(2.5), userMessage: "second" },
      { turn: 3, timestamp: isoAgo(2), userMessage: "third" },
    ]);
    writeJsonl(resolve(sessDir, "s1.jsonl"), [
      { turn: 2, timestamp: isoAgo(2.5), userMessage: "second" },
      { turn: 3, timestamp: isoAgo(2), userMessage: "third" },
      { turn: 4, timestamp: isoAgo(0.5), userMessage: "fourth" },
    ]);

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.total).toBe(4);
    const turns = result.events.map((e) => e.payload.turn).sort((a, b) => a - b);
    expect(turns).toEqual([1, 2, 3, 4]);
  });
});

// ─── Time-window filtering ────────────────────────────────────────────

describe("forge-master source adapter — time filtering", () => {
  it("excludes events outside the time window", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    writeJsonl(resolve(sessDir, "s1.jsonl"), [
      { turn: 1, timestamp: isoAgo(48), userMessage: "old" },
      { turn: 2, timestamp: isoAgo(1), userMessage: "recent" },
    ]);

    const result = await timeline({ from: "24h", sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.total).toBe(1);
    expect(result.events[0].payload.userMessage).toBe("recent");
  });

  it("includes events within an explicit from/to range", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    const t1 = new Date(Date.now() - 10 * 3_600_000).toISOString();
    const t2 = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const t3 = new Date(Date.now() - 1 * 3_600_000).toISOString();

    writeJsonl(resolve(sessDir, "s1.jsonl"), [
      { turn: 1, timestamp: t1, userMessage: "A" },
      { turn: 2, timestamp: t2, userMessage: "B" },
      { turn: 3, timestamp: t3, userMessage: "C" },
    ]);

    const from = new Date(Date.now() - 8 * 3_600_000).toISOString();
    const to = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const result = await timeline({ from, to, sources: ["forge-master"] }, { cwd: tmpDir });
    expect(result.total).toBe(1);
    expect(result.events[0].payload.userMessage).toBe("B");
  });
});

// ─── correlationId filtering ──────────────────────────────────────────

describe("forge-master source adapter — correlationId filtering", () => {
  it("returns only events for the specified correlationId", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    writeJsonl(resolve(sessDir, "sess-A.jsonl"), [
      { turn: 1, timestamp: isoAgo(1), userMessage: "from A" },
    ]);
    writeJsonl(resolve(sessDir, "sess-B.jsonl"), [
      { turn: 1, timestamp: isoAgo(1), userMessage: "from B" },
    ]);

    const result = await timeline(
      { from: "24h", sources: ["forge-master"], correlationId: "sess-A" },
      { cwd: tmpDir },
    );
    expect(result.total).toBe(1);
    expect(result.events[0].correlationId).toBe("sess-A");
  });
});

// ─── groupBy correlation ──────────────────────────────────────────────

describe("forge-master source adapter — groupBy correlation", () => {
  it("groups fm turns into threads by sessionId", async () => {
    const sessDir = resolve(tmpDir, ".forge", "fm-sessions");
    mkdirSync(sessDir, { recursive: true });

    writeJsonl(resolve(sessDir, "sess-X.jsonl"), [
      { turn: 1, timestamp: isoAgo(2), userMessage: "msg1" },
      { turn: 2, timestamp: isoAgo(1), userMessage: "msg2" },
    ]);

    const result = await timeline(
      { from: "24h", sources: ["forge-master"], groupBy: "correlation" },
      { cwd: tmpDir },
    );

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].correlationId).toBe("sess-X");
    expect(result.threads[0].events).toHaveLength(2);
  });
});
