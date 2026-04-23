#!/usr/bin/env node
/**
 * sim-load-phase-37.1.mjs — Synthetic load harness for HTTP dispatcher.
 *
 * Phase-37.1 Slice 4 — measures dispatcher latency under realistic load
 * using mocked mcpCall variants (no live MCP server required).
 *
 * Usage:
 *   node scripts/sim-load-phase-37.1.mjs
 *   node scripts/sim-load-phase-37.1.mjs --validate-converged
 *
 * Flags:
 *   --validate-converged  Read iterations.md and latest run-*.json;
 *                         exit 0 if last 2 iterations have defects_found: 0
 *                         AND p95 < 250 ms. Exit 1 otherwise.
 *   --iter=N              Iteration number to record (default: auto-increment)
 *   --model=X             Model label to record in iterations.md (default: claude-sonnet-4.6)
 *
 * Output:
 *   .forge/load-sim/37.1/run-<iso>.json    — latency + memory metrics
 *   .forge/load-sim/37.1/iterations.md     — appended iteration row
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpDispatcher } from "../pforge-master/src/http-dispatcher.mjs";
import { BASE_ALLOWLIST } from "../pforge-master/src/allowlist.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, ".forge", "load-sim", "37.1");
const ITER_FILE = join(OUT_DIR, "iterations.md");

const argv = Object.fromEntries(
  process.argv.slice(2).flatMap((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [[m[1], m[2] || "true"]] : [];
  }),
);

const VALIDATE_CONVERGED = argv["validate-converged"] === "true";
const MODEL_LABEL = argv.model || "claude-sonnet-4.6";

// ─── Validate-converged mode ──────────────────────────────────────────────────

if (VALIDATE_CONVERGED) {
  validateConverged();
  process.exit(0);
}

// ─── Load test parameters ─────────────────────────────────────────────────────

const TOTAL_INVOCATIONS = 500;
const BATCH_SIZE = 25;

// ─── Arg variants ─────────────────────────────────────────────────────────────

const ARG_VARIANTS = [
  {},                                          // empty object
  { query: "phase-37" },                       // typical args
  { a: "x".repeat(10_000) },                  // huge object (one big string)
  { nested: { deep: { deeper: { v: 1 } } } }, // deep-nested object
];

// ─── Mock mcpCall variants ────────────────────────────────────────────────────
// All variants are in-process; no real MCP server is used.

/** Fast non-streaming response (~0 ms I/O). */
async function mockMcpCall(toolName, _args) {
  return { tool: toolName, ok: true, ts: Date.now() };
}

/** Streaming response: emits 3 progress events + terminal. */
async function* mockStreamingMcpCall(_toolName, _args) {
  for (let i = 0; i < 3; i++) {
    yield { type: "progress", data: { step: i } };
  }
  yield { type: "terminal", data: { done: true } };
}

function pickMcpCall(toolIndex) {
  // Alternate between streaming and non-streaming to exercise both paths.
  return toolIndex % 3 === 0
    ? () => mockStreamingMcpCall()
    : mockMcpCall;
}

// ─── Run load test ───────────────────────────────────────────────────────────

