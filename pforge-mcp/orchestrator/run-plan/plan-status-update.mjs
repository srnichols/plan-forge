/** Plan Forge — Issue #212: rewrite plan-file status header after a successful run */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

/**
 * Patterns that identify a HARDENED status line inside YAML frontmatter.
 * Matches the exact key regardless of surrounding whitespace.
 */
const YAML_HARDENED_RE = /^(status:\s*)HARDENED(\s*)$/m;

/**
 * Matches the first `> **Status**: **HARDENED…` quote-header line in the plan
 * body (outside frontmatter). Case-sensitive to avoid false positives.
 */
const QUOTE_HARDENED_RE = /^(>\s*\*\*Status\*\*:\s*\*\*)HARDENED[^*]*/m;

/**
 * Read the VERSION file from `cwd` and return a string like `v3.18.1`.
 * Returns `null` when the file is absent or unreadable.
 *
 * @param {string} cwd
 * @returns {string|null}
 */
function _readVersionFromFile(cwd) {
  try {
    const versionPath = resolve(cwd, "VERSION");
    if (!existsSync(versionPath)) return null;
    const raw = readFileSync(versionPath, "utf-8").trim();
    return raw.length > 0 ? (raw.startsWith("v") ? raw : `v${raw}`) : null;
  } catch {
    return null;
  }
}

/**
 * Build the replacement quote-header line for a completed plan:
 *   `> **Status**: **✅ Complete — shipped YYYY-MM-DD (vX.Y.Z).** …`
 *
 * @param {string} isoDate - ISO date string, e.g. "2026-05-21T16:54:04.386Z"
 * @param {string|null} version - version tag, e.g. "v3.18.1-dev" or null
 * @returns {string}
 */
function _buildCompleteStatusLine(isoDate, version) {
  const datePart = isoDate.slice(0, 10); // YYYY-MM-DD
  const versionPart = version ? ` (${version})` : "";
  return `> **Status**: **✅ Complete — shipped ${datePart}${versionPart}.** See \`## What actually shipped\` section below.`;
}

/**
 * Atomically rewrite the plan-file status block after a successful run.
 *
 * Rewrites two locations in the plan file (if found):
 *   1. YAML frontmatter: `status: HARDENED` → `status: COMPLETE`
 *   2. First quote-header matching `> **Status**: **HARDENED…`
 *      → `> **Status**: **✅ Complete — shipped <date> (version).**`
 *
 * Idempotent — if the file already has `status: COMPLETE` or no HARDENED
 * markers are present, the file is left untouched.
 *
 * Non-blocking — any error is silently suppressed so a rewrite failure
 * never prevents the run from completing.
 *
 * @param {object} args
 * @param {string}      args.planPath   - absolute or cwd-relative path to the plan file
 * @param {string}      args.cwd        - working directory for relative path resolution
 * @param {string}      [args.shippedAt] - ISO timestamp override (default: now)
 * @param {string|null} [args.version]   - version string override (default: read VERSION)
 */
export function rewritePlanStatusOnSuccess({ planPath, cwd, shippedAt, version } = {}) {
  if (!planPath) return;
  try {
    const absPath = isAbsolute(planPath) ? planPath : resolve(cwd || process.cwd(), planPath);
    if (!existsSync(absPath)) return;

    const original = readFileSync(absPath, "utf-8");

    // Nothing to do if the file doesn't have a HARDENED marker anywhere.
    if (!YAML_HARDENED_RE.test(original) && !QUOTE_HARDENED_RE.test(original)) return;

    const isoDate = typeof shippedAt === "string" && shippedAt.length > 0
      ? shippedAt
      : new Date().toISOString();
    const ver = typeof version === "string" && version.length > 0
      ? version
      : _readVersionFromFile(cwd || process.cwd());

    let updated = original;

    // 1. Rewrite YAML frontmatter status field.
    updated = updated.replace(YAML_HARDENED_RE, (_, prefix, suffix) => `${prefix}COMPLETE${suffix}`);

    // 2. Rewrite first quote-header status line.
    const completeLine = _buildCompleteStatusLine(isoDate, ver);
    updated = updated.replace(QUOTE_HARDENED_RE, completeLine);

    if (updated === original) return; // no change — already correct, skip write
    writeFileSync(absPath, updated, "utf-8");
  } catch {
    // Never block the run on a rewrite failure.
  }
}
