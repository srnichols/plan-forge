import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  emptyCompactionState,
  foldUsage,
  maybeCompactSession,
  recordTurnConclusion,
  renderSummaryBlock,
  RETAIN_WINDOW,
  selectEvicted,
  settleSessionCompaction,
  shouldRegenerate,
  SUMMARY_HEADING,
  truncateUtf8,
} from "../src/session-compaction.mjs";
import { loadSessionSummary, saveSessionSummary } from "../src/persistence.mjs";
import { runTurn } from "../src/reasoning.mjs";
import { computeTurnCost } from "../src/cost.mjs";

const SESSION_ID = "compaction-test";
const SUMMARY_PATH = (cwd) => join(cwd, ".forge", "fm-sessions", `${SESSION_ID}.summary.json`);
const CONFIG = {
  reasoningModel: "gpt-4o-mini",
  reasoningTiers: { low: "gpt-4o-mini" },
  reasoningProvider: "anthropic",
  reasoningProviderExplicit: true,
  maxToolCalls: 5,
  l3Enabled: false,
  discoverExtensionTools: true,
};

let cwd;
let answerCount;
let promptCapture;

function makeCwd() {
  cwd = mkdtempSync(join(tmpdir(), "forge-session-compaction-"));
  return cwd;
}

function makeProvider({ tokensIn = 10, tokensOut = 5 } = {}) {
  answerCount = 0;
  promptCapture = [];
  return {
    PROVIDER_NAME: "test-provider",
    sendTurn: vi.fn(async ({ messages }) => {
      const system = messages.find((item) => item.role === "system")?.content || "";
      promptCapture.push(system);
      answerCount++;
      return {
        type: "reply",
        content: `Conclusion-T${answerCount}: answer`,
        ...(tokensIn === undefined ? {} : { tokensIn }),
        ...(tokensOut === undefined ? {} : { tokensOut }),
      };
    }),
  };
}

async function runOne(provider, deps = {}, extraInput = {}) {
  return runTurn(
    { message: `What is my plan status? Question ${answerCount + 1}?`, cwd, sessionId: SESSION_ID, ...extraInput },
    {
      provider,
      config: CONFIG,
      skipPlanner: true,
      forceKeywordOnly: true,
      dispatcher: async () => ({ result: "ok" }),
      recall: async () => null,
      ...deps,
    },
  );
}

async function runCount(count, provider, deps = {}) {
  const results = [];
  for (let index = 0; index < count; index++) results.push(await runOne(provider, deps));
  return results;
}

async function seedTenTurns() {
  let state = emptyCompactionState();
  for (let turn = 1; turn <= 10; turn++) {
    state = recordTurnConclusion(state, {
      turn,
      userMessage: `Question ${turn}`,
      reply: `Conclusion-T${turn}`,
      untrusted: false,
    });
  }
  await saveSessionSummary(SESSION_ID, state, cwd);
}

afterEach(async () => {
  vi.useRealTimers();
  await settleSessionCompaction();
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  cwd = null;
});

function readSettledSummary() {
  return settleSessionCompaction(SESSION_ID).then(() => JSON.parse(readFileSync(SUMMARY_PATH(cwd), "utf8")));
}

