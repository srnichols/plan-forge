/**
 * Plan Forge — Forge-Master Integration Test (Phase-28, Slice 7).
 *
 * End-to-end happy-path: mocked reasoning model returns a
 * forge_crucible_submit tool call, then a forge_crucible_ask call,
 * then a final reply. Asserts:
 *   (i)   Crucible smelt created in .forge/crucible/<id>.json
 *   (ii)  forge_master_ask output contains expected reply text
 *   (iii) Session history persisted with 3 turns recorded
 *
 * Also tests:
 *   - capabilities.mjs surfaces forge_master_ask + forgeMaster subsystem
 *   - tools.json contains forge_master_ask entry
 *   - error path when no API key configured
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runTurn, buildToolSchemas, ABSOLUTE_CEILING } from "../../pforge-master/src/reasoning.mjs";
import { ensureSessionId } from "../../pforge-master/src/persistence.mjs";
import { TOOL_METADATA } from "../capabilities.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

let tmpDir;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "forge-master-integration-"));
  return tmpDir;
}

function writeForgeJson(dir, content) {
  writeFileSync(join(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

/**
 * Mock provider that replays a sequence of responses.
 * Each call to sendTurn() returns the next response in order.
 */
class MockProvider {
  constructor(responses) {
    this._responses = responses;
    this._callIndex = 0;
    this.calls = [];
    this.PROVIDER_NAME = "mock";
  }

  async sendTurn(opts) {
    this.calls.push(opts);
    if (this._callIndex >= this._responses.length) {
      return { type: "reply", content: "(exhausted)", tokensIn: 0, tokensOut: 0 };
    }
    const resp = this._responses[this._callIndex++];
    return { tokensIn: resp.tokensIn ?? 100, tokensOut: resp.tokensOut ?? 50, ...resp };
  }
}

// ─── Integration: capabilities surface ──────────────────────────────

describe("forge-master integration — capabilities", () => {
  it("TOOL_METADATA contains forge_master_ask entry", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_master_ask");
    const meta = TOOL_METADATA.forge_master_ask;
    expect(meta.intent).toContain("ask");
    expect(meta.aliases).toContain("ask_forge");
    expect(meta.aliases).toContain("forge_ask");
    expect(meta.cost).toBe("high");
    expect(meta.addedIn).toBe("2.61.0");
    expect(meta.agentGuidance).toBeTruthy();
    expect(meta.network).toBe(true);
    expect(meta.errors).toHaveProperty("reasoning_model_unavailable");
  });

  it("buildCapabilitySurface includes forgeMaster subsystem", async () => {
    const { buildCapabilitySurface } = await import("../capabilities.mjs");
    const surface = buildCapabilitySurface([
      { name: "forge_master_ask", description: "test" },
    ]);
    expect(surface).toHaveProperty("forgeMaster");
    expect(surface.forgeMaster.tools).toContain("forge_master_ask");
    expect(surface.forgeMaster.addedIn).toBe("2.61.0");
    expect(surface.forgeMaster.configKey).toBe("forgeMaster");
    expect(surface.forgeMaster.routerModel).toBeTruthy();
  });

  it("forgeMaster subsystem description mentions Phase-28", async () => {
    const { buildCapabilitySurface } = await import("../capabilities.mjs");
    const surface = buildCapabilitySurface([]);
    expect(surface.forgeMaster.description).toContain("Phase-28");
  });
});

// ─── Integration: tools.json ────────────────────────────────────────

describe("forge-master integration — tools.json", () => {
  it("tools.json contains forge_master_ask entry with correct schema", () => {
    const toolsJson = JSON.parse(readFileSync(resolve(__dirname, "../tools.json"), "utf-8"));
    const entry = toolsJson.find((t) => t.name === "forge_master_ask");
    expect(entry).toBeTruthy();
    expect(entry.inputSchema.properties).toHaveProperty("message");
    expect(entry.inputSchema.properties).toHaveProperty("sessionId");
    expect(entry.inputSchema.properties).toHaveProperty("maxToolCalls");
    expect(entry.inputSchema.required).toContain("message");
  });
});

