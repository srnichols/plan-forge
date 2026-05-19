/**
 * Plan Forge — Copilot Memory Sync (Roadmap C3).
 *
 * Generates `.github/copilot-memory-hints.md` from forge decisions so
 * Copilot Memory can auto-discover project context without requiring
 * OpenBrain configuration.
 *
 * Data sources (all local, no API calls for soft-sync mode):
 *   1. Trajectory notes  — `.forge/trajectories/<plan>/<slice>.md`
 *   2. Auto-skills       — `.forge/skills-auto/<sha>.md`
 *   3. Brain L2 entries  — `.forge/brain/**\/*.json`
 *
 * Hard-sync (Copilot Memory write API) is not yet available upstream; this
 * module implements the soft-sync approach: write a well-structured Markdown
 * file that Copilot Memory auto-discovers as a knowledge source.
 *
 * @module sync-memories
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { createHash } from "node:crypto";

// ─── Error classes ───────────────────────────────────────────────────────────

export class SyncMemoriesError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SyncMemoriesError";
    this.code = code ?? "SYNC_MEMORIES_ERROR";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SHA-256 hex digest of a UTF-8 string (for changed-content detection). */
export function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
 * Collect all trajectory notes from `.forge/trajectories/`.
 *
 * @param {string} projectRoot
 * @param {{ since?: Date, limit?: number }} opts
 * @returns {Array<{ planBasename: string, sliceId: string, content: string, mtime: Date }>}
 */
export function collectTrajectories(projectRoot, { since, limit = 50 } = {}) {
  const trajDir = join(projectRoot, ".forge", "trajectories");
  if (!existsSync(trajDir)) return [];

  const results = [];

  let plans;
  try { plans = readdirSync(trajDir); } catch { return []; }

  for (const plan of plans) {
    const planDir = join(trajDir, plan);
    let planStat;
    try { planStat = statSync(planDir); } catch { continue; }
    if (!planStat.isDirectory()) continue;

    let files;
    try { files = readdirSync(planDir); } catch { continue; }

    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const abs = join(planDir, f);
      let fstat;
      try { fstat = statSync(abs); } catch { continue; }
      const mtime = new Date(fstat.mtimeMs);
      if (since && mtime < since) continue;

      let content = "";
      try { content = readFileSync(abs, "utf-8").trim(); } catch { continue; }
      if (!content) continue;

      // Extract slice ID from filename: "slice-<id>.md"
      const m = /^slice-(.+)\.md$/.exec(f);
      const sliceId = m ? m[1] : basename(f, ".md");

      results.push({ planBasename: plan, sliceId, content, mtime });
    }
  }

  // Sort newest-first
  results.sort((a, b) => b.mtime - a.mtime);
  return results.slice(0, limit);
}

/**
 * Collect auto-skill records from `.forge/skills-auto/`.
 *
 * @param {string} projectRoot
 * @param {{ since?: Date, limit?: number }} opts
 * @returns {Array<{ sha256Prefix: string, summary: string, commands: string[], domainKeywords: string[], createdAt: string, reuseCount: number }>}
 */
