/**
 * run-reader.mjs — Offline utilities for reading Plan Forge run artifacts.
 *
 * Provides path helpers and readers for the standard `.forge/runs/` layout
 * written by the Plan Forge orchestrator. All functions that read files are
 * graceful — they return `null` / `[]` on missing files rather than throwing.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * On-disk layout (relative to workspace root):
 *   .forge/runs/                   — run directories
 *   .forge/runs/index.jsonl        — append-only global run index
 *   .forge/runs/<runId>/run.json   — run metadata (plan path, model, timing)
 *   .forge/runs/<runId>/summary.json — post-run summary (results, cost, status)
 *   .forge/runs/<runId>/events.log — line-by-line event log
 *
 * Events.log line format (written by the orchestrator):
 *   [<ISO 8601 timestamp>] <event-type>: <JSON-encoded data>
 *
 * @module run-reader
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the runs directory.
 * @type {string}
 */
export const RUNS_DIR_RELATIVE = join('.forge', 'runs');

/**
 * Relative path (from workspace root) to the global run index file.
 * @type {string}
 */
export const INDEX_FILE_RELATIVE = join('.forge', 'runs', 'index.jsonl');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** @param {{ cwd?: string }} [opts] */
function rootOf(opts) {
  return opts?.cwd ?? process.cwd();
}

/**
 * Try to parse JSON from a file path.
 * @param {string} filePath
 * @returns {unknown|null}
 */
function tryReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to the runs directory.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * runsDir();
 * // → '/workspace/.forge/runs'
 */
export function runsDir(opts) {
  return resolve(rootOf(opts), '.forge', 'runs');
}

/**
 * Resolve the absolute path to a specific run's directory.
 *
 * @param {{ runId: string, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * runDir({ runId: '20260516-123456' });
 * // → '/workspace/.forge/runs/20260516-123456'
 */
export function runDir({ runId, cwd }) {
  return resolve(rootOf({ cwd }), '.forge', 'runs', runId);
}

/**
 * Resolve the absolute path to the global run index file.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * runIndexPath();
 * // → '/workspace/.forge/runs/index.jsonl'
 */
export function runIndexPath(opts) {
  return resolve(rootOf(opts), '.forge', 'runs', 'index.jsonl');
}

// ─── Run discovery ────────────────────────────────────────────────────────────

/**
 * List run IDs from `.forge/runs/`, sorted newest-first (lexicographic descending,
 * which works because run IDs are timestamp-prefixed).
 *
 * Returns an empty array when the runs directory does not exist or is unreadable.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string[]}
 *
 * @example
 * const ids = listRuns();
 * // → ['20260519-183001', '20260518-102233', ...]
 */
export function listRuns(opts) {
  const dir = runsDir(opts);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// ─── Artifact readers ─────────────────────────────────────────────────────────

/**
 * Read the `run.json` metadata file for a specific run.
 *
 * Fields include: `plan`, `traceId`, `startTime`, `model`, `mode`,
 * `quorumMode`, `quorumPreset`, `sliceCount`, `executionOrder`.
 *
 * Returns `null` when the file does not exist or cannot be parsed.
 *
 * @param {{ runId: string, cwd?: string }} opts
 * @returns {object|null}
 *
 * @example
 * const meta = readRunMeta({ runId: '20260519-183001' });
 * if (meta) console.log(meta.plan, meta.status);
 */
export function readRunMeta({ runId, cwd }) {
  const filePath = resolve(rootOf({ cwd }), '.forge', 'runs', runId, 'run.json');
  return tryReadJson(filePath);
}

/**
 * Read the `summary.json` file for a specific run.
 *
 * Fields include: `plan`, `phase`, `startTime`, `endTime`, `status`,
 * `results` `{ passed, failed, skipped, total }`, `totalDuration`,
 * `model`, `mode`, `quorumMode`, `cost`, `sliceResults`.
 *
 * Returns `null` when the file does not exist or cannot be parsed.
 *
 * @param {{ runId: string, cwd?: string }} opts
 * @returns {object|null}
 *
 * @example
 * const summary = readRunSummary({ runId: '20260519-183001' });
 * if (summary?.status === 'completed') { ... }
 */
export function readRunSummary({ runId, cwd }) {
  const filePath = resolve(rootOf({ cwd }), '.forge', 'runs', runId, 'summary.json');
  return tryReadJson(filePath);
}

/**
 * Read the global run index from `.forge/runs/index.jsonl`.
 *
 * Each line is a JSON object representing a completed or in-progress run.
 * Lines that cannot be parsed are silently skipped.
 *
 * Returns an empty array when the file does not exist.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {object[]}
 *
 * @example
 * const index = readRunIndex();
 * const latestFailed = index.filter(r => r.status === 'failed').at(-1);
 */
export function readRunIndex(opts) {
  const filePath = runIndexPath(opts);
  if (!existsSync(filePath)) return [];
  try {
    const text = readFileSync(filePath, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      });
  } catch {
    return [];
  }
}

// ─── Events.log parser ────────────────────────────────────────────────────────

// Mirrors the EVENT_LINE_RE used in pforge-mcp/audit-export.mjs.
const EVENT_LINE_RE = /^\[([^\]]+)\]\s+([a-z][-a-z0-9]*(?:\.[a-z][-a-z0-9]*)*(?::[a-z][-a-z0-9]*)?(?:[-][-a-z0-9]+)*(?:-[a-z0-9]+)*)\s*:\s*(.*)$/;

/**
 * Parse a single line from an `events.log` file.
 *
 * Format: `[<timestamp>] <event-type>: <JSON-encoded data>`
 *
 * Pure — no I/O. Returns `null` for lines that do not match the format.
 *
 * @param {string} line
 * @returns {{ ts: string, type: string, data: object } | null}
 *
 * @example
 * parseEventLine('[2026-05-19T18:30:01.000Z] slice-started: {"sliceId":1}');
 * // → { ts: '2026-05-19T18:30:01.000Z', type: 'slice-started', data: { sliceId: 1 } }
 */
export function parseEventLine(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(EVENT_LINE_RE);
  if (!m) return null;
  let data = {};
  try { data = JSON.parse(m[3] || '{}'); } catch { /* leave empty */ }
  return { ts: m[1], type: m[2], data };
}
