/**
 * Plan Forge — GitHub Personal Dashboard Tab Renderers (Phase-54 Slice 2).
 *
 * Exports four HTML render helpers for the Personal Mode of the
 * "GitHub × Plan-Forge" dashboard tab. All functions:
 *   - Accept a single argument that may be null/undefined without throwing
 *   - Return an HTML string (never raw DOM)
 *   - Escape user-provided text via escapeHtml
 *
 * Designed as a separate file from github-metrics-tab.mjs to minimise
 * merge-conflict surface and keep Personal-mode changes isolated.
 */

/**
 * Render the authenticated-user account card.
 *
 * @param {object|null} user - Normalized UserProfile from fetchUserProfile, or null
 * @returns {string} HTML fragment
 */
export function renderAccountCard(user) {
  if (!user) {
    return renderPersonalEmptyState({ reason: "auth" });
  }

  const name     = user.name ? `<span class="gp-card__name">${escapeHtml(user.name)}</span>` : "";
  const planBadge = user.plan
    ? `<span class="gp-badge gp-badge--plan">${escapeHtml(String(user.plan))}</span>`
    : "";

  return `<div class="gp-card gp-card--account" data-card="account">
  <h3 class="gp-card__title">GitHub Account</h3>
  <div class="gp-card__body">
    <div class="gp-card__primary">
      <span class="gp-card__login">@${escapeHtml(user.login)}</span>${name ? " · " + name : ""}
      ${planBadge}
    </div>
    <dl class="gp-stat-list">
      <div class="gp-stat"><dt>Public repos</dt><dd>${user.publicRepos ?? 0}</dd></div>
      <div class="gp-stat"><dt>Followers</dt><dd>${user.followers ?? 0}</dd></div>
      <div class="gp-stat"><dt>Following</dt><dd>${user.following ?? 0}</dd></div>
    </dl>
    ${user.createdAt ? `<p class="gp-card__since">Member since ${formatDate(user.createdAt)}</p>` : ""}
  </div>
</div>`;
}

/**
 * Render the repository activity card.
 *
 * @param {object|null} repo - Normalized RepoSummary from fetchRepoSummary, or null
 * @returns {string} HTML fragment
 */
export function renderRepoActivityCard(repo) {
  if (!repo) {
    return `<div class="gp-card gp-card--repo gp-card--empty" data-card="repo">
  <h3 class="gp-card__title">Repository Activity</h3>
  <p class="gp-card__empty">No repository data. Pass <code>?owner=&amp;repo=</code> to specify a repo.</p>
</div>`;
  }

  const langBadge = repo.language
    ? `<span class="gp-badge gp-badge--lang">${escapeHtml(repo.language)}</span>`
    : "";
  const privBadge = repo.private
    ? `<span class="gp-badge gp-badge--private">private</span>`
    : `<span class="gp-badge gp-badge--public">public</span>`;

  return `<div class="gp-card gp-card--repo" data-card="repo">
  <h3 class="gp-card__title">
    ${escapeHtml(repo.fullName ?? repo.name ?? "")}
    ${privBadge}${langBadge ? " " + langBadge : ""}
  </h3>
  <div class="gp-card__body">
    <dl class="gp-stat-list">
      <div class="gp-stat"><dt>⭐ Stars</dt><dd>${repo.stars ?? 0}</dd></div>
      <div class="gp-stat"><dt>🍴 Forks</dt><dd>${repo.forks ?? 0}</dd></div>
      <div class="gp-stat"><dt>🐛 Open issues</dt><dd>${repo.openIssues ?? 0}</dd></div>
    </dl>
    ${repo.pushedAt ? `<p class="gp-card__since">Last push: ${formatDate(repo.pushedAt)}</p>` : ""}
  </div>
</div>`;
}

/**
 * Render the Copilot-assisted commits card.
 *
 * @param {object|null} copilotSignal - Result from scanCopilotCoauthors, or null
 * @returns {string} HTML fragment
 */
export function renderAiAssistCard(copilotSignal) {
  if (!copilotSignal || copilotSignal.total === 0) {
    return `<div class="gp-card gp-card--ai-assist gp-card--empty" data-card="ai-assist">
  <h3 class="gp-card__title">Copilot-Assisted Commits</h3>
  <p class="gp-card__empty">No commits scanned. The repository may be empty or inaccessible.</p>
</div>`;
  }

  const { total, withCopilot } = copilotSignal;
  const pct = total > 0 ? ((withCopilot / total) * 100).toFixed(1) : "0.0";

  return `<div class="gp-card gp-card--ai-assist" data-card="ai-assist">
  <h3 class="gp-card__title">Copilot-Assisted Commits</h3>
  <div class="gp-card__body">
    <div class="gp-ai-pct" data-pct="${pct}">${pct}%</div>
    <p class="gp-card__sub">${withCopilot} of ${total} commits scanned carry a Copilot co-author signal.</p>
    <p class="gp-card__hint">Signal fires for <code>Co-Authored-By: GitHub Copilot</code> trailers and <code>copilot-swe-agent[bot]</code> authors.</p>
  </div>
</div>`;
}

/**
 * Render the personal empty-state panel.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.reason] - "auth" | "no-remote" | "empty" | other
 * @returns {string} HTML fragment
 */
export function renderPersonalEmptyState({ reason } = {}) {
  let hint;
  if (reason === "auth") {
    hint = "Sign in with <code>gh auth login</code> to populate this view.";
  } else if (reason === "no-remote") {
    hint = "No GitHub remote detected. Open a project that has a GitHub remote, or pass <code>?owner=&amp;repo=</code> query params.";
  } else if (reason === "empty") {
    hint = "No commits in the last 100 to scan.";
  } else {
    hint = "Sign in with <code>gh auth login</code> and refresh to populate this view.";
  }

  return `<div class="gp-card gp-card--empty-state" data-card="empty-state">
  <h3 class="gp-card__title">GitHub Personal Mode</h3>
  <p class="gp-card__empty">${hint}</p>
</div>`;
}

// ─── Browser interop ─────────────────────────────────────────────────────────
// Expose render helpers to non-module scripts (app.js) via window.
if (typeof window !== "undefined") {
  window.githubPersonalRenderAccountCard     = renderAccountCard;
  window.githubPersonalRenderRepoActivityCard = renderRepoActivityCard;
  window.githubPersonalRenderAiAssistCard    = renderAiAssistCard;
  window.githubPersonalRenderPersonalEmptyState = renderPersonalEmptyState;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
