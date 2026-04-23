/**
 * Tests for dispatchQuorum — Phase-38.7, Slice 1.
 *
 * Uses injectable deps (selectProvider, systemPrompt, timeoutMs) so
 * tests never make real HTTP calls.
 */

import { describe, it, expect, vi } from "vitest";
import {
  dispatchQuorum,
  extractDissent,
  MAX_MODELS,
  TIMEOUT_MS,
} from "../quorum-dispatcher.mjs";

// ─── Helpers ────────────────────────────────────────────────────────

function makeProvider(response, delayMs = 0) {
  return {
    sendTurn: vi.fn(async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return response;
    }),
  };
}

function makeReply(content = "ok", tokensIn = 100, tokensOut = 50) {
  return { type: "reply", content, tokensIn, tokensOut };
}

function makeDeps(providerMap, overrides = {}) {
  return {
    selectProvider: vi.fn(async (name) => providerMap[name] ?? null),
    systemPrompt: "You are a test assistant.",
    timeoutMs: overrides.timeoutMs ?? 5_000,
    ...overrides,
  };
}

// ─── dispatchQuorum ─────────────────────────────────────────────────

describe("dispatchQuorum", () => {
  // ── Parallel dispatch: all 3 succeed ────────────────────────────
  it("dispatches to all models in parallel and returns 3 replies", async () => {
    const providers = {
      anthropic: makeProvider(makeReply("Use library A"), 10),
      openai: makeProvider(makeReply("Use library B"), 10),
      xai: makeProvider(makeReply("Use library C"), 10),
    };
    const deps = makeDeps(providers);
    const models = [
      { model: "claude-sonnet-4", provider: "anthropic" },
      { model: "gpt-4o", provider: "openai" },
      { model: "grok-4", provider: "xai" },
    ];

    const start = Date.now();
    const result = await dispatchQuorum({ prompt: "Which library?", models, deps });
    const elapsed = Date.now() - start;

    expect(result.replies).toHaveLength(3);
    expect(result.replies[0].model).toBe("claude-sonnet-4");
    expect(result.replies[0].text).toBe("Use library A");
    expect(result.replies[0]).toHaveProperty("durationMs");
    expect(result.replies[0]).toHaveProperty("costUSD");
    expect(typeof result.replies[0].costUSD).toBe("number");
    expect(result.dissent).toHaveProperty("topic");
    expect(result.dissent).toHaveProperty("axis");

    // Verify parallel execution — total time should be close to single call, not 3×
    expect(elapsed).toBeLessThan(200);
  });

  // ── Partial failure: 1 of 3 fails, returns 2 ───────────────────
  it("returns partial results when 1 of 3 models fails", async () => {
    const providers = {
      anthropic: makeProvider(makeReply("Answer A")),
      openai: {
        sendTurn: vi.fn(async () => { throw new Error("provider error"); }),
      },
      xai: makeProvider(makeReply("Answer C")),
    };
    const deps = makeDeps(providers);
    const models = [
      { model: "claude-sonnet-4", provider: "anthropic" },
      { model: "gpt-4o", provider: "openai" },
      { model: "grok-4", provider: "xai" },
    ];

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies).toHaveLength(2);
    expect(result.replies.map((r) => r.model)).toEqual(["claude-sonnet-4", "grok-4"]);
  });

  // ── All models fail ─────────────────────────────────────────────
  it("returns all-failed dissent when every model fails", async () => {
    const providers = {
      anthropic: { sendTurn: vi.fn(async () => { throw new Error("fail"); }) },
      openai: { sendTurn: vi.fn(async () => { throw new Error("fail"); }) },
    };
    const deps = makeDeps(providers);
    const models = [
      { model: "claude-sonnet-4", provider: "anthropic" },
      { model: "gpt-4o", provider: "openai" },
    ];

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies).toHaveLength(0);
    expect(result.dissent).toEqual({ topic: "all-failed", axis: "" });
  });

  // ── Timeout: one model exceeds timeout ──────────────────────────
  it("omits a timed-out model and returns remaining replies", async () => {
    const providers = {
      anthropic: makeProvider(makeReply("Fast answer"), 5),
      openai: makeProvider(makeReply("Slow answer"), 10_000), // will exceed timeout
    };
    const deps = makeDeps(providers, { timeoutMs: 100 });
    const models = [
      { model: "claude-sonnet-4", provider: "anthropic" },
      { model: "gpt-4o", provider: "openai" },
    ];

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].model).toBe("claude-sonnet-4");
  });

  // ── Model cap: only first 3 models dispatched ──────────────────
  it("caps models at MAX_MODELS (3)", async () => {
    const provider = makeProvider(makeReply("ok"));
    const providers = { anthropic: provider };
    const deps = makeDeps(providers);
    const models = Array.from({ length: 5 }, (_, i) => ({
      model: `model-${i}`,
      provider: "anthropic",
    }));

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies).toHaveLength(3);
    expect(deps.selectProvider).toHaveBeenCalledTimes(3);
  });

  // ── Unknown provider → null → treated as failure ───────────────
  it("treats unknown provider (selectProvider returns null) as failure", async () => {
    const providers = {
      anthropic: makeProvider(makeReply("ok")),
    };
    const deps = makeDeps(providers);
    const models = [
      { model: "claude-sonnet-4", provider: "anthropic" },
      { model: "gpt-4o", provider: "nonexistent" },
    ];

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].model).toBe("claude-sonnet-4");
  });

  // ── Rate-limited response excluded ─────────────────────────────
  it("excludes rate_limited responses from replies", async () => {
    const providers = {
      anthropic: makeProvider(makeReply("ok")),
      openai: makeProvider({ type: "rate_limited", content: null, tokensIn: 0, tokensOut: 0 }),
    };
    const deps = makeDeps(providers);
    const models = [
      { model: "claude-sonnet-4", provider: "anthropic" },
      { model: "gpt-4o", provider: "openai" },
    ];

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0].model).toBe("claude-sonnet-4");
  });

  // ── Empty models array ──────────────────────────────────────────
  it("returns all-failed when models array is empty", async () => {
    const deps = makeDeps({});
    const result = await dispatchQuorum({ prompt: "test", models: [], deps });

    expect(result.replies).toHaveLength(0);
    expect(result.dissent).toEqual({ topic: "all-failed", axis: "" });
  });

  // ── Cost is computed from token counts ──────────────────────────
  it("computes costUSD from token counts via computeTurnCost", async () => {
    const providers = {
      anthropic: makeProvider(makeReply("ok", 1000, 500)),
    };
    const deps = makeDeps(providers);
    const models = [{ model: "claude-sonnet-4", provider: "anthropic" }];

    const result = await dispatchQuorum({ prompt: "test", models, deps });

    expect(result.replies[0].costUSD).toBeGreaterThan(0);
  });
});

