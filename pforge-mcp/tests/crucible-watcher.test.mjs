/**
 * Plan Forge — Phase CRUCIBLE-03 Slice 03.1
 *
 * Crucible-aware watcher snapshot + anomaly rules. Pins:
 *   - `readCrucibleState` returns null on missing directory
 *   - Counts split cleanly by status, skipping `config.json` +
 *     `phase-claims.json` (matches Smith panel from Slice 02.2)
 *   - Stale detection fires at the shared 7-day cutoff
 *   - Orphan-handoff detection reads hub-events.jsonl and only flags
 *     events whose planPath is missing
 *   - `buildWatchSnapshot(...).crucible` is always defined on the return
 *     shape (null when inactive)
 *   - `detectWatchAnomalies` emits `crucible-stalled` and
 *     `crucible-orphan-handoff` anomalies when warranted
 *   - `recommendFromAnomalies` produces a recommendation for each
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  readCrucibleState,
  buildWatchSnapshot,
  detectWatchAnomalies,
  recommendFromAnomalies,
  CRUCIBLE_STALL_CUTOFF_DAYS,
} from "../orchestrator.mjs";

let tempDir;

function makeTempDir() {
  const dir = resolve(tmpdir(), `pforge-crucible-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSmelt(root, id, data) {
  const dir = resolve(root, ".forge", "crucible");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

function agePath(path, daysOld) {
  const t = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  utimesSync(path, t, t);
}

function writeHubEvent(root, event) {
  const dir = resolve(root, ".forge");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, "hub-events.jsonl");
  writeFileSync(path, JSON.stringify(event) + "\n", { flag: "a" });
}

beforeEach(() => { tempDir = makeTempDir(); });
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

// ─── readCrucibleState ─────────────────────────────────────────────

describe("readCrucibleState (Slice 03.1)", () => {
  it("returns null when .forge/crucible/ does not exist", () => {
    expect(readCrucibleState(tempDir)).toBeNull();
  });

  it("shares the 7-day stall cutoff with pforge smith", () => {
    expect(CRUCIBLE_STALL_CUTOFF_DAYS).toBe(7);
  });

  it("returns an empty-but-defined block when the directory exists but has no smelts", () => {
    mkdirSync(resolve(tempDir, ".forge", "crucible"), { recursive: true });
    const state = readCrucibleState(tempDir);
    expect(state).not.toBeNull();
    expect(state.counts.total).toBe(0);
    expect(state.staleInProgress).toBe(0);
    expect(state.oldestInProgressAgeMs).toBeNull();
    expect(state.orphanHandoffs).toEqual([]);
  });

  it("counts smelts by status and skips config.json + phase-claims.json", () => {
    writeSmelt(tempDir, "s1", { id: "s1", status: "finalized" });
    writeSmelt(tempDir, "s2", { id: "s2", status: "in_progress" });
    writeSmelt(tempDir, "s3", { id: "s3", status: "abandoned" });
    writeSmelt(tempDir, "s4", { id: "s4", status: "finalized" });
    // Non-smelt files that must NOT be counted
    writeSmelt(tempDir, "config", { version: 1 });
    writeSmelt(tempDir, "phase-claims", { claims: [] });

    const state = readCrucibleState(tempDir);
    expect(state.counts.total).toBe(4);
    expect(state.counts.finalized).toBe(2);
    expect(state.counts.in_progress).toBe(1);
    expect(state.counts.abandoned).toBe(1);
  });

  it("flags in_progress smelts older than the cutoff as stale", () => {
    const fresh = writeSmelt(tempDir, "fresh", { id: "fresh", status: "in_progress" });
    const stale = writeSmelt(tempDir, "stale", { id: "stale", status: "in_progress" });
    agePath(stale, CRUCIBLE_STALL_CUTOFF_DAYS + 2);

    const state = readCrucibleState(tempDir);
    expect(state.counts.in_progress).toBe(2);
    expect(state.staleInProgress).toBe(1);
    // Oldest mtime wins when computing the age metric
    expect(state.oldestInProgressAgeMs).toBeGreaterThan(
      CRUCIBLE_STALL_CUTOFF_DAYS * 24 * 60 * 60 * 1000,
    );
    // sanity — keep the fresh one off the stale counter
    expect(fresh).toMatch(/fresh\.json$/);
  });

  it("does not blow up on corrupt smelt JSON — counts as 'other'", () => {
    mkdirSync(resolve(tempDir, ".forge", "crucible"), { recursive: true });
    writeFileSync(resolve(tempDir, ".forge", "crucible", "broken.json"), "{ not json");
    const state = readCrucibleState(tempDir);
    expect(state.counts.total).toBe(1);
    expect(state.counts.other).toBe(1);
  });

  it("detects orphan handoffs: planPath from hub event missing on disk", () => {
    mkdirSync(resolve(tempDir, ".forge", "crucible"), { recursive: true });
    writeHubEvent(tempDir, {
      ts: new Date().toISOString(),
      type: "crucible-handoff-to-hardener",
      data: { id: "abc-123", phaseName: "Phase Ghost", planPath: "docs/plans/Phase-Ghost.md" },
    });
    // Unrelated event should be ignored
    writeHubEvent(tempDir, { ts: new Date().toISOString(), type: "run-started", data: {} });

    const state = readCrucibleState(tempDir);
    expect(state.orphanHandoffs).toHaveLength(1);
    expect(state.orphanHandoffs[0].crucibleId).toBe("abc-123");
    expect(state.orphanHandoffs[0].phaseName).toBe("Phase Ghost");
  });

  it("does not flag a handoff when the plan file actually exists", () => {
    mkdirSync(resolve(tempDir, ".forge", "crucible"), { recursive: true });
    const planDir = resolve(tempDir, "docs", "plans");
    mkdirSync(planDir, { recursive: true });
    writeFileSync(resolve(planDir, "Phase-Real.md"), "---\ncrucibleId: real-1\n---\n# Phase Real");
    writeHubEvent(tempDir, {
      ts: new Date().toISOString(),
      type: "crucible-handoff-to-hardener",
      data: { id: "real-1", phaseName: "Phase Real", planPath: "docs/plans/Phase-Real.md" },
    });

    const state = readCrucibleState(tempDir);
    expect(state.orphanHandoffs).toHaveLength(0);
  });
});

// ─── buildWatchSnapshot integration ─────────────────────────────────

describe("buildWatchSnapshot.crucible (Slice 03.1)", () => {
  it("always emits a `crucible` field on the snapshot shape — null when inactive", () => {
    // Minimum viable target: one run dir so buildWatchSnapshot returns ok
    const runsDir = resolve(tempDir, ".forge", "runs", "run-1");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(resolve(runsDir, "events.jsonl"), "");

    const snap = buildWatchSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    expect("crucible" in snap).toBe(true);
    expect(snap.crucible).toBeNull();
  });

  it("hydrates `crucible` when the directory exists", () => {
    const runsDir = resolve(tempDir, ".forge", "runs", "run-1");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(resolve(runsDir, "events.jsonl"), "");
    writeSmelt(tempDir, "s1", { id: "s1", status: "finalized" });

    const snap = buildWatchSnapshot(tempDir);
    expect(snap.crucible).not.toBeNull();
    expect(snap.crucible.counts.finalized).toBe(1);
  });
});

// ─── anomaly + recommendation wiring ────────────────────────────────

describe("detectWatchAnomalies — Crucible rules (Slice 03.1)", () => {
  it("emits `crucible-stalled` when a smelt has been idle ≥ cutoff", () => {
    const stale = writeSmelt(tempDir, "stale", { id: "stale", status: "in_progress" });
    agePath(stale, CRUCIBLE_STALL_CUTOFF_DAYS + 3);
    const runsDir = resolve(tempDir, ".forge", "runs", "run-1");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(resolve(runsDir, "events.jsonl"), "");

    const snap = buildWatchSnapshot(tempDir);
    const anoms = detectWatchAnomalies(snap);
    const stalled = anoms.find((a) => a.code === "crucible-stalled");
    expect(stalled).toBeDefined();
    expect(stalled.severity).toBe("warn");
    expect(stalled.message).toMatch(/idle ≥ 7 days/);
  });

  it("does NOT emit `crucible-stalled` when all smelts are fresh", () => {
    writeSmelt(tempDir, "fresh", { id: "fresh", status: "in_progress" });
    const runsDir = resolve(tempDir, ".forge", "runs", "run-1");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(resolve(runsDir, "events.jsonl"), "");

    const snap = buildWatchSnapshot(tempDir);
    const anoms = detectWatchAnomalies(snap);
    expect(anoms.find((a) => a.code === "crucible-stalled")).toBeUndefined();
  });

  it("emits `crucible-orphan-handoff` when planPath is missing", () => {
    mkdirSync(resolve(tempDir, ".forge", "crucible"), { recursive: true });
    writeHubEvent(tempDir, {
      ts: new Date().toISOString(),
      type: "crucible-handoff-to-hardener",
      data: { id: "abc-123", phaseName: "Phase Ghost", planPath: "docs/plans/Phase-Ghost.md" },
    });
    const runsDir = resolve(tempDir, ".forge", "runs", "run-1");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(resolve(runsDir, "events.jsonl"), "");

    const snap = buildWatchSnapshot(tempDir);
    const anoms = detectWatchAnomalies(snap);
    const orphan = anoms.find((a) => a.code === "crucible-orphan-handoff");
    expect(orphan).toBeDefined();
    expect(orphan.severity).toBe("error");
  });

  it("produces a recommendation for each new Crucible anomaly code", () => {
    const snap = {
      ok: true,
      crucible: {
        counts: { total: 1, in_progress: 1, finalized: 0, abandoned: 0, other: 0 },
        staleInProgress: 1,
        oldestInProgressAgeMs: 10 * 24 * 60 * 60 * 1000,
        stallCutoffDays: CRUCIBLE_STALL_CUTOFF_DAYS,
        orphanHandoffs: [{ crucibleId: "abc", phaseName: "Phase X", planPath: "p.md", ts: null }],
      },
    };
    const anoms = [
      { severity: "warn", code: "crucible-stalled", message: "..." },
      { severity: "error", code: "crucible-orphan-handoff", message: "..." },
    ];
    const recs = recommendFromAnomalies(anoms, snap);
    const stalledRec = recs.find((r) => r.code === "crucible-stalled");
    const orphanRec = recs.find((r) => r.code === "crucible-orphan-handoff");
    expect(stalledRec).toBeDefined();
    expect(stalledRec.command).toBe("forge_crucible_list");
    expect(orphanRec).toBeDefined();
    // Command should reference the crucibleId so the operator can pull up the smelt
    expect(orphanRec.command).toContain("abc");
  });
});
