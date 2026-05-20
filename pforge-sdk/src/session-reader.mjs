/**
 * session-reader.mjs — Offline utilities for reading Plan Forge Forge-Master session files.
 *
 * Reads the JSONL session files written by the Forge-Master session store
 * (`pforge-master/src/session-store.mjs`) to `.forge/fm-sessions/`. Useful for
 * CI scripts, external dashboards, or any tool that needs to inspect
 * Forge-Master conversation history without a running MCP server.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * On-disk layout (relative to workspace root):
 *   .forge/fm-sessions/                          — session directory
 *   .forge/fm-sessions/<sessionId>.jsonl         — active turns (up to 200)
 *   .forge/fm-sessions/<sessionId>.archive.jsonl — archived turns (oldest 100 on rotation)
 *
 * Turn record shape:
 *   {
 *     turn:           number,          // 1-based, monotonically increasing
 *     timestamp:      string,          // ISO-8601
 *     userMessage:    string,          // raw user message text
 *     classification: string | object, // Forge-Master lane classification
 *     replyHash:      string,          // first 16 hex chars of sha256 of reply
 *     toolCalls:      object[],        // MCP tool calls made during this turn
 *   }
 *
 * @module session-reader
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the fm-sessions directory.
 * @type {string}
 */
export const FM_SESSIONS_DIR_RELATIVE = join('.forge', 'fm-sessions');

/**
 * Suffix used for active session JSONL files.
 * @type {string}
 */
export const ACTIVE_FILE_SUFFIX = '.jsonl';

/**
 * Suffix used for archive session JSONL files.
 * @type {string}
 */
export const ARCHIVE_FILE_SUFFIX = '.archive.jsonl';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** @param {{ cwd?: string }} [opts] */
function rootOf(opts) {
  return opts?.cwd ?? process.cwd();
}

/** Return true if `name` is an archive session filename. */
function isArchive(name) {
  return name.endsWith(ARCHIVE_FILE_SUFFIX);
}

/** Return true if `name` is an active session filename (not archive). */
function isActive(name) {
  return name.endsWith(ACTIVE_FILE_SUFFIX) && !isArchive(name);
}

/** Extract sessionId from a filename by stripping the active or archive suffix. */
function sessionIdFromFilename(name) {
  if (isArchive(name)) return name.slice(0, -ARCHIVE_FILE_SUFFIX.length);
  if (isActive(name)) return name.slice(0, -ACTIVE_FILE_SUFFIX.length);
  return null;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to the `.forge/fm-sessions/` directory.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * fmSessionsDir();
 * // → '/workspace/.forge/fm-sessions'
 *
 * fmSessionsDir({ cwd: '/my/project' });
 * // → '/my/project/.forge/fm-sessions'
 */
export function fmSessionsDir(opts) {
  return resolve(rootOf(opts), '.forge', 'fm-sessions');
}

/**
 * Resolve the absolute path to the active JSONL file for a session.
 *
 * @param {{ sessionId: string, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * sessionFilePath({ sessionId: 'abc-123' });
 * // → '/workspace/.forge/fm-sessions/abc-123.jsonl'
 */
export function sessionFilePath({ sessionId, cwd }) {
  return resolve(rootOf({ cwd }), '.forge', 'fm-sessions', `${sessionId}.jsonl`);
}

/**
 * Resolve the absolute path to the archive JSONL file for a session.
 *
 * @param {{ sessionId: string, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * sessionArchivePath({ sessionId: 'abc-123' });
 * // → '/workspace/.forge/fm-sessions/abc-123.archive.jsonl'
 */
export function sessionArchivePath({ sessionId, cwd }) {
  return resolve(rootOf({ cwd }), '.forge', 'fm-sessions', `${sessionId}.archive.jsonl`);
}

// ─── Turn line parser ─────────────────────────────────────────────────────────

/**
 * Parse a single JSONL line into a turn record.
 *
 * Pure — no I/O. Returns `null` for blank lines or lines that cannot be
 * parsed as valid JSON objects.
 *
 * @param {string} line
 * @returns {object|null}
 *
 * @example
 * parseSessionLine('{"turn":1,"timestamp":"2026-05-20T12:00:00.000Z","userMessage":"hello"}');
 * // → { turn: 1, timestamp: '2026-05-20T12:00:00.000Z', userMessage: 'hello' }
 *
 * parseSessionLine('');
 * // → null
 *
 * parseSessionLine('not json');
 * // → null
 */
export function parseSessionLine(line) {
  if (typeof line !== 'string' || line.trim().length === 0) return null;
  try {
    const record = JSON.parse(line.trim());
    if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
    return record;
  } catch {
    return null;
  }
}

// ─── Internal JSONL reader ────────────────────────────────────────────────────

/**
 * Read and parse all valid JSONL records from a file.
 * Returns an empty array when the file does not exist or cannot be read.
 *
 * @param {string} filePath
 * @returns {object[]}
 */
function readJsonlFile(filePath) {
  if (!existsSync(filePath)) return [];
  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .map((l) => parseSessionLine(l))
    .filter((r) => r !== null);
}

// ─── Session discovery ────────────────────────────────────────────────────────

/**
 * List session IDs available in `.forge/fm-sessions/`, sorted newest-first
 * by the active file's last-modified time.
 *
 * Only session IDs with an active (non-archive) JSONL file are included.
 * Sessions that only have an archive file are excluded.
 *
 * Returns an empty array when the directory does not exist.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string[]}
 *
 * @example
 * const ids = listSessions();
 * // → ['abc-123', 'def-456', ...]  (newest-modified first)
 */
export function listSessions(opts) {
  const dir = fmSessionsDir(opts);
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir)
      .filter(isActive)
      .map((name) => {
        const sid = sessionIdFromFilename(name);
        const filePath = join(dir, name);
        let mtime = 0;
        try { mtime = statSync(filePath).mtimeMs; } catch { /* use 0 */ }
        return { sessionId: sid, mtime };
      })
      .filter((e) => e.sessionId !== null);

    entries.sort((a, b) => b.mtime - a.mtime);
    return entries.map((e) => e.sessionId);
  } catch {
    return [];
  }
}

