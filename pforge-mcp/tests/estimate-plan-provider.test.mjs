/**
 * estimatePlan provider awareness (Phase-34 Slice 2, refreshed for #295/#305).
 *
 * The CLI subscription providers (claude-cli, codex-cli, grok-cli) are priced per
 * premium request; every other provider, gh-copilot included since #295, is
 * priced per token. The per-token Copilot math, including the cached share,
 * is covered in cost-service.test.mjs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimatePlan, SUBSCRIPTION_PROVIDERS } from "../cost-service.mjs";

const ENV_KEYS = ["PFORGE_COST_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"];
let savedEnv;
let cleanCwd;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  cleanCwd = mkdtempSync(join(tmpdir(), "pf-estimate-provider-"));
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(cleanCwd, { recursive: true, force: true });
});

function makePlan(sliceCount) {
  const slices = [];
  const order = [];
  for (let i = 1; i <= sliceCount; i++) {
    slices.push({ number: i, title: `Slice ${i}`, depends: i === 1 ? [] : [String(i - 1)], parallel: false, scope: [`src/file${i}.mjs`], tasks: [] });
    order.push(String(i));
  }
  return { slices, dag: { order } };
}

function writeHistory(cwd, entries) {
  mkdirSync(join(cwd, ".forge"), { recursive: true });
  writeFileSync(join(cwd, ".forge", "cost-history.json"), JSON.stringify(entries));
}

describe("estimatePlan — provider awareness", () => {
  it("prices a CLI subscription provider per premium request", () => {
    expect(SUBSCRIPTION_PROVIDERS.has("claude-cli")).toBe(true);
    process.env.PFORGE_COST_MODEL = "claude-cli";
    const estimate = estimatePlan({ plan: makePlan(6), model: "claude-sonnet-4.6", cwd: cleanCwd });
    expect(estimate.provider).toBe("claude-cli");
    expect(estimate.pricingMode).toBe("subscription");
    // No history: 1.5 premium requests per slice at $0.01 each.
    expect(estimate.estimated_cost_usd).toBe(0.09);
  });

  it("prices gh-copilot per token", () => {
    process.env.PFORGE_COST_MODEL = "gh-copilot";
    const estimate = estimatePlan({ plan: makePlan(6), model: "claude-sonnet-4.6", cwd: cleanCwd });
    expect(estimate.provider).toBe("gh-copilot");
    expect(estimate.pricingMode).toBe("token");
    expect(estimate.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("prices anthropic-api per token from cost history", () => {
    process.env.ANTHROPIC_API_KEY = "test";
    writeHistory(cleanCwd, [
      { total_tokens_in: 200000, total_tokens_out: 500000, sliceCount: 3, total_cost_usd: 16.5, estimated_cost_usd: 15.0 },
      { total_tokens_in: 220000, total_tokens_out: 510000, sliceCount: 3, total_cost_usd: 17.1, estimated_cost_usd: 16.0 },
      { total_tokens_in: 180000, total_tokens_out: 490000, sliceCount: 3, total_cost_usd: 15.9, estimated_cost_usd: 14.5 },
    ]);
    const estimate = estimatePlan({ plan: makePlan(6), model: "claude-sonnet-4.6", cwd: cleanCwd });
    expect(estimate.provider).toBe("anthropic-api");
    expect(estimate.pricingMode).toBe("token");
    expect(estimate.confidence).toBe("historical");
    expect(estimate.estimated_cost_usd).toBeGreaterThan(5);
  });

  it("keeps estimatedCostUSD equal to estimated_cost_usd", () => {
    const estimate = estimatePlan({ plan: makePlan(4), model: "gpt-5.4", cwd: cleanCwd });
    expect(estimate).toHaveProperty("provider");
    expect(estimate).toHaveProperty("pricingMode");
    expect(estimate.estimatedCostUSD).toBe(estimate.estimated_cost_usd);
  });
});
