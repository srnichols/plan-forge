#!/usr/bin/env node
/**
 * sim-load-phase-38.6.mjs — Synthetic load harness for pattern detector registry.
 *
 * Phase-38.6 Slice 5 — exercises runDetectors under load with seeded run
 * fixtures, failure injection, and edge-case coverage.
 *
 * Usage:
 *   node scripts/sim-load-phase-38.6.mjs
 *   node scripts/sim-load-phase-38.6.mjs --validate-converged
 *
 * Flags:
 *   --validate-converged  Read iterations.md and latest run-*.json;
 *                         exit 0 if last 2 iterations have defects_found: 0
 *                         AND p95 < 500 ms. Exit 1 otherwise.
 *   --model=X             Model label to record in iterations.md (default: claude-sonnet-4.6)
 *
 * Output:
 *   .forge/load-sim/38.6/run-<iso>.json    — latency + memory metrics
 *   .forge/load-sim/38.6/iterations.md     — appended iteration row
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runDetectors } from "../pforge-mcp/patterns/registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, ".forge", "load-sim", "38.6");
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

const TOTAL_CYCLES = 100;
const BATCH_SIZE = 10;

// ─── Fixture generators ──────────────────────────────────────────────────────

function makeRun(plan, slices) {
  return {
    plan,
    results: slices.map((s, i) => ({
      number: i + 1,
      title: s.title || `Slice ${i + 1}`,
      status: s.status || (s.gateStatus === "failed" ? "failed" : "passed"),
      gateStatus: s.gateStatus || "passed",
      gateError: s.gateError || null,
      gateOutput: s.gateOutput || null,
      failedCommand: s.failedCommand || null,
      model: s.model || null,
      complexity: s.complexity ?? null,
    })),
  };
}

/** Generate varied fixture contexts for load testing. */
function makeFixtureContexts() {
  const gateFail = {
    gateStatus: "failed",
    gateError: "tee /tmp/gate-out failed: permission denied",
    failedCommand: "tee /tmp/gate-out",
  };

  return [
    // 1. Zero runs
    { runs: [], costs: [] },

    // 2. Single run, no failures
    { runs: [makeRun("Plan-Solo", [{ gateStatus: "passed" }])], costs: [] },

    // 3. Recurring gate failure across 2 plans (surfaces pattern)
    {
      runs: [
        makeRun("Plan-A", [gateFail, gateFail]),
        makeRun("Plan-B", [gateFail]),
      ],
      costs: [],
    },

    // 4. Identical failure across 10 plans
    {
      runs: Array.from({ length: 10 }, (_, i) =>
        makeRun(`Plan-${i}`, [gateFail])
      ),
      costs: [],
    },

    // 5. All patterns below threshold (2 occurrences, 1 plan)
    {
      runs: [
        makeRun("Plan-X", [
          { gateStatus: "failed", gateError: "unique-error-alpha" },
          { gateStatus: "failed", gateError: "unique-error-alpha" },
        ]),
      ],
      costs: [],
    },

    // 6. Model failure rate scenario
    {
      runs: [
        makeRun("Plan-M1", [
          { model: "gpt-4o", complexity: 5, gateStatus: "failed" },
          { model: "gpt-4o", complexity: 4, gateStatus: "failed" },
          { model: "gpt-4o", complexity: 4, gateStatus: "passed" },
        ]),
        makeRun("Plan-M2", [
          { model: "gpt-4o", complexity: 5, gateStatus: "failed" },
        ]),
      ],
      costs: [],
    },

    // 7. Cost anomaly scenario
    {
      runs: [],
      costs: [
        { sliceType: "vitest", cost: 0.50, plan: "Plan-C1" },
        { sliceType: "vitest", cost: 0.55, plan: "Plan-C1" },
        { sliceType: "vitest", cost: 0.60, plan: "Plan-C2" },
        { sliceType: "vitest", cost: 3.00, plan: "Plan-C2" },
      ],
    },

    // 8. Flap scenario (pass→fail→pass→fail = 3 flaps)
    {
      runs: [
        makeRun("Plan-F", [{ title: "API Build", gateStatus: "passed" }]),
        makeRun("Plan-F", [{ title: "API Build", gateStatus: "failed" }]),
        makeRun("Plan-F", [{ title: "API Build", gateStatus: "passed" }]),
        makeRun("Plan-F", [{ title: "API Build", gateStatus: "failed" }]),
      ],
      costs: [],
    },

    // 9. Mixed — everything below threshold
    {
      runs: [
        makeRun("Plan-Z1", [{ gateStatus: "passed" }, { gateStatus: "passed" }]),
        makeRun("Plan-Z2", [{ gateStatus: "passed" }]),
      ],
      costs: [
        { sliceType: "build", cost: 1.0, plan: "Plan-Z1" },
        { sliceType: "build", cost: 1.1, plan: "Plan-Z1" },
      ],
    },

    // 10. Large run — many slices, all passing
    {
      runs: [
        makeRun(
          "Plan-Big",
          Array.from({ length: 50 }, () => ({ gateStatus: "passed" }))
        ),
      ],
      costs: [],
    },
  ];
}

