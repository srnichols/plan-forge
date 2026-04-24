/**
 * Tests for the tempering triage — three-lane finding router (Phase-39 Slice 3).
 *
 * Validates:
 *   1. Bug lane     — real-bug classification routes to "bug"
 *   2. Spec lane    — feature-gap classification routes to "spec"
 *   3. Classifier lane — infra classification routes to "classifier"
 *   4. Fail-safe    — unknown/missing classifier output routes to "bug" with low confidence
 */

import { describe, it, expect } from "vitest";
import { routeFinding } from "../tempering/triage.mjs";

// ─── Fixtures ────────────────────────────────────────────────────────

const FINDING_MISSING_H1 = {
  class: "missing-h1",
  route: "/about",
  severity: "high",
  evidence: { description: "Page missing an <h1> heading" },
};

const FINDING_BROKEN_LINK = {
  class: "broken-link",
  route: "/docs/old-page",
  severity: "medium",
  evidence: { statusCode: 404, url: "https://example.com/old-page" },
};

const FINDING_CLIENT_SHELL = {
  class: "client-shell",
  route: "/dashboard",
  severity: "info",
  evidence: { description: "Client-rendered shell without server content" },
};

// ─── Bug lane ────────────────────────────────────────────────────────

describe("routeFinding — bug lane", () => {
  it("routes real-bug classification to bug lane with high confidence", () => {
    const classifier = {
      classification: "real-bug",
      reason: "Missing heading is a confirmed accessibility defect",
      confidence: 0.92,
      source: "rule",
    };
    const result = routeFinding(FINDING_MISSING_H1, classifier);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("high");
    expect(result.payload).toEqual(expect.objectContaining({
      route: "/about",
      severity: "high",
      classification: "real-bug",
    }));
  });

  it("routes needs-human-review classification to bug lane with low confidence", () => {
    const classifier = {
      classification: "needs-human-review",
      reason: "Ambiguous — LLM confidence below threshold",
      confidence: 0.55,
      source: "llm",
    };
    const result = routeFinding(FINDING_BROKEN_LINK, classifier);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("low");
  });
});

// ─── Spec lane ───────────────────────────────────────────────────────

describe("routeFinding — spec lane", () => {
  it("routes feature-gap classification to spec lane", () => {
    const classifier = {
      classification: "feature-gap",
      reason: "No search functionality exists on this route",
      confidence: 0.80,
      source: "llm",
    };
    const result = routeFinding(FINDING_BROKEN_LINK, classifier);

    expect(result.lane).toBe("spec");
    expect(result.confidence).toBe("medium");
    expect(result.payload).toEqual(expect.objectContaining({
      source: "audit-triage",
      route: "/docs/old-page",
    }));
    expect(result.payload.rawIdea).toContain("broken-link");
  });

  it("routes spec-gap classification to spec lane", () => {
    const classifier = {
      classification: "spec-gap",
      reason: "Specification does not cover this edge case",
      confidence: 0.75,
      source: "rule",
    };
    const result = routeFinding(FINDING_MISSING_H1, classifier);

    expect(result.lane).toBe("spec");
    expect(result.confidence).toBe("medium");
  });
});

// ─── Classifier lane ─────────────────────────────────────────────────

describe("routeFinding — classifier lane", () => {
  it("routes infra classification to classifier lane", () => {
    const classifier = {
      classification: "infra",
      reason: "Client-rendered shell is expected behavior, not a bug",
      confidence: 0.88,
      source: "rule",
      rule: "test-frame-top",
    };
    const result = routeFinding(FINDING_CLIENT_SHELL, classifier);

    expect(result.lane).toBe("classifier");
    expect(result.confidence).toBe("medium");
    expect(result.payload).toEqual(expect.objectContaining({
      findingClass: "client-shell",
      route: "/dashboard",
      currentClassification: "infra",
      rule: "test-frame-top",
    }));
    expect(result.payload.proposedAction).toBeTruthy();
  });
});

// ─── Fail-safe ───────────────────────────────────────────────────────

describe("routeFinding — fail-safe", () => {
  it("routes unknown classification to bug lane with low confidence", () => {
    const classifier = {
      classification: "unknown",
      reason: "Classifier error: LLM unavailable",
      confidence: 0,
      source: "rule",
    };
    const result = routeFinding(FINDING_MISSING_H1, classifier);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("low");
  });

  it("routes null classifier to bug lane with low confidence", () => {
    const result = routeFinding(FINDING_BROKEN_LINK, null);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("low");
  });

  it("routes undefined classifier to bug lane with low confidence", () => {
    const result = routeFinding(FINDING_MISSING_H1, undefined);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("low");
  });

  it("routes unrecognized classification value to bug lane with low confidence", () => {
    const classifier = {
      classification: "something-totally-new",
      reason: "Unexpected classification from a future classifier version",
      confidence: 0.5,
      source: "llm",
    };
    const result = routeFinding(FINDING_MISSING_H1, classifier);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("low");
  });

  it("handles null finding gracefully", () => {
    const classifier = {
      classification: "real-bug",
      reason: "Confirmed defect",
      confidence: 0.9,
      source: "rule",
    };
    const result = routeFinding(null, classifier);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("high");
  });

  it("handles classifier with missing classification field", () => {
    const classifier = {
      reason: "Something",
      confidence: 0.5,
      source: "rule",
    };
    const result = routeFinding(FINDING_MISSING_H1, classifier);

    expect(result.lane).toBe("bug");
    expect(result.confidence).toBe("low");
  });
});
