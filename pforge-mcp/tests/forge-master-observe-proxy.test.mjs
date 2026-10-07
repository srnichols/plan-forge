/**
 * forge-master-observe-proxy.test.mjs — pforge-mcp's forge_master_observe proxy.
 *
 * The observer and its insight ring live in the Forge-Master studio child, so
 * pforge-mcp must forward every call to that child (no in-process fallback)
 * and fail with a structured FORGE_MASTER_UNAVAILABLE envelope when it can't.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../server/state.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  getOrSpawnStudioChild: vi.fn(),
  setStudioClient: vi.fn(),
}));

vi.mock("../orchestrator.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  emitToolTelemetry: vi.fn(),
}));

const { getOrSpawnStudioChild, setStudioClient } = await import("../server/state.mjs");
const { emitToolTelemetry } = await import("../orchestrator.mjs");
const {
  _callToolHandler_101_forge_master_observe: handler,
  _validateObserveArgs,
  OBSERVE_MAX_LIMIT,
} = await import("../server/tool-handlers/forge-master-observe.mjs");
const { _CALL_TOOL_NO_MATCH } = await import("../server/tool-handlers/shared.mjs");

const __dirname = dirname(fileURLToPath(import.meta.url));

function call(args) {
  return handler({ params: { name: "forge_master_observe", arguments: args } }, args);
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

function makeStudio(invokeImpl) {
  return { ready: true, invoke: vi.fn(invokeImpl), close: vi.fn().mockResolvedValue(undefined) };
}

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "pf-observe-proxy-"));
  vi.mocked(getOrSpawnStudioChild).mockReset();
  vi.mocked(setStudioClient).mockReset();
  vi.mocked(emitToolTelemetry).mockReset();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("forge_master_observe proxy — routing", () => {
  it("ignores other tool names", async () => {
    const result = await handler({ params: { name: "forge_master_ask" } }, {});
    expect(result).toBe(_CALL_TOOL_NO_MATCH);
    expect(getOrSpawnStudioChild).not.toHaveBeenCalled();
  });

  it("forwards status with limit and cursor verbatim to the studio child", async () => {
    const page = {
      ok: true,
      status: { connected: true, stopped: false },
      recentBatches: [],
      lastTurn: null,
      insights: { ok: true, insights: [], total: 0, limit: 5, cursor: "12", nextCursor: null, hasMore: false, truncated: false, message: "No observer insights yet." },
    };
    const studio = makeStudio(async () => page);
    vi.mocked(getOrSpawnStudioChild).mockResolvedValue(studio);

    const result = await call({ action: "status", limit: 5, cursor: "12", path: projectDir });

    expect(studio.invoke).toHaveBeenCalledTimes(1);
    const [toolName, proxyArgs] = studio.invoke.mock.calls[0];
    expect(toolName).toBe("forge_master_observe");
    expect(proxyArgs).toMatchObject({ action: "status", limit: 5, cursor: "12" });
    expect(typeof proxyArgs.path).toBe("string");
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toEqual(page);
    expect(setStudioClient).not.toHaveBeenCalled();
  });

  it("forwards start to the same studio client and emits telemetry", async () => {
    const studio = makeStudio(async () => ({ ok: true, message: "Observer started. Subscribing to hub events.", status: { stopped: false } }));
    vi.mocked(getOrSpawnStudioChild).mockResolvedValue(studio);

    const result = await call({ action: "start", sessionId: "claw-1", path: projectDir });

    expect(studio.invoke).toHaveBeenCalledWith("forge_master_observe", expect.objectContaining({ action: "start", sessionId: "claw-1" }));
    expect(parse(result)).toMatchObject({ ok: true });
    expect(emitToolTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "forge_master_observe",
      status: "OK",
      result: expect.objectContaining({ proxied: true, action: "start" }),
    }));
  });

  it("drops undeclared fields instead of forwarding them", async () => {
    const studio = makeStudio(async () => ({ ok: true }));
    vi.mocked(getOrSpawnStudioChild).mockResolvedValue(studio);

    await call({ action: "stop", extra: "nope", path: projectDir });

    const proxyArgs = studio.invoke.mock.calls[0][1];
    expect(Object.keys(proxyArgs).sort()).toEqual(["action", "path"]);
  });

  it("passes a healthy child's tool error through without resetting the client", async () => {
    const disabled = { ok: false, error: "observer-disabled", message: "Observer is disabled by PFORGE_FORGE_MASTER_OBSERVE_DISABLE=1." };
    const studio = makeStudio(async () => {
      throw new Error(`MCP tool error (forge_master_observe): ${JSON.stringify(disabled)}`);
    });
    vi.mocked(getOrSpawnStudioChild).mockResolvedValue(studio);

    const result = await call({ action: "start", path: projectDir });

    expect(result.isError).toBe(true);
    expect(parse(result)).toEqual(disabled);
    expect(setStudioClient).not.toHaveBeenCalled();
    expect(studio.close).not.toHaveBeenCalled();
  });
});

describe("forge_master_observe proxy — studio unavailable", () => {
  it("returns FORGE_MASTER_UNAVAILABLE and resets the client when the child cannot be spawned", async () => {
    vi.mocked(getOrSpawnStudioChild).mockResolvedValue(null);

    const result = await call({ action: "status", path: projectDir });

    expect(result.isError).toBe(true);
    const payload = parse(result);
    expect(payload).toMatchObject({ ok: false, error: "FORGE_MASTER_UNAVAILABLE" });
    expect(payload.message).toMatch(/pforge-master/);
    expect(payload.message).toMatch(/no in-process fallback/);
    expect(setStudioClient).toHaveBeenCalledWith(null);
    expect(emitToolTelemetry).toHaveBeenCalledWith(expect.objectContaining({ status: "ERROR", result: expect.objectContaining({ proxied: false }) }));
  });

  it("returns FORGE_MASTER_UNAVAILABLE and resets the client when the proxy call throws", async () => {
    const studio = makeStudio(async () => {
      throw new Error("Connection closed");
    });
    vi.mocked(getOrSpawnStudioChild).mockResolvedValue(studio);

    const result = await call({ action: "status", limit: 3, path: projectDir });

    expect(result.isError).toBe(true);
    const payload = parse(result);
    expect(payload).toMatchObject({ ok: false, error: "FORGE_MASTER_UNAVAILABLE" });
    expect(payload.message).toMatch(/Connection closed/);
    expect(payload.message).toMatch(/action:'start'/);
    expect(setStudioClient).toHaveBeenCalledWith(null);
    expect(studio.close).toHaveBeenCalled();
  });

  it("returns FORGE_MASTER_UNAVAILABLE when spawning itself throws", async () => {
    vi.mocked(getOrSpawnStudioChild).mockRejectedValue(new Error("spawn EACCES"));

    const result = await call({ action: "stop", path: projectDir });

    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ ok: false, error: "FORGE_MASTER_UNAVAILABLE", message: expect.stringMatching(/spawn EACCES/) });
  });
});

describe("forge_master_observe proxy — input validation", () => {
  const invalidCases = [
    ["missing action", {}, /action must be/],
    ["unknown action", { action: "pause" }, /action must be/],
    ["non-integer limit", { action: "status", limit: 2.5 }, /limit must be an integer/],
    ["limit below 1", { action: "status", limit: 0 }, /limit must be an integer/],
    ["limit above max", { action: "status", limit: OBSERVE_MAX_LIMIT + 1 }, /limit must be an integer/],
    ["string limit", { action: "status", limit: "5" }, /limit must be an integer/],
    ["numeric cursor", { action: "status", cursor: 12 }, /cursor must be/],
    ["empty cursor", { action: "status", cursor: "" }, /cursor must be/],
    ["oversized cursor", { action: "status", cursor: "9".repeat(64) }, /cursor must be/],
    ["non-string sessionId", { action: "start", sessionId: 7 }, /sessionId must be/],
    ["non-boolean detach", { action: "start", detach: "yes" }, /detach must be/],
    ["empty path", { action: "status", path: "" }, /path must be/],
  ];

  for (const [label, args, pattern] of invalidCases) {
    it(`rejects ${label} without touching the studio child`, async () => {
      const result = await call(args);
      expect(result.isError).toBe(true);
      const payload = parse(result);
      expect(payload).toMatchObject({ ok: false, error: "INVALID_INPUT" });
      expect(payload.message).toMatch(pattern);
      expect(getOrSpawnStudioChild).not.toHaveBeenCalled();
    });
  }

  it("rejects missing arguments", async () => {
    const result = await handler({ params: { name: "forge_master_observe" } }, undefined);
    expect(result.isError).toBe(true);
    expect(parse(result).error).toBe("INVALID_INPUT");
  });

  it("accepts the documented bounds", () => {
    expect(_validateObserveArgs({ action: "status", limit: 1, cursor: "1" })).toBeNull();
    expect(_validateObserveArgs({ action: "status", limit: OBSERVE_MAX_LIMIT })).toBeNull();
    expect(_validateObserveArgs({ action: "start", sessionId: "s", detach: false })).toBeNull();
  });
});

describe("Guard: pforge-mcp and pforge-master declare the same forge_master_observe schema", () => {
  it("keeps property names and property text identical", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const mcpSchema = TOOLS.find((tool) => tool.name === "forge_master_observe")?.inputSchema;
    expect(mcpSchema).toBeTruthy();
    expect(mcpSchema.required).toEqual(["action"]);
    expect(mcpSchema.properties.limit.maximum).toBe(OBSERVE_MAX_LIMIT);

    const source = readFileSync(join(__dirname, "../../pforge-master/server.mjs"), "utf8");
    const start = source.indexOf("const FORGE_MASTER_OBSERVE_TOOL = {");
    const end = source.indexOf("\n};", start);
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, end);
    const masterNames = [...block.matchAll(/^ {6}([A-Za-z]\w*):\s*\{/gm)].map((match) => match[1]).sort();
    expect(masterNames).toEqual(Object.keys(mcpSchema.properties).sort());
    for (const [name, property] of Object.entries(mcpSchema.properties)) {
      expect(block, `${name} description must match pforge-master`).toContain(`description: ${JSON.stringify(property.description)}`);
    }
  });
});
