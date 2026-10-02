/**
 * Shell wrappers parse JSON from Node helpers that run with `2>&1`. Taking the
 * last line broke when Node printed a deprecation warning after the JSON: on a
 * CI runner, Bash self-update read `latest` as empty and tried to download tag
 * "v". Both shells now take the last line that starts with "{" (falling back to
 * the last line, so error text still surfaces).
 *
 * Also: validate-setup.ps1 read `.forge.json` with Get-Item, which cannot see
 * dotfiles on Linux/macOS without -Force, so setup.ps1 failed its own
 * validation there.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;
const hasWrappers = existsSync(join(REPO, "pforge.ps1")) && existsSync(join(REPO, "pforge.sh"));

/** Source text of one shell function, by its opening line, up to the next top-level "}". */
function extractFunction(file, opener) {
  const src = readFileSync(join(REPO, file), "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf(opener);
  if (start < 0) throw new Error(`${opener} not found in ${file}`);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end + 2);
}

const JSON_LINE = '{"ok":true,"tag":"v9.9.9"}';
const NOISY = [JSON_LINE, "(node:1) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized", "(Use `node --trace-deprecation ...` to show where the warning was created)"];

describe.skipIf(!hasWrappers)("last JSON line from merged Node output", () => {
  it.skipIf(!BASH)("pforge.sh _pf_last_json skips trailing warnings and falls back to the last line", () => {
    const fn = extractFunction("pforge.sh", "_pf_last_json() {");
    const run = (lines) => spawnSync(BASH, ["-c", `${fn}\nprintf '%s\\n' "$@" | _pf_last_json`, "_", ...lines], { encoding: "utf8" }).stdout.trim();
    expect(run(NOISY)).toBe(JSON_LINE);
    expect(run(["warning first", JSON_LINE])).toBe(JSON_LINE);
    expect(run(["Error: network down"])).toBe("Error: network down");
  });

  it.skipIf(!PWSH)("pforge.ps1 Select-LastJsonLine skips trailing warnings and falls back to the last line", () => {
    const fn = extractFunction("pforge.ps1", "function Select-LastJsonLine");
    const quote = (s) => `'${s.replace(/'/g, "''")}'`;
    const run = (lines) => spawnSync("pwsh", ["-NoProfile", "-Command", `${fn}\n@(${lines.map(quote).join(", ")}) | Select-LastJsonLine`], { encoding: "utf8" }).stdout.trim();
    expect(run(NOISY)).toBe(JSON_LINE);
    expect(run(["Error: network down"])).toBe("Error: network down");
  });

  it("every JSON-parsing node call in the wrappers uses the helper", () => {
    const sh = readFileSync(join(REPO, "pforge.sh"), "utf8");
    const ps = readFileSync(join(REPO, "pforge.ps1"), "utf8");
    expect(sh).not.toMatch(/node [^\n]*2>&1 \| tail -1/);
    expect(ps).not.toMatch(/& node [^\n]*2>&1 \| Select-Object -Last 1/);
  });
});

describe("validate-setup.ps1 on Linux/macOS", () => {
  it("reads file sizes with Get-Item -Force so dotfiles like .forge.json are visible", () => {
    const src = readFileSync(join(REPO, "validate-setup.ps1"), "utf8");
    expect(src).not.toMatch(/Get-Item \$fullPath\)/);
    expect(src).toMatch(/Get-Item -LiteralPath \$fullPath -Force/);
  });
});
