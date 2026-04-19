/**
 * Performance Budget scanner tests (TEMPER-05 Slice 05.1).
 *
 * 12 tests covering:
 *   - scanner-disabled skip
 *   - no endpoints + no OpenAPI → skipped
 *   - all within budget → pass
 *   - single-run regression → pass (needs 2 consecutive)
 *   - 2 consecutive regressions → fail
 *   - regression then recovery → pass
 *   - TTI over budget → violation
 *   - perf-history.jsonl written after every run
 *   - hub event only on confirmed regression
 *   - captureMemory only on confirmed regression
 *   - budget exceeded → budget-exceeded
 *   - forbidden: baseline not auto-promoted
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runPerformanceBudgetScan, PERF_BUDGET_DEFAULTS } from "../tempering/scanners/performance-budget.mjs";
import { appendPerfEntry, readPerfHistory } from "../tempering/perf-history.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-perfbudget-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeConfig(overrides = {}) {
  return {
    scanners: { "performance-budget": { enabled: true, ...overrides } },
    runtimeBudgets: { perfBudgetMaxMs: 120000 },
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

function seedHistory(dir, entries) {
  const histPath = resolve(dir, ".forge", "tempering", "perf-history.jsonl");
  mkdirSync(dirname(histPath), { recursive: true });
  const lines = entries.map((e) => JSON.stringify({ _v: 1, ...e })).join("\n") + "\n";
  writeFileSync(histPath, lines);
}

describe("performance-budget.mjs scanner", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("scanner-disabled → skipped", async () => {
    const r = await runPerformanceBudgetScan({
      config: { scanners: { "performance-budget": false } },
      projectDir: tmp,
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("no endpoints + no OpenAPI → skipped no-endpoints-configured", async () => {
    const r = await runPerformanceBudgetScan({
      config: makeConfig({ endpoints: [] }),
      projectDir: tmp,
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-endpoints-configured");
  });

  it("all within budget → pass", async () => {
    // Seed baseline
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 50 },
    ]);
    const r = await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 52, p95BudgetMs: 100 }],
      }),
      projectDir: tmp,
    });
    expect(r.verdict).toBe("pass");
    expect(r.regressions).toHaveLength(0);
  });

  it("single-run regression → pass (needs 2 consecutive)", async () => {
    // Only 1 prior entry (baseline) + current exceeds threshold
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 50 },
    ]);
    const r = await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 100 }],
        consecutiveRunsRequired: 2,
      }),
      projectDir: tmp,
    });
    // Only 1 exceeding entry → not consecutive → pass
    expect(r.verdict).toBe("pass");
  });

  it("2 consecutive regressions → fail", async () => {
    // Seed 3 entries: baseline then 2 that regress >10%
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 50 },
      { endpoint: "/api/users", method: "GET", p95: 80 },
    ]);
    // Run with currentP95=80 appended → history: [50, 80, 80]
    // isConsecutiveRegression checks last 2 (80, 80) vs baseline entry [50]
    const r = await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 80 }],
        regressionThreshold: 0.10,
        consecutiveRunsRequired: 2,
      }),
      projectDir: tmp,
    });
    // After appending currentP95=80, the last 2 entries both exceed 10% vs baseline=50
    expect(r.verdict).toBe("fail");
    expect(r.regressions.length).toBeGreaterThanOrEqual(1);
  });

  it("regression then recovery → pass", async () => {
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 50 },
      { endpoint: "/api/users", method: "GET", p95: 80 },
      { endpoint: "/api/users", method: "GET", p95: 52 },
    ]);
    const r = await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 52 }],
        regressionThreshold: 0.10,
        consecutiveRunsRequired: 2,
      }),
      projectDir: tmp,
    });
    expect(r.verdict).toBe("pass");
  });

  it("TTI over budget → violation", async () => {
    // Create timing.json for TTI
    const artifactDir = resolve(tmp, ".forge", "tempering", "artifacts", "run-test", "ui-playwright");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(resolve(artifactDir, "timing.json"), JSON.stringify([
      { url: "/home", tti: 5000 },
    ]));
    const r = await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/a", method: "GET", currentP95: 10 }],
        tti: { enabled: true, budgetMs: 3000 },
      }),
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.ttiResults.length).toBeGreaterThanOrEqual(1);
    expect(r.ttiResults[0].verdict).toBe("fail");
  });

  it("perf-history.jsonl written after every run (pass or fail)", async () => {
    await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/test", method: "GET", currentP95: 30 }],
      }),
      projectDir: tmp,
    });
    const history = readPerfHistory(tmp);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].endpoint).toBe("/api/test");
  });

  it("hub event only on confirmed regression", async () => {
    const hub = makeHub();
    // Single entry → no consecutive → no hub event
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 50 },
    ]);
    await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 100 }],
      }),
      projectDir: tmp,
      hub,
    });
    const regressionEvents = hub.events.filter((e) => e.type === "tempering-perf-regression");
    expect(regressionEvents).toHaveLength(0);
  });

  it("captureMemory only on confirmed regression", async () => {
    const captures = [];
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 50 },
    ]);
    await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 100 }],
      }),
      projectDir: tmp,
      captureMemory: (d) => captures.push(d),
    });
    // Not consecutive → no capture
    expect(captures).toHaveLength(0);
  });

  it("budget exceeded → budget-exceeded", async () => {
    let tick = Date.now();
    const r = await runPerformanceBudgetScan({
      config: {
        ...makeConfig({
          endpoints: [{ path: "/api/a", method: "GET", currentP95: 10 }],
        }),
        runtimeBudgets: { perfBudgetMaxMs: 0 },
      },
      projectDir: tmp,
      now: () => { tick += 100; return tick; },
    });
    expect(r.verdict).toBe("budget-exceeded");
  });

  it("forbidden: baseline not auto-promoted when perf improves", async () => {
    // Baseline dir should not exist — perf scanner never writes baselines
    seedHistory(tmp, [
      { endpoint: "/api/users", method: "GET", p95: 100 },
    ]);
    await runPerformanceBudgetScan({
      config: makeConfig({
        endpoints: [{ path: "/api/users", method: "GET", currentP95: 30 }],
      }),
      projectDir: tmp,
    });
    const baselinesDir = resolve(tmp, ".forge", "tempering", "baselines");
    expect(existsSync(baselinesDir)).toBe(false);
  });
});
