/**
 * Plan Forge — Tempering: foundation (Phase TEMPER-01 Slice 01.1)
 *
 * Read-only test-intelligence subsystem. This slice introduces:
 *   - `.forge/tempering/config.json` with enterprise defaults
 *   - Storage helpers (ensureTemperingDirs, readTemperingConfig)
 *   - Stack detection via presets/
 *   - Coverage-report location + parsing (lcov, coverage-final.json,
 *     cobertura.xml, coverage.py XML, jacoco.xml, go cover.out)
 *   - Gap analysis vs. config minima
 *   - handleScan / handleStatus — pure functions invoked by server.mjs
 *   - readTemperingState — cheap snapshot for watcher + dashboard
 *
 * Mirrors the pattern established by crucible-server.mjs: hub events are
 * emitted by a small `emit` helper; side effects are isolated behind
 * filesystem writes; handlers never throw — callers expect
 * `{ ok, ... } | { ok: false, error, code }` shapes.
 *
 * Forbidden this phase (enforced by scope contract, not by code):
 *   - Running any test framework
 *   - Creating bugs (Bug Registry lands in TEMPER-06)
 *   - Editing production source files
 *   - Extending forge_liveguard_run (TEMPER-06 owns that)
 *
 * @module tempering
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Constants ────────────────────────────────────────────────────────

/**
 * Stale-scan cutoff. Mirrors CRUCIBLE_STALL_CUTOFF_DAYS so all three
 * subsystems (Crucible, Tempering, eventually LiveGuard) use the same
 * "7 days without activity = stale" contract.
 */
export const TEMPERING_SCAN_STALE_DAYS = 7;

/**
 * Enterprise defaults — frozen in this slice, all later phases read from
 * here. Per the TEMPER-ARC cross-cutting contract, these are the "dial
 * down if you must" defaults, not the "dial up to get serious" minima.
 */
export const TEMPERING_DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  coverageMinima: {
    domain: 90,
    integration: 80,
    controller: 60,
    overall: 80,
  },
  runtimeBudgets: {
    unitMaxMs: 120000,
    integrationMaxMs: 300000,
    uiMaxMs: 600000,
  },
  scanners: {
    unit: true,
    integration: true,
    "ui-playwright": true,
    "ui-visual": true,
    "ui-accessibility": true,
    "load-stress": true,
    mutation: true,
    flakiness: true,
    contract: true,
    "performance-budget": true,
  },
  visualAnalyzer: {
    mode: "quorum",
    models: ["claude-opus-4.7", "grok-4.20", "gemini-3-pro-preview"],
    agreement: 2,
  },
  bugRegistry: {
    integration: "github",
    githubRepo: null,
    autoCreateIssues: true,
    labelPrefix: "tempering",
    fallback: "jsonl",
  },
  execution: {
    trigger: "post-slice",
    parallelism: "cpu-count",
    regressionFirst: true,
  },
  stackOverrides: {},
});

/**
 * Coverage-report filenames, in priority order per stack. First match on
 * disk wins. Paths are globs relative to project root.
 */
const COVERAGE_REPORTS = [
  // TypeScript / JavaScript (Jest, Vitest, c8, nyc)
  { name: "lcov", path: "coverage/lcov.info", format: "lcov", stacks: ["typescript"] },
  { name: "coverage-final", path: "coverage/coverage-final.json", format: "istanbul-json", stacks: ["typescript"] },
  // .NET (Coverlet, dotCover)
  { name: "cobertura", path: "coverage/cobertura.xml", format: "cobertura", stacks: ["dotnet"] },
  { name: "cobertura-testresults", path: "TestResults/coverage.cobertura.xml", format: "cobertura", stacks: ["dotnet"] },
  // Python (coverage.py)
  { name: "coverage-py-xml", path: "coverage.xml", format: "cobertura", stacks: ["python"] },
  { name: "coverage-py-json", path: "coverage.json", format: "coverage-py-json", stacks: ["python"] },
  // Java / Kotlin (JaCoCo)
  { name: "jacoco", path: "target/site/jacoco/jacoco.xml", format: "jacoco", stacks: ["java"] },
  { name: "jacoco-build", path: "build/reports/jacoco/test/jacocoTestReport.xml", format: "jacoco", stacks: ["java"] },
  // Go
  { name: "go-cover", path: "coverage.out", format: "go-cover", stacks: ["go"] },
  { name: "go-cover-alt", path: "cover.out", format: "go-cover", stacks: ["go"] },
  // Rust (cargo-tarpaulin, cargo-llvm-cov)
  { name: "tarpaulin", path: "tarpaulin-report.json", format: "tarpaulin", stacks: ["rust"] },
  { name: "rust-lcov", path: "lcov.info", format: "lcov", stacks: ["rust"] },
];

