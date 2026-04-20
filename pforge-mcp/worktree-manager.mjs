/**
 * Plan Forge — Worktree Manager (Phase-26 Slice 1)
 *
 * Pure filesystem + `git worktree` wrapper for competitive-slice execution.
 * Manages the lifecycle of per-variant workspaces under `.forge/worktrees/`
 * and archived losers under `.forge/worktrees-archive/`.
 *
 * Contract:
 *   - All paths stay inside `<projectDir>/.forge/worktrees{,-archive}/`.
 *   - Archive retention is capped by `runtime.competitive.archiveDays`
 *     (default 7) — `cleanupAgedArchives()` removes older entries.
 *   - Never writes to `refs/heads/`; only uses detached worktrees.
 *   - All inputs are sanitized with `sanitizeComponent()` (no `..`, no
 *     path separators, no control chars) before path assembly.
 *   - Opt-in: nothing in this module runs unless the orchestrator's
 *     CompetitiveScheduler (Slice 2) invokes it.
 *
 * @module worktree-manager
 */

import { mkdirSync, existsSync, statSync, readdirSync, renameSync, rmSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

export const WORKTREES_DIR = ".forge/worktrees";
export const WORKTREES_ARCHIVE_DIR = ".forge/worktrees-archive";
export const DEFAULT_ARCHIVE_DAYS = 7;
export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 5;
export const DEFAULT_MAX_VARIANTS = 3;

/**
 * Sanitize a user-supplied path component to something safe to use
 * inside `.forge/worktrees/<plan>/<slice>/variant-<n>/`.
 *
 * Strips anything that isn't `[A-Za-z0-9._-]`, collapses `..` sequences
 * (defense against traversal), and caps length at 128. Mirrors
 * memory.mjs#sanitizePathComponent so trajectories + worktrees share
 * the same safety posture.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function sanitizeComponent(s) {
  let cleaned = String(s ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  while (cleaned.includes("..")) {
    cleaned = cleaned.replace(/\.\./g, "_");
  }
  cleaned = cleaned.slice(0, 128);
  return cleaned.length > 0 ? cleaned : "_";
}

/**
 * Compute the absolute worktree path for a variant.
 * @param {string} projectDir absolute path to the repo root
 * @param {string} planBasename plan filename without extension
 * @param {string|number} sliceId
 * @param {number} variant 1-based variant index
 * @returns {string}
 */
export function variantPath(projectDir, planBasename, sliceId, variant) {
  if (!isAbsolute(projectDir)) {
    throw new Error("variantPath: projectDir must be absolute");
  }
  const n = Number(variant);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VARIANTS) {
    throw new Error(`variantPath: variant must be integer in [1, ${MAX_VARIANTS}]`);
  }
  const p = join(
    projectDir,
    WORKTREES_DIR,
    sanitizeComponent(planBasename),
    sanitizeComponent(sliceId),
    `variant-${n}`,
  );
  const root = join(projectDir, WORKTREES_DIR);
  const resolved = resolve(p);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error("variantPath: resolved path escapes worktrees root");
  }
  return resolved;
}

/**
 * Compute the absolute archive path for a variant.
 * @param {string} projectDir
 * @param {string} planBasename
 * @param {string|number} sliceId
 * @param {number} variant
 * @returns {string}
 */
export function archivePath(projectDir, planBasename, sliceId, variant) {
  if (!isAbsolute(projectDir)) {
    throw new Error("archivePath: projectDir must be absolute");
  }
  const n = Number(variant);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VARIANTS) {
    throw new Error(`archivePath: variant must be integer in [1, ${MAX_VARIANTS}]`);
  }
  const p = join(
    projectDir,
    WORKTREES_ARCHIVE_DIR,
    sanitizeComponent(planBasename),
    sanitizeComponent(sliceId),
    `variant-${n}`,
  );
  const root = join(projectDir, WORKTREES_ARCHIVE_DIR);
  const resolved = resolve(p);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error("archivePath: resolved path escapes archive root");
  }
  return resolved;
}

/**
 * Return the clamped, integer maxVariants value given a raw config input.
 * @param {unknown} raw
 * @returns {number}
 */
export function clampMaxVariants(raw) {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_MAX_VARIANTS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_MAX_VARIANTS;
  const i = Math.trunc(n);
  if (i < MIN_VARIANTS) return MIN_VARIANTS;
  if (i > MAX_VARIANTS) return MAX_VARIANTS;
  return i;
}

/**
 * Create a git worktree at the computed variant path. Thin wrapper around
 * `git worktree add --detach`. Creates parent directories if needed.
 *
 * @param {object} opts
 * @param {string} opts.projectDir absolute path to repo root
 * @param {string} opts.planBasename
 * @param {string|number} opts.sliceId
 * @param {number} opts.variant
 * @param {string} [opts.baseRef="HEAD"] ref the worktree starts from
 * @param {(cmd: string, args: string[], options?: object) => {status: number|null, stdout?: string|Buffer, stderr?: string|Buffer}} [opts.spawn]
 *        Inject a spawn implementation (tests override; defaults to spawnSync).
 * @returns {{ path: string, baseRef: string }}
 */
