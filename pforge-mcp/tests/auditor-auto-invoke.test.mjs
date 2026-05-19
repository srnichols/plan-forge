/**
 * Plan Forge — Phase-39 (AUDITOR-AUTOMATION) Slice 1 + Slice 2
 * auditor-auto-invoke.test.mjs
 *
 * Tests for the post-run auditor auto-invoke hook:
 *   hooks.postRun.invokeAuditor.onFailure   (Slice 1)
 *   hooks.postRun.invokeAuditor.everyNRuns  (Slice 2)
 *
 * Validates:
 *   - onFailure: hook fires when plan fails and onFailure:true is configured
 *   - onFailure: hook does NOT fire when plan passes and onFailure:true is configured
 *   - onFailure: hook does NOT fire when plan fails and onFailure is absent
 *   - onFailure: hook does NOT fire when plan fails and onFailure:false is configured
 *   - onFailure: summary._auditor is populated with correct shape on trigger
 *   - onFailure: event emitted via eventBus when triggered
 *   - onFailure: event is NOT emitted when not triggered
 *   - onFailure: config defaults applied when .forge.json has no invokeAuditor block
 *   - onFailure: hook is resilient to malformed .forge.json (uses defaults)
 *   - everyNRuns: fires on first run when no prior state (counter starts at N)
 *   - everyNRuns: reason is 'everyNRuns' when triggered by counter
 *   - everyNRuns: does NOT fire before reaching threshold
 *   - everyNRuns: counter resets to 0 after firing
 *   - everyNRuns: counter increments and persists between calls
 *   - everyNRuns: state file written to .forge/auditor-state.json
 *   - everyNRuns: triggers once when both onFailure and everyNRuns would fire
 *   - everyNRuns: event emitted with reason 'everyNRuns' when triggered by counter
 *   - everyNRuns: resilient to malformed state file
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { runPostRunAuditorHook } from "../orchestrator.mjs";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-auditor-invoke-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeForgeJson(dir, content) {
  writeFileSync(resolve(dir, ".forge.json"), JSON.stringify(content, null, 2), "utf-8");
}

function writeAuditorState(dir, state) {
  const forgeDir = resolve(dir, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(resolve(forgeDir, "auditor-state.json"), JSON.stringify(state, null, 2), "utf-8");
}

function readAuditorState(dir) {
  return JSON.parse(readFileSync(resolve(dir, ".forge", "auditor-state.json"), "utf-8"));
}

// ─── onFailure: core trigger behaviour ───────────────────────────────────────

describe("runPostRunAuditorHook — onFailure trigger behaviour", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("onFailure: fires when plan failed and onFailure:true is configured", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(true);
  });

  it("onFailure: reason is 'onFailure' when triggered by a failed run", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.reason).toBe("onFailure");
  });

  it("onFailure: does NOT fire when plan passed even if onFailure:true is set", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(false);
  });

  it("onFailure: does NOT fire when onFailure is absent from config", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: {} } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(false);
  });

  it("onFailure: does NOT fire when onFailure is explicitly false", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: false } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(false);
  });

  it("onFailure: does NOT fire when hooks.postRun block is entirely absent", () => {
    writeForgeJson(dir, { maxParallelism: 3 });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(false);
  });
});

// ─── onFailure: summary shape ─────────────────────────────────────────────────

describe("runPostRunAuditorHook — onFailure summary shape", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("onFailure: result has triggered, reason, config, timestamp fields when fired", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result).toHaveProperty("triggered");
    expect(result).toHaveProperty("reason");
    expect(result).toHaveProperty("config");
    expect(result).toHaveProperty("timestamp");
  });

  it("onFailure: timestamp is a valid ISO string", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it("onFailure: config echoes back the invokeAuditor config", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: 5 } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.config.onFailure).toBe(true);
    expect(result.config.everyNRuns).toBe(5);
  });

  it("onFailure: result only has triggered:false when not fired", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: false } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

// ─── onFailure: event emission ────────────────────────────────────────────────

describe("runPostRunAuditorHook — onFailure event emission", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("onFailure: emits 'auditor-auto-invoke' on eventBus when triggered", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on("auditor-auto-invoke", (e) => events.push(e));
    runPostRunAuditorHook({ cwd: dir, allPassed: false, eventBus });
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("onFailure");
  });

  it("onFailure: does NOT emit 'auditor-auto-invoke' when plan passed", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on("auditor-auto-invoke", (e) => events.push(e));
    runPostRunAuditorHook({ cwd: dir, allPassed: true, eventBus });
    expect(events).toHaveLength(0);
  });

  it("onFailure: works without an eventBus (eventBus=null)", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    expect(() => runPostRunAuditorHook({ cwd: dir, allPassed: false, eventBus: null })).not.toThrow();
  });
});

// ─── onFailure: resilience ────────────────────────────────────────────────────

describe("runPostRunAuditorHook — onFailure resilience", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("onFailure: returns triggered:false when .forge.json is missing", () => {
    // No .forge.json written — defaults apply
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(false);
  });

  it("onFailure: returns triggered:false when .forge.json is malformed JSON", () => {
    writeFileSync(resolve(dir, ".forge.json"), "{ not valid json }", "utf-8");
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(false);
  });

  it("onFailure: does not throw when cwd does not exist", () => {
    const nonExistent = resolve(tmpdir(), `no-such-dir-${randomUUID()}`);
    expect(() => runPostRunAuditorHook({ cwd: nonExistent, allPassed: false })).not.toThrow();
  });
});

// ─── everyNRuns: core trigger behaviour ──────────────────────────────────────

describe("runPostRunAuditorHook — everyNRuns trigger behaviour", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("everyNRuns: fires on first run when no prior state exists", () => {
    // No auditor-state.json → counter starts at everyNRuns → first run triggers
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(true);
  });

  it("everyNRuns: reason is 'everyNRuns' when triggered by counter", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.reason).toBe("everyNRuns");
  });

  it("everyNRuns: does NOT fire before reaching threshold", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    // Simulate 1 previous run (counter reset to 0 after first-run trigger)
    writeAuditorState(dir, { runsSinceLastAudit: 1 });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(false);
  });

  it("everyNRuns: fires when counter reaches threshold", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    // Counter at 4 → this run increments to 5 → fire
    writeAuditorState(dir, { runsSinceLastAudit: 4 });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("everyNRuns");
  });

  it("everyNRuns: does NOT fire when everyNRuns is null", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: null } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(false);
  });

  it("everyNRuns: does NOT fire when everyNRuns is absent from config", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: false } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(false);
  });
});

// ─── everyNRuns: counter persistence ─────────────────────────────────────────

describe("runPostRunAuditorHook — everyNRuns counter persistence", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("everyNRuns: counter resets to 0 in auditor-state.json after firing", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 3 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 2 });
    runPostRunAuditorHook({ cwd: dir, allPassed: true });
    const state = readAuditorState(dir);
    expect(state.runsSinceLastAudit).toBe(0);
  });

  it("everyNRuns: counter increments when not at threshold", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 1 });
    runPostRunAuditorHook({ cwd: dir, allPassed: true });
    const state = readAuditorState(dir);
    expect(state.runsSinceLastAudit).toBe(2);
  });

  it("everyNRuns: state file is created at .forge/auditor-state.json", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    // No prior state — first run triggers and resets to 0
    runPostRunAuditorHook({ cwd: dir, allPassed: true });
    const statePath = resolve(dir, ".forge", "auditor-state.json");
    expect(existsSync(statePath)).toBe(true);
    const state = readAuditorState(dir);
    expect(typeof state.runsSinceLastAudit).toBe("number");
  });

  it("everyNRuns: counter resets to 0 on first-run trigger then increments normally", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 3 } } } });
    // First run (no state) → triggers → resets to 0
    runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(readAuditorState(dir).runsSinceLastAudit).toBe(0);
    // Second run → counter = 1 (no trigger)
    runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(readAuditorState(dir).runsSinceLastAudit).toBe(1);
    // Third run → counter = 2 (no trigger yet)
    runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(readAuditorState(dir).runsSinceLastAudit).toBe(2);
    // Fourth run → counter = 3 >= 3 → triggers, reset to 0
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(true);
    expect(readAuditorState(dir).runsSinceLastAudit).toBe(0);
  });
});

// ─── everyNRuns: combined with onFailure ─────────────────────────────────────

describe("runPostRunAuditorHook — everyNRuns combined with onFailure", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("everyNRuns: triggers once (not twice) when both onFailure and everyNRuns fire", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: 3 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 2 }); // counter will hit 3 → fire
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false }); // also fails
    expect(result.triggered).toBe(true);
    // Must be a single result, not doubled
    expect(typeof result.reason).toBe("string");
  });

  it("everyNRuns: counter resets when both conditions fire on same run", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: 3 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 2 });
    runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(readAuditorState(dir).runsSinceLastAudit).toBe(0);
  });

  it("everyNRuns: onFailure fires even when everyNRuns counter has not reached threshold", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: 5 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 1 }); // counter at 2 after run, below 5
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: false });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("onFailure");
  });
});

// ─── everyNRuns: event emission ───────────────────────────────────────────────

describe("runPostRunAuditorHook — everyNRuns event emission", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("everyNRuns: emits 'auditor-auto-invoke' with reason everyNRuns when triggered", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 3 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 2 });
    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on("auditor-auto-invoke", (e) => events.push(e));
    runPostRunAuditorHook({ cwd: dir, allPassed: true, eventBus });
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe("everyNRuns");
  });

  it("everyNRuns: does NOT emit when counter has not reached threshold", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 5 } } } });
    writeAuditorState(dir, { runsSinceLastAudit: 1 });
    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on("auditor-auto-invoke", (e) => events.push(e));
    runPostRunAuditorHook({ cwd: dir, allPassed: true, eventBus });
    expect(events).toHaveLength(0);
  });
});

// ─── everyNRuns: resilience ───────────────────────────────────────────────────

describe("runPostRunAuditorHook — everyNRuns resilience", () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("everyNRuns: does not throw when auditor-state.json is malformed JSON", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 3 } } } });
    const forgeDir = resolve(dir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "auditor-state.json"), "{ not valid json }", "utf-8");
    // Malformed state → falls back to default (first-run trigger)
    expect(() => runPostRunAuditorHook({ cwd: dir, allPassed: true })).not.toThrow();
  });

  it("everyNRuns: triggers on first run even when auditor-state.json is malformed", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 3 } } } });
    const forgeDir = resolve(dir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "auditor-state.json"), "{ not valid json }", "utf-8");
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(true);
  });

  it("everyNRuns: does not throw when everyNRuns is 0 (edge case: treated as disabled)", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 0 } } } });
    expect(() => runPostRunAuditorHook({ cwd: dir, allPassed: true })).not.toThrow();
  });

  it("everyNRuns: does not fire when everyNRuns is 0", () => {
    writeForgeJson(dir, { hooks: { postRun: { invokeAuditor: { everyNRuns: 0 } } } });
    const result = runPostRunAuditorHook({ cwd: dir, allPassed: true });
    expect(result.triggered).toBe(false);
  });
});
