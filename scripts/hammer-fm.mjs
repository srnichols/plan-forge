#!/usr/bin/env node
/**
 * Forge-Master Hammer Harness CLI (Phase-37.2).
 *
 * Runs a named scenario pack against a live Forge-Master dashboard,
 * scores each prompt's SSE output, and writes a JSON + Markdown report.
 *
 * Usage:
 *   node scripts/hammer-fm.mjs --scenario=<name> [options]
 *
 * Flags:
 *   --scenario=<name>     Scenario pack name (required)
 *   --tier=<tier>         keyword-only | low | medium | high | all  (default: keyword-only)
 *   --provider=<name>     Provider hint (informational; server uses its own config)
 *   --base-url=<url>      Dashboard URL (default: http://127.0.0.1:3100)
 *   --out-dir=<path>      Output directory for reports (default: .forge/hammer-forge-master/reports)
 *   --timeout=<sec>       Per-prompt SSE timeout in seconds (default: 60)
 *   --parallel=<n>        Prompt batch size for concurrent execution (default: 4)
 *   --dry-run             Print scenario plan, make no HTTP calls, exit 0
 *
 * Exit codes:
 *   0 — all prompts passed all applicable scorers
 *   1 — one or more prompts failed, or runtime error
 *   2 — cannot reach base URL (connection refused before any prompts run)
 *
 * @module hammer-fm
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openStream } from "./hammer-fm/sse-client.mjs";
import { ALL_SCORERS } from "./hammer-fm/scorers.mjs";
import { render as renderReport } from "./hammer-fm/reporter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);

const DEFAULT_BASE_URL = "http://127.0.0.1:3100";
const DEFAULT_OUT_DIR = ".forge/hammer-forge-master/reports";
const DEFAULT_TIMEOUT_SEC = 60;
const DEFAULT_PARALLEL = 4;
const KNOWN_SCENARIOS = [
  "shipped-prompts",
  "realistic-qa",
  "dial-sweep",
  "phase-38.1-baseline",
];

// ── Arg parser ─────────────────────────────────────────────────────

function _parseArgv(argv) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? "true";
    else if (a === "--help" || a === "-h") args.help = "true";
  }
  return args;
}

function _showHelp() {
  console.log(`
Usage: pforge hammer-fm --scenario=<name> [options]

Scenarios:
  ${KNOWN_SCENARIOS.join(", ")}

Primary flags:
  --scenario=<name>   Scenario pack to run (required)
  --tier=<tier>       keyword-only | low | medium | high | all  (default: keyword-only)
  --provider=<name>   Provider hint passed to the server
  --base-url=<url>    Dashboard URL  (default: http://127.0.0.1:3100)
  --out-dir=<path>    Report output dir  (default: .forge/hammer-forge-master/reports)
  --timeout=<sec>     Per-prompt SSE timeout  (default: 60)
  --parallel=<n>      Concurrent prompt batch size  (default: 4)
  --dry-run           Print plan, no network calls, exit 0

Scenario JSON schema:
  {
    "name": "my-scenario",
    "description": "...",
    "prompts": [
      {
        "id": "unique-id",
        "message": "What is the plan status?",
        "expectedLane": "operational",
        "expectedTools": ["forge_plan_status"],
        "mustContain": ["status"],
        "mustNotContain": ["Unknown tool"],
        "notes": "optional context"
      }
    ]
  }
`.trim());
}

// ── Scenario loader ────────────────────────────────────────────────

/**
 * Load and validate a scenario pack from disk.
 *
 * @param {string} name - Scenario name (without .json)
 * @param {object} [opts]
 * @param {string} [opts.scenariosDir] - Override default scenarios directory
 * @returns {{ scenario: object } | { error: string }}
 */
export function loadScenario(name, { scenariosDir } = {}) {
  const dir = scenariosDir ?? join(__dirname, "hammer-fm", "scenarios");
  const filePath = join(dir, `${name}.json`);

  if (!existsSync(filePath)) {
    return { error: `scenario file not found: ${filePath}` };
  }

  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    return { error: `failed to read ${filePath}: ${err.message}` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { error: `invalid JSON in ${filePath}: ${err.message}` };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: `${filePath} root must be an object` };
  }
  if (!Array.isArray(parsed.prompts)) {
    return { error: `${filePath} missing "prompts" array` };
  }
  if (parsed.prompts.length === 0) {
    return { error: `${filePath} has empty prompts array` };
  }

  const ids = new Set();
  for (const [i, p] of parsed.prompts.entries()) {
    if (!p.id || typeof p.id !== "string") {
      return { error: `prompts[${i}] missing string "id"` };
    }
    if (!p.message || typeof p.message !== "string") {
      return { error: `prompts[${i}] missing string "message"` };
    }
    if (ids.has(p.id)) {
      return { error: `duplicate prompt id: ${p.id}` };
    }
    ids.add(p.id);
  }

  return { scenario: parsed };
}

