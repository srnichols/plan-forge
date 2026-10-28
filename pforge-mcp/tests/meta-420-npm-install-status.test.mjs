/**
 * Meta-bug #420 — the installers reported a failed `npm install` as a success.
 *
 * setup.ps1 and pforge.ps1 ran `& npm install` inside try/catch and printed "npm install complete" after
 * it. A native command's non-zero exit does not throw in PowerShell, so the catch never ran and the exit
 * status was never read. setup.sh and pforge.sh did check the status, but sent npm's output to /dev/null,
 * so "npm install failed" never said why. Both are the same step in eight places: pforge-mcp and
 * pforge-master in each of the four scripts.
 *
 * Each script now has one helper that runs npm, reads the status, and on failure shows the end of npm's own
 * output. The helpers are read out of the scripts and run against a stub npm, because a real install takes
 * minutes and needs the network.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";
const PS_SHELLS = [
  { name: "pwsh", exe: "pwsh", available: spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0 },
  { name: "Windows PowerShell 5.1", exe: "powershell.exe", available: isWin },
].filter((shell) => shell.available);

const SCRIPTS = {
  "setup.ps1": readFileSync(join(REPO_ROOT, "setup.ps1"), "utf8"),
  "pforge.ps1": readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf8"),
  "setup.sh": readFileSync(join(REPO_ROOT, "setup.sh"), "utf8"),
  "pforge.sh": readFileSync(join(REPO_ROOT, "pforge.sh"), "utf8"),
};

const NPM_ERROR_LINES = ["npm error Cannot read properties of null (reading 'edgesOut')", "npm error A complete log of this run can be found in: /tmp/npm-debug.log"];

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
const posix = (path) => path.replace(/\\/g, "/");

/** The environment with `stub` first on PATH. On Windows the variable is `Path`, and a second `PATH` key would be ignored. */
function envWithStub(stub, extra) {
  const env = { ...process.env, ...extra };
  const key = Object.keys(env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  env[key] = `${stub}${delimiter}${env[key] ?? ""}`;
  return env;
}

/**
 * A directory holding a stub `npm`: exits 0, or with MODE=fail prints npm's error lines and exits 1. It logs where it ran
 * and with what. PowerShell on Windows finds `npm.cmd`; bash finds the extensionless script. Each gets a directory of its
 * own, because PowerShell would otherwise pick the extensionless file.
 */
function stubNpmDir(flavor) {
  const dir = tempDir("pf-meta-420-npm-");
  if (isWin && flavor === "ps") {
    // Labels, not a parenthesised block: the error text has parentheses, which would end the block early.
    writeFileSync(join(dir, "npm.cmd"), [
      "@echo off",
      'echo "%CD%" "%*" >> "%STUB_NPM_LOG%"',
      'if "%STUB_NPM_MODE%"=="fail" goto fail',
      'if "%STUB_NPM_MODE%"=="warn" goto warn',
      "exit /b 0",
      ":warn",
      "echo npm warn deprecated left-pad@1.0.0: use String.prototype.padStart 1>&2",
      "exit /b 0",
      ":fail",
      ...NPM_ERROR_LINES.map((line) => `echo ${line} 1>&2`),
      "exit /b 1",
      "",
    ].join("\r\n"));
    return dir;
  }
  const script = [
    "#!/usr/bin/env bash",
    'echo "$PWD $*" >> "$STUB_NPM_LOG"',
    'if [ "$STUB_NPM_MODE" = warn ]; then',
    '  echo "npm warn deprecated left-pad@1.0.0: use String.prototype.padStart" >&2',
    "fi",
    'if [ "$STUB_NPM_MODE" = fail ]; then',
    ...NPM_ERROR_LINES.map((line) => `  echo "${line}" >&2`),
    "  exit 1",
    "fi",
    "exit 0",
    "",
  ].join("\n");
  writeFileSync(join(dir, "npm"), script);
  if (!isWin) chmodSync(join(dir, "npm"), 0o755);
  return dir;
}

// ─── the helpers, read out of the scripts ────────────────────────────────────

function extractPsFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  expect(start, `defines ${name}`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n}\n", start) + 3);
}

function extractShFunction(source, name) {
  const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, "m").exec(source);
  expect(match, `defines ${name}`).not.toBeNull();
  return match[0];
}

/** Runs Install-NpmDependencies from `file` in one PowerShell and returns what it printed. */
function runPs({ exe, file, mode, throwing = false }) {
  const stub = stubNpmDir("ps");
  const workDir = tempDir("pf-meta-420-pkg-");
  const log = join(workDir, "npm.log");
  writeFileSync(log, "");
  const driver = join(workDir, "driver.ps1");
  writeFileSync(driver, `\uFEFF${[
    "$ErrorActionPreference = 'Stop'",
    extractPsFunction(SCRIPTS[file], "Install-NpmDependencies"),
    throwing ? "function npm { throw 'npm is not installed' }" : "",
    `Install-NpmDependencies '${workDir}' 'pforge-master'`,
    "Write-Output 'AFTER'",
  ].join("\n")}\n`);
  const env = envWithStub(stub, { STUB_NPM_MODE: mode, STUB_NPM_LOG: log });
  const args = ["-NoProfile", "-NonInteractive", ...(exe === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : []), "-File", driver];
  const result = spawnSync(exe, args, { encoding: "utf8", timeout: 120_000, env });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, log: readFileSync(log, "utf8"), workDir };
}

