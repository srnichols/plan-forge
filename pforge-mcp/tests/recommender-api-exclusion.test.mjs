/**
 * Slice 2 — Recommender excludes API-only models.
 *
 * The recommender (both per-slice via recommendModel and plan-level in
 * cost-service) must never surface API-only models as recommendations when
 * they would require external API keys. Models that can be served by the
 * user's GitHub Copilot subscription via gh-copilot CLI are NOT excluded —
 * that was meta-bug #103.
 *
 * isApiOnlyModel(model) is environment-aware:
 *   - true for DIRECT_API_ONLY models (grok-*, dall-e-*) — no CLI proxy
 *   - true for COPILOT_SERVABLE (gpt-*, chatgpt-*) ONLY when gh-copilot is absent
 *   - false for CLI-routed models (claude-*, gemini-*, etc.)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isApiOnlyModel,
  isDirectApiOnlyModel,
  isCopilotServableModel,
  setGhCopilotProbe,
  recommendModel,
  recordModelPerformance,
} from "../orchestrator.mjs";

// ─── Pure pattern helpers (environment-independent) ─────────────────────

describe("isDirectApiOnlyModel — no CLI proxy exists", () => {
  it("returns true for grok-* models", () => {
    expect(isDirectApiOnlyModel("grok-3")).toBe(true);
    expect(isDirectApiOnlyModel("grok-3-mini")).toBe(true);
    expect(isDirectApiOnlyModel("grok-4")).toBe(true);
    expect(isDirectApiOnlyModel("grok-4.20")).toBe(true);
  });

  it("returns true for dall-e-* models", () => {
    expect(isDirectApiOnlyModel("dall-e-3")).toBe(true);
  });

  it("returns false for Copilot-servable models (gpt-*, chatgpt-*)", () => {
    expect(isDirectApiOnlyModel("gpt-5.2")).toBe(false);
    expect(isDirectApiOnlyModel("gpt-5.3-codex")).toBe(false);
    expect(isDirectApiOnlyModel("chatgpt-4o")).toBe(false);
  });

  it("returns false for CLI-routed models", () => {
    expect(isDirectApiOnlyModel("claude-sonnet-4.6")).toBe(false);
    expect(isDirectApiOnlyModel("gemini-2.5-pro")).toBe(false);
  });
});

describe("isCopilotServableModel — gh-copilot proxies these", () => {
  it("returns true for gpt-* models", () => {
    expect(isCopilotServableModel("gpt-5.2")).toBe(true);
    expect(isCopilotServableModel("gpt-5.3-codex")).toBe(true);
    expect(isCopilotServableModel("gpt-5.4-mini")).toBe(true);
    expect(isCopilotServableModel("gpt-4.1")).toBe(true);
  });

  it("returns true for chatgpt-* models", () => {
    expect(isCopilotServableModel("chatgpt-4o")).toBe(true);
  });

  it("returns false for direct-API-only models (grok-*, dall-e-*)", () => {
    expect(isCopilotServableModel("grok-4")).toBe(false);
    expect(isCopilotServableModel("dall-e-3")).toBe(false);
  });

  it("returns false for CLI-routed models", () => {
    expect(isCopilotServableModel("claude-sonnet-4.6")).toBe(false);
    expect(isCopilotServableModel("gemini-2.5-pro")).toBe(false);
  });
});

// ─── isApiOnlyModel (environment-aware) ────────────────────────────────

describe("isApiOnlyModel — environment-aware, considers gh-copilot availability", () => {
  afterEach(() => setGhCopilotProbe(null)); // restore real probe

  it("returns true for grok-* regardless of gh-copilot (no CLI proxy)", () => {
    setGhCopilotProbe(() => true);
    expect(isApiOnlyModel("grok-3")).toBe(true);
    expect(isApiOnlyModel("grok-4.20")).toBe(true);
    setGhCopilotProbe(() => false);
    expect(isApiOnlyModel("grok-3")).toBe(true);
  });

  it("returns true for dall-e-* regardless of gh-copilot (no CLI proxy)", () => {
    setGhCopilotProbe(() => true);
    expect(isApiOnlyModel("dall-e-3")).toBe(true);
    setGhCopilotProbe(() => false);
    expect(isApiOnlyModel("dall-e-3")).toBe(true);
  });

  it("returns FALSE for gpt-* when gh-copilot is available (fixed in #103)", () => {
    setGhCopilotProbe(() => true);
    expect(isApiOnlyModel("gpt-5.2")).toBe(false);
    expect(isApiOnlyModel("gpt-5.3-codex")).toBe(false);
    expect(isApiOnlyModel("gpt-5.4-mini")).toBe(false);
    expect(isApiOnlyModel("gpt-4.1")).toBe(false);
  });

  it("returns true for gpt-* when gh-copilot is NOT available", () => {
    setGhCopilotProbe(() => false);
    expect(isApiOnlyModel("gpt-5.2")).toBe(true);
    expect(isApiOnlyModel("gpt-5.3-codex")).toBe(true);
  });

  it("returns FALSE for chatgpt-* when gh-copilot is available (fixed in #103)", () => {
    setGhCopilotProbe(() => true);
    expect(isApiOnlyModel("chatgpt-4o")).toBe(false);
  });

  it("returns true for chatgpt-* when gh-copilot is NOT available", () => {
    setGhCopilotProbe(() => false);
    expect(isApiOnlyModel("chatgpt-4o")).toBe(true);
  });

  it("returns false for CLI-routed models (claude, gemini, etc.) in all environments", () => {
    setGhCopilotProbe(() => true);
    expect(isApiOnlyModel("claude-sonnet-4.6")).toBe(false);
    expect(isApiOnlyModel("claude-opus-4.7")).toBe(false);
    expect(isApiOnlyModel("claude-haiku-4.5")).toBe(false);
    expect(isApiOnlyModel("gemini-2.5-pro")).toBe(false);
    setGhCopilotProbe(() => false);
    expect(isApiOnlyModel("claude-sonnet-4.6")).toBe(false);
    expect(isApiOnlyModel("gemini-2.5-pro")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isApiOnlyModel(null)).toBe(false);
    expect(isApiOnlyModel(undefined)).toBe(false);
    expect(isApiOnlyModel("")).toBe(false);
  });

  it("returns false for auto/generic model names", () => {
    expect(isApiOnlyModel("auto")).toBe(false);
    expect(isApiOnlyModel("default")).toBe(false);
  });
});

// ─── recommendModel excludes API-only models ────────────────────────────

describe("recommendModel — API-only model exclusion (with gh-copilot absent)", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-rec-api-"));
    // Force the default exclusion path: no gh-copilot → Copilot-servable
    // models are treated as API-only for recommendation purposes.
    setGhCopilotProbe(() => false);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    setGhCopilotProbe(null);
  });

  it("skips grok-* even when it is cheapest qualifying model", () => {
    const date = new Date().toISOString();
    // grok-4: 4 slices, 100% pass, avg $0.01 — cheapest
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "grok-4", status: "passed", cost_usd: 0.01 });
    }
    // claude-sonnet-4.6: 4 slices, 100% pass, avg $0.05 — more expensive
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "claude-sonnet-4.6", status: "passed", cost_usd: 0.05 });
    }

    const rec = recommendModel(tempDir);
    expect(rec).not.toBeNull();
    expect(rec.model).toBe("claude-sonnet-4.6");
  });

  it("skips gpt-* even when it is cheapest qualifying model", () => {
    const date = new Date().toISOString();
    // gpt-5.2: 4 slices, 100% pass, avg $0.02
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "gpt-5.2", status: "passed", cost_usd: 0.02 });
    }
    // claude-haiku-4.5: 4 slices, 100% pass, avg $0.03
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "claude-haiku-4.5", status: "passed", cost_usd: 0.03 });
    }

    const rec = recommendModel(tempDir);
    expect(rec).not.toBeNull();
    expect(rec.model).toBe("claude-haiku-4.5");
  });

  it("returns null when only API-only models qualify", () => {
    const date = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      recordModelPerformance(tempDir, { date, model: "grok-4", status: "passed", cost_usd: 0.01 });
    }
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "gpt-5.4-mini", status: "passed", cost_usd: 0.02 });
    }

    const rec = recommendModel(tempDir);
    expect(rec).toBeNull();
  });

  it("still recommends CLI models when mixed with API-only models", () => {
    const date = new Date().toISOString();
    // Mix of API-only and CLI models
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "grok-3-mini", status: "passed", cost_usd: 0.005 });
      recordModelPerformance(tempDir, { date, model: "chatgpt-4o", status: "passed", cost_usd: 0.01 });
      recordModelPerformance(tempDir, { date, model: "claude-sonnet-4.6", status: "passed", cost_usd: 0.04 });
      recordModelPerformance(tempDir, { date, model: "claude-opus-4.6", status: "passed", cost_usd: 0.08 });
    }

    const rec = recommendModel(tempDir);
    expect(rec).not.toBeNull();
    // Should be cheapest CLI model
    expect(rec.model).toBe("claude-sonnet-4.6");
    expect(isApiOnlyModel(rec.model)).toBe(false);
  });

  it("excludes dall-e-* from recommendations", () => {
    const date = new Date().toISOString();
    for (let i = 0; i < 4; i++) {
      recordModelPerformance(tempDir, { date, model: "dall-e-3", status: "passed", cost_usd: 0.01 });
      recordModelPerformance(tempDir, { date, model: "claude-haiku-4.5", status: "passed", cost_usd: 0.02 });
    }

    const rec = recommendModel(tempDir);
    expect(rec).not.toBeNull();
    expect(rec.model).toBe("claude-haiku-4.5");
  });
});

