/**
 * `run-plan --estimate` must price the worker execution will actually use.
 *
 * Found on the testbed: Phase 7 on claude-opus-5.5 was estimated at $0.05 and
 * cost $1.89. The token forecast was right (1.21M vs 1.22M input); the price
 * was not. With no ANTHROPIC_API_KEY, cost-service assumed the flat Claude
 * Code subscription ("claude-cli"), but the machine had no claude CLI and the
 * run went through the Copilot CLI, which bills per token.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCostModel, estimatePlan, tokenCostForProvider, cacheSharesFromHistory } from "../cost-service.mjs";
import { predictWorkerForModel } from "../orchestrator/worker-spawn.mjs";

const cli = (name) => ({ name, type: "cli", available: true });

describe("detectCostModel with the worker execution will use", () => {
  it("prices a Claude model run by the Copilot CLI as Copilot token billing", () => {
    expect(detectCostModel({ env: {}, model: "claude-opus-5.5", worker: "gh-copilot" }))
      .toMatchObject({ provider: "gh-copilot", source: "worker:gh-copilot" });
  });

  it("keeps the Claude Code subscription when the claude CLI runs it", () => {
    expect(detectCostModel({ env: {}, model: "claude-opus-5.5", worker: "claude" }).provider).toBe("claude-cli");
  });

  it("leaves direct-API routes to the model rules", () => {
    expect(detectCostModel({ env: { ANTHROPIC_API_KEY: "test" }, model: "claude-opus-5.5", worker: "api:anthropic" }).provider)
      .toBe("anthropic-api");
  });

  it("still lets PFORGE_COST_MODEL and .forge.json cost.model override", () => {
    expect(detectCostModel({ env: { PFORGE_COST_MODEL: "claude-cli" }, model: "claude-opus-5.5", worker: "gh-copilot" }).provider).toBe("claude-cli");
    expect(detectCostModel({ env: {}, forgeConfig: { cost: { model: "claude-cli" } }, model: "claude-opus-5.5", worker: "gh-copilot" }).provider).toBe("claude-cli");
  });

  it("behaves as before without a worker", () => {
    expect(detectCostModel({ env: {}, model: "claude-opus-5.5" }).provider).toBe("claude-cli");
  });
});

describe("predictWorkerForModel", () => {
  it("picks the first available CLI worker, as execution does", () => {
    expect(predictWorkerForModel({ model: "claude-opus-5.5", workers: [cli("gh-copilot"), cli("claude")] })).toBe("gh-copilot");
    expect(predictWorkerForModel({ model: "claude-opus-5.5", workers: [cli("claude"), cli("gh-copilot")] })).toBe("claude");
  });

  it("ignores unavailable and API workers", () => {
    const workers = [{ name: "claude", type: "cli", available: false }, { name: "xai", type: "api", available: true }, cli("gh-copilot")];
    expect(predictWorkerForModel({ model: "claude-opus-5.5", workers })).toBe("gh-copilot");
  });

  it("routes Copilot-servable models to gh-copilot", () => {
    expect(predictWorkerForModel({ model: "gpt-6-luna", workers: [cli("claude"), cli("gh-copilot")] })).toBe("gh-copilot");
  });

  it("returns null when no worker is available", () => {
    expect(predictWorkerForModel({ model: "claude-opus-5.5", workers: [] })).toBeNull();
  });
});

describe("estimates use the cache shares runs actually had", () => {
  // The testbed's Phase 7 run: 1,217,400 input tokens, 1,047,500 cache reads,
  // 169,800 cache writes, 7,800 output, $1.89 actual — the estimate said $3.71
  // with a fixed 30% cache-read share and no cache writes.
  const RUN = { total_tokens_in: 1217400, total_tokens_out: 7800, total_cache_read_tokens: 1047500, total_cache_write_tokens: 169800 };
  const dirs = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const projectWithHistory = (entries) => {
    const dir = mkdtempSync(join(tmpdir(), "pf-estimate-cache-"));
    dirs.push(dir);
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(join(dir, ".forge", "cost-history.json"), JSON.stringify(entries.map((e) => ({ sliceCount: 3, status: "completed", total_cost_usd: 1.89, by_model: {}, ...e }))));
    return dir;
  };
  const plan = { slices: [1, 2, 3].map((n) => ({ number: String(n), title: `S${n}`, depends: [], scope: [] })), dag: { order: ["1", "2", "3"] }, meta: {} };

  it("derives read and write shares from runs that recorded them", () => {
    expect(cacheSharesFromHistory([RUN, { total_tokens_in: 1000 }])).toMatchObject({ read: 1047500 / 1217400, write: 169800 / 1217400, runs: 1 });
    expect(cacheSharesFromHistory([{ total_tokens_in: 1000, total_tokens_out: 10 }])).toBeNull();
  });

  it("prices the forecast with those shares, matching the actual cost formula", () => {
    const cwd = projectWithHistory([RUN]);
    const est = estimatePlan({ plan, model: "claude-opus-5.5", cwd, executionWorker: "gh-copilot" });
    const c = tokenCostForProvider({ model: "claude-opus-5.5", provider: "gh-copilot", tokensIn: 1217400, tokensOut: 7800, cacheRead: 1047500, cacheWrite: 169800 });
    const expected = c.inputUncachedCost + c.inputCacheReadCost + c.inputCacheWriteCost + c.outputCost;
    expect(est.estimatedCostUSD).toBeCloseTo(expected, 1);
    expect(est.estimatedCostUSD).toBeGreaterThan(1.5);
    expect(est.estimatedCostUSD).toBeLessThan(2.3);
  });
});
