/**
 * Plan Forge — Forge-Master Session Store (Phase-38.1).
 *
 * Persists per-session conversation turns as JSONL files under
 * `.forge/fm-sessions/` in the project directory.
 *
 * Turn record schema:
 *   { turn, timestamp, userMessage, classification, replyHash, toolCalls }
 *
 * Storage behaviour:
 *   - Active file:  `.forge/fm-sessions/<sessionId>.jsonl`
 *   - Archive file: `.forge/fm-sessions/<sessionId>.archive.jsonl`
 *   - When active turn count ≥ 200, oldest 100 turns are moved to archive.
 *   - Session files are never committed — `.forge/` is gitignored.
 *
 * Exports:
 *   - appendTurn(sessionId, record, cwd?)  → void
 *   - loadSession(sessionId, cwd?)         → TurnRecord[]
 *   - purgeSession(sessionId, cwd?)        → void
 *   - rotateIfNeeded(sessionId, cwd?)      → void
 *
 * @module forge-master/session-store
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, appendFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

// ─── Validation ──────────────────────────────────────────────────────

/** Allowed characters in a session ID to prevent path traversal. */
const VALID_SESSION_ID_RE = /^[A-Za-z0-9._-]+$/;

function assertSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error(`session-store: sessionId must be a non-empty string`);
  }
  if (!VALID_SESSION_ID_RE.test(sessionId)) {
    throw new Error(`session-store: invalid sessionId "${sessionId}" — only [A-Za-z0-9._-] allowed`);
  }
}

// ─── Path helpers ────────────────────────────────────────────────────

function sessionsDir(cwd) {
  return join(cwd || process.cwd(), ".forge", "fm-sessions");
}

function activePath(sessionId, cwd) {
  assertSessionId(sessionId);
  return join(sessionsDir(cwd), `${sessionId}.jsonl`);
}

function archivePath(sessionId, cwd) {
  assertSessionId(sessionId);
  return join(sessionsDir(cwd), `${sessionId}.archive.jsonl`);
}

// ─── Per-session mutex ───────────────────────────────────────────────

const _locks = new Map();

function acquireLock(key) {
  if (!_locks.has(key)) _locks.set(key, Promise.resolve());
  let release;
  const next = new Promise((res) => { release = res; });
  const prev = _locks.get(key);
  _locks.set(key, next);
  return prev.then(() => release);
}

/** For testing only — clears all active locks. */
export function _resetLocks() {
  _locks.clear();
}

// ─── JSONL helpers ───────────────────────────────────────────────────

async function readLines(filePath) {
  try {
    const text = await readFile(filePath, "utf-8");
    const lines = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed));
      } catch { /* skip malformed lines */ }
    }
    return lines;
  } catch {
    return [];
  }
}

// ─── Internal rotate (must be called within lock) ───────────────────

async function _rotate(sessionId, cwd) {
  const active = activePath(sessionId, cwd);
  const archive = archivePath(sessionId, cwd);
  const lines = await readLines(active);
  if (lines.length < 200) return;

  const toArchive = lines.slice(0, 100);
  const toKeep = lines.slice(100);

  // Append oldest 100 to archive
  const archiveChunk = toArchive.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await appendFile(archive, archiveChunk, "utf-8");

  // Rewrite active file with newest 100
  const keepContent = toKeep.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(active, keepContent, "utf-8");
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Append a turn record to the session's JSONL file.
 * Assigns `turn` (1-based, monotonically increasing) and `timestamp` automatically.
 * Automatically rotates when the active file reaches 200 turns.
 *
 * @param {string} sessionId   — Must match [A-Za-z0-9._-]+
 * @param {object} record      — { userMessage, classification, replyHash, toolCalls }
 * @param {string} [cwd]       — project root (defaults to process.cwd())
 */
export async function appendTurn(sessionId, record, cwd = process.cwd()) {
  const path = activePath(sessionId, cwd);
  const dir = sessionsDir(cwd);
  const release = await acquireLock(sessionId);
  try {
    await mkdir(dir, { recursive: true });

    // Determine monotonic turn number from last active line
    const existing = await readLines(path);
    const lastTurn = existing.length > 0 ? (existing[existing.length - 1].turn ?? existing.length) : 0;
    const nextTurn = lastTurn + 1;

    const entry = {
      turn: nextTurn,
      timestamp: new Date().toISOString(),
      ...record,
    };

    await appendFile(path, JSON.stringify(entry) + "\n", "utf-8");

    // Auto-rotate under the same lock
    await _rotate(sessionId, cwd);
  } finally {
    release();
  }
}

/**
 * Load all turns for a session.
 * Returns `[]` when the file does not exist — never throws on missing file.
 *
 * @param {string} sessionId
 * @param {string} [cwd]
 * @returns {Promise<object[]>}
 */
export async function loadSession(sessionId, cwd = process.cwd()) {
  return readLines(activePath(sessionId, cwd));
}

/**
 * Delete the active and archive session files.
 * No-op (no error) when files do not exist.
 *
 * @param {string} sessionId
 * @param {string} [cwd]
 */
export async function purgeSession(sessionId, cwd = process.cwd()) {
  const release = await acquireLock(sessionId);
  try {
    await Promise.all([
      unlink(activePath(sessionId, cwd)).catch(() => {}),
      unlink(archivePath(sessionId, cwd)).catch(() => {}),
    ]);
  } finally {
    release();
  }
}

/**
 * Rotate the session file if it has ≥ 200 active turns.
 * Exported for external callers; `appendTurn` calls this automatically.
 *
 * @param {string} sessionId
 * @param {string} [cwd]
 */
export async function rotateIfNeeded(sessionId, cwd = process.cwd()) {
  const release = await acquireLock(sessionId);
  try {
    await _rotate(sessionId, cwd);
  } finally {
    release();
  }
}

/**
 * Compute a truncated sha256 hex hash suitable for `replyHash`.
 *
 * @param {string} text
 * @returns {string} — first 16 hex characters
 */
export function hashReply(text) {
  return createHash("sha256").update(text || "").digest("hex").slice(0, 16);
}
