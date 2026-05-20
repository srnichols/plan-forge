/**
 * anvil.mjs — Anvil cache-key helpers for pforge-sdk.
 *
 * Exposes the canonical cache-key algorithm used by `pforge-mcp/anvil.mjs`
 * so external code can compute, inspect, and reason about Anvil entries
 * without taking a dependency on the full MCP server package.
 *
 * All functions are pure (no I/O). Path helpers use `node:path` only.
 *
 * Cache-key formula (mirrors pforge-mcp/anvil.mjs exactly):
 *   key = sha256( toolName + ":" + sha256(JSON.stringify(inputs, sortedKeys)) + ":" + sha256(codeHashSeed) )
 *
 * On-disk layout (relative to workspace root):
 *   .forge/anvil/<toolName>/<key>.json   — cached payload
 *   .forge/anvil/stats.json              — per-tool hit/miss counters
 */

import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * SHA-256 hex of a UTF-8 string.
 * @param {string} data
 * @returns {string}
 */
function sha256(data) {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * JSON.stringify replacer that sorts object keys for canonical serialisation.
 * Arrays are left unchanged so that positional semantics are preserved.
 * @param {string} _key
 * @param {*} value
 * @returns {*}
 */
function sortedReplacer(_key, value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = value[k];
    return sorted;
  }
  return value;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Relative path (from workspace root) to the Anvil stats file.
 * @type {string}
 */
export const ANVIL_STATS_RELATIVE = join('.forge', 'anvil', 'stats.json');

/**
 * Compute the canonical Anvil cache key.
 *
 * The algorithm is identical to the one in `pforge-mcp/anvil.mjs` so that
 * external tools can predict whether a given (toolName, inputs, codeHashSeed)
 * triple is already cached without calling the server.
 *
 * @param {string} toolName       — Stable tool identifier (e.g. `'forge_search'`)
 * @param {*}      inputs         — Tool input value (any JSON-serialisable type)
 * @param {string} codeHashSeed   — Seed that changes when the producing code changes
 * @returns {string}              64-character lowercase hex string
 *
 * @example
 * const key = computeAnvilKey('forge_search', { q: 'drift' }, 'v1.2.3');
 * // → '3f8a…' (64-char hex)
 */
export function computeAnvilKey(toolName, inputs, codeHashSeed) {
  const inputsHash = sha256(JSON.stringify(inputs, sortedReplacer));
  const seedHash = sha256(String(codeHashSeed));
  return sha256(`${toolName}:${inputsHash}:${seedHash}`);
}

/**
 * Resolve the absolute path to an Anvil cache entry on disk.
 *
 * @param {{ toolName: string, key: string, cwd?: string }} opts
 * @returns {string} Absolute path to `<cwd>/.forge/anvil/<toolName>/<key>.json`
 *
 * @example
 * const key  = computeAnvilKey('forge_search', { q: 'drift' }, 'v1.2.3');
 * const path = anvilEntryPath({ toolName: 'forge_search', key });
 */
export function anvilEntryPath({ toolName, key, cwd }) {
  const root = cwd ?? process.cwd();
  return resolve(root, '.forge', 'anvil', toolName, `${key}.json`);
}

/**
 * Resolve the absolute path to an Anvil tool-cache directory.
 *
 * @param {{ toolName: string, cwd?: string }} opts
 * @returns {string} Absolute path to `<cwd>/.forge/anvil/<toolName>/`
 *
 * @example
 * const dir = anvilCacheDir({ toolName: 'forge_search' });
 * // → '/home/user/project/.forge/anvil/forge_search'
 */
export function anvilCacheDir({ toolName, cwd }) {
  const root = cwd ?? process.cwd();
  return resolve(root, '.forge', 'anvil', toolName);
}

/**
 * Resolve the absolute path to the Anvil stats file.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {string} Absolute path to `<cwd>/.forge/anvil/stats.json`
 */
export function anvilStatsPath({ cwd } = {}) {
  const root = cwd ?? process.cwd();
  return resolve(root, '.forge', 'anvil', 'stats.json');
}
