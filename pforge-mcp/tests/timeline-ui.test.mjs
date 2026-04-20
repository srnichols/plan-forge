/**
 * Plan Forge — Phase FORGE-SHOP-05 Slice 05.2: Timeline tab UI file-contract tests.
 *
 * Pure file-contract tests — pin dashboard source to ensure timeline tab button,
 * filter controls, event stream container, and app.js functions exist.
 * Follows the same pattern as `search-ui.test.mjs` and `forge-shop-home-ui.test.mjs`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

// ─── index.html — Timeline tab shell ─────────────────────────────────

describe("dashboard/index.html — Timeline tab shell", () => {
  it("timeline tab button exists with data-testid", () => {
    expect(indexHtml).toMatch(/data-testid="timeline-tab-btn"/);
    expect(indexHtml).toMatch(/data-tab="timeline"/);
  });

  it("timeline tab content section exists", () => {
    expect(indexHtml).toMatch(/id="tab-timeline"/);
  });

  it("timeline tab is hidden by default", () => {
    const match = indexHtml.match(/<section[^>]*id="tab-timeline"[^>]*>/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/hidden/);
  });

  it("has 6 time-window preset chips", () => {
    const chips = indexHtml.match(/timeline-window-chip/g) || [];
    expect(chips.length).toBe(6);
    for (const w of ["15m", "1h", "6h", "24h", "7d", "30d"]) {
      expect(indexHtml).toContain(`data-window="${w}"`);
    }
  });

  it("has 8 source toggle chips", () => {
    const chips = indexHtml.match(/timeline-source-chip/g) || [];
    expect(chips.length).toBe(8);
    for (const src of ["hub-event", "run", "memory", "openbrain", "watch", "tempering", "bug", "incident"]) {
      expect(indexHtml).toContain(`data-testid="timeline-src-${src}"`);
    }
  });

  it("correlation input exists", () => {
    expect(indexHtml).toMatch(/id="timeline-correlation-input"/);
    expect(indexHtml).toMatch(/data-testid="timeline-correlation-input"/);
  });

  it("correlation clear button exists", () => {
    expect(indexHtml).toMatch(/id="timeline-correlation-clear"/);
    expect(indexHtml).toMatch(/data-testid="timeline-correlation-clear"/);
  });

  it("flat and threaded view toggle buttons exist", () => {
    expect(indexHtml).toMatch(/id="timeline-view-flat"/);
    expect(indexHtml).toMatch(/id="timeline-view-threaded"/);
    expect(indexHtml).toMatch(/data-testid="timeline-view-flat"/);
    expect(indexHtml).toMatch(/data-testid="timeline-view-threaded"/);
  });

  it("timeline-stream container exists", () => {
    expect(indexHtml).toMatch(/id="timeline-stream"/);
    expect(indexHtml).toMatch(/data-testid="timeline-stream"/);
  });

  it("auto-refresh checkbox exists", () => {
    expect(indexHtml).toMatch(/id="timeline-auto-refresh"/);
    expect(indexHtml).toMatch(/data-testid="timeline-auto-refresh"/);
  });

  it("stats bar with total, window label, duration exists", () => {
    expect(indexHtml).toMatch(/id="timeline-total"/);
    expect(indexHtml).toMatch(/id="timeline-window-label"/);
    expect(indexHtml).toMatch(/id="timeline-duration"/);
  });

  it("truncated banner exists (hidden by default)", () => {
    const match = indexHtml.match(/<span[^>]*id="timeline-truncated-banner"[^>]*>/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/hidden/);
  });

  it("error state container exists (hidden by default)", () => {
    const match = indexHtml.match(/<div[^>]*id="timeline-error"[^>]*>/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/hidden/);
  });

  it("empty-state text present", () => {
    expect(indexHtml).toContain("No events found. Try widening the time window or removing filters.");
  });

  it("refresh button exists", () => {
    expect(indexHtml).toMatch(/data-testid="timeline-refresh-btn"/);
  });
});

// ─── app.js — Timeline state & functions ──────────────────────────────

describe("dashboard/app.js — Timeline functions", () => {
  it("state.timeline object defined", () => {
    expect(appJs).toContain("timeline: {");
    expect(appJs).toContain("state.timeline");
  });

  it("loadTimelineTab function defined", () => {
    expect(appJs).toMatch(/function loadTimelineTab/);
  });

  it("loadTimelineData function defined", () => {
    expect(appJs).toMatch(/function loadTimelineData/);
  });

  it("renderTimelineFlat function defined", () => {
    expect(appJs).toMatch(/function renderTimelineFlat/);
  });

  it("renderTimelineThreaded function defined", () => {
    expect(appJs).toMatch(/function renderTimelineThreaded/);
  });

  it("filterTimelineByCorrelation function defined", () => {
    expect(appJs).toMatch(/function filterTimelineByCorrelation/);
  });

  it("clearTimelineCorrelation function defined", () => {
    expect(appJs).toMatch(/function clearTimelineCorrelation/);
  });

  it("timelineUpdateHash function syncs URL state", () => {
    expect(appJs).toMatch(/function timelineUpdateHash/);
    expect(appJs).toContain("history.replaceState");
  });

  it("timelineParseHash function reads URL params", () => {
    expect(appJs).toMatch(/function timelineParseHash/);
  });

  it("timelineRelativeTime helper defined", () => {
    expect(appJs).toMatch(/function timelineRelativeTime/);
  });

  it("tabLoadHooks includes timeline", () => {
    expect(appJs).toMatch(/timeline:\s*loadTimelineTab/);
  });

  it("teardown clears timeline refresh timer on tab switch", () => {
    expect(appJs).toContain("state.timeline.refreshTimer");
    expect(appJs).toMatch(/clearInterval\(state\.timeline\.refreshTimer\)/);
  });

  it("auto-refresh interval is 10 seconds", () => {
    expect(appJs).toContain("10_000");
  });

  it("fetches /api/timeline endpoint", () => {
    expect(appJs).toContain("/api/timeline");
  });

  it("renders source icons for all 8 sources", () => {
    for (const src of ["hub-event", "run", "memory", "openbrain", "watch", "tempering", "bug", "incident"]) {
      expect(appJs).toContain(`"${src}"`);
    }
  });

  it("uses searchEscapeHtml for XSS prevention", () => {
    expect(appJs).toContain("searchEscapeHtml(");
  });

  it("deep-link hash listener for #timeline", () => {
    expect(appJs).toContain('#timeline');
    expect(appJs).toMatch(/hash\.startsWith.*#timeline/);
  });

  it("TIMELINE_WINDOW_MS has all 6 presets", () => {
    for (const w of ["15m", "1h", "6h", "24h", "7d", "30d"]) {
      expect(appJs).toContain(`"${w}"`);
    }
  });

  it("window globals are exported", () => {
    expect(appJs).toContain("window.loadTimelineData");
    expect(appJs).toContain("window.filterTimelineByCorrelation");
    expect(appJs).toContain("window.clearTimelineCorrelation");
  });
});
