/**
 * Tests for planner.mjs — Phase-38.4, Slice 1.
 *
 * Covers: skip heuristics (offtopic, build, no-tools, single-tool),
 * multi-step planning, step cap, tool validation, malformed responses,
 * dependency remapping, and error handling.
 */

import { describe, it, expect, vi } from "vitest";
import { plan, MAX_STEPS, SKIP_REASONS } from "../planner.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

const TOOLS = [
  "forge_plan_status",
  "forge_cost_report",
  "forge_status",
  "forge_health_trend",
  "forge_watch",
];

function makeClassification(lane, confidence = "high") {
  return { lane, confidence, suggestedTools: [] };
}

function makeDeps(modelResponse) {
  const callPlannerModel = vi.fn().mockResolvedValue(
    typeof modelResponse === "string" ? modelResponse : JSON.stringify(modelResponse),
  );
  return { callPlannerModel };
}

// ─── Skip Heuristics ────────────────────────────────────────────────

describe("planner skip heuristics", () => {
  it("(1) skips when lane=offtopic — no model call", async () => {
    const deps = makeDeps([]);
    const result = await plan({
      userMessage: "What's the weather?",
      classification: makeClassification("offtopic"),
      lane: "offtopic",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.OFFTOPIC);
    expect(deps.callPlannerModel).not.toHaveBeenCalled();
  });

  it("(2) skips when lane=build — no model call", async () => {
    const deps = makeDeps([]);
    const result = await plan({
      userMessage: "Build me a new dashboard",
      classification: makeClassification("build"),
      lane: "build",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.BUILD);
    expect(deps.callPlannerModel).not.toHaveBeenCalled();
  });

  it("(3) skips when allowedTools is empty — no model call", async () => {
    const deps = makeDeps([]);
    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: [],
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.NO_TOOLS);
    expect(deps.callPlannerModel).not.toHaveBeenCalled();
  });

  it("(4) skips when allowedTools is not an array — no model call", async () => {
    const deps = makeDeps([]);
    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: null,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.NO_TOOLS);
    expect(deps.callPlannerModel).not.toHaveBeenCalled();
  });

  it("(5) skips when only 1 unique allowed tool — single-tool-obvious", async () => {
    const deps = makeDeps([]);
    const result = await plan({
      userMessage: "Show plan status",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: ["forge_plan_status"],
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.SINGLE_TOOL);
    expect(deps.callPlannerModel).not.toHaveBeenCalled();
  });

  it("(6) skips when allowedTools has duplicates but only 1 unique tool", async () => {
    const deps = makeDeps([]);
    const result = await plan({
      userMessage: "Show plan status",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: ["forge_plan_status", "forge_plan_status"],
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.SINGLE_TOOL);
    expect(deps.callPlannerModel).not.toHaveBeenCalled();
  });
});

// ─── Multi-step Planning ────────────────────────────────────────────

describe("planner multi-step", () => {
  it("(7) returns valid multi-step plan from model", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: { period: "week" }, rationale: "Get recent cost data" },
      { tool: "forge_plan_status", args: {}, rationale: "Check plan progress" },
      { tool: "forge_status", args: {}, rationale: "Get overall status" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Show cost for runs that failed last week by model",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.skipReason).toBeUndefined();
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0]).toEqual({
      id: "step-0",
      tool: "forge_cost_report",
      args: { period: "week" },
      rationale: "Get recent cost data",
    });
    expect(result.steps[1].id).toBe("step-1");
    expect(result.steps[2].id).toBe("step-2");
  });

  it("(8) caps steps to MAX_STEPS (5)", async () => {
    const modelSteps = Array.from({ length: 7 }, (_, i) => ({
      tool: TOOLS[i % TOOLS.length],
      args: {},
      rationale: `Step ${i}`,
    }));
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Do many things",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps.length).toBeLessThanOrEqual(MAX_STEPS);
    expect(result.steps).toHaveLength(5);
  });

  it("(9) filters out steps with tools not in allowedTools", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "Valid" },
      { tool: "forge_run_plan", args: {}, rationale: "Not allowed" },
      { tool: "forge_plan_status", args: {}, rationale: "Also valid" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check cost and run plan",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].tool).toBe("forge_cost_report");
    expect(result.steps[1].tool).toBe("forge_plan_status");
    // IDs are sequential after filtering
    expect(result.steps[0].id).toBe("step-0");
    expect(result.steps[1].id).toBe("step-1");
  });

  it("(10) returns planner-empty when all steps are filtered out", async () => {
    const modelSteps = [
      { tool: "forge_run_plan", args: {}, rationale: "Write tool" },
      { tool: "forge_unknown_tool", args: {}, rationale: "Invented" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Run the plan",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_EMPTY);
  });
});

// ─── Dependency Handling ────────────────────────────────────────────