export function createWorktree({
  projectDir,
  planBasename,
  sliceId,
  variant,
  baseRef = "HEAD",
  spawn = spawnSync,
}) {
  const path = variantPath(projectDir, planBasename, sliceId, variant);
  if (existsSync(path)) {
    throw new Error(`createWorktree: path already exists: ${path}`);
  }
  mkdirSync(join(path, ".."), { recursive: true });
  const result = spawn(
    "git",
    ["worktree", "add", "--detach", path, baseRef],
    { cwd: projectDir, encoding: "utf8" },
  );
  if (!result || result.status !== 0) {
    const stderr = result?.stderr ? String(result.stderr) : "";
    throw new Error(
      `createWorktree: git worktree add failed (status=${result?.status ?? "?"}): ${stderr.slice(0, 500)}`,
    );
  }
  return { path, baseRef };
}

/**
 * Archive a variant worktree — moves the directory from
 * `.forge/worktrees/<plan>/<slice>/variant-<n>` to
 * `.forge/worktrees-archive/<plan>/<slice>/variant-<n>`. Also removes the
 * worktree registration with `git worktree remove --force` so git stops
 * tracking it. Safe to call on an already-archived variant (no-op).
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {string} opts.planBasename
 * @param {string|number} opts.sliceId
 * @param {number} opts.variant
 * @param {Function} [opts.spawn]
 * @returns {{ archived: boolean, from: string, to: string }}
 */
export function archiveWorktree({
  projectDir,
  planBasename,
  sliceId,
  variant,
  spawn = spawnSync,
}) {
  const from = variantPath(projectDir, planBasename, sliceId, variant);
  const to = archivePath(projectDir, planBasename, sliceId, variant);
  if (!existsSync(from)) {
    return { archived: false, from, to };
  }
  // Try git worktree remove first; ignore failures (might not be registered).
  try {
    spawn("git", ["worktree", "remove", "--force", from], { cwd: projectDir, encoding: "utf8" });
  } catch { /* swallow — filesystem move below is authoritative */ }
  // If `git worktree remove` already deleted the directory, nothing to move.
  if (!existsSync(from)) {
    return { archived: false, from, to };
  }
  mkdirSync(join(to, ".."), { recursive: true });
  if (existsSync(to)) {
    rmSync(to, { recursive: true, force: true });
  }
  renameSync(from, to);
  return { archived: true, from, to };
}

/**
 * List archived variants older than `archiveDays` and remove them.
 * Uses directory mtime; never touches live worktrees. Idempotent.
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {number} [opts.archiveDays=DEFAULT_ARCHIVE_DAYS]
 * @param {Date} [opts.now=new Date()]
 * @returns {{ removed: string[], kept: string[] }}
 */
export function cleanupAgedArchives({
  projectDir,
  archiveDays = DEFAULT_ARCHIVE_DAYS,
  now = new Date(),
}) {
  if (!isAbsolute(projectDir)) {
    throw new Error("cleanupAgedArchives: projectDir must be absolute");
  }
  const root = join(projectDir, WORKTREES_ARCHIVE_DIR);
  const removed = [];
  const kept = [];
  if (!existsSync(root)) {
    return { removed, kept };
  }
  const cutoff = now.getTime() - archiveDays * 24 * 60 * 60 * 1000;

  // .forge/worktrees-archive/<plan>/<slice>/variant-<n>
  for (const plan of readdirSync(root, { withFileTypes: true })) {
    if (!plan.isDirectory()) continue;
    const planDir = join(root, plan.name);
    for (const slice of readdirSync(planDir, { withFileTypes: true })) {
      if (!slice.isDirectory()) continue;
      const sliceDir = join(planDir, slice.name);
      for (const variant of readdirSync(sliceDir, { withFileTypes: true })) {
        if (!variant.isDirectory()) continue;
        const variantDir = join(sliceDir, variant.name);
        let mtime;
        try { mtime = statSync(variantDir).mtimeMs; } catch { continue; }
        if (mtime < cutoff) {
          rmSync(variantDir, { recursive: true, force: true });
          removed.push(variantDir);
        } else {
          kept.push(variantDir);
        }
      }
    }
  }
  return { removed, kept };
}

/**
 * List live (unarchived) variant directories. Used by the Dashboard and by
 * the Teardown Safety Guard exemption (Slice 4) to know what paths are
 * managed by this module.
 *
 * @param {string} projectDir
 * @returns {string[]} absolute paths
 */
export function listLiveVariants(projectDir) {
  if (!isAbsolute(projectDir)) {
    throw new Error("listLiveVariants: projectDir must be absolute");
  }
  const root = join(projectDir, WORKTREES_DIR);
  const out = [];
  if (!existsSync(root)) return out;
  for (const plan of readdirSync(root, { withFileTypes: true })) {
    if (!plan.isDirectory()) continue;
    const planDir = join(root, plan.name);
    for (const slice of readdirSync(planDir, { withFileTypes: true })) {
      if (!slice.isDirectory()) continue;
      const sliceDir = join(planDir, slice.name);
      for (const variant of readdirSync(sliceDir, { withFileTypes: true })) {
        if (!variant.isDirectory()) continue;
        out.push(join(sliceDir, variant.name));
      }
    }
  }
  return out;
}
