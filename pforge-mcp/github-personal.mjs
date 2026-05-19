/**
 * Plan Forge — GitHub Personal Metrics (Phase-54 Slice 0).
 *
 * Provides three operations against the personal/individual GitHub API surface:
 *   - `fetchUserProfile`      — authenticated user's profile via `gh api user`
 *   - `fetchRepoSummary`      — repository metadata via `gh api repos/{owner}/{repo}`
 *   - `scanCopilotCoauthors`  — scan commit history for Copilot co-author signatures
 *
 * All API calls go through the user's existing `gh` CLI auth — no additional
 * secret management required. Tests mock `gh` via the createMockGh helper;
 * no real GitHub API calls are made during tests.
 *
 * Follows the same spawn/error-dispatch contract as github-metrics.mjs.
 *
 * @module github-personal
 */

import { spawnSync } from "node:child_process";

// ─── Error classes ────────────────────────────────────────────────────────────

export class PersonalError extends Error {
  constructor(message) {
    super(message);
    this.name = "PersonalError";
  }
}

export class PersonalAuthError extends PersonalError {
  constructor(message) {
    super(message);
    this.name = "PersonalAuthError";
  }
}

export class PersonalNotFoundError extends PersonalError {
  constructor(message) {
    super(message);
    this.name = "PersonalNotFoundError";
  }
}

export class PersonalRateLimitError extends PersonalError {
  constructor(message) {
    super(message);
    this.name = "PersonalRateLimitError";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} UserProfile
 * @property {string} login
 * @property {number} id
 * @property {string|null} name
 * @property {string|null} email
 * @property {string|null} bio
 * @property {number} publicRepos
 * @property {number} followers
 * @property {number} following
 * @property {string} createdAt  - ISO datetime
 */

/**
 * Fetch the authenticated user's GitHub profile.
 *
 * @param {Object}  [opts]
 * @param {string}  [opts.ghCmd] - Path to `gh` binary (default: "gh")
 * @param {Object}  [opts.env]   - Process environment override (used in tests)
 * @returns {UserProfile}
 * @throws {PersonalAuthError}      on 401/403
 * @throws {PersonalRateLimitError} on 429
 * @throws {PersonalError}          on other failures
 */
export function fetchUserProfile({ ghCmd = "gh", env } = {}) {
  const raw = callGhApi("user", { ghCmd, env });
  return normalizeUserProfile(raw);
}

/**
 * @typedef {Object} RepoSummary
 * @property {number} id
 * @property {string} name
 * @property {string} fullName
 * @property {boolean} private
 * @property {string|null} description
 * @property {boolean} fork
 * @property {number} stars
 * @property {number} forks
 * @property {number} openIssues
 * @property {string} defaultBranch
 * @property {string|null} language
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} pushedAt
 */

/**
 * Fetch a repository summary from the GitHub API.
 *
 * @param {Object}  opts
 * @param {string}  opts.owner   - Repository owner (user or org slug)
 * @param {string}  opts.repo    - Repository name
 * @param {string}  [opts.ghCmd] - Path to `gh` binary (default: "gh")
 * @param {Object}  [opts.env]   - Process environment override (used in tests)
 * @returns {RepoSummary}
 * @throws {PersonalAuthError}      on 401/403
 * @throws {PersonalNotFoundError}  on 404
 * @throws {PersonalRateLimitError} on 429
 * @throws {PersonalError}          on other failures
 */
export function fetchRepoSummary({ owner, repo, ghCmd = "gh", env } = {}) {
  if (!owner) throw new PersonalError("owner is required");
  if (!repo) throw new PersonalError("repo is required");

  const endpoint = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const raw = callGhApi(endpoint, { ghCmd, env, context: `${owner}/${repo}` });
  return normalizeRepoSummary(raw);
}

/**
 * @typedef {Object} CommitScanResult
 * @property {number} total           - Total commits scanned
 * @property {number} withCopilot     - Commits with a Copilot co-author signature
 * @property {CommitEntry[]} commits  - Per-commit detail
 */

/**
 * @typedef {Object} CommitEntry
 * @property {string}  sha
 * @property {string}  date        - ISO datetime of the commit
 * @property {string}  message     - Full commit message
 * @property {boolean} hasCopilot  - Whether Copilot co-authorship was detected
 */

/**
 * Scan a repository's commit history for GitHub Copilot co-author signatures.
 *
 * Detects lines matching (case-insensitive):
 *   Co-authored-by: GitHub Copilot <...>
 *   Co-authored-by: Copilot <copilot@github.com>
 *
 * @param {Object}  opts
 * @param {string}  opts.owner       - Repository owner
 * @param {string}  opts.repo        - Repository name
 * @param {string}  [opts.since]     - ISO date lower bound (passed to GitHub API)
 * @param {string}  [opts.until]     - ISO date upper bound (passed to GitHub API)
 * @param {number}  [opts.perPage]   - Commits per page (default: 100, max: 100)
 * @param {string}  [opts.ghCmd]     - Path to `gh` binary (default: "gh")
 * @param {Object}  [opts.env]       - Process environment override (used in tests)
 * @returns {CommitScanResult}
 * @throws {PersonalAuthError}      on 401/403
 * @throws {PersonalNotFoundError}  on 404
 * @throws {PersonalRateLimitError} on 429
 * @throws {PersonalError}          on other failures
 */
export function scanCopilotCoauthors({
  owner,
  repo,
  since,
  until,
  perPage = 100,
  ghCmd = "gh",
  env,
} = {}) {
  if (!owner) throw new PersonalError("owner is required");
  if (!repo) throw new PersonalError("repo is required");

  const params = [`per_page=${Math.min(perPage, 100)}`];
  if (since) params.push(`since=${since}`);
  if (until) params.push(`until=${until}`);

  const endpoint =
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits` +
    `?${params.join("&")}`;

  const raw = callGhApi(endpoint, { ghCmd, env, context: `${owner}/${repo}` });
  const items = Array.isArray(raw) ? raw : [];

  const commits = items.map((item) => {
    const message = item?.commit?.message ?? "";
    const hasCopilot = COPILOT_COAUTHOR_RE.test(message);
    return {
      sha: item?.sha ?? "",
      date: item?.commit?.author?.date ?? "",
      message,
      hasCopilot,
    };
  });

  return {
    total: commits.length,
    withCopilot: commits.filter((c) => c.hasCopilot).length,
    commits,
  };
}

// ─── Copilot co-author detection ──────────────────────────────────────────────

const COPILOT_COAUTHOR_RE =
  /co-authored-by:\s*(github\s+)?copilot\s*</i;

// ─── Normalization helpers ────────────────────────────────────────────────────

function normalizeUserProfile(raw) {
  return {
    login: raw.login ?? "",
    id: raw.id ?? 0,
    name: raw.name ?? null,
    email: raw.email ?? null,
    bio: raw.bio ?? null,
    publicRepos: raw.public_repos ?? 0,
    followers: raw.followers ?? 0,
    following: raw.following ?? 0,
    createdAt: raw.created_at ?? "",
  };
}

function normalizeRepoSummary(raw) {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? "",
    fullName: raw.full_name ?? "",
    private: raw.private ?? false,
    description: raw.description ?? null,
    fork: raw.fork ?? false,
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    openIssues: raw.open_issues_count ?? 0,
    defaultBranch: raw.default_branch ?? "main",
    language: raw.language ?? null,
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    pushedAt: raw.pushed_at ?? "",
  };
}

// ─── `gh` invocation helpers ─────────────────────────────────────────────────

/**
 * Call `gh api <endpoint>` and return the parsed JSON body.
 * Throws a typed PersonalError on any non-zero exit or HTTP error response.
 *
 * @param {string} endpoint   - API path (e.g. "user" or "repos/owner/repo")
 * @param {Object} opts
 * @param {string} opts.ghCmd
 * @param {Object} [opts.env]
 * @param {string} [opts.context] - Context hint for error messages (e.g. "owner/repo")
 * @returns {*} Parsed JSON response
 */
function callGhApi(endpoint, { ghCmd, env, context } = {}) {
  // Bug #192 (v2.99.1): avoid DEP0190 on Windows — route through cmd.exe
  const isWin = process.platform === "win32";
  const spawnBin = isWin ? "cmd" : ghCmd;
  const spawnArg = isWin
    ? ["/d", "/s", "/c", ghCmd, "api", endpoint]
    : ["api", endpoint];

  const result = spawnSync(spawnBin, spawnArg, {
    encoding: "utf-8",
    env: env ?? process.env,
    windowsHide: isWin,
  });

  if (result.error) {
    throw new PersonalError(`Failed to spawn gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    raiseGhError(result, context);
  }

