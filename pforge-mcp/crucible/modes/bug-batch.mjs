/**
 * Plan Forge — Crucible bug-batch lane mode descriptor (Phase-59 Slice 4).
 *
 * Self-registering CrucibleMode for the bug-batch lane. Used when a single
 * smelt fixes one bug and the fix itself needs multiple slices.
 *
 * IMPORTANT: must not import from crucible-server.mjs (circular prevention).
 */

import { renderDraft as standardRenderDraft } from "../../crucible-draft.mjs";
import { registerMode } from "../registry.mjs";
import { inferRepoCommands } from "../../crucible-infer.mjs";

// ─── Question bank ───────────────────────────────────────────────────

const BANK = Object.freeze([
  Object.freeze({ id: "symptom-observed",    prompt: "What symptom are you observing?",                                                     required: true,  defaultSource: null }),
  Object.freeze({ id: "expected-behavior",   prompt: "What is the expected behavior?",                                                       required: true,  defaultSource: null }),
  Object.freeze({ id: "suspected-component", prompt: "Which component or file is suspected?",                                                required: true,  defaultSource: null }),
  Object.freeze({ id: "scope-files",         prompt: "Which files need to change to fix this bug? (comma-separated)",                        required: true,  defaultSource: null }),
  Object.freeze({ id: "slice-breakdown",     prompt: "Break the fix into slices (format: <name> | <files> | <test-cmd>, one per line)",      required: true,  defaultSource: null }),
  Object.freeze({ id: "validation-gates",    prompt: "What validation gates will confirm the fix?",                                          required: true,  defaultSource: null }),
  Object.freeze({ id: "forbidden-actions",   prompt: "What changes are forbidden while fixing this bug?",                                    required: true,  defaultSource: null }),
  Object.freeze({ id: "rollback",            prompt: "How do we roll back if the fix makes things worse?",                                   required: false, defaultSource: null }),
]);

// ─── Slice-breakdown parser ──────────────────────────────────────────

/**
 * Parse a slice-breakdown answer into slice descriptors.
 * Each line format: `<name> | <files> | <test-cmd-or-acceptance>`
 *
 * @param {string} raw
 * @returns {{ name: string, files: string, testCmd: string }[]}
 * @throws {Error} with code "INVALID_SLICE_BREAKDOWN" when any line has < 3 parts
 */
export function parseSliceBreakdown(raw) {
  if (!raw || typeof raw !== "string") return [];
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 3) {
      const err = new Error(
        `slice-breakdown line has fewer than 3 parts (expected "<name> | <files> | <test-cmd>"): ${line}`
      );
      err.code = "INVALID_SLICE_BREAKDOWN";
      throw err;
    }
    result.push({ name: parts[0], files: parts[1], testCmd: parts[2] });
  }
  return result;
}

// ─── Renderer helpers ────────────────────────────────────────────────

function getAnswer(smelt, questionId) {
  const a = (smelt.answers || []).find((x) => x.questionId === questionId);
  return a && typeof a.answer === "string" ? a.answer.trim() : null;
}

function tbd(id) { return `{{TBD: ${id}}}`; }

function asBullets(value) {
  if (!value) return null;
  if (/^\s*[-*]\s+/m.test(value)) return value.trim();
  const parts = value.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts.map((p) => `- ${p}`).join("\n") : null;
}

// ─── Custom renderBody ────────────────────────────────────────────────

/**
 * Render a bug-batch plan document.
 * Called by crucible-draft.mjs renderDraft when mode.renderBody is present.
 *
 * @param {object} smelt
 * @param {{ cwd?: string }} [options]
 * @returns {string}
 */
