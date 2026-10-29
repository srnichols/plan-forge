/**
 * `pforge update` and the guidance files a project has edited (#280), run end to end in every shell.
 *
 * The update guard sorts each guidance file the release ships: a copy the project still has as Plan Forge shipped it is
 * replaced (UPDATE), a file the project does not have is added (NEW), and a copy the project edited is kept, with the
 * release's version saved under .forge/update-pending (KEEP). pforge.sh holds the guided files and the guard's
 * verdicts in two newline-delimited strings and two small helpers, because Bash 3.2 on macOS has no associative arrays
 * (#427). Nothing exercised that path off macOS: a planted defect that made the helpers always answer "no" or "empty"
 * passed all 19 update tests that existed, so this runs the whole update and reads the files.
 *
 * The new version saved beside a kept file has to be the file the planner (update-plan.mjs) offers for it (#443). Both
 * shells used to look in Plan Forge's own `.github` first, which is the working copy of this repository and differs from
 * what projects receive for every shared instruction, every shared skill and the instructions each stack preset ships.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { contentHash } from "../update-guard.mjs";
import { buildPlan } from "../update-plan.mjs";
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

// Each row is a guidance file a project has edited. `dst` is also where this repository keeps its own working copy, so the
// source root has a copy that no project receives; `shipped` is the file the planner offers the project for it.
const KEPT_SOURCES = [
  { what: "an instruction its stack preset ships", dst: ".github/instructions/testing.instructions.md", shipped: "presets/typescript/.github/instructions/testing.instructions.md" },
  { what: "a shared instruction", dst: ".github/instructions/architecture-principles.instructions.md", shipped: "presets/shared/.github/instructions/architecture-principles.instructions.md" },
  { what: "a shared skill", dst: ".github/skills/bug-fix/SKILL.md", shipped: "presets/shared/skills/bug-fix/SKILL.md" },
  { what: "a hook", dst: ".github/hooks/PreCommit.mjs", shipped: "templates/.github/hooks/PreCommit.mjs" },
];
const ownCopy = (dst) => text(`Plan Forge's own ${dst}`, "Plan Forge's working copy, which no project receives.");
const shippedCopy = (dst) => text(`Shipped ${dst}`, "The text this release ships.");
const editedCopy = (dst) => text(`Edited ${dst}`, "A line the project wrote itself.");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A source one release ahead of a project of the typescript preset that has edited every file of KEPT_SOURCES. */
function seedKept() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-kept-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, {
    VERSION: "9.9.10",
    // No shipped version matches an edited copy, so the guard calls each of them customized.
    "pforge-mcp/shipped-guidance-hashes.json": `${JSON.stringify({ hashes: [] })}\n`,
    ...Object.fromEntries(KEPT_SOURCES.flatMap(({ dst, shipped }) => [[dst, ownCopy(dst)], [shipped, shippedCopy(dst)]])),
  });
  copyUpdateRuntime(source);
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "typescript" }),
    ...Object.fromEntries(KEPT_SOURCES.map(({ dst }) => [dst, editedCopy(dst)])),
  });
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

    it("saves the release's copy of each kept file from where the planner finds it, not from Plan Forge's own working copy", () => {
      const { source, project } = seedKept();
      const run = shell.run(project, [source, "--yes"]);
      const out = `${run.stdout}${run.stderr}`;
      expect(run.status, out).toBe(0);

      for (const { what, dst, shipped } of KEPT_SOURCES) {
        expect(out, `${what} is kept`).toMatch(new RegExp(`KEEP\\s+${escapeRegExp(dst)}`));
        expect(read(project, dst), `${what}: the project's edit is left alone`).toBe(editedCopy(dst));
        expect(read(project, `.forge/update-pending/${dst}`), `${what}: the copy beside it is ${shipped}`).toBe(shippedCopy(dst));
      }
    }, 300_000);

    it("replaces each kept file with the planner's copy under --overwrite-customized, and backs up the edit", () => {
      const { source, project } = seedKept();
      const run = shell.run(project, [source, "--yes", "--overwrite-customized"]);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

      const backups = filesUnder(join(project, ".forge", "update-backups")).filter((file) => statSync(file).isFile()).map((file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
      for (const { what, dst, shipped } of KEPT_SOURCES) {
        expect(read(project, dst), `${what} becomes ${shipped}`).toBe(shippedCopy(dst));
        expect(backups, `${what}: the edit is backed up first`).toContain(editedCopy(dst));
      }
    }, 300_000);
  });
}

describe("where update looks for a kept file's new version follows the planner (#443)", () => {
  const GUIDANCE = /^(\.github\/(prompts|instructions|agents|skills|hooks)\/|docs\/plans\/)/;
  // The order both shells search (Get-GuidanceSourceCandidates in pforge.ps1, _pf_guidance_source in pforge.sh): the
  // active preset's copy, shared, the shared skills, templates, and only then the source root's own copy.
  const searched = (dst, preset) => [
    `presets/${preset}/${dst}`,
    `presets/shared/${dst}`,
    dst.startsWith(".github/skills/") ? `presets/shared/skills/${dst.slice(".github/skills/".length)}` : null,
    `templates/${dst}`,
    dst,
  ].filter(Boolean);
  const presets = readdirSync(join(REPO_ROOT, "presets"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name);

  it.each(presets)("%s: every guidance file the planner offers is found with the same text", (preset) => {
    const emptyProject = mkdtempSync(join(tmpdir(), "pf-update-empty-"));
    tmpDirs.push(emptyProject);
    const { operations } = buildPlan({ sourceRoot: REPO_ROOT, projectRoot: emptyProject, presetsOverride: [preset] });
    const offered = operations.filter((op) => op.src && GUIDANCE.test(op.dst));
    expect(offered.length, "the plan offers guidance files").toBeGreaterThan(50);

    const wrong = offered.flatMap((op) => {
      const found = searched(op.dst, preset).find((rel) => existsSync(join(REPO_ROOT, rel)));
      const same = found && readFileSync(join(REPO_ROOT, found)).equals(readFileSync(join(REPO_ROOT, op.src)));
      return same ? [] : [`${op.dst}: the search finds ${found ?? "nothing"}, the planner offers ${op.src}`];
    });
    expect(wrong).toEqual([]);
  });
});
