/**
 * Issue #180 — cost rollup zero. Aggressive testbed run produced summary.json
 * with total_cost_usd === 0 for gh-copilot CLI slices, even though stderr
 * clearly showed `Tokens ↑ 22.1k • ↓ 689` and the slice exited 0.
 *
 * These tests pin parseStderrStats against the real stderr captures from the
 * Phase-4 testbed run (and a few synthetic edge cases) so any future regex
 * regression fails loudly. Also verifies that the "premium request bumped to
 * 1 when stdout >200 and exit==0" fallback survives.
 */

import { describe, it, expect } from "vitest";
import { parseStderrStats, calculateSliceCost, shouldDefaultPremiumRequestsToOne } from "../orchestrator.mjs";

describe("Issue #180 — parseStderrStats against real testbed stderr", () => {
  it("parses gh-copilot Unicode header (testbed slice 4 captured stderr)", () => {
    const stderr = [
      "Changes   +0 -0",
      "AI Units  22.7 (33s)",
      "Tokens    ↑ 22.1k • ↓ 689 • 143.2k (cached)",
    ].join("\n");

    const stats = parseStderrStats(stderr);
    expect(stats.tokens_in).toBe(22100);
    expect(stats.tokens_out).toBe(689);
  });

  it("parses Unicode header with explicit Model line", () => {
    const stderr = [
      "Model     claude-opus-4.6",
      "Tokens    ↑ 22.1k • ↓ 689 • 143.2k (cached)",
      "Requests  1 Premium (33s)",
    ].join("\n");

    const stats = parseStderrStats(stderr);
    expect(stats.model).toBe("claude-opus-4.6");
    expect(stats.tokens_in).toBe(22100);
    expect(stats.tokens_out).toBe(689);
    expect(stats.premiumRequests).toBe(1);
  });

  it("parses ASCII fallback header (terminals that strip ↑↓•)", () => {
    const stderr = "Tokens    ^ 22.1k * v 689 * 143.2k (cached)";
    const stats = parseStderrStats(stderr);
    expect(stats.tokens_in).toBe(22100);
    expect(stats.tokens_out).toBe(689);
  });

  it("returns zeros when stderr has no recognizable Token line", () => {
    const stats = parseStderrStats("Hello world\nNo stats here.\n");
    expect(stats.tokens_in).toBe(0);
    expect(stats.tokens_out).toBe(0);
    expect(stats.premiumRequests).toBe(0);
    expect(stats.model).toBeNull();
  });

  it("handles empty / null stderr gracefully", () => {
    expect(parseStderrStats("")).toEqual({ model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 });
    expect(parseStderrStats(null)).toEqual({ model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 });
    expect(parseStderrStats(undefined)).toEqual({ model: null, tokens_in: 0, tokens_out: 0, premiumRequests: 0 });
  });

  it("parses old-format 'N Premium request(s)'", () => {
    const stats = parseStderrStats("3 Premium requests used");
    expect(stats.premiumRequests).toBe(3);
  });

  it("parses 'Requests  N Premium (duration)' style", () => {
    const stats = parseStderrStats("Requests  7 Premium (2m 14s)");
    expect(stats.premiumRequests).toBe(7);
  });
});

describe("Issue #180 — calculateSliceCost for CLI workers with parsed tokens", () => {
  it("non-zero cost when gh-copilot has premiumRequests>=1", () => {
    const tokens = {
      tokens_in: 22100,
      tokens_out: 689,
      model: "claude-opus-4.6",
      premiumRequests: 1,
    };
    const result = calculateSliceCost(tokens, "gh-copilot");
    expect(result.cost_usd).toBeGreaterThan(0);
    expect(result.cost_usd).toBe(0.01); // 1 × $0.01 PREMIUM_REQUEST_RATE
  });

  it("ZERO cost when premiumRequests is 0 (the symptom of #180)", () => {
    const tokens = {
      tokens_in: 22100,
      tokens_out: 689,
      model: "claude-opus-4.6",
      premiumRequests: 0,
    };
    const result = calculateSliceCost(tokens, "gh-copilot");
    expect(result.cost_usd).toBe(0); // PROOF: zero premiumRequests → zero cost
  });

  it("cost scales with premiumRequests count", () => {
    const tokens = { tokens_in: 0, tokens_out: 0, model: "x", premiumRequests: 5 };
    const result = calculateSliceCost(tokens, "gh-copilot");
    expect(result.cost_usd).toBe(0.05); // 5 × $0.01
  });
});

describe("Issue #180 — shouldDefaultPremiumRequestsToOne fallback widening", () => {
  const baseTokens = { premiumRequests: 0, tokens_in: 0, tokens_out: 0 };

  it("returns false when premiumRequests already > 0", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: { premiumRequests: 3 }, stdout: "", stderr: "", code: 0, timedOut: false,
    })).toBe(false);
  });

  it("returns false when CLI timed out", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: baseTokens, stdout: "x".repeat(500), stderr: "", code: 0, timedOut: true,
    })).toBe(false);
  });

  it("returns false when CLI exited non-zero", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: baseTokens, stdout: "x".repeat(500), stderr: "", code: 1, timedOut: false,
    })).toBe(false);
  });

  it("returns true on long stdout (legacy heuristic)", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: baseTokens, stdout: "x".repeat(500), stderr: "", code: 0, timedOut: false,
    })).toBe(true);
  });

  it("(#180) returns true when stdout is short but tokens were parsed from stderr", () => {
    const tokens = { premiumRequests: 0, tokens_in: 22100, tokens_out: 689 };
    expect(shouldDefaultPremiumRequestsToOne({
      tokens, stdout: "short", stderr: "Tokens ↑ 22.1k • ↓ 689", code: 0, timedOut: false,
    })).toBe(true);
  });

  it("(#180) returns true when stderr has Tokens header even without parsed counts", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: baseTokens,
      stdout: "short",
      stderr: "Changes +0 -0\nTokens    ↑ 22.1k • ↓ 689 • 143.2k (cached)",
      code: 0,
      timedOut: false,
    })).toBe(true);
  });

  it("(#180) returns true for ASCII fallback Tokens header", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: baseTokens,
      stdout: "short",
      stderr: "Tokens    ^ 22.1k * v 689 * cached",
      code: 0,
      timedOut: false,
    })).toBe(true);
  });

  it("returns false when stdout short AND stderr has no token markers", () => {
    expect(shouldDefaultPremiumRequestsToOne({
      tokens: baseTokens, stdout: "short", stderr: "Done.", code: 0, timedOut: false,
    })).toBe(false);
  });
});
