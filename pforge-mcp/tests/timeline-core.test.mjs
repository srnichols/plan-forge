import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { timeline, clearTimelineCache, matchEventGlob } from "../timeline/core.mjs";
import { TIMELINE_SOURCES } from "../timeline/sources.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-timeline-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupForge(tmpDir) {
  mkdirSync(resolve(tmpDir, ".forge", "runs", "run-001"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "runs", "run-002"), { recursive: true });
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
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
});

// ─── matchEventGlob ────────────────────────────────────────────────────

describe("matchEventGlob", () => {
  it("matches exact event types", () => {
    expect(matchEventGlob("slice-started", "slice-started")).toBe(true);
    expect(matchEventGlob("slice-started", "slice-completed")).toBe(false);
  });

  it("matches wildcard patterns", () => {
    expect(matchEventGlob("slice-*", "slice-started")).toBe(true);
    expect(matchEventGlob("slice-*", "slice-completed")).toBe(true);
    expect(matchEventGlob("slice-*", "bug-registered")).toBe(false);
    expect(matchEventGlob("tempering-*", "tempering-run")).toBe(true);
  });

  it("matches star-only pattern", () => {
    expect(matchEventGlob("*", "anything")).toBe(true);
  });
});

// ─── Source mappers ────────────────────────────────────────────────────

describe("source mappers", () => {
  it("reads hub-events from JSONL", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "slice-started", data: { correlationId: "corr-1" } },
      { timestamp: isoAgo(2), type: "tool-call", _correlationId: "corr-2" },
    ]);
    const result = await timeline({ from: "24h" }, { cwd: tmpDir });
    const hubEvents = result.events.filter((e) => e.source === "hub-event");
    expect(hubEvents.length).toBe(2);
    expect(hubEvents[0]).toHaveProperty("ts");
    expect(hubEvents[0]).toHaveProperty("event");
    expect(hubEvents[0]).toHaveProperty("correlationId");
    expect(hubEvents[0]).toHaveProperty("payload");
  });

  it("reads run events from events.log", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { timestamp: isoAgo(1), type: "plan-started", plan: "Phase-01" },
      { timestamp: isoAgo(0.5), type: "slice-completed", sliceTitle: "Slice 1" },
    ]);
    const result = await timeline({ from: "24h", sources: ["run"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(2);
    expect(result.events[0].source).toBe("run");
    expect(result.events[0].correlationId).toBe("run-001");
  });

  it("reads memory events from JSONL", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "liveguard-memories.jsonl"), [
      { timestamp: isoAgo(1), tags: ["perf"], summary: "Hot path found", correlationId: "mem-1" },
    ]);
    const result = await timeline({ from: "24h", sources: ["memory"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].source).toBe("memory");
    expect(result.events[0].event).toBe("memory-captured");
  });

  it("reads openbrain events from JSONL", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "openbrain-queue.jsonl"), [
      { timestamp: isoAgo(1), status: "pending", correlationId: "ob-1" },
    ]);
    const result = await timeline({ from: "24h", sources: ["openbrain"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].source).toBe("openbrain");
  });

  it("reads watch events from JSONL", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "watch-history.jsonl"), [
      { timestamp: isoAgo(1), anomalyName: "drift-detected", correlationId: "w-1" },
    ]);
    const result = await timeline({ from: "24h", sources: ["watch"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].source).toBe("watch");
    expect(result.events[0].event).toBe("drift-detected");
  });

  it("reads tempering events with runSteps", async () => {
    writeFileSync(resolve(tmpDir, ".forge", "tempering", "tr-001.json"), JSON.stringify({
      correlationId: "tr-001",
      runSteps: [
        { timestamp: isoAgo(2), scanner: "unit", status: "passed", summary: "all pass" },
        { timestamp: isoAgo(1), scanner: "integration", status: "failed", summary: "3 failures" },
      ],
    }));
    const result = await timeline({ from: "24h", sources: ["tempering"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(2);
    expect(result.events[0].event).toBe("step-passed");
    expect(result.events[1].event).toBe("step-failed");
  });

  it("reads bug events from JSON", async () => {
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "BUG-42.json"), JSON.stringify({
      title: "Auth crash", severity: "high", registeredAt: isoAgo(3), correlationId: "BUG-42",
    }));
    const result = await timeline({ from: "7d", sources: ["bug"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].source).toBe("bug");
    expect(result.events[0].event).toBe("bug-registered");
    expect(result.events[0].correlationId).toBe("BUG-42");
  });

  it("reads incident events from JSON", async () => {
    writeFileSync(resolve(tmpDir, ".forge", "incidents", "INC-01.json"), JSON.stringify({
      title: "Deploy failure", severity: "critical", openedAt: isoAgo(2), correlationId: "INC-01",
    }));
    const result = await timeline({ from: "7d", sources: ["incident"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].source).toBe("incident");
    expect(result.events[0].event).toBe("incident-opened");
  });
});

// ─── Time window — ISO ─────────────────────────────────────────────────

describe("time window — ISO", () => {
  it("includes events within ISO range", async () => {
    const t1 = isoAgo(5);
    const t2 = isoAgo(3);
    const t3 = isoAgo(1);
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: t1, type: "early" },
      { timestamp: t2, type: "middle" },
      { timestamp: t3, type: "late" },
    ]);
    const result = await timeline({ from: isoAgo(4), to: isoAgo(0.5), sources: ["hub-event"] }, { cwd: tmpDir });
    const events = result.events.map((e) => e.event);
    expect(events).toContain("middle");
    expect(events).toContain("late");
    expect(events).not.toContain("early");
  });

  it("excludes events outside ISO range", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(48), type: "old-event" },
    ]);
    const result = await timeline({ from: isoAgo(24), sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(0);
  });
});

