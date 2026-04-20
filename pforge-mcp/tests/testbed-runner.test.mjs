import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runScenario, preflight, acquireLock, releaseLock, ASSERTION_HANDLERS } from "../testbed/runner.mjs";
import { validateScenarioFixture, SCENARIO_KINDS, ASSERTION_KINDS, loadScenario, listScenarios, resolveTestbedPath } from "../testbed/scenarios.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-runner-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt), eventHistory: [] };
}

function makeTestbed() {
  const dir = makeTmpDir();
  // Create a minimal .git-like structure so existsSync checks pass
  mkdirSync(resolve(dir, ".git"), { recursive: true });
  return dir;
}

function makeProjectRoot() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".forge"), { recursive: true });
  mkdirSync(resolve(dir, "docs", "plans", "testbed-findings"), { recursive: true });
  mkdirSync(resolve(dir, "docs", "plans", "testbed-scenarios"), { recursive: true });
  return dir;
}

function makeScenario(overrides = {}) {
  return {
    scenarioId: overrides.scenarioId || "test-scenario",
    kind: "happy-path",
    description: "Test scenario",
    setup: [],
    execute: [{ cmd: "echo hello" }],
    assertions: overrides.assertions || [{ kind: "exit-code", expected: 0 }],
    teardown: [],
    ...overrides,
  };
}

// Mock spawnFn that always succeeds
function makeSpawnFn(overrides = {}) {
  return vi.fn().mockImplementation((cmd, opts) => {
    if (cmd === "git status --porcelain") return overrides.gitStatus ?? "";
    if (cmd === "git rev-parse HEAD") return overrides.gitHead ?? "abc123";
    return overrides.output ?? "";
  });
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("testbed/runner — preflight", () => {
  it("rejects missing testbed path", () => {
    expect(() => preflight("Z:\\definitely\\nonexistent\\path\\abc123", null, null))
      .toThrow(/not found/i);
  });

  it("rejects dirty working tree", () => {
    const tb = makeTestbed();
    try {
      const spawnFn = makeSpawnFn({ gitStatus: " M dirty-file.js\n" });
      expect(() => preflight(tb, null, spawnFn)).toThrow(/dirty/i);
    } finally {
      rmSync(tb, { recursive: true, force: true });
    }
  });

  it("rejects HEAD mismatch", () => {
    const tb = makeTestbed();
    try {
      const spawnFn = makeSpawnFn({ gitHead: "actual-head-sha" });
      expect(() => preflight(tb, "expected-head-sha", spawnFn)).toThrow(/mismatch/i);
    } finally {
      rmSync(tb, { recursive: true, force: true });
    }
  });

  it("passes clean preflight", () => {
    const tb = makeTestbed();
    try {
      const spawnFn = makeSpawnFn();
      const result = preflight(tb, null, spawnFn);
      expect(result.ok).toBe(true);
    } finally {
      rmSync(tb, { recursive: true, force: true });
    }
  });
});

describe("testbed/runner — lock", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("acquires and releases lock", () => {
    acquireLock(projectRoot, null);
    const lockFile = resolve(projectRoot, ".forge", "testbed.lock");
    expect(existsSync(lockFile)).toBe(true);
    releaseLock(projectRoot);
    expect(existsSync(lockFile)).toBe(false);
  });

  it("rejects second acquisition", () => {
    acquireLock(projectRoot, null);
    expect(() => acquireLock(projectRoot, null)).toThrow(/locked/i);
    releaseLock(projectRoot);
  });

  it("reclaims stale lock older than 1 hour", () => {
    const lockFile = resolve(projectRoot, ".forge", "testbed.lock");
    const staleTs = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    writeFileSync(lockFile, JSON.stringify({ pid: 99999, ts: staleTs }), "utf-8");
    const hub = makeHub();
    acquireLock(projectRoot, hub);
    expect(hub.events.some(e => e.type === "testbed-lock-reclaimed")).toBe(true);
    releaseLock(projectRoot);
  });
});

