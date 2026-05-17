/**
 * lattice.mjs — Lattice index store: file walking, chunking, JSONL persistence, and stats.
 *
 * Public API (Slice 4):
 *   latticeIndex({ paths, since, deps })  — walk → chunk → persist JSONL
 *   latticeStat({ deps })                 — summary counts + meta
 *
 * Public API (Slice 5):
 *   latticeQuery({ query, language, kind, filePath, limit, deps })  — search chunks
 *   latticeCallers({ name, limit, deps })                           — who calls a name?
 *   latticeCallees({ chunkId, name, limit, deps })                  — what does a chunk call?
 *
 * Public API (Slice 6):
 *   latticeBlast({ chunkId, name, direction, depth, limit, deps }) — BFS over call graph
 *
 * Scope: pforge-mcp/lattice.mjs
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

// ─── Internal read helpers (Slice 5) ─────────────────────────────────────────

function readAllChunks(deps = {}) {
  const p = join(latticeDir(deps), CHUNKS_FILE);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function readAllEdges(deps = {}) {
  const p = join(latticeDir(deps), EDGES_FILE);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/**
 * Tokenize text for relevance scoring.
 * Splits on whitespace/punctuation AND camelCase/PascalCase boundaries so that
 * a query for "user" matches chunks named "getUserById" or "UserService".
 *
 * @param {string} text
 * @returns {Map<string, number>} token → count (lowercase)
 */
export function tokenizeForSearch(text) {
  if (!text || typeof text !== 'string') return new Map();
  const split = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  const tokens = split.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const out = new Map();
  for (const t of tokens) out.set(t, (out.get(t) || 0) + 1);
  return out;
}

/**
 * Compute a relevance score for a chunk against a query string.
 *
 * Score = (nameOverlap × 2 + pathOverlap) / 3, where overlap is
 * |query_tokens ∩ field_tokens| / |query_tokens|.
 *
 * Returns a value in [0, 1].  Returns 0 when query is empty.
 *
 * @param {string} queryText
 * @param {{ name?: string, filePath?: string }} chunk
 * @returns {number}
 */
export function scoreChunk(queryText, chunk) {
  if (!queryText || typeof queryText !== 'string') return 0;
  const qTokens = tokenizeForSearch(queryText);
  if (qTokens.size === 0) return 0;

  const nameTokens = tokenizeForSearch(chunk.name ?? '');
  const pathTokens = tokenizeForSearch(chunk.filePath ?? '');

  let nameHits = 0;
  let pathHits = 0;
  for (const q of qTokens.keys()) {
    if (nameTokens.has(q)) nameHits++;
    if (pathTokens.has(q)) pathHits++;
  }

  const qSize = qTokens.size;
  return (nameHits / qSize * 2 + pathHits / qSize) / 3;
}

// ─── latticeQuery ─────────────────────────────────────────────────────────────

/**
 * Search the chunk index for records matching the given criteria.
 *
 * All filters are ANDed. An empty/omitted `query` matches all chunks.
 * When a query is provided, results are ranked by relevance (name-token overlap
 * weighted 2× over filePath-token overlap, both camelCase-aware).  Each
 * returned chunk gains a `score` field (0–1, three decimal places).
 *
 * @param {{
 *   query?:    string,            token + substring match against chunk.name / filePath
 *   language?: string,            exact match against chunk.language
 *   kind?:     string,            exact match against chunk.kind
 *   filePath?: string,            substring match against chunk.filePath
 *   limit?:    number,            max results returned (default 25)
 *   deps?:     object
 * }} [opts]
 * @returns {{
 *   chunks:    object[],
 *   total:     number,
 *   truncated: boolean,
 *   message:   string,
 * }}
 */
