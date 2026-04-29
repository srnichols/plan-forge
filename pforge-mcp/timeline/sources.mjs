/**
 * Plan Forge — Timeline L2 Source Adapters
 *
 * Eight adapters that normalize raw `.forge/` files into timeline events:
 *   { ts, source, event, correlationId, payload }
 *
 * Large JSONL files (hub-events, memories) use streaming readers via
 * readline over createReadStream to avoid loading the full file into memory.
 *
 * Each adapter accepts (cwd, { from, to, events, correlationId }) and
 * returns pre-filtered events.
 *
 * @module timeline/sources
 */

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve, basename } from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function listDir(dirPath) {
  try {
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function fileMtime(filePath) {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * Match an event type against a glob-like pattern.
 * Supports `*` as wildcard (e.g. `slice-*` matches `slice-started`).
 * @param {string} pattern
 * @param {string} value
 * @returns {boolean}
 */
export function matchEventGlob(pattern, value) {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === value;
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(value);
}

/**
 * Check if an event passes the filter criteria.
 * @param {{ ts: string }} evt
 * @param {{ from?: Date, to?: Date, events?: string[], correlationId?: string }} filters
 * @returns {boolean}
 */
function passesFilter(evt, filters) {
  if (filters.from && new Date(evt.ts) < filters.from) return false;
  if (filters.to && new Date(evt.ts) > filters.to) return false;
  if (filters.correlationId && evt.correlationId !== filters.correlationId) return false;
  if (filters.events && filters.events.length > 0) {
    const matched = filters.events.some((pat) => matchEventGlob(pat, evt.event));
    if (!matched) return false;
  }
  return true;
}

// ─── Streaming JSONL reader ───────────────────────────────────────────

async function streamJsonl(filePath, mapFn, filters) {
  if (!existsSync(filePath)) return [];
  const results = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const evt = mapFn(record);
      if (evt && passesFilter(evt, filters)) results.push(evt);
    } catch { /* skip malformed */ }
  }
  return results;
}

// ─── Synchronous JSONL reader (small files) ───────────────────────────

function readJsonlSync(filePath, mapFn, filters) {
  if (!existsSync(filePath)) return [];
  const results = [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const evt = mapFn(record);
        if (evt && passesFilter(evt, filters)) results.push(evt);
      } catch { /* skip malformed */ }
    }
  } catch { /* file read error */ }
  return results;
}

// ─── Source: hub-event ────────────────────────────────────────────────

async function readHubEvents(cwd, filters) {
  const filePath = resolve(cwd, ".forge", "hub-events.jsonl");
  return streamJsonl(filePath, (rec) => ({
    ts: rec.timestamp || "",
    source: "hub-event",
    event: rec.type || "unknown",
    correlationId: rec._correlationId || rec.correlationId || rec.data?.correlationId || "",
    payload: rec.data || rec,
  }), filters);
}

// ─── Source: run ──────────────────────────────────────────────────────

async function readRunEvents(cwd, filters) {
  const runsDir = resolve(cwd, ".forge", "runs");
  const results = [];
  for (const runName of listDir(runsDir)) {
    const eventsLog = resolve(runsDir, runName, "events.log");
    if (!existsSync(eventsLog)) continue;
    const events = readJsonlSync(eventsLog, (rec) => ({
      ts: rec.timestamp || "",
      source: "run",
      event: rec.type || "unknown",
      correlationId: rec._correlationId || runName,
      payload: { sliceTitle: rec.sliceTitle, plan: rec.plan, message: rec.message, ...rec },
    }), filters);
    results.push(...events);
  }
  return results;
}

// ─── Source: memory ──────────────────────────────────────────────────

async function readMemories(cwd, filters) {
  const filePath = resolve(cwd, ".forge", "liveguard-memories.jsonl");
  return streamJsonl(filePath, (rec) => ({
    ts: rec.timestamp || "",
    source: "memory",
    event: "memory-captured",
    correlationId: rec._correlationId || rec.correlationId || "",
    payload: { tags: rec.tags, summary: rec.summary, content: rec.content },
  }), filters);
}

// ─── Source: openbrain ───────────────────────────────────────────────

async function readOpenBrain(cwd, filters) {
  const filePath = resolve(cwd, ".forge", "openbrain-queue.jsonl");
  return readJsonlSync(filePath, (rec) => ({
    ts: rec.timestamp || "",
    source: "openbrain",
    event: rec.status || rec.type || "queued",
    correlationId: rec._correlationId || rec.correlationId || "",
    payload: rec,
  }), filters);
}

// ─── Source: watch ───────────────────────────────────────────────────

async function readWatchHistory(cwd, filters) {
  const filePath = resolve(cwd, ".forge", "watch-history.jsonl");
  return readJsonlSync(filePath, (rec) => ({
    ts: rec.timestamp || "",
    source: "watch",
    event: rec.anomalyName || rec.type || "watch-event",
    correlationId: rec._correlationId || rec.correlationId || "",
    payload: rec,
  }), filters);
}

