#!/usr/bin/env node
/**
 * sim-load-phase-38.4.mjs — Synthetic load harness for planner + executor.
 *
 * Phase-38.4 Slice 5 — exercises plan() and executePlan() under load,
 * with failure injection and edge-case coverage.
 *
 * Usage:
 *   node scripts/sim-load-phase-38.4.mjs
 *   node scripts/sim-load-phase-38.4.mjs --validate-converged
 *
 * Flags:
 *   --validate-converged  Read iterations.md and latest run-*.json;
 *                         exit 0 if last 2 iterations have defects_found: 0
 *                         AND p95 < 500 ms. Exit 1 otherwise.
 *   --model=X             Model label to record in iterations.md (default: claude-sonnet-4.6)
 *
 * Output:
 *   .forge/load-sim/38.4/run-<iso>.json    — latency + memory metrics
 *   .forge/load-sim/38.4/iterations.md     — appended iteration row
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { plan, MAX_STEPS, SKIP_REASONS } from "../pforge-master/src/planner.mjs";
import { executePlan, topoSort, TIMEOUT_MS } from "../pforge-master/src/plan-executor.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, ".forge", "load-sim", "38.4");
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

// ─── Allowed tools for test scenarios ─────────────────────────────────────────

const TEST_TOOLS = [
  "forge_plan_status",
  "forge_cost_report",
  "forge_status",
  "forge_health_trend",
  "forge_watch",
];

// ─── Scenario generators ─────────────────────────────────────────────────────

function makeClassification(lane) {
  return { lane, confidence: "high", suggestedTools: [] };
}

/** Mock planner model that returns varied step counts. */
function makeMockPlannerModel(stepCount, options = {}) {
  return async function callPlannerModel() {
    if (options.hangForever) {
      return new Promise(() => {}); // never resolves
    }
    if (options.malformedJson) {
      return "this is not valid JSON {{{";
    }
    if (options.returnSix) {
      // Return 6 steps — exceeds MAX_STEPS cap
      const steps = Array.from({ length: 6 }, (_, i) => ({
        tool: TEST_TOOLS[i % TEST_TOOLS.length],
        args: {},
        rationale: `Step ${i}`,
        dependsOn: i > 0 ? [String(i - 1)] : [],
      }));
      return JSON.stringify(steps);
    }
    if (options.notInAllowlist) {
      return JSON.stringify([
        { tool: "forge_run_plan", args: {}, rationale: "Not allowed" },
        { tool: "forge_cost_report", args: {}, rationale: "Allowed" },
      ]);
    }

    const steps = [];
    for (let i = 0; i < stepCount; i++) {
      steps.push({
        tool: TEST_TOOLS[i % TEST_TOOLS.length],
        args: { query: `test-${i}` },
        rationale: `Test step ${i}`,
        dependsOn: options.sequential && i > 0 ? [String(i - 1)] : [],
      });
    }
    return JSON.stringify(steps);
  };
}

/** Mock dispatch that resolves quickly. */
async function mockDispatch(step) {
  return { ok: true, tool: step.tool, data: `result-${step.id}` };
}

/** Mock dispatch with configurable delay. */
function mockDispatchWithDelay(delayMs) {
  return async (step) => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { ok: true, tool: step.tool, data: `result-${step.id}` };
  };
}

// ─── Scenario definitions ────────────────────────────────────────────────────

const scenarios = [
  // Edge case: empty allowedTools
  {
    name: "empty-allowedTools",
    makePlanArgs: () => ({
      userMessage: "Show cost breakdown",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: [],
      deps: { callPlannerModel: makeMockPlannerModel(3) },
    }),
    expectedSkip: SKIP_REASONS.NO_TOOLS,
  },
  // Edge case: single-word query
  {
    name: "single-word-query",
    makePlanArgs: () => ({
      userMessage: "status",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TEST_TOOLS,
      deps: { callPlannerModel: makeMockPlannerModel(1) },
    }),
  },
  // Edge case: max-5-step plan
  {
    name: "max-5-step-plan",
    makePlanArgs: () => ({
      userMessage: "Show cost for runs that failed last week broken down by model and phase",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TEST_TOOLS,
      deps: { callPlannerModel: makeMockPlannerModel(5) },
    }),
  },
  // Edge case: all-parallel-no-dependencies
  {
    name: "all-parallel-no-deps",
    makePlanArgs: () => ({
      userMessage: "Check everything in parallel",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TEST_TOOLS,
      deps: { callPlannerModel: makeMockPlannerModel(4) },
    }),
  },
  // Edge case: all-sequential-chain
  {
    name: "all-sequential-chain",
    makePlanArgs: () => ({
      userMessage: "Run sequential pipeline",
      classification: makeClassification("troubleshoot"),
      lane: "troubleshoot",
      allowedTools: TEST_TOOLS,
      deps: { callPlannerModel: makeMockPlannerModel(4, { sequential: true }) },
    }),
  },
];