// ─── Directory + config storage ───────────────────────────────────────

/**
 * Ensure `.forge/tempering/` exists. Never overwrites an existing
 * config.json — treating it as "never auto-mutate user intent".
 *
 * @param {string} projectDir
 * @returns {{ dir: string, configPath: string, configWritten: boolean }}
 */
export function ensureTemperingDirs(projectDir) {
  const dir = resolve(projectDir, ".forge", "tempering");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const configPath = resolve(dir, "config.json");
  let configWritten = false;
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify(TEMPERING_DEFAULT_CONFIG, null, 2) + "\n",
      "utf-8",
    );
    configWritten = true;
  }
  return { dir, configPath, configWritten };
}

/**
 * Load config. Never throws — returns baked-in defaults on any error
 * and stamps a `_source` field so callers can distinguish.
 *
 * @param {string} projectDir
 * @returns {object} config (with shallow-merged defaults for any missing keys)
 */
export function readTemperingConfig(projectDir) {
  const configPath = resolve(projectDir, ".forge", "tempering", "config.json");
  if (!existsSync(configPath)) {
    return { ...TEMPERING_DEFAULT_CONFIG, _source: "defaults" };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...TEMPERING_DEFAULT_CONFIG, ...parsed, _source: "file" };
  } catch {
    return { ...TEMPERING_DEFAULT_CONFIG, _source: "defaults-fallback" };
  }
}

// ─── Stack detection ──────────────────────────────────────────────────

/**
 * Detect the project stack by scanning for marker files. Cheap — only
 * `existsSync` calls. Returns one of: typescript, dotnet, python, go,
 * java, rust, or "unknown". Does NOT scan node_modules / .git / vendor.
 *
 * @param {string} projectDir
 * @returns {string} stack id
 */
export function detectStack(projectDir) {
  const has = (p) => existsSync(resolve(projectDir, p));

  // Order matters: dotnet detection before typescript since some .NET
  // projects ship a package.json for tooling. We check .csproj first.
  const dirEntries = (() => {
    try { return readdirSync(projectDir); } catch { return []; }
  })();
  if (dirEntries.some((f) => f.endsWith(".csproj") || f.endsWith(".sln") || f.endsWith(".fsproj"))) {
    return "dotnet";
  }
  if (has("package.json") || has("tsconfig.json")) return "typescript";
  if (has("pyproject.toml") || has("setup.py") || has("setup.cfg") || has("requirements.txt")) {
    return "python";
  }
  if (has("go.mod")) return "go";
  if (has("Cargo.toml")) return "rust";
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) return "java";
  return "unknown";
}

// ─── Coverage report location ─────────────────────────────────────────

/**
 * Find the first existing coverage report matching the stack.
 *
 * @param {string} projectDir
 * @param {string} stack
 * @returns {{ name, path, absPath, format, mtimeMs }|null}
 */
