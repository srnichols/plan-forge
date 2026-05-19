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

function extractAutocannonMetrics(acResult) {
  const totalRequests = acResult?.requests?.total ?? acResult?.totalRequests ?? 0;
  const errors = acResult?.errors ?? acResult?.non2xx ?? 0;
  return {
    p50: acResult?.latency?.p50 ?? acResult?.p50 ?? 0,
    p95: acResult?.latency?.p95 ?? acResult?.p95 ?? 0,
    p99: acResult?.latency?.p99 ?? acResult?.p99 ?? 0,
    totalRequests,
    throughput: acResult?.throughput?.average ?? acResult?.throughput ?? 0,
    errorRate: totalRequests > 0 ? errors / totalRequests : 0,
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
export async function runLoadStressScan(ctx) {
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

  const startedAt = new Date(now()).toISOString();
  const raw = config.scanners?.["load-stress"];
  const settings = { ...LOAD_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const deadline = now() + (config.runtimeBudgets?.loadStressMaxMs ?? 300_000);

  if (raw === false || settings.enabled === false) {
    return buildLoadStressResult({ sliceRef, startedAt, now, verdict: "skipped", reason: "scanner-disabled" });
  }

  if (env.NODE_ENV === "production" && !settings.allowProduction) {
    return buildLoadStressResult({ sliceRef, startedAt, now, verdict: "skipped", reason: "production-url-without-opt-in" });
  }

  const endpoints = resolveLoadEndpoints(settings, projectDir);
  if (!endpoints || endpoints.length === 0) {
    return buildLoadStressResult({ sliceRef, startedAt, now, verdict: "skipped", reason: "no-endpoints-configured" });
  }

  let autocannon;
  try {
    autocannon = await loadAutocannon(importFn);
  } catch {
    return buildLoadStressResult({ sliceRef, startedAt, now, verdict: "error", reason: "autocannon-import-failed" });
  }

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

  const verdict = countLoadStressViolations(results, settings) > 0 ? "fail" : "pass";
  emit(hub, "tempering-load-completed", {
    endpointCount: results.length,
    passCount,
    failCount,
    verdict,
  });

  return buildLoadStressResult({
    sliceRef,
    startedAt,
    now,
    verdict,
    pass: passCount,
    fail: failCount,
    results,
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
