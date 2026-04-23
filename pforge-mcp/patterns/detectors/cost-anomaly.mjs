/**
 * Cost-Anomaly Detector — Phase-38.6 Slice 2.
 *
 * Detects slices where cost spikes > 2× the rolling average for
 * that slice type. Helps identify unexpectedly expensive runs.
 *
 * @module patterns/detectors/cost-anomaly
 */

/**
 * Group cost entries by slice type (falls back to slice title or number).
 * @param {object[]} costs
 * @returns {Map<string, Array<{ cost: number, plan: string, slice: string }>>}
 */
function groupBySliceType(costs) {
  const groups = new Map();
  for (const entry of costs) {
    const type = entry.sliceType || entry.title || entry.slice || "unknown";
    const cost = typeof entry.cost === "number" ? entry.cost : 0;
    if (cost <= 0) continue;

    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push({
      cost,
      plan: entry.plan || "unknown",
      slice: type,
    });
  }
  return groups;
}

/**
 * Compute rolling average up to (but not including) index i.
 * Returns 0 if no prior entries exist.
 */
function rollingAverage(entries, i) {
  if (i === 0) return 0;
  let sum = 0;
  for (let j = 0; j < i; j++) sum += entries[j].cost;
  return sum / i;
}

/**
 * Detector entry point.
 * @param {{ costs?: object[] }} ctx
 * @returns {import('../registry.mjs').Pattern[]}
 */
export default function detect({ costs = [] } = {}) {
  if (!costs.length) return [];

  const groups = groupBySliceType(costs);
  const patterns = [];

  for (const [type, entries] of groups) {
    // Need at least 2 entries to compare against a baseline
    if (entries.length < 2) continue;

    const plans = new Set();
    const spikes = [];

    for (let i = 1; i < entries.length; i++) {
      const avg = rollingAverage(entries, i);
      if (avg > 0 && entries[i].cost > 2 * avg) {
        spikes.push({ entry: entries[i], avg, ratio: entries[i].cost / avg });
        plans.add(entries[i].plan);
      }
    }

    if (spikes.length > 0) {
      const worst = spikes.reduce((a, b) => (b.ratio > a.ratio ? b : a));
      const planList = [...plans];
      patterns.push({
        id: `cost-anomaly:${type}`,
        severity: worst.ratio >= 4 ? "error" : "warning",
        title: `Cost spike for "${type}" — ${worst.ratio.toFixed(1)}× rolling average`,
        detail: [
          `Slice type "${type}" had ${spikes.length} cost spike(s) exceeding 2× rolling average.`,
          `Worst spike: $${worst.entry.cost.toFixed(2)} vs avg $${worst.avg.toFixed(2)} (${worst.ratio.toFixed(1)}×).`,
          `Plans affected: ${planList.join(", ")}.`,
        ].join("\n"),
        occurrences: spikes.length,
        plans: planList,
      });
    }
  }

  return patterns;
}

export { groupBySliceType, rollingAverage };