describe("testbed/runner — assertion handlers", () => {
  let tb;

  beforeEach(() => {
    tb = makeTestbed();
  });

  afterEach(() => {
    rmSync(tb, { recursive: true, force: true });
  });

  // file-exists
  it("file-exists passes when file present", () => {
    writeFileSync(resolve(tb, "test.txt"), "content");
    const r = ASSERTION_HANDLERS["file-exists"]({ path: "test.txt" }, { testbedPath: tb });
    expect(r.passed).toBe(true);
  });

  it("file-exists fails when file missing", () => {
    const r = ASSERTION_HANDLERS["file-exists"]({ path: "missing.txt" }, { testbedPath: tb });
    expect(r.passed).toBe(false);
  });

  // file-contains
  it("file-contains passes on pattern match", () => {
    writeFileSync(resolve(tb, "config.json"), '{"version":"2.0"}');
    const r = ASSERTION_HANDLERS["file-contains"]({ path: "config.json", pattern: "version" }, { testbedPath: tb });
    expect(r.passed).toBe(true);
  });

  it("file-contains fails on pattern mismatch", () => {
    writeFileSync(resolve(tb, "config.json"), '{"version":"2.0"}');
    const r = ASSERTION_HANDLERS["file-contains"]({ path: "config.json", pattern: "nonexistent" }, { testbedPath: tb });
    expect(r.passed).toBe(false);
  });

  // event-emitted
  it("event-emitted passes when event found", () => {
    const now = Date.now();
    const hubEvents = [{ type: "test-event", timestamp: new Date(now).toISOString() }];
    const r = ASSERTION_HANDLERS["event-emitted"]({ eventType: "test-event", within: 5000 }, { startTime: now, hubEvents });
    expect(r.passed).toBe(true);
  });

  it("event-emitted fails when event missing", () => {
    const r = ASSERTION_HANDLERS["event-emitted"]({ eventType: "missing-event" }, { startTime: Date.now(), hubEvents: [] });
    expect(r.passed).toBe(false);
  });

  // correlationId-thread
  it("correlationId-thread passes with enough events", () => {
    const cid = "test-cid";
    const hubEvents = [{ correlationId: cid }, { correlationId: cid }, { correlationId: "other" }];
    const r = ASSERTION_HANDLERS["correlationId-thread"]({ minSize: 2 }, { correlationId: cid, hubEvents });
    expect(r.passed).toBe(true);
  });

  it("correlationId-thread fails with too few events", () => {
    const r = ASSERTION_HANDLERS["correlationId-thread"]({ minSize: 3 }, { correlationId: "cid", hubEvents: [{ correlationId: "cid" }] });
    expect(r.passed).toBe(false);
  });

  // exit-code
  it("exit-code passes on match", () => {
    const r = ASSERTION_HANDLERS["exit-code"]({ expected: 0 }, { lastExitCode: 0 });
    expect(r.passed).toBe(true);
  });

  it("exit-code fails on mismatch", () => {
    const r = ASSERTION_HANDLERS["exit-code"]({ expected: 0 }, { lastExitCode: 1 });
    expect(r.passed).toBe(false);
  });

  // duration-under
  it("duration-under passes when under budget", () => {
    const r = ASSERTION_HANDLERS["duration-under"]({ budgetMs: 5000 }, { lastDurationMs: 3000 });
    expect(r.passed).toBe(true);
  });

  it("duration-under fails when over budget", () => {
    const r = ASSERTION_HANDLERS["duration-under"]({ budgetMs: 1000 }, { lastDurationMs: 2000 });
    expect(r.passed).toBe(false);
  });

  // artefact-count
  it("artefact-count passes with enough artefacts", () => {
    const subdir = resolve(tb, "artefacts");
    mkdirSync(subdir, { recursive: true });
    writeFileSync(resolve(subdir, "a.json"), "{}");
    writeFileSync(resolve(subdir, "b.json"), "{}");
    const r = ASSERTION_HANDLERS["artefact-count"]({ dir: "artefacts", min: 2 }, { testbedPath: tb });
    expect(r.passed).toBe(true);
  });

  it("artefact-count fails with too few artefacts", () => {
    const r = ASSERTION_HANDLERS["artefact-count"]({ dir: "empty-dir", min: 1 }, { testbedPath: tb });
    expect(r.passed).toBe(false);
  });
});

