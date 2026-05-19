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
function _groupEventsByCorrelation(allEvents, limit) {
  const threadMap = new Map();
  for (const evt of allEvents) {
    const cid = evt.correlationId || "__ungrouped__";
    if (!threadMap.has(cid)) threadMap.set(cid, []);
    threadMap.get(cid).push(evt);
  }
  let threads = [];
  for (const [cid, events] of threadMap) {
    threads.push({
      correlationId: cid,
      events,
      firstTs: events[0].ts,
      lastTs: events[events.length - 1].ts,
      sources: [...new Set(events.map((e) => e.source))],
    });
  }
  threads.sort((a, b) => (new Date(b.lastTs).getTime() || 0) - (new Date(a.lastTs).getTime() || 0));
  const truncated = threads.length > limit;
  return { threads: threads.slice(0, limit), truncated };
}

function _buildTimelineEmptyMessage(windowFrom, windowTo, correlationId, eventFilters, params) {
  const fromHuman = windowFrom || "unset";
  const toHuman = windowTo || "now";
  const filterParts = [];
  if (correlationId) filterParts.push(`correlationId=${correlationId}`);
  if (eventFilters && eventFilters.length > 0) filterParts.push(`events=[${eventFilters.join(", ")}]`);
  if (params.sources) filterParts.push(`sources=[${(params.sources || []).join(", ")}]`);
  const filterDesc = filterParts.length > 0 ? ` with filters ${filterParts.join(", ")}` : "";
  return `No events in window ${fromHuman} → ${toHuman}${filterDesc}. Try widening the from/to range (default is last 24h), removing event filters, or checking that the project has activity in .forge/.`;
}

function resolveTimelineWindow(params) {
  const now = new Date();
  return {
    fromDate: params.from ? parseSince(params.from) : new Date(now.getTime() - 86_400_000),
    toDate: params.to ? parseSince(params.to) : now,
  };
}

function resolveTimelineSources(params) {
  const allSourceNames = Object.keys(TIMELINE_SOURCES);
  return params.sources
    ? params.sources.filter((source) => allSourceNames.includes(source))
    : allSourceNames;
}

function resolveTimelineQuery(params) {
  const { fromDate, toDate } = resolveTimelineWindow(params);
  return {
    fromDate,
    toDate,
    limit: Math.min(Math.max(params.limit != null ? params.limit : DEFAULT_LIMIT, 0), MAX_LIMIT),
    groupBy: params.groupBy || "time",
    correlationId: params.correlationId || null,
    eventFilters: params.events || [],
    sourcesQueried: resolveTimelineSources(params),
  };
}

async function readTimelineSourceResults(cwd, sourcesQueried, filters) {
  return Promise.all(sourcesQueried.map((name) => {
    const source = TIMELINE_SOURCES[name];
    if (!source) return Promise.resolve([]);
    return source.read(cwd, filters).catch(() => []);
  }));
}

function flattenTimelineEvents(sourceResults) {
  const allEvents = [];
  for (const events of sourceResults) {
    allEvents.push(...events);
  }
  allEvents.sort((a, b) => {
    const ta = new Date(a.ts).getTime() || 0;
    const tb = new Date(b.ts).getTime() || 0;
    return ta - tb;
  });
  return allEvents;
}

function buildTimelinePayload({ groupBy, allEvents, limit, total, windowFrom, windowTo, sourcesQueried }) {
  if (groupBy === "correlation") {
    const { threads, truncated } = _groupEventsByCorrelation(allEvents, limit);
    return { threads, total, truncated, durationMs: 0, windowFrom, windowTo, sourcesQueried };
  }
  return {
    events: allEvents.slice(0, limit),
    total,
    truncated: total > limit,
    durationMs: 0,
    windowFrom,
    windowTo,
    sourcesQueried,
  };
}

function applyTimelineEmptyMessage(result, { windowFrom, windowTo, correlationId, eventFilters, params }) {
  if (result.total !== 0) return result;
  return {
    ...result,
    message: _buildTimelineEmptyMessage(windowFrom, windowTo, correlationId, eventFilters, params),
  };
}

export async function timeline(params = {}, opts = {}) {
  const start = performance.now();
  const cwd = opts.cwd || process.cwd();
  const forgeDir = resolve(cwd, ".forge");
  const query = resolveTimelineQuery(params);
  const cacheEntryKey = cacheKey({
    ...params,
    from: query.fromDate?.toISOString(),
    to: query.toDate?.toISOString(),
  });
  const cached = cacheGet(cacheEntryKey, forgeDir);
  if (cached) {
    return { ...cached, durationMs: Math.round(performance.now() - start) };
  }

  const filters = {
    from: query.fromDate,
    to: query.toDate,
    events: query.eventFilters,
    correlationId: query.correlationId,
  };
  const sourceResults = await readTimelineSourceResults(cwd, query.sourcesQueried, filters);
  const allEvents = flattenTimelineEvents(sourceResults);
  const windowFrom = query.fromDate ? query.fromDate.toISOString() : "";
  const windowTo = query.toDate ? query.toDate.toISOString() : "";
  const result = applyTimelineEmptyMessage(
    buildTimelinePayload({
      groupBy: query.groupBy,
      allEvents,
      limit: query.limit,
      total: allEvents.length,
      windowFrom,
      windowTo,
      sourcesQueried: query.sourcesQueried,
    }),
    {
      windowFrom,
      windowTo,
      correlationId: query.correlationId,
      eventFilters: query.eventFilters,
      params,
    },
  );

  result.durationMs = Math.round(performance.now() - start);
  cacheSet(cacheEntryKey, forgeDir, result);
  return result;
}

export { matchEventGlob };
