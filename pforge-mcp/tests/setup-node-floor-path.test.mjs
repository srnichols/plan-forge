import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isWindows = process.platform === "win32";
const bash = isWindows ? join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "bash";

function preflight(script, start, end) {
  const source = readFileSync(new URL(`../../${script}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThan(-1);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("installer Node preflight - source path portability", () => {
  let sourceDir;

  beforeEach(() => {
    sourceDir = mkdtempSync(join(tmpdir(), "pforge source's path-"));
    mkdirSync(join(sourceDir, "pforge-mcp"));
    writeFileSync(join(sourceDir, "pforge-mcp", "package.json"), JSON.stringify({ engines: { node: ">=20.19.0" } }));
  });
  afterEach(() => { rmSync(sourceDir, { recursive: true, force: true }); });

  it("reads the manifest from a shell path without embedding it in JavaScript", () => {
    const block = preflight("setup.sh", "MCP_PKG_PATH=", '\nif [[ -z "$PROJECT_PATH"');
    const script = 'set -euo pipefail\nTEMPLATE_ROOT="$(pwd)"\nred() { printf "%s\\n" "$*"; }\n' + block;
    const outcome = spawnSync(bash, ["-c", script], { cwd: sourceDir, encoding: "utf8", windowsHide: true });
    expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: "" });
    expect(outcome.stdout).toContain("requires >= 20.19.0");
  });

  it.skipIf(!isWindows)("keeps the PowerShell twin's manifest-based floor", () => {
    const block = preflight("setup.ps1", "$mcpPkgPath =", "\nif (-not $ProjectPath)");
    const outcome = spawnSync("pwsh", ["-NoProfile", "-Command", '$ErrorActionPreference="Stop"; $templateRoot=(Get-Location).Path; ' + block], {
      cwd: sourceDir, encoding: "utf8", windowsHide: true,
    });
    expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: "" });
    expect(outcome.stdout).toContain("requires >= 20.19.0");
  });
});