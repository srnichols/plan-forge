/**
 * `pforge update` and the dependency ranges a project raised in pforge-mcp and pforge-master (#435), run end to end.
 *
 * Update replaced each framework package's package.json with the release's copy, so a bump the project had merged
 * (Dependabot, say) was undone and an advisory it had closed came back. The manifests are now merged by the update
 * guard: a range the project raised is kept, and the rest of the file is the release's. manifest-merge.test.mjs holds
 * the merge; these run the whole update in every shell the machine has, with a stub npm, and read the files.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";
import { envWithStub, installsIn, writeStubNpm } from "./helpers/npm-stub.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
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

const manifest = (fields) => `${JSON.stringify(fields, null, 2)}\n`;

const RELEASE_MCP = {
  name: "plan-forge-mcp",
  version: "9.9.10",
  scripts: { test: "vitest run" },
  dependencies: { express: "^5.2.1", ws: "^8.22.0", dotenv: "^18.0.8", undici: "^7.30.1" },
  devDependencies: { vitest: "^5.0.5" },
};
const RELEASE_MASTER = { name: "pforge-master", version: "9.9.10", dependencies: { "@modelcontextprotocol/sdk": "^1.32.1" } };
const RELEASE_LOCK = '{"name":"release-lock","lockfileVersion":3}\n';
const PROJECT_LOCK = '{"name":"project-lock","lockfileVersion":3}\n';

// A project that raised express and vitest itself, is behind the release on ws, and has a dependency and a script of its own.
const MCP_WITH_BUMPS = manifest({
  name: "plan-forge-mcp",
  version: "9.9.9",
  scripts: { test: "echo mine" },
  dependencies: { express: "^5.4.0", ws: "^8.18.0", dotenv: "^18.0.8", "left-pad": "^1.3.0" },
  devDependencies: { vitest: "^5.1.0" },
});
const MASTER_BEHIND = manifest({ ...RELEASE_MASTER, version: "9.9.9", dependencies: { "@modelcontextprotocol/sdk": "^1.30.0" } });
const MCP_AHEAD = manifest({ ...RELEASE_MCP, dependencies: { express: "^5.4.0", ws: "^8.30.0", dotenv: "^18.1.0", undici: "^7.31.0" }, devDependencies: { vitest: "^5.1.0" } });

/** A source one release ahead of a project whose pforge-mcp and pforge-master manifests are the ones given. */
function seed({ mcp, master }) {
  const base = tempDir("pf-manifests-");
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, {
    VERSION: "9.9.10",
    "pforge-mcp/package.json": manifest(RELEASE_MCP),
    "pforge-mcp/package-lock.json": RELEASE_LOCK,
    "pforge-master/package.json": manifest(RELEASE_MASTER),
    // The shells use the update guard only where the source ships its index.
    "pforge-mcp/shipped-guidance-hashes.json": '{"hashes":[]}\n',
  });
  copyUpdateRuntime(source);
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "custom" }),
    "pforge-mcp/package.json": mcp,
    "pforge-mcp/package-lock.json": PROJECT_LOCK,
    "pforge-master/package.json": master,
  });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { source, project };
}

/** Runs update with a stub npm, and returns the output and the packages npm was asked to install in. */
function update(shell, project, args) {
  const stub = writeStubNpm(tempDir("pf-manifests-npm-"), shell.flavor);
  const log = join(stub, "npm.log");
  writeFileSync(log, "");
  const run = shell.run(project, args, envWithStub(stub, { STUB_NPM_LOG: log }));
  return { out: `${run.stdout}${run.stderr}`, status: run.status, installs: installsIn(readFileSync(log, "utf8")) };
}

const read = (project, rel) => readFileSync(join(project, rel), "utf8");
const readJson = (project, rel) => JSON.parse(read(project, rel));

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name}: update and the dependency ranges a project raised`, () => {
    it("keeps the ranges the project raised, takes the release's for the rest, and a second update has nothing to do", () => {
      const { source, project } = seed({ mcp: MCP_WITH_BUMPS, master: MASTER_BEHIND });
      const first = update(shell, project, [source, "--yes"]);
      expect(first.status, first.out).toBe(0);
      expect(first.out).toMatch(/Updated pforge-mcp\/package\.json \(kept your newer ranges: express \^5\.4\.0, vitest \^5\.1\.0\)/);

      const mcp = readJson(project, "pforge-mcp/package.json");
      expect(mcp.version).toBe("9.9.10");
      expect(mcp.scripts).toEqual({ test: "vitest run" });
      expect(mcp.dependencies, "express stays at the project's range, ws goes up to the release's, undici is added, left-pad is dropped").toEqual({
        express: "^5.4.0",
        ws: "^8.22.0",
        dotenv: "^18.0.8",
        undici: "^7.30.1",
      });
      expect(mcp.devDependencies).toEqual({ vitest: "^5.1.0" });

      expect(read(project, "pforge-master/package.json"), "a manifest that is only behind becomes the release's, byte for byte").toBe(manifest(RELEASE_MASTER));
      expect(first.out).not.toMatch(/Updated pforge-master\/package\.json \(/);
      expect(read(project, "pforge-mcp/package-lock.json"), "the release's lock replaces the project's; npm install resolves the kept ranges").toBe(RELEASE_LOCK);
      expect(first.installs).toEqual(expect.arrayContaining(["pforge-mcp", "pforge-master"]));

      // --force re-plans even though the version is current, so this is the merge being a fixed point, not the version check.
      const second = update(shell, project, [source, "--force", "--yes"]);
      expect(second.status, second.out).toBe(0);
      expect(second.out).toContain("All framework files are up to date.");
      expect(readJson(project, "pforge-mcp/package.json")).toEqual(mcp);
    }, 600_000);

    it("replaces them too with --overwrite-customized, after backing up the project's manifest", () => {
      const { source, project } = seed({ mcp: MCP_WITH_BUMPS, master: MASTER_BEHIND });
      const run = update(shell, project, [source, "--yes", "--overwrite-customized"]);
      expect(run.status, run.out).toBe(0);
      expect(run.out).toMatch(/Updated pforge-mcp\/package\.json \(your version backed up to \.forge\/update-backups\//);
      expect(read(project, "pforge-mcp/package.json")).toBe(manifest(RELEASE_MCP));
      const backups = [];
      const walk = (dir) => existsSync(dir) && readdirSync(dir, { withFileTypes: true }).forEach((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : backups.push(join(dir, entry.name))));
      walk(join(project, ".forge", "update-backups"));
      const backup = backups.find((file) => file.replace(/\\/g, "/").endsWith("pforge-mcp/package.json"));
      expect(backup, "the project's manifest is backed up").toBeDefined();
      expect(readFileSync(backup, "utf8").replace(/\r\n/g, "\n")).toBe(MCP_WITH_BUMPS);
    }, 600_000);

    it("lists a manifest that is behind the release in a dry run, and none that is ahead of it, and writes nothing", () => {
      const { source, project } = seed({ mcp: MCP_AHEAD, master: MASTER_BEHIND });
      const run = update(shell, project, [source, "--dry-run"]);
      expect(run.status, run.out).toBe(0);
      expect(run.out).toMatch(/UPDATE\s+pforge-master\/package\.json/);
      expect(run.out).not.toMatch(/UPDATE\s+pforge-mcp\/package\.json/);
      expect(read(project, "pforge-mcp/package.json")).toBe(MCP_AHEAD);
      expect(read(project, "pforge-master/package.json")).toBe(MASTER_BEHIND);
      expect(run.installs).toEqual([]);
    }, 600_000);
  });
}
