/**
 * Plan Forge — Spec Kit Importer (Phase CRUCIBLE-IMPORT-CLI).
 *
 * Deterministic, LLM-free importer that maps the four canonical Spec Kit
 * artifacts (`spec.md`, `plan.md`, `tasks.md`, `constitution.md`) into a
 * Plan Forge Crucible smelt and emits a Phase Plan whose YAML frontmatter
 * already satisfies `crucible-enforce.mjs`.
 *
 * Field mapping is documented in [docs/manual/spec-kit-interop.html].
 *
 * Separation of concerns:
 *   - This module: filesystem read, markdown parse, smelt write, plan emit,
 *     audit-log append. Pure data transforms — no network, no LLM, no shell.
 *   - CLI rendering (table output, ANSI, exit codes): the `main()` entry at
 *     the bottom of this file, invoked when run as a script.
 *   - MCP tool wrapping: server.mjs (Slice 4).
 *
 * @module crucible-import
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "./enums.mjs";

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} MappedField
 * @property {string} source    Source file + heading, e.g. "spec.md#title"
 * @property {string} target    Smelt target field, e.g. "plan-title"
 * @property {*}      value     The mapped value (string | string[] | object[])
 *
 * @typedef {Object} MissingField
 * @property {string} file      Which source file was missing the field
 * @property {string} field     Which field
 * @property {"error"|"warn"} severity
 *
 * @typedef {Object} ImportResult
 * @property {boolean}        ok
 * @property {string|null}    smeltId
 * @property {string|null}    planPath
 * @property {string|null}    smeltPath
 * @property {MappedField[]}  mappedFields
 * @property {MissingField[]} missingFields
 * @property {string[]}       warnings
 * @property {string}         [error]    Error code when `ok: false`
 * @property {boolean}        dryRun
 */

/**
 * Default candidate directories Spec Kit artifacts may live under, relative
 * to a project root. First match wins.
 */
const DEFAULT_SCAN_DIRS = [
  "specs",
  "memory",
  ".speckit",
  ".",
];

/**
 * Import a Spec Kit artifact set into a Crucible smelt + Phase Plan.
 *
 * @param {Object}  opts
 * @param {string}  opts.projectRoot      Absolute path to the Plan Forge project
 * @param {string}  [opts.dir]            Override directory to scan (relative or absolute)
 * @param {boolean} [opts.dryRun=false]   Validate + map without writing files
 * @param {boolean} [opts.syncPrinciples=false]  Also write PROJECT-PRINCIPLES.md from constitution.md
 * @param {string}  [opts.name]           Override the slugified plan name
 * @returns {ImportResult}
 */
function _validateSpeckitArtifacts({ spec, plan, tasks, constitution, result }) {
  if (!spec || !plan) {
    if (!spec)
      result.missingFields.push({ file: "spec.md", field: "<file>", severity: "error" });
    if (!plan)
      result.missingFields.push({ file: "plan.md", field: "<file>", severity: "error" });
    result.error = ERROR_CODES.SPECKIT_IMPORT_MISSING_REQUIRED.code;
    result.warnings.push(
      "Both spec.md and plan.md are required. Re-run after creating them."
    );
    return false;
  }
  if (!spec.title) {
    result.missingFields.push({ file: "spec.md", field: "title", severity: "error" });
    result.error = ERROR_CODES.SPECKIT_IMPORT_MISSING_FIELD.code;
    result.warnings.push(
      "spec.md is missing a top-level `# Title` heading; import blocked."
    );
    return false;
  }
  if (!plan.scope) {
    result.missingFields.push({ file: "plan.md", field: "scope", severity: "error" });
    result.error = ERROR_CODES.SPECKIT_IMPORT_MISSING_FIELD.code;
    result.warnings.push(
      "plan.md is missing a `## Scope` section; import blocked."
    );
    return false;
  }
  if (!tasks)
    result.missingFields.push({ file: "tasks.md", field: "<file>", severity: "warn" });
  if (!constitution)
    result.missingFields.push({ file: "constitution.md", field: "<file>", severity: "warn" });
  return true;
}

function _checkSyncPrinciplesGuard({ syncPrinciples, constitution, principlesPath, result }) {
  if (!syncPrinciples) return true;
  if (!constitution) {
    result.error = ERROR_CODES.PROJECT_PRINCIPLES_NO_SOURCE.code;
    result.warnings.push(
      "--sync-principles requested but constitution.md is absent."
    );
    return false;
  }
  if (existsSync(principlesPath)) {
    result.error = ERROR_CODES.PROJECT_PRINCIPLES_EXISTS.code;
    result.warnings.push(
      `${principlesPath} already exists; refusing to overwrite. Remove it first or omit --sync-principles.`
    );
    return false;
  }
  return true;
}

