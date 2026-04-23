/**
 * Gate-Failure-Recurrence Detector — Phase-38.6 Slice 1.
 *
 * Scans run results for gate failure messages, groups by a normalised
 * gate pattern, and surfaces patterns that recur ≥ 3 times across ≥ 2 plans.
 *
 * @module patterns/detectors/gate-failure-recurrence
 */

/**
 * Normalise a gate failure message into a stable pattern key.
 * Strips volatile fragments (timestamps, paths, hashes, line numbers)
 * so structurally identical failures cluster together.
 */
function normaliseGatePattern(message) {
  if (!message || typeof message !== "string") return "unknown";
  return message
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z+-]+/g, "<timestamp>")   // ISO timestamps
    .replace(/\b[a-f0-9]{7,40}\b/g, "<hash>")                   // git hashes
    .replace(/:\d+:\d+/g, ":<line>:<col>")                       // file:line:col
    .replace(/line \d+/gi, "line <N>")                           // "line 42"
    .replace(/\d+(\.\d+)?\s*(s|ms|sec|seconds)/g, "<duration>") // durations
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract gate failure entries from a list of run summaries.
 * Each run is expected to have `{ plan, results: [{ gateStatus, gateError, gateOutput, failedCommand }] }`.
 */
function extractGateFailures(runs) {
  const failures = [];
  for (const run of runs) {
    const plan = run.plan || "unknown";
    const results = run.results || [];
    for (const slice of results) {
      if (slice.gateStatus === "failed") {
        const message = slice.gateError || slice.gateOutput || slice.failedCommand || "unknown gate failure";
        failures.push({
          plan,
          sliceNumber: slice.number,
          sliceTitle: slice.title,
          failedCommand: slice.failedCommand,
          message,
          pattern: normaliseGatePattern(message),
        });
      }
    }
  }
  return failures;
}

/**
 * Detector entry point.
 * @param {{ runs?: object[] }} ctx
 * @returns {import('../registry.mjs').Pattern[]}
 */
export default function detect({ runs = [] } = {}) {
  const failures = extractGateFailures(runs);
  if (!failures.length) return [];

  // Group by normalised pattern
  const groups = new Map();
  for (const f of failures) {
    if (!groups.has(f.pattern)) {
      groups.set(f.pattern, { occurrences: 0, plans: new Set(), samples: [] });
    }
    const g = groups.get(f.pattern);
    g.occurrences++;
    g.plans.add(f.plan);
    if (g.samples.length < 3) g.samples.push(f);
  }

  // Filter: ≥ 3 occurrences AND ≥ 2 distinct plans
  const patterns = [];
  for (const [pattern, group] of groups) {
    if (group.occurrences >= 3 && group.plans.size >= 2) {
      const planList = [...group.plans];
      const sample = group.samples[0];
      patterns.push({
        id: `gate-failure-recurrence:${pattern.slice(0, 60)}`,
        severity: group.occurrences >= 6 ? "error" : "warning",
        title: `Recurring gate failure: ${sample.failedCommand || pattern.slice(0, 80)}`,
        detail: [
          `Gate pattern "${pattern}" failed ${group.occurrences} times across ${planList.length} plans (${planList.join(", ")}).`,
          `Sample: slice ${sample.sliceNumber} "${sample.sliceTitle}" — ${sample.message.slice(0, 200)}`,
        ].join("\n"),
        occurrences: group.occurrences,
        plans: planList,
      });
    }
  }

  return patterns;
}

export { normaliseGatePattern, extractGateFailures };
