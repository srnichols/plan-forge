/**
 * Plan Forge — Crucible MCP handlers + lane inference.
 *
 * Pure module used by server.mjs to dispatch the six crucible tools.
 * Keeps server.mjs slim and makes handlers unit-testable without MCP plumbing.
 *
 * Slice 01.2 added: lane inference, submit/ask/preview/finalize/list/abandon,
 *                   three hub events (crucible-smelt-started/updated/finalized).
 * Slice 01.3 added: real interview engine (crucible-interview.mjs) and
 *                   six-block draft renderer (crucible-draft.mjs). The
 *                   Slice-2 stubs `getNextQuestion`/`renderDraftStub` are
 *                   replaced with real implementations re-exported here
 *                   for backwards-compatible imports in tests.
 * Phase-59 S3: handleFinalize, error classes, CRITICAL_FIELDS extracted to
 *              crucible/core/finalize.mjs. Re-exported here for backwards compat.
 */

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { loadCrucibleConfig } from "./crucible-config.mjs";
import {
  abandonSmelt,
  createSmelt,
  listSmelts,
  loadSmelt,
  updateSmelt,
} from "./crucible-store.mjs";
import {
  getNextQuestion as interviewGetNextQuestion,
  totalQuestions as interviewTotalQuestions,
} from "./crucible-interview.mjs";
import {
  renderDraft,
  extractUnresolvedFields,
} from "./crucible-draft.mjs";

// Phase-59 Slice 3 — finalization logic lives in crucible/core/finalize.mjs.
// Re-export for backwards compat; crucible-server callers continue to work.
import {
  CRITICAL_FIELDS,
  CrucibleFinalizeRefusedError,
  CruciblePlanExistsError,
  CrucibleAskMismatchError,
  handleFinalize,
  buildFrontmatter,
  collectExistingPhaseNames,
  resolveCriticalFields,
} from "./crucible/core/finalize.mjs";
export {
  CRITICAL_FIELDS,
  CrucibleFinalizeRefusedError,
  CruciblePlanExistsError,
  CrucibleAskMismatchError,
  handleFinalize,
  buildFrontmatter,
  collectExistingPhaseNames,
  resolveCriticalFields,
};

// Phase-59 Slice 2+4 — register the canonical lanes as CrucibleMode descriptors.
import "./crucible/modes/tweak.mjs";
import "./crucible/modes/feature.mjs";
import "./crucible/modes/full.mjs";
import "./crucible/modes/bug-batch.mjs";

/**
 * Compute "stale defaults" warnings for a smelt. Fires when the files
 * the recommendation engine reads (Project Principles, project profile)
 * are newer than the smelt's own updatedAt by more than the configured
 * threshold — which means the smelt's pre-filled defaults may reflect
 * out-of-date project state.
 *
 * @param {object} smelt
 * @param {string} projectDir
 * @returns {Array<{code: string, message: string, file: string, mtime: string}>}
 */
export function computeStaleDefaultsWarnings(smelt, projectDir) {
  if (!smelt || !smelt.updatedAt) return [];
  const cfg = loadCrucibleConfig(projectDir);
  const thresholdMs = Math.max(1, cfg.staleDefaultsHours) * 60 * 60 * 1000;
  const smeltTs = Date.parse(smelt.updatedAt);
  if (!Number.isFinite(smeltTs)) return [];

  const candidates = [
    { path: "docs/plans/PROJECT-PRINCIPLES.md", code: "STALE_PRINCIPLES" },
    { path: ".github/instructions/project-profile.instructions.md", code: "STALE_PROFILE" },
  ];
  const warnings = [];
  for (const c of candidates) {
    const abs = resolve(projectDir, c.path);
    if (!existsSync(abs)) continue;
    let stat;
    try { stat = statSync(abs); } catch { continue; }
    const fileTs = stat.mtime.getTime();
    if (fileTs - smeltTs <= thresholdMs) continue;
    const hoursAhead = Math.round((fileTs - smeltTs) / (60 * 60 * 1000));
    warnings.push({
      code: c.code,
      message: `${c.path} was updated ${hoursAhead}h after this smelt started — recommended defaults may be out of date.`,
      file: c.path,
      mtime: stat.mtime.toISOString(),
    });
  }
  return warnings;
}

// ─── Lane inference ──────────────────────────────────────────────────

// Keyword order: FULL wins over FEATURE wins over TWEAK so that a phrase
// like "add new phase" (contains both "add" and "new phase") routes to
// "full" instead of "feature".
const FULL_PATTERNS = /\b(new phase|major (rewrite|overhaul|redesign)|redesign|overhaul|rearchitect|migrate (to|from))\b/i;
const FEATURE_PATTERNS = /\b(add|implement|support|enable|introduce)\b/i;
const TWEAK_PATTERNS = /\b(typo|rename|bump|config|hotfix|tweak|adjust|patch)\b/i;

