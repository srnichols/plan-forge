/**
 * Meta-bug #319 — forge_analyze ignored mode "file". Without quorum the handler
 * always ran `pforge analyze <target>`, which reads every target as a plan, so a
 * C# source file came back as "No MUST/SHOULD criteria found" / "No execution
 * slices found". Its Test Coverage step then walked every bin/obj/node_modules
 * file before filtering them out, and the 60 s runPforge timeout killed it
 * (spawnSync cmd.exe ETIMEDOUT) on a .NET solution.
 *
 * Now the non-quorum handler and both CLIs reject file mode up front with
 * guidance, both handlers share one mode resolver, and both CLIs prune
 * dependency/build directories instead of walking them.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveAnalyzeMode } from "../analyze-mode.mjs";
import {
  _callToolHandler_011_forge_analyze,
  _callToolHandler_012_forge_analyze,
} from "../server/tool-handlers/orch.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";
const analyzeRequest = { params: { name: "forge_analyze" } };

describe("resolveAnalyzeMode (meta #319)", () => {
  it("auto-detects plans from the Markdown extension, anything else as a source file", () => {
    expect(resolveAnalyzeMode({ plan: "docs/plans/Phase-1-AUTH-PLAN.md" })).toEqual({ mode: "plan" });
    expect(resolveAnalyzeMode({ plan: "notes/Design.MARKDOWN" })).toEqual({ mode: "plan" });
    expect(resolveAnalyzeMode({ plan: "src/control-plane/src/Forge.ControlPlane/Program.cs" })).toEqual({ mode: "file" });
    expect(resolveAnalyzeMode({ plan: "src/planner/plan-builder.ts" })).toEqual({ mode: "file" });
  });

  it("honors an explicit mode", () => {
    expect(resolveAnalyzeMode({ plan: "docs/plans/Phase-1.md", mode: "file" })).toEqual({ mode: "file" });
    expect(resolveAnalyzeMode({ plan: "Components/RelativeTime.cs", mode: "plan" })).toEqual({ mode: "plan" });
  });

  it("rejects a missing target and an unknown mode", () => {
    expect(resolveAnalyzeMode({}).error).toMatch(/plan is required/);
    expect(resolveAnalyzeMode({ plan: "  " }).error).toMatch(/plan is required/);
    expect(resolveAnalyzeMode({ plan: "a.md", mode: "diagnose" }).error).toMatch(/mode must be one of "plan", "file" \(got "diagnose"\)/);
  });
});

describe("forge_analyze handler without quorum (meta #319)", () => {
  it.each([
    ["an explicit file mode", { plan: "src/control-plane/src/Forge.ControlPlane/Program.cs", mode: "file" }],
    ["a source file with no mode", { plan: "Components/RelativeTime.cs" }],
  ])("rejects %s with quorum guidance instead of scoring it as a plan", async (_label, args) => {
    const started = Date.now();
    const res = await _callToolHandler_011_forge_analyze(analyzeRequest, args);
    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toContain(`did not analyze "${args.plan}"`);
    expect(text).toContain("quorum: true");
    expect(text).toContain("forge_diagnose");
    expect(text).not.toMatch(/No MUST\/SHOULD criteria|ETIMEDOUT/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("reports an invalid mode as an input error", async () => {
    const res = await _callToolHandler_011_forge_analyze(analyzeRequest, { plan: "docs/plans/x.md", mode: "review" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Analyze error: mode must be one of/);
  });
});

describe("forge_analyze handler with quorum (meta #319)", () => {
  it("validates the target before dispatching any model", async () => {
    const missing = await _callToolHandler_012_forge_analyze(analyzeRequest, { quorum: true });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/^Quorum analysis error: plan is required/);

    const badMode = await _callToolHandler_012_forge_analyze(analyzeRequest, { quorum: true, plan: "a.cs", mode: "x" });
    expect(badMode.isError).toBe(true);
    expect(badMode.content[0].text).toMatch(/mode must be one of/);
  });
});

// ─── CLI: the test-file scan never enters dependency/build trees ─────────────

const PLAN_REL = "docs/plans/Phase-9-ANALYZE-FIXTURE-PLAN.md";
const PLAN = [
  "# Phase 9 — Analyze Fixture",
  "",
  "## Acceptance Criteria",
  "- **MUST**: Items endpoint returns paginated results",
  "",
  "### Slice 1 — Items endpoint",
  "",
  "**Validation Gate**:",
  "```bash",
  "dotnet test",
  "```",
  "",
].join("\n");

// Two real test files; every other *Tests.cs / *.test.* lives under a pruned directory.
const FILES = {
  [PLAN_REL]: PLAN,
  "tests/Api.Tests/ItemsTests.cs": "// Items endpoint returns paginated results\n",
  "src/web/items.test.ts": "it('lists items', () => {});\n",
  "tests/Api.Tests/bin/Debug/net10.0/Copied.Tests.cs": "// build output\n",
  "tests/Api.Tests/obj/Debug/Generated.Tests.cs": "// build output\n",
  "src/Api/bin/Release/Shadow.Tests.cs": "// build output\n",
  "node_modules/pkg/index.test.js": "// dependency\n",
  "web/dist/bundle.test.js": "// build output\n",
  "vendor/lib/thing_test.go": "// vendored\n",
};

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seedRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-319-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [rel, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(dir, "pforge.ps1"));
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
  return dir;
}

const spawnOpts = (dir) => ({ cwd: dir, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" }, timeout: 120_000 });

describe.skipIf(!isWin)("pforge.ps1 analyze prunes dependency/build directories (meta #319)", () => {
  const runPs1 = (dir, ...args) => spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "pforge.ps1"), ...args],
    spawnOpts(dir),
  );

  it("counts only the project's own test files", () => {
    const dir = seedRepo();
    const result = runPs1(dir, "analyze", PLAN_REL);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toMatch(/2 test file\(s\) found in project/);
    expect(out).toMatch(/1\/1 MUST criteria have matching tests/);
    expect(out).toMatch(/Consistency Score: \d+\/100/);
  });

  it("rejects a source file, or an explicit --mode file, before scoring", () => {
    const dir = seedRepo();
    for (const args of [["tests/Api.Tests/ItemsTests.cs"], [PLAN_REL, "--mode", "file"]]) {
      const result = runPs1(dir, "analyze", ...args);
      const out = `${result.stdout}\n${result.stderr}`;
      expect(result.status, out).toBe(1);
      expect(out).toMatch(/scores plan files only/);
      expect(out).toMatch(/pforge analyze \S+ --quorum/);
      expect(out).not.toMatch(/Consistency Score/);
    }
  });
});

describe.skipIf(!BASH)("pforge.sh analyze prunes dependency/build directories (meta #319)", () => {
  it("counts only the project's own test files", () => {
    const dir = seedRepo();
    const result = spawnSync(BASH, ["pforge.sh", "analyze", PLAN_REL], spawnOpts(dir));
    expect(result.stdout).toMatch(/2 test file\(s\) found in project/);
    expect(result.stdout).toMatch(/Consistency Score: \d+\/100/);
  });

  it("rejects a source file, or an explicit --mode file, before scoring", () => {
    const dir = seedRepo();
    for (const args of [["tests/Api.Tests/ItemsTests.cs"], [PLAN_REL, "--mode", "file"]]) {
      const result = spawnSync(BASH, ["pforge.sh", "analyze", ...args], spawnOpts(dir));
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toMatch(/scores plan files only/);
      expect(result.stderr).toMatch(/pforge analyze \S+ --quorum/);
      expect(result.stdout).not.toMatch(/Consistency Score/);
    }
  });
});

describe("Guard: analyze test scans prune instead of filtering after a full walk (meta #319)", () => {
  const ps1 = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf-8");
  const sh = readFileSync(join(REPO_ROOT, "pforge.sh"), "utf-8");

  it("pforge.ps1 routes both test scans through Get-AnalyzeFiles", () => {
    expect(ps1).not.toMatch(/Get-ChildItem -LiteralPath \$testDir -Recurse/);
    expect(ps1).not.toMatch(/Get-ChildItem -LiteralPath \$RepoRoot -Filter \$pattern -Recurse/);
    expect((ps1.match(/Get-AnalyzeFiles -Root/g) || []).length).toBe(2);
  });

  it("pforge.sh prunes the same directories pforge.ps1 skips", () => {
    expect(sh).toContain("-name node_modules -o -name .git -o -name bin -o -name obj -o -name dist -o -name vendor \\) -prune");
    expect(ps1).toContain("$script:AnalyzeSkipDirs = @('node_modules', 'bin', 'obj', 'dist', '.git', 'vendor')");
  });
});
