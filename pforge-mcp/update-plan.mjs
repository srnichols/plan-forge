/**
 * Plan Forge — the single update scan both `pforge.ps1` (Invoke-Update) and
 * `pforge.sh` (cmd_update) will call instead of keeping their own category
 * scans (#299, Phase-UPDATE-CORE).
 *
 *   node update-plan.mjs plan   --source <dir> --project <dir> [--presets a,b] [--json]
 *   node update-plan.mjs report --source <dir> --project <dir> [--presets a,b]
 *
 * `plan` always computes the same plan object; with `--json` it prints the
 * Shared Contract document (docs/plans/Phase-UPDATE-CORE-PLAN.md), otherwise
 * it prints the human-readable report (same text `report` prints). `report`
 * recomputes the plan from `--source`/`--project` and renders it — so a shell
 * that already captured `plan --json` can also just render that JSON itself
 * if it prefers (the shape is documented and stable).
 *
 * Categories, in the order they are scanned (first match wins when a file
 * could be reached by more than one, e.g. `pforge.ps1` via both `cli` and
 * `core`): prompts, agents, instructions, runbook, preset, skills, hooks,
 * automations, mcp, sdk, master, cli, validation, core.
 *
 * Guidance categories (prompts, agents, instructions, runbook, preset,
 * skills, hooks, automations — anything under `.github/{prompts,instructions,
 * agents,skills,hooks,automations}/` or `docs/plans/`) go through `update-guard.mjs` so a
 * project's hand-edited copy is never silently replaced (#280). Everything
 * else (mcp, sdk, master, cli, validation, core) is a plain byte compare.
 *
 * @module update-plan
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { detectPreset } from "./detect-preset.mjs";
import { BACKUP_DIR, classifyFile, loadShippedHashes, readPlaceholderValues } from "./update-guard.mjs";
import { migrateForgeConfig } from "./migrate-forge-config.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(MODULE_DIR, "preset-catalog.json");

/** User-customized files no update ever touches. Mirrors Invoke-Update / cmd_update. */
export const NEVER_UPDATE = Object.freeze([
  ".github/copilot-instructions.md",
  ".github/instructions/project-profile.instructions.md",
  ".github/instructions/project-principles.instructions.md",
  "docs/plans/DEPLOYMENT-ROADMAP.md",
  "docs/plans/PROJECT-PRINCIPLES.md",
  "AGENTS.md",
  ".forge.json",
]);

/** `project-principles.prompt.md` lives in `templates/` and is user-customized — never auto-updated. */
const SKIPPED_PROMPT = "project-principles.prompt.md";

const PIPELINE_AGENTS = Object.freeze([
  "specifier.agent.md",
  "plan-hardener.agent.md",
  "executor.agent.md",
  "reviewer-gate.agent.md",
  "shipper.agent.md",
]);

const RUNBOOK_FILES = Object.freeze([
  "AI-Plan-Hardening-Runbook.md",
  "AI-Plan-Hardening-Runbook-Instructions.md",
  "DEPLOYMENT-ROADMAP-TEMPLATE.md",
  "PROJECT-PRINCIPLES-TEMPLATE.md",
]);

/** A guidance file's project-relative path matches one of these roots (Select-GuidedFiles' pattern). */
const GUIDANCE_PATTERN = /^(\.github\/(prompts|instructions|agents|skills|hooks|automations)\/|docs\/plans\/)/;

/** Recursive scans never descend into these (matches Invoke-Update's `-notmatch` filters). */
const AUTO_DISCOVER_EXCLUDE = /(^|\/)(node_modules|\.forge|coverage)(\/|$)/;

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function readCatalog() {
  return JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
}

/** Non-directory entry names in `dir`, or `[]` if it does not exist. */
function listFileNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
}

