import { ROLES } from "./turn-input.mjs";

export const ACTION_TYPES = Object.freeze(["task", "skill", "plan", "retry", "abort", "bug", "idea", "remember"]);
export const MUTATING_TYPES = Object.freeze(new Set(["task", "skill", "plan", "retry", "abort"]));
export const VIEWER_ALLOWED_TYPES = Object.freeze(new Set(["bug", "idea", "remember"]));
const CONFIDENCE = new Set(["low", "medium", "high"]);
export const PROPOSAL_LIMITS = Object.freeze({ maxProposals: 3, rationaleChars: 200, projectIdChars: 80, idChars: 200, textChars: 1000, maxBlockBytes: 8192 });
const FENCE_TAG = "forge-actions";
const FENCE = "`".repeat(3);
export const EMPTY_MESSAGE = "No actions proposed — the answer is informational.";
export const ARGS_SCHEMA = Object.freeze({
  task: { required: { description: "text" } },
  skill: { required: { name: "id" } },
  plan: { required: { plan: "id" }, optional: { quorum: "id" } },
  retry: { required: { jobId: "id" } },
  abort: { required: { jobId: "id" } },
  bug: { required: { text: "text" } },
  idea: { required: { text: "text" } },
  remember: { required: { text: "text" } },
});

/**
 * Extract the first tagged JSON block and remove complete or unfinished tagged blocks.
 * @param {string} reply
 * @param {string} tag
 * @returns {{ data: unknown, reply: string, found: boolean }}
 */
export function extractFencedJson(reply, tag) {
  const completeFence = new RegExp(FENCE + tag + "[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n" + FENCE, "g");
  let data;
  let found = false;
  let parsed = false;
  let stripped = String(reply).replace(completeFence, (_block, body) => {
    found = true;
    if (!parsed) {
      parsed = true;
      if (Buffer.byteLength(body, "utf8") <= PROPOSAL_LIMITS.maxBlockBytes) {
        try {
          data = JSON.parse(body);
        } catch {
          data = undefined;
        }
      }
    }
    return "";
  });
  const unfinishedFence = new RegExp(FENCE + tag + "[ \\t]*\\r?\\n[\\s\\S]*$");
  if (unfinishedFence.test(stripped)) found = true;
  stripped = stripped.replace(unfinishedFence, "").replace(/\n{3,}/g, "\n\n").trim();
  return { data, reply: stripped, found };
}

/**
 * Validate and copy only the declared string arguments for an action type.
 * @param {string} type
 * @param {unknown} raw
 * @returns {Record<string, string> | null}
 */
export function validateArgs(type, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (!Object.hasOwn(ARGS_SCHEMA, type)) return null;
  const schema = ARGS_SCHEMA[type];

  const safe = Object.create(null);
  for (const [key, kind] of Object.entries({ ...schema.required, ...schema.optional })) {
    const value = raw[key];
    if (value === undefined && !Object.hasOwn(schema.required, key)) continue;
    if (typeof value !== "string" || !value.trim()) return null;
    const text = value.trim();
    const limit = kind === "id" ? PROPOSAL_LIMITS.idChars : PROPOSAL_LIMITS.textChars;
    if (text.length > limit) return null;
    safe[key] = text;
  }
  return { ...safe };
}

function effectiveRole(role) {
  const candidate = role ?? "owner";
  return ROLES.includes(candidate) ? candidate : "viewer";
}

function boundedProjectId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= PROPOSAL_LIMITS.projectIdChars ? trimmed : null;
}

/**
 * Validate, filter, and bound model-proposed actions.
 * @param {unknown} raw
 * @param {{ role?: string, untrusted?: boolean, projectId?: string }} options
 * @returns {{ actions: Array<object>, dropped: number }}
 */
