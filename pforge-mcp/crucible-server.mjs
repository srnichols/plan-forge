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

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

import {
  claimPhaseNumber,
  isValidPhaseName,
  listClaims,
  nextPhaseNumber,
} from "./crucible.mjs";
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

// ─── Phase-number discovery ──────────────────────────────────────────

/**
 * Collect existing decimal-style phase names from:
 *   - active phase-claims.json (in-progress finalizations)
 *   - docs/plans/Phase-*.md file names (already-finalized phases)
 * Non-decimal names (e.g. Phase-CRUCIBLE-01) are ignored — they get
 * grandfathered in Slice 4.
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

// ─── Handlers ────────────────────────────────────────────────────────

/**
 * forge_crucible_submit
 */
export function handleSubmit({ rawIdea, lane, source, parentSmeltId, projectDir, hub }) {
  if (typeof rawIdea !== "string" || !rawIdea.trim()) {
    throw new Error("rawIdea is required");
  }
  const recommendedLane = inferLane(rawIdea);
  const smelt = createSmelt({
    lane: lane || recommendedLane,
    rawIdea,
    source: source || "human",
    parentSmeltId: parentSmeltId || null,
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
export function handleAsk({ id, answer, projectDir, hub }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot continue interview`);
  }

  let current = smelt;
  const pending = interviewGetNextQuestion(smelt, { projectDir });

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
 * forge_crucible_finalize
 */
export function handleFinalize({ id, projectDir, hub }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot finalize`);
  }

  const existing = collectExistingPhaseNames(projectDir);
  const phaseName = nextPhaseNumber(existing);
  claimPhaseNumber(projectDir, phaseName, id);

  const planDir = resolve(projectDir, "docs", "plans");
  mkdirSync(planDir, { recursive: true });
  const planPath = join(planDir, `${phaseName}.md`);

  const frontmatter =
    `---\n` +
    `crucibleId: ${id}\n` +
    `lane: ${smelt.lane}\n` +
    `source: ${smelt.source}\n` +
    `---\n\n`;
  const bodySmelt = { ...smelt, phaseName };
  const body = renderDraft(bodySmelt);
  const markdown = frontmatter + body;
  writeFileSync(planPath, markdown, "utf-8");

  updateSmelt(id, {
    phaseName,
    status: "finalized",
    draftMarkdown: markdown,
  }, projectDir);

  emit(hub, "crucible-smelt-finalized", {
    id,
    phaseName,
    planPath,
  });

  return {
    phaseName,
    planPath,
    hardenerInvoked: false, // Slice 6 wires the Plan Hardener handoff
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
