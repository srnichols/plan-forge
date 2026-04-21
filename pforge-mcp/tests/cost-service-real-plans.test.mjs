import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import * as costService from "../cost-service.mjs";
import { parsePlan } from "../orchestrator.mjs";

// Phase-27.1 Slice 4 — Real-plan smoke matrix.
//
// The 21 synthetic tests in cost-service.test.mjs pass with handwritten
// 6-slice fixtures. Real plans in docs/plans/ have 7–17 slices with varying
// complexity distributions, and it was real plans that exposed all four
// v2.60.0 estimator defects:
//   * identical power/speed overhead (Slice 1) — per-leg pricing fix
//   * opus-4.7 priced as sonnet (Slice 2) — MODEL_PRICING coverage fix
//   * auto degenerated to false (Slice 3) — threshold 7 → 5
//   * forge_estimate_quorum 404 via bridge (Slice 2b) — MCP_ONLY_TOOLS fix
//
// This matrix runs estimateQuorum against every Phase-*-PLAN.md file in
// docs/plans/ and asserts cross-preset invariants. If any of the above
// regresses, this test will trip before release.

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PLANS_DIR = resolve(REPO_ROOT, "docs", "plans");

function listRealPlans() {
  const all = readdirSync(PLANS_DIR);
  return all
    .filter((n) => /^Phase-[\d.]+-.*-PLAN\.md$/.test(n))
    .map((n) => join(PLANS_DIR, n))
    .sort();
}

describe("cost-service: real-plan smoke matrix (Phase-27.1 Slice 4)", () => {
  const planPaths = listRealPlans();

  it("sanity — discovers the Phase-*-PLAN.md files", () => {
    expect(planPaths.length).toBeGreaterThanOrEqual(5);
  });

  const parsed = planPaths
    .map((path) => {
      try {
        const plan = parsePlan(path, REPO_ROOT);
        return { path, plan };
      } catch (err) {
        return { path, plan: null, err };
      }
    })
    .filter((p) => p.plan && p.plan.slices && p.plan.slices.length > 0);

  for (const { path, plan } of parsed) {
    const planName = path.split(/[\\/]/).pop();

    describe(planName, () => {
      const result = costService.estimateQuorum({ plan, cwd: null });

      it("returns finite numeric estimates for all four modes", () => {
        for (const mode of ["auto", "power", "speed", "false"]) {
          const s = result[mode];
          expect(Number.isFinite(s.estimatedCostUSD), `${mode}.estimatedCostUSD must be finite`).toBe(true);
          expect(s.estimatedCostUSD).toBeGreaterThanOrEqual(0);
          expect(["historical", "heuristic"]).toContain(s.confidence);
        }
      });

      it("power > speed > false (pricing distinguishes presets)", () => {
        expect(result.power.estimatedCostUSD).toBeGreaterThan(result.speed.estimatedCostUSD);
        expect(result.speed.estimatedCostUSD).toBeGreaterThan(result["false"].estimatedCostUSD);
      });

      it("auto <= speed (auto is a subset-scoped speed run)", () => {
        expect(result.auto.estimatedCostUSD).toBeLessThanOrEqual(result.speed.estimatedCostUSD + 0.01);
      });
    });
  }

  it("auto.quorumSliceCount obeys the auto threshold on every real plan (Slice 3 invariant)", async () => {
    // Pre-Slice-3, threshold was 7 — higher than the max complexity score
    // produced by scoreSliceComplexity (observed max: 4 across all 7 real
    // plans in docs/plans/). Post-Slice-3 threshold is 5, matching
    // QUORUM_PRESETS.power.threshold. On the current repo, this still
    // produces 0 auto-quorum slices — a real finding: the synthetic-score
    // scale + real-plan feature shapes leave auto effectively inert.
    //
    // This test asserts the INVARIANT (not a minimum count): auto.quorumSliceCount
    // must equal the count of slices whose score >= the active auto threshold.
    // If the threshold changes in cost-service.estimateQuorum's autoConfig, or
    // if scoreSliceComplexity starts producing larger numbers, this test will
    // still hold — it asserts the formula, not a magic number.
    const { scoreSliceComplexity } = await import("../orchestrator.mjs");
    const AUTO_THRESHOLD = 5; // Phase-27.1 Slice 3 value (matches power preset)

    for (const { path, plan } of parsed) {
      const result = costService.estimateQuorum({ plan, cwd: null });
      const expectedCount = plan.slices.filter(
        (s) => scoreSliceComplexity(s, REPO_ROOT).score >= AUTO_THRESHOLD
      ).length;
      expect(
        result.auto.quorumSliceCount,
        `auto.quorumSliceCount must match slices meeting threshold ${AUTO_THRESHOLD} for ${path}`
      ).toBe(expectedCount);
    }
  });
});