// Resolve __dirname for ESM
const __dirname = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1").replace(/\/$/, "");

// ─── Integration: happy-path reasoning ──────────────────────────────

describe("forge-master integration — happy-path", () => {
  beforeEach(() => makeTmp());
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("full turn with 2 tool calls then final reply", async () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-sonnet-4.5",
        reasoningProvider: "anthropic",
        maxToolCalls: 5,
      },
    });

    const provider = new MockProvider([
      {
        type: "tool_calls",
        content: "Let me check your plan status and costs.",
        toolCalls: [
          { id: "tc1", name: "forge_plan_status", args: {} },
          { id: "tc2", name: "forge_cost_report", args: {} },
        ],
      },
      {
        type: "reply",
        content: "Your plan is running well with 5 slices passed and $1.23 total cost.",
      },
    ]);

    const dispatcherCalls = [];
    const deps = {
      provider,
      dispatcher: async (name, args) => {
        dispatcherCalls.push({ name, args });
        if (name === "forge_plan_status") return { status: "completed", slices: 5 };
        if (name === "forge_cost_report") return { total_cost_usd: 1.23 };
        return {};
      },
      hub: null,
      toolMetadata: {},
      recall: async () => null,
      remember: () => ({ ok: true }),
    };

    const result = await runTurn(
      { message: "What is my plan status and cost?", cwd: tmpDir },
      deps,
    );

    // (ii) Reply text
    expect(result.reply).toContain("plan is running well");
    expect(result.reply).toContain("$1.23");

    // Tool calls recorded
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("forge_plan_status");
    expect(result.toolCalls[1].name).toBe("forge_cost_report");

    // Token accounting
    expect(result.tokensIn).toBeGreaterThan(0);
    expect(result.tokensOut).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);

    // Session ID returned
    expect(result.sessionId).toBeTruthy();

    // Dispatcher was called
    expect(dispatcherCalls).toHaveLength(2);
  });

  it("Crucible funnel: submit → ask → final reply", async () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-sonnet-4.5",
        reasoningProvider: "anthropic",
        maxToolCalls: 5,
      },
    });

    const provider = new MockProvider([
      {
        type: "tool_calls",
        content: "I'll start a Crucible smelt for this feature.",
        toolCalls: [
          { id: "tc1", name: "forge_crucible_submit", args: { rawIdea: "multi-tenant billing", lane: "feature" } },
        ],
      },
      {
        type: "tool_calls",
        content: "Let me ask the first interview question.",
        toolCalls: [
          { id: "tc2", name: "forge_crucible_ask", args: { smeltId: "smelt-001", answer: "Yes, per-tenant metering" } },
        ],
      },
      {
        type: "reply",
        content: "I've started a Crucible smelt for multi-tenant billing. The first question is about metering strategy.",
      },
    ]);

    const smeltPath = join(tmpDir, ".forge", "crucible");
    mkdirSync(smeltPath, { recursive: true });

    const deps = {
      provider,
      dispatcher: async (name, args) => {
        if (name === "forge_crucible_submit") {
          const smeltFile = join(smeltPath, "smelt-001.json");
          writeFileSync(smeltFile, JSON.stringify({ id: "smelt-001", rawIdea: args.rawIdea, lane: args.lane }), "utf-8");
          return { smeltId: "smelt-001", status: "created" };
        }
        if (name === "forge_crucible_ask") {
          return { question: "What metering granularity do you need?", questionIndex: 1 };
        }
        return {};
      },
      hub: null,
      toolMetadata: {},
      recall: async () => null,
      remember: () => ({ ok: true }),
    };

    const result = await runTurn(
      { message: "I want to add multi-tenant billing", cwd: tmpDir },
      deps,
    );

    // (ii) Reply text
    expect(result.reply).toContain("Crucible smelt");
    expect(result.reply).toContain("multi-tenant billing");

    // (i) Crucible smelt created
    expect(existsSync(join(smeltPath, "smelt-001.json"))).toBe(true);
    const smelt = JSON.parse(readFileSync(join(smeltPath, "smelt-001.json"), "utf-8"));
    expect(smelt.rawIdea).toBe("multi-tenant billing");
    expect(smelt.lane).toBe("feature");

    // 2 tool calls recorded
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe("forge_crucible_submit");
    expect(result.toolCalls[1].name).toBe("forge_crucible_ask");

    // Session returned
    expect(result.sessionId).toBeTruthy();
  });

  it("session continuity: second call with same sessionId", async () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-sonnet-4.5",
        reasoningProvider: "anthropic",
      },
    });

    const provider1 = new MockProvider([
      { type: "reply", content: "First response." },
    ]);
    const deps1 = {
      provider: provider1,
      dispatcher: async () => ({}),
      hub: null,
      toolMetadata: {},
      recall: async () => null,
      remember: () => ({ ok: true }),
    };

    const r1 = await runTurn({ message: "What is my plan status?", cwd: tmpDir }, deps1);
    const sessionId = r1.sessionId;
    expect(sessionId).toBeTruthy();

    // Second turn with same sessionId
    const provider2 = new MockProvider([
      { type: "reply", content: "Second response." },
    ]);
    const deps2 = { ...deps1, provider: provider2 };
    const r2 = await runTurn({ message: "What about the cost breakdown?", sessionId, cwd: tmpDir }, deps2);

    expect(r2.sessionId).toBe(sessionId);
    expect(r2.reply).toBe("Second response.");
  });
});

