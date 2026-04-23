/**
 * Plan Forge — Forge-Master Intent Router (Phase-28, Slice 2).
 *
 * Two-stage classifier:
 *   1. Keyword regex table (fast path, zero cost)
 *   2. Router-model call (only when keyword match is ambiguous)
 *
 * Lanes:
 *   - build              — user wants to create/add/change a feature → Crucible
 *   - operational        — status, cost, health, memory, watcher queries
 *   - troubleshoot       — bug, incident, failure investigation
 *   - offtopic           — everything outside Plan Forge's domain
 *   - advisory           — architectural guidance and principled recommendations
 *   - tempering          — tempering gate evaluation and enforcement checks
 *   - principle-judgment — principled architectural decisions and principle reviews
 *   - meta-bug-triage    — triage of meta-bugs, self-repair, plan/orchestrator defects
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
  ADVISORY: "advisory",
  TEMPERING: "tempering",
  PRINCIPLE_JUDGMENT: "principle-judgment",
  META_BUG_TRIAGE: "meta-bug-triage",
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
  [LANES.ADVISORY]: [
    "forge_search",
    "forge_timeline",
    "brain_recall",
    "forge_capabilities",
    "forge_hotspot",
    "forge_drift_report",
    "forge_plan_status",
    "forge_cost_report",
  ],
  [LANES.TEMPERING]: [],
  [LANES.PRINCIPLE_JUDGMENT]: [],
  [LANES.META_BUG_TRIAGE]: [],
});

// ─── Lane Descriptors ────────────────────────────────────────────────

/**
 * Per-lane metadata used by the reasoning loop.
 * `recommendedTierBump: 1` marks lanes as high-stakes — the reasoning loop
 * will auto-escalate to the next higher tier when it receives a message in
 * one of these lanes (unless the caller opts out via `autoEscalate: false`).
 */
