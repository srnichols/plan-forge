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
function readRunSummaries(runsDir, cutoffMs) {
  const summaries = [];
  const entries = readdirSync(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const summaryPath = resolve(runsDir, entry.name, "summary.json");
    if (!existsSync(summaryPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(summaryPath, "utf-8"));
      const startMs = raw.startTime ? new Date(raw.startTime).getTime() : NaN;
      if (!Number.isFinite(startMs) || startMs < cutoffMs) continue;
      summaries.push({ runId: entry.name, ...raw });
    } catch {
      // Skip unreadable or malformed summary files
    }
  }
  return summaries;
}

function emptyCrossRunSnapshot(rootDir, runsDir, window, windowMs) {
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

function sliceKey(sr) {
  const label = (sr.title ?? "slice").replace(/\s+/g, "-").slice(0, 40);
  return `${sr.number ?? "?"}-${label}`;
}

function isSliceTimeout(sr) {
  return (sr.duration != null && sr.duration > 5 * 60_000)
    || sr.killedBySignal === true
    || (typeof sr.statusReason === "string" && sr.statusReason.toLowerCase().includes("timeout"));
}

function aggregateSliceStats(summaries) {
  const sliceFailMap = {};
  const sliceRetryMap = {};
  const sliceTimeoutMap = {};
  for (const run of summaries) {
    if (!Array.isArray(run.sliceResults)) continue;
    for (const sr of run.sliceResults) {
      const key = sliceKey(sr);
      if (!sliceFailMap[key]) sliceFailMap[key] = { failCount: 0, totalCount: 0, runIds: [] };
      sliceFailMap[key].totalCount++;
      if (sr.status === "failed") {
        sliceFailMap[key].failCount++;
        if (!sliceFailMap[key].runIds.includes(run.runId)) sliceFailMap[key].runIds.push(run.runId);
      }
      if (!sliceRetryMap[key]) sliceRetryMap[key] = { totalAttempts: 0, occurrences: 0 };
      sliceRetryMap[key].totalAttempts += typeof sr.attempts === "number" ? sr.attempts : 1;
      sliceRetryMap[key].occurrences++;
      if (isSliceTimeout(sr)) sliceTimeoutMap[key] = (sliceTimeoutMap[key] ?? 0) + 1;
    }
  }
  return { sliceFailMap, sliceRetryMap, sliceTimeoutMap };
}

function buildRecurringFailures(sliceFailMap) {
  return Object.entries(sliceFailMap)
    .filter(([, value]) => value.failCount >= 2)
    .map(([sliceName, value]) => ({ sliceName, failCount: value.failCount, totalCount: value.totalCount, runIds: value.runIds }))
    .sort((a, b) => b.failCount - a.failCount);
}

function hasRetryRateSpike(sliceRetryMap) {
  return Object.values(sliceRetryMap).some((value) => value.occurrences > 0 && value.totalAttempts / value.occurrences > 2);
}

function buildCostTrend(sorted) {
  const half = Math.floor(sorted.length / 2);
  if (half < 1) return { costTrend: "flat", costTrendPercent: 0 };
  const first = sorted.slice(0, half);
  const second = sorted.slice(half);
  const avgFirst = first.reduce((sum, run) => sum + (run.cost?.total_cost_usd ?? 0), 0) / first.length;
  const avgSecond = second.reduce((sum, run) => sum + (run.cost?.total_cost_usd ?? 0), 0) / second.length;
  if (avgFirst <= 0) return { costTrend: "flat", costTrendPercent: 0 };
  const costTrendPercent = Math.round(((avgSecond - avgFirst) / avgFirst) * 100);
  return {
    costTrend: costTrendPercent > 20 ? "up" : costTrendPercent < -20 ? "down" : "flat",
    costTrendPercent,
  };
}

function buildSliceTimeoutClusters(sliceTimeoutMap) {
  return Object.entries(sliceTimeoutMap)
    .filter(([, count]) => count >= 2)
    .map(([sliceName, timeoutCount]) => ({ sliceName, timeoutCount }))
    .sort((a, b) => b.timeoutCount - a.timeoutCount);
}

function summarizeRuns(sorted) {
  return sorted.map((run) => ({
    runId: run.runId,
    startTime: run.startTime,
    endTime: run.endTime ?? null,
    status: run.status ?? null,
    cost: run.cost?.total_cost_usd ?? null,
    sliceCount: run.results?.total ?? (run.sliceResults?.length ?? 0),
  }));
}

export async function buildCrossRunSnapshot(rootDir, opts = {}) {
  const { window = "14d" } = opts;
  const windowMs = parseWindowMs(window);
  const runsDir = resolve(rootDir, ".forge", "runs");
  if (!existsSync(runsDir)) {
    return { ok: false, mode: "cross-run", error: `No .forge/runs/ directory found at ${rootDir}` };
  }

  let summaries;
  try {
    summaries = readRunSummaries(runsDir, Date.now() - windowMs);
  } catch (err) {
    return { ok: false, mode: "cross-run", error: `Cannot read runs directory: ${err.message}` };
  }
  if (summaries.length === 0) return emptyCrossRunSnapshot(rootDir, runsDir, window, windowMs);

  const sorted = [...summaries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const { sliceFailMap, sliceRetryMap, sliceTimeoutMap } = aggregateSliceStats(summaries);
  const { costTrend, costTrendPercent } = buildCostTrend(sorted);

  return {
    ok: true,
    mode: "cross-run",
    targetPath: rootDir,
    window,
    windowMs,
    totalRuns: summaries.length,
    passedRuns: summaries.filter((s) => s.status === "completed").length,
    failedRuns: summaries.filter((s) => s.status === "failed").length,
    runs: summarizeRuns(sorted),
    crossRun: {
      recurringFailures: buildRecurringFailures(sliceFailMap),
      retryRateSpike: hasRetryRateSpike(sliceRetryMap),
      costTrend,
      costTrendPercent,
      sliceTimeoutClusters: buildSliceTimeoutClusters(sliceTimeoutMap),
    },
  };
}
