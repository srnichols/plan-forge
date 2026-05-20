/**
 * local-recall-status.test.mjs — Tests for forge_local_recall_status MCP tool (Phase 58)
 *
 * Covers:
 *   - forge_local_recall_status: handler export and no-match guard
 *   - forge_local_recall_status: tool definition (TOOLS array, inputSchema)
 *   - forge_local_recall_status: MCP_ONLY_TOOLS membership
 *   - forge_local_recall_status: tool-metadata entry
 *   - GET /api/local-recall/status: REST route registration
 *   - forge_local_recall_status: status subcommand (no index, fresh, stale)
 *   - forge_local_recall_status: clear subcommand
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `lr-status-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeThought(tmpDir, content = "test thought") {
  const forgeDir = resolve(tmpDir, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  const rec = JSON.stringify({ content, source: "test", createdAt: new Date().toISOString() });
  writeFileSync(resolve(forgeDir, "openbrain-queue.jsonl"), rec + "\n", "utf-8");
}

// ─── forge_local_recall_status handler export ─────────────────────────────────

describe("forge_local_recall_status handler", () => {
  it("exports _callToolHandler_097_forge_local_recall_status", async () => {
    const mod = await import("../server/tool-handlers/platform.mjs");
    expect(typeof mod._callToolHandler_097_forge_local_recall_status).toBe("function");
  });

  it("returns _CALL_TOOL_NO_MATCH for unrelated tool names", async () => {
    const { _callToolHandler_097_forge_local_recall_status } = await import("../server/tool-handlers/platform.mjs");
    const { _CALL_TOOL_NO_MATCH } = await import("../server/tool-handlers/shared.mjs");
    const result = await _callToolHandler_097_forge_local_recall_status(
      { params: { name: "forge_smith" } }, {}
    );
    expect(result).toBe(_CALL_TOOL_NO_MATCH);
  });
});

// ─── forge_local_recall_status tool definition ───────────────────────────────

describe("forge_local_recall_status tool definition", () => {
  it("is present in TOOLS array", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const tool = TOOLS.find(t => t.name === "forge_local_recall_status");
    expect(tool).toBeDefined();
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(20);
  });

  it("has inputSchema with optional subcommand and path properties", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const tool = TOOLS.find(t => t.name === "forge_local_recall_status");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toHaveProperty("subcommand");
    expect(tool.inputSchema.properties).toHaveProperty("path");
  });

  it("subcommand enum includes status, warm, clear", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const tool = TOOLS.find(t => t.name === "forge_local_recall_status");
    const enums = tool.inputSchema.properties.subcommand.enum;
    expect(enums).toContain("status");
    expect(enums).toContain("warm");
    expect(enums).toContain("clear");
  });

  it("does not have required fields", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const tool = TOOLS.find(t => t.name === "forge_local_recall_status");
    expect(tool.inputSchema.required).toBeUndefined();
  });
});

// ─── MCP_ONLY_TOOLS membership ────────────────────────────────────────────────

describe("MCP_ONLY_TOOLS forge_local_recall_status", () => {
  it("contains forge_local_recall_status", async () => {
    const { MCP_ONLY_TOOLS } = await import("../server/tool-handlers.mjs");
    expect(MCP_ONLY_TOOLS.has("forge_local_recall_status")).toBe(true);
  });
});

// ─── tool-metadata entry ──────────────────────────────────────────────────────

describe("forge_local_recall_status tool metadata", () => {
  it("has a TOOL_METADATA entry", async () => {
    const { TOOL_METADATA } = await import("../capabilities/tool-metadata.mjs");
    expect(TOOL_METADATA).toHaveProperty("forge_local_recall_status");
  });

  it("metadata has required shape", async () => {
    const { TOOL_METADATA } = await import("../capabilities/tool-metadata.mjs");
    const meta = TOOL_METADATA.forge_local_recall_status;
    expect(meta.intent).toBeInstanceOf(Array);
    expect(meta.intent).toContain("local-recall");
    expect(meta.cost).toBe("low");
    expect(meta.network).toBe(false);
  });

  it("example output has all required fields", async () => {
    const { TOOL_METADATA } = await import("../capabilities/tool-metadata.mjs");
    const example = TOOL_METADATA.forge_local_recall_status.example.output;
    expect(example).toHaveProperty("ok", true);
    expect(example).toHaveProperty("indexExists");
    expect(example).toHaveProperty("corpusSize");
    expect(example).toHaveProperty("staleness");
    expect(example).toHaveProperty("message");
  });
});

// ─── REST API route registration ──────────────────────────────────────────────

describe("GET /api/local-recall/status REST route registration", () => {
  it("is listed in the REST_ROUTES array", async () => {
    const { REST_ROUTES } = await import("../server/rest-api.mjs");
    const found = REST_ROUTES.find(r => r.method === "GET" && r.path === "/api/local-recall/status");
    expect(found).toBeDefined();
  });
});

// ─── getIndexStatus behavior ──────────────────────────────────────────────────

describe("getIndexStatus", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns exists:false when no cache file exists", async () => {
    const { getIndexStatus } = await import("../local-recall.mjs");
    const status = getIndexStatus(tmpDir);
    expect(status.exists).toBe(false);
    expect(status.version).toBeNull();
    expect(status.corpusSize).toBeNull();
    expect(status.stale).toBeNull();
  });

  it("returns exists:true with corpus size after index is built", async () => {
    writeThought(tmpDir);
    const { searchLocalThoughts, getIndexStatus } = await import("../local-recall.mjs");
    await searchLocalThoughts("test", { cwd: tmpDir, limit: 1, forceBackend: "tfidf" });
    const status = getIndexStatus(tmpDir);
    expect(status.exists).toBe(true);
    expect(status.corpusSize).toBeGreaterThanOrEqual(1);
    expect(status.stale).toBe(false);
    expect(typeof status.builtAt).toBe("string");
  });
});

// ─── clearPersistedIndex behavior ────────────────────────────────────────────

describe("clearPersistedIndex", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("is non-fatal when no cache file exists", async () => {
    const { clearPersistedIndex } = await import("../local-recall.mjs");
    expect(() => clearPersistedIndex(tmpDir)).not.toThrow();
  });

  it("removes the cache file when it exists", async () => {
    writeThought(tmpDir);
    const { searchLocalThoughts, clearPersistedIndex, getIndexStatus } = await import("../local-recall.mjs");
    await searchLocalThoughts("test", { cwd: tmpDir, limit: 1, forceBackend: "tfidf" });
    expect(getIndexStatus(tmpDir).exists).toBe(true);
    clearPersistedIndex(tmpDir);
    expect(getIndexStatus(tmpDir).exists).toBe(false);
  });
});

// ─── forge_local_recall_status status/clear subcommands (integration) ─────────

describe("forge_local_recall_status status subcommand", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns ok:true and indexExists:false when no index built", async () => {
    const { _callToolHandler_097_forge_local_recall_status } = await import("../server/tool-handlers/platform.mjs");
    const result = await _callToolHandler_097_forge_local_recall_status(
      { params: { name: "forge_local_recall_status" } },
      { path: tmpDir }
    );
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.indexExists).toBe(false);
    expect(typeof parsed.message).toBe("string");
  });
});

describe("forge_local_recall_status clear subcommand", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns ok:true and action:cleared", async () => {
    const { _callToolHandler_097_forge_local_recall_status } = await import("../server/tool-handlers/platform.mjs");
    const result = await _callToolHandler_097_forge_local_recall_status(
      { params: { name: "forge_local_recall_status" } },
      { subcommand: "clear", path: tmpDir }
    );
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed.action).toBe("cleared");
  });
});
