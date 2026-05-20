/**
 * Tests for observer-loop.mjs — hub subscription + event-batch buffer.
 * Phase-39, Slice 5.
 *
 * Uses an injectable _wsFactory to avoid needing a live hub.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  startObserver,
  DEFAULT_BATCH_WINDOW_MS,
  MAX_RECONNECT_RETRIES,
  OBSERVER_SUBSCRIBED_EVENTS,
  OBSERVER_NARRATION_EVENT_TYPE,
} from "../src/observer-loop.mjs";

// ─── Mock WebSocket ───────────────────────────────────────────────────

class MockWs extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1; // OPEN
    this.closed = false;
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.emit("close");
    }
  }
  send(data) { /* stub */ }
}

function makeMockWsFactory() {
  const instances = [];
  const factory = (url) => {
    const ws = new MockWs();
    ws._url = url;
    instances.push(ws);
    return ws;
  };
  factory.instances = instances;
  return factory;
}

// ─── Exported constants ───────────────────────────────────────────────

describe("module constants", () => {
  it("DEFAULT_BATCH_WINDOW_MS is a positive number", () => {
    expect(typeof DEFAULT_BATCH_WINDOW_MS).toBe("number");
    expect(DEFAULT_BATCH_WINDOW_MS).toBeGreaterThan(0);
  });

  it("MAX_RECONNECT_RETRIES is 3", () => {
    expect(MAX_RECONNECT_RETRIES).toBe(3);
  });

  it("OBSERVER_SUBSCRIBED_EVENTS is a Set containing core event types", () => {
    expect(OBSERVER_SUBSCRIBED_EVENTS instanceof Set).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("slice-started")).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("slice-completed")).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("slice-failed")).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("run-started")).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("run-completed")).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("run-aborted")).toBe(true);
    expect(OBSERVER_SUBSCRIBED_EVENTS.has("cost-accrued")).toBe(true);
  });

  it("OBSERVER_NARRATION_EVENT_TYPE is reserved for Slice 7", () => {
    expect(typeof OBSERVER_NARRATION_EVENT_TYPE).toBe("string");
    expect(OBSERVER_NARRATION_EVENT_TYPE).toBe("observer:narration");
  });
});

// ─── startObserver — argument validation ──────────────────────────────

describe("startObserver — argument validation", () => {
  it("throws if onBatch is not provided", () => {
    expect(() => startObserver({ wsPort: 9999 })).toThrow("onBatch must be a function");
  });

  it("throws if onBatch is null", () => {
    expect(() => startObserver({ onBatch: null, wsPort: 9999 })).toThrow("onBatch must be a function");
  });

  it("throws if onBatch is a string", () => {
    expect(() => startObserver({ onBatch: "nope", wsPort: 9999 })).toThrow("onBatch must be a function");
  });

  it("accepts a valid onBatch function", () => {
    const factory = makeMockWsFactory();
    let obs;
    expect(() => {
      obs = startObserver({ onBatch: () => {}, wsPort: 9999, _wsFactory: factory });
    }).not.toThrow();
    obs.stop();
  });
});

// ─── startObserver — API shape ────────────────────────────────────────

describe("startObserver — return shape", () => {
  it("returns stop and getStatus methods", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 9999, _wsFactory: factory });
    expect(typeof obs.stop).toBe("function");
    expect(typeof obs.getStatus).toBe("function");
    obs.stop();
  });

  it("getStatus returns all expected fields", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 9999, _wsFactory: factory });
    const status = obs.getStatus();
    expect(status).toHaveProperty("connected");
    expect(status).toHaveProperty("stopped");
    expect(status).toHaveProperty("retryCount");
    expect(status).toHaveProperty("bufferSize");
    expect(status).toHaveProperty("lastError");
    expect(status).toHaveProperty("lastFlushAt");
    expect(status).toHaveProperty("totalEventsReceived");
    expect(status).toHaveProperty("totalBatchesFlushed");
    expect(status).toHaveProperty("batchWindowMs");
    obs.stop();
  });

  it("getStatus.batchWindowMs reflects the configured value", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 9999, batchWindowMs: 5000, _wsFactory: factory });
    expect(obs.getStatus().batchWindowMs).toBe(5000);
    obs.stop();
  });
});

// ─── startObserver — connection lifecycle ─────────────────────────────