/** Directory entry names in `dir`, or `[]` if it does not exist. */
function listDirNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** Every file under `dir`, recursively, as paths relative to `dir` (posix separators), skipping `exclude`. */
function walkRecursive(dir, exclude = AUTO_DISCOVER_EXCLUDE) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = toPosix(relative(dir, full));
      if (exclude.test(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function filesDiffer(a, b) {
  return !readFileSync(a).equals(readFileSync(b));
}

/**
 * Build the operation for one plain (non-guided) file, or `null` when it is
 * unchanged (operations only ever list `new` or `update`).
 */
function plainEntry({ category, srcFull, dstFull, srcRoot, projectRoot }) {
  const src = toPosix(relative(srcRoot, srcFull));
  const dst = toPosix(relative(projectRoot, dstFull));
  if (NEVER_UPDATE.includes(dst)) return null;
  if (!existsSync(dstFull)) return { category, action: "new", src, dst, guided: false };
  if (filesDiffer(srcFull, dstFull)) return { category, action: "update", src, dst, guided: false };
  return null;
}

/**
 * Build the operation for one guidance file via `update-guard.mjs`'s
 * classifier, or `null` when it is unchanged, customized (kept, not
 * reported — the operator still sees it via `.forge/update-pending/` once
 * the guard runs at apply time), or missing and `allowNew` is false.
 */
function guidedEntry({ category, srcFull, dstFull, srcRoot, projectRoot, guardCtx, allowNew }) {
  const src = toPosix(relative(srcRoot, srcFull));
  const dst = toPosix(relative(projectRoot, dstFull));
  if (NEVER_UPDATE.includes(dst)) return null;
  if (!existsSync(srcFull)) return null;
  const dstExists = existsSync(dstFull);
  if (!dstExists && !allowNew) return null;

  if (!guardCtx) {
    // No shipped-guidance index reachable (Node-less or pre-3.30 source): fall
    // back to a byte compare, same as update did before the guard existed.
    if (!dstExists) return { category, action: "new", src, dst, guided: true };
    if (filesDiffer(srcFull, dstFull)) return { category, action: "update", src, dst, guided: true };
    return null;
  }

  const sourceText = readFileSync(srcFull, "utf8");
  const projectText = dstExists ? readFileSync(dstFull, "utf8") : null;
  const isMarkdown = dst.toLowerCase().endsWith(".md");
  const { action } = classifyFile({ sourceText, projectText, isMarkdown, values: guardCtx.values, shippedHashes: guardCtx.shippedHashes });
  if (action === "same" || action === "customized") return null;
  return { category, action, src, dst, guided: true };
}

/** The guard context (shipped-hash index + this project's placeholder values), or `null` if neither root ships the guard. */
function loadGuardContext(sourceRoot, projectRoot) {
  for (const root of [sourceRoot, projectRoot]) {
    const indexFile = join(root, "pforge-mcp", "shipped-guidance-hashes.json");
    if (existsSync(indexFile)) {
      try {
        return { shippedHashes: loadShippedHashes(indexFile), values: readPlaceholderValues(projectRoot) };
      } catch {
        // malformed index on this root — try the other one
      }
    }
  }
  return null;
}

function normalizePresetValue(raw) {
  if (Array.isArray(raw)) return raw.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw.includes(",") ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [raw.trim()].filter(Boolean);
  }
  return [];
}

function readProjectConfig(projectRoot) {
  const configPath = join(projectRoot, ".forge.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/** @returns {{ currentVersion: string, presets: string[], presetSource: "forge.json"|"detected"|"default" }} */
function resolvePresets({ sourceRoot, projectRoot, overridePresets, config }) {
  const currentVersion = typeof config?.templateVersion === "string" ? config.templateVersion : "unknown";

  if (overridePresets && overridePresets.length > 0) {
    return { currentVersion, presets: overridePresets, presetSource: "forge.json" };
  }

  const configPresets = config ? normalizePresetValue(config.preset) : [];
  if (configPresets.length > 0) {
    return { currentVersion, presets: configPresets, presetSource: "forge.json" };
  }

  // No .forge.json preset: detect the stack like `setup -AutoDetect`, rather
  // than assuming "custom" and replacing stack guidance with shared copies.
  const { preset } = detectPreset(projectRoot);
  if (preset !== "custom") return { currentVersion, presets: [preset], presetSource: "detected" };
  return { currentVersion, presets: ["custom"], presetSource: "default" };
}

function getByPath(obj, path) {
  return path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), obj);
}

/** `.forge.json` additions `migrate-forge-config.mjs` would make — reported only; applying them stays with that module (D2). */
function computeConfigMigrations(projectRoot, config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const { config: migrated, added } = migrateForgeConfig(config);
  return added.map((key) => ({ key, value: getByPath(migrated, key) }));
}

function scanPrompts({ sourceRoot, projectRoot, guardCtx }) {
  const srcDir = join(sourceRoot, ".github/prompts");
  const out = [];
  for (const name of listFileNames(srcDir).filter((n) => n.endsWith(".prompt.md"))) {
    if (name === SKIPPED_PROMPT) continue;
    const entry = guidedEntry({
      category: "prompts",
      srcFull: join(srcDir, name),
      dstFull: join(projectRoot, ".github/prompts", name),
      srcRoot: sourceRoot,
      projectRoot,
      guardCtx,
      allowNew: true,
    });
    if (entry) out.push(entry);
  }
  return out;
}

function scanAgents({ sourceRoot, projectRoot, guardCtx }) {
  const srcDir = join(sourceRoot, "templates/.github/agents");
  const out = [];
  for (const name of PIPELINE_AGENTS) {
    const srcFull = join(srcDir, name);
    const dstFull = join(projectRoot, ".github/agents", name);
    if (!existsSync(srcFull) || !existsSync(dstFull)) continue;
    const entry = guidedEntry({ category: "agents", srcFull, dstFull, srcRoot: sourceRoot, projectRoot, guardCtx, allowNew: false });
    if (entry) out.push(entry);
  }
  return out;
}

/** Names a currently-active stack preset ships its own copy of, under `.github/<subDir>/<name>` — the preset's copy wins (#280). */
function presetOwnedNames({ sourceRoot, presets, subDir, name }) {
  return presets
    .filter((p) => p !== "custom")
    .some((p) => existsSync(join(sourceRoot, "presets", p, ".github", subDir, name)));
}

function scanInstructions({ sourceRoot, projectRoot, guardCtx, presets, catalog }) {
  const out = [];
  const sources = [
    { dir: join(sourceRoot, ".github/instructions"), names: catalog.internalInstructions },
    { dir: join(sourceRoot, "presets/shared/.github/instructions"), names: catalog.sharedInstructions },
  ];
  for (const { dir, names } of sources) {
    for (const name of names) {
      if (presetOwnedNames({ sourceRoot, presets, subDir: "instructions", name })) continue;
      const entry = guidedEntry({
        category: "instructions",
        srcFull: join(dir, name),
        dstFull: join(projectRoot, ".github/instructions", name),
        srcRoot: sourceRoot,
        projectRoot,
        guardCtx,
        // D1: a missing shared/internal instruction is offered as NEW, like
        // Bash's `_pf_check` always did — PowerShell used to skip it.
        allowNew: true,
      });
      if (entry) out.push(entry);
    }
  }
  return out;
}

function scanRunbook({ sourceRoot, projectRoot, guardCtx }) {
  const srcDir = join(sourceRoot, "docs/plans");
  const out = [];
  for (const name of RUNBOOK_FILES) {
    const srcFull = join(srcDir, name);
    const dstFull = join(projectRoot, "docs/plans", name);
    if (!existsSync(srcFull) || !existsSync(dstFull)) continue;
    const entry = guidedEntry({ category: "runbook", srcFull, dstFull, srcRoot: sourceRoot, projectRoot, guardCtx, allowNew: false });
    if (entry) out.push(entry);
  }
  return out;
}

function scanPresetFiles({ sourceRoot, projectRoot, guardCtx, presets }) {
  const out = [];
  for (const p of presets.filter((x) => x !== "custom")) {
    const srcPresetGithub = join(sourceRoot, "presets", p, ".github");
    if (!existsSync(srcPresetGithub)) continue;
    for (const subDir of ["instructions", "agents", "prompts"]) {
      const srcSub = join(srcPresetGithub, subDir);
      for (const name of listFileNames(srcSub)) {
        const entry = guidedEntry({
          category: "preset",
          srcFull: join(srcSub, name),
          dstFull: join(projectRoot, ".github", subDir, name),
          srcRoot: sourceRoot,
          projectRoot,
          guardCtx,
          allowNew: true,
        });
        if (entry) out.push(entry);
      }
    }
  }
  return out;
}

function scanSkills({ sourceRoot, projectRoot, guardCtx, presets }) {
  const out = [];
  const presetSkillNames = new Set();
  for (const p of presets.filter((x) => x !== "custom")) {
    const srcSkills = join(sourceRoot, "presets", p, ".github/skills");
    for (const skillName of listDirNames(srcSkills)) {
      presetSkillNames.add(skillName);
      const entry = guidedEntry({
        category: "skills",
        srcFull: join(srcSkills, skillName, "SKILL.md"),
        dstFull: join(projectRoot, ".github/skills", skillName, "SKILL.md"),
        srcRoot: sourceRoot,
        projectRoot,
        guardCtx,
        allowNew: true,
      });
      if (entry) out.push(entry);
    }
  }

  // Shared skills: added/updated only while no active preset ships its own
  // version of that skill (the preset loop above already handles those).
  const srcSharedSkills = join(sourceRoot, "presets/shared/skills");
  for (const skillName of listDirNames(srcSharedSkills)) {
    if (presetSkillNames.has(skillName)) continue;
    const entry = guidedEntry({
      category: "skills",
      srcFull: join(srcSharedSkills, skillName, "SKILL.md"),
      dstFull: join(projectRoot, ".github/skills", skillName, "SKILL.md"),
      srcRoot: sourceRoot,
      projectRoot,
      guardCtx,
      allowNew: true,
    });
    if (entry) out.push(entry);
  }
  return out;
}

function scanHooks({ sourceRoot, projectRoot, guardCtx }) {
  const srcDir = join(sourceRoot, "templates/.github/hooks");
  const out = [];
  for (const rel of walkRecursive(srcDir)) {
    const entry = guidedEntry({
      category: "hooks",
      srcFull: join(srcDir, rel),
      dstFull: join(projectRoot, ".github/hooks", rel),
      srcRoot: sourceRoot,
      projectRoot,
      guardCtx,
      allowNew: true,
    });
    if (entry) out.push(entry);
  }
  return out;
}

/** VS Code automation templates (.automation.md) — guarded like hooks, since users adapt the prompts. */
function scanAutomations({ sourceRoot, projectRoot, guardCtx }) {
  const srcDir = join(sourceRoot, "templates/.github/automations");
  const out = [];
  for (const rel of walkRecursive(srcDir)) {
    const entry = guidedEntry({
      category: "automations",
      srcFull: join(srcDir, rel),
      dstFull: join(projectRoot, ".github/automations", rel),
      srcRoot: sourceRoot,
      projectRoot,
      guardCtx,
      allowNew: true,
    });
    if (entry) out.push(entry);
  }
  return out;
}

/** The packages Plan Forge owns entirely; only these may lose files the release no longer ships. */
const OWNED_PACKAGES = Object.freeze({ "pforge-mcp": "mcp", "pforge-sdk": "sdk", "pforge-master": "master" });

/**
 * Installed files in an owned package that are never removed: dependencies,
 * run state, coverage, test scratch, lockfiles, logs and local env files.
 */
const KEEP_INSTALLED = /(^|\/)(node_modules|\.forge|coverage|\.vitest-scratch)(\/|$)|(^|\/)(package-lock\.json|npm-shrinkwrap\.json|\.env(\..*)?|[^/]*\.log)$/;

/**
 * Files in an owned package that the source release no longer ships (moved or
 * deleted upstream). Updates never removed them, so old modules and tests piled
 * up in projects and could still be imported. Only a complete source package
 * (one with its package.json) can say what was removed: a partial source, such
 * as a test fixture carrying just the update runtime, would mark everything
 * else for removal.
 */
function scanRemovedPackageFiles({ category, pkgDir, sourceRoot, projectRoot }) {
  const srcPkg = join(sourceRoot, pkgDir);
  const dstPkg = join(projectRoot, pkgDir);
  if (!existsSync(join(srcPkg, "package.json")) || !existsSync(dstPkg)) return [];
  const shipped = new Set(walkRecursive(srcPkg, KEEP_INSTALLED));
  return walkRecursive(dstPkg, KEEP_INSTALLED)
    .filter((rel) => !shipped.has(rel))
    .map((rel) => ({ category, action: "remove", src: null, dst: `${pkgDir}/${rel}`, guided: false }));
}

/** The auto-discovered packages (mcp, sdk, master): every file, recursively, plain byte compare. */
function scanAutoDiscoverPackage({ category, pkgDir, sourceRoot, projectRoot }) {
  const srcPkg = join(sourceRoot, pkgDir);
  const out = [];
  for (const rel of walkRecursive(srcPkg)) {
    const entry = plainEntry({
      category,
      srcFull: join(srcPkg, rel),
      dstFull: join(projectRoot, pkgDir, rel),
      srcRoot: sourceRoot,
      projectRoot,
    });
    if (entry) out.push(entry);
  }
  return out;
}

function scanRootFiles({ category, names, sourceRoot, projectRoot }) {
  const out = [];
  for (const name of names) {
    const srcFull = join(sourceRoot, name);
    if (!existsSync(srcFull)) continue;
    const entry = plainEntry({ category, srcFull, dstFull: join(projectRoot, name), srcRoot: sourceRoot, projectRoot });
    if (entry) out.push(entry);
  }
  return out;
}

/** First occurrence wins — overlapping scans (e.g. `cli` and `core` both reach `pforge.ps1`) may add the same `dst` twice. */
function dedupeByDst(operations) {
  const seen = new Set();
  const out = [];
  for (const op of operations) {
    if (seen.has(op.dst)) continue;
    seen.add(op.dst);
    out.push(op);
  }
  return out;
}

/**
 * Compute the full update plan for one project against one source checkout.
 * @returns the Shared Contract document (docs/plans/Phase-UPDATE-CORE-PLAN.md).
 */
export function buildPlan({ sourceRoot, projectRoot, presetsOverride = null }) {
  sourceRoot = resolve(sourceRoot);
  projectRoot = resolve(projectRoot);

  const versionFile = join(sourceRoot, "VERSION");
  if (!existsSync(versionFile)) {
    const err = new Error(`source has no VERSION file: ${sourceRoot}`);
    err.code = "ERR_SOURCE_INVALID";
    throw err;
  }
  const sourceVersion = readFileSync(versionFile, "utf8").trim();

  const catalog = readCatalog();
  const config = readProjectConfig(projectRoot);
  const { currentVersion, presets, presetSource } = resolvePresets({ sourceRoot, projectRoot, overridePresets: presetsOverride, config });
  const guardCtx = loadGuardContext(sourceRoot, projectRoot);

  const args = { sourceRoot, projectRoot, guardCtx, presets, catalog };
  const operations = dedupeByDst([
    ...scanPrompts(args),
    ...scanAgents(args),
    ...scanInstructions(args),
    ...scanRunbook(args),
    ...scanPresetFiles(args),
    ...scanSkills(args),
    ...scanHooks(args),
    ...scanAutomations(args),
    ...scanAutoDiscoverPackage({ category: "mcp", pkgDir: "pforge-mcp", sourceRoot, projectRoot }),
    ...scanAutoDiscoverPackage({ category: "sdk", pkgDir: "pforge-sdk", sourceRoot, projectRoot }),
    ...scanAutoDiscoverPackage({ category: "master", pkgDir: "pforge-master", sourceRoot, projectRoot }),
    ...Object.entries(OWNED_PACKAGES).flatMap(([pkgDir, category]) => scanRemovedPackageFiles({ category, pkgDir, sourceRoot, projectRoot })),
    ...scanRootFiles({ category: "cli", names: ["pforge.ps1", "pforge.sh"], sourceRoot, projectRoot }),
    ...scanRootFiles({ category: "validation", names: ["validate-setup.ps1", "validate-setup.sh"], sourceRoot, projectRoot }),
    ...scanRootFiles({ category: "core", names: ["pforge.ps1", "pforge.sh", "pforge"], sourceRoot, projectRoot }),
  ]);

  const configMigrations = computeConfigMigrations(projectRoot, config);

  return {
    sourceVersion,
    currentVersion,
    presets,
    presetSource,
    operations,
    configMigrations,
    neverUpdate: [...NEVER_UPDATE],
  };
}

/** Render the plan as the text both shells print (D3) — colour stays in the shells. */
/** Report labels, in the order the shells print them. */
const REPORT_LABELS = Object.freeze([["update", "UPDATE"], ["new", "NEW   "], ["remove", "REMOVE"]]);

function renderChanges(operations) {
  const lines = REPORT_LABELS.flatMap(([action, label]) =>
    operations.filter((o) => o.action === action).map((o) => `  ${label}  ${o.dst}`));
  return lines.length > 0 ? ["Changes found:", ...lines] : ["No framework file changes found."];
}

export function renderReport(plan) {
  if (plan.operations.length === 0 && plan.configMigrations.length === 0 && plan.currentVersion === plan.sourceVersion) {
    return "All framework files are up to date.";
  }

  const lines = [
    `Source:   ${plan.sourceVersion}`,
    `Current:  ${plan.currentVersion}`,
    `Preset:   ${plan.presets.join(", ")} (${plan.presetSource})`,
    "",
    ...renderChanges(plan.operations),
  ];
  if (plan.configMigrations.length > 0) {
    lines.push("");
    lines.push(".forge.json additions pending:");
    for (const m of plan.configMigrations) lines.push(`  ${m.key} = ${JSON.stringify(m.value)}`);
  }
  return lines.join("\n");
}

/** Whether `rel` names a file inside an owned package, without escaping it. */
function isOwnedPackagePath(projectRoot, rel) {
  const target = resolve(projectRoot, rel);
  const inside = relative(projectRoot, target);
  if (!inside || inside.startsWith("..") || resolve(inside) === inside) return false;
  const [pkg, ...rest] = inside.split(sep);
  return Object.hasOwn(OWNED_PACKAGES, pkg) && rest.length > 0 && !KEEP_INSTALLED.test(rest.join("/"));
}

function pruneEmptyDirs(dir, stopAt) {
  let current = dir;
  while (current.startsWith(stopAt + sep) && current !== stopAt) {
    if (readdirSync(current).length > 0) return;
    rmdirSync(current);
    current = dirname(current);
  }
}

/**
 * Apply `remove` operations: move each file to .forge/update-backups/<stamp>/<path>
 * (recoverable) and drop folders left empty. Paths outside the owned packages
 * are refused, never touched.
 *
 * @param {{ projectRoot: string, paths: string[], stamp?: string }} opts
 * @returns {{ removed: string[], refused: string[], backupDir: string }}
 */
export function removePackageFiles({ projectRoot, paths, stamp = new Date().toISOString().replace(/[:.]/g, "-") }) {
  projectRoot = resolve(projectRoot);
  const backupRoot = join(projectRoot, BACKUP_DIR, stamp);
  const result = { removed: [], refused: [], backupDir: `${BACKUP_DIR}/${stamp}` };
  for (const rel of paths) {
    const source = resolve(projectRoot, rel);
    if (!isOwnedPackagePath(projectRoot, rel) || !existsSync(source) || !statSync(source).isFile()) {
      result.refused.push(rel);
      continue;
    }
    const posixRel = relative(projectRoot, source).split(sep).join("/");
    const backup = join(backupRoot, posixRel);
    mkdirSync(dirname(backup), { recursive: true });
    renameSync(source, backup);
    pruneEmptyDirs(dirname(source), join(projectRoot, posixRel.split("/")[0]));
    result.removed.push(posixRel);
  }
  return result;
}

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_SOURCE_INVALID = 3;

const USAGE = "usage: update-plan.mjs <plan|report> --source <dir> --project <dir> [--presets a,b] [--json]\n"
  + "       update-plan.mjs remove --project <dir>   (package-relative paths on stdin, one per line)\n";

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { cmd, json: false, presets: null, source: null, project: null };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--source") opts.source = rest[++i];
    else if (arg === "--project") opts.project = rest[++i];
    else if (arg === "--presets") opts.presets = rest[++i];
  }
  return opts;
}

