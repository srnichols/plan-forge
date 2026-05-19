/**
 * Plan Forge — TEMPER-05 Slice 05.1: Load / Stress scanner.
 *
 * Drives HTTP load via `autocannon` (lazy-imported via `importFn` DI)
 * against configured or auto-derived endpoints. Optionally ramps
 * concurrency until the error-rate threshold is breached (stress mode).
 *
 * FORBIDDEN: never run against production without explicit opt-in.
 */

import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { appendPerfEntry } from "../perf-history.mjs";

// ─── Defaults ─────────────────────────────────────────────────────────

export const LOAD_DEFAULTS = Object.freeze({
  enabled: true,
  concurrency: 100,
  durationSec: 60,
  allowProduction: false,
  stressMode: false,
  stressErrorRateThreshold: 0.01,
  endpoints: [],
});

// ─── Hub helper ───────────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

function buildLoadStressResult({ sliceRef, startedAt, now, verdict, pass = 0, fail = 0, results = [], reason = null, settings = LOAD_DEFAULTS }) {
  const completedAt = new Date(now()).toISOString();
  return {
    scanner: "load-stress",
    sliceRef,
    startedAt,
    completedAt,
    verdict,
    pass,
    fail,
    skipped: 0,
    violationCount: countLoadStressViolations(results, settings),
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    results,
    ...(reason ? { reason } : {}),
  };
}

function resolveLoadEndpoints(settings, projectDir) {
  if (Array.isArray(settings.endpoints) && settings.endpoints.length > 0) {
    return settings.endpoints;
  }
  return resolveEndpointsFromOpenAPI(projectDir);
}

async function loadAutocannon(importFn) {
  const mod = await importFn("autocannon");
  return mod.default || mod;
}

function firstDefinedMetric(...values) {
  for (const value of values) {
    if (value != null) return value;
  }
  return 0;
}

function extractLatencyMetrics(acResult) {
  const latency = acResult?.latency || {};
  return {
    p50: firstDefinedMetric(latency.p50, acResult?.p50),
    p95: firstDefinedMetric(latency.p95, acResult?.p95),
    p99: firstDefinedMetric(latency.p99, acResult?.p99),
  };
}

function extractRequestMetrics(acResult) {
  return {
    totalRequests: firstDefinedMetric(acResult?.requests?.total, acResult?.totalRequests),
    errors: firstDefinedMetric(acResult?.errors, acResult?.non2xx),
    throughput: firstDefinedMetric(acResult?.throughput?.average, acResult?.throughput),
  };
}

function extractAutocannonMetrics(acResult) {
  const latencyMetrics = extractLatencyMetrics(acResult);
  const requestMetrics = extractRequestMetrics(acResult);
  return {
    ...latencyMetrics,
    totalRequests: requestMetrics.totalRequests,
    throughput: requestMetrics.throughput,
    errorRate: requestMetrics.totalRequests > 0 ? requestMetrics.errors / requestMetrics.totalRequests : 0,
  };
}

async function findStressBreakpoint({ autocannon, url, method, settings, now, deadline }) {
  let breakpoint = null;
  let currentConcurrency = settings.concurrency;
  while (currentConcurrency <= settings.concurrency * 8) {
    if (now() > deadline) break;
    currentConcurrency *= 2;
    try {
      const stressResult = await autocannon({
        url,
        connections: currentConcurrency,
        duration: Math.min(settings.durationSec, 10),
        method,
      });
      const { errorRate } = extractAutocannonMetrics(stressResult);
      if (errorRate >= settings.stressErrorRateThreshold) {
        breakpoint = currentConcurrency;
        break;
      }
    } catch {
      breakpoint = currentConcurrency;
      break;
    }
  }
  return breakpoint;
}

function appendLoadPerfEntry({ now, runId, projectDir, url, method, metrics }) {
  try {
    appendPerfEntry({
      timestamp: new Date(now()).toISOString(),
      runId,
      endpoint: url,
      method,
      p50: metrics.p50,
      p95: metrics.p95,
      p99: metrics.p99,
      errorRate: metrics.errorRate,
      source: "load-stress",
    }, projectDir);
  } catch { /* best-effort */ }
}

