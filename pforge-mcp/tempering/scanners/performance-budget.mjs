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

  // Merge defaults
  const raw = config.scanners?.["performance-budget"];
  const settings = { ...PERF_BUDGET_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const ttiSettings = { ...PERF_BUDGET_DEFAULTS.tti, ...(typeof settings.tti === "object" ? settings.tti : {}) };

  // Budget
  const budgetMs = config.runtimeBudgets?.perfBudgetMaxMs ?? 120_000;
  const deadline = now() + budgetMs;

  // Skip: scanner disabled
  if (raw === false || settings.enabled === false) {
    return {
      scanner: "performance-budget", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      regressions: [], ttiResults: [],
      reason: "scanner-disabled",
    };
  }

  // Resolve endpoints
  let endpoints = Array.isArray(settings.endpoints) && settings.endpoints.length > 0
    ? settings.endpoints
    : resolveEndpointsFromOpenAPI(projectDir);

  if (!endpoints || endpoints.length === 0) {
    return {
      scanner: "performance-budget", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      regressions: [], ttiResults: [],
      reason: "no-endpoints-configured",
    };
  }

  const regressions = [];
  let passCount = 0;
  let failCount = 0;

  for (const ep of endpoints) {
    // Budget check
    if (now() > deadline) {
      return {
        scanner: "performance-budget", sliceRef,
        startedAt, completedAt: new Date(now()).toISOString(),
        verdict: "budget-exceeded",
        pass: passCount, fail: failCount, skipped: 0,
        violationCount: regressions.length,
        durationMs: now() - new Date(startedAt).getTime(),
        regressions, ttiResults: [],
        reason: "budget-exceeded",
      };
    }

    const endpoint = ep.path || ep.endpoint;
    const method = (ep.method || "GET").toUpperCase();
    const budgetP95 = ep.p95BudgetMs || null;
    const currentP95 = ep.currentP95 || ep.p95 || null;

    // Record this run's metrics (always)
    if (currentP95 != null) {
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

    // Check for consecutive regression (Phase FORGE-SHOP-07 Slice 07.2 — via brain facade)
    let baselineP95 = null;
    try {
      const history = await brainRecall("project.tempering.perf-history", { fallback: "none" }, {
        cwd: projectDir, readPerfHistory,
      });
      if (Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0; i--) {
          const e = history[i];
          if (e.endpoint === endpoint && e.method === method && e.p95 != null) {
            baselineP95 = e.p95;
            break;
          }
        }
      }
    } catch { /* facade failure — treat as no baseline */ }
    if (baselineP95 != null && currentP95 != null) {
      const deltaPercent = (currentP95 - baselineP95) / baselineP95;
      const isRegression = isConsecutiveRegression(
        endpoint, method, settings.regressionThreshold, projectDir,
        { requiredConsecutive: settings.consecutiveRunsRequired },
      );

      if (isRegression) {
        regressions.push({
          endpoint, method, baselineP95, currentP95,
          deltaPercent,
          consecutiveRuns: settings.consecutiveRunsRequired,
          budgetMs: budgetP95,
        });
        failCount++;

        emit(hub, "tempering-perf-regression", {
          endpoint, method, baselineP95, currentP95, deltaPercent,
        });

        if (captureMemory) {
          try {
            captureMemory({
              type: "perf-regression",
              endpoint, method, baselineP95, currentP95, deltaPercent,
            });
          } catch { /* best-effort */ }
        }
      } else {
        passCount++;
      }
    } else {
      // First run — baseline is established, verdict pass
      passCount++;
    }
  }

  // TTI checks
  const ttiResults = [];
  if (ttiSettings.enabled) {
    const timingPath = resolve(
      projectDir, ".forge", "tempering", "artifacts", runId || "unknown",
      "ui-playwright", "timing.json",
    );
    if (existsSync(timingPath)) {
      try {
        const timing = JSON.parse(readFileSync(timingPath, "utf-8"));
        const pages = Array.isArray(timing) ? timing : (timing.pages || []);
        for (const page of pages) {
          const ttiMs = page.tti || page.ttiMs || 0;
          const ttiVerdict = ttiMs > ttiSettings.budgetMs ? "fail" : "pass";
          ttiResults.push({ page: page.url || page.page, ttiMs, budgetMs: ttiSettings.budgetMs, verdict: ttiVerdict });
          if (ttiVerdict === "fail") failCount++;
          else passCount++;
        }
      } catch { /* best-effort */ }
    }
  }

  const completedAt = new Date(now()).toISOString();
  const verdict = regressions.length > 0 || ttiResults.some((t) => t.verdict === "fail")
    ? "fail" : "pass";

  return {
    scanner: "performance-budget", sliceRef,
    startedAt, completedAt,
    verdict,
    pass: passCount, fail: failCount, skipped: 0,
    violationCount: regressions.length + ttiResults.filter((t) => t.verdict === "fail").length,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    regressions, ttiResults,
  };
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
