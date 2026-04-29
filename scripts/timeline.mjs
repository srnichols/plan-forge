#!/usr/bin/env node
/**
 * Plan Forge — timeline CLI helper.
 *
 * Offline-first unified chronological view across all forge event sources.
 * Reads directly from .forge/ files — no running server required.
 *
 * Usage:
 *   node scripts/timeline.mjs [options]
 *
 * Options:
 *   --window <15m|1h|6h|24h|7d|30d>   Time window relative to now (default: 24h)
 *   --from <iso>                        Start of window (ISO timestamp)
 *   --to <iso>                          End of window (ISO timestamp)
 *   --source <name,...>                 Comma-separated source filter
 *   --correlation <id>                  Filter to a single correlationId thread
 *   --group-by <time|correlation>       Group mode (default: time)
 *   --limit <n>                         Max events (default: 100, max: 2000)
 *   --json                              Output raw JSON
 *
 * Sources: hub-event, run, memory, openbrain, watch, tempering, bug, incident, forge-master
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const { timeline } = await import(join(repoRoot, "pforge-mcp", "timeline", "core.mjs"));

// ─── Arg parsing ──────────────────────────────────────────────────────

const WINDOW_MS = { "15m": 15 * 60_000, "1h": 3_600_000, "6h": 6 * 3_600_000, "24h": 24 * 3_600_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
const VALID_WINDOWS = Object.keys(WINDOW_MS);

const args = process.argv.slice(2);
const opts = {};

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json") { opts.json = true; continue; }
  if (a === "--help" || a === "-h") { opts.help = true; continue; }
  const m = a.match(/^--(window|from|to|source|correlation|group-by|limit)(?:=(.+))?$/);
  if (m) {
    opts[m[1]] = m[2] ?? args[++i];
  }
}

if (opts.help) {
  console.log(`Usage: pforge timeline [options]

Options:
  --window <${VALID_WINDOWS.join("|")}>   Time window (default: 24h)
  --from <iso>                  Window start (ISO timestamp)
  --to <iso>                    Window end (ISO timestamp)
  --source <name,...>           Comma-separated source filter
  --correlation <id>            Filter to a single correlationId
  --group-by <time|correlation> Group mode (default: time)
  --limit <n>                   Max events (default: 100)
  --json                        Output raw JSON

Sources: hub-event, run, memory, openbrain, watch, tempering, bug, incident, forge-master
`);
  process.exit(0);
}

// ─── Build params ─────────────────────────────────────────────────────

const params = {};

if (opts.from) {
  params.from = opts.from;
} else if (opts.window) {
  if (!WINDOW_MS[opts.window]) {
    console.error(`Unknown window '${opts.window}'. Valid: ${VALID_WINDOWS.join(", ")}`);
    process.exit(1);
  }
  params.from = new Date(Date.now() - WINDOW_MS[opts.window]).toISOString();
}

if (opts.to) params.to = opts.to;
if (opts.correlation) params.correlationId = opts.correlation;
if (opts["group-by"]) params.groupBy = opts["group-by"];
if (opts.source) params.sources = opts.source.split(",").map((s) => s.trim()).filter(Boolean);

const rawLimit = opts.limit ? parseInt(opts.limit, 10) : 100;
params.limit = isNaN(rawLimit) ? 100 : rawLimit;

// ─── Run timeline ─────────────────────────────────────────────────────

const projectDir = process.cwd();

try {
  const result = await timeline(params, { cwd: projectDir });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // Human-readable output
  const window = `${result.windowFrom ? new Date(result.windowFrom).toLocaleString() : "?"} → ${result.windowTo ? new Date(result.windowTo).toLocaleString() : "?"}`;
  console.log(`\n📅 Timeline  ${window}  (${result.durationMs}ms)`);
  if (result.sourcesQueried?.length) {
    console.log(`   Sources: ${result.sourcesQueried.join(", ")}`);
  }
  console.log("");

  if (result.groupBy === "correlation" || params.groupBy === "correlation") {
    const threads = result.threads || [];
    if (threads.length === 0) {
      console.log("  No threads found. Try widening the time window.");
    } else {
      for (const thread of threads) {
        const cid = thread.correlationId === "__ungrouped__" ? "(ungrouped)" : thread.correlationId;
        const count = thread.events?.length ?? 0;
        console.log(`  [${cid}]  ${count} event(s)  ${thread.sources?.join(",") ?? ""}`);
        if (thread.events) {
          for (const evt of thread.events.slice(0, 5)) {
            const ts = evt.ts ? new Date(evt.ts).toLocaleTimeString() : "?";
            console.log(`    ${ts}  ${evt.source}  ${evt.event}`);
          }
          if (count > 5) console.log(`    … and ${count - 5} more`);
        }
      }
    }
  } else {
    const events = result.events || [];
    if (events.length === 0) {
      console.log("  No events found. Try widening the time window.");
    } else {
      for (const evt of events) {
        const ts = evt.ts ? new Date(evt.ts).toLocaleString() : "?";
        const src = (evt.source || "?").padEnd(14);
        const ev = (evt.event || "?").padEnd(20);
        const cid = evt.correlationId ? `[${evt.correlationId.slice(0, 16)}]` : "";
        console.log(`  ${ts}  ${src}  ${ev}  ${cid}`);
      }
    }
  }

  if (result.truncated) {
    console.log(`\n  ⚠ Truncated to ${params.limit} results. Use --limit to raise the cap.`);
  }
  console.log(`\n  Total: ${result.total} event(s)`);
} catch (err) {
  console.error(`Timeline error: ${err.message}`);
  process.exit(1);
}
