/**
 * Tempering triage — three-lane finding router (Phase-39 Slice 3).
 *
 * Routes a classified finding to one of three lanes:
 *   - "bug"        → product bug, register via `forge_bug_register`
 *   - "spec"       → feature gap / spec issue, submit to Crucible
 *   - "classifier" → classifier noise, emit PR proposal artifact
 *
 * Fail-safe: unknown or missing classifier output always routes to
 * "bug" with confidence "low" — never drop a finding.
 *
 * Design contracts:
 *   - Pure function — no side effects, no I/O
 *   - Never throws — wraps all paths in try/catch
 *   - Classifier is called externally; this module only reads its result
 *   - Lane set is exactly { "bug", "spec", "classifier" }
 *
 * @module tempering/triage
 */

// ─── Lane constants ──────────────────────────────────────────────────

const LANE_BUG = "bug";
const LANE_SPEC = "spec";
const LANE_CLASSIFIER = "classifier";

// ─── Classification → lane mapping ──────────────────────────────────

/**
 * Maps classifier `classification` values to triage lanes.
 *
 * - "real-bug"           → bug lane (confirmed product defect)
 * - "infra"              → classifier lane (test infrastructure noise)
 * - "needs-human-review" → bug lane (fail safe — human must see it)
 * - "feature-gap"        → spec lane (missing capability)
 * - "spec-gap"           → spec lane (spec / requirement gap)
 * - "unknown"            → bug lane (fail safe)
 *
 * Anything not listed falls through to the fail-safe (bug, low confidence).
 */
const CLASSIFICATION_TO_LANE = {
  "real-bug":           { lane: LANE_BUG,        confidence: "high" },
  "infra":              { lane: LANE_CLASSIFIER,  confidence: "medium" },
  "needs-human-review": { lane: LANE_BUG,        confidence: "low" },
  "feature-gap":        { lane: LANE_SPEC,        confidence: "medium" },
  "spec-gap":           { lane: LANE_SPEC,        confidence: "medium" },
  "unknown":            { lane: LANE_BUG,        confidence: "low" },
};

// ─── Payload builders ────────────────────────────────────────────────

function buildBugPayload(finding, classifierResult) {
  return {
    scanner: finding.scanner || finding.class,
    route: finding.route,
    severity: finding.severity,
    evidence: finding.evidence || {},
    classification: classifierResult?.classification,
    reason: classifierResult?.reason,
  };
}

function buildSpecPayload(finding, classifierResult) {
  return {
    rawIdea: `${finding.class}: ${classifierResult?.reason || finding.evidence?.description || "Feature gap detected by audit"}`,
    route: finding.route,
    severity: finding.severity,
    source: "audit-triage",
    evidence: finding.evidence || {},
  };
}

function buildClassifierPayload(finding, classifierResult) {
  return {
    findingClass: finding.class,
    route: finding.route,
    currentClassification: classifierResult?.classification,
    reason: classifierResult?.reason,
    rule: classifierResult?.rule,
    proposedAction: "Add or update classifier rule to suppress this pattern",
    evidence: finding.evidence || {},
  };
}

const PAYLOAD_BUILDERS = {
  [LANE_BUG]: buildBugPayload,
  [LANE_SPEC]: buildSpecPayload,
  [LANE_CLASSIFIER]: buildClassifierPayload,
};

// ─── Main entry point ────────────────────────────────────────────────

/**
 * Route a finding to one of three triage lanes based on classifier output.
 *
 * @param {object} finding - A finding from a tempering scanner
 *   `{ class, route, severity, evidence, seed? }`
 * @param {object|null} classifierResult - Output from `classify()`
 *   `{ classification, rule?, reason, confidence, source }`
 * @returns {{ lane: "bug"|"spec"|"classifier", payload: object, confidence: string }}
 */
export function routeFinding(finding, classifierResult) {
  try {
    // Fail-safe: missing or malformed classifier result → bug lane
    if (!classifierResult || typeof classifierResult.classification !== "string") {
      return {
        lane: LANE_BUG,
        payload: buildBugPayload(finding || {}, classifierResult),
        confidence: "low",
      };
    }

    const mapping = CLASSIFICATION_TO_LANE[classifierResult.classification];

    if (!mapping) {
      // Unknown classification value → fail safe to bug lane
      return {
        lane: LANE_BUG,
        payload: buildBugPayload(finding || {}, classifierResult),
        confidence: "low",
      };
    }

    const { lane, confidence } = mapping;
    const buildPayload = PAYLOAD_BUILDERS[lane];
    const payload = buildPayload(finding || {}, classifierResult);

    return { lane, payload, confidence };
  } catch {
    // Never throw — fail safe to bug lane
    return {
      lane: LANE_BUG,
      payload: { finding, error: "triage-internal-error" },
      confidence: "low",
    };
  }
}
