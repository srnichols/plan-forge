/**
 * Meta-bug #428 — validate-setup said nothing about the leftovers of the older installer's `npm install --prefix`.
 *
 * That install, run from a directory with its own package.json, added a `file:` dependency on the directory to the
 * framework package's package.json and a link to it in node_modules (#422). A project in that state looked
 * healthy: validate-setup only checked that node_modules existed. It now warns about a file: or link: dependency
 * in pforge-mcp or pforge-master, and about a link at node_modules/plan-forge, and says how to repair it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

const SHELLS = [
  {
    name: "validate-setup.sh",
    available: Boolean(BASH),
    // NTFS junctions are not symbolic links to Bash on Windows, and Windows projects are validated by PowerShell.
    seesLinks: !isWin,
    run: (project) => spawnSync(BASH, [join(REPO_ROOT, "validate-setup.sh"), "--path", project], { encoding: "utf8", timeout: 120_000 }),
  },
  {
    name: "validate-setup.ps1 under pwsh",
    available: PWSH_OK,
    seesLinks: true,
    run: (project) => spawnSync("pwsh", [...PS_ARGS, "-File", join(REPO_ROOT, "validate-setup.ps1"), "-ProjectPath", project], { encoding: "utf8", timeout: 120_000 }),
  },
  {
    name: "validate-setup.ps1 under Windows PowerShell 5.1",
    available: isWin,
    seesLinks: true,
    run: (project) =>
      spawnSync("powershell.exe", [...PS_ARGS, "-ExecutionPolicy", "Bypass", "-File", join(REPO_ROOT, "validate-setup.ps1"), "-ProjectPath", project], { encoding: "utf8", timeout: 120_000 }),
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

const manifest = (dependencies = {}) => `${JSON.stringify({ name: "pkg", version: "9.9.9", dependencies }, null, 2)}\n`;

/** A project with both framework packages installed. `mcp` is what pforge-mcp's package.json depends on. */
function project({ mcp = {}, link = false } = {}) {
  const dir = tempDir("pf-meta-428-validate-");
  for (const [name, dependencies] of [["pforge-mcp", mcp], ["pforge-master", {}]]) {
    mkdirSync(join(dir, name, "node_modules"), { recursive: true });
    writeFileSync(join(dir, name, "server.mjs"), "");
    writeFileSync(join(dir, name, "package.json"), manifest(dependencies));
  }
  if (link) {
    const target = tempDir("pf-meta-428-checkout-");
    mkdirSync(dirname(join(dir, "pforge-mcp", "node_modules", "plan-forge")), { recursive: true });
    symlinkSync(target, join(dir, "pforge-mcp", "node_modules", "plan-forge"), isWin ? "junction" : "dir");
  }
  return dir;
}

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name}: what an older installer left in a framework package`, () => {
    const output = (dir) => {
      const run = shell.run(dir);
      return `${run.stdout}${run.stderr}`;
    };

    it("says nothing about a project whose packages depend only on registry packages", () => {
      expect(output(project({ mcp: { express: "^5.2.1" } }))).not.toContain("left by an older installer");
    }, 180_000);

    it("warns about a file: dependency in pforge-mcp, and about nothing in pforge-master", () => {
      const out = output(project({ mcp: { "plan-forge": "file:../../old-checkout" } }));
      expect(out).toMatch(/WARN\s+pforge-mcp: .*file:.*left by an older installer\. Run 'pforge update --force' to repair it/);
      expect(out).not.toMatch(/WARN\s+pforge-master: .*left by an older installer/);
    }, 180_000);

    it("warns about a link: dependency too", () => {
      expect(output(project({ mcp: { shared: "link:../shared" } }))).toMatch(/WARN\s+pforge-mcp: .*left by an older installer/);
    }, 180_000);

    it.skipIf(!shell.seesLinks)("warns about a link at node_modules/plan-forge even when package.json is clean", () => {
      expect(output(project({ link: true }))).toMatch(/WARN\s+pforge-mcp: .*node_modules\/plan-forge is a link.*left by an older installer/);
    }, 180_000);
  });
}
