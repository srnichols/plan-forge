/**
 * Plan Forge — Tempering: GitHub Issues Bug Adapter (Phase TEMPER-06 Slice 06.2)
 *
 * Syncs bugs discovered by tempering scanners to GitHub Issues.
 * All public functions return structured results and never throw.
 *
 * Token resolution priority: GITHUB_TOKEN env → .forge/secrets.json → `gh auth token`
 * Issue creation: tries `gh issue create` first, falls back to REST API.
 *
 * @module tempering/bug-adapters/github
 */

import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// ─── Helpers (exported for tests) ─────────────────────────────────────

/**
 * Resolve a GitHub token from multiple sources.
 * Priority: GITHUB_TOKEN env → .forge/secrets.json#github.token → `gh auth token`
 *
 * @param {object} config
 * @param {object} [deps]
 * @param {Function} [deps.execSync]
 * @param {string} [deps.cwd]
 * @returns {{ token: string, source: string } | { token: null, error: string }}
 */
export function resolveGitHubToken(config, { execSync, cwd } = {}) {
  // 1. Environment variable
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  // 2. .forge/secrets.json
  if (cwd) {
    const secretsPath = resolve(cwd, ".forge", "secrets.json");
    try {
      if (existsSync(secretsPath)) {
        const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
        if (secrets?.github?.token) {
          return { token: secrets.github.token, source: "secrets.json" };
        }
      }
    } catch { /* malformed JSON — skip */ }
  }

  // 3. gh auth token subprocess
  if (typeof execSync === "function") {
    try {
      const token = execSync("gh auth token", {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      }).trim();
      if (token) {
        return { token, source: "gh-cli" };
      }
    } catch { /* gh not installed or not logged in */ }
  }

  return { token: null, error: "NO_TOKEN" };
}

/**
 * Resolve owner/repo from config or git remote.
 *
 * @param {object} config
 * @param {object} [deps]
 * @param {Function} [deps.execSync]
 * @param {string} [deps.cwd]
 * @returns {{ owner: string, repo: string } | null}
 */
export function resolveGitHubRepo(config, { execSync, cwd } = {}) {
  // 1. Explicit config
  const cfgRepo = config?.bugRegistry?.githubRepo;
  if (cfgRepo && cfgRepo.includes("/")) {
    const [owner, repo] = cfgRepo.split("/");
    if (owner && repo) return { owner, repo };
  }

  // 2. Parse git remote
  if (typeof execSync === "function") {
    try {
      const url = execSync("git remote get-url origin", {
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      }).trim();
      return parseGitRemoteUrl(url);
    } catch { /* no git or no remote */ }
  }

  return null;
}

/**
 * Parse a GitHub remote URL (HTTPS or SSH) into owner/repo.
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitRemoteUrl(url) {
  if (!url || typeof url !== "string") return null;

  // HTTPS: https://github.com/owner/repo(.git)?
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // SSH: git@github.com:owner/repo(.git)?
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

// ─── Issue body builders ─────────────────────────────────────────────

const SEVERITY_BADGES = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "🟢 Low",
};

/**
 * Build the markdown body for a GitHub issue.
 * @param {object} bug
 * @returns {string}
 */
export function buildIssueBody(bug) {
  const badge = SEVERITY_BADGES[bug.severity] || bug.severity;
  const lines = [
    `## Tempering Bug Report`,
    "",
    `**Severity:** ${badge}`,
    `**Scanner:** ${bug.scanner}`,
    `**Bug ID:** \`${bug.bugId}\``,
    `**Discovered:** ${bug.discoveredAt}`,
  ];

  if (bug.classification) {
    lines.push(`**Classification:** ${bug.classification}`);
  }

  if (bug.affectedFiles?.length) {
    lines.push("", "### Affected Files", "");
    for (const f of bug.affectedFiles) {
      lines.push(`- \`${f}\``);
    }
  }

  if (bug.evidence) {
    lines.push("", "### Evidence", "");
    if (bug.evidence.testName) {
      lines.push(`**Test:** \`${bug.evidence.testName}\``);
    }
    if (bug.evidence.assertionMessage) {
      lines.push(`**Assertion:** ${bug.evidence.assertionMessage}`);
    }
  }

  // Full evidence in collapsed block
  lines.push(
    "",
    "<details>",
    "<summary>Full evidence JSON</summary>",
    "",
    "```json",
    JSON.stringify(bug.evidence || {}, null, 2),
    "```",
    "",
    "</details>",
    "",
    "---",
    "*Filed automatically by [Plan Forge Tempering](https://github.com/srnichols/plan-forge)*",
  );

  return lines.join("\n");
}

/**
 * Build labels for a GitHub issue.
 * @param {object} bug
 * @param {object} config
 * @returns {string[]}
 */
export function buildLabels(bug, config) {
  const prefix = config?.bugRegistry?.labelPrefix || "tempering";
  const labels = [`${prefix}:bug`];
  if (bug.severity) labels.push(`severity:${bug.severity}`);
  if (bug.scanner) labels.push(`scanner:${bug.scanner}`);
  return labels;
}

