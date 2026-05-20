/**
 * Plan Forge — Local Semantic Recall (Phase 55 + 56)
 *
 * Phase 55: TF-IDF + IDF-weighted cosine-similarity search over local .forge/
 * thought stores. Zero-dependency semantic-search fallback when OpenBrain
 * (L3 Postgres + pgvector) is not configured.
 *
 * Phase 56: Persistent TF-IDF index cache. The corpus index (token maps + IDF
 * weights) is serialised to `.forge/local-recall-index.json` after the first
 * search and reloaded on subsequent calls. Staleness is detected by comparing
 * the mtime of each source JSONL file against the index's `builtAt` timestamp;
 * any newer source file triggers a full rebuild.
 *
 * Optional upgrade: if @xenova/transformers is installed, neural embeddings
 * (all-MiniLM-L6-v2, 384-dim) replace TF-IDF for substantially better recall.
 * The upgrade is fully transparent — same inputs, same output shape.
 *
 * Output shape (ACI-compliant):
 *   { hits, total, backend, query, truncated, message }
 *
 * @module local-recall
 */

import { existsSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tokenize } from "./memory.mjs";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Local .forge/ JSONL files that hold thoughts/memories. */
const THOUGHT_SOURCES = Object.freeze([
  "openbrain-queue.jsonl",
  "openbrain-queue.archive.jsonl",
  "openbrain-dlq.jsonl",
  "liveguard-memories.jsonl",
]);

const MAX_CORPUS = 500;      // max thoughts indexed
const DEFAULT_LIMIT = 5;     // default hits returned
const DEFAULT_THRESHOLD = 0.02; // min similarity score
const SNIPPET_CHARS = 120;   // chars per hit snippet

/** Filename for the persisted TF-IDF index (Phase 56). */
const INDEX_CACHE_FILE = "local-recall-index.json";
/** Current schema version — bump when the index format changes. */
const INDEX_VERSION = 1;

// ─── Thought loading ─────────────────────────────────────────────────────────

/**
 * Read a single JSONL file and return parsed records. Non-fatal on error.
 * @param {string} filePath
 * @returns {Array<object>}
 */
