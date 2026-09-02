/** Plan Forge — Issue #212: rewrite plan-file status header after a successful run */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";

/**
 * Patterns that identify a HARDENED status line inside YAML frontmatter.
 * Case-insensitive because the corpus carries both `HARDENED` and `hardened`,
 * and trailing prose is allowed because the hardener prompt documents
 * `status: HARDENED — awaiting Execution Hold lift`.
 */
const YAML_HARDENED_RE = /^(status:[ \t]*)HARDENED\b.*$/im;

/**
 * Matches the first hardened status quote-header in the plan body.
 *
 * `HARDENED` must be the first *word* of the status value, after an optional
 * bold marker and an optional run of symbols (the corpus uses 🟡 and 🟢).
 * Anchoring on the first word is what keeps `STUB — not yet hardened` and
 * `Drafted, awaiting hardening (Step 2)` — both real, both meaning the
 * opposite — from being rewritten to Complete (issue #255).
 *
 * The match runs to end of line so the replacement consumes any trailing
 * bold-close; the previous `[^*]*` form stopped at the first `*` and left an
 * orphaned `**` behind.
 */
const QUOTE_HARDENED_RE = /^(>[ \t]*\*\*Status\*\*:[ \t]*)(?:\*\*[ \t]*)?(?:[^\w\s][ \t]*)*HARDENED\b.*$/im;

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
 *   2. First quote-header whose status value begins with HARDENED
 *      → `> **Status**: **✅ Complete — shipped <date> (version).**`
 *
 * Idempotent — if the file already has `status: COMPLETE` or no HARDENED
 * markers are present, the file is left untouched.
 *
 * Non-blocking — any error is silently suppressed so a rewrite failure
 * never prevents the run from completing. The return value is how a caller
 * tells "already complete" from "found a status line I did not recognise":
 * those were indistinguishable, so a rewriter that had gone dark for a whole
 * status shape still reported success (issue #255).
 *
 * @param {object} args
 * @param {string}      args.planPath   - absolute or cwd-relative path to the plan file
 * @param {string}      args.cwd        - working directory for relative path resolution
 * @param {string}      [args.shippedAt] - ISO timestamp override (default: now)
 * @param {string|null} [args.version]   - version string override (default: read VERSION)
 * @returns {{ rewrote: boolean, reason: string, yaml?: boolean, quote?: boolean, statusLine?: string }}
 */
export function rewritePlanStatusOnSuccess({ planPath, cwd, shippedAt, version } = {}) {
  if (!planPath) return { rewrote: false, reason: "no-plan-path" };
  try {
    const absPath = isAbsolute(planPath) ? planPath : resolve(cwd || process.cwd(), planPath);
    if (!existsSync(absPath)) return { rewrote: false, reason: "file-missing" };

    const original = readFileSync(absPath, "utf-8");
    const yamlHit = YAML_HARDENED_RE.test(original);
    const quoteHit = QUOTE_HARDENED_RE.test(original);

    // Nothing to do if the file doesn't have a HARDENED marker anywhere. Carry
    // the status line we DID find so an unrecognised shape is diagnosable.
    if (!yamlHit && !quoteHit) {
      const found = original.match(/^>[ \t]*\*\*Status\*\*:.*$/m);
      return {
        rewrote: false,
        reason: "no-hardened-marker",
        ...(found ? { statusLine: found[0].trim() } : {}),
      };
    }

    const isoDate = typeof shippedAt === "string" && shippedAt.length > 0
      ? shippedAt
      : new Date().toISOString();
    const ver = typeof version === "string" && version.length > 0
      ? version
      : _readVersionFromFile(cwd || process.cwd());

    let updated = original;

    // 1. Rewrite YAML frontmatter status field.
    updated = updated.replace(YAML_HARDENED_RE, (_, prefix) => `${prefix}COMPLETE`);

    // 2. Rewrite first quote-header status line.
    const completeLine = _buildCompleteStatusLine(isoDate, ver);
    updated = updated.replace(QUOTE_HARDENED_RE, completeLine);

    if (updated === original) return { rewrote: false, reason: "already-complete" };
    writeFileSync(absPath, updated, "utf-8");
    return { rewrote: true, reason: "rewritten", yaml: yamlHit, quote: quoteHit };
  } catch (err) {
    // Never block the run on a rewrite failure.
    return { rewrote: false, reason: "error", error: err?.message || String(err) };
  }
}