// ─── Failure injection scenarios ─────────────────────────────────────────────

const failureScenarios = [
  // 1. Planner model returns malformed JSON → fallback to reactive
  {
    name: "failure-malformed-json",
    test: async () => {
      const result = await plan({
        userMessage: "Check cost",
        classification: makeClassification("operational"),
        lane: "operational",
        allowedTools: TEST_TOOLS,
        deps: { callPlannerModel: makeMockPlannerModel(0, { malformedJson: true }) },
      });
      if (result.skipReason !== SKIP_REASONS.PLANNER_ERROR) {
        return `Expected skipReason=${SKIP_REASONS.PLANNER_ERROR}, got ${result.skipReason}`;
      }
      return null;
    },
  },
  // 2. Circular dependency (0→1, 1→0) → cycle detection and error
  {
    name: "failure-circular-dependency",
    test: async () => {
      const circularPlan = {
        steps: [
          { id: "step-0", tool: "forge_status", args: {}, rationale: "A", dependsOn: ["step-1"] },
          { id: "step-1", tool: "forge_cost_report", args: {}, rationale: "B", dependsOn: ["step-0"] },
        ],
      };
      const { results } = await executePlan(circularPlan, { dispatch: mockDispatch });
      if (!results.every((r) => r.error && /cycle/i.test(r.error))) {
        return `Expected all steps to have cycle error, got: ${JSON.stringify(results.map(r => r.error))}`;
      }
      return null;
    },
  },
  // 3. Tool not in allowlist returned by planner → silently dropped
  {
    name: "failure-tool-not-in-allowlist",
    test: async () => {
      const result = await plan({
        userMessage: "Run the plan and check cost",
        classification: makeClassification("operational"),
        lane: "operational",
        allowedTools: TEST_TOOLS,
        deps: { callPlannerModel: makeMockPlannerModel(0, { notInAllowlist: true }) },
      });
      // forge_run_plan should be filtered out, forge_cost_report kept
      if (result.steps.length !== 1) {
        return `Expected 1 step after filtering, got ${result.steps.length}`;
      }
      if (result.steps[0].tool !== "forge_cost_report") {
        return `Expected forge_cost_report, got ${result.steps[0].tool}`;
      }
      return null;
    },
  },
  // 4. Plan returns 6 steps (> cap) → only first 5 executed
  {
    name: "failure-exceed-max-steps",
    test: async () => {
      const result = await plan({
        userMessage: "Do many complex things",
        classification: makeClassification("operational"),
        lane: "operational",
        allowedTools: TEST_TOOLS,
        deps: { callPlannerModel: makeMockPlannerModel(0, { returnSix: true }) },
      });
      if (result.steps.length > MAX_STEPS) {
        return `Expected ≤${MAX_STEPS} steps, got ${result.steps.length}`;
      }
      return null;
    },
  },
  // 5. One model in a 3-step plan hangs forever → 30s timeout fires, partial results
  {
    name: "failure-hang-timeout",
    test: async () => {
      const hangingPlan = {
        steps: [
          { id: "step-0", tool: "forge_status", args: {}, rationale: "Fast" },
          { id: "step-1", tool: "forge_cost_report", args: {}, rationale: "Hangs", dependsOn: ["step-0"] },
          { id: "step-2", tool: "forge_plan_status", args: {}, rationale: "After hang", dependsOn: ["step-1"] },
        ],
      };
      const dispatch = async (step) => {
        if (step.id === "step-1") {
          // Hang beyond timeout — use TIMEOUT_MS + 5s
          await new Promise((r) => setTimeout(r, TIMEOUT_MS + 5000));
          return { ok: true };
        }
        return { ok: true, tool: step.tool };
      };

      const t0 = Date.now();
      const { results, totalDurationMs } = await executePlan(hangingPlan, { dispatch });
      const elapsed = Date.now() - t0;

      // Should complete in roughly TIMEOUT_MS (30s), not TIMEOUT_MS + 5s
      if (elapsed > TIMEOUT_MS + 3000) {
        return `Timeout did not fire: elapsed=${elapsed}ms, expected ≤${TIMEOUT_MS + 3000}ms`;
      }
      // At least one step should have a timeout error
      const timeoutSteps = results.filter((r) => r.error === "timeout" || r.error?.includes("dependency-failed"));
      if (timeoutSteps.length === 0) {
        return `Expected at least one timeout/dep-failed step, got none`;
      }
      return null;
    },
  },
];

