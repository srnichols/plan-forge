/**
 * Plan Forge — PreCommit Hook (#74, A3)
 *
 * Runs a configurable chain of pre-commit checks. Each chain entry is
 * either a builtin check (e.g. master-branch reject) or an external
 * command whose stdout returns JSON `{ blocked, message?, advisory? }`.
 *
 * Chain config lives in `plan-forge.json` (adjacent to this file) under
 * `hooks.preCommit.chain[]`. When no chain config is found, the hook
 * falls back to the legacy master-reject behavior.
 *
 * Human commits (PFORGE_RUN_PLAN_ACTIVE absent) skip chain enforcement
 * unless an entry explicitly opts in via `"always": true`.
 *
 * Config: .forge.json → hooks.preCommit.rejectMasterDuringRun (default true).
 * Bypass: set PFORGE_ALLOW_MASTER_COMMIT=1 (master-reject only).
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
 * Load the PreCommit chain from plan-forge.json.
 *
 * Resolution order:
 *   1. Explicit `configPath` (for testing)
 *   2. `plan-forge.json` adjacent to this file
 *   3. `.forge.json` at `cwd` → `hooks.preCommit.chain`
 *
 * @param {{ cwd?: string, configPath?: string }} options
 * @returns {Array<{ name: string, type: string, command?: string, windows?: string, timeout?: number, always?: boolean }>}
 */
export function loadChainConfig(options = {}) {
  const cwd = options.cwd || process.cwd();

  // Explicit config path (testing / override)
  if (options.configPath) {
    return readChainFromFile(options.configPath);
  }

  // Adjacent plan-forge.json (primary location when deployed)
  const hookDir = dirname(fileURLToPath(import.meta.url));
  const adjacentPath = resolve(hookDir, "plan-forge.json");
  if (existsSync(adjacentPath)) {
    const chain = readChainFromFile(adjacentPath);
    if (chain.length > 0) return chain;
  }

  // Fallback: .forge.json at project root
  const forgePath = resolve(cwd, ".forge.json");
  if (existsSync(forgePath)) {
    return readChainFromFile(forgePath);
  }

  return [];
}

/**
 * Read chain[] from a JSON config file.
 * @param {string} filePath
 * @returns {Array}
 */
function readChainFromFile(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8"));
    const chain = raw?.hooks?.preCommit?.chain;
    if (Array.isArray(chain)) return chain;
  } catch { /* malformed or missing */ }
  return [];
}

/**
 * Check whether a commit should be blocked (master-reject builtin).
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

/**
 * Run an external command chain entry and parse its JSON result.
 *
 * @param {{ command: string, windows?: string, timeout?: number }} entry
 * @param {{ cwd?: string }} options
 * @returns {{ blocked: boolean, message?: string, advisory?: string }}
 */
export function runCommandEntry(entry, options = {}) {
  const cwd = options.cwd || process.cwd();
  const isWin = process.platform === "win32";
  const cmd = (isWin && entry.windows) ? entry.windows : entry.command;

  if (!cmd) {
    return { blocked: false, advisory: `Chain entry '${entry.name}': no command for this platform.` };
  }

  const timeout = (entry.timeout || 30) * 1000;

  try {
    const stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!stdout) {
      return { blocked: false };
    }

    const result = JSON.parse(stdout);
    return {
      blocked: !!result.blocked,
      message: result.message || undefined,
      advisory: result.advisory || undefined,
    };
  } catch (err) {
    // Non-zero exit = treat as deny (fail-closed for safety)
    if (err.status != null && err.status !== 0) {
      let parsed;
      try { parsed = JSON.parse((err.stdout || "").trim()); } catch { /* ignore */ }
      return {
        blocked: true,
        message: parsed?.message || `Chain entry '${entry.name}' exited with code ${err.status}.`,
      };
    }
    // Timeout or other error — advisory, don't block
    return {
      blocked: false,
      advisory: `Chain entry '${entry.name}' error: ${err.message || "unknown"}`,
    };
  }
}

/**
 * Run the full PreCommit chain.
 *
 * Iterates `hooks.preCommit.chain[]` in order, aborts on first deny.
 * When no chain config is found, falls back to legacy master-reject.
 *
 * @param {{ cwd?: string, configPath?: string }} options
 * @returns {{ blocked: boolean, exitCode?: number, message?: string, advisory?: string, results?: Array }}
 */
export function runPreCommitChain(options = {}) {
  const chain = loadChainConfig(options);

  // No chain configured — fall back to legacy master-reject
  if (chain.length === 0) {
    return checkPreCommit(options);
  }

  const results = [];

  for (const entry of chain) {
    // Skip non-always entries when not inside run-plan
    if (!entry.always && process.env.PFORGE_RUN_PLAN_ACTIVE !== "1") {
      results.push({ name: entry.name, skipped: true, reason: "not in run-plan" });
      continue;
    }

    let result;

    if (entry.type === "builtin") {
      result = runBuiltinEntry(entry, options);
    } else if (entry.type === "command") {
      result = runCommandEntry(entry, options);
    } else {
      results.push({ name: entry.name, skipped: true, reason: `unknown type '${entry.type}'` });
      continue;
    }

    results.push({ name: entry.name, ...result });

    // Abort on first deny
    if (result.blocked) {
      return {
        blocked: true,
        exitCode: result.exitCode || 1,
        message: result.message,
        results,
      };
    }
  }

  // All entries passed — collect advisories
  const advisories = results
    .filter((r) => r.advisory)
    .map((r) => `[${r.name}] ${r.advisory}`);

  return {
    blocked: false,
    results,
    advisory: advisories.length > 0 ? advisories.join("\n") : undefined,
  };
}

/**
 * Dispatch a builtin chain entry by name.
 *
 * @param {{ name: string }} entry
 * @param {{ cwd?: string }} options
 * @returns {{ blocked: boolean, exitCode?: number, message?: string, advisory?: string }}
 */
function runBuiltinEntry(entry, options) {
  switch (entry.name) {
    case "master-reject":
      return checkPreCommit(options);
    default:
      return { blocked: false, advisory: `Unknown builtin '${entry.name}' — skipped.` };
  }
}
