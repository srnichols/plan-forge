/**
 * Plan Forge — Forge-Master Session Persistence (Phase-28, Slice 6).
 *
 * Manages per-session conversation history in brain L1 and auto-summarizes
 * to L2 digests when a session exceeds 20 turns.
 *
 * Key scheme (from plan):
 *   L1:  session.forgemaster.<sessionId>.history
 *   L2:  project.forgemaster.digests.<YYYY-MM-DD>
 *
 * Uses `sessionId` as the brain `runId` for L1 isolation.
 *
 * Exports:
 *   - ensureSessionId(sessionId?) → string
 *   - appendTurn({sessionId, turn}, deps) → {turnCount, sessionId}
 *   - summarizeIfNeeded({sessionId}, deps) → {summarized, ...}
 *   - SUMMARIZE_THRESHOLD, SUMMARIZE_COUNT
 *
 * @module forge-master/persistence
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Constants ──────────────────────────────────────────────────────

export const SUMMARIZE_THRESHOLD = 20;
export const SUMMARIZE_COUNT = 10;
const VALID_SUMMARY_SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Create the initial schema for a per-session rolling summary.
 *
 * @returns {{version:number,summary:null,coveredThroughTurn:number,generatedAtTurn:null,lastAttemptTurn:null,ledger:object[]}}
 */
export function emptyCompactionState() {
  return {
    version: 1,
    summary: null,
    coveredThroughTurn: 0,
    generatedAtTurn: null,
    lastAttemptTurn: null,
    ledger: [],
  };
}

function isValidSummarySessionId(sessionId) {
  return typeof sessionId === "string"
    && VALID_SUMMARY_SESSION_ID_RE.test(sessionId)
    && !sessionId.includes("..");
}

function sessionSummaryPath(sessionId, cwd) {
  return join(cwd || process.cwd(), ".forge", "fm-sessions", `${sessionId}.summary.json`);
}

function isCompactionState(value) {
  return value !== null
    && typeof value === "object"
    && value.version === 1
    && (value.summary === null || typeof value.summary === "string")
    && Number.isFinite(value.coveredThroughTurn)
    && (value.generatedAtTurn === null || Number.isFinite(value.generatedAtTurn))
    && (value.lastAttemptTurn === null || Number.isFinite(value.lastAttemptTurn))
    && Array.isArray(value.ledger)
    && value.ledger.every((entry) => entry
      && Number.isFinite(entry.turn)
      && typeof entry.userMessage === "string"
      && (entry.conclusion === null || typeof entry.conclusion === "string"));
}

/**
 * Load a rolling conversation summary. Missing or malformed sidecars start
 * with empty state; session history remains independently readable.
 *
 * @param {string} sessionId
 * @param {string} [cwd]
 * @returns {Promise<object>}
 */
export async function loadSessionSummary(sessionId, cwd = process.cwd()) {
  if (!isValidSummarySessionId(sessionId)) return emptyCompactionState();
  try {
    const parsed = JSON.parse(await readFile(sessionSummaryPath(sessionId, cwd), "utf8"));
    return isCompactionState(parsed) ? parsed : emptyCompactionState();
  } catch {
    return emptyCompactionState();
  }
}

/**
 * Atomically persist a rolling conversation summary sidecar.
 *
 * @param {string} sessionId
 * @param {object} state
 * @param {string} [cwd]
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function saveSessionSummary(sessionId, state, cwd = process.cwd()) {
  if (!isValidSummarySessionId(sessionId)) return { ok: false, error: "invalid_session_id" };
  if (!isCompactionState(state)) return { ok: false, error: "invalid_state" };
  const path = sessionSummaryPath(sessionId, cwd);
  try {
    await mkdir(join(cwd || process.cwd(), ".forge", "fm-sessions"), { recursive: true });
    await writeFile(`${path}.tmp`, `${JSON.stringify(state)}\n`, "utf8");
    await rename(`${path}.tmp`, path);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ─── Per-Session Mutex ──────────────────────────────────────────────

const _locks = new Map();

function acquireLock(sessionId) {
  if (!_locks.has(sessionId)) {
    _locks.set(sessionId, Promise.resolve());
  }
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const prev = _locks.get(sessionId);
  _locks.set(sessionId, next);
  return prev.then(() => release);
}

// For testing: clear all locks
export function _resetLocks() {
  _locks.clear();
}

// ─── Session ID ─────────────────────────────────────────────────────

/**
 * Ensure a valid sessionId exists. Returns the input if it is a
 * non-empty string, otherwise generates a fresh UUID.
 *
 * @param {string|null|undefined} sessionId
 * @returns {string}
 */
