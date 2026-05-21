/**
 * Plan Forge — Crucible core/finalize (Phase-59 Slice 3 extraction).
 *
 * Owns the finalization contract: critical-field refusal, file-write guard,
 * frontmatter assembly, and handleFinalize. crucible-server.mjs now re-exports
 * from here for backwards compatibility.
 *
 * Import direction (no circular risk):
 *   finalize.mjs → crucible-store, crucible-draft, crucible, crucible-infer,
 *                   crucible/registry, enums (all leaf-direction)
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { ERROR_CODES } from "../../enums.mjs";
import { inferRepoCommands } from "../../crucible-infer.mjs";
import {
  claimPhaseNumber,
  isValidPhaseName,
  listClaims,
  nextPhaseNumber,
} from "../../crucible.mjs";
import { loadSmelt, updateSmelt } from "../../crucible-store.mjs";
import { renderDraft, extractUnresolvedFields } from "../../crucible-draft.mjs";
import { getMode } from "../registry.mjs";

// ─── Critical fields ─────────────────────────────────────────────────

/**
 * Global fallback critical fields. Per-mode mode.criticalFields takes
 * precedence when a mode is registered for the smelt's lane.
 */
export const CRITICAL_FIELDS = new Set([
  "scope-in",
  "scope-files",
  "validation-gates",
  "validation",
  "forbidden-actions",
  // Issue #118: build/test commands are required to make a slice executable.
  "build-command",
  "test-command",
]);

/**
 * Resolve critical fields for a mode. Per-mode mode.criticalFields takes
 * precedence over the global CRITICAL_FIELDS fallback.
 *
 * @param {import('../mode.mjs').CrucibleMode|null|undefined} mode
 * @returns {Set<string>}
 */
export function resolveCriticalFields(mode) {
  if (mode && mode.criticalFields instanceof Set) return mode.criticalFields;
  return CRITICAL_FIELDS;
}

// ─── Error classes ───────────────────────────────────────────────────

/**
 * Thrown by handleFinalize when the rendered draft still contains unresolved
 * markers for fields that are required before a plan can be executed.
 *
 * `payload.criticalGaps` lists the question IDs that must be answered.
 */
export class CrucibleFinalizeRefusedError extends Error {
  constructor(payload) {
    super(payload.hint || "finalize refused");
    this.name = "CrucibleFinalizeRefusedError";
    this.payload = payload;
  }
}

/**
 * Issue #137 — thrown by handleFinalize when `docs/plans/Phase-NN.md` already
 * exists and the caller did not pass `overwrite: true`.
 */
export class CruciblePlanExistsError extends Error {
  constructor({ phaseName, planPath, draftPath }) {
    super(`Plan already exists at ${planPath}. Pass overwrite:true to replace, or use the side-by-side draft at ${draftPath}.`);
    this.name = "CruciblePlanExistsError";
    this.code = ERROR_CODES.PLAN_ALREADY_EXISTS.code;
    this.phaseName = phaseName;
    this.planPath = planPath;
    this.draftPath = draftPath;
  }
}

/**
 * Issue #138 — thrown by handleAsk when the client supplies an explicit `id`
 * that does not match the question the server has pending.
 */
export class CrucibleAskMismatchError extends Error {
  constructor({ expected, got }) {
    super(`Question id mismatch: server expected '${expected}' but client sent '${got}'. Re-fetch the next question and retry.`);
    this.name = "CrucibleAskMismatchError";
    this.code = ERROR_CODES.ASK_QUESTION_MISMATCH.code;
    this.expected = expected;
    this.got = got;
  }
}

// ─── Frontmatter assembly ─────────────────────────────────────────────

/**
 * Build the YAML frontmatter block for a finalized plan.
 *
 * Keys always emitted: crucibleId, lane, source, phaseId.
 * Keys emitted when present: linkedBugs (array), bugId (string).
 *
 * linkedBugs is assembled from:
 *   1. smelt.bugId (the submit-time bug id, if any)
 *   2. the smelt's 'linked-bugs' answer (comma- or newline-separated)
 *   Values are deduplicated, preserving order.
 *
 * @param {object} smelt
 * @param {string} phaseName
 * @returns {string} YAML frontmatter block (ends with two newlines)
 */
