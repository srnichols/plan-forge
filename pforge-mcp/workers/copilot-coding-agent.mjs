/**
 * Plan Forge — Phase GITHUB-B Slice 1: Copilot Coding Agent dispatch worker.
 *
 * Exports:
 *   dispatchSlice(slice, opts)          → { issueNumber, issueUrl }
 *   pollPullRequest(issueNumber, opts)  → { prNumber, prUrl, status } | { status: "timeout" }
 *
 * Both functions shell out to `gh` (GitHub CLI) via spawnSync. Dependency-inject
 * `env` (containing a modified PATH) in tests to route `gh` to a mock binary.
 */

import { spawnSync } from "node:child_process";

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_POLL_INTERVAL_MS = 60_000;   // 60 s
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

// ─── Error type ───────────────────────────────────────────────────────────────

export class GhError extends Error {
  constructor(message, exitCode, stderr) {
    super(message);
    this.name = "GhError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a Markdown issue body from a slice descriptor.
 * Exported for unit tests.
 */
export function buildIssueBody(slice) {
  const parts = [];

  if (slice.goal) {
    parts.push(`## Goal\n${slice.goal}`);
  }

  if (slice.scope) {
    const text = Array.isArray(slice.scope) ? slice.scope.join("\n") : slice.scope;
    parts.push(`## Files in Scope\n${text}`);
  }

  if (slice.gate) {
    parts.push(`## Validation Gate\n\`\`\`\n${slice.gate}\n\`\`\``);
  }

  return parts.length > 0 ? parts.join("\n\n") : "*(no details)*";
}

/**
 * Low-level wrapper around spawnSync for `gh`.
 * On Windows, routes through cmd.exe to resolve `.cmd` shims without
 * triggering Node's DEP0190 deprecation (shell:true + array args).
 * Throws GhError on non-zero exit or spawn failure.
 */
function spawnGh(args, { cwd = process.cwd(), env = process.env } = {}) {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "cmd" : "gh";
  const cmdArgs = isWindows ? ["/d", "/s", "/c", "gh", ...args] : args;

  const result = spawnSync(cmd, cmdArgs, {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: isWindows,
  });

  if (result.error) {
    throw new GhError(
      `gh failed to start: ${result.error.message}`,
      -1,
      "",
    );
  }

  if (result.status !== 0) {
    const sub = args.slice(0, 2).join(" ");
    const detail = (result.stderr ?? "").trim();
    throw new GhError(
      `gh ${sub} exited ${result.status}${detail ? `: ${detail}` : ""}`,
      result.status,
      result.stderr ?? "",
    );
  }

  return result.stdout ?? "";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a GitHub Issue for a plan slice and assign it to @copilot.
 *
 * @param {{ title?: string, goal?: string, scope?: string|string[], gate?: string }} slice
 * @param {{ cwd?: string, env?: object, repo?: string }} opts
 * @returns {{ issueNumber: number, issueUrl: string }}
 */
export function dispatchSlice(slice, opts = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    repo,
    _spawnGh = spawnGh,
  } = opts;

  const title = slice.title ?? "Untitled slice";
  const body = buildIssueBody(slice);

  const args = [
    "issue", "create",
    "--title", title,
    "--body", body,
    "--assignee", "@copilot",
  ];
  if (repo) args.push("--repo", repo);

  const stdout = _spawnGh(args, { cwd, env });

  // gh issue create outputs the issue URL on stdout: https://github.com/o/r/issues/42
  const url = stdout.trim();
  const match = url.match(/\/issues\/(\d+)$/);
  if (!match) {
    throw new Error(`Unexpected gh issue create output: ${JSON.stringify(url)}`);
  }

  return {
    issueNumber: parseInt(match[1], 10),
    issueUrl: url,
  };
}

/**
 * Poll for a PR linked to the given issue number.
 *
 * Tries `--search "linked:<n>"` first; falls back to `head:copilot/issue-<n>`.
 * Draft PRs are skipped (treated as not-yet-ready).
 *
 * @param {number} issueNumber
 * @param {{ cwd?: string, env?: object, repo?: string,
 *           intervalMs?: number, timeoutMs?: number }} opts
 * @returns {Promise<{ prNumber: number, prUrl: string, status: string }|{ status: "timeout" }>}
 */
export async function pollPullRequest(issueNumber, opts = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    repo,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    _spawnGh = spawnGh,
    _sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  const baseArgs = ["pr", "list", "--json", "number,url,state,isDraft"];
  if (repo) baseArgs.push("--repo", repo);

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const spawnOpts = { cwd, env };

    // Primary: PRs linked to this issue
    const pr =
      tryFindPr([...baseArgs, "--search", `linked:${issueNumber}`], spawnOpts, _spawnGh) ??
      // Fallback: Copilot's conventional branch naming pattern
      tryFindPr([...baseArgs, "--search", `head:copilot/issue-${issueNumber}`], spawnOpts, _spawnGh);

    if (pr) {
      return {
        prNumber: pr.number,
        prUrl: pr.url,
        status: normalizePrState(pr.state),
      };
    }

    await _sleep(intervalMs);
  }

  return { status: "timeout" };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function tryFindPr(args, spawnOpts, _spawnGh) {
  let stdout;
  try {
    stdout = _spawnGh(args, spawnOpts);
  } catch {
    return null;
  }

  let prs;
  try {
    prs = JSON.parse(stdout.trim() || "[]");
  } catch {
    return null;
  }

  if (!Array.isArray(prs)) return null;

  // Skip drafts — Copilot marks newly-opened PRs as draft until ready
  return prs.find((pr) => !pr.isDraft) ?? null;
}

function normalizePrState(state) {
  if (!state) return "open";
  const s = state.toLowerCase();
  if (s === "merged") return "merged";
  if (s === "closed") return "closed";
  return "open";
}
