/**
 * forge-tools/hotspot.mjs — Lattice augmentation for forge_hotspot.
 *
 * Adds { callerCount, calleeCount, inBlastOf } to each hotspot entry when a
 * Lattice index exists.  When the index is absent, input is returned unchanged
 * (additive-only contract — Scope Contract §MUST-1).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const LATTICE_SUBDIR = join('.forge', 'lattice');

function latticeDir(deps = {}) {
  return resolve(deps.cwd ?? process.cwd(), LATTICE_SUBDIR);
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

/**
 * Augment an array of hotspot entries with Lattice call-graph metrics.
 *
 * Each augmented entry gains:
 *   - `callerCount`  {number}   Distinct external files that call into this file.
 *   - `calleeCount`  {number}   Distinct external files this file calls into.
 *   - `inBlastOf`    {string[]} Files whose change would put this file in their blast radius
 *                               (i.e., files that this file calls into).
 *
 * @param {Array<{ file: string, commits: number }>} hotspots
 * @param {{ deps?: { cwd?: string } }} [opts]
 * @returns {Array<object>}  Original entries + optional Lattice fields.
 */
export function augmentHotspots(hotspots, { deps = {} } = {}) {
  if (!Array.isArray(hotspots) || hotspots.length === 0) return hotspots ?? [];

  const dir = latticeDir(deps);
  const chunksPath = join(dir, 'chunks.jsonl');

  // Additive-only: if index absent, return hotspots unchanged.
  if (!existsSync(chunksPath)) return hotspots;

  const allChunks = readJsonl(chunksPath);
  const allEdges = readJsonl(join(dir, 'edges.jsonl'));

  // chunk id → filePath
  const chunkIdToFile = new Map(allChunks.map((c) => [c.id, c.filePath]));

  // callee name → Set of filePaths that declare a chunk with that name
  const nameToFiles = new Map();
  for (const c of allChunks) {
    if (c.name) {
      if (!nameToFiles.has(c.name)) nameToFiles.set(c.name, new Set());
      nameToFiles.get(c.name).add(c.filePath);
    }
  }

  // Per-file call-graph sets (cross-file edges only)
  // callerFiles[file]  = Set of files that call INTO this file
  // calleeFiles[file]  = Set of files that this file calls INTO
  const callerFiles = new Map(); // file → Set<file>
  const calleeFiles = new Map(); // file → Set<file>

  for (const edge of allEdges) {
    const callerFile = chunkIdToFile.get(edge.callerChunkId);
    const targetFiles = nameToFiles.get(edge.calleeName) ?? new Set();

    for (const targetFile of targetFiles) {
      if (!callerFile || callerFile === targetFile) continue;

      // outgoing: callerFile → targetFile
      if (!calleeFiles.has(callerFile)) calleeFiles.set(callerFile, new Set());
      calleeFiles.get(callerFile).add(targetFile);

      // incoming: targetFile ← callerFile
      if (!callerFiles.has(targetFile)) callerFiles.set(targetFile, new Set());
      callerFiles.get(targetFile).add(callerFile);
    }
  }

  return hotspots.map((hs) => {
    const callers = callerFiles.get(hs.file) ?? new Set();
    const callees = calleeFiles.get(hs.file) ?? new Set();
    return {
      ...hs,
      callerCount: callers.size,
      calleeCount: callees.size,
      // Files whose change would cascade to affect this file (this file calls into them).
      inBlastOf: [...callees],
    };
  });
}
