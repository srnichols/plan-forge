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
  "content-audit": "contentAuditMaxMs",
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
function _checkScannerSkipReason(scanner, config, adapter) {
  if (!scanner) return "missing-scanner-id";
  if (!config || !config.scanners || config.scanners[scanner] === false) return "scanner-disabled";
  if (!adapter || !adapter[scanner]) return "no-adapter";
  const check = validateAdapterEntry(adapter[scanner]);
  if (!check.ok) return `invalid-adapter:${check.reason}`;
  if (adapter[scanner].supported === false) return adapter[scanner].reason || "stack-not-supported";
  return null;
}

function _computeScannerVerdict(proc, parsed) {
  if (proc.timedOut) return "budget-exceeded";
  if (proc.error && proc.exitCode === -1) return "error";
  if ((parsed.fail || 0) > 0) return "fail";
  if (proc.exitCode !== 0) return "fail";
  return "pass";
}

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
  const base = { scanner, stack, sliceRef, startedAt: new Date(t0).toISOString() };
  const skippedFrame = (reason) => ({
    ...base, skipped: true, reason, verdict: "skipped", durationMs: 0,
    completedAt: new Date(now()).toISOString(),
  });

  const skipReason = _checkScannerSkipReason(scanner, config, adapter);
  if (skipReason) return skippedFrame(skipReason);

  const budgetKey = SCANNER_BUDGET_KEYS[scanner] || `${scanner}MaxMs`;
  const budgetMs = (config.runtimeBudgets && config.runtimeBudgets[budgetKey]) || DEFAULT_UNIT_BUDGET_MS;

  const proc = await runSubprocess(adapter[scanner].cmd, { cwd, budgetMs, spawn: spawnFn });

  let parsed = { pass: 0, fail: 0, skipped: 0, coverage: null };
  try {
    parsed = adapter[scanner].parseOutput(proc.stdout, proc.stderr, proc.exitCode) || parsed;
  } catch (err) {
    parsed = { pass: 0, fail: 0, skipped: 0, coverage: null, parseError: err.message };
  }

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
    durationMs: now() - t0,
    verdict: _computeScannerVerdict(proc, parsed),
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
function _extractFromFailuresArray(scannerResult) {
  return scannerResult.failures.map((f) => ({
    evidence: f.evidence || f,
    severity: f.severity || (scannerResult.verdict === "error" ? "high" : "medium"),
  }));
}

function _extractFromRegressionsArray(scannerResult) {
  return scannerResult.regressions.map((r) => ({
    evidence: {
      testName: r.url || r.urlHash || r.name || `${scannerResult.scanner}-regression`,
      assertionMessage: r.explanation || r.verdict || "regression detected",
      visualDiffScore: r.diffScore || r.score || null,
      quorumVerdict: r.quorumVerdict || null,
    },
    severity: r.severity || "medium",
  }));
}

function _extractFromViolationsArray(scannerResult) {
  return scannerResult.violations.map((v) => ({
    evidence: {
      testName: v.path || v.endpoint || `${scannerResult.scanner}-violation`,
      assertionMessage: v.message || v.description || "contract violation",
      violation: true,
    },
    severity: v.severity || "medium",
  }));
}

function _extractGenericFailure(scannerResult) {
  if (scannerResult.fail <= 0 && scannerResult.verdict !== "fail" && scannerResult.verdict !== "error") return [];
  return [{
    evidence: {
      testName: `${scannerResult.scanner}-failure`,
      assertionMessage: scannerResult.error || scannerResult.reason || `${scannerResult.scanner} ${scannerResult.verdict}`,
      stackTrace: scannerResult.stderr || null,
    },
    severity: scannerResult.verdict === "error" ? "high" : "medium",
  }];
}

