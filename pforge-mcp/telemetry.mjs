/**
 * Plan Forge — Unified Telemetry (v2.4)
 *
 * OTLP-compatible trace/span/log capture for end-to-end observability.
 * Writes trace.json, manifest.json, and index.jsonl per run.
 *
 * @module telemetry
 */

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { hostname, type as osType } from "node:os";
import { execSync } from "node:child_process";

// Severity levels per OTLP convention
export const Severity = {
  TRACE: { text: "TRACE", number: 1 },
  DEBUG: { text: "DEBUG", number: 5 },
  INFO:  { text: "INFO",  number: 9 },
  WARN:  { text: "WARN",  number: 13 },
  ERROR: { text: "ERROR", number: 17 },
  FATAL: { text: "FATAL", number: 21 },
};

/**
 * Create trace context for a new run.
 */
export function createTraceContext(planPath, options = {}) {
  const { mode = "auto", model = "auto", sliceCount = 0 } = options;

  // Resource context — who/where/what
  let userName = "unknown";
  try { userName = execSync("git config user.name", { encoding: "utf-8", timeout: 5000 }).trim(); } catch { /* ignore */ }

  const traceId = randomUUID().replace(/-/g, "").substring(0, 32);

  return {
    resource: {
      "service.name": "plan-forge-orchestrator",
      "service.version": "2.4.0",
      "host.name": hostname(),
      "os.type": osType(),
      "user.name": userName,
      "project.name": basename(process.cwd()),
    },
    traceId,
    plan: planPath,
    mode,
    model,
    sliceCount,
    spans: [],
    _activeSpans: new Map(),
    _startTime: new Date().toISOString(),
  };
}

/**
 * Start a root span (run-plan).
 */
export function startRootSpan(trace, name, attributes = {}) {
  const span = {
    spanId: randomUUID().replace(/-/g, "").substring(0, 16),
    parentSpanId: null,
    name,
    kind: "SERVER",
    startTime: new Date().toISOString(),
    endTime: null,
    status: "UNSET",
    attributes,
    events: [],
    logSummary: [],
  };
  trace.spans.push(span);
  trace._activeSpans.set(name, span);
  return span;
}

/**
 * Start a child span (slice, worker, gate).
 */
export function startSpan(trace, name, parentSpanId, kind = "INTERNAL", attributes = {}) {
  const span = {
    spanId: randomUUID().replace(/-/g, "").substring(0, 16),
    parentSpanId,
    name,
    kind,
    startTime: new Date().toISOString(),
    endTime: null,
    status: "UNSET",
    attributes,
    events: [],
    logSummary: [],
  };
  trace.spans.push(span);
  trace._activeSpans.set(name, span);
  return span;
}

/**
 * End a span with status.
 */
export function endSpan(span, status = "OK") {
  span.endTime = new Date().toISOString();
  span.status = status;
}

/**
 * Add an event to a span.
 */
export function addEvent(span, name, severity = Severity.INFO, attributes = {}) {
  span.events.push({
    time: new Date().toISOString(),
    name,
    severity: severity.text,
    severityNumber: severity.number,
    attributes,
  });
}

/**
 * Add log summary lines to a span (extracted from worker output).
 */
export function addLogSummary(span, output) {
  if (!output) return;
  const lines = output.split("\n");
  const patterns = /creat|modif|writ|delet|error|fail|warn|pass|compil|test|build/i;
  const summary = lines
    .filter((l) => patterns.test(l))
    .slice(0, 50)
    .map((l) => l.trim().substring(0, 200));
  span.logSummary = summary;
}

// ─── Trace Writer ─────────────────────────────────────────────────────

/**
 * Write trace.json to the run directory.
 */
export function writeTrace(trace, runDir) {
  const output = {
    resource: trace.resource,
    traceId: trace.traceId,
    spans: trace.spans.map((s) => ({
      spanId: s.spanId,
      parentSpanId: s.parentSpanId,
      name: s.name,
      kind: s.kind,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      attributes: s.attributes,
      events: s.events,
      logSummary: s.logSummary,
    })),
  };
  writeFileSync(resolve(runDir, "trace.json"), JSON.stringify(output, null, 2));
}

// ─── Manifest + Index (Log Registry) ──────────────────────────────────

/**
 * Write manifest.json for a completed run.
 */
