/**
 * Plan Forge — self-update version-source parity tests.
 *
 * Regression for the "consumer VERSION collision" meta-bug: a consumer project
 * (e.g. Rummag) that tracks its own application version in a root `VERSION`
 * file (3.32.0) had that file misread by `pforge self-update` as Plan Forge's
 * installed version, which then blocked the update as a false downgrade against
 * the real latest release (3.22.x).
 *
 * Two invariants keep this fixed:
 *   1. self-update sources the installed version from .forge.json's
 *      templateVersion, NOT the project-root VERSION file.
 *   2. `pforge update` no longer copies a root VERSION file into the consumer
 *      project (it would clobber the consumer's own version file).
 *
 * Mechanical pattern check — does NOT spawn a real update.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PS1 = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf8");
const SH = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");

describe("self-update sources the installed version from .forge.json templateVersion", () => {
  it("pforge.ps1 reads templateVersion (with a VERSION fallback), not VERSION directly", () => {
    // The self-update check must prefer .forge.json templateVersion.
    expect(PS1).toMatch(/if \(\$tvCfg\.templateVersion\) \{ \$currentVersion = /);
    // The old bug: reading the project-root VERSION straight into $currentVersion
    // as the sole source must be gone from the self-update path.
    expect(PS1).not.toMatch(
      /Checking for updates \(force refresh\)[\s\S]{0,600}\$currentVersion = \(Get-Content \(Join-Path \$RepoRoot "VERSION"\) -Raw\)\.Trim\(\)\r?\n\s*\$checkResult/
    );
  });

  it("pforge.sh reads templateVersion (with a VERSION fallback), not VERSION directly", () => {
    // Self-update uses the '' default, distinct from Invoke-Update's 'unknown'.
    expect(SH).toMatch(/get\('templateVersion',''\)/);
    // The old bug: `current_version="$(cat "$REPO_ROOT/VERSION" ...)"` must be gone.
    expect(SH).not.toMatch(/current_version="\$\(cat "\$REPO_ROOT\/VERSION" \| tr -d/);
  });
});

describe("pforge update does not copy a root VERSION file into the consumer project", () => {
  it("pforge.ps1 core-file copy loop omits VERSION", () => {
    expect(PS1).toMatch(/foreach \(\$cliFile in @\("pforge\.ps1", "pforge\.sh", "pforge"\)\)/);
    expect(PS1).not.toMatch(/@\("pforge\.ps1", "pforge\.sh", "pforge", "VERSION"\)/);
  });

  it("pforge.sh core-file copy loop omits VERSION", () => {
    expect(SH).toMatch(
      /for core_file in "pforge\.ps1" "pforge\.sh" "pforge" "validate-setup\.ps1" "validate-setup\.sh"; do/
    );
    expect(SH).not.toMatch(/"pforge\.sh" "pforge" "VERSION" "validate-setup/);
  });
});
