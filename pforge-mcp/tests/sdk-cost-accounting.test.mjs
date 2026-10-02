/**
 * #307 prerequisite — price SDK-routed work the way the spawn path is priced.
 *
 * runSdkSession reported worker "sdk", which cost-service did not map to a
 * provider, so routing.copilotSdk="prefer" runs were priced at vendor list
 * prices instead of Copilot AI credits, and the SDK's cached_tokens were
 * dropped, pricing cached input as uncached. Any SDK-vs-spawn cost comparison
 * would have charged the SDK for the accounting, not the work.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { runSdkSession } from "../orchestrator/sdk-worker.mjs";
import { priceSlice } from "../cost-service.mjs";
import { _enrichWorkerTokens } from "../orchestrator/worker-spawn.mjs";

const MODEL = "claude-sonnet-5.5";
const USAGE = { inputTokens: 100_000, outputTokens: 4_000, cacheReadTokens: 60_000, duration: 900 };

function fakeSession(usage = USAGE) {
  return vi.fn(async ({ model, onEvent }) => ({
    session: {
      sendAndWait: vi.fn(async () => {
        onEvent({ type: "assistant.usage", data: { model, ...usage } });
        onEvent({ type: "assistant.message", data: { content: "done" } });
      }),
      disconnect: vi.fn(async () => {}),
    },
    client: { stop: vi.fn(async () => {}) },
  }));
}

afterEach(() => {
  delete process.env.PF_TEST_BYOK_KEY;
});

describe("SDK token accounting", () => {
  it("reports cached input as cache_read_tokens, like the spawn path", async () => {
    const r = await runSdkSession({ prompt: "p", model: MODEL, cwd: "/project", createSession: fakeSession() });
    expect(r.tokens).toMatchObject({ tokens_in: 100_000, tokens_out: 4_000, cache_read_tokens: 60_000 });
  });

  it("prices a Copilot SDK session exactly like the same usage through gh-copilot", async () => {
    const r = await runSdkSession({ prompt: "p", model: MODEL, cwd: "/project", createSession: fakeSession() });
    const viaSdk = priceSlice(r.tokens, r.worker);
    const viaSpawn = priceSlice({ model: MODEL, tokens_in: 100_000, tokens_out: 4_000, cache_read_tokens: 60_000 }, "gh-copilot");
    expect(viaSdk.cost_usd).toBeGreaterThan(0);
    expect(viaSdk.cost_usd).toBe(viaSpawn.cost_usd);
  });

  it("labels a BYOK SDK session separately, since the vendor bills it rather than Copilot", async () => {
    process.env.PF_TEST_BYOK_KEY = "test-key";
    const r = await runSdkSession({
      prompt: "p",
      model: "gpt-6-astra",
      cwd: "/project",
      provider: { type: "openai", envKey: "PF_TEST_BYOK_KEY" },
      createSession: fakeSession(),
    });
    expect(r.worker).toBe("sdk-byok");
    const copilot = priceSlice({ ...r.tokens }, "gh-copilot");
    expect(priceSlice(r.tokens, r.worker).cost_usd).not.toBe(copilot.cost_usd);
  });
});

// The Copilot CLI's run summary (CLI 1.0.9x) names no model, so the spawn path fell
// back to the worker's default model and priced a gpt-6-luna run at Claude Sonnet rates.
const CLI_SUMMARY = [
  "    Changes    +9 -1",
  "    AI Credits 0.41 (24s)",
  "    Tokens     ↑ 117.8k (97.0k cached, 20.8k written) • ↓ 1.0k (444 reasoning)",
  "    Resume     copilot --resume=00000000-0000-0000-0000-000000000000",
].join("\n");

describe("spawn-path token accounting", () => {
  const enrich = (requestedModel) => _enrichWorkerTokens({
    tokens: { tokens_in: 0, tokens_out: 0, model: null },
    stdout: "",
    stderr: CLI_SUMMARY,
    code: 0,
    timedOut: false,
    spec: { defaultModel: "claude-sonnet-5.5" },
    spawnStartMs: Date.now(),
    workerName: "gh-copilot",
    requestedModel,
  });

  it("attributes the run to the requested model when the CLI summary names none", () => {
    const tokens = enrich("gpt-6-luna");
    expect(tokens.model).toBe("gpt-6-luna");
    expect(tokens).toMatchObject({ tokens_in: 117_800, tokens_out: 1_000, cache_read_tokens: 97_000 });
  });

  it("falls back to the worker default only when no model was requested", () => {
    expect(enrich(null).model).toBe("claude-sonnet-5.5");
  });

  it("prices the same usage identically on both paths once the model is right", () => {
    const spawn = enrich("gpt-6-luna");
    const sdk = { model: "gpt-6-luna", tokens_in: 117_800, tokens_out: 1_000, cache_read_tokens: 97_000, cache_creation_input_tokens: spawn.cache_creation_input_tokens };
    expect(priceSlice(spawn, "gh-copilot").cost_usd).toBe(priceSlice(sdk, "sdk").cost_usd);
  });
});
