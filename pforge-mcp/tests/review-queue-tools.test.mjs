import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

import { TOOL_METADATA } from "../capabilities.mjs";

// We read TOOLS and LIVEGUARD_TOOLS from server/orchestrator at test time
// but they are embedded — import the source arrays via a dynamic approach.
// Since TOOLS is a module-level const in server.mjs, we parse tools.json
// which is regenerated on validate.

// ─── Helpers ─────────────────────────────────────────────────────────

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-review-tools-"));
  mkdirSync(resolve(tempDir, ".git"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Tool Registration ──────────────────────────────────────────────

describe("Review Queue tool registration", () => {
  it("forge_review_add has TOOL_METADATA entry", () => {
    expect(TOOL_METADATA.forge_review_add).toBeDefined();
    expect(TOOL_METADATA.forge_review_add.addedIn).toBe("2.49.0");
    expect(TOOL_METADATA.forge_review_add.writesFiles).toBe(true);
    expect(TOOL_METADATA.forge_review_add.cost).toBe("low");
  });

  it("forge_review_list has TOOL_METADATA entry", () => {
    expect(TOOL_METADATA.forge_review_list).toBeDefined();
    expect(TOOL_METADATA.forge_review_list.addedIn).toBe("2.49.0");
    expect(TOOL_METADATA.forge_review_list.writesFiles).toBe(false);
  });

  it("forge_review_resolve has TOOL_METADATA entry", () => {
    expect(TOOL_METADATA.forge_review_resolve).toBeDefined();
    expect(TOOL_METADATA.forge_review_resolve.addedIn).toBe("2.49.0");
    expect(TOOL_METADATA.forge_review_resolve.writesFiles).toBe(true);
  });

  it("forge_review_add TOOL_METADATA has expected error codes", () => {
    const errors = TOOL_METADATA.forge_review_add.errors;
    expect(errors.ERR_INVALID_SOURCE).toBeDefined();
    expect(errors.ERR_INVALID_SEVERITY).toBeDefined();
    expect(errors.ERR_INVALID_TITLE).toBeDefined();
    expect(errors.ERR_INVALID_CONTEXT).toBeDefined();
  });

  it("forge_review_resolve TOOL_METADATA has expected error codes", () => {
    const errors = TOOL_METADATA.forge_review_resolve.errors;
    expect(errors.ERR_ITEM_NOT_FOUND).toBeDefined();
    expect(errors.ERR_ALREADY_RESOLVED).toBeDefined();
    expect(errors.ERR_INVALID_RESOLUTION).toBeDefined();
    expect(errors.ERR_INVALID_RESOLVED_BY).toBeDefined();
  });
});

// ─── Orchestrator-level functional tests via imported functions ──────

import {
  addReviewItem, resolveReviewItem, listReviewItems,
  readReviewQueueState, REVIEW_SOURCES, REVIEW_SEVERITIES,
} from "../orchestrator.mjs";

describe("forge_review_add handler behavior", () => {
  it("happy path: creates item and returns record", () => {
    const result = addReviewItem(tempDir, {
      source: "crucible-stall",
      severity: "high",
      title: "Stalled smelt requires attention",
      context: { smeltId: "smelt-001" },
      correlationId: "corr-abc",
    });
    expect(result.itemId).toMatch(/^review-/);
    expect(result.status).toBe("open");
    expect(result.context).toEqual({ smeltId: "smelt-001" });
    expect(result.correlationId).toBe("corr-abc");
  });

  it("returns structured error envelope for invalid source", () => {
    try {
      addReviewItem(tempDir, { source: "unknown", severity: "high", title: "t" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_INVALID_SOURCE");
      expect(err.message).toContain("Invalid source");
    }
  });

  it("hub event has correct payload shape", () => {
    const events = [];
    const hub = { broadcast: (e) => events.push(e) };
    const result = addReviewItem(tempDir, {
      source: "bug-classify",
      severity: "medium",
      title: "Needs human classification",
    }, hub);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "review-queue-item-added",
      itemId: result.itemId,
      source: "bug-classify",
      severity: "medium",
    });
    expect(events[0].timestamp).toBeDefined();
  });
});

describe("forge_review_list handler behavior", () => {
  it("returns items with correct filter behavior", () => {
    addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: "a" });
    addReviewItem(tempDir, { source: "bug-classify", severity: "low", title: "b" });
    const all = listReviewItems(tempDir);
    expect(all).toHaveLength(2);
    const filtered = listReviewItems(tempDir, { severity: "low" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].severity).toBe("low");
  });

  it("returns empty state gracefully", () => {
    const items = listReviewItems(tempDir);
    expect(items).toEqual([]);
  });

  it("pagination clamp works", () => {
    for (let i = 0; i < 3; i++) {
      addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: `item-${i}` });
    }
    const items = listReviewItems(tempDir, { limit: 2 });
    expect(items).toHaveLength(2);
  });
});

