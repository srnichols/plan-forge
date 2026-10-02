/**
 * #304 — non-interactive setup must not wait for input.
 *
 * `setup.ps1 -Preset custom -NonInteractive` (no -Force) looped forever on the
 * "Build command" prompt: the custom preset has no default and Read-Host kept
 * returning nothing at end of input. Both installers now take every default
 * when run non-interactively and skip the "Proceed?" confirmation.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SETUP_PS1 = join(REPO_ROOT, "setup.ps1");
const SETUP_SH = join(REPO_ROOT, "setup.sh");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";
const PWSH = ["pwsh", "pwsh.exe"].find((cmd) => spawnSync(cmd, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0);
// Development checkout only: projects receive pforge-mcp/ without the installers.
const hasInstallers = existsSync(SETUP_PS1) && existsSync(SETUP_SH);
const TIMEOUT_MS = 240_000;

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function newProject() {
  const dir = mkdtempSync(join(tmpdir(), "pf-setup-noninteractive-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function expectInstalled(result, project) {
  expect(result.error?.code, "setup timed out waiting for input").not.toBe("ETIMEDOUT");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const config = JSON.parse(readFileSync(join(project, ".forge.json"), "utf8"));
  expect(config.preset).toBe("custom");
  // Every LiveGuard hook is seeded, so `pforge smith` reports 8/8 on a fresh install.
  expect(config.hooks.postRun).toEqual({ invokeAuditor: { onFailure: false, everyNRuns: null } });
}

describe.skipIf(!hasInstallers)("#304 non-interactive setup takes defaults", () => {
  it.skipIf(!PWSH)("setup.ps1 -Preset custom -NonInteractive finishes without -Force", () => {
    const project = newProject();
    const env = { ...process.env, CI: "", PFORGE_NONINTERACTIVE: "" };
    const r = spawnSync(PWSH, ["-NoProfile", "-File", SETUP_PS1, "-Preset", "custom", "-ProjectPath", project, "-ProjectName", "Acme", "-NonInteractive"], { encoding: "utf8", timeout: TIMEOUT_MS, env });
    expectInstalled(r, project);
  }, TIMEOUT_MS);

  it.skipIf(!BASH)("setup.sh --preset custom --non-interactive finishes without --force", () => {
    const project = newProject();
    const env = { ...process.env, CI: "", PFORGE_NONINTERACTIVE: "" };
    const r = spawnSync(BASH, ["setup.sh", "--preset", "custom", "--path", project.replace(/\\/g, "/"), "--name", "Acme", "--non-interactive"], { cwd: REPO_ROOT, encoding: "utf8", timeout: TIMEOUT_MS, env });
    expectInstalled(r, project);
  }, TIMEOUT_MS);
});
