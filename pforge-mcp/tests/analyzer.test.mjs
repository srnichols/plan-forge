import { describe, it, expect } from "vitest";
import {
  inferSliceType,
  scoreSliceComplexity,
  calculateSliceCost,
  buildCostBreakdown,
} from "../orchestrator.mjs";

// ─── inferSliceType ───────────────────────────────────────────────────

describe("inferSliceType", () => {
  it("returns 'test' for slice with test-related title", () => {
    expect(inferSliceType({ title: "Write unit test for auth module", tasks: [] })).toBe("test");
  });

  it("returns 'test' for spec in tasks", () => {
    expect(inferSliceType({ title: "Auth module", tasks: ["Add spec coverage"] })).toBe("test");
  });

  it("returns 'review' for audit-related slice", () => {
    expect(inferSliceType({ title: "Code review and lint", tasks: [] })).toBe("review");
  });

  it("returns 'review' for analyze in title", () => {
    expect(inferSliceType({ title: "Analyze performance bottlenecks", tasks: [] })).toBe("review");
  });

  it("returns 'migration' for database migration slice", () => {
    expect(inferSliceType({ title: "Run database migration", tasks: [] })).toBe("migration");
  });

  it("returns 'migration' for schema task", () => {
    expect(inferSliceType({ title: "Setup module", tasks: ["Update schema definition"] })).toBe("migration");
  });

  it("returns 'execute' for generic implementation slice", () => {
    expect(inferSliceType({ title: "Implement user service", tasks: ["Create service class"] })).toBe("execute");
  });

  it("returns 'execute' for empty slice", () => {
    expect(inferSliceType({ title: "", tasks: [] })).toBe("execute");
  });
});

// ─── scoreSliceComplexity ─────────────────────────────────────────────

