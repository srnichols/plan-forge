/**
 * Plan Forge — Timeline Core
 *
 * Unified chronological view across all forge event sources.
 * Time-window filter, source merger, correlationId grouper, LRU cache.
 *
 * Performance budget: p95 < 400 ms over 10k events.
 *
 * @module timeline/core
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { parseSince } from "../search/core.mjs";
import { TIMELINE_SOURCES, matchEventGlob } from "./sources.mjs";

// ─── LRU Cache ────────────────────────────────────────────────────────

const MAX_CACHE = 100;
const CACHE_TTL_MS = 60_000;
const cache = new Map();

function cacheKey(params) {
  return JSON.stringify({
    from: params.from || "",
    to: params.to || "",
    correlationId: params.correlationId || "",
    sources: params.sources || [],
    events: params.events || [],
    groupBy: params.groupBy || "time",
    limit: params.limit || 500,
  });
}

function forgeDirMtime(forgeDir) {
  // Use the max mtime across .forge root and .forge/fm-sessions so that new
  // Forge-Master turns (written to fm-sessions/) invalidate the cache promptly.
  let m = 0;
  try { m = Math.max(m, statSync(forgeDir).mtimeMs); } catch { /* missing */ }
  try { m = Math.max(m, statSync(resolve(forgeDir, "fm-sessions")).mtimeMs); } catch { /* missing */ }
  return m;
}

function cacheGet(key, forgeDir) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.insertedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Invalidate if .forge directory or fm-sessions mtime changed
  const current = forgeDirMtime(forgeDir);
  if (current === 0 || current !== entry.mtimeMs) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, forgeDir, data) {
  if (cache.size >= MAX_CACHE) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, val] of cache) {
      if (val.insertedAt < oldestTime) {
        oldestTime = val.insertedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { data, insertedAt: Date.now(), mtimeMs: forgeDirMtime(forgeDir) });
}

/** Exposed for testing — clears the internal LRU cache. */
export function clearTimelineCache() {
  cache.clear();
}

// ─── Main timeline function ───────────────────────────────────────────

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * Unified chronological view across forge event sources.
 *
 * @param {{ from?: string, to?: string, correlationId?: string, sources?: string[], events?: string[], groupBy?: string, limit?: number }} params
 * @param {{ cwd: string }} opts
 * @returns {Promise<{ events?: Array, threads?: Array, total: number, truncated: boolean, durationMs: number, windowFrom: string, windowTo: string, sourcesQueried: string[] }>}
 */
export async function timeline(params = {}, opts = {}) {
  const start = performance.now();
  const cwd = opts.cwd || process.cwd();
  const forgeDir = resolve(cwd, ".forge");

  // Parse time window
  const now = new Date();
  const fromDate = params.from ? parseSince(params.from) : new Date(now.getTime() - 86_400_000);
  const toDate = params.to ? parseSince(params.to) : now;
  const limit = Math.min(Math.max(params.limit != null ? params.limit : DEFAULT_LIMIT, 0), MAX_LIMIT);
  const groupBy = params.groupBy || "time";
  const correlationId = params.correlationId || null;
  const eventFilters = params.events || [];

  // Determine active sources
  const allSourceNames = Object.keys(TIMELINE_SOURCES);
  const sourcesQueried = params.sources
    ? params.sources.filter((s) => allSourceNames.includes(s))
    : allSourceNames;

  // Check cache
  const ck = cacheKey({ ...params, from: fromDate?.toISOString(), to: toDate?.toISOString() });
  const cached = cacheGet(ck, forgeDir);
  if (cached) {
    return { ...cached, durationMs: Math.round(performance.now() - start) };
  }

  // Read sources in parallel
  const filters = { from: fromDate, to: toDate, events: eventFilters, correlationId };
  const sourcePromises = sourcesQueried.map((name) => {
    const src = TIMELINE_SOURCES[name];
    if (!src) return Promise.resolve([]);
    return src.read(cwd, filters).catch(() => []);
  });
  const sourceResults = await Promise.all(sourcePromises);

  // Concat + sort by ts ascending (stable)
  const allEvents = [];
  for (const events of sourceResults) {
    allEvents.push(...events);
  }
  allEvents.sort((a, b) => {
    const ta = new Date(a.ts).getTime() || 0;
    const tb = new Date(b.ts).getTime() || 0;
    return ta - tb;
  });

  const total = allEvents.length;
  const windowFrom = fromDate ? fromDate.toISOString() : "";
  const windowTo = toDate ? toDate.toISOString() : "";

  let result;

  if (groupBy === "correlation") {
    // Group by correlationId
    const threadMap = new Map();
    for (const evt of allEvents) {
      const cid = evt.correlationId || "__ungrouped__";
      if (!threadMap.has(cid)) {
        threadMap.set(cid, []);
      }
      threadMap.get(cid).push(evt);
    }

    let threads = [];
    for (const [cid, events] of threadMap) {
      const firstTs = events[0].ts;
      const lastTs = events[events.length - 1].ts;
      const sources = [...new Set(events.map((e) => e.source))];
      threads.push({ correlationId: cid, events, firstTs, lastTs, sources });
    }

    // Sort threads by most-recent-event descending
    threads.sort((a, b) => {
      const ta = new Date(a.lastTs).getTime() || 0;
      const tb = new Date(b.lastTs).getTime() || 0;
      return tb - ta;
    });

    const truncated = threads.length > limit;
    threads = threads.slice(0, limit);

    result = { threads, total, truncated, durationMs: 0, windowFrom, windowTo, sourcesQueried };
  } else {
    // Flat mode
    const truncated = total > limit;
    const events = allEvents.slice(0, limit);
    result = { events, total, truncated, durationMs: 0, windowFrom, windowTo, sourcesQueried };
  }

  result.durationMs = Math.round(performance.now() - start);
  cacheSet(ck, forgeDir, result);

  return result;
}

export { matchEventGlob };
