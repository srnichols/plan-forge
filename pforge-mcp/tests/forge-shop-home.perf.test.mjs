import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readHomeSnapshot } from "../orchestrator.mjs";

/**
 * Seed a comprehensive home fixture with L2-shaped records across all subsystems.
 */
function seedHomeFixture(root, { perQuadrant = 1000, hubEvents = 1000 } = {}) {
  // Crucible entries
  const crucibleDir = resolve(root, ".forge", "crucible");
  mkdirSync(crucibleDir, { recursive: true });
  for (let i = 0; i < perQuadrant; i++) {
    const status = i % 3 === 0 ? "finalized" : i % 3 === 1 ? "in_progress" : "abandoned";
    writeFileSync(resolve(crucibleDir, `smelt-${i}.json`), JSON.stringify({ status }));
  }

  // Run events
  const runDir = resolve(root, ".forge", "runs", "run_perf");
  mkdirSync(runDir, { recursive: true });
  const eventLines = [];
  for (let i = 0; i < perQuadrant; i++) {
    const ts = new Date(Date.now() - (perQuadrant - i) * 100).toISOString();
    const type = i === 0 ? "run-started" : i % 10 === 0 ? "slice-completed" : "slice-started";
    eventLines.push(`[${ts}] ${type}: ${JSON.stringify({ sliceNumber: i })}`);
  }
  writeFileSync(resolve(runDir, "events.log"), eventLines.join("\n"));

  // Drift history
  mkdirSync(resolve(root, ".forge"), { recursive: true });
  const driftLines = [];
  for (let i = 0; i < perQuadrant; i++) {
    driftLines.push(JSON.stringify({
      score: 80 + (i % 20),
      timestamp: new Date(Date.now() - (perQuadrant - i) * 1000).toISOString(),
    }));
  }
  writeFileSync(resolve(root, ".forge", "drift-history.jsonl"), driftLines.join("\n"));

  // Incidents
  const incidentLines = [];
  for (let i = 0; i < Math.min(100, perQuadrant); i++) {
    incidentLines.push(JSON.stringify({
      id: `inc-${i}`,
      resolvedAt: i % 2 === 0 ? new Date().toISOString() : null,
    }));
  }
  writeFileSync(resolve(root, ".forge", "incidents.jsonl"), incidentLines.join("\n"));

  // Fix proposals
  const fpLines = [];
  for (let i = 0; i < Math.min(50, perQuadrant); i++) {
    fpLines.push(JSON.stringify({
      id: `fp-${i}`,
      status: i % 3 === 0 ? "validated" : i % 3 === 1 ? "rejected" : "pending",
    }));
  }
  writeFileSync(resolve(root, ".forge", "fix-proposals.jsonl"), fpLines.join("\n"));

  // Tempering
  const temperDir = resolve(root, ".forge", "tempering");
  mkdirSync(resolve(temperDir, "scans"), { recursive: true });
  mkdirSync(resolve(temperDir, "runs"), { recursive: true });
  writeFileSync(resolve(temperDir, "scans", "scan-latest.json"), JSON.stringify({
    status: "pass", coverageVsMinima: [],
  }));
  writeFileSync(resolve(temperDir, "runs", "run-latest.json"), JSON.stringify({
    verdict: "pass", stack: "vitest",
    scanners: [{ scanner: "unit", verdict: "pass", pass: 100, fail: 0, durationMs: 200 }],
    completedAt: new Date().toISOString(),
  }));

  // Hub events
  const hubLines = [];
  for (let i = 0; i < hubEvents; i++) {
    hubLines.push(JSON.stringify({
      type: `event-${i}`,
      ts: new Date(Date.now() - (hubEvents - i) * 100).toISOString(),
      correlationId: `corr-${i}`,
      summary: `Summary event number ${i} with some extra text for realism`,
    }));
  }
  writeFileSync(resolve(root, ".forge", "hub-events.jsonl"), hubLines.join("\n"));
}

describe("readHomeSnapshot performance", () => {
  let perfDir;

  afterAll(() => {
    if (perfDir) rmSync(perfDir, { recursive: true, force: true });
  });

  it("completes in ≤ 250ms with 1000 L2 records across all subsystems", async () => {
    perfDir = mkdtempSync(join(tmpdir(), "pforge-home-perf-"));
    seedHomeFixture(perfDir, { perQuadrant: 1000, hubEvents: 1000 });

    const t0 = performance.now();
    const result = await readHomeSnapshot(perfDir);
    const elapsed = performance.now() - t0;

    expect(result.ok).toBe(true);
    expect(result.quadrants.crucible).not.toBeNull();
    expect(result.quadrants.activeRuns).not.toBeNull();
    expect(result.quadrants.liveguard).not.toBeNull();
    expect(result.quadrants.tempering).not.toBeNull();
    expect(result.activityFeed.length).toBe(25); // default tail
    expect(elapsed).toBeLessThan(250);
  });
});
