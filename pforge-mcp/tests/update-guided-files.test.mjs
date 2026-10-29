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

// Each row is a guidance file a project has edited. `from` lists, best first, the places in the source that hold a copy of
// it: the first is the file the planner offers the project for it, and each of the others ranks below it. The source root
// also holds its own copy at `dst`, which is this repository's working copy and which no project receives. The project is
// on two presets, typescript and python, so the first preset's copy has to win over the second's.
const KEPT_SOURCES = [
  {
    what: "an instruction its stack presets ship",
    dst: ".github/instructions/testing.instructions.md",
    from: [
      "presets/typescript/.github/instructions/testing.instructions.md",
      "presets/python/.github/instructions/testing.instructions.md",
      "presets/shared/.github/instructions/testing.instructions.md",
      "templates/.github/instructions/testing.instructions.md",
    ],
  },
  {
    what: "a shared instruction",
    dst: ".github/instructions/architecture-principles.instructions.md",
    from: ["presets/shared/.github/instructions/architecture-principles.instructions.md", "templates/.github/instructions/architecture-principles.instructions.md"],
  },
  {
    what: "a shared skill",
    dst: ".github/skills/bug-fix/SKILL.md",
    from: ["presets/shared/skills/bug-fix/SKILL.md", "templates/.github/skills/bug-fix/SKILL.md"],
  },
  { what: "a hook", dst: ".github/hooks/PreCommit.mjs", from: ["templates/.github/hooks/PreCommit.mjs"] },
];
const copyOf = (path) => text(`Copy at ${path}`, "The text of this file in the source.");
const editedCopy = (dst) => text(`Edited ${dst}`, "A line the project wrote itself.");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A source one release ahead of a project of the typescript and python presets that has edited every file of KEPT_SOURCES. */
function seedKept() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-kept-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  writeTree(source, {
    VERSION: "9.9.10",
    // No shipped version matches an edited copy, so the guard calls each of them customized.
    "pforge-mcp/shipped-guidance-hashes.json": `${JSON.stringify({ hashes: [] })}\n`,
    ...Object.fromEntries(KEPT_SOURCES.flatMap(({ dst, from }) => [dst, ...from].map((path) => [path, copyOf(path)]))),
  });
  copyUpdateRuntime(source);
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "typescript,python" }),
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

      for (const { what, dst, from } of KEPT_SOURCES) {
        expect(out, `${what} is kept`).toMatch(new RegExp(`KEEP\\s+${escapeRegExp(dst)}`));
        expect(read(project, dst), `${what}: the project's edit is left alone`).toBe(editedCopy(dst));
        expect(read(project, `.forge/update-pending/${dst}`), `${what}: the copy beside it is ${from[0]}`).toBe(copyOf(from[0]));
      }
    }, 300_000);

    it("replaces each kept file with the planner's copy under --overwrite-customized, and backs up the edit", () => {
      const { source, project } = seedKept();
      const run = shell.run(project, [source, "--yes", "--overwrite-customized"]);
      expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

      const backups = filesUnder(join(project, ".forge", "update-backups")).filter((file) => statSync(file).isFile()).map((file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
      for (const { what, dst, from } of KEPT_SOURCES) {
        expect(read(project, dst), `${what} becomes ${from[0]}`).toBe(copyOf(from[0]));
        expect(backups, `${what}: the edit is backed up first`).toContain(editedCopy(dst));
      }
    }, 300_000);
  });
}

