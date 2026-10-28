/**
 * Meta-bug #428 — `pforge update` did not repair a project's dependencies when every file was already current.
 *
 * Update installed the npm dependencies of pforge-mcp and pforge-master only when it had changed one of their
 * files in that run. When every file was current it printed "All framework files are up to date." and returned
 * first, even with --force. A project whose dependencies were wrong for another reason, such as the file: link an
 * older installer left (#422) or an install that failed (#420, #421), was never repaired. Self-update's second
 * pass, which runs `update --force --yes`, could not repair it either: a project updated from 3.35.2 kept a
 * vulnerable body-parser, a stale link in node_modules, and no pforge-master install.
 *
 * With --force both shells install both packages whether or not a file changed. Without it they say so when a
 * package has a package.json and no node_modules. The cases run a stub npm and read where it ran; the last runs
 * real npm against a package with no dependencies, which needs no network.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";
import { REAL_NPM_ENV, envWithStub, installsIn, writeStubNpm } from "./helpers/npm-stub.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const NPM_OK = spawnSync("npm", ["--version"], { shell: isWin }).status === 0;
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

const SHELLS = [
  {
    name: "pforge.sh",
    flavor: "sh",
    available: Boolean(BASH),
    run: (project, args, env) => spawnSync(BASH, ["pforge.sh", "update", ...args], { cwd: project, encoding: "utf8", timeout: 240_000, env }),
  },
  {
    name: "pforge.ps1 under pwsh",
    flavor: "ps",
    available: PWSH_OK,
    run: (project, args, env) => spawnSync("pwsh", [...PS_ARGS, "-File", join(project, "pforge.ps1"), "update", ...args], { cwd: project, encoding: "utf8", timeout: 240_000, env }),
  },
  {
    name: "pforge.ps1 under Windows PowerShell 5.1",
    flavor: "ps",
    available: isWin,
    run: (project, args, env) =>
      spawnSync("powershell.exe", [...PS_ARGS, "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", ...args], { cwd: project, encoding: "utf8", timeout: 240_000, env }),
  },
];

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

const pkg = (name, version = "9.9.9") => `${JSON.stringify({ name, version, dependencies: {} }, null, 2)}\n`;

/**
 * A local Plan Forge source and a project that already has every file the source ships under the two packages.
 * `sourceExtra` is applied to the source after the project is copied from it, so it is what the update would change.
 */
function seed({ projectVersion = "9.9.9", sourceVersion = "9.9.9", sourceExtra = {}, nodeModules = false, projectHooks = false } = {}) {
  const base = tempDir("pf-meta-428-");
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, { VERSION: sourceVersion, "pforge-mcp/package.json": pkg("plan-forge-mcp"), "pforge-master/package.json": pkg("pforge-master") });
  copyUpdateRuntime(source);
  cpSync(join(source, "pforge-mcp"), join(project, "pforge-mcp"), { recursive: true });
  cpSync(join(source, "pforge-master"), join(project, "pforge-master"), { recursive: true });
  writeTree(source, sourceExtra);
  writeFileSync(join(project, ".forge.json"), JSON.stringify({ templateVersion: projectVersion, preset: "custom" }));
  // Update offers a hook file only to a project that already has hooks.
  if (projectHooks) writeTree(project, { ".github/hooks/plan-forge.json": HOOK_JSON });
  if (nodeModules) {
    for (const name of ["pforge-mcp", "pforge-master"]) {
      mkdirSync(join(project, name, "node_modules"), { recursive: true });
    }
  }
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { source, project };
}

/** Runs update with a stub npm and returns the output and the packages npm was asked to install in. */
function update(shell, project, args) {
  const stub = writeStubNpm(tempDir("pf-meta-428-npm-"), shell.flavor);
  const log = join(stub, "npm.log");
  writeFileSync(log, "");
  const run = shell.run(project, args, envWithStub(stub, { STUB_NPM_LOG: log }));
  return { out: `${run.stdout}${run.stderr}`, status: run.status, installs: installsIn(readFileSync(log, "utf8")) };
}