export function writeManifest(runDir, runId, summary) {
  const files = [];
  const checkFile = (name) => {
    const path = resolve(runDir, name);
    if (existsSync(path)) files.push(name);
  };

  checkFile("run.json");
  checkFile("summary.json");
  checkFile("trace.json");
  checkFile("events.log");

  // Find slice files
  const slices = [];
  try {
    const entries = readdirSync(runDir);
    const sliceJsonFiles = entries.filter((f) => /^slice-[\d.]+\.json$/.test(f)).sort();
    for (const sjf of sliceJsonFiles) {
      const num = sjf.match(/slice-([\d.]+)\.json/)?.[1];
      if (!num) continue;
      const logFile = `slice-${num}-log.txt`;
      slices.push({
        number: num,
        result: sjf,
        log: entries.includes(logFile) ? logFile : null,
        status: summary?.sliceResults?.find((r) => String(r.number || r.sliceId) === num)?.status || "unknown",
      });
    }
  } catch { /* ignore */ }

  const manifest = {
    runId,
    traceId: summary?.traceId || null,
    plan: summary?.plan || null,
    startTime: summary?.startTime || null,
    endTime: summary?.endTime || null,
    status: summary?.status || "unknown",
    artifacts: files,
    slices,
  };

  writeFileSync(resolve(runDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Append a run entry to .forge/runs/index.jsonl.
 * JSONL format — one JSON object per line, safe for concurrent appends.
 */
export function appendRunIndex(cwd, runId, manifest) {
  const indexPath = resolve(cwd, ".forge", "runs", "index.jsonl");
  mkdirSync(resolve(cwd, ".forge", "runs"), { recursive: true });

  const entry = JSON.stringify({
    runId,
    plan: manifest.plan,
    status: manifest.status,
    startTime: manifest.startTime,
    endTime: manifest.endTime,
    dir: runId,
    sliceCount: manifest.slices?.length || 0,
  });

  appendFileSync(indexPath, entry + "\n");
}

/**
 * Read the run index. Skips malformed lines (corruption recovery).
 */
export function readRunIndex(cwd) {
  const indexPath = resolve(cwd, ".forge", "runs", "index.jsonl");
  if (!existsSync(indexPath)) return [];

  const lines = readFileSync(indexPath, "utf-8").split("\n").filter((l) => l.trim());
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines (corruption recovery — Gap 6)
      continue;
    }
  }
  return entries;
}

// ─── Log Rotation ─────────────────────────────────────────────────────

/**
 * Prune old run directories beyond maxRunHistory.
 */
export function pruneRunHistory(cwd, maxRunHistory = 50) {
  const runsDir = resolve(cwd, ".forge", "runs");
  if (!existsSync(runsDir)) return;

  const dirs = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();

  if (dirs.length <= maxRunHistory) return;

  const toRemove = dirs.slice(maxRunHistory);
  for (const dir of toRemove) {
    try {
      rmSync(resolve(runsDir, dir), { recursive: true, force: true });
    } catch { /* best effort */ }
  }

  // Compact index — remove entries for deleted directories
  const indexPath = resolve(runsDir, "index.jsonl");
  if (existsSync(indexPath)) {
    const remaining = new Set(dirs.slice(0, maxRunHistory));
    const entries = readRunIndex(cwd).filter((e) => remaining.has(e.dir));
    writeFileSync(indexPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
}

// ─── Orchestrator Event Handler for Telemetry ─────────────────────────

/**
 * Create a telemetry event handler that builds trace.json from orchestrator events.
 * Plug this into the orchestrator via DI (eventHandler option).
 */
export function createTelemetryHandler(trace, runDir) {
  let rootSpan = null;

  return {
    handle(event) {
      const { type, data } = event;

      switch (type) {
        case "run-started": {
          rootSpan = startRootSpan(trace, "run-plan", {
            plan: data?.plan,
            mode: data?.mode,
            model: data?.model,
            sliceCount: data?.sliceCount,
          });
          break;
        }
        case "slice-started": {
          const parentId = rootSpan?.spanId || null;
          startSpan(trace, `slice-${data?.sliceId}`, parentId, "INTERNAL", {
            sliceId: data?.sliceId,
            title: data?.title,
            parallel: data?.parallel || false,
          });
          break;
        }
        case "slice-completed": {
          const span = trace._activeSpans.get(`slice-${data?.sliceId}`);
          if (span) {
            addEvent(span, "completed", Severity.INFO, {
              duration: data?.duration,
              model: data?.model,
              tokens_out: data?.tokens?.tokens_out,
              cost_usd: data?.tokens?.cost_usd,
              attempts: data?.attempts,
            });
            span.attributes.duration = data?.duration;
            span.attributes.model = data?.model;
            span.attributes.cost_usd = data?.cost_usd;
            span.attributes.attempts = data?.attempts;
            endSpan(span, "OK");
          }
          break;
        }
        case "slice-failed": {
          const span = trace._activeSpans.get(`slice-${data?.sliceId}`);
          if (span) {
            addEvent(span, "failed", Severity.ERROR, {
              error: data?.error,
              failedCommand: data?.failedCommand,
              gateError: data?.gateError,
            });
            endSpan(span, "ERROR");
          }
          break;
        }
        case "run-completed": {
          if (rootSpan) {
            addEvent(rootSpan, "completed", Severity.INFO, {
              status: data?.status,
              passed: data?.results?.passed,
              failed: data?.results?.failed,
              report: data?.report,
            });
            endSpan(rootSpan, data?.status === "completed" ? "OK" : "ERROR");
          }
          // Write trace on completion
          writeTrace(trace, runDir);
          break;
        }
        case "run-aborted": {
          if (rootSpan) {
            addEvent(rootSpan, "aborted", Severity.WARN, { reason: data?.reason });
            endSpan(rootSpan, "ERROR");
          }
          writeTrace(trace, runDir);
          break;
        }
      }
    },
  };
}
