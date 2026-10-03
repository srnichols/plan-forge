/**
 * #299 / Phase-UPDATE-CORE Slice 2 — `update-plan.mjs` scan and migration.
 *
 * Covers: one test per operation category, the never-update list, preset
 * ownership of `testing`/`security` instructions, the D1 (missing
 * shared/internal instructions are offered as NEW) and D2 (.forge.json
 * migrations are reported, not applied) decisions, Shared Contract
 * output-shape validation, and equivalence with the Slice 1 shell baselines
 * (docs/plans/Phase-UPDATE-CORE-PLAN.md).
 */

import { describe, it, expect, afterEach } from "vitest";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  NEVER_UPDATE,
  buildPlan,
  renderReport,
  runCli,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_SOURCE_INVALID,
  removePackageFiles,
} from "../update-plan.mjs";
import { contentHash } from "../update-guard.mjs";
import { IS_PLAN_FORGE_SOURCE } from "./helpers/source-repo.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const FIXTURES_ROOT = resolve(import.meta.dirname, "fixtures", "update-plan");
const CATALOG_PATH = resolve(import.meta.dirname, "..", "preset-catalog.json");
const SETUP_PS1_PATH = resolve(REPO_ROOT, "setup.ps1");

const VALID_CATEGORIES = new Set([
  "prompts", "agents", "instructions", "runbook", "preset", "skills",
  "hooks", "automations", "mcp", "sdk", "master", "cli", "validation", "core",
]);
const VALID_ACTIONS = new Set(["new", "update", "remove"]);
const VALID_PRESET_SOURCES = new Set(["forge.json", "detected", "default"]);

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function write(root, rel, content) {
  const full = join(root, ...rel.split("/"));
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function makeSourceRoot({ version = "9.9.9" } = {}) {
  const source = makeTmp("pf-update-plan-source-");
  write(source, "VERSION", `${version}\n`);
  write(source, "pforge-mcp/shipped-guidance-hashes.json", JSON.stringify({ hashes: [] }));
  return source;
}

function makeProjectRoot({ templateVersion = "9.9.8", preset } = {}) {
  const project = makeTmp("pf-update-plan-project-");
  if (preset !== undefined) {
    write(project, ".forge.json", JSON.stringify({ templateVersion, preset }));
  }
  return project;
}

function findOp(plan, dst) {
  return plan.operations.find((o) => o.dst === dst);
}

/**
 * `update-guard.mjs` only reports "update" (rather than "customized") for a
 * guided file when the project's current text hashes to something Plan Forge
 * actually shipped. Register the project's "old shipped version" text so the
 * guard sees it that way, same as a real shipped-guidance-hashes.json would.
 */
function markShipped(sourceRoot, text) {
  const indexPath = join(sourceRoot, "pforge-mcp", "shipped-guidance-hashes.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.hashes.push(contentHash(text));
  writeFileSync(indexPath, JSON.stringify(index));
}

// ───────────────────────────── one test per category ─────────────────────

describe("update-plan: one test per category", () => {
  it("prompts: offers missing prompts as new, changed ones as update, leaves unchanged ones out, skips project-principles.prompt.md", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, ".github/prompts/step0-specify-feature.prompt.md", "new content\n");
    write(source, ".github/prompts/step1-preflight-check.prompt.md", "same content\n");
    write(project, ".github/prompts/step1-preflight-check.prompt.md", "same content\n");
    write(source, ".github/prompts/step2-harden-plan.prompt.md", "changed source\n");
    write(project, ".github/prompts/step2-harden-plan.prompt.md", "changed project\n");
    markShipped(source, "changed project\n");
    write(source, ".github/prompts/project-principles.prompt.md", "never\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });
    const prompts = plan.operations.filter((o) => o.category === "prompts");

    expect(findOp(plan, ".github/prompts/step0-specify-feature.prompt.md")).toMatchObject({ action: "new", guided: true });
    expect(findOp(plan, ".github/prompts/step1-preflight-check.prompt.md")).toBeUndefined();
    expect(findOp(plan, ".github/prompts/step2-harden-plan.prompt.md")).toMatchObject({ action: "update", guided: true });
    expect(findOp(plan, ".github/prompts/project-principles.prompt.md")).toBeUndefined();
    expect(prompts).toHaveLength(2);
  });

  it("agents: only offers an update when the project already has the pipeline agent (no new)", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "templates/.github/agents/executor.agent.md", "v2\n");
    write(project, ".github/agents/executor.agent.md", "v1\n");
    markShipped(source, "v1\n");
    write(source, "templates/.github/agents/shipper.agent.md", "only in source\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/agents/executor.agent.md")).toMatchObject({ category: "agents", action: "update", guided: true });
    expect(findOp(plan, ".github/agents/shipper.agent.md")).toBeUndefined();
  });

  it("instructions: internal and shared instructions from the catalog, D1 missing ones offered as new", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, ".github/instructions/git-workflow.instructions.md", "shared v2\n");
    write(project, ".github/instructions/git-workflow.instructions.md", "shared v1\n");
    markShipped(source, "shared v1\n");
    write(source, "presets/shared/.github/instructions/status-reporting.instructions.md", "status\n");
    // project does NOT have status-reporting.instructions.md: D1 says offer it as new.

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/instructions/git-workflow.instructions.md")).toMatchObject({ category: "instructions", action: "update" });
    expect(findOp(plan, ".github/instructions/status-reporting.instructions.md")).toMatchObject({ category: "instructions", action: "new" });
  });

  it("runbook: only offers an update when the project already has the doc (no new)", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "docs/plans/AI-Plan-Hardening-Runbook.md", "v2\n");
    write(project, "docs/plans/AI-Plan-Hardening-Runbook.md", "v1\n");
    markShipped(source, "v1\n");
    write(source, "docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md", "only in source\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, "docs/plans/AI-Plan-Hardening-Runbook.md")).toMatchObject({ category: "runbook", action: "update" });
    expect(findOp(plan, "docs/plans/PROJECT-PRINCIPLES-TEMPLATE.md")).toBeUndefined();
  });

  it("preset: ships new and updated files for the active preset's own .github/{instructions,agents,prompts}", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "dotnet" });
    write(source, "presets/dotnet/.github/instructions/database.instructions.md", "new preset file\n");
    write(source, "presets/dotnet/.github/agents/database-reviewer.agent.md", "v2\n");
    write(project, ".github/agents/database-reviewer.agent.md", "v1\n");
    markShipped(source, "v1\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/instructions/database.instructions.md")).toMatchObject({ category: "preset", action: "new" });
    expect(findOp(plan, ".github/agents/database-reviewer.agent.md")).toMatchObject({ category: "preset", action: "update" });
  });

  it("skills: a preset's own skill wins over the shared skill of the same name", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "dotnet" });
    write(source, "presets/dotnet/.github/skills/code-review/SKILL.md", "dotnet flavour\n");
    write(source, "presets/shared/skills/code-review/SKILL.md", "shared flavour\n");
    write(source, "presets/shared/skills/release-notes/SKILL.md", "shared only\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/skills/code-review/SKILL.md")).toMatchObject({ category: "skills", action: "new", src: "presets/dotnet/.github/skills/code-review/SKILL.md" });
    expect(findOp(plan, ".github/skills/release-notes/SKILL.md")).toMatchObject({ category: "skills", action: "new", src: "presets/shared/skills/release-notes/SKILL.md" });
  });

  it("hooks: recursively mirrors templates/.github/hooks into .github/hooks", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "templates/.github/hooks/live-guard/pre-deploy.mjs", "v1\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/hooks/live-guard/pre-deploy.mjs")).toMatchObject({ category: "hooks", action: "new", guided: true });
  });

  it("automations: mirrors templates/.github/automations into .github/automations as guidance", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "templates/.github/automations/pforge-daily-drift.automation.md", "v1\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/automations/pforge-daily-drift.automation.md")).toMatchObject({ category: "automations", action: "new", guided: true });
  });

  it("mcp/sdk/master: auto-discovers every file recursively and skips node_modules", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "pforge-mcp/orchestrator/new-module.mjs", "v1\n");
    write(source, "pforge-mcp/node_modules/dep/index.js", "skip me\n");
    write(source, "pforge-sdk/index.mjs", "v1\n");
    write(source, "pforge-master/server.mjs", "v1\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, "pforge-mcp/orchestrator/new-module.mjs")).toMatchObject({ category: "mcp", action: "new", guided: false });
    expect(findOp(plan, "pforge-mcp/node_modules/dep/index.js")).toBeUndefined();
    expect(findOp(plan, "pforge-sdk/index.mjs")).toMatchObject({ category: "sdk", action: "new" });
    expect(findOp(plan, "pforge-master/server.mjs")).toMatchObject({ category: "master", action: "new" });
  });

  it("cli: pforge.ps1 / pforge.sh are new or updated at the project root", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "pforge.ps1", "v2\n");
    write(project, "pforge.ps1", "v1\n");
    write(source, "pforge.sh", "only in source\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, "pforge.ps1")).toMatchObject({ category: "cli", action: "update" });
    expect(findOp(plan, "pforge.sh")).toMatchObject({ category: "cli", action: "new" });
  });

  it("validation: validate-setup.ps1 / validate-setup.sh are new or updated at the project root", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "validate-setup.sh", "only in source\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, "validate-setup.sh")).toMatchObject({ category: "validation", action: "new" });
  });

  it("core: the root `pforge` shim is new/update; pforge.ps1/.sh stay attributed to cli (dedupe)", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "pforge", "shim v1\n");
    write(source, "pforge.ps1", "v1\n");
    write(project, "pforge.ps1", "v1\n"); // unchanged -> omitted entirely

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, "pforge")).toMatchObject({ category: "core", action: "new" });
    expect(findOp(plan, "pforge.ps1")).toBeUndefined();
    // Every dst appears at most once even though cli and core both scan pforge.ps1/.sh.
    const dsts = plan.operations.map((o) => o.dst);
    expect(new Set(dsts).size).toBe(dsts.length);
  });
});

