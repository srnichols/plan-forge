/**
 * Plan Forge — Phase Hotfix-v2.90.8 Slice 1: Clickable Issue/PR badges in slice card
 *
 * File-contract tests: read dashboard/app.js source and assert the required
 * markup, logic, and accessibility attributes are present. Same pattern used
 * by dashboard-cost-projection.test.mjs and dashboard-launch-controls.test.mjs.
 *
 * Coverage:
 *   - trajectoryHtml replaces plain trajectoryHint
 *   - Clickable <a> badge for issue URL with 🔗 prefix
 *   - Clickable <a> badge for PR URL with ⤴ prefix
 *   - event.stopPropagation() prevents slice-log click bubble
 *   - target="_blank" + rel="noopener noreferrer" on all trajectory links
 *   - Falls back to plain renderHint paragraph when URLs are absent
 *   - Merged PR badge uses purple colour class
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_JS = resolve(HERE, "..", "dashboard", "app.js");

let src = "";
beforeAll(() => {
  src = readFileSync(APP_JS, "utf-8");
});

// ─── Variable naming ─────────────────────────────────────────────────────────

describe("trajectoryHtml variable (Hotfix-v2.90.8 Slice 1)", () => {
  it("declares trajectoryHtml instead of the old trajectoryHint", () => {
    expect(src).toMatch(/let trajectoryHtml\s*=\s*""/);
  });

  it("no longer declares the old trajectoryHint variable", () => {
    expect(src).not.toMatch(/const trajectoryHint\s*=/);
  });

  it("uses trajectoryHtml in the slice-card template", () => {
    expect(src).toContain("${trajectoryHtml}");
  });
});

// ─── Issue badge ─────────────────────────────────────────────────────────────

describe("clickable issue badge (Hotfix-v2.90.8 Slice 1)", () => {
  it("guards on t.issueUrl && t.issueNumber before rendering issue link", () => {
    expect(src).toMatch(/t\.issueUrl\s*&&\s*t\.issueNumber/);
  });

  it("renders an <a> tag with href set to t.issueUrl", () => {
    expect(src).toMatch(/href="\$\{t\.issueUrl\}"/);
  });

  it("includes 🔗 emoji prefix and #issueNumber in the link text", () => {
    expect(src).toMatch(/🔗 #\$\{t\.issueNumber\}/);
  });

  it("includes title attribute referencing issueNumber for accessibility", () => {
    expect(src).toMatch(/title="Open GitHub issue #\$\{t\.issueNumber\}"/);
  });
});

// ─── PR badge ────────────────────────────────────────────────────────────────

describe("clickable PR badge (Hotfix-v2.90.8 Slice 1)", () => {
  it("guards on t.prUrl && t.prNumber before rendering PR link", () => {
    expect(src).toMatch(/t\.prUrl\s*&&\s*t\.prNumber/);
  });

  it("renders an <a> tag with href set to t.prUrl", () => {
    expect(src).toMatch(/href="\$\{t\.prUrl\}"/);
  });

  it("includes ⤴ emoji prefix and PR #prNumber in the link text", () => {
    expect(src).toMatch(/⤴ PR #\$\{t\.prNumber\}/);
  });

  it("includes title attribute with prStatus for accessibility", () => {
    expect(src).toMatch(/title="Open GitHub PR #\$\{t\.prNumber\}/);
  });

  it("uses purple colour class for merged PRs", () => {
    expect(src).toMatch(/prStatus\s*===\s*"merged".*text-purple-400/s);
  });

  it("uses cyan colour class for non-merged PRs", () => {
    // The else branch colour — same as issue badge
    expect(src).toMatch(/prLinkColor.*text-cyan-400/s);
  });
});

// ─── Link safety attributes ───────────────────────────────────────────────────

describe("link safety attributes (Hotfix-v2.90.8 Slice 1)", () => {
  it("adds target=\"_blank\" to trajectory anchor tags", () => {
    // Both issue and PR links must open in a new tab
    const matches = [...src.matchAll(/target="_blank"/g)];
    // At minimum two occurrences — one for issue badge, one for PR badge
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("adds rel=\"noopener noreferrer\" to trajectory anchor tags", () => {
    const matches = [...src.matchAll(/rel="noopener noreferrer"/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("calls event.stopPropagation() to prevent slice-log from opening", () => {
    expect(src).toMatch(/onclick="event\.stopPropagation\(\)"/);
  });
});

// ─── Fallback to plain renderHint ────────────────────────────────────────────

describe("renderHint fallback (Hotfix-v2.90.8 Slice 1)", () => {
  it("renders plain renderHint paragraph when no issue/PR URLs are present", () => {
    // The else if branch for renderHint — same class as original implementation
    expect(src).toMatch(/text-cyan-500.*mt-1 truncate.*\$\{t\.renderHint\}/s);
  });

  it("does not render any trajectory markup when s.trajectory is absent", () => {
    // The guard block: if (s.trajectory) { ... }
    expect(src).toMatch(/if\s*\(\s*s\.trajectory\s*\)/);
  });
});

// ─── Badge container layout ───────────────────────────────────────────────────

describe("badge container row layout (Hotfix-v2.90.8 Slice 1)", () => {
  it("wraps issue+PR links in a flex row with gap", () => {
    expect(src).toMatch(/flex items-center gap-1\.5 mt-1/);
  });

  it("separates issue and PR badges with an arrow separator span", () => {
    expect(src).toMatch(/text-gray-600.*→.*\/span>/s);
  });
});
