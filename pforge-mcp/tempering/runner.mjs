/**
 * Plan Forge — Tempering: execution orchestrator (Phase TEMPER-02 Slice 02.1)
 *
 * First phase that actually *runs* code. TEMPER-01 was read-only —
 * it scanned pre-existing coverage reports. This module owns the
 * subprocess boundary that executes test suites and parses their output.
 *
 * Design contracts (non-negotiable):
 *   - Handlers never throw. Always return `{ ok, ... }` shapes.
 *   - Subprocess is abort-able against `config.runtimeBudgets.<scanner>MaxMs`.
 *     SIGTERM first, SIGKILL 2s later if the process ignores it.
 *   - Tests inject `spawn` + `now` + `adapter` overrides — nothing in
 *     this file reaches the real filesystem or the real child_process
 *     module when a test provides overrides.
 *   - Scope contract (from Phase-TEMPER-02.md):
 *       * MUST NOT edit production source during a run
 *       * MUST NOT create bugs (TEMPER-06 owns that)
 *       * MUST NOT invoke itself recursively
 *
 * @module tempering/runner
 */

import { spawn as realSpawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  readTemperingConfig,
  detectStack,
  ensureTemperingDirs,
} from "../tempering.mjs";
import { loadAdapter, validateAdapterEntry, SUPPORTED_STACKS_SLICE_02_1 } from "./adapters.mjs";
// TEMPER-06 Slice 06.1 — Bug registry + classifier
import { classify as realClassify } from "./bug-classifier.mjs";
import { registerBug as realRegisterBug } from "./bug-registry.mjs";

// ─── Constants ────────────────────────────────────────────────────────

/** Kill grace period between SIGTERM and SIGKILL. */
const KILL_GRACE_MS = 2000;

/** Default per-scanner budget fallback (matches tempering.mjs). */
const DEFAULT_UNIT_BUDGET_MS = 120000;

// ─── Hub event helper (mirrors tempering.mjs) ─────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Subprocess boundary ──────────────────────────────────────────────

/**
 * Execute a command and return its stdout/stderr/exitCode, with a
 * hard timeout. Pure function of its inputs when `spawnFn` is injected.
 *
 * Behaviour:
 *   - Never throws. Errors are captured as `{ exitCode: -1, error }`.
 *   - On timeout: `timedOut: true`, SIGTERM, then SIGKILL after 2s.
 *   - On spawn error (ENOENT / command not found): `{ exitCode: -1, error }`.
 *
 * @param {string[]} cmd        - argv, e.g. ["npx", "vitest", "run"]
 * @param {{ cwd: string, budgetMs: number, spawn?: Function, env?: object }} opts
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number, timedOut: boolean, error?: string, durationMs: number }>}
 */
export function runSubprocess(cmd, { cwd, budgetMs, spawn: spawnFn = realSpawn, env } = {}) {
  return new Promise((settle) => {
    if (!Array.isArray(cmd) || cmd.length === 0) {
      settle({ stdout: "", stderr: "", exitCode: -1, timedOut: false, error: "empty-cmd", durationMs: 0 });
      return;
    }
    const [bin, ...args] = cmd;
    const t0 = Date.now();
    let proc;
    try {
      proc = spawnFn(bin, args, {
        cwd,
        shell: false,
        windowsHide: true,
        env: env || process.env,
      });
    } catch (err) {
      settle({ stdout: "", stderr: "", exitCode: -1, timedOut: false, error: err.message, durationMs: 0 });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const done = (outcome) => {
      if (settled) return;
      settled = true;
      try { clearTimeout(timer); } catch { /* ignore */ }
      try { clearTimeout(killer); } catch { /* ignore */ }
      settle({ ...outcome, durationMs: Date.now() - t0 });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill("SIGTERM"); } catch { /* best-effort */ }
    }, Math.max(1, budgetMs || DEFAULT_UNIT_BUDGET_MS));

    const killer = setTimeout(() => {
      if (!settled) {
        try { proc.kill("SIGKILL"); } catch { /* best-effort */ }
      }
    }, Math.max(1, budgetMs || DEFAULT_UNIT_BUDGET_MS) + KILL_GRACE_MS);

    if (proc.stdout) proc.stdout.on("data", (d) => { stdout += d.toString(); });
    if (proc.stderr) proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("error", (err) => {
      done({ stdout, stderr, exitCode: -1, timedOut, error: err.message });
    });
    proc.on("close", (code, signal) => {
      // timeout-triggered SIGTERM returns code=null, signal=SIGTERM
      done({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : -1,
        timedOut,
        error: signal && timedOut ? `killed-${signal}` : undefined,
      });
    });
  });
}