describe("rolling session summary", () => {
  it("does not summarize the first ten turns", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn();

    await runCount(10, provider, { summarizeSession });

    expect(summarizeSession).not.toHaveBeenCalled();
    expect((await readSettledSummary()).summary).toBeNull();
    expect(promptCapture.every((prompt) => !prompt.includes(SUMMARY_HEADING))).toBe(true);
  });

  it("generates the first summary after turn 11 and charges it to the next turn", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn(async ({ prompt }) => ({
      content: `Echo: ${prompt}`,
      tokensIn: 7,
      tokensOut: 3,
    }));

    const results = await runCount(12, provider, { summarizeSession });
    const state = await readSettledSummary();

    expect(summarizeSession).toHaveBeenCalledTimes(1);
    expect(summarizeSession.mock.calls[0][0].prompt).toContain("Conclusion-T1");
    expect(state.generatedAtTurn).toBe(11);
    expect(results[10].usage.tokensIn).toBe(10);
    expect(results[11].usage.tokensIn).toBe(17);
    expect(results[11].usage.tokensOut).toBe(8);
    expect(results[11].usage.costUSD).toBe(
      computeTurnCost("gpt-4o-mini", 10, 5) + computeTurnCost("gpt-4o-mini", 7, 3),
    );
    expect(results[11].tokensIn).toBe(10);
    expect(results[11].totalCostUSD).toBe(computeTurnCost("gpt-4o-mini", 10, 5));
    expect(state.pendingUsage).toBeNull();
    expect(state.summary).toContain("Conclusion-T1");
  });

  it("shows the turn-11 summary from turn 12, before prior conversation turns", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn(async ({ prompt }) => ({ content: `Summary: ${prompt}`, tokensIn: 2, tokensOut: 1 }));

    await runCount(11, provider, { summarizeSession });
    const turn12 = await runOne(provider, { summarizeSession });
    const systemPrompt = promptCapture.at(-1);

    expect(systemPrompt).toContain(SUMMARY_HEADING);
    expect(systemPrompt.indexOf(SUMMARY_HEADING)).toBeLessThan(systemPrompt.indexOf("## Prior conversation turns"));
    expect(turn12.usage.tokensIn).toBe(12);
    expect(summarizeSession).toHaveBeenCalledTimes(1);
  });

  it("reuses the summary through turns 12-15 and regenerates at turn 16", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn(async ({ prompt }) => ({
      content: `Summary-${summarizeSession.mock.calls.length}: ${prompt}`,
      tokensIn: 7,
      tokensOut: 3,
    }));

    const firstEleven = await runCount(11, provider, { summarizeSession });
    const middleTurns = await runCount(4, provider, { summarizeSession });
    const turn16 = await runOne(provider, { summarizeSession });
    const turn17 = await runOne(provider, { summarizeSession });

    expect(summarizeSession).toHaveBeenCalledTimes(2);
    expect(firstEleven[10].usage.tokensIn).toBe(10);
    expect(middleTurns.map((result) => result.usage.tokensIn)).toEqual([17, 10, 10, 10]);
    expect(turn16.usage.tokensIn).toBe(10);
    expect(turn17.usage.tokensIn).toBe(17);
    const secondPrompt = summarizeSession.mock.calls[1][0].prompt;
    expect(secondPrompt).toContain("Summary-1:");
    for (let turn = 2; turn <= 6; turn++) expect(secondPrompt).toContain(`Conclusion-T${turn}`);
  });

  it("keeps assistant conclusions in both the ledger and trusted rendered summary", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn(async ({ prompt }) => ({ content: `Echo: ${prompt}`, tokensIn: 1, tokensOut: 1 }));

    await runCount(11, provider, { summarizeSession });
    const state = await readSettledSummary();

    expect(state.ledger[0].conclusion).toContain("Conclusion-T2");
    expect(renderSummaryBlock(state)).toContain("Conclusion-T1");
  });

  it("preserves the prior summary and paces retries after a summarizer failure", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn()
      .mockRejectedValueOnce(new Error("summary failure"))
      .mockImplementation(async ({ prompt }) => ({ content: `Recovered: ${prompt}`, tokensIn: 2, tokensOut: 1 }));

    await runCount(10, provider, { summarizeSession });
    await settleSessionCompaction(SESSION_ID);
    const state = await loadSessionSummary(SESSION_ID, cwd);
    await saveSessionSummary(SESSION_ID, { ...state, summary: "Existing summary" }, cwd);

    const failedTurn = await runOne(provider, { summarizeSession });
    await settleSessionCompaction(SESSION_ID);
    const afterFailure = await loadSessionSummary(SESSION_ID, cwd);
    expect(failedTurn.reply).toContain("Conclusion-T11");
    expect(failedTurn.error).toBeUndefined();
    expect(failedTurn.usage.tokensIn).toBe(10);
    expect(afterFailure.summary).toBe("Existing summary");
    expect(afterFailure.lastAttemptTurn).toBe(11);

    await runCount(4, provider, { summarizeSession });
    expect(summarizeSession).toHaveBeenCalledTimes(1);
    await runOne(provider, { summarizeSession });
    await settleSessionCompaction(SESSION_ID);
    expect(summarizeSession).toHaveBeenCalledTimes(2);
  });

  it("keeps unknown usage null and does not change legacy usage fields", async () => {
    makeCwd();
    const provider = makeProvider({ tokensIn: null, tokensOut: null });
    const summarizeSession = vi.fn(async () => ({ content: "A compact summary", tokensIn: undefined, tokensOut: undefined }));

    const results = await runCount(12, provider, { summarizeSession });
    const result = results.at(-1);

    expect(summarizeSession).toHaveBeenCalledTimes(1);
    expect(result.usage.tokensIn).toBeNull();
    expect(result.usage.tokensOut).toBeNull();
    expect(result.usage.costUSD).toBeNull();
    expect(result.tokensIn).toBe(0);
    expect(result.totalCostUSD).toBe(0);
  });

  it("forwards the turn's resolved API key to the summary model", async () => {
    makeCwd();
    const provider = makeProvider();
    provider.PROVIDER_NAME = "anthropic";
    const resolveApiKey = vi.fn((name) => (name === "anthropic" ? "sk-test-anthropic" : null));

    await runCount(11, provider, { resolveApiKey });
    await settleSessionCompaction(SESSION_ID);

    const summaryCall = provider.sendTurn.mock.calls
      .map(([request]) => request)
      .find((request) => request.messages[0]?.content.startsWith("Summarize earlier conversation turns"));
    expect(summaryCall).toBeDefined();
    expect(summaryCall.apiKey).toBe("sk-test-anthropic");
    expect(summaryCall.tools).toEqual([]);
    expect((await loadSessionSummary(SESSION_ID, cwd)).generatedAtTurn).toBe(11);
  });

  it("summarizes with the provider, model, and key that served the turn after a fallback", async () => {
    makeCwd();
    await seedTenTurns();
    const primaryRunLoop = vi.fn(async () => {
      throw Object.assign(new Error("not signed in"), { code: "COPILOT_SDK_SESSION_FAILED" });
    });
    const fallback = {
      PROVIDER_NAME: "anthropic",
      sendTurn: vi.fn(async () => ({ type: "reply", content: "Fallback summary or answer.", tokensIn: 4, tokensOut: 2 })),
    };

    const result = await runTurn(
      { message: "What is my plan status? Question 11?", cwd, sessionId: SESSION_ID },
      {
        config: { ...CONFIG, reasoningProvider: null, reasoningProviderExplicit: false, defaultProvider: "githubCopilot" },
        skipPlanner: true,
        forceKeywordOnly: true,
        dispatcher: async () => ({ result: "ok" }),
        recall: async () => null,
        resolveApiKey: (name) => (name === "anthropic" ? "sk-fallback" : null),
        _providers: {
          githubCopilot: { module: { PROVIDER_NAME: "githubCopilot", runLoop: primaryRunLoop }, isAvailable: () => true },
          anthropic: { module: fallback, isAvailable: () => true },
        },
      },
    );
    await settleSessionCompaction(SESSION_ID);

    expect(result.fallbackFromTier).toBe("githubCopilot");
    expect(primaryRunLoop).toHaveBeenCalledTimes(1);
    const summaryCall = fallback.sendTurn.mock.calls.at(-1)[0];
    expect(summaryCall.messages[0].content).toMatch(/^Summarize earlier conversation turns/);
    expect(summaryCall.apiKey).toBe("sk-fallback");
    expect(summaryCall.model).toBe(result.resolvedModel);
    expect((await loadSessionSummary(SESSION_ID, cwd)).summary).toBe("Fallback summary or answer.");
  });

  it("returns the turn result without waiting for a slow summary", async () => {
    makeCwd();
    const provider = makeProvider();
    let releaseSummary;
    const summaryGate = new Promise((resolve) => { releaseSummary = resolve; });
    const summarizeSession = vi.fn(async () => {
      await summaryGate;
      return { content: "Slow summary", tokensIn: 7, tokensOut: 3 };
    });

    await runCount(10, provider, { summarizeSession });
    const turn11 = await runOne(provider, { summarizeSession });

    expect(turn11.reply).toContain("Conclusion-T11");
    expect(turn11.usage.tokensIn).toBe(10);
    await vi.waitFor(() => expect(summarizeSession).toHaveBeenCalledOnce(), { timeout: 1000 });
    expect((await loadSessionSummary(SESSION_ID, cwd)).summary).toBeNull();

    releaseSummary();
    await settleSessionCompaction(SESSION_ID);
    expect((await loadSessionSummary(SESSION_ID, cwd)).summary).toBe("Slow summary");
    const turn12 = await runOne(provider, { summarizeSession });
    expect(turn12.usage.tokensIn).toBe(17);
  });

  it("does not charge for empty summaries and times out a stalled summary call", async () => {
    makeCwd();
    await seedTenTurns();
    const emptyResult = await maybeCompactSession({
      sessionId: SESSION_ID,
      turnNumber: 11,
      message: "Question 11",
      reply: "Conclusion-T11",
      untrusted: false,
      cwd,
      provider: {},
      config: CONFIG,
      deps: { summarizeSession: vi.fn(async () => ({ content: " ", tokensIn: 8, tokensOut: 2 })) },
    });
    expect(emptyResult).toEqual({ usage: null, regenerated: false });
    expect((await loadSessionSummary(SESSION_ID, cwd)).lastAttemptTurn).toBe(11);

    const retryState = await loadSessionSummary(SESSION_ID, cwd);
    await saveSessionSummary(SESSION_ID, { ...retryState, lastAttemptTurn: 6 }, cwd);
    vi.useFakeTimers();
    const stalledSummarizer = vi.fn(() => new Promise(() => {}));
    const timeoutWork = maybeCompactSession({
      sessionId: SESSION_ID,
      turnNumber: 11,
      message: "Question 11",
      reply: "Conclusion-T11",
      untrusted: false,
      cwd,
      provider: {},
      config: CONFIG,
      deps: { summarizeSession: stalledSummarizer },
    });
    await vi.waitFor(() => expect(stalledSummarizer).toHaveBeenCalledOnce(), { timeout: 1000 });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await timeoutWork).toEqual({ usage: null, regenerated: false });
    expect((await loadSessionSummary(SESSION_ID, cwd)).summary).toBeNull();
  });

  it("does not create a sidecar or call the summarizer for ephemeral sessions", async () => {
    makeCwd();
    const provider = makeProvider();
    const summarizeSession = vi.fn();

    for (let index = 0; index < 12; index++) {
      await runTurn(
        { message: `What is my plan status? Question ${index + 1}?`, cwd, sessionId: "ephemeral" },
        { provider, config: CONFIG, skipPlanner: true, forceKeywordOnly: true, summarizeSession },
      );
    }

    expect(summarizeSession).not.toHaveBeenCalled();
    expect(existsSync(join(cwd, ".forge", "fm-sessions"))).toBe(false);
  });
});

