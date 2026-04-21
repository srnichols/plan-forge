/**
 * Tests for forge-master MCP client proxy (Phase-29).
 * Tests createMcpClient factory, McpClient class, and createDispatcher.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpClient, createMcpClient, BASE_TOOL_COUNT_MIN } from "../src/mcp-client.mjs";
import { createDispatcher } from "../src/tool-bridge.mjs";
import { BASE_ALLOWLIST } from "../src/allowlist.mjs";

// ─── McpClient unit tests (class constructor + property tests) ───────

describe("McpClient", () => {
  it("is not ready before connect", () => {
    const client = new McpClient();
    expect(client.ready).toBe(false);
  });

  it("has zero toolCount before connect", () => {
    const client = new McpClient();
    expect(client.toolCount).toBe(0);
  });

  it("has empty toolNames before connect", () => {
    const client = new McpClient();
    expect(client.toolNames).toEqual([]);
  });

  it("hasTool returns false before connect", () => {
    const client = new McpClient();
    expect(client.hasTool("forge_plan_status")).toBe(false);
  });

  it("close() is idempotent when not connected", async () => {
    const client = new McpClient();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it("invoke throws when not connected", async () => {
    const client = new McpClient();
    await expect(client.invoke("test_tool", {})).rejects.toThrow("not connected");
  });

  it("close() resets ready state after manual ready override", async () => {
    const client = new McpClient();
    // Can't actually set ready externally, but close() should be safe
    await client.close();
    expect(client.ready).toBe(false);
    expect(client.toolCount).toBe(0);
    expect(client.toolNames).toEqual([]);
  });

  it("accepts custom logger", () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const client = new McpClient({ logger });
    // Constructor should not throw
    expect(client.ready).toBe(false);
  });

  it("connect throws when serverPath does not exist", async () => {
    const client = new McpClient({ logger: { log: vi.fn(), warn: vi.fn() } });
    await expect(
      client.connect({ serverPath: "/nonexistent/path/server.mjs" }),
    ).rejects.toThrow("downstream MCP server not found");
  });
});

// ─── BASE_TOOL_COUNT_MIN ─────────────────────────────────────────────

describe("BASE_TOOL_COUNT_MIN", () => {
  it("equals BASE_ALLOWLIST length", () => {
    expect(BASE_TOOL_COUNT_MIN).toBe(BASE_ALLOWLIST.length);
  });

  it("is a positive integer", () => {
    expect(BASE_TOOL_COUNT_MIN).toBeGreaterThan(0);
    expect(Number.isInteger(BASE_TOOL_COUNT_MIN)).toBe(true);
  });
});

// ─── createMcpClient error handling ─────────────────────────────────

describe("createMcpClient", () => {
  it("throws when serverPath does not exist", async () => {
    await expect(
      createMcpClient({ serverPath: "/nonexistent/path/server.mjs" }),
    ).rejects.toThrow();
  });
});

// ─── createDispatcher ────────────────────────────────────────────────

describe("createDispatcher", () => {
  it("throws when transport is not provided", () => {
    expect(() => createDispatcher()).toThrow("transport is required");
    expect(() => createDispatcher({})).toThrow("transport is required");
  });

  it("returns a function", () => {
    const d = createDispatcher({ transport: "inprocess", fallbackDispatcher: vi.fn() });
    expect(typeof d).toBe("function");
  });

  describe("transport: inprocess", () => {
    it("routes to fallbackDispatcher", async () => {
      const fallback = vi.fn().mockResolvedValue({ ok: true });
      const d = createDispatcher({ transport: "inprocess", fallbackDispatcher: fallback });
      const result = await d("forge_plan_status", { plan: "test" }, "/cwd");
      expect(fallback).toHaveBeenCalledWith("forge_plan_status", { plan: "test" }, "/cwd");
      expect(result).toEqual({ ok: true });
    });

    it("throws when no fallbackDispatcher is provided", async () => {
      const d = createDispatcher({ transport: "inprocess" });
      await expect(d("forge_status")).rejects.toThrow("no dispatcher available");
    });

    it("ignores mcpClient even if provided and ready", async () => {
      const mcpClient = { ready: true, hasTool: () => true, invoke: vi.fn() };
      const fallback = vi.fn().mockResolvedValue("inprocess-result");
      const d = createDispatcher({ transport: "inprocess", mcpClient, fallbackDispatcher: fallback });
      const result = await d("forge_status");
      expect(fallback).toHaveBeenCalled();
      expect(mcpClient.invoke).not.toHaveBeenCalled();
      expect(result).toBe("inprocess-result");
    });

    it("preserves cwd argument on fallback path", async () => {
      const fallback = vi.fn().mockResolvedValue("ok");
      const d = createDispatcher({ transport: "inprocess", fallbackDispatcher: fallback });
      await d("forge_smith", {}, "/my/project");
      expect(fallback).toHaveBeenCalledWith("forge_smith", {}, "/my/project");
    });
  });

  describe("transport: mcp", () => {
    it("routes to mcpClient.invoke when client is ready and has the tool", async () => {
      const mcpClient = {
        ready: true,
        hasTool: vi.fn().mockReturnValue(true),
        invoke: vi.fn().mockResolvedValue({ status: "ok" }),
      };
      const d = createDispatcher({ transport: "mcp", mcpClient });
      const result = await d("forge_plan_status", { plan: "test" });
      expect(mcpClient.hasTool).toHaveBeenCalledWith("forge_plan_status");
      expect(mcpClient.invoke).toHaveBeenCalledWith("forge_plan_status", { plan: "test" });
      expect(result).toEqual({ status: "ok" });
    });

    it("falls back to in-process when mcpClient is not ready", async () => {
      const mcpClient = { ready: false, hasTool: vi.fn(), invoke: vi.fn() };
      const fallback = vi.fn().mockResolvedValue("fallback-result");
      const d = createDispatcher({ transport: "mcp", mcpClient, fallbackDispatcher: fallback });
      const result = await d("forge_status");
      expect(mcpClient.invoke).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalled();
      expect(result).toBe("fallback-result");
    });

    it("falls back to in-process when mcpClient is null", async () => {
      const fallback = vi.fn().mockResolvedValue("fallback");
      const d = createDispatcher({ transport: "mcp", mcpClient: null, fallbackDispatcher: fallback });
      const result = await d("forge_status");
      expect(result).toBe("fallback");
    });

    it("falls back to in-process when mcpClient does not have the tool", async () => {
      const mcpClient = {
        ready: true,
        hasTool: vi.fn().mockReturnValue(false),
        invoke: vi.fn(),
      };
      const fallback = vi.fn().mockResolvedValue("fallback-for-missing");
      const d = createDispatcher({ transport: "mcp", mcpClient, fallbackDispatcher: fallback });
      const result = await d("unknown_tool", { x: 1 });
      expect(mcpClient.invoke).not.toHaveBeenCalled();
      expect(fallback).toHaveBeenCalledWith("unknown_tool", { x: 1 }, undefined);
      expect(result).toBe("fallback-for-missing");
    });

    it("throws when tool is missing on MCP and no fallback", async () => {
      const mcpClient = {
        ready: true,
        hasTool: vi.fn().mockReturnValue(false),
        invoke: vi.fn(),
      };
      const d = createDispatcher({ transport: "mcp", mcpClient });
      await expect(d("missing_tool")).rejects.toThrow("not found on downstream MCP");
    });

    it("throws when mcpClient not ready and no fallback", async () => {
      const mcpClient = { ready: false, hasTool: vi.fn(), invoke: vi.fn() };
      const d = createDispatcher({ transport: "mcp", mcpClient });
      await expect(d("forge_status")).rejects.toThrow("no dispatcher available");
    });

    it("propagates MCP invoke errors", async () => {
      const mcpClient = {
        ready: true,
        hasTool: vi.fn().mockReturnValue(true),
        invoke: vi.fn().mockRejectedValue(new Error("MCP connection lost")),
      };
      const d = createDispatcher({ transport: "mcp", mcpClient });
      await expect(d("forge_status")).rejects.toThrow("MCP connection lost");
    });

    it("defaults args to empty object", async () => {
      const mcpClient = {
        ready: true,
        hasTool: vi.fn().mockReturnValue(true),
        invoke: vi.fn().mockResolvedValue("ok"),
      };
      const d = createDispatcher({ transport: "mcp", mcpClient });
      await d("forge_status");
      expect(mcpClient.invoke).toHaveBeenCalledWith("forge_status", {});
    });
  });
});
