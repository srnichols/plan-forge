/**
 * Tests for A7 — `--objective` mode on `forge_tempering_run`
 * (Phase-WORKER-GUARDRAILS Slice 7)
 *
 * Coverage:
 *  - no objective → existing behaviour preserved (no objective field in result)
 *  - greater: accepts when post-run metric > baseline
 *  - greater: rejects when post-run metric < baseline
 *  - greater: rejects when post-run metric === baseline (not strictly greater)
 *  - less: accepts when post-run metric < baseline
 *  - less: rejects when post-run metric > baseline
 *  - non-numeric stdout at baseline → fails fast, scanners never run
 *  - non-zero exit at baseline → fails fast, scanners never run
 *  - non-numeric stdout at post → blocked verdict
 *  - non-zero exit at post → blocked verdict
 *  - baseline captured BEFORE scanners run (ordering verified via call log)
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runTemperingRun } from "../tempering/runner.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeProject() {
  const dir = resolve(tmpdir(), `obj-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "package.json"), '{"name":"t"}', "utf-8");
  return dir;
}

/**
 * Build a spawn fake that always skips (exits 0, empty stdout) for normal
 * test-runner calls, plus a separate `objectiveSpawn` that emits the
 * supplied sequence of values on successive calls.
 *
 * `values` is an array of `{ stdout, exitCode }` consumed in call order.
 */
function makeObjectiveSpawn(values) {
  const calls = [];
  let idx = 0;
  const spawn = (bin, args, _opts) => {
    const callEntry = { bin, args, callIndex: calls.length };
    calls.push(callEntry);
    const entry = values[idx++] || { stdout: "", exitCode: 0 };
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setTimeout(() => {
      if (entry.stdout) proc.stdout.emit("data", Buffer.from(entry.stdout));
      proc.emit("close", entry.exitCode ?? 0, null);
    }, 1);
    return proc;
  };
  spawn.calls = calls;
  return spawn;
}

/** Spawn that returns empty/0 (simulates a disabled scanner). */
function makeNoopSpawn() {
  const spawn = (_bin, _args, _opts) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setTimeout(() => proc.emit("close", 0, null), 1);
    return proc;
  };
  return spawn;
}

/** Minimal adapter that marks all scanners as disabled. */
const disabledAdapter = Object.fromEntries(
  ["unit", "integration"].map((s) => [
    s,
    { supported: false, reason: "test-stub" },
  ])
);

/** A dummy no-op implementation for all the optional DI scanner slots. */
const noop = async () => ({
  scanner: "stub",
  skipped: true,
  verdict: "skipped",
  pass: 0,
  fail: 0,
  durationMs: 0,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
});

const NOOP_DI = {
  uiScannerImpl: noop,
  contractScannerImpl: noop,
  visualDiffScannerImpl: noop,
  flakinessScannerImpl: noop,
  perfBudgetScannerImpl: noop,
  loadStressScannerImpl: noop,
  mutationScannerImpl: noop,
  contentAuditScannerImpl: noop,
  classifyFn: async () => ({ classification: "real-bug", rule: null }),
  registerBugFn: async () => ({ ok: false }),
};

// ─── Tests ────────────────────────────────────────────────────────────

describe("runTemperingRun — no objective (existing behaviour)", () => {
  it("returns ok without an objective field when no objective is provided", async () => {
    const dir = makeProject();
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      ...NOOP_DI,
    });
    expect(result.ok).toBe(true);
    expect(result.objective).toBeUndefined();
  });
});

describe("runTemperingRun — objective: acceptIf=greater", () => {
  it("accepts when post-run metric is greater than baseline", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "80\n", exitCode: 0 },  // baseline
      { stdout: "85\n", exitCode: 0 },  // post-run
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js", acceptIf: "greater" },
      ...NOOP_DI,
    });
    expect(result.ok).toBe(true);
    expect(result.objective).toBeDefined();
    expect(result.objective.accepted).toBe(true);
    expect(result.objective.blocked).toBe(false);
    expect(result.objective.acceptIf).toBe("greater");
    expect(result.objective.reason).toBe("objective-met");
    expect(result.verdict).not.toBe("fail");
  });

  it("rejects (blocks) when post-run metric is less than baseline", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "90\n", exitCode: 0 },  // baseline
      { stdout: "85\n", exitCode: 0 },  // post-run (worse)
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js", acceptIf: "greater" },
      ...NOOP_DI,
    });
    expect(result.ok).toBe(true);
    expect(result.objective.accepted).toBe(false);
    expect(result.objective.blocked).toBe(true);
    expect(result.objective.reason).toBe("objective-not-met");
    expect(result.verdict).toBe("fail");
  });

  it("rejects when post-run metric equals baseline (not strictly greater)", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "75\n", exitCode: 0 },
      { stdout: "75\n", exitCode: 0 },
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js" },  // default acceptIf = greater
      ...NOOP_DI,
    });
    expect(result.objective.accepted).toBe(false);
    expect(result.verdict).toBe("fail");
  });
});