function extractFailures(scannerResult) {
  if (!scannerResult || scannerResult.skipped || scannerResult.verdict === "skipped" || scannerResult.verdict === "pass") return [];
  if (Array.isArray(scannerResult.failures)) return _extractFromFailuresArray(scannerResult);
  if (Array.isArray(scannerResult.regressions)) return _extractFromRegressionsArray(scannerResult);
  if (Array.isArray(scannerResult.violations)) return _extractFromViolationsArray(scannerResult);
  return _extractGenericFailure(scannerResult);
}

// ─── Tempering run sub-helpers (Phase ESLINT-D1/D2 — extracted) ───────

function _crossStackSkippedResult(name, sliceRef, now, reason) {
  const ts = new Date(now()).toISOString();
  return {
    scanner: name,
    sliceRef,
    startedAt: ts,
    completedAt: ts,
    skipped: true,
    reason,
    verdict: "skipped",
    pass: 0,
    fail: 0,
    durationMs: 0,
  };
}

async function _runCrossStackScannerStep(opts) {
  const {
    name,
    sliceRef,
    now,
    hub,
    corr,
    stack,
    priorScanners,
    enabled = true,
    disabledReason = "scanner-disabled",
    invokeInjected = null,
    invokeDefault,
  } = opts;

  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: name, stack });

  let result;
  const priorBudgetExceeded = priorScanners.some((s) => s && s.verdict === "budget-exceeded");
  try {
    if (priorBudgetExceeded) {
      result = _crossStackSkippedResult(name, sliceRef, now, "prior-budget-exceeded");
    } else if (!enabled) {
      result = _crossStackSkippedResult(name, sliceRef, now, disabledReason);
    } else if (invokeInjected) {
      result = await invokeInjected();
    } else {
      result = await invokeDefault();
    }
  } catch (err) {
    result = _crossStackSkippedResult(name, sliceRef, now, `scanner-load-failed:${err.message || err}`);
  }

  emit(hub, "tempering-run-scanner-completed", {
    correlationId: corr,
    scanner: name,
    stack,
    verdict: result.verdict,
    pass: result.pass || 0,
    fail: result.fail || 0,
    skipped: result.skipped ? 1 : 0,
    durationMs: result.durationMs || 0,
  });

  return result;
}

async function _runObjectiveBaseline({ objective, objectiveSpawn, spawnFn, projectDir, corr }) {
  if (!objective || !objective.command || typeof objective.command !== "string") {
    return { ok: true, baseline: null };
  }
  const objSpawn = objectiveSpawn || spawnFn;
  const cmdParts = objective.command.trim().split(/\s+/);
  const baselineProc = await runSubprocess(cmdParts, {
    cwd: projectDir,
    budgetMs: 30000,
    spawn: objSpawn,
  });
  if (baselineProc.exitCode !== 0 || baselineProc.timedOut) {
    return {
      ok: false,
      response: {
        ok: false,
        error: "objective-baseline-failed",
        code: "objective-baseline-failed",
        correlationId: corr,
        objective: {
          accepted: false,
          blocked: true,
          reason: baselineProc.timedOut ? "objective-baseline-timed-out" : "objective-baseline-non-zero-exit",
        },
      },
    };
  }
  const baselineNum = parseFloat(baselineProc.stdout.trim());
  if (!isFinite(baselineNum)) {
    return {
      ok: false,
      response: {
        ok: false,
        error: "objective-baseline-non-numeric",
        code: "objective-baseline-non-numeric",
        correlationId: corr,
        objective: {
          accepted: false,
          blocked: true,
          reason: "objective-baseline-non-numeric",
        },
      },
    };
  }
  return { ok: true, baseline: baselineNum };
}

