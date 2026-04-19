/**
 * Plan Forge — Crucible Grandfather Migration (Slice 01.4).
 *
 * Legacy projects that existed before v2.37 have `docs/plans/Phase-*.md`
 * files without a `crucibleId:` frontmatter. Enforcement would break
 * them instantly. This module stamps each such plan with a stable
 * synthetic id so the enforcement gate lets them through while keeping
 * them clearly distinguishable from plans that were actually smelted.
 *
 * Stamp format: `crucibleId: grandfathered-<uuid>`
 * (NOT a real smelt id — tooling can tell the difference.)
 *
 * Design guarantees:
 *   - Idempotent: re-running never changes an already-stamped file
 *   - Scope-safe: only touches `docs/plans/Phase-*.md`
 *   - Body-safe: only inserts frontmatter; body bytes are preserved
 *   - Auditable: writes a `.forge/crucible/manual-imports.jsonl`
 *                entry per stamped file with source="grandfather"
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  parseFrontmatter,
  upsertFrontmatter,
  logManualImport,
} from "./crucible-enforce.mjs";

const PHASE_FILE_RE = /^Phase-.+\.md$/i;

/**
 * Stamp every legacy Phase plan lacking `crucibleId:` with a
 * `grandfathered-<uuid>` value. Returns a per-file report.
 *
 * @param {string} projectDir
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{
 *   scanned: number,
 *   stamped: Array<{ path: string, crucibleId: string }>,
 *   skipped: Array<{ path: string, reason: string }>,
 * }}
 */
export function grandfatherExistingPlans(projectDir, opts = {}) {
  const { dryRun = false } = opts;
  const plansDir = resolve(projectDir, "docs", "plans");
  const report = { scanned: 0, stamped: [], skipped: [] };

  if (!existsSync(plansDir)) return report;

  let entries;
  try { entries = readdirSync(plansDir, { withFileTypes: true }); }
  catch { return report; }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!PHASE_FILE_RE.test(entry.name)) continue;

    const path = join(plansDir, entry.name);
    report.scanned += 1;

    let original;
    try { original = readFileSync(path, "utf-8"); }
    catch (err) {
      report.skipped.push({ path, reason: `read-failed:${err.code || "unknown"}` });
      continue;
    }

    const { frontmatter } = parseFrontmatter(original);
    if (frontmatter.crucibleId) {
      report.skipped.push({ path, reason: "already-stamped" });
      continue;
    }

    const crucibleId = `grandfathered-${randomUUID()}`;
    const { changed, content } = upsertFrontmatter(original, { crucibleId });
    if (!changed) {
      // Defensive — upsert should always change when the field is missing
      report.skipped.push({ path, reason: "no-change" });
      continue;
    }

    if (!dryRun) {
      try { writeFileSync(path, content, "utf-8"); }
      catch (err) {
        report.skipped.push({ path, reason: `write-failed:${err.code || "unknown"}` });
        continue;
      }
      logManualImport(projectDir, {
        timestamp: new Date().toISOString(),
        planPath: path,
        source: "grandfather",
        reason: "legacy plan predated v2.37 Crucible",
        crucibleId,
      });
    }

    report.stamped.push({ path, crucibleId });
  }

  return report;
}
