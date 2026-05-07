/**
 * Phase-TRAJECTORY-SCHEMA-HARDENING Slice 5 — Focused tests for the new
 * `source` and `security_risk` fields on event records.
 *
 * Acceptance Criteria (six tests):
 *   1. appendEvent('slice-started') stamps both fields in the returned data
 *   2. Caller-supplied source overrides the default
 *   3. parseEventLine on a legacy line (no new fields) returns null for both
 *   4. parseEventLine round-trips both fields from a new-format line
 *   5. bridge-edit-blocked is always security_risk:'high' regardless of input
 *   6. Snapshot — all EVENT_SOURCE values survive round-trip on slice-completed
 */
import { describe, it, expect } from "vitest";
import {
  appendEvent,
  parseEventLine,
  EVENT_SOURCE,
  SECURITY_RISK,
} from "../orchestrator.mjs";

// ─── 1. appendEvent stamps both fields ───────────────────────────────────────

describe("appendEvent — field stamping", () => {
  it("slice-started result contains source and security_risk", () => {
    const stamped = appendEvent("slice-started", { sliceId: "1" }, null);
    expect(stamped).toHaveProperty("source");
    expect(stamped).toHaveProperty("security_risk");
    expect(stamped.source).toBe(EVENT_SOURCE.ORCHESTRATOR);
    expect(stamped.security_risk).toBe(SECURITY_RISK.LOW);
  });

  // ─── 2. Caller source override ─────────────────────────────────────────────
  it("explicit source in data overrides the orchestrator default", () => {
    const stamped = appendEvent(
      "slice-started",
      { sliceId: "2", source: EVENT_SOURCE.WORKER },
      null,
    );
    expect(stamped.source).toBe(EVENT_SOURCE.WORKER);
    expect(stamped.security_risk).toBe(SECURITY_RISK.LOW);
  });

  // ─── 5. bridge-edit-blocked always HIGH ────────────────────────────────────
  it("bridge-edit-blocked is always security_risk:'high' even when caller tries to override", () => {
    const low = appendEvent(
      "bridge-edit-blocked",
      { file: "src/foo.ts", security_risk: SECURITY_RISK.NONE },
      null,
    );
    expect(low.security_risk).toBe(SECURITY_RISK.HIGH);

    const medium = appendEvent(
      "bridge-edit-blocked",
      { file: "src/bar.ts", security_risk: SECURITY_RISK.MEDIUM },
      null,
    );
    expect(medium.security_risk).toBe(SECURITY_RISK.HIGH);
  });
});

// ─── 3. parseEventLine — legacy lines ────────────────────────────────────────

describe("parseEventLine — legacy line backward-compat", () => {
  it("line without source or security_risk returns null for both (no throw)", () => {
    const line = '[2023-01-01T00:00:00.000Z] slice-started: {"sliceId":"1","phase":"P-1"}';
    const parsed = parseEventLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed.type).toBe("slice-started");
    expect(parsed.source).toBeNull();
    expect(parsed.security_risk).toBeNull();
  });

  it("completely empty JSON payload does not throw and returns null fields", () => {
    const line = "[2023-06-15T12:00:00.000Z] run-completed: {}";
    const parsed = parseEventLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed.source).toBeNull();
    expect(parsed.security_risk).toBeNull();
  });
});

// ─── 4. parseEventLine — round-trip ──────────────────────────────────────────

describe("parseEventLine — new-format round-trip", () => {
  it("round-trips source and security_risk from a stamped event line", () => {
    const stamped = appendEvent(
      "slice-completed",
      { sliceId: "3", outcome: "ok" },
      null,
    );
    const ts = new Date().toISOString();
    const line = `[${ts}] slice-completed: ${JSON.stringify(stamped)}`;
    const parsed = parseEventLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed.source).toBe(stamped.source);
    expect(parsed.security_risk).toBe(stamped.security_risk);
    expect(parsed.type).toBe("slice-completed");
  });

  it("explicit security_risk in data round-trips correctly", () => {
    const stamped = appendEvent(
      "tool-call",
      { tool: "forge_search", security_risk: SECURITY_RISK.LOW },
      null,
    );
    const ts = new Date().toISOString();
    const line = `[${ts}] tool-call: ${JSON.stringify(stamped)}`;
    const parsed = parseEventLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed.security_risk).toBe(SECURITY_RISK.LOW);
    expect(parsed.source).toBe(EVENT_SOURCE.ORCHESTRATOR);
  });
});

// ─── 6. Snapshot — all EVENT_SOURCE values round-trip on slice-completed ──────

describe("snapshot — all EVENT_SOURCE values round-trip on slice-completed", () => {
  const sourceValues = Object.values(EVENT_SOURCE);

  for (const src of sourceValues) {
    it(`source:'${src}' survives appendEvent → line → parseEventLine`, () => {
      const stamped = appendEvent(
        "slice-completed",
        { sliceId: "snap", source: src },
        null,
      );
      expect(stamped.source).toBe(src);

      const ts = "2025-01-01T00:00:00.000Z";
      const line = `[${ts}] slice-completed: ${JSON.stringify(stamped)}`;
      const parsed = parseEventLine(line);

      expect(parsed).not.toBeNull();
      expect(parsed.source).toBe(src);
      expect(parsed.security_risk).toBe(SECURITY_RISK.LOW);
      expect(parsed.ts).toBe(ts);
      expect(parsed.type).toBe("slice-completed");
    });
  }
});