async function _runObjectivePost({ objective, baseline, objectiveSpawn, spawnFn, projectDir }) {
  const acceptIf = (objective.acceptIf === "less") ? "less" : "greater";
  const objSpawn = objectiveSpawn || spawnFn;
  const cmdParts = objective.command.trim().split(/\s+/);
  const postProc = await runSubprocess(cmdParts, {
    cwd: projectDir,
    budgetMs: 30000,
    spawn: objSpawn,
  });
  if (postProc.exitCode !== 0 || postProc.timedOut) {
    return {
      objectiveResult: {
        accepted: false,
        blocked: true,
        reason: postProc.timedOut ? "objective-post-timed-out" : "objective-post-non-zero-exit",
        acceptIf,
      },
      failed: true,
    };
  }
  const postNum = parseFloat(postProc.stdout.trim());
  if (!isFinite(postNum)) {
    return {
      objectiveResult: {
        accepted: false,
        blocked: true,
        reason: "objective-post-non-numeric",
        acceptIf,
      },
      failed: true,
    };
  }
  const accepted = acceptIf === "greater" ? postNum > baseline : postNum < baseline;
  return {
    objectiveResult: {
      accepted,
      blocked: !accepted,
      reason: accepted ? "objective-met" : "objective-not-met",
      acceptIf,
    },
    failed: !accepted,
  };
}

