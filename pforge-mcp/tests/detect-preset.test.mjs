/**
 * `pforge update` with no .forge.json (or one without a preset) detects the
 * stack from project markers instead of assuming "custom". Assuming "custom"
 * replaced a .NET project's testing and security instructions with the
 * stack-neutral shared copies (found refreshing plan-forge-testbed, which
 * gitignores .forge.json).
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { detectPreset } from "../detect-preset.mjs";

const SCRIPT = resolve(import.meta.dirname, "..", "detect-preset.mjs");
const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "pf-detect-"));
  dirs.push(dir);
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  return dir;
}

describe("detectPreset", () => {
  it.each([
    [["src/Api/Api.csproj"], "dotnet"],
    [["TimeTracker.slnx"], "dotnet"],
    [["App.sln"], "dotnet"],
    [["go.mod", "package.json"], "go"],
    [["Package.swift"], "swift"],
    [["Cargo.toml"], "rust"],
    [["build.gradle.kts"], "java"],
    [["pyproject.toml"], "python"],
    [["package.json", "tsconfig.json"], "typescript"],
    [["composer.json"], "php"],
    [["infra/main.bicep"], "azure-iac"],
    [["README.md"], "custom"],
  ])("%j → %s (same markers and order as setup -AutoDetect)", (files, preset) => {
    expect(detectPreset(project(files)).preset).toBe(preset);
  });

  it("names the marker it matched", () => {
    expect(detectPreset(project(["src/Api/Api.csproj"]))).toEqual({ preset: "dotnet", marker: "src/Api/Api.csproj" });
  });

  it("ignores markers inside node_modules and deeper than setup looks", () => {
    expect(detectPreset(project(["node_modules/x/x.csproj", "a/b/c/d/x.csproj"])).preset).toBe("custom");
  });

  it("CLI prints the preset, or preset|marker with --fields", () => {
    const dir = project(["TimeTracker.slnx"]);
    expect(spawnSync(process.execPath, [SCRIPT, "--project", dir], { encoding: "utf8" }).stdout.trim()).toBe("dotnet");
    expect(spawnSync(process.execPath, [SCRIPT, "--project", dir, "--fields"], { encoding: "utf8" }).stdout.trim()).toBe("dotnet|TimeTracker.slnx");
  });
});