// ─── Failure injection scenarios ─────────────────────────────────────────────

const failureScenarios = [
  // 1. Read-only invariant: pattern detector must not modify run artifacts
  {
    name: "failure-read-only-invariant",
    test: async () => {
      const runs = [
        makeRun("Plan-Immutable", [
          { gateStatus: "failed", gateError: "tee /tmp/x", failedCommand: "tee /tmp/x" },
          { gateStatus: "failed", gateError: "tee /tmp/x", failedCommand: "tee /tmp/x" },
        ]),
        makeRun("Plan-Immutable2", [
          { gateStatus: "failed", gateError: "tee /tmp/x", failedCommand: "tee /tmp/x" },
        ]),
      ];
      const runsBefore = JSON.stringify(runs);
      await runDetectors({ runs });
      const runsAfter = JSON.stringify(runs);
      if (runsBefore !== runsAfter) {
        return "Detector modified run artifacts — read-only invariant violated";
      }
      return null;
    },
  },

  // 2. Detector throws on malformed fixture — registry catches, skips
  {
    name: "failure-malformed-fixture",
    test: async () => {
      // runDetectors should handle malformed runs gracefully (detectors
      // that crash are skipped). Pass a context with non-array runs.
      const ctx = { runs: "not-an-array", costs: null };
      try {
        const result = await runDetectors(ctx);
        // Should return array (possibly empty), not crash
        if (!Array.isArray(result)) {
          return `Expected array, got ${typeof result}`;
        }
      } catch (err) {
        return `Registry crashed on malformed input: ${err.message}`;
      }
      return null;
    },
  },

  // 3. Phase-32 guardrail: pattern NOT injected into step2 hardener prompt
  {
    name: "failure-no-hardener-injection",
    test: async () => {
      // Verify that no pattern file references step2-harden-plan.prompt.md
      const { readdirSync: readdir, readFileSync: readFile } = await import("node:fs");
      const { join: pJoin, resolve: pResolve, dirname: pDirname } = await import("node:path");
      const { fileURLToPath: pFileURL } = await import("node:url");

      const dir = pDirname(pFileURL(import.meta.url));
      const detectorsDir = pResolve(dir, "..", "pforge-mcp", "patterns", "detectors");
      const registryPath = pResolve(dir, "..", "pforge-mcp", "patterns", "registry.mjs");

      const files = [registryPath];
      try {
        for (const f of readdir(detectorsDir)) {
          if (f.endsWith(".mjs")) files.push(pJoin(detectorsDir, f));
        }
      } catch {
        // If dir doesn't exist, that's fine — no injection possible
      }

      for (const file of files) {
        const content = readFile(file, "utf8");
        if (content.includes("step2-harden-plan") || content.includes("hardener")) {
          return `File ${file} references hardener prompt — Phase-32 violation`;
        }
      }
      return null;
    },
  },

  // 4. All below threshold → empty result
  {
    name: "failure-below-threshold-returns-empty",
    test: async () => {
      const runs = [
        makeRun("Plan-Only", [
          { gateStatus: "failed", gateError: "rare error" },
          { gateStatus: "failed", gateError: "rare error" },
        ]),
      ];
      const patterns = await runDetectors({ runs, costs: [] });
      // 2 occurrences in 1 plan — below threshold
      if (patterns.length > 0) {
        // Check if any pattern is from gate-failure-recurrence with < 3 occ
        const gatePatterns = patterns.filter(p => p.detector === "gate-failure-recurrence");
        if (gatePatterns.length > 0) {
          return `Gate detector fired with < 3 occurrences: ${JSON.stringify(gatePatterns)}`;
        }
      }
      return null;
    },
  },

  // 5. 500 run fixtures — complete in < 5s
  {
    name: "failure-500-runs-under-5s",
    test: async () => {
      const runs = Array.from({ length: 500 }, (_, i) =>
        makeRun(`Plan-${i}`, [
          { gateStatus: i % 3 === 0 ? "failed" : "passed", gateError: `error-${i % 10}` },
          { gateStatus: "passed" },
          { model: "model-x", complexity: 5, gateStatus: i % 5 === 0 ? "failed" : "passed" },
        ])
      );
      const costs = Array.from({ length: 100 }, (_, i) => ({
        sliceType: `type-${i % 5}`,
        cost: 0.5 + (i % 20 === 0 ? 5.0 : 0),
        plan: `Plan-${i}`,
      }));

      const t0 = Date.now();
      await runDetectors({ runs, costs });
      const elapsed = Date.now() - t0;
      if (elapsed > 5000) {
        return `500-run detection took ${elapsed}ms (> 5000ms)`;
      }
      return null;
    },
  },
];

