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
  buildRecommendedDefault,
  getNextQuestion as interviewGetNextQuestion,
  totalQuestions as interviewTotalQuestions,
} from "./crucible-interview.mjs";
import {
  renderDraft,
  extractUnresolvedFields,
} from "./crucible-draft.mjs";
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
import { getMode } from "./crucible/registry.mjs";

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

/**
 * Return the next unanswered question for a smelt, or null if done.
 * Thin wrapper so existing callers keep importing from crucible-server.
 * @param {object} smelt
 * @param {{projectDir?: string, questionBank?: Array<object>}} [context]
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

export { renderDraft, extractUnresolvedFields };

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

function _getModeBank(smelt) {
  try {
    const mode = getMode(smelt.lane);
    return mode && typeof mode.questionBank === "function" ? mode.questionBank() : null;
  } catch {
    return null;
  }
}

function _questionContext(smelt, projectDir) {
  const questionBank = _getModeBank(smelt);
  return questionBank ? { projectDir, questionBank } : { projectDir };
}

function _applyQuestionDefaults(smelt, question, projectDir) {
  if (!question) return null;
  if (question.id !== "linked-bugs") return question;
  const bugDefault = typeof smelt.bugId === "string" && smelt.bugId.trim() ? smelt.bugId.trim() : null;
  return {
    ...question,
    recommendedDefault: bugDefault
      || buildRecommendedDefault(question.id, { projectDir, defaultSource: null })
      || question.recommendedDefault
      || null,
  };
}

/**
 * forge_crucible_submit
 */
export function handleSubmit({ rawIdea, lane, source, parentSmeltId, bugId, projectDir, hub }) {
  if (typeof rawIdea !== "string" || !rawIdea.trim()) {
    throw new Error("rawIdea is required");
  }
  const recommendedLane = inferLane(rawIdea);
  const smelt = createSmelt({
    lane: lane || recommendedLane,
    rawIdea,
    source: source || "human",
    parentSmeltId: parentSmeltId || null,
    bugId: bugId || null,
    projectDir,
  });
  emit(hub, "crucible-smelt-started", {
    id: smelt.id,
    lane: smelt.lane,
    source: smelt.source,
    totalQuestions: interviewTotalQuestions(smelt.lane),
  });
  return {
    id: smelt.id,
    recommendedLane,
    firstQuestion: _applyQuestionDefaults(
      smelt,
      interviewGetNextQuestion(smelt, _questionContext(smelt, projectDir)),
      projectDir,
    ),
  };
}

/**
 * forge_crucible_ask
 */
export function handleAsk({ id, answer, questionId, projectDir, hub }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot continue interview`);
  }

  let current = smelt;
  const pending = _applyQuestionDefaults(
    smelt,
    interviewGetNextQuestion(smelt, _questionContext(smelt, projectDir)),
    projectDir,
  );

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

  const nextQuestion = _applyQuestionDefaults(
    current,
    interviewGetNextQuestion(current, _questionContext(current, projectDir)),
    projectDir,
  );
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
