/**
 * Plan Forge — Forge-Master Planner (Phase-38.4, Slice 1).
 *
 * Decomposes complex user queries into ordered read-only tool-call
 * steps before execution. Simple queries are short-circuited via
 * skip heuristics (zero-cost, no model call).
 *
 * Exports:
 *   - plan({userMessage, classification, lane, allowedTools, deps}) → PlanResult
 *   - SKIP_REASONS — frozen map of canonical skip-reason strings
 *   - MAX_STEPS — hard cap on planned steps (5)
 *
 * @module forge-master/planner
 */

import { USAGE_HINTS } from "./allowlist.mjs";

// ─── Constants ──────────────────────────────────────────────────────

/** Hard cap: planner never returns more than 5 steps. */
export const MAX_STEPS = 5;

/** Canonical skip-reason strings. */
export const SKIP_REASONS = Object.freeze({
  OFFTOPIC:       "lane=offtopic",
  BUILD:          "lane=build",
  NO_TOOLS:       "no-allowed-tools",
  SINGLE_TOOL:    "single-tool-obvious",
  PLANNER_EMPTY:  "planner-empty",
  PLANNER_ERROR:  "planner-error",
});

/** Lanes where the planner must never be invoked. */
const SKIP_LANES = new Set(["offtopic", "build"]);

// ─── Types (JSDoc) ──────────────────────────────────────────────────

/**
 * A single planned tool-call step.
 *
 * @typedef {Object} PlanStep
 * @property {string}   id         - Canonical step ID (e.g. "step-0").
 * @property {string}   tool       - Tool name (must be in allowedTools).
 * @property {Object}   args       - Arguments to pass to the tool.
 * @property {string}   rationale  - Why this step is needed.
 * @property {string[]} [dependsOn] - IDs of steps that must complete first.
 */

/**
 * Result returned by the planner.
 *
 * @typedef {Object} PlanResult
 * @property {PlanStep[]} steps      - Ordered list of tool-call steps (0–5).
 * @property {string}     [skipReason] - Present when planning was skipped.
 */

// ─── Skip result helper ─────────────────────────────────────────────

/** @returns {PlanResult} */
function skip(reason) {
  return { steps: [], skipReason: reason };
}

// ─── Step validation ────────────────────────────────────────────────

/**
 * Validate and normalize a raw step object from the model.
 * Returns null if the step is malformed or references a disallowed tool.
 *
 * @param {*} raw
 * @param {Set<string>} allowedSet
 * @returns {Omit<PlanStep, "id"> | null}
 */
function validateStep(raw, allowedSet) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.tool !== "string" || !raw.tool.trim()) return null;

  const tool = raw.tool.trim();
  if (!allowedSet.has(tool)) return null;

  const args = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args)
    ? raw.args
    : {};

  const rationale = typeof raw.rationale === "string" ? raw.rationale : "";

  // dependsOn: accept string array only; will be re-mapped after ID assignment
  let dependsOn;
  if (Array.isArray(raw.dependsOn)) {
    dependsOn = raw.dependsOn.filter((d) => typeof d === "string");
    if (dependsOn.length === 0) dependsOn = undefined;
  }

  return { tool, args, rationale, dependsOn };
}

/**
 * Assign canonical step IDs and remap/prune dependsOn references.
 *
 * @param {Array<Omit<PlanStep, "id"> & { dependsOn?: string[] }>} validSteps
 * @param {string[]} originalIds - The raw IDs the model used (positional)
 * @returns {PlanStep[]}
 */
function assignIds(validSteps, originalIds) {
  // Build a mapping from original (model-supplied) ID → new canonical ID
  const idMap = new Map();
  for (let i = 0; i < validSteps.length; i++) {
    const origId = originalIds[i];
    const canonId = `step-${i}`;
    if (origId != null) idMap.set(String(origId), canonId);
    // Also map positional index strings
    idMap.set(String(i), canonId);
  }

  const canonicalIdSet = new Set(
    validSteps.map((_, i) => `step-${i}`),
  );

  return validSteps.map((s, i) => {
    const id = `step-${i}`;

    let dependsOn;
    if (s.dependsOn) {
      dependsOn = s.dependsOn
        .map((ref) => idMap.get(String(ref)) ?? ref)
        .filter((ref) => canonicalIdSet.has(ref) && ref !== id); // drop self-refs
      if (dependsOn.length === 0) dependsOn = undefined;
    }

    return { id, tool: s.tool, args: s.args, rationale: s.rationale, ...(dependsOn ? { dependsOn } : {}) };
  });
}

