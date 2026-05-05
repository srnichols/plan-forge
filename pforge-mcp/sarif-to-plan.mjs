/**
 * Plan Forge — Phase GITHUB-B Slice 6: sarif-to-plan core module.
 *
 * Converts a CodeQL SARIF 2.1.0 result file into a Plan-Forge plan markdown
 * string, one slice per finding, severity-ordered (critical → high → medium → low).
 *
 * Public API:
 *   sarifToPlan(sarifInput, opts?) → string   — pure function, no I/O
 *   SarifError                                — typed error base
 *   NoFindingsError                           — thrown when SARIF has no results (exitCode 1)
 *   ParseError                                — thrown on malformed JSON (exitCode 2)
 *
 * CLI: node sarif-to-plan.mjs <sarif-file|-> [--output <plan-file>]
 *   Exits 0 on success, 1 for no-findings, 2 for parse/arg errors.
 *
 * Separation of concerns:
 *   - sarifToPlan() is pure (no filesystem, no process.exit).
 *   - main() handles all I/O and exit codes.
 *   - CLI dispatch lives at the bottom, guarded behind invokedDirectly.
 *
 * @module sarif-to-plan
 */

import { readFileSync, writeFileSync } from "node:fs";

// ─── Severity helpers ─────────────────────────────────────────────────────────

/** Maps SARIF `level` strings to a numeric score for severity ordering. */
const LEVEL_TO_SCORE = { error: 7, warning: 4, note: 1 };

/**
 * Returns a numeric severity score (0–10) for a result/rule pair.
 * Prefers `properties.securitySeverity` (CodeQL standard), falls back to `level`.
 *
 * @param {object|null} rule   - Rule definition from tool.driver.rules, or null
 * @param {object}      result - SARIF result object
 * @returns {number}
 */
function severityScore(rule, result) {
  const sec = rule?.properties?.securitySeverity;
  if (sec !== undefined && sec !== null) {
    const n = parseFloat(sec);
    if (!isNaN(n)) return n;
  }
  const level = result?.level ?? rule?.defaultConfiguration?.level ?? "warning";
  return LEVEL_TO_SCORE[level] ?? 4;
}

/**
 * @param {number} score
 * @returns {"critical"|"high"|"medium"|"low"}
 */