describe("runTemperingRun — objective: acceptIf=less", () => {
  it("accepts when post-run metric is less than baseline", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "500\n", exitCode: 0 },  // baseline (e.g., bundle size KB)
      { stdout: "480\n", exitCode: 0 },  // post-run (smaller = better)
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node bundle-size.js", acceptIf: "less" },
      ...NOOP_DI,
    });
    expect(result.ok).toBe(true);
    expect(result.objective.accepted).toBe(true);
    expect(result.objective.blocked).toBe(false);
    expect(result.objective.acceptIf).toBe("less");
  });

  it("rejects when post-run metric is greater than baseline", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "500\n", exitCode: 0 },
      { stdout: "520\n", exitCode: 0 },  // larger = worse
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node bundle-size.js", acceptIf: "less" },
      ...NOOP_DI,
    });
    expect(result.objective.accepted).toBe(false);
    expect(result.verdict).toBe("fail");
  });
});

describe("runTemperingRun — objective: non-numeric stdout fails fast", () => {
  it("returns ok=false before running scanners when baseline stdout is non-numeric", async () => {
    const dir = makeProject();
    let scannersCalled = false;
    const objSpawn = makeObjectiveSpawn([
      { stdout: "not-a-number\n", exitCode: 0 },
    ]);
    const trackingUiImpl = async () => { scannersCalled = true; return noop(); };
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js" },
      ...NOOP_DI,
      uiScannerImpl: trackingUiImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("objective-baseline-non-numeric");
    expect(result.objective.blocked).toBe(true);
    expect(scannersCalled).toBe(false);
  });
});

describe("runTemperingRun — objective: non-zero exit fails fast", () => {
  it("returns ok=false before running scanners when baseline command exits non-zero", async () => {
    const dir = makeProject();
    let scannersCalled = false;
    const objSpawn = makeObjectiveSpawn([
      { stdout: "", exitCode: 1 },
    ]);
    const trackingUiImpl = async () => { scannersCalled = true; return noop(); };
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js" },
      ...NOOP_DI,
      uiScannerImpl: trackingUiImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("objective-baseline-failed");
    expect(result.objective.blocked).toBe(true);
    expect(scannersCalled).toBe(false);
  });

  it("blocks (ok=true, objective.blocked=true) when post-run command exits non-zero", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "80\n", exitCode: 0 },   // baseline OK
      { stdout: "", exitCode: 1 },        // post-run fails
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js" },
      ...NOOP_DI,
    });
    expect(result.ok).toBe(true);  // run completed but objective blocked
    expect(result.objective.blocked).toBe(true);
    expect(result.objective.reason).toBe("objective-post-non-zero-exit");
    expect(result.verdict).toBe("fail");
  });

  it("blocks when post-run stdout is non-numeric", async () => {
    const dir = makeProject();
    const objSpawn = makeObjectiveSpawn([
      { stdout: "80\n", exitCode: 0 },
      { stdout: "error: cannot read file\n", exitCode: 0 },
    ]);
    const result = await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: objSpawn,
      objective: { command: "node measure.js" },
      ...NOOP_DI,
    });
    expect(result.ok).toBe(true);
    expect(result.objective.blocked).toBe(true);
    expect(result.objective.reason).toBe("objective-post-non-numeric");
    expect(result.verdict).toBe("fail");
  });
});

describe("runTemperingRun — objective: baseline captured before scanners", () => {
  it("records the first objective spawn call before any scanner activity", async () => {
    const dir = makeProject();
    const callOrder = [];

    const objSpawn = makeObjectiveSpawn([
      { stdout: "70\n", exitCode: 0 },
      { stdout: "75\n", exitCode: 0 },
    ]);
    // Wrap objSpawn to record ordering
    const trackingObjSpawn = (bin, args, opts) => {
      callOrder.push("objective");
      return objSpawn(bin, args, opts);
    };

    const trackingUi = async (ctx) => {
      callOrder.push("scanner");
      return {
        scanner: "ui-playwright",
        skipped: true,
        verdict: "skipped",
        pass: 0, fail: 0, durationMs: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
    };

    await runTemperingRun({
      projectDir: dir,
      adapter: disabledAdapter,
      spawn: makeNoopSpawn(),
      objectiveSpawn: trackingObjSpawn,
      objective: { command: "node measure.js", acceptIf: "greater" },
      ...NOOP_DI,
      uiScannerImpl: trackingUi,
    });

    // First call must be "objective" (baseline), not "scanner"
    expect(callOrder[0]).toBe("objective");
    // Second call is "scanner" (or another objective) — baseline precedes scanners
    const firstScannerIdx = callOrder.indexOf("scanner");
    const firstObjIdx = callOrder.indexOf("objective");
    expect(firstObjIdx).toBeLessThan(firstScannerIdx);
  });
});
