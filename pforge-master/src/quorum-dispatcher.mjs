/**
 * Plan Forge — Forge-Master Quorum Dispatcher (Phase-38.7, Slice 1).
 *
 * Dispatches a single prompt to multiple models in parallel and collects
 * replies with a dissent summary.  Used by the advisory quorum path in
 * reasoning.mjs when the user enables quorum advisory mode.
 *
 * Exports:
 *   - dispatchQuorum({ prompt, models, deps }) → QuorumResult
 *   - extractDissent(replies)                  → { topic, axis }
 *   - MAX_MODELS                               — hard cap (3)
 *   - TIMEOUT_MS                               — per-call timeout (60 000 ms)
 *
 * @module forge-master/quorum-dispatcher
 */

import { computeTurnCost } from "./cost.mjs";

// ─── Constants ──────────────────────────────────────────────────────

export const MAX_MODELS = 3;
export const TIMEOUT_MS = 60_000;

// ─── Stopwords for dissent extraction ───────────────────────────────

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "and", "but", "or", "nor", "not", "so", "yet", "both",
  "either", "neither", "each", "every", "all", "any", "few", "more",
  "most", "other", "some", "such", "no", "only", "own", "same", "than",
  "too", "very", "just", "because", "if", "when", "while", "that",
  "which", "who", "whom", "this", "these", "those", "i", "you", "he",
  "she", "it", "we", "they", "me", "him", "her", "us", "them", "my",
  "your", "his", "its", "our", "their", "what", "how", "about",
]);

// ─── Dissent Extraction ─────────────────────────────────────────────

/**
 * Extract first N words from text, normalized (lowercase, no punctuation).
 * @param {string} text
 * @param {number} [n=50]
 * @returns {string[]}
 */
function extractWords(text, n = 50) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .slice(0, n);
}

/**
 * Compute dissent summary from an array of reply objects.
 *
 * Uses a simple keyword-diff approach on the first 50 meaningful words
 * of each reply.  If the word-set Jaccard distance exceeds 0.5, reports
 * the most divergent terms.
 *
 * @param {Array<{ model: string, text: string }>} replies
 * @returns {{ topic: string, axis: string }}
 */
export function extractDissent(replies) {
  if (!replies || replies.length < 2) {
    return { topic: "", axis: "" };
  }

  const wordSets = replies.map((r) => new Set(extractWords(r.text)));

  // Pairwise Jaccard distance — find the most divergent pair
  let maxDistance = 0;
  let pairA = 0;
  let pairB = 1;

  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const union = new Set([...wordSets[i], ...wordSets[j]]);
      const intersection = [...wordSets[i]].filter((w) => wordSets[j].has(w));
      const distance = union.size === 0 ? 0 : 1 - intersection.length / union.size;
      if (distance > maxDistance) {
        maxDistance = distance;
        pairA = i;
        pairB = j;
      }
    }
  }

  if (maxDistance <= 0.5) {
    return { topic: "", axis: "" };
  }

  // Find words unique to each side of the most divergent pair
  const uniqueA = [...wordSets[pairA]].filter((w) => !wordSets[pairB].has(w)).slice(0, 5);
  const uniqueB = [...wordSets[pairB]].filter((w) => !wordSets[pairA].has(w)).slice(0, 5);

  return {
    topic: "recommendation",
    axis: `${replies[pairA].model} emphasizes [${uniqueA.join(", ")}] vs ${replies[pairB].model} emphasizes [${uniqueB.join(", ")}]`,
  };
}

// ─── Quorum Dispatcher ─────────────────────────────────────────────

/**
 * Dispatch a prompt to multiple models in parallel and collect replies.
 *
 * @param {{
 *   prompt: string,
 *   models: Array<{ model: string, provider: string, apiKey?: string }>,
 *   deps: {
 *     selectProvider: (name: string) => Promise<{ sendTurn: Function } | null>,
 *     systemPrompt?: string,
 *     timeoutMs?: number,
 *   }
 * }} opts
 * @returns {Promise<{
 *   replies: Array<{ model: string, text: string, durationMs: number, costUSD: number }>,
 *   dissent: { topic: string, axis: string }
 * }>}
 */
export async function dispatchQuorum({ prompt, models, deps }) {
  const effectiveModels = (models || []).slice(0, MAX_MODELS);
  const timeoutMs = deps?.timeoutMs ?? TIMEOUT_MS;
  const systemPrompt = deps?.systemPrompt ?? "You are a helpful assistant.";

  if (effectiveModels.length === 0) {
    return { replies: [], dissent: { topic: "all-failed", axis: "" } };
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  // Dispatch each model call in parallel with individual timeouts
  const tasks = effectiveModels.map(async (entry) => {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const provider = await deps.selectProvider(entry.provider);
      if (!provider) {
        throw new Error(`provider "${entry.provider}" not available`);
      }

      const response = await Promise.race([
        provider.sendTurn({
          messages,
          tools: [],
          model: entry.model,
          apiKey: entry.apiKey || "",
          signal: controller.signal,
        }),
        new Promise((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error("quorum_timeout")),
          );
        }),
      ]);

      // Only accept actual reply responses — rate_limited, tool_calls, etc. are failures
      if (!response || response.type !== "reply" || typeof response.content !== "string") {
        throw new Error(`unexpected response type: ${response?.type ?? "null"}`);
      }

      const durationMs = Date.now() - start;
      const costUSD = computeTurnCost(entry.model, response.tokensIn || 0, response.tokensOut || 0);

      return {
        model: entry.model,
        text: response.content,
        durationMs,
        costUSD,
      };
    } catch {
      return null; // Mark as failed
    } finally {
      clearTimeout(timer);
    }
  });

  const results = await Promise.allSettled(tasks);

  const replies = results
    .filter((r) => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);

  if (replies.length === 0) {
    return { replies: [], dissent: { topic: "all-failed", axis: "" } };
  }

  const dissent = extractDissent(replies);

  return { replies, dissent };
}