// ─── extractDissent ─────────────────────────────────────────────────

describe("extractDissent", () => {
  it("returns empty topic/axis for a single reply", () => {
    const result = extractDissent([{ model: "m1", text: "Use React for the frontend" }]);
    expect(result).toEqual({ topic: "", axis: "" });
  });

  it("returns empty topic/axis for homogeneous replies", () => {
    const result = extractDissent([
      { model: "m1", text: "Use React because it has great community support and ecosystem" },
      { model: "m2", text: "Use React because it has great community support and ecosystem" },
    ]);
    expect(result).toEqual({ topic: "", axis: "" });
  });

  it("detects dissent between divergent replies", () => {
    const result = extractDissent([
      { model: "m1", text: "Use React because it has virtual DOM rendering, component composition, and hooks for state management. Facebook maintains it actively." },
      { model: "m2", text: "Use Svelte because it compiles away the framework, produces smaller bundles, uses reactive assignments natively without hooks overhead." },
    ]);
    expect(result.topic).toBe("recommendation");
    expect(result.axis.length).toBeGreaterThan(0);
    expect(result.axis).toContain("m1");
    expect(result.axis).toContain("m2");
  });

  it("returns empty strings for null/undefined input", () => {
    expect(extractDissent(null)).toEqual({ topic: "", axis: "" });
    expect(extractDissent(undefined)).toEqual({ topic: "", axis: "" });
    expect(extractDissent([])).toEqual({ topic: "", axis: "" });
  });
});
