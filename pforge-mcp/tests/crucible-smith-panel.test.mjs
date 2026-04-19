/**
 * Plan Forge — Crucible Smith panel + setup banner (Phase CRUCIBLE-02 Slice 02.2).
 *
 * We can't execute `pforge smith` in a cross-platform test (requires a Windows
 * PowerShell host *and* a bash host), so we pin the contract at the
 * file-content level. This mirrors the pattern used by
 * `crucible-dashboard.test.mjs` for static assets.
 *
 * What we're guarding:
 *   1. Both pforge entry points emit a `Crucible:` section
 *   2. Both enumerate smelts, differentiate finalized / in-progress / abandoned
 *   3. Both warn on smelts that have been idle ≥ 7 days
 *   4. Both setup scripts carry the one-line Crucible onboarding hint
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const ps1 = readFileSync(resolve(repoRoot, "pforge.ps1"), "utf-8");
const sh = readFileSync(resolve(repoRoot, "pforge.sh"), "utf-8");
const setupPs1 = readFileSync(resolve(repoRoot, "setup.ps1"), "utf-8");
const setupSh = readFileSync(resolve(repoRoot, "setup.sh"), "utf-8");

describe("pforge smith — Crucible section (Slice 02.2)", () => {
  it("pforge.ps1 renders a Crucible: header", () => {
    expect(ps1).toMatch(/Write-Host "Crucible:" -ForegroundColor Cyan/);
  });

  it("pforge.ps1 counts smelts and splits by status", () => {
    // The summary line must call out all three smelt lifecycle statuses so
    // operators can spot an imbalance at a glance.
    expect(ps1).toMatch(/finalized.*in-progress.*abandoned/);
    // Skip config.json + phase-claims.json when enumerating smelts
    expect(ps1).toContain('"config.json", "phase-claims.json"');
  });

  it("pforge.ps1 surfaces stalled in-progress smelts (7-day cutoff)", () => {
    expect(ps1).toContain("AddDays(-7)");
    expect(ps1).toMatch(/idle for 7\+ days/);
  });

  it("pforge.ps1 reports on Crucible config, manual-imports log, phase claims", () => {
    expect(ps1).toMatch(/Crucible config present/);
    expect(ps1).toMatch(/manual-import bypass/);
    expect(ps1).toMatch(/phase number\(s\) claimed atomically/);
  });

  it("pforge.sh renders a Crucible: header", () => {
    expect(sh).toMatch(/echo "Crucible:"/);
  });

  it("pforge.sh counts smelts and splits by status", () => {
    expect(sh).toMatch(/finalized.*in-progress.*abandoned/);
    // Same skip list as ps1 so the two stay behaviorally equivalent
    expect(sh).toMatch(/config\.json\|phase-claims\.json/);
  });

  it("pforge.sh surfaces stalled in-progress smelts (7-day cutoff)", () => {
    // 7 * 24 * 60 * 60 = 604800 seconds
    expect(sh).toMatch(/7\*24\*60\*60/);
    expect(sh).toMatch(/idle for 7\+ days/);
  });

  it("pforge.sh reports on Crucible config, manual-imports log, phase claims", () => {
    expect(sh).toMatch(/Crucible config present/);
    expect(sh).toMatch(/manual-import bypass/);
    expect(sh).toMatch(/phase number\(s\) claimed atomically/);
  });

  it("both implementations agree on the empty-state message", () => {
    expect(ps1).toContain("forge_crucible_submit' to start the funnel");
    expect(sh).toContain("forge_crucible_submit' to start the funnel");
  });
});

describe("setup scripts — Crucible onboarding banner (Slice 02.2)", () => {
  it("setup.ps1 carries the one-line Crucible onboarding hint", () => {
    // Single line — stays light-weight so we don't crowd the post-install output
    expect(setupPs1).toMatch(/Start your first plan the Crucible way/);
    expect(setupPs1).toContain("forge_crucible_submit");
  });

  it("setup.sh carries the one-line Crucible onboarding hint", () => {
    expect(setupSh).toMatch(/Start your first plan the Crucible way/);
    expect(setupSh).toContain("forge_crucible_submit");
  });

  it("banner lives inside the 'Optional (recommended)' block, not 'Next steps'", () => {
    // Keeps the required-steps list short. The Crucible hint is a nudge, not
    // a mandatory checklist item — so it must sit in the optional block.
    const psOptionalSection = setupPs1.slice(setupPs1.indexOf("Optional (recommended):"));
    const shOptionalSection = setupSh.slice(setupSh.indexOf("Optional (recommended):"));
    expect(psOptionalSection).toMatch(/Start your first plan the Crucible way/);
    expect(shOptionalSection).toMatch(/Start your first plan the Crucible way/);
  });
});