export function ensureSessionId(sessionId) {
  if (sessionId && typeof sessionId === "string" && sessionId.trim().length > 0) {
    return sessionId;
  }
  return randomUUID();
}

// ─── Brain Key Helpers ──────────────────────────────────────────────

function historyKey(sessionId) {
  return `session.forgemaster.${sessionId}.history`;
}

function digestKey(dateStr) {
  return `project.forgemaster.digests.${dateStr}`;
}

// ─── Append Turn ────────────────────────────────────────────────────

/**
 * Append a turn record to session history in brain L1.
 *
 * The turn object should contain `{role, content, toolCalls?}`.
 * A timestamp is added automatically if not present.
 *
 * @param {{sessionId: string, turn: object}} input
 * @param {{recall: Function, remember: Function, cwd?: string}} deps
 * @returns {Promise<{turnCount: number, sessionId: string}>}
 */
export async function appendTurn({ sessionId, turn }, deps = {}) {
  if (!sessionId) throw new Error("appendTurn requires a sessionId");
  if (!turn || typeof turn !== "object") throw new Error("appendTurn requires a turn object");

  const key = historyKey(sessionId);
  const release = await acquireLock(sessionId);

  try {
    let history = [];
    try {
      const existing = await deps.recall(key, { runId: sessionId });
      if (Array.isArray(existing)) history = existing;
    } catch { /* empty history on first call */ }

    const record = {
      ...turn,
      timestamp: turn.timestamp || new Date().toISOString(),
    };
    history.push(record);

    deps.remember(key, history, { runId: sessionId });

    return { turnCount: history.length, sessionId };
  } finally {
    release();
  }
}

// ─── Auto-Summarization ─────────────────────────────────────────────

/**
 * If the session history exceeds SUMMARIZE_THRESHOLD turns, move the
 * oldest SUMMARIZE_COUNT turns into an L2 digest and trim L1.
 *
 * Digest key: `project.forgemaster.digests.<YYYY-MM-DD>`
 *
 * @param {{sessionId: string}} input
 * @param {{recall: Function, remember: Function, cwd?: string}} deps
 * @returns {Promise<{summarized: boolean, summarizedCount?: number, remaining?: number, turnCount?: number}>}
 */
export async function summarizeIfNeeded({ sessionId }, deps = {}) {
  if (!sessionId) return { summarized: false };

  const key = historyKey(sessionId);
  const release = await acquireLock(sessionId);

  try {
    let history = [];
    try {
      const existing = await deps.recall(key, { runId: sessionId });
      if (Array.isArray(existing)) history = existing;
    } catch {
      return { summarized: false };
    }

    if (history.length <= SUMMARIZE_THRESHOLD) {
      return { summarized: false, turnCount: history.length };
    }

    const toSummarize = history.slice(0, SUMMARIZE_COUNT);
    const remaining = history.slice(SUMMARIZE_COUNT);

    // Build digest entry and write to L2
    const dateStr = new Date().toISOString().slice(0, 10);
    const dKey = digestKey(dateStr);

    let existingDigests = [];
    try {
      const d = await deps.recall(dKey, { scope: "project" });
      if (Array.isArray(d)) existingDigests = d;
    } catch { /* fresh digest */ }

    existingDigests.push({
      sessionId,
      summarizedAt: new Date().toISOString(),
      turnCount: toSummarize.length,
      turns: toSummarize,
    });

    deps.remember(dKey, existingDigests, { scope: "project" });

    // Update L1 with remaining turns only
    deps.remember(key, remaining, { runId: sessionId });

    return {
      summarized: true,
      summarizedCount: toSummarize.length,
      remaining: remaining.length,
    };
  } finally {
    release();
  }
}
