/**
 * The PowerShell scripts under scripts/ are maintainer tools, and they run in Windows PowerShell 5.1 as well as in
 * PowerShell 7, the way setup.ps1 does (#417).
 *
 * Four did not. sync-master, memory-qa-smoke, sequence-plans and validate-action were UTF-8 without a byte order
 * mark, which 5.1 reads in the system code page, so an em dash inside a string ended it and the file did not
 * parse. validate-action also used the PowerShell 7 ternary and started `pwsh`, memory-qa-smoke called
 * Invoke-WebRequest without -UseBasicParsing, and the Pester tests of sequence-plans gave Join-Path three
 * arguments.
 *
 * Running validate-action turned up two bugs of its own: the analyze score was always read as 0 (-match on an
 * array of lines does not fill $Matches), and a sweep that found markers always failed, because $SweepFail is a
 * [string] parameter and "False" is truthy.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const SCAN = join(import.meta.dirname, "helpers", "ps51-compat-scan.ps1");
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const SHELLS = [
  { name: "pwsh", exe: "pwsh", available: PWSH_OK },
  { name: "Windows PowerShell 5.1", exe: "powershell.exe", available: isWin },
];

const tracked = spawnSync("git", ["ls-files", "scripts/*.ps1", "scripts/*.psm1"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const SCRIPTS = [...new Set(tracked)].sort();

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
const shellArgs = (exe) => ["-NoProfile", "-NonInteractive", ...(exe === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : [])];

function scan(files) {
  const dir = tempDir("pf-ps51-scan-");
  const list = join(dir, "list.txt");
  writeFileSync(list, files.join("\n"));
  const run = spawnSync("pwsh", [...shellArgs("pwsh"), "-File", SCAN, list], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  return run.stdout.split(/\r?\n/).filter(Boolean);
}

describe("the scripts under scripts/ can be read by Windows PowerShell 5.1", () => {
  it("finds the scripts it is about", () => {
    expect(SCRIPTS).toContain("scripts/sync-master.ps1");
    expect(SCRIPTS).toContain("scripts/validate-action.ps1");
    expect(SCRIPTS).toContain("scripts/sequence-plans.psm1");
    expect(SCRIPTS).toContain("scripts/tests/sequence-plans.tests.ps1");
  });

  it("starts every script that has non-ASCII text with a UTF-8 byte order mark, which is how 5.1 knows it is not in the system code page", () => {
    const withoutBom = SCRIPTS.filter((file) => {
      const bytes = readFileSync(join(REPO_ROOT, file));
      const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      return bytes.some((byte) => byte > 0x7f) && !hasBom;
    });
    expect(withoutBom).toEqual([]);
  });

  it.skipIf(!PWSH_OK)("uses nothing that only PowerShell 6 or 7 has: ternaries, ??, pipeline chains, -AsHashtable, a third Join-Path argument, Invoke-WebRequest without -UseBasicParsing", () => {
    const findings = scan(SCRIPTS.map((file) => join(REPO_ROOT, file))).map((line) => line.replace(REPO_ROOT, ""));
    expect(findings).toEqual([]);
  });

  it.skipIf(!PWSH_OK)("is found by the scan above when it has what it looks for, and not otherwise", () => {
    const dir = tempDir("pf-ps51-fixture-");
    const bad = join(dir, "bad.ps1");
    writeFileSync(
      bad,
      [
        "$x = $true ? 1 : 2",
        "$y = $null ?? 'a'",
        "Join-Path $a 'b' 'c'",
        "Join-Path (Join-Path $a 'b') 'c'",
        "Join-Path -Path $a -ChildPath 'b'",
        "Invoke-WebRequest -Uri 'http://example.test'",
        "Invoke-WebRequest -UseBasicParsing -Uri 'http://example.test'",
        "'{}' | ConvertFrom-Json -AsHashtable",
        "git status && git log",
        "",
      ].join("\n"),
    );
    const seven = join(dir, "seven.ps1");
    writeFileSync(seven, "#Requires -Version 7.0\n$x = $true ? 1 : 2\n");
    const found = scan([bad, seven]).map((line) => line.split("|").slice(1, 3).join(":"));
    expect(found).toEqual([
      "1:powershell-7-syntax",
      "2:powershell-7-syntax",
      "3:join-path-three-arguments",
      "6:invoke-webrequest-without-basic-parsing",
      "8:powershell-7-parameter",
      "9:powershell-7-syntax",
    ]);
  });

  it.skipIf(!isWin)("parses without errors in Windows PowerShell 5.1", () => {
    const dir = tempDir("pf-ps51-parse-");
    const list = join(dir, "list.txt");
    const out = join(dir, "out.txt");
    writeFileSync(list, SCRIPTS.map((file) => join(REPO_ROOT, file)).join("\n"));
    const driver = join(dir, "parse.ps1");
    writeFileSync(
      driver,
      `\uFEFF${[
        "param([string]$List, [string]$Out)",
        "$lines = foreach ($path in Get-Content -LiteralPath $List -Encoding UTF8) {",
        "  $t = $null; $e = $null",
        "  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)",
        '  "{0}|{1}|{2}" -f $e.Count, $path, $(if ($e.Count) { "L$($e[0].Extent.StartLineNumber): $($e[0].Message)" } else { "" })',
        "}",
        "[System.IO.File]::WriteAllLines($Out, [string[]]$lines)",
      ].join("\n")}\n`,
    );
    const run = spawnSync("powershell.exe", [...shellArgs("powershell.exe"), "-File", driver, list, out], { encoding: "utf8", timeout: 120_000 });
    expect(run.status, run.stderr || run.stdout).toBe(0);
    const failing = readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean).filter((line) => !line.startsWith("0|")).map((line) => line.replace(REPO_ROOT, ""));
    expect(failing).toEqual([]);
  }, 180_000);
});

// ─── validate-action.ps1 ─────────────────────────────────────────────────────

function buildProject() {
  const dir = tempDir("pf-validate-action-");
  const put = (rel, text) => {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  put(".forge.json", JSON.stringify({ preset: "custom", templateVersion: "1.0.0" }));
  put(".github/copilot-instructions.md", "# Instructions\n");
  put(".github/instructions/architecture-principles.instructions.md", "# Architecture\n");
  put(".github/instructions/git-workflow.instructions.md", "# Git\n");
  put("src/app.js", "// TODO: later\n");
  put("plan.md", "# A plan\n");
  // What `pforge analyze` prints: several lines, so the captured output is an array, as the real one is. A single line is
  // kept as a string, and -match fills $Matches for a string, which hid the bug. The score comes from the environment,
  // so one project serves both runs.
  put("pforge.ps1", 'Write-Host "Plan Forge - Analyze"\nWrite-Host "Consistency Score: $($env:PF_TEST_SCORE)/100"\nWrite-Host "1 slices"\n');
  return dir;
}

function validate(shell, project, extra, score) {
  const run = spawnSync(shell.exe, [...shellArgs(shell.exe), "-File", join(REPO_ROOT, "scripts", "validate-action.ps1"), "-Path", project, ...extra], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, PF_TEST_SCORE: String(score) },
  });
  const text = `${run.stdout}${run.stderr}`;
  return { status: run.status, text, failed: Number(/(\d+) failed/.exec(text)?.[1]) };
}

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`scripts/validate-action.ps1 under ${shell.name}`, () => {
    const analyze = ["-Analyze", "true", "-AnalyzePlan", "plan.md", "-AnalyzeThreshold", "60"];

    it("reads the score that pforge analyze prints, and warns about a marker the sweep finds unless sweep-fail is set", () => {
      const run = validate(shell, buildProject(), analyze, 73);
      expect(run.text).toContain("Consistency score: 73/100 (threshold: 60)");
      expect(run.text).toContain("Found 1 deferred-work marker(s)");
      expect(run.failed, run.text).toBe(0);
      expect(run.status, run.text).toBe(0);
    }, 120_000);

    it("fails a score below the threshold, and a marker when sweep-fail is set", () => {
      const run = validate(shell, buildProject(), ["-SweepFail", "true", ...analyze], 40);
      expect(run.text).toContain("Consistency score: 40/100 (below threshold: 60)");
      expect(run.failed, run.text).toBe(2);
      expect(run.status, run.text).toBe(1);
    }, 120_000);
  });
}