async function _registerScannerBugs(opts) {
  const {
    scanners, projectDir, corr, sliceRef, hub, captureMemory, config, callModel,
    classifyFn, registerBugFn,
  } = opts;
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
          flakinessData: null,
          callModel,
          config,
        });
        const bugResult = await _registerBug({
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

  return { registeredBugs, infraFixes };
}

function _persistRunRecord(runRecord, temperingDir, outPath) {
  try {
    if (!existsSync(temperingDir)) mkdirSync(temperingDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(runRecord, null, 2) + "\n", "utf-8");
  } catch { /* best-effort */ }
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
    uiImportFn = null,
    uiScannerImpl = null,
    contractScannerImpl = null,
    visualDiffScannerImpl = null,
    captureMemory = null,
    flakinessScannerImpl = null,
    perfBudgetScannerImpl = null,
    loadStressScannerImpl = null,
    mutationScannerImpl = null,
    contentAuditScannerImpl = null,
    classifyFn = null,
    registerBugFn = null,
    callModel = null,
    env = process.env,
    spawnWorker = null,
    objective = null,
    objectiveSpawn = null,
  } = opts;

  const corr = correlationId || `temper-run-${randomUUID()}`;
  const startedAt = new Date(now()).toISOString();
  const runId = `run-${startedAt.replace(/[:.]/g, "-")}`;

  if (!projectDir || typeof projectDir !== "string") {
    return { ok: false, error: "projectDir required", code: "missing-projectDir", correlationId: corr };
  }

  const { dir: temperingDir, configWritten } = ensureTemperingDirs(projectDir);
  const config = readTemperingConfig(projectDir);

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

  let adapter = adapterOverride;
  if (!adapter) {
    adapter = await loadAdapter(stack, { importFn });
  }

  let changedFiles = [];
  if (config.execution && config.execution.regressionFirst && lastGreenSha) {
    changedFiles = await pickChangedFiles({ cwd: projectDir, lastGreenSha, gitSpawn: spawnFn });
  }

  // A7 Objective — capture baseline BEFORE scanners run.
  const baselineGate = await _runObjectiveBaseline({ objective, objectiveSpawn, spawnFn, projectDir, corr });
  if (!baselineGate.ok) return baselineGate.response;
  const objectiveBaseline = baselineGate.baseline;

  // ── Unit scanner ──
  emit(hub, "tempering-run-scanner-started", { correlationId: corr, scanner: "unit", stack });
  const unitResult = await runScanner({
    scanner: "unit", config, stack, adapter, sliceRef,
    cwd: projectDir, spawn: spawnFn, now,
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

  // ── Integration scanner ──
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
      scanner: "integration", config, stack, adapter, sliceRef,
      cwd: projectDir, spawn: spawnFn, now,
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

  const stepCommon = { sliceRef, now, hub, corr, stack };
  const importFnSafe = importFn || ((spec) => import(spec));
  const uiImportFnSafe = uiImportFn || ((spec) => import(spec));

  // ── UI sweep scanner ──
  const uiResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "ui-playwright",
    priorScanners: [unitResult, integrationResult],
    invokeInjected: uiScannerImpl
      ? () => uiScannerImpl({ config, projectDir, runId, sliceRef, now, env, importFn: uiImportFn })
      : null,
    invokeDefault: async () => {
      const { runUiSweep } = await import("./scanners/ui-playwright.mjs");
      return runUiSweep({ config, projectDir, runId, sliceRef, now, env, importFn: uiImportFnSafe });
    },
  });

  // ── Contract scanner ──
  const contractResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "contract",
    priorScanners: [unitResult, integrationResult, uiResult],
    invokeInjected: contractScannerImpl
      ? () => contractScannerImpl({ config, projectDir, runId, sliceRef, now, env, importFn })
      : null,
    invokeDefault: async () => {
      const { runContractScan } = await import("./scanners/contract.mjs");
      return runContractScan({ config, projectDir, runId, sliceRef, now, env, importFn: importFnSafe });
    },
  });

  // ── Visual-diff scanner ──
  const visualDiffEnabled = config.scanners?.["visual-diff"] !== false
    && config.visualAnalyzer?.enabled !== false;
  const visualDiffResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "visual-diff",
    priorScanners: [unitResult, integrationResult, uiResult, contractResult],
    enabled: visualDiffEnabled,
    invokeInjected: visualDiffScannerImpl
      ? () => visualDiffScannerImpl({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory, spawnWorker })
      : null,
    invokeDefault: async () => {
      const { runVisualDiffScan } = await import("./scanners/visual-diff.mjs");
      return runVisualDiffScan({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory, spawnWorker });
    },
  });

  // ── Flakiness scanner ──
  const flakinessResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "flakiness",
    priorScanners: [unitResult, integrationResult, uiResult, contractResult, visualDiffResult],
    invokeInjected: flakinessScannerImpl
      ? () => flakinessScannerImpl({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory })
      : null,
    invokeDefault: async () => {
      const { runFlakinessScan } = await import("./scanners/flakiness.mjs");
      return runFlakinessScan({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory });
    },
  });

  // ── Performance Budget scanner ──
  const perfBudgetResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "performance-budget",
    priorScanners: [unitResult, integrationResult, uiResult, contractResult, visualDiffResult, flakinessResult],
    invokeInjected: perfBudgetScannerImpl
      ? () => perfBudgetScannerImpl({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory, importFn: importFnSafe })
      : null,
    invokeDefault: async () => {
      const { runPerformanceBudgetScan } = await import("./scanners/performance-budget.mjs");
      return runPerformanceBudgetScan({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory, importFn: importFnSafe });
    },
  });

  // ── Load / Stress scanner ──
  const loadStressResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "load-stress",
    priorScanners: [unitResult, integrationResult, uiResult, contractResult, visualDiffResult, flakinessResult, perfBudgetResult],
    invokeInjected: loadStressScannerImpl
      ? () => loadStressScannerImpl({ config, projectDir, runId, sliceRef, now, env, hub, importFn: importFnSafe })
      : null,
    invokeDefault: async () => {
      const { runLoadStressScan } = await import("./scanners/load-stress.mjs");
      return runLoadStressScan({ config, projectDir, runId, sliceRef, now, env, hub, importFn: importFnSafe });
    },
  });

  // ── Mutation scanner ──
  const mutationResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "mutation",
    priorScanners: [unitResult, integrationResult, uiResult, contractResult, visualDiffResult, flakinessResult, perfBudgetResult, loadStressResult],
    invokeInjected: mutationScannerImpl
      ? () => mutationScannerImpl({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory })
      : null,
    invokeDefault: async () => {
      const { runMutationScan } = await import("./scanners/mutation.mjs");
      return runMutationScan({ config, projectDir, runId, sliceRef, now, env, hub, captureMemory });
    },
  });

  // ── Content-audit scanner ──
  const contentAuditResult = await _runCrossStackScannerStep({
    ...stepCommon,
    name: "content-audit",
    priorScanners: [unitResult, integrationResult, uiResult, contractResult, visualDiffResult, flakinessResult, perfBudgetResult, loadStressResult, mutationResult],
    invokeInjected: contentAuditScannerImpl
      ? () => contentAuditScannerImpl({ config, projectDir, runId, sliceRef, now, env })
      : null,
    invokeDefault: async () => {
      const { runContentAudit } = await import("./scanners/content-audit.mjs");
      return runContentAudit({ config, projectDir, runId, sliceRef, now, env });
    },
  });

  const scanners = [
    unitResult, integrationResult, uiResult, contractResult, visualDiffResult,
    flakinessResult, perfBudgetResult, loadStressResult, mutationResult, contentAuditResult,
  ];
  let overallVerdict = deriveOverallVerdict(scanners);

  // A7 Objective — compare post-scanner metric against baseline.
  let objectiveResult = null;
  if (objective && objective.command && typeof objective.command === "string" && objectiveBaseline !== null) {
    const postOut = await _runObjectivePost({
      objective, baseline: objectiveBaseline, objectiveSpawn, spawnFn, projectDir,
    });
    objectiveResult = postOut.objectiveResult;
    if (postOut.failed) overallVerdict = "fail";
  }

  const { registeredBugs, infraFixes } = await _registerScannerBugs({
    scanners, projectDir, corr, sliceRef, hub, captureMemory, config, callModel,
    classifyFn, registerBugFn,
  });

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
    ...(objectiveResult !== null ? { objective: objectiveResult } : {}),
    phase: "TEMPER-06",
    slice: "06.1",
  };

  const outPath = resolve(temperingDir, `${runId}.json`);
  _persistRunRecord(runRecord, temperingDir, outPath);

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
    ...(objectiveResult !== null ? { objective: objectiveResult } : {}),
  };
}

