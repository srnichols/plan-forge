/**
 * Plan Forge — Copilot Instructions Sync (Roadmap D5 / v3.0.0).
 *
 * Generates `.github/copilot-instructions.md` from forge project artifacts
 * so GitHub Copilot receives project-specific custom instructions in every
 * conversation without requiring manual setup.
 *
 * Data sources (all local, no API calls):
 *   1. Project profile     — `.github/instructions/project-profile.instructions.md`
 *   2. Project principles  — `docs/plans/PROJECT-PRINCIPLES.md`
 *                            (fallback: `.github/instructions/project-principles.instructions.md`)
 *   3. Forge configuration — `.forge.json` (model prefs, parallelism, philosophy)
 *   4. Coding standards    — `.github/instructions/project-principles.instructions.md`
 *                            (guards section extracted)
 *
 * Completes the Copilot integration trilogy:
 *   v2.99.0 — forge_sync_memories   → .github/copilot-memory-hints.md
 *   v3.0.0  — forge_sync_instructions → .github/copilot-instructions.md
 *
 * @module sync-instructions
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

// ─── Error class ─────────────────────────────────────────────────────────────

export class SyncInstructionsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SyncInstructionsError";
    this.code = code ?? "SYNC_INSTRUCTIONS_ERROR";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SHA-256 hex digest of a UTF-8 string (for changed-content detection). */
export function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Strip YAML frontmatter (--- … ---) from a Markdown string.
 * Returns the body with leading whitespace removed.
 * @param {string} text
 * @returns {string}
 */
export function stripFrontmatter(text) {
  if (typeof text !== "string") return "";
  const stripped = text.replace(/^---[\r\n][\s\S]*?[\r\n]---[\r\n]?/, "");
  return stripped.trimStart();
}

/**
 * Safe JSON parse — returns `null` on any error.
 * @param {string} text
 * @returns {any|null}
 */
function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ─── Data collection ─────────────────────────────────────────────────────────

/**
 * Collect project profile from `.github/instructions/project-profile.instructions.md`.
 *
 * @param {string} projectRoot
 * @returns {{ content: string, found: boolean }}
 */
export function collectProjectProfile(projectRoot) {
  const profilePath = join(projectRoot, ".github", "instructions", "project-profile.instructions.md");
  if (!existsSync(profilePath)) return { content: "", found: false };

  let raw = "";
  try { raw = readFileSync(profilePath, "utf-8"); } catch { return { content: "", found: false }; }

  const content = stripFrontmatter(raw).trim();
  return { content, found: content.length > 0 };
}

/**
 * Collect project principles.
 *
 * Priority order:
 *   1. `docs/plans/PROJECT-PRINCIPLES.md` (full principles doc)
 *   2. `.github/instructions/project-principles.instructions.md` (generated guards)
 *
 * @param {string} projectRoot
 * @returns {{ content: string, found: boolean, source: string }}
 */
export function collectProjectPrinciples(projectRoot) {
  const primaryPath = join(projectRoot, "docs", "plans", "PROJECT-PRINCIPLES.md");
  if (existsSync(primaryPath)) {
    let raw = "";
    try { raw = readFileSync(primaryPath, "utf-8"); } catch { /* fall through */ }
    const content = raw.trim();
    if (content) return { content, found: true, source: "docs/plans/PROJECT-PRINCIPLES.md" };
  }

  const fallbackPath = join(projectRoot, ".github", "instructions", "project-principles.instructions.md");
  if (existsSync(fallbackPath)) {
    let raw = "";
    try { raw = readFileSync(fallbackPath, "utf-8"); } catch { return { content: "", found: false, source: "" }; }
    const content = stripFrontmatter(raw).trim();
    if (content) return { content, found: true, source: ".github/instructions/project-principles.instructions.md" };
  }

  return { content: "", found: false, source: "" };
}