// ───────────────────────────── never-update list ──────────────────────────

describe("update-plan: never-update list", () => {
  it("matches the documented set of user-customized files", () => {
    expect([...NEVER_UPDATE].sort()).toEqual([
      ".forge.json",
      ".github/copilot-instructions.md",
      ".github/instructions/project-principles.instructions.md",
      ".github/instructions/project-profile.instructions.md",
      "AGENTS.md",
      "docs/plans/DEPLOYMENT-ROADMAP.md",
      "docs/plans/PROJECT-PRINCIPLES.md",
    ].sort());
  });

  it("never offers a never-update file even when its content differs", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, ".github/copilot-instructions.md", "shipped\n");
    write(project, ".github/copilot-instructions.md", "customized\n");
    write(source, "AGENTS.md", "shipped\n");
    write(project, "AGENTS.md", "customized\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/copilot-instructions.md")).toBeUndefined();
    expect(findOp(plan, "AGENTS.md")).toBeUndefined();
    for (const op of plan.operations) expect(NEVER_UPDATE).not.toContain(op.dst);
  });
});

// ───────────────────────────── preset ownership ───────────────────────────

describe("update-plan: preset ownership of testing and security instructions", () => {
  it("a stack preset's own testing/security instruction wins over the shared copy", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "dotnet" });
    write(source, "presets/shared/.github/instructions/testing.instructions.md", "shared testing\n");
    write(source, "presets/shared/.github/instructions/security.instructions.md", "shared security\n");
    write(source, "presets/dotnet/.github/instructions/testing.instructions.md", "dotnet testing\n");
    write(source, "presets/dotnet/.github/instructions/security.instructions.md", "dotnet security\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    // The shared `instructions` category must not offer them (the preset category does).
    const sharedTesting = plan.operations.find((o) => o.category === "instructions" && o.dst === ".github/instructions/testing.instructions.md");
    const sharedSecurity = plan.operations.find((o) => o.category === "instructions" && o.dst === ".github/instructions/security.instructions.md");
    expect(sharedTesting).toBeUndefined();
    expect(sharedSecurity).toBeUndefined();

    expect(findOp(plan, ".github/instructions/testing.instructions.md")).toMatchObject({ category: "preset", src: "presets/dotnet/.github/instructions/testing.instructions.md" });
    expect(findOp(plan, ".github/instructions/security.instructions.md")).toMatchObject({ category: "preset", src: "presets/dotnet/.github/instructions/security.instructions.md" });
  });

  it("a custom-only install (no stack preset) falls back to the shared testing/security instruction", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "presets/shared/.github/instructions/testing.instructions.md", "shared testing\n");
    write(source, "presets/shared/.github/instructions/security.instructions.md", "shared security\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/instructions/testing.instructions.md")).toMatchObject({ category: "instructions", action: "new" });
    expect(findOp(plan, ".github/instructions/security.instructions.md")).toMatchObject({ category: "instructions", action: "new" });
  });
});