// ─── Scanner name → dynamic import map ────────────────────────────────

const SCANNER_IMPORT_MAP = {
  "unit":               null,  // handled inline by runTemperingRun (spawn-based)
  "integration":        null,  // handled inline by runTemperingRun (spawn-based)
  "ui-playwright":      "./scanners/ui-playwright.mjs",
  "contract":           "./scanners/contract.mjs",
  "visual-diff":        "./scanners/visual-diff.mjs",
  "flakiness":          "./scanners/flakiness.mjs",
  "performance-budget": "./scanners/performance-budget.mjs",
  "load-stress":        "./scanners/load-stress.mjs",
  "mutation":           "./scanners/mutation.mjs",
  "content-audit":      "./scanners/content-audit.mjs",
};

const SCANNER_ENTRY_POINTS = {
  "ui-playwright":      "runUiSweep",
  "contract":           "runContractScan",
  "visual-diff":        "runVisualDiffScan",
  "flakiness":          "runFlakinessScan",
  "performance-budget": "runPerformanceBudgetScan",
  "load-stress":        "runLoadStressScan",
  "mutation":           "runMutationScan",
  "content-audit":      "runContentAudit",
};

/**
 * Run a single scanner by name — narrow export for closed-loop validation
 * (forge_bug_validate_fix). Does NOT register bugs or persist run records;
 * that's the caller's responsibility.
 *
 * @param {string} name - Scanner name (one of the 9 registered scanners)
 * @param {object} [opts]
 * @param {string} [opts.cwd] - Project directory
 * @param {string|null} [opts.testNameFilter] - Restrict to a single test name
 * @param {number} [opts.timeoutMs=120000] - Per-scanner budget
 * @param {Function} [opts.now] - Injectable clock
 * @param {Function} [opts.scannerImpl] - DI override for tests
 * @returns {Promise<{ scanner: string, startedAt: string, completedAt: string, failures: number, findings: Array, raw: object }>}
 */
