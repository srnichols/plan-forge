/**
 * Tests for Phase-38.6 Slice 3 — forge_patterns_list lane placement
 * and troubleshoot-lane pattern context injection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LANE_TOOLS, LANES } from "../src/intent-router.mjs";

// ─── Mock dependencies for reasoning.mjs ─────────────────────────────

vi.mock("../src/retrieval.mjs", () => ({
  fetchContext: vi.fn(async () => ({ contextBlock: "" })),
}));
vi.mock("../src/config.mjs", () => ({
  getForgeMasterConfig: () => ({
    maxToolCalls: 5,
    defaultTier: "medium",
    autoEscalate: false,
    discoverExtensionTools: false,
  }),
}));
vi.mock("../src/allowlist.mjs", () => ({
  resolveAllowlist: () => [],
  USAGE_HINTS: {},
}));
vi.mock("../src/tool-bridge.mjs", () => ({
  invokeMany: vi.fn(async () => []),
  invokeAllowlisted: vi.fn(async () => ({})),
}));
vi.mock("../src/planner.mjs", () => ({
  plan: vi.fn(async () => ({ steps: [] })),
}));
vi.mock("../src/plan-executor.mjs", () => ({
  executePlan: vi.fn(async () => ({ results: [] })),
}));
vi.mock("../src/persistence.mjs", () => ({
  ensureSessionId: (id) => id || "test-session",
  appendTurn: vi.fn(async () => {}),
  summarizeIfNeeded: vi.fn(async () => {}),
}));
vi.mock("../src/session-store.mjs", () => ({
  appendTurn: vi.fn(async () => {}),
  loadSession: vi.fn(async () => []),
  hashReply: () => "h",
}));
vi.mock("../src/recall-index.mjs", () => ({
  loadIndex: vi.fn(async () => {}),
  queryIndex: vi.fn(async () => []),
}));
vi.mock("../src/principles.mjs", () => ({
  loadPrinciples: () => ({ block: "baseline" }),
  UNIVERSAL_BASELINE: "baseline",
}));
vi.mock("../src/reasoning-tier.mjs", () => ({
  resolveModel: () => "test-model",
  VALID_TIERS: ["low", "medium", "high"],
}));
vi.mock("../src/cost.mjs", () => ({
  computeTurnCost: () => 0,
}));
vi.mock("../src/providers/github-copilot-tools.mjs", () => ({
  isAvailable: () => false,
}));

import { runTurn } from "../src/reasoning.mjs";

// ─── Lane placement tests ────────────────────────────────────────────

describe("forge_patterns_list lane placement", () => {
  it("is in advisory lane", () => {
    expect(LANE_TOOLS[LANES.ADVISORY]).toContain("forge_patterns_list");
  });
  it("is NOT in operational lane", () => {
    expect(LANE_TOOLS[LANES.OPERATIONAL]).not.toContain("forge_patterns_list");
  });
  it("is NOT in troubleshoot lane", () => {
    expect(LANE_TOOLS[LANES.TROUBLESHOOT]).not.toContain("forge_patterns_list");
  });
  it("is NOT in build lane", () => {
    expect(LANE_TOOLS[LANES.BUILD]).not.toContain("forge_patterns_list");
  });
});

// ─── Pattern context injection tests ─────────────────────────────────

describe("troubleshoot-lane pattern context injection", () => {
  /** Minimal provider that returns a final reply echoing the system prompt context */
  function makeProvider(captureRef) {
    return {
      sendTurn: vi.fn(async ({ messages }) => {
        // Capture the system prompt so tests can inspect injected context
        if (captureRef) {
          captureRef.systemPrompt = messages.find((m) => m.role === "system")?.content || "";
        }
        return { type: "reply", content: "ok", tokensIn: 0, tokensOut: 0 };
      }),
    };
  }

  it("injects pattern context when troubleshoot lane fires with patterns", async () => {
    const capture = {};
    const provider = makeProvider(capture);
    const mockDetect = vi.fn(async () => [
      { id: "gate-recurrence:tee-tmp", title: "tee /tmp/ gate failures recur across plans", severity: "warning", occurrences: 5, plans: ["Phase-35", "Phase-36"] },
    ]);

    const result = await runTurn(
      { message: "Why did the gate fail again?", cwd: process.cwd() },
      {
        sessionId: "test-troubleshoot",
        provider,
        forceKeywordOnly: true,
        detectPatterns: mockDetect,
      },
    );

    expect(mockDetect).toHaveBeenCalledTimes(1);
    expect(capture.systemPrompt).toContain("Recurring pattern observed");
    expect(capture.systemPrompt).toContain("tee /tmp/");
  });

  it("does NOT inject patterns when advisory lane fires", async () => {
    const capture = {};
    const provider = makeProvider(capture);
    const mockDetect = vi.fn(async () => [
      { id: "test-pattern", title: "test", severity: "info", occurrences: 3, plans: ["P1", "P2"] },
    ]);

    await runTurn(
      { message: "Should I refactor the auth module or ship as-is?", cwd: process.cwd() },
      {
        sessionId: "test-advisory",
        provider,
        forceKeywordOnly: true,
        detectPatterns: mockDetect,
      },
    );

    // detectPatterns should NOT be called for non-troubleshoot lanes
    expect(mockDetect).not.toHaveBeenCalled();
  });

  it("does NOT inject patterns when no patterns are detected", async () => {
    const capture = {};
    const provider = makeProvider(capture);
    const mockDetect = vi.fn(async () => []);

    await runTurn(
      { message: "Why did the build crash?", cwd: process.cwd() },
      {
        sessionId: "test-empty-patterns",
        provider,
        forceKeywordOnly: true,
        detectPatterns: mockDetect,
      },
    );

    expect(mockDetect).toHaveBeenCalledTimes(1);
    expect(capture.systemPrompt).not.toContain("Recurring pattern observed");
  });

  it("limits injected patterns to 3 maximum", async () => {
    const capture = {};
    const provider = makeProvider(capture);
    const mockDetect = vi.fn(async () => [
      { id: "p1", title: "Pattern 1", severity: "error" },
      { id: "p2", title: "Pattern 2", severity: "warning" },
      { id: "p3", title: "Pattern 3", severity: "info" },
      { id: "p4", title: "Pattern 4 should NOT appear", severity: "info" },
    ]);

    await runTurn(
      { message: "Why did the gate fail?", cwd: process.cwd() },
      {
        sessionId: "test-max-patterns",
        provider,
        forceKeywordOnly: true,
        detectPatterns: mockDetect,
      },
    );

    // Count occurrences of "Recurring pattern observed" in system prompt
    const matches = capture.systemPrompt.match(/Recurring pattern observed/g) || [];
    expect(matches.length).toBe(3);
    expect(capture.systemPrompt).not.toContain("Pattern 4");
  });

  it("gracefully handles detectPatterns errors (non-fatal)", async () => {
    const capture = {};
    const provider = makeProvider(capture);
    const mockDetect = vi.fn(async () => { throw new Error("detector crash"); });

    const result = await runTurn(
      { message: "Why did the test fail?", cwd: process.cwd() },
      {
        sessionId: "test-crash",
        provider,
        forceKeywordOnly: true,
        detectPatterns: mockDetect,
      },
    );

    // Turn should succeed despite detector failure
    expect(result.reply).toBe("ok");
    expect(capture.systemPrompt).not.toContain("Recurring pattern observed");
  });
});
