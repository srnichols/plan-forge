/**
 * #296 — pforge.ps1 under Windows PowerShell 5.1 with PowerShell 7's PSModulePath.
 *
 * A Node process started from pwsh 7 (VS Code, Copilot CLI, vitest) passes pwsh 7's
 * PSModulePath to the powershell.exe it spawns. Windows PowerShell 5.1 then imports
 * PowerShell 7's Core-only Microsoft.PowerShell.Utility, which lacks 5.1's script
 * functions such as Get-FileHash, so every `pforge update` comparison failed with
 * "The term 'Get-FileHash' is not recognized". (pwsh itself sanitizes the path when
 * it launches powershell.exe, which is why the bug only shows through Node.)
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const PS7_MODULES = isWin ? join(process.env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "Modules") : "";
const canReproduce = isWin && existsSync(join(PS7_MODULES, "Microsoft.PowerShell.Utility"));

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

function seed() {
  const base = mkdtempSync(join(tmpdir(), "pf-ps51-modpath-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, {
    VERSION: "9.9.9",
    "templates/.github/hooks/plan-forge.json": "{\"hooks\":{}}\n",
    "templates/.github/hooks/scripts/check-forbidden.ps1": "'new'\n",
  });
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: "9.9.8", preset: "custom" }),
    ".github/hooks/plan-forge.json": "{\"hooks\":{}}\n",
    ".github/hooks/scripts/check-forbidden.ps1": "'old'\n",
  });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { source, project };
}

/** The environment a Node process launched from pwsh 7 hands to its children. */
function pwsh7ChildEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "psmodulepath"));
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  env.PSModulePath = [
    PS7_MODULES,
    join(programFiles, "PowerShell", "Modules"),
    join(programFiles, "WindowsPowerShell", "Modules"),
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
  ].join(";");
  return env;
}

describe.skipIf(!canReproduce)("#296 pforge.ps1 under Windows PowerShell 5.1 with pwsh 7's PSModulePath", () => {
  it("compares files during update instead of failing on Get-FileHash", () => {
    const { source, project } = seed();
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", source, "--dry-run"],
      { cwd: project, encoding: "utf-8", env: pwsh7ChildEnv(), timeout: 120_000 },
    );
    const output = `${r.stdout}\n${r.stderr}`;
    expect(output).not.toMatch(/Get-FileHash/);
    expect(r.stdout.replace(/\\/g, "/")).toMatch(/UPDATE\s+\.github\/hooks\/scripts\/check-forbidden\.ps1/);
  });
});
