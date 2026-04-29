import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { estimatePlan } from "../cost-service.mjs";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

// Clean cwd: no .forge/ — heuristic tokens, no history
const CLEAN_CWD = import.meta.dirname;

// Big-history cwd: created at test runtime with large token counts so
// anthropic-api estimate exceeds $5 over 6 slices.
const BIG_HISTORY_CWD = resolve(import.meta.dirname, "_big-history-fixture");
const BIG_HISTORY_FORGE_DIR = resolve(BIG_HISTORY_CWD, ".forge");
const BIG_HISTORY_FILE = resolve(BIG_HISTORY_FORGE_DIR, "cost-history.json");

const bigHistoryData = [
  { total_tokens_in: 200000, total_tokens_out: 500000, sliceCount: 3, total_cost_usd: 16.5, estimated_cost_usd: 15.0 },
  { total_tokens_in: 220000, total_tokens_out: 510000, sliceCount: 3, total_cost_usd: 17.1, estimated_cost_usd: 16.0 },
  { total_tokens_in: 180000, total_tokens_out: 490000, sliceCount: 3, total_cost_usd: 15.9, estimated_cost_usd: 14.5 },
];

beforeAll(() => {
  mkdirSync(BIG_HISTORY_FORGE_DIR, { recursive: true });
  writeFileSync(BIG_HISTORY_FILE, JSON.stringify(bigHistoryData));
});

afterAll(() => {
  rmSync(BIG_HISTORY_CWD, { recursive: true, force: true });
});

function makePlan(sliceCount) {
  const slices = [];
  const order = [];
  for (let i = 1; i <= sliceCount; i++) {
    slices.push({
      number: i,
      title: `Slice ${i}`,
      depends: i === 1 ? [] : [String(i - 1)],
      parallel: false,
      scope: [`src/file${i}.mjs`],
      tasks: [],
    });
    order.push(String(i));
  }
  return { slices, dag: { order } };
}

describe("estimatePlan — provider awareness (Phase-34 Slice 2)", () => {
  it("Case A: gh-copilot via env → estimated_cost_usd < $1 for 6-slice plan", () => {
    const originalEnv = process.env.PFORGE_COST_MODEL;
    const originalKey = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.PFORGE_COST_MODEL = "gh-copilot";
      delete process.env.ANTHROPIC_API_KEY;

      const plan = makePlan(6);
      const estimate = estimatePlan(plan, "claude-sonnet-4.6", CLEAN_CWD);

      expect(estimate.estimated_cost_usd).toBeLessThan(1.0);
      expect(estimate.pricingMode).toBe("subscription");
      expect(estimate.provider).toBe("gh-copilot");
    } finally {
      if (originalEnv === undefined) delete process.env.PFORGE_COST_MODEL;
      else process.env.PFORGE_COST_MODEL = originalEnv;
      if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("Case B: anthropic-api via ANTHROPIC_API_KEY → estimated_cost_usd > $5 for 6-slice plan (with history)", () => {
    const originalCostModel = process.env.PFORGE_COST_MODEL;
    const originalKey = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.PFORGE_COST_MODEL;
      process.env.ANTHROPIC_API_KEY = "test";

      const plan = makePlan(6);
      const estimate = estimatePlan(plan, "claude-sonnet-4.6", BIG_HISTORY_CWD);

      expect(estimate.estimated_cost_usd).toBeGreaterThan(5.0);
      expect(estimate.pricingMode).toBe("token");
      expect(estimate.provider).toBe("anthropic-api");
    } finally {
      if (originalCostModel === undefined) delete process.env.PFORGE_COST_MODEL;
      else process.env.PFORGE_COST_MODEL = originalCostModel;
      if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("Case C: returned object contains both provider and pricingMode keys", () => {
    const originalEnv = process.env.PFORGE_COST_MODEL;
    try {
      process.env.PFORGE_COST_MODEL = "gh-copilot";
      const plan = makePlan(3);
      const estimate = estimatePlan(plan, "claude-sonnet-4.6", CLEAN_CWD);

      expect(Object.prototype.hasOwnProperty.call(estimate, "provider")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(estimate, "pricingMode")).toBe(true);
    } finally {
      if (originalEnv === undefined) delete process.env.PFORGE_COST_MODEL;
      else process.env.PFORGE_COST_MODEL = originalEnv;
    }
  });

  it("estimatedCostUSD is preserved (existing field not removed)", () => {
    const plan = makePlan(4);
    const estimate = estimatePlan(plan, "gpt-5.4", CLEAN_CWD);
    expect(Object.prototype.hasOwnProperty.call(estimate, "estimatedCostUSD")).toBe(true);
    expect(estimate.estimatedCostUSD).toBe(estimate.estimated_cost_usd);
  });

  it("gh-copilot estimate math: 6 slices * 1.5 req/slice * $0.01 = $0.09", () => {
    const originalEnv = process.env.PFORGE_COST_MODEL;
    const originalKey = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.PFORGE_COST_MODEL = "gh-copilot";
      delete process.env.ANTHROPIC_API_KEY;
      const plan = makePlan(6);
      const estimate = estimatePlan(plan, "claude-sonnet-4.6", CLEAN_CWD);
      // 6 * 1.5 * 0.01 = 0.09, rounded to 2 decimal places = 0.09
      expect(estimate.estimated_cost_usd).toBe(0.09);
    } finally {
      if (originalEnv === undefined) delete process.env.PFORGE_COST_MODEL;
      else process.env.PFORGE_COST_MODEL = originalEnv;
      if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });
});
