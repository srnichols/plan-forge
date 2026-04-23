/**
 * Plan Forge — Digest Renderer Tests (Phase-38.5 Slice 2)
 *
 * Snapshot-style determinism tests: rendering the same fixture digest
 * must produce identical output on repeated runs.
 */

import { describe, it, expect } from "vitest";
import { renderMarkdown, renderJson } from "../digest/render.mjs";

// ─── Fixture: a digest with items in every section ────────────────────

const FIXTURE_DIGEST = {
  sections: [
    {
      id: "probe-deltas",
      title: "Probe Lane-Match Deltas",
      severity: "warn",
      items: [
        { lane: "operational", currentRate: 50, baselineRate: 100, delta: -50 },
      ],
    },
    {
      id: "aging-bugs",
      title: "Aging Meta-Bugs",
      severity: "warn",
      items: [
        { id: "bug-001", title: "Stale assertion", ageDays: 15, severity: "high" },
      ],
    },
    {
      id: "stalled-phases",
      title: "Stalled Phases",
      severity: "warn",
      items: [
        { name: "Phase-22", startDate: "2026-03-01", ageDays: 53 },
      ],
    },
    {
      id: "drift-trend",
      title: "Drift Trend",
      severity: "alert",
      items: [
        { score: 35, threshold: 15, trend: "degrading", timestamp: "2026-04-23T10:00:00Z", violationCount: 35 },
      ],
    },
    {
      id: "cost-anomaly",
      title: "Cost Anomaly",
      severity: "alert",
      items: [
        { latestCost: 0.5, averageCost: 0.05, multiplier: 10, plan: "plan-spike", date: "2026-04-23" },
      ],
    },
  ],
  generatedAt: "2026-04-23T12:00:00.000Z",
};

// ─── Fixture: quiet-day digest (all sections empty) ──────────────────

const QUIET_DIGEST = {
  sections: [
    { id: "probe-deltas", title: "Probe Lane-Match Deltas", severity: "info", items: [] },
    { id: "aging-bugs", title: "Aging Meta-Bugs", severity: "info", items: [] },
    { id: "stalled-phases", title: "Stalled Phases", severity: "info", items: [] },
    { id: "drift-trend", title: "Drift Trend", severity: "info", items: [] },
    { id: "cost-anomaly", title: "Cost Anomaly", severity: "info", items: [] },
  ],
  generatedAt: "2026-04-23T12:00:00.000Z",
};

// ─── Markdown tests ──────────────────────────────────────────────────

describe("renderMarkdown", () => {
  it("produces deterministic output for the same fixture", () => {
    const first = renderMarkdown(FIXTURE_DIGEST);
    const second = renderMarkdown(FIXTURE_DIGEST);
    expect(first).toBe(second);
  });

  it("contains section headings with severity badges", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("## Probe Lane-Match Deltas");
    expect(md).toContain("🟡 warn");
    expect(md).toContain("## Drift Trend");
    expect(md).toContain("🔴 alert");
  });

  it("renders probe-deltas items", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("**operational**: 50%");
    expect(md).toContain("Δ -50%");
  });

  it("renders aging-bugs items", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("**bug-001**");
    expect(md).toContain("15 days");
  });

  it("renders stalled-phases items", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("**Phase-22**");
    expect(md).toContain("stalled 53 days");
  });

  it("renders drift-trend items", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("Score **35**");
    expect(md).toContain("threshold 15");
  });

  it("renders cost-anomaly items", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("$0.5");
    expect(md).toContain("10×");
  });

  it("includes a Generated-at footer with UTC timestamp", () => {
    const md = renderMarkdown(FIXTURE_DIGEST);
    expect(md).toContain("Generated at 2026-04-23T12:00:00.000Z (UTC)");
  });

  it("renders all-green section for quiet-day digest", () => {
    const md = renderMarkdown(QUIET_DIGEST);
    expect(md).toContain("All green");
    expect(md).toContain("🟢 info");
    // No warn or alert badges
    expect(md).not.toContain("🟡 warn");
    expect(md).not.toContain("🔴 alert");
  });

  it("quiet-day digest is deterministic", () => {
    const first = renderMarkdown(QUIET_DIGEST);
    const second = renderMarkdown(QUIET_DIGEST);
    expect(first).toBe(second);
  });
});

// ─── JSON tests ──────────────────────────────────────────────────────

describe("renderJson", () => {
  it("produces deterministic output for the same fixture", () => {
    const first = renderJson(FIXTURE_DIGEST);
    const second = renderJson(FIXTURE_DIGEST);
    expect(first).toEqual(second);
  });

  it("returns correct top-level shape", () => {
    const json = renderJson(FIXTURE_DIGEST);
    expect(json).toHaveProperty("version", "1");
    expect(json).toHaveProperty("date", "2026-04-23");
    expect(json).toHaveProperty("sections");
    expect(json.sections).toHaveLength(5);
  });

  it("sections preserve id, title, severity, and items", () => {
    const json = renderJson(FIXTURE_DIGEST);
    const probeSection = json.sections.find((s) => s.id === "probe-deltas");
    expect(probeSection.title).toBe("Probe Lane-Match Deltas");
    expect(probeSection.severity).toBe("warn");
    expect(probeSection.items).toHaveLength(1);
    expect(probeSection.items[0].lane).toBe("operational");
  });

  it("quiet-day digest has version, date, and empty items", () => {
    const json = renderJson(QUIET_DIGEST);
    expect(json.version).toBe("1");
    expect(json.date).toBe("2026-04-23");
    for (const section of json.sections) {
      expect(section.items).toEqual([]);
      expect(section.severity).toBe("info");
    }
  });

  it("quiet-day JSON is deterministic", () => {
    const first = renderJson(QUIET_DIGEST);
    const second = renderJson(QUIET_DIGEST);
    expect(first).toEqual(second);
  });

  it("does not include generatedAt (unstable across runs)", () => {
    const json = renderJson(FIXTURE_DIGEST);
    expect(json).not.toHaveProperty("generatedAt");
  });
});
