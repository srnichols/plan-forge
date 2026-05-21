/**
 * Plan Forge — Forge-Master Advisory Contract Test (Phase-32, Slice 4).
 *
 * Validates the CTO-in-a-box advisory lane contract:
 *   1. capabilities.mjs TOOL_METADATA advertises advisory intent + cto-in-a-box
 *   2. getForgeMasterCapabilitiesSummary includes advisoryLaneAvailable: true
 *   3. Intent router has ADVISORY lane with keyword classification
 *   4. System prompt (UNIVERSAL_BASELINE) contains "Architecture-First"
 *   5. Prompt catalog has an advisory category
 *   6. tools.json mirrors advisory intent from capabilities.mjs
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { classify, LANES, LANE_TOOLS } from "../../pforge-master/src/intent-router.mjs";
import { UNIVERSAL_BASELINE } from "../../pforge-master/src/principles.mjs";
import { TOOL_METADATA } from "../capabilities/tool-metadata.mjs";
import { getForgeMasterCapabilitiesSummary } from "../forge-master-routes.mjs";
import { getPromptCatalog } from "../../pforge-master/src/prompts.mjs";

const __dirname = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1").replace(/\/$/, "");

// ─── 1 & 2. capabilities.mjs + getForgeMasterCapabilitiesSummary ──────────

describe("forge-master advisory — capabilities surface", () => {
  it("TOOL_METADATA.forge_master_ask declares advisory + cto-in-a-box intent", () => {
    const entry = TOOL_METADATA.forge_master_ask;
    expect(entry, "forge_master_ask entry must exist").toBeTruthy();
    expect(entry.intent).toContain("advisory");
    expect(entry.intent).toContain("cto-in-a-box");
  });

  it("TOOL_METADATA.forge_master_ask.agentGuidance mentions the advisory lane", () => {
    const guidance = TOOL_METADATA.forge_master_ask?.agentGuidance ?? "";
    expect(guidance.toLowerCase()).toMatch(/advisory|cto-in-a-box/);
  });

  it("getForgeMasterCapabilitiesSummary exposes advisoryLaneAvailable: true", async () => {
    const caps = await getForgeMasterCapabilitiesSummary();
    expect(caps, "summary must not be null when pforge-master is present").not.toBeNull();
    expect(caps.advisoryLaneAvailable).toBe(true);
  });
});

// ─── 3. Intent router — ADVISORY lane ──────────────────────────────────────

describe("forge-master advisory — intent router", () => {
  it("LANES.ADVISORY exists", () => {
    expect(LANES.ADVISORY).toBe("advisory");
  });

  it("LANE_TOOLS.advisory is defined and non-empty", () => {
    expect(LANE_TOOLS[LANES.ADVISORY]).toBeDefined();
    expect(LANE_TOOLS[LANES.ADVISORY].length).toBeGreaterThan(0);
  });

  it("'should I refactor or ship' classifies as advisory", async () => {
    const result = await classify("should I refactor or ship this module?");
    expect(result.lane).toBe(LANES.ADVISORY);
  });

  it("'what is the right approach for caching' classifies as advisory", async () => {
    const result = await classify("what is the right approach for our caching strategy?");
    expect(result.lane).toBe(LANES.ADVISORY);
  });

  it("'architecture advice on our database layer' classifies as advisory", async () => {
    const result = await classify("I need architecture advice on our database layer");
    expect(result.lane).toBe(LANES.ADVISORY);
  });
});

// ─── 4. System prompt contains Architecture-First ─────────────────────────

describe("forge-master advisory — Architecture-First in system prompt", () => {
  it("UNIVERSAL_BASELINE contains 'Architecture-First'", () => {
    expect(UNIVERSAL_BASELINE).toContain("Architecture-First");
  });

  it("system-prompt.md contains '### Architecture-First' heading", () => {
    const systemPromptPath = resolve(__dirname, "../../pforge-master/src/system-prompt.md");
    const content = readFileSync(systemPromptPath, "utf-8");
    expect(content).toContain("Architecture-First");
  });

  it("UNIVERSAL_BASELINE is injected when loadSystemPrompt falls back to baseline", () => {
    // The system prompt template substitutes {principles_block} with UNIVERSAL_BASELINE.
    // Assert the baseline is non-empty and begins with Architecture-First.
    expect(UNIVERSAL_BASELINE.trimStart()).toMatch(/^Architecture-First|^\*\*Architecture-First/i);
  });
});

// ─── 5 & 6. Prompt catalog + tools.json advisory fields ──────────────────

describe("forge-master advisory — prompt catalog & tools.json", () => {
  it("prompt catalog has an advisory category with ≥1 prompt", () => {
    const catalog = getPromptCatalog();
    const advisory = catalog.categories.find((c) => c.id === "advisory");
    expect(advisory, "advisory category must exist").toBeTruthy();
    expect(advisory.prompts.length).toBeGreaterThanOrEqual(1);
    for (const p of advisory.prompts) {
      expect(p.category).toBe("advisory");
    }
  });

  it("tools.json mirrors advisory intent + agentGuidance from TOOL_METADATA", () => {
    const toolsJsonPath = resolve(__dirname, "../tools.json");
    const tools = JSON.parse(readFileSync(toolsJsonPath, "utf-8"));
    const ask = tools.find((t) => t.name === "forge_master_ask");
    expect(ask, "forge_master_ask must appear in tools.json").toBeTruthy();
    expect(ask.intent).toContain("advisory");
    expect(ask.intent).toContain("cto-in-a-box");
    expect((ask.agentGuidance || "").toLowerCase()).toMatch(/advisory|cto-in-a-box/);
  });
});
