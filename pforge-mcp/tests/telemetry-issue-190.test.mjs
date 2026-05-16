// Tests for #190 (v2.96.4): tokens.apiDurationMs must be null (not 0) when the
// upstream worker does not surface totalApiDurationMs.
//
// Discovered in plan-forge-testbed Phase-3 background run on v2.96.3:
// gh-copilot CLI workers omit usage.totalApiDurationMs entirely, but
// extractTokens used `|| 0` which coerced the absent field to 0 — producing
// a misleading "API call took 0 ms" signal on every CLI slice.
//
// Contract after fix:
//   - apiDurationMs is null when totalApiDurationMs is absent / null / undefined
//   - apiDurationMs is the numeric value when totalApiDurationMs is present
//     (including 0 if explicitly reported as 0)
//   - sessionDurationMs follows the same contract as a precaution

import { describe, it, expect } from "vitest";
import { extractTokens } from "../orchestrator.mjs";

describe("Bug #190 — extractTokens preserves null for absent duration fields", () => {
  it("returns apiDurationMs === null when no result event is emitted (empty events)", () => {
    const tokens = extractTokens([]);
    expect(tokens.apiDurationMs).toBeNull();
    expect(tokens.sessionDurationMs).toBeNull();
  });

  it("returns apiDurationMs === null when result event has no usage block", () => {
    const events = [
      { type: "result", model: "claude-sonnet-4.6" },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBeNull();
    expect(tokens.sessionDurationMs).toBeNull();
  });

  it("returns apiDurationMs === null when usage is present but totalApiDurationMs is absent (gh-copilot CLI shape)", () => {
    // This is the exact event shape gh-copilot CLI emits — sessionDurationMs
    // and premiumRequests are present, but totalApiDurationMs is not.
    const events = [
      {
        type: "result",
        usage: {
          premiumRequests: 1,
          sessionDurationMs: 53751,
          codeChanges: { filesChanged: 5, linesAdded: 84, linesRemoved: 0 },
        },
        model: "claude-sonnet-4.6",
      },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBeNull();
    expect(tokens.sessionDurationMs).toBe(53751);
    expect(tokens.premiumRequests).toBe(1);
    expect(tokens.codeChanges).toEqual({ filesChanged: 5, linesAdded: 84, linesRemoved: 0 });
  });

  it("returns apiDurationMs === null when totalApiDurationMs is explicitly null", () => {
    const events = [
      { type: "result", usage: { totalApiDurationMs: null, sessionDurationMs: 1000 } },
    ];
    expect(extractTokens(events).apiDurationMs).toBeNull();
  });

  it("returns apiDurationMs === null when totalApiDurationMs is explicitly undefined", () => {
    const events = [
      { type: "result", usage: { totalApiDurationMs: undefined, sessionDurationMs: 1000 } },
    ];
    expect(extractTokens(events).apiDurationMs).toBeNull();
  });

  it("returns apiDurationMs === 0 when totalApiDurationMs is explicitly 0 (preserve real zero)", () => {
    // Distinguish "not reported" from "actually reported as zero" — both legitimate
    // upstream signals; only the former should map to null.
    const events = [
      { type: "result", usage: { totalApiDurationMs: 0, sessionDurationMs: 100 } },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBe(0);
    expect(tokens.sessionDurationMs).toBe(100);
  });

  it("returns apiDurationMs === <number> when totalApiDurationMs is positive (existing positive path)", () => {
    const events = [
      {
        type: "result",
        usage: {
          premiumRequests: 3,
          totalApiDurationMs: 45000,
          sessionDurationMs: 95000,
          codeChanges: 7,
        },
        model: "claude-sonnet-4.6",
      },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBe(45000);
    expect(tokens.sessionDurationMs).toBe(95000);
    expect(tokens.premiumRequests).toBe(3);
  });

  it("returns sessionDurationMs === null when sessionDurationMs is absent", () => {
    const events = [
      { type: "result", usage: { totalApiDurationMs: 1000, premiumRequests: 2 } },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBe(1000);
    expect(tokens.sessionDurationMs).toBeNull();
  });

  it("returns sessionDurationMs === 0 when explicitly reported as 0 (preserve real zero)", () => {
    const events = [
      { type: "result", usage: { sessionDurationMs: 0 } },
    ];
    expect(extractTokens(events).sessionDurationMs).toBe(0);
  });

  it("last-write-wins when multiple result events appear", () => {
    const events = [
      { type: "result", usage: { totalApiDurationMs: 100, sessionDurationMs: 200 } },
      { type: "result", usage: { totalApiDurationMs: 999, sessionDurationMs: 888 } },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBe(999);
    expect(tokens.sessionDurationMs).toBe(888);
  });

  it("does not clobber prior numeric value when a later result lacks the field", () => {
    // First result has totalApiDurationMs, second omits it. The previously-set
    // value must NOT be wiped out by the absent field (no spurious null reset).
    const events = [
      { type: "result", usage: { totalApiDurationMs: 5000, sessionDurationMs: 10000 } },
      { type: "result", usage: { premiumRequests: 1 } },
    ];
    const tokens = extractTokens(events);
    expect(tokens.apiDurationMs).toBe(5000);
    expect(tokens.sessionDurationMs).toBe(10000);
    expect(tokens.premiumRequests).toBe(1);
  });

  it("contract: returned shape always includes apiDurationMs and sessionDurationMs keys", () => {
    const tokens = extractTokens([]);
    expect("apiDurationMs" in tokens).toBe(true);
    expect("sessionDurationMs" in tokens).toBe(true);
    // null is a legitimate value, but the key must always be present
  });

  it("contract: apiDurationMs is null or a non-negative number, never undefined or NaN", () => {
    const cases = [
      [], // empty
      [{ type: "result" }], // no usage
      [{ type: "result", usage: {} }], // empty usage
      [{ type: "result", usage: { totalApiDurationMs: 0 } }], // explicit zero
      [{ type: "result", usage: { totalApiDurationMs: 1234 } }], // positive
    ];
    for (const events of cases) {
      const t = extractTokens(events);
      expect(t.apiDurationMs === null || (typeof t.apiDurationMs === "number" && !Number.isNaN(t.apiDurationMs) && t.apiDurationMs >= 0)).toBe(true);
    }
  });
});