describe("testbed/runner — runScenario", () => {
  let projectRoot;
  let tb;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
    tb = makeTestbed();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(tb, { recursive: true, force: true });
  });

  it("runs a passing scenario", async () => {
    writeFileSync(resolve(tb, "expected.txt"), "content");
    const scenario = makeScenario({
      assertions: [
        { kind: "file-exists", path: "expected.txt" },
        { kind: "exit-code", expected: 0 },
      ],
    });
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const result = await runScenario(scenario, {
      hub,
      projectRoot,
      captureMemoryFn: null,
      testbedPath: tb,
      dryRun: false,
      spawnFn,
    });

    expect(result.status).toBe("passed");
    expect(result.assertions.length).toBe(2);
    expect(result.assertions.every(a => a.passed)).toBe(true);
    expect(result.correlationId).toBeDefined();
  });

  it("marks failed when assertion fails", async () => {
    const scenario = makeScenario({
      assertions: [{ kind: "file-exists", path: "missing.txt" }],
    });
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const result = await runScenario(scenario, {
      hub,
      projectRoot,
      captureMemoryFn: null,
      testbedPath: tb,
      dryRun: false,
      spawnFn,
    });

    expect(result.status).toBe("failed");
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("emits started and completed hub events", async () => {
    const scenario = makeScenario();
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    await runScenario(scenario, { hub, projectRoot, captureMemoryFn: null, testbedPath: tb, spawnFn });

    const types = hub.events.map(e => e.type);
    expect(types).toContain("testbed-scenario-started");
    expect(types).toContain("testbed-scenario-completed");
  });

  it("threads correlationId through events", async () => {
    const scenario = makeScenario();
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const result = await runScenario(scenario, { hub, projectRoot, captureMemoryFn: null, testbedPath: tb, spawnFn });

    const startedEvent = hub.events.find(e => e.type === "testbed-scenario-started");
    const completedEvent = hub.events.find(e => e.type === "testbed-scenario-completed");
    expect(startedEvent.data.correlationId).toBe(result.correlationId);
    expect(completedEvent.data.correlationId).toBe(result.correlationId);
  });

  it("dry-run skips execute and teardown", async () => {
    const teardownSpy = vi.fn();
    const scenario = makeScenario({
      teardown: [{ cmd: "echo teardown" }],
    });
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const result = await runScenario(scenario, {
      hub,
      projectRoot,
      captureMemoryFn: null,
      testbedPath: tb,
      dryRun: true,
      spawnFn,
    });

    expect(result.executeResults.length).toBe(0);
    expect(result.teardownResults.length).toBe(0);
  });

  it("teardown runs even after assertion failure", async () => {
    const scenario = makeScenario({
      assertions: [{ kind: "file-exists", path: "nonexistent.txt" }],
      teardown: [{ cmd: "echo teardown" }],
    });
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const result = await runScenario(scenario, { hub, projectRoot, captureMemoryFn: null, testbedPath: tb, spawnFn });

    expect(result.status).toBe("failed");
    // spawnFn called for execute step + teardown
    expect(spawnFn).toHaveBeenCalled();
  });

  it("releases lock after run", async () => {
    const scenario = makeScenario();
    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    await runScenario(scenario, { hub, projectRoot, captureMemoryFn: null, testbedPath: tb, spawnFn });

    const lockFile = resolve(projectRoot, ".forge", "testbed.lock");
    expect(existsSync(lockFile)).toBe(false);
  });

  it("calls captureMemoryFn for high-severity findings", async () => {
    const scenario = makeScenario({
      assertions: [{ kind: "file-exists", path: "missing.txt", severity: "high" }],
    });
    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const captureFn = vi.fn();

    await runScenario(scenario, { hub, projectRoot, captureMemoryFn: captureFn, testbedPath: tb, spawnFn });

    expect(captureFn).toHaveBeenCalled();
    expect(captureFn.mock.calls[0][1]).toBe("testbed-finding");
  });
});

