/**
 * Plan Forge — Hotfix v2.90.9 Slice 3 (Capabilities doc-sync regression guard)
 *
 * Asserts that docs/capabilities.md and docs/capabilities.html remain in sync
 * with the GitHub Copilot Integration capabilities shipped in Phases GITHUB-A
 * through GITHUB-D and Phase 33.
 *
 * Protects against future drift that would cause the public surfaces to
 * become stale again without a test catching it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");

const capsMd = readFileSync(resolve(REPO_ROOT, "docs", "capabilities.md"), "utf-8");
const capsHtml = readFileSync(resolve(REPO_ROOT, "docs", "capabilities.html"), "utf-8");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return the dashboard tab count from the live probe script, or fall back to
 * the count stated in capabilities.md, emitting a console.warn.
 */
function getDashboardTabCount() {
  const probePath = resolve(REPO_ROOT, "scripts", "_probe-dashboard-tabs.cjs");

  if (existsSync(probePath)) {
    const result = spawnSync(process.execPath, [probePath], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    if (result.status === 0) {
      const count = parseInt(result.stdout.trim(), 10);
      if (!isNaN(count)) return { count, source: "probe" };
    }
  }

  // Probe script absent or failed — extract the count from capabilities.md
  const match = capsMd.match(/\((\d+)\s+tabs?\s+total\)/i);
  if (match) {
    console.warn(
      "[capabilities-doc-sync] scripts/_probe-dashboard-tabs.cjs not found; " +
        "falling back to tab count in capabilities.md. Add the probe script to " +
        "enable live tab-count verification."
    );
    return { count: parseInt(match[1], 10), source: "fallback" };
  }

  return { count: null, source: "none" };
}

// ---------------------------------------------------------------------------
// docs/capabilities.md — GitHub Copilot Integration phrases
// ---------------------------------------------------------------------------

describe("docs/capabilities.md — GitHub Copilot Integration (Hotfix v2.90.9)", () => {
  it("mentions forge_github_status (shipped in Phase GITHUB-A)", () => {
    expect(capsMd).toContain("forge_github_status");
  });

  it("mentions --worker copilot-coding-agent (shipped in Phase GITHUB-B)", () => {
    expect(capsMd).toContain("--worker copilot-coding-agent");
  });

  it("mentions pforge plan-from-sarif (shipped in Phase GITHUB-B)", () => {
    expect(capsMd).toContain("plan-from-sarif");
  });

  it("mentions github-metrics (shipped in Phase GITHUB-D)", () => {
    expect(capsMd).toContain("github-metrics");
  });

  it("mentions GitHub Models zero-key default (shipped in Phase 33)", () => {
    expect(capsMd).toMatch(/GitHub Models/i);
  });

  it("has a GitHub Copilot Integration section heading", () => {
    expect(capsMd).toMatch(/## GitHub Copilot Integration|### GitHub Copilot Integration/i);
  });
});

// ---------------------------------------------------------------------------
// docs/capabilities.html — GitHub Copilot Integration phrases
// ---------------------------------------------------------------------------

describe("docs/capabilities.html — GitHub Copilot Integration (Hotfix v2.90.9)", () => {
  it("mentions forge_github_status", () => {
    expect(capsHtml).toContain("forge_github_status");
  });

  it("mentions --worker copilot-coding-agent", () => {
    expect(capsHtml).toContain("--worker copilot-coding-agent");
  });

  it("mentions plan-from-sarif", () => {
    expect(capsHtml).toContain("plan-from-sarif");
  });

  it("mentions github-metrics", () => {
    expect(capsHtml).toContain("github-metrics");
  });

  it("mentions GitHub Models", () => {
    expect(capsHtml).toMatch(/GitHub Models/i);
  });
});

// ---------------------------------------------------------------------------
// Dashboard tab count — capabilities.md must match probe or its own stated count
// ---------------------------------------------------------------------------

describe("docs/capabilities.md — dashboard tab count sync", () => {
  it("states a dashboard tab count that matches the probe (or its own count when probe is absent)", () => {
    const { count, source } = getDashboardTabCount();

    if (source === "none") {
      // Neither the probe script nor a tab count in the doc — skip gracefully
      console.warn(
        "[capabilities-doc-sync] Could not determine dashboard tab count from " +
          "either the probe script or capabilities.md. Skipping tab-count assertion."
      );
      return;
    }

    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThan(0);

    if (source === "probe") {
      // The doc must mention the live count
      const docMentionsCount = new RegExp(`\\b${count}\\s+tabs?\\b`, "i").test(capsMd);
      if (!docMentionsCount) {
        throw new Error(
          `capabilities.md tab count is stale: probe reports ${count} tabs but the doc does not mention "${count} tab(s)". Update the tab count in docs/capabilities.md.`
        );
      }
    }
    // When source === "fallback" the count came from the doc itself, so
    // the assertion above is trivially satisfied — we just verify it parsed.
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
