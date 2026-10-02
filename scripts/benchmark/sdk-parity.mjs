#!/usr/bin/env node
/**
 * Copilot SDK vs spawn cost-parity benchmark (#307).
 *
 *   node scripts/benchmark/sdk-parity.mjs [--model gpt-6-luna] [--repeats 1] [--tasks slugify,count-words]
 *        [--max-cost 1.00] [--out <file.json>] [--dry-run]
 *
 * Runs each task in tasks.json twice per repeat, once per worker path, with the
 * same model, each in a fresh copy of fixture/:
 *   spawn  the gh-copilot CLI worker (routing.copilotSdk "off")
 *   sdk    @github/copilot-sdk (routing.copilotSdk "prefer")
 * The order alternates per task so prompt caching does not favour one path.
 * Records tokens, cached tokens, AI-credit cost (cost-service priceSlice), wall time
 * and whether the task's check passed, then prints per-path totals and the cost
 * delta. Stops starting new runs once --max-cost (USD, default 1.00) is spent.
 * Real model calls: this spends Copilot AI credits.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const SUITE = join(HERE, "sdk-parity");
const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_MAX_COST_USD = 1;
const RUN_TIMEOUT_MS = 600_000;
const PERCENT = 100;
const ONE_DECIMAL = 10;
const USD_DIGITS = 4;
const PATH_COLUMN = 5;
export const PATHS = Object.freeze(["spawn", "sdk"]);

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/** Planned runs: every task × repeat, with the path order alternating per task. */
export function planRuns(tasks, repeats) {
  const runs = [];
  tasks.forEach((task, i) => {
    for (let r = 0; r < repeats; r++) {
      const order = (i + r) % 2 === 0 ? PATHS : [...PATHS].reverse();
      for (const path of order) runs.push({ task, path, repeat: r + 1 });
    }
  });
  return runs;
}

/** Per-path totals and the SDK-vs-spawn delta for the recorded runs. */
export function summarize(records) {
  const byPath = Object.fromEntries(PATHS.map((p) => [p, { runs: 0, passed: 0, fellBack: 0, tokensIn: 0, cached: 0, tokensOut: 0, costUsd: 0, wallMs: 0 }]));
  for (const r of records) {
    const t = byPath[r.path];
    t.runs += 1;
    t.passed += r.passed ? 1 : 0;
    t.fellBack += r.fellBack ? 1 : 0;
    t.tokensIn += r.tokensIn;
    t.cached += r.cached;
    t.tokensOut += r.tokensOut;
    t.costUsd += r.costUsd;
    t.wallMs += r.wallMs;
  }
  const { spawn, sdk } = byPath;
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * PERCENT * ONE_DECIMAL) / ONE_DECIMAL : null);
  return {
    byPath,
    // Comparable only when both paths ran the same number of tasks.
    costDeltaPct: spawn.runs === sdk.runs ? pct(sdk.costUsd, spawn.costUsd) : null,
    tokensInDeltaPct: spawn.runs === sdk.runs ? pct(sdk.tokensIn, spawn.tokensIn) : null,
    wallDeltaPct: spawn.runs === sdk.runs ? pct(sdk.wallMs, spawn.wallMs) : null,
  };
}

export function renderSummary({ model, summary, records, stoppedAtUsd }) {
  const row = (p) => {
    const t = summary.byPath[p];
    return `| ${p} | ${t.runs} | ${t.passed}/${t.runs} | ${t.tokensIn.toLocaleString("en-US")} | ${t.cached.toLocaleString("en-US")} | ${t.tokensOut.toLocaleString("en-US")} | $${t.costUsd.toFixed(USD_DIGITS)} | ${(t.wallMs / 1000).toFixed(1)}s |`;
  };
  const delta = (v) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`);
  const lines = [
    `## Copilot SDK vs spawn — ${model}`,
    "",
    "| Path | Runs | Checks passed | Tokens in | Cached | Tokens out | Cost | Wall time |",
    "|---|---|---|---|---|---|---|---|",
    row("spawn"),
    row("sdk"),
    "",
    `SDK vs spawn: cost ${delta(summary.costDeltaPct)}, input tokens ${delta(summary.tokensInDeltaPct)}, wall time ${delta(summary.wallDeltaPct)}.`,
  ];
  if (summary.byPath.sdk.fellBack) lines.push(`Warning: ${summary.byPath.sdk.fellBack} SDK run(s) fell back to spawn; their numbers count as SDK but are not SDK data.`);
  if (stoppedAtUsd != null) lines.push(`Stopped early: the --max-cost budget was reached at $${stoppedAtUsd.toFixed(USD_DIGITS)} after ${records.length} run(s).`);
  return `${lines.join("\n")}\n`;
}

