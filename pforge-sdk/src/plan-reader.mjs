/**
 * plan-reader.mjs — Offline utilities for reading Plan Forge plan files.
 *
 * Parses hardened plan Markdown files into structured summaries. Useful for
 * CI scripts, external dashboards, or any tool that needs to inspect plan
 * status and slice structure without a running MCP server.
 *
 * Zero runtime dependencies beyond `node:fs` and `node:path`.
 *
 * Supported plan file layout:
 *   ---
 *   phase: 55
 *   name: CLEAN-CODE-SWEEP
 *   status: HARDENED
 *   lockHash: <sha256>
 *   ---
 *   # Phase 55 — CLEAN-CODE-SWEEP — <description>
 *   > **Status**: HARDENED — cleared for execution ...
 *   ## Execution Hold
 *   - [ ] or [x] hold items
 *   ### Slice 1: Title
 *   ### Slice 2 — Title [depends: Slice 1]
 *
 * @module plan-reader
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default directory (relative to cwd) where plan files live.
 * @type {string}
 */
export const PLANS_DIR_RELATIVE = join('docs', 'plans');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** @param {{ cwd?: string }} [opts] */
function rootOf(opts) {
  return opts?.cwd ?? process.cwd();
}

/**
 * Try to read a UTF-8 file. Returns null if the file does not exist.
 * @param {string} filePath
 * @returns {string|null}
 */
