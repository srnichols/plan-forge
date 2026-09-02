/**
 * Issue #252 — `pforge smith` parsed `.vscode/settings.json` with strict
 * `ConvertFrom-Json`. VS Code settings is JSONC: `//` and block comments and
 * trailing commas are legal there. Any project that documents its settings
 * inline failed the check permanently.
 *
 * Reproduction note (measured 2026-09-02, not inferred):
 *   Windows PowerShell 5.1 -> "Invalid object passed in, ':' or '}' expected."
 *   PowerShell 7.6.5        -> parses JSONC fine
 * So the strict-parse failure is host-version dependent. The fix therefore has
 * to strip JSONC itself rather than lean on whichever parser the host ships.
 *
 * The stripper must be a character scanner, not a regex: `"https://x"` contains
 * a `//` that is NOT a comment, and a comma inside a string is not a trailing
 * comma. Those two cases are the point of this file.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";

const HERE = import.meta.dirname;
const PS1 = resolve(HERE, "..", "..", "pforge.ps1");
const TMP = resolve(HERE, ".tmp-issue-252");

/** Prefer the strict host (5.1) — it is the one that actually rejects JSONC. */
function findPowerShell() {
  for (const exe of process.platform === "win32" ? ["powershell.exe", "pwsh"] : ["pwsh"]) {
    const probe = spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
}

const PS_EXE = findPowerShell();

/**
 * Pull the JSONC helpers out of the real pforge.ps1 via the PowerShell AST and
 * run them there. Extracting by AST (not by line numbers or sentinel comments)
 * keeps the test bound to the shipped function, not to a copy of it.
 *
 * Every function definition in the file is dot-sourced rather than a named
 * subset, so the test does not break when the implementation adds or renames a
 * private helper. Dot-sourcing a definition only defines it; nothing runs.
 */
const DRIVER = `
param([string]$Ps1, [string]$InputFile)
$ErrorActionPreference = 'Stop'
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Ps1, [ref]$null, [ref]$null)
$fns = $ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.FunctionDefinitionAst]
}, $true)
foreach ($fn in $fns) { . ([scriptblock]::Create($fn.Extent.Text)) }
if (-not (Get-Command ConvertFrom-Jsonc -ErrorAction SilentlyContinue)) {
    Write-Output "MISSING_FUNCTION:ConvertFrom-Jsonc"; exit 3
}
$text = Get-Content -LiteralPath $InputFile -Raw
$obj = ConvertFrom-Jsonc -Text $text
$obj | ConvertTo-Json -Depth 10 -Compress
`;

/** @returns {{ status: number, out: string }} */
function runJsonc(text) {
  const inputFile = join(TMP, `in-${Math.random().toString(36).slice(2)}.jsonc`);
  writeFileSync(inputFile, text, "utf8");
  const driverFile = join(TMP, "driver.ps1");
  writeFileSync(driverFile, DRIVER, "utf8");
  const r = spawnSync(PS_EXE, ["-NoProfile", "-File", driverFile, "-Ps1", PS1, "-InputFile", inputFile], {
    encoding: "utf8",
  });
  return { status: r.status ?? -1, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
});

describe("Guard: smith does not strict-parse the JSONC settings file (#252)", () => {
  const src = readFileSync(PS1, "utf8");

  it("routes the .vscode/settings.json read through ConvertFrom-Jsonc", () => {
    const line = src.split(/\r?\n/).find(l => /^\s*\$settings\s*=/.test(l));
    expect(line, "settings.json read site not found in pforge.ps1").toBeTruthy();
    expect(line).toMatch(/ConvertFrom-Jsonc/);
    expect(line).not.toMatch(/ConvertFrom-Json\b(?!c)/);
  });

  it("defines the JSONC helpers", () => {
    expect(src).toMatch(/function\s+Remove-JsoncComment\b/);
    expect(src).toMatch(/function\s+Remove-JsoncTrailingComma\b/);
    expect(src).toMatch(/function\s+ConvertFrom-Jsonc\b/);
  });
});

describe.skipIf(!PS_EXE)("ConvertFrom-Jsonc behaviour (#252)", () => {
  it("parses the exact shape VS Code emits — line comments, block comments, trailing commas", () => {
    const { status, out } = runJsonc(`{
  // maps terminal auto-approve entries to a documented policy file
  "chat.agent.enabled": true,
  /* block
     comment */
  "chat.promptFiles": true,
  "list": [
    1,
    2,
  ],
}
`);
    expect(out).not.toMatch(/MISSING_FUNCTION/);
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed["chat.agent.enabled"]).toBe(true);
    expect(parsed["chat.promptFiles"]).toBe(true);
    expect(parsed.list).toEqual([1, 2]);
  });

  it("does not treat // inside a string as a comment", () => {
    const { status, out } = runJsonc(`{ "url": "https://example.com//docs#a", "x": 1 }`);
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.url).toBe("https://example.com//docs#a");
  });

  it("does not treat /* inside a string as a block comment", () => {
    const { status, out } = runJsonc(`{ "glob": "src/**/*.ts", "note": "/* not a comment */", "x": 1 }`);
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.glob).toBe("src/**/*.ts");
    expect(parsed.note).toBe("/* not a comment */");
    expect(parsed.x).toBe(1);
  });

  it("does not strip a comma that is inside a string value", () => {
    const { status, out } = runJsonc(`{ "csv": "a,b,", "arr": ["x,", "y"] }`);
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.csv).toBe("a,b,");
    expect(parsed.arr).toEqual(["x,", "y"]);
  });

  it("preserves an escaped quote followed by a comment-like sequence", () => {
    const { status, out } = runJsonc(`{ "q": "he said \\"hi//there\\"", "y": 2 }`);
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.q).toBe('he said "hi//there"');
    expect(parsed.y).toBe(2);
  });

  it("still rejects genuinely malformed JSON", () => {
    const { status, out } = runJsonc(`{ "a": }`);
    expect(out).not.toMatch(/MISSING_FUNCTION/);
    expect(status).not.toBe(0);
  });
});