function _writeSpeckitOutputs(ctx) {
  const {
    smeltDir, planFilePath, smeltPath, smelt, projectRoot, phaseName, planMarkdown,
    syncPrinciples, constitution, principlesPath, auditPath, crucibleId, mapped, result,
  } = ctx;
  mkdirSync(smeltDir, { recursive: true });
  mkdirSync(dirname(planFilePath), { recursive: true });
  writeFileSync(smeltPath, JSON.stringify(smelt, null, 2));

  let finalPlanPath = planFilePath;
  let n = 2;
  while (existsSync(finalPlanPath)) {
    finalPlanPath = join(projectRoot, "docs", "plans", `${phaseName}-${n}-PLAN.md`);
    n++;
  }
  writeFileSync(finalPlanPath, planMarkdown);
  result.planPath = finalPlanPath;

  if (syncPrinciples && constitution) {
    writeFileSync(principlesPath, renderPrinciples(constitution));
  }

  appendFileSync(
    auditPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
      planPath: finalPlanPath,
      source: "speckit",
      reason: "auto-import via pforge crucible import",
      crucibleId,
      mappedFieldCount: mapped.length,
      missingFieldCount: result.missingFields.length,
    }) + "\n"
  );
}

function createImportResult(dryRun) {
  return {
    ok: false,
    smeltId: null,
    planPath: null,
    smeltPath: null,
    mappedFields: [],
    missingFields: [],
    warnings: [],
    dryRun,
  };
}

function parseSpeckitArtifacts({ specPath, planPath, tasksPath, constitutionPath }) {
  return {
    spec: specPath ? parseSpec(readFileSync(specPath, "utf-8")) : null,
    plan: planPath ? parsePlan(readFileSync(planPath, "utf-8")) : null,
    tasks: tasksPath ? parseTasks(readFileSync(tasksPath, "utf-8")) : null,
    constitution: constitutionPath
      ? parseConstitution(readFileSync(constitutionPath, "utf-8"))
      : null,
  };
}

function buildSpeckitMappedFields({ spec, plan, slicesMerged, constitution }) {
  const mapped = [
    { source: "spec.md#title", target: "plan-title", value: spec.title },
    { source: "spec.md#goals", target: "objectives[]", value: spec.goals },
    { source: "plan.md#scope", target: "scope", value: plan.scope },
    { source: "plan.md#slices", target: "slices[]", value: slicesMerged },
    {
      source: "plan.md#forbidden-actions",
      target: "forbidden-actions",
      value: plan.forbiddenActions,
    },
  ];
  if (constitution) {
    mapped.push({
      source: "constitution.md#rules",
      target: "agent-constraints",
      value: constitution.rules,
    });
  }
  return mapped;
}

function prepareSpeckitImportArtifacts({ opts, projectRoot, result, scanResult, parsed }) {
  const smeltId = randomUUID();
  const crucibleId = `imported-speckit-${smeltId}`;
  const slices = mergeSlicesWithTasks(parsed.plan.slices || [], parsed.tasks ? parsed.tasks.rows : []);
  for (const warning of slices.warnings) result.warnings.push(warning);

  const mapped = buildSpeckitMappedFields({
    spec: parsed.spec,
    plan: parsed.plan,
    slicesMerged: slices.merged,
    constitution: parsed.constitution,
  });
  result.mappedFields = mapped;

  const slug = opts.name || slugify(parsed.spec.title) || `speckit-import-${smeltId.slice(0, 8)}`;
  const phaseName = `Phase-${slug.toUpperCase()}`;
  const smeltDir = join(projectRoot, ".forge", "crucible");
  const smeltPath = join(smeltDir, `${smeltId}.json`);
  const planFilePath = join(projectRoot, "docs", "plans", `${phaseName}-PLAN.md`);
  const auditPath = join(smeltDir, "manual-imports.jsonl");
  const principlesPath = join(projectRoot, "docs", "plans", "PROJECT-PRINCIPLES.md");

  const smelt = {
    id: smeltId,
    crucibleId,
    source: "speckit",
    sourceDir: scanResult.sourceDir,
    status: "imported",
    createdAt: new Date().toISOString(),
    "plan-title": parsed.spec.title,
    objectives: parsed.spec.goals,
    scope: parsed.plan.scope,
    slices: slices.merged,
    "forbidden-actions": parsed.plan.forbiddenActions,
    "agent-constraints": parsed.constitution ? parsed.constitution.rules : [],
    "agent-commitments": parsed.constitution ? parsed.constitution.commitments : [],
    "agent-boundaries": parsed.constitution ? parsed.constitution.boundaries : [],
    sourceFiles: {
      spec: scanResult.specPath,
      plan: scanResult.planPath,
      tasks: scanResult.tasksPath,
      constitution: scanResult.constitutionPath,
    },
  };

  const planMarkdown = renderPhasePlan({
    crucibleId,
    phaseName,
    spec: parsed.spec,
    plan: parsed.plan,
    slicesMerged: slices.merged,
    constitution: parsed.constitution,
  });

  result.smeltId = smeltId;
  result.smeltPath = smeltPath;
  result.planPath = planFilePath;

  return {
    smelt,
    smeltDir,
    smeltId,
    smeltPath,
    planFilePath,
    auditPath,
    principlesPath,
    mapped,
    planMarkdown,
    phaseName,
    crucibleId,
  };
}

