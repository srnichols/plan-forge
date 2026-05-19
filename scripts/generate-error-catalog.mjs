#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DOC_PATH = resolve(ROOT, "docs", "manual", "errors-and-exit-codes.html");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkMode = args.includes("--check");

const { ERROR_CODES } = await import(pathToFileURL(resolve(ROOT, "pforge-mcp", "enums.mjs")));

const ORIGIN_BY_CODE = Object.freeze({
  ASK_QUESTION_MISMATCH: "Crucible",
  CRITICAL_FIELDS_MISSING: "Crucible finalize",
  DRIFT_DETECTED: "PreToolUse hook",
  ERR_UPDATE_DURING_RUN: "REST 409",
  GATE_COMMAND_FAILED: "Orchestrator",
  NO_API_KEY: "Provider tools",
  NO_REASONING_MODEL: "Forge-Master",
  PLAN_ALREADY_EXISTS: "Crucible finalize",
  PLAN_NOT_FOUND: "forge_run_plan",
  PLAN_PARSE_ERROR: "forge_validate",
  QUORUM_ALL_FAILED: "Quorum mode",
  RATE_LIMITED: "REST 429",
  REVIEW_REJECTED: "Review Gate",
  SCOPE_VIOLATION: "PreToolUse hook",
  STRICT_GATES_REJECTED: "Orchestrator",
  WORKER_TIMEOUT: "Orchestrator",
  "auditor-spawn-failed": "Orchestrator / PostRun hook",
  "observer-budget-exceeded": "Observer daemon",
  "diff-classify-blocked": "forge_diff_classify / PreCommit chain",
  "lock-hash-mismatch": "Orchestrator / PreCommit chain",
  "network-allowlist-violation": "Orchestrator",
  "tool-denied": "Orchestrator",
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const rows = Object.values(ERROR_CODES)
  .filter((entry) => Object.prototype.hasOwnProperty.call(ORIGIN_BY_CODE, entry.code))
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((entry) => `            <tr><td><code>${escapeHtml(entry.code)}</code></td><td>${escapeHtml(ORIGIN_BY_CODE[entry.code])}</td><td>${escapeHtml(entry.remediation)}</td></tr>`)
  .join("\n");

const raw = readFileSync(DOC_PATH, "utf-8");
const useCRLF = raw.includes("\r\n");
const normalized = useCRLF ? raw.replace(/\r\n/g, "\n") : raw;
const tbodyRegex = /(<h2 id="named-error-catalog">[\s\S]*?<table class="manual-table">\s*<thead><tr><th style="width: 18rem">Code<\/th><th>Origin<\/th><th>Cause &amp; fix<\/th><\/tr><\/thead>\s*<tbody>)([\s\S]*?)(\s*<\/tbody>\s*<\/table>)/;

if (!tbodyRegex.test(normalized)) {
  process.stderr.write("[generate-error-catalog] Could not find named-error-catalog table.\n");
  process.exit(1);
}

const updatedNormalized = normalized.replace(tbodyRegex, `$1\n${rows}$3`);
const changed = updatedNormalized !== normalized;

if (dryRun) {
  process.stdout.write(`${rows}\n`);
  if (!changed) process.stdout.write("[generate-error-catalog] no changes needed\n");
} else if (checkMode) {
  if (changed) {
    process.stderr.write("[generate-error-catalog] DRIFT DETECTED: docs/manual/errors-and-exit-codes.html is out of sync with pforge-mcp/enums.mjs ERROR_CODES.\nRun: node scripts/generate-error-catalog.mjs\n");
    process.exit(1);
  }
  process.stdout.write("[generate-error-catalog] docs/manual/errors-and-exit-codes.html is in sync\n");
} else if (changed) {
  const output = useCRLF ? updatedNormalized.replace(/\n/g, "\r\n") : updatedNormalized;
  writeFileSync(DOC_PATH, output, "utf-8");
  process.stdout.write(`[generate-error-catalog] updated ${DOC_PATH}\n`);
} else {
  process.stdout.write("[generate-error-catalog] no changes needed\n");
}