// ───────────────────────────── D1 / D2 ─────────────────────────────────────

describe("update-plan: Required Decisions D1 and D2", () => {
  it("D1: a shared/internal instruction the project lacks entirely is offered as new (closes the PowerShell gap)", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "presets/shared/.github/instructions/status-reporting.instructions.md", "status\n");
    // Project has no .github/instructions directory at all.

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(findOp(plan, ".github/instructions/status-reporting.instructions.md")).toMatchObject({ action: "new" });
  });

  it("D2: pending .forge.json additions are reported as configMigrations, not written to disk", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ templateVersion: "9.9.8", preset: "custom" });

    const before = readFileSync(join(project, ".forge.json"), "utf8");
    const plan = buildPlan({ sourceRoot: source, projectRoot: project });
    const after = readFileSync(join(project, ".forge.json"), "utf8");

    expect(after).toBe(before); // update-plan only reports; migrate-forge-config.mjs applies
    const keys = plan.configMigrations.map((m) => m.key);
    expect(keys).toContain("modelRouting.default");
    expect(keys).toContain("hooks.preDeploy");
    expect(plan.configMigrations.find((m) => m.key === "modelRouting.default").value).toBeTruthy();
  });

  it("D2: a project with no .forge.json reports no config migrations", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: undefined });

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(plan.configMigrations).toEqual([]);
  });
});

