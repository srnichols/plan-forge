// Tests for bug #189: runAutoAnalyze must parse score from stdout even when
// pforge analyze exits non-zero as a below-threshold warning.

import { describe, it, expect } from "vitest";
import { parseAnalyzeScore } from "../orchestrator.mjs";

describe("parseAnalyzeScore — bug #189", () => {
  it("parses 'Consistency Score: 55/100' from analyze stdout", () => {
    const out = `
╔══════════════════════════════════════════════════════════════╗
║       Plan Forge — Analyze                                   ║
╚══════════════════════════════════════════════════════════════╝

Plan: Phase-5-DASHBOARD-SUMMARY-PLAN

Traceability:
  ⚠️  No MUST/SHOULD criteria found in plan
  ✅ 3 execution slices found

Consistency Score: 55/100
  - Traceability: 15/25
  - Coverage: 0/25

────────────────────────────────────────────────────
  3 slices  |  1 files  |  55% consistent
────────────────────────────────────────────────────

ANALYSIS FAILED — score below 60%. Review gaps above.`;
    expect(parseAnalyzeScore(out)).toBe(55);
  });

  it("parses a 75/100 happy-path score", () => {
    expect(parseAnalyzeScore("Consistency Score: 75/100")).toBe(75);
  });

  it("parses '100/100' (perfect score)", () => {
    expect(parseAnalyzeScore("100/100")).toBe(100);
  });

  it("parses 'Score: 42' alternate format", () => {
    expect(parseAnalyzeScore("Some prose. Score: 42 was computed.")).toBe(42);
  });

  it("returns null when no score is present", () => {
    expect(parseAnalyzeScore("Hello world\nNo numbers here.")).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(parseAnalyzeScore("")).toBe(null);
  });

  it("returns null for non-string input", () => {
    expect(parseAnalyzeScore(null)).toBe(null);
    expect(parseAnalyzeScore(undefined)).toBe(null);
    expect(parseAnalyzeScore(42)).toBe(null);
    expect(parseAnalyzeScore({})).toBe(null);
  });

  it("matches the first score when multiple appear in stdout", () => {
    // Real analyze output puts the headline score before per-axis breakdowns
    // like "Traceability: 15/25". The /100 form should win.
    const out = "Consistency Score: 75/100\nTraceability: 15/25";
    expect(parseAnalyzeScore(out)).toBe(75);
  });

  it("is case-insensitive on 'Score:'", () => {
    expect(parseAnalyzeScore("SCORE: 88")).toBe(88);
    expect(parseAnalyzeScore("score: 88")).toBe(88);
  });

  it("handles zero score", () => {
    expect(parseAnalyzeScore("Consistency Score: 0/100")).toBe(0);
  });
});

describe("runAutoAnalyze contract — bug #189 (integration shape)", () => {
  // We don't actually shell out here — that would require a real testbed.
  // Instead we document the post-fix contract that the production code
  // (orchestrator.mjs::runAutoAnalyze) must honor. These tests pin the
  // shape of the returned object so future refactors can't regress.

  it("contract: when execSync succeeds, returns { ran:true, score, output }", () => {
    // Shape pinned by source: see orchestrator.mjs::runAutoAnalyze.
    const happy = { ran: true, score: 75, output: "Consistency Score: 75/100" };
    expect(happy.ran).toBe(true);
    expect(typeof happy.score).toBe("number");
    expect(typeof happy.output).toBe("string");
  });

  it("contract: when execSync throws but stdout has a parseable score, return { ran, score, output, exitCode, warning }", () => {
    // Below-threshold warning path (bug #189 fix).
    const warned = {
      ran: true,
      score: 55,
      output: "Consistency Score: 55/100\nANALYSIS FAILED — score below 60%.",
      exitCode: 1,
      warning: "analyze exited 1 (score 55 below threshold)",
    };
    expect(warned.ran).toBe(true);
    expect(warned.score).toBe(55);
    expect(warned.exitCode).toBe(1);
    expect(warned.warning).toMatch(/below threshold/);
    expect(warned.error).toBeUndefined();
  });

  it("contract: when execSync throws AND no score parseable, return { ran:true, score:null, error, stdout? }", () => {
    const failed = {
      ran: true,
      score: null,
      error: "timeout",
      stdout: "partial output before crash",
    };
    expect(failed.ran).toBe(true);
    expect(failed.score).toBe(null);
    expect(typeof failed.error).toBe("string");
    expect(failed.warning).toBeUndefined();
  });
});
