/**
 * trajectory-reader.mjs — Offline utilities for reading Plan Forge trajectory notes.
 *
 * Reads the markdown trajectory files written by the Plan Forge orchestrator
 * to `.forge/trajectories/<planBasename>/slice-<sliceId>.md` after each passing
 * slice. Useful for CI scripts, external dashboards, or any tool that needs to
 * inspect execution history without a running MCP server.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * On-disk layout (relative to workspace root):
 *   .forge/trajectories/                              — root trajectories directory
 *   .forge/trajectories/<planBasename>/               — per-plan directory
 *   .forge/trajectories/<planBasename>/slice-N.md     — one markdown note per slice
 *
 * Trajectory file content:
 *   Plain prose markdown, ≤500 words, no code blocks.
 *   Written between <!-- PFORGE_TRAJECTORY:BEGIN --> and <!-- PFORGE_TRAJECTORY:END -->
 *   sentinels in the orchestrator output, then stored without the sentinels.
 *
 * @module trajectory-reader
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the trajectories directory.
 * @type {string}
 */
export const TRAJECTORIES_DIR_RELATIVE = join('.forge', 'trajectories');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** @param {{ cwd?: string }} [opts] */
function rootOf(opts) {
  return opts?.cwd ?? process.cwd();
}

/**
 * Sanitize a path component to prevent directory traversal.
 * Allows alphanumerics, dots, underscores, and hyphens only.
 * Collapses `..` sequences. Truncates at 128 chars.
 *
 * @param {string} s
 * @returns {string}
 */
function sanitize(s) {
  let cleaned = String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  while (cleaned.includes('..')) {
    cleaned = cleaned.replace(/\.\./g, '_');
  }
  cleaned = cleaned.slice(0, 128);
  return cleaned.length > 0 ? cleaned : '_';
}

/**
 * Count whitespace-delimited words in a string.
 *
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 0;
  return text.trim().split(/\s+/).length;
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to `.forge/trajectories/`.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * trajectoriesDir();
 * // → '/workspace/.forge/trajectories'
 *
 * trajectoriesDir({ cwd: '/my/project' });
 * // → '/my/project/.forge/trajectories'
 */
export function trajectoriesDir(opts) {
  return resolve(rootOf(opts), '.forge', 'trajectories');
}

/**
 * Resolve the absolute path to the per-plan trajectory directory.
 *
 * @param {{ planBasename: string, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * planTrajectoriesDir({ planBasename: 'Phase-42-CLEAN-CODE-AUDIT-PLAN' });
 * // → '/workspace/.forge/trajectories/Phase-42-CLEAN-CODE-AUDIT-PLAN'
 */
export function planTrajectoriesDir({ planBasename, cwd }) {
  if (typeof planBasename !== 'string' || planBasename.trim().length === 0) {
    throw new TypeError('planTrajectoriesDir: planBasename is required');
  }
  return resolve(rootOf({ cwd }), '.forge', 'trajectories', sanitize(planBasename));
}

/**
 * Resolve the absolute path to a specific trajectory file.
 *
 * @param {{ planBasename: string, sliceId: string|number, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * trajectoryFilePath({ planBasename: 'Phase-42-CLEAN-CODE-AUDIT-PLAN', sliceId: '3' });
 * // → '/workspace/.forge/trajectories/Phase-42-CLEAN-CODE-AUDIT-PLAN/slice-3.md'
 */
export function trajectoryFilePath({ planBasename, sliceId, cwd }) {
  if (typeof planBasename !== 'string' || planBasename.trim().length === 0) {
    throw new TypeError('trajectoryFilePath: planBasename is required');
  }
  if (sliceId === undefined || sliceId === null || sliceId === '') {
    throw new TypeError('trajectoryFilePath: sliceId is required');
  }
  return resolve(
    rootOf({ cwd }),
    '.forge',
    'trajectories',
    sanitize(planBasename),
    `slice-${sanitize(String(sliceId))}.md`,
  );
}

// ─── Slice ID helpers ─────────────────────────────────────────────────────────

/**
 * Extract a slice ID from a trajectory filename.
 *
 * Returns the ID string (e.g. `'1'`, `'12'`, `'S3'`) for filenames matching
 * `slice-<id>.md`, or `null` for anything that doesn't match.
 *
 * @param {string} filename — e.g. `'slice-3.md'`
 * @returns {string|null}
 *
 * @example
 * parseSliceId('slice-3.md');   // → '3'
 * parseSliceId('slice-12.md');  // → '12'
 * parseSliceId('notes.md');     // → null
 * parseSliceId(null);           // → null
 */
