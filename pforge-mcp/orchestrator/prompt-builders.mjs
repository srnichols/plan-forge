/** Plan Forge — Phase-53 S9: shared prompt builders */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { isManualGateSlice, manualGateText } from "./plan-parser.mjs";

const MAX_FORBIDDEN_ITEMS = 20;
const MAX_FORBIDDEN_ITEM_CHARS = 300;
const MAX_CONTEXT_FILES = 20;
// Sized from the Stop Conditions sections in docs/plans: the longest line is about 510 characters, the longest section about 3,100.
const MAX_STOP_CONDITION_LINE_CHARS = 600;
const MAX_STOP_CONDITION_CHARS = 4000;
// "none", "N/A" and "None — …" are placeholders; "Nothing outside src/ may change" is a real rule.
const PLACEHOLDER_ITEM_RE = /^(?:none|nothing|n\/a|tbd)(?:\s*[—–:-].*)?$/i;
/** A bullet or number in front of a line: the "- " of "- None". */
const LIST_MARKER_RE = /^(?:[-*+]|\d+[.)])\s+/;
/** What a worker is told about a `[manual]` gate: it cannot do the check, so it must not claim it (meta-bug #369). */
const MANUAL_VERIFICATION_LABEL = "Manual verification (a person does this after you finish; you cannot, so do not report it as done)";
// The Blocker Report is the one stop signal the orchestrator acts on: a worker that writes it fails the slice (meta-bug #338).
const STOP_CONDITIONS_HEADING =
  "Stop conditions from the plan. If one occurs, do not work around it: follow the recovery the plan gives. " +
  'If it gives none, or you cannot recover, stop and report a Blocker: a "## \u26A0 Blocker" heading, then a "**Problem:** <what happened>" line.';

export function buildSlicePrompt(slice) {
  const parts = [
    `Execute Slice ${slice.number}: ${slice.title}`,
    "",
    "Tasks:",
  ];
  for (const task of slice.tasks) {
    // A task keeps the indented lines written under it (meta-bug #377); nest them under its bullet.
    const [first, ...rest] = String(task).split("\n");
    parts.push(`- ${first}`, ...rest.map((line) => (line === "" ? line : `  ${line}`)));
  }
  // Scope isolation: tell worker which files to modify
  if (slice.scope && slice.scope.length > 0) {
    parts.push("", `SCOPE: Only modify files matching: ${slice.scope.join(", ")}`);
    parts.push("Do NOT create or modify files outside this scope.");
  }
  if (slice.buildCommand) {
    parts.push("", `Build command: ${slice.buildCommand}`);
  }
  if (slice.testCommand) {
    parts.push(`Test command: ${slice.testCommand}`);
  }
  if (slice.validationGate) {
    parts.push("", "Validation gate (run these after completion):", slice.validationGate);
  } else if (isManualGateSlice(slice)) {
    parts.push("", `${MANUAL_VERIFICATION_LABEL}: ${manualGateText(slice) || "(no description)"}`);
  }
  if (slice.stopCondition) {
    parts.push("", `Stop condition: ${slice.stopCondition}`);
  }
  return parts.join("\n");
}