/**
 * Collect the forge configuration context from `.forge.json`.
 *
 * Extracts human-readable settings relevant to Copilot:
 *   - Model routing / default model
 *   - Quorum mode
 *   - Max parallelism
 *   - forgeMaster reasoning model
 *
 * @param {string} projectRoot
 * @returns {{ settings: Record<string,string>, found: boolean }}
 */
export function collectForgeConfig(projectRoot) {
  const forgePath = join(projectRoot, ".forge.json");
  if (!existsSync(forgePath)) return { settings: {}, found: false };

  let raw = "";
  try { raw = readFileSync(forgePath, "utf-8"); } catch { return { settings: {}, found: false }; }

  const parsed = safeJson(raw);
  if (!parsed || typeof parsed !== "object") return { settings: {}, found: false };

  const settings = {};

  const defaultModel = parsed.modelRouting?.default;
  if (defaultModel) settings["Default model routing"] = String(defaultModel);

  const quorumEnabled = parsed.quorum?.enabled;
  if (quorumEnabled != null) {
    settings["Quorum mode"] = quorumEnabled
      ? `enabled (threshold: ${parsed.quorum.threshold ?? "?"})`
      : "disabled";
  }

  const maxParallelism = parsed.maxParallelism;
  if (maxParallelism != null) settings["Max parallelism"] = String(maxParallelism);

  const maxRetries = parsed.maxRetries;
  if (maxRetries != null) settings["Max retries per slice"] = String(maxRetries);

  const reasoningModel = parsed.forgeMaster?.reasoningModel;
  if (reasoningModel) settings["Forge-Master reasoning model"] = String(reasoningModel);

  const philosophy = parsed.forgeMaster?.philosophy;
  if (typeof philosophy === "string" && philosophy.trim()) {
    settings["Project philosophy"] = philosophy.trim();
  }

  return { settings, found: Object.keys(settings).length > 0 };
}

/**
 * Collect extra instruction files from `.github/instructions/` that are
 * relevant for project context (excludes generic Plan Forge baseline files
 * that ship with the installer and would add noise).
 *
 * Excluded by default:
 *   - `architecture-principles.instructions.md`  (universal baseline — too generic)
 *   - `git-workflow.instructions.md`              (VCS tooling, not project-specific)
 *   - `release-checklist.instructions.md`         (maintainer-only)
 *   - `status-reporting.instructions.md`          (orchestration templates)
 *   - `context-fuel.instructions.md`              (AI meta-guidance)
 *   - `self-repair.instructions.md`               (AI meta-guidance)
 *   - `project-profile.instructions.md`           (handled by collectProjectProfile)
 *   - `project-principles.instructions.md`        (handled by collectProjectPrinciples)
 *   - `ai-plan-hardening-runbook.instructions.md` (plan execution meta)
 *
 * @param {string} projectRoot
 * @param {{ exclude?: string[] }} opts
 * @returns {Array<{ filename: string, title: string, content: string }>}
 */
