/**
 * Tests for the run-plan end-of-plan audit activation hook (Phase-39 Slice 7).
 *
 * Validates:
 *   - Hook fires when mode is "always" and plan passed
 *   - Hook fires when mode is "auto" and threshold signals trip
 *   - Hook does NOT fire when mode is "off"
 *   - Hook does NOT fire when plan failed
 *   - Hook does NOT fire when in estimate/dry-run mode
 *   - drain-auto-estimate event emitted before dispatch
 *   - Production guard blocks even when mode is "always"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  loadAuditConfig,
  shouldAutoDrain,
  AUDIT_DEFAULTS,
} from "../tempering/auto-activate.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `run-plan-audit-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeForgeJson(dir, content) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

/**
 * Simulates the end-of-plan hook logic from orchestrator.mjs.
 * Returns { dispatched, event, drainResult } to validate behavior.
 */
function simulateEndOfPlanHook({
  cwd,
  allPassed = true,
  estimate = false,
  dryRun = false,
  env = "dev",
  filesChanged = 0,
  lastDrainTs = 0,
  lastVerdict = null,
  recentFindingCount = 0,
  drainFn = null,
} = {}) {
  const events = [];
  const hub = {
    broadcast: (evt) => events.push(evt),
  };

  if (!allPassed || estimate || dryRun) {
    return { dispatched: false, events, drainResult: null, reason: "skipped" };
  }

  const auditConfig = loadAuditConfig(cwd);
  const evaluation = shouldAutoDrain({
    cwd,
    config: auditConfig,
    filesChanged,
    lastDrainTs,
    lastVerdict,
    recentFindingCount,
    env,
  });

  if (!evaluation.fire) {
    return { dispatched: false, events, drainResult: null, reason: "no-fire", signals: evaluation.signals };
  }

  // Emit drain-auto-estimate event before dispatch
  hub.broadcast({
    type: "drain-auto-estimate",
    data: { mode: auditConfig.mode, maxRounds: auditConfig.maxRounds, signals: evaluation.signals },
    timestamp: new Date().toISOString(),
  });

  // Dispatch the drain
  const drainResult = drainFn
    ? drainFn({ project: cwd, maxRounds: auditConfig.maxRounds, hub })
    : { rounds: [], terminated: "mock", summary: {} };

  return { dispatched: true, events, drainResult, signals: evaluation.signals };
}

describe("end-of-plan audit activation hook", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("does NOT fire when mode is 'off'", () => {
    writeForgeJson(dir, { audit: { mode: "off" } });
    const result = simulateEndOfPlanHook({ cwd: dir });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("no-fire");
  });

  it("fires when mode is 'always' and plan passed", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateEndOfPlanHook({ cwd: dir, allPassed: true, env: "dev" });
    expect(result.dispatched).toBe(true);
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0].type).toBe("drain-auto-estimate");
  });

  it("does NOT fire when plan failed", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateEndOfPlanHook({ cwd: dir, allPassed: false });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("skipped");
  });

  it("does NOT fire in estimate mode", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateEndOfPlanHook({ cwd: dir, estimate: true });
    expect(result.dispatched).toBe(false);
  });

  it("does NOT fire in dry-run mode", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateEndOfPlanHook({ cwd: dir, dryRun: true });
    expect(result.dispatched).toBe(false);
  });

  it("fires in auto mode when threshold signals trip", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    const result = simulateEndOfPlanHook({
      cwd: dir,
      allPassed: true,
      env: "dev",
      filesChanged: 20,
      lastDrainTs: 0,
      lastVerdict: "max-rounds",
      recentFindingCount: 5,
    });
    expect(result.dispatched).toBe(true);
  });

  it("does NOT fire in auto mode when no signals trip", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    const result = simulateEndOfPlanHook({
      cwd: dir,
      allPassed: true,
      env: "dev",
      filesChanged: 1,
      lastDrainTs: Date.now(),
      lastVerdict: "converged",
      recentFindingCount: 0,
    });
    expect(result.dispatched).toBe(false);
  });

  it("blocks production even in 'always' mode", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateEndOfPlanHook({ cwd: dir, env: "production" });
    expect(result.dispatched).toBe(false);
    expect(result.signals.blocked).toBe(true);
  });

  it("emits drain-auto-estimate event with correct shape", () => {
    writeForgeJson(dir, { audit: { mode: "always", maxRounds: 3 } });
    const result = simulateEndOfPlanHook({ cwd: dir, env: "dev" });
    expect(result.dispatched).toBe(true);
    const evt = result.events[0];
    expect(evt.type).toBe("drain-auto-estimate");
    expect(evt.data.mode).toBe("always");
    expect(evt.data.maxRounds).toBe(3);
    expect(evt.timestamp).toBeTruthy();
  });

  it("invokes drain function when dispatched", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    let drainCalled = false;
    const result = simulateEndOfPlanHook({
      cwd: dir,
      env: "dev",
      drainFn: (opts) => {
        drainCalled = true;
        expect(opts.project).toBe(dir);
        return { rounds: [{ round: 1 }], terminated: "converged", summary: {} };
      },
    });
    expect(result.dispatched).toBe(true);
    expect(drainCalled).toBe(true);
    expect(result.drainResult.terminated).toBe("converged");
  });
});