export function latticeQuery({
  query = '',
  language,
  kind,
  filePath: filePathFilter,
  limit = 25,
  deps = {},
} = {}) {
  const allChunks = readAllChunks(deps);
  const q = query.toLowerCase();

  const filtered = allChunks.filter((c) => {
    if (q && !c.name?.toLowerCase().includes(q) && !c.filePath?.toLowerCase().includes(q)) return false;
    if (language !== undefined && c.language !== language) return false;
    if (kind !== undefined && c.kind !== kind) return false;
    if (filePathFilter && !c.filePath?.toLowerCase().includes(filePathFilter.toLowerCase())) return false;
    return true;
  });

  let ranked;
  if (q) {
    ranked = filtered
      .map((c) => ({ ...c, score: Math.round(scoreChunk(query, c) * 1000) / 1000 }))
      .sort((a, b) => b.score - a.score);
  } else {
    ranked = filtered;
  }

  const total = ranked.length;
  const truncated = total > limit;
  const results = ranked.slice(0, limit);

  const filters = [
    query ? `query "${query}"` : null,
    language ? `language "${language}"` : null,
    kind ? `kind "${kind}"` : null,
    filePathFilter ? `filePath "${filePathFilter}"` : null,
  ].filter(Boolean).join(', ');

  const message = total === 0
    ? `No chunks matched${filters ? ` ${filters}` : ''}. Broaden your query or run latticeIndex first.`
    : `Found ${total} chunk${total !== 1 ? 's' : ''}${filters ? ` matching ${filters}` : ''}${truncated ? `; returning first ${limit}` : ''}.`;

  return { chunks: results, total, truncated, message };
}

// ─── latticeCallers ───────────────────────────────────────────────────────────

/**
 * Find all chunks that reference (call) the given symbol name.
 *
 * @param {{
 *   name:   string,   the callee symbol name to search for
 *   limit?: number,   max results (default 25)
 *   deps?:  object
 * }} opts
 * @returns {{
 *   chunks:    object[],
 *   total:     number,
 *   truncated: boolean,
 *   message:   string,
 * }}
 */
export function latticeCallers({ name, limit = 25, deps = {} } = {}) {
  if (!name) {
    return { chunks: [], total: 0, truncated: false, message: '"name" is required.' };
  }

  const edges = readAllEdges(deps);
  const callerIds = new Set(
    edges.filter((e) => e.calleeName === name).map((e) => e.callerChunkId),
  );

  const allChunks = readAllChunks(deps);
  const callers = allChunks.filter((c) => callerIds.has(c.id));

  const total = callers.length;
  const truncated = total > limit;
  const results = callers.slice(0, limit);

  const message = total === 0
    ? `No callers found for "${name}". Ensure the index is up to date.`
    : `Found ${total} caller${total !== 1 ? 's' : ''} of "${name}"${truncated ? `; returning first ${limit}` : ''}.`;

  return { chunks: results, total, truncated, message };
}

// ─── latticeBlast ─────────────────────────────────────────────────────────────

/**
 * BFS traversal of the call graph starting from a seed chunk.
 *
 * Traverses outgoing callee edges, incoming caller edges, or both, up to
 * `depth` hops from the seed.  Callee names that do not resolve to a known
 * chunk are captured in `unresolvedNames` but are not enqueued for further
 * traversal (they have no outgoing/incoming edges of their own).
 *
 * @param {{
 *   chunkId?:   string,   exact seed chunk id (takes priority over name)
 *   name?:      string,   seed chunk name (all matching chunks are enqueued)
 *   direction?: 'callees' | 'callers' | 'both'   default: 'both'
 *   depth?:     number,   BFS hop limit (default 3)
 *   limit?:     number,   max nodes returned (default 50)
 *   deps?:      object
 * }} [opts]
 * @returns {{
 *   nodes:           Array<object & { distance: number }>,
 *   edges:           Array<{ from: string, to: string }>,
 *   unresolvedNames: string[],
 *   total:           number,
 *   truncated:       boolean,
 *   message:         string,
 * }}
 */
