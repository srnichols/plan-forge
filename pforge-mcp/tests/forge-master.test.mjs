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
} from "../../pforge-master/src/config.mjs";

import {
  BASE_ALLOWLIST,
  WRITE_TOOLS_EXCLUDED,
  USAGE_HINTS,
  resolveAllowlist,
  isAllowlisted,
} from "../../pforge-master/src/allowlist.mjs";

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
    const promptPath = join(import.meta.dirname, "..", "..", "pforge-master", "src", "system-prompt.md");
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

  it("re-exports retrieval APIs", async () => {
    const mod = await import("../forge-master/index.mjs");
    expect(typeof mod.fetchContext).toBe("function");
    expect(mod.TOKEN_CAP).toBe(4000);
    expect(mod.L1_KEYS).toBeDefined();
    expect(mod.L2_KEYS_BY_LANE).toBeDefined();
    expect(mod.L3_KEYS).toBeDefined();
  });
});

// ─── Intent Router ──────────────────────────────────────────────────

import {
  classify,
  LANES,
  LANE_TOOLS,
  OFFTOPIC_REDIRECT,
} from "../../pforge-master/src/intent-router.mjs";

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
    expect(OFFTOPIC_REDIRECT).toContain("operational");
    expect(OFFTOPIC_REDIRECT).toContain("troubleshoot");
    expect(OFFTOPIC_REDIRECT).toContain("build");
    expect(OFFTOPIC_REDIRECT).toContain("advisory");
  });
});

// ─── Glossary Expansion (Phase-32 Slice 2) ─────────────────────────