/**
 * Infer the recommended lane for a raw idea.
 * @param {string} rawIdea
 * @returns {"tweak"|"feature"|"full"}
 */
export function inferLane(rawIdea) {
  if (typeof rawIdea !== "string") return "feature";
  const s = rawIdea.trim();
  if (!s) return "feature";
  if (FULL_PATTERNS.test(s)) return "full";
  if (FEATURE_PATTERNS.test(s)) return "feature";
  if (TWEAK_PATTERNS.test(s)) return "tweak";
  return "feature";
}

// ─── Interview (Slice 01.3 — real engine) ────────────────────────────

/**
 * Return the next unanswered question for a smelt, or null if done.
 * Thin wrapper so existing callers keep importing from crucible-server.
 * @param {object} smelt
 * @param {{projectDir?: string}} [context]
 */
export function getNextQuestion(smelt, context = {}) {
  return interviewGetNextQuestion(smelt, context);
}

/**
 * Slice-01.2 compatibility alias — was the stub draft renderer, now
 * just delegates to renderDraft. Kept for legacy imports until callers
 * are migrated.
 * @deprecated use renderDraft from crucible-draft.mjs
 */
export function renderDraftStub(smelt) {
  return renderDraft(smelt);
}

// Re-export the real renderer for convenience.
export { renderDraft, extractUnresolvedFields };

// ─── Hub event helper ────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Handlers ────────────────────────────────────────────────────────

/**
 * forge_crucible_submit
 *
 * Phase-59 S3: accepts optional `bugId` — stored on the smelt for use in
 * frontmatter (linkedBugs/bugId fields) and as the linked-bugs question default.
 */
export function handleSubmit({ rawIdea, lane, source, parentSmeltId, bugId, projectDir, hub }) {
  if (typeof rawIdea !== "string" || !rawIdea.trim()) {
    throw new Error("rawIdea is required");
  }
  const recommendedLane = inferLane(rawIdea);
  let smelt = createSmelt({
    lane: lane || recommendedLane,
    rawIdea,
    source: source || "human",
    parentSmeltId: parentSmeltId || null,
    projectDir,
  });
  if (bugId && typeof bugId === "string" && bugId.trim()) {
    smelt = updateSmelt(smelt.id, { bugId: bugId.trim() }, projectDir);
  }
  emit(hub, "crucible-smelt-started", {
    id: smelt.id,
    lane: smelt.lane,
    source: smelt.source,
    totalQuestions: interviewTotalQuestions(smelt.lane),
  });
  return {
    id: smelt.id,
    recommendedLane,
    firstQuestion: interviewGetNextQuestion(smelt, { projectDir }),
  };
}

/**
 * forge_crucible_ask
 *
 * The caller sends the answer to whatever question was last returned by
 * getNextQuestion. We look up that "pending" question on the server so
 * the questionId recorded in the smelt matches the bank id exactly —
 * not a client-supplied string — and so the interview cannot record
 * answers for nonexistent questions.
 */
export function handleAsk({ id, answer, questionId, projectDir, hub }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot continue interview`);
  }

  let current = smelt;
  const pending = interviewGetNextQuestion(smelt, { projectDir });

  // Issue #138 — if the caller supplied a `questionId` (the schema field
  // formerly mistaken for the smelt `id`), validate it matches the pending
  // question. Refuse mismatched answers so a confused client can't silently
  // record the wrong answer against the wrong question.
  if (typeof questionId === "string" && questionId.length > 0 && pending && questionId !== pending.id) {
    throw new CrucibleAskMismatchError({ expected: pending.id, got: questionId });
  }

  if (answer !== undefined && answer !== null && `${answer}`.length > 0 && pending) {
    const patch = {
      answers: [
        ...smelt.answers,
        { questionId: pending.id, answer: String(answer), recordedAt: new Date().toISOString() },
      ],
    };
    current = updateSmelt(id, patch, projectDir);
    emit(hub, "crucible-smelt-updated", {
      id: current.id,
      questionIndex: current.answers.length,
      totalQuestions: interviewTotalQuestions(current.lane),
    });
  }

  const nextQuestion = interviewGetNextQuestion(current, { projectDir });
  const markdown = renderDraft(current);
  return {
    done: nextQuestion === null,
    nextQuestion,
    draftPreview: markdown,
    warnings: computeStaleDefaultsWarnings(current, projectDir),
  };
}

/**
 * forge_crucible_preview
 */
export function handlePreview({ id, projectDir }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  const markdown = renderDraft(smelt);
  return {
    markdown,
    phaseName: smelt.phaseName,
    unresolvedFields: extractUnresolvedFields(markdown),
  };
}

/**
 * forge_crucible_list
 */
export function handleList({ status, projectDir }) {
  return { smelts: listSmelts(projectDir, status ? { status } : {}) };
}

/**
 * forge_crucible_abandon
 */
export function handleAbandon({ id, projectDir }) {
  return abandonSmelt(id, projectDir);
}
