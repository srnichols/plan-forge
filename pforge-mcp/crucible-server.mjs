/**
 * Plan Forge — Crucible MCP handlers + lane inference.
 *
 * Pure module used by server.mjs to dispatch the six crucible tools.
 * Keeps server.mjs slim and makes handlers unit-testable without MCP plumbing.
 *
 * Slice 01.2 scope:
 *   - inferLane: keyword heuristic for recommended lane
 *   - submit / ask / preview / finalize / list / abandon handlers
 *   - Emits three hub events: crucible-smelt-started/updated/finalized
 *
 * The interview engine and full draft template land in Slice 01.3.
 * Until then, ask() is a no-op shell and preview/finalize render a stub
 * document from the raw idea + any answers supplied.
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

// ─── Interview stub (Slice 3 replaces) ───────────────────────────────

/**
 * Placeholder for the Slice 3 interview engine. Returns null to signal
 * "no more questions" so Slice 2 end-to-end flows terminate cleanly.
 * @returns {null}
 */
export function getNextQuestion(_smelt) {
  return null;
}

/**
 * Render a minimal draft for preview/finalize until Slice 3 ships the
 * proper template. Kept intentionally small so it is unambiguous what
 * Slice 3 will replace.
 */
export function renderDraftStub(smelt) {
  const firstLine = (smelt.rawIdea || "").split("\n")[0].slice(0, 80).trim();
  const title = firstLine || "Untitled smelt";
  const lines = [
    `# ${smelt.phaseName ? `${smelt.phaseName}: ` : ""}${title}`,
    "",
    `> **Lane**: ${smelt.lane}`,
    `> **Source**: ${smelt.source}`,
    `> **Status**: ${smelt.status}`,
    "",
    "## Raw Idea",
    "",
    smelt.rawIdea || "",
  ];
  if (Array.isArray(smelt.answers) && smelt.answers.length > 0) {
    lines.push("", "## Interview Answers", "");
    smelt.answers.forEach((a, i) => {
      lines.push(`${i + 1}. **${a.questionId}**: ${a.answer}`);
    });
  }
  return lines.join("\n") + "\n";
}

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
  });
  return {
    id: smelt.id,
    recommendedLane,
    firstQuestion: getNextQuestion(smelt),
  };
}

/**
 * forge_crucible_ask
 */
export function handleAsk({ id, answer, projectDir, hub }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  if (smelt.status !== "in-progress") {
    throw new Error(`smelt is ${smelt.status}, cannot continue interview`);
  }

  let current = smelt;
  if (answer !== undefined && answer !== null && `${answer}`.length > 0) {
    const questionId = String(smelt.answers.length + 1);
    const patch = {
      answers: [
        ...smelt.answers,
        { questionId, answer: String(answer), recordedAt: new Date().toISOString() },
      ],
    };
    current = updateSmelt(id, patch, projectDir);
    emit(hub, "crucible-smelt-updated", {
      id: current.id,
      questionIndex: current.answers.length,
      totalQuestions: null, // Slice 3 supplies total
    });
  }

  const nextQuestion = getNextQuestion(current);
  return {
    done: nextQuestion === null,
    nextQuestion,
    draftPreview: renderDraftStub(current),
  };
}

/**
 * forge_crucible_preview
 */
export function handlePreview({ id, projectDir }) {
  const smelt = loadSmelt(id, projectDir);
  if (!smelt) throw new Error(`smelt not found: ${id}`);
  return {
    markdown: renderDraftStub(smelt),
    phaseName: smelt.phaseName,
    unresolvedFields: [], // Slice 3 fills in from {{TBD:...}} placeholders
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
  const body = renderDraftStub(bodySmelt);
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
