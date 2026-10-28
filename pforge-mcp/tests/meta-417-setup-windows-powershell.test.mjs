/**
 * Meta-bug #417 — setup.ps1 did not run in Windows PowerShell 5.1.
 *
 * Two things stopped it. The script is UTF-8 without a BOM, which 5.1 reads in the system code page, so an em
 * dash inside a double-quoted string ended it (50 parse errors); and it used `?.` and `??`, which only
 * PowerShell 7 has. Making it parse is not enough: the installer then ran, but `Set-Content` and `Add-Content`
 * with no -Encoding write the system code page in 5.1, so it wrote an em dash as byte 0x97 into .gitignore and
 * docs/plans/auto/README.md, and an arrow as a literal "?" into CLAUDE.md, GEMINI.md and the Cursor and
 * Windsurf rules. And -Encoding UTF8 there writes a BOM, which Node's JSON.parse rejects.
 *
 * setup.ps1 now starts with a BOM, has no PowerShell 7 syntax, and writes and reads text only through
 * Write-Utf8File, Add-Utf8Content and `Get-Content -Encoding UTF8`, which give the same bytes in both shells.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EOL, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { checkInstalledText, listProjectFiles } from "../../scripts/check-installed-text.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const SETUP = join(REPO_ROOT, "setup.ps1");
const setupBytes = readFileSync(SETUP);
const setupSource = setupBytes.toString("utf8").replace(/^\uFEFF/, "");

const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const SHELLS = [
  { name: "pwsh", exe: "pwsh", available: PWSH_OK },
  { name: "Windows PowerShell 5.1", exe: "powershell.exe", available: isWin },
].filter((shell) => shell.available);

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
const shellArgs = (exe, file, ...rest) => ["-NoProfile", "-NonInteractive", ...(exe === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : []), "-File", file, ...rest];

function extractPsFunction(name) {
  const start = setupSource.indexOf(`function ${name}(`);
  expect(start, `setup.ps1 defines ${name}`).toBeGreaterThan(-1);
  return setupSource.slice(start, setupSource.indexOf("\n}\n", start) + 3);
}

// ─── it can be read and parsed by Windows PowerShell 5.1 ─────────────────────

/** Source text with here-strings, comments and quoted strings blanked, so a scan sees only code. */
function codeOnly(source) {
  return source
    .replace(/@"[\s\S]*?"@/g, '""')
    .replace(/@'[\s\S]*?'@/g, "''")
    .replace(/<#[\s\S]*?#>/g, "")
    .replace(/"(?:`.|[^"`\r\n])*"/g, '""')
    .replace(/'(?:''|[^'\r\n])*'/g, "''")
    .replace(/#[^\r\n]*/g, "");
}

describe("setup.ps1 can be read by Windows PowerShell 5.1", () => {
  it("starts with a UTF-8 byte order mark, which is how 5.1 knows the file is not in the system code page", () => {
    expect([...setupBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("uses no PowerShell 7 syntax: null-conditional access, null coalescing, ternary or pipeline chains", () => {
    const code = codeOnly(setupSource);
    expect(code).not.toMatch(/\?\?/);
    expect(code).not.toMatch(/\?\./);
    expect(code).not.toMatch(/\?\[/);
    expect(code).not.toMatch(/\)\s*\?\s*[^\s]/);
    expect(code).not.toMatch(/&&|\|\|/);
  });

  it("is found by the scan above when it has what it looks for", () => {
    expect(codeOnly('$x = $a ?? "b" # note\n$y = "?? in a string"')).toMatch(/\?\?/);
    expect(codeOnly('$y = "?? in a string" # ?? in a comment\n$z = @"\n?? in a here-string\n"@')).not.toMatch(/\?\?/);
    expect(codeOnly("$p = (Get-Item x)?.Path")).toMatch(/\?\./);
  });

  it.skipIf(!isWin)("parses without errors in Windows PowerShell 5.1, and so does every script shipped to a project", () => {
    const tracked = spawnSync("git", ["ls-files", "*.ps1"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
    const shipped = tracked.filter((file) => !file.startsWith("scripts/"));
    expect(shipped).toContain("setup.ps1");
    expect(shipped).toContain("pforge.ps1");
    const dir = tempDir("pf-meta-417-parse-");
    const list = join(dir, "list.txt");
    const out = join(dir, "out.txt");
    writeFileSync(list, shipped.map((file) => join(REPO_ROOT, file)).join("\n"));
    const driver = join(dir, "scan.ps1");
    writeFileSync(driver, `\uFEFF${[
      "param([string]$List, [string]$Out)",
      "$lines = foreach ($path in Get-Content -LiteralPath $List -Encoding UTF8) {",
      "  $t = $null; $e = $null",
      "  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)",
      '  "{0}|{1}|{2}" -f $e.Count, $path, $(if ($e.Count) { "L$($e[0].Extent.StartLineNumber): $($e[0].Message)" } else { "" })',
      "}",
      "[System.IO.File]::WriteAllLines($Out, [string[]]$lines)",
    ].join("\n")}\n`);
    const run = spawnSync("powershell.exe", shellArgs("powershell.exe", driver, list, out), { encoding: "utf8", timeout: 120_000 });
    expect(run.status, run.stderr || run.stdout).toBe(0);
    const failing = readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean).filter((line) => !line.startsWith("0|")).map((line) => line.replace(REPO_ROOT, ""));
    expect(failing).toEqual([]);
  }, 180_000);
});

// ─── it reads and writes text the same way in both shells ────────────────────

describe("setup.ps1 reads and writes text as UTF-8 without a byte order mark", () => {
  const codeLines = codeOnly(setupSource).split("\n");
  const helperBodies = ["Write-Utf8File", "Add-Utf8Content"].map((name) => {
    const at = setupSource.indexOf(`function ${name}(`);
    return at < 0 ? "" : setupSource.slice(at, setupSource.indexOf("\n}\n", at) + 3);
  }).join("\n");
  const outsideHelpers = codeOnly(setupSource.replace(helperBodies, "")).split("\n");

  it("writes through Write-Utf8File and Add-Utf8Content, never Set-Content, Add-Content, Out-File or a redirect", () => {
    expect(helperBodies, "the two helpers exist").toContain("function Write-Utf8File(");
    const offenders = outsideHelpers.map((line, i) => ({ line, i })).filter(({ line }) => /\b(Set-Content|Add-Content|Out-File|Tee-Object)\b|\s>>?\s*[$"']/.test(line));
    expect(offenders.map(({ line }) => line.trim())).toEqual([]);
  });

  it("reads every file as UTF-8: the Get-Content default is set before any is used, on a copy of the caller's defaults", () => {
    const copy = setupSource.search(/\$PSDefaultParameterValues\s*=\s*@\{\}\s*\+\s*\$PSDefaultParameterValues/);
    const encoding = setupSource.search(/\$PSDefaultParameterValues\['Get-Content:Encoding'\]\s*=\s*'UTF8'/);
    const firstRead = codeLines.join("\n").search(/\bGet-Content\b/);
    expect(copy, "copies the caller's $PSDefaultParameterValues").toBeGreaterThan(-1);
    expect(encoding, "sets the Get-Content encoding").toBeGreaterThan(copy);
    expect(firstRead, "uses Get-Content").toBeGreaterThan(-1);
    expect(setupSource.slice(0, encoding).split("\n").length, "the default is set near the top, before any function reads").toBeLessThan(80);
    const overrides = codeLines.filter((line) => /\bGet-Content\b/.test(line) && /-Encoding\s+(?!UTF8\b)\w+/i.test(line));
    expect(overrides.map((line) => line.trim())).toEqual([]);
  });

  it.each(SHELLS)("the helpers write the same bytes in $name as Set-Content does in PowerShell 7", ({ exe }) => {
    const dir = tempDir("pf-meta-417-write-");
    const sample = "em \u2014 arrow \u2192 check \u2705 face \u{1F600}";
    const script = `\uFEFF${[
      "$ErrorActionPreference = 'Stop'",
      extractPsFunction("Write-Utf8File"),
      extractPsFunction("Add-Utf8Content"),
      `$text = [System.IO.File]::ReadAllText('${join(dir, "sample.txt").replace(/\\/g, "/")}', (New-Object System.Text.UTF8Encoding $false))`,
      `Set-Location '${dir}'`,
      "Write-Utf8File 'plain.txt' $text",
      "Write-Utf8File 'nonewline.txt' $text -NoNewline",
      "Write-Utf8File 'lines.txt' @('one', $text, 'three')",
      "New-Item -ItemType Directory -Path 'sub [x]' | Out-Null",
      "Write-Utf8File (Join-Path (Join-Path (Get-Location) 'sub [x]') 'wild.txt') $text",
      "Write-Utf8File 'appended.txt' 'first'",
      "Add-Utf8Content 'appended.txt' $text",
      // A file that does not exist yet is where an encoding with a preamble writes its byte order mark.
      "Add-Utf8Content 'created.txt' $text",
    ].join("\n")}\n`;
    writeFileSync(join(dir, "sample.txt"), sample, "utf8");
    const driver = join(dir, "driver.ps1");
    writeFileSync(driver, script);
    const run = spawnSync(exe, shellArgs(exe, driver), { encoding: "utf8", timeout: 120_000 });
    expect(run.status, run.stderr || run.stdout).toBe(0);
    const bytes = (file) => [...readFileSync(join(dir, file))];
    const utf8 = (text) => [...Buffer.from(text, "utf8")];
    expect(bytes("plain.txt")).toEqual(utf8(sample + EOL));
    expect(bytes("nonewline.txt")).toEqual(utf8(sample));
    expect(bytes("lines.txt")).toEqual(utf8(["one", sample, "three"].join(EOL) + EOL));
    expect(bytes("sub [x]/wild.txt")).toEqual(utf8(sample + EOL));
    expect(bytes("appended.txt")).toEqual(utf8(`first${EOL}${sample}${EOL}`));
    expect(bytes("created.txt"), "appended to a file that did not exist, with no byte order mark").toEqual(utf8(sample + EOL));
    expect(bytes("plain.txt").slice(0, 3), "no byte order mark").not.toEqual([0xef, 0xbb, 0xbf]);
  }, 120_000);

  it.skipIf(!PWSH_OK)("what Set-Content writes in PowerShell 7 is what Write-Utf8File writes (the contract the helpers keep)", () => {
    const dir = tempDir("pf-meta-417-parity-");
    const driver = join(dir, "parity.ps1");
    writeFileSync(driver, `\uFEFF${[
      "$ErrorActionPreference = 'Stop'",
      extractPsFunction("Write-Utf8File"),
      "$text = 'em ' + [char]0x2014 + ' arrow ' + [char]0x2192 + ' end'",
      "Set-Content -Path (Join-Path (Get-Location) 'a.txt') -Value $text",
      "Write-Utf8File (Join-Path (Get-Location) 'b.txt') $text",
      "Set-Content -Path (Join-Path (Get-Location) 'c.txt') -Value $text -NoNewline",
      "Write-Utf8File (Join-Path (Get-Location) 'd.txt') $text -NoNewline",
    ].join("\n")}\n`);
    const run = spawnSync("pwsh", shellArgs("pwsh", driver), { encoding: "utf8", cwd: dir, timeout: 60_000 });
    expect(run.status, run.stderr || run.stdout).toBe(0);
    expect([...readFileSync(join(dir, "b.txt"))]).toEqual([...readFileSync(join(dir, "a.txt"))]);
    expect([...readFileSync(join(dir, "d.txt"))]).toEqual([...readFileSync(join(dir, "c.txt"))]);
  }, 60_000);
});

// ─── the text check, and a whole install under Windows PowerShell 5.1 ────────

describe("scripts/check-installed-text.mjs", () => {
  /** A project holding what the check looks for, each file as setup writes it under PowerShell 7. */
  function healthyProject() {
    const project = tempDir("pf-meta-417-check-");
    const put = (file, content) => {
      mkdirSync(dirname(join(project, file)), { recursive: true });
      writeFileSync(join(project, file), content);
    };
    put(".gitignore", "# produced by pforge \u2014 never commit\n");
    put("docs/plans/auto/README.md", "Auto plans \u2014 generated\n");
    put("CLAUDE.md", "Step \u2192 next\n");
    put("GEMINI.md", "Step \u2192 next\n");
    put(".github/copilot-instructions.md", "Rules \u2014 follow them\n");
    for (const json of [".forge.json", ".vscode/mcp.json", ".forge/capabilities.json", ".claude/mcp.json", ".gemini/settings.json"]) put(json, '{"ok":true}\n');
    return { project, put };
  }

  it("passes a project written as UTF-8 without a byte order mark", () => {
    expect(checkInstalledText(healthyProject().project)).toEqual([]);
  });

  it("finds a file written in the system code page", () => {
    const { project, put } = healthyProject();
    put("docs/notes.md", Buffer.concat([Buffer.from("a "), Buffer.from([0x97]), Buffer.from(" b")]));
    expect(checkInstalledText(project)).toEqual(["docs/notes.md: not valid UTF-8 (written in the system code page)"]);
  });

  it("finds an arrow that became a question mark, and a dash decoded in the wrong code page", () => {
    const { project, put } = healthyProject();
    put("CLAUDE.md", "Step ? next\n");
    put(".github/copilot-instructions.md", "Rules \u00e2\u20ac\u201d follow them \u2014\n");
    expect(checkInstalledText(project)).toEqual([
      'CLAUDE.md: no longer contains "\u2192"',
      ".github/copilot-instructions.md: has an em dash decoded in the wrong code page",
    ]);
  });

  it("finds JSON that starts with a byte order mark, or is missing", () => {
    const { project, put } = healthyProject();
    put(".forge.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"ok":true}')]));
    rmSync(join(project, ".claude", "mcp.json"));
    expect(checkInstalledText(project)).toEqual([".forge.json: starts with a byte order mark", ".claude/mcp.json: missing"]);
  });

  it("skips binary files and node_modules", () => {
    const { project, put } = healthyProject();
    put("logo.png", Buffer.from([0x89, 0x50, 0x00, 0x97]));
    put("pforge-mcp/node_modules/dep/index.js", Buffer.from([0x97]));
    expect(checkInstalledText(project)).toEqual([]);
  });

  it("does not pass a directory that holds no files, such as a wrong path", () => {
    const problems = checkInstalledText(tempDir("pf-meta-417-empty-"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("no files");
  });
});

describe.skipIf(!isWin)("setup.ps1 run by Windows PowerShell 5.1", () => {
  it("installs a project whose text is valid UTF-8 with its dashes and arrows, and whose JSON has no byte order mark", () => {
    const stub = tempDir("pf-meta-417-npm-");
    writeFileSync(join(stub, "npm.cmd"), "@exit /b 0\r\n");
    const project = tempDir("pf-meta-417-proj-");
    const env = { ...process.env, PATH: `${stub}${delimiter}${process.env.PATH}` };
    delete env.CI;
    const run = spawnSync("powershell.exe", shellArgs("powershell.exe", SETUP, "-Preset", "custom", "-Agent", "all", "-ProjectPath", project, "-ProjectName", "Acme", "-NonInteractive", "-Force"), { encoding: "utf8", timeout: 280_000, env });
    expect(run.status, (run.stdout + run.stderr).slice(-1500)).toBe(0);

    expect(listProjectFiles(project).length).toBeGreaterThan(500);
    // This is also what the Windows PowerShell 5.1 job of Validate Setup runs.
    expect(checkInstalledText(project), "the installed text").toEqual([]);
  }, 300_000);
});
