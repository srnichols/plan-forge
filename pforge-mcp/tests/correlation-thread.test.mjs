import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "../hub.mjs";
import { registerCorrelationThreadResponder } from "../orchestrator.mjs";

function makeStubWss() {
  const wss = new EventEmitter();
  wss.close = () => {};
  return wss;
}

function makeHub(cwd) {
  const wss = makeStubWss();
  const hub = new Hub(wss, 0, cwd);
  hub._appendDurableEvent = () => {};
  return { hub, wss };
}

function writeHubEvents(tmpDir, events) {
  const dir = resolve(tmpDir, ".forge");
  mkdirSync(dir, { recursive: true });
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(resolve(dir, "hub-events.jsonl"), lines);
}

describe("brain.correlation-thread responder — Slice 06.2", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-corr-thread-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Happy path ──────────────────────────────────────────────────

  it("returns matching events for a correlationId", async () => {
    writeHubEvents(tmpDir, [
      { _correlationId: "corr-1", type: "slice-started", ts: "2026-01-01T00:00:00Z" },
      { _correlationId: "corr-2", type: "run-started", ts: "2026-01-01T00:01:00Z" },
      { _correlationId: "corr-1", type: "slice-completed", ts: "2026-01-01T00:02:00Z" },
    ]);
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-1" });
    expect(result.ok).toBe(true);
    expect(result.payload.count).toBe(2);
    expect(result.payload.events).toHaveLength(2);
  });

  // ── 2. No match ───────────────────────────────────────────────────

  it("returns empty array when no events match", async () => {
    writeHubEvents(tmpDir, [
      { _correlationId: "corr-X", type: "run-started", ts: "2026-01-01T00:00:00Z" },
    ]);
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-Z" });
    expect(result.ok).toBe(true);
    expect(result.payload.events).toHaveLength(0);
    expect(result.payload.count).toBe(0);
  });

  // ── 3. Limit parameter ────────────────────────────────────────────

  it("respects limit parameter", async () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      _correlationId: "corr-A",
      type: "slice-started",
      ts: `2026-01-01T00:0${i}:00Z`,
    }));
    writeHubEvents(tmpDir, events);
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-A", limit: 3 });
    expect(result.payload.events).toHaveLength(3);
    expect(result.payload.count).toBe(10);
  });

  // ── 4. Newest-first ordering ──────────────────────────────────────

  it("returns events in newest-first order", async () => {
    writeHubEvents(tmpDir, [
      { _correlationId: "corr-B", type: "a", ts: "2026-01-01T00:00:00Z" },
      { _correlationId: "corr-B", type: "b", ts: "2026-01-01T00:05:00Z" },
      { _correlationId: "corr-B", type: "c", ts: "2026-01-01T00:02:00Z" },
    ]);
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-B" });
    expect(result.payload.events[0].type).toBe("b");
    expect(result.payload.events[1].type).toBe("c");
    expect(result.payload.events[2].type).toBe("a");
  });

  // ── 5. Missing hub-events.jsonl ───────────────────────────────────

  it("handles missing hub-events.jsonl gracefully", async () => {
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-X" });
    expect(result.ok).toBe(true);
    expect(result.payload.events).toHaveLength(0);
  });

  // ── 6. Malformed JSONL lines ──────────────────────────────────────

  it("handles malformed JSONL lines gracefully via readForgeJsonl fallback", async () => {
    const dir = resolve(tmpDir, ".forge");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "hub-events.jsonl"), "not-json\n{}\n");
    // readForgeJsonl returns defaultValue on parse error
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "any" });
    expect(result.ok).toBe(true);
    // readForgeJsonl returns [] on parse failure
    expect(result.payload.count).toBe(0);
  });

  // ── 7. Default limit is 50 ────────────────────────────────────────

  it("default limit is 50", async () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      _correlationId: "corr-L",
      type: "evt",
      ts: new Date(Date.now() + i * 1000).toISOString(),
    }));
    writeHubEvents(tmpDir, events);
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-L" });
    expect(result.payload.events).toHaveLength(50);
    expect(result.payload.count).toBe(60);
  });

  // ── 8. correlationId field support ────────────────────────────────

  it("matches events using correlationId field (not just _correlationId)", async () => {
    writeHubEvents(tmpDir, [
      { correlationId: "corr-alt", type: "alt-event", ts: "2026-01-01T00:00:00Z" },
    ]);
    registerCorrelationThreadResponder(hub, tmpDir);
    const result = await hub.ask("brain.correlation-thread", { correlationId: "corr-alt" });
    expect(result.payload.count).toBe(1);
  });
});