export const LANE_DESCRIPTORS = Object.freeze({
  [LANES.BUILD]:              { recommendedTierBump: 0 },
  [LANES.OPERATIONAL]:        { recommendedTierBump: 0 },
  [LANES.TROUBLESHOOT]:       { recommendedTierBump: 0 },
  [LANES.OFFTOPIC]:           { recommendedTierBump: 0 },
  [LANES.ADVISORY]:           { recommendedTierBump: 0 },
  [LANES.TEMPERING]:          { recommendedTierBump: 1 },
  [LANES.PRINCIPLE_JUDGMENT]: { recommendedTierBump: 1 },
  [LANES.META_BUG_TRIAGE]:    { recommendedTierBump: 1 },
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
  // Combined "why + fail" is a very strong investigation signal (outweighs phase/slice operational terms)
  { pattern: /\b(why did|why does|why is)\b.{0,60}\b(fail|failed|failure|error|crash)\b/i, lane: LANES.TROUBLESHOOT, weight: 4 },
  // ── Phase-32 Slice 2: meta-bug / self-repair family → strong troubleshoot signal
  { pattern: /\b(meta[-\s]?bug|self[-\s]?repair|plan[-\s]?defect|orchestrator[-\s]?defect|prompt[-\s]?defect)\b/i, lane: LANES.TROUBLESHOOT, weight: 3 },

  // ── Tempering lane signals ─────────────────────────────────────────
  { pattern: /\btempering\s+(gate|evaluation|check|enforcement)\b/i, lane: LANES.TEMPERING, weight: 4 },
  { pattern: /\b(run|evaluate|execute)\s+(a\s+)?tempering\b/i, lane: LANES.TEMPERING, weight: 3 },

  // ── Principle-judgment lane signals ───────────────────────────────
  { pattern: /\bprinciple\s+judgment\b/i, lane: LANES.PRINCIPLE_JUDGMENT, weight: 5 },
  { pattern: /\bprincipled?\s+(decision|review|call|assessment|ruling)\b/i, lane: LANES.PRINCIPLE_JUDGMENT, weight: 3 },

  // ── Meta-bug-triage lane signals ──────────────────────────────────
  { pattern: /\btriage\b.{0,40}\b(meta[-\s]?bug|self[-\s]?repair|plan[-\s]?defect|orchestrator[-\s]?defect)\b/i, lane: LANES.META_BUG_TRIAGE, weight: 5 },
  { pattern: /\b(triage|triaging)\b/i, lane: LANES.META_BUG_TRIAGE, weight: 3 },

  // ── Phase-32 Slice 2: Plan Forge domain glossary ──────────────────
  // Slices and gates with a Plan Forge context marker (prevents "slice me an apple")
  { pattern: /\b(slice|slices|gate|gates)\s+(\d+|status|passed|failed|done|complete|ran|running|in.progress|stuck|blocked)/i, lane: LANES.OPERATIONAL, weight: 3 },
  // Plan hardening vocabulary
  { pattern: /\b(harden|hardened|hardening)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  // Plan execution / resume vocabulary
  { pattern: /\b(executed|execution|resume-from|resume\s+from)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  // Tempering / baseline / enforcement signals
  { pattern: /\b(tempering|baseline|enforcement|suppressed)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  // Quorum extras: reflexion, retry, escalation
  { pattern: /\b(reflexion|escalation|retry|retried|attempt)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  // Phase reference (e.g. "Phase-33", "Phase 27.2") → strong operational signal
  { pattern: /\b(phase[-\s]?\d+(\.\d+)?)\b/i, lane: LANES.OPERATIONAL, weight: 3 },
  // pforge CLI / run-plan invocation references
  { pattern: /\b(pforge|run-plan|forge\s+run|forge\s+plan)\b/i, lane: LANES.OPERATIONAL, weight: 2 },
  // Crucible extras: smelt, preview, finalize
  { pattern: /\b(smelt|smelts|smelted|preview|finalize|finalise)\b/i, lane: LANES.BUILD, weight: 2 },

  // ── Advisory signals ──
  { pattern: /\bshould\s+(i|we)\b/i, lane: LANES.ADVISORY, weight: 3 },
  { pattern: /\b(what|which)\s+is\s+the\s+(right|best)\s+(approach|path|way|choice)\b/i, lane: LANES.ADVISORY, weight: 3 },
  { pattern: /\b(architecture\s+advice|architect\s+this|arch\s+review)\b/i, lane: LANES.ADVISORY, weight: 3 },
  { pattern: /\b(refactor\s+or\s+ship|ship\s+vs|fix\s+later|do\s+it\s+right)\b/i, lane: LANES.ADVISORY, weight: 3 },
  { pattern: /\b(cto|principal\s+engineer|staff\s+engineer)\b/i, lane: LANES.ADVISORY, weight: 2 },
  { pattern: /\b(recommend|recommendation|your\s+take)\b/i, lane: LANES.ADVISORY, weight: 2 },
  { pattern: /\bhelp\s+me\s+decide\b/i, lane: LANES.ADVISORY, weight: 3 },
  { pattern: /\b(what|which)\s+(path|direction)\s+(should|to|forward)\b/i, lane: LANES.ADVISORY, weight: 2 },

  // ── Off-topic signals ──
  { pattern: /\b(weather|temperature|forecast|sports|score|game)\b/i, lane: LANES.OFFTOPIC, weight: 3 },
  { pattern: /\b(recipe|cook|food|restaurant|movie|music|song)\b/i, lane: LANES.OFFTOPIC, weight: 3 },
  { pattern: /\b(joke|funny|tell me a|what is the meaning of life)\b/i, lane: LANES.OFFTOPIC, weight: 2 },
  { pattern: /\b(stock|stocks|crypto|bitcoin|investment|portfolio)\b/i, lane: LANES.OFFTOPIC, weight: 3 },
  { pattern: /\b(write me|generate code|write code|code for)\b/i, lane: LANES.OFFTOPIC, weight: 2 },
];

// ─── Off-Topic Redirect (canned response) ───────────────────────────

export const OFFTOPIC_REDIRECT =
  "I'm scoped to Plan Forge topics. Try asking about:\n" +
  "  \u2022 operational \u2014 \"what's the status of slice 4\", \"cost report for this week\"\n" +
  "  \u2022 troubleshoot \u2014 \"why did the gate fail\", \"diagnose this incident\"\n" +
  "  \u2022 build \u2014 \"I want to add OAuth\" (routes to Crucible)\n" +
  "  \u2022 advisory \u2014 \"should I refactor or ship\", \"architecture advice\"\n" +
  "Outside those lanes I'll redirect you.";

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
    [LANES.ADVISORY]: 0,
    [LANES.TEMPERING]: 0,
    [LANES.PRINCIPLE_JUDGMENT]: 0,
    [LANES.META_BUG_TRIAGE]: 0,
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
- "advisory" — the user asks for architectural guidance, a recommendation, or a principled decision ("should I", "what's the right approach", "recommend a path")
- "tempering" — the user requests a tempering gate evaluation, enforcement check, or tempering run
- "principle-judgment" — the user asks for a principled architectural decision, principle review, or principle ruling
- "meta-bug-triage" — the user wants to triage a meta-bug, self-repair issue, plan defect, or orchestrator defect
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
