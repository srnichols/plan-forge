import { createHash } from "node:crypto";
import { FORGE_MASTER_INSIGHT_EVENT, INSIGHT_SEVERITIES } from "../../pforge-mcp/enums.mjs";
import { ACTION_TYPES, extractFencedJson, validateArgs } from "./proposed-actions.mjs";

export const INSIGHTS_TAG = "forge-insights";
export const INSIGHT_LIMITS = Object.freeze({
  summaryChars: 200,
  maxEvidence: 5,
  maxPerTurn: 5,
  ringSize: 50,
  defaultPage: 10,
  maxPage: 25,
  refChars: 200,
  eventTypeChars: 80,
  runIdChars: 80,
});
export const EMPTY_INSIGHTS_MESSAGE =
  "No observer insights retained yet — the observer has not emitted structured insights since this process started. Start it with action:'start' and wait for a notable batch.";

const FENCE = "`".repeat(3);
const FINGERPRINT_HEX_LENGTH = 16;

/**
 * Build instructions for the observer's optional structured insight output.
 * @returns {string}
 */
export function buildInsightsInstruction() {
  return [
    "When something is notable, write 2–5 sentences of prose and optionally include at most one forge-insights JSON-array block. Do not emit a block when there is nothing notable.",
    "Each array item has this shape: {severity, summary, evidence:[{eventType, ref}], suggestedAction:{type,args}|null}.",
    "A suggestedAction is a recommendation only; it will never be dispatched. Do not supply an id; the system assigns one.",
    `${FENCE}${INSIGHTS_TAG}`,
    '[{"severity":"warn","summary":"Repeated gate failures","evidence":[{"eventType":"gate-failed","ref":"slice-2"}],"suggestedAction":null}]',
    FENCE,
  ].join("\n");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function buildValidatedInsight(item) {
  if (
    !isPlainObject(item) ||
    !INSIGHT_SEVERITIES.includes(item.severity) ||
    typeof item.summary !== "string" ||
    !item.summary.trim()
  ) return null;

  const summary = item.summary.trim().slice(0, INSIGHT_LIMITS.summaryChars);
  const evidence = Array.isArray(item.evidence)
    ? item.evidence
      .filter((entry) => isPlainObject(entry) && typeof entry.eventType === "string" && typeof entry.ref === "string")
      .slice(0, INSIGHT_LIMITS.maxEvidence)
      .map(({ eventType, ref }) => ({
        eventType: eventType.slice(0, INSIGHT_LIMITS.eventTypeChars),
        ref: ref.slice(0, INSIGHT_LIMITS.refChars),
      }))
    : [];
  const action = isPlainObject(item.suggestedAction) ? item.suggestedAction : null;
  const args = action && ACTION_TYPES.includes(action.type) ? validateArgs(action.type, action.args) : null;
  const insight = {
    severity: item.severity,
    summary,
    evidence,
    suggestedAction: args ? { type: action.type, args } : null,
  };
  insight.id = fingerprintInsight(insight);
  return insight;
}

/**
 * Validate and bound model-provided observer insights.
 * @param {unknown} raw
 * @returns {{ insights: Array<object>, dropped: number }}
 */
export function validateInsights(raw) {
  if (!Array.isArray(raw)) return { insights: [], dropped: 0 };
  const insights = [];
  let dropped = 0;

  for (const item of raw) {
    if (insights.length >= INSIGHT_LIMITS.maxPerTurn) {
      dropped += 1;
      continue;
    }
    const insight = buildValidatedInsight(item);
    if (!insight) dropped += 1;
    else insights.push(insight);
  }

  return { insights, dropped };
}

/**
 * Produce a stable identifier for equivalent insight patterns across runs.
 * @param {{ severity: string, summary: string, evidence?: Array<{ eventType: string }> }} insight
 * @returns {string}
 */
export function fingerprintInsight({ severity, summary, evidence = [] }) {
  const normalizedSummary = String(summary).toLowerCase().replace(/\s+/g, " ").trim();
  const eventTypes = evidence.map(({ eventType }) => eventType).sort().join("|");
  const input = `${severity}|${normalizedSummary}|${eventTypes}`;
  return `fmi-${createHash("sha256").update(input).digest("hex").slice(0, FINGERPRINT_HEX_LENGTH)}`;
}

/**
 * Remove tagged insight blocks while retaining prose replies byte-for-byte.
 * @param {string} reply
 * @returns {{ insights: Array<object>, narration: string, found: boolean }}
 */
export function finalizeInsights(reply) {
  const original = typeof reply === "string" ? reply : String(reply ?? "");
  const extracted = extractFencedJson(original, INSIGHTS_TAG);
  if (!extracted.found) return { insights: [], narration: original, found: false };
  return {
    insights: validateInsights(extracted.data).insights,
    narration: extracted.reply,
    found: true,
  };
}

/**
 * Create a bounded, in-memory insight history.
 * @param {{ size?: number }} options
 * @returns {{ push: Function, page: Function, size: Function, clear: Function }}
 */
export function createInsightRing({ size = INSIGHT_LIMITS.ringSize } = {}) {
  const entries = [];
  let sequence = 0;
  let evicted = 0;
  const capacity = Number.isInteger(size) && size > 0 ? size : INSIGHT_LIMITS.ringSize;

  function push(insight, meta = {}) {
    const ts = typeof meta.ts === "string" ? meta.ts : new Date().toISOString();
    const existing = entries.find((entry) => entry.insight.id === insight.id);
    if (existing) {
      existing.count += 1;
      existing.lastSeenAt = ts;
      return existing;
    }

    const entry = {
      seq: ++sequence,
      insight,
      ...(typeof meta.runId === "string" && meta.runId && { runId: meta.runId.slice(0, INSIGHT_LIMITS.runIdChars) }),
      ts,
      count: 1,
      lastSeenAt: ts,
    };
    entries.push(entry);
    if (entries.length > capacity) {
      entries.shift();
      evicted += 1;
    }
    return entry;
  }

  function page({ limit = INSIGHT_LIMITS.defaultPage, cursor } = {}) {
    const pageLimit = Math.min(INSIGHT_LIMITS.maxPage, Math.max(1, limit));
    const before = cursor === undefined || cursor === null ? Infinity : Number(cursor);
    const ordered = [...entries].sort((a, b) => b.seq - a.seq);
    const eligible = ordered.filter((entry) => entry.seq < before);
    const selected = eligible.slice(0, pageLimit);
    const hasMore = eligible.length > selected.length;
    return {
      ok: true,
      insights: selected,
      total: entries.length,
      limit: pageLimit,
      cursor: cursor ?? null,
      nextCursor: hasMore ? String(selected.at(-1).seq) : null,
      hasMore,
      truncated: evicted > 0,
      ...(!entries.length && { message: EMPTY_INSIGHTS_MESSAGE }),
      ...(entries.length && !selected.length && { message: "No observer insights are available on this page. Use an earlier cursor to view retained entries." }),
    };
  }

  return {
    push,
    page,
    size: () => entries.length,
    clear: () => {
      entries.length = 0;
      evicted = 0;
    },
  };
}

export const insightRing = createInsightRing();

/**
 * Return a bounded page from the retained observer insights.
 * @param {{ limit?: number, cursor?: string|null }} options
 * @param {ReturnType<typeof createInsightRing>} ring
 * @returns {object}
 */
export function paginateInsights({ limit, cursor } = {}, ring = insightRing) {
  if (limit !== undefined && !Number.isInteger(limit)) {
    return { ok: false, error: "INVALID_INPUT", message: "limit must be an integer." };
  }
  if (cursor !== undefined && cursor !== null && (typeof cursor !== "string" || !/^\d+$/.test(cursor))) {
    return { ok: false, error: "INVALID_INPUT", message: "cursor must be a numeric string." };
  }
  const pageLimit = limit === undefined ? INSIGHT_LIMITS.defaultPage : Math.min(INSIGHT_LIMITS.maxPage, Math.max(1, limit));
  return ring.page({ limit: pageLimit, cursor });
}

/**
 * Build an event envelope for one structured observer insight.
 * @param {object} insight
 * @param {{ runId?: string, ts?: string }} meta
 * @returns {object}
 */
export function buildInsightEvent(insight, { runId, ts = new Date().toISOString() } = {}) {
  return {
    type: FORGE_MASTER_INSIGHT_EVENT,
    ts,
    source: "forge-master",
    ...(typeof runId === "string" && runId.trim() && { runId: runId.slice(0, INSIGHT_LIMITS.runIdChars) }),
    insight,
  };
}

function getBatchRunId(batch) {
  if (!Array.isArray(batch) || batch.length === 0) return undefined;
  const candidate = batch[0]?.runId;
  if (typeof candidate !== "string" || !candidate.trim()) return undefined;
  return batch.every((event) => event?.runId === candidate) ? candidate : undefined;
}

function broadcastInsight(hub, insight, meta) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast(buildInsightEvent(insight, meta));
  } catch (error) {
    console.error(`forge-master: observer insight broadcast failed: ${error?.message ?? String(error)}`);
  }
}

/**
 * Retain and broadcast structured insights without making broadcast a turn failure.
 * @param {{ hub?: object|null, batch?: object[], insights?: object[], ring?: ReturnType<typeof createInsightRing> }} options
 */
export function emitObserverInsights({ hub, batch = [], insights = [], ring = insightRing } = {}) {
  if (!insights.length) return;
  const runId = getBatchRunId(batch);
  const ts = new Date().toISOString();

  for (const insight of insights) {
    ring.push(insight, { runId, ts });
    broadcastInsight(hub, insight, { runId, ts });
  }
}
