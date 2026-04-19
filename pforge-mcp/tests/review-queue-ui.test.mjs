/**
 * Plan Forge — Phase FORGE-SHOP-02 Slice 02.2: Review queue UI file-contract tests.
 *
 * Pure file-contract tests — pin dashboard source to ensure Review tab,
 * filter chips, panes, action buttons, and testids exist.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

// ─── index.html — Review tab shell ───────────────────────────────────

describe("dashboard/index.html — Review tab shell", () => {
  it("Review tab button exists with data-tab=\"review\" between Home and Crucible", () => {
    expect(indexHtml).toMatch(/data-testid="review-tab-btn"/);
    const homeIdx = indexHtml.indexOf('data-tab="home"');
    const reviewIdx = indexHtml.indexOf('data-tab="review"');
    const progressIdx = indexHtml.indexOf('data-tab="progress"');
    expect(reviewIdx).toBeGreaterThan(homeIdx);
    expect(reviewIdx).toBeLessThan(progressIdx);
  });

  it("<section id=\"tab-review\"> exists", () => {
    expect(indexHtml).toMatch(/id="tab-review"/);
  });

  it("Review pane is between Home and Progress sections", () => {
    const homeIdx = indexHtml.indexOf('id="tab-home"');
    const reviewIdx = indexHtml.indexOf('id="tab-review"');
    const progressIdx = indexHtml.indexOf('id="tab-progress"');
    expect(reviewIdx).toBeGreaterThan(homeIdx);
    expect(reviewIdx).toBeLessThan(progressIdx);
  });

  it("filter chip bar has correct testid", () => {
    expect(indexHtml).toMatch(/data-testid="review-filter-bar"/);
  });

  it("5 source filter chips exist", () => {
    for (const src of ["crucible-stall", "tempering-quorum-inconclusive", "tempering-baseline", "bug-classify", "fix-plan-approval"]) {
      expect(indexHtml).toMatch(new RegExp(`data-testid="review-chip-source-${src}"`));
    }
  });

  it("4 severity filter chips exist", () => {
    for (const sev of ["blocker", "high", "medium", "low"]) {
      expect(indexHtml).toMatch(new RegExp(`data-testid="review-chip-severity-${sev}"`));
    }
  });

  it("3 status filter chips exist", () => {
    for (const st of ["open", "resolved", "deferred"]) {
      expect(indexHtml).toMatch(new RegExp(`data-testid="review-chip-status-${st}"`));
    }
  });

  it("open status chip is default active", () => {
    const chipMatch = indexHtml.match(/<button[^>]*data-testid="review-chip-status-open"[^>]*>/);
    expect(chipMatch).toBeTruthy();
    expect(chipMatch[0]).toMatch(/tab-active/);
  });

  it("two-pane layout with review-list-pane and review-detail-pane", () => {
    expect(indexHtml).toMatch(/id="review-list-pane"/);
    expect(indexHtml).toMatch(/id="review-detail-pane"/);
  });

  it("empty state text is correct", () => {
    expect(indexHtml).toMatch(/data-testid="review-empty-state"/);
    expect(indexHtml).toContain("🧹 Shop floor clear — no pending reviews");
  });
});

// ─── app.js — Review queue functions ────────────────────────────────

describe("dashboard/app.js — Review queue integration", () => {
  it("state.review is initialized with correct defaults", () => {
    expect(appJs).toMatch(/review:\s*\{/);
    expect(appJs).toContain('status: ["open"]');
  });

  it("tabLoadHooks includes review", () => {
    expect(appJs).toMatch(/review:\s*loadReviewQueue/);
  });

  it("loadReviewQueue function exists", () => {
    expect(appJs).toMatch(/async\s+function\s+loadReviewQueue/);
  });

  it("renderReviewPanel function exists", () => {
    expect(appJs).toMatch(/function\s+renderReviewPanel/);
  });

  it("renderReviewList function exists", () => {
    expect(appJs).toMatch(/function\s+renderReviewList/);
  });

  it("renderReviewDetail function exists", () => {
    expect(appJs).toMatch(/function\s+renderReviewDetail/);
  });

  it("handleReviewAction function exists", () => {
    expect(appJs).toMatch(/async\s+function\s+handleReviewAction/);
  });

  it("switchToReviewTab function exists", () => {
    expect(appJs).toMatch(/function\s+switchToReviewTab/);
  });

  it("15s refresh interval is set", () => {
    expect(appJs).toMatch(/setInterval\(loadReviewQueue,\s*15[_0]*\)/);
  });

  it("review timer is cleared on tab switch", () => {
    expect(appJs).toMatch(/state\.review\.refreshTimer/);
    expect(appJs).toMatch(/clearInterval\(state\.review\.refreshTimer\)/);
  });

  it("document.hidden check exists for blur-pause", () => {
    expect(appJs).toMatch(/document\.hidden/);
  });

  it("action buttons use correct testids in renderReviewDetail", () => {
    expect(appJs).toMatch(/review-action-approve/);
    expect(appJs).toMatch(/review-action-reject/);
    expect(appJs).toMatch(/review-action-defer/);
  });

  it("ERR_ALREADY_RESOLVED is handled", () => {
    expect(appJs).toMatch(/ERR_ALREADY_RESOLVED/);
  });

  it("renderActiveRunsQuadrant shows openReviews sub-count", () => {
    expect(appJs).toMatch(/data-testid="home-open-reviews"/);
    expect(appJs).toMatch(/openReviews/);
  });

  it("home-open-reviews link calls switchToReviewTab", () => {
    expect(appJs).toMatch(/switchToReviewTab\(/);
  });
});