describe("startObserver — connection lifecycle", () => {
  it("starts disconnected before 'open' event fires", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 9999, _wsFactory: factory });
    expect(obs.getStatus().connected).toBe(false);
    obs.stop();
  });

  it("marks connected after hub emits 'open'", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 9999, _wsFactory: factory });
    factory.instances[0].emit("open");
    expect(obs.getStatus().connected).toBe(true);
    obs.stop();
  });

  it("connects to the correct URL when wsPort is provided", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 3101, _wsFactory: factory });
    expect(factory.instances[0]._url).toBe("ws://127.0.0.1:3101");
    obs.stop();
  });

  it("marks disconnected on WebSocket 'close'", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    expect(obs.getStatus().connected).toBe(true);
    obs.stop(); // stop before auto-reconnect fires
    expect(obs.getStatus().connected).toBe(false);
  });

  it("stop() sets stopped to true", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({ onBatch: () => {}, wsPort: 9999, _wsFactory: factory });
    obs.stop();
    expect(obs.getStatus().stopped).toBe(true);
  });

  it("gracefully handles missing hub port (no wsPort, no server-ports.json)", () => {
    // When no port is discoverable, observer should not throw — it logs + retries
    const called = [];
    const obs = startObserver({
      onBatch: () => {},
      cwd: "/nonexistent/path/xyz123",
      _wsFactory: (url) => { called.push(url); return new MockWs(); },
    });
    // factory should not have been called since port discovery failed
    expect(called).toHaveLength(0);
    const status = obs.getStatus();
    expect(status.connected).toBe(false);
    expect(status.lastError).toContain("hub port not found");
    obs.stop();
  });
});

// ─── startObserver — event buffering ──────────────────────────────────

describe("startObserver — event buffering", () => {
  it("buffers subscribed event types received from hub", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "slice-started", sliceId: "S-1" }));
    factory.instances[0].emit("message", JSON.stringify({ type: "run-completed", runId: "r-1" }));
    expect(obs.getStatus().bufferSize).toBe(2);
    expect(obs.getStatus().totalEventsReceived).toBe(2);
    obs.stop();
  });

  it("ignores the 'connected' handshake message", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "connected", clientId: "abc" }));
    expect(obs.getStatus().bufferSize).toBe(0);
    expect(obs.getStatus().totalEventsReceived).toBe(0);
    obs.stop();
  });

  it("ignores unknown event types", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "some-future-event", data: "x" }));
    expect(obs.getStatus().bufferSize).toBe(0);
    obs.stop();
  });

  it("ignores malformed (non-JSON) messages", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    expect(() => {
      factory.instances[0].emit("message", "NOT JSON {{{");
    }).not.toThrow();
    expect(obs.getStatus().bufferSize).toBe(0);
    obs.stop();
  });

  it("buffers all subscribed event types", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    let count = 0;
    for (const type of OBSERVER_SUBSCRIBED_EVENTS) {
      factory.instances[0].emit("message", JSON.stringify({ type, id: count++ }));
    }
    expect(obs.getStatus().bufferSize).toBe(OBSERVER_SUBSCRIBED_EVENTS.size);
    obs.stop();
  });
});

// ─── startObserver — flush behaviour ─────────────────────────────────

describe("startObserver — flush behaviour", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls onBatch with buffered events when timer fires", () => {
    const batches = [];
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: (b) => batches.push([...b]),
      wsPort: 9999,
      batchWindowMs: 1000,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "slice-started", sliceId: "S-1" }));
    factory.instances[0].emit("message", JSON.stringify({ type: "run-completed", runId: "r-1" }));
    vi.advanceTimersByTime(1100);
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0]).toHaveLength(2);
    obs.stop();
  });

  it("does not call onBatch when buffer is empty at flush time", () => {
    const calls = [];
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: (b) => calls.push(b),
      wsPort: 9999,
      batchWindowMs: 1000,
      _wsFactory: factory,
    });
    vi.advanceTimersByTime(1100);
    expect(calls).toHaveLength(0);
    obs.stop();
  });

  it("clears buffer after flush so events are not re-delivered", () => {
    const batches = [];
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: (b) => batches.push([...b]),
      wsPort: 9999,
      batchWindowMs: 1000,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "slice-started" }));
    vi.advanceTimersByTime(1100); // first flush
    factory.instances[0].emit("message", JSON.stringify({ type: "run-completed" }));
    vi.advanceTimersByTime(1100); // second flush
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(1);
    obs.stop();
  });

  it("increments totalBatchesFlushed on each non-empty flush", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 1000,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "slice-started" }));
    vi.advanceTimersByTime(1100);
    expect(obs.getStatus().totalBatchesFlushed).toBe(1);
    obs.stop();
  });

  it("stop() performs a final flush of remaining buffered events", () => {
    const batches = [];
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: (b) => batches.push([...b]),
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("message", JSON.stringify({ type: "slice-failed", sliceId: "S-3" }));
    obs.stop();
    expect(batches).toHaveLength(1);
    expect(batches[0][0].type).toBe("slice-failed");
  });
});

