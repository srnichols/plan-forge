/**
 * `pforge update` and the guidance files a project has edited (#280), run end to end in every shell.
 *
 * The update guard sorts each guidance file the release ships: a copy the project still has as Plan Forge shipped it is
 * replaced (UPDATE), a file the project does not have is added (NEW), and a copy the project edited is kept, with the
 * release's version saved under .forge/update-pending (KEEP). pforge.sh holds the guided files and the guard's
 * verdicts in two newline-delimited strings and two small helpers, because Bash 3.2 on macOS has no associative arrays
 * (#427). Nothing exercised that path off macOS: a planted defect that made the helpers always answer "no" or "empty"
 * passed all 19 update tests that existed, so this runs the whole update and reads the files.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { contentHash } from "../update-guard.mjs";
import { copyUpdateRuntime } from "./helpers/update-runtime.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

const SHELLS = [
  { name: "pforge.sh", available: Boolean(BASH), run: (project, args) => spawnSync(BASH, ["pforge.sh", "update", ...args], { cwd: project, encoding: "utf8", timeout: 240_000 }) },
  {
    name: "pforge.ps1 under pwsh",
    available: PWSH_OK,
    run: (project, args) => spawnSync("pwsh", [...PS_ARGS, "-File", join(project, "pforge.ps1"), "update", ...args], { cwd: project, encoding: "utf8", timeout: 240_000 }),
  },
  {
    name: "pforge.ps1 under Windows PowerShell 5.1",
    available: isWin,
    run: (project, args) => spawnSync("powershell.exe", [...PS_ARGS, "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", ...args], { cwd: project, encoding: "utf8", timeout: 240_000 }),
  },
];

const GIT = ".github/instructions/git-workflow.instructions.md";
const CONTEXT = ".github/instructions/context-fuel.instructions.md";
const RUNBOOK = ".github/instructions/ai-plan-hardening-runbook.instructions.md";

const text = (title, line) => `# ${title}\n\n${line}\n`;
const OLD_GIT = text("Git workflow", "The text a release shipped before.");
const NEW_GIT = text("Git workflow", "The text this release ships.");
const EDITED_CONTEXT = text("Context fuel", "A line the project wrote itself.");
const NEW_CONTEXT = text("Context fuel", "The text this release ships.");
const NEW_RUNBOOK = text("Runbook", "A file the project does not have yet.");

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

/** A source one release ahead of a project that has an old copy, an edited copy, and no copy of the three files. */
function seed() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-guided-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, {
    VERSION: "9.9.10",
    [GIT]: NEW_GIT,
    [CONTEXT]: NEW_CONTEXT,
    [RUNBOOK]: NEW_RUNBOOK,
    // What the guard counts as "shipped": the old text of git-workflow. The edited text is in no release.
    "pforge-mcp/shipped-guidance-hashes.json": `${JSON.stringify({ hashes: [contentHash(OLD_GIT)] })}\n`,
  });
  copyUpdateRuntime(source);
  writeTree(project, { ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "custom" }), [GIT]: OLD_GIT, [CONTEXT]: EDITED_CONTEXT });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { source, project };
}

const read = (project, rel) => readFileSync(join(project, rel), "utf8").replace(/\r\n/g, "\n");

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]));
}

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name}: update and guidance files`, () => {
    it("replaces an unmodified old copy, adds a missing file, and keeps an edited copy with the new version beside it", () => {
      const { source, project } = seed();
      const run = shell.run(project, [source, "--yes"]);
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).toBe(0);
      expect(out).toMatch(/UPDATE\s+\.github\/instructions\/git-workflow\.instructions\.md/);
      expect(out).toMatch(/NEW\s+\.github\/instructions\/ai-plan-hardening-runbook\.instructions\.md/);
      expect(out).toMatch(/KEEP\s+\.github\/instructions\/context-fuel\.instructions\.md/);

      expect(read(project, GIT), "an unmodified old copy is replaced").toBe(NEW_GIT);
      expect(read(project, RUNBOOK), "a missing file is added").toBe(NEW_RUNBOOK);
      expect(read(project, CONTEXT), "an edited copy is left alone").toBe(EDITED_CONTEXT);
      expect(read(project, `.forge/update-pending/${CONTEXT}`), "the release's version is saved beside it").toBe(NEW_CONTEXT);
    }, 300_000);

    it("replaces an edited copy with --overwrite-customized, and backs up the edited text first", () => {
      const { source, project } = seed();
      const run = shell.run(project, [source, "--yes", "--overwrite-customized"]);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

      expect(read(project, CONTEXT)).toBe(NEW_CONTEXT);
      const backups = filesUnder(join(project, ".forge", "update-backups")).filter((file) => statSync(file).isFile() && file.replace(/\\/g, "/").endsWith("context-fuel.instructions.md"));
      expect(backups.map((file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n"))).toContain(EDITED_CONTEXT);
    }, 300_000);
  });
}