describe("forge_review_resolve handler behavior", () => {
  it("happy path: resolves item", () => {
    const item = addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: "test" });
    const result = resolveReviewItem(tempDir, {
      itemId: item.itemId, resolution: "approve", resolvedBy: "engineer",
    });
    expect(result.status).toBe("resolved");
    expect(result.resolution).toBe("approve");
  });

  it("ERR_ALREADY_RESOLVED on double resolve", () => {
    const item = addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: "test" });
    resolveReviewItem(tempDir, { itemId: item.itemId, resolution: "approve", resolvedBy: "a" });
    try {
      resolveReviewItem(tempDir, { itemId: item.itemId, resolution: "reject", resolvedBy: "b" });
      expect.unreachable("should throw");
    } catch (err) {
      expect(err.code).toBe("ERR_ALREADY_RESOLVED");
    }
  });

  it("hub event payload is correct on resolve", () => {
    const events = [];
    const hub = { broadcast: (e) => events.push(e) };
    const item = addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: "test" });
    resolveReviewItem(tempDir, {
      itemId: item.itemId, resolution: "reject", resolvedBy: "reviewer",
    }, hub);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "review-queue-item-resolved",
      itemId: item.itemId,
      resolution: "reject",
      resolvedBy: "reviewer",
    });
  });

  it("captureMemory is called with structured tags (no note)", () => {
    const captured = [];
    const mockCapture = (content, type, source, cwd) => {
      captured.push({ content, type, source, cwd });
    };
    const item = addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: "test" });
    resolveReviewItem(tempDir, {
      itemId: item.itemId, resolution: "approve", resolvedBy: "eng",
      note: "This is a free-text note that should NOT appear in memory",
    }, null, mockCapture);
    expect(captured).toHaveLength(1);
    expect(captured[0].content).not.toContain("free-text note");
    expect(captured[0].content).toContain("approve");
    expect(captured[0].content).toContain("eng");
    expect(captured[0].type).toBe("decision");
    expect(captured[0].source).toBe("forge_review_resolve");
  });

  it("captureMemory failure is swallowed", () => {
    const item = addReviewItem(tempDir, { source: "crucible-stall", severity: "high", title: "test" });
    const result = resolveReviewItem(tempDir, {
      itemId: item.itemId, resolution: "approve", resolvedBy: "eng",
    }, null, () => { throw new Error("boom"); });
    expect(result.status).toBe("resolved");
  });
});

// ─── Telemetry ──────────────────────────────────────────────────────

import { emitToolTelemetry } from "../orchestrator.mjs";

describe("Review Queue telemetry", () => {
  it("emitToolTelemetry writes to tool-calls.jsonl for review tools", () => {
    emitToolTelemetry("forge_review_add", { source: "crucible-stall" }, { ok: true }, 42, "OK", tempDir);
    const telPath = resolve(tempDir, ".forge", "telemetry", "tool-calls.jsonl");
    expect(existsSync(telPath)).toBe(true);
    const line = readFileSync(telPath, "utf-8").trim();
    const record = JSON.parse(line);
    expect(record.tool).toBe("forge_review_add");
    expect(record.durationMs).toBe(42);
  });

  it("emitToolTelemetry writes to liveguard-events.jsonl for review tools", () => {
    emitToolTelemetry("forge_review_list", {}, { count: 0 }, 10, "OK", tempDir);
    const lgPath = resolve(tempDir, ".forge", "liveguard-events.jsonl");
    expect(existsSync(lgPath)).toBe(true);
    const line = readFileSync(lgPath, "utf-8").trim();
    const record = JSON.parse(line);
    expect(record.tool).toBe("forge_review_list");
  });

  it("emitToolTelemetry writes liveguard events for forge_review_resolve", () => {
    emitToolTelemetry("forge_review_resolve", {}, {}, 5, "OK", tempDir);
    const lgPath = resolve(tempDir, ".forge", "liveguard-events.jsonl");
    expect(existsSync(lgPath)).toBe(true);
    const lines = readFileSync(lgPath, "utf-8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.tool).toBe("forge_review_resolve");
  });
});