/** The text of a function that starts at column 0 and ends at the first closing brace at column 0 after it. */
function functionText(file, header) {
  const source = readFileSync(join(REPO_ROOT, file), "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf(`\n${header}`);
  expect(start, `${file} defines ${header}`).toBeGreaterThan(-1);
  return source.slice(start + 1, source.indexOf("\n}\n", start) + 3);
}

// The search each shell runs for a kept file's new version, taken from the script as it ships and run over lines of
// "<presets, comma separated><TAB><path in the project>". Each answers with a line of "<presets><TAB><path><TAB><path in the
// source, or nothing>". The source is a path with forward slashes.
const bashLookup = (source, input) => {
  const script = [
    "set -u",
    functionText("pforge.sh", "_pf_guidance_source() {"),
    "while IFS=$'\\t' read -r list dst; do",
    '  IFS=, read -ra presets <<< "$list"',
    '  answer=""',
    '  _pf_guidance_source "$1" "$dst" answer "${presets[@]}"',
    "  printf '%s\\t%s\\t%s\\n' \"$list\" \"$dst\" \"${answer#\"$1\"/}\"",
    "done",
  ].join("\n");
  return spawnSync(BASH, ["-c", script, "lookup", source], { input, encoding: "utf8", timeout: 240_000 });
};

const powershellLookup = (executable, args) => (source, input) => {
  const dir = mkdtempSync(join(tmpdir(), "pf-lookup-"));
  tmpDirs.push(dir);
  const script = join(dir, "lookup.ps1");
  writeFileSync(
    script,
    [
      "param([string]$Source)",
      functionText("pforge.ps1", "function Get-GuidanceSourceCandidates("),
      "foreach ($line in ([Console]::In.ReadToEnd() -split '\\r?\\n')) {",
      "    if (-not $line) { continue }",
      "    $parts = $line.Split([char]9)",
      "    $found = Get-GuidanceSourceCandidates $Source $parts[1] ($parts[0] -split ',') | Where-Object { Test-Path $_ } | Select-Object -First 1",
      "    $rel = if ($found) { $found.Substring($Source.Length).TrimStart('\\', '/').Replace('\\', '/') } else { '' }",
      "    ($parts[0] + [char]9 + $parts[1] + [char]9 + $rel)",
      "}",
      "",
    ].join("\n"),
  );
  return spawnSync(executable, [...args, script, source], { input, encoding: "utf8", timeout: 240_000 });
};

const LOOKUPS = {
  "pforge.sh": bashLookup,
  "pforge.ps1 under pwsh": powershellLookup("pwsh", ["-NoProfile", "-File"]),
  "pforge.ps1 under Windows PowerShell 5.1": powershellLookup("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]),
};

describe("where update looks for a kept file's new version follows the planner (#443)", () => {
  const GUIDANCE = /^(\.github\/(prompts|instructions|agents|skills|hooks)\/|docs\/plans\/)/;
  const presets = readdirSync(join(REPO_ROOT, "presets"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name);
  // Each preset alone, and pairs of them in both orders: the first preset's copy wins.
  const FIELDS = [...presets, "typescript,python", "python,typescript", "dotnet,azure-iac", "azure-iac,dotnet"];
  const repoRoot = REPO_ROOT.replaceAll("\\", "/");

  // The planner is the oracle. An empty project shows what it offers a new install; the agents and the runbook are offered
  // only to a project that already has them, so they are not in this list. Each has a single source today.
  const offered = new Map();
  const offeredFor = (field) => {
    if (!offered.has(field)) {
      const emptyProject = mkdtempSync(join(tmpdir(), "pf-update-empty-"));
      tmpDirs.push(emptyProject);
      const { operations } = buildPlan({ sourceRoot: REPO_ROOT, projectRoot: emptyProject, presetsOverride: field.split(",") });
      offered.set(field, operations.filter((op) => op.src && GUIDANCE.test(op.dst)).map(({ dst, src }) => ({ dst, src })));
    }
    return offered.get(field);
  };

  const answers = new Map();
  const answersOf = (shellName) => {
    if (!answers.has(shellName)) {
      const input = `${FIELDS.flatMap((field) => offeredFor(field).map(({ dst }) => `${field}\t${dst}`)).join("\n")}\n`;
      const run = LOOKUPS[shellName](repoRoot, input);
      expect(run.status, `${shellName}: ${run.stderr}`).toBe(0);
      answers.set(shellName, new Map(run.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split("\t")).map(([field, dst, rel]) => [`${field}\t${dst}`, rel])));
    }
    return answers.get(shellName);
  };

  for (const shell of SHELLS) {
    describe.skipIf(!shell.available)(`${shell.name}: the search`, () => {
      it.each(FIELDS)("%s: every guidance file the planner offers is found with the planner's text", (field) => {
        const planned = offeredFor(field);
        expect(planned.length, "the plan offers guidance files").toBeGreaterThan(50);
        const found = answersOf(shell.name);
        const wrong = planned.flatMap(({ dst, src }) => {
          const rel = found.get(`${field}\t${dst}`);
          const same = rel && readFileSync(join(REPO_ROOT, rel)).equals(readFileSync(join(REPO_ROOT, src)));
          return same ? [] : [`${dst}: the search finds ${rel || "nothing"}, the planner offers ${src}`];
        });
        expect(wrong).toEqual([]);
      }, 300_000);
    });
  }
});