export function collectAutoSkills(projectRoot, { since, limit = 20 } = {}) {
  const skillsDir = join(projectRoot, ".forge", "skills-auto");
  if (!existsSync(skillsDir)) return [];

  let files;
  try { files = readdirSync(skillsDir).filter((f) => f.endsWith(".md")); } catch { return []; }

  const results = [];
  for (const f of files) {
    const abs = join(skillsDir, f);
    let text = "";
    try { text = readFileSync(abs, "utf-8"); } catch { continue; }

    const record = parseAutoSkillFrontmatter(text);
    if (!record) continue;

    if (since) {
      const createdDate = new Date(record.createdAt);
      if (isNaN(createdDate.getTime()) || createdDate < since) continue;
    }

    results.push(record);
  }

  // Sort by reuseCount DESC, then createdAt DESC
  results.sort((a, b) => {
    const diff = b.reuseCount - a.reuseCount;
    if (diff !== 0) return diff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return results.slice(0, limit);
}

/**
 * Parse auto-skill frontmatter without importing memory.mjs (keeps this
 * module self-contained for tree-shakability and testability).
 *
 * @param {string} text
 * @returns {{ sha256Prefix, summary, commands, domainKeywords, createdAt, reuseCount }|null}
 */
function frontmatterField(fm, field) {
  return (new RegExp(`^${field}:\\s*(.+)$`, "m").exec(fm) || [])[1] || "";
}

function parseFrontmatterJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseFrontmatterInlineStringArray(fm, field) {
  const match = new RegExp(`^\\s*${field}:\\s*\\[([^\\]]*)\\]$`, "m").exec(fm);
  if (!match || !match[1].trim()) return [];
  const parsed = parseFrontmatterJson(`[${match[1]}]`, []);
  return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
}

function parseFrontmatterCommands(fm) {
  const commands = [];
  const sectionMatch = /\ncommands:\n([\s\S]*)$/.exec(fm);
  if (!sectionMatch) return commands;
  for (const raw of sectionMatch[1].split("\n")) {
    const match = /^\s*-\s*(.+)$/.exec(raw);
    if (!match) continue;
    const value = parseFrontmatterJson(match[1].trim(), match[1].trim());
    if (typeof value === "string" && value.length > 0) commands.push(value);
  }
  return commands;
}

export function parseAutoSkillFrontmatter(text) {
  if (typeof text !== "string") return null;
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  const sha256Prefix = frontmatterField(fm, "sha256Prefix");
  if (!sha256Prefix) return null;

  const summaryLine = frontmatterField(fm, "summary");
  const summary = parseFrontmatterJson(summaryLine, summaryLine);
  const createdAt = frontmatterField(fm, "createdAt");
  const reuseCount = Number(frontmatterField(fm, "reuseCount") || 0) || 0;

  return {
    sha256Prefix,
    summary,
    commands: parseFrontmatterCommands(fm),
    domainKeywords: parseFrontmatterInlineStringArray(fm, "domainKeywords"),
    createdAt,
    reuseCount,
  };
}

/**
 * Collect decision entries from `.forge/brain/**\/*.json`.
 *
 * Reads all JSON files under `.forge/brain/`, filters to objects that look
 * like decisions (have a `content` or `value.content` string field).
 *
 * @param {string} projectRoot
 * @param {{ since?: Date, limit?: number }} opts
 * @returns {Array<{ key: string, content: string, mtime: Date }>}
 */
export function collectBrainDecisions(projectRoot, { since, limit = 30 } = {}) {
  const brainDir = join(projectRoot, ".forge", "brain");
  if (!existsSync(brainDir)) return [];

  const results = [];
  _walkBrainDir(brainDir, brainDir, results, since);

  results.sort((a, b) => b.mtime - a.mtime);
  return results.slice(0, limit);
}

function _walkBrainDir(brainRoot, dir, results, since) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    const abs = join(dir, entry);
    let stat;
    try { stat = statSync(abs); } catch { continue; }

    if (stat.isDirectory()) {
      _walkBrainDir(brainRoot, abs, results, since);
      continue;
    }

    if (!entry.endsWith(".json")) continue;
    const mtime = new Date(stat.mtimeMs);
    if (since && mtime < since) continue;

    let text = "";
    try { text = readFileSync(abs, "utf-8"); } catch { continue; }
    const parsed = safeJson(text);
    if (!parsed || typeof parsed !== "object") continue;

    // Extract content: try {value: {content}}, {content}, {value}
    let content = null;
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      content = parsed.content.trim();
    } else if (typeof parsed.value?.content === "string" && parsed.value.content.trim()) {
      content = parsed.value.content.trim();
    } else if (typeof parsed.value === "string" && parsed.value.trim()) {
      content = parsed.value.trim();
    }

    if (!content) continue;

    // Build human-readable key from path relative to .forge/brain/
    const relPath = abs.slice(brainRoot.length + 1).replace(/\\/g, "/").replace(/\.json$/, "");
    results.push({ key: relPath, content, mtime });
  }
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

/**
 * Render the memory-hints Markdown document.
 *
 * @param {object} data
 * @param {Array}  data.trajectories
 * @param {Array}  data.autoSkills
 * @param {Array}  data.decisions
 * @param {Date}   [data.now]
 * @returns {string}
 */
