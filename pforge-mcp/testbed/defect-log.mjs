/**
 * Plan Forge — Testbed Defect Log
 *
 * Phase TESTBED-01 Slice 01
 *
 * Writes, reads, and updates defect findings produced by testbed
 * scenario runs. Findings are stored as individual JSON files under
 * `docs/plans/testbed-findings/`.
 *
 * @module testbed/defect-log
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

// ─── Frozen Enums ─────────────────────────────────────────────────────
export const SEVERITY_VALUES = Object.freeze(["blocker", "high", "medium", "low", "polish"]);
export const SURFACE_VALUES  = Object.freeze(["crucible", "forge-exec", "tempering", "liveguard", "forge-shop", "cli", "docs"]);
export const STATUS_VALUES   = Object.freeze(["open", "fixed", "wontfix", "duplicate"]);
export const OWNER_ARC_VALUES = Object.freeze(["TEMPER", "FORGE-SHOP", "TESTBED", "AUTO-UPDATE", "MANUAL"]);

// ─── Redaction ────────────────────────────────────────────────────────
const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36,}/g,
  /gho_[A-Za-z0-9]{36,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._\-]{20,}/gi,
  /xai-[A-Za-z0-9]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
];

function redact(text) {
  if (typeof text !== "string") return text;
  let result = text;
  for (const pat of SECRET_PATTERNS) {
    result = result.replace(pat, "[REDACTED]");
  }
  return result;
}

function redactObject(obj) {
  if (typeof obj === "string") return redact(obj);
  if (Array.isArray(obj)) return obj.map(redactObject);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = redactObject(v);
    return out;
  }
  return obj;
}

// ─── Slug ─────────────────────────────────────────────────────────────
export function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ─── Validation ───────────────────────────────────────────────────────
export function validateFinding(finding) {
  const errors = [];
  const required = ["findingId", "date", "scenario", "severity", "surface", "title", "expected", "observed", "status"];
  for (const field of required) {
    if (!finding[field]) errors.push(`missing required field: ${field}`);
  }
  if (finding.severity && !SEVERITY_VALUES.includes(finding.severity)) {
    errors.push(`invalid severity '${finding.severity}'; expected one of: ${SEVERITY_VALUES.join(", ")}`);
  }
  if (finding.surface && !SURFACE_VALUES.includes(finding.surface)) {
    errors.push(`invalid surface '${finding.surface}'; expected one of: ${SURFACE_VALUES.join(", ")}`);
  }
  if (finding.status && !STATUS_VALUES.includes(finding.status)) {
    errors.push(`invalid status '${finding.status}'; expected one of: ${STATUS_VALUES.join(", ")}`);
  }
  return { ok: errors.length === 0, errors };
}

// ─── Finding Directory ────────────────────────────────────────────────
function findingsDir(projectRoot) {
  return resolve(projectRoot, "docs", "plans", "testbed-findings");
}

function ensureFindingsDir(projectRoot) {
  const dir = findingsDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function findExistingByFindingId(dir, findingId) {
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir).filter(n => n.endsWith(".json"))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      if (data.findingId === findingId) return f;
    } catch { /* skip malformed */ }
  }
  return null;
}

function resolveFilename(dir, slug) {
  let candidate = `${slug}.json`;
  if (!existsSync(join(dir, candidate))) return candidate;
  let i = 2;
  while (existsSync(join(dir, `${slug}-${i}.json`))) i++;
  return `${slug}-${i}.json`;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Write a finding to the testbed-findings directory.
 * Idempotent by findingId — re-logging the same ID overwrites the file.
 */
export function logFinding(finding, { hub, projectRoot }) {
  const validation = validateFinding(finding);
  if (!validation.ok) {
    const err = new Error(`Invalid finding: ${validation.errors.join("; ")}`);
    err.code = "ERR_INVALID_FINDING";
    throw err;
  }

  const sanitized = { ...finding };
  sanitized.observed = redactObject(sanitized.observed);
  if (sanitized.artefacts) sanitized.artefacts = redactObject(sanitized.artefacts);

  const dir = ensureFindingsDir(projectRoot);
  const existing = findExistingByFindingId(dir, finding.findingId);
  const slug = `${finding.date}-${toSlug(finding.title)}`;
  const filename = existing || resolveFilename(dir, slug);

  writeFileSync(join(dir, filename), JSON.stringify(sanitized, null, 2), "utf-8");

  hub?.broadcast({ type: "testbed-finding-logged", data: { findingId: finding.findingId, severity: finding.severity, surface: finding.surface, title: finding.title, filename } });

  return { ok: true, filename, path: join(dir, filename) };
}

/**
 * List findings, optionally filtered by status, severity, and date.
 */
export function listFindings({ status, severity, since } = {}, { projectRoot }) {
  const dir = findingsDir(projectRoot);
  if (!existsSync(dir)) return [];

  const results = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith(".json"))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      if (status && data.status !== status) continue;
      if (severity && data.severity !== severity) continue;
      if (since && data.date < since) continue;
      results.push({ ...data, _filename: f });
    } catch {
      console.warn(`[testbed] skipping malformed finding: ${f}`);
    }
  }

  return results.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

/**
 * Update a finding's status. Validates transition (open → fixed|wontfix|duplicate).
 */
export function updateFindingStatus(findingId, status, linkedPlanForgeIssue, { projectRoot }) {
  if (!STATUS_VALUES.includes(status)) {
    const err = new Error(`Invalid status '${status}'`);
    err.code = "ERR_INVALID_STATUS";
    throw err;
  }

  const dir = findingsDir(projectRoot);
  const filename = findExistingByFindingId(dir, findingId);
  if (!filename) {
    const err = new Error(`Finding not found: ${findingId}`);
    err.code = "ERR_FINDING_NOT_FOUND";
    throw err;
  }

  const filepath = join(dir, filename);
  const data = JSON.parse(readFileSync(filepath, "utf-8"));

  // Idempotent — same status is a no-op
  if (data.status === status) return { ok: true, noop: true };

  data.status = status;
  if (linkedPlanForgeIssue) data.linkedPlanForgeIssue = linkedPlanForgeIssue;

  writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
  return { ok: true, noop: false };
}