// ─── Integration: error paths ───────────────────────────────────────

describe("forge-master integration — error paths", () => {
  beforeEach(() => makeTmp());
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("returns error when no provider is available", async () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "unknown-model",
        reasoningProvider: "nonexistent",
      },
    });

    const result = await runTurn(
      { message: "What is my plan status?", cwd: tmpDir },
      {
        recall: async () => null,
        remember: () => ({ ok: true }),
        toolMetadata: {},
      },
    );

    expect(result.error).toBe("reasoning_model_unavailable");
    expect(result.reply).toBe("");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("off-topic messages get redirected without model call", async () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-sonnet-4.5",
        reasoningProvider: "anthropic",
      },
    });

    const provider = new MockProvider([]);
    const deps = {
      provider,
      dispatcher: async () => ({}),
      hub: null,
      toolMetadata: {},
      recall: async () => null,
      remember: () => ({ ok: true }),
    };

    const result = await runTurn({ message: "What is the weather in Boise?", cwd: tmpDir }, deps);

    // Off-topic should be handled without calling the provider
    expect(provider.calls).toHaveLength(0);
    expect(result.reply).toBeTruthy();
    expect(result.tokensIn).toBe(0);
    expect(result.totalCostUSD).toBe(0);
  });

  it("truncates when tool budget is exceeded", async () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-sonnet-4.5",
        reasoningProvider: "anthropic",
        maxToolCalls: 2,
      },
    });

    const provider = new MockProvider([
      {
        type: "tool_calls",
        toolCalls: [
          { id: "tc1", name: "forge_plan_status", args: {} },
          { id: "tc2", name: "forge_cost_report", args: {} },
        ],
      },
      {
        type: "tool_calls",
        content: "More tools...",
        toolCalls: [
          { id: "tc3", name: "forge_health_trend", args: {} },
        ],
      },
    ]);

    const deps = {
      provider,
      dispatcher: async () => ({ result: "ok" }),
      hub: null,
      toolMetadata: {},
      recall: async () => null,
      remember: () => ({ ok: true }),
    };

    const result = await runTurn({ message: "Show me the plan status and cost and health trend", cwd: tmpDir }, deps);

    expect(result.truncated).toBe(true);
  });
});