function runRemove(opts, { stdin, stdout }) {
  const paths = String(stdin ?? readFileSync(0, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = removePackageFiles({ projectRoot: opts.project, paths });
  for (const rel of result.removed) stdout.write(`  ✅ Removed ${rel} (kept in ${result.backupDir}/)\n`);
  for (const rel of result.refused) stdout.write(`  ⚠ Not removed (not a Plan Forge package file): ${rel}\n`);
  return EXIT_OK;
}

const isPlanCommand = (opts) => ["plan", "report"].includes(opts.cmd) && Boolean(opts.source && opts.project);

export function runCli(argv, { stdout = process.stdout, stderr = process.stderr, stdin = null } = {}) {
  const opts = parseArgs(argv);
  if (opts.cmd === "remove" && opts.project) return runRemove(opts, { stdin, stdout });
  if (!isPlanCommand(opts)) {
    stderr.write(USAGE);
    return EXIT_USAGE;
  }
  return runPlanCommand(opts, { stdout, stderr });
}

function runPlanCommand(opts, { stdout, stderr }) {
  const presetsOverride = opts.presets ? opts.presets.split(",").map((s) => s.trim()).filter(Boolean) : null;
  let plan;
  try {
    plan = buildPlan({ sourceRoot: opts.source, projectRoot: opts.project, presetsOverride });
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return err.code === "ERR_SOURCE_INVALID" ? EXIT_SOURCE_INVALID : EXIT_USAGE;
  }

  if (opts.cmd === "plan" && opts.json) {
    stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    stdout.write(`${renderReport(plan)}\n`);
  }
  return EXIT_OK;
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (isMain) {
  process.exitCode = runCli(process.argv.slice(2));
}
