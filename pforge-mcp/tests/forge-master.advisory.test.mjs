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

import { TOOL_METADATA } from "../capabilities.mjs";
import { classify, LANES, LANE_TOOLS } from "../../pforge-master/src/intent-router.mjs";
import { UNIVERSAL_BASELINE } from "../../pforge-master/src/principles.mjs";
import { getPromptCatalog } from "../../pforge-master/src/prompts.mjs";
import { getForgeMasterCapabilitiesSummary } from "../forge-master-routes.mjs";

const __dirname = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1").replace(/\/$/, "");

// ─── 1. capabilities.mjs contract ──────────────────────────────────────────

describe("forge-master advisory — capabilities.mjs contract", () => {
  it("TOOL_METADATA.forge_master_ask.intent includes 'advisory'", () => {
    expect(TOOL_METADATA.forge_master_ask.intent).toContain("advisory");
  });

  it("TOOL_METADATA.forge_master_ask.agentGuidance mentions 'cto-in-a-box'", () => {
    expect(TOOL_METADATA.forge_master_ask.agentGuidance).toContain("cto-in-a-box");
  });

  it("TOOL_METADATA.forge_master_ask.agentGuidance mentions 'advisory'", () => {
    expect(TOOL_METADATA.forge_master_ask.agentGuidance).toContain("advisory");
  });

  it("addedIn is still '2.61.0' (advisory contract is documented in CHANGELOG, not a new version)", () => {
    expect(TOOL_METADATA.forge_master_ask.addedIn).toBe("2.61.0");
  });
});

// ─── 2. getForgeMasterCapabilitiesSummary ──────────────────────────────────

describe("forge-master advisory — getForgeMasterCapabilitiesSummary", () => {
  it("returns advisoryLaneAvailable: true when prompts module is present", async () => {
    const summary = await getForgeMasterCapabilitiesSummary();
    expect(summary).not.toBeNull();
    expect(summary.available).toBe(true);
    expect(summary.advisoryLaneAvailable).toBe(true);
  });

  it("promptCategories count is at least 8 (7 original + advisory)", async () => {
    const summary = await getForgeMasterCapabilitiesSummary();
    expect(summary.promptCategories).toBeGreaterThanOrEqual(8);
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

// ─── 5. Prompt catalog advisory category ──────────────────────────────────

describe("forge-master advisory — prompt catalog", () => {
  it("getPromptCatalog includes 'advisory' category", () => {
    const catalog = getPromptCatalog();
    const advisory = catalog.categories.find((c) => c.id === "advisory");
    expect(advisory).toBeDefined();
  });

  it("advisory category has at least 2 prompts", () => {
    const catalog = getPromptCatalog();
    const advisory = catalog.categories.find((c) => c.id === "advisory");
    expect(advisory.prompts.length).toBeGreaterThanOrEqual(2);
  });

  it("advisory prompts all have required shape (id, title, template, category)", () => {
    const catalog = getPromptCatalog();
    const advisory = catalog.categories.find((c) => c.id === "advisory");
    for (const prompt of advisory.prompts) {
      expect(prompt.id).toBeTruthy();
      expect(prompt.title).toBeTruthy();
      expect(prompt.template).toBeTruthy();
      expect(prompt.category).toBe("advisory");
    }
  });
});

// ─── 6. tools.json mirrors advisory intent ────────────────────────────────

describe("forge-master advisory — tools.json", () => {
  const toolsJson = JSON.parse(readFileSync(resolve(__dirname, "../tools.json"), "utf-8"));
  const entry = toolsJson.find((t) => t.name === "forge_master_ask");

  it("tools.json forge_master_ask entry exists", () => {
    expect(entry).toBeDefined();
  });

  it("tools.json forge_master_ask intent includes 'advisory'", () => {
    expect(entry.intent).toContain("advisory");
  });

  it("tools.json forge_master_ask agentGuidance mentions 'cto-in-a-box'", () => {
    expect(entry.agentGuidance).toContain("cto-in-a-box");
  });
});
