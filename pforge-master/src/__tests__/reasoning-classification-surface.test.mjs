/**
 * Tests for surfacing `classification` from `runTurn` — Phase-36, Slice 2.
 *
 * Validates:
 *   (1) Normal success path: result.classification contains lane + confidence
 *   (2) OFFTOPIC short-circuit path: result.classification.lane === LANES.OFFTOPIC
 *   (3) No-provider error path: result.classification is still present
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { LANES } from "../intent-router.mjs";
import { runTurn } from "../reasoning.mjs";

const baseForgeJson = JSON.stringify({
  forgeMaster: {
    reasoningTiers: {
      high: "claude-opus-4",
      medium: "gpt-4o",
      low: "gpt-4o-mini",
    },
  },
});

// ── (1) Normal success: classification surfaced in result ──────────────────

describe("runTurn() — classification surfaced on success", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-cls-surface-test-"));
    writeFileSync(join(tmpDir, ".forge.json"), baseForgeJson, "utf-8");
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("(1) includes classification with lane and confidence on a normal reply", async () => {
    const stubbedProvider = {
      PROVIDER_NAME: "stub",
      sendTurn: async () => ({
        type: "reply",
        content: "Here is the forge status.",
        tokensIn: 5,
        tokensOut: 10,
      }),
    };

    const result = await runTurn(
      {
        message: "What is the current forge status?",
        cwd: tmpDir,
        tier: "low",
      },
      {
        provider: stubbedProvider,
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        remember: () => ({ ok: true }),
      },
    );

    expect(result.classification).toBeDefined();
    expect(typeof result.classification.lane).toBe("string");
    expect(typeof result.classification.confidence).toBe("string");
    expect(["low", "medium", "high"]).toContain(result.classification.confidence);
  });
});

// ── (2) OFFTOPIC short-circuit: classification.lane === LANES.OFFTOPIC ──

describe("runTurn() — classification surfaced on OFFTOPIC short-circuit", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-cls-offtopic-test-"));
    writeFileSync(join(tmpDir, ".forge.json"), baseForgeJson, "utf-8");
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("(2) includes classification with lane OFFTOPIC when off-topic message is sent", async () => {
    // The OFFTOPIC path short-circuits before any provider call.
    // Pass a provider so we can confirm it is never called.
    let providerCalled = false;
    const stubbedProvider = {
      PROVIDER_NAME: "stub",
      sendTurn: async () => {
        providerCalled = true;
        return { type: "reply", content: "should not reach", tokensIn: 0, tokensOut: 0 };
      },
    };

    const result = await runTurn(
      {
        message: "What's the weather like today? Tell me a fun fact about dinosaurs.",
        cwd: tmpDir,
        tier: "low",
      },
      {
        provider: stubbedProvider,
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        remember: () => ({ ok: true }),
      },
    );

    expect(result.classification).toBeDefined();
    expect(result.classification.lane).toBe(LANES.OFFTOPIC);
    expect(providerCalled).toBe(false);
  });
});

// ── (3) Provider-throws error path: classification still present ──────────

describe("runTurn() — classification surfaced when provider throws", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "forge-cls-throw-test-"));
    writeFileSync(join(tmpDir, ".forge.json"), baseForgeJson, "utf-8");
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it("(3) includes classification even when the provider throws an error", async () => {
    const throwingProvider = {
      PROVIDER_NAME: "stub",
      sendTurn: async () => { throw new Error("provider exploded"); },
    };

    // Use a message known to route to a forge lane (not OFFTOPIC)
    const result = await runTurn(
      {
        message: "What is the current forge status?",
        cwd: tmpDir,
        tier: "low",
      },
      {
        provider: throwingProvider,
        dispatcher: async () => ({}),
        hub: null,
        toolMetadata: {},
        recall: async () => null,
        remember: () => ({ ok: true }),
      },
    );

    expect(result.error).toBe("reasoning_model_unavailable");
    expect(result.classification).toBeDefined();
    expect(typeof result.classification.lane).toBe("string");
    expect(["low", "medium", "high"]).toContain(result.classification.confidence);
  });
});