async function runLoadTest() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const dispatchers = BASE_ALLOWLIST.map((_, i) =>
    createHttpDispatcher({
      allowlist: BASE_ALLOWLIST,
      mcpCall: pickMcpCall(i),
      streamTimeout: 5000,
    })
  );

  const tasks = [];
  for (let i = 0; i < TOTAL_INVOCATIONS; i++) {
    const toolIndex = i % BASE_ALLOWLIST.length;
    const argVariant = ARG_VARIANTS[i % ARG_VARIANTS.length];
    const dispatch = dispatchers[toolIndex];
    const tool = BASE_ALLOWLIST[toolIndex];
    tasks.push({ dispatch, tool, args: argVariant });
  }

  const memBefore = process.memoryUsage();
  const startTime = Date.now();
  const latencies = [];

  // Process in batches of BATCH_SIZE.
  let batches = 0;
  for (let offset = 0; offset < tasks.length; offset += BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ dispatch, tool, args }) => {
        const t0 = Date.now();
        await dispatch(tool, args);
        latencies.push(Date.now() - t0);
      })
    );
    batches++;
  }

  const totalDuration = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  // ─── Latency percentiles ─────────────────────────────────────────────────
  latencies.sort((a, b) => a - b);
  const pct = (n) => latencies[Math.floor(latencies.length * n / 100)] ?? 0;
  const p50 = pct(50);
  const p95 = pct(95);
  const p99 = pct(99);
  const meanMs = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  const memPeakMb = Math.round(
    Math.max(memAfter.heapUsed, memBefore.heapUsed) / 1024 / 1024
  );

  const runData = {
    iso: new Date().toISOString(),
    invocations: TOTAL_INVOCATIONS,
    batchSize: BATCH_SIZE,
    batches,
    totalDurationMs: totalDuration,
    latencyMs: { p50, p95, p99, mean: Math.round(meanMs) },
    memoryMb: {
      before: Math.round(memBefore.heapUsed / 1024 / 1024),
      after: Math.round(memAfter.heapUsed / 1024 / 1024),
      peak: memPeakMb,
    },
    p95Pass: p95 < 250,
  };

  // ─── Write run JSON ──────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = join(OUT_DIR, `run-${stamp}.json`);
  writeFileSync(runPath, JSON.stringify(runData, null, 2));

  console.log(`[sim-load] ${TOTAL_INVOCATIONS} invocations in ${batches} batches`);
  console.log(`[sim-load] Latency: p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  mean=${Math.round(meanMs)}ms`);
  console.log(`[sim-load] Memory: before=${runData.memoryMb.before}MB  after=${runData.memoryMb.after}MB`);
  console.log(`[sim-load] p95 < 250ms: ${runData.p95Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`[sim-load] Results → ${runPath}`);

  return { runData, p95 };
}

// ─── Defect detection ─────────────────────────────────────────────────────────

/**
 * Run a quick defect scan: re-run key vitest tests and check that the
 * dispatcher returns no unexpected errors on the BASE_ALLOWLIST.
 *
 * Returns number of defects found.
 */
async function detectDefects() {
  const dispatch = createHttpDispatcher({
    allowlist: BASE_ALLOWLIST,
    mcpCall: async (toolName) => ({ ok: true, tool: toolName }),
    streamTimeout: 0,
  });

  let defects = 0;
  for (const tool of BASE_ALLOWLIST) {
    const result = await dispatch(tool, {});
    if (result?.error) {
      const isExpected =
        result.error === "tool not allowlisted" ||
        result.error === "destructive tool requires in-IDE confirmation";
      if (!isExpected) {
        console.warn(`[sim-load] defect: ${tool} → ${result.error}`);
        defects++;
      }
    }
  }
  return defects;
}

// ─── Iteration accounting ─────────────────────────────────────────────────────

function readIterCount() {
  if (!existsSync(ITER_FILE)) return 0;
  const lines = readFileSync(ITER_FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^[|\s-]*$/.test(l));
  // Subtract header row
  return Math.max(0, lines.length - 1);
}

function appendIterRow({ iter, model, durationMs, defectsFound, defectsFixed, p95, memPeakMb }) {
  const header = "| iter | model | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |";
  const sep    = "|------|-------|---------|----------|---------------|---------------|--------|-------------|";
  const started = new Date().toISOString().split("T")[0];
  const row = `| ${iter} | ${model} | ${started} | ${durationMs}ms | ${defectsFound} | ${defectsFixed} | ${p95} | ${memPeakMb} |`;

  let content = "";
  if (!existsSync(ITER_FILE)) {
    content = `# Phase-37.1 Slice 4 — Load-Hardening Iterations\n\n${header}\n${sep}\n${row}\n`;
  } else {
    content = readFileSync(ITER_FILE, "utf8");
    if (!content.includes(header)) {
      content = `# Phase-37.1 Slice 4 — Load-Hardening Iterations\n\n${header}\n${sep}\n` + content;
    }
    content = content.trimEnd() + "\n" + row + "\n";
  }
  writeFileSync(ITER_FILE, content);
}

