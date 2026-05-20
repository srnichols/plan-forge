/**
 * bug-reader.mjs — Offline utilities for reading Plan Forge bug registry entries.
 *
 * Reads the structured JSON bug files written by the Plan Forge tempering
 * sub-system to `.forge/bugs/<bugId>.json`. Useful for CI scripts, external
 * dashboards, or any tool that needs to inspect the bug registry without a
 * running MCP server.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * On-disk layout (relative to workspace root):
 *   .forge/bugs/                          — bug directory
 *   .forge/bugs/bug-YYYY-MM-DD-NNN.json   — one file per bug
 *
 * Bug record shape:
 *   {
 *     bugId:          string,           // 'bug-YYYY-MM-DD-NNN'
 *     fingerprint:    string,           // SHA-1 dedup fingerprint
 *     scanner:        string,           // scanner that discovered the bug
 *     severity:       string,           // 'info' | 'low' | 'medium' | 'high' | 'critical'
 *     status:         string,           // 'open' | 'in-fix' | 'fixed' | 'wont-fix' | 'duplicate'
 *     classification: string,           // 'real-bug' | 'infra' | ...
 *     classifierMeta: object | null,
 *     evidence:       object,           // { testName?, assertionMessage?, stackTrace? }
 *     affectedFiles:  string[],
 *     reproSteps:     string | null,
 *     correlationId:  string | null,
 *     sliceRef:       string | null,
 *     discoveredAt:   string,           // ISO-8601 timestamp
 *     updatedAt:      string,           // ISO-8601 timestamp
 *   }
 *
 * @module bug-reader
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the bugs directory.
 * @type {string}
 */
export const BUGS_DIR_RELATIVE = join('.forge', 'bugs');

/**
 * Valid bug status values, matching the tempering bug registry.
 * @type {readonly string[]}
 */
export const BUG_STATUSES = Object.freeze([
  'open',
  'in-fix',
  'fixed',
  'wont-fix',
  'duplicate',
]);

/**
 * Known severity levels in ascending order (info < low < medium < high < critical).
 * @type {readonly string[]}
 */