/**
 * The bash smith never parsed JSON at all — it greps — so it could not produce
 * the false FAILURE #252 reports. It had the opposite JSONC bug: a
 * commented-out setting grepped as present. The shipped
 * templates/vscode-settings.json.template is full of `//` lines, so this is the
 * default install, not an edge case.
 */
const BASH = (() => {
  for (const exe of ["bash", "C:\\Program Files\\Git\\bin\\bash.exe"]) {
    const probe = spawnSync(exe, ["-c", "exit 0"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return exe;
  }
  return null;
})();

/** Run the exact `settings_body=` assignment line that pforge.sh uses. */
function stripCommentsWithSh(text) {
  const shSrc = readFileSync(resolve(HERE, "..", "..", "pforge.sh"), "utf8");
  const assign = shSrc.split(/\r?\n/).find(l => /^\s*settings_body=/.test(l));
  expect(assign, "pforge.sh no longer strips comments before grepping").toBeTruthy();

  const inputName = `sh-${Math.random().toString(36).slice(2)}.json`;
  writeFileSync(join(TMP, inputName), text, "utf8");
  writeFileSync(
    join(TMP, "strip.sh"),
    `settings_path="$1"\n${assign.trim()}\nprintf '%s' "$settings_body"\n`,
    "utf8",
  );

  // Relative names + cwd: `bash` here may be WSL, where an E:\ or E:/ path does
  // not resolve. WSL translates the inherited Windows cwd, so relatives work.
  const r = spawnSync(BASH, ["strip.sh", inputName], { cwd: TMP, encoding: "utf8" });
  expect(r.stderr || "", "bash driver errored").toBe("");
  return r.stdout || "";
}

describe.skipIf(!BASH)("pforge.sh treats settings.json as JSONC (#252)", () => {
  it("drops a commented-out setting so it is not reported as configured", () => {
    const stripped = stripCommentsWithSh(`{\n  // "chat.promptFiles": true,\n  "x": 1\n}\n`);
    expect(stripped).not.toMatch(/chat\.promptFiles/);
  });

  it("keeps a // that is part of a URL value", () => {
    const stripped = stripCommentsWithSh(`{\n  "docs": "https://example.com//policy"\n}\n`);
    expect(stripped).toMatch(/https:\/\/example\.com\/\/policy/);
  });

  it("keeps a real setting that follows a comment line", () => {
    const stripped = stripCommentsWithSh(`{\n  // explains the next line\n  "chat.promptFiles": true\n}\n`);
    expect(stripped).toMatch(/"chat\.promptFiles": true/);
  });
});
