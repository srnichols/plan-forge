/**
 * forge-tools/regression-guard.mjs — Lattice blast-radius augmentation for forge_regression_guard.
 *
 * Computes blastRadius for a set of changed files using the Lattice call graph.
 * When the index is absent, returns null so the caller omits the field entirely
 * (additive-only contract — Scope Contract §MUST-2).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { latticeBlast } from '../lattice.mjs';

const LATTICE_SUBDIR = join('.forge', 'lattice');

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/** Heuristic: is this file a test file? */
function isTestFile(filePath) {
  return /\.(test|spec)\.[^.]+$/.test(filePath) ||
    /(^|[/\\])(tests?|__tests?__)[/\\]/.test(filePath);
}

/**
 * Compute the blast radius for a set of changed files using the Lattice call graph.
 *
 * Starting from the chunks belonging to each changed file, a BFS traversal in
 * the `callers` direction is run: files that call into a changed file could be
 * broken by that change and therefore appear in its blast radius.
 *
 * @param {string[]} changedFiles  Relative (or absolute) file paths that changed.
 * @param {{ depth?: number, limit?: number, deps?: { cwd?: string } }} [opts]
 * @returns {{
 *   files:     string[],   Non-test files in blast radius (changed files excluded).
 *   tests:     string[],   Test files in blast radius (changed files excluded).
 *   depth:     number,     BFS depth used.
 *   truncated: boolean,    True if any traversal hit the limit.
 * } | null}  null when no Lattice index is present.
 */
export function computeBlastRadius(changedFiles = [], { depth = 3, limit = 50, deps = {} } = {}) {
  const root = deps.cwd ?? process.cwd();
  const chunksPath = resolve(root, LATTICE_SUBDIR, 'chunks.jsonl');

  // Additive-only: if index absent, return null so callers omit the field.
  if (!existsSync(chunksPath)) return null;

  if (changedFiles.length === 0) {
    return { files: [], tests: [], depth, truncated: false };
  }

  // Resolve chunk IDs for the changed files.
  const allChunks = readJsonl(chunksPath);
  const changedFileSet = new Set(changedFiles);
  const seedChunkIds = allChunks
    .filter((c) => changedFileSet.has(c.filePath))
    .map((c) => c.id);

  if (seedChunkIds.length === 0) {
    return { files: [], tests: [], depth, truncated: false };
  }

  // BFS from each seed chunk in the caller direction.
  const affectedFileSet = new Set();
  let truncated = false;

  for (const chunkId of seedChunkIds) {
    const result = latticeBlast({ chunkId, direction: 'callers', depth, limit, deps });
    for (const node of result.nodes) {
      affectedFileSet.add(node.filePath);
    }
    if (result.truncated) truncated = true;
  }

  // The changed files themselves are the source of the blast, not victims.
  for (const f of changedFiles) affectedFileSet.delete(f);

  const allAffected = [...affectedFileSet];
  const tests = allAffected.filter(isTestFile);
  const files = allAffected.filter((f) => !isTestFile(f));

  return { files, tests, depth, truncated };
}
