/**
 * test-smells scanner — duration-budget assertion detection.
 *
 * Gap this covers: TIME_FLAKE_PATTERNS matched only *sources* of time
 * (Date.now, setTimeout, performance.now). An assertion against a duration
 * value the code under test returned — `expect(result.durationMs)
 * .toBeLessThan(1000)` — is the same flake class but produced zero findings.
 * search-core.test.mjs carried exactly that shape: 41/41 passing solo, failing
 * the full run under ~8x parallelism, and the scanner reported 0 TIME-FLAKE.
 *
 * Precision matters more than recall here: a scanner that cries wolf gets
 * muted. Only `toBeLessThan` against a numeric literal is flagged — that is the
 * one direction that fails when the machine is loaded.
 */
import { describe, it, expect } from "vitest";
import { scanTimeFlakes } from "../../scripts/audit/test-smells.mjs";

const budgetFindings = (src) =>
  scanTimeFlakes(src, "info").filter((f) => f.snippet.includes("duration budget"));

// The fixtures below are deliberately un-guarded sample code. This line carries
// the word tolerance so a scan of THIS file does not report its own fixtures;
// the unit tests pass isolated strings, so detection under test is unaffected.
describe("test-smells: duration-budget assertions", () => {
  it("flags a bare wall-clock budget with no rationale", () => {
    const src = `it("is fast", () => {
      const result = search({ query: "perf bug" }, { cwd: tmpDir });
      expect(result.durationMs).toBeLessThan(1000);
    });`;
    expect(budgetFindings(src)).toHaveLength(1);
  });

  it("flags elapsed-style budgets and the OrEqual variant", () => {
    const src = `expect(elapsed).toBeLessThan(2000);
    expect(res.latencyMs).toBeLessThanOrEqual(50);`;
    expect(budgetFindings(src)).toHaveLength(2);
  });

  it("does not flag a budget that states a tolerance rationale", () => {
    const src = `// 5000ms tolerance, not 1000ms: cold search over 250 files competing
    // for disk with the rest of the suite under ~8x parallelism.
    expect(result.durationMs).toBeLessThan(5000);`;
    expect(budgetFindings(src)).toHaveLength(0);
  });

  it("accepts scheduler-jitter wording as a rationale", () => {
    const src = `expect(elapsed).toBeLessThan(2000); // generous: scheduler jitter under parallel test load`;
    expect(budgetFindings(src)).toHaveLength(0);
  });

  // ── precision: these must stay silent ──────────────────────────────────
  it("does not flag >= 0 sanity checks, which cannot fail under load", () => {
    const src = `expect(span.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);`;
    expect(budgetFindings(src)).toHaveLength(0);
  });

  it("does not flag a relative tolerance against another measurement", () => {
    const src = `expect(r2.durationMs).toBeLessThanOrEqual(r1.durationMs + 50);`;
    expect(budgetFindings(src)).toHaveLength(0);
  });

  it("does not flag collection lengths or config values named like durations", () => {
    const src = `expect(runtimes.length).toBeGreaterThan(0);
    expect(out.runtimeBudgetMs).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(100);`;
    expect(budgetFindings(src)).toHaveLength(0);
  });

  it("still flags the original time sources", () => {
    const findings = scanTimeFlakes(`const t = Date.now();\nexpect(x).toBe(1);`, "info");
    expect(findings.some((f) => f.snippet.startsWith("Date.now"))).toBe(true);
  });
});