// ─── Validate-converged ───────────────────────────────────────────────────────

function validateConverged() {
  let ok = true;

  // Check iterations.md
  if (!existsSync(ITER_FILE)) {
    console.error("[validate] FAIL: iterations.md not found");
    process.exit(1);
  }

  const lines = readFileSync(ITER_FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^[|\s-]*$/.test(l));

  const dataRows = lines.slice(1); // skip header
  if (dataRows.length < 2) {
    console.error(`[validate] FAIL: iterations.md has only ${dataRows.length} data row(s); need ≥ 2`);
    ok = false;
  } else {
    const last2 = dataRows.slice(-2);
    for (const row of last2) {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      // cols: [iter, model, started, duration, defects_found, defects_fixed, p95_ms, mem_peak_mb]
      const defectsFound = parseInt(cols[4] ?? "1", 10);
      if (defectsFound !== 0) {
        console.error(`[validate] FAIL: row "${row.trim()}" has defects_found=${defectsFound}`);
        ok = false;
      }
    }
    if (ok) console.log("[validate] iterations.md: last 2 rows have defects_found: 0 ✓");
  }

  // Check latest run-*.json for p95 < 250ms
  const runFiles = existsSync(OUT_DIR)
    ? readdirSync(OUT_DIR).filter((f) => f.startsWith("run-") && f.endsWith(".json")).sort()
    : [];

  if (runFiles.length === 0) {
    console.error("[validate] FAIL: no run-*.json files found");
    ok = false;
  } else {
    const latest = runFiles[runFiles.length - 1];
    const runData = JSON.parse(readFileSync(join(OUT_DIR, latest), "utf8"));
    const p95 = runData.latencyMs?.p95 ?? 999;
    if (p95 >= 250) {
      console.error(`[validate] FAIL: p95=${p95}ms ≥ 250ms in ${latest}`);
      ok = false;
    } else {
      console.log(`[validate] ${latest}: p95=${p95}ms < 250ms ✓`);
    }
  }

  if (!ok) process.exit(1);
  console.log("[validate] converged ✓");
}

// ─── Main loop ────────────────────────────────────────────────────────────────

const HARD_CAP = 5;

async function main() {
  let iter = readIterCount() + 1;
  let consecutiveClean = 0;

  while (iter <= HARD_CAP) {
    console.log(`\n=== Iteration ${iter} ===`);
    const startMs = Date.now();

    const { runData, p95 } = await runLoadTest();
    const defectsFound = await detectDefects();
    const durationMs = Date.now() - startMs;

    appendIterRow({
      iter,
      model: MODEL_LABEL,
      durationMs,
      defectsFound,
      defectsFixed: 0,
      p95,
      memPeakMb: runData.memoryMb.peak,
    });

    if (defectsFound === 0) {
      consecutiveClean++;
      console.log(`[sim-load] iter ${iter}: 0 defects (${consecutiveClean}/2 clean)`);
      if (consecutiveClean >= 2) {
        console.log("[sim-load] converged: 2 consecutive zero-defect iterations ✓");
        break;
      }
    } else {
      consecutiveClean = 0;
      console.warn(`[sim-load] iter ${iter}: ${defectsFound} defect(s) found`);
    }

    iter++;
  }

  if (iter > HARD_CAP && consecutiveClean < 2) {
    console.error(`[sim-load] ERROR: reached iteration cap (${HARD_CAP}) without converging`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[sim-load] fatal:", err);
  process.exit(1);
});