describe("testbed/scenarios — validateScenarioFixture", () => {
  it("validates a correct fixture", () => {
    const result = validateScenarioFixture({
      scenarioId: "test",
      kind: "happy-path",
      execute: [{ cmd: "echo" }],
      assertions: [{ kind: "exit-code" }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing scenarioId", () => {
    const result = validateScenarioFixture({ kind: "happy-path", execute: [], assertions: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("scenarioId"))).toBe(true);
  });

  it("rejects invalid kind", () => {
    const result = validateScenarioFixture({ scenarioId: "t", kind: "invalid", execute: [], assertions: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects unsupported assertion kind", () => {
    const result = validateScenarioFixture({
      scenarioId: "t",
      kind: "happy-path",
      execute: [],
      assertions: [{ kind: "unknown-assertion" }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes("unknown-assertion"))).toBe(true);
  });

  it("rejects missing execute array", () => {
    const result = validateScenarioFixture({ scenarioId: "t", kind: "happy-path", assertions: [] });
    expect(result.ok).toBe(false);
  });
});

describe("testbed/scenarios — loadScenario", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("loads a valid scenario", () => {
    const fixture = { scenarioId: "smoke", kind: "happy-path", execute: [{ cmd: "echo" }], assertions: [{ kind: "exit-code" }] };
    writeFileSync(resolve(projectRoot, "docs", "plans", "testbed-scenarios", "smoke.json"), JSON.stringify(fixture));
    const loaded = loadScenario("smoke", { projectRoot });
    expect(loaded.scenarioId).toBe("smoke");
  });

  it("throws ERR_SCENARIO_NOT_FOUND for missing file", () => {
    expect(() => loadScenario("nonexistent", { projectRoot })).toThrow(/not found/i);
  });

  it("throws on invalid fixture", () => {
    writeFileSync(resolve(projectRoot, "docs", "plans", "testbed-scenarios", "bad.json"), JSON.stringify({ scenarioId: "bad" }));
    expect(() => loadScenario("bad", { projectRoot })).toThrow(/invalid/i);
  });
});

describe("testbed/scenarios — listScenarios", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("lists scenarios from directory", () => {
    const dir = resolve(projectRoot, "docs", "plans", "testbed-scenarios");
    writeFileSync(join(dir, "s1.json"), JSON.stringify({ scenarioId: "s1", kind: "happy-path", execute: [], assertions: [] }));
    writeFileSync(join(dir, "s2.json"), JSON.stringify({ scenarioId: "s2", kind: "chaos", execute: [], assertions: [] }));
    const list = listScenarios({ projectRoot });
    expect(list.length).toBe(2);
    expect(list.map(s => s.scenarioId)).toContain("s1");
  });

  it("returns empty array when directory missing", () => {
    const freshDir = makeTmpDir();
    const list = listScenarios({ projectRoot: freshDir });
    expect(list).toEqual([]);
    rmSync(freshDir, { recursive: true, force: true });
  });
});

describe("testbed/scenarios — resolveTestbedPath", () => {
  let projectRoot;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("uses explicit testbedPath argument", () => {
    const path = resolveTestbedPath({ testbedPath: "/explicit/path" }, { projectRoot });
    expect(path).toBe("/explicit/path");
  });

  it("reads from .forge.json config", () => {
    writeFileSync(resolve(projectRoot, ".forge.json"), JSON.stringify({ testbed: { path: "/from/config" } }));
    const path = resolveTestbedPath({}, { projectRoot });
    expect(path).toBe("/from/config");
  });
});
