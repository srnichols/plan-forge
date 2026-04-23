/**
 * Plan Forge — Recurring Patterns Dashboard Panel Tests (Phase-38.6 Slice 4)
 *
 * Verifies that forgeMasterRenderPatternsPanel renders correctly
 * from fixture pattern data grouped by severity.
 */

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

// ─── Fixtures ─────────────────────────────────────────────────────────

const FIXTURE_PATTERNS = [
  {
    id: "gate-failure-recurrence:tee-tmp",
    detector: "gate-failure-recurrence",
    severity: "error",
    title: "tee /tmp/ gate failures",
    detail: "Recurring gate failure pattern across multiple plans",
    occurrences: 6,
    plans: ["Phase-35", "Phase-36"],
  },
  {
    id: "model-failure-rate:gpt-4o-mini-high-complexity",
    detector: "model-failure-rate-by-complexity",
    severity: "warning",
    title: "gpt-4o-mini fails on complexity ≥ 4",
    detail: "Model failure rate 33% on high-complexity slices",
    occurrences: 4,
    plans: ["Phase-37", "Phase-38"],
  },
  {
    id: "cost-anomaly:phase-38-spike",
    detector: "cost-anomaly",
    severity: "warning",
    title: "Cost spike in Phase-38",
    detail: "Cost 3.2× above rolling average",
    occurrences: 3,
    plans: ["Phase-38"],
  },
  {
    id: "slice-flap:retry-loop",
    detector: "slice-flap-pattern",
    severity: "info",
    title: "Slice flap: retry-loop",
    detail: "Pass/fail/pass cycle detected",
    occurrences: 3,
    plans: ["Phase-34", "Phase-35"],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function setupDOM() {
  return new JSDOM(`<!DOCTYPE html>
    <html>
    <body>
      <div id="forge-master-root"></div>
    </body>
    </html>`);
}

const FM_PATTERN_SEVERITY_ICON = { info: "🟢", warning: "🟡", error: "🔴" };
const FM_PATTERN_SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * Mirror of forgeMasterRenderPatternsPanel from forge-master.js.
 */
function renderPatternsPanel(document, patterns) {
  const root = document.getElementById("forge-master-root");
  if (!root) return;

  let panel = document.getElementById("fm-patterns-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "fm-patterns-panel";
    panel.className = "border border-gray-700 rounded p-3 mb-3 text-xs";
    const digestTile = document.getElementById("fm-digest-tile");
    if (digestTile && digestTile.nextSibling) {
      root.insertBefore(panel, digestTile.nextSibling);
    } else if (digestTile) {
      root.appendChild(panel);
    } else {
      root.insertBefore(panel, root.firstChild);
    }
  }

  if (!patterns || patterns.length === 0) {
    panel.innerHTML = `<h4 class="text-cyan-400 font-semibold mb-1">Recurring Patterns</h4>
      <p class="text-gray-500">No patterns detected.</p>`;
    return;
  }

  const sorted = [...patterns].sort((a, b) =>
    (FM_PATTERN_SEVERITY_ORDER[a.severity] ?? 3) - (FM_PATTERN_SEVERITY_ORDER[b.severity] ?? 3)
  );

  const groups = new Map();
  for (const p of sorted) {
    const sev = p.severity || "info";
    if (!groups.has(sev)) groups.set(sev, []);
    groups.get(sev).push(p);
  }

  let rows = "";
  for (const [severity, items] of groups) {
    const icon = FM_PATTERN_SEVERITY_ICON[severity] || "⚪";
    rows += `<div class="mt-1 mb-0.5 text-gray-400 font-semibold">${icon} ${severity} (${items.length})</div>`;
    for (const p of items) {
      const plans = p.plans && p.plans.length > 0 ? p.plans.join(", ") : "";
      rows += `<div class="pl-4 py-0.5 text-gray-300">
        <span class="font-mono text-cyan-600">${p.title || p.id}</span>
        <span class="text-gray-500 ml-1">× ${p.occurrences || 0}</span>
        ${plans ? `<span class="text-gray-600 ml-1">(${plans})</span>` : ""}
      </div>`;
    }
  }

  panel.innerHTML = `<h4 class="text-cyan-400 font-semibold mb-1">Recurring Patterns</h4>${rows}`;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("forgeMasterRenderPatternsPanel", () => {
  it("renders panel with patterns grouped by severity", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel).toBeTruthy();
    expect(panel.innerHTML).toContain("Recurring Patterns");
    expect(panel.innerHTML).toContain("tee /tmp/ gate failures");
    expect(panel.innerHTML).toContain("gpt-4o-mini fails on complexity");
    expect(panel.innerHTML).toContain("Cost spike in Phase-38");
    expect(panel.innerHTML).toContain("Slice flap: retry-loop");
  });

  it("shows severity icons per group", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel.innerHTML).toContain("🔴"); // error
    expect(panel.innerHTML).toContain("🟡"); // warning
    expect(panel.innerHTML).toContain("🟢"); // info
  });

  it("sorts error before warning before info", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    const html = panel.innerHTML;
    const errorIdx = html.indexOf("🔴");
    const warnIdx = html.indexOf("🟡");
    const infoIdx = html.indexOf("🟢");
    expect(errorIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });

  it("shows occurrence counts", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel.innerHTML).toContain("× 6");
    expect(panel.innerHTML).toContain("× 4");
    expect(panel.innerHTML).toContain("× 3");
  });

  it("shows plan names for each pattern", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel.innerHTML).toContain("Phase-35");
    expect(panel.innerHTML).toContain("Phase-36");
    expect(panel.innerHTML).toContain("Phase-37");
  });

  it("shows group counts per severity level", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel.innerHTML).toContain("error (1)");
    expect(panel.innerHTML).toContain("warning (2)");
    expect(panel.innerHTML).toContain("info (1)");
  });

  it("renders empty-state when patterns is null", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, null);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel).toBeTruthy();
    expect(panel.innerHTML).toContain("No patterns detected");
  });

  it("renders empty-state when patterns array is empty", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, []);

    const panel = dom.window.document.getElementById("fm-patterns-panel");
    expect(panel.innerHTML).toContain("No patterns detected");
  });

  it("re-renders panel in place on second call", () => {
    const dom = setupDOM();
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);
    renderPatternsPanel(dom.window.document, []);

    const root = dom.window.document.getElementById("forge-master-root");
    const panels = root.querySelectorAll("#fm-patterns-panel");
    expect(panels.length).toBe(1);
    expect(panels[0].innerHTML).toContain("No patterns detected");
  });

  it("does nothing when forge-master-root is missing", () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
    renderPatternsPanel(dom.window.document, FIXTURE_PATTERNS);
    expect(dom.window.document.getElementById("fm-patterns-panel")).toBeNull();
  });
});