// ─── REST API helpers ────────────────────────────────────────────────

/**
 * Create an issue via the GitHub REST API.
 * @returns {Promise<{ issueNumber: number, url: string } | null>}
 */
async function createIssueViaRest(token, owner, repo, title, body, labels, { fetch: fetchFn }) {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title, body, labels }),
      signal: AbortSignal.timeout(30_000),
    });

    // Rate limit check
    const remaining = res.headers?.get?.("x-ratelimit-remaining");
    const resetAt = res.headers?.get?.("x-ratelimit-reset");
    if (res.status === 403 && remaining === "0") {
      return { error: "RATE_LIMITED", resetAt: resetAt ? new Date(Number(resetAt) * 1000).toISOString() : null };
    }

    if (!res.ok) {
      return { error: `HTTP_${res.status}` };
    }

    const data = await res.json();
    return { issueNumber: data.number, url: data.html_url };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { error: "TIMEOUT" };
    }
    return { error: "NETWORK_ERROR" };
  }
}

/**
 * Create an issue via `gh issue create`. Returns null on any failure.
 */
function createIssueViaGh(owner, repo, title, body, labels, { execSync: execSyncFn, cwd }) {
  if (typeof execSyncFn !== "function") return null;
  try {
    const labelArg = labels.map((l) => `--label "${l}"`).join(" ");
    const cmd = `gh issue create --repo "${owner}/${repo}" --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" ${labelArg}`;
    const output = execSyncFn(cmd, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    }).trim();

    // gh outputs the URL of the created issue
    const match = output.match(/\/issues\/(\d+)/);
    if (match) {
      return { issueNumber: parseInt(match[1], 10), url: output };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Add a comment to an existing issue via REST API.
 */
async function addComment(token, owner, repo, issueNumber, body, { fetch: fetchFn }) {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { error: `HTTP_${res.status}` };
    }

    const data = await res.json();
    return { commentId: data.id, url: data.html_url };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { error: "TIMEOUT" };
    }
    return { error: "NETWORK_ERROR" };
  }
}

// ─── Public API (4-function contract) ────────────────────────────────

/**
 * Register a new bug as a GitHub Issue.
 *
 * @param {object} bug - Bug record from registry
 * @param {object} config - Forge config
 * @param {object} [deps]
 * @returns {Promise<{ provider: string, ok: boolean, issueNumber?: number, url?: string, error?: string, warnings?: string[] }>}
 */
export async function registerBug(bug, config, { fetch: fetchFn = globalThis.fetch, execSync: execSyncFn, cwd } = {}) {
  try {
    // Short-circuit if already linked
    if (bug.externalRef?.provider === "github" && bug.externalRef?.issueNumber) {
      return { provider: "github", ok: true, issueNumber: bug.externalRef.issueNumber, url: bug.externalRef.url };
    }

    const tokenResult = resolveGitHubToken(config, { execSync: execSyncFn, cwd });
    if (!tokenResult.token) {
      return { provider: "github", ok: false, error: tokenResult.error || "NO_TOKEN" };
    }

    const repoInfo = resolveGitHubRepo(config, { execSync: execSyncFn, cwd });
    if (!repoInfo) {
      return { provider: "github", ok: false, error: "NO_REPO" };
    }

    const title = `[Tempering] ${bug.scanner}: ${bug.evidence?.testName || bug.bugId}`;
    const body = buildIssueBody(bug);
    const labels = buildLabels(bug, config);

    // Try gh CLI first, fall back to REST
    let result = createIssueViaGh(repoInfo.owner, repoInfo.repo, title, body, labels, { execSync: execSyncFn, cwd });

    if (!result) {
      result = await createIssueViaRest(tokenResult.token, repoInfo.owner, repoInfo.repo, title, body, labels, { fetch: fetchFn });
    }

    if (!result || result.error) {
      return { provider: "github", ok: false, error: result?.error || "CREATE_FAILED" };
    }

    return { provider: "github", ok: true, issueNumber: result.issueNumber, url: result.url };
  } catch {
    return { provider: "github", ok: false, error: "UNEXPECTED" };
  }
}

/**
 * Update bug status by adding a comment to the linked GitHub issue.
 * Never rewrites issue body.
 */
export async function updateBugStatus(bug, config, { fetch: fetchFn = globalThis.fetch, execSync: execSyncFn, cwd } = {}) {
  try {
    const issueNumber = bug.externalRef?.issueNumber;
    if (!issueNumber) {
      return { provider: "github", ok: false, error: "NO_ISSUE_NUMBER" };
    }

    const tokenResult = resolveGitHubToken(config, { execSync: execSyncFn, cwd });
    if (!tokenResult.token) {
      return { provider: "github", ok: false, error: tokenResult.error || "NO_TOKEN" };
    }

    const repoInfo = resolveGitHubRepo(config, { execSync: execSyncFn, cwd });
    if (!repoInfo) {
      return { provider: "github", ok: false, error: "NO_REPO" };
    }

    const body = `## Status Update\n\n**New Status:** \`${bug.status}\`\n**Updated:** ${bug.updatedAt || new Date().toISOString()}\n\n${bug.statusHistory?.at(-1)?.note ? `**Note:** ${bug.statusHistory.at(-1).note}` : ""}`;

    const result = await addComment(tokenResult.token, repoInfo.owner, repoInfo.repo, issueNumber, body, { fetch: fetchFn });

    if (result.error) {
      return { provider: "github", ok: false, error: result.error };
    }

    return { provider: "github", ok: true, commentId: result.commentId, url: result.url };
  } catch {
    return { provider: "github", ok: false, error: "UNEXPECTED" };
  }
}

