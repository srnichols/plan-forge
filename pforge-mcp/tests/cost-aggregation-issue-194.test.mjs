/**
 * Issue #194 — Quorum reviewer cost not aggregated into summary.cost.
 *
 * Before fix:
 *   - summary.cost.total_cost_usd counted only executor leg.
 *   - summary.cost.by_model omitted reviewer models entirely.
 *   - Live testbed run on Phase-4 reported $0.04 when actual cost
 *     (executor + 4 × ~$0.14 reviewerCost) was ~$0.60 — 15x under-report.
 *
 * After fix (cost-service.priceRun):
 *   - total_cost_usd = sum(executor cost) + sum(reviewer cost).
 *   - total_executor_cost_usd / total_reviewer_cost_usd exposed for transparency.
 *   - by_model includes reviewer models with apportioned cost + tokens.
 *   - by_slice[i] gains reviewer_cost_usd + reviewer_models siblings.
 *
 * Contract: sliceResult.quorum carries
 *   { score, models:[], reviewerFallback, reviewerCost, dryRunTokens:{in,out} }
 * exactly as orchestrator.runPlan persists it (see slice-N.json schema).
 */

import { describe, it, expect } from "vitest";
import { priceRun } from "../cost-service.mjs";

function executor(sliceN, extra = {}) {
  // gh-copilot CLI subscription slice — priceSlice returns $0.01 per
  // premiumRequest (PREMIUM_REQUEST_RATE in cost-service.mjs).
  return {
    number: String(sliceN),
    status: "passed",
    worker: "gh-copilot",
    tokens: { tokens_in: 25000, tokens_out: 1200, model: "claude-sonnet-4.6", premiumRequests: 1 },
    ...extra,
  };
}

function quorum(reviewerCost, models, tokensIn = 400000, tokensOut = 6800) {
  return {
    score: 3,
    models,
    reviewerFallback: false,
    reviewerCost,
    dryRunTokens: { tokens_in: tokensIn, tokens_out: tokensOut },
  };
}