export function parseSliceId(filename) {
  if (typeof filename !== 'string') return null;
  const m = /^slice-([A-Za-z0-9._-]+)\.md$/.exec(filename);
  return m ? m[1] : null;
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

/**
 * Compare two slice IDs for sorting.
 *
 * Numeric IDs sort numerically; non-numeric IDs sort lexicographically;
 * numeric IDs sort before non-numeric ones.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSliceIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  const aIsNum = !Number.isNaN(na);
  const bIsNum = !Number.isNaN(nb);
  if (aIsNum && bIsNum) return na - nb;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b);
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * List plan basenames that have a trajectory directory under `.forge/trajectories/`.
 *
 * Returns names sorted alphabetically. Entries that are not directories are
 * excluded silently.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string[]}
 *
 * @example
 * listPlans();
 * // → ['Phase-42-CLEAN-CODE-AUDIT-PLAN', 'Phase-AUTH-RBAC-SCAFFOLD-PLAN']
 */
export function listPlans(opts = {}) {
  const dir = trajectoriesDir(opts);
  if (!existsSync(dir)) return [];

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries
    .filter((name) => {
      try {
        return statSync(resolve(dir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

/**
 * List all trajectory entries for a plan, sorted numerically by slice ID.
 *
 * Each entry includes the slice ID, absolute file path, and word count.
 * Returns `[]` when the plan directory does not exist.
 *
 * @param {{ planBasename: string, cwd?: string }} opts
 * @returns {Array<{ sliceId: string, path: string, wordCount: number }>}
 *
 * @example
 * listTrajectories({ planBasename: 'Phase-42-CLEAN-CODE-AUDIT-PLAN' });
 * // → [{ sliceId: '1', path: '/…/slice-1.md', wordCount: 342 }, …]
 */
export function listTrajectories({ planBasename, cwd } = {}) {
  if (typeof planBasename !== 'string' || planBasename.trim().length === 0) return [];

  const dir = planTrajectoriesDir({ planBasename, cwd });
  if (!existsSync(dir)) return [];

  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const entries = [];
  for (const file of files) {
    const sliceId = parseSliceId(file);
    if (!sliceId) continue;
    const filePath = resolve(dir, file);
    let content = '';
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      // Unreadable files are skipped
    }
    entries.push({ sliceId, path: filePath, wordCount: countWords(content) });
  }

  return entries.sort((a, b) => compareSliceIds(a.sliceId, b.sliceId));
}

// ─── Reader ───────────────────────────────────────────────────────────────────

/**
 * Read a single trajectory note by plan basename and slice ID.
 *
 * Returns `null` when the file does not exist or cannot be read.
 *
 * @param {{ planBasename: string, sliceId: string|number, cwd?: string }} opts
 * @returns {{ sliceId: string, content: string, wordCount: number } | null}
 *
 * @example
 * const note = readTrajectory({ planBasename: 'Phase-42-CLEAN-CODE-AUDIT-PLAN', sliceId: '3' });
 * if (note) {
 *   console.log(note.wordCount);  // → 312
 * }
 */
export function readTrajectory({ planBasename, sliceId, cwd } = {}) {
  if (typeof planBasename !== 'string' || planBasename.trim().length === 0) return null;
  if (sliceId === undefined || sliceId === null || sliceId === '') return null;

  const filePath = trajectoryFilePath({ planBasename, sliceId, cwd });
  if (!existsSync(filePath)) return null;

  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  return { sliceId: String(sliceId), content, wordCount: countWords(content) };
}

// ─── Composite reader ─────────────────────────────────────────────────────────

/**
 * Read all trajectory notes for a plan in ascending slice-ID order.
 *
 * Each entry includes the slice ID, content, and word count.
 * Unreadable or missing files are silently excluded.
 * Returns `[]` when the plan directory does not exist.
 *
 * @param {{ planBasename: string, cwd?: string }} opts
 * @returns {Array<{ sliceId: string, content: string, wordCount: number }>}
 *
 * @example
 * const notes = readAllTrajectories({ planBasename: 'Phase-42-CLEAN-CODE-AUDIT-PLAN' });
 * for (const note of notes) {
 *   console.log(`S${note.sliceId}: ${note.wordCount} words`);
 * }
 */
export function readAllTrajectories({ planBasename, cwd } = {}) {
  if (typeof planBasename !== 'string' || planBasename.trim().length === 0) return [];

  const dir = planTrajectoriesDir({ planBasename, cwd });
  if (!existsSync(dir)) return [];

  let files;
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  const entries = [];
  for (const file of files) {
    const sliceId = parseSliceId(file);
    if (!sliceId) continue;
    const filePath = resolve(dir, file);
    let content = '';
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue; // Skip unreadable files entirely
    }
    entries.push({ sliceId, content, wordCount: countWords(content) });
  }

  return entries.sort((a, b) => compareSliceIds(a.sliceId, b.sliceId));
}

// ─── Analysis helpers ─────────────────────────────────────────────────────────

/**
 * Produce a summary of trajectory entries.
 *
 * Works on in-memory arrays — no I/O. Suitable for producing quick stats
 * after calling `listTrajectories` or `readAllTrajectories`.
 *
 * @param {Array<{ sliceId: string, wordCount?: number }>} entries
 * @returns {{
 *   total:      number,
 *   sliceIds:   string[],
 *   totalWords: number,
 *   avgWords:   number,
 * }}
 *
 * @example
 * const notes = readAllTrajectories({ planBasename: 'Phase-42-CLEAN-CODE-AUDIT-PLAN' });
 * const stats = summarizeTrajectories(notes);
 * // → { total: 5, sliceIds: ['1','2','3','4','5'], totalWords: 1540, avgWords: 308 }
 */
export function summarizeTrajectories(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { total: 0, sliceIds: [], totalWords: 0, avgWords: 0 };
  }

  let totalWords = 0;
  const sliceIds = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    sliceIds.push(String(entry.sliceId ?? ''));
    totalWords += typeof entry.wordCount === 'number' ? entry.wordCount : 0;
  }

  const total = sliceIds.length;
  const avgWords = total > 0 ? Math.round(totalWords / total) : 0;

  return { total, sliceIds, totalWords, avgWords };
}