// ───────────────────────────── output shape ────────────────────────────────

describe("update-plan: output shape matches the Shared Contract", () => {
  it("plan --json has exactly the documented top-level fields, correctly typed", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "dotnet" });
    write(source, ".github/prompts/step0-specify-feature.prompt.md", "x\n");

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });

    expect(Object.keys(plan).sort()).toEqual(
      ["sourceVersion", "currentVersion", "presets", "presetSource", "operations", "configMigrations", "neverUpdate"].sort(),
    );
    expect(typeof plan.sourceVersion).toBe("string");
    expect(typeof plan.currentVersion).toBe("string");
    expect(Array.isArray(plan.presets)).toBe(true);
    expect(VALID_PRESET_SOURCES.has(plan.presetSource)).toBe(true);
    expect(Array.isArray(plan.neverUpdate)).toBe(true);

    for (const op of plan.operations) {
      expect(Object.keys(op).sort()).toEqual(["category", "action", "src", "dst", "guided"].sort());
      expect(VALID_CATEGORIES.has(op.category)).toBe(true);
      expect(VALID_ACTIONS.has(op.action)).toBe(true);
      expect(typeof op.src).toBe("string");
      expect(typeof op.dst).toBe("string");
      expect(op.src).not.toMatch(/\\/);
      expect(op.dst).not.toMatch(/\\/);
      expect(typeof op.guided).toBe("boolean");
    }
    for (const m of plan.configMigrations) {
      expect(typeof m.key).toBe("string");
      expect("value" in m).toBe(true);
    }
  });

  it("report renders without throwing and mentions an up-to-date install when there is nothing to do", () => {
    const source = makeSourceRoot({ version: "9.9.8" });
    const project = makeTmp("pf-update-plan-project-");
    // Mirror the auto-discovered pforge-mcp file so it isn't reported as new.
    write(project, "pforge-mcp/shipped-guidance-hashes.json", readFileSync(join(source, "pforge-mcp/shipped-guidance-hashes.json")));
    // Already has every migration key, so configMigrations is empty too.
    write(project, ".forge.json", JSON.stringify({
      templateVersion: "9.9.8",
      preset: "custom",
      modelRouting: { default: "already-set" },
      hooks: { preDeploy: null, postSlice: null, preAgentHandoff: null, postRun: null },
    }));

    const plan = buildPlan({ sourceRoot: source, projectRoot: project });
    const text = renderReport(plan);

    expect(plan.configMigrations).toEqual([]);
    expect(text).toContain("up to date");
  });

  it("CLI: usage error, source-invalid, and success exit codes", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    const noop = { write: () => {} };

    expect(runCli(["plan"], { stdout: noop, stderr: noop })).toBe(EXIT_USAGE);
    expect(runCli(["plan", "--source", join(source, "missing"), "--project", project], { stdout: noop, stderr: noop })).toBe(EXIT_SOURCE_INVALID);
    expect(runCli(["plan", "--source", source, "--project", project, "--json"], { stdout: noop, stderr: noop })).toBe(EXIT_OK);
  });

  it("--presets overrides .forge.json / detection", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "dotnet" });

    const plan = buildPlan({ sourceRoot: source, projectRoot: project, presetsOverride: ["typescript"] });

    expect(plan.presets).toEqual(["typescript"]);
  });
});

