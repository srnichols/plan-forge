/**
 * Model-Failure-Rate-by-Complexity Detector — Phase-38.6 Slice 2.
 *
 * Scans run results for models with failure rate > 25% on slices
 * with complexity ≥ 4. Helps identify models that struggle with
 * high-complexity work.
 *
 * @module patterns/detectors/model-failure-rate-by-complexity
 */

/**
 * Build a per-model stats map from runs, filtered to complexity ≥ 4.
 * @param {object[]} runs
 * @returns {Map<string, { total: number, failed: number, plans: Set<string> }>}
 */
function buildModelStats(runs) {
  const stats = new Map();
  for (const run of runs) {
    const plan = run.plan || "unknown";
    for (const slice of run.results || []) {
      const complexity = slice.complexity ?? slice.estimatedComplexity ?? 0;
      if (complexity < 4) continue;
      const model = slice.model || slice.modelUsed;
      if (!model) continue;

      if (!stats.has(model)) {
        stats.set(model, { total: 0, failed: 0, plans: new Set() });
      }
      const s = stats.get(model);
      s.total++;
      s.plans.add(plan);
      if (slice.status === "failed" || slice.gateStatus === "failed") {
        s.failed++;
      }
    }
  }
  return stats;
}

/**
 * Detector entry point.
 * @param {{ runs?: object[] }} ctx
 * @returns {import('../registry.mjs').Pattern[]}
 */
export default function detect({ runs = [] } = {}) {
  const stats = buildModelStats(runs);
  const patterns = [];

  for (const [model, s] of stats) {
    if (s.total === 0) continue;
    const rate = s.failed / s.total;
    if (rate > 0.25) {
      const pct = Math.round(rate * 100);
      const planList = [...s.plans];
      patterns.push({
        id: `model-failure-rate-by-complexity:${model}`,
        severity: pct >= 50 ? "error" : "warning",
        title: `${model} fails ${pct}% of high-complexity slices`,
        detail: [
          `Model "${model}" failed ${s.failed}/${s.total} slices (complexity ≥ 4) — ${pct}% failure rate.`,
          `Observed across plans: ${planList.join(", ")}.`,
        ].join("\n"),
        occurrences: s.failed,
        plans: planList,
      });
    }
  }

  return patterns;
}

export { buildModelStats };
