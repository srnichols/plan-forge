#!/usr/bin/env node
/**
 * sim-load-phase-38.7.mjs — Synthetic load harness for quorum dispatcher.
 *
 * Phase-38.7 Slice 5 — exercises dispatchQuorum under load with mocked
 * providers, failure injection, and edge-case coverage.
 *
 * Usage:
 *   node scripts/sim-load-phase-38.7.mjs
 *   node scripts/sim-load-phase-38.7.mjs --validate-converged
 *
 * Flags:
 *   --validate-converged  Read iterations.md and latest run-*.json;
 *                         exit 0 if last 2 iterations have defects_found: 0
 *                         AND p95 < 500 ms. Exit 1 otherwise.
 *   --model=X             Model label to record in iterations.md (default: claude-sonnet-4.6)
 *
 * Output:
 *   .forge/load-sim/38.7/run-<iso>.json    — latency + memory metrics
 *   .forge/load-sim/38.7/iterations.md     — appended iteration row
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dispatchQuorum,
  extractDissent,
  MAX_MODELS,
  TIMEOUT_MS,
} from "../pforge-master/src/quorum-dispatcher.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, ".forge", "load-sim", "38.7");
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

// ─── Mock providers ──────────────────────────────────────────────────────────

function makeProvider(reply, delayMs = 0) {
  return {
    sendTurn: async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return reply;
    },
  };
}

function makeReply(content, tokensIn = 100, tokensOut = 50) {
  return { type: "reply", content, tokensIn, tokensOut };
}

// ─── Fixture generators ──────────────────────────────────────────────────────

function makeFixtureContexts() {
  return [
    // 1. All 3 models succeed, divergent replies
    {
      prompt: "Which auth library?",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
        { model: "grok-4", provider: "xai" },
      ],
      providers: {
        anthropic: makeProvider(makeReply("Use Passport.js for Node authentication, it supports OAuth2 and local strategies with middleware pattern.")),
        openai: makeProvider(makeReply("Use Auth0 for managed authentication, it provides SDKs and handles token management securely.")),
        xai: makeProvider(makeReply("Use NextAuth.js for Next.js apps, it integrates tightly with providers and sessions.")),
      },
    },

    // 2. All 3 models agree (homogeneous replies, dissent should be empty)
    {
      prompt: "Should I use TypeScript?",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
        { model: "grok-4", provider: "xai" },
      ],
      providers: {
        anthropic: makeProvider(makeReply("Yes use TypeScript for type safety and better developer experience with IDE support.")),
        openai: makeProvider(makeReply("Yes use TypeScript for type safety and better developer experience with IDE support.")),
        xai: makeProvider(makeReply("Yes use TypeScript for type safety and better developer experience with IDE support.")),
      },
    },

    // 3. Only 1 model available (others null)
    {
      prompt: "Single model fallback",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "missing1" },
        { model: "grok-4", provider: "missing2" },
      ],
      providers: {
        anthropic: makeProvider(makeReply("Only I responded successfully to this advisory query.")),
      },
    },

    // 4. 2 of 3 models succeed
    {
      prompt: "Partial success scenario",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
        { model: "grok-4", provider: "xai" },
      ],
      providers: {
        anthropic: makeProvider(makeReply("Approach A with repository pattern for data access layer separation.")),
        openai: { sendTurn: async () => { throw new Error("provider error"); } },
        xai: makeProvider(makeReply("Approach B with active record pattern for simpler codebases.")),
      },
    },

    // 5. All models fail
    {
      prompt: "Total failure",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
      ],
      providers: {
        anthropic: { sendTurn: async () => { throw new Error("rate limited"); } },
        openai: { sendTurn: async () => { throw new Error("server error"); } },
      },
    },

    // 6. Empty models array
    {
      prompt: "No models available",
      models: [],
      providers: {},
    },

    // 7. Rate-limited response (should be excluded)
    {
      prompt: "Rate limited model",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
      ],
      providers: {
        anthropic: makeProvider(makeReply("Good answer from working model.")),
        openai: makeProvider({ type: "rate_limited", content: null, tokensIn: 0, tokensOut: 0 }),
      },
    },

    // 8. Single model only
    {
      prompt: "Solo model",
      models: [{ model: "claude-sonnet-4", provider: "anthropic" }],
      providers: {
        anthropic: makeProvider(makeReply("Solo reply with no dissent possible.")),
      },
    },

    // 9. Large token counts (cost calculation edge case)
    {
      prompt: "Heavy token usage",
      models: [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
      ],
      providers: {
        anthropic: makeProvider(makeReply("Detailed analysis with many tokens.", 50000, 25000)),
        openai: makeProvider(makeReply("Another detailed analysis with many tokens.", 50000, 25000)),
      },
    },

    // 10. Models exceed MAX_MODELS cap (5 models, only 3 dispatched)
    {
      prompt: "Exceeds model cap",
      models: Array.from({ length: 5 }, (_, i) => ({
        model: `model-${i}`,
        provider: "anthropic",
      })),
      providers: {
        anthropic: makeProvider(makeReply("Capped response.")),
      },
    },
  ];
}

// ─── Failure injection scenarios ─────────────────────────────────────────────

const failureScenarios = [
  // 1. One model hangs forever — must timeout, return 2/3 results
  {
    name: "failure-one-model-hangs",
    test: async () => {
      const providers = {
        anthropic: makeProvider(makeReply("Fast answer"), 5),
        openai: makeProvider(makeReply("Slow forever"), 60_000), // hangs
        xai: makeProvider(makeReply("Also fast"), 5),
      };
      const deps = {
        selectProvider: async (name) => providers[name] ?? null,
        systemPrompt: "test",
        timeoutMs: 200, // short timeout for test
      };
      const models = [
        { model: "claude-sonnet-4", provider: "anthropic" },
        { model: "gpt-4o", provider: "openai" },
        { model: "grok-4", provider: "xai" },
      ];

      const start = Date.now();
      const result = await dispatchQuorum({ prompt: "test", models, deps });
      const elapsed = Date.now() - start;

      if (result.replies.length !== 2) {
        return `Expected 2 replies (timeout 1), got ${result.replies.length}`;
      }
      if (elapsed > 5000) {
        return `Took ${elapsed}ms — timeout not enforced (should be ~200ms)`;
      }
      return null;
    },
  },

  // 2. All 3 models fail — graceful fallback, not empty/crash
  {
    name: "failure-all-models-fail",
    test: async () => {
      const providers = {
        anthropic: { sendTurn: async () => { throw new Error("fail A"); } },
        openai: { sendTurn: async () => { throw new Error("fail B"); } },
        xai: { sendTurn: async () => { throw new Error("fail C"); } },
      };
      const deps = {
        selectProvider: async (name) => providers[name] ?? null,
        systemPrompt: "test",
        timeoutMs: 5000,
      };
      const models = [
        { model: "m1", provider: "anthropic" },
        { model: "m2", provider: "openai" },
        { model: "m3", provider: "xai" },
      ];

      const result = await dispatchQuorum({ prompt: "test", models, deps });
      if (!result || !Array.isArray(result.replies)) {
        return "Result missing replies array";
      }
      if (result.replies.length !== 0) {
        return `Expected 0 replies, got ${result.replies.length}`;
      }
      if (result.dissent?.topic !== "all-failed") {
        return `Expected dissent.topic='all-failed', got '${result.dissent?.topic}'`;
      }
      return null;
    },
  },

  // 3. Quorum must NOT fire on operational lane (Phase-32 guardrail)
  //    Verify the lane guard exists in reasoning.mjs source code.
  {
    name: "failure-operational-lane-blocked",
    test: async () => {
      try {
        const { readFileSync: rf } = await import("node:fs");
        const { resolve: rp, dirname: dn } = await import("node:path");
        const { fileURLToPath: fu } = await import("node:url");
        const dir = dn(fu(import.meta.url));
        const src = rf(rp(dir, "..", "pforge-master", "src", "reasoning.mjs"), "utf8");

        if (!src.includes("QUORUM_BLOCKED_LANES")) {
          return "reasoning.mjs missing QUORUM_BLOCKED_LANES constant";
        }
        // Verify it references the blocked lane constants (BUILD, OPERATIONAL, TROUBLESHOOT)
        const required = ["BUILD", "OPERATIONAL", "TROUBLESHOOT"];
        for (const lane of required) {
          if (!src.includes(`LANES.${lane}`)) {
            return `reasoning.mjs missing LANES.${lane} in QUORUM_BLOCKED_LANES`;
          }
        }
        // Verify guard is used in the quorum path
        if (!src.includes("QUORUM_BLOCKED_LANES.has")) {
          return "reasoning.mjs missing QUORUM_BLOCKED_LANES.has() guard check";
        }
      } catch (err) {
        return `Failed to verify lane guard: ${err.message}`;
      }
      return null;
    },
  },

  // 4. Cost estimate does not overflow on extreme token counts
  {
    name: "failure-cost-no-overflow",
    test: async () => {
      const providers = {
        anthropic: makeProvider(makeReply("ok", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)),
      };
      const deps = {
        selectProvider: async (name) => providers[name] ?? null,
        systemPrompt: "test",
        timeoutMs: 5000,
      };
      const models = [{ model: "claude-sonnet-4", provider: "anthropic" }];

      const result = await dispatchQuorum({ prompt: "test", models, deps });
      if (result.replies.length !== 1) {
        return `Expected 1 reply, got ${result.replies.length}`;
      }
      const cost = result.replies[0].costUSD;
      if (typeof cost !== "number" || isNaN(cost)) {
        return `costUSD is NaN or not a number: ${cost}`;
      }
      if (!isFinite(cost)) {
        return `costUSD is Infinity: ${cost}`;
      }
      return null;
    },
  },

  // 5. extractDissent with null/undefined/empty inputs
  {
    name: "failure-dissent-edge-cases",
    test: async () => {
      const cases = [null, undefined, [], [{ model: "m1", text: "" }]];
      for (const input of cases) {
        const result = extractDissent(input);
        if (!result || typeof result.topic !== "string" || typeof result.axis !== "string") {
          return `extractDissent(${JSON.stringify(input)}) returned invalid: ${JSON.stringify(result)}`;
        }
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
      batch.map(async (fixture) => {
        const deps = {
          selectProvider: async (name) => fixture.providers[name] ?? null,
          systemPrompt: "You are a helpful assistant.",
          timeoutMs: 5_000,
        };
        const t0 = Date.now();
        await dispatchQuorum({
          prompt: fixture.prompt,
          models: fixture.models,
          deps,
        });
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

  console.log(`[sim-load-38.7] ${TOTAL_CYCLES} quorum dispatch cycles in ${batches} batches`);
  console.log(`[sim-load-38.7] Latency: p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  mean=${Math.round(meanMs)}ms`);
  console.log(`[sim-load-38.7] Memory: before=${runData.memoryMb.before}MB  after=${runData.memoryMb.after}MB`);
  console.log(`[sim-load-38.7] p95 < 500ms: ${runData.p95Pass ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`[sim-load-38.7] Results → ${runPath}`);

  return { runData, p95 };
}

// ─── Failure injection ───────────────────────────────────────────────────────

async function runFailureInjection() {
  console.log("\n[sim-load-38.7] Running failure injection scenarios...");
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
    const fixture = fixtures[i];
    const deps = {
      selectProvider: async (name) => fixture.providers[name] ?? null,
      systemPrompt: "You are a helpful assistant.",
      timeoutMs: 5_000,
    };

    try {
      const result = await dispatchQuorum({
        prompt: fixture.prompt,
        models: fixture.models,
        deps,
      });

      // Basic invariant: result shape
      if (!result || !Array.isArray(result.replies)) {
        console.warn(`[defect] fixture ${i}: result.replies is not array`);
        defects++;
        continue;
      }
      if (!result.dissent || typeof result.dissent.topic !== "string") {
        console.warn(`[defect] fixture ${i}: result.dissent malformed`);
        defects++;
        continue;
      }

      // Verify replies have required fields
      for (const r of result.replies) {
        if (!r.model || typeof r.text !== "string" || typeof r.durationMs !== "number" || typeof r.costUSD !== "number") {
          console.warn(`[defect] fixture ${i}: reply missing required fields: ${JSON.stringify(r)}`);
          defects++;
        }
      }

      // Verify model cap
      if (result.replies.length > MAX_MODELS) {
        console.warn(`[defect] fixture ${i}: replies (${result.replies.length}) exceed MAX_MODELS (${MAX_MODELS})`);
        defects++;
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
    content = `# Phase-38.7 Slice 5 — Load-Hardening Iterations\n\n${header}\n${sep}\n${row}\n`;
  } else {
    content = readFileSync(ITER_FILE, "utf8");
    if (!content.includes(header)) {
      content = `# Phase-38.7 Slice 5 — Load-Hardening Iterations\n\n${header}\n${sep}\n` + content;
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
      // cols: [iter, model, started, duration, defects_found, defects_fixed, p95_ms, mem_peak_mb]
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
      console.log(`[sim-load-38.7] iter ${iter}: 0 defects (${consecutiveClean}/2 clean)`);
      if (consecutiveClean >= 2) {
        console.log("[sim-load-38.7] converged: 2 consecutive zero-defect iterations ✓");
        break;
      }
    } else {
      consecutiveClean = 0;
      console.warn(`[sim-load-38.7] iter ${iter}: ${defectsFound} defect(s) found`);
    }

    iter++;
  }

  if (iter > HARD_CAP && consecutiveClean < 2) {
    console.error(`[sim-load-38.7] ERROR: reached iteration cap (${HARD_CAP}) without converging`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[sim-load-38.7] fatal:", err);
  process.exit(1);
});
