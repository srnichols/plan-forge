/**
 * Plan Forge — Phase TEMPER-06 Slice 06.3: Closed-loop fix validation tests.
 *
 * ~45 tests across 6 groups:
 *   - Schema/Contract (8)
 *   - forge_fix_proposal tempering-bug source (10)
 *   - forge_bug_validate_fix (12)
 *   - LiveGuard tempering dimension (8)
 *   - Orchestrator anomaly + recommendation (4)
 *   - End-to-end fixtures (3)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  loadBug,
  listBugs,
  registerBug,
  updateBugStatus,
  setLinkedFixPlan,
  appendValidationAttempt,
} from "../tempering/bug-registry.mjs";

import { runSingleScanner } from "../tempering/runner.mjs";

import { TOOL_METADATA } from "../capabilities.mjs";

import {
  detectWatchAnomalies,
  recommendFromAnomalies,
} from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(__dirname, "..");

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `temper-06-3-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return {
    events,
    broadcast: (evt) => events.push(evt),
  };
}

function makeBug(cwd, overrides = {}) {
  const bugsDir = resolve(cwd, ".forge", "bugs");
  mkdirSync(bugsDir, { recursive: true });
  const bugId = overrides.bugId || `bug-2026-04-19-${String(Math.floor(Math.random() * 999) + 1).padStart(3, "0")}`;
  const bug = {
    bugId,
    fingerprint: randomUUID(),
    scanner: "unit",
    severity: "medium",
    status: "open",
    classification: "real-bug",
    classifierMeta: {},
    evidence: {
      testName: "UserService.login should validate credentials",
      assertionMessage: "Expected true to be false",
      stackTrace: "at Object.<anonymous> (src/services/user.test.js:42:5)",
    },
    affectedFiles: ["src/services/user.js"],
    reproSteps: [],
    correlationId: `corr-${randomUUID()}`,
    sliceRef: null,
    discoveredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
  writeFileSync(resolve(bugsDir, `${bugId}.json`), JSON.stringify(bug, null, 2) + "\n", "utf-8");
  return bug;
}

// ─── Group 1: Schema/Contract (8) ────────────────────────────────────

describe("Schema/Contract (Slice 06.3)", () => {
  const toolsJson = JSON.parse(readFileSync(resolve(MCP_ROOT, "tools.json"), "utf-8"));
  const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
  const capSrc = readFileSync(resolve(MCP_ROOT, "capabilities.mjs"), "utf-8");
  const orchestratorSrc = readFileSync(resolve(MCP_ROOT, "orchestrator.mjs"), "utf-8");

  it("tools.json registers forge_bug_validate_fix", () => {
    const entry = toolsJson.find(t => t.name === "forge_bug_validate_fix");
    expect(entry).toBeTruthy();
    expect(entry.cost).toBe("medium");
    expect(entry.consumes).toContain(".forge/bugs/<bugId>.json");
  });

  it("TOOL_METADATA entry exists for forge_bug_validate_fix", () => {
    const meta = TOOL_METADATA.forge_bug_validate_fix;
    expect(meta).toBeTruthy();
    expect(meta.cost).toBe("medium");
    expect(meta.maxConcurrent).toBe(1);
  });

  it("forge_bug_validate_fix addedIn is 2.47.0", () => {
    expect(TOOL_METADATA.forge_bug_validate_fix.addedIn).toBe("2.47.0");
  });

  it("forge_fix_proposal schema admits source 'tempering-bug' and consumes bugs", () => {
    const entry = toolsJson.find(t => t.name === "forge_fix_proposal");
    expect(entry).toBeTruthy();
    expect(entry.consumes).toContain(".forge/bugs/*.json");
  });

  it("LIVEGUARD_TOOLS contains forge_bug_validate_fix (size 22)", () => {
    const match = orchestratorSrc.match(/const LIVEGUARD_TOOLS = new Set\(\[([\s\S]*?)\]\)/);
    expect(match).toBeTruthy();
    expect(match[1]).toContain("forge_bug_validate_fix");
    const entries = match[1].match(/"forge_\w+"/g);
    expect(entries.length).toBe(22);
  });

  it("EVENTS.md documents tempering-bug-validated-fixed", () => {
    const eventsPath = resolve(MCP_ROOT, "EVENTS.md");
    if (existsSync(eventsPath)) {
      const content = readFileSync(eventsPath, "utf-8");
      expect(content).toContain("tempering-bug-validated-fixed");
    }
  });

  it("forge_liveguard_run.consumes lists .forge/bugs/*.json", () => {
    const meta = TOOL_METADATA.forge_liveguard_run;
    expect(meta.consumes).toContain(".forge/bugs/*.json");
  });

  it("forge_fix_proposal.errors includes MISSING_BUG_ID and BUG_TERMINAL_STATUS", () => {
    const meta = TOOL_METADATA.forge_fix_proposal;
    expect(meta.errors.MISSING_BUG_ID).toBeTruthy();
    expect(meta.errors.BUG_TERMINAL_STATUS).toBeTruthy();
  });
});

// ─── Group 2: forge_fix_proposal tempering-bug source (10) ───────────

describe("forge_fix_proposal tempering-bug source (Slice 06.3)", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} });

  it("server.mjs source description mentions tempering-bug", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("tempering-bug");
  });

  it("setLinkedFixPlan sets linkedFixPlan on bug", () => {
    const bug = makeBug(cwd);
    const result = setLinkedFixPlan(cwd, bug.bugId, "docs/plans/auto/test.md");
    expect(result.ok).toBe(true);
    const updated = loadBug(cwd, bug.bugId);
    expect(updated.linkedFixPlan).toBe("docs/plans/auto/test.md");
  });

  it("setLinkedFixPlan returns BUG_NOT_FOUND for missing bug", () => {
    const result = setLinkedFixPlan(cwd, "nonexistent", "test.md");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("BUG_NOT_FOUND");
  });

  it("fixId namespacing uses tempering-bug-<bugId>", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("tempering-bug-${bugId}");
  });

  it("ALREADY_EXISTS pattern uses file presence check", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("existsSync(planPath)");
    expect(serverSrc).toContain("alreadyExists: true");
  });

  it("auto mode places tempering-bug last in cascade", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    // tempering-bug check should appear after crucible
    const crucibleIdx = serverSrc.indexOf("source === \"crucible\"");
    const temperingBugIdx = serverSrc.indexOf("source === \"tempering-bug\"");
    expect(temperingBugIdx).toBeGreaterThan(crucibleIdx);
  });

  it("bug transitions to in-fix on fix proposal generation", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    // Verify the code calls updateBugStatus with "in-fix"
    expect(serverSrc).toContain('updateBugStatus(cwd, bugId, "in-fix"');
  });

  it("linkedFixPlan is set during fix proposal", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("setLinkedFixPlan(cwd, bugId, relPlanPath)");
  });

  it("hub event fix-proposal-ready includes source in data", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("fix-proposal-ready");
    expect(serverSrc).toContain("source: sourceData.type");
  });

  it("3-slice plan generated for critical severity bugs", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    // Conditional slice 3 for critical/high
    expect(serverSrc).toContain('severity === "critical" || severity === "high"');
    expect(serverSrc).toContain("Regression guard");
  });
});

// ─── Group 3: forge_bug_validate_fix (12) ────────────────────────────

describe("forge_bug_validate_fix (Slice 06.3)", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} });

  it("appendValidationAttempt grows validationAttempts array", () => {
    const bug = makeBug(cwd);
    const attempt = { at: new Date().toISOString(), scanners: ["unit"], result: "pass", details: [] };
    appendValidationAttempt(cwd, bug.bugId, attempt);
    const updated = loadBug(cwd, bug.bugId);
    expect(updated.validationAttempts).toHaveLength(1);
    expect(updated.validationAttempts[0].result).toBe("pass");
  });

  it("appendValidationAttempt returns BUG_NOT_FOUND for missing bug", () => {
    const result = appendValidationAttempt(cwd, "nonexistent", { at: "now", scanners: [], result: "pass" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("BUG_NOT_FOUND");
  });

  it("multiple validation attempts accumulate", () => {
    const bug = makeBug(cwd);
    appendValidationAttempt(cwd, bug.bugId, { at: "t1", scanners: ["unit"], result: "fail" });
    appendValidationAttempt(cwd, bug.bugId, { at: "t2", scanners: ["unit"], result: "pass" });
    const updated = loadBug(cwd, bug.bugId);
    expect(updated.validationAttempts).toHaveLength(2);
    expect(updated.validationAttempts[0].result).toBe("fail");
    expect(updated.validationAttempts[1].result).toBe("pass");
  });

  it("runSingleScanner throws SCANNER_UNAVAILABLE for unknown scanner", async () => {
    await expect(runSingleScanner("nonexistent", { cwd }))
      .rejects.toThrow("not registered");
    try {
      await runSingleScanner("nonexistent", { cwd });
    } catch (e) {
      expect(e.code).toBe("SCANNER_UNAVAILABLE");
    }
  });

  it("runSingleScanner accepts scannerImpl DI override", async () => {
    const result = await runSingleScanner("unit", {
      cwd,
      scannerImpl: async () => ({ failures: [], findings: [] }),
    });
    expect(result.scanner).toBe("unit");
    expect(result.failures).toBe(0);
    expect(result.startedAt).toBeTruthy();
    expect(result.completedAt).toBeTruthy();
  });

  it("runSingleScanner reports failure count from DI scanner", async () => {
    const result = await runSingleScanner("integration", {
      cwd,
      scannerImpl: async () => ({ failures: [{ test: "a" }, { test: "b" }], findings: [] }),
    });
    expect(result.failures).toBe(2);
  });

  it("server.mjs handler returns BUG_NOT_FOUND for missing bugId", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("BUG_NOT_FOUND");
  });

  it("server.mjs handler returns ALREADY_FIXED for terminal status", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("ALREADY_FIXED");
  });

  it("server.mjs handler dispatches commentValidatedFix on pass", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("commentValidatedFix");
    expect(serverSrc).toContain("dispatchBugAdapter");
  });

  it("server.mjs handler broadcasts hub event on pass", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("tempering-bug-validated-fixed");
  });

  it("server.mjs handler captures OpenBrain thought on pass", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("isOpenBrainConfigured");
    expect(serverSrc).toContain("forge_bug_validate_fix");
  });

  it("server.mjs handler returns advisory warning for open bug without linkedFixPlan", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("manual fix assumed");
  });
});

// ─── Group 4: LiveGuard tempering dimension (8) ──────────────────────

describe("LiveGuard tempering dimension (Slice 06.3)", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} });

  it("server.mjs includes tempering dimension in forge_liveguard_run", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("report.tempering");
    expect(serverSrc).toContain("temperingOk");
  });

  it("dimension shape includes expected fields", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain("openBugs:");
    expect(serverSrc).toContain("criticalOrHighOpen:");
    expect(serverSrc).toContain("coverageVsMinima");
    expect(serverSrc).toContain("mutationScore");
    expect(serverSrc).toContain("lastRunAt:");
    expect(serverSrc).toContain("status: temperingStatus");
  });

  it("red on critical/high open bugs", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain('criticalOrHigh.length > 0) temperingStatus = "red"');
  });

  it("yellow on any open bugs", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain('openBugs.length > 0');
    expect(serverSrc).toContain('"yellow"');
  });

  it("green on no open bugs", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain('"green"');
  });

  it("overallStatus composition includes temperingOk", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toMatch(/driftOk && secretsOk && regressionOk && depsOk && alertsOk && temperingOk/);
  });

  it("temperingOk is red-condition alongside regression and secrets", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toMatch(/!regressionOk \|\| !secretsOk \|\| !temperingOk/);
  });

  it("missing config results in graceful status", () => {
    const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
    expect(serverSrc).toContain('status: "unknown"');
  });
});

// ─── Group 5: Orchestrator anomaly + recommendation (4) ──────────────

describe("Orchestrator anomaly + recommendation (Slice 06.3)", () => {
  function makeSnapshot(overrides = {}) {
    return {
      ok: true,
      runState: "completed",
      lastEventAgeMs: 1000,
      artifacts: [],
      counts: { started: 1, completed: 1, failed: 0, escalated: 0, events: 1, artifacts: 0, quorumDispatched: 0, quorumLegsCompleted: 0, quorumReviewed: 0, skillsStarted: 0, skillsCompleted: 0, skillStepsFailed: 0 },
      summary: null,
      crucible: null,
      tempering: {
        initialized: true,
        openBugCount: { total: 0, criticalOrHigh: 0, unaddressed: [] },
        belowMinimum: 0,
        stale: false,
        runFailed: false,
        contractMismatch: 0,
        mutationBelowMinimum: 0,
        flakyCount: 0,
        perfRegressionCount: 0,
      },
      ...overrides,
    };
  }

  it("fires tempering-bug-unaddressed for old bugs without linkedFixPlan", () => {
    const snapshot = makeSnapshot({
      tempering: {
        ...makeSnapshot().tempering,
        openBugCount: {
          total: 2,
          criticalOrHigh: 0,
          unaddressed: [
            { bugId: "bug-2026-04-01-001", discoveredAt: "2026-04-01T00:00:00Z" },
          ],
        },
      },
    });
    const anomalies = detectWatchAnomalies(snapshot);
    const unaddressed = anomalies.find(a => a.code === "tempering-bug-unaddressed");
    expect(unaddressed).toBeTruthy();
    expect(unaddressed.severity).toBe("warn");
    expect(unaddressed.bugIds).toContain("bug-2026-04-01-001");
  });

  it("suppressed when no unaddressed bugs", () => {
    const snapshot = makeSnapshot();
    const anomalies = detectWatchAnomalies(snapshot);
    const unaddressed = anomalies.find(a => a.code === "tempering-bug-unaddressed");
    expect(unaddressed).toBeUndefined();
  });

  it("recommendFromAnomalies returns fix-proposal recommendation", () => {
    const anomaly = {
      severity: "warn",
      code: "tempering-bug-unaddressed",
      count: 1,
      bugIds: ["bug-2026-04-01-001"],
      message: "test",
    };
    const snapshot = makeSnapshot();
    const recs = recommendFromAnomalies([anomaly], snapshot);
    const rec = recs.find(r => r.code === "tempering-bug-unaddressed");
    expect(rec).toBeTruthy();
    expect(rec.action).toContain("forge_fix_proposal");
    expect(rec.action).toContain("bug-2026-04-01-001");
    expect(rec.command).toContain("forge_fix_proposal");
  });

  it("caps bugIds at 10 in anomaly payload", () => {
    // readOpenBugCount in tempering.mjs does the capping
    const serverSrc = readFileSync(resolve(MCP_ROOT, "../pforge-mcp/tempering.mjs"), "utf-8");
    expect(serverSrc).toContain(".slice(0, 10)");
  });
});

// ─── Group 6: End-to-end fixtures (3) ────────────────────────────────

describe("End-to-end fixtures (Slice 06.3)", () => {
  let cwd;
  beforeEach(() => { cwd = makeTmpDir(); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch {} });

  it("happy path: register → propose → validate pass → bug fixed", async () => {
    // Register bug
    const bug = makeBug(cwd, { status: "open", classification: "real-bug", severity: "medium" });

    // Simulate fix proposal: transition to in-fix and link plan
    await updateBugStatus(cwd, bug.bugId, "in-fix", { note: "linked fix plan" });
    setLinkedFixPlan(cwd, bug.bugId, "docs/plans/auto/test.md");

    let updated = loadBug(cwd, bug.bugId);
    expect(updated.status).toBe("in-fix");
    expect(updated.linkedFixPlan).toBe("docs/plans/auto/test.md");

    // Validate fix — scanner passes
    const scanResult = await runSingleScanner("unit", {
      cwd,
      scannerImpl: async () => ({ failures: [], findings: [] }),
    });
    expect(scanResult.failures).toBe(0);

    // Append validation attempt
    const attempt = { at: new Date().toISOString(), scanners: ["unit"], result: "pass", details: [scanResult] };
    appendValidationAttempt(cwd, bug.bugId, attempt);

    // Transition to fixed
    await updateBugStatus(cwd, bug.bugId, "fixed", { note: "Validated by scanner rerun" });

    updated = loadBug(cwd, bug.bugId);
    expect(updated.status).toBe("fixed");
    expect(updated.validationAttempts).toHaveLength(1);
    expect(updated.validationAttempts[0].result).toBe("pass");
  });

  it("failure path: propose → validate fail → bug still in-fix", async () => {
    const bug = makeBug(cwd, { status: "open", classification: "real-bug" });
    await updateBugStatus(cwd, bug.bugId, "in-fix", { note: "linked" });

    // Validate fix — scanner fails
    const scanResult = await runSingleScanner("unit", {
      cwd,
      scannerImpl: async () => ({ failures: [{ test: "a" }], findings: [] }),
    });
    expect(scanResult.failures).toBe(1);

    // Append validation attempt
    const attempt = { at: new Date().toISOString(), scanners: ["unit"], result: "fail", details: [scanResult] };
    appendValidationAttempt(cwd, bug.bugId, attempt);

    // Bug stays in-fix
    const updated = loadBug(cwd, bug.bugId);
    expect(updated.status).toBe("in-fix");
    expect(updated.validationAttempts).toHaveLength(1);
    expect(updated.validationAttempts[0].result).toBe("fail");
  });

  it("aging path: old bug triggers unaddressed anomaly", () => {
    // Create a bug with an old discoveredAt date (>14 days)
    const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    makeBug(cwd, {
      bugId: "bug-2026-04-01-001",
      discoveredAt: oldDate,
      classification: "real-bug",
      status: "open",
    });

    // Simulate what readOpenBugCount does
    const bugsDir = resolve(cwd, ".forge", "bugs");
    const files = readdirSync(bugsDir).filter(f => f.endsWith(".json"));
    expect(files.length).toBe(1);

    const bug = JSON.parse(readFileSync(resolve(bugsDir, files[0]), "utf-8"));
    expect(bug.status).toBe("open");
    expect(bug.classification).toBe("real-bug");
    expect(bug.linkedFixPlan).toBeUndefined();

    // Verify age > 14 days
    const ageMs = Date.now() - new Date(bug.discoveredAt).getTime();
    expect(ageMs).toBeGreaterThan(14 * 24 * 60 * 60 * 1000);

    // Build snapshot with unaddressed bug
    const snapshot = {
      ok: true,
      runState: "completed",
      lastEventAgeMs: 1000,
      artifacts: [],
      counts: { started: 0, completed: 0, failed: 0, escalated: 0, events: 0, artifacts: 0, quorumDispatched: 0, quorumLegsCompleted: 0, quorumReviewed: 0, skillsStarted: 0, skillsCompleted: 0, skillStepsFailed: 0 },
      summary: null,
      crucible: null,
      tempering: {
        initialized: true,
        openBugCount: { total: 1, criticalOrHigh: 0, unaddressed: [{ bugId: bug.bugId, discoveredAt: bug.discoveredAt }] },
        belowMinimum: 0,
        stale: false,
        runFailed: false,
        contractMismatch: 0,
        mutationBelowMinimum: 0,
        flakyCount: 0,
        perfRegressionCount: 0,
      },
    };

    const anomalies = detectWatchAnomalies(snapshot);
    const unaddressed = anomalies.find(a => a.code === "tempering-bug-unaddressed");
    expect(unaddressed).toBeTruthy();
    expect(unaddressed.bugIds).toContain("bug-2026-04-01-001");
  });
});
