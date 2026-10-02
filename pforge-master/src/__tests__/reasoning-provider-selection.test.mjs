/**
 * Tests for autoSelectProvider — Phase-33, Slice 2.
 *
 * Stubs each provider's isAvailable via the _providers injection parameter
 * so tests never spawn subprocesses or make HTTP calls.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { autoSelectProvider } from "../reasoning.mjs";
import { runTurn } from "../reasoning.mjs";

function makeProviderStub(available, name) {
  return {
    module: { sendTurn: async () => ({ type: "reply", content: "ok", tokensIn: 1, tokensOut: 1 }), PROVIDER_NAME: name },
    isAvailable: () => available,
  };
}

const allUnavailable = {
  githubCopilot: makeProviderStub(false, "github-copilot"),
  anthropic: makeProviderStub(false, "anthropic"),
  openai: makeProviderStub(false, "openai"),
  xai: makeProviderStub(false, "xai"),
};

// ── (a) githubCopilot SDK is first when available ─

describe("autoSelectProvider", () => {
  it("(a) auto-selects githubCopilot first when its stub reports available", async () => {
    const providers = {
      ...allUnavailable,
      githubCopilot: makeProviderStub(true, "githubCopilot"),
    };
    expect((await autoSelectProvider({}, process.env, providers)).PROVIDER_NAME).toBe("githubCopilot");
    expect((await autoSelectProvider({ defaultProvider: "githubCopilot" }, process.env, providers)).PROVIDER_NAME).toBe("githubCopilot");
  });

  it("(a2) tries githubCopilot, then anthropic, then openai, then xai", async () => {
    const providers = {
      ...allUnavailable,
      openai: makeProviderStub(true, "openai"),
      xai: makeProviderStub(true, "xai"),
    };
    expect((await autoSelectProvider({}, process.env, providers)).PROVIDER_NAME).toBe("openai");
    providers.anthropic = makeProviderStub(true, "anthropic");
    expect((await autoSelectProvider({}, process.env, providers)).PROVIDER_NAME).toBe("anthropic");
  });

  // ── (b) fallback to anthropic when githubCopilot unavailable ─────

  it("(b) falls back to anthropic when githubCopilot.isAvailable() === false", async () => {
    const providers = {
      ...allUnavailable,
      anthropic: makeProviderStub(true, "anthropic"),
    };
    const result = await autoSelectProvider({}, process.env, providers);
    expect(result).toBeTruthy();
    expect(result.PROVIDER_NAME).toBe("anthropic");
  });

  // ── (d) explicit defaultProvider in config overrides the order ────

  it("(d) explicit defaultProvider:openai in config tries openai first", async () => {
    const providers = {
      ...allUnavailable,
      githubCopilot: makeProviderStub(true, "github-copilot"),
      openai: makeProviderStub(true, "openai"),
    };
    const result = await autoSelectProvider({ defaultProvider: "openai" }, process.env, providers);
    expect(result).toBeTruthy();
    expect(result.PROVIDER_NAME).toBe("openai");
  });
});

// ── (c) no provider available → runTurn returns structured error ────

describe("runTurn no-provider error", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-provider-sel-"));
    // reasoningModel set to a value that won't match any provider pattern,
    // so resolveReasoningProvider returns null and autoSelectProvider is used.
    // This makes the test env-independent (GITHUB_TOKEN et al don't matter).
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ forgeMaster: { maxToolCalls: 3, reasoningModel: "test-no-key-model" } }),
      "utf-8",
    );
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("(c) returns no provider available error with suggestion when all providers unavailable", async () => {
    const result = await runTurn(
      { message: "What is my plan status?", cwd: tmpDir },
      {
        config: { reasoningModel: "test-no-key-model", reasoningProvider: null, defaultProvider: "githubCopilot", maxToolCalls: 3, discoverExtensionTools: false, autoEscalate: false },
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        // Inject all-unavailable stubs so env vars don't affect this test
        _providers: {
          githubCopilot: makeProviderStub(false, "github-copilot"),
          anthropic: makeProviderStub(false, "anthropic"),
          openai: makeProviderStub(false, "openai"),
          xai: makeProviderStub(false, "xai"),
        },
      },
    );

    expect(result.error).toBe("no provider available");
    expect(result.suggestion).toContain("ANTHROPIC_API_KEY");
    expect(result.suggestion).toContain("gh auth login");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.reply).toBe("");
  });
});