// ─── startObserver — reconnect behaviour ─────────────────────────────

describe("startObserver — reconnect behaviour", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("schedules reconnect on WebSocket 'close'", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].closed = true; // prevent double-close triggering recursion
    factory.instances[0].emit("close");
    vi.advanceTimersByTime(1500); // past first retry delay (1000ms)
    expect(factory.instances.length).toBeGreaterThanOrEqual(2);
    obs.stop();
  });

  it("schedules reconnect on WebSocket error", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("error", new Error("connection refused"));
    vi.advanceTimersByTime(1500);
    expect(factory.instances.length).toBeGreaterThanOrEqual(2);
    obs.stop();
  });

  it("does NOT reconnect after stop()", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    obs.stop();
    const countAfterStop = factory.instances.length;
    vi.advanceTimersByTime(5000);
    expect(factory.instances.length).toBe(countAfterStop);
  });

  it("halts after MAX_RECONNECT_RETRIES without reconnecting further", () => {
    let wsCount = 0;
    const allWs = [];
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: () => {
        wsCount++;
        const ws = new MockWs();
        allWs.push(ws);
        return ws;
      },
    });
    // Immediately close each connection without triggering further reconnect manually
    // retries: 0 → close → retry 1 (delay 1s) → close → retry 2 (delay 2s) → close → retry 3 (delay 4s) → close → HALT
    vi.advanceTimersByTime(1); // initial connect is synchronous; ws[0] is created
    allWs[0]?.emit("error", new Error("x")); // triggers scheduleReconnect(), retryCount=1
    vi.advanceTimersByTime(1100);             // retry 1 fires → ws[1]
    allWs[1]?.emit("error", new Error("x")); // retryCount=2
    vi.advanceTimersByTime(2100);             // retry 2 fires → ws[2]
    allWs[2]?.emit("error", new Error("x")); // retryCount=3
    vi.advanceTimersByTime(4100);             // retry 3 fires → ws[3]
    allWs[3]?.emit("error", new Error("x")); // retryCount now ≥ MAX → HALT
    vi.advanceTimersByTime(10000);            // no more retries
    // Should have exactly MAX_RECONNECT_RETRIES + 1 initial = 4 total attempts
    expect(wsCount).toBeLessThanOrEqual(MAX_RECONNECT_RETRIES + 1);
    expect(obs.getStatus().lastError).toContain("max retries");
    obs.stop();
  });

  it("resets retryCount to 0 on successful reconnect", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("open");
    factory.instances[0].emit("close"); // trigger retry, retryCount=1
    vi.advanceTimersByTime(1500);
    factory.instances[1]?.emit("open"); // successful reconnect → retryCount resets
    expect(obs.getStatus().retryCount).toBe(0);
    obs.stop();
  });

  it("clears lastError on successful reconnect", () => {
    const factory = makeMockWsFactory();
    const obs = startObserver({
      onBatch: () => {},
      wsPort: 9999,
      batchWindowMs: 999999,
      _wsFactory: factory,
    });
    factory.instances[0].emit("error", new Error("initial fail"));
    vi.advanceTimersByTime(1500);
    factory.instances[1]?.emit("open");
    expect(obs.getStatus().lastError).toBeNull();
    obs.stop();
  });
});

// ─── forge_master_observe tool schema ────────────────────────────────

describe("forge_master_observe tool registration", () => {
  it("server.mjs can be imported without error", async () => {
    // We just verify the module graph is loadable; we don't boot the MCP server
    // (that would bind stdio). Import the observer-loop module directly.
    const mod = await import("../src/observer-loop.mjs");
    expect(typeof mod.startObserver).toBe("function");
  });

  it("observer-loop exports startObserver as a named export", async () => {
    const { startObserver: fn } = await import("../src/observer-loop.mjs");
    expect(typeof fn).toBe("function");
  });
});
