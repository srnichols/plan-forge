import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { validateScenarioFixture, loadScenario, listScenarios } from "../testbed/scenarios.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-happypath-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeProjectRoot() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".forge"), { recursive: true });
  mkdirSync(resolve(dir, "docs", "plans", "testbed-findings"), { recursive: true });
  mkdirSync(resolve(dir, "docs", "plans", "testbed-scenarios"), { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt), eventHistory: [] };
}

function makeTestbed() {
  const dir = makeTmpDir();
  mkdirSync(resolve(dir, ".git"), { recursive: true });
  return dir;
}

function makeSpawnFn(overrides = {}) {
  return vi.fn().mockImplementation((cmd, opts) => {
    if (cmd === "git status --porcelain") return overrides.gitStatus ?? "";
    if (cmd === "git rev-parse HEAD") return overrides.gitHead ?? "abc123";
    return overrides.output ?? "";
  });
}

function writeScenario(projectRoot, scenarioId, fixture) {
  const dir = resolve(projectRoot, "docs", "plans", "testbed-scenarios");
  writeFileSync(join(dir, `${scenarioId}.json`), JSON.stringify(fixture, null, 2), "utf-8");
}

function makeHappyPathScenario(id, overrides = {}) {
  return {
    scenarioId: id,
    kind: "happy-path",
    description: `Happy path scenario: ${id}`,
    setup: [],
    execute: [{ cmd: "echo hello" }],
    assertions: [{ kind: "exit-code", expected: 0 }],
    teardown: [],
    ...overrides,
  };
}

// ─── Scenario Fixture Validation ──────────────────────────────────────