/**
 * Post a "validated fix" comment to the linked GitHub issue.
 * Does NOT close the issue automatically.
 */
export async function commentValidatedFix(bug, config, { fetch: fetchFn = globalThis.fetch, execSync: execSyncFn, cwd } = {}) {
  try {
    const issueNumber = bug.externalRef?.issueNumber;
    if (!issueNumber) {
      return { provider: "github", ok: false, error: "NO_ISSUE_NUMBER" };
    }

    const tokenResult = resolveGitHubToken(config, { execSync: execSyncFn, cwd });
    if (!tokenResult.token) {
      return { provider: "github", ok: false, error: tokenResult.error || "NO_TOKEN" };
    }

    const repoInfo = resolveGitHubRepo(config, { execSync: execSyncFn, cwd });
    if (!repoInfo) {
      return { provider: "github", ok: false, error: "NO_REPO" };
    }

    const scanRef = bug.validationHistory?.at(-1)?.scanRef || "";
    const body = `## 🔥 Tempering validated this fix\n\n**Bug ID:** \`${bug.bugId}\`\n**Scanner:** ${bug.scanner}\n**Validated at:** ${new Date().toISOString()}\n${scanRef ? `**Scan Reference:** \`${scanRef}\`` : ""}\n\nThe tempering subsystem has confirmed this bug is fixed. The issue remains open for human review.`;

    const result = await addComment(tokenResult.token, repoInfo.owner, repoInfo.repo, issueNumber, body, { fetch: fetchFn });

    if (result.error) {
      return { provider: "github", ok: false, error: result.error };
    }

    return { provider: "github", ok: true, commentId: result.commentId, url: result.url };
  } catch {
    return { provider: "github", ok: false, error: "UNEXPECTED" };
  }
}

/**
 * Sync status from GitHub (read labels and state).
 */
export async function syncStatusFromProvider(bugId, config, { fetch: fetchFn = globalThis.fetch, execSync: execSyncFn, cwd } = {}) {
  try {
    // We need the bug record to get the issueNumber
    // The caller should provide the full bug, but bugId is also accepted
    const bug = typeof bugId === "object" ? bugId : { bugId };
    const issueNumber = bug.externalRef?.issueNumber;
    if (!issueNumber) {
      return { provider: "github", ok: false, error: "NO_ISSUE_NUMBER" };
    }

    const tokenResult = resolveGitHubToken(config, { execSync: execSyncFn, cwd });
    if (!tokenResult.token) {
      return { provider: "github", ok: false, error: tokenResult.error || "NO_TOKEN" };
    }

    const repoInfo = resolveGitHubRepo(config, { execSync: execSyncFn, cwd });
    if (!repoInfo) {
      return { provider: "github", ok: false, error: "NO_REPO" };
    }

    const res = await fetchFn(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { provider: "github", ok: false, error: `HTTP_${res.status}` };
    }

    const data = await res.json();
    return {
      provider: "github",
      ok: true,
      status: data.state,
      labels: (data.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    };
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { provider: "github", ok: false, error: "TIMEOUT" };
    }
    return { provider: "github", ok: false, error: "NETWORK_ERROR" };
  }
}

// ─── Meta-bug class schema & repo resolver ────────────────────────────

/**
 * Canonical meta-bug classes for Plan Forge self-repair.
 *
 * - plan-defect: brittle gate, missing scope, wrong path, over-narrow grep
 * - orchestrator-defect: runtime bug in Plan Forge (timeout, spawn, stash)
 * - prompt-defect: unsafe output, missing rule, placeholder not expanded
 */
export const META_BUG_CLASSES = Object.freeze([
  "plan-defect",
  "orchestrator-defect",
  "prompt-defect",
]);

/** Default labels applied to every meta-bug issue. */
export const SELF_REPAIR_LABELS = Object.freeze([
  "self-repair",
  "plan-forge-internal",
]);

/**
 * Resolve the target repository for meta-bug (self-repair) issues.
 *
 * Resolution priority:
 *   1. config.meta.selfRepairRepo  ("owner/repo" string)
 *   2. Fallback: srnichols/plan-forge
 *
 * @param {object|null|undefined} config - Forge configuration object
 * @returns {{ owner: string, repo: string }}
 */
export function resolveSelfRepairRepo(config) {
  const raw = config?.meta?.selfRepairRepo;
  if (!raw || typeof raw !== "string") {
    return { owner: "srnichols", repo: "plan-forge" };
  }
  const trimmed = raw.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { owner: "srnichols", repo: "plan-forge" };
  }
  return { owner: parts[0], repo: parts[1] };
}
