/**
 * Plan Forge — Forge-Master tests (Phase-28, Slice 1).
 *
 * Covers:
 *   - config.mjs   (getForgeMasterConfig, fallback chain, clamping, provider detection)
 *   - allowlist.mjs (BASE_ALLOWLIST shape, resolveAllowlist, isAllowlisted, extension discovery)
 *   - index.mjs     (re-exports)
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getForgeMasterConfig,
  FORGE_MASTER_DEFAULTS,
} from "../forge-master/config.mjs";

import {
  BASE_ALLOWLIST,
  WRITE_TOOLS_EXCLUDED,
  USAGE_HINTS,
  resolveAllowlist,
  isAllowlisted,
} from "../forge-master/allowlist.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

let tmpDir;

function makeTmp() {
  tmpDir = mkdtempSync(join(tmpdir(), "forge-master-test-"));
  return tmpDir;
}

function writeForgeJson(dir, content) {
  writeFileSync(join(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

// ─── Config Loader ──────────────────────────────────────────────────

describe("forge-master config", () => {
  beforeEach(() => makeTmp());
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("returns defaults when .forge.json is missing", () => {
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.routerModel).toBe(FORGE_MASTER_DEFAULTS.routerModel);
    expect(cfg.maxToolCalls).toBe(5);
    expect(cfg.ceilingToolCalls).toBe(10);
    expect(cfg.sessionRetentionDays).toBe(14);
    expect(cfg.l3Enabled).toBe(false);
    expect(cfg.discoverExtensionTools).toBe(true);
  });

  it("returns defaults when .forge.json has no forgeMaster block", () => {
    writeForgeJson(tmpDir, { preset: "dotnet" });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.maxToolCalls).toBe(5);
    expect(cfg.l3Enabled).toBe(false);
  });

  it("applies explicit forgeMaster overrides", () => {
    writeForgeJson(tmpDir, {
      forgeMaster: {
        reasoningModel: "claude-opus-4.5",
        routerModel: "gpt-5.4-mini",
        maxToolCalls: 8,
        l3Enabled: true,
        discoverExtensionTools: false,
      },
    });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.reasoningModel).toBe("claude-opus-4.5");
    expect(cfg.routerModel).toBe("gpt-5.4-mini");
    expect(cfg.maxToolCalls).toBe(8);
    expect(cfg.l3Enabled).toBe(true);
    expect(cfg.discoverExtensionTools).toBe(false);
  });

  it("clamps maxToolCalls to 1..10", () => {
    writeForgeJson(tmpDir, { forgeMaster: { maxToolCalls: 50 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).maxToolCalls).toBe(10);
    writeForgeJson(tmpDir, { forgeMaster: { maxToolCalls: -3 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).maxToolCalls).toBe(1);
  });

  it("clamps sessionRetentionDays to 1..365", () => {
    writeForgeJson(tmpDir, { forgeMaster: { sessionRetentionDays: 999 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).sessionRetentionDays).toBe(365);
    writeForgeJson(tmpDir, { forgeMaster: { sessionRetentionDays: 0 } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).sessionRetentionDays).toBe(1);
  });

  it("falls back to model.default when forgeMaster.reasoningModel is absent", () => {
    writeForgeJson(tmpDir, { model: { default: "gpt-5.2" } });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.reasoningModel).toBe("gpt-5.2");
    expect(cfg.reasoningProvider).toBe("openai");
  });

  it("detects provider from model name", () => {
    writeForgeJson(tmpDir, { forgeMaster: { reasoningModel: "claude-opus-4.7" } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("anthropic");

    writeForgeJson(tmpDir, { forgeMaster: { reasoningModel: "gpt-5.4" } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("openai");

    writeForgeJson(tmpDir, { forgeMaster: { reasoningModel: "grok-4" } });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("xai");
  });

  it("respects explicit reasoningProvider over auto-detection", () => {
    writeForgeJson(tmpDir, {
      forgeMaster: { reasoningModel: "my-custom-model", reasoningProvider: "anthropic" },
    });
    expect(getForgeMasterConfig({ cwd: tmpDir }).reasoningProvider).toBe("anthropic");
  });

  it("handles malformed .forge.json gracefully", () => {
    writeFileSync(join(tmpDir, ".forge.json"), "not json!", "utf-8");
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.maxToolCalls).toBe(5); // defaults
  });

  it("ensures ceilingToolCalls >= maxToolCalls", () => {
    writeForgeJson(tmpDir, {
      forgeMaster: { maxToolCalls: 7, ceilingToolCalls: 3 },
    });
    const cfg = getForgeMasterConfig({ cwd: tmpDir });
    expect(cfg.ceilingToolCalls).toBeGreaterThanOrEqual(cfg.maxToolCalls);
  });
});

// ─── Allowlist ──────────────────────────────────────────────────────

describe("forge-master allowlist", () => {
  it("BASE_ALLOWLIST contains expected read-only tools", () => {
    expect(BASE_ALLOWLIST).toContain("forge_plan_status");
    expect(BASE_ALLOWLIST).toContain("forge_cost_report");
    expect(BASE_ALLOWLIST).toContain("forge_smith");
    expect(BASE_ALLOWLIST).toContain("forge_crucible_submit");
    expect(BASE_ALLOWLIST).toContain("brain_recall");
    expect(BASE_ALLOWLIST).toContain("forge_search");
    expect(BASE_ALLOWLIST).toContain("forge_timeline");
  });

  it("BASE_ALLOWLIST does NOT contain write tools", () => {
    for (const writeTool of WRITE_TOOLS_EXCLUDED) {
      expect(BASE_ALLOWLIST).not.toContain(writeTool);
    }
  });

  it("BASE_ALLOWLIST is frozen", () => {
    expect(Object.isFrozen(BASE_ALLOWLIST)).toBe(true);
  });

  it("USAGE_HINTS covers every base tool", () => {
    for (const tool of BASE_ALLOWLIST) {
      expect(USAGE_HINTS).toHaveProperty(tool);
      expect(typeof USAGE_HINTS[tool]).toBe("string");
      expect(USAGE_HINTS[tool].length).toBeGreaterThan(10);
    }
  });

  it("resolveAllowlist returns base tools when no extensions", () => {
    const list = resolveAllowlist();
    expect(list).toEqual(expect.arrayContaining([...BASE_ALLOWLIST]));
    expect(list.length).toBe(BASE_ALLOWLIST.length);
  });

  it("resolveAllowlist discovers readOnly extension tools", () => {
    const meta = {
      my_extension_tool: { source: "extension", readOnly: true },
      my_write_ext: { source: "extension", readOnly: false },
      my_untagged_ext: { source: "extension" },
    };
    const list = resolveAllowlist({ toolMetadata: meta });
    expect(list).toContain("my_extension_tool");
    expect(list).not.toContain("my_write_ext");
    expect(list).not.toContain("my_untagged_ext");
  });

  it("resolveAllowlist skips discovery when disabled", () => {
    const meta = {
      my_extension_tool: { source: "extension", readOnly: true },
    };
    const list = resolveAllowlist({ toolMetadata: meta, discoverExtensionTools: false });
    expect(list).not.toContain("my_extension_tool");
    expect(list.length).toBe(BASE_ALLOWLIST.length);
  });

  it("isAllowlisted rejects write tools with specific reason", () => {
    const list = resolveAllowlist();
    const result = isAllowlisted("forge_run_plan", list);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("write_tool_excluded_phase28");
  });

  it("isAllowlisted allows base tools", () => {
    const list = resolveAllowlist();
    expect(isAllowlisted("forge_cost_report", list).allowed).toBe(true);
  });

  it("isAllowlisted rejects unknown tools", () => {
    const list = resolveAllowlist();
    const result = isAllowlisted("some_random_tool", list);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("tool_not_allowlisted");
  });
});

// ─── System Prompt ──────────────────────────────────────────────────

describe("forge-master system-prompt", () => {
  it("system-prompt.md exists and contains key sections", () => {
    const promptPath = join(import.meta.dirname, "..", "forge-master", "system-prompt.md");
    expect(existsSync(promptPath)).toBe(true);
    const content = readFileSync(promptPath, "utf-8");
    expect(content).toContain("Forge-Master");
    expect(content).toContain("Anti-Lovable");
    expect(content).toContain("Crucible-Funneling");
    expect(content).toContain("No Hand-Math");
    expect(content).toContain("Off-Topic");
    expect(content).toContain("Temper Guards");
    expect(content).toContain("5-question framework");
    expect(content).toContain("{context_block}");
  });
});

// ─── Index re-exports ───────────────────────────────────────────────

describe("forge-master index", () => {
  it("re-exports config and allowlist APIs", async () => {
    const mod = await import("../forge-master/index.mjs");
    expect(typeof mod.getForgeMasterConfig).toBe("function");
    expect(mod.FORGE_MASTER_DEFAULTS).toBeDefined();
    expect(mod.BASE_ALLOWLIST).toBeDefined();
    expect(mod.WRITE_TOOLS_EXCLUDED).toBeDefined();
    expect(mod.USAGE_HINTS).toBeDefined();
    expect(typeof mod.resolveAllowlist).toBe("function");
    expect(typeof mod.isAllowlisted).toBe("function");
  });

  it("re-exports intent router APIs", async () => {
    const mod = await import("../forge-master/index.mjs");
    expect(typeof mod.classify).toBe("function");
    expect(mod.LANES).toBeDefined();
    expect(mod.LANE_TOOLS).toBeDefined();
    expect(typeof mod.OFFTOPIC_REDIRECT).toBe("string");
  });
});

// ─── Intent Router ──────────────────────────────────────────────────

import {
  classify,
  LANES,
  LANE_TOOLS,
  OFFTOPIC_REDIRECT,
} from "../forge-master/intent-router.mjs";

describe("forge-master intent router", () => {
  // ── Build lane (2 examples) ──

  it("classifies 'I want to add multi-tenant auth' as build", async () => {
    const result = await classify("I want to add multi-tenant auth to my pipeline");
    expect(result.lane).toBe(LANES.BUILD);
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    expect(result.reason).toBe("keyword_match");
    expect(result.suggestedTools).toEqual(LANE_TOOLS[LANES.BUILD]);
  });

  it("classifies 'create a new phase for auth refactor' as build", async () => {
    const result = await classify("Let's create a new phase for the auth refactor");
    expect(result.lane).toBe(LANES.BUILD);
    expect(result.suggestedTools).toContain("forge_crucible_submit");
  });

  // ── Operational lane (2 examples) ──

  it("classifies 'what is my plan status' as operational", async () => {
    const result = await classify("What is my plan status for Phase-27?");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
    expect(result.suggestedTools).toContain("forge_plan_status");
  });

  it("classifies 'how much did quorum cost on Phase-27' as operational", async () => {
    const result = await classify("How much did quorum cost on Phase-27?");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.suggestedTools).toContain("forge_cost_report");
  });

  // ── Troubleshoot lane (2 examples) ──

  it("classifies 'why did Phase-27 Slice 4 fail' as troubleshoot", async () => {
    const result = await classify("Why did Phase-27 Slice 4 fail last run?");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
    expect(result.suggestedTools).toContain("forge_diagnose");
  });

  it("classifies 'there is a bug in the tempering scanner' as troubleshoot", async () => {
    const result = await classify("There is a bug in the tempering scanner");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.suggestedTools).toContain("forge_bug_list");
  });

  // ── Off-topic lane (2 examples) ──

  it("classifies 'what is the weather in Boise' as offtopic", async () => {
    const result = await classify("What's the weather in Boise?");
    expect(result.lane).toBe(LANES.OFFTOPIC);
    expect(result.reason).toBe("keyword_match");
    expect(result.suggestedTools).toEqual([]);
  });

  it("classifies 'tell me a joke' as offtopic", async () => {
    const result = await classify("Tell me a joke about programming");
    expect(result.lane).toBe(LANES.OFFTOPIC);
    expect(result.suggestedTools).toEqual([]);
  });

  // ── Empty / missing input ──

  it("classifies empty message as offtopic with high confidence", async () => {
    const result = await classify("");
    expect(result.lane).toBe(LANES.OFFTOPIC);
    expect(result.confidence).toBe(1.0);
    expect(result.reason).toBe("empty_message");
  });

  // ── Ambiguous case: exercises the router-model path (mocked) ──

  it("falls back to router model for ambiguous input and uses model result", async () => {
    const mockCallApiWorker = async () => ({
      output: '{"lane": "operational"}',
    });
    const mockDetectApiProvider = () => ({
      name: "xai",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "test-key",
      label: "xAI Grok",
    });

    // "tell me about things" — no keyword matches
    const result = await classify("tell me about things in my project", {
      callApiWorker: mockCallApiWorker,
      detectApiProvider: mockDetectApiProvider,
    });

    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.confidence).toBe(0.75);
    expect(result.reason).toBe("router_model");
  });

  it("degrades to keyword-only when router model is unavailable", async () => {
    const mockDetectApiProvider = () => null; // no provider

    // "the build failed and I see errors" has troubleshoot keywords
    const result = await classify("the build failed and I see errors", {
      callApiWorker: async () => ({}),
      detectApiProvider: mockDetectApiProvider,
    });

    // Should still classify via keywords (troubleshoot signals)
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
  });

  it("degrades gracefully when router model throws", async () => {
    const mockCallApiWorker = async () => { throw new Error("provider down"); };
    const mockDetectApiProvider = () => ({
      name: "xai",
      baseUrl: "https://api.x.ai/v1",
      apiKey: "test-key",
      label: "xAI Grok",
    });

    // No keyword signals → router model → throws → falls through to no_signals
    const result = await classify("xyzzy plugh", {
      callApiWorker: mockCallApiWorker,
      detectApiProvider: mockDetectApiProvider,
    });

    expect(result.lane).toBe(LANES.OFFTOPIC);
    expect(result.reason).toBe("no_signals");
  });

  // ── LANE_TOOLS structure ──

  it("LANE_TOOLS covers all four lanes", () => {
    for (const lane of Object.values(LANES)) {
      expect(LANE_TOOLS).toHaveProperty(lane);
      expect(Array.isArray(LANE_TOOLS[lane])).toBe(true);
    }
    expect(LANE_TOOLS[LANES.OFFTOPIC]).toEqual([]);
  });

  // ── OFFTOPIC_REDIRECT ──

  it("OFFTOPIC_REDIRECT contains the expected canned text", () => {
    expect(OFFTOPIC_REDIRECT).toContain("Plan Forge topics");
    expect(OFFTOPIC_REDIRECT).toContain("plans, runs, costs");
  });
});