// ───────────────────────────── Slice 1 fixture parity ──────────────────────

/**
 * The Slice 1 baseline snapshots record what each shell's `update --dry-run`
 * reports today, parsed into sorted "ACTION path" lines (UPDATE/NEW/KEEP).
 * `update-plan.mjs` must report the same non-KEEP (i.e. new/update) lines,
 * plus the one documented D1 gap line PowerShell used to miss.
 */
const CASES = ["dotnet", "typescript", "dotnet-azure-iac", "no-forge-json", "custom"];
const KNOWN_D1_ADDITIONS = [".github/instructions/status-reporting.instructions.md"];

/**
 * The real modules `update-plan.mjs` itself ships alongside (plain `mcp`
 * byte-compare, not guidance) — every shell baseline reports all of these as
 * `NEW` against an empty `pforge-mcp/` project dir, so the fixture source
 * needs real copies of all of them, not just `update-guard.mjs`.
 */
const SHIPPED_MCP_MODULES = [
  "update-guard.mjs",
  "detect-preset.mjs",
  "migrate-forge-config.mjs",
  "update-plan.mjs",
  "preset-catalog.json",
  "orchestrator/constants.mjs",
];

/** Copy a fixture case into scratch dirs and wire in the real shipped `pforge-mcp` modules `update-plan.mjs` depends on (or reports as `NEW` itself). */
function materializeFixture(caseName) {
  const fixtureDir = join(FIXTURES_ROOT, caseName);
  const source = makeTmp(`pf-update-plan-fixture-${caseName}-source-`);
  const project = makeTmp(`pf-update-plan-fixture-${caseName}-project-`);
  cpSync(join(fixtureDir, "source"), source, { recursive: true });
  cpSync(join(fixtureDir, "project"), project, { recursive: true });
  for (const rel of SHIPPED_MCP_MODULES) {
    const dst = join(source, "pforge-mcp", rel);
    mkdirSync(join(dst, ".."), { recursive: true });
    copyFileSync(join(REPO_ROOT, "pforge-mcp", rel), dst);
  }
  return { source, project };
}

describe.each(CASES)("update-plan matches the Slice 1 baseline + D1: %s", (caseName) => {
  it("reports exactly the baseline's non-KEEP lines plus the documented D1 addition", () => {
    const baseline = JSON.parse(readFileSync(join(FIXTURES_ROOT, caseName, `${caseName}.baseline.json`), "utf8"));
    const reference = baseline["pforge.sh"] ?? baseline["pforge.ps1"] ?? [];
    const expectedLines = new Set(
      reference.filter((line) => line.startsWith("NEW ") || line.startsWith("UPDATE ")),
    );
    for (const addition of KNOWN_D1_ADDITIONS) expectedLines.add(`NEW ${addition}`);

    const { source, project } = materializeFixture(caseName);
    const plan = buildPlan({ sourceRoot: source, projectRoot: project });
    const actualLines = new Set(
      plan.operations.map((o) => `${o.action === "new" ? "NEW" : "UPDATE"} ${o.dst}`),
    );

    expect([...actualLines].sort()).toEqual([...expectedLines].sort());
  });
});

