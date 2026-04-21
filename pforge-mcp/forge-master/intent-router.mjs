/**
 * Plan Forge — Forge-Master Intent Router (Phase-28, Slice 2).
 *
 * Two-stage classifier:
 *   1. Keyword regex table (fast path, zero cost)
 *   2. Router-model call (only when keyword match is ambiguous)
 *
 * Lanes:
 *   - build         — user wants to create/add/change a feature → Crucible
 *   - operational    — status, cost, health, memory, watcher queries
 *   - troubleshoot   — bug, incident, failure investigation
 *   - offtopic       — everything outside Plan Forge's domain
 *
 * Exports:
 *   classify(message, opts?) → {lane, confidence, reason, suggestedTools}
 *
 * @module forge-master/intent-router
 */

import { getForgeMasterConfig } from "./config.mjs";

// ─── Lane Constants ─────────────────────────────────────────────────

export const LANES = Object.freeze({
  BUILD: "build",
  OPERATIONAL: "operational",
  TROUBLESHOOT: "troubleshoot",
  OFFTOPIC: "offtopic",
});

// ─── Suggested Tools per Lane ───────────────────────────────────────

export const LANE_TOOLS = Object.freeze({
  [LANES.BUILD]: [
    "forge_crucible_submit",
    "forge_crucible_ask",
    "forge_crucible_preview",
    "forge_crucible_list",
  ],
  [LANES.OPERATIONAL]: [
    "forge_plan_status",
    "forge_phase_status",
    "forge_status",
    "forge_cost_report",
    "forge_estimate_quorum",
    "forge_health_trend",
    "forge_watch",
    "forge_watch_live",
    "brain_recall",
    "forge_memory_report",
    "forge_search",
    "forge_timeline",
  ],
  [LANES.TROUBLESHOOT]: [
    "forge_diagnose",
    "forge_bug_list",
    "forge_watch_live",
    "forge_smith",
    "forge_sweep",
    "forge_analyze",
    "forge_alert_triage",
    "forge_regression_guard",
    "forge_search",
    "forge_timeline",
  ],
  [LANES.OFFTOPIC]: [],
});

// ─── Keyword Regex Table ────────────────────────────────────────────

/**
 * Each entry: { pattern: RegExp, lane: string, weight: number }
 * Higher weight = stronger signal. Evaluated in order; all matches
 * accumulate into a lane score map.
 */
