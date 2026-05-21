/**
 * Plan Forge — Crucible Draft Renderer (Phase-35 Slice 2).
 *
 * Assembles a phase-doc markdown body from a smelt's raw idea + answers.
 * Emits the six mandatory blocks every hardened plan must carry:
 *
 *   1. Slices              — from scope-files / scope-in answers
 *   2. Validation Gates    — from validation / validation-gates answer
 *   3. Stop Conditions     — boilerplate we WILL NOT auto-fill as "answered"
 *   4. Rollback            — from rollback / rollback-plan answer
 *   5. Anti-patterns       — from forbidden-actions answer
 *   6. Change Manifest     — file list derived from scope answers
 *
 * Any field that has no answer yet renders as `{{TBD: <question-id>}}`
 * so `extractUnresolvedFields()` can surface it in the preview.
 *
 * Hard rule: this renderer must NEVER inject plausible-sounding filler
 * in place of a `{{TBD:}}` marker. Slice 01.3 Stop Condition.
 */

import { inferRepoCommands } from "./crucible-infer.mjs";
import { getQuestionBank } from "./crucible-interview.mjs";

const TBD_REGEX = /\{\{TBD:\s*([a-z0-9-]+)\s*\}\}/gi;

/**
 * Return a { questionId -> answer } lookup from a smelt.
 */
function indexAnswers(smelt) {
  const out = {};
  for (const a of (smelt && smelt.answers) || []) {
    if (a && typeof a.questionId === "string") out[a.questionId] = a.answer;
  }
  return out;
}