export function locateCoverageReport(projectDir, stack) {
  for (const entry of COVERAGE_REPORTS) {
    if (!entry.stacks.includes(stack)) continue;
    const abs = resolve(projectDir, entry.path);
    if (!existsSync(abs)) continue;
    let mtimeMs = 0;
    try { mtimeMs = statSync(abs).mtimeMs; } catch { /* ignore */ }
    return { name: entry.name, path: entry.path, absPath: abs, format: entry.format, mtimeMs };
  }
  return null;
}

// ─── Coverage parsers ─────────────────────────────────────────────────

/**
 * Parse an lcov.info file into per-file line coverage.
 * Format reference: http://ltp.sourceforge.net/coverage/lcov/geninfo.1.php
 *
 * We only extract what we need for a layer-level roll-up:
 *   - SF:<file>
 *   - LF:<total-lines-instrumented>
 *   - LH:<total-lines-hit>
 *   - end_of_record
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseLcov(content) {
  if (typeof content !== "string" || !content) return [];
  const records = [];
  let current = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("SF:")) {
      current = { file: line.slice(3), linesTotal: 0, linesHit: 0 };
    } else if (current && line.startsWith("LF:")) {
      current.linesTotal = parseInt(line.slice(3), 10) || 0;
    } else if (current && line.startsWith("LH:")) {
      current.linesHit = parseInt(line.slice(3), 10) || 0;
    } else if (line === "end_of_record") {
      if (current) records.push(current);
      current = null;
    }
  }
  return records;
}

/**
 * Parse Istanbul coverage-final.json into per-file line coverage.
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseIstanbulJson(content) {
  try {
    const data = JSON.parse(content);
    const out = [];
    for (const [file, entry] of Object.entries(data)) {
      if (!entry || typeof entry !== "object") continue;
      const statementMap = entry.s || {};
      let total = 0;
      let hit = 0;
      for (const count of Object.values(statementMap)) {
        total++;
        if (typeof count === "number" && count > 0) hit++;
      }
      out.push({ file, linesTotal: total, linesHit: hit });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Parse Cobertura XML (used by .NET Coverlet and coverage.py).
 * Parser is deliberately small — we extract `<class filename="..." line-rate="0.82">`
 * entries with a regex to avoid pulling in an XML dep.
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseCobertura(content) {
  if (typeof content !== "string" || !content) return [];
  const out = [];
  // <class ... filename="..." ... line-rate="0.75" ...> with optional lines-covered / lines-valid
  const classRe = /<class\b([^>]*?)>/g;
  let match;
  while ((match = classRe.exec(content)) !== null) {
    const attrs = match[1];
    const filename = /filename="([^"]+)"/.exec(attrs)?.[1];
    if (!filename) continue;
    const lineRate = parseFloat(/line-rate="([^"]+)"/.exec(attrs)?.[1] || "0");
    const linesValid = parseInt(/lines-valid="([^"]+)"/.exec(attrs)?.[1] || "0", 10);
    const linesCovered = parseInt(/lines-covered="([^"]+)"/.exec(attrs)?.[1] || "0", 10);
    if (linesValid > 0) {
      out.push({ file: filename, linesTotal: linesValid, linesHit: linesCovered });
    } else if (Number.isFinite(lineRate)) {
      // fallback: we don't know the absolute counts, synthesise 100-scale
      out.push({ file: filename, linesTotal: 100, linesHit: Math.round(lineRate * 100) });
    }
  }
  return out;
}

/**
 * Parse JaCoCo XML — one `<counter type="LINE" covered=".." missed=".." />`
 * per `<class>` or per-file.
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseJacoco(content) {
  if (typeof content !== "string" || !content) return [];
  const out = [];
  // <class name="com/foo/Bar" sourcefilename="Bar.java">...<counter type="LINE" missed="5" covered="15"/>
  const classRe = /<class\b([^>]*?)>([\s\S]*?)<\/class>/g;
  let match;
  while ((match = classRe.exec(content)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const sourcefilename = /sourcefilename="([^"]+)"/.exec(attrs)?.[1];
    const className = /name="([^"]+)"/.exec(attrs)?.[1];
    const file = sourcefilename || className || "";
    if (!file) continue;
    const lineCounter = /<counter\s+type="LINE"\s+missed="(\d+)"\s+covered="(\d+)"\s*\/>/.exec(body);
    if (!lineCounter) continue;
    const missed = parseInt(lineCounter[1], 10);
    const covered = parseInt(lineCounter[2], 10);
    out.push({ file, linesTotal: missed + covered, linesHit: covered });
  }
  return out;
}

/**
 * Parse go cover.out (mode: set|count|atomic). Format:
 *   mode: set
 *   path/to/file.go:3.23,5.10 2 1
 *
 * We sum coverage per file using the number of statements in each block
 * (third-to-last column) weighted by hit-count (last column).
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseGoCover(content) {
  if (typeof content !== "string" || !content) return [];
  const perFile = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("mode:")) continue;
    // file.go:3.23,5.10 N C
    const m = /^(.+?):\d+\.\d+,\d+\.\d+\s+(\d+)\s+(\d+)$/.exec(line);
    if (!m) continue;
    const [, file, statementsStr, hitsStr] = m;
    const statements = parseInt(statementsStr, 10);
    const hits = parseInt(hitsStr, 10);
    if (!perFile.has(file)) perFile.set(file, { file, linesTotal: 0, linesHit: 0 });
    const rec = perFile.get(file);
    rec.linesTotal += statements;
    if (hits > 0) rec.linesHit += statements;
  }
  return [...perFile.values()];
}

/**
 * Parse coverage.py JSON format (`coverage json`).
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseCoveragePyJson(content) {
  try {
    const data = JSON.parse(content);
    const files = data.files || {};
    const out = [];
    for (const [file, entry] of Object.entries(files)) {
      const summary = entry?.summary || {};
      out.push({
        file,
        linesTotal: summary.num_statements || 0,
        linesHit: summary.covered_lines || 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Parse tarpaulin JSON (cargo-tarpaulin `--out Json`).
 *
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseTarpaulin(content) {
  try {
    const data = JSON.parse(content);
    const files = data.files || [];
    return files.map((f) => ({
      file: (f.path || []).join("/") || f.file || "",
      linesTotal: f.coverable || 0,
      linesHit: f.covered || 0,
    }));
  } catch {
    return [];
  }
}

/**
 * Dispatch to the right parser for a format id.
 *
 * @param {string} format
 * @param {string} content
 * @returns {Array<{ file, linesTotal, linesHit }>}
 */
