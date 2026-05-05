/**
 * Plan Forge — Issue #153: planner-executed steps must surface as tool-call records
 *
 * The bug: Forge-Master's planner pre-fetched read-only tool results before the
 * reply was generated, but those calls did not appear in `result.toolCalls`.
 * Downstream SSE consumers (and the dashboard) couldn't tell what the planner
 * actually ran, which masked a hallucinated reply that the planner's results
 * would have caught.
 *
 * The fix: push every executed planner step into `allToolCalls` with
 * `source: "planner"`, and exclude those entries from the reactive tool-budget.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/cost.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return { ...orig, computeTurnCost: () => 0 };
});

// Capture mock state up-front so vi.mock factories can reach it (factories
// are hoisted above any module-level let/const).
const mockState = {
  plannerSteps: [],
  executorResults: [],
};

vi.mock("../src/planner.mjs", () => ({
  plan: async () => ({ steps: mockState.plannerSteps }),
}));

vi.mock("../src/plan-executor.mjs", () => ({
  executePlan: async () => ({ results: mockState.executorResults, totalDurationMs: 1 }),
}));

vi.mock("../src/intent-router.mjs", async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    classify: async () => ({
      lane: "operational",
      confidence: "high",
      reason: "test-mock",
      suggestedTools: [],
      via: "keyword_match",
      classifierCostUSD: 0,
    }),
  };
});

import { runTurn } from "../src/reasoning.mjs";

// ─── Test scaffolding ─────────────────────────────────────────────────

class StubProvider {
  constructor(scriptedReplies) {
    this.scriptedReplies = scriptedReplies;
    this.callCount = 0;
  }
  async sendTurn(/* { messages, tools, model, apiKey } */) {
    const reply = this.scriptedReplies[this.callCount] ?? this.scriptedReplies[this.scriptedReplies.length - 1];
    this.callCount++;
    return reply;
  }
}

function makeMockClassifier(lane = "operational") {
  return vi.fn().mockResolvedValue({
    lane,
    confidence: "high",
    reason: "test",
    suggestedTools: [],
    via: "keyword_match",
    classifierCostUSD: 0,
  });
}

function makeMockPlanner(steps) {
  mockState.plannerSteps = steps;
}

function makeMockExecutor(results) {
  mockState.executorResults = results;
}

const baseDeps = {
  config: {
    routerProvider: "openai",
    routerModel: "gpt-5-mini",
    reasoningProvider: "openai",
    reasoningModel: "gpt-5",
    maxToolCalls: 5,
  },
  resolveApiKey: () => "fake-key",
  classifyIntent: makeMockClassifier(),
  systemPrompt: "test system prompt",
  buildAllowlist: () => [],
  resolveTools: () => [],
  recall: async () => null,
  remember: () => ({ ok: true }),
  selectProvider: () => null, // overridden per-test
  dispatcher: async () => ({ ok: true, summary: "tool-result" }),
};describe("Issue #153 — planner steps appear in result.toolCalls with source:'planner'", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("planner-executed steps are pushed into result.toolCalls", async () => {
    const plannerSteps = [
      { id: "step-0", tool: "forge_diff", args: { planA: "a.md", planB: "b.json" }, rationale: "diff" },
      { id: "step-1", tool: "forge_graph_query", args: { query: "Phase X" }, rationale: "graph" },
    ];
    const executorResults = [
      { step: plannerSteps[0], output: { matches: 3 } },
      { step: plannerSteps[1], output: "graph-result" },
    ];

    // Provider returns a single reply (no reactive tool calls)
    const provider = new StubProvider([
      { content: "planner-context", tokensIn: 10, tokensOut: 5 }, // planner model call
      { type: "reply", content: "Final answer based on planner results.", tokensIn: 50, tokensOut: 30 }, // reasoning loop
    ]);

    makeMockPlanner(plannerSteps);
    makeMockExecutor(executorResults);
    const result = await runTurn(
      { message: "audit X for gaps", sessionId: "test-153-A" },
      {
        ...baseDeps,
        provider,
      },
    );

    // Both planner steps must appear in toolCalls
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]).toMatchObject({
      name: "forge_diff",
      source: "planner",
      stepId: "step-0",
    });
    expect(result.toolCalls[1]).toMatchObject({
      name: "forge_graph_query",
      source: "planner",
      stepId: "step-1",
    });
  });

  it("planner step errors are surfaced via the error field", async () => {
    const plannerSteps = [
      { id: "step-0", tool: "forge_diff", args: {} },
    ];
    const executorResults = [
      { step: plannerSteps[0], output: null, error: "tool unavailable" },
    ];

    const provider = new StubProvider([
      { content: "planner-context", tokensIn: 5, tokensOut: 3 },
      { type: "reply", content: "ok", tokensIn: 10, tokensOut: 10 },
    ]);

    makeMockPlanner(plannerSteps);
    makeMockExecutor(executorResults);
    const result = await runTurn(
      { message: "x", sessionId: "test-153-B" },
      {
        ...baseDeps,
        provider,
      },
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "forge_diff",
      source: "planner",
      error: "tool unavailable",
    });
    expect(result.toolCalls[0].resultSummary).toMatch(/ERROR: tool unavailable/);
  });

  it("planner steps do not consume the reactive tool-call budget", async () => {
    // Budget = 1. Planner runs 2 steps. Reactive loop must still be allowed
    // 1 tool call before truncation kicks in.
    const plannerSteps = [
      { id: "step-0", tool: "forge_status", args: {} },
      { id: "step-1", tool: "forge_status", args: {} },
    ];
    const executorResults = [
      { step: plannerSteps[0], output: "ok" },
      { step: plannerSteps[1], output: "ok" },
    ];

    const provider = new StubProvider([
      // Reactive iteration 1: model emits 1 tool call (must be allowed under budget=1)
      {
        type: "tool_calls",
        toolCalls: [{ id: "rc-0", name: "forge_status", args: {} }],
        tokensIn: 5,
        tokensOut: 3,
      },
      // Reactive iteration 2: final reply
      { type: "reply", content: "done", tokensIn: 5, tokensOut: 3 },
    ]);

    makeMockPlanner(plannerSteps);
    makeMockExecutor(executorResults);
    const result = await runTurn(
      { message: "x", sessionId: "test-153-C" },
      {
        ...baseDeps,
        config: { ...baseDeps.config, maxToolCalls: 1 },
        provider,
      },
    );

    // 2 planner steps + 1 reactive call = 3 total, but only 1 reactive
    expect(result.toolCalls).toHaveLength(3);
    expect(result.truncated).toBeFalsy();

    const plannerCalls = result.toolCalls.filter((tc) => tc.source === "planner");
    const reactiveCalls = result.toolCalls.filter((tc) => tc.source !== "planner");
    expect(plannerCalls).toHaveLength(2);
    expect(reactiveCalls).toHaveLength(1);
  });
});
