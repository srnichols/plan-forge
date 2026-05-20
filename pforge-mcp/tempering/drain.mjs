/**
 * Tempering drain — round-loop driver that wraps `runTemperingRun` and
 * iterates until convergence or max-rounds (Phase-39 Slice 2).
 *
 * The drain is the novel contract from proposal 0001: run tempering
 * repeatedly, counting real findings and noise patterns per round,
 * until the system has either fixed everything or taught its classifier
 * not to flag it. The drain curve (e.g., 88→31→4→0) is a compact,
 * auditable session artifact.
 *
 * Design constraints:
 *   - Never throws — always returns a result frame
 *   - `runTemperingRun` dependency is injectable for tests
 *   - Per-round deltas written to `.forge/tempering/drain-history.jsonl`
 *   - Convergence rule injectable; default requires zero real findings
 *     AND zero patterns AND a healthy run (ok === true)
 *   - Max-rounds cap prevents infinite tuning
 *   - AbortSignal checked between rounds (not mid-round)
 *
 * @module tempering/drain
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runTemperingRun } from "./runner.mjs";

// ─── Hub event helper ────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Finding extraction ──────────────────────────────────────────────

/**
 * Extract real-finding and pattern counts from a `runTemperingRun` result.
 *
 * - realFindings: severity !== "info" && severity !== "ok"
 * - patterns:     severity === "info" (noise / classifier-fixable)
 */
function extractCounts(runResult) {
  if (!runResult || !runResult.ok || !Array.isArray(runResult.scanners)) {
    return { realFindings: 0, patterns: 0, findings: [] };
  }
  const allFindings = [];
  for (const scanner of runResult.scanners) {
    if (Array.isArray(scanner.findings)) {
      allFindings.push(...scanner.findings);
    }
  }
  let realFindings = 0;
  let patterns = 0;
  for (const f of allFindings) {
    if (f.severity === "info" || f.severity === "ok") {
      patterns++;
    } else {
      realFindings++;
    }
  }
  return { realFindings, patterns, findings: allFindings };
}

// ─── JSONL history writer ────────────────────────────────────────────

function ensureHistoryDir(projectDir) {
  const dir = resolve(projectDir, ".forge", "tempering");
  const errors = [];
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      errors.push({ op: "mkdir", path: dir, message: err.message });
    }
  }
  return { historyPath: resolve(dir, "drain-history.jsonl"), errors };
}

function appendHistoryLine(historyPath, line, errors) {
  try {
    appendFileSync(historyPath, JSON.stringify(line) + "\n", "utf-8");
    return true;
  } catch (err) {
    // Record the first write error we see; subsequent failures are usually
    // the same cause and noisy to log individually.
    if (errors && errors.length === 0) {
      errors.push({ op: "append", path: historyPath, message: err.message });
    }
    return false;
  }
}

// ─── Default convergence rule ────────────────────────────────────────

function defaultConvergenceRule(roundData) {
  return roundData.realFindings === 0 && roundData.patterns === 0;
}

function makeDrainRoundBase(round, runResult, now) {
  return {
    round,
    runId: runResult?.runId || null,
    ts: new Date(now()).toISOString(),
    verdict: runResult?.verdict || null,
  };
}

function failedDrainRound(round, runResult, now) {
  return {
    ...makeDrainRoundBase(round, runResult, now),
    realFindings: 0,
    patterns: 0,
    deltas: null,
    error: runResult?.error || "run-failed",
  };
}

function noWorkDrainRound(round, runResult, now) {
  return {
    ...makeDrainRoundBase(round, runResult, now),
    realFindings: 0,
    patterns: 0,
    deltas: null,
    findingCount: 0,
    noWork: true,
    reason: runResult.skipped ? (runResult.reason || "tempering-skipped") : "no-scanners-executed",
  };
}

function completedDrainRound({ round, runResult, now, prevRealFindings, prevPatterns }) {
  const { realFindings, patterns, findings } = extractCounts(runResult);
  return {
    ...makeDrainRoundBase(round, runResult, now),
    realFindings,
    patterns,
    deltas: prevRealFindings !== null
      ? { realFindings: realFindings - prevRealFindings, patterns: patterns - prevPatterns }
      : null,
    findingCount: findings.length,
  };
}

