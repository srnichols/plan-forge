/**
 * Observer prompt — "narrate notable patterns" (Phase-39, Slice 7).
 *
 * Distinct from runTurn()'s Q&A prompt: shorter, event-batch-aware,
 * narrator-focused. No principles block, no context_block — the hub
 * event batch IS the context.
 *
 * Exports:
 *   OBSERVER_SYSTEM_PROMPT  — static system prompt string
 *   formatBatchMessage(batch) → string
 *   buildObserverPrompt(batch) → { systemPrompt, userMessage }
 *
 * @module forge-master/observer-prompt
 */

export const OBSERVER_SYSTEM_PROMPT = `\
You are the **Plan Forge Observer**, a lightweight narration agent that monitors live pipeline events.

## Your job

You receive a batch of hub events from an active Plan Forge run. Narrate notable patterns in \
2–5 sentences of plain prose, directed at a developer monitoring their pipeline.

Say **"N routine events — nothing notable."** when the batch contains no signal worth surfacing.

## Rules

- Be concise. 200 words maximum.
- Focus on patterns, not individual events. One gate failure in 20 events is noise; five in a row is a pattern.
- Never fabricate data. Only narrate what the event batch shows.
- Do not give advice unless a clear, actionable observation exists \
(e.g., a recurring gate failure on the same slice).
- You may call a tool when you genuinely need external context to interpret an anomaly, \
but prefer narrating from the batch alone.
- You are strictly read-only. Never call write tools.
`;

/**
 * Build a compact, LLM-friendly description of a hub event batch.
 *
 * Each event line includes: timestamp, type, and selected notable fields
 * (sliceId, planId, costUSD, error, retryCount). Unknown fields are omitted
 * to keep the message bounded.
 *
 * @param {object[]} batch
 * @returns {string}
 */
export function formatBatchMessage(batch) {
  if (!Array.isArray(batch) || batch.length === 0) {
    return "Batch: 0 events — nothing to narrate.";
  }

  const lines = batch.map((e, i) => {
    const ts = e.timestamp
      ? `[${String(e.timestamp).slice(0, 24)}]`
      : `[event-${i + 1}]`;
    const type = e.type || "unknown";
    const extras = [];
    if (e.sliceId != null) extras.push(`slice: ${e.sliceId}`);
    if (e.planId != null) extras.push(`plan: ${e.planId}`);
    if (e.costUSD != null) extras.push(`cost: $${Number(e.costUSD).toFixed(6)}`);
    if (e.error) extras.push(`error: ${String(e.error).slice(0, 80)}`);
    if (e.retryCount != null) extras.push(`retry: ${e.retryCount}`);
    return `${ts} ${type}${extras.length ? ` (${extras.join(", ")})` : ""}`;
  });

  return `Batch: ${batch.length} hub event${batch.length === 1 ? "" : "s"}\n\n${lines.join("\n")}`;
}

/**
 * Build the full observer prompt pair for a model narration turn.
 *
 * @param {object[]} batch  Array of hub events from the observer loop.
 * @returns {{ systemPrompt: string, userMessage: string }}
 */
export function buildObserverPrompt(batch) {
  return {
    systemPrompt: OBSERVER_SYSTEM_PROMPT,
    userMessage: formatBatchMessage(batch),
  };
}
