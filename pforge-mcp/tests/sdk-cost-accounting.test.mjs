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

const MODEL = "claude-sonnet-5.5";
const USAGE = { input_tokens: 100_000, output_tokens: 4_000, cached_tokens: 60_000, api_duration_ms: 900 };

function fakeSession(usage = USAGE) {
  return vi.fn(async ({ model, onEvent }) => ({
    run: vi.fn(async () => {
      onEvent({ type: "assistant.message_delta", text: "done", usage: null });
      onEvent({ type: "session.complete", model, usage });
    }),
    close: vi.fn(async () => {}),
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
