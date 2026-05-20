/**
 * forge-audit-export-mcp.test.mjs — MCP surface tests for forge_audit_export (#098).
 *
 * Covers:
 *   - Handler is exported from platform.mjs
 *   - Tool definition exists in TOOLS array with correct shape
 *   - forge_audit_export is in MCP_ONLY_TOOLS set
 *   - TOOL_METADATA entry exists with required fields
 *   - REST route GET /api/audit/export is registered in ROUTES array
 *   - Empty corpus returns { ok: true, records: [], total: 0, truncated: false, message }
 *   - Records are returned as parsed objects for json format
 *   - Pagination (limit) and truncated flag
 *   - type filter is respected
 *   - CSV format returns string rows with header
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `forge-audit-export-mcp-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function setupRun(cwd, runId, events) {
  const runDir = resolve(cwd, ".forge", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, "events.log"), events.join("\n") + "\n", "utf-8");
}

function makeEvent(type, ts, extra = {}) {
  return `[${ts}] ${type}: ${JSON.stringify(extra)}`;
}

// ─── Import surfaces ─────────────────────────────────────────────────

describe("forge_audit_export — handler registration", () => {
  it("is exported from platform.mjs", async () => {
    const mod = await import("../server/tool-handlers/platform.mjs");
    expect(typeof mod._callToolHandler_098_forge_audit_export).toBe("function");
  });

  it("is present in the TOOLS array (tool-definitions.mjs)", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const tool = TOOLS.find(t => t.name === "forge_audit_export");
    expect(tool).toBeDefined();
    expect(tool.description).toMatch(/audit/i);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.properties).toMatchObject({
      since: expect.objectContaining({ type: "string" }),
      until: expect.objectContaining({ type: "string" }),
      limit: expect.objectContaining({ type: "number" }),
      format: expect.objectContaining({ enum: ["json", "csv"] }),
    });
  });

  it("is in MCP_ONLY_TOOLS", async () => {
    const { MCP_ONLY_TOOLS } = await import("../server/tool-handlers.mjs");
    expect(MCP_ONLY_TOOLS.has("forge_audit_export")).toBe(true);
  });

  it("has a TOOL_METADATA entry with required fields", async () => {
    const { TOOL_METADATA } = await import("../capabilities/tool-metadata.mjs");
    const meta = TOOL_METADATA["forge_audit_export"];
    expect(meta).toBeDefined();
    expect(meta.addedIn).toBe("3.10.0");
    expect(Array.isArray(meta.intent)).toBe(true);
    expect(meta.intent).toContain("audit");
    expect(meta.cost).toBe("low");
    expect(meta.writesFiles).toBe(false);
    expect(meta.example?.input).toBeDefined();
    expect(meta.example?.output).toBeDefined();
  });

  it("has GET /api/audit/export in ROUTES array", async () => {
    const { REST_ROUTES } = await import("../server/rest-api.mjs");
    const route = REST_ROUTES.find(r => r.method === "GET" && r.path === "/api/audit/export");
    expect(route).toBeDefined();
  });
});

// ─── Handler behaviour ────────────────────────────────────────────────

describe("forge_audit_export — handler behaviour", () => {
  let cwd;

  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => cleanup(cwd));

  it("returns empty-state with message when .forge/runs/ does not exist", async () => {
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    const res = await _callToolHandler_098_forge_audit_export({ path: cwd });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.records).toEqual([]);
    expect(payload.total).toBe(0);
    expect(payload.truncated).toBe(false);
    expect(typeof payload.message).toBe("string");
    expect(payload.message.length).toBeGreaterThan(0);
  });

  it("returns records as parsed objects for json format", async () => {
    setupRun(cwd, "run-001", [
      makeEvent("slice-start", "2026-05-01T10:00:00.000Z", { slice: "1" }),
      makeEvent("gate-pass",   "2026-05-01T10:01:00.000Z", { slice: "1" }),
    ]);
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    const res = await _callToolHandler_098_forge_audit_export({ path: cwd, format: "json" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.format).toBe("json");
    expect(payload.total).toBe(2);
    expect(payload.truncated).toBe(false);
    expect(payload.records[0]).toMatchObject({ event_type: "slice-start", slice_id: "1" });
    expect(payload.records[1]).toMatchObject({ event_type: "gate-pass", slice_id: "1" });
  });

  it("respects type filter", async () => {
    setupRun(cwd, "run-002", [
      makeEvent("slice-start",    "2026-05-01T10:00:00.000Z"),
      makeEvent("gate-fail",      "2026-05-01T10:01:00.000Z"),
      makeEvent("slice-complete", "2026-05-01T10:02:00.000Z"),
    ]);
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    const res = await _callToolHandler_098_forge_audit_export({ path: cwd, type: ["gate-fail"] });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(1);
    expect(payload.records[0].event_type).toBe("gate-fail");
  });

  it("truncates at limit and sets truncated: true", async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent("tool-call", `2026-05-01T10:0${i}:00.000Z`),
    );
    setupRun(cwd, "run-003", events);
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    const res = await _callToolHandler_098_forge_audit_export({ path: cwd, limit: 3 });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(3);
    expect(payload.truncated).toBe(true);
    expect(payload.records).toHaveLength(3);
  });

  it("caps limit at 500", async () => {
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    // No runs, just verify it doesn't blow up with a huge limit
    const res = await _callToolHandler_098_forge_audit_export({ path: cwd, limit: 9999 });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(0);
  });

  it("returns CSV rows as strings for csv format", async () => {
    setupRun(cwd, "run-004", [
      makeEvent("gate-pass", "2026-05-01T10:00:00.000Z", { slice: "1" }),
    ]);
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    const res = await _callToolHandler_098_forge_audit_export({ path: cwd, format: "csv" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.format).toBe("csv");
    expect(Array.isArray(payload.records)).toBe(true);
    payload.records.forEach(row => expect(typeof row).toBe("string"));
    // First row should be the CSV header
    expect(payload.records[0]).toMatch(/ts|type|runId/i);
  });

  it("returns filters object in payload", async () => {
    const { _callToolHandler_098_forge_audit_export } = await import("../server/tool-handlers/platform.mjs");
    const res = await _callToolHandler_098_forge_audit_export({
      path: cwd, since: "2026-01-01", type: ["gate-pass"], format: "json", limit: 50,
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.filters).toMatchObject({
      since: "2026-01-01",
      type: ["gate-pass"],
      format: "json",
    });
  });
});