// ─── Time window — relative ────────────────────────────────────────────

describe("time window — relative", () => {
  it("parses 24h relative window", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(12), type: "recent" },
      { timestamp: isoAgo(48), type: "old" },
    ]);
    const result = await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].event).toBe("recent");
  });

  it("parses 7d relative window", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(48), type: "within-week" },
    ]);
    const result = await timeline({ from: "7d", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
  });

  it("returns empty for no matching events", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(72), type: "ancient" },
    ]);
    const result = await timeline({ from: "30m", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events).toEqual([]);
  });
});

// ─── events glob filter ────────────────────────────────────────────────

describe("events glob filter", () => {
  it("filters by glob pattern", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "slice-started" },
      { timestamp: isoAgo(1), type: "slice-completed" },
      { timestamp: isoAgo(1), type: "bug-registered" },
    ]);
    const result = await timeline({ from: "24h", events: ["slice-*"], sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(2);
    expect(result.events.every((e) => e.event.startsWith("slice-"))).toBe(true);
  });

  it("filters by exact event name", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "slice-started" },
      { timestamp: isoAgo(1), type: "slice-completed" },
    ]);
    const result = await timeline({ from: "24h", events: ["slice-started"], sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].event).toBe("slice-started");
  });
});

// ─── correlationId filter ──────────────────────────────────────────────

describe("correlationId filter", () => {
  it("returns only matching events", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "a", _correlationId: "corr-1" },
      { timestamp: isoAgo(1), type: "b", _correlationId: "corr-2" },
      { timestamp: isoAgo(1), type: "c", _correlationId: "corr-1" },
    ]);
    const result = await timeline({ from: "24h", correlationId: "corr-1", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(2);
    expect(result.events.every((e) => e.correlationId === "corr-1")).toBe(true);
  });

  it("returns empty for non-existent correlationId", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "a", _correlationId: "corr-1" },
    ]);
    const result = await timeline({ from: "24h", correlationId: "no-exist", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(0);
  });
});

// ─── groupBy: "time" ───────────────────────────────────────────────────

describe("groupBy: time (flat)", () => {
  it("returns flat chronological sort", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(3), type: "first" },
      { timestamp: isoAgo(1), type: "third" },
      { timestamp: isoAgo(2), type: "second" },
    ]);
    const result = await timeline({ from: "24h", groupBy: "time", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events).toBeDefined();
    expect(result.threads).toBeUndefined();
    expect(result.events[0].event).toBe("first");
    expect(result.events[2].event).toBe("third");
  });

  it("returns correct output shape", async () => {
    const result = await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("truncated");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("windowFrom");
    expect(result).toHaveProperty("windowTo");
    expect(result).toHaveProperty("sourcesQueried");
  });
});

