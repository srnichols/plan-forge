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
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* best-effort */ }
  }
  return resolve(dir, "drain-history.jsonl");
}

function appendHistoryLine(historyPath, line) {
  try {
    appendFileSync(historyPath, JSON.stringify(line) + "\n", "utf-8");
  } catch { /* best-effort — non-fatal */ }
}

// ─── Default convergence rule ────────────────────────────────────────

function defaultConvergenceRule(roundData) {
  return roundData.realFindings === 0 && roundData.patterns === 0;
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

  const historyPath = ensureHistoryDir(project);

  return (async () => {
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
      // Check abort between rounds
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

      // If the run failed or was skipped, abort the drain
      if (!runResult || !runResult.ok) {
        const errorRound = {
          round,
          runId: runResult?.runId || null,
          realFindings: 0,
          patterns: 0,
          ts: new Date(now()).toISOString(),
          deltas: null,
          error: runResult?.error || "run-failed",
          verdict: runResult?.verdict || null,
        };
        rounds.push(errorRound);
        appendHistoryLine(historyPath, errorRound);
        terminated = "aborted";
        break;
      }

      const { realFindings, patterns, findings } = extractCounts(runResult);

      const deltas = prevRealFindings !== null
        ? { realFindings: realFindings - prevRealFindings, patterns: patterns - prevPatterns }
        : null;

      const roundData = {
        round,
        runId: runResult.runId,
        realFindings,
        patterns,
        ts: new Date(now()).toISOString(),
        deltas,
        verdict: runResult.verdict,
        findingCount: findings.length,
      };

      rounds.push(roundData);
      appendHistoryLine(historyPath, roundData);

      emit(hub, "drain-round-completed", {
        correlationId: corr,
        ...roundData,
      });

      // Evaluate convergence
      if (convergenceRule(roundData)) {
        terminated = "converged";
        break;
      }

      prevRealFindings = realFindings;
      prevPatterns = patterns;
    }

    const summary = {
      correlationId: corr,
      totalRounds: rounds.length,
      terminated,
      drainCurve: rounds.map((r) => r.realFindings),
      finalRealFindings: rounds.length > 0 ? rounds[rounds.length - 1].realFindings : 0,
      finalPatterns: rounds.length > 0 ? rounds[rounds.length - 1].patterns : 0,
    };

    emit(hub, "drain-completed", {
      correlationId: corr,
      ...summary,
    });

    return { rounds, terminated, summary };
  })();
}