function scoreToLabel(score) {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class SarifError extends Error {}

/** Thrown when the SARIF document contains no results (exit code 1). */
export class NoFindingsError extends SarifError {
  constructor() {
    super("no findings — SARIF has no results");
    this.exitCode = 1;
  }
}

/** Thrown when the input cannot be parsed as valid JSON (exit code 2). */
export class ParseError extends SarifError {
  constructor(detail) {
    super(`SARIF parse error: ${detail}`);
    this.exitCode = 2;
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse raw SARIF input (string or already-parsed object).
 * @param {string|object} input
 * @returns {object} Parsed SARIF document
 * @throws {ParseError}
 */
function parseSarif(input) {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch (e) {
      throw new ParseError(e.message);
    }
  }
  if (typeof input === "object" && input !== null) return input;
  throw new ParseError("expected string or object");
}

/**
 * Extract structured findings from a SARIF document.
 * Each finding carries the original result, its resolved rule, and a severity score.
 *
 * @param {object} doc - Parsed SARIF document
 * @returns {Array<{result: object, rule: object|null, ruleId: string, score: number}>}
 */
function extractFindings(doc) {
  const runs = doc?.runs;
  if (!Array.isArray(runs) || runs.length === 0) return [];

  const findings = [];
  for (const run of runs) {
    const rules = run?.tool?.driver?.rules ?? [];
    const ruleMap = new Map(rules.map((r) => [r.id, r]));
    const results = run?.results ?? [];

    for (const result of results) {
      const ruleId = result.ruleId ?? result.rule?.id;
      const rule = ruleId != null ? (ruleMap.get(ruleId) ?? null) : null;
      findings.push({
        result,
        rule,
        ruleId: ruleId ?? "(unknown-rule)",
        score: severityScore(rule, result),
      });
    }
  }
  return findings;
}

// ─── Location helpers ─────────────────────────────────────────────────────────

/** @returns {string|null} URI of the first location, or null */
function firstUri(result) {
  return result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? null;
}

/**
 * Collect deduplicated artifact URIs from all result locations.
 * @param {object} result
 * @returns {string[]}
 */
function dedupeLocations(result) {
  const seen = new Set();
  const out = [];
  for (const loc of result?.locations ?? []) {
    const uri = loc?.physicalLocation?.artifactLocation?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      out.push(uri);
    }
  }
  return out;
}

// ─── Plan generator ───────────────────────────────────────────────────────────

/**
 * Convert a SARIF document into a Plan-Forge plan markdown string.
 *
 * @param {string|object} sarifInput  - Raw SARIF JSON string or parsed object.
 * @param {object}        [opts]
 * @param {string}        [opts.source]    - Source file path for front-matter.
 * @param {string}        [opts.planName]  - Override the plan heading name.
 * @returns {string} Plan markdown
 * @throws {NoFindingsError} when SARIF has no results
 * @throws {ParseError}      when JSON is malformed
 */
export function sarifToPlan(sarifInput, opts = {}) {
  const doc = parseSarif(sarifInput);
  const findings = extractFindings(doc);

  if (findings.length === 0) throw new NoFindingsError();

  // Sort: highest severity score first; tie-break by file path (deterministic output)
  findings.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aPath = firstUri(a.result) ?? "";
    const bPath = firstUri(b.result) ?? "";
    return aPath.localeCompare(bPath);
  });

  // Severity histogram
  const hist = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) hist[scoreToLabel(f.score)]++;

  const now = new Date().toISOString();
  const source = opts.source ?? "(unknown)";
  const ts = Date.now();
  const planName = opts.planName ?? `Phase-SARIF-${ts}-REMEDIATION`;

  const lines = [];

  // ─── Front-matter / header ─────────────────────────────────────────────────
  lines.push(`# ${planName}`);
  lines.push("");
  lines.push(`Source: ${source}`);
  lines.push(`Generated: ${now}`);
  lines.push("");
  lines.push("## Severity Summary");
  lines.push("");
  lines.push("| Severity | Count |");
  lines.push("|----------|-------|");
  for (const [sev, count] of Object.entries(hist)) {
    lines.push(`| ${sev} | ${count} |`);
  }
  lines.push("");
  lines.push("## Scope Contract");
  lines.push("");
  lines.push("Remediate all SARIF findings in severity order.");
  lines.push("");

  // ─── One slice per finding ─────────────────────────────────────────────────
  for (let i = 0; i < findings.length; i++) {
    const { result, rule, ruleId, score } = findings[i];
    const sliceNum = i + 1;
    const sevLabel = scoreToLabel(score);
    const msgText = result?.message?.text ?? "(no message)";
    const shortDesc = rule?.shortDescription?.text ?? "(no description)";

    // Location details
    const uris = dedupeLocations(result);
    const firstLoc = result?.locations?.[0]?.physicalLocation;
    const region = firstLoc?.region;
    const regionStr = region ? ` line ${region.startLine ?? "?"}` : "";
    const firstUriStr = firstLoc?.artifactLocation?.uri ?? "(no location in SARIF)";
    const filesInScope = uris.length > 0 ? uris : ["(no location in SARIF)"];

    lines.push(`## Slice ${sliceNum} — [${ruleId}] ${msgText}`);
    lines.push("");
    lines.push(`**Severity**: ${sevLabel} (score: ${score})`);
    lines.push(`**Files in scope**: ${filesInScope.join(", ")}`);
    lines.push(`**Goal**: ${shortDesc} — see ${firstUriStr}${regionStr}`);
    lines.push("**Validation gate**:");
    lines.push("```bash");
    lines.push(`echo "TODO: add validation gate for ${ruleId}"`);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main(argv) {
  let inputPath = null;
  let outputPath = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output" || a === "-o") {
      outputPath = argv[++i];
    } else if (a.startsWith("--output=")) {
      outputPath = a.slice("--output=".length);
    } else if (!a.startsWith("-")) {
      inputPath = a;
    } else {
      process.stderr.write(`sarif-to-plan: unknown argument: ${a}\n`);
      printHelp(process.stderr);
      return 2;
    }
  }

  if (!inputPath) {
    process.stderr.write("sarif-to-plan: missing required argument: <sarif-file|->\n");
    printHelp(process.stderr);
    return 2;
  }

  let raw;
  try {
    // Node.js supports readFileSync(0) to read stdin synchronously (fd 0)
    raw = inputPath === "-" ? readFileSync(0, "utf-8") : readFileSync(inputPath, "utf-8");
  } catch {
    process.stderr.write(`sarif-to-plan: SARIF file not found: ${inputPath}\n`);
    return 2;
  }

  let plan;
  try {
    const source = inputPath === "-" ? "<stdin>" : inputPath;
    plan = sarifToPlan(raw, { source });
  } catch (e) {
    if (e instanceof SarifError) {
      process.stderr.write(`sarif-to-plan: ${e.message}\n`);
      return e.exitCode ?? 1;
    }
    throw e;
  }

  if (outputPath) {
    writeFileSync(outputPath, plan, "utf-8");
    process.stdout.write(`sarif-to-plan: plan written to ${outputPath}\n`);
  } else {
    process.stdout.write(plan + "\n");
  }
  return 0;
}

function printHelp(stream = process.stdout) {
  stream.write(
    `Usage: node sarif-to-plan.mjs <sarif-file|-> [--output <plan-file>]

Convert a CodeQL SARIF result file into a Plan-Forge plan markdown.

Arguments:
  <sarif-file>         Path to SARIF JSON file, or '-' to read from stdin
  --output, -o <file>  Write plan to this file (default: stdout)

Exit codes:
  0   plan generated successfully
  1   SARIF has no findings
  2   invalid arguments or SARIF parse error
`
  );
}

// Run CLI when invoked directly (not when imported as a module).
const entryPath = typeof process.argv[1] === "string" ? process.argv[1] : "";
const invokedDirectly =
  entryPath.length > 0 &&
  (import.meta.url === `file://${entryPath.replace(/\\/g, "/")}` ||
    import.meta.url.endsWith(entryPath.replace(/\\/g, "/")));

if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
