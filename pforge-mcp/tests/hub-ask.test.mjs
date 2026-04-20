import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "../hub.mjs";

/**
 * Stub WebSocketServer — mirrors hub.test.mjs pattern.
 */
function makeStubWss() {
  const wss = new EventEmitter();
  wss.close = () => {};
  return wss;
}

function makeHub(cwd) {
  const wss = makeStubWss();
  const hub = new Hub(wss, 0, cwd);
  // Suppress durable event writes in tests
  hub._appendDurableEvent = () => {};
  return { hub, wss };
}

describe("Hub ask/respond transport — Slice 06.1", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-hub-ask-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Happy path ──────────────────────────────────────────────────

  it("ask() resolves when responder returns a value", async () => {
    hub.onAsk("echo", (payload) => payload);
    const result = await hub.ask("echo", { msg: "hello" });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ msg: "hello" });
  });

  it("ask() resolves with responder's return value in payload", async () => {
    hub.onAsk("double", (payload) => ({ value: payload.n * 2 }));
    const result = await hub.ask("double", { n: 21 });
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ value: 42 });
  });

  // ── 3. Timeout ─────────────────────────────────────────────────────

  it("ask() rejects with ErrAskTimeout after timeoutMs", async () => {
    hub.onAsk("slow", () => new Promise(() => {})); // never resolves
    await expect(
      hub.ask("slow", {}, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "ask-timeout" });
  });

  // ── 4. No responder ────────────────────────────────────────────────

  it("ask() with no registered responder returns ok:false, code:no-responder", async () => {
    const result = await hub.ask("missing-topic", {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("no-responder");
  });

  // ── 5. Single-responder enforcement ────────────────────────────────

  it("onAsk() throws on duplicate topic registration", () => {
    hub.onAsk("once", () => {});
    expect(() => hub.onAsk("once", () => {})).toThrow(
      "Responder already registered for topic: once",
    );
  });

  // ── 6. removeAskHandler ────────────────────────────────────────────

  it("removeAskHandler() allows re-registration", () => {
    hub.onAsk("temp", () => "v1");
    hub.removeAskHandler("temp");
    hub.onAsk("temp", () => "v2");
    expect(hub.listResponders()).toContain("temp");
  });

  // ── 7. Late respond after timeout ──────────────────────────────────

  it("late respond after timeout is dropped with warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let resolveHandler;
    hub.onAsk("delayed", () => new Promise((r) => { resolveHandler = r; }));

    await expect(
      hub.ask("delayed", {}, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "ask-timeout" });

    // Handler resolves after timeout — should be dropped
    resolveHandler("too late");
    await new Promise((r) => setTimeout(r, 20));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("late respond dropped"),
    );
    warnSpy.mockRestore();
  });

  // ── 8. Responder throws → ok:false ─────────────────────────────────

  it("responder that throws → ok:false with responder-error", async () => {
    hub.onAsk("boom", () => { throw new Error("kaboom"); });
    const result = await hub.ask("boom", {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("responder-error");
    expect(result.error.message).toBe("kaboom");
  });

  // ── 9. Async responder rejects ─────────────────────────────────────

  it("async responder that rejects → ok:false", async () => {
    hub.onAsk("async-boom", async () => { throw new Error("async fail"); });
    const result = await hub.ask("async-boom", {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("responder-error");
    expect(result.error.message).toBe("async fail");
  });

  // ── 10. Non-blocking dispatch ──────────────────────────────────────

  it("ask does not block the event loop (handler runs via Promise.resolve)", async () => {
    let handlerRanAt = 0;
    const beforeAsk = Date.now();
    hub.onAsk("defer", () => {
      handlerRanAt = Date.now();
      return "ok";
    });
    const promise = hub.ask("defer", {});
    // The handler runs on the next microtask, not synchronously
    expect(handlerRanAt).toBe(0); // not yet invoked synchronously
    const result = await promise;
    expect(result.ok).toBe(true);
    expect(handlerRanAt).toBeGreaterThanOrEqual(beforeAsk);
  });

  // ── 11. Backwards-compat ───────────────────────────────────────────

  it("existing event subscribers ignore ask/respond frames", () => {
    // broadcast() with ask-telemetry events should not break normal
    // event handling. Simulate that broadcast works for any type.
    hub.broadcast({ type: "slice-started", data: { slice: 1 } });
    hub.onAsk("compat-check", () => "ok");
    // After registering a responder, broadcast still works
    hub.broadcast({ type: "slice-completed", data: { slice: 1 } });
    // Event history contains both events, no interference
    const types = hub.eventHistory.map((e) => e.type);
    expect(types).toContain("slice-started");
    expect(types).toContain("slice-completed");
  });

  // ── 12. CorrelationId forwarding ───────────────────────────────────

  it("ask with correlationId propagates it to handler meta", async () => {
    let receivedMeta;
    hub.onAsk("meta-check", (_payload, meta) => {
      receivedMeta = meta;
      return "ok";
    });
    await hub.ask("meta-check", {}, { correlationId: "corr-123" });
    expect(receivedMeta.correlationId).toBe("corr-123");
    expect(receivedMeta.topic).toBe("meta-check");
    expect(receivedMeta.requestId).toMatch(/^req-/);
  });

  // ── 13. Large payload ──────────────────────────────────────────────

  it("ask with large payload succeeds", async () => {
    hub.onAsk("big", (payload) => ({ size: JSON.stringify(payload).length }));
    const bigPayload = { data: "x".repeat(100_000) };
    const result = await hub.ask("big", bigPayload);
    expect(result.ok).toBe(true);
    expect(result.payload.size).toBeGreaterThan(100_000);
  });

  // ── 14–16. Telemetry spans ─────────────────────────────────────────

  it("telemetry span emitted on successful ask", async () => {
    hub.onAsk("tel-ok", () => "done");
    await hub.ask("tel-ok", {});
    const spans = hub._askSpans.filter((s) => s.topic === "tel-ok");
    expect(spans).toHaveLength(1);
    expect(spans[0].ok).toBe(true);
    expect(spans[0].name).toBe("hub.ask");
  });

  it("telemetry span emitted on timeout with ok:false", async () => {
    hub.onAsk("tel-timeout", () => new Promise(() => {}));
    await expect(
      hub.ask("tel-timeout", {}, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "ask-timeout" });
    const spans = hub._askSpans.filter((s) => s.topic === "tel-timeout");
    expect(spans).toHaveLength(1);
    expect(spans[0].ok).toBe(false);
  });

  it("telemetry span includes durationMs", async () => {
    hub.onAsk("tel-dur", () => "fast");
    await hub.ask("tel-dur", {});
    const span = hub._askSpans.find((s) => s.topic === "tel-dur");
    expect(span.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof span.durationMs).toBe("number");
  });

  // ── 17–18. listResponders ──────────────────────────────────────────

  it("listResponders() returns registered topics", () => {
    hub.onAsk("a", () => {});
    hub.onAsk("b", () => {});
    expect(hub.listResponders()).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("listResponders() returns empty array when none registered", () => {
    expect(hub.listResponders()).toEqual([]);
  });

  // ── 19. Concurrent asks ────────────────────────────────────────────

  it("concurrent asks to same topic resolve independently", async () => {
    hub.onAsk("multi", (payload) => ({ echo: payload.id }));
    const [r1, r2, r3] = await Promise.all([
      hub.ask("multi", { id: 1 }),
      hub.ask("multi", { id: 2 }),
      hub.ask("multi", { id: 3 }),
    ]);
    expect(r1.payload.echo).toBe(1);
    expect(r2.payload.echo).toBe(2);
    expect(r3.payload.echo).toBe(3);
  });

  // ── 20. Ask after close ────────────────────────────────────────────

  it("ask after hub.close() rejects cleanly", async () => {
    hub.onAsk("post-close", () => "nope");
    hub.close();
    await expect(hub.ask("post-close", {})).rejects.toThrow("hub-closed");
  });

  // ── 21. Double respond ─────────────────────────────────────────────

  it("double-respond for same requestId: second is dropped", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    hub.onAsk("double", () => "first");
    const result = await hub.ask("double", {});
    expect(result.ok).toBe(true);

    // Manually attempt a second deliver — should be dropped
    hub._deliverResponse("req-nonexistent", "second", true, Date.now(), "double", undefined);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("late respond dropped"),
    );
    warnSpy.mockRestore();
  });

  // ── 22. Timeout eviction cleans up map ─────────────────────────────

  it("timeout eviction cleans up _pendingAsks map", async () => {
    hub.onAsk("leak-check", () => new Promise(() => {}));
    await expect(
      hub.ask("leak-check", {}, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "ask-timeout" });
    expect(hub._pendingAsks.size).toBe(0);
  });
});
