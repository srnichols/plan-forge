/**
 * Plan Forge — Forge-Master Memory Retrieval (Phase-28, Slice 3).
 *
 * Reads L1 session history, L2 project digests, L3 cross-project topics;
 * formats into a markdown block capped at 4000 tokens; truncates by
 * dropping sections in order L3 → L2 → L1 (least-specific first).
 *
 * The returned `contextBlock` is the *body* only — the system prompt
 * already contains the `## Current Context` heading and `{context_block}`
 * placeholder.
 *
 * @module forge-master/retrieval
 */

import { recall } from "../../pforge-mcp/brain.mjs";
import { getForgeMasterConfig } from "./config.mjs";

// ─── Constants ──────────────────────────────────────────────────────

const TOKEN_CAP = 4000;
const CHARS_PER_TOKEN = 4;
const CHAR_CAP = TOKEN_CAP * CHARS_PER_TOKEN;

// L1 keys — session-scoped, need runId
const L1_KEYS = Object.freeze([
  "session.history",
  "session.context",
]);

// L2 keys per lane — only fetch what's relevant
const L2_KEYS_BY_LANE = Object.freeze({
  build:        ["project.run.latest", "project.crucible"],
  operational:  ["project.run.latest", "project.tempering.state"],
  troubleshoot: ["project.run.latest", "project.tempering.state", "project.liveguard.incidents"],
  offtopic:     ["project.run.latest"],
});
const L2_KEYS_DEFAULT = Object.freeze(["project.run.latest", "project.tempering.state"]);

// L3 keys — cross-project, only when l3Enabled
const L3_KEYS = Object.freeze([
  "cross.pattern.recent",
  "cross.convention.recent",
]);

// ─── Summarizers ────────────────────────────────────────────────────

function summarizeValue(key, value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const items = value.slice(-5); // keep most recent entries
    return items.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join("\n");
  }
  // Objects — extract summary fields if available, else compact JSON
  if (typeof value === "object") {
    if (value.summary) return String(value.summary);
    if (value.status && value.plan) {
      return `Plan: ${value.plan} | Status: ${value.status}`;
    }
    const json = JSON.stringify(value, null, 0);
    return json.length > 500 ? json.slice(0, 497) + "..." : json;
  }
  return String(value);
}

// ─── Token Estimation ───────────────────────────────────────────────

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ─── Section Builder ────────────────────────────────────────────────

function buildSection(tier, entries) {
  const filtered = entries.filter((e) => e.text != null);
  if (filtered.length === 0) return null;
  const label = tier === "l1" ? "Session" : tier === "l2" ? "Project" : "Cross-Project";
  const lines = [`### ${label}`, ""];
  for (const { key, text } of filtered) {
    lines.push(`**${key}**: ${text}`);
  }
  return lines.join("\n");
}

// ─── Truncation ─────────────────────────────────────────────────────

/**
 * Truncate sections to fit within CHAR_CAP.
 * Drops sections in order: L3 → L2 → L1 (least-specific first).
 * Within a section, drops oldest entries first.
 */
function truncateSections(l1Section, l2Section, l3Section) {
  const sections = [];
  if (l3Section) sections.push({ tier: "l3", text: l3Section });
  if (l2Section) sections.push({ tier: "l2", text: l2Section });
  if (l1Section) sections.push({ tier: "l1", text: l1Section });

  let total = sections.reduce((sum, s) => sum + s.text.length, 0);

  // Drop whole sections from the front (L3 first, then L2) until we fit
  while (total > CHAR_CAP && sections.length > 1) {
    const dropped = sections.shift();
    total -= dropped.text.length;
  }

  // If still over cap, hard-truncate the remaining section
  if (total > CHAR_CAP && sections.length === 1) {
    sections[0].text = sections[0].text.slice(0, CHAR_CAP - 20) + "\n\n*(truncated)*";
  }

  // Rebuild in display order: L1 → L2 → L3
  const ordered = [];
  for (const tier of ["l1", "l2", "l3"]) {
    const found = sections.find((s) => s.tier === tier);
    if (found) ordered.push(found.text);
  }
  return ordered.join("\n\n");
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Fetch context from all brain tiers and format as a markdown block.
 *
 * @param {{ sessionId?: string, lane?: string, cwd?: string }} opts
 * @param {{ recall?: Function, getForgeMasterConfig?: Function }} [deps] — DI overrides
 * @returns {Promise<{ contextBlock: string, sources: { l1: string[], l2: string[], l3: string[] } }>}
 */
export async function fetchContext(opts = {}, deps = {}) {
  const { sessionId, lane, cwd } = opts;
  const doRecall = deps.recall || recall;
  const getConfig = deps.getForgeMasterConfig || getForgeMasterConfig;

  const config = getConfig({ cwd });
  const sources = { l1: [], l2: [], l3: [] };

  // ── L1: session-scoped ────────────────────────────────────────────
  const l1Entries = [];
  for (const key of L1_KEYS) {
    try {
      const value = await doRecall(key, { runId: sessionId }, { cwd });
      const text = summarizeValue(key, value);
      if (text) {
        l1Entries.push({ key, text });
        sources.l1.push(key);
      }
    } catch { /* non-fatal — best-effort retrieval */ }
  }

  // ── L2: project-scoped, lane-aware ────────────────────────────────
  const l2Keys = L2_KEYS_BY_LANE[lane] || L2_KEYS_DEFAULT;
  const l2Entries = [];
  for (const key of l2Keys) {
    try {
      const value = await doRecall(key, {}, { cwd });
      const text = summarizeValue(key, value);
      if (text) {
        l2Entries.push({ key, text });
        sources.l2.push(key);
      }
    } catch { /* non-fatal */ }
  }

  // ── L3: cross-project (only when enabled) ─────────────────────────
  const l3Entries = [];
  if (config.l3Enabled) {
    for (const key of L3_KEYS) {
      try {
        const value = await doRecall(key, { scope: "cross" }, { cwd });
        const text = summarizeValue(key, value);
        if (text) {
          l3Entries.push({ key, text });
          sources.l3.push(key);
        }
      } catch { /* non-fatal */ }
    }
  }

  // ── Format & truncate ─────────────────────────────────────────────
  const l1Section = buildSection("l1", l1Entries);
  const l2Section = buildSection("l2", l2Entries);
  const l3Section = buildSection("l3", l3Entries);

  const contextBlock = truncateSections(l1Section, l2Section, l3Section);

  return { contextBlock, sources };
}

// Exported for testing
export { TOKEN_CAP, CHARS_PER_TOKEN, L1_KEYS, L2_KEYS_BY_LANE, L3_KEYS, estimateTokens, summarizeValue };
