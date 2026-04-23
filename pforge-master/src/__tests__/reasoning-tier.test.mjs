/**
 * Tests for reasoning-tier.mjs — Phase-34, Slice 1.
 *
 * Covers resolveModel() directly (pure function) and the tier-based
 * fallback loop wired into runTurn() via a stubbed deps.provider.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveModel, VALID_TIERS } from "../reasoning-tier.mjs";
import { runTurn } from "../reasoning.mjs";

// ── resolveModel unit tests ──────────────────────────────────────────

const tieredConfig = {
  reasoningTiers: { low: "gpt-4o-mini", medium: "gpt-4o", high: "claude-opus-4" },
  reasoningModel: "gpt-4o-mini",
};

describe("resolveModel", () => {
  it("(1) returns the high-tier model when tier='high' and tiers are configured", () => {
    expect(resolveModel("high", tieredConfig)).toBe("claude-opus-4");
  });

  it("(2) returns the medium-tier model when tier='medium' and tiers are configured", () => {
    expect(resolveModel("medium", tieredConfig)).toBe("gpt-4o");
  });

  it("(3) returns the low-tier model when tier='low' and tiers are configured", () => {
    expect(resolveModel("low", tieredConfig)).toBe("gpt-4o-mini");
  });

  it("(4) falls back to reasoningModel when the tier has no explicit mapping", () => {
    const cfg = {
      reasoningTiers: { low: null, medium: null, high: null },
      reasoningModel: "gpt-4o",
    };
    expect(resolveModel("high", cfg)).toBe("gpt-4o");
  });

  it("(5) falls back to reasoningModel when tier is null or invalid", () => {
    expect(resolveModel(null, { reasoningModel: "gpt-4o" })).toBe("gpt-4o");
    expect(resolveModel("urgent", { reasoningModel: "gpt-4o" })).toBe("gpt-4o");
  });
});

// ── runTurn tier fallback integration tests ──────────────────────────

describe("runTurn tier fallback", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-tier-test-"));
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

  it("(6) falls back from 'high' to 'medium' on rate_limited and returns fallback telemetry", async () => {
    let calls = 0;
    const stubbedProvider = {
      PROVIDER_NAME: "stub",
      sendTurn: async ({ model }) => {
        calls++;
        // First call (high tier) → rate_limited
        if (calls === 1) {
          return { type: "rate_limited", retryAfter: null, raw: "" };
        }
        // Second call (medium tier) → success
        return { type: "reply", content: `ok from ${model}`, tokensIn: 1, tokensOut: 1 };
      },
    };

    const result = await runTurn(
      { message: "What is my plan status?", cwd: tmpDir, tier: "high" },
      {
        provider: stubbedProvider,
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        remember: () => ({ ok: true }),
        resolvedAllowlist: ["forge_plan_status"],
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.requestedTier).toBe("high");
    expect(result.fallbackFromTier).toBe("high");
    expect(result.resolvedModel).toBe("gpt-4o");
    expect(result.escalated).toBe(false);
    expect(calls).toBe(2);
  });

  it("(7) surfaces rate_limited error when tier='low' provider returns rate_limited", async () => {
    const stubbedProvider = {
      PROVIDER_NAME: "stub",
      sendTurn: async () => ({ type: "rate_limited", retryAfter: null, raw: "" }),
    };

    const result = await runTurn(
      { message: "What is my plan status?", cwd: tmpDir, tier: "low" },
      {
        provider: stubbedProvider,
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        remember: () => ({ ok: true }),
      },
    );

    expect(result.error).toBe("rate_limited");
    expect(result.requestedTier).toBe("low");
    expect(result.fallbackFromTier).toBeNull();
    expect(result.escalated).toBe(false);
  });
});
