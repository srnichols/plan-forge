/**
 * Plan Forge — TEMPER-05 Slice 05.1: Performance Budget scanner.
 *
 * Compares per-endpoint p95 latencies against baselines stored in
 * `.forge/tempering/perf-history.jsonl`. A regression is confirmed
 * only when the threshold is breached for `consecutiveRunsRequired`
 * consecutive runs (default 2).
 *
 * FORBIDDEN: never auto-promote baselines when perf improves.
 */

import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  appendPerfEntry,
  readPerfHistory,
  isConsecutiveRegression,
} from "../perf-history.mjs";
// Phase FORGE-SHOP-07 Slice 07.2 — brain facade for perf-history reads
import { recall as brainRecall } from "../../brain.mjs";

// ─── Defaults ─────────────────────────────────────────────────────────

export const PERF_BUDGET_DEFAULTS = Object.freeze({
  enabled: true,
  regressionThreshold: 0.10,
  consecutiveRunsRequired: 2,
  endpoints: [],
  tti: { enabled: false, budgetMs: 3000 },
});

// ─── Hub helper ───────────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

function buildPerfBudgetResult({ sliceRef, startedAt, now, verdict, pass = 0, fail = 0, regressions = [], ttiResults = [], reason = null }) {
  const completedAt = new Date(now()).toISOString();
  return {
    scanner: "performance-budget",
    sliceRef,
    startedAt,
    completedAt,
    verdict,
    pass,
    fail,
    skipped: 0,
    violationCount: regressions.length + ttiResults.filter((result) => result.verdict === "fail").length,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    regressions,
    ttiResults,
    ...(reason ? { reason } : {}),
  };
}

function resolvePerfBudgetEndpoints(settings, projectDir) {
  if (Array.isArray(settings.endpoints) && settings.endpoints.length > 0) {
    return settings.endpoints;
  }
  return resolveEndpointsFromOpenAPI(projectDir);
}

function appendBudgetPerfEntry(ep, { now, runId, projectDir, endpoint, method, currentP95 }) {
  if (currentP95 == null) return;
  try {
    appendPerfEntry({
      timestamp: new Date(now()).toISOString(),
      runId,
      endpoint,
      method,
      p50: ep.p50 || null,
      p95: currentP95,
      p99: ep.p99 || null,
      errorRate: ep.errorRate || 0,
      source: "performance-budget",
    }, projectDir);
  } catch { /* best-effort */ }
}

async function resolveBaselineP95(endpoint, method, projectDir) {
  try {
    const history = await brainRecall("project.tempering.perf-history", { fallback: "none" }, {
      cwd: projectDir,
      readPerfHistory,
    });
    return findLatestBaseline(history, endpoint, method);
  } catch {
    return null;
  }
}

function findLatestBaseline(history, endpoint, method) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.endpoint === endpoint && entry.method === method && entry.p95 != null) {
      return entry.p95;
    }
  }
  return null;
}

function maybeCapturePerfRegression(captureMemory, regression) {
  if (!captureMemory) return;
  try {
    captureMemory({ type: "perf-regression", ...regression });
  } catch { /* best-effort */ }
}

function evaluateEndpointRegression({ endpoint, method, budgetP95, currentP95, baselineP95, settings, projectDir }) {
  if (baselineP95 == null || currentP95 == null) {
    return { pass: true, regression: null };
  }
  const deltaPercent = (currentP95 - baselineP95) / baselineP95;
  const isRegression = isConsecutiveRegression(
    endpoint,
    method,
    settings.regressionThreshold,
    projectDir,
    { requiredConsecutive: settings.consecutiveRunsRequired },
  );
  if (!isRegression) {
    return { pass: true, regression: null };
  }
  return {
    pass: false,
    regression: {
      endpoint,
      method,
      baselineP95,
      currentP95,
      deltaPercent,
      consecutiveRuns: settings.consecutiveRunsRequired,
      budgetMs: budgetP95,
    },
  };
}

function readTtiResults(projectDir, runId, ttiSettings) {
  if (!ttiSettings.enabled) return [];
  const artifactsRunDir = resolve(projectDir, ".forge", "tempering", "artifacts", runId || "unknown");
  const timingPath = resolve(artifactsRunDir, "ui-playwright", "timing.json");
  if (!existsSync(timingPath)) return [];
  try {
    const timing = JSON.parse(readFileSync(timingPath, "utf-8"));
    const pages = Array.isArray(timing) ? timing : (timing.pages || []);
    return pages.map((page) => {
      const ttiMs = page.tti || page.ttiMs || 0;
      return {
        page: page.url || page.page,
        ttiMs,
        budgetMs: ttiSettings.budgetMs,
        verdict: ttiMs > ttiSettings.budgetMs ? "fail" : "pass",
      };
    });
  } catch {
    return [];
  }
}

