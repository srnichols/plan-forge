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
  const isRegression = isConsecutiveRegression({
    endpoint,
    method,
    threshold: settings.regressionThreshold,
    cwd: projectDir,
    requiredConsecutive: settings.consecutiveRunsRequired,
  });
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

function resolvePerformanceBudgetContext(ctx) {
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
  return {
    config,
    projectDir,
    runId,
    sliceRef,
    now,
    env,
    hub,
    captureMemory,
    importFn,
  };
}

async function evaluatePerfBudgetEndpoints({ endpoints, budgetCtx, settings, deadline }) {
  const regressions = [];
  let passCount = 0;
  let failCount = 0;

  for (const ep of endpoints) {
    if (budgetCtx.now() > deadline) {
      return {
        verdict: "budget-exceeded",
        regressions,
        passCount,
        failCount,
        reason: "budget-exceeded",
      };
    }

    const endpoint = ep.path || ep.endpoint;
    const method = (ep.method || "GET").toUpperCase();
    const budgetP95 = ep.p95BudgetMs || null;
    const currentP95 = ep.currentP95 || ep.p95 || null;

    appendBudgetPerfEntry(ep, {
      now: budgetCtx.now,
      runId: budgetCtx.runId,
      projectDir: budgetCtx.projectDir,
      endpoint,
      method,
      currentP95,
    });

    const baselineP95 = await resolveBaselineP95(endpoint, method, budgetCtx.projectDir);
    const evaluation = evaluateEndpointRegression({
      endpoint,
      method,
      budgetP95,
      currentP95,
      baselineP95,
      settings,
      projectDir: budgetCtx.projectDir,
    });

    if (evaluation.regression) {
      regressions.push(evaluation.regression);
      failCount++;
      emit(budgetCtx.hub, "tempering-perf-regression", evaluation.regression);
      maybeCapturePerfRegression(budgetCtx.captureMemory, evaluation.regression);
      continue;
    }
    if (evaluation.pass) passCount++;
  }

  return { regressions, passCount, failCount };
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * @param {object} ctx - DI context
 * @returns {Promise<object>} scanner result
 */
export async function runPerformanceBudgetScan(ctx) {
  const budgetCtx = resolvePerformanceBudgetContext(ctx);
  const startedAt = new Date(budgetCtx.now()).toISOString();
  const raw = budgetCtx.config.scanners?.["performance-budget"];
  const settings = { ...PERF_BUDGET_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const ttiSettings = { ...PERF_BUDGET_DEFAULTS.tti, ...(typeof settings.tti === "object" ? settings.tti : {}) };
  const deadline = budgetCtx.now() + (budgetCtx.config.runtimeBudgets?.perfBudgetMaxMs ?? 120_000);

  if (raw === false || settings.enabled === false) {
    return buildPerfBudgetResult({ sliceRef: budgetCtx.sliceRef, startedAt, now: budgetCtx.now, verdict: "skipped", reason: "scanner-disabled" });
  }

  const endpoints = resolvePerfBudgetEndpoints(settings, budgetCtx.projectDir);
  if (!endpoints || endpoints.length === 0) {
    return buildPerfBudgetResult({ sliceRef: budgetCtx.sliceRef, startedAt, now: budgetCtx.now, verdict: "skipped", reason: "no-endpoints-configured" });
  }

  const endpointOutcome = await evaluatePerfBudgetEndpoints({
    endpoints,
    budgetCtx,
    settings,
    deadline,
  });
  if (endpointOutcome.verdict) {
    return buildPerfBudgetResult({
      sliceRef: budgetCtx.sliceRef,
      startedAt,
      now: budgetCtx.now,
      verdict: endpointOutcome.verdict,
      pass: endpointOutcome.passCount,
      fail: endpointOutcome.failCount,
      regressions: endpointOutcome.regressions,
      reason: endpointOutcome.reason,
    });
  }

  const ttiResults = readTtiResults(budgetCtx.projectDir, budgetCtx.runId, ttiSettings);
  const ttiCounts = countTtiResults(ttiResults);
  const passCount = endpointOutcome.passCount + ttiCounts.pass;
  const failCount = endpointOutcome.failCount + ttiCounts.fail;
  const verdict = endpointOutcome.regressions.length > 0 || ttiCounts.fail > 0 ? "fail" : "pass";

  return buildPerfBudgetResult({
    sliceRef: budgetCtx.sliceRef,
    startedAt,
    now: budgetCtx.now,
    verdict,
    pass: passCount,
    fail: failCount,
    regressions: endpointOutcome.regressions,
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
