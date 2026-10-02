/**
 * #280 — `pforge update` keeps guidance files a project changed, in both shells.
 *
 * A local "release" (source) ships the update guard, a hash index of the
 * versions it shipped before, and newer guidance files. The project has one
 * file it edited, older unmodified copies rendered by setup, and a stack preset
 * whose testing and security instructions must win over the shared ones (and
 * over Plan Forge's own internal security rules, which older setups installed).
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contentHash, renderPlaceholders, INDEX_FILE } from "../update-guard.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const GIT_BASH = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p));
const BASH = isWin ? GIT_BASH : "bash";

const VALUES = { projectName: "Acme Orders", stack: ".NET 10 / ASP.NET Core", setupDate: "2026-05-01" };
const STEP0 = ".github/prompts/step0-specify-feature.prompt.md";
// Older updaters copied this one raw, so it matches the source byte for byte.
const STEP1 = ".github/prompts/step1-preflight-check.prompt.md";
const GIT_WORKFLOW = ".github/instructions/git-workflow.instructions.md";
const TESTING = ".github/instructions/testing.instructions.md";
const SECURITY = ".github/instructions/security.instructions.md";
const RUNBOOK = "docs/plans/AI-Plan-Hardening-Runbook.md";
const PENDING = `.forge/update-pending/${GIT_WORKFLOW}`;

const V1 = {
  step0: "# Specify\n\nProject: <YOUR PROJECT NAME> (<YOUR TECH STACK>), set up <DATE>.\n",
  git: "# Git workflow v1\n",
  dotnetTesting: "# .NET testing v1\n",
  internalSecurity: "# Plan Forge security: forge_* handler rules\n",
  runbook: "# Runbook v1 for <YOUR PROJECT NAME>\n",
};
const V2 = {
  step0: "# Specify\n\nProject: <YOUR PROJECT NAME>. Read the principles first.\n",
  step1: "# Preflight for <YOUR PROJECT NAME>\n",
  git: "# Git workflow v2 for <YOUR PROJECT NAME>\n",
  dotnetTesting: "# .NET testing v2 (xUnit v3)\n",
  sharedTesting: "# TypeScript Testing Patterns\n",
  sharedSecurity: "# Security Instructions (stack-neutral)\n",
  dotnetSecurity: "# .NET security v2\n",
  runbook: "# Runbook v2 for <YOUR PROJECT NAME>\n",
};
const OUR_GIT_RULES = "# Our own git rules\n\nSquash merges only.\n";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

function seed() {
  const base = mkdtempSync(join(tmpdir(), "pf-update-guard-cli-"));
  tmpDirs.push(base);
  const source = join(base, "plan-forge");
  const project = join(base, "project");
  const shipped = [...Object.values(V1), ...Object.values(V2)].map((text) => contentHash(text));
  writeTree(source, {
    VERSION: "9.9.9",
    [`pforge-mcp/${INDEX_FILE}`]: JSON.stringify({ hashes: shipped }),
    [STEP0]: V2.step0,
    [STEP1]: V2.step1,
    [GIT_WORKFLOW]: V2.git,
    "presets/shared/.github/instructions/testing.instructions.md": V2.sharedTesting,
    "presets/dotnet/.github/instructions/testing.instructions.md": V2.dotnetTesting,
    [SECURITY]: V1.internalSecurity,
    "presets/shared/.github/instructions/security.instructions.md": V2.sharedSecurity,
    "presets/dotnet/.github/instructions/security.instructions.md": V2.dotnetSecurity,
    [RUNBOOK]: V2.runbook,
  });
  copyFileSync(join(REPO_ROOT, "pforge-mcp", "update-guard.mjs"), join(source, "pforge-mcp", "update-guard.mjs"));
  writeTree(project, {
    ".forge.json": JSON.stringify({ templateVersion: "9.9.8", preset: "dotnet", ...VALUES }),
    [STEP0]: renderPlaceholders(V1.step0, VALUES),
    [STEP1]: V2.step1,
    [GIT_WORKFLOW]: OUR_GIT_RULES,
    [TESTING]: V1.dotnetTesting,
    [SECURITY]: V1.internalSecurity,
    [RUNBOOK]: renderPlaceholders(V1.runbook, VALUES),
  });
  execFileSync("git", ["init", "-q"], { cwd: project, stdio: "ignore" });
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(project, "pforge.sh"));
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(project, "pforge.ps1"));
  return { source, project };
}

const read = (project, rel) => readFileSync(join(project, rel), "utf8");

function runners() {
  const list = [];
  if (BASH) {
    list.push({
      name: "pforge.sh",
      run: (project, args) => spawnSync(BASH, ["pforge.sh", "update", ...args], { cwd: project, encoding: "utf-8", timeout: 180_000 }),
    });
  }
  if (isWin) {
    list.push({
      name: "pforge.ps1 (Windows PowerShell 5.1)",
      run: (project, args) => spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(project, "pforge.ps1"), "update", ...args],
        { cwd: project, encoding: "utf-8", timeout: 180_000 },
      ),
    });
  }
  return list;
}

describe.each(runners())("#280 $name update keeps edited guidance", ({ run }) => {
  it("dry run reports KEEP for the edited file and changes nothing", () => {
    const { source, project } = seed();
    const r = run(project, [source, "--dry-run"]);
    const out = r.stdout.replace(/\\/g, "/");
    expect(out).toMatch(/UPDATE\s+\.github\/prompts\/step0-specify-feature\.prompt\.md/);
    expect(out).toMatch(/UPDATE\s+\.github\/prompts\/step1-preflight-check\.prompt\.md/);
    expect(out).toMatch(/KEEP\s+\.github\/instructions\/git-workflow\.instructions\.md/);
    expect(out).toMatch(/UPDATE\s+\.github\/instructions\/testing\.instructions\.md/);
    expect(out).toContain("--overwrite-customized");
    expect(read(project, GIT_WORKFLOW)).toBe(OUR_GIT_RULES);
    expect(read(project, STEP0)).toBe(renderPlaceholders(V1.step0, VALUES));
    expect(existsSync(join(project, ".forge"))).toBe(false);
  });

  it("updates unmodified files with placeholders rendered, keeps the edited one, and takes testing and security guidance from the preset", () => {
    const { source, project } = seed();
    const r = run(project, [source, "--force"]);
    expect(r.status, r.stderr).toBe(0);

    expect(read(project, STEP0)).toBe(renderPlaceholders(V2.step0, VALUES));
    expect(read(project, STEP0)).not.toContain("<YOUR PROJECT NAME>");
    expect(read(project, STEP1)).toBe(renderPlaceholders(V2.step1, VALUES));
    expect(read(project, RUNBOOK)).toBe(renderPlaceholders(V2.runbook, VALUES));

    expect(read(project, GIT_WORKFLOW)).toBe(OUR_GIT_RULES);
    expect(read(project, PENDING)).toBe(renderPlaceholders(V2.git, VALUES));

    expect(read(project, TESTING)).toBe(V2.dotnetTesting);
    expect(read(project, SECURITY)).toBe(V2.dotnetSecurity);
  });

  it("--overwrite-customized replaces the edited file after backing it up", () => {
    const { source, project } = seed();
    const r = run(project, [source, "--force", "--overwrite-customized"]);
    expect(r.status, r.stderr).toBe(0);

    expect(read(project, GIT_WORKFLOW)).toBe(renderPlaceholders(V2.git, VALUES));
    const backupRoot = join(project, ".forge", "update-backups");
    const [stamp] = readdirSync(backupRoot);
    expect(readFileSync(join(backupRoot, stamp, GIT_WORKFLOW), "utf8")).toBe(OUR_GIT_RULES);
  });

  it("without .forge.json, detects the stack instead of assuming custom", () => {
    const { source, project } = seed();
    rmSync(join(project, ".forge.json"));
    writeTree(project, { "src/Api/Api.csproj": "<Project />\n" });
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "detect-preset.mjs"), join(source, "pforge-mcp", "detect-preset.mjs"));
    const r = run(project, [source, "--force"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.replace(/\\/g, "/")).toMatch(/Preset:\s+dotnet \(detected from src\/Api\/Api\.csproj/);
    expect(read(project, TESTING)).toBe(V2.dotnetTesting);
    expect(read(project, SECURITY)).toBe(V2.dotnetSecurity);
  });

  it("migrates missing .forge.json defaults even when already up to date", () => {
    const { source, project } = seed();
    writeTree(project, { ".forge.json": JSON.stringify({ templateVersion: "9.9.9", preset: "dotnet", ...VALUES }) });
    mkdirSync(join(source, "pforge-mcp", "orchestrator"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "migrate-forge-config.mjs"), join(source, "pforge-mcp", "migrate-forge-config.mjs"));
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "orchestrator", "constants.mjs"), join(source, "pforge-mcp", "orchestrator", "constants.mjs"));
    const r = run(project, [source]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("Already up to date");
    expect(r.stdout).toContain("Added hooks.postRun to .forge.json");
    const cfg = JSON.parse(read(project, ".forge.json"));
    expect(cfg.hooks.postRun.invokeAuditor.onFailure).toBe(false);
    expect(cfg.projectName).toBe(VALUES.projectName);
  });

  it("migrates on a forced update that finds every file current, but never on a dry run", () => {
    const { source, project } = seed();
    mkdirSync(join(source, "pforge-mcp", "orchestrator"), { recursive: true });
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "migrate-forge-config.mjs"), join(source, "pforge-mcp", "migrate-forge-config.mjs"));
    copyFileSync(join(REPO_ROOT, "pforge-mcp", "orchestrator", "constants.mjs"), join(source, "pforge-mcp", "orchestrator", "constants.mjs"));
    expect(run(project, [source, "--force", "--overwrite-customized"]).status).toBe(0);
    const stripPostRun = () => {
      const cfg = JSON.parse(read(project, ".forge.json"));
      delete cfg.hooks.postRun;
      writeFileSync(join(project, ".forge.json"), JSON.stringify(cfg, null, 2));
    };

    stripPostRun();
    const dry = run(project, [source, "--dry-run"]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(JSON.parse(read(project, ".forge.json")).hooks.postRun).toBeUndefined();

    const forced = run(project, [source, "--force"]);
    expect(forced.status, forced.stderr).toBe(0);
    expect(forced.stdout).toContain("All framework files are up to date");
    expect(JSON.parse(read(project, ".forge.json")).hooks.postRun.invokeAuditor.onFailure).toBe(false);
  });
});

const BUILD_SCRIPT = join(REPO_ROOT, "scripts", "build-shipped-guidance-hashes.mjs");

// Development checkout only: projects get pforge-mcp/ without presets/ or scripts/.
describe.skipIf(!existsSync(join(REPO_ROOT, "presets")) || !existsSync(BUILD_SCRIPT))("shipped guidance index", () => {
  it("covers every guidance file in the working tree (regenerate with node scripts/build-shipped-guidance-hashes.mjs)", async () => {
    const { missingFromIndex } = await import(pathToFileURL(BUILD_SCRIPT).href);
    expect(missingFromIndex()).toEqual([]);
  });
});
