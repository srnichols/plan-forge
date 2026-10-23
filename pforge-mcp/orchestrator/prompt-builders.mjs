/** Plan Forge — Phase-53 S9: shared prompt builders */

import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_FORBIDDEN_ITEMS = 20;
const MAX_FORBIDDEN_ITEM_CHARS = 300;
const MAX_CONTEXT_FILES = 20;
// "none", "N/A" and "None — …" are placeholders; "Nothing outside src/ may change" is a real rule.
const PLACEHOLDER_ITEM_RE = /^(?:none|nothing|n\/a|tbd)(?:\s*[—–:-].*)?$/i;

export function buildSlicePrompt(slice) {
  const parts = [
    `Execute Slice ${slice.number}: ${slice.title}`,
    "",
    "Tasks:",
  ];
  for (const task of slice.tasks) {
    parts.push(`- ${task}`);
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
 * and whether it has a Shared Contract section (meta-bug #320).
 */
export function buildPlanContext({ plan, planPath, cwd }) {
  return {
    planFile: projectRelativePlanFile(planPath, cwd),
    forbidden: (plan?.scopeContract?.forbidden ?? [])
      .map((item) => String(item).trim())
      .filter((item) => !isPlaceholderItem(item)),
    hasSharedContract: plan?.hasSharedContract === true,
  };
}

function boundedList(items, max, overflowLabel) {
  const lines = items.slice(0, max).map((item) => `- ${item}`);
  if (items.length > max) lines.push(`- (+${items.length - max} more ${overflowLabel})`);
  return lines;
}

/**
 * The plan-level context a worker would otherwise never see: the slice's
 * Context Files, the plan's Forbidden list, and a pointer to the plan file
 * for sections the slice cites ("per D7", "per the Shared Contract").
 * Returns "" when there is nothing to add.
 */
export function buildPlanContextBlock(slice, planContext) {
  const sections = [];
  if (planContext?.planFile) {
    const pointer = [
      `Plan file: ${planContext.planFile}`,
      'If this slice cites a plan decision or section by name (for example "per D7"), open that section in the plan file and follow it. The rest of the plan is not needed.',
    ];
    if (planContext.hasSharedContract) {
      pointer.push('The plan has a "Shared Contract" section pinning the names, types and signatures shared across slices. Read it before editing.');
    }
    sections.push(pointer);
  }
  const contextFiles = slice?.contextFiles ?? [];
  if (contextFiles.length > 0) {
    sections.push([
      "Read before editing (references only, not part of your edit scope):",
      ...boundedList(contextFiles, MAX_CONTEXT_FILES, "in the slice's Context Files"),
    ]);
  }
  const forbidden = (planContext?.forbidden ?? []).map((item) => clip(item, MAX_FORBIDDEN_ITEM_CHARS));
  if (forbidden.length > 0) {
    sections.push([
      "Forbidden by the plan's Scope Contract (do NOT do any of these):",
      ...boundedList(forbidden, MAX_FORBIDDEN_ITEMS, "in the plan's Scope Contract"),
    ]);
  }
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