async function scanLoadEndpoint({ autocannon, endpoint, settings, now, deadline, runId, projectDir }) {
  const url = endpoint.url || endpoint.path || endpoint.endpoint;
  const method = (endpoint.method || "GET").toUpperCase();

  try {
    const acResult = await autocannon({
      url,
      connections: settings.concurrency,
      duration: settings.durationSec,
      method,
    });
    const metrics = extractAutocannonMetrics(acResult);
    const result = { endpoint: url, method, ...metrics };
    if (settings.stressMode) {
      result.breakpointConcurrency = await findStressBreakpoint({
        autocannon,
        url,
        method,
        settings,
        now,
        deadline,
      });
    }
    appendLoadPerfEntry({ now, runId, projectDir, url, method, metrics });
    return {
      result,
      pass: metrics.errorRate <= settings.stressErrorRateThreshold,
    };
  } catch (err) {
    return {
      result: {
        endpoint: url,
        method,
        p50: 0,
        p95: 0,
        p99: 0,
        errorRate: 1,
        totalRequests: 0,
        throughput: 0,
        error: err.message || String(err),
      },
      pass: false,
    };
  }
}

function countLoadStressViolations(results, settings) {
  return results.filter((result) => result.errorRate > settings.stressErrorRateThreshold).length;
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * @param {object} ctx - DI context
 * @returns {Promise<object>} scanner result
 */
function resolveLoadStressContext(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    now = () => Date.now(),
    env = process.env,
    hub = null,
    importFn = (spec) => import(spec),
  } = ctx || {};
  return { config, projectDir, runId, sliceRef, now, env, hub, importFn };
}

function buildLoadStressSkippedResult(sliceRef, startedAt, now, reason) {
  return buildLoadStressResult({ sliceRef, startedAt, now, verdict: "skipped", reason });
}

async function runLoadStressEndpoints({ endpoints, autocannon, settings, now, deadline, runId, projectDir, sliceRef, startedAt }) {
  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (const endpoint of endpoints) {
    if (now() >= deadline) {
      return buildLoadStressResult({
        sliceRef,
        startedAt,
        now,
        verdict: "budget-exceeded",
        pass: passCount,
        fail: failCount,
        results,
        reason: "budget-exceeded",
        settings,
      });
    }

    const outcome = await scanLoadEndpoint({
      autocannon,
      endpoint,
      settings,
      now,
      deadline,
      runId,
      projectDir,
    });
    results.push(outcome.result);
    if (outcome.pass) passCount++;
    else failCount++;
  }

  return { results, passCount, failCount };
}

export async function runLoadStressScan(ctx) {
  const loadCtx = resolveLoadStressContext(ctx);
  const startedAt = new Date(loadCtx.now()).toISOString();
  const raw = loadCtx.config.scanners?.["load-stress"];
  const settings = { ...LOAD_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const deadline = loadCtx.now() + (loadCtx.config.runtimeBudgets?.loadStressMaxMs ?? 300_000);

  if (raw === false || settings.enabled === false) {
    return buildLoadStressSkippedResult(loadCtx.sliceRef, startedAt, loadCtx.now, "scanner-disabled");
  }
  if (loadCtx.env.NODE_ENV === "production" && !settings.allowProduction) {
    return buildLoadStressSkippedResult(loadCtx.sliceRef, startedAt, loadCtx.now, "production-url-without-opt-in");
  }

  const endpoints = resolveLoadEndpoints(settings, loadCtx.projectDir);
  if (!endpoints || endpoints.length === 0) {
    return buildLoadStressSkippedResult(loadCtx.sliceRef, startedAt, loadCtx.now, "no-endpoints-configured");
  }

  let autocannon;
  try {
    autocannon = await loadAutocannon(loadCtx.importFn);
  } catch {
    return buildLoadStressResult({ sliceRef: loadCtx.sliceRef, startedAt, now: loadCtx.now, verdict: "error", reason: "autocannon-import-failed" });
  }

  const outcome = await runLoadStressEndpoints({
    endpoints,
    autocannon,
    settings,
    now: loadCtx.now,
    deadline,
    runId: loadCtx.runId,
    projectDir: loadCtx.projectDir,
    sliceRef: loadCtx.sliceRef,
    startedAt,
  });
  if (outcome.verdict) return outcome;

  const verdict = countLoadStressViolations(outcome.results, settings) > 0 ? "fail" : "pass";
  emit(loadCtx.hub, "tempering-load-completed", {
    endpointCount: outcome.results.length,
    passCount: outcome.passCount,
    failCount: outcome.failCount,
    verdict,
  });

  return buildLoadStressResult({
    sliceRef: loadCtx.sliceRef,
    startedAt,
    now: loadCtx.now,
    verdict,
    pass: outcome.passCount,
    fail: outcome.failCount,
    results: outcome.results,
    settings,
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
        endpoints.push({ path, method: method.toUpperCase(), url: path });
      }
    }
  }
  return endpoints;
}
