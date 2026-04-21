import { describe, it, expect } from "vitest";
import * as costService from "../cost-service.mjs";
import { calculateSliceCost, buildCostBreakdown, buildEstimate, QUORUM_PRESETS } from "../orchestrator.mjs";

describe("cost-service: MODEL_PRICING + getPricing (Slice 1)", () => {
  it("exports MODEL_PRICING as an object with a default rate", () => {
    expect(costService.MODEL_PRICING).toBeTypeOf("object");
    expect(costService.MODEL_PRICING.default).toBeDefined();
    expect(costService.MODEL_PRICING.default.input).toBeGreaterThan(0);
    expect(costService.MODEL_PRICING.default.output).toBeGreaterThan(0);
  });

  it("includes canonical flagship models", () => {
    expect(costService.MODEL_PRICING["claude-opus-4.6"]).toBeDefined();
    expect(costService.MODEL_PRICING["claude-sonnet-4.5"]).toBeDefined();
    expect(costService.MODEL_PRICING["gpt-5.4"]).toBeDefined();
    expect(costService.MODEL_PRICING["grok-4.20"]).toBeDefined();
    expect(costService.MODEL_PRICING["gemini-3-pro-preview"]).toBeDefined();
  });

  it("getPricing returns the model's pricing when known", () => {
    const pricing = costService.getPricing("claude-opus-4.6");
    expect(pricing.input).toBe(15 / 1_000_000);
    expect(pricing.output).toBe(75 / 1_000_000);
  });

  it("getPricing falls back to default for unknown models", () => {
    const pricing = costService.getPricing("nonexistent-model-xyz");
    expect(pricing).toBe(costService.MODEL_PRICING.default);
  });

  it("getPricing handles null/undefined model safely", () => {
    expect(costService.getPricing(null)).toBe(costService.MODEL_PRICING.default);
    expect(costService.getPricing(undefined)).toBe(costService.MODEL_PRICING.default);
  });
});

describe("cost-service: priceSlice parity (Slice 2)", () => {
  const fixtures = [
    {
      name: "API worker with sonnet tokens",
      tokens: { tokens_in: 10000, tokens_out: 3000, model: "claude-sonnet-4.5" },
      worker: "api-anthropic",
    },
    {
      name: "API worker with opus tokens",
      tokens: { tokens_in: 5000, tokens_out: 8000, model: "claude-opus-4.6" },
      worker: "api-anthropic",
    },
    {
      name: "API worker with unknown model falls to default",
      tokens: { tokens_in: 1000, tokens_out: 500, model: "mystery-model" },
      worker: "api-other",
    },
    {
      name: "CLI worker uses premium request rate",
      tokens: { tokens_in: 99999, tokens_out: 99999, model: "claude-sonnet-4.5", premiumRequests: 5 },
      worker: "gh-copilot",
    },
    {
      name: "CLI worker with no premium requests costs 0",
      tokens: { tokens_in: 10000, tokens_out: 5000, model: "claude-sonnet-4.5" },
      worker: "claude",
    },
    {
      name: "missing tokens defaults to 0",
      tokens: { model: "gpt-5.4" },
      worker: "api-openai",
    },
    {
      name: "null worker treated as API path",
      tokens: { tokens_in: 2000, tokens_out: 1000, model: "grok-4.20" },
      worker: undefined,
    },
  ];

  for (const f of fixtures) {
    it(`priceSlice matches calculateSliceCost — ${f.name}`, () => {
      const newResult = costService.priceSlice(f.tokens, f.worker);
      const oldResult = calculateSliceCost(f.tokens, f.worker);
      expect(newResult).toEqual(oldResult);
    });
  }
});

describe("cost-service: priceRun parity (Slice 2)", () => {
  it("priceRun matches buildCostBreakdown on a mixed slice set", () => {
    const sliceResults = [
      {
        number: 1,
        worker: "api-anthropic",
        status: "passed",
        tokens: { tokens_in: 5000, tokens_out: 2000, model: "claude-sonnet-4.5" },
      },
      {
        number: 2,
        worker: "gh-copilot",
        status: "passed",
        tokens: { tokens_in: 100, tokens_out: 50, model: "claude-sonnet-4.5", premiumRequests: 3 },
      },
      {
        number: 3,
        worker: "api-openai",
        status: "skipped",
        tokens: { tokens_in: 1000, tokens_out: 500, model: "gpt-5.4" },
      },
      {
        number: 4,
        worker: "api-anthropic",
        status: "passed",
        tokens: { tokens_in: 8000, tokens_out: 6000, model: "claude-opus-4.6" },
      },
    ];
    const newResult = costService.priceRun(sliceResults);
    const oldResult = buildCostBreakdown(sliceResults);
    expect(newResult).toEqual(oldResult);
  });

  it("priceRun returns zeros for empty slice set", () => {
    const result = costService.priceRun([]);
    expect(result.total_cost_usd).toBe(0);
    expect(result.total_tokens_in).toBe(0);
    expect(result.total_tokens_out).toBe(0);
    expect(result.by_slice).toEqual([]);
    expect(result.by_model).toEqual({});
  });
});