describe("planner dependency handling", () => {
  it("(11) remaps dependsOn indices to canonical step IDs", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "First", dependsOn: [] },
      { tool: "forge_plan_status", args: {}, rationale: "Second", dependsOn: ["0"] },
      { tool: "forge_status", args: {}, rationale: "Third", dependsOn: ["0", "1"] },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Cost then status",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps[0].dependsOn).toBeUndefined();
    expect(result.steps[1].dependsOn).toEqual(["step-0"]);
    expect(result.steps[2].dependsOn).toEqual(["step-0", "step-1"]);
  });

  it("(12) drops self-referencing dependsOn entries", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "Self-ref", dependsOn: ["0"] },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Cost check",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps[0].dependsOn).toBeUndefined();
  });

  it("(13) drops dependsOn references to nonexistent steps", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "Has bad ref", dependsOn: ["99"] },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Cost check",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps[0].dependsOn).toBeUndefined();
  });
});

// ─── Malformed Model Responses ──────────────────────────────────────

describe("planner error handling", () => {
  it("(14) returns planner-error when model returns non-JSON", async () => {
    const deps = makeDeps("This is not JSON at all");

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_ERROR);
  });

  it("(15) returns planner-error when model returns non-array JSON", async () => {
    const deps = { callPlannerModel: vi.fn().mockResolvedValue('{"not": "an array"}') };

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_ERROR);
  });

  it("(16) returns planner-error when callPlannerModel throws", async () => {
    const deps = { callPlannerModel: vi.fn().mockRejectedValue(new Error("model down")) };

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_ERROR);
  });

  it("(17) returns planner-error when callPlannerModel is missing", async () => {
    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps: {},
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_ERROR);
  });

  it("(18) returns planner-error when model returns non-string", async () => {
    const deps = { callPlannerModel: vi.fn().mockResolvedValue(42) };

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_ERROR);
  });
});

// ─── Step Shape Validation ──────────────────────────────────────────

describe("planner step shape validation", () => {
  it("(19) filters out steps missing the tool field", async () => {
    const modelSteps = [
      { args: {}, rationale: "No tool" },
      { tool: "forge_cost_report", args: {}, rationale: "Valid" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe("forge_cost_report");
  });

  it("(20) filters out null/undefined/non-object steps", async () => {
    const modelSteps = [
      null,
      undefined,
      "not an object",
      42,
      { tool: "forge_cost_report", args: {}, rationale: "Valid" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe("forge_cost_report");
  });

  it("(21) normalizes missing args to empty object", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", rationale: "No args" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps[0].args).toEqual({});
  });

  it("(22) normalizes array args to empty object", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: [1, 2, 3], rationale: "Array args" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps[0].args).toEqual({});
  });

  it("(23) strips markdown fences from model response", async () => {
    const json = JSON.stringify([
      { tool: "forge_cost_report", args: {}, rationale: "Inside fences" },
    ]);
    const deps = { callPlannerModel: vi.fn().mockResolvedValue("```json\n" + json + "\n```") };

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].tool).toBe("forge_cost_report");
  });

  it("(24) filters non-string entries from dependsOn arrays", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "First" },
      { tool: "forge_plan_status", args: {}, rationale: "Second", dependsOn: [0, null, "0", true] },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check things",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps[1].dependsOn).toEqual(["step-0"]);
  });

  it("(25) handles empty model response array → planner-empty", async () => {
    const deps = makeDeps([]);

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.steps).toEqual([]);
    expect(result.skipReason).toBe(SKIP_REASONS.PLANNER_EMPTY);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────

describe("planner edge cases", () => {
  it("(26) works with advisory lane (not skipped)", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "Advisory cost check" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "What's the best architecture approach?",
      classification: makeClassification("advisory"),
      lane: "advisory",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.skipReason).toBeUndefined();
    expect(result.steps).toHaveLength(1);
  });

  it("(27) works with troubleshoot lane (not skipped)", async () => {
    const modelSteps = [
      { tool: "forge_status", args: {}, rationale: "Check health" },
      { tool: "forge_watch", args: {}, rationale: "Check alerts" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Why did Phase-37 fail?",
      classification: makeClassification("troubleshoot"),
      lane: "troubleshoot",
      allowedTools: TOOLS,
      deps,
    });

    expect(result.skipReason).toBeUndefined();
    expect(result.steps).toHaveLength(2);
  });

  it("(28) filters non-string and empty-string entries from allowedTools", async () => {
    const modelSteps = [
      { tool: "forge_cost_report", args: {}, rationale: "Valid" },
    ];
    const deps = makeDeps(modelSteps);

    const result = await plan({
      userMessage: "Check cost",
      classification: makeClassification("operational"),
      lane: "operational",
      allowedTools: [null, "", "  ", "forge_cost_report", 42],
      deps,
    });

    // Only forge_cost_report is unique and valid — so single-tool-obvious
    expect(result.skipReason).toBe(SKIP_REASONS.SINGLE_TOOL);
  });
});