describe("session compaction helpers", () => {
  it("selects only uncovered turns evicted from the retained window", () => {
    let state = emptyCompactionState();
    for (let turn = 1; turn <= 16; turn++) {
      state = recordTurnConclusion(state, { turn, userMessage: `Question ${turn}`, reply: `Conclusion ${turn}`, untrusted: false });
    }

    expect(shouldRegenerate(state, 10)).toBe(false);
    expect(shouldRegenerate(state, 11)).toBe(true);
    expect(shouldRegenerate({ ...state, lastAttemptTurn: 12 }, 16)).toBe(false);
    expect(shouldRegenerate({ ...state, lastAttemptTurn: 11 }, 16)).toBe(true);
    expect(selectEvicted({ ...state, coveredThroughTurn: 2 }, 16).map((entry) => entry.turn)).toEqual([3, 4, 5, 6]);
    expect(RETAIN_WINDOW).toBe(10);
  });

  it("truncates at a sentence boundary within the UTF-8 byte limit", () => {
    const ascii = truncateUtf8(`${"a".repeat(1500)}. ${"b".repeat(100)}`, 1536);
    const multibyte = truncateUtf8(`${"é".repeat(700)}. ${"界".repeat(100)}`, 1536);

    expect(Buffer.byteLength(ascii, "utf8")).toBeLessThanOrEqual(1536);
    expect(ascii.endsWith(".")).toBe(true);
    expect(Buffer.byteLength(multibyte, "utf8")).toBeLessThanOrEqual(1536);
    expect(multibyte.endsWith(".")).toBe(true);
  });

  it("folds known usage, preserves unknown fields, and preserves identity when unused", () => {
    const usage = { tokensIn: 10, tokensOut: 4, costUSD: 0.2, model: "answer-model", provider: "answer-provider" };
    const extra = { tokensIn: 3, tokensOut: null, costUSD: 0.1 };

    expect(foldUsage(usage, null)).toBe(usage);
    const folded = foldUsage(usage, extra);
    expect(folded.tokensIn).toBe(13);
    expect(folded.tokensOut).toBeNull();
    expect(folded.costUSD).toBeCloseTo(0.3);
    expect(folded.model).toBe("answer-model");
    expect(folded.provider).toBe("answer-provider");
    expect(foldUsage({ ...usage, tokensIn: null }, extra).tokensIn).toBeNull();
  });

  it("returns an empty state for corrupt files and rejects traversal ids", async () => {
    makeCwd();
    await saveSessionSummary(SESSION_ID, emptyCompactionState(), cwd);
    const path = SUMMARY_PATH(cwd);
    writeFileSync(path, "{broken json");

    expect(await loadSessionSummary(SESSION_ID, cwd)).toEqual(emptyCompactionState());
    expect(await loadSessionSummary("../x", cwd)).toEqual(emptyCompactionState());
    expect(await saveSessionSummary("../x", emptyCompactionState(), cwd)).toEqual({ ok: false, error: "invalid_session_id" });
  });

  it("keeps untrusted conclusions out of the trusted ledger", async () => {
    makeCwd();
    const usage = await maybeCompactSession({
      sessionId: SESSION_ID,
      turnNumber: 1,
      message: "untrusted message",
      reply: "answer",
      untrusted: true,
      cwd,
      provider: {},
      config: CONFIG,
    });

    expect(usage).toEqual({ usage: null, regenerated: false });
    expect((await loadSessionSummary(SESSION_ID, cwd)).ledger[0].conclusion).toBeNull();
  });

  it("supports both runLoop and sendTurn providers without enabling tools", async () => {
    makeCwd();
    await seedTenTurns();
    const runLoop = vi.fn(async () => ({ reply: "Loop summary", tokensIn: 4, tokensOut: 2 }));
    const loopResult = await maybeCompactSession({
      sessionId: SESSION_ID,
      turnNumber: 11,
      message: "Question 11",
      reply: "Conclusion-T11",
      untrusted: false,
      cwd,
      provider: { runLoop },
      config: CONFIG,
    });
    expect(loopResult.regenerated).toBe(true);
    expect(runLoop.mock.calls[0][0].tools).toEqual([]);
    expect(runLoop.mock.calls[0][0].maxToolCalls).toBe(0);
    expect((await loadSessionSummary(SESSION_ID, cwd)).summary).toBe("Loop summary");

    await seedTenTurns();
    const sendTurn = vi.fn(async () => ({ content: "Turn summary", tokensIn: 3, tokensOut: 1 }));
    const turnResult = await maybeCompactSession({
      sessionId: SESSION_ID,
      turnNumber: 11,
      message: "Question 11",
      reply: "Conclusion-T11",
      untrusted: false,
      cwd,
      provider: { sendTurn },
      config: CONFIG,
    });
    expect(turnResult.regenerated).toBe(true);
    expect(sendTurn.mock.calls[0][0].tools).toEqual([]);
    expect((await loadSessionSummary(SESSION_ID, cwd)).summary).toBe("Turn summary");
  });
});
