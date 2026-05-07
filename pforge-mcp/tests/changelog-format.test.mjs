/**
 * Changelog format regression tests — Hotfix v2.90.6.
 *
 * Guards against format regressions introduced by this cleanup hotfix:
 *   1. No [2.89.x] entries re-appear as properly-bracketed headings.
 *   2. All bracketed [X.Y.Z] headings use em-dash (—) separators, not
 *      hyphen-minus (-) separators.
 *   3. A [2.90.6] heading exists (the cleanup release marker).
 *   4. VERSION file matches pforge-mcp/package.json version.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const changelog = readFileSync(join(REPO_ROOT, "CHANGELOG.md"), "utf8");
const version = readFileSync(join(REPO_ROOT, "VERSION"), "utf8").trim();
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "pforge-mcp", "package.json"), "utf8"));

// All lines that look like a bracketed version heading: ## [X.Y.Z]…
const versionHeadings = changelog
  .split("\n")
  .filter((line) => /^##\s+\[\d+\.\d+\.\d+\]/.test(line));

describe("CHANGELOG.md — no forbidden version headings", () => {
  it("does not contain a [2.89.0] heading", () => {
    const matches = versionHeadings.filter((l) => /\[2\.89\.0\]/.test(l));
    expect(matches, `Found forbidden [2.89.0] heading(s): ${matches.join("; ")}`).toHaveLength(0);
  });

  it("does not contain a [2.89.1] heading", () => {
    const matches = versionHeadings.filter((l) => /\[2\.89\.1\]/.test(l));
    expect(matches, `Found forbidden [2.89.1] heading(s): ${matches.join("; ")}`).toHaveLength(0);
  });
});

describe("CHANGELOG.md — heading format (em-dash required for 2.85.0+ entries)", () => {
  // Scope: only entries introduced in the GitHub-stack era (2.85.0+) and later.
  // Older entries predate this cleanup and are out of scope per the Forbidden
  // Actions in the Hotfix v2.90.6 plan (no modifications to entries older than 2.89.0).
  const MIN_MAJOR = 2;
  const MIN_MINOR = 85;

  const modernHeadingsWithDates = versionHeadings.filter((l) => {
    const m = l.match(/^##\s+\[(\d+)\.(\d+)\.\d+\]/);
    if (!m) return false;
    const major = parseInt(m[1], 10);
    const minor = parseInt(m[2], 10);
    const isModern = major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR);
    return isModern && /\d{4}-\d{2}-\d{2}/.test(l);
  });

  it("has at least one modern dated heading to validate", () => {
    expect(modernHeadingsWithDates.length).toBeGreaterThan(0);
  });

  it("every 2.85.0+ dated version heading uses em-dash (—) separators, not hyphen-minus", () => {
    const violations = modernHeadingsWithDates.filter((line) => {
      // Strip date tokens so hyphens inside YYYY-MM-DD are ignored.
      const withoutDate = line.replace(/\d{4}-\d{2}-\d{2}/g, "DATE");
      return / - /.test(withoutDate);
    });
    expect(
      violations,
      `These headings use hyphen-minus instead of em-dash:\n  ${violations.join("\n  ")}`
    ).toHaveLength(0);
  });
});

describe("CHANGELOG.md — release marker presence", () => {
  // Read the most recently-released version from CHANGELOG.md (first dated
  // bracketed heading after [Unreleased]) and assert it's present. Asserting
  // a hardcoded version number broke every release that didn't remember to
  // bump this file (was: hardcoded 2.90.6 → broke at 2.90.7; bumped to 2.90.10
  // → broke at 2.91.0-dev). Drift-proof check instead.
  const releasedVersionMatch = changelog.match(/##\s+\[(\d+\.\d+\.\d+(?:-[\w.]+)?)\]\s*[—-]/);
  it("contains a properly-formatted released version heading after [Unreleased]", () => {
    expect(
      releasedVersionMatch,
      "CHANGELOG.md must contain at least one ## [X.Y.Z] — heading documenting a shipped release"
    ).not.toBeNull();
  });
});

describe("VERSION and package.json consistency", () => {
  // Don't hardcode a target version — that creates a drift trap on every
  // release. Instead enforce the actual cross-file invariant: VERSION must
  // match pforge-mcp/package.json, and both must be a recognisable
  // semver (clean release or `-dev`).
  it("VERSION file is a valid semver (optionally with -dev suffix)", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });

  it("pforge-mcp/package.json version is a valid semver (optionally with -dev suffix)", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
  });

  it("VERSION file matches pforge-mcp/package.json version (no drift)", () => {
    expect(version).toBe(pkg.version);
  });

  it("when VERSION is a clean release (no -dev), CHANGELOG must contain a matching heading (release-tag invariant)", () => {
    if (/-dev$/.test(version)) {
      // Dev cycles legitimately have no matching CHANGELOG heading until cut.
      return;
    }
    const escaped = version.replace(/\./g, "\\.");
    const re = new RegExp(`##\\s+\\[${escaped}\\]\\s*[—-]`);
    expect(
      re.test(changelog),
      `VERSION reads ${version} (clean release) but CHANGELOG.md has no matching ## [${version}] — heading. Cut the release entry before tagging.`
    ).toBe(true);
  });
});
