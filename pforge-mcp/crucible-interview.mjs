/**
 * Plan Forge — Crucible Interview Engine (Slice 01.3).
 *
 * Lane-scoped question banks plus a strict recommended-default resolver
 * that refuses to fabricate answers when memory yields nothing.
 *
 * Sources consulted (in order) for recommended defaults:
 *   1. `docs/plans/PROJECT-PRINCIPLES.md` — project-specific commitments
 *   2. `docs/plans/Phase-*.md`             — conventions from prior phases
 *   3. `null`                              — explicit "no default" sentinel
 *
 * Design Commitment #3 of Phase-CRUCIBLE-01:
 *   "No defaults = no question (leave blank, don't fabricate)."
 *
 * Callers MUST treat `recommendedDefault === null` as "unknown — ask the
 * human" and MUST NOT substitute boilerplate.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

// ─── Question banks ──────────────────────────────────────────────────
// Shape of each question:
//   { id, prompt, required, defaultSource? }
// defaultSource is a hint for buildRecommendedDefault — the resolver
// maps source keys to lookup strategies.

export const TWEAK_QUESTIONS = Object.freeze([
  Object.freeze({
    id: "scope-file",
    prompt: "Which file(s) will this change touch? List paths.",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "validation",
    prompt: "How will we verify the fix works? Give the exact build/test command.",
    required: true,
    defaultSource: "validation-gate",
  }),
  Object.freeze({
    id: "rollback",
    prompt: "How do we roll back if this breaks something?",
    required: true,
    defaultSource: null,
  }),
]);

export const FEATURE_QUESTIONS = Object.freeze([
  Object.freeze({
    id: "goal",
    prompt: "What user-visible outcome does this feature produce?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "scope-files",
    prompt: "Which files/modules are in scope?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "out-of-scope",
    prompt: "What is explicitly out of scope for this phase?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "tests",
    prompt: "What tests prove the feature works? Name the test files or suites.",
    required: true,
    defaultSource: "test-framework",
  }),
  Object.freeze({
    id: "validation-gates",
    prompt: "Which build/test commands gate completion of each slice?",
    required: true,
    defaultSource: "validation-gate",
  }),
  Object.freeze({
    id: "rollback",
    prompt: "How do we roll this feature back cleanly if issues surface post-ship?",
    required: true,
    defaultSource: null,
  }),
]);

export const FULL_QUESTIONS = Object.freeze([
  Object.freeze({
    id: "feature-name",
    prompt: "Name this phase (short, imperative, no marketing fluff).",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "user-problem",
    prompt: "What concrete user or operator problem does this solve?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "success-metric",
    prompt: "How will we measure that the phase succeeded?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "stack-boundary",
    prompt: "What language / framework boundaries apply? (no off-stack work)",
    required: true,
    defaultSource: "stack",
  }),
  Object.freeze({
    id: "data-model",
    prompt: "What new data models, tables, or schema changes are required?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "api-surface",
    prompt: "What new APIs, CLI flags, MCP tools, or events will this expose?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "security-posture",
    prompt: "Security posture — any new secrets, permissions, or attack surface?",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "scope-in",
    prompt: "Scope Contract — what IS in scope for this phase? (bullet list)",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "scope-out",
    prompt: "Scope Contract — what is OUT of scope? (bullet list)",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "forbidden-actions",
    prompt: "Forbidden actions — paths, patterns, or behaviours that MUST NOT be introduced.",
    required: true,
    defaultSource: null,
  }),
  Object.freeze({
    id: "slice-count",
    prompt: "Estimated number of slices (<=6 preferred; split larger phases).",
    required: true,
    defaultSource: "slice-count",
  }),
  Object.freeze({
    id: "rollback-plan",
    prompt: "Rollback plan — exact steps to revert if the phase destabilises main.",
    required: true,
    defaultSource: null,
  }),
]);

/**
 * Return the frozen question bank for a given lane.
 * @param {"tweak"|"feature"|"full"} lane
 * @returns {ReadonlyArray<{id:string,prompt:string,required:boolean,defaultSource:string|null}>}
 */
export function getQuestionBank(lane) {
  if (lane === "tweak") return TWEAK_QUESTIONS;
  if (lane === "full") return FULL_QUESTIONS;
  return FEATURE_QUESTIONS; // default + explicit "feature"
}

/**
 * Total number of questions for a lane (used by the hub updated event).
 * @param {string} lane
 * @returns {number}
 */
export function totalQuestions(lane) {
  return getQuestionBank(lane).length;
}

// ─── Next question ───────────────────────────────────────────────────

/**
 * Return the next unanswered question for a smelt, or null if the
 * interview is complete.
 *
 * Pure on the smelt; reads the filesystem only to resolve recommended
 * defaults (via buildRecommendedDefault).
 *
 * @param {{lane:string, answers:Array<{questionId:string}>}} smelt
 * @param {{projectDir?: string}} [context]
 * @returns {{id:string,prompt:string,required:boolean,recommendedDefault:string|null,questionIndex:number,totalQuestions:number}|null}
 */
export function getNextQuestion(smelt, context = {}) {
  if (!smelt || smelt.status && smelt.status !== "in-progress") return null;
  const bank = getQuestionBank(smelt.lane);
  const answered = new Set((smelt.answers || []).map((a) => a.questionId));
  const idx = bank.findIndex((q) => !answered.has(q.id));
  if (idx === -1) return null;
  const q = bank[idx];
  const recommendedDefault = buildRecommendedDefault(q.id, {
    ...context,
    defaultSource: q.defaultSource,
  });
  return {
    id: q.id,
    prompt: q.prompt,
    required: q.required,
    recommendedDefault, // null = ask human, do NOT fabricate
    questionIndex: idx + 1,
    totalQuestions: bank.length,
  };
}

