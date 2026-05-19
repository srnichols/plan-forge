/**
 * Plan Forge — Phase-39 (AUDITOR-AUTOMATION) Slice 1
 * auditor-auto-invoke.test.mjs
 *
 * Tests for the post-run auditor auto-invoke hook:
 *   hooks.postRun.invokeAuditor.onFailure
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
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  existsSync,
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
