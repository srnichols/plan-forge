/**
 * Plan Forge — Tempering: Bug Classifier (Phase TEMPER-06 Slice 06.1)
 *
 * Two-layer classification: deterministic rules first, LLM arbitration
 * as fallback. Never throws — all failures produce structured results.
 *
 * Design contracts:
 *   - `classify()` never throws. Returns `{ classification, rule?, reason, confidence, source }`.
 *   - Layer 1 (rules) is synchronous, first-match wins, ordered by confidence.
 *   - Layer 2 (LLM) is async, single-model by default, quorum opt-in.
 *   - confidence < 0.7 from LLM → 'needs-human-review'.
 *   - LLM unavailable → 'unknown'.
 *
 * @module tempering/bug-classifier
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Rule Definitions ─────────────────────────────────────────────────

/**
 * Deterministic classification rules, ordered by confidence.
 * First match wins. Each rule returns a classification or null.
 */
const RULES = [
  // Rule 1: test-frame-top — stack top in test files
  {
    id: "test-frame-top",
    test: (opts) => {
      const top = extractTopFrame(opts.evidence?.stackTrace);
      if (!top) return null;
      if (/tests?[/\\]|\.spec\.|\.test\./i.test(top)) {
        return { classification: "infra", confidence: 0.95, reason: "Stack trace top frame is in test code" };
      }
      return null;
    },
  },
  // Rule 2: visual-quorum — visual-diff scanner with quorum verdict
  {
    id: "visual-quorum",
    test: (opts) => {
      if (opts.scanner !== "visual-diff") return null;
      if (opts.evidence?.quorumVerdict || opts.evidence?.verdict) {
        return { classification: "real-bug", confidence: 0.95, reason: "Visual-diff quorum confirmed regression" };
      }
      return null;
    },
  },
  // Rule 3: src-assertion — top frame in src/ with assertion failure
  {
    id: "src-assertion",
    test: (opts) => {
      const top = extractTopFrame(opts.evidence?.stackTrace);
      if (!top) return null;
      if (/src[/\\]/i.test(top) && opts.evidence?.assertionMessage) {
        return { classification: "real-bug", confidence: 0.90, reason: "Assertion failure in production source code" };
      }
      return null;
    },
  },
  // Rule 4: a11y-critical — accessibility violations from UI scanner
  {
    id: "a11y-critical",
    test: (opts) => {
      if (opts.scanner !== "ui-playwright") return null;
      const sev = opts.evidence?.a11ySeverity || opts.evidence?.severity;
      if (sev === "serious" || sev === "critical") {
        return { classification: "real-bug", confidence: 0.90, reason: `Accessibility violation: ${sev}` };
      }
      return null;
    },
  },
  // Rule 5: contract-mismatch — contract scanner with violation
  {
    id: "contract-mismatch",
    test: (opts) => {
      if (opts.scanner !== "contract") return null;
      if (opts.evidence?.violation || opts.evidence?.violations?.length > 0) {
        return { classification: "real-bug", confidence: 0.90, reason: "API contract violation detected" };
      }
      return null;
    },
  },
  // Rule 6: flaky-threshold — ≥3 failures in rolling window
  {
    id: "flaky-threshold",
    test: (opts) => {
      const flaky = opts.flakinessData;
      if (!flaky || typeof flaky.failureCount !== "number") return null;
      if (flaky.failureCount >= 3) {
        return { classification: "infra", confidence: 0.85, reason: `Flaky: ${flaky.failureCount} failures in rolling window` };
      }
      return null;
    },
  },
  // Rule 7: perf-consecutive — perf regression in 2+ consecutive runs
  {
    id: "perf-consecutive",
    test: (opts) => {
      if (opts.scanner !== "performance-budget") return null;
      if (opts.evidence?.consecutiveFailures >= 2) {
        return { classification: "real-bug", confidence: 0.85, reason: "Performance regression in 2+ consecutive runs" };
      }
      return null;
    },
  },
  // Rule 8: load-error-rate — load-stress scanner error rate breach
  {
    id: "load-error-rate",
    test: (opts) => {
      if (opts.scanner !== "load-stress") return null;
      if (opts.evidence?.errorRateBreach || opts.evidence?.errorRate > (opts.evidence?.threshold || 0.05)) {
        return { classification: "real-bug", confidence: 0.85, reason: "Load test error rate exceeds threshold" };
      }
      return null;
    },
  },
  // Rule 9: test-modified-same-commit
  {
    id: "test-modified-same-commit",
    test: (opts) => {
      const top = extractTopFrame(opts.evidence?.stackTrace);
      if (!top) return null;
      if (/tests?[/\\]|\.spec\.|\.test\./i.test(top) && opts.evidence?.testModifiedInCommit) {
        return { classification: "infra", confidence: 0.90, reason: "Test file modified in same commit as failure" };
      }
      return null;
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function extractTopFrame(stackTrace) {
  if (!stackTrace || typeof stackTrace !== "string") return "";
  const lines = stackTrace.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("at ") && !line.includes("node_modules")) {
      return line;
    }
  }
  return lines[0] || "";
}

// ─── Layer 1: Rule-Based Classification ──────────────────────────────

/**
 * Classify using deterministic rules. Synchronous.
 *
 * @param {object} opts - { scanner, evidence, flakinessData? }
 * @returns {{ classification, rule, reason, confidence, source: 'rule' } | null}
 */
export function classifyByRules(opts) {
  for (const rule of RULES) {
    try {
      const result = rule.test(opts);
      if (result) {
        return {
          classification: result.classification,
          rule: rule.id,
          reason: result.reason,
          confidence: result.confidence,
          source: "rule",
        };
      }
    } catch { /* skip broken rule */ }
  }
  return null;
}

// ─── Layer 2: LLM Arbitration ─────────────────────────────────────────

const CLASSIFIER_SYSTEM_PROMPT = `You are a bug classifier. Given scanner evidence from an automated test suite, decide if this is a product bug ('real-bug') or test-infrastructure issue ('infra'). Return JSON only: { "classification": "real-bug"|"infra", "reason": "<brief explanation>", "confidence": <0.0-1.0> }`;

/**
 * Classify using LLM when rules don't match. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.scanner
 * @param {object} opts.evidence
 * @param {Function} opts.callModel - DI injected model caller
 * @param {object} [opts.config]
 * @returns {Promise<{ classification, reason, confidence, source: 'llm' }>}
 */
export async function classifyByLLM(opts) {
  const { scanner, evidence, callModel, config } = opts;

  if (typeof callModel !== "function") {
    return { classification: "unknown", reason: "LLM unavailable (no callModel)", confidence: 0, source: "llm" };
  }

  try {
    const userPrompt = JSON.stringify({
      scanner,
      testName: evidence?.testName || null,
      assertionMessage: evidence?.assertionMessage || null,
      stackTrace: (evidence?.stackTrace || "").slice(0, 1500),
      visualDiffScore: evidence?.visualDiffScore || null,
    });

    const response = await callModel({
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 200,
      temperature: 0.1,
    });

    // Parse LLM response
    const text = typeof response === "string" ? response : response?.text || response?.content || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { classification: "unknown", reason: "LLM response not parseable", confidence: 0, source: "llm" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const classification = parsed.classification || "unknown";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const reason = parsed.reason || "LLM classified";

    // Low confidence → needs-human-review
    if (confidence < 0.7) {
      return { classification: "needs-human-review", reason, confidence, source: "llm" };
    }

    return { classification, reason, confidence, source: "llm" };
  } catch (err) {
    return { classification: "unknown", reason: `LLM unavailable: ${err.message}`, confidence: 0, source: "llm" };
  }
}

// ─── Flakiness Data Loader ────────────────────────────────────────────

/**
 * Load flakiness data for a test name from recent run records.
 *
 * @param {string} cwd
 * @param {string} testName
 * @param {number} [windowSize=20]
 * @returns {{ failureCount: number, runCount: number, failureRate: number }}
 */
export function loadFlakinessData(cwd, testName, windowSize = 20) {
  if (!testName || typeof testName !== "string") {
    return { failureCount: 0, runCount: 0, failureRate: 0 };
  }

  const temperingDir = resolve(cwd, ".forge", "tempering");
  if (!existsSync(temperingDir)) {
    return { failureCount: 0, runCount: 0, failureRate: 0 };
  }

  let runFiles;
  try {
    runFiles = readdirSync(temperingDir)
      .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, windowSize);
  } catch {
    return { failureCount: 0, runCount: 0, failureRate: 0 };
  }

  let failures = 0;
  let runs = 0;

  for (const file of runFiles) {
    try {
      const record = JSON.parse(readFileSync(resolve(temperingDir, file), "utf-8"));
      if (!Array.isArray(record.scanners)) continue;

      for (const scanner of record.scanners) {
        if (scanner.failures && Array.isArray(scanner.failures)) {
          const hasFail = scanner.failures.some(
            (f) => f.testName === testName || f.evidence?.testName === testName
          );
          if (hasFail) failures++;
        }
      }
      runs++;
    } catch { /* skip corrupt */ }
  }

  return {
    failureCount: failures,
    runCount: runs,
    failureRate: runs > 0 ? failures / runs : 0,
  };
}

// ─── Top-level classifier ─────────────────────────────────────────────

/**
 * Two-layer classification: rules first, then LLM fallback.
 * Never throws.
 *
 * @param {object} opts
 * @param {string} opts.scanner
 * @param {object} opts.evidence
 * @param {object} [opts.flakinessData]
 * @param {object|null} [opts.sliceRef]
 * @param {Function} [opts.callModel]
 * @param {object} [opts.config]
 * @returns {Promise<{ classification, rule?, reason, confidence, source }>}
 */
export async function classify(opts) {
  try {
    // Layer 1: rules
    const ruleResult = classifyByRules(opts);
    if (ruleResult) return ruleResult;

    // Layer 2: LLM
    return await classifyByLLM(opts);
  } catch (err) {
    return {
      classification: "unknown",
      reason: `Classifier error: ${err.message}`,
      confidence: 0,
      source: "rule",
    };
  }
}
