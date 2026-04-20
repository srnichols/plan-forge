/**
 * Plan Forge — Search Core
 *
 * Query parser, L2 scanner, optional L3 OpenBrain merger, deterministic
 * ranker, and 60-second LRU cache with mtime invalidation.
 *
 * Ranking (deterministic):
 *   Base score  = matchedTokens / max(queryTokens, 1)
 *   Recency     = × exp(−ageHours / 168)   (1-week half-life)
 *   Tag bonus   = + 0.5 × matchingTagCount
 *   Source wt   = × SOURCE_WEIGHTS[source]
 *   CorrelationId exact match = +10.0
 *
 * Performance budget: p95 < 250 ms cold over 5 000 hub-events + 500 runs
 * + 100 bugs + 50 incidents, with a 60 s / 200-entry LRU cache.
 *
 * @module search/core
 */

import { statSync } from "node:fs";
import { L2_SOURCES, SOURCE_WEIGHTS } from "./sources.mjs";

// ─── LRU Cache ────────────────────────────────────────────────────────

const MAX_CACHE = 200;
const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheGet(filePath) {
  const entry = cache.get(filePath);
  if (!entry) return null;
  if (Date.now() - entry.insertedAt > CACHE_TTL_MS) {
    cache.delete(filePath);
    return null;
  }
  try {
    const stat = statSync(filePath);
    if (stat.mtimeMs !== entry.mtimeMs) {
      cache.delete(filePath);
      return null;
    }
  } catch {
    cache.delete(filePath);
    return null;
  }
  return entry.data;
}

function cacheSet(filePath, mtimeMs, data) {
  if (cache.size >= MAX_CACHE) {
    // evict oldest entry
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, val] of cache) {
      if (val.insertedAt < oldestTime) {
        oldestTime = val.insertedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(filePath, { mtimeMs, data, insertedAt: Date.now() });
}

/** Exposed for testing — clears the internal LRU cache. */
export function clearCache() {
  cache.clear();
}

// ─── Query parsing ────────────────────────────────────────────────────

/**
 * Tokenize a query string into lowercase search tokens.
 * @param {string} queryString
 * @returns {{ tokens: string[] }}
 */
export function parseQuery(queryString) {
  if (!queryString || typeof queryString !== "string") return { tokens: [] };
  const tokens = queryString
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return { tokens };
}

/**
 * Parse a `since` filter value into a Date.
 * Supports ISO 8601 strings and relative expressions: Nm (minutes),
 * Nh (hours), Nd (days), Nw (weeks).
 *
 * @param {string} sinceStr
 * @returns {Date}
 * @throws {{ code: string, message: string }} ERR_BAD_SINCE
 */
export function parseSince(sinceStr) {
  if (!sinceStr) return null;
  // Try ISO 8601 first
  const iso = new Date(sinceStr);
  if (!isNaN(iso.getTime()) && sinceStr.length > 6) return iso;
  // Relative: 24h, 7d, 30m, 2w
  const match = sinceStr.match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) {
    const err = new Error(`Invalid since value: "${sinceStr}". Use ISO timestamp or relative: 24h, 7d, 2w, 30m`);
    err.code = "ERR_BAD_SINCE";
    throw err;
  }
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return new Date(Date.now() - n * multipliers[unit]);
}

// ─── Scoring ──────────────────────────────────────────────────────────

/**
 * Score a normalized record against query parameters.
 * @param {{ source: string, text: string, tags: string[], correlationId: string, timestamp: string }} record
 * @param {string[]} queryTokens
 * @param {string[]|null} tagFilter
 * @param {string|null} correlationId
 * @returns {number}
 */
export function scoreRecord(record, queryTokens, tagFilter, correlationId) {
  const textLower = (record.text || "").toLowerCase();

  // Base: token overlap
  let matchedCount = 0;
  for (const token of queryTokens) {
    if (textLower.includes(token)) matchedCount++;
  }
  let score = matchedCount / Math.max(queryTokens.length, 1);

  // Recency decay: exp(-ageHours / 168)
  const ts = record.timestamp ? new Date(record.timestamp).getTime() : 0;
  const ageHours = Math.max(0, (Date.now() - ts) / 3_600_000);
  score *= Math.exp(-ageHours / 168);

  // Tag bonus
  if (record.tags && record.tags.length > 0 && tagFilter && tagFilter.length > 0) {
    const recordTagsLower = record.tags.map((t) => String(t).toLowerCase());
    let matchingTags = 0;
    for (const tf of tagFilter) {
      if (recordTagsLower.includes(tf.toLowerCase())) matchingTags++;
    }
    score += 0.5 * matchingTags;
  }

  // Source weight
  const weight = SOURCE_WEIGHTS[record.source] || 1.0;
  score *= weight;

  // CorrelationId exact-match boost
  if (correlationId && record.correlationId === correlationId) {
    score += 10.0;
  }

  return score;
}