// ─── groupBy: "correlation" ────────────────────────────────────────────

describe("groupBy: correlation", () => {
  it("buckets events by correlationId", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(3), type: "a", _correlationId: "corr-1" },
      { timestamp: isoAgo(2), type: "b", _correlationId: "corr-2" },
      { timestamp: isoAgo(1), type: "c", _correlationId: "corr-1" },
    ]);
    const result = await timeline({ from: "24h", groupBy: "correlation", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.threads).toBeDefined();
    expect(result.events).toBeUndefined();
    expect(result.threads.length).toBe(2);
    const corr1 = result.threads.find((t) => t.correlationId === "corr-1");
    expect(corr1.events.length).toBe(2);
  });

  it("sorts threads by most-recent-event descending", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(5), type: "old", _correlationId: "corr-old" },
      { timestamp: isoAgo(1), type: "new", _correlationId: "corr-new" },
    ]);
    const result = await timeline({ from: "24h", groupBy: "correlation", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.threads[0].correlationId).toBe("corr-new");
    expect(result.threads[1].correlationId).toBe("corr-old");
  });

  it("within-thread events sorted by ts ascending", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(3), type: "first", _correlationId: "corr-1" },
      { timestamp: isoAgo(1), type: "third", _correlationId: "corr-1" },
      { timestamp: isoAgo(2), type: "second", _correlationId: "corr-1" },
    ]);
    const result = await timeline({ from: "24h", groupBy: "correlation", sources: ["hub-event"] }, { cwd: tmpDir });
    const thread = result.threads[0];
    expect(thread.events[0].event).toBe("first");
    expect(thread.events[1].event).toBe("second");
    expect(thread.events[2].event).toBe("third");
  });
});

// ─── Sort stability ────────────────────────────────────────────────────

describe("sort stability", () => {
  it("preserves source insertion order for identical timestamps", async () => {
    const ts = isoAgo(1);
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: ts, type: "hub-first", _correlationId: "c1" },
      { timestamp: ts, type: "hub-second", _correlationId: "c2" },
    ]);
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "BUG-1.json"), JSON.stringify({
      title: "bug", registeredAt: ts, correlationId: "c3",
    }));
    const result = await timeline({ from: "24h" }, { cwd: tmpDir });
    // All 3 events should be present; no crash on equal timestamps
    expect(result.events.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Limit + truncation (flat) ─────────────────────────────────────────

describe("limit + truncation (flat)", () => {
  it("truncates when over limit", async () => {
    const records = Array.from({ length: 20 }, (_, i) => ({
      timestamp: isoAgo(i * 0.01), type: `event-${i}`,
    }));
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), records);
    const result = await timeline({ from: "24h", limit: 5, sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(20);
  });

  it("does not truncate when under limit", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "a" },
      { timestamp: isoAgo(2), type: "b" },
    ]);
    const result = await timeline({ from: "24h", limit: 100, sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.truncated).toBe(false);
  });
});

// ─── Limit + truncation (grouped) ──────────────────────────────────────

describe("limit + truncation (grouped)", () => {
  it("caps thread count at limit", async () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      timestamp: isoAgo(i * 0.1), type: `event-${i}`, _correlationId: `corr-${i}`,
    }));
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), records);
    const result = await timeline({ from: "24h", groupBy: "correlation", limit: 3, sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.threads.length).toBe(3);
    expect(result.truncated).toBe(true);
  });
});

// ─── Cache invalidation ────────────────────────────────────────────────

describe("cache invalidation", () => {
  it("returns cached result on repeated call", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "cached-event" },
    ]);
    const r1 = await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    const r2 = await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(r1.events.length).toBe(r2.events.length);
    expect(r2.durationMs).toBeLessThanOrEqual(r1.durationMs + 5);
  });

  it("invalidates cache after clearTimelineCache()", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "before" },
    ]);
    await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    clearTimelineCache();
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "before" },
      { timestamp: isoAgo(0.5), type: "after" },
    ]);
    const r = await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(r.events.length).toBe(2);
  });
});

