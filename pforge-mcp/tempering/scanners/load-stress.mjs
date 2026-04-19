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

  // Merge defaults
  const raw = config.scanners?.["load-stress"];
  const settings = { ...LOAD_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };

  // Budget
  const budgetMs = config.runtimeBudgets?.loadStressMaxMs ?? 300_000;
  const deadline = now() + budgetMs;

  // Skip: scanner disabled
  if (raw === false || settings.enabled === false) {
    return {
      scanner: "load-stress", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      results: [],
      reason: "scanner-disabled",
    };
  }

  // Production guard
  if (env.NODE_ENV === "production" && !settings.allowProduction) {
    return {
      scanner: "load-stress", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      results: [],
      reason: "production-url-without-opt-in",
    };
  }

  // Resolve endpoints
  let endpoints = Array.isArray(settings.endpoints) && settings.endpoints.length > 0
    ? settings.endpoints
    : resolveEndpointsFromOpenAPI(projectDir);

  if (!endpoints || endpoints.length === 0) {
    return {
      scanner: "load-stress", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      results: [],
      reason: "no-endpoints-configured",
    };
  }

  // Lazy import autocannon
  let autocannon;
  try {
    const mod = await importFn("autocannon");
    autocannon = mod.default || mod;
  } catch {
    return {
      scanner: "load-stress", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "error", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      results: [],
      reason: "autocannon-import-failed",
    };
  }

  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (const ep of endpoints) {
    // Budget check between endpoints
    if (now() > deadline) {
      return {
        scanner: "load-stress", sliceRef,
        startedAt, completedAt: new Date(now()).toISOString(),
        verdict: "budget-exceeded",
        pass: passCount, fail: failCount, skipped: 0,
        violationCount: results.filter((r) => r.errorRate > settings.stressErrorRateThreshold).length,
        durationMs: now() - new Date(startedAt).getTime(),
        results,
        reason: "budget-exceeded",
      };
    }

    const url = ep.url || ep.path || ep.endpoint;
    const method = (ep.method || "GET").toUpperCase();

    try {
      const acResult = await autocannon({
        url,
        connections: settings.concurrency,
        duration: settings.durationSec,
        method,
      });

      const p50 = acResult?.latency?.p50 ?? acResult?.p50 ?? 0;
      const p95 = acResult?.latency?.p95 ?? acResult?.p95 ?? 0;
      const p99 = acResult?.latency?.p99 ?? acResult?.p99 ?? 0;
      const totalRequests = acResult?.requests?.total ?? acResult?.totalRequests ?? 0;
      const throughput = acResult?.throughput?.average ?? acResult?.throughput ?? 0;
      const errors = acResult?.errors ?? acResult?.non2xx ?? 0;
      const errorRate = totalRequests > 0 ? errors / totalRequests : 0;

      const endpointResult = {
        endpoint: url, method, p50, p95, p99,
        errorRate, totalRequests, throughput,
      };

      // Stress mode: ramp concurrency until error threshold
      if (settings.stressMode) {
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
            const stressErrors = stressResult?.errors ?? stressResult?.non2xx ?? 0;
            const stressTotal = stressResult?.requests?.total ?? stressResult?.totalRequests ?? 0;
            const stressErrorRate = stressTotal > 0 ? stressErrors / stressTotal : 0;
            if (stressErrorRate >= settings.stressErrorRateThreshold) {
              breakpoint = currentConcurrency;
              break;
            }
          } catch {
            breakpoint = currentConcurrency;
            break;
          }
        }
        endpointResult.breakpointConcurrency = breakpoint;
      }

      results.push(endpointResult);

      // Append to perf-history
      try {
        appendPerfEntry({
          timestamp: new Date(now()).toISOString(),
          runId,
          endpoint: url,
          method,
          p50, p95, p99,
          errorRate,
          source: "load-stress",
        }, projectDir);
      } catch { /* best-effort */ }

      if (errorRate > settings.stressErrorRateThreshold) {
        failCount++;
      } else {
        passCount++;
      }
    } catch (err) {
      results.push({
        endpoint: url, method,
        p50: 0, p95: 0, p99: 0,
        errorRate: 1, totalRequests: 0, throughput: 0,
        error: err.message || String(err),
      });
      failCount++;
    }
  }

  const completedAt = new Date(now()).toISOString();
  const hasFailures = results.some((r) => r.errorRate > settings.stressErrorRateThreshold);
  const verdict = hasFailures ? "fail" : "pass";

  emit(hub, "tempering-load-completed", {
    endpointCount: results.length,
    passCount, failCount,
    verdict,
  });

  return {
    scanner: "load-stress", sliceRef,
    startedAt, completedAt,
    verdict,
    pass: passCount, fail: failCount, skipped: 0,
    violationCount: results.filter((r) => r.errorRate > settings.stressErrorRateThreshold).length,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    results,
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
        endpoints.push({ path, method: method.toUpperCase(), url: path });
      }
    }
  }
  return endpoints;
}
