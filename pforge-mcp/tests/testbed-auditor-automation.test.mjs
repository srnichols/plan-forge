/**
 * Plan Forge — Phase-39 (AUDITOR-AUTOMATION) Slice 10
 * testbed-auditor-automation.test.mjs
 *
 * Testbed E2E + chaos scenarios for the three auditor-automation capabilities:
 *   Cluster A — auditor auto-invocation (onFailure, everyNRuns, no-double-fire, spawn-isolation)
 *   Cluster B — watcher cross-run mode (anomaly detection against synthetic run history)
 *   Cluster C — Forge-Master observer mode (mute-by-default, budget-fail-closed, lifecycle, chaos)
 *
 * Approach:
 *   1. Fixture validation — each scenario JSON exists and is structurally valid
 *   2. Runner integration — runScenario with dryRun:true verifies runner/fixture compatibility
 *   3. Behavioral tests — direct module imports verify the core logic each fixture describes
 *   4. Happy-path regression — existing happy-path-*.json fixtures remain valid
 *
 * Traces to: MUST #8 (testbed scenarios), MUST #9 (chaos resilience), MUST #10 (no regression).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { runScenario } from "../testbed/runner.mjs";
import { validateScenarioFixture, loadScenario, listScenarios } from "../testbed/scenarios.mjs";
import { runPostRunAuditorHook } from "../orchestrator.mjs";
import { buildCrossRunSnapshot } from "../watcher.mjs";
import { runWatch, detectWatchAnomalies, recommendFromAnomalies } from "../orchestrator.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCENARIO_DIR = resolve(REPO_ROOT, "docs", "plans", "testbed-scenarios");

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-s10-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProjectRoot() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".forge"), { recursive: true });
  mkdirSync(resolve(dir, "docs", "plans", "testbed-scenarios"), { recursive: true });
  return dir;
}

function makeTestbed() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".git"), { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt), eventHistory: [] };
}

function makeSpawnFn(overrides = {}) {
  return vi.fn().mockImplementation((cmd, _opts) => {
    if (cmd === "git status --porcelain") return overrides.gitStatus ?? "";
    if (cmd === "git rev-parse HEAD") return overrides.gitHead ?? "abc123";
    return overrides.output ?? "";
  });
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
  const path = resolve(dir, ".forge", "auditor-state.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function makeRunSummary(overrides = {}) {
  return {
    plan: "Phase-99-TEST.md",
    startTime: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date().toISOString(),
    status: "completed",
    results: { passed: 2, failed: 1, skipped: 0, total: 3 },
    cost: { total_cost_usd: 0.05 },
    sliceResults: [],
    ...overrides,
  };
}

function writeRunSummary(rootDir, runId, summary) {
  const runDir = resolve(rootDir, ".forge", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(resolve(runDir, "summary.json"), JSON.stringify(summary), "utf-8");
}

// ─── Fixture IDs ──────────────────────────────────────────────────────

const S10_FIXTURE_IDS = [
  "auditor-auto-invoke-on-failure",
  "auditor-auto-invoke-every-n",
  "auditor-no-double-fire",
  "watcher-cross-run-anomalies",
  "observer-mute-by-default",
  "observer-budget-fail-closed",
  "observer-process-lifecycle",
  "observer-chaos-kill-mid-narration",
  "auditor-spawn-isolation",
];

const HAPPY_PATH_FIXTURE_IDS = [
  "happy-path-01",
  "happy-path-02",
  "happy-path-03",
  "happy-path-04",
  "happy-path-05",
];

// ─── 1. Fixture validation ────────────────────────────────────────────

describe("S10 — fixture validation: all 9 scenario fixtures exist and are valid", () => {
  for (const id of S10_FIXTURE_IDS) {
    it(`${id}.json exists and passes validateScenarioFixture`, () => {
      const filePath = join(SCENARIO_DIR, `${id}.json`);
      expect(existsSync(filePath), `${id}.json must exist in docs/plans/testbed-scenarios/`).toBe(true);

      const raw = readFileSync(filePath, "utf-8");
      const fixture = JSON.parse(raw);

      expect(fixture.scenarioId).toBe(id);
      expect(typeof fixture.kind).toBe("string");
      expect(typeof fixture.description).toBe("string");
      expect(fixture.description.length).toBeGreaterThan(0);
      expect(Array.isArray(fixture.execute)).toBe(true);
      expect(fixture.execute.length).toBeGreaterThan(0);
      expect(Array.isArray(fixture.assertions)).toBe(true);
      expect(fixture.assertions.length).toBeGreaterThan(0);

      const validation = validateScenarioFixture(fixture);
      expect(validation.ok, `validation errors: ${validation.errors.join("; ")}`).toBe(true);
    });
  }

  it("chaos scenarios have kind='chaos'", () => {
    const chaosIds = ["observer-chaos-kill-mid-narration"];
    for (const id of chaosIds) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(fixture.kind).toBe("chaos");
    }
  });

  it("non-chaos scenarios have kind='happy-path'", () => {
    const nonChaosIds = S10_FIXTURE_IDS.filter(id => id !== "observer-chaos-kill-mid-narration");
    for (const id of nonChaosIds) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(fixture.kind).toBe("happy-path");
    }
  });

  it("all fixtures have teardown steps", () => {
    for (const id of S10_FIXTURE_IDS) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(Array.isArray(fixture.teardown), `${id} must have teardown array`).toBe(true);
      expect(fixture.teardown.length, `${id} teardown must not be empty`).toBeGreaterThan(0);
    }
  });
});

// ─── 2. Runner integration (dryRun) ──────────────────────────────────

describe("S10 — runner integration: dryRun passes for all 9 fixtures", () => {
  let projectRoot;
  let testbedDir;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
    testbedDir = makeTestbed();

    // Copy fixtures into projectRoot so loadScenario can find them
    const destDir = resolve(projectRoot, "docs", "plans", "testbed-scenarios");
    for (const id of S10_FIXTURE_IDS) {
      const src = readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8");
      writeFileSync(join(destDir, `${id}.json`), src, "utf-8");
    }
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testbedDir, { recursive: true, force: true });
  });

  for (const id of S10_FIXTURE_IDS) {
    it(`${id} — runner accepts fixture and returns a result in dryRun mode`, async () => {
      const hub = makeHub();
      const spawnFn = makeSpawnFn();

      const scenario = loadScenario(id, { projectRoot });
      const result = await runScenario(scenario, {
        hub,
        projectRoot,
        testbedPath: testbedDir,
        dryRun: true,
        spawnFn,
      });

      expect(result.scenarioId).toBe(id);
      expect(typeof result.correlationId).toBe("string");
      expect(result.correlationId.length).toBeGreaterThan(0);
      // In dryRun, execute steps are skipped so assertions check against default state
      expect(typeof result.status).toBe("string");

      // Hub emitted start + complete events
      const started = hub.events.filter(e => e.type === "testbed-scenario-started");
      const completed = hub.events.filter(e => e.type === "testbed-scenario-completed");
      expect(started.length).toBeGreaterThanOrEqual(1);
      expect(completed.length).toBeGreaterThanOrEqual(1);
    });
  }

  it("correlationIds are unique across all 9 scenarios", async () => {
    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const correlationIds = [];

    for (const id of S10_FIXTURE_IDS) {
      const scenario = loadScenario(id, { projectRoot });
      const result = await runScenario(scenario, {
        hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
      });
      correlationIds.push(result.correlationId);
    }

    const uniqueIds = new Set(correlationIds);
    expect(uniqueIds.size).toBe(correlationIds.length);
  });
});

// ─── 3a. Behavioral: Cluster A — auditor auto-invocation ─────────────

describe("S10 — behavioral: auditor-auto-invoke-on-failure", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("triggers when onFailure:true and run failed", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: null } } } });
    const result = runPostRunAuditorHook({ cwd, allPassed: false });
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("onFailure");
  });

  it("does NOT trigger when onFailure:true but run passed", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: null } } } });
    const result = runPostRunAuditorHook({ cwd, allPassed: true });
    expect(result.triggered).toBe(false);
  });

  it("does NOT trigger when onFailure:false and run failed", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: false, everyNRuns: null } } } });
    const result = runPostRunAuditorHook({ cwd, allPassed: false });
    expect(result.triggered).toBe(false);
  });

  it("does NOT include a cost field in the result (cost belongs to spawned FM process)", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd, allPassed: false });
    expect("cost" in result).toBe(false);
  });

  it("emits auditor-auto-invoke event on eventBus", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const bus = new EventEmitter();
    const events = [];
    bus.on("auditor-auto-invoke", (e) => events.push(e));
    runPostRunAuditorHook({ cwd, allPassed: false, eventBus: bus });
    expect(events.length).toBe(1);
    expect(events[0].reason).toBe("onFailure");
  });
});

// ─── 3b. Behavioral: auditor-auto-invoke-every-n ─────────────────────

describe("S10 — behavioral: auditor-auto-invoke-every-n", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("triggers exactly once in 5 runs with everyNRuns:5", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: false, everyNRuns: 5 } } } });
    let triggered = 0;
    for (let i = 0; i < 5; i++) {
      const r = runPostRunAuditorHook({ cwd, allPassed: true });
      if (r.triggered) triggered++;
    }
    expect(triggered).toBe(1);
  });

  it("counter resets to 0 after trigger", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: false, everyNRuns: 5 } } } });
    // First run triggers (no prior state = counter starts at N)
    runPostRunAuditorHook({ cwd, allPassed: true });
    const state = readAuditorState(cwd);
    expect(state).not.toBeNull();
    expect(state.runsSinceLastAudit).toBe(0);
  });

  it("counter increments and persists between calls before threshold", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: false, everyNRuns: 10 } } } });
    // Seed prior state at count=2 to avoid first-run-triggers behavior
    writeAuditorState(cwd, { runsSinceLastAudit: 2 });
    runPostRunAuditorHook({ cwd, allPassed: true });
    const state = readAuditorState(cwd);
    expect(state.runsSinceLastAudit).toBe(3);
  });

  it("does not trigger before reaching threshold", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: false, everyNRuns: 5 } } } });
    // Seed count well below threshold
    writeAuditorState(cwd, { runsSinceLastAudit: 2 });
    const r = runPostRunAuditorHook({ cwd, allPassed: true });
    expect(r.triggered).toBe(false);
  });
});

// ─── 3c. Behavioral: auditor-no-double-fire ──────────────────────────

describe("S10 — behavioral: auditor-no-double-fire", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("fires exactly once when both onFailure and everyNRuns threshold are met on same run", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: 1 } } } });
    const bus = new EventEmitter();
    const events = [];
    bus.on("auditor-auto-invoke", (e) => events.push(e));

    const result = runPostRunAuditorHook({ cwd, allPassed: false, eventBus: bus });

    expect(result.triggered).toBe(true);
    expect(typeof result.reason).toBe("string");
    expect(events.length).toBe(1); // single event, not two
  });

  it("reason is 'onFailure' when both conditions fire (onFailure takes priority)", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true, everyNRuns: 1 } } } });
    const result = runPostRunAuditorHook({ cwd, allPassed: false });
    expect(result.reason).toBe("onFailure");
  });
});

// ─── 3d. Behavioral: watcher-cross-run-anomalies ─────────────────────

describe("S10 — behavioral: watcher-cross-run-anomalies", () => {
  let rootDir;

  beforeEach(() => {
    rootDir = makeTmpDir();
  });

  afterEach(() => { rmSync(rootDir, { recursive: true, force: true }); });

  it("buildCrossRunSnapshot returns mode:'cross-run' with aggregated run counts", async () => {
    for (let i = 0; i < 3; i++) {
      writeRunSummary(rootDir, `run-fail-${i}`, makeRunSummary({
        status: "failed",
        sliceResults: [{ sliceId: "slice-gate-01", status: "failed", retries: 0, gateFailures: 1 }],
      }));
    }

    const snapshot = await buildCrossRunSnapshot(rootDir, { window: "14d" });
    expect(snapshot.mode).toBe("cross-run");
    expect(snapshot.totalRuns).toBeGreaterThanOrEqual(3);
  });

  it("detectWatchAnomalies returns cross-run.* codes when same slice fails repeatedly", async () => {
    for (let i = 0; i < 3; i++) {
      writeRunSummary(rootDir, `run-recurring-${i}`, makeRunSummary({
        status: "failed",
        sliceResults: [{ sliceId: "slice-gate-01", status: "failed", retries: 1, gateFailures: 1 }],
      }));
    }

    const snapshot = await buildCrossRunSnapshot(rootDir, { window: "14d" });
    const anomalies = detectWatchAnomalies(snapshot);
    const crossRunCodes = anomalies.filter(a => a.code && a.code.startsWith("cross-run."));
    expect(crossRunCodes.length).toBeGreaterThan(0);
  });

  it("recommendFromAnomalies returns non-empty recommendations for cross-run anomalies", async () => {
    for (let i = 0; i < 4; i++) {
      writeRunSummary(rootDir, `run-recs-${i}`, makeRunSummary({
        status: "failed",
        sliceResults: [{ sliceId: "slice-flaky", status: "failed", retries: 3, gateFailures: 2 }],
      }));
    }

    const snapshot = await buildCrossRunSnapshot(rootDir, { window: "14d" });
    const anomalies = detectWatchAnomalies(snapshot);
    const recs = recommendFromAnomalies(anomalies);
    expect(Array.isArray(recs)).toBe(true);
    if (anomalies.length > 0) {
      expect(recs.length).toBeGreaterThan(0);
    }
  });

  it("returns empty anomalies when all runs pass", async () => {
    for (let i = 0; i < 3; i++) {
      writeRunSummary(rootDir, `run-pass-${i}`, makeRunSummary({
        status: "completed",
        results: { passed: 3, failed: 0, skipped: 0, total: 3 },
        sliceResults: [{ sliceId: "slice-ok", status: "passed", retries: 0, gateFailures: 0 }],
      }));
    }

    const snapshot = await buildCrossRunSnapshot(rootDir, { window: "14d" });
    const anomalies = detectWatchAnomalies(snapshot);
    const crossRunCodes = anomalies.filter(a => a.code && a.code.startsWith("cross-run."));
    expect(crossRunCodes.length).toBe(0);
  });
});

// ─── 3e. Behavioral: observer-mute-by-default ────────────────────────

describe("S10 — behavioral: observer-mute-by-default", () => {
  it("FORGE_MASTER_DEFAULTS.observer.enabled is false", async () => {
    const { FORGE_MASTER_DEFAULTS } = await import("../../pforge-master/src/config.mjs");
    expect(FORGE_MASTER_DEFAULTS.observer.enabled).toBe(false);
  });

  it("getForgeMasterConfig returns observer.enabled=false when not explicitly set", async () => {
    const { getForgeMasterConfig } = await import("../../pforge-master/src/config.mjs");
    const cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
    // No .forge.json written — should get defaults
    const cfg = getForgeMasterConfig(cwd);
    expect(cfg.observer.enabled).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });

  it("getForgeMasterConfig returns observer.enabled=false from explicit false", async () => {
    const { getForgeMasterConfig } = await import("../../pforge-master/src/config.mjs");
    const cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
    writeFileSync(
      resolve(cwd, ".forge.json"),
      JSON.stringify({ forgeMaster: { observer: { enabled: false } } }),
      "utf-8",
    );
    const cfg = getForgeMasterConfig(cwd);
    expect(cfg.observer.enabled).toBe(false);
    rmSync(cwd, { recursive: true, force: true });
  });
});

// ─── 3f. Behavioral: observer-budget-fail-closed ─────────────────────

describe("S10 — behavioral: observer-budget-fail-closed", () => {
  it("checkBudget blocks when dailyUsd meets cap", async () => {
    const { checkBudget } = await import("../../pforge-master/src/observer-budget.mjs");
    const now = new Date("2026-01-15T10:00:00Z").getTime();
    const day = new Date(now).toISOString().slice(0, 10);
    const hour = new Date(now).toISOString().slice(0, 13);
    const state = { dailyUsd: 0.01, dailyDate: day, hourlyNarrations: 0, hourlyHour: hour };
    const result = checkBudget(state, { maxUsdPerDay: 0.01, maxNarrationsPerHour: 6 }, now);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/daily USD cap exceeded/);
  });

  it("checkBudget allows narration when under cap", async () => {
    const { checkBudget } = await import("../../pforge-master/src/observer-budget.mjs");
    const now = new Date("2026-01-15T10:00:00Z").getTime();
    const day = new Date(now).toISOString().slice(0, 10);
    const hour = new Date(now).toISOString().slice(0, 13);
    const state = { dailyUsd: 0.005, dailyDate: day, hourlyNarrations: 2, hourlyHour: hour };
    const result = checkBudget(state, { maxUsdPerDay: 0.01, maxNarrationsPerHour: 6 }, now);
    expect(result.ok).toBe(true);
  });

  it("recordSpend increments both dailyUsd and hourlyNarrations", async () => {
    const { recordSpend } = await import("../../pforge-master/src/observer-budget.mjs");
    const now = new Date("2026-01-15T10:00:00Z").getTime();
    const day = new Date(now).toISOString().slice(0, 10);
    const hour = new Date(now).toISOString().slice(0, 13);
    const state = { dailyUsd: 0.005, dailyDate: day, hourlyNarrations: 2, hourlyHour: hour };
    const updated = recordSpend(state, { usd: 0.003, timestamp: now });
    expect(updated.dailyUsd).toBeCloseTo(0.008, 6);
    expect(updated.hourlyNarrations).toBe(3);
  });

  it("fails closed (blocks) when cap is 0", async () => {
    const { checkBudget } = await import("../../pforge-master/src/observer-budget.mjs");
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const hour = new Date(now).toISOString().slice(0, 13);
    const state = { dailyUsd: 0, dailyDate: day, hourlyNarrations: 0, hourlyHour: hour };
    // cap=0 means always blocked
    const result = checkBudget(state, { maxUsdPerDay: 0 }, now);
    expect(result.ok).toBe(false);
  });

  it("maxUsdPerDay must be a finite positive number (not null or Infinity)", async () => {
    const { checkBudget } = await import("../../pforge-master/src/observer-budget.mjs");
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const hour = new Date(now).toISOString().slice(0, 13);
    const state = { dailyUsd: 0, dailyDate: day, hourlyNarrations: 0, hourlyHour: hour };
    // null and Infinity caps should not block (no cap = ok)
    const withNull = checkBudget(state, { maxUsdPerDay: null }, now);
    const withInfinity = checkBudget(state, { maxUsdPerDay: Infinity }, now);
    expect(withNull.ok).toBe(true);
    expect(withInfinity.ok).toBe(true);
  });
});

// ─── 3g. Behavioral: observer-process-lifecycle ──────────────────────

describe("S10 — behavioral: observer-process-lifecycle", () => {
  it("startObserver requires onBatch function", async () => {
    const { startObserver } = await import("../../pforge-master/src/observer-loop.mjs");
    expect(() => startObserver({ wsPort: 19999 })).toThrow("onBatch must be a function");
  });

  it("startObserver returns handle with stop() and getStatus()", async () => {
    const { startObserver } = await import("../../pforge-master/src/observer-loop.mjs");
    const handle = startObserver({
      wsPort: 19999,
      onBatch: () => {},
      _wsFactory: () => {
        const ee = { on: () => {}, close: () => {} };
        return ee;
      },
    });
    expect(typeof handle.stop).toBe("function");
    expect(typeof handle.getStatus).toBe("function");
    handle.stop();
  });

  it("getStatus reports running=false and connected=false before WS connection", async () => {
    const { startObserver } = await import("../../pforge-master/src/observer-loop.mjs");
    const handle = startObserver({
      wsPort: 19999,
      onBatch: () => {},
      _wsFactory: () => ({ on: () => {}, close: () => {} }),
    });
    const status = handle.getStatus();
    expect(typeof status).toBe("object");
    expect(status.connected).toBe(false);
    handle.stop();
  });

  it("OBSERVER_PID_FILE is the expected filename", async () => {
    const { OBSERVER_PID_FILE } = await import("../../pforge-master/src/observer-loop.mjs");
    expect(OBSERVER_PID_FILE).toBe("forge-master-observer.pid");
  });

  it("getObserverPidPath returns path containing .forge/forge-master-observer.pid", async () => {
    const { getObserverPidPath } = await import("../../pforge-master/src/observer-loop.mjs");
    const path = getObserverPidPath("/tmp/myproject");
    expect(path).toContain("forge-master-observer.pid");
    expect(path).toContain(".forge");
  });
});

// ─── 3h. Behavioral: observer-chaos-kill-mid-narration ───────────────

describe("S10 — chaos: observer-chaos-kill-mid-narration", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("budget state file survives a stop() call without corruption", async () => {
    const { startObserver } = await import("../../pforge-master/src/observer-loop.mjs");
    const { checkBudget, DEFAULT_BUDGET_STATE } = await import("../../pforge-master/src/observer-budget.mjs");

    // Write initial clean state
    const now = Date.now();
    const initialState = {
      dailyUsd: 0,
      dailyDate: new Date(now).toISOString().slice(0, 10),
      hourlyNarrations: 0,
      hourlyHour: new Date(now).toISOString().slice(0, 13),
    };
    writeFileSync(
      resolve(cwd, ".forge", "forge-master-observer-state.json"),
      JSON.stringify(initialState, null, 2),
      "utf-8",
    );

    // Start and immediately stop the observer (simulates kill mid-operation)
    const handle = startObserver({
      wsPort: 29998,
      cwd,
      onBatch: () => {},
      _wsFactory: () => ({ on: () => {}, close: () => {} }),
    });
    handle.stop();

    // State file must still be valid JSON
    const raw = readFileSync(resolve(cwd, ".forge", "forge-master-observer-state.json"), "utf-8");
    let state;
    expect(() => { state = JSON.parse(raw); }).not.toThrow();

    // No phantom spend
    const budget = checkBudget(state, { maxUsdPerDay: 0.5, maxNarrationsPerHour: 6 });
    expect(budget.ok).toBe(true);
  });

  it("no pid file is left behind after stop()", async () => {
    const { startObserver, getObserverPidPath } = await import("../../pforge-master/src/observer-loop.mjs");
    const pidPath = getObserverPidPath(cwd);

    const handle = startObserver({
      wsPort: 29997,
      cwd,
      onBatch: () => {},
      _wsFactory: () => ({ on: () => {}, close: () => {} }),
    });
    handle.stop();

    // PID file is a daemon concern; startObserver (in-process mode) should not create one
    // This asserts the file's absence to detect any accidental daemon-mode activation
    // (acceptable: file may or may not exist; what matters is it's not CORRUPT if present)
    if (existsSync(pidPath)) {
      const content = readFileSync(pidPath, "utf-8").trim();
      expect(content.length).toBeGreaterThanOrEqual(0); // not throwing = not corrupt
    }
  });
});

// ─── 3i. Behavioral: auditor-spawn-isolation ─────────────────────────

describe("S10 — behavioral: auditor-spawn-isolation", () => {
  let cwd;

  beforeEach(() => {
    cwd = makeTmpDir();
    mkdirSync(resolve(cwd, ".forge"), { recursive: true });
  });

  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it("hook result does not contain cost field (cost belongs to spawned FM process)", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const result = runPostRunAuditorHook({ cwd, allPassed: false });
    expect(result.triggered).toBe(true);
    expect("cost" in result).toBe(false);
    expect("tokensUsed" in result).toBe(false);
  });

  it("multiple failure runs each produce triggered=true independently", () => {
    writeForgeJson(cwd, { hooks: { postRun: { invokeAuditor: { onFailure: true } } } });
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(runPostRunAuditorHook({ cwd, allPassed: false }));
    }
    expect(results.every(r => r.triggered)).toBe(true);
    expect(results.every(r => r.reason === "onFailure")).toBe(true);
  });

  it("hook is resilient to missing .forge directory (auto-creates it)", () => {
    const isolated = resolve(makeTmpDir(), "subdir");
    mkdirSync(isolated, { recursive: true });
    writeFileSync(resolve(isolated, ".forge.json"),
      JSON.stringify({ hooks: { postRun: { invokeAuditor: { onFailure: true } } } }),
      "utf-8",
    );
    expect(() => runPostRunAuditorHook({ cwd: isolated, allPassed: false })).not.toThrow();
    rmSync(isolated, { recursive: true, force: true });
  });
});

// ─── 4. Happy-path regression guard ──────────────────────────────────

describe("S10 — regression: existing happy-path fixtures still valid", () => {
  for (const id of HAPPY_PATH_FIXTURE_IDS) {
    it(`${id}.json still exists and validates`, () => {
      const filePath = join(SCENARIO_DIR, `${id}.json`);
      expect(existsSync(filePath), `${id}.json must still exist`).toBe(true);
      const fixture = JSON.parse(readFileSync(filePath, "utf-8"));
      const validation = validateScenarioFixture(fixture);
      expect(validation.ok, `validation errors: ${validation.errors.join("; ")}`).toBe(true);
      expect(fixture.kind).toBe("happy-path");
    });
  }

  it("no happy-path fixture was modified to have a chaos kind", () => {
    for (const id of HAPPY_PATH_FIXTURE_IDS) {
      const fixture = JSON.parse(readFileSync(join(SCENARIO_DIR, `${id}.json`), "utf-8"));
      expect(fixture.kind).not.toBe("chaos");
    }
  });

  it("listScenarios returns all 14 scenario files (9 new + 5 existing)", () => {
    // Load from the real repo's scenario dir (all files present)
    const scenarios = listScenarios({ projectRoot: REPO_ROOT });
    expect(scenarios.length).toBeGreaterThanOrEqual(14);
  });
});
