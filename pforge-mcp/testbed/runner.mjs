/**
 * Plan Forge — Testbed Runner
 *
 * Phase TESTBED-01 Slice 01
 *
 * Executes a scenario fixture against a testbed repository:
 *   preflight → setup → execute → assertions → teardown
 *
 * DI-based: all external deps injected for testability.
 *
 * @module testbed/runner
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { logFinding } from "./defect-log.mjs";

// ─── Constants ────────────────────────────────────────────────────────
const LOCK_STALE_MS = 60 * 60 * 1000; // 1 hour
const MAX_CAPTURE_BYTES = 100 * 1024;  // 100 KB per step output

// ─── Lock ─────────────────────────────────────────────────────────────

function lockPath(projectRoot) {
  return resolve(projectRoot, ".forge", "testbed.lock");
}

export function acquireLock(projectRoot, hub) {
  const forgeDir = resolve(projectRoot, ".forge");
  if (!existsSync(forgeDir)) mkdirSync(forgeDir, { recursive: true });

  const lp = lockPath(projectRoot);
  if (existsSync(lp)) {
    try {
      const existing = JSON.parse(readFileSync(lp, "utf-8"));
      const age = Date.now() - new Date(existing.ts).getTime();
      if (age < LOCK_STALE_MS) {
        const err = new Error(`Testbed is locked by PID ${existing.pid} since ${existing.ts}`);
        err.code = "ERR_TESTBED_LOCKED";
        throw err;
      }
      // Stale lock — reclaim with warning
      hub?.broadcast({ type: "testbed-lock-reclaimed", data: { stalePid: existing.pid, staleTs: existing.ts, ageMs: age } });
    } catch (e) {
      if (e.code === "ERR_TESTBED_LOCKED") throw e;
      // Corrupt lock file — overwrite
    }
  }

  writeFileSync(lp, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }), "utf-8");
}

export function releaseLock(projectRoot) {
  const lp = lockPath(projectRoot);
  try { if (existsSync(lp)) unlinkSync(lp); } catch { /* best-effort */ }
}

// ─── Preflight ────────────────────────────────────────────────────────

export function preflight(testbedPath, expectedHead, spawnFn) {
  if (!existsSync(testbedPath)) {
    const err = new Error(`Testbed repo not found at: ${testbedPath}`);
    err.code = "ERR_TESTBED_NOT_FOUND";
    throw err;
  }

  // Check for clean working tree
  let statusOutput;
  try {
    const exec = spawnFn || execSync;
    statusOutput = exec("git status --porcelain", { cwd: testbedPath, encoding: "utf-8", timeout: 10_000 });
  } catch (e) {
    const err = new Error(`Failed to check testbed git status: ${e.message}`);
    err.code = "ERR_TESTBED_GIT";
    throw err;
  }

  if (typeof statusOutput === "string" && statusOutput.trim().length > 0) {
    const err = new Error(`Testbed has uncommitted changes:\n${statusOutput.trim()}`);
    err.code = "ERR_TESTBED_DIRTY";
    throw err;
  }

  // Check HEAD match
  if (expectedHead) {
    let head;
    try {
      const exec = spawnFn || execSync;
      head = exec("git rev-parse HEAD", { cwd: testbedPath, encoding: "utf-8", timeout: 10_000 });
      if (typeof head === "string") head = head.trim();
    } catch (e) {
      const err = new Error(`Failed to read testbed HEAD: ${e.message}`);
      err.code = "ERR_TESTBED_GIT";
      throw err;
    }

    if (head !== expectedHead) {
      const err = new Error(`Testbed HEAD mismatch: expected ${expectedHead}, got ${head}`);
      err.code = "ERR_TESTBED_HEAD_MISMATCH";
      throw err;
    }
  }

  return { ok: true };
}

// ─── Assertion Handlers ───────────────────────────────────────────────

