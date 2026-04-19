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
 * Run the unit scanner for a stack. Pure orchestration — all
 * stack-specific knowledge lives in `adapter.unit`.
 *
 * @param {object} ctx
 * @param {object} ctx.config            - loaded tempering config
 * @param {string} ctx.stack             - e.g. "typescript"
 * @param {object|null} ctx.adapter      - result of loadAdapter(stack)
 * @param {{plan:string, slice:string}|null} ctx.sliceRef
 * @param {string} ctx.cwd
 * @param {Function} [ctx.spawn]
 * @param {Function} [ctx.now]           - () => number, injectable clock
 * @returns {Promise<object>} scanner result record
 */
export async function runScannerUnit(ctx) {
  const {
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
    scanner: "unit",
    stack,
    sliceRef,
    startedAt: new Date(t0).toISOString(),
  };

  // Scanner globally disabled
  if (!config || !config.scanners || config.scanners.unit === false) {
    return { ...base, skipped: true, reason: "scanner-disabled", verdict: "skipped", durationMs: 0, completedAt: new Date(now()).toISOString() };
  }

  // No adapter for this stack (including loadAdapter failure)
  if (!adapter || !adapter.unit) {
    return { ...base, skipped: true, reason: "no-adapter", verdict: "skipped", durationMs: 0, completedAt: new Date(now()).toISOString() };
  }

  const check = validateAdapterEntry(adapter.unit);
  if (!check.ok) {
    return { ...base, skipped: true, reason: `invalid-adapter:${check.reason}`, verdict: "skipped", durationMs: 0, completedAt: new Date(now()).toISOString() };
  }

  // Explicit unsupported stub (php / swift / azure-iac in this slice)
  if (adapter.unit.supported === false) {
    return {
      ...base,
      skipped: true,
      reason: adapter.unit.reason || "stack-not-supported",
      verdict: "skipped",
      durationMs: 0,
      completedAt: new Date(now()).toISOString(),
    };
  }

  const budgetMs = (config.runtimeBudgets && config.runtimeBudgets.unitMaxMs) || DEFAULT_UNIT_BUDGET_MS;

  const proc = await runSubprocess(adapter.unit.cmd, { cwd, budgetMs, spawn: spawnFn });

  let parsed = { pass: 0, fail: 0, skipped: 0, coverage: null };
  try {
    parsed = adapter.unit.parseOutput(proc.stdout, proc.stderr, proc.exitCode) || parsed;
  } catch (err) {
    // Parser blew up — surface it but don't throw
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
    cmd: adapter.unit.cmd,
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

// ─── Top-level dispatcher ─────────────────────────────────────────────

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
  } = opts;

  const corr = correlationId || `temper-run-${randomUUID()}`;
  const startedAt = new Date(now()).toISOString();

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

  const unitResult = await runScannerUnit({
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

  // Overall verdict: worst of the scanner verdicts
  const scanners = [unitResult];
  const overallVerdict = deriveOverallVerdict(scanners);

  const completedAt = new Date(now()).toISOString();
  const runId = `run-${startedAt.replace(/[:.]/g, "-")}`;

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
    phase: "TEMPER-02",
    slice: "02.1",
  };

  // Persist — best-effort
  const outPath = resolve(temperingDir, `${runId}.json`);
  try {
    if (!existsSync(temperingDir)) mkdirSync(temperingDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(runRecord, null, 2) + "\n", "utf-8");
  } catch { /* best-effort */ }

  // Compact completion event — primitives only, mirrors tempering-scan-completed
  emit(hub, "tempering-run-completed", {
    correlationId: corr,
    runId,
    stack,
    verdict: overallVerdict,
    scannerCount: scanners.length,
    pass: unitResult.pass,
    fail: unitResult.fail,
    skipped: unitResult.skipped,
    durationMs: unitResult.durationMs,
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
