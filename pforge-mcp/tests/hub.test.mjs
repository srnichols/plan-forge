import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "../hub.mjs";

/**
 * Stub WebSocketServer — just an EventEmitter with a close() method.
 * Tests don't need a real port.
 */
function makeStubWss() {
  const wss = new EventEmitter();
  wss.close = () => {};
  return wss;
}

function makeHub(cwd) {
  const wss = makeStubWss();
  const hub = new Hub(wss, 0, cwd);
  return { hub, wss };
}

describe("Hub.broadcast — G1.2 durable hub-events.jsonl", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-hub-test-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends every broadcast to .forge/hub-events.jsonl", () => {
    hub.broadcast({ type: "slice-started", data: { slice: 1 } });
    hub.broadcast({ type: "slice-completed", data: { slice: 1 } });

    const logPath = resolve(tmpDir, ".forge", "hub-events.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.type).toBe("slice-started");
    expect(first.version).toBe("1.0");
    expect(first.timestamp).toBeDefined();
    expect(first.data.slice).toBe(1);
  });

  it("creates .forge/ directory if it doesn't exist", () => {
    hub.broadcast({ type: "test" });
    expect(existsSync(resolve(tmpDir, ".forge"))).toBe(true);
  });

  it("never throws when the durable write fails (best-effort)", () => {
    // Force failure by pointing cwd at a path we'll make read-only
    // — simplest cross-platform approach: clobber the method to throw.
    hub._appendDurableEvent = () => { throw new Error("disk full"); };
    expect(() => hub.broadcast({ type: "test" })).not.toThrow();
    // Ring buffer still updated
    expect(hub.eventHistory).toHaveLength(1);
  });

  it("ring buffer stays bounded at EVENT_HISTORY_SIZE (500)", () => {
    for (let i = 0; i < 600; i++) {
      hub.broadcast({ type: "tick", data: { i } });
    }
    expect(hub.eventHistory.length).toBe(500);
    // Oldest entries dropped
    expect(hub.eventHistory[0].data.i).toBe(100);
    expect(hub.eventHistory[499].data.i).toBe(599);
  });
});

describe("Hub.rehydrateFromRuns — G1.1 multi-run replay", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-hub-rehydrate-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRunLog(runId, lines) {
    const runDir = resolve(tmpDir, ".forge", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(resolve(runDir, "events.log"), lines.join("\n") + "\n");
  }

  it("returns zero counts when no runs directory exists", () => {
    const result = hub.rehydrateFromRuns();
    expect(result).toEqual({ runsScanned: 0, eventsLoaded: 0 });
    expect(hub.eventHistory).toHaveLength(0);
  });

  it("loads events from the last N runs, oldest first", () => {
    writeRunLog("2024-01-01T00-00-00", [
      "[2024-01-01T00:00:01Z] slice-started: {\"slice\":1}",
      "[2024-01-01T00:00:02Z] slice-completed: {\"slice\":1}",
    ]);
    writeRunLog("2024-01-02T00-00-00", [
      "[2024-01-02T00:00:01Z] slice-started: {\"slice\":1}",
    ]);

    const result = hub.rehydrateFromRuns(2);
    expect(result.runsScanned).toBe(2);
    expect(result.eventsLoaded).toBe(3);
    expect(hub.eventHistory).toHaveLength(3);
    // Oldest first
    expect(hub.eventHistory[0].timestamp).toBe("2024-01-01T00:00:01Z");
    expect(hub.eventHistory[2].timestamp).toBe("2024-01-02T00:00:01Z");
    // Each rehydrated event is tagged
    expect(hub.eventHistory[0].source).toBe("rehydrate");
    expect(hub.eventHistory[0].version).toBe("1.0");
  });

  it("respects runCount parameter — newest N runs only", () => {
    writeRunLog("2024-01-01T00-00-00", ["[2024-01-01T00:00:01Z] a: {}"]);
    writeRunLog("2024-01-02T00-00-00", ["[2024-01-02T00:00:01Z] b: {}"]);
    writeRunLog("2024-01-03T00-00-00", ["[2024-01-03T00:00:01Z] c: {}"]);

    const result = hub.rehydrateFromRuns(2);
    expect(result.runsScanned).toBe(2);
    expect(hub.eventHistory.map((e) => e.type)).toEqual(["b", "c"]);
  });

  it("skips malformed lines silently", () => {
    writeRunLog("2024-01-01T00-00-00", [
      "not-a-valid-line",
      "[2024-01-01T00:00:01Z] ok: {\"x\":1}",
      "[bad-timestamp] foo: {malformed json",
    ]);
    const result = hub.rehydrateFromRuns();
    expect(result.eventsLoaded).toBe(1);
    expect(hub.eventHistory[0].type).toBe("ok");
  });

  it("caps rehydrated events at EVENT_HISTORY_SIZE (500)", () => {
    const lines = [];
    for (let i = 0; i < 700; i++) {
      lines.push(`[2024-01-01T00:00:${String(i).padStart(2, "0")}Z] tick: {"i":${i}}`);
    }
    writeRunLog("2024-01-01T00-00-00", lines);

    const result = hub.rehydrateFromRuns(1);
    expect(result.eventsLoaded).toBe(500);
    expect(hub.eventHistory).toHaveLength(500);
  });
});