export function latticeBlast({
  chunkId,
  name,
  direction = 'both',
  depth = 3,
  limit = 50,
  deps = {},
} = {}) {
  if (!chunkId && !name) {
    return {
      nodes: [],
      edges: [],
      unresolvedNames: [],
      total: 0,
      truncated: false,
      message: '"chunkId" or "name" is required.',
    };
  }

  const allChunks = readAllChunks(deps);
  const allEdges = readAllEdges(deps);

  // Build lookup maps for efficient traversal
  const chunkById = new Map(allChunks.map((c) => [c.id, c]));
  const chunksByName = new Map();
  for (const c of allChunks) {
    if (c.name) {
      if (!chunksByName.has(c.name)) chunksByName.set(c.name, []);
      chunksByName.get(c.name).push(c);
    }
  }

  // callee direction: chunkId → Set<calleeName>
  const outEdges = new Map(); // callerChunkId → [calleeName]
  // caller direction: calleeName → [callerChunkId]
  const inEdges = new Map();  // calleeName → [callerChunkId]
  for (const e of allEdges) {
    if (!outEdges.has(e.callerChunkId)) outEdges.set(e.callerChunkId, []);
    outEdges.get(e.callerChunkId).push(e.calleeName);
    if (!inEdges.has(e.calleeName)) inEdges.set(e.calleeName, []);
    inEdges.get(e.calleeName).push(e.callerChunkId);
  }

  // Resolve seed chunk(s)
  let seedIds;
  if (chunkId) {
    seedIds = chunkById.has(chunkId) ? [chunkId] : [];
  } else {
    seedIds = (chunksByName.get(name) ?? []).map((c) => c.id);
  }

  const desc = chunkId ? `chunk "${chunkId}"` : `"${name}"`;

  if (seedIds.length === 0) {
    return {
      nodes: [],
      edges: [],
      unresolvedNames: [],
      total: 0,
      truncated: false,
      message: `No chunk found for ${desc}.`,
    };
  }

  // BFS
  const visited = new Map();    // chunkId → distance
  const traversedEdges = [];    // { from: chunkId, to: chunkId }
  const unresolvedNames = new Set();
  const queue = [];             // { id: string, dist: number }

  for (const id of seedIds) {
    if (!visited.has(id)) {
      visited.set(id, 0);
      queue.push({ id, dist: 0 });
    }
  }

  let head = 0;
  while (head < queue.length) {
    const { id: curId, dist } = queue[head++];
    if (dist >= depth) continue;

    // Expand callees (outgoing)
    if (direction === 'callees' || direction === 'both') {
      for (const calleeName of outEdges.get(curId) ?? []) {
        const calleeChunks = chunksByName.get(calleeName) ?? [];
        if (calleeChunks.length === 0) {
          unresolvedNames.add(calleeName);
        } else {
          for (const cc of calleeChunks) {
            traversedEdges.push({ from: curId, to: cc.id });
            if (!visited.has(cc.id)) {
              visited.set(cc.id, dist + 1);
              queue.push({ id: cc.id, dist: dist + 1 });
            }
          }
        }
      }
    }

    // Expand callers (incoming)
    if (direction === 'callers' || direction === 'both') {
      const curChunk = chunkById.get(curId);
      if (curChunk?.name) {
        for (const callerChunkId of inEdges.get(curChunk.name) ?? []) {
          traversedEdges.push({ from: callerChunkId, to: curId });
          if (!visited.has(callerChunkId)) {
            visited.set(callerChunkId, dist + 1);
            queue.push({ id: callerChunkId, dist: dist + 1 });
          }
        }
      }
    }
  }

  // Build ordered node list (BFS order, distance annotated)
  const allNodes = [];
  for (const [id, distance] of visited) {
    const chunk = chunkById.get(id);
    if (chunk) allNodes.push({ ...chunk, distance });
  }
  // Sort by distance then id for determinism
  allNodes.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));

  const total = allNodes.length;
  const truncated = total > limit;
  const nodes = allNodes.slice(0, limit);

  // Deduplicate traversed edges
  const edgeKey = (e) => `${e.from}→${e.to}`;
  const seenEdges = new Set();
  const uniqueEdges = traversedEdges.filter((e) => {
    const k = edgeKey(e);
    if (seenEdges.has(k)) return false;
    seenEdges.add(k);
    return true;
  });

  const dirLabel = direction === 'callees' ? 'callee' : direction === 'callers' ? 'caller' : 'call-graph';
  const message = total === 0
    ? `No ${dirLabel} neighbors found for ${desc} within depth ${depth}.`
    : `Traversed ${total} node${total !== 1 ? 's' : ''} from ${desc} (direction: ${direction}, depth: ${depth})${truncated ? `; returning first ${limit}` : ''}.`;

  return {
    nodes,
    edges: uniqueEdges,
    unresolvedNames: [...unresolvedNames],
    total,
    truncated,
    message,
  };
}