// ─── Run load test ───────────────────────────────────────────────────────────

async function runLoadTest() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const fixtures = makeFixtureContexts();
  const latencies = [];
  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  // Build tasks using round-robin fixtures
  const tasks = [];
  for (let i = 0; i < TOTAL_CYCLES; i++) {
    tasks.push(fixtures[i % fixtures.length]);
  }

  // Process in batches
  let batches = 0;
  for (let offset = 0; offset < tasks.length; offset += BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + BATCH_SIZE);
    await Promise.all(
      batch.map(async (ctx) => {
        const t0 = Date.now();
        await runDetectors(ctx);
        latencies.push(Date.now() - t0);
      }),
    );
    batches++;
  }

  const totalDuration = Date.now() - startTime;
  const memAfter = process.memoryUsage();

  // Latency percentiles
  latencies.sort((a, b) => a - b);
  const pct = (n) => latencies[Math.floor(latencies.length * n / 100)] ?? 0;
  const p50 = pct(50);
  const p95 = pct(95);
  const p99 = pct(99);
  const meanMs = latencies.reduce((s, v) => s + v, 0) / latencies.length;

  const memPeakMb = Math.round(
    Math.max(memAfter.heapUsed, memBefore.heapUsed) / 1024 / 1024,
  );

  const runData = {
    iso: new Date().toISOString(),
    cycles: TOTAL_CYCLES,
    batchSize: BATCH_SIZE,
    batches,
    totalDurationMs: totalDuration,
    latencyMs: { p50, p95, p99, mean: Math.round(meanMs) },
    memoryMb: {
      before: Math.round(memBefore.heapUsed / 1024 / 1024),
      after: Math.round(memAfter.heapUsed / 1024 / 1024),
      peak: memPeakMb,
    },
    p95Pass: p95 < 500,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = join(OUT_DIR, `run-${stamp}.json`);
  writeFileSync(runPath, JSON.stringify(runData, null, 2));

  console.log(`[sim-load-38.6] ${TOTAL_CYCLES} detectPatterns cycles in ${batches} batches`);
  console.log(`[sim-load-38.6] Latency: p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  mean=${Math.round(meanMs)}ms`);
  console.log(`[sim-load-38.6] Memory: before=${runData.memoryMb.before}MB  after=${runData.memoryMb.after}MB`);
  console.log(`[sim-load-38.6] p95 < 500ms: ${runData.p95Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`[sim-load-38.6] Results → ${runPath}`);

  return { runData, p95 };
}

// ─── Failure injection ───────────────────────────────────────────────────────

async function runFailureInjection() {
  console.log("\n[sim-load-38.6] Running failure injection scenarios...");
  let defects = 0;

  for (const scenario of failureScenarios) {
    try {
      const error = await scenario.test();
      if (error) {
        console.warn(`  ✗ ${scenario.name}: ${error}`);
        defects++;
      } else {
        console.log(`  ✓ ${scenario.name}`);
      }
    } catch (err) {
      console.warn(`  ✗ ${scenario.name}: CRASH — ${err.message}`);
      defects++;
    }
  }

  return defects;
}

// ─── Defect detection ─────────────────────────────────────────────────────────

async function detectDefects() {
  let defects = 0;

  // Run each fixture once and verify basic invariants
  const fixtures = makeFixtureContexts();
  for (let i = 0; i < fixtures.length; i++) {
    try {
      const result = await runDetectors(fixtures[i]);
      if (!Array.isArray(result)) {
        console.warn(`[defect] fixture ${i}: result is not array`);
        defects++;
        continue;
      }
      // Verify all patterns have required fields
      for (const p of result) {
        if (!p.id || !p.detector || !p.severity) {
          console.warn(`[defect] fixture ${i}: pattern missing required fields: ${JSON.stringify(p)}`);
          defects++;
        }
      }
    } catch (err) {
      console.warn(`[defect] fixture ${i}: CRASH — ${err.message}`);
      defects++;
    }
  }

  // Run failure injection tests
  defects += await runFailureInjection();

  return defects;
}

// ─── Iteration accounting ─────────────────────────────────────────────────────

function readIterCount() {
  if (!existsSync(ITER_FILE)) return 0;
  const lines = readFileSync(ITER_FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^[|\s-]*$/.test(l));
  return Math.max(0, lines.length - 1);
}

function appendIterRow({ iter, model, durationMs, defectsFound, defectsFixed, p95, memPeakMb }) {
  const header = "| iter | model | started | duration | defects_found | defects_fixed | p95_ms | mem_peak_mb |";
  const sep    = "|------|-------|---------|----------|---------------|---------------|--------|-------------|";
  const started = new Date().toISOString().split("T")[0];
  const row = `| ${iter} | ${model} | ${started} | ${durationMs}ms | ${defectsFound} | ${defectsFixed} | ${p95} | ${memPeakMb} |`;

  let content = "";
  if (!existsSync(ITER_FILE)) {
    content = `# Phase-38.6 Slice 5 — Load-Hardening Iterations\n\n${header}\n${sep}\n${row}\n`;
  } else {
    content = readFileSync(ITER_FILE, "utf8");
    if (!content.includes(header)) {
      content = `# Phase-38.6 Slice 5 — Load-Hardening Iterations\n\n${header}\n${sep}\n` + content;
    }
    content = content.trimEnd() + "\n" + row + "\n";
  }
  writeFileSync(ITER_FILE, content);
}