// ─── Snippet generation ───────────────────────────────────────────────

function buildSnippet(text, queryTokens) {
  if (!text) return "";
  const lower = text.toLowerCase();
  let pos = -1;
  for (const token of queryTokens) {
    pos = lower.indexOf(token);
    if (pos >= 0) break;
  }
  if (pos < 0) pos = 0;
  const start = Math.max(0, pos - 40);
  const end = Math.min(text.length, pos + 40);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

// ─── Main search ──────────────────────────────────────────────────────

// Failure sentinel for OpenBrain — skip for 5 minutes after an error
let openBrainFailedAt = 0;
const OPENBRAIN_COOLDOWN_MS = 300_000;

/**
 * Search across forge artifacts.
 *
 * @param {{ query: string, tags?: string[], since?: string, correlationId?: string, sources?: string[], limit?: number }} params
 * @param {{ cwd: string, openBrainSearchFn?: Function }} opts
 * @returns {{ hits: Array, total: number, truncated: boolean, durationMs: number }}
 */
export function search(params, opts = {}) {
  const start = performance.now();
  const { query, tags = null, since = null, correlationId = null, sources = null } = params;
  const limit = Math.min(Math.max(params.limit || 50, 1), 200);
  const cwd = opts.cwd || process.cwd();

  const { tokens } = parseQuery(query);
  const sinceDate = parseSince(since);

  // Filter L2 sources by requested types
  const activeSources = sources
    ? L2_SOURCES.filter((s) => sources.includes(s.source))
    : L2_SOURCES;

  // Collect all L2 records
  const allRecords = [];
  for (const src of activeSources) {
    const filePaths = src.resolve(cwd);
    for (const fp of filePaths) {
      let records = cacheGet(fp);
      if (!records) {
        records = src.parse(null, fp);
        try {
          const stat = statSync(fp);
          cacheSet(fp, stat.mtimeMs, records);
        } catch {
          // file may have been deleted between resolve and here — skip
        }
      }
      for (const rec of records) {
        // Apply since filter
        if (sinceDate && rec.timestamp) {
          const recDate = new Date(rec.timestamp);
          if (recDate < sinceDate) continue;
        }
        // Apply tags filter (ALL must match)
        if (tags && tags.length > 0) {
          const recTagsLower = (rec.tags || []).map((t) => String(t).toLowerCase());
          const allMatch = tags.every((t) => recTagsLower.includes(t.toLowerCase()));
          if (!allMatch) continue;
        }
        allRecords.push(rec);
      }
    }
  }

  // Attempt L3 OpenBrain merge
  if (opts.openBrainSearchFn && (Date.now() - openBrainFailedAt > OPENBRAIN_COOLDOWN_MS)) {
    try {
      const l3Hits = opts.openBrainSearchFn({ query, tags, since });
      if (Array.isArray(l3Hits)) {
        const existingCorrelations = new Set(
          allRecords.filter((r) => r.correlationId).map((r) => r.correlationId)
        );
        for (const hit of l3Hits) {
          // Dedupe by correlationId
          if (hit.correlationId && existingCorrelations.has(hit.correlationId)) continue;
          allRecords.push({
            source: hit.source || "openbrain",
            recordRef: hit.recordRef || hit.id || "",
            text: hit.text || hit.content || "",
            timestamp: hit.timestamp || new Date().toISOString(),
            tags: hit.tags || [],
            correlationId: hit.correlationId || "",
          });
          if (hit.correlationId) existingCorrelations.add(hit.correlationId);
        }
      }
    } catch {
      openBrainFailedAt = Date.now();
    }
  }

  // Score all records
  const scored = allRecords.map((rec) => ({
    ...rec,
    score: scoreRecord(rec, tokens, tags, correlationId),
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const total = scored.length;
  const truncated = total > limit;
  const topHits = scored.slice(0, limit);

  // Build output with snippets
  const hits = topHits.map((rec) => ({
    source: rec.source,
    recordRef: rec.recordRef,
    snippet: buildSnippet(rec.text, tokens),
    score: Math.round(rec.score * 1000) / 1000,
    correlationId: rec.correlationId || null,
    timestamp: rec.timestamp,
  }));

  const durationMs = Math.round(performance.now() - start);

  return { hits, total, truncated, durationMs };
}

/** Reset OpenBrain failure sentinel — exposed for testing. */
export function resetOpenBrainSentinel() {
  openBrainFailedAt = 0;
}
