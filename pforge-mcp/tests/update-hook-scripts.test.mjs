/**
 * `pforge update` must deliver every hook file, including hooks/scripts/*.
 *
 * Found while fixing meta-bug #287: pforge.sh enumerated templates/.github/hooks
 * with `find -maxdepth 1`, so the lifecycle scripts under hooks/scripts/ — the
 * launchers' targets, and every #287 script fix — were never offered to
 * projects updated from Bash. pforge.ps1 already recursed. Both are checked
 * here with --dry-run against a local source.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

/** A local Plan Forge source and a project one release behind it. */
function seed() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-hooks-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, {
    VERSION: "9.9.9",
    "templates/.github/hooks/plan-forge.json": "{\"hooks\":{}}\n",
    "templates/.github/hooks/scripts/check-forbidden.sh": "echo new\n",
    "templates/.github/hooks/scripts/check-diff-classify.mjs": "export {};\n",
  });
  // Both shells run the source's update-plan.mjs and refuse a source without it (#299).
  copyUpdateRuntime(source);
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: "9.9.8", preset: "custom" }),
    ".github/hooks/plan-forge.json": "{\"hooks\":{}}\n",
    ".github/hooks/scripts/check-forbidden.sh": "echo old\n",
  });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { source, project };
}

function expectHookScriptsOffered(output) {
  expect(output).toMatch(/UPDATE\s+\.github\/hooks\/scripts\/check-forbidden\.sh/);
  expect(output).toMatch(/NEW\s+\.github\/hooks\/scripts\/check-diff-classify\.mjs/);
  expect(output).not.toMatch(/\.github\/hooks\/plan-forge\.json/);
}

describe.skipIf(!BASH)("pforge.sh update offers hooks/scripts files", () => {
  it("lists changed and new hook scripts in a dry run", () => {
    const { source, project } = seed();
    const r = spawnSync(BASH, ["pforge.sh", "update", source, "--dry-run"], { cwd: project, encoding: "utf-8", timeout: 120_000 });
    expectHookScriptsOffered(r.stdout);
  });
});

describe.skipIf(!isWin)("pforge.ps1 update offers hooks/scripts files", () => {
  it("lists changed and new hook scripts in a dry run", () => {
    const { source, project } = seed();
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", source, "--dry-run"],
      { cwd: project, encoding: "utf-8", timeout: 120_000 },
    );
    expectHookScriptsOffered(r.stdout.replace(/\\/g, "/"));
  });
});
