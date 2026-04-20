/**
 * Plan Forge — PreCommit Hook (#74)
 *
 * Rejects direct commits to the default branch (master/main) when
 * PFORGE_RUN_PLAN_ACTIVE=1 is set in the environment (i.e., during
 * slice execution via `run-plan`).
 *
 * Human commits (env var absent) are never blocked.
 * Bypass: set PFORGE_ALLOW_MASTER_COMMIT=1.
 * Config: .forge.json → hooks.preCommit.rejectMasterDuringRun (default true).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Detect the repository's default branch name.
 * Tries (in order):
 *   1. git symbolic-ref refs/remotes/origin/HEAD → strip prefix
 *   2. git config init.defaultBranch
 *   3. Fallback: "master"
 *
 * @param {string} cwd - Working directory (must contain .git)
 * @returns {string}
 */
export function detectDefaultBranch(cwd = process.cwd()) {
  // Try symbolic-ref first (most reliable for cloned repos)
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    }).trim();
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch && branch !== ref) return branch;
  } catch { /* not available */ }

  // Fallback: local git config
  try {
    const branch = execSync("git config init.defaultBranch", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    }).trim();
    if (branch) return branch;
  } catch { /* not configured */ }

  return "master";
}

/**
 * Load PreCommit hook configuration from .forge.json.
 * Schema: { "hooks": { "preCommit": { "rejectMasterDuringRun": true } } }
 *
 * @param {string} cwd
 * @returns {{ rejectMasterDuringRun: boolean }}
 */
export function loadPreCommitConfig(cwd = process.cwd()) {
  const defaults = { rejectMasterDuringRun: true };
  const configPath = resolve(cwd, ".forge.json");
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.hooks?.preCommit && typeof raw.hooks.preCommit === "object") {
        return { ...defaults, ...raw.hooks.preCommit };
      }
    } catch { /* malformed — use defaults */ }
  }
  return defaults;
}

/**
 * Check whether a commit should be blocked.
 *
 * @param {{ cwd?: string }} options
 * @returns {{ blocked: boolean, exitCode?: number, message?: string, advisory?: string }}
 */
export function checkPreCommit(options = {}) {
  const cwd = options.cwd || process.cwd();

  const config = loadPreCommitConfig(cwd);

  // Config opt-out: advisory only
  if (!config.rejectMasterDuringRun) {
    return { blocked: false, advisory: "PreCommit hook disabled via config — advisory only." };
  }

  // Not inside run-plan → no enforcement (human commits unaffected)
  if (process.env.PFORGE_RUN_PLAN_ACTIVE !== "1") {
    return { blocked: false };
  }

  // Detect current branch
  let currentBranch;
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    }).trim();
  } catch {
    // Can't detect branch (no .git, detached HEAD returning "HEAD", etc.) — degrade gracefully
    return { blocked: false, advisory: "PreCommit: unable to detect current branch — skipping guard." };
  }

  const defaultBranch = detectDefaultBranch(cwd);

  // Not on default branch → allow
  if (currentBranch !== defaultBranch) {
    return { blocked: false };
  }

  // Bypass override
  if (process.env.PFORGE_ALLOW_MASTER_COMMIT === "1") {
    return {
      blocked: false,
      advisory: `Bypass active — committing to '${defaultBranch}' despite run-plan.`,
    };
  }

  // Block: direct-to-default-branch during run-plan
  return {
    blocked: true,
    exitCode: 1,
    message: [
      `PreCommit blocked: direct commit to '${defaultBranch}' during run-plan.`,
      "Create a feature branch or set PFORGE_ALLOW_MASTER_COMMIT=1 to bypass.",
    ].join("\n"),
  };
}
