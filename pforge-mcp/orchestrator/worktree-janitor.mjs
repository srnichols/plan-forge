/**
 * Plan Forge — stale worktree janitor.
 *
 * Parallel and competitive slices run in `.forge/worktrees/…`, and a failed or
 * interrupted batch keeps its worktrees for recovery. Nothing removed them
 * later, so they piled up — each with dependency links back into the project
 * and paths deep enough to break Windows tools. At run start this removes
 * worktrees and archives older than the retention (default 7 days).
 *
 * Directories are deleted with Node's rmSync, which removes links without
 * following them (a junction back to the project must never be traversed),
 * and `git worktree prune` then drops git's record of them.
 */

import { execFileSync } from "node:child_process";
import { rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { MS_PER_DAY } from "../time-units.mjs";
import { DEFAULT_ARCHIVE_DAYS, cleanupAgedArchives, gitLongPathArgs, listLiveVariants } from "../worktree-manager.mjs";

const GIT_TIMEOUT_MS = 60_000;
const RM_RETRIES = 3;

function pruneWorktreeRecords(cwd) {
  try {
    execFileSync("git", [...gitLongPathArgs(), "worktree", "prune"], { cwd, stdio: "ignore", timeout: GIT_TIMEOUT_MS, windowsHide: true });
  } catch { /* not a git repo, or git missing: the directories are gone either way */ }
}

function modifiedMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.cwd               Project root.
 * @param {number} [opts.retentionDays]   Keep worktrees modified within this many days.
 * @param {Date}   [opts.now]
 * @returns {{ removed: string[], kept: string[], archivesRemoved: string[], errors: string[] }}
 */
export function cleanupStaleWorktrees({ cwd, retentionDays = DEFAULT_ARCHIVE_DAYS, now = new Date() }) {
  const projectDir = resolve(cwd);
  const cutoff = now.getTime() - retentionDays * MS_PER_DAY;
  const result = { removed: [], kept: [], archivesRemoved: [], errors: [] };

  for (const path of listLiveVariants(projectDir)) {
    const mtime = modifiedMs(path);
    if (mtime === null || mtime >= cutoff) {
      result.kept.push(path);
      continue;
    }
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: RM_RETRIES });
      result.removed.push(path);
    } catch (err) {
      result.errors.push(`${path}: ${err.message}`);
    }
  }

  try {
    result.archivesRemoved = cleanupAgedArchives({ projectDir, archiveDays: retentionDays, now }).removed;
  } catch (err) {
    result.errors.push(`archives: ${err.message}`);
  }

  if (result.removed.length > 0) pruneWorktreeRecords(projectDir);
  return result;
}