// ─── Run load test ───────────────────────────────────────────────────────────

async function runLoadTest() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const latencies = [];
  const memBefore = process.memoryUsage();
  const startTime = Date.now();

  // Build cycle tasks using round-robin scenarios
  const tasks = [];
  for (let i = 0; i < TOTAL_CYCLES; i++) {
    const scenario = scenarios[i % scenarios.length];
    tasks.push(scenario);
  }

  // Process in batches of BATCH_SIZE
  let batches = 0;
  for (let offset = 0; offset < tasks.length; offset += BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + BATCH_SIZE);
    await Promise.all(
      batch.map(async (scenario) => {
        const t0 = Date.now();
        const args = scenario.makePlanArgs();
        const planResult = await plan(args);

        // If planner produced steps, execute them
        if (planResult.steps.length > 0) {
          await executePlan(planResult, { dispatch: mockDispatch });
        }
        latencies.push(Date.now() - t0);
      }),
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

  // ─── Write run JSON ──────────────────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runPath = join(OUT_DIR, `run-${stamp}.json`);
  writeFileSync(runPath, JSON.stringify(runData, null, 2));

  console.log(`[sim-load-38.4] ${TOTAL_CYCLES} plan+execute cycles in ${batches} batches`);
  console.log(`[sim-load-38.4] Latency: p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  mean=${Math.round(meanMs)}ms`);
  console.log(`[sim-load-38.4] Memory: before=${runData.memoryMb.before}MB  after=${runData.memoryMb.after}MB`);
  console.log(`[sim-load-38.4] p95 < 500ms: ${runData.p95Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`[sim-load-38.4] Results → ${runPath}`);

  return { runData, p95 };
}

// ─── Failure injection tests ─────────────────────────────────────────────────

async function runFailureInjection() {
  console.log("\n[sim-load-38.4] Running failure injection scenarios...");
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

// ─── Defect detection (scenario-level) ───────────────────────────────────────

async function detectDefects() {
  let defects = 0;

  // Run each scenario once and verify basic invariants
  for (const scenario of scenarios) {
    try {
      const args = scenario.makePlanArgs();
      const result = await plan(args);

      // Verify skip expectations
      if (scenario.expectedSkip) {
        if (result.skipReason !== scenario.expectedSkip) {
          console.warn(`[defect] ${scenario.name}: expected skip=${scenario.expectedSkip}, got ${result.skipReason}`);
          defects++;
          continue;
        }
      }

      // Verify step cap
      if (result.steps.length > MAX_STEPS) {
        console.warn(`[defect] ${scenario.name}: ${result.steps.length} steps > MAX_STEPS(${MAX_STEPS})`);
        defects++;
        continue;
      }

      // Verify all step tools are in allowedTools
      const allowed = new Set(args.allowedTools);
      for (const s of result.steps) {
        if (!allowed.has(s.tool)) {
          console.warn(`[defect] ${scenario.name}: step ${s.id} uses disallowed tool ${s.tool}`);
          defects++;
        }
      }

      // If steps exist, execute and verify results
      if (result.steps.length > 0) {
        const { results } = await executePlan(result, { dispatch: mockDispatch });
        if (results.length !== result.steps.length) {
          console.warn(`[defect] ${scenario.name}: result count ${results.length} ≠ step count ${result.steps.length}`);
          defects++;
        }
      }
    } catch (err) {
      console.warn(`[defect] ${scenario.name}: CRASH — ${err.message}`);
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
    content = `# Phase-38.4 Slice 5 — Load-Hardening Iterations\n\n${header}\n${sep}\n${row}\n`;
  } else {
    content = readFileSync(ITER_FILE, "utf8");
    if (!content.includes(header)) {
      content = `# Phase-38.4 Slice 5 — Load-Hardening Iterations\n\n${header}\n${sep}\n` + content;
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
      console.log(`[sim-load-38.4] iter ${iter}: 0 defects (${consecutiveClean}/2 clean)`);
      if (consecutiveClean >= 2) {
        console.log("[sim-load-38.4] converged: 2 consecutive zero-defect iterations ✓");
        break;
      }
    } else {
      consecutiveClean = 0;
      console.warn(`[sim-load-38.4] iter ${iter}: ${defectsFound} defect(s) found`);
    }

    iter++;
  }

  if (iter > HARD_CAP && consecutiveClean < 2) {
    console.error(`[sim-load-38.4] ERROR: reached iteration cap (${HARD_CAP}) without converging`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[sim-load-38.4] fatal:", err);
  process.exit(1);
});