// ─── Planner system prompt ──────────────────────────────────────────

/**
 * Build the system prompt for the planning model.
 *
 * @param {string[]} allowedTools
 * @returns {string}
 */
function buildPlannerPrompt(allowedTools) {
  const toolDescriptions = allowedTools.map((t) => {
    const hint = USAGE_HINTS[t] || `Plan Forge tool: ${t}`;
    return `- ${t}: ${hint}`;
  }).join("\n");

  return `You are a query planner for Plan Forge's Forge-Master assistant.
Your job is to decompose a user query into an ordered list of tool calls.

Rules:
- Return a JSON array of step objects. Each step: {"tool": "<name>", "args": {}, "rationale": "<why>", "dependsOn": []}
- Use ONLY tools from the allowed list below.
- Maximum 5 steps.
- dependsOn is optional: list step indices (0-based) that must complete before this step.
- If the query is simple and needs only 1 tool, return a single-step plan.
- Return an empty array [] if no tools are relevant.

Allowed tools:
${toolDescriptions}

Respond with ONLY valid JSON — no markdown, no explanation.`;
}

// ─── Main planner function ──────────────────────────────────────────

/**
 * Plan tool-call steps for a user query.
 *
 * Skip heuristics (zero-cost, no model call):
 *   1. lane is "offtopic" or "build" → skip
 *   2. allowedTools is empty → skip
 *   3. allowedTools has exactly 1 tool → single-tool-obvious
 *
 * Otherwise, calls `deps.callPlannerModel` to decompose the query.
 *
 * @param {{
 *   userMessage: string,
 *   classification: { lane: string, confidence: string, suggestedTools?: string[] },
 *   lane: string,
 *   allowedTools: string[],
 *   deps: {
 *     callPlannerModel: (opts: { systemPrompt: string, userMessage: string }) => Promise<string>,
 *   },
 * }} opts
 * @returns {Promise<PlanResult>}
 */
export async function plan({ userMessage, classification, lane, allowedTools, deps }) {
  // ── Skip heuristics ───────────────────────────────────────────────

  // 1. Disallowed lanes
  if (SKIP_LANES.has(lane)) {
    return skip(lane === "offtopic" ? SKIP_REASONS.OFFTOPIC : SKIP_REASONS.BUILD);
  }

  // 2. No tools available
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    return skip(SKIP_REASONS.NO_TOOLS);
  }

  // 3. Single allowed tool — no need for decomposition
  const uniqueTools = [...new Set(allowedTools.filter((t) => typeof t === "string" && t.trim()))];
  if (uniqueTools.length <= 1) {
    return skip(SKIP_REASONS.SINGLE_TOOL);
  }

  // ── Model call ────────────────────────────────────────────────────

  if (!deps?.callPlannerModel || typeof deps.callPlannerModel !== "function") {
    return skip(SKIP_REASONS.PLANNER_ERROR);
  }

  let rawResponse;
  try {
    const systemPrompt = buildPlannerPrompt(uniqueTools);
    rawResponse = await deps.callPlannerModel({ systemPrompt, userMessage });
  } catch {
    return skip(SKIP_REASONS.PLANNER_ERROR);
  }

  // ── Parse response ────────────────────────────────────────────────

  let parsed;
  try {
    if (typeof rawResponse !== "string") {
      return skip(SKIP_REASONS.PLANNER_ERROR);
    }
    // Strip markdown fences if present
    const cleaned = rawResponse.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return skip(SKIP_REASONS.PLANNER_ERROR);
  }

  if (!Array.isArray(parsed)) {
    return skip(SKIP_REASONS.PLANNER_ERROR);
  }

  // ── Validate, filter, cap ─────────────────────────────────────────

  const allowedSet = new Set(uniqueTools);
  const originalIds = [];
  const validSteps = [];

  for (const raw of parsed) {
    // Capture original ID for dep remapping (index-based or explicit)
    originalIds.push(raw?.id ?? String(originalIds.length));
    const step = validateStep(raw, allowedSet);
    if (step) validSteps.push(step);
  }

  // Cap to MAX_STEPS after filtering
  const capped = validSteps.slice(0, MAX_STEPS);

  if (capped.length === 0) {
    return skip(SKIP_REASONS.PLANNER_EMPTY);
  }

  // Build original ID list for just the capped steps (positional)
  const cappedOriginalIds = originalIds.slice(0, originalIds.length).slice(0, capped.length);
  const steps = assignIds(capped, cappedOriginalIds);

  return { steps };
}