const HOOK_JSON = '{"hooks":{}}\n';
const HOOK_FILES = { "templates/.github/hooks/plan-forge.json": HOOK_JSON, "templates/.github/hooks/scripts/check-diff-classify.mjs": "export {};\n" };
const HOOK_OFFERED = /NEW\s+\.github\/hooks\/scripts\/check-diff-classify\.mjs/;

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name}: update and the dependencies of pforge-mcp and pforge-master`, () => {
    it("installs both with --force when every file is current", () => {
      const { source, project } = seed();
      const run = update(shell, project, [source, "--force", "--yes"]);
      expect(run.out).toContain("All framework files are up to date.");
      expect(run.out).toContain("Installing MCP dependencies...");
      expect(run.out).toContain("Installing pforge-master dependencies...");
      expect(run.installs).toEqual(["pforge-mcp", "pforge-master"]);
      expect(run.status, run.out).toBe(0);
    }, 300_000);

    it("installs nothing with --force --dry-run", () => {
      const { source, project } = seed();
      const run = update(shell, project, [source, "--force", "--dry-run"]);
      expect(run.installs).toEqual([]);
      expect(run.status, run.out).toBe(0);
    }, 300_000);

    it("installs nothing without --force, and says which package has no node_modules", () => {
      const { source, project } = seed();
      const run = update(shell, project, [source, "--yes"]);
      expect(run.out).toContain("Already up to date");
      expect(run.installs).toEqual([]);
      expect(run.out).toMatch(/pforge-mcp has no node_modules\. Run 'pforge update --force'/);
      expect(run.out).toMatch(/pforge-master has no node_modules\. Run 'pforge update --force'/);
    }, 300_000);

    it("says nothing about node_modules when the packages have them", () => {
      const { source, project } = seed({ nodeModules: true });
      const run = update(shell, project, [source, "--yes"]);
      expect(run.out).toContain("Already up to date");
      expect(run.out).not.toContain("has no node_modules");
    }, 300_000);

    it("still installs nothing when it changed files outside the two packages", () => {
      const { source, project } = seed({ projectVersion: "9.9.8", projectHooks: true, sourceExtra: HOOK_FILES });
      const run = update(shell, project, [source, "--yes"]);
      expect(run.out).toMatch(HOOK_OFFERED);
      expect(run.installs).toEqual([]);
      expect(run.status, run.out).toBe(0);
    }, 300_000);

    it("installs only pforge-mcp when it changed a file of pforge-mcp", () => {
      const { source, project } = seed({ projectVersion: "9.9.8", sourceExtra: { "pforge-mcp/package.json": pkg("plan-forge-mcp", "9.9.10") } });
      const run = update(shell, project, [source, "--yes"]);
      expect(run.out).toMatch(/UPDATE\s+pforge-mcp\/package\.json/);
      expect(run.installs).toEqual(["pforge-mcp"]);
      expect(run.status, run.out).toBe(0);
    }, 300_000);

    it("installs both with --force when it changed files outside the two packages", () => {
      const { source, project } = seed({ projectVersion: "9.9.8", projectHooks: true, sourceExtra: HOOK_FILES });
      const run = update(shell, project, [source, "--force", "--yes"]);
      expect(run.out).toMatch(HOOK_OFFERED);
      expect(run.installs).toEqual(["pforge-mcp", "pforge-master"]);
      expect(run.status, run.out).toBe(0);
    }, 300_000);

    it.skipIf(!NPM_OK)("repairs a project whose node_modules still holds the link an older installer left, with real npm, and leaves what it pointed at alone", () => {
      const { source, project } = seed();
      const oldCheckout = tempDir("pf-meta-428-old-checkout-");
      writeFileSync(join(oldCheckout, "keep.txt"), "do not delete");
      mkdirSync(join(project, "pforge-mcp", "node_modules"), { recursive: true });
      const link = join(project, "pforge-mcp", "node_modules", "plan-forge");
      symlinkSync(oldCheckout, link, isWin ? "junction" : "dir");

      const run = shell.run(project, [source, "--force", "--yes"], { ...process.env, ...REAL_NPM_ENV });
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).toBe(0);
      expect(out).not.toContain("npm install failed");
      const linkRemains = (() => {
        try {
          lstatSync(link);
          return true;
        } catch {
          return false;
        }
      })();
      expect(linkRemains, "the stale link is gone").toBe(false);
      expect(readFileSync(join(oldCheckout, "keep.txt"), "utf8")).toBe("do not delete");
      expect(existsSync(join(project, "pforge-master", "node_modules")) || existsSync(join(project, "pforge-master", "package-lock.json"))).toBe(true);
    }, 300_000);
  });
}
