/**
 * Plan Forge — Watcher Module (Phase-39 Slice 3)
 *
 * Provides `buildCrossRunSnapshot(rootDir, opts)` — aggregates historical
 * `.forge/runs/{runId}/summary.json` files into a cross-run health snapshot that
 * feeds the existing `detectWatchAnomalies()` + `recommendFromAnomalies()`
 * pipeline in orchestrator.mjs.
 *
 * Contract: all exports are pure computation (no LLM calls, no disk writes).
 *
 * New anomaly codes produced via crossRun snapshot:
 *   cross-run.recurring-gate-failure  — same slice failed in ≥2 runs
 *   cross-run.retry-rate-spike        — avg retries/slice > 2 across runs
 *   cross-run.cost-anomaly-trend      — cost trend up >20% vs earlier window
 *   cross-run.slice-timeout-cluster   — same slice timed out in ≥2 runs
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Parse a window string like "14d", "7d", "30d" into milliseconds.
 * Falls back to 14 days for unrecognised formats.
 *
 * @param {string} [window="14d"]
 * @returns {number} Milliseconds
 */
export function parseWindowMs(window = "14d") {
  const match = String(window).match(/^(\d+)d$/);
  return match ? parseInt(match[1], 10) * MS_PER_DAY : 14 * MS_PER_DAY;
}

/**
 * Aggregate historical run summaries into a cross-run health snapshot.
 *
 * Reads all `.forge/runs/{runId}/summary.json` files whose `startTime` falls
 * within the requested window, then computes:
 *   - Per-slice failure-mode buckets
 *   - Retry rate trend
 *   - Cost trend (first-half vs second-half of window)
 *   - Slice timeout clusters
 *
 * The returned `crossRun` sub-object is consumed by `detectWatchAnomalies()`.
 * The top-level shape (`{ ok, anomalies, recommendations, snapshot }`) is
 * compatible with the existing `forge_watch` callers — no breaking change.
 *
 * @param {string} rootDir - Project root containing `.forge/runs/`
 * @param {object} [opts={}]
 * @param {string} [opts.window="14d"] - Lookback window (e.g. "7d", "14d", "30d")
 * @returns {Promise<object>} Cross-run snapshot
 */
