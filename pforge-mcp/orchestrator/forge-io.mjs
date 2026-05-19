/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S5: forge-io sub-module
 *
 * I/O helpers and reporting functions extracted from orchestrator.mjs:
 * forge directory management, cost/performance reporting, health trends,
 * run pruning, and gate-check configuration/responder.
 *
 * Private helpers (readForgeJson, readForgeJsonl, appendForgeJsonl,
 * computeTrendDirection, readReviewQueueState) are included here as
 * unexported copies; they will be deduplicated in a later slice when
 * their own sub-modules land.
 */

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, statSync, rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { isApiOnlyModel } from "./worker-spawn.mjs";
import { recall as brainRecall, loadReviewerConfig, invokeReviewer } from "../brain.mjs";

// ─── Private helpers ──────────────────────────────────────────────────
// These mirror the public implementations in orchestrator.mjs and will be
// removed when the corresponding sub-modules are extracted (Phase-53 S6+).

export function readForgeJson(filePath, defaultValue = null, cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return JSON.parse(readFileSync(fullPath, "utf-8"));
    }
  } catch { /* corrupt/missing → return default */ }
  return defaultValue;
}

export function readForgeJsonl(filePath, defaultValue = [], cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8")
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
    // G2.1 shim: try the legacy `.json` variant for newly-renamed files
    if (filePath.endsWith(".jsonl")) {
      const legacy = resolve(cwd, ".forge", filePath.slice(0, -1)); // .jsonl → .json
      if (existsSync(legacy)) {
        return readFileSync(legacy, "utf-8")
          .split("\n")
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      }
    }
    return defaultValue;
  } catch { return defaultValue; }
}

