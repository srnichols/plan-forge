import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePlanCoverage, readPassedSlicesFromHistory } from "../orchestrator/run-plan/plan-coverage.mjs";
import { runPlan } from "../orchestrator.mjs";

/**
 * Meta-bug #322 — `pforge run-plan <plan> --only-slices 5` on a 29-slice plan
 * finished 1 passed / 0 failed and rewrote the plan header to "Complete —
 * shipped" while 24 slices had never run. `allPassed` only covered the slices
 * that executed, so --only-slices, --resume-from and aborted runs all marked
 * the whole plan shipped. The rewritten file was left dirty, so a false
 * Complete could reach the next auto-commit, the dashboard and forge_plan_status.
 */

const planOf = (count, overrides = {}) => ({
  slices: Array.from({ length: count }, (_, i) => ({ number: String(i + 1), ...(overrides[i + 1] ?? {}) })),
});
const passed = (...ids) => ids.map((id) => ({ sliceId: String(id), status: "passed" }));
const skipped = (...ids) => ids.map((id) => ({ sliceId: String(id), status: "skipped" }));

describe("computePlanCoverage (#322)", () => {
  it("is complete when every plan slice passed in this run", () => {
    const result = computePlanCoverage({ plan: planOf(3), results: passed(1, 2, 3) });
    expect(result).toMatchObject({ complete: true, uncovered: [] });
  });

  it("is partial for --only-slices: the slices that never ran have no result", () => {
    const result = computePlanCoverage({ plan: planOf(5), results: passed(5) });
    expect(result.complete).toBe(false);
    expect(result.uncovered).toEqual(["1", "2", "3", "4"]);
  });

  it("is partial when the run was aborted between slices", () => {
    const result = computePlanCoverage({ plan: planOf(3), results: passed(1, 2, 3), aborted: true });
    expect(result.complete).toBe(false);
    expect(result.reason).toMatch(/abort/i);
  });

  it("does not treat a --resume-from skip as proof the earlier slices ever passed", () => {
    const results = [...skipped(1, 2), ...passed(3)];
    const result = computePlanCoverage({ plan: planOf(3), results });
    expect(result.complete).toBe(false);
    expect(result.uncovered).toEqual(["1", "2"]);
  });

  it("accepts a resume-from skip when run history shows the slice passed earlier", () => {
    const results = [...skipped(1, 2), ...passed(3)];
    const result = computePlanCoverage({ plan: planOf(3), results, priorPassed: new Set(["1", "2"]) });
    expect(result.complete).toBe(true);
  });

  it("accepts a slice the plan itself marks complete", () => {
    const plan = planOf(3, { 1: { status: "completed" } });
    expect(computePlanCoverage({ plan, results: [...skipped(1), ...passed(2, 3)] }).complete).toBe(true);
  });

  it("never counts a slice skipped behind an unsatisfied dependency", () => {
    const results = [...passed(1), { sliceId: "2", status: "skipped", unsatisfied: true, reason: "dependency 1 failed" }];
    const result = computePlanCoverage({ plan: planOf(2), results, priorPassed: new Set(["2"]) });
    expect(result.complete).toBe(false);
    expect(result.uncovered).toEqual(["2"]);
  });

  it("matches results that carry only `number`, as executed slices do", () => {
    const results = [{ number: "1", status: "passed" }, { sliceId: "2", status: "passed" }];
    expect(computePlanCoverage({ plan: planOf(2), results }).complete).toBe(true);
  });

  it("is never complete for a plan with no slices", () => {
    expect(computePlanCoverage({ plan: { slices: [] }, results: [] }).complete).toBe(false);
  });

  it("lets a failed result stand even when history shows an earlier pass", () => {
    const results = [{ sliceId: "1", status: "failed" }];
    expect(computePlanCoverage({ plan: planOf(1), results, priorPassed: new Set(["1"]) }).complete).toBe(false);
  });
});

describe("readPassedSlicesFromHistory (#322)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project() {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-322-history-"));
    dirs.push(cwd);
    const run = (name, files) => {
      const dir = join(cwd, ".forge", "runs", name);
      mkdirSync(dir, { recursive: true });
      for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
    };
    return { cwd, run };
  }

  it("collects passed slices of this plan across runs and ignores everything else", () => {
    const { cwd, run } = project();
    run("2026-10-01T10-00-00-000Z_Phase-9-PLAN", {
      "slice-1.json": JSON.stringify({ status: "passed" }),
      "slice-2.json": JSON.stringify({ status: "failed" }),
      "slice-2.1.json": JSON.stringify({ status: "passed" }),
      "slice-3-quorum.json": JSON.stringify({ status: "passed" }),
      "slice-3-log.txt": "not json",
      "slice-4.json": "{ broken",
    });
    run("2026-10-02T10-00-00-000Z_Phase-9-PLAN", { "slice-2.json": JSON.stringify({ status: "passed" }) });
    run("2026-10-02T11-00-00-000Z_Phase-90-PLAN", { "slice-5.json": JSON.stringify({ status: "passed" }) });

    const found = readPassedSlicesFromHistory({ cwd, planPath: join(cwd, "docs", "plans", "Phase-9-PLAN.md") });
    expect([...found].sort()).toEqual(["1", "2", "2.1"]);
  });

  it("returns an empty set when there is no run history", () => {
    const { cwd } = project();
    expect(readPassedSlicesFromHistory({ cwd, planPath: join(cwd, "Phase-9-PLAN.md") }).size).toBe(0);
  });
});

describe("runPlan leaves the plan header alone after a partial run (#322)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function writePlan() {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-322-run-"));
    dirs.push(cwd);
    const gate = (n) => ["**Validation Gate**", "```", `node -e "process.exit(0)" # slice ${n}`, "```"].join("\n");
    const planPath = join(cwd, "Phase-9-PLAN.md");
    writeFileSync(planPath, [
      "---", "status: HARDENED", "---", "",
      "# Phase 9 - Partial run", "",
      "> **Status**: **HARDENED — cleared for execution.**", "",
      "## Scope Contract", "", "### In Scope", "- `a.txt`", "", "### Forbidden", "- nothing", "",
      "## Execution Slices", "",
      "### Slice 1: First", "", gate(1), "", "1. Do it.", "",
      "### Slice 2: Second", "", gate(2), "", "1. Do it.", "",
      "### Slice 3: Third", "", gate(3), "", "1. Do it.", "",
    ].join("\n"));
    return { cwd, planPath };
  }

  const options = (cwd, extra = {}) => ({ cwd, dryRunWorker: true, manualImport: true, quorum: false, ...extra });

  it("keeps HARDENED and says why when only some slices ran", async () => {
    const { cwd, planPath } = writePlan();
    const summary = await runPlan(planPath, options(cwd, { onlySlices: ["2"] }));
    expect(summary.status).toBe("completed");
    expect(summary.planStatusRewrite).toMatchObject({ rewrote: false, reason: "partial-run", uncovered: ["1", "3"] });
    const text = readFileSync(planPath, "utf-8");
    expect(text).toContain("status: HARDENED");
    expect(text).not.toContain("Complete — shipped");
  }, 120_000);

  it("still rewrites to Complete when the run covers every slice", async () => {
    const { cwd, planPath } = writePlan();
    const summary = await runPlan(planPath, options(cwd));
    expect(summary.planStatusRewrite).toMatchObject({ rewrote: true });
    const text = readFileSync(planPath, "utf-8");
    expect(text).toContain("status: COMPLETE");
    expect(text).toContain("Complete — shipped");
  }, 120_000);
});
