/**
 * Guard: shipped Plan Forge source contains no personal checkout paths.
 *
 * A path such as `E:\GitHub\some-repo` only exists on one contributor's machine.
 * One slipped into resolveTestbedPath as a Windows default, so every other
 * Windows user was pointed at a folder they don't have. Examples and defaults
 * must use neutral placeholders (`/path/to/my-app`, `C:\src\my-app`) or be
 * resolved at runtime.
 *
 * This suite also ships into consumer projects, so it only scans folders that
 * Plan Forge owns there. Dev-repo-only folders (templates/, scripts/,
 * extensions/) are scanned only inside the Plan Forge source repo.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MCP_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(MCP_ROOT, "..");
const IS_PLAN_FORGE_REPO = existsSync(join(REPO_ROOT, "presets")) && existsSync(join(MCP_ROOT, "server.mjs"));

const SCANNED_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".json", ".ps1", ".psm1", ".sh"]);
// obj/: .NET restore output (project.assets.json records the machine's NuGet paths), never source.
const SKIPPED_DIRS = new Set(["node_modules", "tests", "__tests__", ".forge", "obj"]);
const SKIPPED_FILES = new Set([".vitest-results.json", "package-lock.json"]);

// A quoted string that points into a personal checkout: a drive path through
// GitHub/repos/source/Users, or a macOS/Linux home directory.
const PERSONAL_PATH_RE =
  /(["'`])(?:[A-Za-z]:(?:\\\\|\\|\/)+(?:[^"'`\r\n]*?(?:\\\\|\\|\/))?(?:GitHub|repos|source|Users)(?:\\\\|\\|\/)|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/)/;

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...listFiles(full));
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name)) && !SKIPPED_FILES.has(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function shippedFiles() {
  const dirs = [MCP_ROOT, join(REPO_ROOT, "pforge-master", "src")];
  if (IS_PLAN_FORGE_REPO) {
    dirs.push(join(REPO_ROOT, "templates"), join(REPO_ROOT, "scripts"), join(REPO_ROOT, "extensions"));
  }
  const rootScripts = ["pforge.ps1", "pforge.sh", "setup.ps1", "setup.sh", "validate-setup.ps1", "validate-setup.sh"]
    .map((name) => join(REPO_ROOT, name))
    .filter((file) => existsSync(file));
  return [...dirs.flatMap(listFiles), ...rootScripts];
}

function findPersonalPaths(files) {
  const hits = [];
  for (const file of files) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
      if (PERSONAL_PATH_RE.test(line)) hits.push(`${relative(REPO_ROOT, file)}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

describe("Guard: shipped source contains no personal checkout paths", () => {
  it("the scan covers the MCP server source", () => {
    expect(shippedFiles().some((file) => file.endsWith(join("testbed", "scenarios.mjs")))).toBe(true);
  });

  it("no string literal points into a contributor's checkout", () => {
    expect(findPersonalPaths(shippedFiles())).toEqual([]);
  });

  it.each([
    ['"E:\\\\GitHub\\\\some-repo"', true],
    ["'D:/repos/app'", true],
    ['"C:\\\\Users\\\\someone\\\\proj"', true],
    ["`/Users/someone/proj`", true],
    ['"/home/someone/proj"', true],
    ['"/path/to/my-app"', false],
    ['"C:\\\\src\\\\plan-forge-testbed"', false],
    ['"../plan-forge-testbed"', false],
  ])("classifies %s as personal = %s", (literal, personal) => {
    expect(PERSONAL_PATH_RE.test(literal)).toBe(personal);
  });
});