// ─── Regression-first ordering ────────────────────────────────────────

/**
 * Pick the changed-files list for regression-first ordering. Returns
 * an array of file paths relative to `cwd`, or `[]` when we can't or
 * shouldn't narrow. Never throws.
 *
 * This is a hint to the adapter, not an enforcement — adapters decide
 * whether to honour it (e.g. `vitest --changed` supports it natively).
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string|null} opts.lastGreenSha
 * @param {Function} [opts.gitSpawn]     - injectable for tests
 * @returns {Promise<string[]>}
 */
export async function pickChangedFiles({ cwd, lastGreenSha, gitSpawn = realSpawn } = {}) {
  if (!lastGreenSha || typeof lastGreenSha !== "string") return [];
  const result = await runSubprocess(
    ["git", "diff", "--name-only", `${lastGreenSha}..HEAD`],
    { cwd, budgetMs: 5000, spawn: gitSpawn },
  );
  if (result.exitCode !== 0 || !result.stdout) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// ─── Per-scanner runners ──────────────────────────────────────────────

/**
 * Budget-key map: scanner id → config.runtimeBudgets key.
 * Keeps the generic runner free of scanner-specific branching.
 */
const SCANNER_BUDGET_KEYS = Object.freeze({
  unit: "unitMaxMs",
  integration: "integrationMaxMs",
  "visual-diff": "visualDiffMaxMs",
  flakiness: "flakinessMaxMs",
  "performance-budget": "perfBudgetMaxMs",
  "load-stress": "loadStressMaxMs",
  mutation: "mutationMaxMs",
});

/**
 * Generic scanner runner — the same orchestration logic for any
 * scanner whose adapter entry has `{ supported, cmd, parseOutput }`.
 * Pure function of its inputs when `spawnFn`, `now`, `adapter` are
 * injected.
 *
 * @param {object} ctx
 * @param {string} ctx.scanner           - "unit" | "integration" (future: "ui-playwright" …)
 * @param {object} ctx.config            - loaded tempering config
 * @param {string} ctx.stack
 * @param {object|null} ctx.adapter
 * @param {{plan:string, slice:string}|null} ctx.sliceRef
 * @param {string} ctx.cwd
 * @param {Function} [ctx.spawn]
 * @param {Function} [ctx.now]
 * @returns {Promise<object>} scanner result record
 */
export async function runScanner(ctx) {
  const {
    scanner,
    config,
    stack,
    adapter,
    sliceRef = null,
    cwd,
    spawn: spawnFn = realSpawn,
    now = () => Date.now(),
  } = ctx || {};

  const t0 = now();
  const base = {
    scanner,
    stack,
    sliceRef,
    startedAt: new Date(t0).toISOString(),
  };
  const skippedFrame = (reason) => ({
    ...base,
    skipped: true,
    reason,
    verdict: "skipped",
    durationMs: 0,
    completedAt: new Date(now()).toISOString(),
  });

  if (!scanner) return skippedFrame("missing-scanner-id");

  // Scanner globally disabled
  if (!config || !config.scanners || config.scanners[scanner] === false) {
    return skippedFrame("scanner-disabled");
  }

  // No adapter for this stack
  if (!adapter || !adapter[scanner]) {
    return skippedFrame("no-adapter");
  }

  const check = validateAdapterEntry(adapter[scanner]);
  if (!check.ok) return skippedFrame(`invalid-adapter:${check.reason}`);

  // Explicit unsupported stub
  if (adapter[scanner].supported === false) {
    return skippedFrame(adapter[scanner].reason || "stack-not-supported");
  }

  const budgetKey = SCANNER_BUDGET_KEYS[scanner] || `${scanner}MaxMs`;
  const budgetMs = (config.runtimeBudgets && config.runtimeBudgets[budgetKey]) || DEFAULT_UNIT_BUDGET_MS;

  const proc = await runSubprocess(adapter[scanner].cmd, { cwd, budgetMs, spawn: spawnFn });

  let parsed = { pass: 0, fail: 0, skipped: 0, coverage: null };
  try {
    parsed = adapter[scanner].parseOutput(proc.stdout, proc.stderr, proc.exitCode) || parsed;
  } catch (err) {
    parsed = { pass: 0, fail: 0, skipped: 0, coverage: null, parseError: err.message };
  }

  const durationMs = now() - t0;

  let verdict;
  if (proc.timedOut) verdict = "budget-exceeded";
  else if (proc.error && proc.exitCode === -1) verdict = "error";
  else if ((parsed.fail || 0) > 0) verdict = "fail";
  else if (proc.exitCode !== 0) verdict = "fail";
  else verdict = "pass";

  return {
    ...base,
    completedAt: new Date(now()).toISOString(),
    cmd: adapter[scanner].cmd,
    exitCode: proc.exitCode,
    timedOut: proc.timedOut,
    error: proc.error || null,
    pass: parsed.pass || 0,
    fail: parsed.fail || 0,
    skipped: parsed.skipped || 0,
    coverage: parsed.coverage || null,
    parseError: parsed.parseError || null,
    durationMs,
    verdict,
  };
}

/**
 * Back-compat wrapper — Slice 02.1 shipped `runScannerUnit` as the
 * public API; Slice 02.2 generalises it to `runScanner`. The wrapper
 * keeps any external callers that imported `runScannerUnit` working.
 */
export function runScannerUnit(ctx) {
  return runScanner({ ...ctx, scanner: "unit" });
}

/**
 * Integration-scanner entry point (TEMPER-02 Slice 02.2). Same
 * contract as `runScannerUnit` — just routes through the generic
 * runner with `scanner: "integration"`.
 */
export function runScannerIntegration(ctx) {
  return runScanner({ ...ctx, scanner: "integration" });
}

// ─── Top-level dispatcher ─────────────────────────────────────────────

// TEMPER-06 Slice 06.1 — Extract failures from a scanner result.
// Per-scanner normalizer: each scanner shape may encode failures
// differently. This function returns a uniform `{ evidence, severity }` array.
function extractFailures(scannerResult) {
  if (!scannerResult || scannerResult.skipped || scannerResult.verdict === "skipped" || scannerResult.verdict === "pass") return [];
  const failures = [];

  // If scanner already has a `failures` array, use it directly
  if (Array.isArray(scannerResult.failures)) {
    for (const f of scannerResult.failures) {
      failures.push({
        evidence: f.evidence || f,
        severity: f.severity || (scannerResult.verdict === "error" ? "high" : "medium"),
      });
    }
    return failures;
  }

  // Regressions array (visual-diff, perf-budget)
  if (Array.isArray(scannerResult.regressions)) {
    for (const r of scannerResult.regressions) {
      failures.push({
        evidence: {
          testName: r.url || r.urlHash || r.name || `${scannerResult.scanner}-regression`,
          assertionMessage: r.explanation || r.verdict || "regression detected",
          visualDiffScore: r.diffScore || r.score || null,
          quorumVerdict: r.quorumVerdict || null,
        },
        severity: r.severity || "medium",
      });
    }
    return failures;
  }

  // Violations array (contract scanner)
  if (Array.isArray(scannerResult.violations)) {
    for (const v of scannerResult.violations) {
      failures.push({
        evidence: {
          testName: v.path || v.endpoint || `${scannerResult.scanner}-violation`,
          assertionMessage: v.message || v.description || "contract violation",
          violation: true,
        },
        severity: v.severity || "medium",
      });
    }
    return failures;
  }

  // Generic: scanner failed but no structured failures — synthesize one
  if (scannerResult.fail > 0 || scannerResult.verdict === "fail" || scannerResult.verdict === "error") {
    failures.push({
      evidence: {
        testName: `${scannerResult.scanner}-failure`,
        assertionMessage: scannerResult.error || scannerResult.reason || `${scannerResult.scanner} ${scannerResult.verdict}`,
        stackTrace: scannerResult.stderr || null,
      },
      severity: scannerResult.verdict === "error" ? "high" : "medium",
    });
  }

  return failures;
}

/**
 * forge_tempering_run — execute enabled scanners, write a run record,
 * emit hub events per scanner. Slice 02.1 runs the **unit** scanner
 * only; Slice 02.2 adds integration; later phases add UI/visual/load.
 *
 * Writes `.forge/tempering/run-<ts>.json`. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {object} [opts.hub]
 * @param {string} [opts.correlationId]
 * @param {{plan:string, slice:string}} [opts.sliceRef]
 * @param {string|null} [opts.lastGreenSha]   - for regression-first ordering
 * @param {Function} [opts.spawn]
 * @param {Function} [opts.importFn]          - for loadAdapter injection
 * @param {object}   [opts.adapter]           - direct override (tests)
 * @param {Function} [opts.now]
 * @returns {Promise<object>}
 */
export async function runTemperingRun(opts = {}) {
  const {
    projectDir,
    hub = null,
    correlationId = null,
    sliceRef = null,
    lastGreenSha = null,
    spawn: spawnFn = realSpawn,
    importFn,
    adapter: adapterOverride = null,
    now = () => Date.now(),
    // TEMPER-03 Slice 03.1 — UI scanner dependency injection.
    // Lets tests mock Playwright + axe-core without installing them.
    // `uiScannerImpl` overrides the real scanner entirely, used in
    // the tests that need to exercise runTemperingRun wiring without
    // going through the full crawler logic.
    uiImportFn = null,
    uiScannerImpl = null,
    // TEMPER-03 Slice 03.2 — Contract scanner dependency injection.
    contractScannerImpl = null,
    // TEMPER-04 Slice 04.1 — Visual-diff scanner dependency injection.
    visualDiffScannerImpl = null,
    // TEMPER-04 Slice 04.2 — L3 capture callback for visual-diff quorum.
    captureMemory = null,
    // TEMPER-05 Slice 05.1 — Flakiness, perf-budget, load-stress DI.
    flakinessScannerImpl = null,
    perfBudgetScannerImpl = null,
    loadStressScannerImpl = null,
    // TEMPER-05 Slice 05.2 — Mutation scanner dependency injection.
    mutationScannerImpl = null,
    // TEMPER-06 Slice 06.1 — Bug registry + classifier DI.
    // `classifyFn` and `registerBugFn` override the real classify/registerBug
    // for tests. `callModel` is threaded to the classifier's LLM layer.
    classifyFn = null,
    registerBugFn = null,
    callModel = null,
    env = process.env,
  } = opts;

  const corr = correlationId || `temper-run-${randomUUID()}`;
  const startedAt = new Date(now()).toISOString();
  // Hoisted early so artifact-producing scanners can write under a
  // stable `<runId>/` directory before the final record is persisted.
  const runId = `run-${startedAt.replace(/[:.]/g, "-")}`;

  if (!projectDir || typeof projectDir !== "string") {
    return { ok: false, error: "projectDir required", code: "missing-projectDir", correlationId: corr };
  }

  // Seed dirs + config if first run (TEMPER-01 contract)
  const { dir: temperingDir, configWritten } = ensureTemperingDirs(projectDir);
  const config = readTemperingConfig(projectDir);

  // Global disable — respect `enabled: false`
  if (config.enabled === false) {
    emit(hub, "tempering-run-skipped", { correlationId: corr, reason: "disabled" });
    return {
      ok: true,
      skipped: true,
      reason: "tempering-disabled",
      correlationId: corr,
      configWritten,
    };
  }

  const stack = detectStack(projectDir);

  emit(hub, "tempering-run-started", {
    correlationId: corr,
    projectDir,
    stack,
    sliceRef,
    configWritten,
  });

  // Load adapter (or honour override)
  let adapter = adapterOverride;
  if (!adapter) {
    adapter = await loadAdapter(stack, { importFn });
  }

  // Regression-first hint (best-effort; adapter decides whether to use it)
  let changedFiles = [];
  if (config.execution && config.execution.regressionFirst && lastGreenSha) {
    changedFiles = await pickChangedFiles({ cwd: projectDir, lastGreenSha, gitSpawn: spawnFn });
  }

  // ── Unit scanner ──
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "unit", stack });

  const unitResult = await runScanner({
    scanner: "unit",
    config,
    stack,
    adapter,
    sliceRef,
    cwd: projectDir,
    spawn: spawnFn,
    now,
  });

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "unit",
    stack,
    verdict: unitResult.verdict,
    pass: unitResult.pass,
    fail: unitResult.fail,
    skipped: unitResult.skipped,
    durationMs: unitResult.durationMs,
  });

  // ── Integration scanner (TEMPER-02 Slice 02.2) ──
  // Ordered after unit so a failing unit suite short-circuits the
  // budget: if unit already blew the runtime budget, integration is
  // skipped with reason "prior-budget-exceeded" rather than compounding.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "integration", stack });

  let integrationResult;
  if (unitResult.verdict === "budget-exceeded") {
    integrationResult = {
      scanner: "integration",
      stack,
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: "prior-budget-exceeded",
      verdict: "skipped",
      durationMs: 0,
    };
  } else {
    integrationResult = await runScanner({
      scanner: "integration",
      config,
      stack,
      adapter,
      sliceRef,
      cwd: projectDir,
      spawn: spawnFn,
      now,
    });
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "integration",
    stack,
    verdict: integrationResult.verdict,
    pass: integrationResult.pass || 0,
    fail: integrationResult.fail || 0,
    skipped: integrationResult.skipped || 0,
    durationMs: integrationResult.durationMs || 0,
  });

  // ── UI sweep scanner (TEMPER-03 Slice 03.1) ──
  // Cross-stack scanner — runs against a deployed app URL rather
  // than source code. Loaded lazily so missing Playwright / axe-core
  // installs don't force the unit+integration path to fail.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "ui-playwright", stack });

  let uiResult;
  try {
    // Short-circuit when prior scanner exhausted the overall budget.
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded";
    if (priorBudgetExceeded) {
      uiResult = {
        scanner: "ui-playwright",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (uiScannerImpl) {
      uiResult = await uiScannerImpl({
        config, projectDir, runId, sliceRef, now, env, importFn: uiImportFn,
      });
    } else {
      const { runUiSweep } = await import("./scanners/ui-playwright.mjs");
      uiResult = await runUiSweep({
        config, projectDir, runId, sliceRef, now, env,
        importFn: uiImportFn || ((spec) => import(spec)),
      });
    }
  } catch (err) {
    // Absolute last-resort — the scanner module itself failed to load
    // or blew up before returning its own error frame. Keep the run
    // alive and surface the failure in the record.
    uiResult = {
      scanner: "ui-playwright",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "ui-playwright",
    stack,
    verdict: uiResult.verdict,
    pass: uiResult.pass || 0,
    fail: uiResult.fail || 0,
    skipped: uiResult.skipped ? 1 : 0,
    durationMs: uiResult.durationMs || 0,
  });

  // ── Contract scanner (TEMPER-03 Slice 03.2) ──
  // Cross-stack scanner — validates live API against OpenAPI / GraphQL
  // specs. Loaded lazily so missing js-yaml doesn't affect the other
  // scanners. Modeled exactly on the UI phase above.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "contract", stack });

  let contractResult;
  try {
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded"
      || uiResult.verdict === "budget-exceeded";
    if (priorBudgetExceeded) {
      contractResult = {
        scanner: "contract",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (contractScannerImpl) {
      contractResult = await contractScannerImpl({
        config, projectDir, runId, sliceRef, now, env, importFn,
      });
    } else {
      const { runContractScan } = await import("./scanners/contract.mjs");
      contractResult = await runContractScan({
        config, projectDir, runId, sliceRef, now, env,
        importFn: importFn || ((spec) => import(spec)),
      });
    }
  } catch (err) {
    contractResult = {
      scanner: "contract",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "contract",
    stack,
    verdict: contractResult.verdict,
    pass: contractResult.pass || 0,
    fail: contractResult.fail || 0,
    skipped: contractResult.skipped ? 1 : 0,
    durationMs: contractResult.durationMs || 0,
  });

  // ── Visual-diff scanner (TEMPER-04 Slice 04.1) ──
  // Cross-stack scanner — pixel-diffs screenshots against baselines.
  // Loaded lazily so missing pixelmatch/pngjs doesn't affect other scanners.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "visual-diff", stack });

  let visualDiffResult;
  try {
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded"
      || uiResult.verdict === "budget-exceeded"
      || contractResult.verdict === "budget-exceeded";
    const visualDiffEnabled = config.scanners?.["visual-diff"] !== false
      && config.visualAnalyzer?.enabled !== false;
    if (priorBudgetExceeded) {
      visualDiffResult = {
        scanner: "visual-diff",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (!visualDiffEnabled) {
      visualDiffResult = {
        scanner: "visual-diff",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "scanner-disabled",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (visualDiffScannerImpl) {
      visualDiffResult = await visualDiffScannerImpl({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
      });
    } else {
      const { runVisualDiffScan } = await import("./scanners/visual-diff.mjs");
      visualDiffResult = await runVisualDiffScan({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
      });
    }
  } catch (err) {
    visualDiffResult = {
      scanner: "visual-diff",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "visual-diff",
    stack,
    verdict: visualDiffResult.verdict,
    pass: visualDiffResult.pass || 0,
    fail: visualDiffResult.fail || 0,
    skipped: visualDiffResult.skipped ? 1 : 0,
    durationMs: visualDiffResult.durationMs || 0,
  });

  // ── Flakiness scanner (TEMPER-05 Slice 05.1) ──
  // Cross-stack scanner — analyzes run history for flaky tests.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "flakiness", stack });

  let flakinessResult;
  try {
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded"
      || uiResult.verdict === "budget-exceeded"
      || contractResult.verdict === "budget-exceeded"
      || visualDiffResult.verdict === "budget-exceeded";
    if (priorBudgetExceeded) {
      flakinessResult = {
        scanner: "flakiness",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (flakinessScannerImpl) {
      flakinessResult = await flakinessScannerImpl({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
      });
    } else {
      const { runFlakinessScan } = await import("./scanners/flakiness.mjs");
      flakinessResult = await runFlakinessScan({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
      });
    }
  } catch (err) {
    flakinessResult = {
      scanner: "flakiness",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "flakiness",
    stack,
    verdict: flakinessResult.verdict,
    pass: flakinessResult.pass || 0,
    fail: flakinessResult.fail || 0,
    skipped: flakinessResult.skipped ? 1 : 0,
    durationMs: flakinessResult.durationMs || 0,
  });

  // ── Performance Budget scanner (TEMPER-05 Slice 05.1) ──
  // Cross-stack scanner — compares p95 latencies against baselines.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "performance-budget", stack });

  let perfBudgetResult;
  try {
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded"
      || uiResult.verdict === "budget-exceeded"
      || contractResult.verdict === "budget-exceeded"
      || visualDiffResult.verdict === "budget-exceeded"
      || flakinessResult.verdict === "budget-exceeded";
    if (priorBudgetExceeded) {
      perfBudgetResult = {
        scanner: "performance-budget",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (perfBudgetScannerImpl) {
      perfBudgetResult = await perfBudgetScannerImpl({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
        importFn: importFn || ((spec) => import(spec)),
      });
    } else {
      const { runPerformanceBudgetScan } = await import("./scanners/performance-budget.mjs");
      perfBudgetResult = await runPerformanceBudgetScan({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
        importFn: importFn || ((spec) => import(spec)),
      });
    }
  } catch (err) {
    perfBudgetResult = {
      scanner: "performance-budget",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "performance-budget",
    stack,
    verdict: perfBudgetResult.verdict,
    pass: perfBudgetResult.pass || 0,
    fail: perfBudgetResult.fail || 0,
    skipped: perfBudgetResult.skipped ? 1 : 0,
    durationMs: perfBudgetResult.durationMs || 0,
  });

  // ── Load / Stress scanner (TEMPER-05 Slice 05.1) ──
  // Cross-stack scanner — drives HTTP load via autocannon.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "load-stress", stack });

  let loadStressResult;
  try {
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded"
      || uiResult.verdict === "budget-exceeded"
      || contractResult.verdict === "budget-exceeded"
      || visualDiffResult.verdict === "budget-exceeded"
      || flakinessResult.verdict === "budget-exceeded"
      || perfBudgetResult.verdict === "budget-exceeded";
    if (priorBudgetExceeded) {
      loadStressResult = {
        scanner: "load-stress",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (loadStressScannerImpl) {
      loadStressResult = await loadStressScannerImpl({
        config, projectDir, runId, sliceRef, now, env, hub,
        importFn: importFn || ((spec) => import(spec)),
      });
    } else {
      const { runLoadStressScan } = await import("./scanners/load-stress.mjs");
      loadStressResult = await runLoadStressScan({
        config, projectDir, runId, sliceRef, now, env, hub,
        importFn: importFn || ((spec) => import(spec)),
      });
    }
  } catch (err) {
    loadStressResult = {
      scanner: "load-stress",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "load-stress",
    stack,
    verdict: loadStressResult.verdict,
    pass: loadStressResult.pass || 0,
    fail: loadStressResult.fail || 0,
    skipped: loadStressResult.skipped ? 1 : 0,
    durationMs: loadStressResult.durationMs || 0,
  });

  // ── Mutation scanner (TEMPER-05 Slice 05.2) ──
  // 9th scanner — drives mutation testing via stack adapter.
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "mutation", stack });

  let mutationResult;
  try {
    const priorBudgetExceeded = unitResult.verdict === "budget-exceeded"
      || integrationResult.verdict === "budget-exceeded"
      || uiResult.verdict === "budget-exceeded"
      || contractResult.verdict === "budget-exceeded"
      || visualDiffResult.verdict === "budget-exceeded"
      || flakinessResult.verdict === "budget-exceeded"
      || perfBudgetResult.verdict === "budget-exceeded"
      || loadStressResult.verdict === "budget-exceeded";
    if (priorBudgetExceeded) {
      mutationResult = {
        scanner: "mutation",
        sliceRef,
        startedAt: new Date(now()).toISOString(),
        completedAt: new Date(now()).toISOString(),
        skipped: true,
        reason: "prior-budget-exceeded",
        verdict: "skipped",
        pass: 0, fail: 0,
        durationMs: 0,
      };
    } else if (mutationScannerImpl) {
      mutationResult = await mutationScannerImpl({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
      });
    } else {
      const { runMutationScan } = await import("./scanners/mutation.mjs");
      mutationResult = await runMutationScan({
        config, projectDir, runId, sliceRef, now, env, hub, captureMemory,
      });
    }
  } catch (err) {
    mutationResult = {
      scanner: "mutation",
      sliceRef,
      startedAt: new Date(now()).toISOString(),
      completedAt: new Date(now()).toISOString(),
      skipped: true,
      reason: `scanner-load-failed:${err.message || err}`,
      verdict: "skipped",
      pass: 0, fail: 0,
      durationMs: 0,
    };
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: "mutation",
    stack,
    verdict: mutationResult.verdict,
    pass: mutationResult.pass || 0,
    fail: mutationResult.fail || 0,
    skipped: mutationResult.skipped ? 1 : 0,
    durationMs: mutationResult.durationMs || 0,
  });

  // Overall verdict: worst of the scanner verdicts
  const scanners = [unitResult, integrationResult, uiResult, contractResult, visualDiffResult, flakinessResult, perfBudgetResult, loadStressResult, mutationResult];
  const overallVerdict = deriveOverallVerdict(scanners);

  // ── TEMPER-06 Slice 06.1 — Bug registration hook ──
  // Iterate scanner failures, classify, and register bugs.
  // DI: classifyFn/registerBugFn let tests bypass real classifier/registry.
  const _classify = classifyFn || realClassify;
  const _registerBug = registerBugFn || realRegisterBug;
  const registeredBugs = [];
  const infraFixes = [];

  for (const scannerResult of scanners) {
    const failures = extractFailures(scannerResult);
    for (const failure of failures) {
      try {
        const classification = await _classify({
          scanner: scannerResult.scanner,
          evidence: failure.evidence,
          flakinessData: null,  // loadFlakinessData called by higher-level caller when needed
          callModel,
          config,
        });
        const bugResult = _registerBug({
          cwd: projectDir,
          scanner: scannerResult.scanner,
          severity: failure.severity,
          evidence: failure.evidence,
          correlationId: corr,
          sliceRef,
          classification: classification.classification,
          classifierMeta: classification,
          hub,
          captureMemory,
        });
        if (classification.classification === "infra") {
          infraFixes.push({
            scanner: scannerResult.scanner,
            testName: failure.evidence.testName,
            rule: classification.rule,
          });
        } else if (bugResult.ok) {
          registeredBugs.push(bugResult.bugId);
        }
      } catch { /* bug registration is best-effort */ }
    }
  }

  const completedAt = new Date(now()).toISOString();

  const runRecord = {
    runId,
    correlationId: corr,
    startedAt,
    completedAt,
    stack,
    sliceRef,
    changedFilesCount: changedFiles.length,
    lastGreenSha,
    scanners,
    verdict: overallVerdict,
    infraFixes,
    registeredBugs,
    phase: "TEMPER-06",
    slice: "06.1",
  };

  // Persist — best-effort
  const outPath = resolve(temperingDir, `${runId}.json`);
  try {
    if (!existsSync(temperingDir)) mkdirSync(temperingDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(runRecord, null, 2) + "\n", "utf-8");
  } catch { /* best-effort */ }

  // Compact completion event — primitives only, mirrors tempering-scan-completed.
  // `pass`/`fail`/`skipped` are cross-scanner totals so dashboards can
  // render a single summary chip per run without loading the record.
  const totals = scanners.reduce((acc, s) => ({
    pass: acc.pass + (s.pass || 0),
    fail: acc.fail + (s.fail || 0),
    skipped: acc.skipped + (s.skipped || 0),
    durationMs: acc.durationMs + (s.durationMs || 0),
  }), { pass: 0, fail: 0, skipped: 0, durationMs: 0 });

  emit(hub, "tempering-run-completed", {
    correlationId: corr,
    runId,
    stack,
    verdict: overallVerdict,
    scannerCount: scanners.length,
    pass: totals.pass,
    fail: totals.fail,
    skipped: totals.skipped,
    durationMs: totals.durationMs,
    sliceRef,
  });

  return {
    ok: true,
    runId,
    correlationId: corr,
    stack,
    verdict: overallVerdict,
    scanners,
    runRecordPath: outPath,
    configWritten,
    changedFilesCount: changedFiles.length,
  };
}

/**
 * Derive a single run-level verdict from scanner verdicts.
 * Priority: error > budget-exceeded > fail > pass > skipped.
 */
export function deriveOverallVerdict(scanners) {
  if (!Array.isArray(scanners) || scanners.length === 0) return "skipped";
  const order = ["error", "budget-exceeded", "fail", "pass", "skipped"];
  let worst = "skipped";
  for (const s of scanners) {
    const v = s && s.verdict ? s.verdict : "skipped";
    if (order.indexOf(v) < order.indexOf(worst)) worst = v;
  }
  return worst;
}
