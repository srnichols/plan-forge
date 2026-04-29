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

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

import { loadCrucibleConfig } from "./crucible-config.mjs";
import { inferRepoCommands } from "./crucible-infer.mjs";

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

// ─── Finalize refusal ────────────────────────────────────────────────

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
 * Fields whose absence blocks finalization entirely. A plan that still has
 * {{TBD: <any of these>}} cannot be executed by the orchestrator.
 */
const CRITICAL_FIELDS = new Set([
  "scope-in",
  "scope-files",
  "validation-gates",
  "validation",
  "forbidden-actions",
]);

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
 * forge_crucible_finalize
 */
export function handleFinalize({ id, projectDir, hub }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot finalize`);
  }

  // Render a preview draft (no phaseName yet) to detect critical TBD gaps
  // before committing to a phase number or writing any file.
  const previewBody = renderDraft(smelt, { cwd: projectDir });
  const allUnresolved = extractUnresolvedFields(previewBody);
  const criticalGaps = allUnresolved.filter((f) => CRITICAL_FIELDS.has(f));

  if (criticalGaps.length > 0) {
    throw new CrucibleFinalizeRefusedError({
      id,
      criticalGaps,
      hint: "Run forge_crucible_ask with these question IDs to fill the gaps before finalizing.",
    });
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
  const body = renderDraft(bodySmelt, { cwd: projectDir });
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

  // v2.37 Slice 01.6 — emit the Hardener handoff event. The dashboard
  // listens for this and shows a "Hardener ready" action; the MCP
  // agent can subscribe and auto-invoke `step2-harden-plan.prompt.md`.
  // We do not block finalize on hardening — the plan is already on
  // disk and enforcement-compatible by virtue of the frontmatter
  // written above.
  emit(hub, "crucible-handoff-to-hardener", {
    id,
    phaseName,
    planPath,
    nextStep: "step2-harden-plan.prompt.md",
  });

  const inferred = inferRepoCommands(projectDir);
  const unresolvedFields = allUnresolved.filter((f) => !CRITICAL_FIELDS.has(f));

  return {
    phaseName,
    planPath,
    unresolvedFields,
    inferred,
    hardenerInvoked: false, // Slice 6 wires the Plan Hardener handoff
    hardenerHandoff: {
      event: "crucible-handoff-to-hardener",
      nextStep: "step2-harden-plan.prompt.md",
      hint: "Run `/step2-harden-plan` against this plan, or attach it to the Plan Hardener agent.",
    },
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