function isPlaceholderItem(text) {
  const bare = text.replace(/[`*_()]/g, "").replace(/\.+$/, "").trim();
  return bare === "" || PLACEHOLDER_ITEM_RE.test(bare);
}

function clip(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// Resolved against the process directory exactly as parsePlan reads the file.
function projectRelativePlanFile(planPath, cwd) {
  if (!planPath || !cwd) return null;
  const rel = relative(resolve(cwd), resolve(String(planPath)));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * What every slice of a plan shares and the worker needs but the slice record
 * does not carry: where the plan lives, its Scope Contract Forbidden items,
 * whether it has a Shared Contract section (meta-bug #320), and the lines of
 * its plan-level Stop Conditions section (meta-bug #365).
 */
export function buildPlanContext({ plan, planPath, cwd }) {
  return {
    planFile: projectRelativePlanFile(planPath, cwd),
    forbidden: (plan?.scopeContract?.forbidden ?? [])
      .map((item) => String(item).trim())
      .filter((item) => !isPlaceholderItem(item)),
    hasSharedContract: plan?.hasSharedContract === true,
    stopConditions: (plan?.stopConditions ?? [])
      .map((line) => String(line).trimEnd())
      .filter((line) => !isPlaceholderItem(line.trim().replace(LIST_MARKER_RE, ""))),
  };
}

function boundedList(items, max, overflowLabel) {
  const lines = items.slice(0, max).map((item) => `- ${item}`);
  if (items.length > max) lines.push(`- (+${items.length - max} more ${overflowLabel})`);
  return lines;
}

/**
 * The stop-condition lines, as the plan wrote them, up to the character budget.
 * A line past it is dropped whole, not cut mid-sentence, and the block says how
 * many lines it left out.
 */
function boundedStopConditions(lines) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const text = clip(line, MAX_STOP_CONDITION_LINE_CHARS);
    if (used + text.length > MAX_STOP_CONDITION_CHARS) break;
    kept.push(text);
    used += text.length;
  }
  const omitted = lines.length - kept.length;
  if (omitted > 0) kept.push(`(+${omitted} more lines in the plan's Stop Conditions section)`);
  return kept;
}

function planPointerSection(planContext) {
  if (!planContext?.planFile) return null;
  const pointer = [
    `Plan file: ${planContext.planFile}`,
    'If this slice cites a plan decision or section by name (for example "per D7"), open that section in the plan file and follow it. The rest of the plan is not needed.',
  ];
  if (planContext.hasSharedContract) {
    pointer.push('The plan has a "Shared Contract" section pinning the names, types and signatures shared across slices. Read it before editing.');
  }
  return pointer;
}

function contextFilesSection(slice) {
  const contextFiles = slice?.contextFiles ?? [];
  if (contextFiles.length === 0) return null;
  return [
    "Read before editing (references only, not part of your edit scope):",
    ...boundedList(contextFiles, MAX_CONTEXT_FILES, "in the slice's Context Files"),
  ];
}

function forbiddenSection(planContext) {
  const forbidden = (planContext?.forbidden ?? []).map((item) => clip(item, MAX_FORBIDDEN_ITEM_CHARS));
  if (forbidden.length === 0) return null;
  return [
    "Forbidden by the plan's Scope Contract (do NOT do any of these):",
    ...boundedList(forbidden, MAX_FORBIDDEN_ITEMS, "in the plan's Scope Contract"),
  ];
}

function stopConditionsSection(planContext) {
  const lines = planContext?.stopConditions ?? [];
  if (lines.length === 0) return null;
  return [STOP_CONDITIONS_HEADING, ...boundedStopConditions(lines)];
}

/**
 * The plan-level context a worker would otherwise never see: the slice's
 * Context Files, the plan's Forbidden list, the plan's Stop Conditions, and a
 * pointer to the plan file for sections the slice cites ("per D7", "per the
 * Shared Contract"). Returns "" when there is nothing to add.
 */
export function buildPlanContextBlock(slice, planContext) {
  const sections = [
    planPointerSection(planContext),
    contextFilesSection(slice),
    forbiddenSection(planContext),
    stopConditionsSection(planContext),
  ].filter(Boolean);
  if (sections.length === 0) return "";
  const body = sections.map((section) => section.join("\n")).join("\n\n");
  return `--- PLAN CONTEXT ---\n${body}\n--- END PLAN CONTEXT ---`;
}

/**
 * `prompt` followed by the slice's plan-context block, when it has one. Every
 * model that plans or executes the slice reads the block the same way: the
 * executing worker and the quorum legs that plan it first (meta-bug #381).
 */
export function appendPlanContext(prompt, slice, planContext) {
  const block = buildPlanContextBlock(slice, planContext);
  return block ? `${prompt}\n\n${block}` : prompt;
}
