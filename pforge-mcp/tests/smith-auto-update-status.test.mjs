/**
 * `pforge smith` auto-update status line, both shells.
 *
 * - PowerShell computed cache ages as local Get-Date minus a UTC timestamp, so a
 *   cache checked 5 minutes ago read "-355m" on a UTC-6 machine (and the 24-hour
 *   version-check cache stayed "fresh" for hours too long east of UTC… or expired
 *   early west of it).
 * - Both shells read `latestVersion` from .forge/update-check.json, but
 *   update-check.mjs writes `latest`, so "Last tag" was always "unknown".
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;
const hasWrappers = existsSync(join(REPO, "pforge.ps1")) && existsSync(join(REPO, "pforge.sh"));
const MINUTES_AGO = 7;

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function project() {
  const dir = mkdtempSync(join(tmpdir(), "pf-smith-au-"));
  dirs.push(dir);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  for (const f of ["pforge.ps1", "pforge.sh"]) copyFileSync(join(REPO, f), join(dir, f));
  writeFileSync(join(dir, ".forge.json"), JSON.stringify({ projectName: "x", preset: "custom", templateVersion: "9.9.8" }));
  mkdirSync(join(dir, ".forge"));
  writeFileSync(join(dir, ".forge", "update-check.json"), JSON.stringify({
    latest: "9.9.9",
    checkedAt: new Date(Date.now() - MINUTES_AGO * 60_000).toISOString(),
    url: "https://example.invalid",
    publishedAt: null,
  }));
  return dir;
}

function autoUpdateLine(output) {
  return output.split(/\r?\n/).find((l) => l.includes("Cache age:")) ?? "";
}

function expectLine(line) {
  expect(line).toContain("Last tag: v9.9.9");
  const age = Number(/Cache age: (-?\d+)m/.exec(line)?.[1]);
  expect(age, line).toBeGreaterThanOrEqual(MINUTES_AGO - 1);
  expect(age, line).toBeLessThanOrEqual(MINUTES_AGO + 2);
}

describe.skipIf(!hasWrappers)("smith auto-update status", () => {
  it.skipIf(!PWSH)("pforge.ps1 reports the real cache age and the cached tag", () => {
    const dir = project();
    const r = spawnSync("pwsh", ["-NoProfile", "-File", join(dir, "pforge.ps1"), "smith"], { cwd: dir, encoding: "utf8", timeout: 170_000 });
    expectLine(autoUpdateLine(r.stdout + r.stderr));
  }, 180_000);

  it.skipIf(!BASH)("pforge.sh reports the real cache age and the cached tag", () => {
    const dir = project();
    const r = spawnSync(BASH, ["pforge.sh", "smith"], { cwd: dir, encoding: "utf8", timeout: 170_000 });
    expectLine(autoUpdateLine(r.stdout + r.stderr));
  }, 180_000);
});