function finalizeDrainSummary({ corr, rounds, terminated, historyPath, fsErrors }) {
  const summary = {
    correlationId: corr,
    totalRounds: rounds.length,
    terminated,
    drainCurve: rounds.map((r) => r.realFindings),
    finalRealFindings: rounds.length > 0 ? rounds[rounds.length - 1].realFindings : 0,
    finalPatterns: rounds.length > 0 ? rounds[rounds.length - 1].patterns : 0,
    historyPath,
  };
  if (fsErrors.length > 0) summary.fsErrors = fsErrors;
  if (terminated === "no-work" && rounds.length > 0) summary.reason = rounds[rounds.length - 1].reason;
  return summary;
}

async function executeDrainLoop({ project, maxRounds, convergenceRule, spawnWorker, hub, abortSignal, runTemperingRunFn, now, corr, historyPath, fsErrors }) {
  emit(hub, "drain-started", {
    correlationId: corr,
    project,
    maxRounds,
    ts: new Date(now()).toISOString(),
  });

  const rounds = [];
  let terminated = "max-rounds";
  let prevRealFindings = null;
  let prevPatterns = null;

  for (let round = 1; round <= maxRounds; round++) {
    if (abortSignal && abortSignal.aborted) {
      terminated = "aborted";
      break;
    }

    const runResult = await runTemperingRunFn({
      projectDir: project,
      hub,
      correlationId: `${corr}-round-${round}`,
      spawnWorker,
      now,
    });

    if (!runResult || !runResult.ok) {
      rounds.push(failedDrainRound(round, runResult, now));
      appendHistoryLine(historyPath, rounds[rounds.length - 1], fsErrors);
      terminated = "aborted";
      break;
    }

    if (runResult.skipped === true || !Array.isArray(runResult.scanners) || runResult.scanners.length === 0) {
      rounds.push(noWorkDrainRound(round, runResult, now));
      appendHistoryLine(historyPath, rounds[rounds.length - 1], fsErrors);
      terminated = "no-work";
      break;
    }

    const roundData = completedDrainRound({ round: round, runResult: runResult, now: now, prevRealFindings: prevRealFindings, prevPatterns: prevPatterns });
    rounds.push(roundData);
    appendHistoryLine(historyPath, roundData, fsErrors);
    emit(hub, "drain-round-completed", { correlationId: corr, ...roundData });

    if (convergenceRule(roundData)) {
      terminated = "converged";
      break;
    }
    prevRealFindings = roundData.realFindings;
    prevPatterns = roundData.patterns;
  }

  const summary = finalizeDrainSummary({ corr: corr, rounds: rounds, terminated: terminated, historyPath: historyPath, fsErrors: fsErrors });
  emit(hub, "drain-completed", { correlationId: corr, ...summary });
  return { rounds, terminated, summary };
}

// ─── Main entry point ────────────────────────────────────────────────

/**
 * Run tempering in a drain loop until convergence or max-rounds.
 *
 * @param {object} opts
 * @param {string}   opts.project          — project directory
 * @param {number}   [opts.maxRounds=5]    — cap to prevent infinite loops
 * @param {string[]} [opts.scanners]       — scanner names to run (passed to runner)
 * @param {Function} [opts.convergenceRule] — `(roundData) => boolean`
 * @param {Function} [opts.spawnWorker]    — DI for LLM workers
 * @param {object}   [opts.hub]            — SSE event hub
 * @param {string}   [opts.correlationId]  — trace correlation
 * @param {AbortSignal} [opts.abortSignal] — cancel between rounds
 * @param {Function} [opts.runTemperingRunFn] — DI for tests
 * @param {Function} [opts.now]            — injectable clock
 * @returns {Promise<{ rounds: Array, terminated: string, summary: object }>}
 */
export function runTemperingDrain(opts = {}) {
  const {
    project,
    maxRounds = 5,
    scanners: scannerNames,
    convergenceRule = defaultConvergenceRule,
    spawnWorker = null,
    hub = null,
    correlationId = null,
    abortSignal = null,
    runTemperingRunFn = runTemperingRun,
    now = () => Date.now(),
  } = opts;

  const corr = correlationId || `drain-${randomUUID()}`;

  if (!project || typeof project !== "string") {
    return Promise.resolve({
      rounds: [],
      terminated: "aborted",
      summary: { error: "project directory required", correlationId: corr },
    });
  }

  const historyFs = ensureHistoryDir(project);
  const historyPath = historyFs.historyPath;
  const fsErrors = [...historyFs.errors];

  return executeDrainLoop({
    project,
    maxRounds,
    convergenceRule,
    spawnWorker,
    hub,
    abortSignal,
    runTemperingRunFn,
    now,
    corr,
    historyPath,
    fsErrors,
  });
}
