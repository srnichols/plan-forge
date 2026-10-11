import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockReasoningClient } from "../src/__fixtures__/MockReasoningClient.mjs";
import { runTurn } from "../src/reasoning.mjs";

const SUCCESS_LEGACY_KEYS = [
  "reply",
  "toolCalls",
  "tokensIn",
  "tokensOut",
  "totalCostUSD",
  "truncated",
  "sessionId",
  "requestedTier",
  "resolvedModel",
  "fallbackFromTier",
  "escalated",
  "autoEscalated",
  "fromTier",
  "toTier",
  "reason",
  "classification",
  "relatedTurns",
  "quorumResult",
];

const OFFTOPIC_LEGACY_KEYS = [
  "reply",
  "toolCalls",
  "tokensIn",
  "tokensOut",
  "totalCostUSD",
  "truncated",
  "sessionId",
  "requestedTier",
  "resolvedModel",
  "fallbackFromTier",
  "escalated",
  "autoEscalated",
  "fromTier",
  "toTier",
  "reason",
  "classification",
  "relatedTurns",
];

const NO_PROVIDER_LEGACY_KEYS = [
  "reply",
  "toolCalls",
  "tokensIn",
  "tokensOut",
  "totalCostUSD",
  "truncated",
  "error",
  "suggestion",
  "sessionId",
  "requestedTier",
  "resolvedModel",
  "fallbackFromTier",
  "escalated",
  "autoEscalated",
  "fromTier",
  "toTier",
  "reason",
  "classification",
  "relatedTurns",
];

let testDir;

function makeTestDir() {
  testDir = mkdtempSync(join(tmpdir(), "forge-master-turn-contract-"));
  return testDir;
}

function makeDeps(client, overrides = {}) {
  return {
    provider: client,
    skipPlanner: true,
    forceKeywordOnly: true,
    dispatcher: async () => ({ result: "ok" }),
    hub: null,
    toolMetadata: {},
    recall: async () => null,
    config: {
      reasoningModel: "test-model",
      reasoningProvider: "anthropic",
      reasoningProviderExplicit: true,
      routerModel: "test-router",
      maxToolCalls: 5,
      ceilingToolCalls: 10,
      l3Enabled: false,
      discoverExtensionTools: true,
      sessionRetentionDays: 14,
    },
    getForgeMasterConfig: () => ({
      reasoningModel: "test-model",
      reasoningProvider: "anthropic",
      reasoningProviderExplicit: true,
      routerModel: "test-router",
      maxToolCalls: 5,
      ceilingToolCalls: 10,
      l3Enabled: false,
      discoverExtensionTools: true,
      sessionRetentionDays: 14,
    }),
    ...overrides,
  };
}

function withoutUsage(result) {
  const { usage, ...legacy } = result;
  return legacy;
}

afterEach(() => {
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
});

describe("Guard: no new fields → identical result shape", () => {
  it("retains every legacy key and value, with usage as the only additive key", async () => {
    const cwd = makeTestDir();
    const run = () => runTurn(
      { message: "what is my plan status?", cwd, sessionId: "ephemeral" },
      makeDeps(new MockReasoningClient([{ type: "reply", content: "Plan is ready." }])),
    );
    const first = await run();
    const second = await run();
    // Shared Contract MUST at L195 requires usage as the sole additive result key.
    expect(Object.keys(first).sort()).toEqual([...SUCCESS_LEGACY_KEYS, "usage"].sort());
    expect(withoutUsage(second)).toEqual(withoutUsage(first));
    expect(typeof first.truncated).toBe("boolean");
    expect(first.usage.tokensIn).toBe(first.tokensIn);
  });

  it("keeps the off-topic result shape and reports known zero usage", async () => {
    const cwd = makeTestDir();
    const result = await runTurn(
      { message: "what is the weather in Boise?", cwd, sessionId: "ephemeral" },
      makeDeps(new MockReasoningClient([])),
    );
    expect(Object.keys(result).sort()).toEqual([...OFFTOPIC_LEGACY_KEYS, "usage"].sort());
    expect(result.usage).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUSD: 0,
      model: null,
      provider: null,
    });
  });

  it("keeps the no-provider result shape and leaves unknown usage null", async () => {
    const cwd = makeTestDir();
    const result = await runTurn(
      { message: "what is my plan status?", cwd, sessionId: "ephemeral" },
      makeDeps(null, {
        getForgeMasterConfig: () => ({
          reasoningModel: "test-model",
          reasoningProvider: "unsupported",
          reasoningProviderExplicit: true,
          routerModel: "test-router",
          maxToolCalls: 5,
          ceilingToolCalls: 10,
          l3Enabled: false,
          discoverExtensionTools: true,
          sessionRetentionDays: 14,
        }),
        config: {
          reasoningModel: "test-model",
          reasoningProvider: "unsupported",
          reasoningProviderExplicit: true,
          routerModel: "test-router",
          maxToolCalls: 5,
          ceilingToolCalls: 10,
          l3Enabled: false,
          discoverExtensionTools: true,
          sessionRetentionDays: 14,
        },
      }),
    );
    expect(Object.keys(result).sort()).toEqual([...NO_PROVIDER_LEGACY_KEYS, "usage"].sort());
    expect(result.usage.tokensIn).toBeNull();
    expect(result.usage.tokensOut).toBeNull();
    expect(result.usage.costUSD).toBeNull();
  }, 15000);
});