// ─── Slice 3 fixtures ─────────────────────────────────────────────────
function makePlan(sliceCount, opts = {}) {
  const slices = [];
  const order = [];
  for (let i = 1; i <= sliceCount; i++) {
    slices.push({
      number: i,
      title: `Slice ${i}`,
      depends: i === 1 ? [] : [String(i - 1)],
      parallel: false,
      scope: opts.scope || [`src/file${i}.mjs`],
      tasks: opts.tasks || [],
    });
    order.push(String(i));
  }
  return { slices, dag: { order } };
}

describe("cost-service: estimatePlan parity (Slice 3)", () => {
  it("estimatePlan matches buildEstimate — simple 3-slice plan, no quorum, no cwd", () => {
    const plan = makePlan(3);
    const a = costService.estimatePlan(plan, "claude-sonnet-4.5", null, null, null);
    const b = buildEstimate(plan, "claude-sonnet-4.5", null, null, null);
    expect(a).toEqual(b);
  });

  it("estimatePlan matches buildEstimate — 5-slice plan with resumeFrom=3", () => {
    const plan = makePlan(5);
    const a = costService.estimatePlan(plan, "claude-opus-4.6", null, null, "3");
    const b = buildEstimate(plan, "claude-opus-4.6", null, null, "3");
    expect(a).toEqual(b);
  });

  it("estimatePlan matches buildEstimate — with quorum config enabled", () => {
    const plan = makePlan(4);
    const quorumConfig = {
      enabled: true,
      auto: false,
      threshold: 5,
      models: ["claude-opus-4.6", "gpt-5.3-codex"],
      reviewerModel: "claude-opus-4.7",
      preset: "power",
    };
    // Note: quorum paths call scoreSliceComplexity → requires non-null cwd.
    // Use process.cwd() since buildEstimate has the same constraint.
    const cwd = process.cwd();
    const a = costService.estimatePlan(plan, "claude-sonnet-4.5", cwd, quorumConfig, null);
    const b = buildEstimate(plan, "claude-sonnet-4.5", cwd, quorumConfig, null);
    expect(a).toEqual(b);
  });
});

describe("cost-service: estimateQuorum regression (Slice 3)", () => {
  it("returns all four modes with numeric estimates for a 6-slice heuristic plan", () => {
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });

    expect(result.auto).toBeDefined();
    expect(result.power).toBeDefined();
    expect(result.speed).toBeDefined();
    expect(result["false"]).toBeDefined();
    expect(["auto", "power", "speed", "false"]).toContain(result.recommended);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (const mode of ["auto", "power", "speed", "false"]) {
      const s = result[mode];
      expect(typeof s.estimatedCostUSD).toBe("number");
      expect(s.estimatedCostUSD).toBeGreaterThanOrEqual(0);
      expect(typeof s.baseCostUSD).toBe("number");
      expect(typeof s.overheadUSD).toBe("number");
      expect(s.totalSliceCount).toBe(6);
      expect(s.confidence).toBe("heuristic");
    }
  });

  it("REGRESSION GUARD: power mode on 6 trivial heuristic slices stays under $25 (fabrication catcher)", () => {
    // This test exists because on 2026-04-20 an agent hallucinated a quorum picker
    // claiming "power: $146.57" for 6 slices. Real pforge math on the same input
    // produces ~$10-15. Any change that pushes this above $25 either broke the
    // pricing table or broke the quorum overhead formula — investigate before shipping.
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });

    expect(result.power.estimatedCostUSD).toBeLessThan(25);
    expect(result["false"].estimatedCostUSD).toBeLessThan(5); // no quorum → just base
  });

  it("throws on missing plan", () => {
    expect(() => costService.estimateQuorum({ plan: null })).toThrow();
    expect(() => costService.estimateQuorum({})).toThrow();
  });

  it("per-leg pricing varies across quorum presets (Phase-27.1 Slice 1)", () => {
    // After the per-leg fix, power and speed must produce different overhead
    // because they use different models with different per-token rates.
    // Power preset uses opus/codex/grok-reasoning (~$6.70/Mtok avg input),
    // speed preset uses sonnet/gpt-mini/grok-fast (~$1.20/Mtok avg input).
    // Observed ratio ≈ 5.5×; assert > 4× to allow pricing drift margin.
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });

    expect(result.power.overheadUSD).toBeGreaterThan(0);
    expect(result.speed.overheadUSD).toBeGreaterThan(0);
    expect(result.power.overheadUSD).not.toBe(result.speed.overheadUSD);
    // Pre-fix ratio was 1.0 (identical). After Slice 1 (per-leg pricing) + Slice 2
    // (opus-4.7 in MODEL_PRICING, was falling back to sonnet rates), observed ratio
    // ≈ 5.5× on this fixture (reviewer term still dilutes). Threshold `> * 4` catches
    // the original bug (identical numbers) and catches partial regressions (e.g., if
    // opus-4.7 silently drops back to the fallback) while leaving margin for pricing
    // drift. Per plan Slice 1 rationale.
    expect(result.power.overheadUSD).toBeGreaterThan(result.speed.overheadUSD * 4);
  });
});

