/**
 * Audit export — streaming reader for `.forge/runs/<id>/events.log` files.
 * Yields filtered JSON or CSV records without loading all events into memory.
 *
 * Phase-OTEL-AUDIT-EXPORT Slice 8.
 *
 * Design constraints:
 *   - Streaming: uses readline on each events.log — no bulk readFileSync
 *   - Never throws — graceful on missing/empty .forge/runs/
 *   - Decoupled from OTel — reads the same files telemetry already writes
 *   - Filters: --since, --until, --type (repeatable), --run
 *   - Formats: json (JSONL) and csv (flat with header)
 *
 * @module audit-export
 */

import { existsSync, readdirSync, readFileSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

// ─── Event line parser (mirrors orchestrator.mjs parseEventLine) ─────

const EVENT_LINE_RE = /^\[([^\]]+)\]\s+([a-z-]+):\s*(.*)$/;

/**
 * Parse a single events.log line.
 * @param {string} line
 * @returns {{ ts: string, type: string, data: object } | null}
 */
function parseLine(line) {
  const m = line.match(EVENT_LINE_RE);
  if (!m) return null;
  let data = {};
  try { data = JSON.parse(m[3] || "{}"); } catch { /* keep empty */ }
  return { ts: m[1], type: m[2], data };
}

// ─── CSV helpers ─────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "timestamp",
  "run_id",
  "plan",
  "slice_id",
  "event_type",
  "source",
  "security_risk",
  "gate_result",
  "cost_usd",
  "tokens_in",
  "tokens_out",
  "model",
  "worker",
];

function csvEscape(value) {
  if (value == null) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsvRow(record) {
  return CSV_COLUMNS.map((col) => csvEscape(record[col])).join(",");
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

// ─── Record builder ──────────────────────────────────────────────────

/**
 * Build a flat record from a parsed event line + run metadata.
 */
function buildRecord(parsed, runId, plan) {
  const d = parsed.data;
  return {
    timestamp: parsed.ts,
    run_id: runId,
    plan: firstDefined(plan, d.plan),
    slice_id: firstDefined(d.sliceId, d.slice, d.sliceNumber),
    event_type: parsed.type,
    source: firstDefined(d.source),
    security_risk: firstDefined(d.security_risk),
    gate_result: firstDefined(d.gateResult, d.gate_result),
    cost_usd: firstDefined(d.cost, d.costUsd, d.cost_usd),
    tokens_in: firstDefined(d.tokensIn, d.tokens_in, d.inputTokens),
    tokens_out: firstDefined(d.tokensOut, d.tokens_out, d.outputTokens),
    model: firstDefined(d.model),
    worker: firstDefined(d.worker),
  };
}

// ─── Run directory discovery ─────────────────────────────────────────

/**
 * List run directories under `.forge/runs/`, sorted oldest-first.
 * @param {string} cwd
 * @returns {string[]} sorted directory names
 */
function listRunDirs(cwd) {
  const runsDir = resolve(cwd, ".forge", "runs");
  if (!existsSync(runsDir)) return [];
  try {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}


// ─── Filter logic ────────────────────────────────────────────────────

/**
 * Check if an event timestamp passes the --since / --until filters.
 */
function passesDateFilter(ts, since, until) {
  if (!ts) return false;
  if (since && ts < since) return false;
  if (until && ts > until) return false;
  return true;
}

/**
 * Check if an event type passes the --type filter.
 */
function passesTypeFilter(type, typeFilter) {
  if (!typeFilter || typeFilter.length === 0) return true;
  return typeFilter.includes(type);
}

// ─── Core streaming export ───────────────────────────────────────────

/**
 * Streaming audit export. Async generator that yields records from
 * `.forge/runs/<id>/events.log` files, applying filters.
 *
 * @param {object} opts
 * @param {string} [opts.cwd=process.cwd()]  - Working directory
 * @param {string} [opts.since]              - ISO date lower bound (inclusive)
 * @param {string} [opts.until]              - ISO date upper bound (inclusive)
 * @param {string[]} [opts.type]             - Event types to include
 * @param {string} [opts.run]                - Single run ID to scope to
 * @param {"json"|"csv"} [opts.format="json"] - Output format
 * @yields {string} One line per record (JSONL or CSV row)
 */
export async function* exportAudit(opts = {}) {
  const {
    cwd = process.cwd(),
    since,
    until,
    type: typeFilter,
    run: runFilter,
    format = "json",
  } = opts;

  const dirs = listRunDirs(cwd);
  if (dirs.length === 0) return;

  // Filter to a single run if --run specified
  const targetDirs = runFilter
    ? dirs.filter((d) => d === runFilter)
    : dirs;

  if (targetDirs.length === 0) return;

  // Emit CSV header if format is csv
  if (format === "csv") {
    yield CSV_COLUMNS.join(",");
  }

  for (const dirName of targetDirs) {
    const runDirPath = resolve(cwd, ".forge", "runs", dirName);
    const logPath = resolve(runDirPath, "events.log");
    if (!existsSync(logPath)) continue;

    // Read minimal manifest metadata for plan name
    let plan = null;
    try {
      const manifestPath = resolve(runDirPath, "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        plan = manifest.plan ?? null;
      }
    } catch { /* skip */ }

    // Stream events.log line by line
    const rl = createInterface({
      input: createReadStream(logPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      const parsed = parseLine(line);
      if (!parsed) continue;

      if (!passesDateFilter(parsed.ts, since, until)) continue;
      if (!passesTypeFilter(parsed.type, typeFilter)) continue;

      const record = buildRecord(parsed, dirName, plan);

      if (format === "csv") {
        yield toCsvRow(record);
      } else {
        yield JSON.stringify(record);
      }
    }
  }
}
