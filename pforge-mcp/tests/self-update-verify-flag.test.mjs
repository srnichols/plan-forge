/**
 * Plan Forge — pforge self-update --verify flag parity tests.
 *
 * Verifies that `--verify` is parsed and surfaced symmetrically in both
 * shell entry points (pforge.ps1 + pforge.sh) and the dispatcher help text.
 * Mechanical pattern check — does NOT spawn a real update.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const PS1 = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf8");
const SH = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");

describe("pforge self-update --verify (shell parity)", () => {
  it("pforge.ps1 parses --verify alongside --force / --yes / --dry-run", () => {
    expect(PS1).toMatch(/\$verify\s*=\s*\$Arguments\s+-contains\s+'--verify'/);
    expect(PS1).toMatch(/\$forceUpdate\s*=\s*\$Arguments\s+-contains\s+'--force'/);
    expect(PS1).toMatch(/\$dryRun\s*=\s*\$Arguments\s+-contains\s+'--dry-run'/);
  });

  it("pforge.sh parses --verify alongside --force / --yes / --dry-run", () => {
    expect(SH).toMatch(/--verify\)\s+verify=true/);
    expect(SH).toMatch(/--force\)\s+force_heal=true/);
    expect(SH).toMatch(/--dry-run\)\s+dry_run=true/);
    // Single declaration line, all four flags initialised together.
    expect(SH).toMatch(/local auto_yes=false dry_run=false force_heal=false verify=false/);
  });

  it("both shells invoke 'pforge check' and 'pforge smith' as subprocesses when --verify is set", () => {
    // PowerShell side: spawns pwsh against the freshly-updated pforge.ps1.
    expect(PS1).toMatch(/if\s*\(\$verify\)/);
    expect(PS1).toMatch(/pwsh\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+\$pforgeScript\s+check/);
    expect(PS1).toMatch(/pwsh\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\s+\$pforgeScript\s+smith/);

    // Bash side: spawns bash against the freshly-updated pforge.sh.
    expect(SH).toMatch(/if\s+\$verify;\s+then/);
    expect(SH).toMatch(/bash\s+"\$pforge_script"\s+check/);
    expect(SH).toMatch(/bash\s+"\$pforge_script"\s+smith/);
  });

  it("both shells exit non-zero when --verify reports a failure", () => {
    // PowerShell tracks both exit codes and `exit 1` when either is non-zero.
    expect(PS1).toMatch(/\$checkExit\s*=\s*\$LASTEXITCODE/);
    expect(PS1).toMatch(/\$smithExit\s*=\s*\$LASTEXITCODE/);
    expect(PS1).toMatch(/if\s*\(\$checkExit\s+-eq\s+0\s+-and\s+\$smithExit\s+-eq\s+0\)/);

    // Bash captures via `|| check_exit=$?` and `|| smith_exit=$?`, then exits 1.
    expect(SH).toMatch(/bash\s+"\$pforge_script"\s+check\s+\|\|\s+check_exit=\$\?/);
    expect(SH).toMatch(/bash\s+"\$pforge_script"\s+smith\s+\|\|\s+smith_exit=\$\?/);
    expect(SH).toMatch(/\[\s*"\$check_exit"\s+-eq\s+0\s*\]\s+&&\s+\[\s*"\$smith_exit"\s+-eq\s+0\s*\]/);
  });

  it("dispatcher help text in both shells mentions --verify under self-update", () => {
    // PowerShell help block (`Write-Host` line beneath `self-update`).
    expect(PS1).toMatch(/self-update\s+Check for and install[\s\S]{0,200}--verify \(run check \+ smith after\)/);
    // Bash help block (heredoc beneath `self-update`).
    expect(SH).toMatch(/self-update\s+Check for and install[\s\S]{0,200}--verify \(run check \+ smith after\)/);
  });

  it("manual-steps prelude in both shells advertises the --verify behavior", () => {
    expect(PS1).toMatch(/With --verify: run 'pforge check' \+ 'pforge smith' in subprocesses after a successful update/);
    expect(SH).toMatch(/With --verify: run 'pforge check' \+ 'pforge smith' in subprocesses after a successful update/);
  });
});
