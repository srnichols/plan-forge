/**
 * Load / Stress scanner tests (TEMPER-05 Slice 05.1).
 *
 * 11 tests covering:
 *   - scanner-disabled skip
 *   - no endpoints → skipped
 *   - production guard (NODE_ENV=production + allowProduction=false)
 *   - production allowed (allowProduction=true)
 *   - mocked autocannon, low error rate → pass
 *   - high error rate → fail
 *   - stress mode → finds breakpointConcurrency
 *   - stress mode off by default
 *   - importFn throws → verdict error, reason autocannon-import-failed
 *   - hub event emitted on completion
 *   - budget exceeded mid-scan → partial results + budget-exceeded
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runLoadStressScan, LOAD_DEFAULTS } from "../tempering/scanners/load-stress.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-load-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeConfig(overrides = {}) {
  return {
    scanners: { "load-stress": { enabled: true, ...overrides } },
    runtimeBudgets: { loadStressMaxMs: 300000 },
    ...overrides._root,
  };
}

function makeHub() {
  const events = [];
  return {
    events,
    broadcast(e) { events.push(e); },
  };
}

function mockAutocannon({ p50 = 5, p95 = 20, p99 = 50, errors = 0, total = 1000, throughput = 500 } = {}) {
  return async (opts) => ({
    latency: { p50, p95, p99 },
    requests: { total },
    throughput: { average: throughput },
    errors,
  });
}

function makeImportFn(autocannon) {
  return async (spec) => {
    if (spec === "autocannon") return { default: autocannon };
    throw new Error(`unexpected import: ${spec}`);
  };
}

describe("load-stress.mjs scanner", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("scanner-disabled → skipped", async () => {
    const r = await runLoadStressScan({
      config: { scanners: { "load-stress": false } },
      projectDir: tmp,
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("no endpoints → skipped", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({ endpoints: [] }),
      projectDir: tmp,
      importFn: makeImportFn(mockAutocannon()),
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-endpoints-configured");
  });

  it("NODE_ENV=production + allowProduction=false → skipped", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
        allowProduction: false,
      }),
      projectDir: tmp,
      env: { NODE_ENV: "production" },
      importFn: makeImportFn(mockAutocannon()),
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("production-url-without-opt-in");
  });

  it("NODE_ENV=production + allowProduction=true → runs", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
        allowProduction: true,
      }),
      projectDir: tmp,
      env: { NODE_ENV: "production" },
      importFn: makeImportFn(mockAutocannon()),
    });
    expect(r.verdict).not.toBe("skipped");
    expect(r.results.length).toBeGreaterThanOrEqual(1);
  });

  it("mocked autocannon, low error rate → pass", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
      }),
      projectDir: tmp,
      importFn: makeImportFn(mockAutocannon({ errors: 0, total: 1000 })),
    });
    expect(r.verdict).toBe("pass");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].errorRate).toBe(0);
  });

  it("high error rate → fail", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
        stressErrorRateThreshold: 0.01,
      }),
      projectDir: tmp,
      importFn: makeImportFn(mockAutocannon({ errors: 50, total: 1000 })),
    });
    expect(r.verdict).toBe("fail");
    expect(r.results[0].errorRate).toBe(0.05);
  });

  it("stress mode → finds breakpointConcurrency", async () => {
    let callCount = 0;
    const stressAutocannon = async (opts) => {
      callCount++;
      const errors = opts.connections >= 400 ? 100 : 0;
      return {
        latency: { p50: 5, p95: 20, p99: 50 },
        requests: { total: 1000 },
        throughput: { average: 500 },
        errors,
      };
    };
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
        stressMode: true,
        concurrency: 100,
      }),
      projectDir: tmp,
      importFn: makeImportFn(stressAutocannon),
    });
    expect(r.results[0].breakpointConcurrency).toBeDefined();
    expect(r.results[0].breakpointConcurrency).toBeGreaterThanOrEqual(400);
  });

  it("stress mode off by default", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
      }),
      projectDir: tmp,
      importFn: makeImportFn(mockAutocannon()),
    });
    expect(r.results[0].breakpointConcurrency).toBeUndefined();
  });

  it("importFn throws → verdict error, reason autocannon-import-failed", async () => {
    const r = await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
      }),
      projectDir: tmp,
      importFn: async () => { throw new Error("not found"); },
    });
    expect(r.verdict).toBe("error");
    expect(r.reason).toBe("autocannon-import-failed");
  });

  it("hub event emitted on completion", async () => {
    const hub = makeHub();
    await runLoadStressScan({
      config: makeConfig({
        endpoints: [{ url: "http://localhost:3000/api/users", method: "GET" }],
      }),
      projectDir: tmp,
      hub,
      importFn: makeImportFn(mockAutocannon()),
    });
    const loadEvents = hub.events.filter((e) => e.type === "tempering-load-completed");
    expect(loadEvents).toHaveLength(1);
    expect(loadEvents[0].data.verdict).toBe("pass");
  });

  it("budget exceeded mid-scan → partial results + budget-exceeded", async () => {
    const r = await runLoadStressScan({
      config: {
        ...makeConfig({
          endpoints: [
            { url: "http://localhost:3000/api/a", method: "GET" },
            { url: "http://localhost:3000/api/b", method: "GET" },
          ],
        }),
        runtimeBudgets: { loadStressMaxMs: 0 },
      },
      projectDir: tmp,
      importFn: makeImportFn(mockAutocannon()),
      now: () => Date.now(),
    });
    expect(r.verdict).toBe("budget-exceeded");
  });
});
