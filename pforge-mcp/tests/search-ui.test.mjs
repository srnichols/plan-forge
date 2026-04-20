/**
 * Plan Forge — Phase FORGE-SHOP-04 Slice 04.2: Search bar UI file-contract tests.
 *
 * Pure file-contract tests — pin dashboard source to ensure search bar,
 * results dropdown, CSS classes, keyboard shortcuts, and app.js functions exist.
 * Follows the same pattern as `review-queue-ui.test.mjs` and `forge-shop-home-ui.test.mjs`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

// ─── index.html — Search bar shell ───────────────────────────────────

describe("dashboard/index.html — Search bar shell", () => {
  it("search container exists with data-testid", () => {
    expect(indexHtml).toMatch(/data-testid="search-container"/);
    expect(indexHtml).toMatch(/id="search-container"/);
  });

  it("search input exists with id and data-testid", () => {
    expect(indexHtml).toMatch(/id="global-search"/);
    expect(indexHtml).toMatch(/data-testid="global-search"/);
  });

  it("search input has correct placeholder text", () => {
    expect(indexHtml).toMatch(/placeholder="Search runs, bugs, incidents/);
  });

  it("search input has type=\"search\"", () => {
    expect(indexHtml).toMatch(/type="search"[^>]*id="global-search"/);
  });

  it("keyboard hint (/) element exists", () => {
    expect(indexHtml).toMatch(/id="search-hint"/);
  });

  it("search results dropdown exists with role=listbox", () => {
    expect(indexHtml).toMatch(/id="search-results"/);
    expect(indexHtml).toMatch(/role="listbox"[^>]*data-testid="search-results"/);
  });

  it("search results dropdown is hidden by default", () => {
    const match = indexHtml.match(/<div[^>]*id="search-results"[^>]*>/);
    expect(match).toBeTruthy();
    expect(match[0]).toMatch(/hidden/);
  });

  it("search bar is positioned between logo and right controls", () => {
    const logoIdx = indexHtml.indexOf('🔨</span>');
    const searchIdx = indexHtml.indexOf('id="search-container"');
    const updateIdx = indexHtml.indexOf('id="update-banner"');
    expect(searchIdx).toBeGreaterThan(logoIdx);
    expect(searchIdx).toBeLessThan(updateIdx);
  });
});

// ─── index.html — Search CSS ──────────────────────────────────────────

describe("dashboard/index.html — Search CSS classes", () => {
  it("search-result-item style defined", () => {
    expect(indexHtml).toMatch(/\.search-result-item/);
  });

  it("search-source-badge style defined", () => {
    expect(indexHtml).toMatch(/\.search-source-badge/);
  });

  it("source badge colors defined for all 8 source types", () => {
    for (const source of ["run", "bug", "incident", "review", "plan", "tempering", "memory", "hub-event"]) {
      expect(indexHtml).toMatch(new RegExp(`\\.search-source-badge\\[data-source="${source}"\\]`));
    }
  });

  it("search-snippet mark highlight style defined", () => {
    expect(indexHtml).toMatch(/\.search-snippet mark/);
  });

  it("search-loading style defined", () => {
    expect(indexHtml).toMatch(/\.search-loading/);
  });

  it("search-error style defined", () => {
    expect(indexHtml).toMatch(/\.search-error/);
  });

  it("search-active hover state defined", () => {
    expect(indexHtml).toMatch(/\.search-active/);
  });
});

// ─── app.js — Search functions ────────────────────────────────────────

describe("dashboard/app.js — Search bar functions", () => {
  it("parseSearchSyntax function exists", () => {
    expect(appJs).toMatch(/function parseSearchSyntax\(/);
  });

  it("bindGlobalSearch function exists", () => {
    expect(appJs).toMatch(/function bindGlobalSearch\(/);
  });

  it("bindGlobalSearch is called during init", () => {
    expect(appJs).toMatch(/bindGlobalSearch\(\)/);
  });

  it("searchEscapeHtml function exists (XSS prevention)", () => {
    expect(appJs).toMatch(/function searchEscapeHtml\(/);
  });

  it("highlightTokens function exists", () => {
    expect(appJs).toMatch(/function highlightTokens\(/);
  });

  it("renderSearchResults function exists", () => {
    expect(appJs).toMatch(/function renderSearchResults\(/);
  });

  it("deepLinkResult function exists", () => {
    expect(appJs).toMatch(/function deepLinkResult\(/);
  });

  it("manageSearchHistory function exists", () => {
    expect(appJs).toMatch(/function manageSearchHistory\(/);
  });

  it("getSearchHistory function exists", () => {
    expect(appJs).toMatch(/function getSearchHistory\(/);
  });

  it("/ hotkey listener registered", () => {
    expect(appJs).toMatch(/e\.key === '\/'/);
  });

  it("Escape key handler clears and hides", () => {
    expect(appJs).toMatch(/e\.key === 'Escape'/);
  });

  it("ArrowDown / ArrowUp keyboard navigation exists", () => {
    expect(appJs).toMatch(/e\.key === 'ArrowDown'/);
    expect(appJs).toMatch(/e\.key === 'ArrowUp'/);
  });

  it("debounce uses 150ms timeout", () => {
    expect(appJs).toMatch(/setTimeout\(\(\) => executeSearch\(val\), 150\)/);
  });

  it("AbortController used for request cancellation", () => {
    expect(appJs).toMatch(/AbortController/);
  });

  it("query string truncated to 500 chars", () => {
    expect(appJs).toMatch(/queryStr\.slice\(0, 500\)/);
  });

  it("localStorage key is pforge.search.history", () => {
    expect(appJs).toMatch(/pforge\.search\.history/);
  });

  it("history capped at 5 entries", () => {
    expect(appJs).toMatch(/history\.slice\(0, 5\)/);
  });

  it("fetch calls /api/search endpoint", () => {
    expect(appJs).toMatch(/\/api\/search\?/);
  });

  it("deep-link tab mapping covers all 8 source types", () => {
    // Verify the deepLinkResult tabMap references all source types
    // Some are unquoted JS keys (run, bug), others are quoted ('hub-event')
    for (const src of ["run", "bug", "incident", "review", "plan", "tempering", "memory", "hub-event"]) {
      expect(appJs).toContain(src);
    }
    // Specifically verify the tabMap keys in deepLinkResult
    expect(appJs).toMatch(/run:\s*'runs'/);
    expect(appJs).toMatch(/bug:\s*'bugregistry'/);
    expect(appJs).toMatch(/incident:\s*'lg-incidents'/);
    expect(appJs).toMatch(/'hub-event':\s*'home'/);
  });
});
