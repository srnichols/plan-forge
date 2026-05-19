/**
 * Observer Budget — daily USD cap + hourly narration cap (Phase-39, Slice 6).
 *
 * Pure functions:
 *   checkBudget(state, caps, [now])  → { ok, reason? }
 *   recordSpend(state, spend)        → updatedState
 *
 * I/O helpers (NOT pure — touch the filesystem):
 *   loadBudgetState([opts])          → state
 *   saveBudgetState(state, [opts])   → void  (atomic: write-to-tmp + rename)
 *
 * State shape (persisted to .forge/forge-master-observer-state.json):
 * {
 *   dailyUsd:          number,  // total USD spent in the current calendar day
 *   dailyDate:         string,  // "YYYY-MM-DD" — day-rollover sentinel
 *   hourlyNarrations:  number,  // narrations emitted in the current clock hour
 *   hourlyHour:        string,  // "YYYY-MM-DDTHH" — hour-rollover sentinel
 * }
 *
 * @module forge-master/observer-budget
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomBytes } from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────────

export const BUDGET_STATE_FILE = ".forge/forge-master-observer-state.json";

export const DEFAULT_BUDGET_STATE = Object.freeze({
  dailyUsd: 0,
  dailyDate: "",
  hourlyNarrations: 0,
  hourlyHour: "",
});

// ─── Internal helpers ────────────────────────────────────────────────

/** @param {number} ts */
function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** @param {number} ts */
function isoHour(ts) {
  return new Date(ts).toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
}

/**
 * Apply day and hour rollover to `state` relative to `now`.
 * Returns a new state object; never mutates the input.
 *
 * @param {object} state
 * @param {number} now
 * @returns {object}
 */
function applyRollover(state, now) {
  const day = isoDay(now);
  const hour = isoHour(now);
  let next = { ...state };
  if (next.dailyDate !== day) {
    next = { ...next, dailyUsd: 0, dailyDate: day };
  }
  if (next.hourlyHour !== hour) {
    next = { ...next, hourlyNarrations: 0, hourlyHour: hour };
  }
  return next;
}

// ─── Pure functions ───────────────────────────────────────────────────

/**
 * Check whether a narration is allowed under the configured caps.
 *
 * Applies rollover before checking so stale state is handled transparently.
 * Fail-closed: any cap that is a finite number blocks when met or exceeded.
 *
 * @param {object} state                           Budget state from loadBudgetState().
 * @param {{ maxUsdPerDay?: number, maxNarrationsPerHour?: number }} caps
 * @param {number} [now=Date.now()]                Injection point for tests.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkBudget(state, { maxUsdPerDay, maxNarrationsPerHour } = {}, now = Date.now()) {
  const s = applyRollover(state, now);

  if (typeof maxUsdPerDay === "number" && Number.isFinite(maxUsdPerDay) && s.dailyUsd >= maxUsdPerDay) {
    return {
      ok: false,
      reason: `daily USD cap exceeded (spent ${s.dailyUsd.toFixed(6)} >= limit ${maxUsdPerDay})`,
    };
  }

  if (
    typeof maxNarrationsPerHour === "number" &&
    Number.isFinite(maxNarrationsPerHour) &&
    s.hourlyNarrations >= maxNarrationsPerHour
  ) {
    return {
      ok: false,
      reason: `hourly narration cap exceeded (${s.hourlyNarrations} >= limit ${maxNarrationsPerHour})`,
    };
  }

  return { ok: true };
}

/**
 * Record a completed narration spend. Returns the updated state without
 * persisting — caller must call saveBudgetState() when ready to commit.
 *
 * Applies rollover before incrementing so the day/hour sentinels are always
 * current in the returned state.
 *
 * @param {object} state
 * @param {{ usd: number, timestamp?: number }} spend
 * @returns {object} New state with updated dailyUsd and hourlyNarrations.
 */
export function recordSpend(state, { usd, timestamp = Date.now() }) {
  const s = applyRollover(state, timestamp);
  return {
    ...s,
    dailyUsd: s.dailyUsd + (typeof usd === "number" && Number.isFinite(usd) ? usd : 0),
    hourlyNarrations: s.hourlyNarrations + 1,
  };
}

// ─── I/O helpers ──────────────────────────────────────────────────────

/**
 * Load the budget state from disk.
 *
 * If the file is missing or corrupt, returns DEFAULT_BUDGET_STATE with
 * current-day/hour sentinels (so rollover detection starts correctly).
 * Rollover is applied before returning so callers always receive a
 * state that is valid for the current moment.
 *
 * @param {{ cwd?: string, now?: number }} [opts]
 * @returns {object}
 */
export function loadBudgetState({ cwd = process.cwd(), now = Date.now() } = {}) {
  const stateFile = resolve(cwd, BUDGET_STATE_FILE);
  let raw = { ...DEFAULT_BUDGET_STATE };
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, "utf-8"));
      raw = { ...DEFAULT_BUDGET_STATE, ...parsed };
    }
  } catch {
    /* corrupt file — start from defaults */
  }
  return applyRollover(raw, now);
}

/**
 * Atomically persist the budget state to disk.
 *
 * Uses write-to-tmp + rename to avoid partial-write corruption.
 * Creates the containing directory if it does not yet exist.
 *
 * @param {object} state
 * @param {{ cwd?: string }} [opts]
 */
export function saveBudgetState(state, { cwd = process.cwd() } = {}) {
  const stateFile = resolve(cwd, BUDGET_STATE_FILE);
  const dir = dirname(stateFile);
  mkdirSync(dir, { recursive: true });
  const tmp = `${stateFile}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  renameSync(tmp, stateFile);
}
