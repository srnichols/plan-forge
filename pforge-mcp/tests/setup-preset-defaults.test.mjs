/**
 * Every stack preset the installers accept needs a stack label and
 * build/test/lint defaults in both shells. setup.sh exited with
 * "Unknown preset: php" (and rust), and setup.ps1 silently wrote an empty
 * stack label and empty commands for them.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SETUP_SH = resolve(REPO_ROOT, "setup.sh");
const SETUP_PS1 = resolve(REPO_ROOT, "setup.ps1");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

// Development checkout only: projects receive pforge-mcp/ without the installers.
const hasInstallers = existsSync(SETUP_SH) && existsSync(SETUP_PS1);
const read = (path) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe.skipIf(!hasInstallers)("installers define every preset they accept", () => {
  const sh = hasInstallers ? read(SETUP_SH) : "";
  const ps = hasInstallers ? read(SETUP_PS1) : "";
  const shPresets = hasInstallers ? /VALID_PRESETS=\(([^)]+)\)/.exec(sh)[1].trim().split(/\s+/) : [];
  const stackPresets = shPresets.filter((p) => p !== "custom");

  it("setup.ps1 and setup.sh accept the same presets", () => {
    const psPresets = [.../\$validPresets = @\(([^)]+)\)/.exec(ps)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(psPresets).toEqual(shPresets);
  });

  it.each(stackPresets)("setup.ps1 has stack labels and build/test/lint defaults for %s", (preset) => {
    const entries = ps.match(new RegExp(`'${preset}'\\s+\\{ '[^']+' \\}`, "g")) || [];
    // multi-preset label, single-preset label, build, test, lint
    expect(entries).toHaveLength(5);
  });

  it.skipIf(!BASH).each(stackPresets)("setup.sh selects a stack label and build/test/lint defaults for %s", (preset) => {
    const start = sh.indexOf("# Normalise: split comma-separated preset string into array");
    const end = sh.indexOf('\nif [[ "$FORCE" != true ]]', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const script = 'set -euo pipefail\nPRESET="$PFORGE_TEST_PRESET"\nred() { printf "%s\\n" "$*"; }\n'
      + sh.slice(start, end)
      + '\nprintf "LABEL=%s\\nBUILD=%s\\nTEST=%s\\nLINT=%s\\n" "$STACK_LABEL" "$DEFAULT_BUILD" "$DEFAULT_TEST" "$DEFAULT_LINT"\n';
    const r = spawnSync(BASH, ["-c", script], { encoding: "utf8", windowsHide: true, env: { ...process.env, PFORGE_TEST_PRESET: preset } });
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: "" });
    for (const key of ["LABEL", "BUILD", "TEST", "LINT"]) {
      expect(r.stdout).toMatch(new RegExp(`^${key}=\\S`, "m"));
    }
  });
});