// ─── latticeCallees ───────────────────────────────────────────────────────────

/**
 * Find all symbols called by a given chunk (identified by chunkId or name).
 *
 * Callee names are resolved to chunk records where possible. Names that do
 * not match any known chunk are returned in `unresolvedNames`.
 *
 * @param {{
 *   chunkId?: string,  exact chunk id (takes priority over name)
 *   name?:    string,  chunk.name to look up the source chunk
 *   limit?:   number,  max resolved chunks returned (default 25)
 *   deps?:    object
 * }} [opts]
 * @returns {{
 *   chunks:          object[],   resolved callee chunks
 *   unresolvedNames: string[],   callee names with no matching chunk
 *   total:           number,     resolved + unresolved count
 *   truncated:       boolean,
 *   message:         string,
 * }}
 */
export function latticeCallees({ chunkId, name, limit = 25, deps = {} } = {}) {
  if (!chunkId && !name) {
    return { chunks: [], unresolvedNames: [], total: 0, truncated: false, message: '"chunkId" or "name" is required.' };
  }

  const allChunks = readAllChunks(deps);
  const edges = readAllEdges(deps);

  // Resolve source chunk id(s)
  let sourceIds;
  if (chunkId) {
    sourceIds = new Set([chunkId]);
  } else {
    sourceIds = new Set(allChunks.filter((c) => c.name === name).map((c) => c.id));
  }

  const desc = chunkId ? `chunk "${chunkId}"` : `"${name}"`;

  if (sourceIds.size === 0) {
    return { chunks: [], unresolvedNames: [], total: 0, truncated: false, message: `No chunk found for ${desc}.` };
  }

  // Unique callee names from outgoing edges
  const calleeNames = [
    ...new Set(edges.filter((e) => sourceIds.has(e.callerChunkId)).map((e) => e.calleeName)),
  ];

  // Build a name → first-chunk map for resolution
  const chunksByName = new Map();
  for (const c of allChunks) {
    if (c.name && !chunksByName.has(c.name)) chunksByName.set(c.name, c);
  }

  const resolvedChunks = [];
  const unresolvedNames = [];
  for (const cn of calleeNames) {
    const resolved = chunksByName.get(cn);
    if (resolved) resolvedChunks.push(resolved);
    else unresolvedNames.push(cn);
  }

  const total = resolvedChunks.length + unresolvedNames.length;
  const truncated = resolvedChunks.length > limit;
  const resultChunks = resolvedChunks.slice(0, limit);

  const message = total === 0
    ? `No callees found for ${desc}.`
    : `Found ${total} callee${total !== 1 ? 's' : ''} for ${desc} (${resolvedChunks.length} resolved, ${unresolvedNames.length} unresolved)${truncated ? `; returning first ${limit} resolved` : ''}.`;

  return { chunks: resultChunks, unresolvedNames, total, truncated, message };
}