// ─── Running ────────────────────────────────────────────────────────────────

function prepareProject(path) {
  const dir = mkdtempSync(join(tmpdir(), `pf-sdk-parity-${path}-`));
  cpSync(join(SUITE, "fixture"), dir, { recursive: true });
  writeFileSync(join(dir, ".forge.json"), `${JSON.stringify({ routing: { copilotSdk: path === "sdk" ? "prefer" : "off" } }, null, 2)}\n`);
  const git = (...args) => spawnSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=bench", "-c", "user.email=bench@example.invalid", "commit", "-q", "-m", "fixture");
  return dir;
}

/** Token counts from either path's result, with zeros for anything unreported. */
export function readUsage(tokens = {}) {
  return {
    tokensIn: tokens.tokens_in ?? 0,
    cached: tokens.cache_read_tokens ?? tokens.cached ?? 0,
    tokensOut: tokens.tokens_out ?? 0,
    premiumRequests: tokens.premiumRequests ?? null,
    model: tokens.model ?? null,
  };
}

async function runOne({ task, path, repeat }, { model, spawnWorker, priceSlice }) {
  const dir = prepareProject(path);
  const started = Date.now();
  try {
    const result = (await spawnWorker(task.prompt, { model, cwd: dir, worker: path === "spawn" ? "gh-copilot" : null, timeout: RUN_TIMEOUT_MS })) || {};
    const wallMs = Date.now() - started;
    const tokens = result.tokens || {};
    const check = spawnSync(process.execPath, ["--input-type=module", "-e", task.check], { cwd: dir, encoding: "utf8" });
    const priced = priceSlice({ ...tokens, model: tokens.model || model }, result.worker);
    return {
      task: task.id, path, repeat, worker: result.worker || null,
      fellBack: path === "sdk" && result.worker !== "sdk",
      exitCode: result.exitCode,
      passed: check.status === 0,
      ...readUsage(tokens),
      costUsd: priced.cost_usd || 0,
      wallMs,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  return {
    model: opt("--model") ?? DEFAULT_MODEL,
    repeats: Math.max(1, Number(opt("--repeats") ?? 1)),
    taskIds: opt("--tasks")?.split(",").map((s) => s.trim()) ?? null,
    maxCostUsd: Number(opt("--max-cost") ?? DEFAULT_MAX_COST_USD),
    out: opt("--out"),
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = JSON.parse(readFileSync(join(SUITE, "tasks.json"), "utf8")).tasks;
  const tasks = args.taskIds ? all.filter((t) => args.taskIds.includes(t.id)) : all;
  if (tasks.length === 0) throw new Error(`no tasks match ${args.taskIds}`);
  const runs = planRuns(tasks, args.repeats);
  if (args.dryRun) {
    for (const r of runs) console.log(`${r.task.id} #${r.repeat} ${r.path}`);
    console.log(`${runs.length} run(s) with ${args.model}; budget $${args.maxCostUsd.toFixed(2)}`);
    return 0;
  }

  const { spawnWorker, isCopilotServableModel } = await import(pathToFileURL(join(REPO, "pforge-mcp/orchestrator/worker-spawn.mjs")).href);
  const { priceSlice } = await import(pathToFileURL(join(REPO, "pforge-mcp/cost-service.mjs")).href);
  if (!isCopilotServableModel(args.model)) throw new Error(`${args.model} is not Copilot-servable, so the SDK path would never run; pick a gpt-* or Copilot Grok model`);

  const records = [];
  let spent = 0;
  let stoppedAtUsd = null;
  for (const run of runs) {
    if (spent >= args.maxCostUsd) { stoppedAtUsd = spent; break; }
    const rec = await runOne(run, { model: args.model, spawnWorker, priceSlice });
    records.push(rec);
    spent += rec.costUsd;
    console.error(`${rec.task} #${rec.repeat} ${rec.path.padEnd(PATH_COLUMN)} worker=${rec.worker} pass=${rec.passed} in=${rec.tokensIn} cached=${rec.cached} out=${rec.tokensOut} $${rec.costUsd.toFixed(USD_DIGITS)} ${(rec.wallMs / 1000).toFixed(1)}s`);
  }

  const summary = summarize(records);
  const report = { model: args.model, at: new Date().toISOString(), records, summary, stoppedAtUsd };
  const out = args.out ?? join(REPO, ".forge", "benchmarks", `sdk-parity-${report.at.replace(/[:.]/g, "-")}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(renderSummary({ model: args.model, summary, records, stoppedAtUsd }));
  console.log(`Raw results: ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`sdk-parity: ${err.message}`);
    process.exitCode = 2;
  });
}