export function appendForgeJsonl(filePath, record, cwd = process.cwd(), opts = {}) {
  const fullPath = resolve(cwd, ".forge", filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  const stamped = {
    _v: 1,
    ...(opts.correlationId ? { _correlationId: opts.correlationId } : {}),
    ...record,
  };
  appendFileSync(fullPath, JSON.stringify(stamped) + "\n");
}

/** Compute trend direction from an ordered array of numeric values. */
function computeTrendDirection(values) {
  if (!values || values.length < 2) return "insufficient-data";
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const delta = avg2 - avg1;
  const threshold = Math.abs(avg1) * 0.05 || 1;
  if (delta > threshold) return "increasing";
  if (delta < -threshold) return "decreasing";
  return "stable";
}

function readReviewQueueState(targetPath) {
  const dir = resolve(targetPath, ".forge", "review-queue");
  if (!existsSync(dir)) return null;

  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch { return null; }

  const state = {
    total: 0, open: 0, resolved: 0, deferred: 0,
    lastActivityTs: null,
    bySeverity: { blocker: 0, high: 0, medium: 0, low: 0 },
    bySource: {},
  };

  for (const file of entries) {
    try {
      const raw = readFileSync(resolve(dir, file), "utf-8");
      const item = JSON.parse(raw);
      state.total++;
      if (item.status === "open") state.open++;
      else if (item.status === "resolved") state.resolved++;
      else if (item.status === "deferred") state.deferred++;

      if (item.severity && state.bySeverity[item.severity] !== undefined) {
        state.bySeverity[item.severity]++;
      }
      if (item.source) {
        state.bySource[item.source] = (state.bySource[item.source] || 0) + 1;
      }

      const ts = item.resolvedAt || item.createdAt;
      if (ts && (!state.lastActivityTs || ts > state.lastActivityTs)) {
        state.lastActivityTs = ts;
      }
    } catch {
      console.warn(`[review-queue] skipping corrupt file in state reader: ${file}`);
    }
  }

  return state;
}

// ─── Operational Data Infrastructure ──────────────────────────────────

/**
 * Ensure a subdirectory exists under .forge/.
 * @param {string} subpath - Relative path under .forge/ (e.g. "runs", "telemetry"). Use "" for .forge/ root.
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {string} Resolved absolute path of the created directory
 */
export function ensureForgeDir(subpath, cwd = process.cwd()) {
  const dir = resolve(cwd, ".forge", subpath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── G2.3 — Run pruning ───────────────────────────────────────────────

/**
 * G2.3 (v2.36): prune `.forge/runs/<runId>/` directories. Two retention
 * dimensions are checked; a run is removed if it fails EITHER:
 *   - older than `maxAgeDays` days (default 30), OR
 *   - falls outside the newest `maxRuns` runs (default 50)
 *
 * Best-effort: filesystem errors on individual runs are logged via the
 * returned `errors[]` but never throw. The newest run is always kept.
 *
 * @param {string} [cwd=process.cwd()]
 * @param {{maxAgeDays?: number, maxRuns?: number, dryRun?: boolean}} [opts]
 * @returns {{kept: string[], pruned: string[], errors: Array<{runId: string, error: string}>, dryRun: boolean}}
 */
export function pruneForgeRuns(cwd = process.cwd(), opts = {}) {
  const { maxAgeDays = 30, maxRuns = 50, dryRun = false } = opts;
  const runsDir = resolve(cwd, ".forge", "runs");
  const result = { kept: [], pruned: [], errors: [], dryRun };
  if (!existsSync(runsDir)) return result;

  let entries;
  try {
    entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()         // ISO-like timestamps sort lexicographically
      .reverse();     // newest first
  } catch (err) {
    result.errors.push({ runId: "<runs-dir>", error: err.message });
    return result;
  }

  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (let i = 0; i < entries.length; i++) {
    const runId = entries[i];
    const runPath = resolve(runsDir, runId);
    let prune = false;
    if (i >= maxRuns) prune = true;
    if (!prune) {
      try {
        const stat = statSync(runPath);
        if (stat.mtimeMs < cutoffMs) prune = true;
      } catch (err) {
        result.errors.push({ runId, error: err.message });
        continue;
      }
    }
    // Always keep the newest run regardless of age
    if (i === 0) prune = false;

    if (prune) {
      if (!dryRun) {
        try { rmSync(runPath, { recursive: true, force: true }); }
        catch (err) { result.errors.push({ runId, error: err.message }); continue; }
      }
      result.pruned.push(runId);
    } else {
      result.kept.push(runId);
    }
  }
  return result;
}

// ─── Model Performance Tracking (Phase 3) ────────────────────────────

/**
 * Load the model performance log from .forge/model-performance.json.
 * Returns an array of per-slice performance entries, or [] if none exists.
 *
 * Migration (v2.62.1): on first load after the fix, drops any entries where
 * the model name matches an API-only provider (grok-*, gpt-*, etc.), writes
 * the cleaned file back, and logs a one-line notice. Idempotent — if no
 * entries are removed the file is not rewritten.
 */
export function loadModelPerformance(cwd) {
  // Meta-bug #97: callers may pass null cwd to opt out of history lookup.
  if (!cwd) return [];
  const perfPath = resolve(cwd, ".forge", "model-performance.json");
  if (!existsSync(perfPath)) return [];
  try {
    const data = JSON.parse(readFileSync(perfPath, "utf-8"));
    if (!Array.isArray(data)) return [];
    const clean = data.filter(r => !isApiOnlyModel(r.model));
    if (clean.length < data.length) {
      writeFileSync(perfPath, JSON.stringify(clean, null, 2));
      console.log(`[perf] scrubbed ${data.length - clean.length} API-worker entries from model-performance.json`);
    }
    return clean;
  } catch {
    return [];
  }
}

/**
 * Aggregate model performance records into per-model stats.
 * @param {Array} records - from loadModelPerformance()
 * @returns {object} model → { total_slices, passed, failed, success_rate, avg_cost_usd }
 */
export function aggregateModelStats(records) {
  const stats = {};
  for (const r of records) {
    const m = r.model || "unknown";
    if (!stats[m]) stats[m] = { total_slices: 0, passed: 0, failed: 0, total_cost_usd: 0 };
    stats[m].total_slices += 1;
    if (r.status === "passed") stats[m].passed += 1;
    else stats[m].failed += 1;
    stats[m].total_cost_usd += r.cost_usd || 0;
  }
  const result = {};
  for (const [model, s] of Object.entries(stats)) {
    result[model] = {
      total_slices: s.total_slices,
      passed: s.passed,
      failed: s.failed,
      success_rate: s.total_slices > 0 ? Math.round((s.passed / s.total_slices) * 1000) / 1000 : 0,
      avg_cost_usd: s.total_slices > 0 ? Math.round((s.total_cost_usd / s.total_slices) * 1_000_000) / 1_000_000 : 0,
    };
  }
  return result;
}

// ─── Cost History ──────────────────────────────────────────────────────

/**
 * Generate a cost report from .forge/cost-history.json.
 * Returns formatted summary with totals, per-model breakdown, and monthly aggregation.
 */
export function getCostReport(cwd) {
  const historyPath = resolve(cwd, ".forge", "cost-history.json");
  const modelStats = aggregateModelStats(loadModelPerformance(cwd));
  if (!existsSync(historyPath)) {
    return { runs: 0, message: "No cost history yet. Run `pforge run-plan` to start tracking.", forge_model_stats: modelStats };
  }

  let history;
  try {
    history = JSON.parse(readFileSync(historyPath, "utf-8"));
    if (!Array.isArray(history)) return { runs: 0, message: "Invalid cost history format.", forge_model_stats: modelStats };
  } catch {
    return { runs: 0, message: "Could not parse cost-history.json.", forge_model_stats: modelStats };
  }

  if (history.length === 0) {
    return { runs: 0, message: "Cost history is empty.", forge_model_stats: modelStats };
  }

  // Aggregate totals
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const modelTotals = {};
  const monthly = {};

  for (const entry of history) {
    totalCost += entry.total_cost_usd || 0;
    totalTokensIn += entry.total_tokens_in || 0;
    totalTokensOut += entry.total_tokens_out || 0;

    // Per-model aggregation
    if (entry.by_model) {
      for (const [model, data] of Object.entries(entry.by_model)) {
        if (!modelTotals[model]) modelTotals[model] = { tokens_in: 0, tokens_out: 0, cost_usd: 0, runs: 0 };
        modelTotals[model].tokens_in += data.tokens_in || 0;
        modelTotals[model].tokens_out += data.tokens_out || 0;
        modelTotals[model].cost_usd += data.cost_usd || 0;
        modelTotals[model].runs += 1;
      }
    }

    // Monthly aggregation
    const month = (entry.date || "").substring(0, 7); // YYYY-MM
    if (month) {
      if (!monthly[month]) monthly[month] = { runs: 0, cost_usd: 0 };
      monthly[month].runs += 1;
      monthly[month].cost_usd += entry.total_cost_usd || 0;
    }
  }

  // Round model totals
  for (const m of Object.values(modelTotals)) {
    m.cost_usd = Math.round(m.cost_usd * 100) / 100;
  }
  for (const m of Object.values(monthly)) {
    m.cost_usd = Math.round(m.cost_usd * 100) / 100;
  }

  return {
    runs: history.length,
    total_cost_usd: Math.round(totalCost * 100) / 100,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    by_model: modelTotals,
    monthly,
    latest: history[history.length - 1],
    forge_model_stats: modelStats,
  };
}

// ─── Health Trend Analysis ────────────────────────────────────────────

/**
 * Compute health trend from .forge/health-snapshots.jsonl.
 * Aggregates cost, drift, incident, and model performance data points
 * over the requested time window.
 *
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @param {number} [days=30] - Number of days of history to include
 * @param {string[]|null} [metrics=null] - Optional metric filter (e.g. ["drift","cost","incidents","models"])
 * @returns {object} Health trend report
 */
export function getHealthTrend(cwd = process.cwd(), days = 30, metrics = null) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const allMetrics = ["drift", "cost", "incidents", "models", "tests"];
  const active = metrics && metrics.length ? metrics.filter(m => allMetrics.includes(m)) : allMetrics;

  const result = { days, metricsIncluded: active, generatedAt: new Date().toISOString(), dataPoints: 0 };

  // Drift trend
  if (active.includes("drift")) {
    const driftHistory = readForgeJsonl("drift-history.jsonl", [], cwd); // G2.1: was .json
    const filtered = driftHistory.filter(r => r.timestamp >= cutoff);
    const scores = filtered.map(r => r.score).filter(s => typeof s === "number");
    result.drift = {
      snapshots: filtered.length,
      latest: scores.length ? scores[scores.length - 1] : null,
      avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      min: scores.length ? Math.min(...scores) : null,
      max: scores.length ? Math.max(...scores) : null,
      trend: computeTrendDirection(scores),
    };
    result.dataPoints += filtered.length;
  }

  // Cost trend
  if (active.includes("cost")) {
    const costHistory = readForgeJson("cost-history.json", [], cwd);
    const filtered = Array.isArray(costHistory) ? costHistory.filter(r => (r.date || "") >= cutoff) : [];
    const costs = filtered.map(r => r.total_cost_usd || 0);
    result.cost = {
      runs: filtered.length,
      totalUsd: costs.length ? Math.round(costs.reduce((a, b) => a + b, 0) * 100) / 100 : 0,
      avgPerRun: costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 100) / 100 : 0,
      trend: computeTrendDirection(costs),
    };
    result.dataPoints += filtered.length;
  }

  // Incident trend
  if (active.includes("incidents")) {
    const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
    const filtered = incidents.filter(r => (r.capturedAt || "") >= cutoff);
    const resolved = filtered.filter(r => r.resolvedAt);
    const mttrs = resolved.map(r => r.mttr).filter(m => typeof m === "number" && m > 0);
    result.incidents = {
      total: filtered.length,
      resolved: resolved.length,
      open: filtered.length - resolved.length,
      avgMttrMs: mttrs.length ? Math.round(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : null,
      bySeverity: {},
    };
    for (const inc of filtered) {
      const sev = inc.severity || "unknown";
      result.incidents.bySeverity[sev] = (result.incidents.bySeverity[sev] || 0) + 1;
    }
    result.dataPoints += filtered.length;
  }

  // Model performance trend
  if (active.includes("models")) {
    const perfRecords = loadModelPerformance(cwd);
    const filtered = perfRecords.filter(r => (r.date || "") >= cutoff);
    const stats = {};
    for (const r of filtered) {
      const m = r.model || "unknown";
      if (!stats[m]) stats[m] = { slices: 0, passed: 0, failed: 0, totalCost: 0 };
      stats[m].slices += 1;
      if (r.status === "passed") stats[m].passed += 1;
      else stats[m].failed += 1;
      stats[m].totalCost += r.cost_usd || 0;
    }
    const models = {};
    for (const [model, s] of Object.entries(stats)) {
      models[model] = {
        slices: s.slices,
        successRate: s.slices > 0 ? Math.round((s.passed / s.slices) * 1000) / 1000 : 0,
        avgCostUsd: s.slices > 0 ? Math.round((s.totalCost / s.slices) * 1_000_000) / 1_000_000 : 0,
      };
    }
    result.models = { totalSlices: filtered.length, byModel: models };
    result.dataPoints += filtered.length;
  }

  // Test/regression trend (E5)
  if (active.includes("tests")) {
    const regHistory = readForgeJsonl("regression-history.jsonl", [], cwd); // G2.1: was .json
    const filtered = regHistory.filter(r => (r.timestamp || "") >= cutoff);
    const passRates = filtered.map(r => r.gatesChecked > 0 ? r.passed / r.gatesChecked : 1);
    result.tests = {
      runs: filtered.length,
      totalGates: filtered.reduce((sum, r) => sum + (r.gatesChecked || 0), 0),
      totalPassed: filtered.reduce((sum, r) => sum + (r.passed || 0), 0),
      totalFailed: filtered.reduce((sum, r) => sum + (r.failed || 0), 0),
      passRate: passRates.length ? Math.round((passRates.reduce((a, b) => a + b, 0) / passRates.length) * 1000) / 1000 : null,
      lastFailure: filtered.filter(r => r.failed > 0).slice(-1)[0]?.timestamp || null,
      trend: computeTrendDirection(passRates.map(r => r * 100)),
    };
    result.dataPoints += filtered.length;
  }

  // Overall health summary
  const scores = [];
  if (result.drift?.avg != null) scores.push(result.drift.avg);
  if (result.incidents) {
    const incidentPenalty = Math.min(result.incidents.total * 5, 50);
    scores.push(Math.max(0, 100 - incidentPenalty));
  }
  if (result.models?.totalSlices > 0) {
    const allPassRate = Object.values(result.models.byModel).reduce((sum, m) => sum + m.successRate, 0);
    const avgRate = allPassRate / Object.keys(result.models.byModel).length;
    scores.push(Math.round(avgRate * 100));
  }
  if (result.tests?.passRate != null) {
    scores.push(Math.round(result.tests.passRate * 100));
  }

  result.healthScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  result.trend = result.drift?.trend || (result.dataPoints === 0 ? "no-data" : "stable");

  // Project Health DNA — composite fingerprint for decay detection
  result.healthDNA = {
    driftAvg: result.drift?.avg ?? null,
    incidentRate: result.incidents ? Math.round((result.incidents.total / Math.max(days, 1)) * 100) / 100 : null,
    testPassRate: result.tests?.passRate ?? null,
    modelSuccessRate: result.models?.totalSlices > 0
      ? Math.round(Object.values(result.models.byModel).reduce((s, m) => s + m.successRate, 0) / Object.keys(result.models.byModel).length * 1000) / 1000
      : null,
    costPerSlice: result.cost?.avgPerRun ?? null,
    timestamp: new Date().toISOString(),
  };

  // Persist health DNA snapshot for cross-session trend analysis
  try {
    if (result.healthDNA.driftAvg != null || result.healthDNA.testPassRate != null) {
      appendForgeJsonl("health-dna.jsonl", { ...result.healthDNA, healthScore: result.healthScore }, cwd); // G2.1: was .json
    }
  } catch { /* best-effort */ }

  return result;
}

// ─── Phase FORGE-SHOP-06 Slice 06.2 — Gate Check Configuration ──────

const GATE_CHECK_DEFAULTS = {
  enabled: false,
  driftThreshold: 0.6,
  timeoutMs: 5000,
};

/**
 * Load gate-check configuration from .forge.json → runtime.gateCheck.
 * Returns GATE_CHECK_DEFAULTS (enabled: false) if absent or malformed.
 * @param {string} cwd - Project root directory
 * @returns {{ enabled: boolean, driftThreshold: number, timeoutMs: number }}
 */
export function loadGateCheckConfig(cwd) {
  let config = { ...GATE_CHECK_DEFAULTS };
  const configPath = resolve(cwd, ".forge.json");
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.runtime?.gateCheck) {
        config = { ...config, ...raw.runtime.gateCheck };
      }
    } catch {
      /* malformed config — use defaults */
    }
  }
  return config;
}