function firstAnswer(answers, ...keys) {
  for (const k of keys) {
    const v = answers[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Expand an answer into a markdown bullet list. Input may be comma- or
 * newline-separated. If already formatted as a list, return as-is.
 */
function asBulletList(value) {
  if (!value) return null;
  if (/^\s*[-*]\s+/m.test(value)) return value.trim();
  const parts = value
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((p) => `- ${p}`).join("\n");
}

/**
 * Synthesize a concrete Slice 1 markdown block from interview answers and
 * inferred repo commands. Returns `null` when any required prerequisite is
 * missing, so the caller falls back to the generic `> Slice template:` block.
 *
 * Prerequisites:
 *   - `smelt.answers` must contain a non-empty `scope-files` / `scope-in` answer
 *   - `smelt.answers` must contain a non-empty `validation-gates` / `validation` answer
 *   - `repoCommands.buildCommand` and `repoCommands.testCommand` must both be non-null
 *
 * @param {{ smelt: object, repoCommands: object }} params
 * @returns {string|null}
 */
export function synthesizeSliceBlock({ smelt, repoCommands }) {
  if (!smelt || !repoCommands) return null;
  if (!repoCommands.buildCommand || !repoCommands.testCommand) return null;

  const ans = indexAnswers(smelt);

  const scopeRaw = firstAnswer(ans, "scope-files", "scope-file", "scope-in");
  if (!scopeRaw) return null;
  const filesBullet = asBulletList(scopeRaw);
  if (!filesBullet) return null;

  const gatesRaw = firstAnswer(ans, "validation-gates", "validation");
  if (!gatesRaw) return null;
  const gatesLines = gatesRaw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (/^-\s*\[/.test(s)) return s;
      if (/^[-*]\s+/.test(s)) return `- [ ] ${s.replace(/^[-*]\s+/, "")}`;
      return `- [ ] ${s}`;
    });
  if (gatesLines.length === 0) return null;

  const rawIdea = (smelt.rawIdea || "").trim();
  const titleBase =
    firstAnswer(ans, "feature-name") || rawIdea.split(/\r?\n/)[0] || "Untitled";
  const title = titleBase.slice(0, 60);

  return [
    `### Slice 1 — ${title}`,
    "",
    `Build command: ${repoCommands.buildCommand}`,
    `Test command:  ${repoCommands.testCommand}`,
    "",
    "**Files**:",
    filesBullet,
    "",
    "**Acceptance Criteria**:",
    gatesLines.join("\n"),
  ].join("\n");
}

/**
 * Render the phase-doc body for a smelt. Caller prepends the crucibleId
 * frontmatter.
 *
 * @param {{
 *   rawIdea?: string,
 *   lane?: string,
 *   source?: string,
 *   status?: string,
 *   answers?: Array<{questionId:string, answer:string}>,
 *   phaseName?: string|null,
 * }} smelt
 * @param {{ cwd?: string }} [options]
 * @returns {string} markdown body (trailing newline included)
 */
function fallbackField(value, tbdId) {
  return value || `{{TBD: ${tbdId}}}`;
}

function buildDraftContent(ans, lane) {
  const bankIds = new Set(getQuestionBank(lane).map((q) => q.id));

  function maybeField(value, tbdId, ...altIds) {
    const inBank = bankIds.has(tbdId) || altIds.some((id) => bankIds.has(id));
    if (!inBank) return value || null;
    return fallbackField(value, tbdId);
  }

  const scopeInRaw = firstAnswer(ans, "scope-in", "scope-files", "scope-file", "goal");
  return {
    scopeIn: fallbackField(asBulletList(scopeInRaw), lane === "full" ? "scope-in" : "scope-files"),
    outOfScope: maybeField(asBulletList(firstAnswer(ans, "scope-out", "out-of-scope")), "out-of-scope", "scope-out"),
    validationGates: maybeField(firstAnswer(ans, "validation-gates", "validation"), "validation-gates", "validation"),
    rollback: fallbackField(firstAnswer(ans, "rollback-plan", "rollback"), lane === "full" ? "rollback-plan" : "rollback"),
    forbidden: fallbackField(asBulletList(firstAnswer(ans, "forbidden-actions")), "forbidden-actions"),
    tests: maybeField(firstAnswer(ans, "tests"), "tests"),
    changeManifest: fallbackField(asBulletList(firstAnswer(ans, "scope-files", "scope-file", "scope-in")), "change-manifest"),
    sliceCount: firstAnswer(ans, "slice-count"),
  };
}

function appendDraftPreamble(lines, { smelt, lane, title, rawIdea }) {
  lines.push(`# ${smelt.phaseName ? `${smelt.phaseName}: ` : ""}${title}`);
  lines.push("");
  lines.push(`> **Lane**: ${lane}  `);
  lines.push(`> **Source**: ${smelt.source || "human"}  `);
  lines.push(`> **Status**: ${smelt.status || "in-progress"}`);
  lines.push("");
  lines.push("## Raw Idea");
  lines.push("");
  lines.push(rawIdea || `{{TBD: ${lane === "full" ? "user-problem" : "goal"}}}`);
  lines.push("");
}

function appendFullLaneSections(lines, ans) {
  const problem = fallbackField(firstAnswer(ans, "user-problem"), "user-problem");
  const metric = fallbackField(firstAnswer(ans, "success-metric"), "success-metric");
  const stack = fallbackField(firstAnswer(ans, "stack-boundary"), "stack-boundary");
  const dataModel = fallbackField(firstAnswer(ans, "data-model"), "data-model");
  const apiSurface = fallbackField(firstAnswer(ans, "api-surface"), "api-surface");
  const security = fallbackField(firstAnswer(ans, "security-posture"), "security-posture");

  lines.push("## Problem & Success Metric");
  lines.push("");
  lines.push(`**Problem**: ${problem}`);
  lines.push("");
  lines.push(`**Success metric**: ${metric}`);
  lines.push("");
  lines.push("## Stack Boundary");
  lines.push("");
  lines.push(stack);
  lines.push("");
  lines.push("## Data Model");
  lines.push("");
  lines.push(dataModel);
  lines.push("");
  lines.push("## API Surface");
  lines.push("");
  lines.push(apiSurface);
  lines.push("");
  lines.push("## Security Posture");
  lines.push("");
  lines.push(security);
  lines.push("");
}

function appendScopeContract(lines, content) {
  lines.push("## Scope Contract");
  lines.push("");
  lines.push("**In scope**:");
  lines.push("");
  lines.push(content.scopeIn);
  lines.push("");
  if (content.outOfScope !== null && content.outOfScope !== undefined) {
    lines.push("**Out of scope**:");
    lines.push("");
    lines.push(content.outOfScope);
    lines.push("");
  }
}

function appendSliceTemplate(lines) {
  lines.push("> Slice template:");
  lines.push(">");
  lines.push("> ```");
  lines.push("> ### Slice N — <name>");
  lines.push("> Build command: <cmd>");
  lines.push("> Test command:  <cmd>");
  lines.push("> Tasks:         <list>");
  lines.push("> Files:         <manifest>");
  lines.push("> ```");
}

function appendSlicesSection(lines, sliceCount, synthesized) {
  lines.push("## Slices");
  lines.push("");
  lines.push(
    sliceCount
      ? `_Estimated: ${sliceCount} slices. Expand each below during Plan Hardener step._`
      : "_Slice breakdown is authored during the Plan Hardener step (Session 1, Step 2)._"
  );
  lines.push("");
  if (synthesized) lines.push(synthesized);
  else appendSliceTemplate(lines);
  lines.push("");
}

function appendStandardBlocks(lines, content) {
  lines.push("## Validation Gates");
  lines.push("");
  if (content.validationGates) {
    lines.push(content.validationGates);
    lines.push("");
  }
  if (content.tests) {
    lines.push(`**Tests**: ${content.tests}`);
    lines.push("");
  }
  lines.push("## Stop Conditions");
  lines.push("");
  lines.push("- Validation gate fails and root cause is not identified within 30 minutes");
  lines.push("- A slice drifts past its declared Scope Contract");
  lines.push("- A forbidden action (see Anti-patterns) is about to be introduced");
  lines.push("- Token budget for this phase is exceeded by more than 25%");
  lines.push("");
  lines.push("## Rollback");
  lines.push("");
  lines.push(content.rollback);
  lines.push("");
  lines.push("## Anti-patterns & Forbidden Actions");
  lines.push("");
  lines.push(content.forbidden);
  lines.push("");
  lines.push("## Change Manifest");
  lines.push("");
  lines.push(content.changeManifest);
  lines.push("");
}

function appendInterviewLog(lines, answers) {
  if (!Array.isArray(answers) || answers.length === 0) return;
  lines.push("## Interview Log");
  lines.push("");
  answers.forEach((answer, i) => {
    lines.push(`${i + 1}. **${answer.questionId}** — ${answer.answer}`);
  });
  lines.push("");
}

export function renderDraft(smelt, options = {}) {
  if (!smelt) throw new Error("smelt required");
  const cwd = options && options.cwd;
  const ans = indexAnswers(smelt);
  const lane = smelt.lane || "feature";
  const rawIdea = (smelt.rawIdea || "").trim();
  const firstLine = rawIdea.split(/\r?\n/)[0].slice(0, 80).trim();
  const title = firstAnswer(ans, "feature-name") || firstLine || "Untitled smelt";
  const content = buildDraftContent(ans, lane);
  const synthesized = cwd ? synthesizeSliceBlock({ smelt, repoCommands: inferRepoCommands(cwd) }) : null;
  const lines = [];

  appendDraftPreamble(lines, { smelt, lane, title, rawIdea });
  if (lane === "full") appendFullLaneSections(lines, ans);
  appendScopeContract(lines, content);
  appendSlicesSection(lines, content.sliceCount, synthesized);
  appendStandardBlocks(lines, content);
  appendInterviewLog(lines, smelt.answers);

  return lines.join("\n");
}

/**
 * Extract the set of unresolved `{{TBD: question-id}}` markers from a
 * rendered markdown body. Returns an ordered, de-duplicated array of
 * question ids.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractUnresolvedFields(markdown) {
  if (typeof markdown !== "string") return [];
  const seen = new Set();
  const out = [];
  let m;
  TBD_REGEX.lastIndex = 0;
  while ((m = TBD_REGEX.exec(markdown)) !== null) {
    const id = m[1].trim();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Six block headings that renderDraft must emit for every lane. Exposed
 * for tests so the contract is declarative.
 */
export const MANDATORY_BLOCKS = Object.freeze([
  "## Scope Contract",
  "## Slices",
  "## Validation Gates",
  "## Stop Conditions",
  "## Rollback",
  "## Anti-patterns & Forbidden Actions",
  "## Change Manifest",
]);
