/**
 * Unattended updates: `pforge update --yes` applies without prompting, and
 * `pforge self-update --yes` passes that on instead of letting `update` ask a
 * second question nobody can answer.
 *
 * Found upgrading the testbed from 3.29.0-dev to 3.31.1: `self-update --yes
 * --verify` downloaded the release, listed 736 operations, hit update's own
 * "Apply …? [y/N]" prompt with no input, printed "Cancelled.", then ran
 * --verify, reported "check + smith both passed" and exited 0. Nothing had
 * been installed. verify-public always passed `--yes --force`, and --force
 * happens to skip the prompt, so the release checks never saw it.
 */

import { describe, it, expect, afterEach } from "vitest";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const FIXTURE = resolve(import.meta.dirname, "fixtures", "update-plan", "dotnet");
const NEW_SHARED_FILE = ".github/instructions/status-reporting.instructions.md";
const PS1 = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf8");
const SH = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8");

const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function materialize() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-unattended-"));
  tmpDirs.push(base);
  const source = join(base, "source");
  const project = join(base, "project");
  cpSync(join(FIXTURE, "source"), source, { recursive: true });
  cpSync(join(FIXTURE, "project"), project, { recursive: true });
  copyUpdateRuntime(source);
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  return { source, project };
}

/** Run `update` with no input on stdin, as an unattended caller would. */
const shells = [
  ...(BASH ? [{ name: "pforge.sh", run: (project, args) => spawnSync(BASH, ["pforge.sh", "update", ...args], { cwd: project, encoding: "utf-8", input: "", timeout: 180_000 }) }] : []),
  ...(isWin ? [{
    name: "pforge.ps1",
    run: (project, args) => spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", ...args],
      { cwd: project, encoding: "utf-8", input: "", timeout: 180_000 },
    ),
  }] : []),
];

describe.each(shells)("$name update with no input", ({ run }) => {
  it("--yes applies without prompting", () => {
    const { source, project } = materialize();
    const r = run(project, [source, "--yes"]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/Cancelled/);
    expect(r.stdout).toMatch(/Update complete/);
    expect(existsSync(join(project, NEW_SHARED_FILE))).toBe(true);
  });

  it("moves package files the release no longer ships to .forge/update-backups", () => {
    const { source, project } = materialize();
    writeFileSync(join(source, "pforge-mcp", "package.json"), '{"name":"plan-forge-mcp"}\n');
    mkdirSync(join(project, "pforge-mcp", "tests"), { recursive: true });
    writeFileSync(join(project, "pforge-mcp", "tests", "moved-away.test.mjs"), "old\n");
    const r = run(project, [source, "--yes"]);
    expect(r.stdout).toMatch(/REMOVE {2}pforge-mcp\/tests\/moved-away\.test\.mjs/);
    expect(existsSync(join(project, "pforge-mcp", "tests", "moved-away.test.mjs"))).toBe(false);
    const [stamp] = readdirSync(join(project, ".forge", "update-backups"));
    expect(readFileSync(join(project, ".forge", "update-backups", stamp, "pforge-mcp", "tests", "moved-away.test.mjs"), "utf8")).toBe("old\n");
  });

  it("-y is the short form", () => {
    const { source, project } = materialize();
    const r = run(project, [source, "-y"]);
    expect(r.stdout).toMatch(/Update complete/);
  });

  it("without --yes or --force it still asks, and applies nothing when unanswered", () => {
    const { source, project } = materialize();
    const r = run(project, [source]);
    expect(r.stdout).toMatch(/Cancelled/);
    expect(existsSync(join(project, NEW_SHARED_FILE))).toBe(false);
  });
});

describe("Guard: self-update hands its confirmation to update and checks the result", () => {
  const selfUpdate = (src, start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
  const ps1Self = selfUpdate(PS1, "function Invoke-SelfUpdate {", "\nfunction ");
  const shSelf = selfUpdate(SH, "cmd_self_update()", "\n}\n");

  it("pforge.ps1 always passes --yes to update", () => {
    expect(ps1Self).toMatch(/\$updateArgs = @\('--from-github', '--tag', \$latestTag, '--yes'/);
  });

  it("pforge.sh always passes --yes to update", () => {
    expect(shSelf).toMatch(/update_args=\(--from-github --tag "\$latest_tag" --yes/);
  });

  it("both shells re-run update with the new wrapper after replacing it", () => {
    expect(ps1Self).toMatch(/Invoke-SelfUpdateSecondPass/);
    expect(PS1).toMatch(/-File \$pforgeScript update \$script:UpdateSourceDir --force --yes/);
    expect(shSelf).toMatch(/_pf_self_update_second_pass/);
    expect(SH).toMatch(/bash "\$REPO_ROOT\/pforge\.sh" update "\$_PF_UPDATE_SOURCE_DIR" --force --yes/);
  });

  it("pforge.ps1 stops before --verify when nothing was applied", () => {
    const check = ps1Self.indexOf("if (-not $script:UpdateApplied)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(ps1Self.indexOf("if ($verify)"));
  });

  it("pforge.sh stops before --verify when nothing was applied", () => {
    const check = shSelf.indexOf('[ "${_PF_UPDATE_APPLIED:-0}" != 1 ]');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(shSelf.indexOf("if $verify; then"));
  });
});