function tryReadFile(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

/**
 * Parse YAML-lite frontmatter from a plan file.
 * Supports single-level key: value pairs; does not handle nested YAML.
 * @param {string} content
 * @returns {Record<string,string>}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    let value = kv[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[kv[1]] = value;
  }
  return result;
}

/**
 * Extract the plan title from the first `# ` heading.
 * Returns null if no heading found.
 * @param {string[]} lines
 * @returns {string|null}
 */
function parseTitle(lines) {
  for (const line of lines) {
    if (line.startsWith('# ')) return line.slice(2).trim();
  }
  return null;
}

/**
 * Extract the status line from the first `> **Status**:` blockquote.
 * Returns null if not found.
 * @param {string[]} lines
 * @returns {string|null}
 */
function parseStatusLine(lines) {
  for (const line of lines) {
    const m = line.match(/^>\s*\*\*Status\*\*:\s*(.*)/);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * Derive a short canonical status token from the full status line.
 *
 * Examples:
 *   "✅ Complete. All 12 slices shipped." → "complete"
 *   "HARDENED — cleared for execution 2026-05-19" → "hardened"
 *   "📋 Planned (DRAFT — Step-2 harden required)" → "draft"
 *   "🚧 In Progress (slices executing)" → "in-progress"
 *   "⏸️ Paused / Blocked" → "paused"
 *
 * @param {string|null} statusLine
 * @returns {string}
 */
function deriveStatus(statusLine) {
  if (!statusLine) return 'unknown';
  const upper = statusLine.toUpperCase();
  if (upper.includes('COMPLETE') || upper.includes('✅')) return 'complete';
  if (upper.includes('HARDENED')) return 'hardened';
  if (upper.includes('IN PROGRESS') || upper.includes('🚧')) return 'in-progress';
  if (upper.includes('PAUSED') || upper.includes('BLOCKED') || upper.includes('⏸')) return 'paused';
  if (upper.includes('DRAFT') || upper.includes('📋') || upper.includes('PLANNED')) return 'draft';
  return 'unknown';
}

/**
 * Parse the execution-hold section: return true if any checkbox is unchecked.
 * @param {string[]} lines
 * @returns {boolean}
 */
function parseExecutionHold(lines) {
  let inHoldSection = false;
  let hasAnyHold = false;
  let hasOpenHold = false;
  for (const line of lines) {
    if (/^##\s+Execution Hold/i.test(line)) {
      inHoldSection = true;
      continue;
    }
    if (inHoldSection && /^##\s/.test(line)) break;
    if (!inHoldSection) continue;
    const unchecked = line.match(/^\s*-\s*\[\s*\]/);
    const checked = line.match(/^\s*-\s*\[x\]/i);
    if (unchecked) { hasAnyHold = true; hasOpenHold = true; }
    if (checked) { hasAnyHold = true; }
  }
  return hasAnyHold && hasOpenHold;
}

/**
 * Parse all slice headers from a plan.
 *
 * Recognises:
 *   ### Slice 1: Title
 *   ### Slice 12.1 — Title
 *   ### Slice N: Title [depends: Slice 1] [P] [scope: src/**]
 *
 * @param {string[]} lines
 * @returns {SliceSummary[]}
 */
function parseSlices(lines) {
  const slices = [];
  const sliceHeading = /^###\s+Slice\s+([\d.]+)\s*[:\u2014-]\s*(.+)/i;
  for (const line of lines) {
    const m = line.match(sliceHeading);
    if (!m) continue;
    const rawTitle = m[2];
    // Strip metadata annotations like [depends: Slice 1], [P], [scope: ...]
    const title = rawTitle.replace(/\[.*?\]/g, '').trim();
    const depMatch = rawTitle.match(/\[depends?:\s*([^\]]+)\]/i);
    const dependencies = depMatch
      ? depMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      : [];
    slices.push({
      number: parseFloat(m[1]),
      title,
      dependencies,
    });
  }
  return slices;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SliceSummary
 * @property {number} number - Slice number (e.g. 1, 2.1)
 * @property {string} title - Slice title (annotations stripped)
 * @property {string[]} dependencies - Slice dependency labels (e.g. ["Slice 1"])
 */

/**
 * @typedef {Object} PlanSummary
 * @property {string} planPath - Resolved absolute path to the plan file
 * @property {string|null} title - Full title from the `# ` heading
 * @property {string|null} statusLine - Raw status blockquote text
 * @property {string} status - Canonical status token: "complete"|"hardened"|"in-progress"|"paused"|"draft"|"unknown"
 * @property {boolean} executionHold - True if any `- [ ]` checkbox remains in the Execution Hold section
 * @property {SliceSummary[]} slices - Ordered slice summaries
 * @property {Record<string,string>} frontmatter - Parsed YAML frontmatter fields
 */

/**
 * Absolute path to the plans directory.
 * @param {{ cwd?: string }} [opts]
 * @returns {string}
 */
export function plansDir(opts) {
  return resolve(rootOf(opts), PLANS_DIR_RELATIVE);
}

/**
 * List all `*-PLAN.md` files in `docs/plans/` (non-recursive).
 * Returns relative paths from `cwd`. Returns `[]` if the directory does not exist.
 * @param {{ cwd?: string }} [opts]
 * @returns {string[]}
 */
export function listPlans(opts) {
  const dir = plansDir(opts);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('-PLAN.md') || f.endsWith('-plan.md'))
    .sort()
    .map((f) => join(PLANS_DIR_RELATIVE, f));
}

/**
 * Parse a plan file into a structured summary.
 * Returns `null` if the file does not exist.
 * @param {{ planPath: string, cwd?: string }} opts
 * @returns {PlanSummary|null}
 */
export function readPlan({ planPath, cwd } = {}) {
  const root = rootOf({ cwd });
  const resolved = resolve(root, planPath);
  const content = tryReadFile(resolved);
  if (content == null) return null;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const frontmatter = parseFrontmatter(content);
  const title = parseTitle(lines);
  const statusLine = parseStatusLine(lines);
  const status = deriveStatus(statusLine);
  const executionHold = parseExecutionHold(lines);
  const slices = parseSlices(lines);
  return {
    planPath: resolved,
    title,
    statusLine,
    status,
    executionHold,
    slices,
    frontmatter,
  };
}

/**
 * Return only the canonical status token for a plan file.
 * Returns `null` if the file does not exist.
 * @param {{ planPath: string, cwd?: string }} opts
 * @returns {string|null}
 */
export function getPlanStatus({ planPath, cwd } = {}) {
  const plan = readPlan({ planPath, cwd });
  return plan ? plan.status : null;
}

/**
 * Return only the slice list for a plan file.
 * Returns `null` if the file does not exist.
 * @param {{ planPath: string, cwd?: string }} opts
 * @returns {SliceSummary[]|null}
 */
export function getPlanSlices({ planPath, cwd } = {}) {
  const plan = readPlan({ planPath, cwd });
  return plan ? plan.slices : null;
}