export function buildFrontmatter(smelt, phaseName) {
  const lines = [
    `crucibleId: ${smelt.id}`,
    `lane: ${smelt.lane}`,
    `source: ${smelt.source}`,
    `phaseId: ${phaseName}`,
  ];

  const linkedBugs = [];
  if (smelt.bugId && typeof smelt.bugId === "string") {
    linkedBugs.push(smelt.bugId.trim());
  }
  const linkedBugsAnswer = (smelt.answers || []).find((a) => a.questionId === "linked-bugs");
  if (linkedBugsAnswer && typeof linkedBugsAnswer.answer === "string") {
    const extra = linkedBugsAnswer.answer
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const b of extra) {
      if (!linkedBugs.includes(b)) linkedBugs.push(b);
    }
  }

  if (linkedBugs.length > 0) {
    lines.push(`linkedBugs: [${linkedBugs.join(", ")}]`);
  }
  if (smelt.bugId && typeof smelt.bugId === "string") {
    lines.push(`bugId: ${smelt.bugId.trim()}`);
  }

  return `---\n${lines.join("\n")}\n---\n\n`;
}

// ─── Phase-number discovery ──────────────────────────────────────────

/**
 * Collect existing decimal-style phase names from active claims and plan files.
 * @param {string} projectDir
 * @returns {string[]}
 */
export function collectExistingPhaseNames(projectDir) {
  const names = new Set();
  for (const c of listClaims(projectDir)) {
    if (isValidPhaseName(c.phaseName)) names.add(c.phaseName);
  }
  const plansDir = resolve(projectDir, "docs", "plans");
  try {
    for (const entry of readdirSync(plansDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".md")) continue;
      const base = entry.name.replace(/\.md$/, "");
      if (isValidPhaseName(base)) names.add(base);
    }
  } catch { /* plans dir may not exist yet */ }
  return [...names];
}

// ─── Hub event helper (finalize-scoped) ─────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── handleFinalize ──────────────────────────────────────────────────

/**
 * forge_crucible_finalize
 *
 * @param {object} params
 * @param {string} params.id
 * @param {string} params.projectDir
 * @param {object} [params.hub]
 * @param {boolean} [params.overwrite=false]
 */
export function handleFinalize({ id, projectDir, hub, overwrite = false }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot finalize`);
  }

  const previewBody = renderDraft(smelt, { cwd: projectDir });
  const allUnresolved = extractUnresolvedFields(previewBody);
  let modeCriticalFields = CRITICAL_FIELDS;
  try { modeCriticalFields = getMode(smelt.lane).criticalFields || CRITICAL_FIELDS; } catch { /* unregistered lane */ }
  const criticalGaps = allUnresolved.filter((f) => modeCriticalFields.has(f));

  if (criticalGaps.length > 0) {
    throw new CrucibleFinalizeRefusedError({
      id,
      criticalGaps,
      hint: "Run forge_crucible_ask with these question IDs to fill the gaps before finalizing.",
    });
  }

  const existing = collectExistingPhaseNames(projectDir);
  const phaseName = nextPhaseNumber(existing);

  const planDir = resolve(projectDir, "docs", "plans");
  mkdirSync(planDir, { recursive: true });
  const planPath = join(planDir, `${phaseName}.md`);

  const bodySmelt = { ...smelt, phaseName };
  const frontmatter = buildFrontmatter(bodySmelt, phaseName);
  const body = renderDraft(bodySmelt, { cwd: projectDir });
  const markdown = frontmatter + body;

  const planExists = existsSync(planPath);
  let planFileExistedAndNonEmpty = false;
  if (planExists) {
    try {
      const stat = statSync(planPath);
      planFileExistedAndNonEmpty = stat.size > 0;
    } catch { /* treat unreadable as non-existent */ }
  }

  if (planFileExistedAndNonEmpty && !overwrite) {
    const draftPath = join(planDir, `${phaseName}.crucible-draft.md`);
    writeFileSync(draftPath, markdown, "utf-8");
    throw new CruciblePlanExistsError({ phaseName, planPath, draftPath });
  }

  claimPhaseNumber(projectDir, phaseName, id);
  writeFileSync(planPath, markdown, "utf-8");

  updateSmelt(id, { phaseName, status: "finalized", draftMarkdown: markdown }, projectDir);

  emit(hub, "crucible-smelt-finalized", { id, phaseName, planPath });
  emit(hub, "crucible-handoff-to-hardener", {
    id,
    phaseName,
    planPath,
    nextStep: "step2-harden-plan.prompt.md",
  });

  const inferred = inferRepoCommands(projectDir);
  const unresolvedFields = allUnresolved.filter((f) => !modeCriticalFields.has(f));

  return {
    phaseName,
    planPath,
    unresolvedFields,
    inferred,
    hardenerInvoked: false,
    hardenerHandoff: {
      event: "crucible-handoff-to-hardener",
      nextStep: "step2-harden-plan.prompt.md",
      hint: "Run `/step2-harden-plan` against this plan, or attach it to the Plan Hardener agent.",
    },
  };
}

// ─── Re-export unused import workaround ──────────────────────────────
// (listSmelts/readdirSync not needed; import only what handleFinalize uses)
