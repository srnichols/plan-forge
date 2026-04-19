/**
 * Tempering artifact lifecycle (TEMPER-03 Slice 03.1).
 *
 * Tempering runs that capture non-text output (screenshots, HAR files,
 * a11y JSON reports, later visual-diff images) write under
 * `.forge/tempering/artifacts/<runId>/`. This module owns the
 * directory shape, deterministic URL-to-filename hashing, and
 * retention GC. Kept separate from `runner.mjs` so scanners in later
 * phases (visual diff, load, mutation) can reuse the same primitives
 * without dragging runner orchestration into their test matrix.
 *
 * Design constraints:
 *   - Artifact directories are never committed to git — `.gitignore`
 *     entry is seeded by the Tempering subsystem, not here
 *   - Never throws on filesystem errors — returns best-effort results
 *     so a scanner that can't write a screenshot doesn't kill a run
 *   - Pure functions of (projectDir, runId, now) so tests don't need
 *     the real clock
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

/**
 * Default retention for run artifacts — anything older than this
 * window is eligible for GC. Matches the `bugRegistry` + coverage
 * retention cadence documented in TEMPER-ARC so operators only have
 * one mental model of "how long does Tempering keep data".
 */
export const DEFAULT_ARTIFACT_RETENTION_DAYS = 7;

/**
 * Canonical per-run artifact directory. All scanners write under
 * `<projectDir>/.forge/tempering/artifacts/<runId>/<scanner>/…`.
 *
 * @param {string} projectDir
 * @param {string} runId
 * @returns {string}
 */
export function getArtifactDir(projectDir, runId) {
  return resolve(projectDir, ".forge", "tempering", "artifacts", runId);
}

/**
 * Per-scanner subdirectory under the run's artifact root. Scanners
 * shouldn't hand-roll path joins — they get a directory they own.
 *
 * @param {string} projectDir
 * @param {string} runId
 * @param {string} scanner
 * @returns {string}
 */
export function getScannerArtifactDir(projectDir, runId, scanner) {
  return resolve(getArtifactDir(projectDir, runId), scanner);
}

/**
 * Ensure the scanner's artifact directory exists. Returns the
 * absolute path on success; returns `null` if the directory can't be
 * created (read-only FS, permissions). Callers should fall back to
 * "no artifact written" rather than failing the run.
 *
 * @param {string} projectDir
 * @param {string} runId
 * @param {string} scanner
 * @returns {string|null}
 */
export function ensureScannerArtifactDir(projectDir, runId, scanner) {
  const dir = getScannerArtifactDir(projectDir, runId, scanner);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

/**
 * Deterministic, filesystem-safe filename derived from a URL. Uses
 * sha1 truncated to 16 hex chars — collision probability for the
 * ≤ maxPages=100 URLs a single sweep will visit is astronomically
 * small, and the shortened hash keeps filenames scannable.
 *
 * @param {string} url
 * @returns {string}
 */
export function hashUrl(url) {
  return createHash("sha1").update(String(url || "")).digest("hex").slice(0, 16);
}

/**
 * Retention GC — remove any per-run artifact directory older than
 * `retentionDays`. Best-effort; a locked or vanished directory is
 * silently skipped because a failed GC is never worse than a full
 * disk (operators can always clear `.forge/tempering/artifacts/` by
 * hand).
 *
 * @param {object} params
 * @param {string} params.projectDir
 * @param {number} [params.retentionDays=DEFAULT_ARTIFACT_RETENTION_DAYS]
 * @param {Function} [params.now=Date.now]
 * @returns {{ removed: string[], kept: string[] }}
 */
export function gcArtifacts({
  projectDir,
  retentionDays = DEFAULT_ARTIFACT_RETENTION_DAYS,
  now = Date.now,
} = {}) {
  const root = resolve(projectDir, ".forge", "tempering", "artifacts");
  const removed = [];
  const kept = [];
  if (!existsSync(root)) return { removed, kept };

  const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return { removed, kept }; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = resolve(root, entry.name);
    let mtimeMs = 0;
    try { mtimeMs = statSync(abs).mtimeMs; } catch { continue; }
    if (mtimeMs < cutoff) {
      try {
        rmSync(abs, { recursive: true, force: true });
        removed.push(entry.name);
      } catch { /* ignore, GC is best-effort */ }
    } else {
      kept.push(entry.name);
    }
  }
  return { removed, kept };
}

/**
 * Append the artifacts directory to the project's `.gitignore` if not
 * already present. Called once when a Tempering run produces its
 * first artifact so users don't accidentally commit screenshots. The
 * append is idempotent — reading the file line-by-line and checking
 * for the entry avoids duplicate appends.
 *
 * @param {string} projectDir
 * @param {object} [fs]
 * @returns {boolean} true when a new entry was appended
 */
export function seedArtifactsGitignore(projectDir) {
  const gitignore = resolve(projectDir, ".gitignore");
  const entry = ".forge/tempering/artifacts/";
  try {
    if (!existsSync(gitignore)) {
      writeFileSync(gitignore, `${entry}\n`, "utf-8");
      return true;
    }
    const current = readFileSync(gitignore, "utf-8");
    const lines = current.split(/\r?\n/).map((l) => l.trim());
    if (lines.includes(entry) || lines.includes(entry.replace(/\/$/, ""))) return false;
    const suffix = current.endsWith("\n") ? "" : "\n";
    appendFileSync(gitignore, `${suffix}${entry}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}