export function parseCoverage(format, content) {
  switch (format) {
    case "lcov": return parseLcov(content);
    case "istanbul-json": return parseIstanbulJson(content);
    case "cobertura": return parseCobertura(content);
    case "jacoco": return parseJacoco(content);
    case "go-cover": return parseGoCover(content);
    case "coverage-py-json": return parseCoveragePyJson(content);
    case "tarpaulin": return parseTarpaulin(content);
    default: return [];
  }
}

// ─── Layer classification ─────────────────────────────────────────────

/**
 * Classify a file path into a coverage layer (domain / integration /
 * controller / overall).
 *
 * Heuristic, not config — TEMPER-02 will promote this to a config
 * `layerGlobs` block. For now, we lean on conventional folder names so
 * the first-run experience "just works" on most codebases:
 *
 *   controllers/ routes/ handlers/ api/ endpoints/  → controller
 *   repositories/ repo/ data/ db/ database/ dal/    → integration
 *   services/ domain/ models/ entities/ logic/      → domain
 *   everything else                                 → overall (not double-counted)
 *
 * @param {string} file
 * @returns {"domain" | "integration" | "controller" | "overall"}
 */
export function classifyLayer(file) {
  if (typeof file !== "string" || !file) return "overall";
  const lower = file.toLowerCase().replace(/\\/g, "/");
  // controller-family
  if (/(^|\/)(controllers?|routes?|handlers?|api|endpoints?)(\/|$)/.test(lower)) {
    return "controller";
  }
  // integration-family (data access)
  if (/(^|\/)(repositories?|repo|data|db|database|dal|storage|persistence)(\/|$)/.test(lower)) {
    return "integration";
  }
  // domain-family (business logic)
  if (/(^|\/)(services?|domain|models?|entities?|logic|business|core)(\/|$)/.test(lower)) {
    return "domain";
  }
  return "overall";
}

