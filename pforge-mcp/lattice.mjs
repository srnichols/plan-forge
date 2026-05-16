/**
 * lattice.mjs — Lattice index store: file walking, chunking, JSONL persistence, and stats.
 *
 * Public API (Slice 4):
 *   latticeIndex({ paths, since, deps })  — walk → chunk → persist JSONL
 *   latticeStat({ deps })                 — summary counts + meta
 *
 * Later slices add: latticeQuery, latticeCallers, latticeCallees, latticeBlast.
 *
 * Scope: pforge-mcp/lattice.mjs (Slice 4 of Phase-LATTICE)
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, statSync,
} from 'node:fs';
import { resolve, join, relative, isAbsolute, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { withAnvil } from './anvil.mjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const LATTICE_SUBDIR = join('.forge', 'lattice');
const CHUNKS_FILE = 'chunks.jsonl';
const EDGES_FILE = 'edges.jsonl';
const META_FILE = 'meta.json';

/** File extensions that will be chunked (union of pure-JS + tree-sitter chunkers). */
const CHUNKABLE_EXTS = new Set(['js', 'mjs', 'ts', 'tsx', 'py', 'sql', 'md']);

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sha256hex(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Compute a short deterministic ID for a chunk record (16 hex chars). */
function makeChunkId(chunk) {
  return createHash('sha256')
    .update(`${chunk.filePath}:${chunk.kind}:${chunk.name}:${chunk.startByte}`)
    .digest('hex')
    .slice(0, 16);
}

function workspaceRoot(deps = {}) {
  return deps.cwd ?? process.cwd();
}

function latticeDir(deps = {}) {
  return resolve(workspaceRoot(deps), LATTICE_SUBDIR);
}

/**
 * Validate that all resolved paths fall inside the workspace root.
 * Throws ERR_LATTICE_PATH_OUTSIDE_REPO if any path escapes.
 */
function assertPathsInsideRepo(root, resolvedPaths) {
  for (const p of resolvedPaths) {
    const rel = relative(root, p);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      const err = new Error(
        `Path "${p}" is outside the workspace root "${root}". ` +
          'Lattice only indexes files within the repo.',
      );
      err.code = 'ERR_LATTICE_PATH_OUTSIDE_REPO';
      throw err;
    }
  }
}

function getExec(deps = {}) {
  return deps.exec ?? ((cmd, opts) => execSync(cmd, opts));
}

/**
 * Return absolute paths of all tracked / untracked-non-ignored files via
 * `git ls-files`. Returns [] when not in a git repo or the command fails.
 */
function listRepoFiles(root, deps = {}) {
  const exec = getExec(deps);
  try {
    const out = exec('git ls-files --cached --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (out ?? '')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => resolve(root, f));
  } catch {
    return [];
  }
}

/** Return absolute paths of files changed between `since` and HEAD. */
function listChangedFiles(root, since, deps = {}) {
  const exec = getExec(deps);
  try {
    const out = exec(`git diff --name-only ${since} HEAD`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (out ?? '')
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => resolve(root, f));
  } catch {
    return [];
  }
}

function fileExt(filePath) {
  return extname(filePath).replace(/^\./, '').toLowerCase();
}

function readMeta(deps = {}) {
  const p = join(latticeDir(deps), META_FILE);
  if (!existsSync(p)) return { lastIndexedAt: null, chunkerImpl: null, chunkerVersion: null };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { lastIndexedAt: null, chunkerImpl: null, chunkerVersion: null };
  }
}

function writeMeta(meta, deps = {}) {
  const dir = latticeDir(deps);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 2), 'utf8');
}

// ─── Chunker resolution ───────────────────────────────────────────────────────

/** @type {{ chunkFile: Function, name: string, version: string } | null} */
let _cachedChunker = null;

/**
 * Resolve the best available chunker implementation.
 *
 * Priority:
 *  1. deps.chunker  (test injection)
 *  2. tree-sitter   (when `tree-sitter` package is importable)
 *  3. pure-JS       (always available; last resort)
 *
 * Result is cached after the first resolution to avoid repeated dynamic imports.
 */
