/**
 * #299 / Phase-UPDATE-CORE Slice 1 — characterize today's `pforge update`.
 *
 * `pforge update` is implemented twice: `Invoke-Update` in `pforge.ps1` and
 * `cmd_update` in `pforge.sh`. Before Slice 2 moves both shells onto a shared
 * `pforge-mcp/update-plan.mjs`, this test records what the two shells report
 * *today* for five stack configurations, so later slices can diff their new
 * behaviour against a known baseline instead of guessing.
 *
 * Each fixture under `pforge-mcp/tests/fixtures/update-plan/<case>/` ships a
 * "source" (template) tree and a "project" (installed) tree with exactly two
 * guidance differences:
 *   - an internal instruction (`git-workflow.instructions.md`) the project
 *     has hand-edited — both shells must report it `KEEP`.
 *   - a shared instruction (`status-reporting.instructions.md`) the project
 *     does not have at all — Bash's `_pf_check` always queues a missing
 *     guidance file as `NEW`; PowerShell's `Invoke-Update` shared/internal
 *     instruction loop only offers a file the project already has
 *     (`Test-Path $dstFile`), so it reports nothing. This is the one
 *     documented parity gap (Phase-UPDATE-CORE-PLAN.md, D1) this test allows.
 *
 * No other guidance category (prompts, agents, skills, hooks, runbook docs,
 * presets) is populated in the fixtures, so every other scan is a no-op in
 * both shells; the only non-gap operations either shell can report are the
 * `pforge-mcp/*` auto-discovery entries the update guard itself requires
 * (symmetric in both shells, so they never show up as a difference).
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const FIXTURES_ROOT = resolve(import.meta.dirname, "fixtures", "update-plan");

const isWin = process.platform === "win32";
const GIT_BASH = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

const CASES = ["dotnet", "typescript", "dotnet-azure-iac", "no-forge-json", "custom"];

const EDITED_GUIDANCE_LINE = "KEEP .github/instructions/git-workflow.instructions.md";

// The one difference Slice 1 recorded (Phase-UPDATE-CORE-PLAN.md D1): Bash
// reported the shared instruction the project lacks as NEW; PowerShell never
// offered an internal/shared instruction the project did not already have, so
// it reported nothing for that file. Slice 3 closes this gap the moment
// `Invoke-Update` moves onto `update-plan.mjs` — the same module Bash's
// `cmd_update` will adopt in Slice 4 — so both shells already agree here,
// ahead of Slice 6's full "both shells, whole update" coherence pass.
const KNOWN_BASH_ONLY_LINES = [];

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Copy a fixture case into a scratch dir and wire in the shared infra both shells need to run. */
function materialize(caseName) {
  const fixtureDir = join(FIXTURES_ROOT, caseName);
  const base = mkdtempSync(join(tmpdir(), `pf-update-plan-${caseName}-`));
  tmpDirs.push(base);
  const source = join(base, "source");
  const project = join(base, "project");
  cpSync(join(fixtureDir, "source"), source, { recursive: true });
  cpSync(join(fixtureDir, "project"), project, { recursive: true });

  // Always the repo's real update guard, preset detector and update-plan
  // module (#299, Slice 3: Invoke-Update now shells out to update-plan.mjs
  // for every case, not just no-forge-json) — never a fixture copy — so this
  // baseline can never drift from the scan behaviour the rest of the suite
  // exercises.
  mkdirSync(join(source, "pforge-mcp", "orchestrator"), { recursive: true });
  for (const rel of ["update-guard.mjs", "detect-preset.mjs", "migrate-forge-config.mjs", "update-plan.mjs", "preset-catalog.json"]) {
    copyFileSync(join(REPO_ROOT, "pforge-mcp", rel), join(source, "pforge-mcp", rel));
  }
  copyFileSync(
    join(REPO_ROOT, "pforge-mcp", "orchestrator", "constants.mjs"),
    join(source, "pforge-mcp", "orchestrator", "constants.mjs"),
  );

  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });

  return { source, project };
}

function runners() {
  const list = [];
  if (BASH) {
    list.push({
      name: "pforge.sh",
      run: (project, args) => spawnSync(BASH, ["pforge.sh", "update", ...args], { cwd: project, encoding: "utf-8", timeout: 180_000 }),
    });
  }
  if (isWin) {
    list.push({
      name: "pforge.ps1",
      run: (project, args) => spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", ...args],
        { cwd: project, encoding: "utf-8", timeout: 180_000 },
      ),
    });
  }
  return list;
}

/** Parse "  UPDATE  <path>" / "  NEW  <path>" / "  KEEP  <path> (...)" lines into a sorted, deduped "ACTION path" list. */
function parseReport(stdout) {
  const normalized = stdout.replace(/\r\n/g, "\n").replace(/\\/g, "/");
  const lines = new Set();
  for (const line of normalized.split("\n")) {
    const m = line.match(/^\s*(UPDATE|NEW|KEEP)\s+(\S+)/);
    if (m) lines.add(`${m[1]} ${m[2]}`);
  }
  return [...lines].sort();
}

describe.each(CASES)("update-plan baseline: %s", (caseName) => {
  it("records each shell's sorted UPDATE/NEW/KEEP lines and checks the documented gap", () => {
    const { source, project } = materialize(caseName);
    const active = runners();
    expect(active.length, "neither pforge.sh nor pforge.ps1 could be run on this machine").toBeGreaterThan(0);

    const results = {};
    for (const { name, run } of active) {
      const r = run(project, [source, "--dry-run"]);
      expect(r.status, `${name} exited non-zero.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
      results[name] = parseReport(r.stdout);
    }

    writeFileSync(
      join(FIXTURES_ROOT, caseName, `${caseName}.baseline.json`),
      `${JSON.stringify(results, null, 2)}\n`,
    );

    // The hand-edited guidance file is always kept, regardless of shell or stack.
    for (const [name, list] of Object.entries(results)) {
      expect(list, `${name} did not KEEP the edited guidance file`).toContain(EDITED_GUIDANCE_LINE);
    }

    if (!results["pforge.sh"] || !results["pforge.ps1"]) return; // only one shell runnable here — nothing to diff

    const bashOnly = results["pforge.sh"].filter((l) => !results["pforge.ps1"].includes(l));
    const psOnly = results["pforge.ps1"].filter((l) => !results["pforge.sh"].includes(l));

    expect(psOnly, "pforge.ps1 reported a line pforge.sh did not — an undocumented gap").toEqual([]);
    expect(bashOnly.sort()).toEqual([...KNOWN_BASH_ONLY_LINES].sort());
  });
});
