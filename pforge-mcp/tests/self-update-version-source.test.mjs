/**
 * Plan Forge — self-update version-source parity tests.
 *
 * Regression for the "consumer VERSION collision" meta-bug: a consumer project
 * that tracks its own application version in a root `VERSION`
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
 * (1) is a source pattern check; (2) runs update-plan.mjs's planner.
 */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlan } from "../update-plan.mjs";

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
    // #297: read through json_get (node), which also works in Git Bash on Windows.
    expect(SH).toMatch(/current_version="\$\(json_get "\$REPO_ROOT\/\.forge\.json" templateVersion\)"/);
    // The old bug: `current_version="$(cat "$REPO_ROOT/VERSION" ...)"` must be gone.
    expect(SH).not.toMatch(/current_version="\$\(cat "\$REPO_ROOT\/VERSION" \| tr -d/);
  });
});

// Since #299 both shells take their file list from update-plan.mjs, so check
// the plan itself: a source with a root VERSION file and a project with its own
// must never produce an operation on VERSION.
describe("pforge update does not copy a root VERSION file into the consumer project", () => {
  it("update-plan.mjs never plans an operation on VERSION", () => {
    const base = mkdtempSync(join(tmpdir(), "pf-version-source-"));
    try {
      const source = join(base, "source");
      const project = join(base, "project");
      for (const [root, files] of [
        [source, { VERSION: "9.9.9\n", "pforge.ps1": "# new\n", "pforge.sh": "# new\n" }],
        [project, { VERSION: "3.32.0\n", ".forge.json": JSON.stringify({ templateVersion: "9.9.8", preset: "custom" }) }],
      ]) {
        for (const [rel, text] of Object.entries(files)) {
          mkdirSync(join(root, rel, ".."), { recursive: true });
          writeFileSync(join(root, rel), text);
        }
      }
      const plan = buildPlan({ sourceRoot: source, projectRoot: project });
      expect(plan.operations.map((op) => op.dst)).toContain("pforge.ps1");
      expect(plan.operations.filter((op) => op.dst === "VERSION" || op.src === "VERSION")).toEqual([]);
      expect(readFileSync(join(project, "VERSION"), "utf8")).toBe("3.32.0\n");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
