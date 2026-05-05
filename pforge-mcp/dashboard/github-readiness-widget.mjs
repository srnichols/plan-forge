/**
 * Plan Forge — GitHub Stack Readiness Widget (Phase Hotfix-v2.90.8 Slice 4).
 *
 * Exports `renderReadinessWidget(checks)` which takes a CheckResult[] array
 * (as returned by `inspectGithubStack`) and returns an HTML fragment suitable
 * for injection into the GH Metrics tab's `<section id="gm-readiness">`.
 *
 * Rendering rules:
 *   - The 8 standard checks are always rendered.
 *   - The `copilot-coding-agent-assignable` probe is rendered only when its
 *     status is not "na" (i.e. when a ghToken was provided and the probe ran).
 *   - warn/fail rows include the fixHint inline.
 *   - Status glyphs follow the same ✓/⚠/✗/⊘ convention as the CLI renderer.
 */

const GLYPH = { pass: "✓", warn: "⚠", fail: "✗", na: "⊘" };
const ASSIGNABLE_ID = "copilot-coding-agent-assignable";

/**
 * Render the GitHub Stack Readiness widget HTML fragment.
 *
 * @param {import('../github-introspect.mjs').CheckResult[]} checks
 * @returns {string} HTML fragment
 */
export function renderReadinessWidget(checks) {
  if (!checks || checks.length === 0) {
    return `<div class="gm-readiness" data-widget="github-readiness">
  <p class="gm-readiness__empty">No readiness data available.</p>
</div>`;
  }

  // Standard checks are always shown; assignable probe is only shown when active
  const standardChecks = checks.filter((c) => c.id !== ASSIGNABLE_ID);
  const assignableCheck = checks.find((c) => c.id === ASSIGNABLE_ID);

  const visibleChecks = [...standardChecks];
  if (assignableCheck && assignableCheck.status !== "na") {
    visibleChecks.push(assignableCheck);
  }

  const rowsHtml = visibleChecks.map((c) => renderRow(c)).join("\n");
  const summary = buildSummary(visibleChecks);

  return `<div class="gm-readiness" data-widget="github-readiness">
  <h3 class="gm-readiness__title">GitHub Stack Readiness</h3>
  <ul class="gm-readiness__list">
${rowsHtml}
  </ul>
  <div class="gm-readiness__summary">${escapeHtml(summary)}</div>
</div>`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function renderRow(check) {
  const glyph = GLYPH[check.status] || "?";
  const hintHtml =
    check.fixHint && (check.status === "warn" || check.status === "fail")
      ? `\n      <span class="gm-readiness__hint">${escapeHtml(check.fixHint)}</span>`
      : "";
  return `    <li class="gm-readiness__row gm-readiness__row--${escapeHtml(check.status)}" data-check-id="${escapeHtml(check.id)}">
      <span class="gm-readiness__glyph" aria-label="${escapeHtml(check.status)}">${glyph}</span>
      <span class="gm-readiness__label">${escapeHtml(check.label)}</span>
      <span class="gm-readiness__detail">${escapeHtml(check.detail)}</span>${hintHtml}
    </li>`;
}

function buildSummary(checks) {
  const counts = checks.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});
  const pass = counts.pass || 0;
  const warn = counts.warn || 0;
  const fail = counts.fail || 0;
  const na = counts.na || 0;
  return `${pass} pass · ${warn} warn · ${fail} fail · ${na} n/a  (${checks.length} checks)`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─── Browser interop ─────────────────────────────────────────────────────────
// Expose render helper to non-module scripts (app.js) via window.
if (typeof window !== "undefined") {
  window.githubReadinessRenderWidget = renderReadinessWidget;
}