describe("Issue #194 — quorum reviewer cost aggregation", () => {
  describe("baseline: no quorum, single executor", () => {
    it("total_cost_usd equals executor cost (subscription = $0.01)", () => {
      const r = priceRun([executor(1)]);
      expect(r.total_cost_usd).toBeCloseTo(0.01, 2);
      expect(r.total_executor_cost_usd).toBeCloseTo(0.01, 2);
      expect(r.total_reviewer_cost_usd).toBe(0);
    });

    it("by_model contains only the executor model", () => {
      const r = priceRun([executor(1)]);
      expect(Object.keys(r.by_model)).toEqual(["claude-sonnet-4.6"]);
    });

    it("by_slice[i] has zero reviewer fields", () => {
      const r = priceRun([executor(1)]);
      expect(r.by_slice[0].reviewer_cost_usd).toBe(0);
      expect(r.by_slice[0].reviewer_models).toEqual([]);
    });
  });

  describe("single-reviewer quorum", () => {
    it("includes reviewerCost in total_cost_usd", () => {
      const slices = [
        executor(1, { quorum: quorum(0.1449, ["claude-opus-4.7"]) }),
      ];
      const r = priceRun(slices);
      expect(r.total_cost_usd).toBeCloseTo(0.01 + 0.1449, 2);
      expect(r.total_reviewer_cost_usd).toBeCloseTo(0.1449, 2);
      expect(r.total_executor_cost_usd).toBeCloseTo(0.01, 2);
    });

    it("adds reviewer model to by_model with role tag", () => {
      const slices = [
        executor(1, { quorum: quorum(0.1449, ["claude-opus-4.7"], 394600, 6800) }),
      ];
      const r = priceRun(slices);
      expect(r.by_model).toHaveProperty("claude-opus-4.7");
      expect(r.by_model["claude-opus-4.7"].cost_usd).toBeCloseTo(0.1449, 4);
      expect(r.by_model["claude-opus-4.7"].slices).toBe(1);
      expect(r.by_model["claude-opus-4.7"].role).toBe("reviewer");
    });

    it("apportions reviewer tokens into total_tokens_in / out", () => {
      const slices = [
        executor(1, { quorum: quorum(0.1449, ["claude-opus-4.7"], 394600, 6800) }),
      ];
      const r = priceRun(slices);
      // executor tokens_in 25000 + reviewer 394600 = 419600
      expect(r.total_tokens_in).toBe(25000 + 394600);
      expect(r.total_tokens_out).toBe(1200 + 6800);
    });

    it("per-slice by_slice[i].cost_usd stays executor-only (no double-count)", () => {
      const slices = [
        executor(1, { quorum: quorum(0.1449, ["claude-opus-4.7"]) }),
      ];
      const r = priceRun(slices);
      expect(r.by_slice[0].cost_usd).toBeCloseTo(0.01, 2);
      expect(r.by_slice[0].reviewer_cost_usd).toBeCloseTo(0.1449, 4);
      expect(r.by_slice[0].reviewer_models).toEqual(["claude-opus-4.7"]);
    });
  });

  describe("multi-reviewer quorum (Phase-4 live repro)", () => {
    it("Phase-4 v3.0.1 regression: 4 slices × 2 reviewers ≈ $0.60 total", () => {
      // Mirrors actual values from the 2026-05-17T03-28-25-495Z Phase-4 run
      // where summary reported $0.04 but reviewer cost was $0.5607.
      const slices = [
        executor(1, { quorum: quorum(0.1449, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
        executor(2, { quorum: quorum(0.1554, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
        executor(3, { quorum: quorum(0.1326, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
        executor(4, { quorum: quorum(0.1278, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
      ];
      const r = priceRun(slices);
      // 4 × $0.01 executor + (0.1449+0.1554+0.1326+0.1278) reviewer = $0.04 + $0.5607
      expect(r.total_cost_usd).toBeCloseTo(0.04 + 0.5607, 2);
      expect(r.total_executor_cost_usd).toBeCloseTo(0.04, 2);
      expect(r.total_reviewer_cost_usd).toBeCloseTo(0.5607, 2);
    });

    it("apportions reviewer cost evenly across both reviewer models", () => {
      const slices = [
        executor(1, { quorum: quorum(0.2, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
      ];
      const r = priceRun(slices);
      // 0.2 split 50/50 = 0.1 each
      expect(r.by_model["claude-opus-4.7"].cost_usd).toBeCloseTo(0.1, 4);
      expect(r.by_model["gpt-5.3-codex"].cost_usd).toBeCloseTo(0.1, 4);
    });

    it("apportions reviewer tokens evenly across both reviewer models", () => {
      const slices = [
        executor(1, { quorum: quorum(0.2, ["claude-opus-4.7", "gpt-5.3-codex"], 400000, 6800) }),
      ];
      const r = priceRun(slices);
      expect(r.by_model["claude-opus-4.7"].tokens_in).toBe(200000);
      expect(r.by_model["claude-opus-4.7"].tokens_out).toBe(3400);
      expect(r.by_model["gpt-5.3-codex"].tokens_in).toBe(200000);
      expect(r.by_model["gpt-5.3-codex"].tokens_out).toBe(3400);
    });

    it("by_model.slices counts every slice the reviewer participated in", () => {
      const slices = [
        executor(1, { quorum: quorum(0.1, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
        executor(2, { quorum: quorum(0.1, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
        executor(3, { quorum: quorum(0.1, ["claude-opus-4.7", "gpt-5.3-codex"]) }),
      ];
      const r = priceRun(slices);
      expect(r.by_model["claude-opus-4.7"].slices).toBe(3);
      expect(r.by_model["gpt-5.3-codex"].slices).toBe(3);
      expect(r.by_model["claude-sonnet-4.6"].slices).toBe(3);
    });
  });

  describe("reviewer fallback (no reviewerCost)", () => {
    it("zero reviewer cost contributes nothing to totals", () => {
      const slices = [
        executor(1, {
          quorum: {
            score: 8,
            models: ["claude-opus-4.7", "gpt-5.3-codex"],
            reviewerFallback: true,
            reviewerCost: 0,
            dryRunTokens: { tokens_in: 0, tokens_out: 0 },
          },
        }),
      ];
      const r = priceRun(slices);
      expect(r.total_reviewer_cost_usd).toBe(0);
      expect(r.total_cost_usd).toBeCloseTo(0.01, 2);
      // When all reviewer telemetry is zero we don't manufacture by_model entries.
      expect(r.by_model).not.toHaveProperty("claude-opus-4.7");
      expect(r.by_model).not.toHaveProperty("gpt-5.3-codex");
    });
  });

  describe("mixed billing surface (executor model also a reviewer)", () => {
    it("tags overlap as role=mixed", () => {
      const slices = [
        // executor uses claude-sonnet-4.6, reviewers happen to include the same
        executor(1, { quorum: quorum(0.1, ["claude-sonnet-4.6", "gpt-5.3-codex"]) }),
      ];
      const r = priceRun(slices);
      // executor leg ran (cost_usd > 0 from priceSlice) before reviewer entry merged
      expect(r.by_model["claude-sonnet-4.6"].role).toBe("mixed");
      // gpt-5.3-codex appears only as reviewer
      expect(r.by_model["gpt-5.3-codex"].role).toBe("reviewer");
    });
  });

  describe("schema invariants", () => {
    it("total_executor_cost_usd + total_reviewer_cost_usd === total_cost_usd (penny rounding)", () => {
      const slices = [
        executor(1, { quorum: quorum(0.1449, ["claude-opus-4.7"]) }),
        executor(2, { quorum: quorum(0.1554, ["gpt-5.3-codex"]) }),
        executor(3),
      ];
      const r = priceRun(slices);
      const sum = r.total_executor_cost_usd + r.total_reviewer_cost_usd;
      expect(Math.abs(r.total_cost_usd - Math.round(sum * 100) / 100)).toBeLessThan(0.01);
    });

    it("every by_slice entry has reviewer_cost_usd + reviewer_models keys (even when zero)", () => {
      const r = priceRun([executor(1), executor(2)]);
      for (const s of r.by_slice) {
        expect(s).toHaveProperty("reviewer_cost_usd");
        expect(s).toHaveProperty("reviewer_models");
        expect(Array.isArray(s.reviewer_models)).toBe(true);
      }
    });

    it("skipped slices do not contribute to any total", () => {
      const slices = [
        { ...executor(1, { quorum: quorum(0.5, ["claude-opus-4.7"]) }), status: "skipped" },
        executor(2),
      ];
      const r = priceRun(slices);
      // Only executor #2 counted
      expect(r.total_cost_usd).toBeCloseTo(0.01, 2);
      expect(r.total_reviewer_cost_usd).toBe(0);
      expect(r.by_slice).toHaveLength(1);
    });
  });
});