  let data;
  try {
    data = JSON.parse(result.stdout || "null");
  } catch {
    throw new PersonalError(
      `gh api returned non-JSON output: ${result.stdout?.slice(0, 200)}`
    );
  }

  if (data && typeof data === "object" && !Array.isArray(data) && data.message) {
    raiseErrorBody(data, context);
  }

  return data;
}

// ─── Error dispatch ───────────────────────────────────────────────────────────

function raiseGhError(result, context) {
  let body = null;
  try {
    body = JSON.parse(result.stdout || "{}");
  } catch { /* ignore */ }

  const message = body?.message ?? "";
  const status = body?.status ?? "";
  const combined = `${message} ${status} ${result.stderr ?? ""}`;

  if (/401|403|forbidden|unauthorized|required scope|bad.?credentials/i.test(combined)) {
    throw new PersonalAuthError(
      "GitHub auth failure. Run `gh auth login` or `gh auth refresh` to re-authenticate."
    );
  }

  if (/404|not.?found/i.test(combined)) {
    const ctx = context ? `: ${context}` : "";
    throw new PersonalNotFoundError(`Resource not found${ctx}`);
  }

  if (/429|rate.?limit/i.test(combined)) {
    const m = (result.stderr ?? "").match(/retry.?after[:\s]+(\d+)/i);
    const hint = m ? ` --retry-after ${m[1]}` : "";
    throw new PersonalRateLimitError(`GitHub API rate limit hit.${hint}`);
  }

  throw new PersonalError(
    `gh api failed (exit ${result.status}): ${message || result.stderr?.trim() || "unknown error"}`
  );
}

function raiseErrorBody(body, context) {
  raiseGhError({ status: 1, stdout: JSON.stringify(body), stderr: "" }, context);
}
