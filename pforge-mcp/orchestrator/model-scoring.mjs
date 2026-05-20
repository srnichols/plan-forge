/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S8: model-scoring sub-module
 *
 * Groups all model-recommendation and slice-complexity helpers in one place
 * so that cost-service.mjs can import them without going through the full
 * orchestrator.mjs surface and creating a circular dependency.
 *
 * Re-exports from peer sub-modules (no import from orchestrator.mjs):
 *   scoreSliceComplexity  ← orchestrator/review-watcher.mjs
 *   loadModelPerformance  ← orchestrator/forge-io.mjs
 *   aggregateModelStats   ← orchestrator/forge-io.mjs
 *   isApiOnlyModel        ← orchestrator/worker-spawn.mjs
 *   assessQuorumViability ← orchestrator/worker-spawn.mjs
 *   QUORUM_PRESETS        ← orchestrator/constants.mjs
 *
 * Owns:
 *   inferSliceType        (moved from orchestrator.mjs Phase-53 S8)
 *   recommendModel        (moved from orchestrator.mjs Phase-53 S8)
 */

import { loadModelPerformance, aggregateModelStats } from "./forge-io.mjs";
import { isApiOnlyModel, assessQuorumViability } from "./worker-spawn.mjs";

export { scoreSliceComplexity } from "./review-watcher.mjs";
export { loadModelPerformance, aggregateModelStats } from "./forge-io.mjs";
export { isApiOnlyModel, assessQuorumViability } from "./worker-spawn.mjs";
export { QUORUM_PRESETS } from "./constants.mjs";

/**
 * Infer the slice type from its title and tasks for model routing purposes.
 * Returns one of: "test" | "review" | "migration" | "execute"
 * @param {object} slice - Parsed slice object
 * @returns {string}
 */
export function inferSliceType(slice) {
  const text = [slice.title || "", ...(slice.tasks || [])].join(" ").toLowerCase();
  if (/\b(test|spec|unit test|integration test|e2e|coverage)\b/.test(text)) return "test";
  if (/\b(review|audit|lint|analyze|analyse|check|inspect)\b/.test(text)) return "review";
  if (/\b(migration|migrate|schema|seed|alter table|create table|drop table|dbcontext|ef core)\b/.test(text)) return "migration";
  return "execute";
}

/**
 * Recommend the best model for a given slice type based on historical performance.
 *
 * Selection criteria:
 *   1. Minimum 3 slices of data (MIN_SAMPLE)
 *   2. Success rate > 80%
 *   3. Cheapest qualifying model wins
 *
 * Records are filtered by sliceType when type info is present in history.
 * Falls back to all records when no type-specific data is available.
 *
 * @param {string} cwd - Project working directory
 * @param {string|null} sliceType - Slice type from inferSliceType(), or null for global stats
 * @returns {{ model: string, success_rate: number, avg_cost_usd: number, total_slices: number } | null}
 */
export function recommendModel(cwd, sliceType = null) {
  try {
    const records = loadModelPerformance(cwd);
    if (records.length === 0) return null;

    // Prefer type-specific records; fall back to all records
    const typed = sliceType ? records.filter((r) => r.sliceType === sliceType) : records;
    const relevant = typed.length >= 3 ? typed : records;

    const stats = aggregateModelStats(relevant);
    const MIN_SAMPLE = 3;
    const qualified = Object.entries(stats)
      .filter(([m, s]) => !isApiOnlyModel(m) && s.total_slices >= MIN_SAMPLE && s.success_rate > 0.8)
      .map(([m, s]) => ({
        model: m,
        success_rate: s.success_rate,
        avg_cost_usd: s.avg_cost_usd,
        total_slices: s.total_slices,
      }))
      .sort((a, b) => a.avg_cost_usd - b.avg_cost_usd);

    return qualified.length > 0 ? qualified[0] : null;
  } catch {
    return null;
  }
}