// ─── Phase FORGE-SHOP-06 Slice 06.2 — Gate Check Responder ──────────

/**
 * Register the `brain.gate-check` hub responder.
 * Pure-read: queries brain facade for open blockers, critical incidents, and drift.
 * Returns { proceed, reason, openBlockingReviews, driftScore, openIncidents }.
 *
 * @param {object} hub - Hub instance with onAsk
 * @param {string} cwd - Project root
 * @param {object} [deps] - DI overrides for recall, readReviewQueueState, readForgeJsonl
 */
export function registerGateCheckResponder(hub, cwd, deps = {}) {
  const _recall = deps.recall || brainRecall;
  const _readRQS = deps.readReviewQueueState || readReviewQueueState;
  const _readJsonl = deps.readForgeJsonl || readForgeJsonl;
  const config = deps.config || loadGateCheckConfig(cwd);
  // Phase-25 Slice 7: opt-in reviewer (MUST #7 + #8). Advisory-only in v2.57
  // per D6 (blockOnCritical defaults false). When `deps.quorumInvoke` is
  // absent the reviewer simply reports skipped.
  const reviewerConfig = deps.reviewerConfig || loadReviewerConfig(cwd);
  const reviewerDeps = { quorumInvoke: deps.quorumInvoke };

  hub.onAsk("brain.gate-check", async (payload) => {
    const reasons = [];
    let openBlockingReviews = 0;
    let openIncidents = 0;
    let driftScore = null;
    let reviewer = null;

    // 1. Check for blocker-severity open reviews
    try {
      const rqState = await _recall("project.review.counts", {}, {
        cwd, readReviewQueueState: _readRQS,
      });
      if (rqState?.bySeverity?.blocker) {
        openBlockingReviews = rqState.bySeverity.blocker;
      }
      if (openBlockingReviews > 0) {
        reasons.push(`${openBlockingReviews} blocker-severity review(s) open`);
      }
    } catch { /* treat as no data — proceed */ }

    // 2. Check for critical open incidents
    try {
      const incidents = await _recall("project.liveguard.incidents", {}, {
        cwd, readForgeJsonl: _readJsonl,
      });
      if (Array.isArray(incidents)) {
        openIncidents = incidents.filter(
          (i) => i.status === "open" && i.severity === "critical",
        ).length;
      }
      if (openIncidents > 0) {
        reasons.push(`${openIncidents} critical incident(s) open`);
      }
    } catch { /* treat as no data — proceed */ }

    // 3. Check drift score against threshold
    try {
      const driftHistory = await _recall("project.liveguard.drift", {}, {
        cwd, readForgeJsonl: _readJsonl,
      });
      if (Array.isArray(driftHistory) && driftHistory.length > 0) {
        const latest = driftHistory[driftHistory.length - 1];
        const oneHourAgo = Date.now() - 3_600_000;
        const latestTs = new Date(latest.ts || latest.timestamp || 0).getTime();
        if (latestTs >= oneHourAgo && typeof latest.driftScore === "number") {
          driftScore = latest.driftScore;
          if (driftScore < config.driftThreshold) {
            reasons.push(`drift score ${driftScore} below threshold ${config.driftThreshold}`);
          }
        }
      }
    } catch { /* treat as no data — proceed */ }

    // 4. Opt-in reviewer-agent (Phase-25 Slice 7, MUST #7 + #8). Advisory
    //    only in v2.57 per D6 — flags `critical` but `blockOnCritical`
    //    defaults false so verdicts never stop slice progression here. When
    //    blockOnCritical is true AND the reviewer ran AND flagged critical,
    //    we append a blocking reason.
    if (reviewerConfig.enabled) {
      try {
        const verdict = await invokeReviewer({
          sliceNumber: payload?.sliceNumber,
          sliceTitle: payload?.sliceTitle,
          diffSummary: payload?.diffSummary,
          config: reviewerConfig,
          cwd,
        }, reviewerDeps);
        reviewer = verdict;
        if (verdict.ok && verdict.critical && reviewerConfig.blockOnCritical) {
          reasons.push(`reviewer flagged critical: ${verdict.summary || "(no summary)"}`);
        }
      } catch {
        // Never block the gate on reviewer infrastructure failure — advisory only.
      }
    }

    const proceed = reasons.length === 0;
    return {
      proceed,
      reason: proceed ? "all checks passed" : reasons.join("; "),
      openBlockingReviews,
      driftScore,
      openIncidents,
      reviewer,
    };
  });
}

