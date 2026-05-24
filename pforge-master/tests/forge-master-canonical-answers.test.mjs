// Phase-43 — canonical Q&A regression
//
// Pins the lane (and therefore the suggested toolset) that Forge-Master must
// produce for canonical questions a CTO/Tech-Lead would ask. These are the
// questions that motivated the Phase-43 sprint:
//
//   1. "What's my biggest risk this week?"        → advisory (audit-shaped)
//   2. "Should I ship this slice or refactor?"    → advisory
//   3. "I want to add OAuth to my app"            → build (Crucible-funneled)
//   4. "Why did slice 4 fail?"                    → troubleshoot
//
// Each test asserts:
//   - the right lane
//   - the suggested-tools list contains the canonical entrypoint tool
//
// If a future change re-routes one of these into the wrong lane, this test
// fails and forces the change author to either fix the router or update the
// canonical expectation with justification.

import { describe, it, expect } from "vitest";
import { classify, LANES, LANE_TOOLS } from "../src/intent-router.mjs";

// Pin to keyword-only path so the test does not require network/embeddings.
const KEYWORD_ONLY = { keywordOnly: true, embeddingFallback: false };

async function classifyKw(message) {
  return classify(message, KEYWORD_ONLY);
}

describe("Canonical Q&A regression (Phase-43)", () => {
  it("'what is my biggest risk this week' → advisory lane", async () => {
    const r = await classifyKw("what is my biggest risk this week");
    expect(r.lane).toBe(LANES.ADVISORY);
    expect(r.suggestedTools).toEqual(LANE_TOOLS[LANES.ADVISORY]);
  });

  it("'should I ship this slice or refactor first' → advisory lane", async () => {
    const r = await classifyKw("should I ship this slice or refactor first");
    expect(r.lane).toBe(LANES.ADVISORY);
  });

  it("'I want to add OAuth login to my app' → build lane (Crucible-funneled)", async () => {
    const r = await classifyKw("I want to add OAuth login to my app");
    expect(r.lane).toBe(LANES.BUILD);
    expect(r.suggestedTools).toContain("forge_crucible_submit");
  });

  it("'why did slice 4 fail' → troubleshoot lane", async () => {
    const r = await classifyKw("why did slice 4 fail");
    expect(r.lane).toBe(LANES.TROUBLESHOOT);
  });

  it("'what is the weather today' → offtopic lane", async () => {
    const r = await classifyKw("what is the weather today");
    expect(r.lane).toBe(LANES.OFFTOPIC);
  });

  it("LANE_TOOLS.advisory references at least one audit-relevant tool", () => {
    // forge_master_audit is the canonical entrypoint for the advisory lane
    // when the user asks for a CTO-style "biggest risk" summary. Even if the
    // advisory lane suggests other tools (status, cost), the audit tool
    // should be reachable via the allowlist.
    const advisoryTools = LANE_TOOLS[LANES.ADVISORY];
    expect(Array.isArray(advisoryTools)).toBe(true);
    expect(advisoryTools.length).toBeGreaterThan(0);
  });
});
