/**
 * Plan Forge — Phase FORGE-SHOP-01 Slice 01.2: Home tab UI file-contract tests.
 *
 * Pure file-contract tests — we pin the dashboard source to make sure the
 * Home tab button, section, quadrants, activity feed, and drill-through
 * wiring cannot be accidentally regressed. Follows the same pattern as
 * `tempering-dashboard.test.mjs` and `crucible-dashboard.test.mjs`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

// ─── index.html — Home tab shell ──────────────────────────────────────

describe("dashboard/index.html — Home tab shell", () => {
  it("Home tab button exists with data-tab=\"home\" and is first child of #subtabs-forge", () => {
    // The Home button must be the first <button> inside #subtabs-forge
    const subtabsMatch = indexHtml.match(/id="subtabs-forge"[^>]*>[\s]*<button[^>]*data-tab="home"/);
    expect(subtabsMatch).toBeTruthy();
    expect(indexHtml).toMatch(/data-testid="home-tab-btn"/);
  });

  it("Home tab button has tab-active class (default active)", () => {
    const homeBtn = indexHtml.match(/<button[^>]*data-tab="home"[^>]*>/);
    expect(homeBtn).toBeTruthy();
    expect(homeBtn[0]).toMatch(/tab-active/);
  });

  it("<section id=\"tab-home\"> exists before #tab-progress", () => {
    const homeIdx = indexHtml.indexOf('id="tab-home"');
    const progressIdx = indexHtml.indexOf('id="tab-progress"');
    expect(homeIdx).toBeGreaterThan(-1);
    expect(progressIdx).toBeGreaterThan(-1);
    expect(homeIdx).toBeLessThan(progressIdx);
  });

  it("all 4 quadrants have correct IDs, role=\"region\", aria-labelledby, data-testid", () => {
    for (const name of ["crucible", "runs", "liveguard", "tempering"]) {
      expect(indexHtml).toMatch(new RegExp(`id="home-q-${name}"`));
      expect(indexHtml).toMatch(new RegExp(`data-testid="home-q-${name}"`));
      expect(indexHtml).toMatch(new RegExp(`aria-labelledby="home-q-${name}-label"`));
      // role="region" on the quadrant div
      const quadrant = indexHtml.match(new RegExp(`<div[^>]*id="home-q-${name}"[^>]*>`));
      expect(quadrant).toBeTruthy();
      expect(quadrant[0]).toMatch(/role="region"/);
    }
  });

  it("4 drill-through buttons with data-testid=\"home-drill-{name}\"", () => {
    for (const name of ["crucible", "runs", "liveguard", "tempering"]) {
      expect(indexHtml).toMatch(new RegExp(`data-testid="home-drill-${name}"`));
    }
  });

  it("activity feed has role=\"log\" and aria-live=\"polite\"", () => {
    const feed = indexHtml.match(/<div[^>]*id="home-activity-feed"[^>]*>/);
    expect(feed).toBeTruthy();
    expect(feed[0]).toMatch(/role="log"/);
    expect(feed[0]).toMatch(/aria-live="polite"/);
    expect(indexHtml).toMatch(/data-testid="home-activity-feed"/);
  });

  it("group-by toggle has data-testid=\"home-group-toggle\"", () => {
    expect(indexHtml).toMatch(/data-testid="home-group-toggle"/);
  });
});

// ─── app.js — Home wiring ─────────────────────────────────────────────

describe("dashboard/app.js — Home tab wiring", () => {
  it("defines loadHomeSnapshot, renderHomePanel, renderActivityFeed, applyFilter", () => {
    expect(appJs).toMatch(/async\s+function\s+loadHomeSnapshot/);
    expect(appJs).toMatch(/function\s+renderHomePanel/);
    expect(appJs).toMatch(/function\s+renderActivityFeed/);
    expect(appJs).toMatch(/function\s+applyFilter/);
  });

  it("POSTs to /api/tool/forge_home_snapshot", () => {
    expect(appJs).toMatch(/\/api\/tool\/forge_home_snapshot/);
  });

  it("tabLoadHooks registers home", () => {
    expect(appJs).toMatch(/home:\s*loadHomeSnapshot/);
  });

  it("drill-through wiring calls applyFilter", () => {
    // index.html drill-through buttons call applyFilter
    expect(indexHtml).toMatch(/onclick="applyFilter\(/);
  });

  it("escHtml used in activity feed rendering path", () => {
    // The renderActivityFeed function must use escHtml for XSS safety
    const feedFn = appJs.match(/function\s+renderActivityFeed[\s\S]*?^}/m);
    expect(feedFn).toBeTruthy();
    expect(feedFn[0]).toMatch(/escHtml/);
  });
});
