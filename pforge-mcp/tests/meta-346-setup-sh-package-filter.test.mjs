/**
 * #346 — setup.sh skipped every runtime package file when the framework source sat under a
 * folder named .forge (or node_modules, or coverage).
 *
 * The three package copy loops (pforge-sdk, pforge-master, pforge-mcp) listed files with
 * `find "$SRC" -type f ! -path '*\/node_modules/*' ! -path '*\/.forge/*' ! -path '*\/coverage/*'`.
 * `-path` matches the whole path, ancestors of the source tree included, so a checkout under
 * `.forge/audit/` copied nothing, setup still exited 0, and the project had no runtime. setup.ps1
 * had the same defect and was fixed in #400. The list is one function now, which prunes directories
 * named node_modules, .forge or coverage below the package and never walks them.
 *
 * The function is read out of setup.sh and run under bash, so the test exercises the installer's
 * own code without running the installer.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { IS_PLAN_FORGE_SOURCE } from "./helpers/source-repo.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SETUP_SH = join(REPO_ROOT, "setup.sh");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PACKAGES = ["pforge-mcp", "pforge-master", "pforge-sdk"];
const SKIPPED_DIRS = ["node_modules", ".forge", "coverage"];

const posix = (path) => path.replace(/\\/g, "/");
const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
};

function filterFunction() {
  const match = readFileSync(SETUP_SH, "utf8").match(/^list_runtime_package_files\(\) \{\n[\s\S]*?\n\}\n/m);
  expect(match, "setup.sh defines list_runtime_package_files").not.toBeNull();
  return match[0];
}

/** The files setup.sh's own function lists below `sourceDir`, relative and sorted. */
function listed(sourceDir) {
  const dir = tempDir("pf-meta-346-driver-");
  const driver = join(dir, "driver.sh");
  writeFileSync(driver, [
    filterFunction(),
    'list_runtime_package_files "$1" | while IFS= read -r -d \'\' f; do printf \'%s\\n\' "${f#"$1/"}"; done | sort',
    "",
  ].join("\n"));
  const result = spawnSync(BASH, [posix(driver), posix(sourceDir)], { encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.split("\n").filter(Boolean);
}

function plant(root, relatives) {
  for (const relative of relatives) {
    const file = join(root, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "x\n");
  }
}

/** The same rule in JS: a path is skipped when one of its directories is node_modules, .forge or coverage. */
const skippedByRule = (relative) => relative.split("/").slice(0, -1).some((segment) => SKIPPED_DIRS.includes(segment));

describe.skipIf(!IS_PLAN_FORGE_SOURCE || !BASH)("#346 setup.sh lists every runtime package file that is not under a skipped folder", () => {
  const COPIED = [
    "server.mjs",
    "orchestrator/run-plan/plan-coverage.mjs",
    "tests/cost-service-token-coverage.test.mjs",
    "tests/fixtures/coverage-sample.json",
    "coveragereport/index.js",
    "my-coverage/report.js",
    "node_modules_backup/index.js",
    ".forgeconfig/settings.json",
    "docs/a file with spaces.md",
  ];
  const SKIPPED = [
    "node_modules/zod/index.js",
    "tests/helpers/node_modules/zod/index.js",
    ".forge/state.json",
    "tests/.forge/scratch.json",
    "coverage/lcov.info",
    "dashboard/coverage/index.html",
  ];

  it("lists the copied paths and none of the skipped ones", () => {
    const root = join(tempDir("pf-meta-346-src-"), "pforge-mcp");
    plant(root, [...COPIED, ...SKIPPED]);
    expect(listed(root)).toEqual([...COPIED].sort());
  });

  it("copies a package whose source tree sits under a .forge or coverage folder", () => {
    const base = tempDir("pf-meta-346-anc-");
    for (const ancestor of [join(base, ".forge", "audit", "pforge-mcp"), join(base, "coverage", "run", "pforge-mcp"), join(base, "node_modules", "kit", "pforge-mcp")]) {
      plant(ancestor, ["server.mjs", "orchestrator/run-plan/plan-coverage.mjs", "node_modules/zod/index.js", "coverage/lcov.info"]);
      expect(listed(ancestor), ancestor).toEqual(["orchestrator/run-plan/plan-coverage.mjs", "server.mjs"]);
    }
  });

  it("lists a file that is named like a skipped folder, since only directories are skipped", () => {
    const root = join(tempDir("pf-meta-346-file-"), "pforge-sdk");
    plant(root, ["coverage", ".forge", "node_modules", "src/index.mjs"]);
    expect(listed(root)).toEqual([".forge", "coverage", "node_modules", "src/index.mjs"]);
  });

  it("does not walk a skipped folder", () => {
    const root = join(tempDir("pf-meta-346-prune-"), "pforge-master");
    plant(root, ["server.mjs", ...Array.from({ length: 50 }, (_, i) => `node_modules/pkg-${i}/index.js`)]);
    expect(listed(root)).toEqual(["server.mjs"]);
  });

  it("lists every tracked file of the runtime packages except those under node_modules, .forge or coverage", () => {
    for (const pkg of PACKAGES) {
      const tracked = execFileSync("git", ["ls-files", "--", pkg], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
        .split("\n").filter(Boolean).map((file) => file.slice(pkg.length + 1));
      expect(tracked.length, pkg).toBeGreaterThan(0);
      const result = new Set(listed(join(REPO_ROOT, pkg)));
      const missing = tracked.filter((file) => !skippedByRule(file) && !result.has(file));
      expect(missing, `${pkg}: tracked files setup.sh would not copy`).toEqual([]);
      expect([...result].filter(skippedByRule), `${pkg}: skipped folders listed`).toEqual([]);
    }
  }, 120_000);
});

describe.skipIf(!IS_PLAN_FORGE_SOURCE)("#346 setup.sh filters its package copies in one place", () => {
  const source = existsSync(SETUP_SH) ? readFileSync(SETUP_SH, "utf8") : "";
  const codeLines = source.split("\n").filter((line) => !/^\s*#/.test(line));

  it("filters no package copy on the whole path", () => {
    expect(codeLines.filter((line) => /!\s+-path\s+'\*\/(node_modules|\.forge|coverage)\/\*'/.test(line))).toEqual([]);
  });

  it("lists pforge-sdk, pforge-master and pforge-mcp through the shared function, with their own source directories", () => {
    for (const dir of ["SDK_SRC_DIR", "FM_SRC_DIR", "MCP_SRC_DIR"]) {
      expect(codeLines.filter((line) => line.includes(`done < <(list_runtime_package_files "$${dir}")`)), dir).toHaveLength(1);
    }
  });

  it.skipIf(!BASH)("still parses as bash", () => {
    const result = spawnSync(BASH, ["-n", posix(SETUP_SH)], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