async function resolveChunker(deps = {}) {
  if (deps.chunker) {
    return {
      chunkFile: deps.chunker,
      name: deps.chunkerName ?? 'injected',
      version: deps.chunkerVersion ?? '0.0.0',
    };
  }

  if (_cachedChunker) return _cachedChunker;

  // Probe for tree-sitter availability (optional dep)
  let treeSitterAvailable = false;
  try {
    await import('tree-sitter');
    treeSitterAvailable = true;
  } catch { /* not installed — expected in stock CI */ }

  if (treeSitterAvailable) {
    const mod = await import('./lattice-chunker-treesitter.mjs');
    _cachedChunker = { chunkFile: mod.chunkFile, name: 'treesitter', version: mod.version };
  } else {
    const mod = await import('../pforge-sdk/src/chunker-pureJs.mjs');
    _cachedChunker = { chunkFile: mod.chunkFile, name: 'pureJs', version: mod.version };
    // Emit the one-time warning mandated by the forbidden-actions contract
    process.stderr.write(
      '[lattice] tree-sitter packages not installed; using pure-JS chunker. ' +
        'Install with: npm install tree-sitter tree-sitter-javascript ' +
        'tree-sitter-typescript tree-sitter-python\n',
    );
  }

  return _cachedChunker;
}

/**
 * Reset the cached chunker impl. Exported for test isolation only — do not
 * call in production code.
 */
export function _resetChunkerForTesting() {
  _cachedChunker = null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Walk the given `paths`, chunk each file, persist JSONL, and return a summary.
 *
 * Per-file chunking is wrapped in `withAnvil` so repeated `latticeIndex` calls
 * on an unchanged tree yield ≥ 95 % Anvil hit rate with zero re-chunking work.
 *
 * @param {{
 *   paths?:  string[],
 *   since?:  string,
 *   deps?:   { cwd?: string, exec?: Function, chunker?: Function, chunkerName?: string, chunkerVersion?: string }
 * }} opts
 * @returns {Promise<{
 *   filesIndexed: number,
 *   chunks:       number,
 *   edges:        number,
 *   anvilHits:    number,
 *   anvilMisses:  number,
 * }>}
 */
export async function latticeIndex({ paths = ['.'], since, deps = {} } = {}) {
  const root = workspaceRoot(deps);

  // 1. Resolve and validate paths
  const resolvedPaths = paths.map((p) => (isAbsolute(p) ? p : resolve(root, p)));
  assertPathsInsideRepo(root, resolvedPaths);

  // 2. Get the full tracked-file list from git
  const candidateFiles = listRepoFiles(root, deps);

  // 3. Filter to files under the requested paths
  let files = candidateFiles.filter((absFile) =>
    resolvedPaths.some((rp) => {
      const rel = relative(rp, absFile);
      return !rel.startsWith('..') && !isAbsolute(rel);
    }),
  );

  // 4. Optionally restrict to files changed since a revision
  if (since) {
    const changedSet = new Set(listChangedFiles(root, since, deps));
    files = files.filter((f) => changedSet.has(f));
  }

  // 5. Filter to chunkable extensions
  files = files.filter((f) => CHUNKABLE_EXTS.has(fileExt(f)));

  // 6. Resolve the chunker impl
  const chunker = await resolveChunker(deps);

  // 7. Chunk each file with per-file Anvil caching
  const allChunks = [];
  const allEdges = [];
  let anvilHits = 0;
  let anvilMisses = 0;

  for (const absPath of files) {
    let content;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue; // skip unreadable files
    }

    const relPath = relative(root, absPath).replace(/\\/g, '/');
    const contentHash = sha256hex(content);
    const codeHashSeed = `${relPath}:${contentHash}:${chunker.name}:${chunker.version}`;

    const result = await withAnvil(
      async () => {
        const chunks = await chunker.chunkFile({ filePath: relPath, content });
        return { chunks };
      },
      {
        toolName: 'lattice_file_chunk',
        inputs: {
          filePath: relPath,
          contentHash,
          chunkerName: chunker.name,
          chunkerVersion: chunker.version,
        },
        codeHashSeed,
      },
      deps,
    );

    if (result.anvil?.hit) anvilHits++;
    else anvilMisses++;

    for (const chunk of result.chunks ?? []) {
      const cId = makeChunkId(chunk);
      allChunks.push({ ...chunk, id: cId });
      for (const ref of chunk.references ?? []) {
        allEdges.push({ callerChunkId: cId, calleeName: ref });
      }
    }
  }

  // 8. Persist JSONL files
  const dir = latticeDir(deps);
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, CHUNKS_FILE),
    allChunks.map((c) => JSON.stringify(c)).join('\n') +
      (allChunks.length > 0 ? '\n' : ''),
    'utf8',
  );
  writeFileSync(
    join(dir, EDGES_FILE),
    allEdges.map((e) => JSON.stringify(e)).join('\n') +
      (allEdges.length > 0 ? '\n' : ''),
    'utf8',
  );

  // 9. Persist meta for latticeStat
  writeMeta(
    {
      lastIndexedAt: new Date().toISOString(),
      chunkerImpl: chunker.name,
      chunkerVersion: chunker.version,
      filesIndexed: files.length,
    },
    deps,
  );

  return { filesIndexed: files.length, chunks: allChunks.length, edges: allEdges.length, anvilHits, anvilMisses };
}