export function collectInstructionFiles(projectRoot, { exclude = [] } = {}) {
  const DEFAULT_EXCLUDE = new Set([
    "architecture-principles.instructions.md",
    "git-workflow.instructions.md",
    "release-checklist.instructions.md",
    "status-reporting.instructions.md",
    "context-fuel.instructions.md",
    "self-repair.instructions.md",
    "project-profile.instructions.md",
    "project-principles.instructions.md",
    "ai-plan-hardening-runbook.instructions.md",
  ]);

  const extraExclude = new Set(exclude.map((f) => f.replace(/^.*[\\/]/, "")));

  const instrDir = join(projectRoot, ".github", "instructions");
  if (!existsSync(instrDir)) return [];

  let files;
  try { files = readdirSync(instrDir).filter((f) => f.endsWith(".instructions.md")); } catch { return []; }

  const results = [];
  for (const filename of files.sort()) {
    if (DEFAULT_EXCLUDE.has(filename) || extraExclude.has(filename)) continue;

    const abs = join(instrDir, filename);
    let raw = "";
    try { raw = readFileSync(abs, "utf-8"); } catch { continue; }

    const content = stripFrontmatter(raw).trim();
    if (!content) continue;

    // Extract first heading as title, fall back to filename
    const headingMatch = /^#+\s+(.+)$/m.exec(content);
    const title = headingMatch ? headingMatch[1].trim() : filename.replace(".instructions.md", "");

    results.push({ filename, title, content });
  }

  return results;
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

/**
 * Render the copilot-instructions Markdown document.
 *
 * @param {object} data
 * @param {{ content: string, found: boolean }}                  data.profile
 * @param {{ content: string, found: boolean, source: string }}  data.principles
 * @param {{ settings: Record<string,string>, found: boolean }}  data.forgeConfig
 * @param {Array<{ filename: string, title: string, content: string }>} data.extraInstructions
 * @param {Date}   [data.now]
 * @param {boolean} [data.noPrinciples]
 * @param {boolean} [data.noProfile]
 * @param {boolean} [data.noExtras]
 * @returns {string}
 */
export function renderInstructions({
  profile,
  principles,
  forgeConfig,
  extraInstructions = [],
  now,
  noPrinciples = false,
  noProfile = false,
  noExtras = false,
}) {
  const ts = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
  const lines = [
    "# Copilot Instructions",
    "",
    `> Generated by Plan Forge \`forge_sync_instructions\` on ${ts}.`,
    "> GitHub Copilot reads this file automatically for project-specific instructions.",
    "> Do **not** edit manually — regenerate with \`pforge sync-instructions\`.",
    "",
  ];

  let sectionsCount = 0;

  // ── Section 1: Project Profile ────────────────────────────────────────────
  if (!noProfile && profile.found) {
    lines.push("## Project Profile", "");
    lines.push(profile.content, "");
    sectionsCount++;
  }

  // ── Section 2: Project Principles ────────────────────────────────────────
  if (!noPrinciples && principles.found) {
    lines.push("## Project Principles", "");
    lines.push(principles.content, "");
    sectionsCount++;
  }

  // ── Section 3: Extra Instruction Files ───────────────────────────────────
  if (!noExtras && extraInstructions.length > 0) {
    for (const instr of extraInstructions) {
      lines.push(`## ${instr.title}`, "");
      lines.push(instr.content, "");
      sectionsCount++;
    }
  }

  // ── Section 4: Forge Configuration ───────────────────────────────────────
  if (forgeConfig.found) {
    lines.push("## Forge Configuration", "");
    for (const [key, value] of Object.entries(forgeConfig.settings)) {
      lines.push(`- **${key}**: ${value}`);
    }
    lines.push("");
    sectionsCount++;
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (sectionsCount === 0) {
    lines.push(
      "## No project-specific instructions found",
      "",
      "Add a project profile (`pforge smith` then check `.github/instructions/project-profile.instructions.md`),",
      "project principles (`docs/plans/PROJECT-PRINCIPLES.md`), or forge config (`.forge.json`) to",
      "populate this file with project-specific guidance.",
      "",
    );
  }

  return { markdown: lines.join("\n"), sectionsCount };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * @typedef {Object} SyncInstructionsResult
 * @property {boolean} ok
 * @property {string}  [outputPath]     - Absolute path written (undefined in dry-run)
 * @property {number}  sectionsCount    - Number of sections rendered
 * @property {{ profile: boolean, principles: boolean, forgeConfig: boolean, extraCount: number }} sections
 * @property {boolean} changed          - true when content differs from existing file
 * @property {boolean} dryRunMode
 * @property {string}  [dryRunContent]  - Rendered Markdown (dry-run only)
 * @property {string}  message
 */

/**
 * Sync forge project context to `.github/copilot-instructions.md`.
 *
 * @param {Object}  opts
 * @param {string}  opts.projectRoot     - Project root (required)
 * @param {boolean} [opts.dryRun]        - Print without writing
 * @param {boolean} [opts.force]         - Overwrite even if content is unchanged
 * @param {boolean} [opts.noPrinciples]  - Skip PROJECT-PRINCIPLES section
 * @param {boolean} [opts.noProfile]     - Skip project-profile section
 * @param {boolean} [opts.noExtras]      - Skip extra instruction files
 * @param {string}  [opts.output]        - Override output path
 * @param {Date}    [opts.now]           - Timestamp override for tests
 * @returns {SyncInstructionsResult}
 */
function collectInstructionSections(projectRoot, noExtras) {
  const profile = collectProjectProfile(projectRoot);
  const principles = collectProjectPrinciples(projectRoot);
  const forgeConfig = collectForgeConfig(projectRoot);
  const extraInstructions = noExtras ? [] : collectInstructionFiles(projectRoot);
  return { profile, principles, forgeConfig, extraInstructions };
}

function resolveInstructionsOutputPath(projectRoot, output) {
  return output
    ? resolve(projectRoot, output)
    : resolve(projectRoot, ".github", "copilot-instructions.md");
}

function shouldWriteInstructions(outputPath, content, force) {
  if (force || !existsSync(outputPath)) return true;
  try {
    return sha256(readFileSync(outputPath, "utf-8")) !== sha256(content);
  } catch {
    return true;
  }
}

function writeInstructionsFile(outputPath, content) {
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content, "utf-8");
  } catch (err) {
    throw new SyncInstructionsError(`Failed to write ${outputPath}: ${err.message}`);
  }
}

export function syncInstructions({
  projectRoot,
  dryRun = false,
  force = false,
  noPrinciples = false,
  noProfile = false,
  noExtras = false,
  output,
  now,
} = {}) {
  if (!projectRoot) throw new SyncInstructionsError("projectRoot is required");

  const { profile, principles, forgeConfig, extraInstructions } = collectInstructionSections(projectRoot, noExtras);
  const { markdown: content, sectionsCount } = renderInstructions({
    profile,
    principles,
    forgeConfig,
    extraInstructions,
    now: now instanceof Date ? now : new Date(),
    noPrinciples,
    noProfile,
    noExtras,
  });

  const sections = {
    profile: !noProfile && profile.found,
    principles: !noPrinciples && principles.found,
    forgeConfig: forgeConfig.found,
    extraCount: noExtras ? 0 : extraInstructions.length,
  };

  if (dryRun) {
    return {
      ok: true,
      sectionsCount,
      sections,
      changed: true,
      dryRunMode: true,
      dryRunContent: content,
      message: `Dry run: would write ${sectionsCount} section(s).`,
    };
  }

  const outputPath = resolveInstructionsOutputPath(projectRoot, output);
  const changed = shouldWriteInstructions(outputPath, content, force);
  if (changed) writeInstructionsFile(outputPath, content);

  return {
    ok: true,
    outputPath,
    sectionsCount,
    sections,
    changed,
    dryRunMode: false,
    message: changed
      ? `Wrote ${sectionsCount} section(s) to ${outputPath}.`
      : `No changes — copilot-instructions.md is up to date (${sectionsCount} section(s)).`,
  };
}

// ─── CLI entry point (when run directly via node sync-instructions.mjs) ──────
// Consumed by pforge.ps1 / pforge.sh via: node sync-instructions.mjs <json-opts>

if (process.argv[1] && process.argv[1].endsWith("sync-instructions.mjs")) {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: node sync-instructions.mjs <json-opts>");
    process.exit(1);
  }

  let opts;
  try {
    opts = JSON.parse(raw);
  } catch (e) {
    console.error(`Invalid JSON opts: ${e.message}`);
    process.exit(1);
  }

  try {
    const result = syncInstructions(opts);
    if (result.dryRunMode) {
      console.log(`📋 Dry run — ${result.message}`);
      console.log("");
      console.log(result.dryRunContent);
    } else {
      console.log(`✓ ${result.message}`);
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}