describe("scoreSliceComplexity", () => {
  const cwd = "C:\\nonexistent\\project"; // no .forge/runs → historicalWeight = 0

  it("returns score between 1 and 10", () => {
    const slice = { title: "Simple slice", tasks: [], scope: [], depends: [], validationGate: null };
    const { score } = scoreSliceComplexity(slice, cwd);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("returns signals object with all expected keys", () => {
    const slice = { title: "Setup", tasks: ["Do thing"], scope: ["src/a.ts"], depends: [], validationGate: null };
    const { signals } = scoreSliceComplexity(slice, cwd);
    expect(signals).toHaveProperty("scopeWeight");
    expect(signals).toHaveProperty("dependencyWeight");
    expect(signals).toHaveProperty("securityWeight");
    expect(signals).toHaveProperty("databaseWeight");
    expect(signals).toHaveProperty("gateWeight");
    expect(signals).toHaveProperty("taskWeight");
    expect(signals).toHaveProperty("historicalWeight");
  });

  it("increases score with more scope files", () => {
    const low  = { title: "T", tasks: [], scope: [], depends: [], validationGate: null };
    const high = { title: "T", tasks: [], scope: ["a","b","c","d","e"], depends: [], validationGate: null };
    const { score: lowScore }  = scoreSliceComplexity(low, cwd);
    const { score: highScore } = scoreSliceComplexity(high, cwd);
    expect(highScore).toBeGreaterThanOrEqual(lowScore);
  });

  it("security keywords raise securityWeight", () => {
    const slice = {
      title: "Handle JWT auth token and password credential validation",
      tasks: [], scope: [], depends: [], validationGate: null,
    };
    const { signals } = scoreSliceComplexity(slice, cwd);
    expect(signals.securityWeight).toBeGreaterThan(0);
  });

  it("database keywords raise databaseWeight", () => {
    const slice = {
      title: "Run migration and alter schema with foreign key",
      tasks: [], scope: [], depends: [], validationGate: null,
    };
    const { signals } = scoreSliceComplexity(slice, cwd);
    expect(signals.databaseWeight).toBeGreaterThan(0);
  });

  it("caps scopeWeight at 1 for 5+ files", () => {
    const slice = {
      title: "T", tasks: [], scope: ["a","b","c","d","e","f","g"], depends: [], validationGate: null,
    };
    const { signals } = scoreSliceComplexity(slice, cwd);
    expect(signals.scopeWeight).toBe(1);
  });
});

// ─── calculateSliceCost ───────────────────────────────────────────────

describe("calculateSliceCost", () => {
  it("calculates API cost for known Claude model", () => {
    const tokens = { model: "claude-sonnet-4.6", tokens_in: 1_000_000, tokens_out: 100_000 };
    const result = calculateSliceCost(tokens, "api-claude");
    // 1M * (3/1M) + 100k * (15/1M) = 3 + 1.5 = 4.5
    expect(result.cost_usd).toBeCloseTo(4.5, 4);
    expect(result.model).toBe("claude-sonnet-4.6");
  });

  it("calculates API cost for unknown model using default pricing", () => {
    const tokens = { model: "unknown-model", tokens_in: 1_000_000, tokens_out: 0 };
    const result = calculateSliceCost(tokens, "api-custom");
    // 1M * (3/1M) = 3
    expect(result.cost_usd).toBeCloseTo(3, 4);
  });

  it("calculates CLI subscription cost via premiumRequests", () => {
    const tokens = { model: "claude-sonnet-4.6", premiumRequests: 10, tokens_in: 5000, tokens_out: 2000 };
    const result = calculateSliceCost(tokens, "gh-copilot");
    // 10 * 0.01 = 0.10
    expect(result.cost_usd).toBeCloseTo(0.10, 4);
  });

  it("returns zero cost for CLI worker with no premium requests", () => {
    const tokens = { model: "claude-sonnet-4.6", premiumRequests: 0 };
    const result = calculateSliceCost(tokens, "copilot");
    expect(result.cost_usd).toBe(0);
  });

  it("handles missing tokens gracefully", () => {
    const result = calculateSliceCost(null, "gh-copilot");
    expect(result.cost_usd).toBe(0);
    expect(result.tokens_in).toBe(0);
    expect(result.tokens_out).toBe(0);
  });

  it("returns token counts in result", () => {
    const tokens = { model: "gpt-4.1", tokens_in: 500, tokens_out: 200 };
    const result = calculateSliceCost(tokens, "api-openai");
    expect(result.tokens_in).toBe(500);
    expect(result.tokens_out).toBe(200);
  });
});

// ─── buildCostBreakdown ───────────────────────────────────────────────

describe("buildCostBreakdown", () => {
  it("returns zero totals for empty results", () => {
    const result = buildCostBreakdown([]);
    expect(result.total_cost_usd).toBe(0);
    expect(result.total_tokens_in).toBe(0);
    expect(result.by_slice).toHaveLength(0);
  });

  it("skips slices with status=skipped", () => {
    const slices = [
      { number: "1", status: "skipped", tokens: { model: "claude-sonnet-4.6", tokens_in: 1000, tokens_out: 500 }, worker: "api-claude" },
    ];
    const result = buildCostBreakdown(slices);
    expect(result.total_cost_usd).toBe(0);
    expect(result.by_slice).toHaveLength(0);
  });

  it("skips slices without tokens", () => {
    const slices = [{ number: "1", status: "completed", tokens: null, worker: "gh-copilot" }];
    const result = buildCostBreakdown(slices);
    expect(result.total_cost_usd).toBe(0);
  });

  it("aggregates cost from multiple slices", () => {
    const slices = [
      { number: "1", tokens: { model: "gpt-4.1", tokens_in: 1_000_000, tokens_out: 0 }, worker: "api-openai" },
      { number: "2", tokens: { model: "gpt-4.1", tokens_in: 1_000_000, tokens_out: 0 }, worker: "api-openai" },
    ];
    const result = buildCostBreakdown(slices);
    // 2 * (1M * 2/1M) = 4
    expect(result.total_cost_usd).toBeCloseTo(4, 2);
    expect(result.by_slice).toHaveLength(2);
  });

  it("groups by model in by_model", () => {
    const slices = [
      { number: "1", tokens: { model: "claude-haiku-4.5", tokens_in: 100, tokens_out: 100 }, worker: "api-claude" },
      { number: "2", tokens: { model: "gpt-5-mini", tokens_in: 100, tokens_out: 100 }, worker: "api-openai" },
    ];
    const result = buildCostBreakdown(slices);
    expect(result.by_model).toHaveProperty("claude-haiku-4.5");
    expect(result.by_model).toHaveProperty("gpt-5-mini");
    expect(result.by_model["claude-haiku-4.5"].slices).toBe(1);
  });

  it("includes total_tokens_in and total_tokens_out", () => {
    const slices = [
      { number: "1", tokens: { model: "gpt-4.1", tokens_in: 300, tokens_out: 200 }, worker: "api-openai" },
    ];
    const result = buildCostBreakdown(slices);
    expect(result.total_tokens_in).toBe(300);
    expect(result.total_tokens_out).toBe(200);
  });
});
