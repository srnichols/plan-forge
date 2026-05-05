/**
 * Plan Forge — GitHub Metrics Dashboard Tab (Phase GITHUB-D Slice 5).
 *
 * Exports render helpers for the "GitHub × Plan-Forge" unified leaderboard tab.
 *
 * Three panels:
 *   1. Adoption sparklines  — acceptance rate, AI-assisted PR users, chat users (last 30d)
 *   2. Orchestration sparklines — runs, slices, $ spent from forge_cost_report
 *   3. Per-team table — sortable, filterable
 *
 * Empty-state: when no metrics have been pulled yet, shows a populate command.
 */

/**
 * Render the adoption sparklines panel HTML string.
 *
 * @param {Object[]} records - Normalized NormalizedRecord[] from loadMetrics
 * @returns {string} HTML fragment for the adoption panel
 */
export function renderAdoptionPanel(records) {
  if (!records || records.length === 0) {
    return renderEmptyState();
  }

  const acceptanceRates = records.map((r) => r.codeCompletions?.acceptanceRate ?? 0);
  const prUsers = records.map((r) => r.prEngagedUsers ?? 0);
  const chatUsers = records.map(
    (r) => (r.ideChatEngagedUsers ?? 0) + (r.dotcomChatEngagedUsers ?? 0)
  );

  return `<div class="gm-panel gm-panel--adoption" data-panel="adoption">
  <h3 class="gm-panel__title">Adoption</h3>
  <div class="gm-sparklines">
    <div class="gm-sparkline" data-metric="acceptance-rate" data-values="${acceptanceRates.join(",")}">
      <span class="gm-sparkline__label">Acceptance rate</span>
      <span class="gm-sparkline__value">${formatPercent(acceptanceRates[acceptanceRates.length - 1])}</span>
    </div>
    <div class="gm-sparkline" data-metric="pr-engaged-users" data-values="${prUsers.join(",")}">
      <span class="gm-sparkline__label">AI-assisted PR users</span>
      <span class="gm-sparkline__value">${prUsers[prUsers.length - 1]}</span>
    </div>
    <div class="gm-sparkline" data-metric="chat-users" data-values="${chatUsers.join(",")}">
      <span class="gm-sparkline__label">Chat-engaged users</span>
      <span class="gm-sparkline__value">${chatUsers[chatUsers.length - 1]}</span>
    </div>
  </div>
</div>`;
}

/**
 * Render the orchestration sparklines panel HTML string.
 *
 * @param {Object} costReport - Cost report from getCostReport
 * @returns {string} HTML fragment for the orchestration panel
 */
export function renderOrchestrationPanel(costReport) {
  const runs = costReport?.totalRuns ?? 0;
  const slices = costReport?.totalSlices ?? 0;
  const totalCost = costReport?.totalCostUsd ?? 0;

  return `<div class="gm-panel gm-panel--orchestration" data-panel="orchestration">
  <h3 class="gm-panel__title">Orchestration</h3>
  <div class="gm-sparklines">
    <div class="gm-sparkline" data-metric="runs">
      <span class="gm-sparkline__label">Plan runs</span>
      <span class="gm-sparkline__value">${runs}</span>
    </div>
    <div class="gm-sparkline" data-metric="slices">
      <span class="gm-sparkline__label">Total slices</span>
      <span class="gm-sparkline__value">${slices}</span>
    </div>
    <div class="gm-sparkline" data-metric="cost-usd">
      <span class="gm-sparkline__label">Total cost</span>
      <span class="gm-sparkline__value">$${(typeof totalCost === "number" ? totalCost : 0).toFixed(2)}</span>
    </div>
  </div>
</div>`;
}

/**
 * Render the per-team table panel HTML string.
 *
 * @param {Object[]} rows - Array of { team, adoptedPrs, runs, costUsd, driftScore }
 * @returns {string} HTML fragment for the per-team panel
 */
export function renderPerTeamTable(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="gm-panel gm-panel--per-team" data-panel="per-team">
  <h3 class="gm-panel__title">Per-team</h3>
  <p class="gm-panel__empty">No per-team data available.</p>
</div>`;
  }

  const rowsHtml = rows
    .map(
      (r) => `<tr class="gm-table__row">
    <td class="gm-table__cell">${escapeHtml(String(r.team ?? ""))}</td>
    <td class="gm-table__cell gm-table__cell--num">${r.adoptedPrs ?? 0}</td>
    <td class="gm-table__cell gm-table__cell--num">${r.runs ?? 0}</td>
    <td class="gm-table__cell gm-table__cell--num">$${(r.costUsd ?? 0).toFixed(2)}</td>
    <td class="gm-table__cell gm-table__cell--num">${r.driftScore ?? "\u2014"}</td>
  </tr>`
    )
    .join("\n");

  return `<div class="gm-panel gm-panel--per-team" data-panel="per-team">
  <h3 class="gm-panel__title">Per-team</h3>
  <table class="gm-table" aria-label="Per-team metrics">
    <thead>
      <tr>
        <th class="gm-table__th">Team</th>
        <th class="gm-table__th gm-table__th--num">AI PRs</th>
        <th class="gm-table__th gm-table__th--num">Runs</th>
        <th class="gm-table__th gm-table__th--num">$ Spent</th>
        <th class="gm-table__th gm-table__th--num">Drift</th>
      </tr>
    </thead>
    <tbody>
${rowsHtml}
    </tbody>
  </table>
</div>`;
}

/**
 * Render the empty-state panel shown when no metrics have been pulled yet.
 *
 * @param {string} [org] - Org slug to include in the populate-command
 * @returns {string} HTML fragment for the empty-state
 */
export function renderEmptyState(org) {
  const cmd = org
    ? `pforge github metrics pull --org ${org}`
    : `pforge github metrics pull --org <org-name>`;
  return `<div class="gm-panel gm-panel--empty" data-panel="empty">
  <p class="gm-panel__empty">No metrics data yet.</p>
  <p class="gm-panel__hint">Run the following command to populate:</p>
  <div class="gm-copy-block">
    <code class="gm-copy-code" id="gm-populate-cmd">${escapeHtml(cmd)}</code>
    <button class="gm-copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('gm-populate-cmd').textContent)">Copy</button>
  </div>
</div>`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function formatPercent(val) {
  if (typeof val !== "number") return "0%";
  return `${(val * 100).toFixed(1)}%`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