// ─── Session readers ──────────────────────────────────────────────────────────

/**
 * Read active turn records for a session.
 *
 * Reads only the active `.jsonl` file — not the archive. Use `readAllSessionTurns`
 * to include archived turns.
 *
 * Returns an empty array when the file does not exist or cannot be read.
 * Lines that cannot be parsed as JSON are silently skipped.
 *
 * When `max` is provided, at most `max` records are returned (taken from the
 * end of the file — i.e. the most-recent turns).
 *
 * @param {{ sessionId: string, cwd?: string, max?: number }} opts
 * @returns {object[]}
 *
 * @example
 * const turns = readSession({ sessionId: 'abc-123' });
 * console.log(turns[0].userMessage);
 *
 * // Limit to the 5 most-recent turns:
 * const recent = readSession({ sessionId: 'abc-123', max: 5 });
 */
export function readSession({ sessionId, cwd, max } = {}) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return [];
  const records = readJsonlFile(sessionFilePath({ sessionId, cwd }));
  if (typeof max === 'number') {
    return max <= 0 ? [] : records.slice(-max);
  }
  return records;
}

/**
 * Read all turn records for a session — both archive and active.
 *
 * Archive turns are prepended (they are the oldest). Active turns follow.
 * Turns are deduplicated by `turn` number in case the same turn appears in
 * both files during a rotation window.
 *
 * Returns an empty array when neither file exists.
 *
 * When `max` is provided, at most `max` records are returned (taken from the
 * end of the combined list — i.e. the most-recent turns).
 *
 * @param {{ sessionId: string, cwd?: string, max?: number }} opts
 * @returns {object[]}
 *
 * @example
 * const all = readAllSessionTurns({ sessionId: 'abc-123' });
 * console.log(all.length); // total turns including archived
 *
 * const last10 = readAllSessionTurns({ sessionId: 'abc-123', max: 10 });
 */
export function readAllSessionTurns({ sessionId, cwd, max } = {}) {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return [];

  const archive = readJsonlFile(sessionArchivePath({ sessionId, cwd }));
  const active = readJsonlFile(sessionFilePath({ sessionId, cwd }));

  // Deduplicate by turn number — prefer the active version if duplicated
  const seen = new Set();
  const all = [];
  for (const rec of [...archive, ...active]) {
    const key = typeof rec.turn === 'number' ? rec.turn : JSON.stringify(rec);
    if (!seen.has(key)) {
      seen.add(key);
      all.push(rec);
    }
  }

  // Re-sort by turn number ascending so archived + active flow chronologically
  all.sort((a, b) => {
    const ta = typeof a.turn === 'number' ? a.turn : 0;
    const tb = typeof b.turn === 'number' ? b.turn : 0;
    return ta - tb;
  });

  if (typeof max === 'number') {
    return max <= 0 ? [] : all.slice(-max);
  }
  return all;
}

// ─── Analysis helpers ─────────────────────────────────────────────────────────

/**
 * Extract the classification lane string from a turn record.
 *
 * The classification field may be a string or an object with a `lane` property.
 * Returns an empty string when the field is absent or unrecognised.
 *
 * @param {object} turn
 * @returns {string}
 *
 * @example
 * getLane({ classification: 'advisory' });
 * // → 'advisory'
 *
 * getLane({ classification: { lane: 'operational', score: 0.9 } });
 * // → 'operational'
 *
 * getLane({});
 * // → ''
 */
export function getLane(turn) {
  if (!turn || typeof turn !== 'object') return '';
  const { classification } = turn;
  if (typeof classification === 'string') return classification;
  if (classification && typeof classification === 'object' && typeof classification.lane === 'string') {
    return classification.lane;
  }
  return '';
}

/**
 * Compute a summary of a loaded session's turns.
 *
 * Returns a lightweight object with counts and the most-recent user message.
 * Pure — no I/O.
 *
 * @param {object[]} turns
 * @returns {{ turnCount: number, lanes: string[], latestTimestamp: string|null, latestUserMessage: string|null }}
 *
 * @example
 * const turns = readSession({ sessionId: 'abc-123' });
 * const summary = summarizeSession(turns);
 * // → { turnCount: 3, lanes: ['advisory', 'operational'], latestTimestamp: '...', latestUserMessage: '...' }
 */
export function summarizeSession(turns) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return { turnCount: 0, lanes: [], latestTimestamp: null, latestUserMessage: null };
  }

  const laneSet = new Set();
  let latestTimestamp = null;
  let latestUserMessage = null;

  for (const t of turns) {
    const lane = getLane(t);
    if (lane) laneSet.add(lane);

    if (typeof t.timestamp === 'string') {
      if (latestTimestamp === null || t.timestamp > latestTimestamp) {
        latestTimestamp = t.timestamp;
      }
    }

    if (typeof t.userMessage === 'string' && t.userMessage.trim().length > 0) {
      latestUserMessage = t.userMessage;
    }
  }

  return {
    turnCount: turns.length,
    lanes: [...laneSet].sort(),
    latestTimestamp,
    latestUserMessage,
  };
}
