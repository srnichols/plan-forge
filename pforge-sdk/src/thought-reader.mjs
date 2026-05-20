/**
 * thought-reader.mjs — Offline utilities for reading Plan Forge thought stores.
 *
 * Reads the local `.forge/*.jsonl` thought files written by the OpenBrain
 * queue, LiveGuard, and other Plan Forge sub-systems. Useful for CI scripts,
 * external dashboards, or any tool that needs to inspect thought history
 * without a running MCP server.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * On-disk layout (relative to workspace root):
 *   .forge/                                — Plan Forge workspace directory
 *   .forge/openbrain-queue.jsonl           — pending thoughts (not yet delivered)
 *   .forge/openbrain-queue.archive.jsonl   — delivered thoughts
 *   .forge/openbrain-dlq.jsonl             — dead-letter queue (failed deliveries)
 *   .forge/liveguard-memories.jsonl        — LiveGuard memory records
 *
 * Thought record shape (minimum — extra fields vary by source):
 *   { _v: 1, content: string, project?: string }
 *
 * Queue archive records add delivery metadata:
 *   { _v, _status, _attempts, _enqueuedAt, _nextAttemptAt, content, project? }
 *
 * @module thought-reader
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the `.forge/` directory.
 * @type {string}
 */
export const FORGE_DIR_RELATIVE = '.forge';

/**
 * Default JSONL source filenames (relative to `.forge/`) that hold thoughts.
 * Mirrors the `THOUGHT_SOURCES` list used by `pforge-mcp/local-recall.mjs`.
 * @type {readonly string[]}
 */
export const THOUGHT_SOURCES = Object.freeze([
  'openbrain-queue.jsonl',
  'openbrain-queue.archive.jsonl',
  'openbrain-dlq.jsonl',
  'liveguard-memories.jsonl',
]);

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** @param {{ cwd?: string }} [opts] */
function rootOf(opts) {
  return opts?.cwd ?? process.cwd();
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to the `.forge/` directory.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 *
 * @example
 * forgeDir();
 * // → '/workspace/.forge'
 *
 * forgeDir({ cwd: '/my/project' });
 * // → '/my/project/.forge'
 */
export function forgeDir(opts) {
  return resolve(rootOf(opts), '.forge');
}

/**
 * Resolve the absolute path to a specific thought source file.
 *
 * @param {{ source: string, cwd?: string }} opts
 * @returns {string}
 *
 * @example
 * thoughtFilePath({ source: 'openbrain-queue.archive.jsonl' });
 * // → '/workspace/.forge/openbrain-queue.archive.jsonl'
 */
export function thoughtFilePath({ source, cwd }) {
  return resolve(rootOf({ cwd }), '.forge', source);
}

// ─── Source discovery ─────────────────────────────────────────────────────────

/**
 * List thought source filenames that actually exist on disk.
 *
 * By default, checks every entry in `THOUGHT_SOURCES`. Pass `sources` to
 * restrict the check to a specific subset.
 *
 * Returns an empty array when the `.forge/` directory does not exist.
 *
 * @param {{ cwd?: string, sources?: string[] }} [opts]
 * @returns {string[]}
 *
 * @example
 * const present = listThoughtSources();
 * // → ['openbrain-queue.archive.jsonl', 'liveguard-memories.jsonl']
 */
export function listThoughtSources(opts) {
  const dir = forgeDir(opts);
  if (!existsSync(dir)) return [];
  const candidates = Array.isArray(opts?.sources) ? opts.sources : THOUGHT_SOURCES;
  return candidates.filter((src) => existsSync(join(dir, src)));
}

// ─── Thought readers ──────────────────────────────────────────────────────────

/**
 * Parse a single JSONL line into a thought record.
 *
 * Pure — no I/O. Returns `null` for blank lines or lines that cannot be
 * parsed as JSON.
 *
 * @param {string} line
 * @returns {object|null}
 *
 * @example
 * parseThoughtLine('{"_v":1,"content":"test"}');
 * // → { _v: 1, content: 'test' }
 *
 * parseThoughtLine('not json');
 * // → null
 *
 * parseThoughtLine('');
 * // → null
 */
export function parseThoughtLine(line) {
  if (typeof line !== 'string' || line.trim().length === 0) return null;
  try {
    const record = JSON.parse(line.trim());
    if (typeof record !== 'object' || record === null || Array.isArray(record)) return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Read thought records from a single `.forge/<source>` file.
 *
 * Lines that cannot be parsed as JSON are silently skipped. When `max` is
 * provided, at most `max` records are returned (taken from the end of the
 * file — i.e. the most-recent entries).
 *
 * Returns an empty array when the file does not exist or cannot be read.
 *
 * @param {{ source: string, cwd?: string, max?: number }} opts
 * @returns {object[]}
 *
 * @example
 * const records = readThoughts({ source: 'liveguard-memories.jsonl' });
 * console.log(records[0].content);
 *
 * // Limit to the 10 most-recent records:
 * const recent = readThoughts({ source: 'openbrain-queue.archive.jsonl', max: 10 });
 */
export function readThoughts({ source, cwd, max } = {}) {
  if (typeof source !== 'string' || source.trim().length === 0) return [];
  const filePath = thoughtFilePath({ source, cwd });
  if (!existsSync(filePath)) return [];
  let text;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  const records = text
    .split('\n')
    .map((l) => parseThoughtLine(l))
    .filter((r) => r !== null);

  if (typeof max === 'number') {
    return max <= 0 ? [] : records.slice(-max);
  }
  return records;
}

/**
 * Read thought records from multiple `.forge/*.jsonl` sources.
 *
 * Sources are read in the order given (default: `THOUGHT_SOURCES`). Records
 * from each file are appended in order; no deduplication is performed.
 *
 * When `max` is provided, the combined result is capped at `max` records
 * (newest entries across all files, i.e. `slice(-max)` applied to the
 * concatenated list).
 *
 * Returns an empty array when no source files can be read.
 *
 * @param {{ cwd?: string, sources?: string[], max?: number }} [opts]
 * @returns {object[]}
 *
 * @example
 * const all = readAllThoughts();
 * console.log(all.length); // total records across all default sources
 *
 * const limited = readAllThoughts({ max: 50 });
 * // → at most the 50 most-recent records across all sources
 *
 * const subset = readAllThoughts({
 *   sources: ['liveguard-memories.jsonl'],
 *   max: 20,
 * });
 */
export function readAllThoughts(opts = {}) {
  const { cwd, max } = opts;
  const sources = Array.isArray(opts.sources) ? opts.sources : THOUGHT_SOURCES;
  const all = [];
  for (const src of sources) {
    const records = readThoughts({ source: src, cwd });
    all.push(...records);
  }
  if (typeof max === 'number') {
    return max <= 0 ? [] : all.slice(-max);
  }
  return all;
}