// ─── Validate-converged ───────────────────────────────────────────────────────

function validateConverged() {
  let ok = true;

  if (!existsSync(ITER_FILE)) {
    console.error("[validate] FAIL: iterations.md not found");
    process.exit(1);
  }

  const lines = readFileSync(ITER_FILE, "utf8")
    .split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^[|\s-]*$/.test(l));

  const dataRows = lines.slice(1);
  if (dataRows.length < 2) {
    console.error(`[validate] FAIL: iterations.md has only ${dataRows.length} data row(s); need ≥ 2`);
    ok = false;
  } else {
    const last2 = dataRows.slice(-2);
    for (const row of last2) {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      const defectsFound = parseInt(cols[4] ?? "1", 10);
      if (defectsFound !== 0) {
        console.error(`[validate] FAIL: row "${row.trim()}" has defects_found=${defectsFound}`);
        ok = false;
      }
    }
    if (ok) console.log("[validate] iterations.md: last 2 rows have defects_found: 0 ✓");
  }

  // Check latest run-*.json for p95 < 500ms
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
    if (p95 >= 500) {
      console.error(`[validate] FAIL: p95=${p95}ms ≥ 500ms in ${latest}`);
      ok = false;
    } else {
      console.log(`[validate] ${latest}: p95=${p95}ms < 500ms ✓`);
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
      console.log(`[sim-load-38.6] iter ${iter}: 0 defects (${consecutiveClean}/2 clean)`);
      if (consecutiveClean >= 2) {
        console.log("[sim-load-38.6] converged: 2 consecutive zero-defect iterations ✓");
        break;
      }
    } else {
      consecutiveClean = 0;
      console.warn(`[sim-load-38.6] iter ${iter}: ${defectsFound} defect(s) found`);
    }

    iter++;
  }

  if (iter > HARD_CAP && consecutiveClean < 2) {
    console.error(`[sim-load-38.6] ERROR: reached iteration cap (${HARD_CAP}) without converging`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[sim-load-38.6] fatal:", err);
  process.exit(1);
});
