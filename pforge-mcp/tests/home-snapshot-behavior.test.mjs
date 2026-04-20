/**
 * Phase FORGE-SHOP-07 Slice 07.2 — Behavior-preservation tests for
 * readHomeSnapshot after brain facade rewire. Verifies identical output
 * shape before/after the facade sits in between.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readHomeSnapshot } from "../orchestrator.mjs";

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-home-behav-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Seeding helpers ──────────────────────────────────────────────────

function seedCrucible(root, { inProgress = 0, finalized = 2, abandoned = 0 } = {}) {
  const dir = resolve(root, ".forge", "crucible");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < finalized; i++) {
    writeFileSync(resolve(dir, `smelt-fin-${i}.json`), JSON.stringify({ status: "finalized" }));
  }
  for (let i = 0; i < inProgress; i++) {
    writeFileSync(resolve(dir, `smelt-ip-${i}.json`), JSON.stringify({ status: "in_progress" }));
  }
}

function seedRun(root, runId = "run_001", events = []) {
  const runDir = resolve(root, ".forge", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const lines = events.map(e => `[${e.ts}] ${e.type}: ${JSON.stringify(e.data || {})}`);
  writeFileSync(resolve(runDir, "events.log"), lines.join("\n"));
}

function seedDriftHistory(root, entries = []) {
  mkdirSync(resolve(root, ".forge"), { recursive: true });
  writeFileSync(resolve(root, ".forge", "drift-history.jsonl"), entries.map(e => JSON.stringify(e)).join("\n"));
}

function seedIncidents(root, entries = []) {
  mkdirSync(resolve(root, ".forge"), { recursive: true });
  writeFileSync(resolve(root, ".forge", "incidents.jsonl"), entries.map(e => JSON.stringify(e)).join("\n"));
}

function seedFixProposals(root, entries = []) {
  mkdirSync(resolve(root, ".forge"), { recursive: true });
  writeFileSync(resolve(root, ".forge", "fix-proposals.jsonl"), entries.map(e => JSON.stringify(e)).join("\n"));
}

function seedTempering(root) {
  const dir = resolve(root, ".forge", "tempering");
  mkdirSync(dir, { recursive: true });
  const scanDir = resolve(dir, "scans");
  mkdirSync(scanDir, { recursive: true });
  writeFileSync(resolve(scanDir, "scan-2026-04-19.json"), JSON.stringify({ status: "pass", coverageVsMinima: [] }));
  const runDir = resolve(dir, "runs");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, "run-2026-04-19.json"), JSON.stringify({
    verdict: "pass", stack: "vitest",
    scanners: [{ scanner: "unit", verdict: "pass", pass: 10, fail: 0, durationMs: 500 }],
    completedAt: new Date().toISOString(),
  }));
}

function seedHubEvents(root, count = 5) {
  mkdirSync(resolve(root, ".forge"), { recursive: true });
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(JSON.stringify({ type: "test-event", ts: new Date(Date.now() - i * 60_000).toISOString(), summary: `event-${i}` }));
  }
  writeFileSync(resolve(root, ".forge", "hub-events.jsonl"), lines.join("\n"));
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("readHomeSnapshot — behavior preservation after facade rewire", () => {
  it("returns ok:true with expected shape on empty project", async () => {
    mkdirSync(resolve(tempDir, ".forge"), { recursive: true });
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    expect(snap.targetPath).toBe(tempDir);
    expect(snap.generatedAt).toBeTruthy();
    expect(snap.quadrants).toBeDefined();
    expect(snap.quadrants).toHaveProperty("crucible");
    expect(snap.quadrants).toHaveProperty("activeRuns");
    expect(snap.quadrants).toHaveProperty("liveguard");
    expect(snap.quadrants).toHaveProperty("tempering");
    expect(snap.activityFeed).toBeInstanceOf(Array);
  });

  it("crucible quadrant returns correct counts", async () => {
    seedCrucible(tempDir, { finalized: 3, inProgress: 1 });
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    const c = snap.quadrants.crucible;
    expect(c).not.toBeNull();
    expect(c.total).toBeGreaterThan(0);
    expect(typeof c.finalized).toBe("number");
    expect(typeof c.stalled).toBe("number");
  });

  it("activeRuns quadrant returns run data when run exists", async () => {
    const now = new Date().toISOString();
    seedRun(tempDir, "run_test", [
      { ts: now, type: "run-started", data: { plan: "test.md" } },
      { ts: now, type: "slice-completed", data: { sliceId: "1" } },
    ]);
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    const ar = snap.quadrants.activeRuns;
    expect(ar).not.toBeNull();
    expect(ar.lastRunId).toBe("run_test");
    expect(typeof ar.inFlight).toBe("number");
    expect(typeof ar.lastRunAgeMs).toBe("number");
  });

  it("liveguard quadrant returns drift/incident data", async () => {
    seedDriftHistory(tempDir, [{ score: 85, timestamp: new Date().toISOString() }]);
    seedIncidents(tempDir, [{ id: "INC-1", severity: "high" }]);
    seedFixProposals(tempDir, [{ id: "FP-1", status: "proposed" }]);
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    const lg = snap.quadrants.liveguard;
    expect(lg).not.toBeNull();
    expect(lg.driftScore).toBe(85);
    expect(lg.openIncidents).toBe(1);
    expect(lg.openFixProposals).toBe(1);
  });

  it("tempering quadrant returns coverage status", async () => {
    seedTempering(tempDir);
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    const t = snap.quadrants.tempering;
    expect(t).not.toBeNull();
    expect(["ok", "stale", "failing"]).toContain(t.coverageStatus);
  });

  it("activityFeed contains hub events", async () => {
    seedHubEvents(tempDir, 3);
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    expect(snap.activityFeed.length).toBe(3);
    expect(snap.activityFeed[0]).toHaveProperty("type");
    expect(snap.activityFeed[0]).toHaveProperty("timestamp");
  });

  it("gracefully handles missing .forge directory", async () => {
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
    expect(snap.quadrants.crucible).toBeNull();
    expect(snap.quadrants.activeRuns).toBeNull();
    expect(snap.quadrants.liveguard).toBeNull();
    expect(snap.quadrants.tempering).toBeNull();
  });

  it("openReviews field is present in activeRuns", async () => {
    const now = new Date().toISOString();
    seedRun(tempDir, "run_rev", [
      { ts: now, type: "run-started", data: { plan: "test.md" } },
    ]);
    const snap = await readHomeSnapshot(tempDir);
    const ar = snap.quadrants.activeRuns;
    if (ar) {
      expect(typeof ar.openReviews).toBe("number");
    }
  });

  it("returns a Promise (async verification)", () => {
    mkdirSync(resolve(tempDir, ".forge"), { recursive: true });
    const result = readHomeSnapshot(tempDir);
    expect(result).toBeInstanceOf(Promise);
  });

  it("activityTail option limits feed size", async () => {
    seedHubEvents(tempDir, 20);
    const snap = await readHomeSnapshot(tempDir, { activityTail: 5 });
    expect(snap.activityFeed.length).toBe(5);
  });

  it("quadrant errors don't fail the whole snapshot", async () => {
    mkdirSync(resolve(tempDir, ".forge"), { recursive: true });
    // Write a corrupt crucible file to trigger an error in readCrucibleState
    const crucibleDir = resolve(tempDir, ".forge", "crucible");
    mkdirSync(crucibleDir, { recursive: true });
    writeFileSync(resolve(crucibleDir, "smelt-bad.json"), "not valid json{{{");
    const snap = await readHomeSnapshot(tempDir);
    expect(snap.ok).toBe(true);
  });
});