export async function buildCrossRunSnapshot(rootDir, opts = {}) {
  const { window = "14d" } = opts;
  const windowMs = parseWindowMs(window);
  const cutoffMs = Date.now() - windowMs;

  const runsDir = resolve(rootDir, ".forge", "runs");
  if (!existsSync(runsDir)) {
    return {
      ok: false,
      mode: "cross-run",
      error: `No .forge/runs/ directory found at ${rootDir}`,
    };
  }

  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true });
  } catch (err) {
    return {
      ok: false,
      mode: "cross-run",
      error: `Cannot read runs directory: ${err.message}`,
    };
  }

  const runIds = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const summaries = [];
  for (const runId of runIds) {
    const summaryPath = resolve(runsDir, runId, "summary.json");
    if (!existsSync(summaryPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(summaryPath, "utf-8"));
      if (!raw.startTime) continue;
      const startMs = new Date(raw.startTime).getTime();
      if (!Number.isFinite(startMs) || startMs < cutoffMs) continue;
      summaries.push({ runId, ...raw });
    } catch {
      // Skip unreadable or malformed summary files
    }
  }

  if (summaries.length === 0) {
    return {
      ok: true,
      mode: "cross-run",
      targetPath: rootDir,
      window,
      windowMs,
      totalRuns: 0,
      passedRuns: 0,
      failedRuns: 0,
      runs: [],
      message: `No completed runs found within the last ${window} under ${runsDir}. Try a wider window or run a plan first.`,
      crossRun: {
        recurringFailures: [],
        retryRateSpike: false,
        costTrend: "flat",
        costTrendPercent: 0,
        sliceTimeoutClusters: [],
      },
    };
  }

  // Sort chronologically for cost-trend split
  const sorted = [...summaries].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const passedRuns = summaries.filter((s) => s.status === "completed").length;
  const failedRuns = summaries.filter((s) => s.status === "failed").length;

  // ── Per-slice aggregation ────────────────────────────────────────────
  const sliceFailMap = {};    // key → { failCount, totalCount, runIds[] }
  const sliceRetryMap = {};   // key → { totalAttempts, occurrences }
  const sliceTimeoutMap = {}; // key → count

  for (const run of summaries) {
    if (!Array.isArray(run.sliceResults)) continue;
    for (const sr of run.sliceResults) {
      const label = (sr.title ?? "slice").replace(/\s+/g, "-").slice(0, 40);
      const key = `${sr.number ?? "?"}-${label}`;

      // Failure tracking
      if (!sliceFailMap[key]) sliceFailMap[key] = { failCount: 0, totalCount: 0, runIds: [] };
      sliceFailMap[key].totalCount++;
      if (sr.status === "failed") {
        sliceFailMap[key].failCount++;
        if (!sliceFailMap[key].runIds.includes(run.runId)) {
          sliceFailMap[key].runIds.push(run.runId);
        }
      }

      // Retry tracking (attempts defaults to 1 = no retry)
      const attempts = typeof sr.attempts === "number" ? sr.attempts : 1;
      if (!sliceRetryMap[key]) sliceRetryMap[key] = { totalAttempts: 0, occurrences: 0 };
      sliceRetryMap[key].totalAttempts += attempts;
      sliceRetryMap[key].occurrences++;

      // Timeout detection: long duration OR killedBySignal OR statusReason contains "timeout"
      const isTimeout =
        (sr.duration != null && sr.duration > 5 * 60_000) ||
        sr.killedBySignal === true ||
        (typeof sr.statusReason === "string" &&
          sr.statusReason.toLowerCase().includes("timeout"));
      if (isTimeout) {
        sliceTimeoutMap[key] = (sliceTimeoutMap[key] ?? 0) + 1;
      }
    }
  }

  // Recurring gate failures: same slice failed in ≥2 distinct runs
  const recurringFailures = Object.entries(sliceFailMap)
    .filter(([, v]) => v.failCount >= 2)
    .map(([sliceName, v]) => ({
      sliceName,
      failCount: v.failCount,
      totalCount: v.totalCount,
      runIds: v.runIds,
    }))
    .sort((a, b) => b.failCount - a.failCount);

  // Retry rate spike: any slice averaging >2 attempts per occurrence
  const retryRateSpike = Object.values(sliceRetryMap).some(
    (v) => v.occurrences > 0 && v.totalAttempts / v.occurrences > 2
  );

  // Cost trend: average cost first-half vs second-half of the window
  const half = Math.floor(sorted.length / 2);
  let costTrend = "flat";
  let costTrendPercent = 0;
  if (half >= 1) {
    const first = sorted.slice(0, half);
    const second = sorted.slice(half);
    const avgFirst = first.reduce((s, r) => s + (r.cost?.total_cost_usd ?? 0), 0) / first.length;
    const avgSecond =
      second.reduce((s, r) => s + (r.cost?.total_cost_usd ?? 0), 0) / second.length;
    if (avgFirst > 0) {
      costTrendPercent = Math.round(((avgSecond - avgFirst) / avgFirst) * 100);
      if (costTrendPercent > 20) costTrend = "up";
      else if (costTrendPercent < -20) costTrend = "down";
    }
  }

  // Slice timeout clusters: same slice timed out in ≥2 runs
  const sliceTimeoutClusters = Object.entries(sliceTimeoutMap)
    .filter(([, count]) => count >= 2)
    .map(([sliceName, timeoutCount]) => ({ sliceName, timeoutCount }))
    .sort((a, b) => b.timeoutCount - a.timeoutCount);

  return {
    ok: true,
    mode: "cross-run",
    targetPath: rootDir,
    window,
    windowMs,
    totalRuns: summaries.length,
    passedRuns,
    failedRuns,
    runs: sorted.map((s) => ({
      runId: s.runId,
      startTime: s.startTime,
      endTime: s.endTime ?? null,
      status: s.status ?? null,
      cost: s.cost?.total_cost_usd ?? null,
      sliceCount: s.results?.total ?? (s.sliceResults?.length ?? 0),
    })),
    crossRun: {
      recurringFailures,
      retryRateSpike,
      costTrend,
      costTrendPercent,
      sliceTimeoutClusters,
    },
  };
}