export const ASSERTION_HANDLERS = {
  "file-exists": (a, ctx) => {
    const target = resolve(ctx.testbedPath, a.path);
    const exists = existsSync(target);
    return { passed: exists, kind: "file-exists", detail: exists ? `File exists: ${a.path}` : `File missing: ${a.path}` };
  },

  "file-contains": (a, ctx) => {
    const target = resolve(ctx.testbedPath, a.path);
    if (!existsSync(target)) return { passed: false, kind: "file-contains", detail: `File missing: ${a.path}` };
    const content = readFileSync(target, "utf-8");
    const matched = new RegExp(a.pattern).test(content);
    return { passed: matched, kind: "file-contains", detail: matched ? `Pattern matched in ${a.path}` : `Pattern '${a.pattern}' not found in ${a.path}` };
  },

  "event-emitted": (a, ctx) => {
    const withinMs = a.within || 30_000;
    const cutoff = ctx.startTime - withinMs;
    const matching = (ctx.hubEvents || []).filter(e => e.type === a.eventType && new Date(e.timestamp).getTime() >= cutoff);
    const passed = matching.length > 0;
    return { passed, kind: "event-emitted", detail: passed ? `Event '${a.eventType}' found (${matching.length} match(es))` : `Event '${a.eventType}' not found within ${withinMs}ms` };
  },

  "correlationId-thread": (a, ctx) => {
    const matching = (ctx.hubEvents || []).filter(e => e.correlationId === ctx.correlationId);
    const minSize = a.minSize || 1;
    const passed = matching.length >= minSize;
    return { passed, kind: "correlationId-thread", detail: `${matching.length} events with correlationId (need ≥ ${minSize})` };
  },

  "exit-code": (a, ctx) => {
    const actual = ctx.lastExitCode;
    const expected = a.expected ?? 0;
    const passed = actual === expected;
    return { passed, kind: "exit-code", detail: `Exit code: ${actual} (expected ${expected})` };
  },

  "duration-under": (a, ctx) => {
    const actual = ctx.lastDurationMs;
    const budget = a.budgetMs;
    const passed = actual <= budget;
    return { passed, kind: "duration-under", detail: `Duration ${actual}ms ${passed ? "≤" : ">"} budget ${budget}ms` };
  },

  "artefact-count": (a, ctx) => {
    const dir = resolve(ctx.testbedPath, a.dir || ".forge/runs");
    let count = 0;
    try {
      if (existsSync(dir)) {
        const entries = readdirSync(dir);
        count = entries.length;
      }
    } catch { /* empty */ }
    const min = a.min || 1;
    const passed = count >= min;
    return { passed, kind: "artefact-count", detail: `${count} artefact(s) in ${a.dir || ".forge/runs"} (need ≥ ${min})` };
  },
};

// ─── Step Execution ───────────────────────────────────────────────────

function executeSteps(steps, cwd, spawnFn) {
  const results = [];
  for (const step of steps) {
    const t0 = Date.now();
    let stdout = "", stderr = "", exitCode = 0;
    try {
      const exec = spawnFn || execSync;
      const output = exec(step.cmd || step, { cwd, encoding: "utf-8", timeout: step.timeout || 120_000 });
      stdout = typeof output === "string" ? output.slice(0, MAX_CAPTURE_BYTES) : "";
    } catch (e) {
      exitCode = e.status ?? 1;
      stdout = (e.stdout || "").slice(0, MAX_CAPTURE_BYTES);
      stderr = (e.stderr || "").slice(0, MAX_CAPTURE_BYTES);
    }
    results.push({ cmd: step.cmd || step, stdout, stderr, exitCode, durationMs: Date.now() - t0 });
    if (exitCode !== 0) break; // abort on first failure
  }
  return results;
}

// ─── Main Runner ──────────────────────────────────────────────────────

/**
 * Run a testbed scenario.
 *
 * @param {object} scenario - Parsed scenario fixture
 * @param {object} deps - DI deps: { hub, projectRoot, captureMemoryFn, spawnFn }
 * @returns {Promise<object>} Run result
 */