export function recordModelPerformance(cwd, entry) {
  const perfPath = resolve(cwd, ".forge", "model-performance.json");
  const records = loadModelPerformance(cwd);
  records.push(entry);
  mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  writeFileSync(perfPath, JSON.stringify(records, null, 2));
}

// Phase-53 S5: aggregateModelStats, ensureForgeDir → orchestrator/forge-io.mjs

/**
 * Read and parse a JSON file from .forge/.
 * @param {string} filePath - Path relative to .forge/ (e.g. "cost-history.json")
 * @param {*} [defaultValue=null] - Returned when file is missing or contains invalid JSON
 * @param {string} [cwd=process.cwd()] - Project root directory
 * @returns {*} Parsed JSON or defaultValue
 */

export function auditOrphanForgeFiles(cwd = process.cwd()) {
  // Patterns of recognised artifacts (substring or RegExp)
  const WHITELIST = [
    // Top-level state
    "server-ports.json", "hub-events.jsonl", "watch-history.jsonl",
    // L2 LiveGuard / dual-write
    "drift-history.jsonl", "drift-history.json",
    "regression-history.jsonl", "regression-history.json",
    "health-dna.jsonl", "health-dna.json",
    "quorum-history.jsonl", "quorum-history.json",
    "incidents.jsonl", "deploy-journal.jsonl",
    "liveguard-events.jsonl", "liveguard-memories.jsonl",
    "openbrain-queue.jsonl", "openbrain-dlq.jsonl", "openbrain-stats.jsonl",
    "env-diff-history.jsonl",
    // Caches
    "cost-history.json", "model-performance.json",
    "secret-scan-cache.json", "regression-gates.json",
    // Subdirectories handled separately
  ];
  const KNOWN_DIRS = new Set(["runs", "telemetry", "cache", "skills"]);

  const dir = resolve(cwd, ".forge");
  const known = [];
  const orphan = [];
  if (!existsSync(dir)) return { known, orphan, whitelist: WHITELIST };

  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return { known, orphan, whitelist: WHITELIST }; }

  for (const e of entries) {
    if (e.isDirectory()) {
      if (KNOWN_DIRS.has(e.name)) known.push(e.name + "/");
      else orphan.push(e.name + "/");
      continue;
    }
    if (WHITELIST.includes(e.name)) known.push(e.name);
    else orphan.push(e.name);
  }
  return { known, orphan, whitelist: WHITELIST };
}