describe("turn input validation before side effects", () => {
  it("rejects invalid input before model calls, session writes, or classification", async () => {
    const cwd = makeTestDir();
    const client = new MockReasoningClient([]);
    let classifications = 0;
    const result = await runTurn(
      { message: "what is my plan status?", cwd, sessionId: "invalid-session", caller: null },
      makeDeps(client, { onClassification: () => { classifications++; } }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      field: "caller",
      reply: "",
      toolCalls: [],
    });
    expect(client.callCount).toBe(0);
    expect(classifications).toBe(0);
    expect(existsSync(join(cwd, ".forge"))).toBe(false);
  });
});

describe("usage provider and unknown-token tracking", () => {
  it("reports the fallback provider that answered", async () => {
    const cwd = makeTestDir();
    const primaryProvider = {
      PROVIDER_NAME: "githubCopilot",
      runLoop: async () => { throw new Error("primary unavailable"); },
    };
    const fallbackProvider = {
      PROVIDER_NAME: "anthropic",
      sendTurn: async () => ({ type: "reply", content: "Fallback answer", tokensIn: 7, tokensOut: 3 }),
    };
    const result = await runTurn(
      { message: "what is my plan status?", cwd, sessionId: "ephemeral" },
      makeDeps(null, {
        provider: undefined,
        getForgeMasterConfig: () => ({
          reasoningModel: "test-model",
          reasoningProvider: null,
          reasoningProviderExplicit: false,
          defaultProvider: "githubCopilot",
          routerModel: "test-router",
          maxToolCalls: 5,
          ceilingToolCalls: 10,
          l3Enabled: false,
          discoverExtensionTools: true,
          sessionRetentionDays: 14,
        }),
        config: {
          reasoningModel: "test-model",
          reasoningProvider: null,
          reasoningProviderExplicit: false,
          defaultProvider: "githubCopilot",
          routerModel: "test-router",
          maxToolCalls: 5,
          ceilingToolCalls: 10,
          l3Enabled: false,
          discoverExtensionTools: true,
          sessionRetentionDays: 14,
        },
        _providers: {
          githubCopilot: { module: primaryProvider, isAvailable: () => true },
          anthropic: { module: fallbackProvider, isAvailable: () => true },
        },
      }),
    );
    expect(result.reply).toBe("Fallback answer");
    expect(result.usage.provider).toBe("anthropic");
  });

  it("uses null when the provider does not report token counts", async () => {
    const cwd = makeTestDir();
    const provider = {
      PROVIDER_NAME: "anthropic",
      runLoop: async () => ({ reply: "No telemetry reported.", toolCalls: [] }),
    };
    const result = await runTurn(
      { message: "what is my plan status?", cwd, sessionId: "ephemeral" },
      makeDeps(provider),
    );
    expect(result.usage.tokensIn).toBeNull();
    expect(result.usage.tokensOut).toBeNull();
    expect(result.usage.costUSD).toBeNull();
  });
});
