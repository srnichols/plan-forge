/**
 * Classifier calibration — Phase-37, Slices 1 & 2.
 *
 * Authoritative keyword-only regression harness.
 * Stage-2 router-model is disabled (callApiWorker throws) so ONLY
 * scoreKeywords() determines the result. A green suite guarantees that
 * keyword patterns alone can route the required probes without a model.
 *
 * Probe IDs correspond to .forge/validation/probes.json.
 */

import { describe, it, expect } from "vitest";
import { classify, LANES } from "../intent-router.mjs";

/**
 * Stage-2 stub — always throws.
 * Ensures keyword stage-1 is exercised exclusively.
 * callRouterModel() catches this and returns null → graceful degradation.
 */
const throwingCallApiWorker = async () => {
  throw new Error("mock: stage-2 router-model disabled for calibration tests");
};
const stubbedDetectApiProvider = () => "stub-provider";

/**
 * Helper: classify in keyword-only mode (stage-2 throws → graceful fallback).
 */
async function kwClassify(message) {
  return classify(message, {
    callApiWorker: throwingCallApiWorker,
    detectApiProvider: stubbedDetectApiProvider,
  });
}

/**
 * Classifier calibration — Phase-37, Slices 1 & 2.
 *
 * Each probe ID corresponds to .forge/validation/probes.json.
 * Stage-2 router-model is disabled in all tests (callApiWorker throws)
 * so ONLY scoreKeywords() determines the result.
 */

// ── operational lane ────────────────────────────────────────────────────────

describe("operational", () => {
  it("op-cost-week — 'spent on forge runs this week' → operational", async () => {
    const r = await kwClassify("How much have I spent on forge runs this week?");
    expect(r.lane).toBe(LANES.OPERATIONAL);
  });

  it("op-phase-reference — 'Did Phase-32 ship?' → operational", async () => {
    const r = await kwClassify("Did Phase-32 ship?");
    expect(r.lane).toBe(LANES.OPERATIONAL);
  });

  it("op-slice-status — 'Is slice 4 of Phase-34 passed?' → operational", async () => {
    const r = await kwClassify("Is slice 4 of Phase-34 passed?");
    expect(r.lane).toBe(LANES.OPERATIONAL);
  });

  it("op-status-basic — 'What is the status of Phase-34.1?' → operational", async () => {
    const r = await kwClassify("What is the status of Phase-34.1?");
    expect(r.lane).toBe(LANES.OPERATIONAL);
  });

  it("op-cost-quorum-estimate — 'How much would Phase-34.1 have cost under power quorum mode?' → operational", async () => {
    const r = await kwClassify(
      "How much would Phase-34.1 have cost under power quorum mode?",
    );
    expect(r.lane).toBe(LANES.OPERATIONAL);
  });

  it("op-memory-recall — 'What do I have in memory about Windows gate dispatch?' → operational", async () => {
    const r = await kwClassify(
      "What do I have in memory about Windows gate dispatch?",
    );
    expect(r.lane).toBe(LANES.OPERATIONAL);
  });
});

// ── troubleshoot lane ───────────────────────────────────────────────────────

describe("troubleshoot", () => {
  it("ts-recurrence — orchestrator erroring + did we see → troubleshoot", async () => {
    const r = await kwClassify(
      "The orchestrator is erroring out on Windows again. Did we see this before?",
    );
    expect(r.lane).toBe(LANES.TROUBLESHOOT);
  });

  it("ts-why-fail — 'Why did slice 3 fail?' → troubleshoot", async () => {
    const r = await kwClassify("Why did slice 3 fail?");
    expect(r.lane).toBe(LANES.TROUBLESHOOT);
  });

  it("ts-crash — 'The build crashed with an exception' → troubleshoot", async () => {
    const r = await kwClassify("The build crashed with an exception");
    expect(r.lane).toBe(LANES.TROUBLESHOOT);
  });

  it("ts-regression — 'We have a regression in the gate runner' → troubleshoot", async () => {
    const r = await kwClassify("We have a regression in the gate runner");
    expect(r.lane).toBe(LANES.TROUBLESHOOT);
  });
});

// ── advisory lane ───────────────────────────────────────────────────────────

describe("advisory", () => {
  it("adv-principle-judgment — abstraction layer over-engineering question → advisory", async () => {
    const r = await kwClassify(
      "I'm about to add a 4th abstraction layer for a one-off operation — is this over-engineering?",
    );
    expect(r.lane).toBe(LANES.ADVISORY);
  });

  it("adv-arch-review — architecture review request → advisory", async () => {
    const r = await kwClassify(
      "Give me an architecture review of the Forge-Master intent router.",
    );
    expect(r.lane).toBe(LANES.ADVISORY);
  });

  it("adv-refactor-or-ship — 'Should I refactor or ship?' → advisory", async () => {
    const r = await kwClassify("Should I refactor or ship?");
    expect(r.lane).toBe(LANES.ADVISORY);
  });

  it("adv-best-approach — 'What is the best approach for caching?' → advisory", async () => {
    const r = await kwClassify("What is the best approach for caching?");
    expect(r.lane).toBe(LANES.ADVISORY);
  });
});