// Phase-53 S5: getHealthTrend → orchestrator/forge-io.mjs

/**
 * Extract a target release version from a plan file.
 *
 * Scans (in order):
 *   1. Plan filename for `v<MAJOR>.<MINOR>[.<PATCH>][-...]` (e.g. `Phase-33.4-...-v2.67.4-PLAN.md`)
 *   2. Plan frontmatter `version:` field (if present)
 *   3. First `chore(release): vX.Y.Z` literal in the body
 *
 * Returns `null` when no version literal is found (non-release plan).
 *
 * @param {string} planPath - Path to plan markdown file
 * @returns {string|null} Bare semver string (no `v` prefix) or null
 */

const LIVEGUARD_TOOLS = new Set([
  "forge_drift_report", "forge_incident_capture", "forge_dep_watch",
  "forge_regression_guard", "forge_runbook", "forge_hotspot",
  "forge_health_trend", "forge_alert_triage", "forge_deploy_journal",
  "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
  "forge_quorum_analyze", "forge_liveguard_run",
  // Phase TEMPER-06 Slice 06.1 — Bug Registry tools
  "forge_bug_register", "forge_bug_list", "forge_bug_update_status",
  // Phase TEMPER-06 Slice 06.3 — Closed-loop fix validation
  "forge_bug_validate_fix",
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools
  "forge_review_add", "forge_review_list", "forge_review_resolve",
  // Phase TEMPER-07 Slice 07.1 — Agent delegation
  "forge_delegate_to_agent",
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools
  "forge_notify_send", "forge_notify_test",
]);

export function emitToolTelemetry(toolName, inputs, result, durationMs, status, cwd = process.cwd()) {
  const normalizedResult = typeof result === "string"
    ? result.slice(0, 2000)
    : JSON.stringify(result ?? "").slice(0, 2000);
  const record = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    inputs: typeof inputs === "object" ? inputs : { raw: inputs },
    result: normalizedResult,
    durationMs,
    status,
  };
  try {
    appendForgeJsonl("telemetry/tool-calls.jsonl", record, cwd);
  } catch { /* telemetry is best-effort — never crash the tool */ }
  if (LIVEGUARD_TOOLS.has(toolName)) {
    try {
      appendForgeJsonl("liveguard-events.jsonl", { timestamp: record.timestamp, tool: toolName, status, durationMs }, cwd);
    } catch { /* best-effort */ }
  }
  return record;
}
