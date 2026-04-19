/**
 * Plan Forge — Phase CRUCIBLE-03 Slice 03.2
 * Watcher-tab Crucible row (dashboard polish).
 *
 * Contracts pinned:
 *   1. orchestrator's watch-snapshot-completed event carries a compact
 *      `crucible` block (primitives only, no nested arrays) OR null when
 *      the watched project has no `.forge/crucible/` directory.
 *   2. dashboard app.js renderWatcherPanel renders a `watcher-crucible-row`
 *      block only when `latest.crucible` is truthy — hides cleanly for
 *      pre-Crucible projects.
 *   3. Row includes all six funnel metrics: total, finalized, in_progress,
 *      abandoned, staleInProgress, orphanHandoffs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runWatch } from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tempDir;
function makeTempDir() {
  const dir = resolve(tmpdir(), `pforge-watcher-row-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
beforeEach(() => { tempDir = makeTempDir(); });
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

// ─── orchestrator event shape ───────────────────────────────────────

describe("watch-snapshot-completed event — Crucible payload (Slice 03.2)", () => {
  function makeRun() {
    const runsDir = resolve(tempDir, ".forge", "runs", "run-1");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(resolve(runsDir, "events.jsonl"), "");
  }
  function writeSmelt(id, data) {
    const dir = resolve(tempDir, ".forge", "crucible");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${id}.json`), JSON.stringify(data));
  }

  it("emits a compact `crucible` block alongside the snapshot event", async () => {
    makeRun();
    writeSmelt("s1", { id: "s1", status: "finalized" });
    writeSmelt("s2", { id: "s2", status: "in_progress" });

    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    await runWatch({ targetPath: tempDir, eventBus, recordHistory: false });

    const snap = events.find((e) => e.type === "watch-snapshot-completed");
    expect(snap).toBeDefined();
    expect(snap.data.crucible).toBeDefined();
    expect(snap.data.crucible.total).toBe(2);
    expect(snap.data.crucible.finalized).toBe(1);
    expect(snap.data.crucible.in_progress).toBe(1);
    expect(snap.data.crucible.staleInProgress).toBe(0);
    expect(snap.data.crucible.orphanHandoffs).toBe(0);
    expect(snap.data.crucible.stallCutoffDays).toBe(7);
  });

  it("emits null `crucible` when .forge/crucible/ is absent", async () => {
    makeRun();
    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    await runWatch({ targetPath: tempDir, eventBus, recordHistory: false });

    const snap = events.find((e) => e.type === "watch-snapshot-completed");
    expect(snap).toBeDefined();
    expect(snap.data.crucible).toBeNull();
  });

  it("flattens orphanHandoffs to a count (not an array) — keeps WS payload small", async () => {
    makeRun();
    writeSmelt("s1", { id: "s1", status: "finalized" });
    // No plan file on disk → this handoff is an orphan
    const hubPath = resolve(tempDir, ".forge", "hub-events.jsonl");
    writeFileSync(hubPath, JSON.stringify({
      ts: new Date().toISOString(),
      type: "crucible-handoff-to-hardener",
      data: { id: "s1", phaseName: "Phase X", planPath: "docs/plans/Phase-X.md" },
    }) + "\n");

    const events = [];
    const eventBus = { emit: (type, data) => events.push({ type, data }) };
    await runWatch({ targetPath: tempDir, eventBus, recordHistory: false });

    const snap = events.find((e) => e.type === "watch-snapshot-completed");
    expect(typeof snap.data.crucible.orphanHandoffs).toBe("number");
    expect(snap.data.crucible.orphanHandoffs).toBe(1);
  });
});

// ─── dashboard render contract ──────────────────────────────────────

describe("Dashboard Watcher tab — Crucible row (Slice 03.2)", () => {
  const js = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

  it("renderWatcherPanel guards the Crucible row behind `latest.crucible`", () => {
    // Only render the row when the watcher payload actually carried one —
    // projects without a Crucible funnel should still show a clean snapshot.
    expect(js).toMatch(/if \(latest\.crucible\)/);
  });

  it("row includes all six funnel metrics", () => {
    expect(js).toContain("c.total");
    expect(js).toContain("c.finalized");
    expect(js).toContain("c.in_progress");
    expect(js).toContain("c.abandoned");
    expect(js).toContain("c.staleInProgress");
    expect(js).toContain("c.orphanHandoffs");
  });

  it("row uses stable identifier for downstream automation / E2E tests", () => {
    expect(js).toContain('data-testid="watcher-crucible-row"');
  });

  it("stall + orphan badges use amber/red when counts > 0", () => {
    // Threshold-based color — zero is gray, any non-zero warns.
    expect(js).toMatch(/staleInProgress > 0.*text-amber-400/s);
    expect(js).toMatch(/orphanHandoffs > 0.*text-red-400/s);
  });
});