export function renderMemoryHints({ trajectories, autoSkills, decisions, now }) {
  const ts = (now instanceof Date ? now : new Date()).toISOString().slice(0, 10);
  const lines = [
    "# Copilot Memory Hints",
    "",
    `> Generated by Plan Forge \`forge_sync_memories\` on ${ts}.`,
    "> Copilot Memory auto-discovers this file as a project knowledge source.",
    "> Do **not** edit manually — regenerate with \`pforge sync-memories\`.",
    "",
  ];

  // ── Section 1: Architecture Decisions ──────────────────────────────────
  if (decisions.length > 0) {
    lines.push("## Architecture Decisions", "");
    for (const d of decisions) {
      const short = d.content.split("\n")[0].slice(0, 200);
      lines.push(`- **${d.key}**: ${short}`);
    }
    lines.push("");
  }

  // ── Section 2: Conventions & Patterns (auto-skills) ────────────────────
  if (autoSkills.length > 0) {
    lines.push("## Conventions & Patterns", "");
    for (const s of autoSkills) {
      lines.push(`### ${s.summary}`);
      if (s.domainKeywords.length > 0) {
        lines.push(`*Domains: ${s.domainKeywords.join(", ")}*`);
      }
      if (s.reuseCount > 0) {
        lines.push(`*Reused ${s.reuseCount} time${s.reuseCount !== 1 ? "s" : ""}.*`);
      }
      if (s.commands.length > 0) {
        lines.push("", "Validation commands that worked:", "```");
        for (const c of s.commands) lines.push(c);
        lines.push("```");
      }
      lines.push("");
    }
  }

  // ── Section 3: Lessons Learned (trajectory notes) ──────────────────────
  if (trajectories.length > 0) {
    lines.push("## Lessons Learned", "");
    for (const t of trajectories) {
      const heading = `Plan \`${t.planBasename}\` / Slice ${t.sliceId}`;
      lines.push(`### ${heading}`, "");
      // Trim to first 300 chars to keep the file bounded
      const excerpt = t.content.slice(0, 300) + (t.content.length > 300 ? "\n\n*[truncated — see .forge/trajectories for full note]*" : "");
      lines.push(excerpt, "");
    }
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (decisions.length === 0 && autoSkills.length === 0 && trajectories.length === 0) {
    lines.push(
      "## No hints yet",
      "",
      "Run at least one plan (`pforge run-plan`) to generate trajectory notes and auto-skills.",
      "OpenBrain decisions will appear here once the brain store is populated.",
      "",
    );
  }

  return lines.join("\n");
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * @typedef {Object} SyncMemoriesResult
 * @property {boolean} ok
 * @property {string}  [outputPath]     - Absolute path written (undefined in dry-run)
 * @property {number}  hintsCount       - Total hint items across all sections
 * @property {{ trajectories: number, autoSkills: number, decisions: number }} sections
 * @property {boolean} changed          - true when content differs from existing file
 * @property {boolean} dryRunMode
 * @property {string}  [dryRunContent]  - Rendered Markdown (dry-run only)
 * @property {string}  message
 */

/**
 * Sync forge decisions to `.github/copilot-memory-hints.md`.
 *
 * @param {Object} opts
 * @param {string}  opts.projectRoot  - Project root (required)
 * @param {boolean} [opts.dryRun]     - Print without writing
 * @param {boolean} [opts.force]      - Overwrite even if content is unchanged
 * @param {number}  [opts.limit]      - Max entries per section (default: 10)
 * @param {string}  [opts.since]      - ISO date string to filter by
 * @param {string}  [opts.output]     - Override output path (default: .github/copilot-memory-hints.md)
 * @param {Date}    [opts.now]        - Timestamp override for tests
 * @returns {SyncMemoriesResult}
 */
export function syncMemories({
  projectRoot,
  dryRun = false,
  force = false,
  limit = 10,
  since,
  output,
  now,
} = {}) {
  if (!projectRoot) throw new SyncMemoriesError("projectRoot is required");

  const sinceDate = since ? new Date(since) : undefined;
  if (sinceDate && isNaN(sinceDate.getTime())) {
    throw new SyncMemoriesError(`Invalid --since value: "${since}"`);
  }

  const trajectories = collectTrajectories(projectRoot, { since: sinceDate, limit });
  const autoSkills   = collectAutoSkills(projectRoot, { since: sinceDate, limit });
  const decisions    = collectBrainDecisions(projectRoot, { since: sinceDate, limit });

  const content = renderMemoryHints({
    trajectories,
    autoSkills,
    decisions,
    now: now instanceof Date ? now : new Date(),
  });

  const hintsCount = trajectories.length + autoSkills.length + decisions.length;
  const sections = {
    trajectories: trajectories.length,
    autoSkills:   autoSkills.length,
    decisions:    decisions.length,
  };

  if (dryRun) {
    return {
      ok: true,
      hintsCount,
      sections,
      changed: true,
      dryRunMode: true,
      dryRunContent: content,
      message: `Dry run: would write ${hintsCount} hint(s) (${sections.trajectories} trajectories, ${sections.autoSkills} auto-skills, ${sections.decisions} decisions).`,
    };
  }

  const outputPath = output
    ? resolve(projectRoot, output)
    : resolve(projectRoot, ".github", "copilot-memory-hints.md");

  // Skip write when content is unchanged (unless --force)
  let changed = true;
  if (!force && existsSync(outputPath)) {
    try {
      const existing = readFileSync(outputPath, "utf-8");
      if (sha256(existing) === sha256(content)) {
        changed = false;
      }
    } catch { /* treat as changed */ }
  }

  if (changed) {
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, content, "utf-8");
    } catch (err) {
      throw new SyncMemoriesError(`Failed to write ${outputPath}: ${err.message}`);
    }
  }

  return {
    ok: true,
    outputPath,
    hintsCount,
    sections,
    changed,
    dryRunMode: false,
    message: changed
      ? `Wrote ${hintsCount} hint(s) to ${outputPath}.`
      : `No changes — memory hints are up to date (${hintsCount} hint(s)).`,
  };
}

// ─── CLI entry point (when run directly via node sync-memories.mjs) ──────────
// Consumed by pforge.ps1 / pforge.sh via: node sync-memories.mjs <json-opts>

if (process.argv[1] && process.argv[1].endsWith("sync-memories.mjs")) {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: node sync-memories.mjs <json-opts>");
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
    const result = syncMemories(opts);
    if (result.dryRunMode) {
      console.log(`📋 Dry run — ${result.message}`);
      console.log("");
      console.log(result.dryRunContent);
    } else if (result.changed) {
      console.log(`✓ ${result.message}`);
    } else {
      console.log(`✓ ${result.message}`);
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}