export function importSpeckit(opts) {
  const projectRoot = resolve(opts.projectRoot || process.cwd());
  const dryRun = !!opts.dryRun;
  const syncPrinciples = !!opts.syncPrinciples;
  const result = createImportResult(dryRun);

  const scanResult = locateArtifacts(projectRoot, opts.dir);
  if (!scanResult.ok) {
    result.error = scanResult.error;
    result.warnings.push(scanResult.message);
    return result;
  }

  const parsed = parseSpeckitArtifacts(scanResult);
  if (!_validateSpeckitArtifacts({ ...parsed, result })) {
    return result;
  }

  const artifacts = prepareSpeckitImportArtifacts({
    opts,
    projectRoot,
    result,
    scanResult,
    parsed,
  });

  if (!_checkSyncPrinciplesGuard({
    syncPrinciples,
    constitution: parsed.constitution,
    principlesPath: artifacts.principlesPath,
    result,
  })) {
    return result;
  }

  if (dryRun) {
    result.ok = true;
    return result;
  }

  _writeSpeckitOutputs({
    smeltDir: artifacts.smeltDir,
    planFilePath: artifacts.planFilePath,
    smeltPath: artifacts.smeltPath,
    smelt: artifacts.smelt,
    projectRoot,
    phaseName: artifacts.phaseName,
    planMarkdown: artifacts.planMarkdown,
    syncPrinciples,
    constitution: parsed.constitution,
    principlesPath: artifacts.principlesPath,
    auditPath: artifacts.auditPath,
    crucibleId: artifacts.crucibleId,
    mapped: artifacts.mapped,
    result,
  });

  result.ok = true;
  return result;
}

// ─── Locator ────────────────────────────────────────────────────────────────

function locateArtifacts(projectRoot, overrideDir) {
  const candidates = [];
  if (overrideDir) {
    const abs = resolve(projectRoot, overrideDir);
    if (!existsSync(abs)) {
      return {
        ok: false,
        error: ERROR_CODES.SPECKIT_IMPORT_DIR_NOT_FOUND.code,
        message: `Directory not found: ${abs}`,
      };
    }
    candidates.push(abs);
  } else {
    for (const d of DEFAULT_SCAN_DIRS) {
      const abs = resolve(projectRoot, d);
      if (!existsSync(abs)) continue;
      candidates.push(abs);
      // For specs/, also descend one level (Spec Kit puts feature dirs there)
      if (d === "specs") {
        try {
          for (const child of readdirSync(abs)) {
            const childAbs = join(abs, child);
            if (statSync(childAbs).isDirectory()) candidates.push(childAbs);
          }
        } catch { /* ignore */ }
      }
    }
  }

  // Pick the first candidate that has at least spec.md OR plan.md
  for (const c of candidates) {
    const specPath = pickFirst(c, ["spec.md", "SPEC.md"]);
    const planPath = pickFirst(c, ["plan.md", "PLAN.md"]);
    if (specPath || planPath) {
      // constitution.md often lives one level up (under memory/ in Spec Kit's default layout)
      let constitutionPath = pickFirst(c, ["constitution.md"]);
      if (!constitutionPath) {
        constitutionPath = pickFirst(join(projectRoot, "memory"), ["constitution.md"]);
      }
      return {
        ok: true,
        sourceDir: c,
        specPath,
        planPath,
        tasksPath: pickFirst(c, ["tasks.md", "TASKS.md"]),
        constitutionPath,
      };
    }
  }

  return {
    ok: false,
    error: ERROR_CODES.SPECKIT_IMPORT_NOT_FOUND.code,
    message:
      "No Spec Kit artifacts found. Tried: " +
      DEFAULT_SCAN_DIRS.map((d) => `${d}/`).join(", ") +
      ". Pass --dir <path> to point at a specific feature directory.",
  };
}

function pickFirst(dir, names) {
  for (const n of names) {
    const p = join(dir, n);
    if (existsSync(p)) return p;
  }
  return null;
}