/**
 * Roll up per-file coverage into per-layer percentages.
 *
 * @param {Array<{ file, linesTotal, linesHit }>} records
 * @returns {{ domain, integration, controller, overall, perFile }}
 */
export function rollupByLayer(records) {
  const agg = {
    domain: { total: 0, hit: 0, files: 0 },
    integration: { total: 0, hit: 0, files: 0 },
    controller: { total: 0, hit: 0, files: 0 },
    overall: { total: 0, hit: 0, files: 0 },
  };
  for (const rec of records) {
    const layer = classifyLayer(rec.file);
    agg[layer].total += rec.linesTotal;
    agg[layer].hit += rec.linesHit;
    agg[layer].files += 1;
    // overall always accumulates
    if (layer !== "overall") {
      agg.overall.total += rec.linesTotal;
      agg.overall.hit += rec.linesHit;
      agg.overall.files += 1;
    } else {
      // already counted in overall
    }
  }
  const pct = (a) => (a.total > 0 ? Math.round((a.hit / a.total) * 10000) / 100 : 0);
  return {
    domain: { percent: pct(agg.domain), ...agg.domain },
    integration: { percent: pct(agg.integration), ...agg.integration },
    controller: { percent: pct(agg.controller), ...agg.controller },
    overall: { percent: pct(agg.overall), ...agg.overall },
  };
}

/**
 * Compute gaps: (minimum - actual) per layer, with the files that pulled
 * each layer below minimum to the top of the list (sorted by lowest
 * coverage first). `records` is the parsed per-file coverage.
 *
 * @param {object} rollup
 * @param {object} coverageMinima
 * @param {Array<{ file, linesTotal, linesHit }>} records
 * @returns {Array<{ layer, minimum, actual, gap, files }>}
 */
export function computeGaps(rollup, coverageMinima, records) {
  const gaps = [];
  for (const layer of ["domain", "integration", "controller", "overall"]) {
    const minimum = coverageMinima?.[layer];
    if (typeof minimum !== "number") continue;
    // Skip layers with no instrumented lines — you can't fail a
    // minimum for code you don't have. TEMPER-02 will revisit this
    // once "missing layer" is itself a reportable signal.
    const layerRollup = rollup[layer];
    if (!layerRollup || layerRollup.total === 0) continue;
    const actual = layerRollup.percent ?? 0;
    if (actual >= minimum) continue;
    const gap = Math.round((minimum - actual) * 100) / 100;
    const layerFiles = (records || [])
      .filter((r) => classifyLayer(r.file) === layer && r.linesTotal > 0)
      .map((r) => ({
        file: r.file,
        percent: Math.round((r.linesHit / r.linesTotal) * 10000) / 100,
        linesTotal: r.linesTotal,
      }))
      .sort((a, b) => a.percent - b.percent)
      .slice(0, 10); // top-10 worst offenders
    gaps.push({ layer, minimum, actual, gap, files: layerFiles });
  }
  return gaps;
}

// ─── Scan-record IO ───────────────────────────────────────────────────

/**
 * List scan-record files by mtime desc. Returns empty array when the
 * directory or files are missing/unreadable.
 *
 * @param {string} projectDir
 * @returns {Array<{ name, absPath, mtimeMs }>}
 */
