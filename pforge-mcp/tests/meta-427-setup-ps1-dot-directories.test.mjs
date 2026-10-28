/**
 * Meta-bug #427 — setup.ps1 copied almost nothing of a stack preset when PowerShell ran on macOS or Linux.
 *
 * PowerShell on Unix treats a name that starts with a dot as hidden, and Get-ChildItem -Recurse does not enter a
 * hidden folder unless it is given -Force. Every file of a stack preset sits under presets/<stack>/.github/, so
 * Step 3 copied only AGENTS.md, and Step 4 never visited .github to replace the placeholders. The copy of the
 * runtime packages (pforge-mcp, pforge-master, pforge-sdk) skipped their dot-prefixed files the same way: a results
 * file and the test fixtures that are a project's .github folder. Nothing showed on Windows, where a name is hidden
 * only when it carries the Hidden attribute, which .github does not.
 *
 * This test builds a small source tree and hides its names that start with a dot the way Unix does: nothing to do
 * on macOS and Linux, the Hidden attribute on Windows. The project's own .github is hidden before setup runs, for
 * Step 4.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const PRESET = "typescript";

// What a typescript install reads from its template root; the rest of the repository is not needed.
const SOURCE_TREE = [
  "setup.ps1",
  "VERSION",
  "pforge-mcp/package.json",
  "pforge-mcp/preset-catalog.json",
  "pforge-master/package.json",
  "pforge-sdk/package.json",
  `presets/${PRESET}`,
  "presets/shared",
  "templates",
  ".github/prompts",
  ".github/instructions",
];

// The runtime packages ship names that start with a dot too (a results file, and test fixtures that are a project's
// .github folder), and setup copies the packages whole.
const RUNTIME_DOT_FILES = [
  "pforge-mcp/.vitest-results.json",
  "pforge-mcp/tests/fixtures/update-plan/case/project/.github/instructions/sample.instructions.md",
  "pforge-master/.sample-config",
  "pforge-sdk/.hidden-folder/sample.txt",
];

const SHELLS = [
  { name: "pwsh", exe: "pwsh", available: spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0 },
  { name: "Windows PowerShell 5.1", exe: "powershell.exe", available: isWin },
];

const tmpDirs = [];
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};
const cleanUp = () => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
};
const shellArgs = (exe, ...rest) => ["-NoProfile", "-NonInteractive", ...(exe === "powershell.exe" ? ["-ExecutionPolicy", "Bypass"] : []), ...rest];

function listFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(relative(root, full).replaceAll("\\", "/"));
    }
  };
  walk(root);
  return found.sort();
}

/** Hides each file and folder whose name starts with a dot, which is how PowerShell on macOS and Linux sees it. */
function hideDotNames(root) {
  if (!isWin) return;
  const paths = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.name.startsWith(".")) paths.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  for (const path of paths) spawnSync("attrib", ["+h", path]);
}

function buildSourceTree() {
  const source = tempDir("pf-meta-427-src-");
  for (const rel of SOURCE_TREE) {
    const target = join(source, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(REPO_ROOT, rel), target, { recursive: true });
  }
  for (const rel of RUNTIME_DOT_FILES) {
    mkdirSync(dirname(join(source, rel)), { recursive: true });
    writeFileSync(join(source, rel), "sample\n");
  }
  hideDotNames(source);
  return source;
}

function stubNpmDir() {
  const dir = tempDir("pf-meta-427-npm-");
  if (isWin) writeFileSync(join(dir, "npm.cmd"), "@exit /b 0\r\n");
  else {
    writeFileSync(join(dir, "npm"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "npm"), 0o755);
  }
  return dir;
}

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`setup.ps1 under ${shell.name}, where names that start with a dot are hidden`, () => {
    let source;
    let project;
    let presetFiles;
    let run;

    afterAll(cleanUp);

    beforeAll(() => {
      source = buildSourceTree();
      presetFiles = listFiles(join(source, "presets", PRESET));
      project = tempDir("pf-meta-427-proj-");
      mkdirSync(join(project, ".github"));
      hideDotNames(project);
      const env = { ...process.env, PATH: `${stubNpmDir()}${delimiter}${process.env.PATH}` };
      delete env.CI;
      run = spawnSync(shell.exe, shellArgs(shell.exe, "-File", join(source, "setup.ps1"), "-Preset", PRESET, "-ProjectPath", project, "-ProjectName", "Acme", "-NonInteractive", "-Force"), {
        encoding: "utf8",
        timeout: 240_000,
        env,
      });
    }, 300_000);

    it("hides the .github folder of the preset from a recursive listing unless it is given -Force", () => {
      const presetDir = join(source, "presets", PRESET);
      const count = (flags) => {
        const out = spawnSync(shell.exe, shellArgs(shell.exe, "-Command", `(Get-ChildItem -Path '${presetDir}' -Recurse -File ${flags}).Count`), { encoding: "utf8" });
        return Number(out.stdout.trim());
      };
      expect(presetFiles.length).toBeGreaterThan(10);
      expect(count("")).toBe(1);
      expect(count("-Force")).toBe(presetFiles.length);
    });

    it("finishes the install", () => {
      expect(run.status, (run.stdout + run.stderr).slice(-1500)).toBe(0);
    });

    it("copies every file of the preset, including the ones under .github", () => {
      const missing = presetFiles.filter((rel) => !existsSync(join(project, rel)));
      expect(missing).toEqual([]);
    });

    it("copies the runtime packages whole, including the names that start with a dot", () => {
      const missing = RUNTIME_DOT_FILES.filter((rel) => !existsSync(join(project, rel)));
      expect(missing).toEqual([]);
    });

    it("replaces the placeholders in .github/copilot-instructions.md, which setup copies on its own", () => {
      const text = readFileSync(join(project, ".github/copilot-instructions.md"), "utf8");
      expect(text).not.toContain("<DATE>");
    });

    it("replaces the placeholders in the preset files under .github", () => {
      const text = readFileSync(join(project, ".github/agents/architecture-reviewer.agent.md"), "utf8");
      expect(text).not.toContain("<YOUR PROJECT NAME>");
      expect(text).toContain('project: "Acme"');
    });
  });
}
