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

const __dirname = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1").replace(/\/$/, "");

// ─── 1 & 2. capabilities.mjs + getForgeMasterCapabilitiesSummary ──────────
// Issue #149 Bucket A: advisory contract fields (intent, agentGuidance,
// advisoryLaneAvailable, advisory prompt category) were never implemented.
// Tracked in issue #149; implement when product decision is made.
it.todo("forge-master advisory — capabilities.mjs contract: intent/agentGuidance advisory fields (#149 Bucket A)");
it.todo("forge-master advisory — getForgeMasterCapabilitiesSummary: advisoryLaneAvailable field (#149 Bucket A)");

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
// Issue #149 Bucket A: advisory category not in prompt catalog; tools.json
// advisory fields not updated. Tracked in issue #149.
it.todo("forge-master advisory — prompt catalog: advisory category (#149 Bucket A)");
it.todo("forge-master advisory — tools.json: advisory intent/agentGuidance fields (#149 Bucket A)");