const KEYWORD_RULES = [
  // ── Build signals ──
  { pattern: /\b(i want to|i'd like to|let's|can we|help me)\b.{0,40}\b(build|create|add|implement|develop|introduce|design|scaffold|make)\b/i, lane: LANES.BUILD, weight: 3 },
  { pattern: /\b(new feature|new phase|add.{0,15}(feature|capability|module|component))\b/i, lane: LANES.BUILD, weight: 3 },
  { pattern: /\b(feature request|enhancement|proposal|spec out|plan out)\b/i, lane: LANES.BUILD, weight: 2 },
  { pattern: /\bcrucible\b/i, lane: LANES.BUILD, weight: 2 },
  { pattern: /\b(tweak|refactor|rework|redesign|overhaul)\b/i, lane: LANES.BUILD, weight: 1 },

  // ── Operational signals ──
  { pattern: /\b(status|progress|how.{0,10}(is|are|was|were)|current state)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  { pattern: /\b(cost|spend|budget|price|token|tokens|expense|billing)\b/i, lane: LANES.OPERATIONAL, weight: 3 },
  { pattern: /\b(how much did|how much does|how much will|total cost|cost per)\b/i, lane: LANES.OPERATIONAL, weight: 3 },
  { pattern: /\b(health|watcher|watchers|alert|alerts|trend|trends|metric|metrics)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  { pattern: /\b(memory|memories|recall|remembered|brain)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  { pattern: /\b(plan run|plan status|phase status|slice.{0,5}(passed|failed|done|complete))\b/i, lane: LANES.OPERATIONAL, weight: 3 },
  { pattern: /\b(quorum|quorum mode|estimate|projection)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  { pattern: /\b(extension|extensions|ext search|ext info)\b/i, lane: LANES.OPERATIONAL, weight: 1 },
  { pattern: /\b(deploy journal|runbook|capabilities)\b/i, lane: LANES.OPERATIONAL, weight: 1 },
  { pattern: /\b(drift|diff|hotspot)\b/i, lane: LANES.OPERATIONAL, weight: 1 },

  // ── Troubleshoot signals ──
  { pattern: /\b(fail|failed|failure|failing|broken|broke|crash|crashed)\b/i, lane: LANES.TROUBLESHOOT, weight: 3 },
  { pattern: /\b(bug|bugs|defect|defects|incident|error|errors|exception)\b/i, lane: LANES.TROUBLESHOOT, weight: 3 },
  { pattern: /\b(why did|why does|why is|root cause|diagnose|debug|investigate)\b/i, lane: LANES.TROUBLESHOOT, weight: 2 },
  { pattern: /\b(regression|regressed|test.{0,5}fail|build.{0,5}fail)\b/i, lane: LANES.TROUBLESHOOT, weight: 3 },
  { pattern: /\b(fix|fixing|troubleshoot|trouble|problem|issue)\b/i, lane: LANES.TROUBLESHOOT, weight: 1 },
  { pattern: /\b(what went wrong|not working|doesn't work|stopped working)\b/i, lane: LANES.TROUBLESHOOT, weight: 3 },

  // ── Off-topic signals ──
  { pattern: /\b(weather|temperature|forecast|sports|score|game)\b/i, lane: LANES.OFFTOPIC, weight: 3 },
  { pattern: /\b(recipe|cook|food|restaurant|movie|music|song)\b/i, lane: LANES.OFFTOPIC, weight: 3 },
  { pattern: /\b(joke|funny|tell me a|what is the meaning of life)\b/i, lane: LANES.OFFTOPIC, weight: 2 },
  { pattern: /\b(stock|stocks|crypto|bitcoin|investment|portfolio)\b/i, lane: LANES.OFFTOPIC, weight: 3 },
  { pattern: /\b(write me|generate code|write code|code for)\b/i, lane: LANES.OFFTOPIC, weight: 2 },
];

// ─── Off-Topic Redirect (canned response) ───────────────────────────

export const OFFTOPIC_REDIRECT =
  "I'm scoped to Plan Forge topics — plans, runs, costs, memory, Crucible, " +
  "tempering, watchers, and bug registry. Ask me something in that lane.";

// Confidence thresholds
const HIGH_CONFIDENCE = 0.85;
const AMBIGUOUS_THRESHOLD = 0.55;

// ─── Keyword Classification ─────────────────────────────────────────

/**
 * Score a message against the keyword table.
 * @param {string} message
 * @returns {{ scores: Record<string, number>, totalWeight: number }}
 */
function scoreKeywords(message) {
  const scores = {
    [LANES.BUILD]: 0,
    [LANES.OPERATIONAL]: 0,
    [LANES.TROUBLESHOOT]: 0,
    [LANES.OFFTOPIC]: 0,
  };
  let totalWeight = 0;

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(message)) {
      scores[rule.lane] += rule.weight;
      totalWeight += rule.weight;
    }
  }

  return { scores, totalWeight };
}

/**
 * Derive lane + confidence from keyword scores.
 * @param {{ scores: Record<string, number>, totalWeight: number }} result
 * @returns {{ lane: string, confidence: number } | null}
 */
function deriveFromScores({ scores, totalWeight }) {
  if (totalWeight === 0) return null;

  const sorted = Object.entries(scores)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return null;

  const [topLane, topScore] = sorted[0];
  const confidence = topScore / totalWeight;

  // If the top lane has a clear lead, classify with high confidence
  if (sorted.length === 1 || confidence >= AMBIGUOUS_THRESHOLD) {
    return {
      lane: topLane,
      confidence: Math.min(confidence, HIGH_CONFIDENCE),
    };
  }

  // Multiple lanes scored but no clear winner — ambiguous
  return null;
}

// ─── Router-Model Fallback ──────────────────────────────────────────

const ROUTER_PROMPT = `You are a message classifier for Plan Forge, a software plan orchestration system.

Classify the user's message into exactly ONE lane:
- "build" — the user wants to create, add, implement, or design a new feature, phase, or component
- "operational" — the user asks about status, cost, health, metrics, memory, watchers, extensions, plans, or runs
- "troubleshoot" — the user asks about bugs, failures, errors, incidents, regressions, or root causes
- "offtopic" — the message is unrelated to Plan Forge (weather, personal questions, code generation, etc.)

Respond with ONLY a JSON object: {"lane": "<lane>"}
Do not include any other text.

User message: `;

/**
 * Call the router model for ambiguous classification.
 * @param {string} message
 * @param {{ callApiWorker: Function, routerModel: string, routerProvider: object }} deps
 * @returns {Promise<string|null>} lane name or null on failure
 */
async function callRouterModel(message, deps) {
  try {
    const result = await deps.callApiWorker(
      ROUTER_PROMPT + JSON.stringify(message),
      deps.routerModel,
      deps.routerProvider,
      { timeout: 15_000, role: "forge-master-router" },
    );

    if (!result?.output) return null;

    const text = result.output.trim();
    // Try JSON parse first
    try {
      const parsed = JSON.parse(text);
      if (parsed.lane && Object.values(LANES).includes(parsed.lane)) {
        return parsed.lane;
      }
    } catch { /* not JSON, try regex extraction */ }

    // Fallback: look for a lane name in the output
    for (const lane of Object.values(LANES)) {
      if (text.toLowerCase().includes(lane)) return lane;
    }

    return null;
  } catch {
    return null; // graceful degradation — keyword-only
  }
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Classify a user message into one of four lanes.
 *
 * Stage 1: keyword regex table (fast, zero cost).
 * Stage 2: router-model call (only when keywords are ambiguous).
 * Fallback: if router model unavailable, falls back to keyword-only
 *           with reduced confidence.
 *
 * @param {string} message — the user's input text
 * @param {{
 *   cwd?: string,
 *   callApiWorker?: Function,
 *   detectApiProvider?: Function,
 * }} [opts]
 * @returns {Promise<{
 *   lane: string,
 *   confidence: number,
 *   reason: string,
 *   suggestedTools: string[],
 * }>}
 */
export async function classify(message, opts = {}) {
  if (!message || typeof message !== "string" || !message.trim()) {
    return {
      lane: LANES.OFFTOPIC,
      confidence: 1.0,
      reason: "empty_message",
      suggestedTools: LANE_TOOLS[LANES.OFFTOPIC],
    };
  }

  const trimmed = message.trim();

  // Stage 1: keyword scoring
  const kwResult = scoreKeywords(trimmed);
  const kwClassification = deriveFromScores(kwResult);

  if (kwClassification) {
    return {
      lane: kwClassification.lane,
      confidence: kwClassification.confidence,
      reason: "keyword_match",
      suggestedTools: LANE_TOOLS[kwClassification.lane],
    };
  }

  // No keyword match or ambiguous — try router model
  if (opts.callApiWorker && opts.detectApiProvider) {
    const config = getForgeMasterConfig({ cwd: opts.cwd });
    const routerProvider = opts.detectApiProvider(config.routerModel);

    if (routerProvider) {
      const modelLane = await callRouterModel(trimmed, {
        callApiWorker: opts.callApiWorker,
        routerModel: config.routerModel,
        routerProvider,
      });

      if (modelLane) {
        return {
          lane: modelLane,
          confidence: 0.75,
          reason: "router_model",
          suggestedTools: LANE_TOOLS[modelLane],
        };
      }
    }
  }

  // Fallback: if keywords scored anything at all, pick top with low confidence
  if (kwResult.totalWeight > 0) {
    const sorted = Object.entries(kwResult.scores)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]);
    const topLane = sorted[0][0];
    return {
      lane: topLane,
      confidence: 0.4,
      reason: "keyword_weak",
      suggestedTools: LANE_TOOLS[topLane],
    };
  }

  // No signals at all — default to offtopic
  return {
    lane: LANES.OFFTOPIC,
    confidence: 0.5,
    reason: "no_signals",
    suggestedTools: LANE_TOOLS[LANES.OFFTOPIC],
  };
}
