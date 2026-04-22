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

// ── (a) githubCopilot selected when it's the only available provider ─

describe("autoSelectProvider", () => {
  it("(a) selects githubCopilot when only githubCopilot is available", async () => {
    const providers = {
      ...allUnavailable,
      githubCopilot: makeProviderStub(true, "github-copilot"),
    };
    const result = await autoSelectProvider({}, process.env, providers);
    expect(result).toBeTruthy();
    expect(result.PROVIDER_NAME).toBe("github-copilot");
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
    // No reasoningProvider set → triggers autoSelectProvider path
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ forgeMaster: { maxToolCalls: 3 } }),
      "utf-8",
    );
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("(c) returns no provider available error with suggestion when all providers unavailable", async () => {
    const result = await runTurn(
      { message: "What is my plan status?", cwd: tmpDir },
      {
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
    expect(result.suggestion).toContain("gh auth login");
    expect(result.suggestion).toContain("GITHUB_TOKEN");
    expect(result.toolCalls).toHaveLength(0);
    expect(result.reply).toBe("");
  });
});