export function listScanRecords(projectDir) {
  const dir = resolve(projectDir, ".forge", "tempering");
  if (!existsSync(dir)) return [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith("scan-")) continue;
    if (!entry.name.endsWith(".json")) continue;
    const absPath = resolve(dir, entry.name);
    try {
      const mtimeMs = statSync(absPath).mtimeMs;
      out.push({ name: entry.name, absPath, mtimeMs });
    } catch { /* ignore */ }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * Read and parse a single scan record. Returns null on any error.
 *
 * @param {string} absPath
 * @returns {object|null}
 */
export function readScanRecord(absPath) {
  try {
    return JSON.parse(readFileSync(absPath, "utf-8"));
  } catch {
    return null;
  }
}

// ─── Watcher snapshot helper ──────────────────────────────────────────

/**
 * Read the Tempering subsystem state for a watched project. Returns
 * null when `.forge/tempering/` does not exist so callers can cheaply
 * branch — same contract as readCrucibleState.
 *
 * Never throws. Bounded work: walks the tempering dir once, reads at
 * most the latest scan-record, stats remaining files for mtime.
 *
 * @param {string} targetPath - Absolute path to project being watched
 * @returns {object|null}
 */
export function readTemperingState(targetPath) {
  const dir = resolve(targetPath, ".forge", "tempering");
  if (!existsSync(dir)) return null;

  const records = listScanRecords(targetPath);
  const totalScans = records.length;
  const latest = records[0] || null;
  const latestScan = latest ? readScanRecord(latest.absPath) : null;
  const latestScanAgeMs = latest ? Date.now() - latest.mtimeMs : null;

  // Gaps from latest scan (primitives-only for compact WS payloads)
  const latestStatus = latestScan?.status || null;
  const gaps = Array.isArray(latestScan?.coverageVsMinima)
    ? latestScan.coverageVsMinima.length
    : 0;
  const belowMinimum = Array.isArray(latestScan?.coverageVsMinima)
    ? latestScan.coverageVsMinima.filter((g) => g.gap >= 5).length
    : 0;
  const stale = latestScanAgeMs !== null
    ? latestScanAgeMs > TEMPERING_SCAN_STALE_DAYS * 24 * 60 * 60 * 1000
    : false;

  return {
    initialized: true,
    totalScans,
    latestScanTs: latest ? new Date(latest.mtimeMs).toISOString() : null,
    latestScanAgeMs,
    latestStatus,
    gaps,
    belowMinimum,
    stale,
    staleCutoffDays: TEMPERING_SCAN_STALE_DAYS,
  };
}

// ─── Hub event helper ─────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Handlers ─────────────────────────────────────────────────────────

/**
 * forge_tempering_scan — read-only coverage scan.
 *
 * 1. Ensure `.forge/tempering/` exists and config is seeded
 * 2. Detect stack
 * 3. Locate existing coverage report (lcov, cobertura, etc.)
 * 4. Parse it, roll up by layer, compute gaps vs. minima
 * 5. Write `.forge/tempering/scan-<ts>.json`
 * 6. Emit hub events (start + complete)
 *
 * @param {{ projectDir: string, hub?: object, correlationId?: string|null }} opts
 * @returns {object}
 */
export function handleScan({ projectDir, hub = null, correlationId = null }) {
  const corr = correlationId || `temper-scan-${randomUUID()}`;
  const startedAt = new Date().toISOString();

  // Seed dirs + config if first run
  const { dir, configWritten } = ensureTemperingDirs(projectDir);
  const config = readTemperingConfig(projectDir);

  emit(hub, "tempering-scan-started", {
    correlationId: corr,
    projectDir,
    configWritten,
  });

  const stack = detectStack(projectDir);
  const report = stack !== "unknown" ? locateCoverageReport(projectDir, stack) : null;

  let coverageRollup = null;
  let coverageGaps = [];
  let reportFormat = null;
  let reportPath = null;
  let fileCount = 0;
  let status = "green";
  let reason = null;

  if (!report) {
    status = "no-data";
    reason = stack === "unknown"
      ? "Could not detect project stack (no package.json / *.csproj / pyproject.toml / go.mod / Cargo.toml / pom.xml found)."
      : `No coverage report found for ${stack}. Generate one with your test runner's coverage flag (e.g. 'vitest --coverage', 'dotnet test --collect:"XPlat Code Coverage"', 'pytest --cov=. --cov-report=xml').`;
  } else {
    reportFormat = report.format;
    reportPath = report.path;
    let content = "";
    try {
      content = readFileSync(report.absPath, "utf-8");
    } catch (err) {
      status = "error";
      reason = `Failed to read coverage report at ${report.path}: ${err.message}`;
    }
    if (!reason) {
      const records = parseCoverage(report.format, content);
      fileCount = records.length;
      if (records.length === 0) {
        status = "error";
        reason = `Coverage report ${report.path} parsed to zero records (format: ${report.format}). It may be empty or malformed.`;
      } else {
        coverageRollup = rollupByLayer(records);
        coverageGaps = computeGaps(coverageRollup, config.coverageMinima, records);
        if (coverageGaps.some((g) => g.gap >= 5)) {
          status = "amber";
        }
        // No "red" from TEMPER-01 alone — red requires a failing test
        // run which lands in TEMPER-02.
      }
    }
  }

  const scanId = `scan-${startedAt.replace(/[:.]/g, "-")}`;
  const completedAt = new Date().toISOString();
  const scanRecord = {
    scanId,
    correlationId: corr,
    startedAt,
    completedAt,
    stack,
    report: report
      ? { path: reportPath, format: reportFormat, fileCount, mtimeMs: report.mtimeMs }
      : null,
    coverage: coverageRollup,
    coverageVsMinima: coverageGaps,
    status,
    reason,
    phase: "TEMPER-01",
  };

  // Persist the scan record — best-effort, never block the handler
  const outPath = resolve(dir, `${scanId}.json`);
  try {
    writeFileSync(outPath, JSON.stringify(scanRecord, null, 2) + "\n", "utf-8");
  } catch { /* best-effort */ }

  emit(hub, "tempering-scan-completed", {
    correlationId: corr,
    scanId,
    stack,
    status,
    gaps: coverageGaps.length,
    belowMinimum: coverageGaps.filter((g) => g.gap >= 5).length,
    reportPath,
  });

  return {
    ok: status !== "error",
    scanId,
    correlationId: corr,
    stack,
    status,
    reason,
    report: scanRecord.report,
    coverage: coverageRollup,
    coverageVsMinima: coverageGaps,
    scanRecordPath: outPath,
    configWritten,
  };
}

/**
 * forge_tempering_status — latest N scan summaries.
 *
 * @param {{ projectDir: string, limit?: number }} opts
 * @returns {object}
 */
export function handleStatus({ projectDir, limit = 10 }) {
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 10));
  const records = listScanRecords(projectDir).slice(0, safeLimit);
  const summaries = records
    .map((r) => {
      const rec = readScanRecord(r.absPath);
      if (!rec) return null;
      return {
        scanId: rec.scanId,
        correlationId: rec.correlationId || null,
        completedAt: rec.completedAt,
        stack: rec.stack,
        status: rec.status,
        reason: rec.reason || null,
        gaps: Array.isArray(rec.coverageVsMinima) ? rec.coverageVsMinima.length : 0,
        belowMinimum: Array.isArray(rec.coverageVsMinima)
          ? rec.coverageVsMinima.filter((g) => g.gap >= 5).length
          : 0,
        coverage: rec.coverage
          ? {
              domain: rec.coverage.domain?.percent ?? 0,
              integration: rec.coverage.integration?.percent ?? 0,
              controller: rec.coverage.controller?.percent ?? 0,
              overall: rec.coverage.overall?.percent ?? 0,
            }
          : null,
      };
    })
    .filter(Boolean);
  const state = readTemperingState(projectDir);
  return {
    ok: true,
    initialized: state !== null,
    state,
    scans: summaries,
  };
}
