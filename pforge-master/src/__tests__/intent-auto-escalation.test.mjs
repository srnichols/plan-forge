/**
 * Tests for auto-escalation of high-stakes lanes — Phase-34, Slice 2.
 *
 * Validates:
 *   (1) LANE_DESCRIPTORS marks the 3 high-stakes lanes with recommendedTierBump: 1
 *   (2) LANE_DESCRIPTORS marks the standard lanes with recommendedTierBump: 0
 *   (3) classify() routes a "tempering gate evaluation" message to LANES.TEMPERING
 *   (4) classify() routes a "principle judgment" message to LANES.PRINCIPLE_JUDGMENT
 *   (5) classify() routes a "meta-bug triage" message to LANES.META_BUG_TRIAGE
 *   (6) runTurn() auto-escalates tier and emits correct trace fields for a
 *       high-stakes lane message
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { classify, LANES, LANE_DESCRIPTORS } from "../intent-router.mjs";
import { runTurn } from "../reasoning.mjs";

// ── (1) LANE_DESCRIPTORS: high-stakes lanes have recommendedTierBump: 1 ──

describe("LANE_DESCRIPTORS — high-stakes bumps", () => {
  it("(1a) TEMPERING lane has recommendedTierBump: 1", () => {
    expect(LANE_DESCRIPTORS[LANES.TEMPERING].recommendedTierBump).toBe(1);
  });

  it("(1b) PRINCIPLE_JUDGMENT lane has recommendedTierBump: 1", () => {
    expect(LANE_DESCRIPTORS[LANES.PRINCIPLE_JUDGMENT].recommendedTierBump).toBe(1);
  });

  it("(1c) META_BUG_TRIAGE lane has recommendedTierBump: 1", () => {
    expect(LANE_DESCRIPTORS[LANES.META_BUG_TRIAGE].recommendedTierBump).toBe(1);
  });
});

// ── (2) LANE_DESCRIPTORS: standard lanes have recommendedTierBump: 0 ──

describe("LANE_DESCRIPTORS — standard lane bumps", () => {
  it("(2a) BUILD lane has recommendedTierBump: 0", () => {
    expect(LANE_DESCRIPTORS[LANES.BUILD].recommendedTierBump).toBe(0);
  });

  it("(2b) OPERATIONAL lane has recommendedTierBump: 0", () => {
    expect(LANE_DESCRIPTORS[LANES.OPERATIONAL].recommendedTierBump).toBe(0);
  });

  it("(2c) ADVISORY lane has recommendedTierBump: 0", () => {
    expect(LANE_DESCRIPTORS[LANES.ADVISORY].recommendedTierBump).toBe(0);
  });
});

// ── (3) classify() routes tempering gate evaluation to TEMPERING lane ──

describe("classify() high-stakes lane routing", () => {
  it("(3) routes 'tempering gate evaluation' to LANES.TEMPERING", async () => {
    const result = await classify("Please run a tempering gate evaluation for this slice");
    expect(result.lane).toBe(LANES.TEMPERING);
    expect(["low", "medium", "high"]).toContain(result.confidence);
  });

  // ── (4) classify() routes principle-judgment message ──

  it("(4) routes 'principle judgment' message to LANES.PRINCIPLE_JUDGMENT", async () => {
    const result = await classify("I need a principle judgment on whether to add this abstraction");
    expect(result.lane).toBe(LANES.PRINCIPLE_JUDGMENT);
    expect(["low", "medium", "high"]).toContain(result.confidence);
  });

  // ── (5) classify() routes meta-bug triage message ──

  it("(5) routes 'triage this meta bug' to LANES.META_BUG_TRIAGE", async () => {
    const result = await classify("Can you triage this meta bug from Slice 4?");
    expect(result.lane).toBe(LANES.META_BUG_TRIAGE);
    expect(["low", "medium", "high"]).toContain(result.confidence);
  });
});

// ── (6) runTurn() auto-escalates tier and emits trace fields ──

describe("runTurn() auto-escalation trace fields", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-autoesc-test-"));
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({
        forgeMaster: {
          reasoningTiers: {
            high: "claude-opus-4",
            medium: "gpt-4o",
            low: "gpt-4o-mini",
          },
        },
      }),
      "utf-8",
    );
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("(6) auto-escalates from medium to high for a tempering gate evaluation message and emits correct trace fields", async () => {
    const stubbedProvider = {
      PROVIDER_NAME: "stub",
      sendTurn: async ({ model }) => ({
        type: "reply",
        content: `ok from ${model}`,
        tokensIn: 1,
        tokensOut: 1,
      }),
    };

    const result = await runTurn(
      {
        message: "Please run a tempering gate evaluation now",
        cwd: tmpDir,
        tier: "medium",
      },
      {
        provider: stubbedProvider,
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        remember: () => ({ ok: true }),
      },
    );

    expect(result.autoEscalated).toBe(true);
    expect(result.fromTier).toBe("medium");
    expect(result.toTier).toBe("high");
    expect(result.reason).toMatch(/high-stakes lane/);
    expect(result.reason).toMatch(/tempering/);
    // The resolved model should be the high-tier model
    expect(result.resolvedModel).toBe("claude-opus-4");
    // requestedTier is still the originally requested tier
    expect(result.requestedTier).toBe("medium");
    // escalated (rate-limit fallback field) is unaffected
    expect(result.escalated).toBe(false);
  });
});