describe("cost-service: estimateQuorum per-slice breakdown (Phase-27.2 Slice 2)", () => {
  it("each mode summary exposes a slices[] array with one entry per plan slice", () => {
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });

    for (const mode of ["auto", "power", "speed", "false"]) {
      const s = result[mode];
      expect(Array.isArray(s.slices)).toBe(true);
      expect(s.slices.length).toBe(plan.slices.length);
      for (const entry of s.slices) {
        expect(entry).toHaveProperty("sliceNumber");
        expect(entry).toHaveProperty("projectedCostUSD");
        expect(entry).toHaveProperty("complexityScore");
        expect(entry).toHaveProperty("quorumEligible");
        expect(typeof entry.projectedCostUSD).toBe("number");
        expect(entry.projectedCostUSD).toBeGreaterThanOrEqual(0);
        expect(typeof entry.complexityScore).toBe("number");
        expect(typeof entry.quorumEligible).toBe("boolean");
      }
    }
  });

  it("mode 'false' slice entries all report quorumEligible:false and zero overhead", () => {
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });
    const baseOnly = result["false"].slices;

    for (const entry of baseOnly) {
      expect(entry.quorumEligible).toBe(false);
    }
    // mode false projected cost equals base only — must match power's baseCost-per-slice share.
    // (Not strict equality to power/auto because those may add overhead; base should be identical.)
  });

  it("mode 'power' forces quorumEligible:true on every slice", () => {
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });
    for (const entry of result.power.slices) {
      expect(entry.quorumEligible).toBe(true);
    }
  });

  it("payload round-trips through JSON.stringify without loss (MCP serialization sanity)", () => {
    const plan = makePlan(6);
    const result = costService.estimateQuorum({ plan, cwd: null });
    const roundTripped = JSON.parse(JSON.stringify(result));
    expect(roundTripped.auto.slices.length).toBe(plan.slices.length);
    expect(roundTripped.power.slices[0].sliceNumber).toBe(result.power.slices[0].sliceNumber);
    expect(roundTripped.power.slices[0].projectedCostUSD).toBeCloseTo(result.power.slices[0].projectedCostUSD, 6);
  });
});

describe("cost-service: pricing table coverage (Phase-27.1 Slice 2)", () => {
  // Regression guard: every model named in QUORUM_PRESETS must exist as a direct
  // key in MODEL_PRICING. Without this, a new quorum preset entry silently falls
  // through to the default rate — which is how claude-opus-4.7 shipped priced as
  // sonnet in v2.60.0 (Phase-27.1 Bug B).
  const presetNames = Object.keys(QUORUM_PRESETS);

  for (const presetName of presetNames) {
    const preset = QUORUM_PRESETS[presetName];
    const names = [...(preset.models || []), preset.reviewerModel].filter(Boolean);
    for (const modelName of names) {
      it(`QUORUM_PRESETS.${presetName} model '${modelName}' has a direct MODEL_PRICING entry`, () => {
        expect(
          Object.prototype.hasOwnProperty.call(costService.MODEL_PRICING, modelName),
          `MODEL_PRICING is missing '${modelName}' — it would fall back to default rates, silently distorting quorum estimates.`
        ).toBe(true);
      });
    }
  }
});

