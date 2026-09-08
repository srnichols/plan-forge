import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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

  function runConfigUpdate() {
    const source = readFileSync(new URL("../../pforge.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const marker = source.indexOf("Update .forge.json templateVersion");
    const start = source.indexOf('    if [ -f "$config_path" ]; then', marker);
    const end = source.indexOf('    pf_update_gitignore "$REPO_ROOT"', start);
    expect(marker).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const script = 'set -euo pipefail\nupdate_fixture() {\nlocal config_path="$PWD/.forge.json" source_version="3.26.6"\n'
      + source.slice(start, end) + '\n}\nupdate_fixture\n';
    return spawnSync(bash, ["-c", script], { cwd: sourceDir, encoding: "utf8", windowsHide: true });
  }

  it("updates consumer config through shell-safe JSON IO and preserves nested settings", () => {
    const config = { templateVersion: "3.26.5", preset: ["dotnet", "typescript"], custom: { nested: { feature: { enabled: true } } } };
    const configPath = join(sourceDir, ".forge.json");
    writeFileSync(configPath, JSON.stringify(config));
    const outcome = runConfigUpdate();
    expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ ...config, templateVersion: "3.26.6" });
  });

  it("does not overwrite malformed consumer config", () => {
    const configPath = join(sourceDir, ".forge.json");
    const malformed = '{"templateVersion":"3.26.5", invalid';
    writeFileSync(configPath, malformed);
    expect(runConfigUpdate().status).not.toBe(0);
    expect(readFileSync(configPath, "utf8")).toBe(malformed);
  });

  it("finishes stale version metadata even when a prior attempt copied every file", () => {
    const source = readFileSync(new URL("../../pforge.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf('    if [ "${#_updates[@]}" -eq 0 ]');
    const end = source.indexOf('    echo "Changes found:"', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const script = 'set -euo pipefail\ncheck_fixture() {\nlocal -a _updates=() _new_files=()\nlocal current_version="3.26.5" source_version="3.26.6"\n'
      + source.slice(start, end) + '\nprintf "MIGRATION_CONTINUES\\n"\n}\ncheck_fixture\n';
    const outcome = spawnSync(bash, ["-c", script], { cwd: sourceDir, encoding: "utf8", windowsHide: true });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("MIGRATION_CONTINUES");
  });

  it.skipIf(!isWindows)("the PowerShell updater also finishes metadata after a partial copy", () => {
    const block = preflight("pforge.ps1", "    if ($updates.Count -eq 0", '    Write-Host "Changes found:"');
    const script = '$ErrorActionPreference="Stop"; function Check-Update { $updates=@(); $newFiles=@(); $currentVersion="3.26.5"; $sourceVersion="3.26.6"; '
      + block + '; Write-Output "MIGRATION_CONTINUES" }; Check-Update';
    const outcome = spawnSync("pwsh", ["-NoProfile", "-Command", script], { cwd: sourceDir, encoding: "utf8", windowsHide: true });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("MIGRATION_CONTINUES");
  });

  function selectPresets(preset) {
    const source = readFileSync(new URL("../../setup.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const split = source.indexOf("# Normalise: split comma-separated preset string into array");
    const oldLabel = source.lastIndexOf('\ncase "$PRESET" in', split);
    const start = oldLabel >= 0 ? oldLabel : split;
    const end = source.indexOf('\nif [[ "$FORCE" != true ]]', split);
    expect(split).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const script = 'set -euo pipefail\nPRESET="$PFORGE_TEST_PRESETS"\nred() { printf "%s\\n" "$*"; }\n'
      + source.slice(start, end) + '\nprintf "COUNT=%s PRIMARY=%s BUILD=%s\\n" "${#PRESETS[@]}" "$PRIMARY_PRESET" "$DEFAULT_BUILD"\n';
    return spawnSync(bash, ["-c", script], {
      cwd: sourceDir, encoding: "utf8", windowsHide: true, env: { ...process.env, PFORGE_TEST_PRESETS: preset },
    });
  }

  it("validates each requested preset before selecting a multi-preset label", () => {
    const outcome = selectPresets("typescript,dotnet");
    expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: "" });
    expect(outcome.stdout).toContain("COUNT=2 PRIMARY=typescript BUILD=pnpm build");
  });

  it("still rejects an unknown member of a preset list", () => {
    const outcome = selectPresets("typescript,unknown");
    expect(outcome.status).not.toBe(0);
    expect(outcome.stdout).toContain("Unknown preset");
  });

  it("extracts a downloader's native archive path through the real Bash update block", () => {
    const payload = join(sourceDir, "payload");
    mkdirSync(payload);
    writeFileSync(join(payload, "VERSION"), "3.26.7");
    execFileSync("tar", ["-czf", "download.tar.gz", "payload"], { cwd: sourceDir, windowsHide: true });
    const block = preflight("pforge.sh", "        # Extract tarball", "        # Find top-level directory");
    const script = 'set -euo pipefail\nextract_fixture() {\nlocal gh_tarball="$PFORGE_TEST_ARCHIVE" resolved_tag="v3.26.7" gh_extract_dir=""\n'
      + block + '\ncat "$gh_extract_dir/payload/VERSION"\n}\nextract_fixture\n';
    const outcome = spawnSync(bash, ["-c", script], {
      cwd: sourceDir, encoding: "utf8", windowsHide: true,
      env: { ...process.env, PFORGE_TEST_ARCHIVE: join(sourceDir, "download.tar.gz") },
    });
    expect({ status: outcome.status, stderr: outcome.stderr }).toEqual({ status: 0, stderr: "" });
    expect(outcome.stdout).toContain("3.26.7");
  });
});