export function validateProposals(raw, { role, untrusted = false, projectId } = {}) {
  if (!Array.isArray(raw)) return { actions: [], dropped: 0 };
  const roleName = effectiveRole(role);
  const actions = [];
  let dropped = 0;
  for (const proposal of raw) {
    if (actions.length >= PROPOSAL_LIMITS.maxProposals) break;
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal) ||
        !ACTION_TYPES.includes(proposal.type) ||
        (roleName === "viewer" && !VIEWER_ALLOWED_TYPES.has(proposal.type)) ||
        typeof proposal.rationale !== "string" || !proposal.rationale.trim()) {
      dropped++;
      continue;
    }
    const args = validateArgs(proposal.type, proposal.args);
    if (!args) {
      dropped++;
      continue;
    }
    const rationale = proposal.rationale.trim();
    actions.push({
      type: proposal.type,
      projectId: boundedProjectId(proposal.projectId) ?? boundedProjectId(projectId),
      args,
      rationale: rationale.slice(0, PROPOSAL_LIMITS.rationaleChars),
      confidence: CONFIDENCE.has(proposal.confidence) ? proposal.confidence : "low",
      origin: untrusted ? "untrusted" : "trusted",
      mutating: MUTATING_TYPES.has(proposal.type),
    });
  }
  return { actions, dropped };
}

/**
 * Build the role-appropriate fenced-action instructions without interpolating caller content.
 * @param {{ role?: string }} options
 * @returns {string}
 */
export function buildProposalInstruction({ role } = {}) {
  const roleName = effectiveRole(role);
  const types = roleName === "viewer" ? ACTION_TYPES.filter((type) => VIEWER_ALLOWED_TYPES.has(type)) : ACTION_TYPES;
  const schemas = types.map((type) => {
    const { required, optional = {} } = ARGS_SCHEMA[type];
    const keys = [...Object.keys(required), ...Object.keys(optional)];
    return `- ${type}: args { ${keys.map((key) => `${key}: ${required[key] ?? optional[key]}`).join(", ")} }`;
  });
  return [
    "## Proposed actions",
    "After your prose, include at most one fenced block tagged forge-actions. Put a JSON array on its own lines and the closing fence on its own line.",
    "The array may contain at most 3 items of the form {type, projectId?, args, rationale, confidence}.",
    `Allowed actions and args:\n${schemas.join("\n")}`,
    "These are suggestions only; never claim you ran them. Omit the block when nothing is actionable.",
    `${FENCE}${FENCE_TAG}`,
    "[",
    '  {"type":"idea","projectId":null,"args":{"text":"..."},"rationale":"...","confidence":"low"}',
    "]",
    FENCE,
  ].join("\n");
}

/**
 * Describe the outcome of action proposal validation.
 * @param {{ count: number, dropped?: number, role?: string }} options
 * @returns {string}
 */
export function proposedActionsMessage({ count, dropped = 0, role } = {}) {
  if (count > 0) return `${count} action(s) proposed. Forge-Master does not execute them; the caller decides.`;
  const suffix = dropped > 0
    ? ` (${dropped} proposal(s) dropped: invalid, unknown type, or not permitted for role ${effectiveRole(role)}.)`
    : "";
  return `${EMPTY_MESSAGE}${suffix}`;
}

/**
 * Extract and validate proposals from a model reply.
 * @param {{ reply: string, role?: string, untrusted?: boolean, projectId?: string }} options
 * @returns {{ reply: string, proposedActions: Array<object>, proposedActionsMessage: string }}
 */
export function finalizeProposals({ reply, role, untrusted = false, projectId } = {}) {
  const extracted = extractFencedJson(reply, FENCE_TAG);
  const validated = validateProposals(extracted.data, { role, untrusted, projectId });
  const dropped = extracted.found && extracted.data === undefined ? validated.dropped + 1 : validated.dropped;
  return {
    reply: extracted.reply,
    proposedActions: validated.actions,
    proposedActionsMessage: proposedActionsMessage({ count: validated.actions.length, dropped, role }),
  };
}

/**
 * Return the stable empty proposal result shape.
 * @returns {{ proposedActions: Array<never>, proposedActionsMessage: string }}
 */
export function emptyProposals() {
  return { proposedActions: [], proposedActionsMessage: EMPTY_MESSAGE };
}