export async function runScenario(scenario, deps) {
  const { hub, projectRoot, captureMemoryFn, spawnFn } = deps;
  const correlationId = randomUUID();
  const startTime = Date.now();
  const testbedPath = deps.testbedPath;
  const dryRun = deps.dryRun || false;

  hub?.broadcast({ type: "testbed-scenario-started", data: { scenarioId: scenario.scenarioId, correlationId, testbedPath } });

  // Preflight
  preflight(testbedPath, scenario.expectedHead, spawnFn);

  // Lock
  acquireLock(projectRoot, hub);

  const result = {
    scenarioId: scenario.scenarioId,
    correlationId,
    status: "passed",
    durationMs: 0,
    assertions: [],
    findings: [],
    setupResults: [],
    executeResults: [],
    teardownResults: [],
  };

  try {
    // Setup
    if (scenario.setup && scenario.setup.length > 0) {
      result.setupResults = executeSteps(scenario.setup, testbedPath, spawnFn);
      const lastSetup = result.setupResults[result.setupResults.length - 1];
      if (lastSetup && lastSetup.exitCode !== 0) {
        result.status = "setup-failed";
        result.findings.push({
          findingId: `${scenario.scenarioId}-setup-${correlationId.slice(0, 8)}`,
          date: new Date().toISOString().slice(0, 10),
          scenario: scenario.scenarioId,
          severity: "high",
          surface: "cli",
          title: `Setup step failed: ${lastSetup.cmd}`,
          expected: "exit code 0",
          observed: `exit code ${lastSetup.exitCode}`,
          status: "open",
        });
      }
    }

    // Execute (skip in dry-run or if setup failed)
    if (result.status === "passed" && !dryRun) {
      result.executeResults = executeSteps(scenario.execute, testbedPath, spawnFn);
    }

    // Collect hub events for assertion context
    const hubEvents = hub?.eventHistory || [];
    const lastExec = result.executeResults[result.executeResults.length - 1];

    const ctx = {
      testbedPath,
      startTime,
      correlationId,
      hubEvents,
      lastExitCode: lastExec?.exitCode ?? 0,
      lastDurationMs: lastExec?.durationMs ?? 0,
    };

    // Assertions
    for (const assertion of scenario.assertions) {
      const handler = ASSERTION_HANDLERS[assertion.kind];
      if (!handler) {
        result.assertions.push({ passed: false, kind: assertion.kind, detail: `Unknown assertion kind: ${assertion.kind}` });
        continue;
      }
      const ar = handler(assertion, ctx);
      result.assertions.push(ar);

      if (!ar.passed) {
        result.status = "failed";
        const finding = {
          findingId: `${scenario.scenarioId}-${assertion.kind}-${correlationId.slice(0, 8)}`,
          date: new Date().toISOString().slice(0, 10),
          scenario: scenario.scenarioId,
          severity: assertion.severity || "medium",
          surface: assertion.surface || "cli",
          title: `Assertion failed: ${assertion.kind}`,
          expected: assertion.expected || ar.detail,
          observed: ar.detail,
          status: "open",
        };
        result.findings.push(finding);
        try {
          logFinding(finding, { hub, projectRoot });
        } catch { /* defect-log write is best-effort during runs */ }
      }
    }

    // L3 memory capture for high/blocker findings
    if (captureMemoryFn) {
      for (const f of result.findings) {
        if (f.severity === "blocker" || f.severity === "high") {
          try {
            captureMemoryFn(
              `Testbed finding [${f.severity}]: ${f.title} — expected: ${f.expected}, observed: ${f.observed}`,
              "testbed-finding",
              `testbed/${scenario.scenarioId}`,
              projectRoot,
            );
          } catch { /* best-effort */ }
        }
      }
    }
  } finally {
    // Teardown (always runs, skip in dry-run)
    if (!dryRun && scenario.teardown && scenario.teardown.length > 0) {
      try {
        result.teardownResults = executeSteps(scenario.teardown, testbedPath, spawnFn);
      } catch { /* teardown failure must not mask assertion results */ }
    }

    releaseLock(projectRoot);
  }

  result.durationMs = Date.now() - startTime;

  hub?.broadcast({
    type: "testbed-scenario-completed",
    data: {
      scenarioId: scenario.scenarioId,
      correlationId,
      status: result.status,
      failedAssertions: result.assertions.filter(a => !a.passed).length,
      durationMs: result.durationMs,
    },
  });

  return result;
}
