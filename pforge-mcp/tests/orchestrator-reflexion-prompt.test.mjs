/**
 * Plan Forge — Phase-31 Slice 3 (Reflexion prompt wiring) unit tests
 *
 * Covers `buildRetryPrompt()` — the orchestrator-level function that wires
 * the reflexion context block into the worker prompt as a preamble on retries.
 *
 * Requirements (Phase-31 MUST):
 *   - First attempt (lastFailureContext === null) → prompt unchanged (no added block)
 *   - Retry (lastFailureContext non-null) → reflexion preamble prepended before all
 *     slice instructions
 *   - stderrTail ≥ 2KB is truncated, retaining the TAIL (not the head)
 *
 * Pure-function tests — no fs, no network, no orchestrator runtime plumbing.
 */

import { describe, it, expect } from "vitest";
import { buildRetryPrompt } from "../orchestrator.mjs";
import { buildReflexionBlock } from "../memory.mjs";

const SAMPLE_INSTRUCTIONS = "## Slice 5: Add feature\n\nDo the thing.";

const SAMPLE_CTX = {
  previousAttempt: 1,
  gateName: "npx vitest run",
  model: "claude-sonnet-4.5",
  durationMs: 8000,
  stderrTail: "Error: Cannot find module './foo'",
};

describe("buildRetryPrompt (Phase-31 Reflexion wiring)", () => {
  // ── First-attempt identity ─────────────────────────────────────────────────

  it("returns slice instructions unchanged when lastFailureContext is null", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, null);
    expect(result).toBe(SAMPLE_INSTRUCTIONS);
  });

  it("returns slice instructions unchanged when lastFailureContext is undefined", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, undefined);
    expect(result).toBe(SAMPLE_INSTRUCTIONS);
  });

  // ── Retry — preamble injection ─────────────────────────────────────────────

  it("prepends reflexion block separated by a blank line on retry", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, SAMPLE_CTX);
    const expected = buildReflexionBlock(SAMPLE_CTX) + "\n\n" + SAMPLE_INSTRUCTIONS;
    expect(result).toBe(expected);
  });

  it("result starts with the reflexion block (block is a preamble, not an appendix)", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, SAMPLE_CTX);
    expect(result.startsWith("## Previous attempt")).toBe(true);
  });

  it("result ends with the original slice instructions", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, SAMPLE_CTX);
    expect(result.endsWith(SAMPLE_INSTRUCTIONS)).toBe(true);
  });

  it("slice instructions appear after the reflexion block, not before", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, SAMPLE_CTX);
    const reflexionEnd = result.indexOf(SAMPLE_INSTRUCTIONS);
    const headerPos = result.indexOf("## Previous attempt");
    expect(headerPos).toBeLessThan(reflexionEnd);
  });

  // ── Reflexion block content ────────────────────────────────────────────────

  it("includes previousAttempt number in the block", () => {
    const ctx = { ...SAMPLE_CTX, previousAttempt: 3 };
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, ctx);
    expect(result).toContain("## Previous attempt (3) summary");
  });

  it("includes gate name, model, and duration in the block", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, SAMPLE_CTX);
    expect(result).toContain("- **Gate that failed**: `npx vitest run`");
    expect(result).toContain("- **Model used**: `claude-sonnet-4.5`");
    expect(result).toContain("- **Duration**: 8000ms");
  });

  it("includes the stderrTail text in the block", () => {
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, SAMPLE_CTX);
    expect(result).toContain("Cannot find module './foo'");
  });

  // ── stderrTail truncation ──────────────────────────────────────────────────

  it("truncates stderrTail > 2KB and preserves the TAIL (last bytes), not the head", () => {
    const head = "H".repeat(3000);
    const tail = "TAIL_MARKER";
    const longStderr = head + tail;
    const ctx = { ...SAMPLE_CTX, stderrTail: longStderr };

    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, ctx);

    // Truncation notice present
    expect(result).toContain("truncated to last 2048 bytes");
    // Tail is preserved
    expect(result).toContain("TAIL_MARKER");
    // Head should NOT be fully present (it was trimmed)
    expect(result).not.toContain("H".repeat(3000));
  });

  it("keeps stderrTail ≤ 2KB intact and uses the short-form notice", () => {
    const ctx = { ...SAMPLE_CTX, stderrTail: "Small error" };
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, ctx);
    expect(result).toContain("(stderr tail, ≤2KB)");
    expect(result).toContain("Small error");
    expect(result).not.toContain("truncated to last");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("handles empty string instructions gracefully on retry", () => {
    const result = buildRetryPrompt("", SAMPLE_CTX);
    expect(result.startsWith("## Previous attempt")).toBe(true);
    expect(result).toContain("\n\n");
  });

  it("handles a context object with no stderrTail (defaults to no-stderr notice)", () => {
    const ctx = { previousAttempt: 1, gateName: "npm test", model: "auto", durationMs: 100 };
    const result = buildRetryPrompt(SAMPLE_INSTRUCTIONS, ctx);
    expect(result).toContain("(no stderr captured)");
  });
});
