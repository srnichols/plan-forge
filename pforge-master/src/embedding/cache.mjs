/**
 * Embedding cache — cosine-similarity query over previously-classified prompts.
 *
 * Entries are keyed by a monotonic counter. The cache enforces a hard cap
 * (MAX_ENTRIES = 500) via LRU eviction. Persistence uses a binary format
 * for vectors (header + packed Float32) plus a JSON metadata sidecar.
 *
 * Binary format (.bin):
 *   [4 bytes: uint32 entry count]
 *   [4 bytes: uint32 vector dimension]
 *   [count × dim × 4 bytes: packed Float32 vectors, row-major]
 *
 * Sidecar (.bin.meta.json):
 *   Array of { id, text, classification, confidence, lastUsed }
 *   Order matches the vector rows in the binary file.
 *
 * @module embedding/cache
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { embed } from './provider.mjs';

export const MAX_ENTRIES = 500;

/** @type {Map<number, CacheEntry>} */
let _entries = new Map();
let _nextId = 1;

/**
 * @typedef {object} CacheEntry
 * @property {number}       id
 * @property {string}       text
 * @property {Float32Array} vector
 * @property {object}       classification - { lane, via, ... }
 * @property {number}       confidence
 * @property {number}       lastUsed - Date.now() timestamp
 */

// ── Cosine similarity ────────────────────────────────────────────────

/**
 * Cosine similarity: dot(a,b) / (|a| × |b|).
 * Returns 0 for zero-magnitude vectors (no NaN).
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} Similarity in [-1, 1].
 */
export function cosineSimilarity(a, b) {
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

// ── Public API ───────────────────────────────────────────────────────

/**
 * Add an entry to the cache. If the cache is at capacity, evicts the
 * least-recently-used entry first.
 *
 * @param {object} params
 * @param {string} params.text
 * @param {object} params.classification
 * @param {number} params.confidence
 * @param {((text: string) => Promise<Float32Array>)|undefined} [params._embed]
 *   DI seam for tests.
 * @returns {Promise<number>} The id of the new entry.
 */
export async function addEntry({ text, classification, confidence, _embed }) {
  const embedFn = _embed ?? embed;
  const vector = await embedFn(text);
  if (_entries.size >= MAX_ENTRIES) evictLRU();

  const id = _nextId++;
  _entries.set(id, {
    id,
    text,
    vector,
    classification,
    confidence,
    lastUsed: Date.now(),
  });
  return id;
}

/**
 * @typedef {object} QueryResult
 * @property {number} id
 * @property {string} text
 * @property {object} classification
 * @property {number} confidence
 * @property {number} score - cosine similarity
 */

/**
 * Query the cache: embed `text`, compute cosine against every entry,
 * filter by threshold, sort descending, return top-K.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.85]
 * @param {number} [opts.topK=1]
 * @param {((text: string) => Promise<Float32Array>)|undefined} [opts._embed]
 * @returns {Promise<QueryResult[]>}
 */
export async function query(text, { threshold = 0.85, topK = 1, _embed } = {}) {
  if (_entries.size === 0) return [];

  const embedFn = _embed ?? embed;
  const qVec = await embedFn(text);

  const hits = [];
  for (const entry of _entries.values()) {
    const score = cosineSimilarity(qVec, entry.vector);
    if (score >= threshold) {
      entry.lastUsed = Date.now();
      hits.push({
        id: entry.id,
        text: entry.text,
        classification: entry.classification,
        confidence: entry.confidence,
        score,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

/**
 * Evict the least-recently-used entry.
 * @returns {number|null} Id of the evicted entry, or null if cache empty.
 */
export function evictLRU() {
  let oldest = null;
  let oldestTime = Infinity;
  for (const entry of _entries.values()) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldest = entry;
    }
  }
  if (oldest) {
    _entries.delete(oldest.id);
    return oldest.id;
  }
  return null;
}

/**
 * Return current cache size.
 * @returns {number}
 */
export function size() {
  return _entries.size;
}

// ── Persistence ──────────────────────────────────────────────────────

/**
 * Save cache to binary file + JSON sidecar.
 *
 * @param {string} filePath - Path for the .bin file. Sidecar is `${filePath}.meta.json`.
 * @returns {Promise<void>}
 */
export async function save(filePath) {
  const entries = [..._entries.values()];
  const count = entries.length;
  const dim = count > 0 ? entries[0].vector.length : 0;

  // Binary: [uint32 count][uint32 dim][count × dim Float32]
  const headerBytes = 8;
  const vectorBytes = count * dim * 4;
  const buf = Buffer.alloc(headerBytes + vectorBytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(0, count, true);
  view.setUint32(4, dim, true);

  for (let r = 0; r < count; r++) {
    const vec = entries[r].vector;
    const rowOffset = headerBytes + r * dim * 4;
    for (let c = 0; c < dim; c++) {
      view.setFloat32(rowOffset + c * 4, vec[c], true);
    }
  }

  // Metadata sidecar (parallel array, same order)
  const meta = entries.map((e) => ({
    id: e.id,
    text: e.text,
    classification: e.classification,
    confidence: e.confidence,
    lastUsed: e.lastUsed,
  }));

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, buf);
  await writeFile(`${filePath}.meta.json`, JSON.stringify(meta));
}

/**
 * Load cache from binary file + JSON sidecar. Replaces current cache
 * contents entirely.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
export async function load(filePath) {
  const [binBuf, metaRaw] = await Promise.all([
    readFile(filePath),
    readFile(`${filePath}.meta.json`, 'utf8'),
  ]);

  const view = new DataView(binBuf.buffer, binBuf.byteOffset, binBuf.byteLength);
  const count = view.getUint32(0, true);
  const dim = view.getUint32(4, true);
  const meta = JSON.parse(metaRaw);

  if (meta.length !== count) {
    throw new Error(
      `Embedding cache corrupt: binary has ${count} entries but sidecar has ${meta.length}`,
    );
  }

  _entries = new Map();
  _nextId = 1;

  for (let r = 0; r < count; r++) {
    const vec = new Float32Array(dim);
    const rowOffset = 8 + r * dim * 4;
    for (let c = 0; c < dim; c++) {
      vec[c] = view.getFloat32(rowOffset + c * 4, true);
    }
    const m = meta[r];
    const id = m.id;
    _entries.set(id, {
      id,
      text: m.text,
      vector: vec,
      classification: m.classification,
      confidence: m.confidence,
      lastUsed: m.lastUsed,
    });
    if (id >= _nextId) _nextId = id + 1;
  }
}

// ── Test helpers ─────────────────────────────────────────────────────

/** @internal Reset cache for test isolation. */
export function __resetCacheForTests() {
  _entries = new Map();
  _nextId = 1;
}