describe("glossary expansion", () => {
  // ── Slices / Gates (contextual) ──

  it("'what's the status of slice 4' → operational", async () => {
    const result = await classify("what's the status of slice 4");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'gate 3 passed in the last run' → operational", async () => {
    const result = await classify("gate 3 passed in the last run");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'slice me an apple' does NOT classify as operational (food context wins)", async () => {
    // "recipe" / "food" offtopic rules score higher than the bare-slice contextual rule
    // which requires a Plan Forge context marker after the word
    const result = await classify("can you slice me an apple");
    expect(result.lane).not.toBe(LANES.OPERATIONAL);
  });

  // ── Hardening ──

  it("'help me harden Phase-33' → operational", async () => {
    const result = await classify("help me harden Phase-33");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'the plan is fully hardened' → operational", async () => {
    const result = await classify("the plan is fully hardened and ready to execute");
    expect(result.lane).toBe(LANES.OPERATIONAL);
  });

  // ── Execution / Resume ──

  it("'why did the execution fail at slice 3' → troubleshoot", async () => {
    // "why did...fail" combined pattern (w4) beats execution (w2) + slice 3 (w3)
    const result = await classify("why did the execution fail at slice 3");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
  });

  it("'resume-from slice 4 to skip the first three' → operational", async () => {
    const result = await classify("resume-from slice 4 to skip the first three");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  // ── Tempering ──

  it("'did tempering fire on this slice' → operational", async () => {
    const result = await classify("did tempering fire on this slice");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'suppressed advisory from last run' → operational", async () => {
    const result = await classify("show me the suppressed advisory from last run");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  // ── Quorum / Reflexion extras ──

  it("'how did reflexion change the answer' → operational", async () => {
    const result = await classify("how did reflexion change the answer on that slice");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'another attempt failed' → troubleshoot (fail beats retry)", async () => {
    const result = await classify("another attempt failed with the same error");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
  });

  // ── Meta-bugs / Self-repair ──

  it("'I need to file a meta-bug about this' → troubleshoot", async () => {
    const result = await classify("I need to file a meta-bug about this plan defect");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
  });

  it("'self-repair was triggered during the run' → troubleshoot", async () => {
    const result = await classify("self-repair was triggered during the run");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
  });

  it("'plan-defect detected in slice 2' → troubleshoot", async () => {
    const result = await classify("plan-defect detected in slice 2");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
  });

  it("a normal build request without meta-bug terms is not troubleshoot", async () => {
    const result = await classify("I want to add a new feature to the pipeline");
    expect(result.lane).not.toBe(LANES.TROUBLESHOOT);
  });

  // ── Phase refs ──

  it("'is Phase-31 done?' → operational", async () => {
    const result = await classify("is Phase-31 done?");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'status of phase 27.2' → operational", async () => {
    const result = await classify("what is the status of phase 27.2");
    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.reason).toBe("keyword_match");
  });

  it("'phase of the moon' does NOT classify as operational (no digit after phase)", async () => {
    // The phase-ref pattern requires a digit immediately after phase
    const result = await classify("what is the phase of the moon tonight");
    expect(result.lane).not.toBe(LANES.OPERATIONAL);
  });

  // ── Crucible extras ──

  it("'can we smelt this idea in crucible' → build", async () => {
    const result = await classify("can we smelt this idea in crucible");
    expect(result.lane).toBe(LANES.BUILD);
    expect(result.reason).toBe("keyword_match");
  });

  it("'finalize the plan before shipping' → build", async () => {
    const result = await classify("finalize the plan before shipping");
    expect(result.lane).toBe(LANES.BUILD);
    expect(result.reason).toBe("keyword_match");
  });

  // ── Stop-condition guard (from plan) ──

  it("[stop-condition] 'why did the gate fail on slice 2' → troubleshoot", async () => {
    const result = await classify("why did the gate fail on slice 2");
    expect(result.lane).toBe(LANES.TROUBLESHOOT);
    expect(result.reason).toBe("keyword_match");
  });
});

import {
  fetchContext,
  TOKEN_CAP,
  L1_KEYS,
  L2_KEYS_BY_LANE,
  L3_KEYS,
  estimateTokens,
  summarizeValue,
} from "../../pforge-master/src/retrieval.mjs";

describe("forge-master retrieval", () => {
  // ── Helper: mock recall that returns per-key data ──

  function makeMockRecall(data = {}) {
    return async (key) => data[key] ?? null;
  }

  function makeMockConfig(overrides = {}) {
    return () => ({
      l3Enabled: false,
      ...overrides,
    });
  }

  // ── All three tiers populated ──

  it("returns context block with L1, L2, L3 sections when all tiers populated", async () => {
    const mockRecall = makeMockRecall({
      "session.history": "User asked about Phase-27 cost breakdown.",
      "session.context": "Currently viewing cost report.",
      "project.run.latest": { plan: "Phase-27", status: "completed", slices: 8, passed: 8 },
      "project.tempering.state": { summary: "No active tempering issues." },
      "cross.pattern.recent": "Auth patterns established in Phase-20.",
      "cross.convention.recent": "Use conventional commits.",
    });
    const mockConfig = makeMockConfig({ l3Enabled: true });

    const result = await fetchContext(
      { sessionId: "test-session-1", lane: "operational", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    expect(result.contextBlock).toContain("### Session");
    expect(result.contextBlock).toContain("### Project");
    expect(result.contextBlock).toContain("### Cross-Project");
    expect(result.contextBlock).toContain("Phase-27 cost breakdown");
    expect(result.contextBlock).toContain("Phase-27");
    expect(result.contextBlock).toContain("Auth patterns");
    expect(result.sources.l1).toContain("session.history");
    expect(result.sources.l1).toContain("session.context");
    expect(result.sources.l2).toContain("project.run.latest");
    expect(result.sources.l3).toContain("cross.pattern.recent");
    expect(result.sources.l3).toContain("cross.convention.recent");
  });

  // ── L3 missing (l3Enabled: false) ──

  it("omits L3 section when l3Enabled is false", async () => {
    const mockRecall = makeMockRecall({
      "session.history": "User asked about plan status.",
      "project.run.latest": { plan: "Phase-27", status: "completed" },
      "cross.pattern.recent": "Should NOT appear.",
    });
    const mockConfig = makeMockConfig({ l3Enabled: false });

    const result = await fetchContext(
      { sessionId: "s1", lane: "operational", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    expect(result.contextBlock).toContain("### Session");
    expect(result.contextBlock).toContain("### Project");
    expect(result.contextBlock).not.toContain("### Cross-Project");
    expect(result.contextBlock).not.toContain("Should NOT appear");
    expect(result.sources.l3).toEqual([]);
  });

  // ── Token truncation at cap ──

  it("truncates context when total exceeds 4000-token cap (oldest tiers first)", async () => {
    // Each character ~ 0.25 tokens, so 4000 tokens ~ 16000 chars.
    // Create L1 and L2 data that together exceed the cap.
    const longL1 = "A".repeat(10000); // ~2500 tokens
    const longL2 = "B".repeat(10000); // ~2500 tokens — total ~5000 > 4000
    const longL3 = "C".repeat(6000); // ~1500 tokens

    const mockRecall = makeMockRecall({
      "session.history": longL1,
      "project.run.latest": longL2,
      "project.tempering.state": null,
      "cross.pattern.recent": longL3,
      "cross.convention.recent": null,
    });
    const mockConfig = makeMockConfig({ l3Enabled: true });

    const result = await fetchContext(
      { sessionId: "s1", lane: "operational", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    // L3 should be dropped first (least specific)
    expect(result.contextBlock).not.toContain("### Cross-Project");
    expect(result.contextBlock).not.toContain("CCCCCC");

    // Verify total is within the character cap (16000 chars + some headroom for markdown)
    expect(result.contextBlock.length).toBeLessThanOrEqual(TOKEN_CAP * 4 + 100);
  });

  // ── Empty project (no history) ──

  it("returns empty contextBlock and empty sources when nothing is available", async () => {
    const mockRecall = makeMockRecall({}); // all nulls
    const mockConfig = makeMockConfig({ l3Enabled: false });

    const result = await fetchContext(
      { sessionId: "empty-session", lane: "operational", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    expect(result.contextBlock).toBe("");
    expect(result.sources.l1).toEqual([]);
    expect(result.sources.l2).toEqual([]);
    expect(result.sources.l3).toEqual([]);
  });

  // ── Lane-aware L2 key selection ──

  it("fetches lane-specific L2 keys for troubleshoot lane", async () => {
    const calledKeys = [];
    const mockRecall = async (key) => {
      calledKeys.push(key);
      if (key === "project.liveguard.incidents") return [{ id: "INC-1", severity: "high" }];
      return null;
    };
    const mockConfig = makeMockConfig();

    const result = await fetchContext(
      { sessionId: "s1", lane: "troubleshoot", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    expect(calledKeys).toContain("project.liveguard.incidents");
    expect(result.sources.l2).toContain("project.liveguard.incidents");
    expect(result.contextBlock).toContain("INC-1");
  });

  // ── Graceful degradation when recall throws ──

  it("returns best-effort context when one recall throws", async () => {
    let callCount = 0;
    const mockRecall = async (key) => {
      callCount++;
      if (key === "session.history") throw new Error("L1 unavailable");
      if (key === "project.run.latest") return { plan: "Phase-27", status: "running" };
      return null;
    };
    const mockConfig = makeMockConfig();

    const result = await fetchContext(
      { sessionId: "s1", lane: "operational", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    // Should still have L2 context despite L1 failure
    expect(result.contextBlock).toContain("Phase-27");
    expect(result.sources.l2).toContain("project.run.latest");
    expect(callCount).toBeGreaterThan(1);
  });

  // ── summarizeValue handles various types ──

  it("summarizeValue handles null, string, array, and object", () => {
    expect(summarizeValue("k", null)).toBe(null);
    expect(summarizeValue("k", "hello")).toBe("hello");
    expect(summarizeValue("k", [])).toBe(null);
    expect(summarizeValue("k", ["a", "b"])).toBe("a\nb");
    expect(summarizeValue("k", { summary: "test summary" })).toBe("test summary");
    expect(summarizeValue("k", { plan: "P1", status: "done" })).toBe("Plan: P1 | Status: done");
  });

  // ── estimateTokens approximation ──

  it("estimateTokens uses chars/4 approximation", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(16000))).toBe(4000);
  });

  // ── Default lane fallback ──

  it("uses default L2 keys for unknown lane", async () => {
    const calledKeys = [];
    const mockRecall = async (key) => { calledKeys.push(key); return null; };
    const mockConfig = makeMockConfig();

    await fetchContext(
      { lane: "unknown_lane", cwd: "/tmp/test" },
      { recall: mockRecall, getForgeMasterConfig: mockConfig },
    );

    // Should use default keys (project.run.latest, project.tempering.state)
    expect(calledKeys).toContain("project.run.latest");
    expect(calledKeys).toContain("project.tempering.state");
  });
});

// ─── Tool Bridge ────────────────────────────────────────────────────

import {
  invokeAllowlisted,
  invokeMany,
  summarize,
  SUMMARY_LIMIT,
} from "../../pforge-master/src/tool-bridge.mjs";

describe("forge-master bridge", () => {
  const allowlist = [...BASE_ALLOWLIST];
  const makeDeps = (dispatcher, hub = null) => ({
    resolvedAllowlist: allowlist,
    dispatcher,
    hub,
  });

  // ── Allowlist rejection ──

  it("rejects forge_run_plan with tool_not_allowlisted", async () => {
    const dispatcher = async () => { throw new Error("should not be called"); };
    const result = await invokeAllowlisted(
      { tool: "forge_run_plan", args: {} },
      makeDeps(dispatcher),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("tool_not_allowlisted");
    expect(result.tool).toBe("forge_run_plan");
    expect(result.source).toBe("forge-master");
    expect(result.reason).toBe("write_tool_excluded_phase28");
  });

  it("rejects an unknown tool with tool_not_allowlisted", async () => {
    const dispatcher = async () => "ok";
    const result = await invokeAllowlisted(
      { tool: "not_a_real_tool", args: {} },
      makeDeps(dispatcher),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("tool_not_allowlisted");
    expect(result.reason).toBe("tool_not_allowlisted");
  });

  // ── Successful invocation ──

  it("invokes an allowlisted tool and returns ok + summary", async () => {
    const dispatcher = async (name, args) => ({ plan: "P1", status: "done" });
    const result = await invokeAllowlisted(
      { tool: "forge_plan_status", args: { plan: "test" } },
      makeDeps(dispatcher),
    );
    expect(result.ok).toBe(true);
    expect(result.tool).toBe("forge_plan_status");
    expect(result.source).toBe("forge-master");
    expect(result.resultFull).toEqual({ plan: "P1", status: "done" });
    expect(typeof result.summary).toBe("string");
    expect(result.costUSD).toBe(0);
  });

  // ── Parallel invocation of 3 allowlisted tools ──

  it("invokes 3 allowlisted tools in parallel via invokeMany", async () => {
    const callOrder = [];
    const dispatcher = async (name) => {
      callOrder.push(name);
      return { tool: name, data: "ok" };
    };
    const results = await invokeMany(
      [
        { tool: "forge_plan_status", args: {} },
        { tool: "forge_cost_report", args: {} },
        { tool: "forge_smith", args: {} },
      ],
      makeDeps(dispatcher),
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok === true)).toBe(true);
    expect(results.every((r) => r.source === "forge-master")).toBe(true);
    // All three should have been dispatched
    expect(callOrder).toContain("forge_plan_status");
    expect(callOrder).toContain("forge_cost_report");
    expect(callOrder).toContain("forge_smith");
  });

  it("invokeMany rejects blocked tools within a parallel batch", async () => {
    const dispatcher = async (name) => ({ data: name });
    const results = await invokeMany(
      [
        { tool: "forge_plan_status", args: {} },
        { tool: "forge_run_plan", args: {} }, // blocked
        { tool: "forge_smith", args: {} },
      ],
      makeDeps(dispatcher),
    );
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toBe("tool_not_allowlisted");
    expect(results[2].ok).toBe(true);
  });

  // ── Result summarization / truncation ──

  it("truncates result exceeding SUMMARY_LIMIT", async () => {
    const longText = "x".repeat(5000);
    const dispatcher = async () => longText;
    const result = await invokeAllowlisted(
      { tool: "forge_sweep", args: {} },
      makeDeps(dispatcher),
    );
    expect(result.ok).toBe(true);
    expect(result.summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
    expect(result.summary).toContain("…[truncated]");
    // resultFull preserves full output
    expect(result.resultFull).toBe(longText);
  });

  it("does not truncate short results", async () => {
    const dispatcher = async () => "short response";
    const result = await invokeAllowlisted(
      { tool: "forge_status", args: {} },
      makeDeps(dispatcher),
    );
    expect(result.summary).toBe("short response");
    expect(result.summary).not.toContain("…[truncated]");
  });

  // ── summarize() unit tests ──

  it("summarize returns text as-is when under limit", () => {
    expect(summarize("hello")).toBe("hello");
    expect(summarize("a".repeat(2000))).toBe("a".repeat(2000));
  });

  it("summarize truncates and appends marker when over limit", () => {
    const over = "b".repeat(3000);
    const s = summarize(over);
    expect(s.length).toBeLessThanOrEqual(SUMMARY_LIMIT);
    expect(s.endsWith("…[truncated]")).toBe(true);
  });

  it("summarize handles non-string input", () => {
    expect(summarize(null)).toBe("");
    expect(summarize(undefined)).toBe("");
    expect(summarize({ a: 1 })).toBe('{"a":1}');
  });

  // ── Cost tagging on emitted hub event ──

  it("emits hub event with source: forge-master on successful call", async () => {
    const events = [];
    const hub = { broadcast: (e) => events.push(e) };
    const dispatcher = async () => "result";
    await invokeAllowlisted(
      { tool: "forge_validate", args: {} },
      makeDeps(dispatcher, hub),
    );
    const complete = events.find((e) => e.type === "forge-master.tool-complete");
    expect(complete).toBeTruthy();
    expect(complete.source).toBe("forge-master");
    expect(complete.tool).toBe("forge_validate");
    expect(typeof complete.durationMs).toBe("number");
  });

  it("emits hub event with source: forge-master on rejection", async () => {
    const events = [];
    const hub = { broadcast: (e) => events.push(e) };
    const dispatcher = async () => "ok";
    await invokeAllowlisted(
      { tool: "forge_run_plan", args: {} },
      makeDeps(dispatcher, hub),
    );
    const rejected = events.find((e) => e.type === "forge-master.tool-rejected");
    expect(rejected).toBeTruthy();
    expect(rejected.source).toBe("forge-master");
  });

  // ── Dispatcher error handling ──

  it("returns ok:false when dispatcher throws", async () => {
    const dispatcher = async () => { throw new Error("boom"); };
    const result = await invokeAllowlisted(
      { tool: "forge_analyze", args: {} },
      makeDeps(dispatcher),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dispatcher_error");
    expect(result.error).toContain("boom");
    expect(result.source).toBe("forge-master");
  });

  // ── invokeMany edge cases ──

  it("invokeMany returns empty array for empty calls", async () => {
    const dispatcher = async () => "ok";
    expect(await invokeMany([], makeDeps(dispatcher))).toEqual([]);
    expect(await invokeMany(null, makeDeps(dispatcher))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Reasoning loop (Phase-28, Slice 5)
// ═══════════════════════════════════════════════════════════════════

import {
  runTurn,
  buildToolSchemas,
  selectProvider,
  ABSOLUTE_CEILING,
} from "../../pforge-master/src/reasoning.mjs";
import { MockReasoningClient } from "../../pforge-master/src/__fixtures__/MockReasoningClient.mjs";

describe("forge-master reasoning", () => {
  let tmpDirR;

  beforeEach(() => {
    tmpDirR = mkdtempSync(join(tmpdir(), "forge-master-reasoning-"));
    // Write a minimal .forge.json so config resolves
    writeFileSync(
      join(tmpDirR, ".forge.json"),
      JSON.stringify({
        forgeMaster: {
          reasoningModel: "claude-sonnet-4.5",
          reasoningProvider: "anthropic",
          maxToolCalls: 5,
        },
      }),
      "utf-8",
    );
  });

  afterEach(() => rmSync(tmpDirR, { recursive: true, force: true }));

  // ── Helpers ─────────────────────────────────────────────────────

  function makeDepsForReasoning(client, overrides = {}) {
    return {
      provider: client,
      dispatcher: overrides.dispatcher || (async (name) => ({ tool: name, result: "ok" })),
      hub: overrides.hub || null,
      toolMetadata: {},
      recall: async () => null,
      getForgeMasterConfig: () => ({
        reasoningModel: "claude-sonnet-4.5",
        reasoningProvider: "anthropic",
        routerModel: "grok-3-mini",
        maxToolCalls: 5,
        ceilingToolCalls: 10,
        l3Enabled: false,
        discoverExtensionTools: true,
        sessionRetentionDays: 14,
      }),
      ...overrides,
    };
  }

  // ── Happy path: 3 tool calls → final reply ──────────────────────

  it("reasoning: happy path — 3 tool calls then final reply", async () => {
    const client = new MockReasoningClient([
      {
        type: "tool_calls",
        toolCalls: [
          { id: "tc1", name: "forge_plan_status", args: {} },
          { id: "tc2", name: "forge_cost_report", args: {} },
        ],
      },
      {
        type: "tool_calls",
        toolCalls: [
          { id: "tc3", name: "forge_health_trend", args: {} },
        ],
      },
      { type: "reply", content: "Here is your plan summary with costs." },
    ]);

    const result = await runTurn(
      { message: "what is my plan status and cost?", cwd: tmpDirR },
      makeDepsForReasoning(client),
    );

    expect(result.reply).toBe("Here is your plan summary with costs.");
    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls[0].name).toBe("forge_plan_status");
    expect(result.toolCalls[1].name).toBe("forge_cost_report");
    expect(result.toolCalls[2].name).toBe("forge_health_trend");
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
    expect(client.callCount).toBe(3);
  });

  // ── Budget overflow: model requests 15 calls, loop stops at ceiling ──

  it("reasoning: budget overflow — stops at maxToolCalls ceiling", async () => {
    // Script 12 tool calls (exceeds max of 5)
    const manyToolCalls = [];
    for (let i = 0; i < 12; i++) {
      manyToolCalls.push({
        type: "tool_calls",
        toolCalls: [{ id: `tc${i}`, name: "forge_status", args: {} }],
      });
    }
    manyToolCalls.push({ type: "reply", content: "done" });

    const client = new MockReasoningClient(manyToolCalls);

    const result = await runTurn(
      { message: "give me all the status info", maxToolCalls: 5, cwd: tmpDirR },
      makeDepsForReasoning(client),
    );

    expect(result.truncated).toBe(true);
    expect(result.toolCalls.length).toBeLessThanOrEqual(5);
  });

  // ── Off-topic short-circuit: zero model calls ────────────────────

  it("reasoning: off-topic short-circuit — zero model calls", async () => {
    const client = new MockReasoningClient([]);

    const result = await runTurn(
      { message: "what is the weather in Boise?", cwd: tmpDirR },
      makeDepsForReasoning(client),
    );

    expect(result.reply).toContain("scoped to Plan Forge");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
    expect(client.callCount).toBe(0); // no model calls!
  });

  // ── Graceful error when provider throws ──────────────────────────

  it("reasoning: graceful error when provider throws", async () => {
    const client = new MockReasoningClient([
      { error: new Error("API connection refused") },
    ]);

    const result = await runTurn(
      { message: "what is my plan status?", cwd: tmpDirR },
      makeDepsForReasoning(client),
    );

    expect(result.error).toBe("reasoning_model_unavailable");
    expect(result.toolCalls).toHaveLength(0);
  });

  // ── Provider unavailable returns structured error ─────────────────

  it("reasoning: returns error when no provider available", async () => {
    // Override config to use unsupported provider
    const result = await runTurn(
      { message: "what is my plan status?", cwd: tmpDirR },
      {
        provider: null, // no provider injected
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        getForgeMasterConfig: () => ({
          reasoningModel: "some-unknown-model",
          reasoningProvider: "unsupported",
          routerModel: "grok-3-mini",
          maxToolCalls: 5,
          ceilingToolCalls: 10,
          l3Enabled: false,
          discoverExtensionTools: true,
          sessionRetentionDays: 14,
        }),
      },
    );

    expect(result.error).toBe("reasoning_model_unavailable");
    expect(result.toolCalls).toHaveLength(0);
  });

  // ── Hub event emission on turn completion ─────────────────────────

  it("reasoning: emits hub event with source: forge-master on completion", async () => {
    const events = [];
    const hub = { broadcast: (e) => events.push(e) };

    const client = new MockReasoningClient([
      { type: "reply", content: "done" },
    ]);

    await runTurn(
      { message: "what is plan status?", cwd: tmpDirR },
      makeDepsForReasoning(client, { hub }),
    );

    const turnEvent = events.find((e) => e.type === "forge-master.turn-complete");
    expect(turnEvent).toBeTruthy();
    expect(turnEvent.source).toBe("forge-master");
    expect(turnEvent.worker).toBe("forge-master-reasoning");
  });

  // ── buildToolSchemas covers allowlist ─────────────────────────────

  it("reasoning: buildToolSchemas creates schemas from allowlist", () => {
    const schemas = buildToolSchemas(
      ["forge_status", "forge_plan_status"],
      { forge_status: "Quick health check" },
    );
    expect(schemas).toHaveLength(2);
    expect(schemas[0].name).toBe("forge_status");
    expect(schemas[0].description).toBe("Quick health check");
    expect(schemas[1].description).toContain("Plan Forge tool");
    expect(schemas[0].parameters).toHaveProperty("type", "object");
  });

  // ── selectProvider returns correct adapters ───────────────────────

  it("reasoning: selectProvider resolves anthropic, openai, xai", async () => {
    const ant = await selectProvider("anthropic");
    expect(ant).toBeTruthy();
    expect(typeof ant.sendTurn).toBe("function");

    const oai = await selectProvider("openai");
    expect(oai).toBeTruthy();
    expect(typeof oai.sendTurn).toBe("function");

    const xai = await selectProvider("xai");
    expect(xai).toBeTruthy();
    expect(typeof xai.sendTurn).toBe("function");

    const none = await selectProvider("unsupported");
    expect(none).toBeNull();
  });

  // ── ABSOLUTE_CEILING is 10 ────────────────────────────────────────

  it("reasoning: ABSOLUTE_CEILING is 10", () => {
    expect(ABSOLUTE_CEILING).toBe(10);
  });

  // ── Tool call results are recorded with summaries ─────────────────

  it("reasoning: tool call results include resultSummary", async () => {
    const client = new MockReasoningClient([
      {
        type: "tool_calls",
        toolCalls: [{ id: "tc1", name: "forge_smith", args: {} }],
      },
      { type: "reply", content: "Diagnostics passed." },
    ]);

    const dispatcher = async (name) => `${name} result data`;

    const result = await runTurn(
      { message: "what is the health trend of my project?", cwd: tmpDirR },
      makeDepsForReasoning(client, { dispatcher }),
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].resultSummary).toContain("forge_smith result data");
  });

  // ── Allowlisted tool calls succeed, blocked ones are caught ───────

  it("reasoning: blocked tool in model response still records in toolCalls", async () => {
    const client = new MockReasoningClient([
      {
        type: "tool_calls",
        toolCalls: [{ id: "tc1", name: "forge_run_plan", args: {} }],
      },
      { type: "reply", content: "Tried but was blocked." },
    ]);

    const result = await runTurn(
      { message: "what is the cost of my last plan run?", cwd: tmpDirR },
      makeDepsForReasoning(client),
    );

    // The tool call is recorded, but bridge rejected it
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("forge_run_plan");
    expect(result.toolCalls[0].resultSummary).toContain("tool_not_allowlisted");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Persistence (Slice 6)
// ═══════════════════════════════════════════════════════════════════

import {
  ensureSessionId,
  appendTurn,
  summarizeIfNeeded,
  SUMMARIZE_THRESHOLD,
  SUMMARIZE_COUNT,
  _resetLocks,
} from "../../pforge-master/src/persistence.mjs";

describe("forge-master persistence", () => {
  afterEach(() => _resetLocks());

  // ── ensureSessionId ──────────────────────────────────────────────

  it("ensureSessionId: returns input when valid string", () => {
    expect(ensureSessionId("my-session")).toBe("my-session");
    expect(ensureSessionId("abc-123")).toBe("abc-123");
  });

  it("ensureSessionId: generates UUID for null/undefined/empty", () => {
    const id1 = ensureSessionId(null);
    const id2 = ensureSessionId(undefined);
    const id3 = ensureSessionId("");
    const id4 = ensureSessionId("   ");

    expect(id1).toMatch(/^[0-9a-f]{8}-/);
    expect(id2).toMatch(/^[0-9a-f]{8}-/);
    expect(id3).toMatch(/^[0-9a-f]{8}-/);
    expect(id4).toMatch(/^[0-9a-f]{8}-/);
    expect(id1).not.toBe(id2);
  });

  // ── appendTurn ───────────────────────────────────────────────────

  it("appendTurn: creates new session history on first call", async () => {
    const store = {};
    const deps = {
      recall: async (key) => store[key] ?? null,
      remember: (key, value) => { store[key] = value; },
    };

    const result = await appendTurn(
      { sessionId: "sess-1", turn: { role: "turn", userMessage: "hello", assistantReply: "hi" } },
      deps,
    );

    expect(result.turnCount).toBe(1);
    expect(result.sessionId).toBe("sess-1");
    const history = store["session.forgemaster.sess-1.history"];
    expect(history).toHaveLength(1);
    expect(history[0].userMessage).toBe("hello");
    expect(history[0].timestamp).toBeDefined();
  });

  it("appendTurn: appends to existing session history", async () => {
    const store = {
      "session.forgemaster.sess-2.history": [
        { role: "turn", userMessage: "first", assistantReply: "response1", timestamp: "2026-01-01T00:00:00Z" },
      ],
    };
    const deps = {
      recall: async (key) => store[key] ?? null,
      remember: (key, value) => { store[key] = value; },
    };

    const result = await appendTurn(
      { sessionId: "sess-2", turn: { role: "turn", userMessage: "second", assistantReply: "response2" } },
      deps,
    );

    expect(result.turnCount).toBe(2);
    const history = store["session.forgemaster.sess-2.history"];
    expect(history).toHaveLength(2);
    expect(history[0].userMessage).toBe("first");
    expect(history[1].userMessage).toBe("second");
  });

  it("appendTurn: throws on missing sessionId", async () => {
    await expect(appendTurn({ sessionId: null, turn: {} }, {})).rejects.toThrow("requires a sessionId");
  });

  it("appendTurn: throws on missing turn object", async () => {
    await expect(appendTurn({ sessionId: "s1", turn: null }, {})).rejects.toThrow("requires a turn object");
  });

  // ── summarizeIfNeeded ────────────────────────────────────────────

  it("summarizeIfNeeded: no-op when history is at or below threshold", async () => {
    const history = Array.from({ length: SUMMARIZE_THRESHOLD }, (_, i) => ({
      role: "turn", userMessage: `msg-${i}`, timestamp: "2026-01-01T00:00:00Z",
    }));
    const store = { "session.forgemaster.s1.history": history };
    const deps = {
      recall: async (key) => store[key] ?? null,
      remember: (key, value) => { store[key] = value; },
    };

    const result = await summarizeIfNeeded({ sessionId: "s1" }, deps);
    expect(result.summarized).toBe(false);
    expect(result.turnCount).toBe(SUMMARIZE_THRESHOLD);
  });

  it("summarizeIfNeeded: triggers at turn 21 (threshold + 1)", async () => {
    const turnCount = SUMMARIZE_THRESHOLD + 1;
    const history = Array.from({ length: turnCount }, (_, i) => ({
      role: "turn", userMessage: `msg-${i}`, timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    }));
    const store = { "session.forgemaster.s1.history": [...history] };
    const deps = {
      recall: async (key) => store[key] ?? null,
      remember: (key, value) => { store[key] = value; },
    };

    const result = await summarizeIfNeeded({ sessionId: "s1" }, deps);

    expect(result.summarized).toBe(true);
    expect(result.summarizedCount).toBe(SUMMARIZE_COUNT);
    expect(result.remaining).toBe(turnCount - SUMMARIZE_COUNT);

    // L1 should have remaining turns only
    const updatedHistory = store["session.forgemaster.s1.history"];
    expect(updatedHistory).toHaveLength(turnCount - SUMMARIZE_COUNT);
    expect(updatedHistory[0].userMessage).toBe(`msg-${SUMMARIZE_COUNT}`);

    // L2 digest should exist
    const dateStr = new Date().toISOString().slice(0, 10);
    const digest = store[`project.forgemaster.digests.${dateStr}`];
    expect(digest).toHaveLength(1);
    expect(digest[0].sessionId).toBe("s1");
    expect(digest[0].turnCount).toBe(SUMMARIZE_COUNT);
    expect(digest[0].turns).toHaveLength(SUMMARIZE_COUNT);
  });

  it("summarizeIfNeeded: returns false for null sessionId", async () => {
    const result = await summarizeIfNeeded({ sessionId: null }, {});
    expect(result.summarized).toBe(false);
  });

  // ── Concurrent append tolerance ──────────────────────────────────

  it("appendTurn: concurrent appends do not lose turns", async () => {
    const store = {};
    const deps = {
      recall: async (key) => store[key] ?? null,
      remember: (key, value) => { store[key] = value; },
    };

    // Fire 5 concurrent appends
    const promises = Array.from({ length: 5 }, (_, i) =>
      appendTurn(
        { sessionId: "concurrent", turn: { role: "turn", userMessage: `msg-${i}` } },
        deps,
      ),
    );

    const results = await Promise.all(promises);

    // All 5 turns must be present
    const history = store["session.forgemaster.concurrent.history"];
    expect(history).toHaveLength(5);

    // Turn counts should be 1..5 (serialized by mutex)
    const counts = results.map((r) => r.turnCount).sort((a, b) => a - b);
    expect(counts).toEqual([1, 2, 3, 4, 5]);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Session ID integration in reasoning (Slice 6)
// ═══════════════════════════════════════════════════════════════════

describe("forge-master session integration", () => {
  let tmpDirS;

  beforeEach(() => {
    tmpDirS = mkdtempSync(join(tmpdir(), "forge-master-session-"));
    writeForgeJson(tmpDirS, {});
  });
  afterEach(() => {
    rmSync(tmpDirS, { recursive: true, force: true });
    _resetLocks();
  });

  function makeSessionDeps(client, overrides = {}) {
    return {
      provider: client,
      dispatcher: overrides.dispatcher || (async (name) => ({ tool: name, result: "ok" })),
      hub: overrides.hub || null,
      toolMetadata: {},
      recall: overrides.recall || (async () => null),
      remember: overrides.remember || (() => ({ ok: true })),
      ...overrides,
    };
  }

  it("reasoning: generates sessionId when not provided", async () => {
    const client = new MockReasoningClient([
      { type: "reply", content: "Hello there!" },
    ]);

    const result = await runTurn(
      { message: "what does my project do?", cwd: tmpDirS },
      makeSessionDeps(client),
    );

    expect(result.sessionId).toBeDefined();
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-/);
  });

  it("reasoning: preserves provided sessionId", async () => {
    const client = new MockReasoningClient([
      { type: "reply", content: "Status looks good." },
    ]);

    const result = await runTurn(
      { message: "what is the project status?", sessionId: "my-fixed-session", cwd: tmpDirS },
      makeSessionDeps(client),
    );

    expect(result.sessionId).toBe("my-fixed-session");
  });

  it("reasoning: off-topic returns sessionId", async () => {
    const result = await runTurn(
      { message: "what is the meaning of life?", cwd: tmpDirS },
      {
        callApiWorker: async () => ({ text: "OFFTOPIC" }),
        detectApiProvider: () => ({ provider: "test", apiKey: "k" }),
      },
    );

    expect(result.sessionId).toBeDefined();
    expect(result.sessionId).toMatch(/^[0-9a-f]{8}-/);
  });

  it("reasoning: persists turn history via brain deps", async () => {
    const store = {};
    const client = new MockReasoningClient([
      { type: "reply", content: "Analysis complete." },
    ]);

    const result = await runTurn(
      { message: "what is the current cost of my plan run?", sessionId: "persist-test", cwd: tmpDirS },
      makeSessionDeps(client, {
        recall: async (key) => store[key] ?? null,
        remember: (key, value) => { store[key] = value; },
      }),
    );

    expect(result.reply).toBe("Analysis complete.");
    const historyKey = `session.forgemaster.persist-test.history`;
    const history = store[historyKey];
    expect(history).toBeDefined();
    expect(history).toHaveLength(1);
    expect(history[0].userMessage).toBe("what is the current cost of my plan run?");
    expect(history[0].assistantReply).toBe("Analysis complete.");
  });

  it("reasoning: 21st turn triggers summarization", async () => {
    const store = {};
    // Pre-populate 20 turns
    const existingHistory = Array.from({ length: 20 }, (_, i) => ({
      role: "turn",
      userMessage: `msg-${i}`,
      assistantReply: `reply-${i}`,
      timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
    }));
    store["session.forgemaster.sum-test.history"] = existingHistory;

    const client = new MockReasoningClient([
      { type: "reply", content: "Turn 21." },
    ]);

    await runTurn(
      { message: "show the plan status for this phase", sessionId: "sum-test", cwd: tmpDirS },
      makeSessionDeps(client, {
        recall: async (key) => store[key] ?? null,
        remember: (key, value) => { store[key] = value; },
      }),
    );

    // L1 should have been trimmed (21 - 10 = 11 turns remaining)
    const history = store["session.forgemaster.sum-test.history"];
    expect(history.length).toBeLessThanOrEqual(21 - SUMMARIZE_COUNT);

    // Digest should exist
    const dateStr = new Date().toISOString().slice(0, 10);
    const digest = store[`project.forgemaster.digests.${dateStr}`];
    expect(digest).toBeDefined();
    expect(digest[0].turns).toHaveLength(SUMMARIZE_COUNT);
  });

  it("reasoning: persistence failure does not crash the turn", async () => {
    const client = new MockReasoningClient([
      { type: "reply", content: "Still works." },
    ]);

    const result = await runTurn(
      { message: "what is the current project health trend?", sessionId: "fail-test", cwd: tmpDirS },
      makeSessionDeps(client, {
        recall: async () => { throw new Error("brain unavailable"); },
        remember: () => { throw new Error("brain unavailable"); },
      }),
    );

    expect(result.reply).toBe("Still works.");
    expect(result.sessionId).toBe("fail-test");
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MockReasoningClient fixture
// ═══════════════════════════════════════════════════════════════════

describe("forge-master MockReasoningClient", () => {
  it("returns scripted responses in order", async () => {
    const client = new MockReasoningClient([
      { type: "tool_calls", toolCalls: [{ id: "1", name: "forge_status", args: {} }] },
      { type: "reply", content: "done" },
    ]);

    const r1 = await client.sendTurn({ messages: [], tools: [], model: "test" });
    expect(r1.type).toBe("tool_calls");
    expect(r1.toolCalls).toHaveLength(1);

    const r2 = await client.sendTurn({ messages: [], tools: [], model: "test" });
    expect(r2.type).toBe("reply");
    expect(r2.content).toBe("done");
  });

  it("returns default reply when script exhausted", async () => {
    const client = new MockReasoningClient([]);
    const r = await client.sendTurn({ messages: [], tools: [], model: "test" });
    expect(r.type).toBe("reply");
    expect(r.content).toContain("Script exhausted");
  });

  it("records call history", async () => {
    const client = new MockReasoningClient([{ type: "reply", content: "ok" }]);
    await client.sendTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "m1" });
    expect(client.callCount).toBe(1);
    expect(client.calls[0].model).toBe("m1");
  });

  it("throws when entry has error", async () => {
    const client = new MockReasoningClient([
      { error: new Error("api down") },
    ]);
    await expect(
      client.sendTurn({ messages: [], tools: [], model: "test" }),
    ).rejects.toThrow("api down");
  });

  it("reset clears call history", async () => {
    const client = new MockReasoningClient([{ type: "reply", content: "ok" }]);
    await client.sendTurn({ messages: [], tools: [], model: "test" });
    expect(client.callCount).toBe(1);
    client.reset();
    expect(client.callCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  Provider adapter unit tests (format translation only — no HTTP)
// ═══════════════════════════════════════════════════════════════════

import {
  buildAnthropicTools,
  formatMessages as formatAnthropicMessages,
  parseResponse as parseAnthropicResponse,
} from "../../pforge-master/src/providers/anthropic-tools.mjs";

import {
  buildOpenAITools,
  formatMessages as formatOpenAIMessages,
  parseResponse as parseOpenAIResponse,
} from "../../pforge-master/src/providers/openai-tools.mjs";

describe("forge-master providers/anthropic-tools", () => {
  it("buildAnthropicTools produces input_schema format", () => {
    const tools = buildAnthropicTools([
      { name: "forge_status", description: "Get status" },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("forge_status");
    expect(tools[0]).toHaveProperty("input_schema");
  });

  it("formatMessages extracts system messages", () => {
    const { system, messages } = formatAnthropicMessages([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(system).toBe("You are helpful.");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("formatMessages converts tool_result to Anthropic format", () => {
    const { messages } = formatAnthropicMessages([
      { role: "tool_result", toolCallId: "tc1", content: "result data" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content[0].type).toBe("tool_result");
    expect(messages[0].content[0].tool_use_id).toBe("tc1");
  });

  it("parseResponse detects tool_use blocks", () => {
    const result = parseAnthropicResponse({
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tu1", name: "forge_status", input: { plan: "phase-28" } },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(result.type).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("forge_status");
    expect(result.content).toBe("Let me check.");
    expect(result.tokensIn).toBe(100);
  });

  it("parseResponse returns reply when no tool_use", () => {
    const result = parseAnthropicResponse({
      content: [{ type: "text", text: "All good." }],
      usage: { input_tokens: 50, output_tokens: 30 },
    });
    expect(result.type).toBe("reply");
    expect(result.content).toBe("All good.");
  });
});

describe("forge-master providers/openai-tools", () => {
  it("buildOpenAITools produces function format", () => {
    const tools = buildOpenAITools([
      { name: "forge_status", description: "Get status", parameters: { type: "object" } },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("forge_status");
  });

  it("formatMessages converts tool_result to OpenAI tool role", () => {
    const msgs = formatOpenAIMessages([
      { role: "tool_result", toolCallId: "tc1", content: "result data" },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("tool");
    expect(msgs[0].tool_call_id).toBe("tc1");
  });

  it("formatMessages converts assistant with toolCalls", () => {
    const msgs = formatOpenAIMessages([
      {
        role: "assistant",
        content: "Checking",
        toolCalls: [{ id: "tc1", name: "forge_status", args: {} }],
      },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].tool_calls).toHaveLength(1);
    expect(msgs[0].tool_calls[0].function.name).toBe("forge_status");
  });

  it("parseResponse detects tool_calls in choices", () => {
    const result = parseOpenAIResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "tc1",
                type: "function",
                function: { name: "forge_status", arguments: '{"plan":"p1"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    });
    expect(result.type).toBe("tool_calls");
    expect(result.toolCalls[0].name).toBe("forge_status");
    expect(result.toolCalls[0].args).toEqual({ plan: "p1" });
  });

  it("parseResponse returns reply when no tool_calls", () => {
    const result = parseOpenAIResponse({
      choices: [{ message: { content: "Here you go." } }],
      usage: { prompt_tokens: 50, completion_tokens: 25 },
    });
    expect(result.type).toBe("reply");
    expect(result.content).toBe("Here you go.");
  });
});

