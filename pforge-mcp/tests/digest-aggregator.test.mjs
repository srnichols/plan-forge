/**
 * Plan Forge — Digest Aggregator Tests (Phase-38.5 Slice 1)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildDigest } from "../digest/aggregator.mjs";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── Fixture helpers ──────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-digest-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(base, relPath, data) {
  const full = resolve(base, relPath);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2), "utf-8");
}

function writeJsonl(base, relPath, entries) {
  const full = resolve(base, relPath);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, entries.map((e) => JSON.stringify(e)).join("\n"), "utf-8");
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("buildDigest", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTmpDir();
  });

  afterEach(() => {
    if (projectDir && existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  // ── Empty state ─────────────────────────────────────────────────────

  it("returns valid result with all 5 sections on a fresh repo", () => {
    const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });

    expect(result).toHaveProperty("sections");
    expect(result).toHaveProperty("generatedAt");
    expect(result.sections).toHaveLength(5);

    const ids = result.sections.map((s) => s.id);
    expect(ids).toEqual([
      "probe-deltas",
      "aging-bugs",
      "stalled-phases",
      "drift-trend",
      "cost-anomaly",
    ]);

    // All sections have empty items on a fresh repo
    for (const section of result.sections) {
      expect(section.items).toEqual([]);
      expect(section.severity).toBe("info");
      expect(section).toHaveProperty("title");
    }
  });

  // ── probe-deltas ────────────────────────────────────────────────────

  describe("probe-deltas", () => {
    it("detects lane-match regression", () => {
      const baseline = [
        { probe: { id: "p1", lane: "operational" }, classification: { lane: "operational" } },
        { probe: { id: "p2", lane: "operational" }, classification: { lane: "operational" } },
        { probe: { id: "p3", lane: "troubleshoot" }, classification: { lane: "troubleshoot" } },
      ];
      const current = [
        { probe: { id: "p1", lane: "operational" }, classification: { lane: "operational" } },
        { probe: { id: "p2", lane: "operational" }, classification: { lane: "advisory" } }, // regression
        { probe: { id: "p3", lane: "troubleshoot" }, classification: { lane: "troubleshoot" } },
      ];

      writeJson(projectDir, ".forge/validation/results-2026-04-22T00-00-00-000Z.json", baseline);
      writeJson(projectDir, ".forge/validation/results-2026-04-23T00-00-00-000Z.json", current);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "probe-deltas");

      expect(section.severity).toBe("warn");
      expect(section.items).toHaveLength(1);
      expect(section.items[0].lane).toBe("operational");
      expect(section.items[0].delta).toBeLessThan(0);
    });

    it("returns info severity when no regressions", () => {
      const probes = [
        { probe: { id: "p1", lane: "operational" }, classification: { lane: "operational" } },
      ];
      writeJson(projectDir, ".forge/validation/results-2026-04-22T00-00-00-000Z.json", probes);
      writeJson(projectDir, ".forge/validation/results-2026-04-23T00-00-00-000Z.json", probes);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "probe-deltas");

      expect(section.severity).toBe("info");
      expect(section.items).toHaveLength(0);
    });
  });

  // ── aging-bugs ──────────────────────────────────────────────────────

  describe("aging-bugs", () => {
    it("lists open bugs older than 7 days", () => {
      writeJson(projectDir, ".forge/bugs/bug-2026-04-01-001.json", {
        id: "bug-2026-04-01-001",
        status: "open",
        title: "Stale bug",
        createdAt: "2026-04-01T00:00:00Z",
        severity: "high",
      });
      // Recent bug (not aging)
      writeJson(projectDir, ".forge/bugs/bug-2026-04-20-001.json", {
        id: "bug-2026-04-20-001",
        status: "open",
        title: "Fresh bug",
        createdAt: "2026-04-20T00:00:00Z",
        severity: "low",
      });
      // Fixed bug (not open)
      writeJson(projectDir, ".forge/bugs/bug-2026-03-01-001.json", {
        id: "bug-2026-03-01-001",
        status: "fixed",
        title: "Fixed bug",
        createdAt: "2026-03-01T00:00:00Z",
      });

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "aging-bugs");

      expect(section.items).toHaveLength(1);
      expect(section.items[0].id).toBe("bug-2026-04-01-001");
      expect(section.items[0].ageDays).toBe(22);
      expect(section.severity).toBe("warn");
    });

    it("sets alert severity for bugs older than 30 days", () => {
      writeJson(projectDir, ".forge/bugs/old-bug.json", {
        id: "old-bug",
        status: "open",
        title: "Very old bug",
        createdAt: "2026-03-01T00:00:00Z",
        severity: "critical",
      });

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "aging-bugs");

      expect(section.severity).toBe("alert");
      expect(section.items[0].ageDays).toBeGreaterThanOrEqual(30);
    });
  });

  // ── stalled-phases ──────────────────────────────────────────────────

  describe("stalled-phases", () => {
    it("detects phases in-progress for > 14 days", () => {
      const roadmap = [
        "# Deployment Roadmap",
        "",
        "## Phases",
        "",
        "- Phase-22 (2026-04-01) — in-progress",
        "- Phase-23 (2026-04-20) — in-progress",
        "- Phase-24 — complete",
      ].join("\n");

      mkdirSync(resolve(projectDir, "docs", "plans"), { recursive: true });
      writeFileSync(resolve(projectDir, "docs", "plans", "DEPLOYMENT-ROADMAP.md"), roadmap);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "stalled-phases");

      expect(section.items).toHaveLength(1);
      expect(section.items[0].name).toBe("Phase-22");
      expect(section.items[0].ageDays).toBeGreaterThanOrEqual(14);
      expect(section.severity).toBe("warn");
    });

    it("falls back to ROADMAP.md when DEPLOYMENT-ROADMAP.md absent", () => {
      const roadmap = "**In flight (next)**: Phase-38.5 (2026-04-01) — in progress\n";
      writeFileSync(resolve(projectDir, "ROADMAP.md"), roadmap);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "stalled-phases");

      expect(section.items).toHaveLength(1);
      expect(section.items[0].name).toBe("Phase-38.5");
    });
  });

  // ── drift-trend ─────────────────────────────────────────────────────

  describe("drift-trend", () => {
    it("flags scores above threshold", () => {
      const entries = [
        { timestamp: "2026-04-22T10:00:00Z", score: 22, violations: new Array(22), trend: "stable" },
        { timestamp: "2026-04-23T10:00:00Z", score: 35, violations: new Array(35), trend: "degrading" },
      ];
      writeJsonl(projectDir, ".forge/drift-history.json", entries);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "drift-trend");

      expect(section.items).toHaveLength(1);
      expect(section.items[0].score).toBe(35);
      expect(section.severity).toBe("alert"); // 35 > 15*2
    });

    it("returns info when score is below threshold", () => {
      const entries = [
        { timestamp: "2026-04-23T10:00:00Z", score: 5, violations: [], trend: "stable" },
      ];
      writeJsonl(projectDir, ".forge/drift-history.json", entries);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "drift-trend");

      expect(section.items).toHaveLength(0);
      expect(section.severity).toBe("info");
    });
  });

  // ── cost-anomaly ────────────────────────────────────────────────────

  describe("cost-anomaly", () => {
    it("detects cost spike > 2× the 7-day average", () => {
      const entries = [
        { date: "2026-04-16T00:00:00Z", total_cost_usd: 0.05, plan: "plan-a" },
        { date: "2026-04-17T00:00:00Z", total_cost_usd: 0.06, plan: "plan-b" },
        { date: "2026-04-18T00:00:00Z", total_cost_usd: 0.04, plan: "plan-c" },
        { date: "2026-04-19T00:00:00Z", total_cost_usd: 0.05, plan: "plan-d" },
        { date: "2026-04-20T00:00:00Z", total_cost_usd: 0.05, plan: "plan-e" },
        { date: "2026-04-21T00:00:00Z", total_cost_usd: 0.06, plan: "plan-f" },
        { date: "2026-04-22T00:00:00Z", total_cost_usd: 0.05, plan: "plan-g" },
        // Spike: 0.50 is ~10× the average
        { date: "2026-04-23T00:00:00Z", total_cost_usd: 0.50, plan: "plan-spike" },
      ];
      writeJson(projectDir, ".forge/cost-history.json", entries);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "cost-anomaly");

      expect(section.items).toHaveLength(1);
      expect(section.items[0].multiplier).toBeGreaterThan(2);
      expect(section.severity).toBe("alert"); // 10× > 5×
    });

    it("returns info when cost is normal", () => {
      const entries = [
        { date: "2026-04-20T00:00:00Z", total_cost_usd: 0.05, plan: "plan-a" },
        { date: "2026-04-21T00:00:00Z", total_cost_usd: 0.06, plan: "plan-b" },
        { date: "2026-04-22T00:00:00Z", total_cost_usd: 0.05, plan: "plan-c" },
        { date: "2026-04-23T00:00:00Z", total_cost_usd: 0.06, plan: "plan-d" },
      ];
      writeJson(projectDir, ".forge/cost-history.json", entries);

      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "cost-anomaly");

      expect(section.items).toHaveLength(0);
      expect(section.severity).toBe("info");
    });

    it("returns info with no cost history", () => {
      const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
      const section = result.sections.find((s) => s.id === "cost-anomaly");

      expect(section.items).toHaveLength(0);
      expect(section.severity).toBe("info");
    });
  });

  // ── generatedAt ─────────────────────────────────────────────────────

  it("generatedAt is a valid ISO timestamp", () => {
    const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  // ── severity labels ─────────────────────────────────────────────────

  it("all sections use valid severity labels", () => {
    const result = buildDigest({ projectDir, date: "2026-04-23", baselineDate: "2026-04-22" });
    const validSeverities = ["info", "warn", "alert"];
    for (const section of result.sections) {
      expect(validSeverities).toContain(section.severity);
    }
  });
});
