/**
 * Plan Forge — Phase TEMPER-01 Slice 01.2: watcher + forge_smith + snapshot.
 *
 * Covers:
 *   - buildWatchSnapshot exposes `tempering` block (null when inactive)
 *   - detectWatchAnomalies emits tempering-coverage-below-minimum (warn)
 *   - detectWatchAnomalies emits tempering-scan-stale (warn) at ≥ 7-day cutoff
 *   - recommendFromAnomalies returns a concrete action + command for both codes
 *   - runWatch report carries the `tempering` block
 *   - Compact Tempering block is emitted on watch-snapshot-completed payloads
 *   - handleStatus summaries carry coverageMinima + coverageVsMinima
 *   - pforge smith (PowerShell + bash) contains Tempering sections
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  buildWatchSnapshot,
  detectWatchAnomalies,
  recommendFromAnomalies,
  runWatch,
} from "../orchestrator.mjs";
import { handleScan, handleStatus, ensureTemperingDirs } from "../tempering.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pforgePs1 = readFileSync(resolve(__dirname, "..", "..", "pforge.ps1"), "utf-8");
const pforgeSh = readFileSync(resolve(__dirname, "..", "..", "pforge.sh"), "utf-8");

function makeProject() {
  const dir = resolve(tmpdir(), `temper-watcher-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  // Seed a run dir so findLatestRun succeeds — buildWatchSnapshot
  // short-circuits without one.
  const runDir = resolve(dir, ".forge", "runs", "2026-01-01T00-00-00-000Z");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, "events.log"), "", "utf-8");
  return { dir, runDir };
}
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }

function seedTemperingScan(projectDir, { status = "green", belowMinimum = 0, ageDays = 0 } = {}) {
  ensureTemperingDirs(projectDir);
  const scanPath = resolve(projectDir, ".forge", "tempering", `scan-${randomUUID()}.json`);
  const coverageVsMinima = [];
  if (belowMinimum > 0) {
    coverageVsMinima.push({ layer: "domain", minimum: 90, actual: 75, gap: 15, files: [] });
  }
  writeFileSync(scanPath, JSON.stringify({
    scanId: "scan-test",
    completedAt: new Date().toISOString(),
    stack: "typescript",
    status,
    coverageVsMinima,
    coverage: { domain: { percent: 75, total: 100, hit: 75 } },
    coverageMinima: { domain: 90, integration: 80, controller: 60, overall: 80 },
  }), "utf-8");
  if (ageDays > 0) {
    const past = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    utimesSync(scanPath, past, past);
  }
}

// ─── buildWatchSnapshot.tempering ────────────────────────────────────

describe("buildWatchSnapshot — tempering block", () => {
  let project;
  beforeEach(() => { project = makeProject(); });
  afterEach(() => cleanup(project.dir));

  it("returns tempering: null when subsystem is uninitialized", async () => {
    const snap = await buildWatchSnapshot(project.dir);
    expect(snap.ok).toBe(true);
    expect(snap.tempering).toBeNull();
  });

  it("returns a populated tempering block after initialization", async () => {
    seedTemperingScan(project.dir, { status: "green" });
    const snap = await buildWatchSnapshot(project.dir);
    expect(snap.tempering).not.toBeNull();
    expect(snap.tempering.initialized).toBe(true);
    expect(snap.tempering.totalScans).toBe(1);
    expect(snap.tempering.latestStatus).toBe("green");
    expect(snap.tempering.belowMinimum).toBe(0);
  });

  it("surfaces belowMinimum count from the latest scan", async () => {
    seedTemperingScan(project.dir, { status: "amber", belowMinimum: 1 });
    const snap = await buildWatchSnapshot(project.dir);
    expect(snap.tempering.latestStatus).toBe("amber");
    expect(snap.tempering.belowMinimum).toBe(1);
  });

  it("flags stale=true when the latest scan is older than the cutoff", async () => {
    seedTemperingScan(project.dir, { status: "green", ageDays: 10 });
    const snap = await buildWatchSnapshot(project.dir);
    expect(snap.tempering.stale).toBe(true);
  });
});

// ─── detectWatchAnomalies — tempering rules ──────────────────────────

describe("detectWatchAnomalies — Tempering", () => {
  it("emits tempering-coverage-below-minimum (severity=warn) when belowMinimum > 0", () => {
    const anomalies = detectWatchAnomalies({
      ok: true,
      runState: "idle",
      counts: {},
      artifacts: [],
      tempering: { belowMinimum: 2, stale: false, latestScanAgeMs: 0, staleCutoffDays: 7 },
    });
    const a = anomalies.find((x) => x.code === "tempering-coverage-below-minimum");
    expect(a).toBeDefined();
    expect(a.severity).toBe("warn");
    expect(a.message).toMatch(/2 coverage layer\(s\)/);
  });

  it("emits tempering-scan-stale (severity=warn) when stale=true", () => {
    const anomalies = detectWatchAnomalies({
      ok: true,
      runState: "idle",
      counts: {},
      artifacts: [],
      tempering: { belowMinimum: 0, stale: true, latestScanAgeMs: 10 * 86400 * 1000, staleCutoffDays: 7 },
    });
    const a = anomalies.find((x) => x.code === "tempering-scan-stale");
    expect(a).toBeDefined();
    expect(a.severity).toBe("warn");
    expect(a.message).toMatch(/10 days old/);
  });

  it("emits no tempering anomalies when tempering is null", () => {
    const anomalies = detectWatchAnomalies({
      ok: true,
      runState: "idle",
      counts: {},
      artifacts: [],
      tempering: null,
    });
    const temperingAnomalies = anomalies.filter((x) => x.code.startsWith("tempering-"));
    expect(temperingAnomalies).toEqual([]);
  });

  it("does not emit tempering-coverage-below-minimum when belowMinimum is 0", () => {
    const anomalies = detectWatchAnomalies({
      ok: true,
      runState: "idle",
      counts: {},
      artifacts: [],
      tempering: { belowMinimum: 0, stale: false, latestScanAgeMs: 0, staleCutoffDays: 7 },
    });
    expect(anomalies.find((x) => x.code === "tempering-coverage-below-minimum")).toBeUndefined();
  });
});

// ─── recommendFromAnomalies — tempering cases ────────────────────────

describe("recommendFromAnomalies — Tempering", () => {
  it("returns a concrete action + forge_tempering_status command for below-minimum", () => {
    const snap = { tempering: { belowMinimum: 3 } };
    const recs = recommendFromAnomalies(
      [{ severity: "warn", code: "tempering-coverage-below-minimum", message: "x" }],
      snap,
    );
    const rec = recs.find((r) => r.code === "tempering-coverage-below-minimum");
    expect(rec).toBeDefined();
    expect(rec.command).toBe("forge_tempering_status");
    expect(rec.action).toMatch(/coverage layer/);
  });

  it("returns a concrete action + forge_tempering_scan command for stale", () => {
    const recs = recommendFromAnomalies(
      [{ severity: "warn", code: "tempering-scan-stale", message: "x" }],
      { tempering: { stale: true } },
    );
    const rec = recs.find((r) => r.code === "tempering-scan-stale");
    expect(rec).toBeDefined();
    expect(rec.command).toBe("forge_tempering_scan");
  });
});

// ─── runWatch report + compact hub event payload ─────────────────────

describe("runWatch — tempering propagation", () => {
  let project;
  beforeEach(() => { project = makeProject(); });
  afterEach(() => cleanup(project.dir));

  it("includes the tempering block on the report itself", async () => {
    seedTemperingScan(project.dir, { status: "amber", belowMinimum: 1 });
    const report = await runWatch({ targetPath: project.dir, mode: "snapshot", recordHistory: false });
    expect(report.ok).toBe(true);
    expect(report.tempering).not.toBeNull();
    expect(report.tempering.latestStatus).toBe("amber");
    expect(report.tempering.belowMinimum).toBe(1);
  });

  it("emits a compact Tempering block on watch-snapshot-completed", async () => {
    seedTemperingScan(project.dir, { status: "green", belowMinimum: 0 });
    const emitted = [];
    const eventBus = { emit: (type, data) => emitted.push({ type, data }) };
    await runWatch({ targetPath: project.dir, mode: "snapshot", recordHistory: false, eventBus });
    const completed = emitted.find((e) => e.type === "watch-snapshot-completed");
    expect(completed).toBeDefined();
    expect(completed.data.tempering).toMatchObject({
      totalScans: 1,
      latestStatus: "green",
      belowMinimum: 0,
      stale: false,
    });
    expect(completed.data.tempering.staleCutoffDays).toBe(7);
  });

  it("emits tempering: null when subsystem is uninitialized", async () => {
    const emitted = [];
    const eventBus = { emit: (type, data) => emitted.push({ type, data }) };
    await runWatch({ targetPath: project.dir, mode: "snapshot", recordHistory: false, eventBus });
    const completed = emitted.find((e) => e.type === "watch-snapshot-completed");
    expect(completed.data.tempering).toBeNull();
  });
});

// ─── handleStatus enrichment ─────────────────────────────────────────

describe("handleStatus — coverage-vs-minima surfacing", () => {
  let project;
  beforeEach(() => { project = makeProject(); });
  afterEach(() => cleanup(project.dir));

  it("carries coverageMinima + coverageVsMinima on each scan summary", () => {
    writeFileSync(resolve(project.dir, "package.json"), "{}", "utf-8");
    mkdirSync(resolve(project.dir, "coverage"), { recursive: true });
    writeFileSync(resolve(project.dir, "coverage", "lcov.info"),
      "SF:src/services/weak.ts\nLF:100\nLH:60\nend_of_record\n", "utf-8");
    handleScan({ projectDir: project.dir });
    const status = handleStatus({ projectDir: project.dir });
    const latest = status.scans[0];
    expect(latest).toBeDefined();
    expect(latest.coverageMinima).toMatchObject({ domain: 90 });
    expect(Array.isArray(latest.coverageVsMinima)).toBe(true);
    expect(latest.coverageVsMinima.length).toBeGreaterThan(0);
  });
});

// ─── pforge smith sections ───────────────────────────────────────────

describe("pforge smith — Tempering section", () => {
  it("PowerShell pforge.ps1 has a Tempering section with scan + stale warnings", () => {
    expect(pforgePs1).toMatch(/Tempering:/);
    expect(pforgePs1).toMatch(/forge_tempering_scan/);
    expect(pforgePs1).toMatch(/below minimum by ≥ 5 points|below min/i);
    expect(pforgePs1).toMatch(/days old/);
  });

  it("bash pforge.sh has a Tempering section with scan + stale warnings", () => {
    expect(pforgeSh).toMatch(/Tempering:/);
    expect(pforgeSh).toMatch(/forge_tempering_scan/);
    expect(pforgeSh).toMatch(/below minimum by ≥ 5 points|below min/i);
    expect(pforgeSh).toMatch(/days old/);
  });
});
