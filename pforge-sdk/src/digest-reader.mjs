/**
 * digest-reader.mjs — Offline utilities for reading Plan Forge daily digests.
 *
 * Reads the structured JSON digest files written by `pforge digest` to
 * `.forge/digests/<YYYY-MM-DD>.json`. Useful for CI scripts, external
 * dashboards, or any tool that needs to inspect digest history without a
 * running MCP server.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * On-disk layout (relative to workspace root):
 *   .forge/digests/                 — digest directory
 *   .forge/digests/YYYY-MM-DD.json  — one file per date
 *
 * Digest record shape:
 *   {
 *     sections: Array<{
 *       id:       string,        // 'probe-deltas' | 'aging-bugs' | 'stalled-phases' | 'drift-trend' | 'cost-anomaly'
 *       title:    string,
 *       severity: 'info' | 'warn' | 'alert',
 *       items:    object[],
 *     }>,
 *     generatedAt: string,       // ISO-8601 timestamp
 *   }
 *
 * @module digest-reader
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the digests directory.
 * @type {string}
 */
export const DIGESTS_DIR_RELATIVE = join('.forge', 'digests');

/**
 * Severity levels in ascending order (info < warn < alert).
 * @type {readonly string[]}
 */
export const SEVERITY_LEVELS = Object.freeze(['info', 'warn', 'alert']);

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** @param {{ cwd?: string }} [opts] */
function rootOf(opts) {
  return opts?.cwd ?? process.cwd();
}

/** @param {string} filePath @returns {object|null} */
function safeReadJson(filePath) {
  try {
    const text = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Return true if `name` looks like a date-named digest file (YYYY-MM-DD.json). */
function isDigestFilename(name) {
  return /^\d{4}-\d{2}-\d{2}\.json$/.test(name);
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to the `.forge/digests/` directory.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * digestsDir();
 * // → '/workspace/.forge/digests'
 *
 * digestsDir({ cwd: '/my/project' });
 * // → '/my/project/.forge/digests'
 */
export function digestsDir(opts) {
  return resolve(rootOf(opts), '.forge', 'digests');
}

/**
 * Resolve the absolute path to a specific digest file.
 *
 * @param {{ date: string, cwd?: string }} opts
 *   `date` must be an ISO date string (YYYY-MM-DD).
 * @returns {string}
 *
 * @example
 * digestFilePath({ date: '2026-05-20' });
 * // → '/workspace/.forge/digests/2026-05-20.json'
 */
export function digestFilePath({ date, cwd }) {
  return resolve(rootOf({ cwd }), '.forge', 'digests', `${date}.json`);
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * List all digest dates available on disk, sorted newest-first.
 *
 * Returns an empty array when the `.forge/digests/` directory does not exist
 * or contains no date-named JSON files.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string[]} Date strings in `YYYY-MM-DD` format, newest first.
 *
 * @example
 * const dates = listDigests();
 * // → ['2026-05-20', '2026-05-19', '2026-05-18']
 */
export function listDigests(opts) {
  const dir = digestsDir(opts);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(isDigestFilename)
      .map((f) => basename(f, '.json'))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// ─── Readers ──────────────────────────────────────────────────────────────────

/**
 * Read a specific digest by date.
 *
 * Returns `null` when the file does not exist or cannot be parsed as a valid
 * digest object.
 *
 * @param {{ date: string, cwd?: string }} opts
 *   `date` must be an ISO date string (YYYY-MM-DD).
 * @returns {object|null}
 *
 * @example
 * const digest = readDigest({ date: '2026-05-20' });
 * if (digest) {
 *   console.log(digest.sections.length);  // → 5
 *   console.log(digest.generatedAt);       // → '2026-05-20T06:00:00.000Z'
 * }
 */
export function readDigest({ date, cwd } = {}) {
  if (typeof date !== 'string' || date.trim().length === 0) return null;
  const filePath = digestFilePath({ date, cwd });
  return safeReadJson(filePath);
}

/**
 * Read the most recent digest available on disk.
 *
 * Returns `null` when no digest files exist or the latest cannot be read.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {object|null}
 *
 * @example
 * const latest = readLatestDigest();
 * if (latest) {
 *   const severity = overallSeverity(latest);
 *   console.log(severity);  // → 'warn'
 * }
 */
export function readLatestDigest(opts) {
  const dates = listDigests(opts);
  if (dates.length === 0) return null;
  return readDigest({ date: dates[0], cwd: opts?.cwd });
}

// ─── Analysis helpers ─────────────────────────────────────────────────────────

/**
 * Compute the overall severity of a digest by taking the maximum severity
 * across all sections.
 *
 * Returns `'info'` for an empty or invalid digest.
 *
 * Severity order: `info` < `warn` < `alert`
 *
 * @param {object} digest
 * @returns {'info' | 'warn' | 'alert'}
 *
 * @example
 * overallSeverity({ sections: [
 *   { severity: 'info' },
 *   { severity: 'warn' },
 * ] });
 * // → 'warn'
 */
export function overallSeverity(digest) {
  if (!digest || !Array.isArray(digest.sections) || digest.sections.length === 0) return 'info';
  let maxIdx = 0;
  for (const section of digest.sections) {
    const idx = SEVERITY_LEVELS.indexOf(section.severity);
    if (idx > maxIdx) maxIdx = idx;
  }
  return SEVERITY_LEVELS[maxIdx];
}

/**
 * Return only the sections from a digest whose severity meets or exceeds
 * the given threshold.
 *
 * @param {object} digest
 * @param {'info' | 'warn' | 'alert'} [threshold='warn']
 * @returns {object[]} Filtered section array (may be empty).
 *
 * @example
 * const alertSections = getSectionsByMinSeverity(digest, 'alert');
 */
export function getSectionsByMinSeverity(digest, threshold = 'warn') {
  if (!digest || !Array.isArray(digest.sections)) return [];
  const minIdx = SEVERITY_LEVELS.indexOf(threshold);
  if (minIdx === -1) return [];
  return digest.sections.filter((s) => {
    const idx = SEVERITY_LEVELS.indexOf(s.severity);
    return idx >= minIdx;
  });
}
