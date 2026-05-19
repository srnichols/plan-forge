/**
 * Plan Forge — Phase-39 Slice 3: watcher cross-run mode
 *
 * Covers:
 *   - buildCrossRunSnapshot() happy path, empty-state, window filtering
 *   - detectWatchAnomalies() cross-run anomaly codes
 *   - recommendFromAnomalies() cross-run recommendations
 *   - runWatch({ mode: "cross-run" }) end-to-end shape
 *   - MUST #3: ≥1 cross-run.* anomaly when same slice fails in ≥2 runs
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCrossRunSnapshot, parseWindowMs } from "../watcher.mjs";
import {
  runWatch,
  detectWatchAnomalies,
  recommendFromAnomalies,
} from "../orchestrator.mjs";

// ─── helpers ──────────────────────────────────────────────────────────

function makeRunDir(root, runId, summary) {
  const dir = join(root, ".forge", "runs", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "summary.json"), JSON.stringify(summary), "utf-8");
  return dir;
}

function recentTs(offsetMs = 0) {
  return new Date(Date.now() - offsetMs).toISOString();
}

function baseSummary(overrides = {}) {
  return {
    plan: "Phase-99-TEST-PLAN.md",
    startTime: recentTs(60_000),
    endTime: recentTs(),
    status: "completed",
    results: { passed: 3, failed: 0, skipped: 0, total: 3 },
    cost: { total_cost_usd: 0.05 },
    sliceResults: [],
    ...overrides,
  };
}

// ─── parseWindowMs ────────────────────────────────────────────────────

describe("parseWindowMs", () => {
  it("parses 14d correctly", () => {
    expect(parseWindowMs("14d")).toBe(14 * 24 * 60 * 60 * 1000);
  });
  it("parses 7d correctly", () => {
    expect(parseWindowMs("7d")).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it("parses 30d correctly", () => {
    expect(parseWindowMs("30d")).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it("defaults to 14d for unknown format", () => {
    expect(parseWindowMs("bad")).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

// ─── buildCrossRunSnapshot ────────────────────────────────────────────

describe("buildCrossRunSnapshot — no runs directory", () => {
  it("returns ok:false when .forge/runs does not exist", async () => {
    const result = await buildCrossRunSnapshot("/no/such/path/pforge-cross-run-xyz");
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

describe("buildCrossRunSnapshot — empty runs directory", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-empty-"));
    mkdirSync(join(tempDir, ".forge", "runs"), { recursive: true });
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("returns ok:true with 0 runs", async () => {
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.ok).toBe(true);
    expect(result.totalRuns).toBe(0);
    expect(result.runs).toHaveLength(0);
    expect(typeof result.message).toBe("string");
  });

  it("crossRun sub-object present with empty arrays", async () => {
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun).toBeDefined();
    expect(result.crossRun.recurringFailures).toHaveLength(0);
    expect(result.crossRun.retryRateSpike).toBe(false);
    expect(result.crossRun.sliceTimeoutClusters).toHaveLength(0);
  });
});

describe("buildCrossRunSnapshot — window filtering", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-window-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("includes runs within the window", async () => {
    makeRunDir(tempDir, "run-recent", baseSummary({ startTime: recentTs(1 * 24 * 60 * 60_000) }));
    const result = await buildCrossRunSnapshot(tempDir, { window: "7d" });
    expect(result.ok).toBe(true);
    expect(result.totalRuns).toBe(1);
  });

  it("excludes runs outside the window", async () => {
    makeRunDir(tempDir, "run-old", baseSummary({ startTime: recentTs(30 * 24 * 60 * 60_000) }));
    const result = await buildCrossRunSnapshot(tempDir, { window: "7d" });
    expect(result.ok).toBe(true);
    expect(result.totalRuns).toBe(0);
  });

  it("skips run dirs without summary.json", async () => {
    const dir = join(tempDir, ".forge", "runs", "run-no-summary");
    mkdirSync(dir, { recursive: true });
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.ok).toBe(true);
    expect(result.totalRuns).toBe(0);
  });
});

describe("buildCrossRunSnapshot — aggregate shape", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-agg-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("counts passed and failed runs correctly", async () => {
    makeRunDir(tempDir, "run-pass", baseSummary({ status: "completed" }));
    makeRunDir(tempDir, "run-fail", baseSummary({ status: "failed" }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.passedRuns).toBe(1);
    expect(result.failedRuns).toBe(1);
    expect(result.totalRuns).toBe(2);
  });

  it("runs array contains expected fields", async () => {
    makeRunDir(tempDir, "run-a", baseSummary());
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.runs).toHaveLength(1);
    const run = result.runs[0];
    expect(run).toHaveProperty("runId");
    expect(run).toHaveProperty("startTime");
    expect(run).toHaveProperty("status");
  });

  it("mode is 'cross-run'", async () => {
    makeRunDir(tempDir, "run-a", baseSummary());
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.mode).toBe("cross-run");
  });
});

describe("buildCrossRunSnapshot — recurring gate failures", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-fail-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("detects recurring failure when same slice fails in ≥2 runs", async () => {
    const failedSlice = { number: 3, title: "add-feature", status: "failed", duration: 30_000 };
    makeRunDir(tempDir, "run-1", baseSummary({ status: "failed", sliceResults: [failedSlice] }));
    makeRunDir(tempDir, "run-2", baseSummary({ status: "failed", sliceResults: [failedSlice] }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.recurringFailures).toHaveLength(1);
    expect(result.crossRun.recurringFailures[0].failCount).toBe(2);
    expect(result.crossRun.recurringFailures[0].sliceName).toMatch(/add-feature/);
  });

  it("does NOT flag a slice that failed only once", async () => {
    const failedSlice = { number: 2, title: "test-slice", status: "failed", duration: 15_000 };
    const passedSlice = { number: 2, title: "test-slice", status: "passed", duration: 15_000 };
    makeRunDir(tempDir, "run-1", baseSummary({ status: "failed", sliceResults: [failedSlice] }));
    makeRunDir(tempDir, "run-2", baseSummary({ status: "completed", sliceResults: [passedSlice] }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.recurringFailures).toHaveLength(0);
  });
});

describe("buildCrossRunSnapshot — retry rate spike", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-retry-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("detects retry rate spike when avg attempts > 2", async () => {
    const highRetrySlice = { number: 1, title: "heavy", status: "passed", attempts: 3, duration: 20_000 };
    makeRunDir(tempDir, "run-1", baseSummary({ sliceResults: [highRetrySlice] }));
    makeRunDir(tempDir, "run-2", baseSummary({ sliceResults: [highRetrySlice] }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.retryRateSpike).toBe(true);
  });

  it("no spike when retries are within normal range", async () => {
    const normalSlice = { number: 1, title: "easy", status: "passed", attempts: 1, duration: 10_000 };
    makeRunDir(tempDir, "run-1", baseSummary({ sliceResults: [normalSlice] }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.retryRateSpike).toBe(false);
  });
});

describe("buildCrossRunSnapshot — timeout clusters", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-timeout-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("detects timeout cluster when slice duration > 5min in ≥2 runs", async () => {
    const longSlice = { number: 5, title: "big-slice", status: "failed", duration: 6 * 60_000 };
    makeRunDir(tempDir, "run-1", baseSummary({ sliceResults: [longSlice] }));
    makeRunDir(tempDir, "run-2", baseSummary({ sliceResults: [longSlice] }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.sliceTimeoutClusters).toHaveLength(1);
    expect(result.crossRun.sliceTimeoutClusters[0].timeoutCount).toBe(2);
  });

  it("detects timeout via killedBySignal flag", async () => {
    const sigSlice = { number: 6, title: "killed-slice", status: "failed", killedBySignal: true, duration: 1000 };
    makeRunDir(tempDir, "run-1", baseSummary({ sliceResults: [sigSlice] }));
    makeRunDir(tempDir, "run-2", baseSummary({ sliceResults: [sigSlice] }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.sliceTimeoutClusters).toHaveLength(1);
  });
});

describe("buildCrossRunSnapshot — cost trend", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-cross-run-cost-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("reports 'up' trend when costs doubled in the second half", async () => {
    // Two early runs cheap, two late runs expensive
    const msPerDay = 24 * 60 * 60_000;
    makeRunDir(tempDir, "run-1", baseSummary({ startTime: recentTs(6 * msPerDay), cost: { total_cost_usd: 0.10 } }));
    makeRunDir(tempDir, "run-2", baseSummary({ startTime: recentTs(5 * msPerDay), cost: { total_cost_usd: 0.10 } }));
    makeRunDir(tempDir, "run-3", baseSummary({ startTime: recentTs(1 * msPerDay), cost: { total_cost_usd: 0.30 } }));
    makeRunDir(tempDir, "run-4", baseSummary({ startTime: recentTs(0.5 * msPerDay), cost: { total_cost_usd: 0.30 } }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.costTrend).toBe("up");
    expect(result.crossRun.costTrendPercent).toBeGreaterThan(20);
  });

  it("reports 'flat' when costs are consistent", async () => {
    const msPerDay = 24 * 60 * 60_000;
    makeRunDir(tempDir, "run-a", baseSummary({ startTime: recentTs(4 * msPerDay), cost: { total_cost_usd: 0.10 } }));
    makeRunDir(tempDir, "run-b", baseSummary({ startTime: recentTs(1 * msPerDay), cost: { total_cost_usd: 0.11 } }));
    const result = await buildCrossRunSnapshot(tempDir);
    expect(result.crossRun.costTrend).toBe("flat");
  });
});

// ─── detectWatchAnomalies — cross-run codes ────────────────────────────

describe("detectWatchAnomalies — cross-run codes", () => {
  it("fires cross-run.recurring-gate-failure when recurringFailures present", () => {
    const snapshot = {
      ok: true,
      crossRun: {
        recurringFailures: [{ sliceName: "3-add-feat", failCount: 3, totalCount: 5, runIds: ["r1", "r2", "r3"] }],
        retryRateSpike: false,
        costTrend: "flat",
        costTrendPercent: 5,
        sliceTimeoutClusters: [],
      },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const codes = anomalies.map((a) => a.code);
    expect(codes).toContain("cross-run.recurring-gate-failure");
  });

  it("fires cross-run.retry-rate-spike when retryRateSpike is true", () => {
    const snapshot = {
      ok: true,
      crossRun: {
        recurringFailures: [],
        retryRateSpike: true,
        costTrend: "flat",
        costTrendPercent: 0,
        sliceTimeoutClusters: [],
      },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const codes = anomalies.map((a) => a.code);
    expect(codes).toContain("cross-run.retry-rate-spike");
  });

  it("fires cross-run.cost-anomaly-trend when costTrend is 'up'", () => {
    const snapshot = {
      ok: true,
      crossRun: {
        recurringFailures: [],
        retryRateSpike: false,
        costTrend: "up",
        costTrendPercent: 45,
        sliceTimeoutClusters: [],
      },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const codes = anomalies.map((a) => a.code);
    expect(codes).toContain("cross-run.cost-anomaly-trend");
  });

  it("fires cross-run.slice-timeout-cluster when clusters present", () => {
    const snapshot = {
      ok: true,
      crossRun: {
        recurringFailures: [],
        retryRateSpike: false,
        costTrend: "flat",
        costTrendPercent: 0,
        sliceTimeoutClusters: [{ sliceName: "4-heavy-slice", timeoutCount: 3 }],
      },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const codes = anomalies.map((a) => a.code);
    expect(codes).toContain("cross-run.slice-timeout-cluster");
  });

  it("does NOT fire cross-run codes when crossRun field is absent", () => {
    const snapshot = { ok: true, runState: "completed", artifacts: [], counts: { failed: 0 } };
    const anomalies = detectWatchAnomalies(snapshot);
    const crossRunCodes = anomalies.filter((a) => a.code.startsWith("cross-run."));
    expect(crossRunCodes).toHaveLength(0);
  });

  it("does NOT fire cross-run codes for empty crossRun arrays", () => {
    const snapshot = {
      ok: true,
      crossRun: {
        recurringFailures: [],
        retryRateSpike: false,
        costTrend: "flat",
        costTrendPercent: 0,
        sliceTimeoutClusters: [],
      },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const crossRunCodes = anomalies.filter((a) => a.code.startsWith("cross-run."));
    expect(crossRunCodes).toHaveLength(0);
  });
});

// ─── recommendFromAnomalies — cross-run recs ───────────────────────────

describe("recommendFromAnomalies — cross-run codes", () => {
  const crossRunSnapshot = {
    ok: true,
    crossRun: {
      recurringFailures: [{ sliceName: "3-add-feat", failCount: 2, totalCount: 4, runIds: ["r1", "r2"] }],
      retryRateSpike: true,
      costTrend: "up",
      costTrendPercent: 50,
      sliceTimeoutClusters: [{ sliceName: "5-big-task", timeoutCount: 2 }],
    },
  };

  it("returns a recommendation for cross-run.recurring-gate-failure", () => {
    const anomalies = [{ code: "cross-run.recurring-gate-failure", severity: "error", message: "test" }];
    const recs = recommendFromAnomalies(anomalies, crossRunSnapshot);
    expect(recs.some((r) => r.code === "cross-run.recurring-gate-failure")).toBe(true);
  });

  it("returns a recommendation for cross-run.retry-rate-spike", () => {
    const anomalies = [{ code: "cross-run.retry-rate-spike", severity: "warn", message: "test" }];
    const recs = recommendFromAnomalies(anomalies, crossRunSnapshot);
    expect(recs.some((r) => r.code === "cross-run.retry-rate-spike")).toBe(true);
  });

  it("returns a recommendation for cross-run.cost-anomaly-trend", () => {
    const anomalies = [{ code: "cross-run.cost-anomaly-trend", severity: "warn", message: "test" }];
    const recs = recommendFromAnomalies(anomalies, crossRunSnapshot);
    expect(recs.some((r) => r.code === "cross-run.cost-anomaly-trend")).toBe(true);
  });

  it("returns a recommendation for cross-run.slice-timeout-cluster", () => {
    const anomalies = [{ code: "cross-run.slice-timeout-cluster", severity: "warn", message: "test" }];
    const recs = recommendFromAnomalies(anomalies, crossRunSnapshot);
    expect(recs.some((r) => r.code === "cross-run.slice-timeout-cluster")).toBe(true);
  });

  it("recommendations have required fields", () => {
    const anomalies = [{ code: "cross-run.recurring-gate-failure", severity: "error", message: "test" }];
    const recs = recommendFromAnomalies(anomalies, crossRunSnapshot);
    const rec = recs.find((r) => r.code === "cross-run.recurring-gate-failure");
    expect(rec).toHaveProperty("code");
    expect(rec).toHaveProperty("severity");
    expect(rec).toHaveProperty("action");
    expect(rec).toHaveProperty("command");
  });
});

// ─── runWatch({ mode: "cross-run" }) end-to-end ───────────────────────

describe("runWatch — mode: cross-run — shape contract", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-rw-cross-run-"));
    // Seed 2 successful runs so the path has data
    makeRunDir(tempDir, "run-1", baseSummary());
    makeRunDir(tempDir, "run-2", baseSummary());
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("returns ok:true", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(result.ok).toBe(true);
  });

  it("mode field is 'cross-run'", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(result.mode).toBe("cross-run");
  });

  it("result has required shape fields", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    const required = ["ok", "mode", "targetPath", "crossRunWindow", "totalRuns", "passedRuns",
      "failedRuns", "runs", "anomalies", "recommendations", "snapshot", "timestamp"];
    for (const field of required) {
      expect(result, `cross-run result must have '${field}'`).toHaveProperty(field);
    }
  });

  it("anomalies is an array", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(Array.isArray(result.anomalies)).toBe(true);
  });

  it("recommendations is an array", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  it("timestamp is a valid ISO string", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(typeof result.timestamp).toBe("string");
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it("crossRunWindow defaults to '14d'", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(result.crossRunWindow).toBe("14d");
  });

  it("respects custom crossRunWindow", async () => {
    const result = await runWatch({ targetPath: tempDir, mode: "cross-run", crossRunWindow: "7d" });
    expect(result.crossRunWindow).toBe("7d");
  });

  it("returns ok:false for missing targetPath", async () => {
    const result = await runWatch({ mode: "cross-run" });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false for non-existent targetPath", async () => {
    const result = await runWatch({ targetPath: "/no/such/path/pforge-cross-run-xyz", mode: "cross-run" });
    expect(result.ok).toBe(false);
  });
});

// ─── MUST #3 — at least one cross-run.* anomaly for ≥2 failures of same slice ──

describe("MUST #3 — cross-run anomaly fires for ≥2 historical failures of same slice", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-must3-"));
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("returns at least one cross-run.* anomaly when the same slice failed in 2 different runs", async () => {
    const failedSlice = { number: 4, title: "validate-schema", status: "failed", duration: 25_000 };
    makeRunDir(tempDir, "run-alpha", baseSummary({ status: "failed", sliceResults: [failedSlice] }));
    makeRunDir(tempDir, "run-beta", baseSummary({ status: "failed", sliceResults: [failedSlice] }));

    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    expect(result.ok).toBe(true);

    const crossRunAnomalies = result.anomalies.filter((a) => a.code.startsWith("cross-run."));
    expect(crossRunAnomalies.length).toBeGreaterThanOrEqual(1);
    expect(crossRunAnomalies[0].code).toBe("cross-run.recurring-gate-failure");
  });

  it("produces a corresponding recommendation for the recurring failure", async () => {
    const failedSlice = { number: 2, title: "run-tests", status: "failed", duration: 20_000 };
    makeRunDir(tempDir, "run-x", baseSummary({ status: "failed", sliceResults: [failedSlice] }));
    makeRunDir(tempDir, "run-y", baseSummary({ status: "failed", sliceResults: [failedSlice] }));

    const result = await runWatch({ targetPath: tempDir, mode: "cross-run" });
    const recs = result.recommendations.filter((r) => r.code === "cross-run.recurring-gate-failure");
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(typeof recs[0].action).toBe("string");
  });
});

// ─── non-regression: snapshot mode unaffected ─────────────────────────

describe("non-regression — snapshot mode unchanged by Slice 3", () => {
  let tempDir;
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-nonreg-"));
    const runDir = join(tempDir, ".forge", "runs", "run-seed");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "events.log"), "", "utf-8");
  });
  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it("snapshot mode still returns ok:true", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(result.ok).toBe(true);
  });

  it("snapshot mode result does NOT have crossRunWindow field", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(result).not.toHaveProperty("crossRunWindow");
  });

  it("snapshot mode result.mode is 'snapshot'", async () => {
    const result = await runWatch({ targetPath: tempDir });
    expect(result.mode).toBe("snapshot");
  });
});
