/**
 * #303 — weekly Copilot model and pricing drift check (scripts/check-model-drift.mjs).
 * The live listModels() call needs Copilot credentials, so these tests cover the
 * decisions and the report; the workflow runs the live check.
 */

import { describe, it, expect } from "vitest";
import { diffPricing, renderReport, retiringDefaults, unavailableDefaults } from "../../scripts/check-model-drift.mjs";

const NOW = Date.parse("2026-10-01T00:00:00Z");

describe("retiringDefaults", () => {
  const retirements = { "old-a": "2026-09-01", "soon-b": "2026-10-19", "later-c": "2027-03-01" };

  it("returns defaults that retired already or retire within the window, soonest first", () => {
    const got = retiringDefaults({ defaults: ["later-c", "soon-b", "old-a", "fine-d"], retirements, now: NOW, withinDays: 30 });
    expect(got).toEqual([
      { model: "old-a", retires: "2026-09-01", daysLeft: -30 },
      { model: "soon-b", retires: "2026-10-19", daysLeft: 18 },
    ]);
  });

  it("ignores defaults with no announced retirement", () => {
    expect(retiringDefaults({ defaults: ["fine-d"], retirements, now: NOW })).toEqual([]);
  });
});

describe("unavailableDefaults", () => {
  it("flags Copilot-served defaults missing from the live list, not direct-API ones", () => {
    const got = unavailableDefaults({
      defaults: ["claude-opus-5.5", "gone-x", "direct-y"],
      liveIds: ["claude-opus-5.5"],
      isDirectApiOnly: (m) => m === "direct-y",
    });
    expect(got).toEqual(["gone-x"]);
  });
});

describe("diffPricing", () => {
  it("lists added, removed and repriced models", () => {
    const saved = { a: { input: 1 }, b: { input: 2 }, c: { input: 3 } };
    const fresh = { a: { input: 1 }, b: { input: 5 }, d: { input: 4 } };
    expect(diffPricing(saved, fresh)).toEqual({ added: ["d"], removed: ["c"], changed: ["b"] });
  });
});

describe("renderReport", () => {
  const clean = { retiring: [], unavailable: [], pricing: { added: [], removed: [], changed: [] }, liveError: null, withinDays: 30 };

  it("says there is no drift when nothing is found", () => {
    expect(renderReport(clean)).toContain("No drift");
  });

  it("names each kind of drift and what to do about it", () => {
    const report = renderReport({
      ...clean,
      retiring: [{ model: "old-a", retires: "2026-09-01", daysLeft: -30 }, { model: "soon-b", retires: "2026-10-19", daysLeft: 18 }],
      unavailable: ["gone-x"],
      pricing: { added: ["d"], removed: [], changed: ["b"] },
    });
    expect(report).toContain("`old-a` retired 30 day(s) ago (2026-09-01)");
    expect(report).toContain("`soon-b` retires in 18 day(s) (2026-10-19)");
    expect(report).toContain("- `gone-x`");
    expect(report).toContain("- Added: `d`");
    expect(report).toContain("- Repriced: `b`");
    expect(report).toContain("node scripts/sync-copilot-pricing.mjs");
    expect(report).not.toContain("No drift");
  });

  it("explains skipped live checks without claiming there is no drift", () => {
    const report = renderReport({ ...clean, pricing: null, liveError: "not authenticated" });
    expect(report).toContain("Live checks skipped");
    expect(report).toContain("COPILOT_GITHUB_TOKEN");
    expect(report).not.toContain("No drift");
  });
});