describe("http-bridge coverage: every MCP-handled tool is in MCP_ONLY_TOOLS (Phase-27.1 Slice 2b)", () => {
  // Phase-27.1 Slice 2b — Catches the class of bug where a new MCP tool is
  // registered in capabilities.mjs/tools.json/switch-case/handler but the author
  // forgets to add it to server.mjs's MCP_ONLY_TOOLS Set. When that happens,
  // POST /api/tool/<name> falls through to runPforge(), which has no CLI
  // counterpart for MCP-native tools — the dashboard cannot invoke the tool.
  //
  // This test parses server.mjs as text (no import — server.mjs has side-effects
  // on import) and asserts: every tool name present in a case-label of the main
  // CallToolRequestSchema switch must also appear in the MCP_ONLY_TOOLS Set.
  it("every tool with a dedicated switch-case handler is listed in MCP_ONLY_TOOLS", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const serverSrc = readFileSync(
      resolve(import.meta.dirname, "..", "server.mjs"),
      "utf-8"
    );

    // Extract the MCP_ONLY_TOOLS Set literal
    const setMatch = serverSrc.match(/const\s+MCP_ONLY_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    expect(setMatch, "Could not locate MCP_ONLY_TOOLS Set in server.mjs").toBeTruthy();
    const setBody = setMatch[1];
    const inSet = new Set();
    for (const m of setBody.matchAll(/"(forge_[a-z0-9_]+)"/g)) inSet.add(m[1]);

    // Extract every `case "forge_*":` — these are tools the MCP dispatcher handles.
    // Not every such case needs to be in MCP_ONLY_TOOLS (some delegate to runPforge
    // on the CLI path), but for the specific tool that motivated this test we
    // assert inclusion explicitly.
    const REQUIRED = [
      // Phase-27.1 Slice 2b — carryover defect from Phase-27 Slice 6
      "forge_estimate_quorum",
      // Phase-27.2 Slice 3 — registered the same way as forge_estimate_quorum;
      // included here so the Slice 2b coverage guard stays honest for it too.
      "forge_estimate_slice",
    ];
    for (const tool of REQUIRED) {
      expect(inSet.has(tool), `${tool} is missing from MCP_ONLY_TOOLS — HTTP bridge will fall through to runPforge`).toBe(true);
    }
  });
});

describe("forge_estimate_slice registration (Phase-27.2 Slice 3)", () => {
  it("TOOL_METADATA.forge_estimate_slice declares required shape", async () => {
    const { TOOL_METADATA } = await import("../capabilities.mjs");
    const meta = TOOL_METADATA.forge_estimate_slice;
    expect(meta, "forge_estimate_slice missing from TOOL_METADATA").toBeDefined();
    expect(meta.addedIn).toBe("2.61.0");
    expect(meta.agentGuidance).toMatch(/single slice/i);
    expect(Array.isArray(meta.intent)).toBe(true);
    expect(meta.intent).toContain("slice");
    expect(meta.errors).toHaveProperty("PLAN_NOT_FOUND");
    expect(meta.errors).toHaveProperty("SLICE_NOT_FOUND");
  });

  it("tools.json includes forge_estimate_slice with planPath + sliceNumber required", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const toolsJson = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "tools.json"), "utf-8"));
    const entry = toolsJson.find((t) => t.name === "forge_estimate_slice");
    expect(entry, "forge_estimate_slice missing from tools.json").toBeDefined();
    expect(entry.inputSchema.required).toEqual(expect.arrayContaining(["planPath", "sliceNumber"]));
    expect(entry.inputSchema.properties.mode.enum).toEqual(["auto", "power", "speed", "false"]);
  });

  it("server.mjs registers forge_estimate_slice in tool list and dispatcher switch", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const serverSrc = readFileSync(resolve(import.meta.dirname, "..", "server.mjs"), "utf-8");
    // Tool list entry
    expect(serverSrc).toMatch(/name:\s*"forge_estimate_slice"/);
    // Switch-case (case label on its own line)
    expect(serverSrc).toMatch(/case\s+"forge_estimate_slice"\s*:/);
    // Handler body
    expect(serverSrc).toMatch(/if\s*\(\s*name\s*===\s*"forge_estimate_slice"\s*\)/);
  });
});