/** Runs the shell helper from `file` under `set -euo pipefail`, as the scripts run, and returns what it printed. */
function runSh({ file, mode }) {
  const stub = stubNpmDir("sh");
  const workDir = tempDir("pf-meta-420-pkg-");
  const log = join(workDir, "npm.log");
  writeFileSync(log, "");
  const driver = join(workDir, "driver.sh");
  writeFileSync(driver, [
    "set -euo pipefail",
    'green() { printf "%s\\n" "$*"; }',
    'yellow() { printf "%s\\n" "$*"; }',
    extractShFunction(SCRIPTS[file], "pf_npm_install"),
    `pf_npm_install "${posix(workDir)}" "pforge-master"`,
    "echo AFTER",
    "",
  ].join("\n"));
  const env = envWithStub(stub, { STUB_NPM_MODE: mode, STUB_NPM_LOG: log });
  const result = spawnSync(BASH, [posix(driver)], { encoding: "utf8", timeout: 60_000, env });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, log: readFileSync(log, "utf8"), workDir };
}

// ─── behaviour ───────────────────────────────────────────────────────────────

describe.each(PS_SHELLS)("PowerShell helper in $name", ({ exe }) => {
  it.each(["setup.ps1", "pforge.ps1"])("%s: says complete when npm succeeds, and ran npm install for that package", (file) => {
    const run = runPs({ exe, file, mode: "ok" });
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("npm install complete");
    expect(run.out).not.toMatch(/failed/i);
    expect(run.log).toMatch(/install/);
    expect(run.log.toLowerCase()).toContain(run.workDir.toLowerCase().replace(/\\/g, "/").split("/").pop());
  }, 120_000);

  it.each(["setup.ps1", "pforge.ps1"])("%s: says failed, with the exit status and why, when npm exits 1", (file) => {
    const run = runPs({ exe, file, mode: "fail" });
    expect(run.status, run.out).toBe(0);
    expect(run.out).not.toContain("npm install complete");
    expect(run.out).toContain("npm install failed (exit 1)");
    expect(run.out).toContain("cd pforge-master && npm install");
    for (const line of NPM_ERROR_LINES) expect(run.out).toContain(line);
    expect(run.out).toContain("AFTER");
  }, 120_000);

  it.each(["setup.ps1", "pforge.ps1"])("%s: says complete, not failed, when npm exits 0 but writes a warning to stderr", (file) => {
    const run = runPs({ exe, file, mode: "warn" });
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("npm install complete");
    expect(run.out).not.toMatch(/failed/i);
  }, 120_000);

  it.each(["setup.ps1", "pforge.ps1"])("%s: says failed when npm cannot be run at all", (file) => {
    const run = runPs({ exe, file, mode: "ok", throwing: true });
    expect(run.status, run.out).toBe(0);
    expect(run.out).not.toContain("npm install complete");
    expect(run.out).toContain("npm install failed");
    expect(run.out).toContain("npm is not installed");
    expect(run.out).toContain("AFTER");
  }, 120_000);
});

describe.skipIf(!BASH)("shell helper", () => {
  it.each(["setup.sh", "pforge.sh"])("%s: says complete when npm succeeds, and ran npm install in that package", (file) => {
    const run = runSh({ file, mode: "ok" });
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("npm install complete");
    expect(run.out).not.toMatch(/failed/i);
    expect(run.log).toMatch(/install/);
    expect(run.log).toContain(posix(run.workDir).split("/").pop());
  });

  it.each(["setup.sh", "pforge.sh"])("%s: says complete, not failed, when npm exits 0 but writes a warning to stderr", (file) => {
    const run = runSh({ file, mode: "warn" });
    expect(run.status, run.out).toBe(0);
    expect(run.out).toContain("npm install complete");
    expect(run.out).not.toMatch(/failed/i);
  });

  it.each(["setup.sh", "pforge.sh"])("%s: says failed, with the exit status and why, and carries on under set -e", (file) => {
    const run = runSh({ file, mode: "fail" });
    expect(run.status, run.out).toBe(0);
    expect(run.out).not.toContain("npm install complete");
    expect(run.out).toContain("npm install failed (exit 1)");
    expect(run.out).toContain("cd pforge-master && npm install");
    for (const line of NPM_ERROR_LINES) expect(run.out).toContain(line);
    expect(run.out).toContain("AFTER");
  });
});

// ─── every call site uses the helper ─────────────────────────────────────────

describe("the install steps of the four scripts", () => {
  const count = (source, pattern) => (source.match(pattern) ?? []).length;

  it.each(["setup.ps1", "pforge.ps1"])("%s runs npm install only inside the helper, and calls the helper for pforge-mcp and pforge-master", (file) => {
    const source = SCRIPTS[file];
    expect(count(source, /(?<![&\w])&\s*npm\s+install\b(?!\s+--save-optional)/g), "`& npm install` appears once, in the helper").toBe(1);
    expect(count(source, /Install-NpmDependencies\s+\$\w+\s+'pforge-mcp'/g), "pforge-mcp call").toBe(1);
    expect(count(source, /Install-NpmDependencies\s+\$\w+\s+'pforge-master'/g), "pforge-master call").toBe(1);
    expect(source).not.toMatch(/\$(null|npmOutput)\s*=\s*&\s*npm\s+install/);
  });

  it.each(["setup.sh", "pforge.sh"])("%s runs npm install only inside the helper, and calls the helper for pforge-mcp and pforge-master", (file) => {
    const source = SCRIPTS[file];
    expect(source, "no npm output is sent to /dev/null").not.toMatch(/npm install[^\n]*2>\/dev\/null/);
    expect(source, "no --silent, which hides the reason too").not.toMatch(/npm install\s+--silent/);
    expect(count(source, /^\s*pf_npm_install\s+"[^"]+"\s+"pforge-mcp"/gm), "pforge-mcp call").toBe(1);
    expect(count(source, /^\s*pf_npm_install\s+"[^"]+"\s+"pforge-master"/gm), "pforge-master call").toBe(1);
  });
});
