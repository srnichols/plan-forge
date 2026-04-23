/**
 * http-dispatcher-failure.test.mjs
 *
 * Phase-37.1 Slice 4 — Failure injection tests for createHttpDispatcher.
 *
 * Covers the 5 failure modes hardened in Slice 4:
 *   1. Handler throws Error("mcp dropped") mid-stream → { error: ... }, no crash.
 *   2. Handler never emits terminal (hang) → timeout → { error: "stream-timeout" }.
 *   3. Handler emits 10 000 events → capped at streamEventCap, returns cleanly.
 *   4. Malformed (non-object) primitive in stream → skipped, clean result.
 *   5. null terminal → normalized to { events: [...], terminal: null }.
 *
 * All tests use mocked mcpCall and short streamTimeout (100 ms) where needed
 * so the suite runs in < 1 s.
 */

import { describe, it, expect } from "vitest";
import { createHttpDispatcher } from "../src/http-dispatcher.mjs";
import { BASE_ALLOWLIST } from "../src/allowlist.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Pick a stable read-only tool from the allowlist for all tests.
const TOOL = BASE_ALLOWLIST[0]; // "forge_plan_status"

/** Build an async iterable from an array of items. */
async function* makeStream(...items) {
  for (const item of items) {
    yield item;
  }
}

/** Build an async iterable that throws after emitting `priorItems`. */
async function* makeThrowingStream(priorItems, errorMsg) {
  for (const item of priorItems) {
    yield item;
  }
  throw new Error(errorMsg);
}

/** Build an async iterable that never yields (simulates a hang). */
async function* neverYields() {
  await new Promise(() => {}); // hangs forever
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("http-dispatcher failure injection", () => {
  // ── Mode 1: throw mid-stream ──────────────────────────────────────────────

  it("mode 1 — handler throws mid-stream: returns { error } without crashing", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: () => makeThrowingStream(
        [{ type: "progress", data: { n: 1 } }],
        "mcp dropped"
      ),
      streamTimeout: 0, // disable timeout so we test the throw path only
    });

    const result = await dispatch(TOOL, {});

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/mcp dropped/);
  });

  it("mode 1 — mcpCall itself rejects: returns { error } without crashing", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: async () => { throw new Error("connection refused"); },
    });

    const result = await dispatch(TOOL, {});

    expect(result).toHaveProperty("error");
    expect(result.error).toMatch(/connection refused/);
  });

  // ── Mode 2: never-emitting terminal (timeout) ─────────────────────────────

  it("mode 2 — handler never emits terminal: dispatcher aborts with stream-timeout", async () => {
    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: () => neverYields(),
      streamTimeout: 80, // 80 ms so the test finishes quickly
    });

    const result = await dispatch(TOOL, {});

    expect(result).toEqual({ error: "stream-timeout" });
  }, 2000 /* vitest timeout: 2s */);

  // ── Mode 3: 10 000 events — capped at streamEventCap ──────────────────────

  it("mode 3 — 10 000-event stream: capped cleanly at streamEventCap", async () => {
    const CAP = 15;

    async function* bigStream() {
      for (let i = 0; i < 10_000; i++) {
        yield { type: "progress", data: { n: i } };
      }
      yield { type: "terminal", data: { done: true } };
    }

    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: () => bigStream(),
      streamEventCap: CAP,
      streamTimeout: 0,
    });

    const result = await dispatch(TOOL, {});

    expect(result).toHaveProperty("events");
    expect(result.events).toHaveLength(CAP);
    expect(result.terminal).toMatchObject({ type: "terminal" });
    expect(result).not.toHaveProperty("error");
  });

  // ── Mode 4: malformed (non-object) item in stream — skipped ───────────────

  it("mode 4 — malformed primitive in stream: skipped, clean result", async () => {
    const goodEvent = { type: "progress", data: { n: 1 } };
    const terminal = { type: "terminal", data: { done: true } };

    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: () => makeStream(
        goodEvent,
        "malformed-string", // non-object primitive → skipped
        42,                  // another malformed primitive → skipped
        terminal,
      ),
      streamTimeout: 0,
    });

    const result = await dispatch(TOOL, {});

    expect(result).not.toHaveProperty("error");
    // Only the real event object should appear; primitives are discarded.
    expect(result.events).toEqual([goodEvent]);
    expect(result.terminal).toEqual(terminal);
  });

  // ── Mode 5: null terminal — normalized to { events, terminal: null } ───────

  it("mode 5 — null terminal: normalized to { events: [...], terminal: null }", async () => {
    const priorEvent = { type: "progress", data: { slice: 1 } };

    const dispatch = createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: () => makeStream(priorEvent, null),
      streamTimeout: 0,
    });

    const result = await dispatch(TOOL, {});

    expect(result).not.toHaveProperty("error");
    expect(result).toHaveProperty("events");
    expect(result.events).toEqual([priorEvent]);
    expect(result).toHaveProperty("terminal");
    expect(result.terminal).toBeNull();
  });
});