/**
 * Return a new smelt object with the answer appended. Does not persist.
 * Caller persists via crucible-store's updateSmelt.
 *
 * @param {{answers?:Array}} smelt
 * @param {string} questionId
 * @param {string} answer
 * @returns {object} patched smelt
 */
export function recordAnswer(smelt, questionId, answer) {
  if (!smelt) throw new Error("smelt required");
  if (typeof questionId !== "string" || !questionId) {
    throw new Error("questionId required");
  }
  if (typeof answer !== "string") {
    throw new Error("answer must be a string");
  }
  const entry = {
    questionId,
    answer,
    recordedAt: new Date().toISOString(),
  };
  return { ...smelt, answers: [...(smelt.answers || []), entry] };
}

// ─── Recommended default resolver ────────────────────────────────────

/**
 * Strict resolver — returns a string when a source yields a value,
 * otherwise null. NEVER fabricates.
 *
 * @param {string} questionId
 * @param {{projectDir?:string, defaultSource?:string|null}} context
 * @returns {string|null}
 */
export function buildRecommendedDefault(questionId, context = {}) {
  const { projectDir, defaultSource } = context;
  if (!projectDir || !defaultSource) return null;

  // 1) PROJECT-PRINCIPLES.md (primary source)
  const fromPrinciples = readFromPrinciples(projectDir, defaultSource);
  if (fromPrinciples) return fromPrinciples;

  // 2) Existing plan conventions (secondary)
  const fromPlans = readFromPlans(projectDir, defaultSource);
  if (fromPlans) return fromPlans;

  // 3) Nothing found — explicit null (no fabrication)
  return null;
}

function readFromPrinciples(projectDir, defaultSource) {
  const candidates = [
    resolve(projectDir, "docs", "plans", "PROJECT-PRINCIPLES.md"),
    resolve(projectDir, "PROJECT-PRINCIPLES.md"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let text;
    try { text = readFileSync(path, "utf-8"); } catch { continue; }
    const value = extractPrincipleValue(text, defaultSource);
    if (value) return value;
  }
  return null;
}

/**
 * Extract a value matching defaultSource from a PROJECT-PRINCIPLES.md body.
 * Conservative — only returns a value when the principles file is
 * unambiguous. Returns null for anything uncertain.
 */
function extractPrincipleValue(text, defaultSource) {
  if (defaultSource === "validation-gate") {
    // Look for a fenced code block preceded by a "validation" / "build" / "test" heading
    const m = text.match(/(?:^|\n)#{1,6}\s*(?:validation|build|test)[^\n]*\n+```[\w-]*\n([^\n`]+)\n```/i);
    if (m && m[1]) return m[1].trim();
  }
  if (defaultSource === "test-framework") {
    const m = text.match(/\btest(?:ing)?\s*(?:framework|runner)\s*[:=]\s*([A-Za-z0-9_+\-./ ]+)/i);
    if (m && m[1]) return m[1].trim();
  }
  if (defaultSource === "stack") {
    const m = text.match(/(?:^|\n)#{1,6}\s*(?:stack|technology)[^\n]*\n+([^\n#]+)/i);
    if (m && m[1]) {
      const v = m[1].trim();
      if (v.length > 0 && v.length <= 200) return v;
    }
  }
  if (defaultSource === "slice-count") {
    const m = text.match(/\bmax(?:imum)?\s*slices?\s*[:=]\s*(\d{1,2})\b/i);
    if (m && m[1]) return m[1];
  }
  return null;
}

function readFromPlans(projectDir, defaultSource) {
  const plansDir = resolve(projectDir, "docs", "plans");
  if (!existsSync(plansDir)) return null;
  let files;
  try { files = readdirSync(plansDir); } catch { return null; }
  // Most-recent first by mtime
  const phaseFiles = files
    .filter((f) => /^Phase-.+\.md$/.test(f))
    .map((f) => {
      const p = join(plansDir, f);
      let mtime = 0;
      try { mtime = statSync(p).mtimeMs; } catch { /* ignore */ }
      return { path: p, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 5);

  for (const { path } of phaseFiles) {
    let text;
    try { text = readFileSync(path, "utf-8"); } catch { continue; }
    const value = extractPlanValue(text, defaultSource);
    if (value) return value;
  }
  return null;
}

function extractPlanValue(text, defaultSource) {
  if (defaultSource === "validation-gate") {
    // Pick the first **Validation Gate** / **Test command** code block content
    const m = text.match(/\*\*(?:Validation Gate|Test command|Build command)\*\*[^\n]*\n+```[\w-]*\n([^\n`]+)\n```/i);
    if (m && m[1]) return m[1].trim();
    // Fallback: inline backticks after "Test command:"
    const m2 = text.match(/\*\*Test command\*\*[^`\n]*`([^`\n]+)`/i);
    if (m2 && m2[1]) return m2[1].trim();
  }
  if (defaultSource === "slice-count") {
    // Count "### Slice N" headers in the recent plan
    const matches = text.match(/^###\s+Slice\s+\d/gim);
    if (matches && matches.length > 0) return String(matches.length);
  }
  return null;
}