function readJsonl(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const records = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { records.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Load thoughts from local .forge/ JSONL stores.
 * Returns at most MAX_CORPUS records (newest-first within each file).
 *
 * @param {string} [cwd=process.cwd()]
 * @param {{ sources?: string[], max?: number }} [opts]
 * @returns {Array<object>}
 */
export function readLocalThoughts(cwd = process.cwd(), opts = {}) {
  const forgeDir = resolve(cwd, ".forge");
  if (!existsSync(forgeDir)) return [];

  const sources = Array.isArray(opts.sources) ? opts.sources : THOUGHT_SOURCES;
  const max = typeof opts.max === "number" ? opts.max : MAX_CORPUS;
  const all = [];

  for (const src of sources) {
    if (all.length >= max) break;
    const records = readJsonl(join(forgeDir, src));
    const remaining = max - all.length;
    // Take from the end (newest records)
    all.push(...records.slice(-remaining));
  }

  return all;
}

// ─── TF-IDF engine ───────────────────────────────────────────────────────────

/**
 * Compute IDF weights from a corpus of token maps.
 * IDF(t) = log((N + 1) / (df(t) + 1)) + 1  (smooth)
 *
 * @param {Array<Map<string,number>>} tokenMaps
 * @returns {Map<string, number>} token → idf weight
 */
export function buildIdf(tokenMaps) {
  const N = tokenMaps.length;
  const df = new Map(); // document frequency
  for (const tMap of tokenMaps) {
    for (const token of tMap.keys()) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }
  const idf = new Map();
  for (const [token, freq] of df) {
    idf.set(token, Math.log((N + 1) / (freq + 1)) + 1);
  }
  return idf;
}

/**
 * Compute a TF-IDF weighted vector (as Map<token, weight>) for `text`.
 *
 * @param {string} text
 * @param {Map<string, number>} idf
 * @returns {Map<string, number>}
 */
export function tfIdfVector(text, idf) {
  const tf = tokenize(text);
  const vec = new Map();
  const len = tf.size || 1;
  for (const [token, count] of tf) {
    const w = (count / len) * (idf.get(token) ?? 1);
    vec.set(token, w);
  }
  return vec;
}

/**
 * Cosine similarity between two Map<string, number> vectors.
 *
 * @param {Map<string, number>} a
 * @param {Map<string, number>} b
 * @returns {number} [0, 1]
 */
export function vecCosineSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const v of a.values()) magA += v * v;
  for (const v of b.values()) magB += v * v;
  // Iterate the smaller map
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [token, v] of smaller) {
    const w = larger.get(token);
    if (w) dot += v * w;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Persistent index cache (Phase 56) ───────────────────────────────────────

/**
 * Build a corpus index from an array of thought records.
 *
 * @param {Array<object>} thoughts
 * @returns {{ tokenMaps: Array<Array<[string,number]>>, idf: Array<[string,number]> }}
 *   Serialisable index — Maps converted to arrays for JSON round-trip.
 */
export function buildCorpusIndex(thoughts) {
  const contents = thoughts.map((t) => t.content || t.message || t.text || "");
  const tokenMaps = contents.map(tokenize);
  const idf = buildIdf(tokenMaps);
  return {
    tokenMaps: tokenMaps.map((m) => [...m]),
    idf: [...idf],
  };
}

/**
 * Return the mtime (ms since epoch) for each THOUGHT_SOURCE JSONL file that
 * exists inside `forgeDir`, or 0 when absent.
 *
 * @param {string} forgeDir  Absolute path to `.forge/`
 * @param {string[]} sources  Filenames to stat
 * @returns {Record<string, number>} fileName → mtime
 */
function _sourceMtimes(forgeDir, sources) {
  const mtimes = {};
  for (const src of sources) {
    const p = join(forgeDir, src);
    try {
      mtimes[src] = statSync(p).mtimeMs;
    } catch {
      mtimes[src] = 0;
    }
  }
  return mtimes;
}

/**
 * Persist the corpus index to `.forge/local-recall-index.json`.
 * Non-fatal on I/O error.
 *
 * @param {string} cwd
 * @param {object} index  Output of `buildCorpusIndex`.
 * @param {{ sources?: string[], corpusSize?: number }} [meta]
 */
export function persistIndex(cwd, index, meta = {}) {
  const forgeDir = resolve(cwd, ".forge");
  if (!existsSync(forgeDir)) return;
  const sources = Array.isArray(meta.sources) ? meta.sources : [...THOUGHT_SOURCES];
  const record = {
    version: INDEX_VERSION,
    builtAt: Date.now(),
    corpusSize: meta.corpusSize ?? (index.tokenMaps?.length ?? 0),
    sourceMtimes: _sourceMtimes(forgeDir, sources),
    index,
  };
  try {
    writeFileSync(join(forgeDir, INDEX_CACHE_FILE), JSON.stringify(record), "utf-8");
  } catch { /* non-fatal */ }
}

/**
 * Load the cached corpus index if it exists and is not stale.
 *
 * Staleness: any source JSONL file with an mtime newer than `builtAt` causes
 * a cache miss. A missing source counts as mtime 0 (never newer).
 *
 * @param {string} cwd
 * @param {{ sources?: string[] }} [opts]
 * @returns {{ tokenMaps: Map<string,number>[], idf: Map<string,number> } | null}
 *   Hydrated Maps, or null on cache miss / stale / version mismatch.
 */
export function loadCachedIndex(cwd, opts = {}) {
  const forgeDir = resolve(cwd, ".forge");
  const cachePath = join(forgeDir, INDEX_CACHE_FILE);
  if (!existsSync(cachePath)) return null;

  let record;
  try {
    record = JSON.parse(readFileSync(cachePath, "utf-8"));
  } catch { return null; }

  if (record.version !== INDEX_VERSION) return null;
  if (!record.builtAt || !record.index) return null;

  const sources = Array.isArray(opts.sources) ? opts.sources : [...THOUGHT_SOURCES];
  const currentMtimes = _sourceMtimes(forgeDir, sources);
  for (const src of sources) {
    const stored = record.sourceMtimes?.[src] ?? 0;
    const current = currentMtimes[src] ?? 0;
    if (current !== stored) return null; // added, modified, or removed
  }

  try {
    const tokenMaps = record.index.tokenMaps.map((arr) => new Map(arr));
    const idf = new Map(record.index.idf);
    return { tokenMaps, idf };
  } catch { return null; }
}

/**
 * Delete the persisted index file, if it exists.
 * Non-fatal on I/O error.
 *
 * @param {string} [cwd=process.cwd()]
 */
export function clearPersistedIndex(cwd = process.cwd()) {
  const cachePath = join(resolve(cwd, ".forge"), INDEX_CACHE_FILE);
  try {
    if (existsSync(cachePath)) unlinkSync(cachePath);
  } catch { /* non-fatal */ }
}

/**
 * Return diagnostic information about the persisted index.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {{
 *   exists: boolean,
 *   version: number|null,
 *   builtAt: string|null,
 *   corpusSize: number|null,
 *   stale: boolean|null,
 *   cacheFile: string
 * }}
 */
export function getIndexStatus(cwd = process.cwd()) {
  const forgeDir = resolve(cwd, ".forge");
  const cachePath = join(forgeDir, INDEX_CACHE_FILE);

  if (!existsSync(cachePath)) {
    return { exists: false, version: null, builtAt: null, corpusSize: null, stale: null, cacheFile: cachePath };
  }

  let record;
  try { record = JSON.parse(readFileSync(cachePath, "utf-8")); }
  catch { return { exists: true, version: null, builtAt: null, corpusSize: null, stale: null, cacheFile: cachePath }; }

  const sources = [...THOUGHT_SOURCES];
  const currentMtimes = _sourceMtimes(forgeDir, sources);
  const stale = record.sourceMtimes
    ? sources.some((s) => (currentMtimes[s] ?? 0) !== (record.sourceMtimes[s] ?? 0))
    : null;

  return {
    exists: true,
    version: record.version ?? null,
    builtAt: record.builtAt ? new Date(record.builtAt).toISOString() : null,
    corpusSize: record.corpusSize ?? null,
    stale,
    cacheFile: cachePath,
  };
}

// ─── Neural embedding probe ──────────────────────────────────────────────────

let _neuralProbeCache = null; // null = unchecked, false = unavailable, true = available

/**
 * Check whether @xenova/transformers is importable. Result is cached after
 * the first check to avoid repeated dynamic-import overhead.
 *
 * @returns {Promise<boolean>}
 */
export async function isNeuralEmbeddingAvailable() {
  if (_neuralProbeCache !== null) return _neuralProbeCache;
  try {
    await import("@xenova/transformers");
    _neuralProbeCache = true;
  } catch {
    _neuralProbeCache = false;
  }
  return _neuralProbeCache;
}

/** Reset the neural probe cache (for tests). */
export function _resetNeuralProbeCache() {
  _neuralProbeCache = null;
}

/**
 * Embed a list of texts using @xenova/transformers (all-MiniLM-L6-v2).
 * Returns Float32Array per text, or null on failure.
 *
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]|null>}
 */
async function _neuralEmbed(texts) {
  try {
    const { pipeline } = await import("@xenova/transformers");
    const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { quantized: true });
    const results = [];
    for (const text of texts) {
      const output = await embedder(text, { pooling: "mean", normalize: true });
      results.push(output.data);
    }
    return results;
  } catch {
    return null;
  }
}