async function _runSpawnBasedScanner(name, cwd, timeoutMs, started, now) {
  const config = await readTemperingConfig(cwd);
  const stack = detectStack(cwd);
  const adapter = loadAdapter(stack);
  if (!adapter) {
    const err = new Error(`No adapter for stack "${stack}" — scanner "${name}" unavailable`);
    err.code = "SCANNER_UNAVAILABLE";
    throw err;
  }
  const cmd = name === "unit"
    ? adapter.unitTestCommand(config, cwd)
    : adapter.integrationTestCommand?.(config, cwd) ?? adapter.unitTestCommand(config, cwd);
  if (!cmd) {
    const err = new Error(`Adapter does not provide a ${name} command for stack "${stack}"`);
    err.code = "SCANNER_UNAVAILABLE";
    throw err;
  }

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, KILL_GRACE_MS);
      reject(Object.assign(new Error(`Scanner "${name}" timed out after ${timeoutMs}ms`), { code: "SCANNER_TIMEOUT" }));
    }, timeoutMs);

    let stdout = "", stderr = "";
    const child = realSpawn(cmd.bin, cmd.args || [], { cwd, shell: true, env: { ...process.env, CI: "1" } });
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });

  const completed = now();
  return {
    scanner: name,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    failures: result.code !== 0 ? 1 : 0,
    findings: [],
    raw: { exitCode: result.code, stdout: result.stdout.slice(0, 2000), stderr: result.stderr.slice(0, 2000) },
  };
}

async function _runImportBasedScanner(name, opts) {
  const { modulePath, entryPoint, cwd, timeoutMs, started, now } = opts;
  const mod = await import(modulePath);
  const runFn = mod[entryPoint];
  if (typeof runFn !== "function") {
    const err = new Error(`Scanner "${name}" module missing entry point "${entryPoint}"`);
    err.code = "SCANNER_UNAVAILABLE";
    throw err;
  }

  const config = await readTemperingConfig(cwd);
  const runId = `validate-${started.toISOString().replace(/[:.]/g, "-")}`;
  const result = await Promise.race([
    runFn({ config, projectDir: cwd, runId, sliceRef: null, now: () => now().getTime(), env: process.env }),
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error(`Scanner "${name}" timed out after ${timeoutMs}ms`), { code: "SCANNER_TIMEOUT" })), timeoutMs)
    ),
  ]);

  const completed = now();
  return {
    scanner: name,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    failures: result.fail ?? result.failures?.length ?? 0,
    findings: result.findings ?? [],
    raw: result,
  };
}

export async function runSingleScanner(name, opts = {}) {
  const {
    cwd = process.cwd(),
    testNameFilter = null,
    timeoutMs = 120_000,
    now = () => new Date(),
    scannerImpl = null,
  } = opts;

  if (!name || !(name in SCANNER_IMPORT_MAP)) {
    const err = new Error(`Scanner "${name}" is not registered`);
    err.code = "SCANNER_UNAVAILABLE";
    throw err;
  }

  const started = now();

  if (scannerImpl) {
    const result = await scannerImpl({ cwd, filter: { testName: testNameFilter } });
    const completed = now();
    return {
      scanner: name,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      failures: result.failures?.length ?? (result.fail ?? 0),
      findings: result.findings ?? [],
      raw: result,
    };
  }

  if (name === "unit" || name === "integration") {
    return _runSpawnBasedScanner(name, cwd, timeoutMs, started, now);
  }

  const modulePath = SCANNER_IMPORT_MAP[name];
  const entryPoint = SCANNER_ENTRY_POINTS[name];
  return _runImportBasedScanner(name, { modulePath, entryPoint, cwd, timeoutMs, started, now });
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
