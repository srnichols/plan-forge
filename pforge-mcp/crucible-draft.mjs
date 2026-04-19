/**
 * Plan Forge — Crucible Draft Renderer (Slice 01.3).
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
 * @returns {string} markdown body (trailing newline included)
 */
export function renderDraft(smelt) {
  if (!smelt) throw new Error("smelt required");
  const ans = indexAnswers(smelt);
  const lane = smelt.lane || "feature";
  const rawIdea = (smelt.rawIdea || "").trim();
  const firstLine = rawIdea.split(/\r?\n/)[0].slice(0, 80).trim();
  const title = firstAnswer(ans, "feature-name") || firstLine || "Untitled smelt";

  const scopeInRaw = firstAnswer(ans, "scope-in", "scope-files", "scope-file", "goal");
  const scopeIn = asBulletList(scopeInRaw) || `{{TBD: ${lane === "full" ? "scope-in" : "scope-files"}}}`;

  const outOfScope = asBulletList(firstAnswer(ans, "scope-out", "out-of-scope"))
    || `{{TBD: ${lane === "full" ? "scope-out" : "out-of-scope"}}}`;

  const validationGates =
    firstAnswer(ans, "validation-gates", "validation")
    || `{{TBD: ${lane === "tweak" ? "validation" : "validation-gates"}}}`;

  const rollback =
    firstAnswer(ans, "rollback-plan", "rollback")
    || `{{TBD: ${lane === "full" ? "rollback-plan" : "rollback"}}}`;

  const forbidden = asBulletList(firstAnswer(ans, "forbidden-actions"))
    || `{{TBD: forbidden-actions}}`;

  const tests = firstAnswer(ans, "tests") || `{{TBD: tests}}`;

  const changeManifest = asBulletList(firstAnswer(ans, "scope-files", "scope-file", "scope-in"))
    || `{{TBD: change-manifest}}`;

  const sliceCount = firstAnswer(ans, "slice-count");

  const lines = [];
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

  if (lane === "full") {
    const problem = firstAnswer(ans, "user-problem") || `{{TBD: user-problem}}`;
    const metric = firstAnswer(ans, "success-metric") || `{{TBD: success-metric}}`;
    const stack = firstAnswer(ans, "stack-boundary") || `{{TBD: stack-boundary}}`;
    const dataModel = firstAnswer(ans, "data-model") || `{{TBD: data-model}}`;
    const apiSurface = firstAnswer(ans, "api-surface") || `{{TBD: api-surface}}`;
    const security = firstAnswer(ans, "security-posture") || `{{TBD: security-posture}}`;

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

  // Block 1: Slices
  lines.push("## Scope Contract");
  lines.push("");
  lines.push("**In scope**:");
  lines.push("");
  lines.push(scopeIn);
  lines.push("");
  lines.push("**Out of scope**:");
  lines.push("");
  lines.push(outOfScope);
  lines.push("");

  lines.push("## Slices");
  lines.push("");
  if (sliceCount) {
    lines.push(`_Estimated: ${sliceCount} slices. Expand each below during Plan Hardener step._`);
  } else {
    lines.push("_Slice breakdown is authored during the Plan Hardener step (Session 1, Step 2)._");
  }
  lines.push("");
  lines.push("> Slice template:");
  lines.push(">");
  lines.push("> ```");
  lines.push("> ### Slice N — <name>");
  lines.push("> Build command: <cmd>");
  lines.push("> Test command:  <cmd>");
  lines.push("> Tasks:         <list>");
  lines.push("> Files:         <manifest>");
  lines.push("> ```");
  lines.push("");

  // Block 2: Validation Gates
  lines.push("## Validation Gates");
  lines.push("");
  lines.push(validationGates);
  lines.push("");
  lines.push(`**Tests**: ${tests}`);
  lines.push("");

  // Block 3: Stop Conditions (boilerplate — universal, lane-neutral)
  lines.push("## Stop Conditions");
  lines.push("");
  lines.push("- Validation gate fails and root cause is not identified within 30 minutes");
  lines.push("- A slice drifts past its declared Scope Contract");
  lines.push("- A forbidden action (see Anti-patterns) is about to be introduced");
  lines.push("- Token budget for this phase is exceeded by more than 25%");
  lines.push("");

  // Block 4: Rollback
  lines.push("## Rollback");
  lines.push("");
  lines.push(rollback);
  lines.push("");

  // Block 5: Anti-patterns
  lines.push("## Anti-patterns & Forbidden Actions");
  lines.push("");
  lines.push(forbidden);
  lines.push("");

  // Block 6: Change Manifest
  lines.push("## Change Manifest");
  lines.push("");
  lines.push(changeManifest);
  lines.push("");

  if (Array.isArray(smelt.answers) && smelt.answers.length > 0) {
    lines.push("## Interview Log");
    lines.push("");
    smelt.answers.forEach((a, i) => {
      lines.push(`${i + 1}. **${a.questionId}** — ${a.answer}`);
    });
    lines.push("");
  }

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