function countTtiResults(ttiResults) {
  return ttiResults.reduce((counts, result) => {
    if (result.verdict === "fail") counts.fail++;
    else counts.pass++;
    return counts;
  }, { pass: 0, fail: 0 });
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * @param {object} ctx - DI context
 * @returns {Promise<object>} scanner result
 */
export async function runPerformanceBudgetScan(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    now = () => Date.now(),
    env = process.env,
    hub = null,
    captureMemory = null,
    importFn = (spec) => import(spec),
  } = ctx || {};

  const startedAt = new Date(now()).toISOString();
  const raw = config.scanners?.["performance-budget"];
  const settings = { ...PERF_BUDGET_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const ttiSettings = { ...PERF_BUDGET_DEFAULTS.tti, ...(typeof settings.tti === "object" ? settings.tti : {}) };
  const deadline = now() + (config.runtimeBudgets?.perfBudgetMaxMs ?? 120_000);

  if (raw === false || settings.enabled === false) {
    return buildPerfBudgetResult({ sliceRef, startedAt, now, verdict: "skipped", reason: "scanner-disabled" });
  }

  const endpoints = resolvePerfBudgetEndpoints(settings, projectDir);
  if (!endpoints || endpoints.length === 0) {
    return buildPerfBudgetResult({ sliceRef, startedAt, now, verdict: "skipped", reason: "no-endpoints-configured" });
  }

  const regressions = [];
  let passCount = 0;
  let failCount = 0;

  for (const ep of endpoints) {
    if (now() > deadline) {
      return buildPerfBudgetResult({
        sliceRef,
        startedAt,
        now,
        verdict: "budget-exceeded",
        pass: passCount,
        fail: failCount,
        regressions,
        reason: "budget-exceeded",
      });
    }

    const endpoint = ep.path || ep.endpoint;
    const method = (ep.method || "GET").toUpperCase();
    const budgetP95 = ep.p95BudgetMs || null;
    const currentP95 = ep.currentP95 || ep.p95 || null;

    appendBudgetPerfEntry(ep, { now, runId, projectDir, endpoint, method, currentP95 });

    const baselineP95 = await resolveBaselineP95(endpoint, method, projectDir);
    const evaluation = evaluateEndpointRegression({
      endpoint,
      method,
      budgetP95,
      currentP95,
      baselineP95,
      settings,
      projectDir,
    });

    if (evaluation.regression) {
      regressions.push(evaluation.regression);
      failCount++;
      emit(hub, "tempering-perf-regression", evaluation.regression);
      maybeCapturePerfRegression(captureMemory, evaluation.regression);
    } else if (evaluation.pass) {
      passCount++;
    }
  }

  const ttiResults = readTtiResults(projectDir, runId, ttiSettings);
  const ttiCounts = countTtiResults(ttiResults);
  passCount += ttiCounts.pass;
  failCount += ttiCounts.fail;

  const verdict = regressions.length > 0 || ttiCounts.fail > 0 ? "fail" : "pass";
  return buildPerfBudgetResult({
    sliceRef,
    startedAt,
    now,
    verdict,
    pass: passCount,
    fail: failCount,
    regressions,
    ttiResults,
  });
}

// ─── Internals ────────────────────────────────────────────────────────

function resolveEndpointsFromOpenAPI(projectDir) {
  const candidates = [
    "openapi.json", "openapi.yaml", "openapi.yml",
    "swagger.json", "swagger.yaml",
    "docs/openapi.json", "api/openapi.json",
  ];
  for (const candidate of candidates) {
    const specPath = resolve(projectDir, candidate);
    if (existsSync(specPath)) {
      try {
        const raw = readFileSync(specPath, "utf-8");
        const spec = JSON.parse(raw);
        return deriveEndpointsFromSpec(spec);
      } catch {
        continue;
      }
    }
  }
  return [];
}

function deriveEndpointsFromSpec(spec) {
  const endpoints = [];
  const paths = spec.paths || {};
  for (const [path, methods] of Object.entries(paths)) {
    for (const method of Object.keys(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method.toLowerCase())) {
        endpoints.push({ path, method: method.toUpperCase() });
      }
    }
  }
  return endpoints;
}