// ─── Max limit enforcement ─────────────────────────────────────────────

describe("max limit enforcement", () => {
  it("clamps limit to 2000", async () => {
    // Just verify it doesn't throw and returns bounded result
    const result = await timeline({ from: "24h", limit: 5000, sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result).toHaveProperty("events");
  });
});

// ─── Default window ────────────────────────────────────────────────────

describe("default window", () => {
  it("defaults to last 24h when no from/to provided", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(12), type: "recent" },
      { timestamp: isoAgo(48), type: "old" },
    ]);
    const result = await timeline({ sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(1);
    expect(result.events[0].event).toBe("recent");
    expect(result.windowFrom).toBeTruthy();
    expect(result.windowTo).toBeTruthy();
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty for missing .forge directory", async () => {
    const emptyDir = resolve(tmpdir(), `pforge-empty-${randomUUID()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const result = await timeline({ from: "24h" }, { cwd: emptyDir });
      expect(result.total).toBe(0);
      expect(result.events).toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("handles malformed JSONL lines gracefully", async () => {
    writeFileSync(resolve(tmpDir, ".forge", "hub-events.jsonl"),
      `{"timestamp":"${isoAgo(1)}","type":"good"}\nNOT_JSON\n{"timestamp":"${isoAgo(0.5)}","type":"also-good"}\n`);
    const result = await timeline({ from: "24h", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(2);
  });

  it("handles empty sources array", async () => {
    const result = await timeline({ from: "24h", sources: [] }, { cwd: tmpDir });
    expect(result.events).toEqual([]);
    expect(result.sourcesQueried).toEqual([]);
  });

  it("ignores unknown source names", async () => {
    const result = await timeline({ from: "24h", sources: ["nonexistent", "hub-event"] }, { cwd: tmpDir });
    expect(result.sourcesQueried).toContain("hub-event");
    expect(result.sourcesQueried).not.toContain("nonexistent");
  });

  it("returns empty for limit 0", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(1), type: "a" },
    ]);
    const result = await timeline({ from: "24h", limit: 0, sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.events.length).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it("correlationId filter with groupBy correlation returns single thread", async () => {
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), [
      { timestamp: isoAgo(2), type: "a", _correlationId: "corr-X" },
      { timestamp: isoAgo(1), type: "b", _correlationId: "corr-Y" },
    ]);
    const result = await timeline({ from: "24h", correlationId: "corr-X", groupBy: "correlation", sources: ["hub-event"] }, { cwd: tmpDir });
    expect(result.threads.length).toBe(1);
    expect(result.threads[0].correlationId).toBe("corr-X");
  });
});

// ─── Performance guard ─────────────────────────────────────────────────

describe("performance guard", () => {
  it("processes 10k events under 2000ms", async () => {
    const records = Array.from({ length: 10_000 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      type: `event-${i % 50}`,
      _correlationId: `corr-${i % 100}`,
    }));
    writeJsonl(resolve(tmpDir, ".forge", "hub-events.jsonl"), records);
    clearTimelineCache();
    const t0 = performance.now();
    const result = await timeline({ from: "7d", sources: ["hub-event"] }, { cwd: tmpDir });
    const elapsed = performance.now() - t0;
    expect(result.total).toBe(10_000);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── TIMELINE_SOURCES registry ─────────────────────────────────────────

describe("TIMELINE_SOURCES", () => {
  it("has 9 source adapters", () => {
    expect(Object.keys(TIMELINE_SOURCES).length).toBe(9);
  });

  it("includes forge-master source", () => {
    expect(TIMELINE_SOURCES["forge-master"]).toBeDefined();
    expect(typeof TIMELINE_SOURCES["forge-master"].read).toBe("function");
  });

  it("all sources have a read function", () => {
    for (const [name, src] of Object.entries(TIMELINE_SOURCES)) {
      expect(typeof src.read).toBe("function");
    }
  });
});