describe("testbed-happypath — scenario fixtures", () => {
  const repoRoot = resolve(process.cwd(), "..");
  const scenarioDir = resolve(repoRoot, "docs", "plans", "testbed-scenarios");

  const expectedIds = [
    "happy-path-01",
    "happy-path-02",
    "happy-path-03",
    "happy-path-04",
    "happy-path-05",
  ];

  for (const id of expectedIds) {
    it(`fixture ${id}.json exists and is valid`, () => {
      const filePath = join(scenarioDir, `${id}.json`);
      expect(existsSync(filePath), `${id}.json should exist`).toBe(true);

      const raw = readFileSync(filePath, "utf-8");
      const fixture = JSON.parse(raw);

      expect(fixture.scenarioId).toBe(id);
      expect(fixture.kind).toBe("happy-path");

      const validation = validateScenarioFixture(fixture);
      expect(validation.ok, `validation errors: ${validation.errors.join("; ")}`).toBe(true);
    });
  }

  it("all happy-path fixtures have descriptions", () => {
    for (const id of expectedIds) {
      const fixture = JSON.parse(readFileSync(join(scenarioDir, `${id}.json`), "utf-8"));
      expect(typeof fixture.description).toBe("string");
      expect(fixture.description.length).toBeGreaterThan(0);
    }
  });

  it("each fixture uses at least one assertion kind", () => {
    for (const id of expectedIds) {
      const fixture = JSON.parse(readFileSync(join(scenarioDir, `${id}.json`), "utf-8"));
      expect(fixture.assertions.length).toBeGreaterThan(0);
    }
  });

  it("fixtures collectively use at least 4 distinct assertion kinds", () => {
    const kinds = new Set();
    for (const id of expectedIds) {
      const fixture = JSON.parse(readFileSync(join(scenarioDir, `${id}.json`), "utf-8"));
      for (const a of fixture.assertions) kinds.add(a.kind);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });
});

// ─── Tool Handler Logic ──────────────────────────────────────────────

describe("testbed-happypath — tool handler logic", () => {
  let projectRoot;
  let testbedDir;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
    testbedDir = makeTestbed();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testbedDir, { recursive: true, force: true });
  });

  it("returns aggregated results with passed/failed/total", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-a", makeHappyPathScenario("happy-path-a"));
    writeScenario(projectRoot, "happy-path-b", makeHappyPathScenario("happy-path-b"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const results = [];

    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    for (const s of happyPaths) {
      const scenario = loadScenario(s.scenarioId, { projectRoot });
      const res = await runScenario(scenario, {
        hub,
        projectRoot,
        testbedPath: testbedDir,
        dryRun: true,
        spawnFn,
      });
      results.push(res);
    }

    const passed = results.filter(r => r.status === "passed").length;
    const failed = results.filter(r => r.status !== "passed").length;

    expect(passed).toBe(2);
    expect(failed).toBe(0);
    expect(results.length).toBe(2);
  });

  it("filters only happy-path scenarios (ignores chaos kind)", () => {
    writeScenario(projectRoot, "happy-path-a", makeHappyPathScenario("happy-path-a"));
    writeScenario(projectRoot, "chaos-01", {
      scenarioId: "chaos-01",
      kind: "chaos",
      description: "Chaos scenario",
      execute: [{ cmd: "echo chaos" }],
      assertions: [{ kind: "exit-code", expected: 1 }],
    });

    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    expect(scenarios.length).toBe(2);
    expect(happyPaths.length).toBe(1);
    expect(happyPaths[0].scenarioId).toBe("happy-path-a");
  });

  it("handles empty scenario directory gracefully", () => {
    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    expect(happyPaths.length).toBe(0);
  });

  it("handles scenario load failure with partial results", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-a", makeHappyPathScenario("happy-path-a"));
    // Write a scenario with valid JSON but invalid fixture (missing required fields)
    writeScenario(projectRoot, "happy-path-bad", {
      scenarioId: "happy-path-bad",
      kind: "happy-path",
      description: "Bad scenario with missing execute",
    });

    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const results = [];
    let failed = 0;

    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    for (const s of happyPaths) {
      try {
        const scenario = loadScenario(s.scenarioId, { projectRoot });
        const res = await runScenario(scenario, {
          hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
        });
        results.push(res);
      } catch (err) {
        results.push({ scenarioId: s.scenarioId, status: "load-error", error: err.message, code: err.code });
        failed++;
      }
    }

    expect(results.length).toBe(2);
    expect(failed).toBeGreaterThanOrEqual(1);
    const loadErrors = results.filter(r => r.status === "load-error");
    expect(loadErrors.length).toBe(1);
    expect(loadErrors[0].code).toBe("ERR_SCENARIO_INVALID");
  });

  it("dryRun flag passes through to runner", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-dry", makeHappyPathScenario("happy-path-dry", {
      execute: [{ cmd: "node -e \"process.exit(1)\"" }],
    }));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const scenario = loadScenario("happy-path-dry", { projectRoot });
    const res = await runScenario(scenario, {
      hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
    });

    // In dry-run, execute steps are skipped so exit-code assertion uses default 0
    expect(res.executeResults.length).toBe(0);
    expect(res.status).toBe("passed");
  });

  it("results include per-scenario scenarioId and status", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-x", makeHappyPathScenario("happy-path-x"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const scenario = loadScenario("happy-path-x", { projectRoot });
    const res = await runScenario(scenario, {
      hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
    });

    expect(res.scenarioId).toBe("happy-path-x");
    expect(res.status).toBe("passed");
    expect(typeof res.correlationId).toBe("string");
    expect(res.correlationId.length).toBeGreaterThan(0);
  });

  it("lock is released after all scenarios complete", async () => {
    const { runScenario, releaseLock, acquireLock } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-lock", makeHappyPathScenario("happy-path-lock"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const scenario = loadScenario("happy-path-lock", { projectRoot });
    await runScenario(scenario, {
      hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
    });

    // Lock should be released — acquiring should succeed
    expect(() => acquireLock(projectRoot, hub)).not.toThrow();
    releaseLock(projectRoot);
  });

  it("hub events emitted for each scenario", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-evt", makeHappyPathScenario("happy-path-evt"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();

    const scenario = loadScenario("happy-path-evt", { projectRoot });
    await runScenario(scenario, {
      hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
    });

    const started = hub.events.filter(e => e.type === "testbed-scenario-started");
    const completed = hub.events.filter(e => e.type === "testbed-scenario-completed");

    expect(started.length).toBe(1);
    expect(started[0].data.scenarioId).toBe("happy-path-evt");
    expect(completed.length).toBe(1);
    expect(completed[0].data.status).toBe("passed");
  });
});

// ─── Integration: Full dry-run with mocked deps ──────────────────────

