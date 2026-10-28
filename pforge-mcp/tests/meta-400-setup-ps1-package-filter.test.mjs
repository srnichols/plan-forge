/**
 * #400 — setup.ps1 skipped every file whose path contains "coverage".
 *
 * The package copy loops filtered with `$_.FullName -notmatch '(node_modules|\.forge|coverage)'`,
 * an unanchored substring match on the absolute path. pforge-mcp/orchestrator/run-plan/plan-coverage.mjs,
 * which run-plan.mjs imports, never reached a PowerShell install, so the orchestrator could not
 * load there; and a source tree under a `.forge` folder installed nothing (#346). The filter is
 * one function now, matching whole directory segments of the path below the package.
 *
 * The function is read out of setup.ps1 and run under pwsh, so the test exercises the installer's
 * own code without running the installer.
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IS_PLAN_FORGE_SOURCE } from "./helpers/source-repo.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SETUP_PS1 = join(REPO_ROOT, "setup.ps1");
const PWSH = ["pwsh", "pwsh.exe"].find((cmd) => spawnSync(cmd, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0);
const PACKAGES = ["pforge-mcp", "pforge-master", "pforge-sdk"];
const SKIPPED_DIRS = ["node_modules", ".forge", "coverage"];

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function filterFunction() {
  const match = readFileSync(SETUP_PS1, "utf8").match(/^function Test-RuntimePackageFile[\s\S]*?^\}$/m);
  expect(match, "setup.ps1 defines Test-RuntimePackageFile").not.toBeNull();
  return match[0];
}

/** What setup.ps1's own filter decides for each path below `sourceDir`: path -> copied. */
function decisions(sourceDir, relatives) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-400-"));
  tmpDirs.push(dir);
  const casesFile = join(dir, "cases.json");
  writeFileSync(casesFile, JSON.stringify(relatives));
  const script = join(dir, "probe.ps1");
  writeFileSync(script, [
    "param([string]$SourceDir, [string]$CasesFile)",
    filterFunction(),
    "foreach ($relative in (Get-Content $CasesFile -Raw | ConvertFrom-Json)) {",
    "  $file = [System.IO.FileInfo]::new((Join-Path $SourceDir $relative))",
    '  "{0}|{1}" -f $relative, (Test-RuntimePackageFile $file $SourceDir)',
    "}",
  ].join("\n"));
  const result = spawnSync(PWSH, ["-NoProfile", "-File", script, "-SourceDir", sourceDir, "-CasesFile", casesFile], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return Object.fromEntries(result.stdout.trim().split(/\r?\n/).map((line) => {
    const at = line.lastIndexOf("|");
    return [line.slice(0, at), line.slice(at + 1) === "True"];
  }));
}

/** The same rule in JS: a path is skipped when one of its directories is node_modules, .forge or coverage. */
const skippedByRule = (relative) => relative.split("/").slice(0, -1).some((segment) => SKIPPED_DIRS.includes(segment));

describe.skipIf(!IS_PLAN_FORGE_SOURCE || !PWSH)("#400 setup.ps1 copies every runtime package file that is not a skipped folder", () => {
  const SOURCE = join(tmpdir(), "pf-meta-400-source", "pforge-mcp");

  it.each([
    ["orchestrator/run-plan/plan-coverage.mjs", true],
    ["tests/cost-service-token-coverage.test.mjs", true],
    ["tests/fixtures/coverage-sample.json", true],
    ["coveragereport/index.js", true],
    ["my-coverage/report.js", true],
    ["node_modules_backup/index.js", true],
    ["server.mjs", true],
    ["node_modules/zod/index.js", false],
    ["tests/helpers/node_modules/zod/index.js", false],
    [".forge/state.json", false],
    ["tests/.forge/scratch.json", false],
    ["coverage/lcov.info", false],
    ["dashboard/coverage/index.html", false],
  ])("%s -> copied: %s", (relative, copied) => {
    expect(decisions(SOURCE, [relative])[relative]).toBe(copied);
  });

  it("copies a package whose source tree sits under a .forge or coverage folder (#346)", () => {
    for (const ancestor of [join(tmpdir(), ".forge", "audit", "pforge-mcp"), join(tmpdir(), "coverage", "run", "pforge-mcp")]) {
      const result = decisions(ancestor, ["server.mjs", "orchestrator/run-plan/plan-coverage.mjs", "node_modules/zod/index.js"]);
      expect(result, ancestor).toEqual({ "server.mjs": true, "orchestrator/run-plan/plan-coverage.mjs": true, "node_modules/zod/index.js": false });
    }
  });

  it("copies every tracked file of the runtime packages except those under node_modules, .forge or coverage", () => {
    const tracked = PACKAGES.flatMap((pkg) => execFileSync("git", ["ls-files", "--", pkg], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean)
      .map((file) => ({ pkg, relative: file.slice(pkg.length + 1) })));
    expect(tracked.length).toBeGreaterThan(900);
    for (const pkg of PACKAGES) {
      const files = tracked.filter((entry) => entry.pkg === pkg).map((entry) => entry.relative);
      const result = decisions(join(REPO_ROOT, pkg), files);
      const dropped = files.filter((file) => !result[file]);
      expect(dropped, `${pkg}: files setup.ps1 would not copy`).toEqual(files.filter(skippedByRule));
    }
  });
});

describe.skipIf(!IS_PLAN_FORGE_SOURCE)("#400 setup.ps1 filters its package copies in one place", () => {
  const source = existsSync(SETUP_PS1) ? readFileSync(SETUP_PS1, "utf8") : "";

  it("filters no package copy on the absolute path", () => {
    expect(source).not.toMatch(/\$_\.FullName\s+-notmatch\s+'\(node_modules/);
  });

  it("uses the shared filter, with its own source directory, for pforge-sdk, pforge-master and pforge-mcp", () => {
    const loops = source.match(/Get-ChildItem -Path \$(sdk|fm|mcp)SrcDir -File -Recurse( -Force)? \|\s+Where-Object \{ Test-RuntimePackageFile \$_ \$\1SrcDir \}/g);
    expect(loops).toHaveLength(3);
  });

  it("lists each package with -Force, because PowerShell on macOS and Linux hides a name that starts with a dot (#427)", () => {
    expect(source.match(/Get-ChildItem -Path \$(sdk|fm|mcp)SrcDir -File -Recurse -Force \|/g)).toHaveLength(3);
  });
});
