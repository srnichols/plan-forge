import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  REVIEW_SOURCES, REVIEW_SEVERITIES, REVIEW_STATUSES, REVIEW_RESOLUTIONS,
  ensureReviewQueueDirs, generateReviewItemId,
  readReviewItem, listReviewItems, readReviewQueueState,
  addReviewItem, resolveReviewItem,
} from "../orchestrator.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-review-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt) };
}

function fixedNow(dateStr = "2026-04-19T12:00:00Z") {
  return () => new Date(dateStr);
}

function addTestItem(dir, overrides = {}) {
  return addReviewItem(dir, {
    source: "crucible-stall",
    severity: "high",
    title: "Test review item",
    _nowFn: fixedNow(),
    ...overrides,
  });
}

// ─── ID Generation ──────────────────────────────────────────────────

describe("Review Item ID generation", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("generates review-YYYY-MM-DD-001 for first item", () => {
    const id = generateReviewItemId(dir, fixedNow("2026-04-19T12:00:00Z"));
    expect(id).toBe("review-2026-04-19-001");
  });

  it("increments sequence for same date", () => {
    const queueDir = ensureReviewQueueDirs(dir);
    writeFileSync(resolve(queueDir, "review-2026-04-19-001.json"), "{}");
    writeFileSync(resolve(queueDir, "review-2026-04-19-002.json"), "{}");
    const id = generateReviewItemId(dir, fixedNow("2026-04-19T12:00:00Z"));
    expect(id).toBe("review-2026-04-19-003");
  });

  it("resets sequence on date rollover", () => {
    const queueDir = ensureReviewQueueDirs(dir);
    writeFileSync(resolve(queueDir, "review-2026-04-19-005.json"), "{}");
    const id = generateReviewItemId(dir, fixedNow("2026-04-20T00:00:00Z"));
    expect(id).toBe("review-2026-04-20-001");
  });
});

// ─── Dir Helpers ─────────────────────────────────────────────────────

describe("ensureReviewQueueDirs", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates .forge/review-queue/ directory", () => {
    const result = ensureReviewQueueDirs(dir);
    expect(existsSync(result)).toBe(true);
    expect(result).toContain("review-queue");
  });
});

// ─── addReviewItem ──────────────────────────────────────────────────