describe("testbed-happypath — integration dry-run", () => {
  let projectRoot;
  let testbedDir;

  beforeEach(() => {
    projectRoot = makeProjectRoot();
    testbedDir = makeTestbed();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(testbedDir, { recursive: true, force: true });
  });

  it("full dry-run through multiple scenarios with mock deps", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-int-1", makeHappyPathScenario("happy-path-int-1"));
    writeScenario(projectRoot, "happy-path-int-2", makeHappyPathScenario("happy-path-int-2", {
      assertions: [
        { kind: "exit-code", expected: 0 },
        { kind: "duration-under", budgetMs: 60000 },
      ],
    }));
    writeScenario(projectRoot, "happy-path-int-3", makeHappyPathScenario("happy-path-int-3"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const results = [];

    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    for (const s of happyPaths) {
      const scenario = loadScenario(s.scenarioId, { projectRoot });
      const res = await runScenario(scenario, {
        hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
      });
      results.push(res);
    }

    expect(results.length).toBe(3);
    expect(results.every(r => r.status === "passed")).toBe(true);
  });

  it("validates correlationId is unique per scenario", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-cid-1", makeHappyPathScenario("happy-path-cid-1"));
    writeScenario(projectRoot, "happy-path-cid-2", makeHappyPathScenario("happy-path-cid-2"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const results = [];

    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    for (const s of happyPaths) {
      const scenario = loadScenario(s.scenarioId, { projectRoot });
      const res = await runScenario(scenario, {
        hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
      });
      results.push(res);
    }

    const correlationIds = results.map(r => r.correlationId);
    const uniqueIds = new Set(correlationIds);
    expect(uniqueIds.size).toBe(correlationIds.length);
  });

  it("hub events threaded with correct correlationIds", async () => {
    const { runScenario } = await import("../testbed/runner.mjs");

    writeScenario(projectRoot, "happy-path-hub-1", makeHappyPathScenario("happy-path-hub-1"));
    writeScenario(projectRoot, "happy-path-hub-2", makeHappyPathScenario("happy-path-hub-2"));

    const hub = makeHub();
    const spawnFn = makeSpawnFn();
    const results = [];

    const scenarios = listScenarios({ projectRoot });
    const happyPaths = scenarios.filter(s => s.kind === "happy-path");

    for (const s of happyPaths) {
      const scenario = loadScenario(s.scenarioId, { projectRoot });
      const res = await runScenario(scenario, {
        hub, projectRoot, testbedPath: testbedDir, dryRun: true, spawnFn,
      });
      results.push(res);
    }

    // Each scenario should produce started + completed events
    const startedEvents = hub.events.filter(e => e.type === "testbed-scenario-started");
    const completedEvents = hub.events.filter(e => e.type === "testbed-scenario-completed");
    expect(startedEvents.length).toBe(2);
    expect(completedEvents.length).toBe(2);

    // Each completed event should have a correlationId matching a result
    for (const res of results) {
      const matchingComplete = completedEvents.find(e => e.data.correlationId === res.correlationId);
      expect(matchingComplete).toBeDefined();
      expect(matchingComplete.data.scenarioId).toBe(res.scenarioId);
    }
  });
});

// ─── CLI Parity ──────────────────────────────────────────────────────

describe("testbed-happypath — CLI parity", () => {
  const repoRoot = resolve(process.cwd(), "..");

  it("mcpToCli maps forge_testbed_happypath to testbed-happypath", async () => {
    const { mcpToCli } = await import("../../scripts/audit-cli-parity.mjs");
    expect(mcpToCli("forge_testbed_happypath")).toBe("testbed-happypath");
  });

  it("testbed-happypath command exists in pforge.ps1", () => {
    const content = readFileSync(resolve(repoRoot, "pforge.ps1"), "utf-8");
    expect(content).toContain("'testbed-happypath'");
  });

  it("testbed-happypath command exists in pforge.sh", () => {
    const content = readFileSync(resolve(repoRoot, "pforge.sh"), "utf-8");
    expect(content).toContain("testbed-happypath)");
  });

  it("forge_testbed_happypath is NOT in KNOWN_MCP_ONLY exceptions", async () => {
    const auditContent = readFileSync(resolve(repoRoot, "scripts", "audit-cli-parity.mjs"), "utf-8");
    expect(auditContent).not.toContain('"forge_testbed_happypath"');
  });
});

// ─── Capabilities Metadata ───────────────────────────────────────────

describe("testbed-happypath — capabilities metadata", () => {
  it("TOOL_METADATA includes forge_testbed_happypath", async () => {
    const { TOOL_METADATA } = await import("../capabilities.mjs");
    expect(TOOL_METADATA.forge_testbed_happypath).toBeDefined();
  });

  it("metadata has correct structure", async () => {
    const { TOOL_METADATA } = await import("../capabilities.mjs");
    const meta = TOOL_METADATA.forge_testbed_happypath;

    expect(meta.intent).toContain("happy-path");
    expect(meta.intent).toContain("testbed");
    expect(meta.cost).toBe("high");
    expect(meta.maxConcurrent).toBe(1);
    expect(meta.writesFiles).toBe(true);
    expect(meta.network).toBe(false);
    expect(meta.risk).toBe("medium");
    expect(meta.errors.ERR_TESTBED_NOT_FOUND).toBeDefined();
    expect(meta.errors.ERR_NO_HAPPYPATH_SCENARIOS).toBeDefined();
    expect(meta.example).toBeDefined();
  });
});