// ─── Parsers ────────────────────────────────────────────────────────────────

/**
 * Parse spec.md. Recognises:
 *   - First `# heading`            → title (strips "Feature Specification: " prefix if present)
 *   - `## Goals` bullet list       → goals[] (alias: `## Requirements`)
 *   - `## Acceptance Criteria` list → acceptance[] (alias: `## Success Criteria`)
 *   - `## Out of Scope` list       → outOfScope[] (alias: `## Assumptions`)
 *   - `## User Scenarios` list     (informational)
 *
 * Aliases support both the hand-crafted Plan Forge convention and the actual
 * heading names emitted by the real github/spec-kit CLI templates.
 */
export function parseSpec(content) {
  const title = extractFirstH1(content);
  const goals = extractBulletsWithAliases(content, ["Goals", "Requirements"]);
  const acceptance = extractBulletsWithAliases(content, ["Acceptance Criteria", "Success Criteria"]);
  const outOfScope = extractBulletsWithAliases(content, ["Out of Scope", "Assumptions"]);
  return { title, goals, acceptance, outOfScope };
}

/**
 * Parse plan.md. Recognises:
 *   - `## Scope`              → scope (raw paragraph text; alias: `## Summary`)
 *   - `## Slices` numbered list → slices[]
 *   - `## Forbidden Actions` list → forbiddenActions[]
 *
 * The `## Summary` alias supports the heading name used by the real
 * github/spec-kit `plan-template.md`.
 */
export function parsePlan(content) {
  const scope = extractParagraphUnderHeading(content, "Scope") ??
                extractParagraphUnderHeading(content, "Summary");
  const sliceLines = extractBulletsUnderHeading(content, "Slices");
  const slices = sliceLines.map((line, i) => {
    // Handle "**Title** — body" pattern
    const m = line.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.*)$/);
    return {
      id: i + 1,
      title: m ? m[1].trim() : line.split(/[—–-]/)[0].trim(),
      description: m ? m[2].trim() : line,
    };
  });
  const forbiddenActions = extractBulletsUnderHeading(content, "Forbidden Actions");
  return { scope, slices, forbiddenActions };
}

/**
 * Parse tasks.md. Recognises a markdown table with columns:
 *   Task ID | Slice | Description | Status
 *
 * Returns `{ rows: [{ taskId, slice, description, status }] }`.
 * Unknown status values are normalised to `pending` with a warning attached.
 */
export function parseTasks(content) {
  const lines = content.split(/\r?\n/);
  const rows = [];
  let inTable = false;
  let headerSeen = false;
  for (const line of lines) {
    if (line.trim().startsWith("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
      if (!headerSeen) {
        headerSeen = true;
        inTable = true;
        continue;
      }
      // Skip the separator row (---|---|---)
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (cells.length >= 4) {
        rows.push({
          taskId: cells[0],
          slice: cells[1],
          description: cells[2],
          status: normaliseTaskStatus(cells[3]),
        });
      }
    } else if (inTable && line.trim() === "") {
      // table ended
      inTable = false;
    }
  }
  return { rows };
}

function normaliseTaskStatus(raw) {
  const r = raw.toLowerCase().trim();
  if (r === "done" || r === "complete" || r === "completed") return "done";
  if (r === "in-progress" || r === "in progress" || r === "wip") return "in_progress";
  return "pending";
}

/**
 * Parse constitution.md. Recognises three optional sections:
 *   ## Rules        → rules[] (alias: `## Core Principles`)
 *   ## Commitments  → commitments[]
 *   ## Boundaries   → boundaries[]
 *
 * The `## Core Principles` alias supports the heading name used by the real
 * github/spec-kit `constitution-template.md`.
 */
export function parseConstitution(content) {
  return {
    rules: extractBulletsWithAliases(content, ["Rules", "Core Principles"]),
    commitments: extractBulletsUnderHeading(content, "Commitments"),
    boundaries: extractBulletsUnderHeading(content, "Boundaries"),
  };
}

// ─── Markdown helpers (no external deps, deterministic) ─────────────────────

function extractFirstH1(content) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) {
      // Strip the "Feature Specification: " prefix emitted by the real spec-kit CLI
      return m[1].trim().replace(/^Feature Specification:\s+/i, "");
    }
  }
  return null;
}

/**
 * Try each alias heading in order; return the first non-empty bullet list found.
 * Falls back to [] when none of the aliases match.
 */
function extractBulletsWithAliases(content, aliases) {
  for (const alias of aliases) {
    const items = extractBulletsUnderHeading(content, alias);
    if (items.length > 0) return items;
  }
  return [];
}

/**
 * Extract bullet items under a `## Heading` until the next heading or EOF.
 * Recognises `-`, `*`, and `1.` style bullets. Strips checkbox prefixes.
 */
