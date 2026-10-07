import { CHANNELS, NEW_TURN_FIELDS, ROLES, STYLES } from "./turn-input.mjs";

/** Exact marker appended when a generated reply exceeds its character budget. */
export const REPLY_TRUNCATION_MARKER = "…(truncated — ask for more)";

const ROLE_GUIDANCE_TEXT = [
  "May request any analysis and receive next-step suggestions, including running or retrying plans. Forge-Master itself remains read-only.",
  "May request any analysis and receive next-step suggestions, including running or retrying plans, plus suggestions to approve or reject pending actions. Forge-Master itself remains read-only.",
  "Only suggest filing a bug, capturing an idea, or asking to remember information.",
];

if (ROLE_GUIDANCE_TEXT.length !== ROLES.length) {
  throw new Error("Caller guidance must cover every canonical role");
}

/** Guidance for each canonical caller role. */
export const ROLE_GUIDANCE = Object.freeze(Object.fromEntries(
  ROLES.map((role, index) => [role, ROLE_GUIDANCE_TEXT[index]]),
));

/**
 * Build the trusted caller context for the system prompt.
 * @param {{ role: string, channel: string }|null|undefined} caller — validated caller metadata
 * @returns {string} Caller guidance, or an empty string when no caller is set
 */
export function buildCallerSection(caller) {
  if (caller == null) return "";
  if (!ROLES.includes(caller.role) || !CHANNELS.includes(caller.channel)) {
    throw new TypeError("Caller role and channel must be canonical values");
  }
  return [
    "## Caller",
    `- Role: ${caller.role}`,
    `- Channel: ${caller.channel}`,
    ROLE_GUIDANCE[caller.role],
  ].join("\n");
}

/**
 * Build response-format instructions without incorporating channel metadata.
 * @param {{ style?: string, maxChars?: number }|null|undefined} fmt — validated response format
 * @returns {string} Response-format guidance, or an empty string when absent
 */
export function buildResponseFormatSection(fmt) {
  if (fmt == null) return "";
  const rules = fmt.style === STYLES[1]
    ? [
        "Lead with the answer in at most 2 sentences.",
        "Use bullets instead of tables.",
        "Use code spans only for identifiers.",
        "Use no headings (bold text at most).",
        "Use plain Markdown with no channel-specific escaping.",
      ]
    : ["Use normal Forge-Master formatting."];
  if (fmt.maxChars !== undefined) rules.push(`Keep the whole reply under ${fmt.maxChars} characters.`);
  return ["## Response format", ...rules].join("\n");
}

/**
 * Build all non-empty prompt shaping sections.
 * @param {{ caller?: object|null, responseFormat?: object|null }} options — turn shaping inputs
 * @returns {string} Joined prompt sections
 */
export function buildShapingSections({ caller, responseFormat }) {
  return [buildCallerSection(caller), buildResponseFormatSection(responseFormat)]
    .filter(Boolean)
    .join("\n\n");
}

function isValidReplyBudget(reply, maxChars) {
  return typeof reply === "string" && reply.length > 0 &&
    Number.isFinite(maxChars) && Number.isInteger(maxChars) && maxChars > 0;
}

function isDecimalPoint(prefix, match, punctuationIndex) {
  return match[0][punctuationIndex - match.index] === "." &&
    /\d/.test(prefix[punctuationIndex - 1] ?? "") &&
    /\d/.test(prefix[punctuationIndex + 1] ?? "");
}

function findSentenceCut(prefix) {
  let cut = -1;
  const sentenceEnds = /[.!?…]["')\]]*(?=\s|$)/g;
  for (const match of prefix.matchAll(sentenceEnds)) {
    const punctuationIndex = match.index + match[0].search(/[.!?…]/);
    if (isDecimalPoint(prefix, match, punctuationIndex)) continue;
    cut = match.index + match[0].length;
  }
  return cut;
}

function findReadableCut(prefix, budget) {
  let cut = findSentenceCut(prefix);
  if (cut >= 0) return cut;

  const newline = prefix.lastIndexOf("\n");
  if (newline >= 0) return newline;

  for (const match of prefix.matchAll(/\s/g)) cut = match.index;
  return cut >= 0 ? cut : budget;
}

/**
 * Enforce a character budget while preserving a readable cut and explicit marker.
 * @param {string} reply — generated reply text
 * @param {number} maxChars — maximum allowed JavaScript string length
 * @returns {{ reply: string, truncated: boolean }} Bounded reply and truncation status
 */
export function enforceMaxChars(reply, maxChars) {
  if (!isValidReplyBudget(reply, maxChars) || reply.length <= maxChars) {
    return { reply, truncated: false };
  }
  if (reply.endsWith(REPLY_TRUNCATION_MARKER)) return { reply, truncated: false };

  const budget = maxChars - (REPLY_TRUNCATION_MARKER.length + 1);
  if (budget < 0) throw new RangeError("maxChars is too small to fit the truncation marker");

  const prefix = reply.slice(0, budget);
  let cut = findReadableCut(prefix, budget);

  if (cut > 0 && /[\uD800-\uDBFF]/.test(reply[cut - 1])) cut--;
  const result = `${reply.slice(0, cut).trimEnd()} ${REPLY_TRUNCATION_MARKER}`;
  if (result.length > maxChars) throw new RangeError("Truncated reply exceeded maxChars");
  return { reply: result, truncated: true };
}

/**
 * Detect whether the caller supplied any field from the new turn-input contract.
 * @param {object|null|undefined} input — raw turn input
 * @returns {boolean} Whether a new turn field was explicitly supplied
 */
export function hasNewTurnFields(input) {
  return NEW_TURN_FIELDS.some((field) => input?.[field] !== undefined);
}

/**
 * Preserve the legacy boolean shape unless the caller opted into new fields.
 * @param {{ legacy: boolean, optIn: boolean, inputFlags?: object, reply?: boolean }} options — truncation sources
 * @returns {boolean|{ budget: boolean, reply: boolean, context: boolean, untrusted: boolean }} Truncation shape
 */
export function buildTruncated({ legacy, optIn, inputFlags = {}, reply = false }) {
  if (!optIn) return legacy;
  return {
    budget: legacy,
    reply,
    context: Boolean(inputFlags.context),
    untrusted: Boolean(inputFlags.untrusted),
  };
}
