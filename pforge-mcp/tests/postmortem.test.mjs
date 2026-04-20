/**
 * Plan Forge — Phase-25 Slice 5 (L5 Plan postmortem) unit tests
 *
 * Covers buildPlanPostmortem(), listPlanPostmortems(), writePlanPostmortem():
 *   - Builds a record with the MUST #5 schema (retriesPerSlice, gateFlaps,
 *     driftDelta, costDelta, topFailureReason, totalDurationMs).
 *   - Delta fields compare against the newest prior postmortem per plan.
 *   - Retention keeps the newest POSTMORTEM_RETENTION_COUNT (D7).
 *   - Writer is path-traversal safe.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  buildPlanPostmortem,
  listPlanPostmortems,
  writePlanPostmortem,
  POSTMORTEM_RETENTION_COUNT,
} from "../orchestrator.mjs";

const SAMPLE_SUMMARY_PASSED = {
  status: "completed",
  totalDuration: 12345,
  cost: { total_cost_usd: 0.42 },
  analyze: { score: 88 },
  sliceResults: [
    { number: 1, status: "passed", attempts: 1 },
    { number: 2, status: "passed", attempts: 2 }, // one gate flap
    { number: 3, status: "passed", attempts: 3 }, // two gate flaps
  ],
};

describe("buildPlanPostmortem", () => {
  it("produces the Phase-25 MUST #5 schema shape", () => {
    const rec = buildPlanPostmortem({
      summary: SAMPLE_SUMMARY_PASSED,
      planBasename: "my-plan",
      now: "2099-01-01T00:00:00.000Z",
    });
    expect(rec.planBasename).toBe("my-plan");
    expect(rec.status).toBe("completed");
    expect(rec.totalDurationMs).toBe(12345);
    expect(rec.createdAt).toBe("2099-01-01T00:00:00.000Z");
    expect(rec.retriesPerSlice).toEqual({ 2: 1, 3: 2 });
    expect(rec.gateFlaps).toBe(3);
    expect(rec.topFailureReason).toBeNull();
  });

  it("captures the most common failure reason when slices fail", () => {
    const rec = buildPlanPostmortem({
      summary: {
        status: "failed",
        totalDuration: 500,
        sliceResults: [
          { number: 1, status: "failed", attempts: 3, failedCommand: "vitest run X" },
          { number: 2, status: "failed", attempts: 3, failedCommand: "vitest run X" },
          { number: 3, status: "failed", attempts: 1, failedCommand: "npm run build" },
        ],
      },
      planBasename: "fail-plan",
    });
    expect(rec.topFailureReason).toBe("vitest run X");
    // Failed slices don't count as gate flaps (only passed slices with attempts>1 do)
    expect(rec.gateFlaps).toBe(0);
  });

  it("computes costDelta vs the most-recent prior postmortem", () => {
    const prior = [{
      planBasename: "p",
      createdAt: "2099-01-01T00:00:00.000Z",
      costDelta: { before: null, after: 0.10, delta: null },
    }];
    const rec = buildPlanPostmortem({
      summary: SAMPLE_SUMMARY_PASSED,
      planBasename: "p",
      priorPostmortems: prior,
    });
    expect(rec.costDelta.before).toBe(0.10);
    expect(rec.costDelta.after).toBe(0.42);
    expect(rec.costDelta.delta).toBeCloseTo(0.32, 4);
  });

  it("sets costDelta.before=null when no priors exist", () => {
    const rec = buildPlanPostmortem({
      summary: SAMPLE_SUMMARY_PASSED,
      planBasename: "fresh",
      priorPostmortems: [],
    });
    expect(rec.costDelta.before).toBeNull();
    expect(rec.costDelta.after).toBe(0.42);
    expect(rec.costDelta.delta).toBeNull();
  });

  it("computes driftDelta when analyze.score is present on both runs", () => {
    const prior = [{
      planBasename: "p",
      createdAt: "2099-01-01T00:00:00.000Z",
      driftDelta: { before: null, after: 75, delta: null },
    }];
    const rec = buildPlanPostmortem({
      summary: SAMPLE_SUMMARY_PASSED,
      planBasename: "p",
      priorPostmortems: prior,
    });
    expect(rec.driftDelta.before).toBe(75);
    expect(rec.driftDelta.after).toBe(88);
    expect(rec.driftDelta.delta).toBeCloseTo(13, 2);
  });

  it("driftDelta/costDelta are null when summary lacks the source fields", () => {
    const rec = buildPlanPostmortem({
      summary: { status: "completed", totalDuration: 0, sliceResults: [] },
      planBasename: "no-metrics",
    });
    expect(rec.costDelta).toBeNull();
    expect(rec.driftDelta).toBeNull();
  });

  it("throws on missing required args", () => {
    expect(() => buildPlanPostmortem({})).toThrow();
    expect(() => buildPlanPostmortem({ summary: {} })).toThrow();
  });
});

describe("listPlanPostmortems + writePlanPostmortem", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-pm-"));
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns [] when the postmortem directory does not exist", () => {
    expect(listPlanPostmortems({ cwd, planBasename: "never-run" })).toEqual([]);
  });

  it("persists a postmortem JSON file to .forge/plans/<plan>/", () => {
    const record = buildPlanPostmortem({
      summary: SAMPLE_SUMMARY_PASSED,
      planBasename: "demo-plan",
      now: "2099-06-01T12-34-56-000Z".replace("Z","Z"),
    });
    const path = writePlanPostmortem({ cwd, planBasename: "demo-plan", record });
    expect(path).toContain(".forge");
    expect(path).toContain("plans");
    expect(path).toContain("demo-plan");
    const listed = listPlanPostmortems({ cwd, planBasename: "demo-plan" });
    expect(listed).toHaveLength(1);
    expect(listed[0].record.planBasename).toBe("demo-plan");
  });

  it("returns postmortems newest-first", () => {
    const r1 = buildPlanPostmortem({ summary: SAMPLE_SUMMARY_PASSED, planBasename: "p", now: "2099-01-01T00:00:00.000Z" });
    writePlanPostmortem({ cwd, planBasename: "p", record: r1 });
    const r2 = buildPlanPostmortem({ summary: SAMPLE_SUMMARY_PASSED, planBasename: "p", now: "2099-06-01T00:00:00.000Z" });
    writePlanPostmortem({ cwd, planBasename: "p", record: r2 });
    const listed = listPlanPostmortems({ cwd, planBasename: "p" });
    expect(listed).toHaveLength(2);
    expect(listed[0].record.createdAt).toBe("2099-06-01T00:00:00.000Z");
  });

  it("prunes to POSTMORTEM_RETENTION_COUNT newest entries (D7)", () => {
    // Write N+3 postmortems
    const N = POSTMORTEM_RETENTION_COUNT + 3;
    for (let i = 0; i < N; i++) {
      const iso = `2099-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`;
      const rec = buildPlanPostmortem({ summary: SAMPLE_SUMMARY_PASSED, planBasename: "pruned", now: iso });
      writePlanPostmortem({ cwd, planBasename: "pruned", record: rec });
    }
    const listed = listPlanPostmortems({ cwd, planBasename: "pruned" });
    expect(listed).toHaveLength(POSTMORTEM_RETENTION_COUNT);
    // Newest retained
    expect(listed[0].record.createdAt.startsWith(`2099-01-${String(N).padStart(2, "0")}`)).toBe(true);
  });

  it("sanitizes planBasename against path traversal", () => {
    const rec = buildPlanPostmortem({
      summary: SAMPLE_SUMMARY_PASSED,
      planBasename: "../../../etc/passwd",
      now: "2099-01-01T00:00:00.000Z",
    });
    const path = writePlanPostmortem({ cwd, planBasename: "../../../etc/passwd", record: rec });
    // Must not escape the cwd
    expect(path.startsWith(resolve(cwd))).toBe(true);
    expect(path.includes("..")).toBe(false);
  });

  it("skips malformed files without throwing", () => {
    const dir = resolve(cwd, ".forge", "plans", "broken");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "postmortem-bad.json"), "not json {{{", "utf-8");
    const rec = buildPlanPostmortem({ summary: SAMPLE_SUMMARY_PASSED, planBasename: "broken", now: "2099-01-01T00:00:00.000Z" });
    writePlanPostmortem({ cwd, planBasename: "broken", record: rec });
    const listed = listPlanPostmortems({ cwd, planBasename: "broken" });
    // Only the valid one is returned
    expect(listed).toHaveLength(1);
  });
});