// ───────────────────────────── catalog ↔ setup.ps1 parity ──────────────────

describe.skipIf(!IS_PLAN_FORGE_SOURCE)("preset-catalog.json matches setup.ps1's preset tables", () => {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const ps = existsSync(SETUP_PS1_PATH) ? readFileSync(SETUP_PS1_PATH, "utf8").replace(/\r\n/g, "\n") : "";

  /** Parse a `switch ($x) { 'name' { 'value' } ... }` block into a name → value map. */
  function parseSwitchBlock(source, startMarker) {
    const start = source.indexOf(startMarker);
    if (start < 0) throw new Error(`marker not found: ${startMarker}`);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let end = braceStart;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = source.slice(braceStart, end + 1);
    const map = {};
    for (const m of body.matchAll(/'([^']+)'\s*\{\s*'([^']*)'\s*\}/g)) map[m[1]] = m[2];
    return map;
  }

  const psLabels = parseSwitchBlock(ps, "switch ($Preset[0]) {");
  const psBuild = parseSwitchBlock(ps, "$defaultBuild = switch ($primaryPreset) {");
  const psTest = parseSwitchBlock(ps, "$defaultTest = switch ($primaryPreset) {");
  const psLint = parseSwitchBlock(ps, "$defaultLint = switch ($primaryPreset) {");

  it.each(Object.keys(catalog.presets))("catalog entry for %s matches setup.ps1", (preset) => {
    const entry = catalog.presets[preset];
    expect(entry.label).toBe(psLabels[preset]);
    expect(entry.build).toBe(psBuild[preset]);
    expect(entry.test).toBe(psTest[preset]);
    expect(entry.lint).toBe(psLint[preset]);
  });

  it("catalog has an entry for every preset setup.ps1 accepts", () => {
    const validPresetsMatch = ps.match(/\$validPresets = @\(([^)]+)\)/);
    const names = [...validPresetsMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(Object.keys(catalog.presets).sort()).toEqual(names.sort());
  });
});

describe("Guard: the CLIs route the same guidance paths through the update guard as update-plan.mjs", () => {
  const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");
  const planPattern = read("pforge-mcp/update-plan.mjs").match(/const GUIDANCE_PATTERN = \/(.+)\/;/)[1].replace(/\\\//g, "/");
  const ps1Pattern = read("pforge.ps1").match(/\$script:GuidancePathPattern = '([^']+)'/)[1];
  const shPattern = read("pforge.sh").match(/_PF_GUIDANCE_PATH_RE='([^']+)'/)[1];

  it("pforge.ps1 matches update-plan.mjs", () => {
    expect(ps1Pattern).toBe(planPattern);
  });

  it("pforge.sh matches update-plan.mjs", () => {
    expect(shPattern).toBe(planPattern);
  });

  it("covers automation templates", () => {
    expect(new RegExp(planPattern).test(".github/automations/pforge-daily-drift.automation.md")).toBe(true);
  });
});

