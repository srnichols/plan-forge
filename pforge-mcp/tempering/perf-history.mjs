/**
 * Plan Forge — TEMPER-05 Slice 05.1: perf-history JSONL helper.
 *
 * Append-only performance history stored at
 * `.forge/tempering/perf-history.jsonl`.  Reuses the project-wide
 * `appendForgeJsonl` / `readForgeJsonl` from orchestrator.mjs so
 * the IO path is identical for every JSONL file in the forge.
 *
 * Entry shape:
 *   { timestamp, runId, endpoint, method, p50, p95, p99,
 *     errorRate, source: "performance-budget" | "load-stress" }
 */

import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, mkdirSync, appendFileSync } from "node:fs";

const JSONL_RELATIVE = "tempering/perf-history.jsonl";

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Append a single perf entry to the history file.
 *
 * @param {object} entry - Performance data record
 * @param {string} [cwd=process.cwd()] - Project root
 */
export function appendPerfEntry(entry, cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", JSONL_RELATIVE);
  mkdirSync(dirname(fullPath), { recursive: true });
  const stamped = { _v: 1, ...entry };
  appendFileSync(fullPath, JSON.stringify(stamped) + "\n");
}

/**
 * Read the tail of the performance history (bounded).
 *
 * @param {string} [cwd=process.cwd()] - Project root
 * @param {{ limit?: number }} [opts]
 * @returns {object[]}
 */
export function readPerfHistory(cwd = process.cwd(), { limit = 100 } = {}) {
  const fullPath = resolve(cwd, ".forge", JSONL_RELATIVE);
  if (!existsSync(fullPath)) return [];
  try {
    const lines = readFileSync(fullPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim());
    // Bounded: take the last `limit` lines
    const tail = lines.slice(-limit);
    const entries = [];
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip corrupted lines silently
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Retrieve the most recent baseline p95 for a given endpoint+method.
 *
 * @param {string} endpoint
 * @param {string} method
 * @param {string} [cwd=process.cwd()]
 * @returns {number|null}
 */
export function getBaselineP95(endpoint, method, cwd = process.cwd()) {
  const history = readPerfHistory(cwd);
  // Walk backwards to find the most recent entry for this endpoint+method
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e.endpoint === endpoint && e.method === method && e.p95 != null) {
      return e.p95;
    }
  }
  return null;
}

/**
 * Check whether an endpoint has regressed for N consecutive runs.
 *
 * @param {string} endpoint
 * @param {string} method
 * @param {number} threshold - Fraction (0.10 = 10%)
 * @param {string} [cwd=process.cwd()]
 * @param {{ requiredConsecutive?: number }} [opts]
 * @returns {boolean}
 */
export function isConsecutiveRegression(
  endpoint,
  method,
  threshold,
  cwd = process.cwd(),
  { requiredConsecutive = 2 } = {},
) {
  const history = readPerfHistory(cwd);
  // Filter to this endpoint+method, newest last
  const relevant = history.filter(
    (e) => e.endpoint === endpoint && e.method === method && e.p95 != null,
  );
  if (relevant.length < requiredConsecutive + 1) return false;

  // We need at least `requiredConsecutive` latest entries that all exceed
  // `threshold` regression vs the entry just before the streak.
  const baseline = relevant[relevant.length - requiredConsecutive - 1];
  if (!baseline || baseline.p95 == null || baseline.p95 === 0) return false;

  for (let i = relevant.length - requiredConsecutive; i < relevant.length; i++) {
    const delta = (relevant[i].p95 - baseline.p95) / baseline.p95;
    if (delta <= threshold) return false;
  }
  return true;
}