function extractBulletsUnderHeading(content, heading) {
  const lines = content.split(/\r?\n/);
  const headingRe = new RegExp(`^##+\\s+${escapeRe(heading)}\\s*$`, "i");
  const nextHeadingRe = /^##+\s+/;
  const bulletRe = /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/;
  const items = [];
  let inSection = false;
  for (const line of lines) {
    if (headingRe.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && nextHeadingRe.test(line)) break;
    if (inSection) {
      const m = line.match(bulletRe);
      if (m) {
        let item = m[1].trim();
        // Strip leading `[ ]` / `[x]` checkbox markers
        item = item.replace(/^\[\s*[xX ]?\s*\]\s+/, "");
        items.push(item);
      }
    }
  }
  return items;
}

/**
 * Extract the prose paragraph(s) directly under a `## Heading` until the
 * next heading. Bullet lines are excluded — use `extractBulletsUnderHeading`
 * for those.
 */
function extractParagraphUnderHeading(content, heading) {
  const lines = content.split(/\r?\n/);
  const headingRe = new RegExp(`^##+\\s+${escapeRe(heading)}\\s*$`, "i");
  const nextHeadingRe = /^##+\s+/;
  const collected = [];
  let inSection = false;
  for (const line of lines) {
    if (headingRe.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && nextHeadingRe.test(line)) break;
    if (inSection) collected.push(line);
  }
  return collected.join("\n").trim() || null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(s) {
  if (!s) return null;
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ─── Slice-task merge ───────────────────────────────────────────────────────

function mergeSlicesWithTasks(slices, taskRows) {
  const warnings = [];
  if (!slices.length) {
    if (taskRows.length) {
      warnings.push(
        "tasks.md has rows but plan.md has no Slices section; tasks dropped."
      );
    }
    return { merged: [], warnings };
  }
  const merged = slices.map((s) => ({ ...s, tasks: [] }));
  for (const row of taskRows) {
    // Slice cell can be "1", "Slice 1", or the slice title
    const idx = matchSliceIndex(row.slice, merged);
    if (idx < 0) {
      warnings.push(
        `tasks.md row ${row.taskId} references unknown slice "${row.slice}"; task skipped.`
      );
      continue;
    }
    merged[idx].tasks.push({
      taskId: row.taskId,
      description: row.description,
      status: row.status,
    });
  }
  return { merged, warnings };
}

function matchSliceIndex(sliceCell, slices) {
  const raw = String(sliceCell).trim();
  // Numeric match
  const numMatch = raw.match(/(\d+)/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= slices.length) return n - 1;
  }
  // Title match (case-insensitive substring)
  const lower = raw.toLowerCase();
  for (let i = 0; i < slices.length; i++) {
    if (slices[i].title.toLowerCase().includes(lower)) return i;
  }
  return -1;
}

// ─── Renderers ──────────────────────────────────────────────────────────────

function _renderBulletList(lines, items) {
  for (const item of items) lines.push(`- ${item}`);
}

function _renderSpecSections(lines, spec) {
  if (spec.goals && spec.goals.length) {
    lines.push("## Goals");
    lines.push("");
    _renderBulletList(lines, spec.goals);
    lines.push("");
  }
  if (spec.acceptance && spec.acceptance.length) {
    lines.push("## Acceptance Criteria");
    lines.push("");
    _renderBulletList(lines, spec.acceptance);
    lines.push("");
  }
  if (spec.outOfScope && spec.outOfScope.length) {
    lines.push("## Out of Scope");
    lines.push("");
    _renderBulletList(lines, spec.outOfScope);
    lines.push("");
  }
}

function _renderSliceBlock(lines, s) {
  lines.push(`### Slice ${s.id} — ${s.title}`);
  if (s.description && s.description !== s.title) {
    lines.push("");
    lines.push(s.description);
  }
  if (s.tasks && s.tasks.length) {
    lines.push("");
    lines.push("**Tasks**:");
    lines.push("");
    for (const t of s.tasks) {
      const mark = t.status === "done" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      lines.push(`- ${mark} \`${t.taskId}\` ${t.description}`);
    }
  }
  lines.push("");
  lines.push("**Validation gate** (placeholder — Hardener must replace):");
  lines.push("");
  lines.push("```bash");
  lines.push(`bash -c "echo 'TODO: gate for slice ${s.id}'"`);
  lines.push("```");
  lines.push("");
}

function _renderSlicePlan(lines, slicesMerged) {
  lines.push("## Slice Plan");
  lines.push("");
  lines.push("> **Note for Hardener**: Each slice below was imported from a Spec Kit `plan.md` entry. Validation gates are placeholders — Step 2 must replace them with real gates that match Plan Forge gate-portability rules.");
  lines.push("");
  if (!slicesMerged.length) {
    lines.push("_(no slices in source plan.md — Hardener must define them)_");
    lines.push("");
    return;
  }
  for (const s of slicesMerged) _renderSliceBlock(lines, s);
}

function _renderConstitutionSection(lines, constitution) {
  if (!constitution) return;
  if (!(constitution.rules.length || constitution.commitments.length || constitution.boundaries.length)) return;
  lines.push("## Imported Agent Constraints (from constitution.md)");
  lines.push("");
  if (constitution.rules.length) {
    lines.push("### Rules");
    lines.push("");
    _renderBulletList(lines, constitution.rules);
    lines.push("");
  }
  if (constitution.commitments.length) {
    lines.push("### Commitments");
    lines.push("");
    _renderBulletList(lines, constitution.commitments);
    lines.push("");
  }
  if (constitution.boundaries.length) {
    lines.push("### Boundaries");
    lines.push("");
    _renderBulletList(lines, constitution.boundaries);
    lines.push("");
  }
  lines.push("> If you also have `docs/plans/PROJECT-PRINCIPLES.md`, the rules above are advisory and PROJECT-PRINCIPLES wins on conflict.");
  lines.push("");
}

function renderPhasePlan({ crucibleId, phaseName, spec, plan, slicesMerged, constitution }) {
  const lines = [];
  lines.push("---");
  lines.push(`crucibleId: ${crucibleId}`);
  lines.push("lane: full");
  lines.push("source: speckit");
  lines.push("---");
  lines.push("");
  lines.push(`# ${phaseName}: ${spec.title}`);
  lines.push("");
  lines.push("> **Source**: Imported from Spec Kit via `pforge crucible import --from=spec-kit`.");
  lines.push("> **Status**: Drafted (Step 0 equivalent), awaiting Pre-flight (Step 1) + Hardening (Step 2).");
  lines.push("");
  lines.push("## Specification Source");
  lines.push("");
  lines.push("- Imported from: Spec Kit");
  if (spec.title) lines.push(`- Spec title: ${spec.title}`);
  lines.push(`- Importer: pforge crucible import (Phase CRUCIBLE-IMPORT-CLI)`);
  lines.push("");

  _renderSpecSections(lines, spec);

  lines.push("## Scope Contract");
  lines.push("");
  lines.push(plan.scope || "_(scope not provided in source plan.md)_");
  lines.push("");

  if (plan.forbiddenActions && plan.forbiddenActions.length) {
    lines.push("### Forbidden Actions");
    lines.push("");
    for (const f of plan.forbiddenActions) lines.push(`- ❌ ${f}`);
    lines.push("");
  }

  _renderSlicePlan(lines, slicesMerged);
  _renderConstitutionSection(lines, constitution);

  return lines.join("\n");
}

function renderPrinciples(constitution) {
  const lines = [];
  lines.push("# Project Principles");
  lines.push("");
  lines.push("> Imported from Spec Kit `constitution.md` via `pforge crucible import --sync-principles`.");
  lines.push("");
  if (constitution.rules.length) {
    lines.push("## Rules (Non-Negotiable)");
    lines.push("");
    for (const r of constitution.rules) lines.push(`- ${r}`);
    lines.push("");
  }
  if (constitution.commitments.length) {
    lines.push("## Commitments");
    lines.push("");
    for (const c of constitution.commitments) lines.push(`- ${c}`);
    lines.push("");
  }
  if (constitution.boundaries.length) {
    lines.push("## Boundaries");
    lines.push("");
    for (const b of constitution.boundaries) lines.push(`- ${b}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Smelt browser (used by `pforge crucible status`) ───────────────────────

/**
 * List smelts under `.forge/crucible/`. Returns a thin summary array.
 *
 * @param {string} projectRoot
 * @returns {{ smelts: Array<{id:string, source:string, status:string, createdAt:string, planTitle?:string}> }}
 */
export function listSmelts(projectRoot) {
  const dir = join(resolve(projectRoot), ".forge", "crucible");
  if (!existsSync(dir)) return { smelts: [] };
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "config.json" || f === "phase-claims.json") continue;
    try {
      const obj = JSON.parse(readFileSync(join(dir, f), "utf-8"));
      out.push({
        id: obj.id || basename(f, ".json"),
        source: obj.source || "unknown",
        status: obj.status || "unknown",
        createdAt: obj.createdAt || null,
        planTitle: obj["plan-title"] || obj.rawIdea || null,
      });
    } catch {
      // Skip malformed
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { smelts: out };
}

/**
 * Return the full smelt JSON for a given id, or `null` if not found.
 *
 * @param {string} projectRoot
 * @param {string} smeltId
 */
export function getSmelt(projectRoot, smeltId) {
  const dir = join(resolve(projectRoot), ".forge", "crucible");
  const path = join(dir, `${smeltId}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

/**
 * CLI entrypoint. Invoked by pforge.ps1 / pforge.sh as:
 *   node pforge-mcp/crucible-import.mjs <subcommand> [options]
 *
 * Subcommands:
 *   import   --from=spec-kit [--dir <path>] [--dry-run] [--sync-principles] [--name <slug>] [--json] [--project <root>]
 *   status   [<smeltId>] [--json] [--project <root>]
 *
 * Exit codes:
 *   0   success
 *   1   import returned ok:false, smelt not found, or unexpected error
 *   2   invalid arguments
 */
function main(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    printHelp();
    return 0;
  }

  if (sub === "import") return cliImport(rest);
  if (sub === "status") return cliStatus(rest);

  process.stderr.write(`pforge crucible: unknown subcommand '${sub}'\n`);
  printHelp(process.stderr);
  return 2;
}

function cliImport(argv) {
  const args = parseImportArgs(argv);
  if (args.error) {
    process.stderr.write(`pforge crucible import: ${args.error}\n`);
    return 2;
  }
  if (args.from !== "spec-kit") {
    process.stderr.write(
      `pforge crucible import: --from=${args.from} not supported. Currently supported: spec-kit.\n`
    );
    return 2;
  }
  const result = importSpeckit({
    projectRoot: args.project,
    dir: args.dir,
    dryRun: args.dryRun,
    syncPrinciples: args.syncPrinciples,
    name: args.name,
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    renderImportHuman(result);
  }
  return result.ok ? 0 : 1;
}

function cliStatus(argv) {
  const args = parseStatusArgs(argv);
  if (args.error) {
    process.stderr.write(`pforge crucible status: ${args.error}\n`);
    return 2;
  }
  if (args.smeltId) {
    const smelt = getSmelt(args.project, args.smeltId);
    if (!smelt) {
      if (args.json) process.stdout.write(JSON.stringify({ ok: false, error: ERROR_CODES.SMELT_NOT_FOUND.code, smeltId: args.smeltId }) + "\n");
      else process.stderr.write(`pforge crucible status: smelt not found: ${args.smeltId}\n`);
      return 1;
    }
    if (args.json) process.stdout.write(JSON.stringify(smelt, null, 2) + "\n");
    else renderSmeltDetail(smelt);
    return 0;
  }
  const list = listSmelts(args.project);
  if (args.json) process.stdout.write(JSON.stringify(list, null, 2) + "\n");
  else renderSmeltList(list);
  return 0;
}

function parseImportArgs(argv) {
  const out = {
    project: process.cwd(),
    from: null,
    dir: null,
    dryRun: false,
    syncPrinciples: false,
    name: null,
    json: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from = argv[++i];
    else if (a.startsWith("--from=")) out.from = a.slice("--from=".length);
    else if (a === "--dir") out.dir = argv[++i];
    else if (a.startsWith("--dir=")) out.dir = a.slice("--dir=".length);
    else if (a === "--name") out.name = argv[++i];
    else if (a.startsWith("--name=")) out.name = a.slice("--name=".length);
    else if (a === "--project") out.project = argv[++i];
    else if (a.startsWith("--project=")) out.project = a.slice("--project=".length);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--sync-principles") out.syncPrinciples = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") { out.error = "see `pforge crucible --help`"; return out; }
    else { out.error = `unknown argument: ${a}`; return out; }
  }
  if (!out.from) { out.error = "missing required --from=<source> (e.g. --from=spec-kit)"; }
  return out;
}

function parseStatusArgs(argv) {
  const out = { project: process.cwd(), smeltId: null, json: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") out.project = argv[++i];
    else if (a.startsWith("--project=")) out.project = a.slice("--project=".length);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") { out.error = "see `pforge crucible --help`"; return out; }
    else if (a.startsWith("--")) { out.error = `unknown argument: ${a}`; return out; }
    else if (!out.smeltId) out.smeltId = a;
    else { out.error = `unexpected argument: ${a}`; return out; }
  }
  return out;
}

function renderImportHuman(r) {
  const out = [];
  out.push("");
  out.push("Spec Kit → Crucible import");
  out.push("─".repeat(72));
  if (!r.ok) {
    out.push(`  ✗ FAILED — ${r.error || "unknown error"}`);
    for (const w of r.warnings) out.push(`    • ${w}`);
    if (r.missingFields.length) {
      out.push("");
      out.push("  Missing fields:");
      for (const m of r.missingFields) {
        const sev = m.severity === "error" ? "✗" : "⚠";
        out.push(`    ${sev} ${m.file} :: ${m.field}`);
      }
    }
  } else if (r.dryRun) {
    out.push("  ✓ DRY RUN — would write the following:");
    out.push(`    smelt:   ${r.smeltPath}`);
    out.push(`    plan:    ${r.planPath}`);
    out.push(`    audit:   .forge/crucible/manual-imports.jsonl (append)`);
    out.push("");
    out.push(`  Mapped fields: ${r.mappedFields.length}`);
    for (const m of r.mappedFields) {
      const v = Array.isArray(m.value) ? `[${m.value.length} items]` : truncate(String(m.value), 60);
      out.push(`    • ${m.source.padEnd(36)} → ${m.target.padEnd(20)} ${v}`);
    }
    if (r.missingFields.length) {
      out.push("");
      out.push("  Warnings:");
      for (const m of r.missingFields) out.push(`    ⚠ ${m.file} :: ${m.field} (${m.severity})`);
    }
  } else {
    out.push(`  ✓ Imported smelt ${r.smeltId}`);
    out.push(`    smelt:   ${r.smeltPath}`);
    out.push(`    plan:    ${r.planPath}`);
    out.push(`    fields:  ${r.mappedFields.length} mapped`);
    if (r.warnings.length) {
      out.push("");
      out.push("  Warnings:");
      for (const w of r.warnings) out.push(`    • ${w}`);
    }
    out.push("");
    out.push(`  Next: pforge run-plan "${r.planPath}"`);
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

function renderSmeltList(list) {
  const out = [];
  out.push("");
  out.push(`Crucible smelts (${list.smelts.length})`);
  out.push("─".repeat(72));
  if (!list.smelts.length) {
    out.push("  (none)");
    out.push("");
    out.push("  Hint: `pforge crucible import --from=spec-kit` to import Spec Kit artifacts.");
  } else {
    out.push(`  ${"ID".padEnd(36)}  ${"SOURCE".padEnd(10)}  ${"STATUS".padEnd(12)}  CREATED`);
    for (const s of list.smelts) {
      out.push(
        `  ${s.id.padEnd(36)}  ${String(s.source).padEnd(10)}  ${String(s.status).padEnd(12)}  ${s.createdAt || ""}`
      );
    }
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

function renderSmeltDetail(smelt) {
  const out = [];
  out.push("");
  out.push(`Smelt ${smelt.id}`);
  out.push("─".repeat(72));
  out.push(`  source:    ${smelt.source || "unknown"}`);
  out.push(`  status:    ${smelt.status || "unknown"}`);
  out.push(`  created:   ${smelt.createdAt || ""}`);
  if (smelt["plan-title"]) out.push(`  title:     ${smelt["plan-title"]}`);
  if (Array.isArray(smelt.objectives) && smelt.objectives.length) {
    out.push(`  objectives (${smelt.objectives.length}):`);
    for (const o of smelt.objectives) out.push(`    • ${o}`);
  }
  if (Array.isArray(smelt.slices) && smelt.slices.length) {
    out.push(`  slices (${smelt.slices.length}):`);
    for (const s of smelt.slices) out.push(`    ${s.id}. ${s.title}`);
  }
  out.push("");
  process.stdout.write(out.join("\n") + "\n");
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function printHelp(stream = process.stdout) {
  stream.write(
`Usage: node crucible-import.mjs <subcommand> [options]

Subcommands:
  import --from=spec-kit [options]   Import Spec Kit artifacts into a Crucible smelt
  status [<smeltId>] [options]       List smelts, or show one in detail

Import options:
  --from=<source>      Required. Currently supported: spec-kit
  --dir <path>         Override scan directory (default: scan specs/, memory/, .speckit/, .)
  --dry-run            Validate and map without writing files
  --sync-principles    Also write docs/plans/PROJECT-PRINCIPLES.md from constitution.md
  --name <slug>        Override the slugified plan name
  --project <dir>      Project root (default: cwd)
  --json               Emit structured JSON to stdout

Status options:
  <smeltId>            Optional smelt id to show in detail
  --project <dir>      Project root (default: cwd)
  --json               Emit structured JSON to stdout

Exit codes:
  0   success
  1   import returned ok:false, smelt not found, or unexpected error
  2   invalid arguments
`
  );
}

// Run CLI when invoked directly (not when imported).
const entryPath = typeof process.argv[1] === "string" ? process.argv[1] : "";
const invokedDirectly =
  entryPath.length > 0 &&
  (import.meta.url === `file://${entryPath.replace(/\\/g, "/")}` ||
    import.meta.url.endsWith(entryPath.replace(/\\/g, "/")));
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