describe("removed package files", () => {
  const setup = () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    for (const pkg of ["pforge-mcp", "pforge-master", "pforge-sdk"]) {
      write(source, `${pkg}/package.json`, `{"name":"${pkg}"}\n`);
      write(project, `${pkg}/package.json`, `{"name":"${pkg}"}\n`);
    }
    write(source, "pforge-mcp/server.mjs", "v2\n");
    write(project, "pforge-mcp/server.mjs", "v1\n");
    write(project, "pforge-mcp/tests/forge-master.test.mjs", "moved to pforge-master\n");
    write(project, "pforge-mcp/notifications/adapter-contract.mjs", "moved to pforge-sdk\n");
    write(source, "pforge-master/server.mjs", "v2\n");
    write(project, "pforge-master/old-module.mjs", "gone\n");
    write(source, "pforge-sdk/index.mjs", "v2\n");
    return { source, project };
  };

  it("lists files the release no longer ships as remove operations", () => {
    const { source, project } = setup();
    const plan = buildPlan({ sourceRoot: source, projectRoot: project });
    expect(findOp(plan, "pforge-mcp/tests/forge-master.test.mjs")).toMatchObject({ category: "mcp", action: "remove", src: null, guided: false });
    expect(findOp(plan, "pforge-mcp/notifications/adapter-contract.mjs")).toMatchObject({ action: "remove" });
    expect(findOp(plan, "pforge-master/old-module.mjs")).toMatchObject({ category: "master", action: "remove" });
  });

  it("never removes installed dependencies, run state, lockfiles, logs, env files or test scratch", () => {
    const { source, project } = setup();
    for (const rel of [
      "pforge-mcp/node_modules/dep/index.js", "pforge-mcp/.forge/state.json", "pforge-mcp/coverage/index.html",
      "pforge-mcp/.vitest-scratch/x/.forge/run.json", "pforge-master/package-lock.json", "pforge-mcp/server.log",
      "pforge-mcp/.env", "pforge-mcp/.env.local",
    ]) write(project, rel, "keep\n");
    const removed = buildPlan({ sourceRoot: source, projectRoot: project }).operations.filter((o) => o.action === "remove").map((o) => o.dst);
    expect(removed.sort()).toEqual([
      "pforge-master/old-module.mjs", "pforge-mcp/notifications/adapter-contract.mjs", "pforge-mcp/tests/forge-master.test.mjs",
    ]);
  });

  it("leaves a package alone when the source does not ship it", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(project, "pforge-sdk/index.mjs", "local\n");
    expect(buildPlan({ sourceRoot: source, projectRoot: project }).operations.some((o) => o.action === "remove")).toBe(false);
  });

  it("removes nothing when the source package is partial (no package.json)", () => {
    const source = makeSourceRoot();
    const project = makeProjectRoot({ preset: "custom" });
    write(source, "pforge-mcp/update-plan.mjs", "runtime only\n");
    write(project, "pforge-mcp/update-from-github.mjs", "still needed\n");
    expect(buildPlan({ sourceRoot: source, projectRoot: project }).operations.some((o) => o.action === "remove")).toBe(false);
  });

  it("reports removals", () => {
    const { source, project } = setup();
    expect(renderReport(buildPlan({ sourceRoot: source, projectRoot: project }))).toMatch(/^ {2}REMOVE {2}pforge-mcp\/tests\/forge-master\.test\.mjs$/m);
  });

  it("removePackageFiles moves files to a dated backup and prunes empty folders", () => {
    const { project } = setup();
    const result = removePackageFiles({
      projectRoot: project,
      paths: ["pforge-mcp/notifications/adapter-contract.mjs", "pforge-mcp/tests/forge-master.test.mjs"],
      stamp: "2026-10-03T00-00-00-000Z",
    });
    expect(result.removed).toEqual(["pforge-mcp/notifications/adapter-contract.mjs", "pforge-mcp/tests/forge-master.test.mjs"]);
    expect(existsSync(join(project, "pforge-mcp/notifications"))).toBe(false);
    expect(existsSync(join(project, "pforge-mcp/tests/forge-master.test.mjs"))).toBe(false);
    expect(readFileSync(join(project, ".forge/update-backups/2026-10-03T00-00-00-000Z/pforge-mcp/notifications/adapter-contract.mjs"), "utf8")).toBe("moved to pforge-sdk\n");
  });

  it("removePackageFiles refuses paths outside the Plan Forge packages", () => {
    const { project } = setup();
    write(project, "src/app.cs", "user code\n");
    const result = removePackageFiles({ projectRoot: project, paths: ["src/app.cs", "pforge-mcp/../src/app.cs", "../outside.txt"], stamp: "s" });
    expect(result.removed).toEqual([]);
    expect(result.refused).toHaveLength(3);
    expect(existsSync(join(project, "src/app.cs"))).toBe(true);
  });
});
