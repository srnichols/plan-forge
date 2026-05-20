/**
 * Plan Forge — Classifier-Lane GitHub Issue Filer (v3.5.0)
 *
 * When tempering triage routes a finding to the "classifier" lane
 * (classification: "infra"), this module creates a GitHub issue proposing
 * an update to the classifier rules that would suppress the pattern.
 *
 * The issue is deduped by a stable hash of `(findingClass, reason)` so
 * repeated runs of the same noisy pattern don't spam the tracker.
 *
 * Design contracts:
 *   - Never throws — all paths return structured `{ ok, ... }`
 *   - No side effects beyond GitHub issue creation
 *   - Dedup window: 7 days (same hash in an open issue = comment instead)
 *   - Token resolution: env → .forge/secrets.json → gh auth token
 *
 * @module tempering/classifier-issue
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ERROR_CODES } from "../enums.mjs";

// ─── Labels ──────────────────────────────────────────────────────────────────

export const CLASSIFIER_ISSUE_LABELS = Object.freeze([
  "classifier-noise",
  "plan-forge-internal",
]);

// ─── Hash helper ─────────────────────────────────────────────────────────────

/**
 * Compute a stable 12-char hex hash for deduplication.
 * @param {string} findingClass - The finding class (e.g. "missing-h1")
 * @param {string} reason       - Classifier reason string
 * @returns {string} 12-character hex hash
 */
export function computeClassifierIssueHash(findingClass, reason) {
  const key = `classifier:${(findingClass || "").toLowerCase()}:${(reason || "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

// ─── Issue body builder ───────────────────────────────────────────────────────

/**
 * Build the markdown body for a classifier-noise GitHub issue.
 *
 * @param {object} payload - Classifier-lane payload from `routeFinding`
 * @param {string} hash    - Dedup hash to embed in title
 * @returns {string}
 */
export function buildClassifierIssueBody(payload, hash) {
  const lines = [
    `## Classifier Noise Report`,
    "",
    `**Finding Class:** \`${payload.findingClass || "unknown"}\``,
  ];
  if (payload.route) {
    lines.push(`**Route:** \`${payload.route}\``);
  }
  lines.push(
    `**Current Classification:** \`${payload.currentClassification || "infra"}\``,
    "",
    `## Proposed Action`,
    "",
    payload.proposedAction || "Add or update a classifier rule to suppress this pattern.",
    "",
  );
  if (payload.reason) {
    lines.push("## Classifier Reason", "", payload.reason, "");
  }
  if (payload.rule) {
    lines.push(`**Matched Rule:** \`${payload.rule}\``);
  }
  const evidenceKeys = Object.keys(payload.evidence || {});
  if (evidenceKeys.length > 0) {
    lines.push(...[
      "",
      "<details>",
      "<summary>Evidence JSON</summary>",
      "",
      "```json",
      JSON.stringify(payload.evidence, null, 2),
      "```",
      "",
      "</details>",
    ]);
  }
  lines.push(
    "",
    "---",
    `*Filed automatically by [Plan Forge Tempering](https://github.com/srnichols/plan-forge) — hash \`${hash || ""}\`*`,
  );
  return lines.join("\n");
}

// ─── Token + repo resolution (mirrors bug-adapters/github.mjs) ───────────────

