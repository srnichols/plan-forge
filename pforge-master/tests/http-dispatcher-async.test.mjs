/**
 * http-dispatcher-async.test.mjs
 *
 * Red scaffold: verifies that the HTTP dispatcher can handle a streaming
 * MCP call — one that emits multiple intermediate events followed by a
 * terminal payload.
 *
 * Current state (2026-04-23): createHttpDispatcher forwards calls to mcpCall
 * and returns the raw result.  It has no concept of event streaming.
 * These tests are therefore RED; they will go GREEN once the dispatcher
 * is enhanced to collect { events, terminal } from an async-iterable mcpCall.
 *
 * Expected dispatcher contract (once implemented):
 *   Given a mcpCall that returns an async iterable of { type, data } objects
 *   where the last item has type === "terminal":
 *   → dispatcher resolves to { events: [...non-terminal items...], terminal: <last item> }
 *
 * Phase-37.1 Slice 2+ will add the streaming-collector logic to
 * pforge-master/src/http-dispatcher.mjs to satisfy these tests.
 */

import { describe, it, expect } from "vitest";
import { createHttpDispatcher } from "../src/http-dispatcher.mjs";
import { BASE_ALLOWLIST } from "../src/allowlist.mjs";

// ─── Streaming mock helpers ───────────────────────────────────────────────────

/**
 * Build an async iterable that emits `events` followed by a terminal event.
 * Models the expected streaming MCP call contract.
 */
async function* makeAsyncStream(events, terminal) {
  for (const event of events) {
    yield event;
  }
  yield terminal;
}

/**
 * Streaming mcpCall factory: wraps makeAsyncStream so the dispatcher can
 * consume it.  Returns an async iterable (not a plain Promise<object>).
 */
function makeStreamingMcpCall(events, terminal) {
  return (_toolName, _args) => makeAsyncStream(events, terminal);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const STREAM_EVENTS = [
  { type: "progress", data: { slice: 1, status: "running" } },
  { type: "progress", data: { slice: 2, status: "running" } },
  { type: "progress", data: { slice: 3, status: "running" } },
];

const STREAM_TERMINAL = {
  type: "terminal",
  data: { slicesCompleted: 3, cost: 0.012, status: "done" },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("http-dispatcher streaming (async MCP call — currently red)", () => {
  // Use a known ASYNC tool from the allowlist so the dispatcher forwards to mcpCall
  const ASYNC_TOOL = "forge_watch_live";

  it("collects 3 intermediate events from the stream", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: makeStreamingMcpCall(STREAM_EVENTS, STREAM_TERMINAL),
    });

    const result = await dispatch(ASYNC_TOOL, { targetPath: "/tmp" });

    // RED: current dispatcher returns the raw async iterable, not { events, terminal }
    expect(result).toHaveProperty("events");
    expect(result.events).toHaveLength(3);
    expect(result.events).toEqual(STREAM_EVENTS);
  });

  it("exposes the terminal payload separately", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: makeStreamingMcpCall(STREAM_EVENTS, STREAM_TERMINAL),
    });

    const result = await dispatch(ASYNC_TOOL, { targetPath: "/tmp" });

    // RED: current dispatcher does not separate terminal from events
    expect(result).toHaveProperty("terminal");
    expect(result.terminal).toEqual(STREAM_TERMINAL);
  });

  it("terminal.type is 'terminal'", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: makeStreamingMcpCall(STREAM_EVENTS, STREAM_TERMINAL),
    });

    const result = await dispatch(ASYNC_TOOL, { targetPath: "/tmp" });

    // RED: not present until streaming support is added
    expect(result?.terminal?.type).toBe("terminal");
  });

  it("result has no top-level error", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: makeStreamingMcpCall(STREAM_EVENTS, STREAM_TERMINAL),
    });

    const result = await dispatch(ASYNC_TOOL, { targetPath: "/tmp" });

    // This should pass even with the current stub (the async iterable is returned as-is)
    expect(result?.error).toBeUndefined();
  });
});
