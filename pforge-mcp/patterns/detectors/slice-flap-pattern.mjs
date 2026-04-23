/**
 * Slice-Flap-Pattern Detector — Phase-38.6 Slice 2.
 *
 * Detects slices that have "flapped" — alternating between pass and fail
 * (pass→fail or fail→pass) ≥ 3 times across runs. Flapping slices
 * indicate unstable gates or non-deterministic tests.
 *
 * @module patterns/detectors/slice-flap-pattern
 */

/**
 * Resolve a stable slice key from a run + slice result.
 * Prefers title, falls back to number within the plan.
 */
function sliceKey(plan, slice) {
  const label = slice.title || `slice-${slice.number || 0}`;
  return `${plan}::${label}`;
}

/**
 * Determine pass/fail status from a slice result.
 * @returns {"pass"|"fail"|null}
 */
function resolveStatus(slice) {
  if (slice.gateStatus === "passed" || slice.status === "passed") return "pass";
  if (slice.gateStatus === "failed" || slice.status === "failed") return "fail";
  return null;
}

/**
 * Count state transitions (flaps) in an ordered list of statuses.
 * A flap is any adjacent pair where the status differs (pass→fail or fail→pass).
 */
function countFlaps(statuses) {
  let flaps = 0;
  for (let i = 1; i < statuses.length; i++) {
    if (statuses[i] !== statuses[i - 1]) flaps++;
  }
  return flaps;
}

/**
 * Build per-slice timelines from runs.
 * Each run is assumed to be chronologically ordered in the array.
 * @param {object[]} runs
 * @returns {Map<string, { statuses: string[], plan: string }>}
 */
function buildSliceTimelines(runs) {
  const timelines = new Map();
  for (const run of runs) {
    const plan = run.plan || "unknown";
    for (const slice of run.results || []) {
      const status = resolveStatus(slice);
      if (!status) continue;
      const key = sliceKey(plan, slice);
      if (!timelines.has(key)) {
        timelines.set(key, { statuses: [], plan });
      }
      timelines.get(key).statuses.push(status);
    }
  }
  return timelines;
}

/**
 * Detector entry point.
 * @param {{ runs?: object[] }} ctx
 * @returns {import('../registry.mjs').Pattern[]}
 */
export default function detect({ runs = [] } = {}) {
  const timelines = buildSliceTimelines(runs);
  const patterns = [];

  for (const [key, { statuses, plan }] of timelines) {
    const flaps = countFlaps(statuses);
    if (flaps >= 3) {
      const sliceLabel = key.split("::")[1] || key;
      patterns.push({
        id: `slice-flap-pattern:${sliceLabel}`,
        severity: flaps >= 5 ? "error" : "warning",
        title: `Slice "${sliceLabel}" flapped ${flaps} times`,
        detail: [
          `Slice "${sliceLabel}" in plan "${plan}" alternated between pass and fail ${flaps} times across ${statuses.length} observations.`,
          `Timeline: ${statuses.join(" → ")}.`,
        ].join("\n"),
        occurrences: flaps,
        plans: [plan],
      });
    }
  }

  return patterns;
}

export { countFlaps, buildSliceTimelines, resolveStatus };