/**
 * Cosine similarity between two Float32Arrays.
 */
function float32Cosine(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Search ───────────────────────────────────────────────────────────────────

/**
 * Extract a displayable snippet from a thought record.
 * @param {object} thought
 * @returns {string}
 */
function thoughtSnippet(thought) {
  const raw = thought.content || thought.message || thought.text || "";
  return raw.length > SNIPPET_CHARS ? raw.slice(0, SNIPPET_CHARS) + "…" : raw;
}

/**
 * Search local .forge/ thoughts by semantic similarity.
 *
 * TF-IDF path uses a disk-persisted corpus index (Phase 56). On the first call
 * the index is built and saved to `.forge/local-recall-index.json`; subsequent
 * calls reload the cached index unless any source JSONL has been modified.
 * Neural path always rebuilds embeddings (the WASM model is already fast).
 *
 * @param {string} query
 * @param {{
 *   cwd?: string,
 *   limit?: number,
 *   threshold?: number,
 *   sources?: string[],
 *   forceBackend?: 'tfidf'|'neural',
 *   noCache?: boolean
 * }} [opts]
 * @returns {Promise<{
 *   hits: Array, total: number, backend: string,
 *   query: string, truncated: boolean, message: string
 * }>}
 */
export async function searchLocalThoughts(query, opts = {}) {
  const {
    cwd = process.cwd(),
    limit = DEFAULT_LIMIT,
    threshold = DEFAULT_THRESHOLD,
    sources,
    forceBackend,
    noCache = false,
  } = opts;

  if (!query || typeof query !== "string" || !query.trim()) {
    return _emptyResult(query || "", "Query must be a non-empty string.");
  }

  const thoughts = readLocalThoughts(cwd, { sources });
  if (thoughts.length === 0) {
    return _emptyResult(query, "No local thoughts found in .forge/ — capture some with forge_capture_thought or run a plan to build memory.");
  }

  const useNeural =
    forceBackend === "neural" ||
    (forceBackend !== "tfidf" && (await isNeuralEmbeddingAvailable()));

  let hits;
  if (useNeural) {
    hits = await _neuralSearch(query, thoughts, limit, threshold);
  } else {
    const cachedIdx = noCache ? null : loadCachedIndex(cwd, { sources: sources ?? [...THOUGHT_SOURCES] });
    if (cachedIdx) {
      hits = _tfidfSearchWithIndex(query, thoughts, cachedIdx.tokenMaps, cachedIdx.idf, limit, threshold);
    } else {
      hits = _tfidfSearch(query, thoughts, limit, threshold);
      if (!noCache) {
        const built = buildCorpusIndex(thoughts);
        persistIndex(cwd, built, { sources: sources ?? [...THOUGHT_SOURCES], corpusSize: thoughts.length });
      }
    }
  }

  const backend = useNeural ? "neural" : "tfidf";
  const truncated = thoughts.length >= MAX_CORPUS;

  return {
    hits,
    total: hits.length,
    corpusSize: thoughts.length,
    backend,
    query,
    truncated,
    message: hits.length > 0
      ? `Found ${hits.length} matching thought${hits.length === 1 ? "" : "s"} (${backend} backend, corpus: ${thoughts.length}).`
      : `No thoughts matched query "${query}" above threshold ${threshold} (${backend} backend, corpus: ${thoughts.length}). Try a broader query or lower threshold.`,
  };
}

/**
 * TF-IDF path: rank all thoughts by cosine similarity to query.
 * Builds the corpus index internally (no cache).
 */
function _tfidfSearch(query, thoughts, limit, threshold) {
  const contents = thoughts.map((t) => t.content || t.message || t.text || "");
  const tokenMaps = contents.map(tokenize);
  const idf = buildIdf(tokenMaps);
  return _tfidfSearchWithIndex(query, thoughts, tokenMaps, idf, limit, threshold);
}

/**
 * TF-IDF path with pre-built index (cache hit path).
 *
 * @param {string} query
 * @param {Array<object>} thoughts
 * @param {Map<string,number>[]} tokenMaps  Pre-computed raw token-count maps
 * @param {Map<string,number>} idf          Pre-computed IDF weights
 * @param {number} limit
 * @param {number} threshold
 */
function _tfidfSearchWithIndex(query, thoughts, tokenMaps, idf, limit, threshold) {
  const queryVec = tfIdfVector(query, idf);
  const scored = thoughts.map((thought, i) => {
    const rawTf = tokenMaps[i];        // Map<string, count> from tokenize()
    const len = rawTf.size || 1;
    const docVec = new Map();
    for (const [token, count] of rawTf) {
      docVec.set(token, (count / len) * (idf.get(token) ?? 1));
    }
    const score = vecCosineSimilarity(queryVec, docVec);
    return { thought, score };
  });
  return _topHits(scored, limit, threshold);
}

/**
 * Neural path: embed query + all thought contents, rank by cosine.
 * Falls back to TF-IDF if embedding fails.
 */
async function _neuralSearch(query, thoughts, limit, threshold) {
  const contents = thoughts.map((t) => t.content || t.message || t.text || "");
  const allTexts = [query, ...contents];
  const vectors = await _neuralEmbed(allTexts);

  if (!vectors || vectors.length !== allTexts.length) {
    return _tfidfSearch(query, thoughts, limit, threshold);
  }

  const queryVec = vectors[0];
  const scored = thoughts.map((thought, i) => ({
    thought,
    score: float32Cosine(queryVec, vectors[i + 1]),
  }));

  return _topHits(scored, limit, threshold);
}

/**
 * Filter, sort, and format the top scored hits.
 */
function _topHits(scored, limit, threshold) {
  return scored
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ thought, score }) => ({
      source: thought.source || thought._source || "local",
      project: thought.project || thought._project || null,
      type: thought.type || thought._type || null,
      snippet: thoughtSnippet(thought),
      score: Math.round(score * 10000) / 10000,
      createdAt: thought._enqueuedAt || thought.created_at || thought.timestamp || null,
    }));
}

function _emptyResult(query, message) {
  return { hits: [], total: 0, corpusSize: 0, backend: "none", query, truncated: false, message };
}
