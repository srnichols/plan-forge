/**
 * Slice 2 — Recommender excludes API-only models.
 *
 * The recommender (both per-slice via recommendModel and plan-level in
 * cost-service) must never surface API-only models (grok-*, gpt-*,
 * dall-e-*, chatgpt-*) as recommendations. These models require external
 * API keys and are inappropriate for default recommendations.
 *
 * isApiOnlyModel(model) is the pattern-only gate: it checks model name
 * prefixes against API_PROVIDERS without requiring an API key to be set.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isApiOnlyModel,
  recommendModel,
  recordModelPerformance,
} from "../orchestrator.mjs";

// ─── isApiOnlyModel ─────────────────────────────────────────────────────

describe("isApiOnlyModel — pattern-only API provider detection", () => {
  it("returns true for grok-* models", () => {
    expect(isApiOnlyModel("grok-3")).toBe(true);
    expect(isApiOnlyModel("grok-3-mini")).toBe(true);
    expect(isApiOnlyModel("grok-4")).toBe(true);
    expect(isApiOnlyModel("grok-4.20")).toBe(true);
  });

  it("returns true for gpt-* models", () => {
    expect(isApiOnlyModel("gpt-5.2")).toBe(true);
    expect(isApiOnlyModel("gpt-5.4-mini")).toBe(true);
    expect(isApiOnlyModel("gpt-4.1")).toBe(true);
  });

  it("returns true for dall-e-* models", () => {
    expect(isApiOnlyModel("dall-e-3")).toBe(true);
  });

  it("returns true for chatgpt-* models", () => {
    expect(isApiOnlyModel("chatgpt-4o")).toBe(true);
  });

  it("returns false for CLI-routed models (claude, gemini, etc.)", () => {
    expect(isApiOnlyModel("claude-sonnet-4.6")).toBe(false);
    expect(isApiOnlyModel("claude-opus-4.6")).toBe(false);
    expect(isApiOnlyModel("claude-haiku-4.5")).toBe(false);
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

describe("recommendModel — API-only model exclusion", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-rec-api-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
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