function resolveToken(config, { execSync: execSyncFn, cwd } = {}) {
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) return { token: envToken, source: "env" };

  if (cwd) {
    const secretsPath = resolve(cwd, ".forge", "secrets.json");
    try {
      if (existsSync(secretsPath)) {
        const s = JSON.parse(readFileSync(secretsPath, "utf-8"));
        if (s?.github?.token) return { token: s.github.token, source: "secrets.json" };
      }
    } catch { /* malformed */ }
  }

  if (typeof execSyncFn === "function") {
    try {
      const t = execSyncFn("gh auth token", { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"], cwd }).trim();
      if (t) return { token: t, source: "gh-cli" };
    } catch { /* gh not available */ }
  }

  return { token: null, error: ERROR_CODES.NO_TOKEN.code };
}

function resolveRepo(config, { execSync: execSyncFn, cwd } = {}) {
  const cfgRepo = config?.bugRegistry?.githubRepo;
  if (cfgRepo?.includes("/")) {
    const [owner, repo] = cfgRepo.split("/");
    if (owner && repo) return { owner, repo };
  }
  if (typeof execSyncFn === "function") {
    try {
      const url = execSyncFn("git remote get-url origin", { encoding: "utf-8", timeout: 5_000, stdio: ["pipe", "pipe", "pipe"], cwd }).trim();
      const https = url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
      if (https) return { owner: https[1], repo: https[2] };
      const ssh = url.match(/github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
      if (ssh) return { owner: ssh[1], repo: ssh[2] };
    } catch { /* no remote */ }
  }
  return null;
}

// ─── Dedup check ─────────────────────────────────────────────────────────────

async function findExisting({ hash, owner, repo, token, execSync: execSyncFn, fetch: fetchFn, cwd }) {
  if (typeof execSyncFn === "function") {
    try {
      const cmd = `gh issue list --repo "${owner}/${repo}" --label "classifier-noise" --state open --search "${hash}" --json number,url,title --limit 10`;
      const raw = execSyncFn(cmd, { encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"], cwd }).trim();
      if (raw) {
        const issues = JSON.parse(raw);
        const match = issues.find((i) => i.title?.includes(hash));
        if (match) return { issueNumber: match.number, url: match.url };
      }
    } catch { /* fall through */ }
  }
  if (token && typeof fetchFn === "function") {
    try {
      const q = encodeURIComponent(`repo:${owner}/${repo} label:classifier-noise state:open "${hash}" in:title`);
      const res = await fetchFn(`https://api.github.com/search/issues?q=${q}&per_page=5`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const data = await res.json();
        const match = (data.items || []).find((i) => i.title?.includes(hash));
        if (match) return { issueNumber: match.number, url: match.html_url };
      }
    } catch { /* search failed */ }
  }
  return null;
}

// ─── Issue creation helpers ──────────────────────────────────────────────────

function createViaGh({ owner, repo, title, body, labels, execSync: execSyncFn, cwd }) {
  if (typeof execSyncFn !== "function") return null;
  try {
    const labelArg = labels.map((l) => `--label "${l}"`).join(" ");
    const safeTitle = title.replace(/"/g, '\\"');
    const safeBody = body.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const cmd = `gh issue create --repo "${owner}/${repo}" --title "${safeTitle}" --body "${safeBody}" ${labelArg}`;
    const out = execSyncFn(cmd, { encoding: "utf-8", timeout: 30_000, stdio: ["pipe", "pipe", "pipe"], cwd }).trim();
    const m = out.match(/\/issues\/(\d+)/);
    if (m) return { issueNumber: parseInt(m[1], 10), url: out };
    return null;
  } catch {
    return null;
  }
}

async function createViaRest({ token, owner, repo, title, body, labels, fetch: fetchFn }) {
  if (typeof fetchFn !== "function") return null;
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
    if (!res.ok) return { error: `HTTP_${res.status}` };
    const data = await res.json();
    return { issueNumber: data.number, url: data.html_url };
  } catch (err) {
    return { error: err.name === "TimeoutError" ? ERROR_CODES.TIMEOUT.code : ERROR_CODES.NETWORK_ERROR.code };
  }
}

async function addComment({ token, owner, repo, issueNumber, body, fetch: fetchFn }) {
  if (typeof fetchFn !== "function") return null;
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
    if (!res.ok) return { error: `HTTP_${res.status}` };
    const data = await res.json();
    return { commentId: data.id, url: data.html_url };
  } catch {
    return null;
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * File (or dedup-comment on) a classifier-noise GitHub issue.
 *
 * @param {object} payload  - Classifier-lane payload from `routeFinding`
 * @param {object} config   - Forge configuration (from .forge.json)
 * @param {object} [deps]
 * @param {Function} [deps.execSync]
 * @param {Function} [deps.fetch]
 * @param {string}   [deps.cwd]
 * @returns {Promise<{ ok: boolean, issueNumber?: number, url?: string, deduped?: boolean, message: string }>}
 */
export async function fileClassifierIssue(payload, config, {
  execSync: execSyncFn,
  fetch: fetchFn = globalThis.fetch,
  cwd,
} = {}) {
  try {
    const hash = computeClassifierIssueHash(payload.findingClass, payload.reason);

    const tokenResult = resolveToken(config, { execSync: execSyncFn, cwd });
    if (!tokenResult.token) {
      return { ok: false, error: ERROR_CODES.NO_TOKEN.code, message: "No GitHub token — set GITHUB_TOKEN, .forge/secrets.json#github.token, or run `gh auth login`." };
    }

    const repoInfo = resolveRepo(config, { execSync: execSyncFn, cwd });
    if (!repoInfo) {
      return { ok: false, error: ERROR_CODES.NO_REPO.code, message: "Could not resolve GitHub repository. Set bugRegistry.githubRepo in .forge.json." };
    }

    // Dedup: check for existing open issue with same hash
    const existing = await findExisting({ hash: hash, owner: repoInfo.owner, repo: repoInfo.repo, token: tokenResult.token, ...{ execSync: execSyncFn, fetch: fetchFn, cwd } });
    if (existing) {
      const commentBody = `## Recurrence\n\nThis classifier noise pattern was observed again.\n\n**Finding:** \`${payload.findingClass || "unknown"}\`\n**Route:** \`${payload.route || ""}\`\n\n*Reported by Plan Forge Tempering — hash \`${hash}\`*`;
      await addComment({ token: tokenResult.token, owner: repoInfo.owner, repo: repoInfo.repo, issueNumber: existing.issueNumber, body: commentBody, fetch: fetchFn });
      return { ok: true, issueNumber: existing.issueNumber, url: existing.url, deduped: true, message: `Commented on existing issue #${existing.issueNumber} (hash ${hash} already open).` };
    }

    const title = `[classifier-noise:${hash}] ${payload.findingClass || "unknown"}: ${(payload.reason || "noise pattern").slice(0, 80)}`;
    const body = buildClassifierIssueBody(payload, hash);

    let result = createViaGh({ owner: repoInfo.owner, repo: repoInfo.repo, title, body, labels: [...CLASSIFIER_ISSUE_LABELS], execSync: execSyncFn, cwd });
    if (!result || result.error) {
      result = await createViaRest({
        token: tokenResult.token,
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        title,
        body,
        labels: [...CLASSIFIER_ISSUE_LABELS],
        fetch: fetchFn,
      });
    }

    if (!result || result.error) {
      return { ok: false, error: result?.error || ERROR_CODES.CREATE_FAILED.code, message: "GitHub issue creation failed. Check token permissions and repository access." };
    }

    return { ok: true, issueNumber: result.issueNumber, url: result.url, deduped: false, message: `Classifier-noise issue #${result.issueNumber} created.` };
  } catch (err) {
    return { ok: false, error: ERROR_CODES.UNEXPECTED.code, message: err?.message || "Unexpected error in fileClassifierIssue." };
  }
}
