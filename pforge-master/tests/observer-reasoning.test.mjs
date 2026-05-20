/**
 * Tests for observer reasoning — runObserverTurn (Phase-39, Slice 7).
 *
 * Covers:
 *   (1)  Module exports — runObserverTurn, OBSERVER_TOOL_ALLOWLIST
 *   (2)  Budget block → no LLM call, returns { ok: false, skipped: true }
 *   (3)  Budget block → emits observer:budget-blocked hub event
 *   (4)  Happy path → model called, narration returned
 *   (5)  Hub event emitted with correct shape (MUST #4 / MUST #5 companion)
 *   (6)  Brain capture called with correct key prefix and value shape
 *   (7)  Brain capture skipped when observerConfig.brainCapture === false
 *   (8)  OBSERVER_TOOL_ALLOWLIST has exactly 4 tools and the expected names
 *   (9)  Tool schemas passed to provider contain only allowlist tools
 *   (10) Budget state saved after successful narration
 *   (11) Model error returns { ok: false, skipped: false }
 *   (12) Empty batch handled gracefully
 *   (13) No provider available returns { ok: false, reason: 'no provider available' }
 *   (14) observer-prompt exports: OBSERVER_SYSTEM_PROMPT, formatBatchMessage, buildObserverPrompt
 *   (15) formatBatchMessage formats events correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  runObserverTurn,
  OBSERVER_TOOL_ALLOWLIST,
} from "../src/reasoning.mjs";

import {
  OBSERVER_SYSTEM_PROMPT,
  formatBatchMessage,
  buildObserverPrompt,
} from "../src/observer-prompt.mjs";

// ─── Stub helpers ─────────────────────────────────────────────────────

function makeFakeProvider(reply = "3 events — slice-2 completed normally, nothing notable.") {
  const calls = [];
  const provider = {
    PROVIDER_NAME: "stub",
    sendTurn: vi.fn(async ({ messages, tools, model }) => {
      calls.push({ messages, tools, model });
      return {
        type: "reply",
        content: reply,
        tokensIn: 10,
        tokensOut: 20,
      };
    }),
  };
  provider._calls = calls;
  return provider;
}

function makeFakeHub() {
  const broadcasts = [];
  return {
    broadcast: vi.fn((event) => broadcasts.push(event)),
    _broadcasts: broadcasts,
  };
}

function makeBudgetStatePassing() {
  return { dailyUsd: 0, dailyDate: "2099-01-01", hourlyNarrations: 0, hourlyHour: "2099-01-01T00" };
}

function makeBudgetStateExhausted() {
  return { dailyUsd: 999, dailyDate: "2099-01-01", hourlyNarrations: 99, hourlyHour: "2099-01-01T00" };
}

function makeObserverConfig(overrides = {}) {
  return {
    observer: {
      enabled: true,
      maxUsdPerDay: 1.0,
      maxNarrationsPerHour: 6,
      modelTier: null,
      brainCapture: true,
      ...overrides,
    },
    reasoningModel: "stub-model",
  };
}

function makeNopBudgetFns() {
  return {
    _checkBudget: () => ({ ok: true }),
    _recordSpend: (state) => state,
    _saveBudgetState: () => {},
  };
}

const SAMPLE_BATCH = [
  { type: "slice-started", timestamp: "2099-01-01T00:00:01.000Z", sliceId: "2" },
  { type: "slice-completed", timestamp: "2099-01-01T00:00:05.000Z", sliceId: "2" },
  { type: "cost-accrued", timestamp: "2099-01-01T00:00:05.100Z", costUSD: 0.000123 },
];

// ─── (1) Module exports ───────────────────────────────────────────────

describe("module exports", () => {
  it("exports runObserverTurn as an async function", () => {
    expect(typeof runObserverTurn).toBe("function");
  });

  it("exports OBSERVER_TOOL_ALLOWLIST as an array", () => {
    expect(Array.isArray(OBSERVER_TOOL_ALLOWLIST)).toBe(true);
  });
});

// ─── (2) Budget block — no LLM call ─────────────────────────────────

describe("runObserverTurn — budget block", () => {
  it("(2) returns ok:false, skipped:true when budget check fails, no LLM call", async () => {
    const provider = makeFakeProvider();
    const _checkBudget = () => ({ ok: false, reason: "daily USD cap exceeded" });

    const result = await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider,
      budgetState: makeBudgetStateExhausted(),
      _checkBudget,
      _recordSpend: (s) => s,
      _saveBudgetState: () => {},
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("daily USD cap exceeded");
    expect(result.narration).toBeNull();
    expect(provider.sendTurn).not.toHaveBeenCalled();
  });
});

// ─── (3) Budget block — hub event emitted ────────────────────────────

describe("runObserverTurn — budget block hub event", () => {
  it("(3) emits observer:budget-blocked event on the hub when budget is exceeded", async () => {
    const hub = makeFakeHub();
    const _checkBudget = () => ({ ok: false, reason: "hourly narration cap exceeded (6 >= limit 6)" });

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider: makeFakeProvider(),
      hub,
      budgetState: makeBudgetStateExhausted(),
      _checkBudget,
      _recordSpend: (s) => s,
      _saveBudgetState: () => {},
    });

    expect(hub.broadcast).toHaveBeenCalledTimes(1);
    const event = hub._broadcasts[0];
    expect(event.type).toBe("observer:budget-blocked");
    expect(typeof event.reason).toBe("string");
    expect(event.reason.length).toBeGreaterThan(0);
    expect(typeof event.timestamp).toBe("string");
  });
});

// ─── (4) Happy path ───────────────────────────────────────────────────

describe("runObserverTurn — happy path", () => {
  it("(4) calls the model and returns narration when budget is ok", async () => {
    const provider = makeFakeProvider("slice-2 completed normally. nothing notable.");

    const result = await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(result.ok).toBe(true);
    expect(result.narration).toBe("slice-2 completed normally. nothing notable.");
    expect(result.tokensIn).toBe(10);
    expect(result.tokensOut).toBe(20);
    expect(typeof result.usd).toBe("number");
    expect(provider.sendTurn).toHaveBeenCalledTimes(1);
  });
});

// ─── (5) Hub event shape ─────────────────────────────────────────────

describe("runObserverTurn — hub event", () => {
  it("(5a) emits observer:narration event on the hub after successful narration", async () => {
    const hub = makeFakeHub();
    const provider = makeFakeProvider("2 routine events.");

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider,
      hub,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(hub.broadcast).toHaveBeenCalledTimes(1);
    const event = hub._broadcasts[0];
    expect(event.type).toBe("observer:narration");
  });

  it("(5b) hub event has batchEventCount, narration, usd, modelTier fields", async () => {
    const hub = makeFakeHub();

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig({ modelTier: null }),
      provider: makeFakeProvider("ok"),
      hub,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    const event = hub._broadcasts[0];
    expect(event.batchEventCount).toBe(SAMPLE_BATCH.length);
    expect(typeof event.narration).toBe("string");
    expect(typeof event.usd).toBe("number");
    expect("modelTier" in event).toBe(true);
    expect(typeof event.timestamp).toBe("string");
  });
});

// ─── (6) Brain capture ───────────────────────────────────────────────

describe("runObserverTurn — brain capture", () => {
  it("(6) calls remember() with a project.observer.narration-<ts> key and correct value shape", async () => {
    const rememberedCalls = [];
    const remember = vi.fn((key, val) => rememberedCalls.push({ key, val }));

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig({ brainCapture: true }),
      provider: makeFakeProvider("something notable happened."),
      remember,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(remember).toHaveBeenCalledTimes(1);
    const [key, val] = remember.mock.calls[0];
    expect(key).toMatch(/^project\.observer\.narration-\d+$/);
    expect(typeof val.narration).toBe("string");
    expect(val.narration).toBe("something notable happened.");
    expect(typeof val.timestamp).toBe("string");
    expect(val.batchEventCount).toBe(SAMPLE_BATCH.length);
    expect(typeof val.usd).toBe("number");
  });
});

// ─── (7) Brain capture skipped ───────────────────────────────────────

describe("runObserverTurn — brain capture skipped", () => {
  it("(7) does NOT call remember() when brainCapture is false", async () => {
    const remember = vi.fn();

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig({ brainCapture: false }),
      provider: makeFakeProvider("ok"),
      remember,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(remember).not.toHaveBeenCalled();
  });
});

// ─── (8) OBSERVER_TOOL_ALLOWLIST content ─────────────────────────────

describe("OBSERVER_TOOL_ALLOWLIST", () => {
  it("(8a) has exactly 4 entries", () => {
    expect(OBSERVER_TOOL_ALLOWLIST).toHaveLength(4);
  });

  it("(8b) contains exactly the four declared read-only tools (RD #11)", () => {
    expect(OBSERVER_TOOL_ALLOWLIST).toContain("brain_recall");
    expect(OBSERVER_TOOL_ALLOWLIST).toContain("forge_search");
    expect(OBSERVER_TOOL_ALLOWLIST).toContain("forge_plan_status");
    expect(OBSERVER_TOOL_ALLOWLIST).toContain("forge_watch");
  });
});

// ─── (9) Tool schemas limited to allowlist ────────────────────────────

describe("runObserverTurn — tool schema allowlist enforcement", () => {
  it("(9) passes exactly the 4 observer-allowlist tool schemas to provider.sendTurn", async () => {
    const provider = makeFakeProvider("ok");

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(provider.sendTurn).toHaveBeenCalledTimes(1);
    const { tools } = provider.sendTurn.mock.calls[0][0];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(4);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("brain_recall");
    expect(toolNames).toContain("forge_search");
    expect(toolNames).toContain("forge_plan_status");
    expect(toolNames).toContain("forge_watch");
    // Verify no non-allowlisted tools leaked in
    expect(toolNames.every((n) => OBSERVER_TOOL_ALLOWLIST.includes(n))).toBe(true);
  });
});

// ─── (10) Budget state saved after successful narration ───────────────

describe("runObserverTurn — budget state persistence", () => {
  it("(10) calls saveBudgetState after successful narration", async () => {
    const _saveBudgetState = vi.fn();

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider: makeFakeProvider("ok"),
      budgetState: makeBudgetStatePassing(),
      _checkBudget: () => ({ ok: true }),
      _recordSpend: (state) => ({ ...state, hourlyNarrations: state.hourlyNarrations + 1 }),
      _saveBudgetState,
    });

    expect(_saveBudgetState).toHaveBeenCalledTimes(1);
    const savedState = _saveBudgetState.mock.calls[0][0];
    expect(typeof savedState).toBe("object");
  });

  it("(10b) the saved state has incremented hourlyNarrations", async () => {
    const savedStates = [];
    const initialState = makeBudgetStatePassing();

    await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider: makeFakeProvider("ok"),
      budgetState: initialState,
      _checkBudget: () => ({ ok: true }),
      _recordSpend: (state, { usd }) => ({
        ...state,
        dailyUsd: state.dailyUsd + usd,
        hourlyNarrations: state.hourlyNarrations + 1,
      }),
      _saveBudgetState: (s) => savedStates.push(s),
    });

    expect(savedStates).toHaveLength(1);
    expect(savedStates[0].hourlyNarrations).toBe(initialState.hourlyNarrations + 1);
  });
});

// ─── (11) Model error ────────────────────────────────────────────────

describe("runObserverTurn — model error", () => {
  it("(11) returns ok:false, skipped:false when provider.sendTurn throws", async () => {
    const provider = {
      PROVIDER_NAME: "stub",
      sendTurn: vi.fn(async () => { throw new Error("network timeout"); }),
    };

    const result = await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toContain("network timeout");
    expect(result.narration).toBeNull();
  });
});

// ─── (12) Empty batch ────────────────────────────────────────────────

describe("runObserverTurn — empty batch", () => {
  it("(12) handles an empty batch — still calls the model, returns ok:true", async () => {
    const provider = makeFakeProvider("0 events — nothing to narrate.");

    const result = await runObserverTurn([], {
      config: makeObserverConfig(),
      provider,
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(result.ok).toBe(true);
    expect(provider.sendTurn).toHaveBeenCalledTimes(1);
  });
});

// ─── (13) No provider available ──────────────────────────────────────

describe("runObserverTurn — no provider", () => {
  it("(13) returns ok:false with 'no provider available' when provider cannot be resolved", async () => {
    const result = await runObserverTurn(SAMPLE_BATCH, {
      config: makeObserverConfig(),
      provider: null,
      // Force autoSelectProvider to fail by providing a fake _providers map with no available provider
      _providers: {},
      budgetState: makeBudgetStatePassing(),
      ...makeNopBudgetFns(),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no provider available");
  });
});

// ─── (14) observer-prompt module exports ─────────────────────────────

describe("observer-prompt exports", () => {
  it("(14a) exports OBSERVER_SYSTEM_PROMPT as a non-empty string", () => {
    expect(typeof OBSERVER_SYSTEM_PROMPT).toBe("string");
    expect(OBSERVER_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("(14b) exports formatBatchMessage as a function", () => {
    expect(typeof formatBatchMessage).toBe("function");
  });

  it("(14c) exports buildObserverPrompt as a function", () => {
    expect(typeof buildObserverPrompt).toBe("function");
  });

  it("(14d) buildObserverPrompt returns { systemPrompt, userMessage }", () => {
    const result = buildObserverPrompt(SAMPLE_BATCH);
    expect(typeof result.systemPrompt).toBe("string");
    expect(typeof result.userMessage).toBe("string");
    expect(result.systemPrompt).toBe(OBSERVER_SYSTEM_PROMPT);
  });
});

// ─── (15) formatBatchMessage ─────────────────────────────────────────

describe("formatBatchMessage", () => {
  it("(15a) returns a message mentioning batch count", () => {
    const msg = formatBatchMessage(SAMPLE_BATCH);
    expect(msg).toContain("3 hub events");
  });

  it("(15b) includes event type in the output", () => {
    const msg = formatBatchMessage(SAMPLE_BATCH);
    expect(msg).toContain("slice-started");
    expect(msg).toContain("slice-completed");
    expect(msg).toContain("cost-accrued");
  });

  it("(15c) handles empty array", () => {
    const msg = formatBatchMessage([]);
    expect(msg).toContain("0 events");
  });

  it("(15d) handles null/undefined gracefully", () => {
    expect(() => formatBatchMessage(null)).not.toThrow();
    expect(() => formatBatchMessage(undefined)).not.toThrow();
    const msg = formatBatchMessage(null);
    expect(msg).toContain("0 events");
  });

  it("(15e) singular 'event' for a batch of 1", () => {
    const msg = formatBatchMessage([{ type: "run-started" }]);
    expect(msg).toMatch(/1 hub event[^s]/);
  });

  it("(15f) includes costUSD, sliceId, error when present", () => {
    const batch = [
      { type: "gate-failed", timestamp: "2099-01-01T00:00:00Z", sliceId: "3", error: "gate timed out" },
    ];
    const msg = formatBatchMessage(batch);
    expect(msg).toContain("slice: 3");
    expect(msg).toContain("error: gate timed out");
  });
});