describe("addReviewItem", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates a review item with correct fields", () => {
    const result = addTestItem(dir);
    expect(result._v).toBe(1);
    expect(result.itemId).toMatch(/^review-2026-04-19-\d{3}$/);
    expect(result.source).toBe("crucible-stall");
    expect(result.severity).toBe("high");
    expect(result.title).toBe("Test review item");
    expect(result.status).toBe("open");
    expect(result.resolvedAt).toBeNull();
    expect(result.resolvedBy).toBeNull();
    expect(result.resolution).toBeNull();
    expect(result.note).toBeNull();
  });

  it("rejects invalid source", () => {
    try {
      addReviewItem(dir, { source: "invalid", severity: "high", title: "test" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_INVALID_SOURCE");
    }
  });

  it("rejects invalid severity", () => {
    try {
      addReviewItem(dir, { source: "crucible-stall", severity: "critical", title: "test" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_INVALID_SEVERITY");
    }
  });

  it("rejects empty title", () => {
    try {
      addReviewItem(dir, { source: "crucible-stall", severity: "high", title: "" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_INVALID_TITLE");
    }
  });

  it("rejects string context", () => {
    try {
      addReviewItem(dir, { source: "crucible-stall", severity: "high", title: "test", context: "bad" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_INVALID_CONTEXT");
    }
  });

  it("broadcasts hub event on add", () => {
    const hub = makeHub();
    addReviewItem(dir, {
      source: "bug-classify", severity: "medium", title: "test hub",
      _nowFn: fixedNow(),
    }, hub);
    expect(hub.events).toHaveLength(1);
    expect(hub.events[0].type).toBe("review-queue-item-added");
    expect(hub.events[0].source).toBe("bug-classify");
    expect(hub.events[0].severity).toBe("medium");
  });
});

// ─── readReviewItem ─────────────────────────────────────────────────

describe("readReviewItem", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("reads an existing item", () => {
    const created = addTestItem(dir);
    const read = readReviewItem(dir, created.itemId);
    expect(read).toEqual(created);
  });

  it("returns null for missing item", () => {
    const result = readReviewItem(dir, "review-9999-01-01-999");
    expect(result).toBeNull();
  });
});

// ─── listReviewItems ────────────────────────────────────────────────

describe("listReviewItems", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("returns empty array when dir missing", () => {
    expect(listReviewItems(dir)).toEqual([]);
  });

  it("returns all items sorted by createdAt DESC", () => {
    addTestItem(dir, { _nowFn: fixedNow("2026-04-19T10:00:00Z") });
    addTestItem(dir, { _nowFn: fixedNow("2026-04-19T12:00:00Z") });
    addTestItem(dir, { _nowFn: fixedNow("2026-04-19T11:00:00Z") });
    const items = listReviewItems(dir);
    expect(items).toHaveLength(3);
    expect(items[0].createdAt > items[1].createdAt).toBe(true);
    expect(items[1].createdAt > items[2].createdAt).toBe(true);
  });

  it("filters by status", () => {
    const item = addTestItem(dir);
    resolveReviewItem(dir, { itemId: item.itemId, resolution: "approve", resolvedBy: "tester" });
    addTestItem(dir, { _nowFn: fixedNow("2026-04-19T13:00:00Z") });
    const openItems = listReviewItems(dir, { status: "open" });
    expect(openItems).toHaveLength(1);
    expect(openItems[0].status).toBe("open");
  });

  it("filters by source", () => {
    addTestItem(dir, { source: "crucible-stall" });
    addTestItem(dir, { source: "bug-classify", _nowFn: fixedNow("2026-04-19T13:00:00Z") });
    const items = listReviewItems(dir, { source: "bug-classify" });
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("bug-classify");
  });

  it("respects limit (clamped to max 500)", () => {
    for (let i = 0; i < 5; i++) {
      addTestItem(dir, { _nowFn: fixedNow(`2026-04-19T${String(10 + i).padStart(2, "0")}:00:00Z`) });
    }
    const items = listReviewItems(dir, { limit: 2 });
    expect(items).toHaveLength(2);
  });

  it("skips corrupt JSON files", () => {
    addTestItem(dir);
    const queueDir = resolve(dir, ".forge", "review-queue");
    writeFileSync(resolve(queueDir, "review-2026-04-19-999.json"), "NOT JSON{{{");
    const items = listReviewItems(dir);
    expect(items).toHaveLength(1);
  });

  it("filters by correlationId", () => {
    addTestItem(dir, { correlationId: "corr-123" });
    addTestItem(dir, { correlationId: "corr-456", _nowFn: fixedNow("2026-04-19T13:00:00Z") });
    const items = listReviewItems(dir, { correlationId: "corr-123" });
    expect(items).toHaveLength(1);
    expect(items[0].correlationId).toBe("corr-123");
  });
});

// ─── readReviewQueueState ───────────────────────────────────────────

describe("readReviewQueueState", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("returns null when dir missing", () => {
    expect(readReviewQueueState(dir)).toBeNull();
  });

  it("aggregates counts correctly", () => {
    addTestItem(dir, { severity: "blocker" });
    addTestItem(dir, { severity: "high", _nowFn: fixedNow("2026-04-19T13:00:00Z") });
    const item3 = addTestItem(dir, { severity: "medium", _nowFn: fixedNow("2026-04-19T14:00:00Z") });
    resolveReviewItem(dir, { itemId: item3.itemId, resolution: "defer", resolvedBy: "tester" });

    const state = readReviewQueueState(dir);
    expect(state.total).toBe(3);
    expect(state.open).toBe(2);
    expect(state.deferred).toBe(1);
    expect(state.resolved).toBe(0);
    expect(state.bySeverity.blocker).toBe(1);
    expect(state.bySeverity.high).toBe(1);
    expect(state.bySeverity.medium).toBe(1);
    expect(state.bySource["crucible-stall"]).toBe(3);
  });

  it("skips corrupt files without crashing", () => {
    addTestItem(dir);
    const queueDir = resolve(dir, ".forge", "review-queue");
    writeFileSync(resolve(queueDir, "review-corrupt.json"), "{{INVALID}}");
    const state = readReviewQueueState(dir);
    expect(state.total).toBe(1);
  });
});

// ─── resolveReviewItem ──────────────────────────────────────────────

describe("resolveReviewItem", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("resolves an open item with 'approve'", () => {
    const item = addTestItem(dir);
    const resolved = resolveReviewItem(dir, {
      itemId: item.itemId, resolution: "approve", resolvedBy: "engineer-1",
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toBe("approve");
    expect(resolved.resolvedBy).toBe("engineer-1");
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it("maps 'defer' resolution to 'deferred' status", () => {
    const item = addTestItem(dir);
    const resolved = resolveReviewItem(dir, {
      itemId: item.itemId, resolution: "defer", resolvedBy: "tester",
    });
    expect(resolved.status).toBe("deferred");
    expect(resolved.resolution).toBe("defer");
  });

  it("throws ERR_ALREADY_RESOLVED on double resolve", () => {
    const item = addTestItem(dir);
    resolveReviewItem(dir, { itemId: item.itemId, resolution: "approve", resolvedBy: "a" });
    try {
      resolveReviewItem(dir, { itemId: item.itemId, resolution: "reject", resolvedBy: "b" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_ALREADY_RESOLVED");
    }
  });

  it("throws ERR_ITEM_NOT_FOUND for missing item", () => {
    try {
      resolveReviewItem(dir, { itemId: "review-9999-01-01-999", resolution: "approve", resolvedBy: "a" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_ITEM_NOT_FOUND");
    }
  });

  it("throws ERR_INVALID_RESOLUTION for bad resolution", () => {
    const item = addTestItem(dir);
    try {
      resolveReviewItem(dir, { itemId: item.itemId, resolution: "cancel", resolvedBy: "a" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_INVALID_RESOLUTION");
    }
  });

  it("broadcasts hub event on resolve", () => {
    const hub = makeHub();
    const item = addTestItem(dir);
    resolveReviewItem(dir, {
      itemId: item.itemId, resolution: "approve", resolvedBy: "eng",
    }, hub);
    expect(hub.events).toHaveLength(1);
    expect(hub.events[0].type).toBe("review-queue-item-resolved");
    expect(hub.events[0].itemId).toBe(item.itemId);
    expect(hub.events[0].resolution).toBe("approve");
  });

  it("calls captureMemory on resolve (best-effort)", () => {
    const captured = [];
    const mockCapture = (content, type, source, cwd) => {
      captured.push({ content, type, source, cwd });
    };
    const item = addTestItem(dir);
    resolveReviewItem(dir, {
      itemId: item.itemId, resolution: "reject", resolvedBy: "reviewer",
    }, null, mockCapture);
    expect(captured).toHaveLength(1);
    expect(captured[0].type).toBe("decision");
    expect(captured[0].source).toBe("forge_review_resolve");
    expect(captured[0].content).toContain("reject");
    expect(captured[0].content).toContain("reviewer");
  });

  it("swallows captureMemory failure", () => {
    const item = addTestItem(dir);
    const throwingCapture = () => { throw new Error("capture boom"); };
    // Should not throw
    const result = resolveReviewItem(dir, {
      itemId: item.itemId, resolution: "approve", resolvedBy: "eng",
    }, null, throwingCapture);
    expect(result.status).toBe("resolved");
  });
});