/**
 * Return a bounded summary of the current Lattice index state.
 *
 * @param {{ deps?: object }} [opts]
 * @returns {{
 *   chunks:        number,
 *   edges:         number,
 *   languages:     Record<string, number>,
 *   lastIndexedAt: string | null,
 *   chunkerImpl:   string | null,
 *   chunkerVersion:string | null,
 *   anvilHitRate:  number,
 *   indexBytes:    number,
 * }}
 */
export function latticeStat({ deps = {} } = {}) {
  const dir = latticeDir(deps);
  const meta = readMeta(deps);

  // Count chunks and tally language distribution
  const chunksPath = join(dir, CHUNKS_FILE);
  let chunks = 0;
  const languages = {};
  if (existsSync(chunksPath)) {
    const lines = readFileSync(chunksPath, 'utf8').split('\n').filter(Boolean);
    chunks = lines.length;
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        const lang = rec.language ?? 'unknown';
        languages[lang] = (languages[lang] ?? 0) + 1;
      } catch { /* skip malformed lines */ }
    }
  }

  // Count edges
  const edgesPath = join(dir, EDGES_FILE);
  let edges = 0;
  if (existsSync(edgesPath)) {
    edges = readFileSync(edgesPath, 'utf8').split('\n').filter(Boolean).length;
  }

  // Total index byte size across all three files
  let indexBytes = 0;
  for (const fname of [CHUNKS_FILE, EDGES_FILE, META_FILE]) {
    const p = join(dir, fname);
    if (existsSync(p)) {
      try { indexBytes += statSync(p).size; } catch { /* best-effort */ }
    }
  }

  // Anvil hit rate for lattice_file_chunk operations
  let anvilHitRate = 0;
  try {
    const statsFile = resolve(workspaceRoot(deps), '.forge', 'anvil', 'stats.json');
    if (existsSync(statsFile)) {
      const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
      const ts = stats.perTool?.lattice_file_chunk;
      if (ts) {
        const total = (ts.hits ?? 0) + (ts.misses ?? 0);
        anvilHitRate = total > 0 ? ts.hits / total : 0;
      }
    }
  } catch { /* best-effort */ }

  return {
    chunks,
    edges,
    languages,
    lastIndexedAt: meta.lastIndexedAt ?? null,
    chunkerImpl: meta.chunkerImpl ?? null,
    chunkerVersion: meta.chunkerVersion ?? null,
    anvilHitRate,
    indexBytes,
  };
}