// ── Tier → request headers mapping ────────────────────────────────

function _tierHeaders(tier) {
  if (tier === "keyword-only") return { "x-pforge-keyword-only": "1" };
  // low/medium/high: server doesn't differentiate tiers over HTTP yet
  return {};
}

// ── Run one prompt against the server ─────────────────────────────

async function _runPrompt(prompt, { baseUrl, tier, timeoutMs, fetchFn, openStreamFn }) {
  const reqHeaders = {
    "content-type": "application/json",
    ..._tierHeaders(tier),
  };
  const start = Date.now();

  let sessionId, streamUrl;
  try {
    const resp = await fetchFn(`${baseUrl}/api/forge-master/chat`, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ message: prompt.message }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const body = await resp.json();
    sessionId = body.sessionId;
    streamUrl = body.streamUrl;
    if (!sessionId || !streamUrl) {
      throw new Error(`bad init response: ${JSON.stringify(body)}`);
    }
  } catch (err) {
    return {
      promptId: prompt.id,
      error: `init: ${err.message}`,
      events: [],
      durationMs: Date.now() - start,
    };
  }

  const { events, closedReason } = await openStreamFn(`${baseUrl}${streamUrl}`, {
    timeoutMs,
    headers: _tierHeaders(tier),
    fetchFn,
  });

  return {
    promptId: prompt.id,
    sessionId,
    events,
    closedReason,
    durationMs: Date.now() - start,
  };
}

// ── Score one prompt result ────────────────────────────────────────

function _scorePrompt(prompt, result, scorers) {
  if (result.error) {
    return { promptId: prompt.id, verdict: "error", error: result.error, scores: [] };
  }
  const scores = scorers.map(({ name, fn }) => {
    try {
      return { scorer: name, ...fn(prompt, result.events) };
    } catch (err) {
      return { scorer: name, pass: false, reason: `scorer threw: ${err.message}`, error: true };
    }
  });
  const failed = scores.filter((s) => !s.pass);
  return {
    promptId: prompt.id,
    verdict: failed.length === 0 ? "pass" : "fail",
    scores,
    events: result.events,
    closedReason: result.closedReason,
    durationMs: result.durationMs,
  };
}

// ── Report writer ──────────────────────────────────────────────────