// ─── Source: tempering ──────────────────────────────────────────────

async function readTempering(cwd, filters) {
  const dir = resolve(cwd, ".forge", "tempering");
  const results = [];
  for (const file of listDir(dir).filter((f) => f.endsWith(".json"))) {
    const data = safeReadJson(resolve(dir, file));
    if (!data) continue;
    const runId = basename(file, ".json");
    const corrId = data.correlationId || data._correlationId || runId;

    // Unroll runSteps if present
    if (Array.isArray(data.runSteps)) {
      for (const step of data.runSteps) {
        const evt = {
          ts: step.timestamp || step.startedAt || data.timestamp || fileMtime(resolve(dir, file)),
          source: "tempering",
          event: step.status === "passed" ? "step-passed" : step.status === "failed" ? "step-failed" : "step-started",
          correlationId: corrId,
          payload: { scanner: step.scanner, summary: step.summary, ...step },
        };
        if (passesFilter(evt, filters)) results.push(evt);
      }
    } else {
      const evt = {
        ts: data.timestamp || fileMtime(resolve(dir, file)),
        source: "tempering",
        event: data.status || "tempering-run",
        correlationId: corrId,
        payload: data,
      };
      if (passesFilter(evt, filters)) results.push(evt);
    }
  }
  return results;
}

// ─── Source: bug ─────────────────────────────────────────────────────

async function readBugs(cwd, filters) {
  const dir = resolve(cwd, ".forge", "bugs");
  const results = [];
  for (const file of listDir(dir).filter((f) => f.endsWith(".json"))) {
    const data = safeReadJson(resolve(dir, file));
    if (!data) continue;
    const bugId = basename(file, ".json");
    const corrId = data.correlationId || data._correlationId || bugId;
    const eventType = data.status === "resolved" ? "bug-resolved" : "bug-registered";
    const evt = {
      ts: data.registeredAt || data.timestamp || data.createdAt || fileMtime(resolve(dir, file)),
      source: "bug",
      event: eventType,
      correlationId: corrId,
      payload: { title: data.title, severity: data.severity, status: data.status, ...data },
    };
    if (passesFilter(evt, filters)) results.push(evt);
  }
  return results;
}

// ─── Source: forge-master ────────────────────────────────────────────

async function readForgeMasterSessions(cwd, filters) {
  const sessDir = resolve(cwd, ".forge", "fm-sessions");
  if (!existsSync(sessDir)) return [];

  const files = listDir(sessDir).filter((f) => f.endsWith(".jsonl"));
  const seen = new Set(); // dedupe across archive + active during rotation
  const results = [];

  for (const file of files) {
    // Derive sessionId: strip .archive.jsonl or .jsonl suffix
    const sessionId = file.replace(/\.archive\.jsonl$/, "").replace(/\.jsonl$/, "");
    const filePath = resolve(sessDir, file);

    const events = await streamJsonl(filePath, (rec) => {
      const dedupeKey = `${sessionId}:${rec.turn}`;
      if (seen.has(dedupeKey)) return null;
      seen.add(dedupeKey);

      const lane = rec.classification?.lane || rec.classification || "";
      const msgPreview = typeof rec.userMessage === "string"
        ? rec.userMessage.slice(0, 200)
        : "";

      return {
        ts: rec.timestamp || "",
        source: "forge-master",
        event: "fm-turn",
        correlationId: sessionId,
        payload: { turn: rec.turn, lane, userMessage: msgPreview },
      };
    }, filters);

    results.push(...events);
  }

  return results;
}

// ─── Source: incident ───────────────────────────────────────────────

async function readIncidents(cwd, filters) {
  const dir = resolve(cwd, ".forge", "incidents");
  const results = [];
  for (const file of listDir(dir).filter((f) => f.endsWith(".json"))) {
    const data = safeReadJson(resolve(dir, file));
    if (!data) continue;
    const id = basename(file, ".json");
    const corrId = data.correlationId || data._correlationId || id;
    const eventType = data.resolvedAt ? "incident-resolved" : "incident-opened";
    const evt = {
      ts: data.openedAt || data.timestamp || data.createdAt || fileMtime(resolve(dir, file)),
      source: "incident",
      event: eventType,
      correlationId: corrId,
      payload: { title: data.title, severity: data.severity, summary: data.summary, ...data },
    };
    if (passesFilter(evt, filters)) results.push(evt);
  }
  return results;
}

// ─── Source Registry ─────────────────────────────────────────────────

export const TIMELINE_SOURCES = {
  "hub-event": { read: readHubEvents },
  "run": { read: readRunEvents },
  "memory": { read: readMemories },
  "openbrain": { read: readOpenBrain },
  "watch": { read: readWatchHistory },
  "tempering": { read: readTempering },
  "bug": { read: readBugs },
  "incident": { read: readIncidents },
  "forge-master": { read: readForgeMasterSessions },
};
