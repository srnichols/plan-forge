/**
 * Forge-Master hammer harness scorers (Phase-37.2).
 *
 * Each scorer is a pure function:
 *   (promptRecord, sseEvents) → { pass: boolean, reason: string }
 *
 * promptRecord shape (from scenario JSON):
 *   { id, message, expectedLane?, expectedTools?, mustContain?, mustNotContain? }
 *
 * sseEvents shape (from sse-client.mjs openStream):
 *   Array<{ event: string, data: any }>
 *
 * @module hammer-fm/scorers
 */

// ── Helpers ────────────────────────────────────────────────────────

function _findEvent(events, type) {
  return events.find((e) => e.event === type) ?? null;
}

function _allEvents(events, type) {
  return events.filter((e) => e.event === type);
}

// ── Scorer: lane-match ─────────────────────────────────────────────

/**
 * Pass when the SSE `classification` event lane matches expectedLane.
 * Skipped (pass) when no expectedLane is set on the prompt record.
 */
export function laneMatch(promptRecord, events) {
  if (!promptRecord.expectedLane) {
    return { pass: true, reason: "no expectedLane constraint" };
  }
  const cls = _findEvent(events, "classification");
  if (!cls) {
    return { pass: false, reason: "no classification event received" };
  }
  const got = cls.data?.lane;
  if (got === promptRecord.expectedLane) {
    return { pass: true, reason: `lane=${got}` };
  }
  return {
    pass: false,
    reason: `expected lane=${promptRecord.expectedLane}, got lane=${got ?? "?"}`,
  };
}

// ── Scorer: tool-set-overlap ───────────────────────────────────────

/**
 * Pass when at least one expectedTool appears in tool-call events.
 * Skipped (pass) when no expectedTools are set or the array is empty.
 */
export function toolSetOverlap(promptRecord, events) {
  const expected = promptRecord.expectedTools;
  if (!expected || expected.length === 0) {
    return { pass: true, reason: "no expectedTools constraint" };
  }
  const toolEvents = _allEvents(events, "tool-call");
  const calledNames = new Set(
    toolEvents.map((e) => e.data?.name || e.data?.tool || "").filter(Boolean),
  );
  const overlap = expected.filter((t) => calledNames.has(t));
  if (overlap.length > 0) {
    return { pass: true, reason: `matched: ${overlap.join(", ")}` };
  }
  return {
    pass: false,
    reason: `expected one of [${expected.join(", ")}], saw [${[...calledNames].join(", ") || "none"}]`,
  };
}

// ── Scorer: reply-contains ─────────────────────────────────────────

/**
 * Pass when all mustContain strings are found in the reply (case-insensitive).
 * Skipped (pass) when mustContain is null/empty.
 */
export function replyContains(promptRecord, events) {
  const mustContain = promptRecord.mustContain;
  if (!mustContain || mustContain.length === 0) {
    return { pass: true, reason: "no mustContain constraint" };
  }
  const reply = _findEvent(events, "reply")?.data?.content ?? "";
  const lower = reply.toLowerCase();
  const missing = mustContain.filter((s) => !lower.includes(s.toLowerCase()));
  if (missing.length === 0) {
    return { pass: true, reason: "all mustContain strings found" };
  }
  return { pass: false, reason: `missing in reply: ${missing.join(", ")}` };
}

// ── Scorer: reply-not-contains ─────────────────────────────────────

/**
 * Pass when none of the mustNotContain strings appear in the reply.
 * Skipped (pass) when mustNotContain is null/empty.
 */
export function replyNotContains(promptRecord, events) {
  const mustNotContain = promptRecord.mustNotContain;
  if (!mustNotContain || mustNotContain.length === 0) {
    return { pass: true, reason: "no mustNotContain constraint" };
  }
  const reply = _findEvent(events, "reply")?.data?.content ?? "";
  const lower = reply.toLowerCase();
  const found = mustNotContain.filter((s) => lower.includes(s.toLowerCase()));
  if (found.length === 0) {
    return { pass: true, reason: "no forbidden strings found" };
  }
  return { pass: false, reason: `forbidden strings in reply: ${found.join(", ")}` };
}

// ── Scorer: tool-success-rate ──────────────────────────────────────

/**
 * Pass when ≥50% of tool-call events had successful results.
 * A tool call is considered a failure if resultSummary contains known error patterns.
 * Skipped (pass) when no tool calls occurred.
 */
export function toolSuccessRate(promptRecord, events) {
  const toolEvents = _allEvents(events, "tool-call");
  if (toolEvents.length === 0) {
    return { pass: true, reason: "no tool calls" };
  }
  const FAILURE_STRINGS = ["unknown tool", "requires async dispatch", '"success":false'];
  const successes = toolEvents.filter((e) => {
    const rs = e.data?.resultSummary;
    if (rs == null) return true;
    if (typeof rs === "string") {
      const lower = rs.toLowerCase();
      return !FAILURE_STRINGS.some((f) => lower.includes(f.toLowerCase()));
    }
    if (typeof rs === "object") return rs.success !== false;
    return true;
  });
  const rate = successes.length / toolEvents.length;
  if (rate >= 0.5) {
    return {
      pass: true,
      reason: `${successes.length}/${toolEvents.length} succeeded (rate=${rate.toFixed(2)})`,
    };
  }
  return {
    pass: false,
    reason: `only ${successes.length}/${toolEvents.length} succeeded (rate=${rate.toFixed(2)})`,
  };
}

// ── Scorer: no-error-events ────────────────────────────────────────

/**
 * Pass when no SSE `error` events were received.
 */
export function noErrorEvents(promptRecord, events) {
  const errorEvts = _allEvents(events, "error");
  if (errorEvts.length === 0) {
    return { pass: true, reason: "no error events" };
  }
  const first = JSON.stringify(errorEvts[0]?.data ?? "").slice(0, 200);
  return {
    pass: false,
    reason: `${errorEvts.length} error event(s): ${first}`,
  };
}

// ── Scorer registry ────────────────────────────────────────────────

export const ALL_SCORERS = Object.freeze([
  { name: "lane-match", fn: laneMatch },
  { name: "tool-set-overlap", fn: toolSetOverlap },
  { name: "reply-contains", fn: replyContains },
  { name: "reply-not-contains", fn: replyNotContains },
  { name: "tool-success-rate", fn: toolSuccessRate },
  { name: "no-error-events", fn: noErrorEvents },
]);