function _writeReport(records, { outDir, isoStamp, reporter }) {
  const reportDir = join(outDir, isoStamp);
  mkdirSync(reportDir, { recursive: true });

  // Always write JSON first (durable)
  const jsonPath = join(reportDir, "report.json");
  writeFileSync(jsonPath, JSON.stringify(records, null, 2), "utf-8");

  // Markdown: use injected reporter if available, else basic inline
  let md;
  if (reporter) {
    md = reporter.render(records, { isoStamp });
  } else {
    const rows = records.map((r) => {
      const icon = r.verdict === "pass" ? "✅" : r.verdict === "error" ? "🔥" : "❌";
      const lane = r.events?.find((e) => e.event === "classification")?.data?.lane ?? "?";
      const tools = r.events
        ?.filter((e) => e.event === "tool-call")
        .map((e) => e.data?.name || e.data?.tool || "?")
        .join(", ") || "—";
      const dur = r.durationMs != null ? `${r.durationMs}ms` : "—";
      return `| ${r.promptId} | ${lane} | ${tools} | ${dur} | ${r.verdict} ${icon} |`;
    });
    const passed = records.filter((r) => r.verdict === "pass").length;
    md = [
      `# Forge-Master Hammer Report — ${isoStamp}`,
      ``,
      `**Results**: ${passed}/${records.length} passed`,
      ``,
      `| Prompt ID | Lane | Tools Called | Duration | Verdict |`,
      `|-----------|------|-------------|----------|---------|`,
      ...rows,
      ``,
    ].join("\n");
  }

  const mdPath = join(reportDir, "report.md");
  writeFileSync(mdPath, md, "utf-8");
  return { jsonPath, mdPath, reportDir };
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Run the hammer harness.
 *
 * @param {string[]} argv - CLI arguments (without node + script path)
 * @param {object} [deps] - Injectable dependencies for testing
 * @param {Function} [deps.fetchFn] - Injected fetch (default: globalThis.fetch)
 * @param {Function} [deps.openStreamFn] - Injected SSE client (default: openStream)
 * @param {string} [deps.scenariosDir] - Override scenarios directory path
 * @param {object} [deps.reporter] - Optional reporter module with render() method
 * @returns {Promise<number>} Exit code: 0 (pass), 1 (fail/error), 2 (connection error)
 */
export async function main(argv, deps = {}) {
  const args = _parseArgv(argv);

  if (args.help) {
    _showHelp();
    return 0;
  }

  const scenarioName = args.scenario;
  const tier = args.tier || "keyword-only";
  const baseUrl = args["base-url"] || DEFAULT_BASE_URL;
  const parallel = Math.max(1, parseInt(args.parallel || DEFAULT_PARALLEL, 10));
  const timeoutMs = Math.max(5000, parseInt(args.timeout || DEFAULT_TIMEOUT_SEC, 10) * 1000);
  const dryRun = args["dry-run"] === "true";
  const outDirRaw = args["out-dir"] || DEFAULT_OUT_DIR;
  // Resolve relative to repo root unless absolute
  const outDir = outDirRaw.startsWith("/") || outDirRaw.match(/^[A-Za-z]:/)
    ? outDirRaw
    : join(REPO_ROOT, outDirRaw);

  const {
    fetchFn = globalThis.fetch,
    openStreamFn = openStream,
    scenariosDir,
    reporter,
  } = deps;

  if (!scenarioName) {
    console.error("ERROR: --scenario=<name> is required");
    _showHelp();
    return 1;
  }

  // Load and validate scenario
  const loaded = loadScenario(scenarioName, { scenariosDir });
  if (loaded.error) {
    console.error(`ERROR: ${loaded.error}`);
    return 1;
  }
  const { scenario } = loaded;

  // Dry-run: print plan, no network calls
  if (dryRun) {
    console.log(
      `[hammer-fm] DRY RUN — scenario: ${scenario.name || scenarioName} (${scenario.prompts.length} prompts)`,
    );
    console.log(`[hammer-fm] tier=${tier} parallel=${parallel} base-url=${baseUrl}`);
    console.log(`[hammer-fm] prompts:`);
    for (const [i, p] of scenario.prompts.entries()) {
      const lane = p.expectedLane ? ` → ${p.expectedLane}` : "";
      console.log(
        `  ${i + 1}. [${p.id}]${lane}: ${p.message.slice(0, 80).replace(/\n/g, " ")}…`,
      );
    }
    return 0;
  }

  // Preflight: verify server is reachable
  console.log(
    `[hammer-fm] scenario: ${scenario.name || scenarioName} (${scenario.prompts.length} prompts)`,
  );
  console.log(`[hammer-fm] tier=${tier} parallel=${parallel} timeout=${timeoutMs / 1000}s`);

  try {
    const probe = await fetchFn(`${baseUrl}/api/forge-master/capabilities`);
    if (!probe.ok) throw new Error(`server responded ${probe.status}`);
    console.log(`[hammer-fm] server reachable (${baseUrl})`);
  } catch (err) {
    console.error(`[hammer-fm] ERROR: cannot reach ${baseUrl}: ${err.message}`);
    console.error(`[hammer-fm] Start the dashboard with: node pforge-mcp/server.mjs`);
    return 2;
  }

  const isoStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const allRecords = [];

  // Expand tiers for --tier=all
  const tiers = tier === "all" ? ["keyword-only", "low", "medium", "high"] : [tier];

  for (const t of tiers) {
    if (tiers.length > 1) {
      console.log(`\n[hammer-fm] tier: ${t}`);
    }
    const prompts = [...scenario.prompts];
    while (prompts.length > 0) {
      const batch = prompts.splice(0, parallel);
      const results = await Promise.all(
        batch.map((p) => _runPrompt(p, { baseUrl, tier: t, timeoutMs, fetchFn, openStreamFn })),
      );
      for (const [i, result] of results.entries()) {
        const scored = _scorePrompt(batch[i], result, ALL_SCORERS);
        const icon =
          scored.verdict === "pass" ? "✅" : scored.verdict === "error" ? "🔥" : "❌";
        const lane =
          result.events?.find((e) => e.event === "classification")?.data?.lane ?? "?";
        const dur = result.durationMs != null ? `${result.durationMs}ms` : "?";
        console.log(`  ${icon} [${batch[i].id}] lane=${lane} dur=${dur}`);
        if (scored.verdict !== "pass") {
          for (const s of scored.scores.filter((x) => !x.pass)) {
            console.log(`     ↳ ${s.scorer}: ${s.reason}`);
          }
        }
        allRecords.push({ ...scored, tier: t });
      }
    }
  }

  // Write report (use injected reporter or built-in)
  const effectiveReporter = reporter ?? { render: (recs, opts) => renderReport(recs, { ...opts, scenario }) };
  try {
    const { jsonPath, mdPath } = _writeReport(allRecords, { outDir, isoStamp, reporter: effectiveReporter });
    console.log(`\n[hammer-fm] report → ${mdPath}`);
    console.log(`[hammer-fm] json   → ${jsonPath}`);
  } catch (err) {
    console.error(`[hammer-fm] WARNING: failed to write report: ${err.message}`);
  }

  const failed = allRecords.filter((r) => r.verdict !== "pass");
  const passed = allRecords.length - failed.length;
  console.log(`\n[hammer-fm] ${passed}/${allRecords.length} passed`);

  return failed.length === 0 ? 0 : 1;
}

// ── CLI entry point ────────────────────────────────────────────────

if (process.argv[1] === __filename) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[hammer-fm] FATAL: ${err.message}`);
      process.exit(1);
    });
}
