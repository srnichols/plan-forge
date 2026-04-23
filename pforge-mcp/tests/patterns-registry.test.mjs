import { describe, it, expect } from "vitest";
import detect, { normaliseGatePattern, extractGateFailures } from "../patterns/detectors/gate-failure-recurrence.mjs";
import { loadDetectors, runDetectors } from "../patterns/registry.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Build a fake run with gate failures seeded across slices. */
function makeRun(plan, slices) {
  return {
    plan,
    results: slices.map((s, i) => ({
      number: i + 1,
      title: s.title || `Slice ${i + 1}`,
      status: s.gateStatus === "failed" ? "failed" : "passed",
      gateStatus: s.gateStatus || "passed",
      gateError: s.gateError || null,
      gateOutput: s.gateOutput || null,
      failedCommand: s.failedCommand || null,
    })),
  };
}

// ─── normaliseGatePattern ─────────────────────────────────────────────

describe("normaliseGatePattern", () => {
  it("strips ISO timestamps", () => {
    const p = normaliseGatePattern("Error at 2026-04-23T10:30:00.000Z in run");
    expect(p).toContain("<timestamp>");
    expect(p).not.toMatch(/2026/);
  });

  it("strips git hashes", () => {
    const p = normaliseGatePattern("commit abc1234def was bad");
    expect(p).toContain("<hash>");
  });

  it("strips line:col references", () => {
    const p = normaliseGatePattern("src/foo.ts:42:10 error");
    expect(p).toContain(":<line>:<col>");
  });

  it("returns 'unknown' for falsy input", () => {
    expect(normaliseGatePattern(null)).toBe("unknown");
    expect(normaliseGatePattern("")).toBe("unknown");
  });
});

// ─── extractGateFailures ──────────────────────────────────────────────

describe("extractGateFailures", () => {
  it("extracts failures from runs", () => {
    const runs = [
      makeRun("plan-A", [
        { gateStatus: "passed" },
        { gateStatus: "failed", gateError: "tee /tmp/test failed", failedCommand: "tee /tmp/out" },
      ]),
    ];
    const failures = extractGateFailures(runs);
    expect(failures).toHaveLength(1);
    expect(failures[0].plan).toBe("plan-A");
    expect(failures[0].failedCommand).toBe("tee /tmp/out");
  });

  it("handles runs with no results", () => {
    expect(extractGateFailures([{ plan: "x" }])).toHaveLength(0);
  });
});

// ─── detect (main detector logic) ─────────────────────────────────────

describe("gate-failure-recurrence detector", () => {
  it("surfaces pattern when ≥ 3 occurrences across ≥ 2 plans", () => {
    // Seed: 4 gate failures with same normalised pattern across 2 plans
    const gateFail = { gateStatus: "failed", gateError: "tee /tmp/gate-out failed: permission denied", failedCommand: "tee /tmp/gate-out" };
    const runs = [
      makeRun("Phase-10-PLAN", [
        gateFail,
        gateFail,
        { gateStatus: "passed" },
      ]),
      makeRun("Phase-11-PLAN", [
        gateFail,
        gateFail,
        { gateStatus: "passed" },
      ]),
    ];

    const patterns = detect({ runs });
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    const p = patterns[0];
    expect(p.occurrences).toBe(4);
    expect(p.plans).toContain("Phase-10-PLAN");
    expect(p.plans).toContain("Phase-11-PLAN");
    expect(p.severity).toBe("warning");
    expect(p.id).toMatch(/^gate-failure-recurrence:/);
    expect(p.title).toBeTruthy();
    expect(p.detail).toBeTruthy();
  });

  it("does NOT surface pattern with < 3 occurrences", () => {
    const runs = [
      makeRun("Plan-A", [{ gateStatus: "failed", gateError: "unique error A" }]),
      makeRun("Plan-B", [{ gateStatus: "failed", gateError: "unique error A" }]),
    ];
    const patterns = detect({ runs });
    expect(patterns).toHaveLength(0);
  });

  it("does NOT surface pattern with < 2 plans", () => {
    const same = { gateStatus: "failed", gateError: "same error" };
    const runs = [
      makeRun("Plan-A", [same, same, same]),
    ];
    const patterns = detect({ runs });
    expect(patterns).toHaveLength(0);
  });

  it("returns empty for no runs", () => {
    expect(detect({ runs: [] })).toHaveLength(0);
    expect(detect({})).toHaveLength(0);
    expect(detect()).toHaveLength(0);
  });

  it("escalates to error severity at ≥ 6 occurrences", () => {
    const fail = { gateStatus: "failed", gateError: "npm test exit 1" };
    const runs = [
      makeRun("Plan-A", [fail, fail, fail]),
      makeRun("Plan-B", [fail, fail, fail]),
    ];
    const patterns = detect({ runs });
    expect(patterns).toHaveLength(1);
    expect(patterns[0].severity).toBe("error");
    expect(patterns[0].occurrences).toBe(6);
  });
});

// ─── Registry integration ─────────────────────────────────────────────

describe("patterns/registry", () => {
  it("loadDetectors discovers gate-failure-recurrence", async () => {
    const detectors = await loadDetectors();
    const names = detectors.map(d => d.name);
    expect(names).toContain("gate-failure-recurrence");
  });

  it("runDetectors returns patterns with detector field set", async () => {
    const fail = { gateStatus: "failed", gateError: "tee /tmp/x failed" };
    const runs = [
      makeRun("Plan-X", [fail, fail]),
      makeRun("Plan-Y", [fail]),
    ];
    const patterns = await runDetectors({ runs });
    // 3 occurrences across 2 plans — should surface
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0].detector).toBe("gate-failure-recurrence");
  });

  it("runDetectors returns empty for clean runs", async () => {
    const runs = [makeRun("Plan-A", [{ gateStatus: "passed" }])];
    const patterns = await runDetectors({ runs });
    expect(patterns).toHaveLength(0);
  });
});
