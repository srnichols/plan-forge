/**
 * Plan Forge — Phase-25 Slice 1 (L1 Reflexion) unit tests
 *
 * Covers the pure `buildReflexionBlock()` function that builds the
 * "## Previous attempt (N-1) summary" Markdown block used on slice retries
 * (MUST #1 in docs/plans/Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md).
 *
 * Pure-function tests — no fs, no network, no orchestrator plumbing.
 */

import { describe, it, expect } from "vitest";
import { buildReflexionBlock } from "../memory.mjs";

describe("buildReflexionBlock (Phase-25 L1 Reflexion)", () => {
  it("emits the mandated Markdown header with the attempt number", () => {
    const out = buildReflexionBlock({
      previousAttempt: 1,
      gateName: "npx vitest run",
      model: "claude-sonnet-4.5",
      durationMs: 12345,
      stderrTail: "ReferenceError: foo is not defined",
    });
    expect(out).toContain("## Previous attempt (1) summary");
  });

  it("includes gate name, model, and duration on their own bullet lines", () => {
    const out = buildReflexionBlock({
      previousAttempt: 2,
      gateName: "npm test",
      model: "gpt-5",
      durationMs: 500,
      stderrTail: "boom",
    });
    expect(out).toContain("- **Gate that failed**: `npm test`");
    expect(out).toContain("- **Model used**: `gpt-5`");
    expect(out).toContain("- **Duration**: 500ms");
  });

  it("renders the stderr tail inside a fenced code block", () => {
    const out = buildReflexionBlock({
      previousAttempt: 1,
      gateName: "tsc --noEmit",
      model: "grok-4",
      durationMs: 900,
      stderrTail: "TS2304: Cannot find name 'Foo'.",
    });
    // Find the triple-backtick block
    const firstFence = out.indexOf("```");
    const lastFence = out.lastIndexOf("```");
    expect(firstFence).toBeGreaterThan(-1);
    expect(lastFence).toBeGreaterThan(firstFence);
    const body = out.slice(firstFence + 3, lastFence);
    expect(body).toContain("TS2304: Cannot find name 'Foo'.");
  });

  it("truncates stderr longer than 2KB to the LAST 2048 bytes and marks it truncated", () => {
    const long = "X".repeat(3000) + "END";
    const out = buildReflexionBlock({
      previousAttempt: 1,
      gateName: "npm test",
      model: "auto",
      durationMs: 10,
      stderrTail: long,
    });
    // Truncation notice present
    expect(out).toContain("truncated to last 2048 bytes");
    // "END" (last 3 chars) must be retained — the tail, not the head, is preserved
    expect(out).toContain("END");
    // Full-length blob should NOT appear verbatim in output (it was trimmed)
    expect(out.length).toBeLessThan(long.length + 500);
  });

  it("keeps stderr ≤2KB intact and uses the short-form notice", () => {
    const short = "Small error.";
    const out = buildReflexionBlock({
      previousAttempt: 3,
      gateName: "pytest",
      model: "sonnet",
      durationMs: 100,
      stderrTail: short,
    });
    expect(out).toContain("(stderr tail, ≤2KB)");
    expect(out).toContain(short);
    expect(out).not.toContain("truncated to last");
  });

  it("falls back to safe defaults when fields are missing or invalid", () => {
    const out = buildReflexionBlock({});
    expect(out).toContain("## Previous attempt (1) summary");
    expect(out).toContain("- **Gate that failed**: `unknown`");
    expect(out).toContain("- **Model used**: `auto`");
    expect(out).toContain("- **Duration**: 0ms");
    expect(out).toContain("(no stderr captured)");
  });

  it("coerces a negative or NaN attempt number to 1", () => {
    const neg = buildReflexionBlock({ previousAttempt: -5, stderrTail: "x" });
    const nan = buildReflexionBlock({ previousAttempt: Number.NaN, stderrTail: "x" });
    expect(neg).toContain("## Previous attempt (1) summary");
    expect(nan).toContain("## Previous attempt (1) summary");
  });

  it("rounds fractional durations to an integer", () => {
    const out = buildReflexionBlock({
      previousAttempt: 1,
      gateName: "g",
      model: "m",
      durationMs: 123.7,
      stderrTail: "e",
    });
    expect(out).toContain("- **Duration**: 124ms");
  });

  it("closes with actionable guidance for the worker", () => {
    const out = buildReflexionBlock({ previousAttempt: 1, stderrTail: "e" });
    expect(out.toLowerCase()).toContain("avoid repeating");
  });
});