export const BUG_SEVERITIES = Object.freeze([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

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

/** Return true if `name` looks like a bug file (bug-YYYY-MM-DD-NNN.json). */
function isBugFilename(name) {
  return /^bug-\d{4}-\d{2}-\d{2}-\d{3,}\.json$/.test(name);
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to the `.forge/bugs/` directory.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * bugsDir();
 * // → '/workspace/.forge/bugs'
 *
 * bugsDir({ cwd: '/my/project' });
 * // → '/my/project/.forge/bugs'
 */
export function bugsDir(opts) {
  return resolve(rootOf(opts), '.forge', 'bugs');
}

/**
 * Resolve the absolute path to a specific bug file.
 *
 * @param {{ bugId: string, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * bugFilePath({ bugId: 'bug-2026-05-20-001' });
 * // → '/workspace/.forge/bugs/bug-2026-05-20-001.json'
 */
export function bugFilePath({ bugId, cwd }) {
  return resolve(rootOf({ cwd }), '.forge', 'bugs', `${bugId}.json`);
}

// ─── Bug ID helpers ───────────────────────────────────────────────────────────

/**
 * Extract a bug ID from a filename by stripping the `.json` extension.
 *
 * Returns `null` for names that do not match the expected `bug-YYYY-MM-DD-NNN.json`
 * pattern or are not strings.
 *
 * @param {string} filename — e.g. `'bug-2026-05-20-001.json'`
 * @returns {string|null}
 *
 * @example
 * parseBugId('bug-2026-05-20-001.json');  // → 'bug-2026-05-20-001'
 * parseBugId('other.json');               // → null
 */
export function parseBugId(filename) {
  if (typeof filename !== 'string') return null;
  if (!isBugFilename(filename)) return null;
  return basename(filename, '.json');
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * List bugs from `.forge/bugs/` with optional filters, newest-discovered first.
 *
 * All filter fields are optional. When omitted, all bugs are returned.
 *
 * @param {{ cwd?: string, status?: string, severity?: string, scanner?: string, since?: string, until?: string }} [opts]
 * @returns {object[]} Array of bug record objects.
 *
 * @example
 * // All open bugs
 * const openBugs = listBugs({ status: 'open' });
 *
 * // All critical bugs regardless of status
 * const critical = listBugs({ severity: 'critical' });
 *
 * // Bugs discovered since a date
 * const recent = listBugs({ since: '2026-05-01T00:00:00.000Z' });
 */
export function listBugs(opts = {}) {
  const dir = bugsDir(opts);
  if (!existsSync(dir)) return [];

  let files;
  try {
    files = readdirSync(dir).filter(isBugFilename);
  } catch {
    return [];
  }

  const bugs = [];
  for (const file of files) {
    const bug = safeReadJson(resolve(dir, file));
    if (!bug) continue;

    if (opts.status && bug.status !== opts.status) continue;
    if (opts.severity && bug.severity !== opts.severity) continue;
    if (opts.scanner && bug.scanner !== opts.scanner) continue;
    if (opts.since && (bug.discoveredAt || '') < opts.since) continue;
    if (opts.until && (bug.discoveredAt || '') > opts.until) continue;

    bugs.push(bug);
  }

  // Sort newest-discovered first; fall back to bugId lexicographic order for ties
  bugs.sort((a, b) => {
    const da = a.discoveredAt || '';
    const db = b.discoveredAt || '';
    if (db !== da) return db.localeCompare(da);
    return (b.bugId || '').localeCompare(a.bugId || '');
  });

  return bugs;
}

// ─── Reader ───────────────────────────────────────────────────────────────────

/**
 * Read a single bug record by ID.
 *
 * Returns `null` when the file does not exist, the `bugId` is invalid, or
 * the file cannot be parsed as a valid bug object.
 *
 * @param {{ bugId: string, cwd?: string }} opts
 * @returns {object|null}
 *
 * @example
 * const bug = readBug({ bugId: 'bug-2026-05-20-001' });
 * if (bug) {
 *   console.log(bug.status);    // → 'open'
 *   console.log(bug.severity);  // → 'critical'
 * }
 */
export function readBug({ bugId, cwd } = {}) {
  if (typeof bugId !== 'string' || bugId.trim().length === 0) return null;
  // Path traversal guard: only allow bug-YYYY-MM-DD-NNN format
  if (!/^bug-\d{4}-\d{2}-\d{2}-\d{3,}$/.test(bugId)) return null;
  const filePath = bugFilePath({ bugId, cwd });
  return safeReadJson(filePath);
}

// ─── Analysis helpers ─────────────────────────────────────────────────────────

/**
 * Produce a summary of a bug array.
 *
 * @param {object[]} bugs — Array of bug record objects (e.g. from `listBugs`).
 * @returns {{
 *   total:      number,
 *   byStatus:   Record<string, number>,
 *   bySeverity: Record<string, number>,
 *   scanners:   string[],
 * }}
 *
 * @example
 * const bugs = listBugs({ status: 'open' });
 * const summary = summarizeBugs(bugs);
 * // → { total: 3, byStatus: { open: 3 }, bySeverity: { critical: 1, high: 2 }, scanners: ['vitest'] }
 */
export function summarizeBugs(bugs) {
  if (!Array.isArray(bugs) || bugs.length === 0) {
    return { total: 0, byStatus: {}, bySeverity: {}, scanners: [] };
  }

  const byStatus = {};
  const bySeverity = {};
  const scannerSet = new Set();

  for (const bug of bugs) {
    if (!bug || typeof bug !== 'object') continue;

    if (bug.status) {
      byStatus[bug.status] = (byStatus[bug.status] || 0) + 1;
    }
    if (bug.severity) {
      bySeverity[bug.severity] = (bySeverity[bug.severity] || 0) + 1;
    }
    if (bug.scanner) {
      scannerSet.add(bug.scanner);
    }
  }

  return {
    total: bugs.length,
    byStatus,
    bySeverity,
    scanners: [...scannerSet].sort(),
  };
}