export function renderBody(smelt, options = {}) {
  const cwd = options && options.cwd;
  const ans = {
    symptom:    getAnswer(smelt, "symptom-observed"),
    expected:   getAnswer(smelt, "expected-behavior"),
    component:  getAnswer(smelt, "suspected-component"),
    scopeFiles: getAnswer(smelt, "scope-files"),
    breakdown:  getAnswer(smelt, "slice-breakdown"),
    gates:      getAnswer(smelt, "validation-gates"),
    forbidden:  getAnswer(smelt, "forbidden-actions"),
    rollback:   getAnswer(smelt, "rollback"),
  };

  const rawIdea = (smelt.rawIdea || "").trim();
  const titleBase = rawIdea.split(/\r?\n/)[0].slice(0, 80).trim() || "Bug fix";
  const phasePrefix = smelt.phaseName ? `${smelt.phaseName}: ` : "";

  const lines = [];

  // ── Header ──
  lines.push(`# ${phasePrefix}${titleBase}`);
  lines.push("");
  lines.push(`> **Lane**: bug-batch  `);
  lines.push(`> **Source**: ${smelt.source || "human"}  `);
  lines.push(`> **Status**: ${smelt.status || "in-progress"}`);
  lines.push("");
  lines.push("## Raw Idea");
  lines.push("");
  lines.push(rawIdea || tbd("rawIdea"));
  lines.push("");

  // ── Root Cause Hypothesis ──
  lines.push("## Root Cause Hypothesis");
  lines.push("");
  lines.push(`**Symptom observed**: ${ans.symptom || tbd("symptom-observed")}`);
  lines.push("");
  lines.push(`**Expected behavior**: ${ans.expected || tbd("expected-behavior")}`);
  lines.push("");
  lines.push(`**Suspected component**: ${ans.component || tbd("suspected-component")}`);
  lines.push("");

  // ── Scope Contract ──
  lines.push("## Scope Contract");
  lines.push("");
  lines.push("### In Scope");
  lines.push("");
  lines.push(asBullets(ans.scopeFiles) || tbd("scope-files"));
  lines.push("");
  lines.push("### Forbidden");
  lines.push("");
  lines.push(asBullets(ans.forbidden) || tbd("forbidden-actions"));
  lines.push("");

  // ── Slices ──
  lines.push("## Slices");
  lines.push("");

  if (ans.breakdown) {
    let slices;
    try {
      slices = parseSliceBreakdown(ans.breakdown);
    } catch {
      // Invalid format: emit as TBD so finalize can refuse via criticalGaps
      lines.push(tbd("slice-breakdown"));
      slices = null;
    }
    if (slices && slices.length > 0) {
      const repoCommands = cwd ? inferRepoCommands(cwd) : null;
      const buildCmd = repoCommands && repoCommands.buildCommand ? repoCommands.buildCommand : "npm run build";
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i];
        const scopeClause = s.files ? ` [scope: ${s.files}]` : "";
        lines.push(`### Slice ${i + 1} — ${s.name}${scopeClause}`);
        lines.push("");
        lines.push(`Build command: ${buildCmd}`);
        lines.push(`Test command:  ${s.testCmd}`);
        lines.push("");
        lines.push("**Files**:");
        const fileBullets = asBullets(s.files);
        lines.push(fileBullets || `- ${s.files}`);
        lines.push("");
      }
    }
  } else {
    lines.push(tbd("slice-breakdown"));
    lines.push("");
  }

  // ── Validation Gates ──
  lines.push("## Validation Gates");
  lines.push("");
  lines.push(ans.gates || tbd("validation-gates"));
  lines.push("");
  // Advisory skill gates — appended after the user-declared gates so the
  // executor has a clear "what to run alongside the gates" line. These do
  // NOT replace the user's gates; they sit beside them.
  lines.push("### Recommended skill gates (advisory)");
  lines.push("");
  lines.push("- **Pre-implementation**: `/code-review` scoped to the slice's files — surfaces collateral issues before patching");
  lines.push("- **Post-implementation**: `/test-sweep` over the full project — catches regressions outside the bug's original scanner");
  lines.push("");

  // ── Stop Conditions ──
  lines.push("## Stop Conditions");
  lines.push("");
  lines.push("- Validation gate fails and root cause is not identified within 30 minutes");
  lines.push("- A slice drifts past its declared Scope Contract");
  lines.push("- A forbidden action (see Scope Contract → Forbidden) is about to be introduced");
  lines.push("- Token budget for this phase is exceeded by more than 25%");
  lines.push("");

  // ── Rollback ──
  lines.push("## Rollback");
  lines.push("");
  lines.push(ans.rollback || tbd("rollback"));
  lines.push("");

  // ── Change Manifest ──
  lines.push("## Change Manifest");
  lines.push("");
  lines.push(asBullets(ans.scopeFiles) || tbd("change-manifest"));
  lines.push("");

  // ── Interview Log ──
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

// ─── Mode descriptor ─────────────────────────────────────────────────

const bug_batch = {
  id: "bug-batch",
  label: "Bug Batch",
  criticalFields: new Set(["scope-files", "validation-gates", "forbidden-actions", "slice-breakdown"]),
  // `bank` exposed directly for compatibility with plan validation gates
  bank: BANK,
  questionBank: () => BANK,
  renderBody,
  renderDraft: (smelt, opts) => renderBody(smelt, opts),
  // Finalization is handled by handleFinalize in crucible/core/finalize.mjs.
  finalize: () => { throw new Error("use handleFinalize via forge_crucible_finalize"); },
};

registerMode(bug_batch);
export default bug_batch;
