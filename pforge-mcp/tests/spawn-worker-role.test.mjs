/**
 * Bug #78 + #80 — spawnWorker call-site role & API routing overrides.
 *
 * #78: `spawnWorker` had no way for a call site to declare its role
 *       (dry-run, reviewer, analysis), and the `worker` override was
 *       ignored once the model matched an API-provider pattern.
 * #80: API-routed Grok refused "simulate slice execution" prompts as
 *       instruction-override. Wrapping the prompt in a system message
 *       that frames it as analysis lets safety-tuned providers engage.
 *
 * The `buildApiMessages` helper is the seam: user-only for legacy/null
 * role, system + user for analysis/reviewer/quorum-dry-run roles.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { buildApiMessages, spawnWorker, API_ALLOWED_ROLES } from "../orchestrator.mjs";

describe("buildApiMessages — bug #78/#80 role-aware prompt shaping", () => {
  it("returns a single user message for null role (legacy behaviour preserved)", () => {
    const msgs = buildApiMessages("hello", null);
    expect(msgs).toEqual([{ role: "user", content: "hello" }]);
  });

  it("returns a single user message for unknown role (legacy fallback)", () => {
    const msgs = buildApiMessages("hello", "something-new");
    expect(msgs).toEqual([{ role: "user", content: "hello" }]);
  });

  it("wraps with analysis system message when role=quorum-dry-run (bug #80)", () => {
    const msgs = buildApiMessages("run slice 5", "quorum-dry-run");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content.toLowerCase()).toContain("analysis");
    expect(msgs[0].content.toLowerCase()).toContain("not being asked to execute");
    expect(msgs[1]).toEqual({ role: "user", content: "run slice 5" });
  });

  it("wraps with analysis system message when role=reviewer", () => {
    const msgs = buildApiMessages("review these plans", "reviewer");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toBe("review these plans");
  });

  it("wraps with analysis system message when role=analysis", () => {
    const msgs = buildApiMessages("analyze this file", "analysis");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toBe("analyze this file");
  });

  it("preserves the user prompt verbatim across all roles", () => {
    const prompt = "line 1\nline 2\n```code```\nfinal";
    for (const role of [null, "quorum-dry-run", "reviewer", "analysis", "unknown"]) {
      const msgs = buildApiMessages(prompt, role);
      const userMsg = msgs.find((m) => m.role === "user");
      expect(userMsg.content).toBe(prompt);
    }
  });

  it("system message explicitly disclaims instruction-override for safety-tuned providers", () => {
    // Regression: the prompt must tell the model the payload is DATA, not
    // a higher-priority system instruction. This is what unblocks Grok.
    const msgs = buildApiMessages("x", "quorum-dry-run");
    const sys = msgs[0].content.toLowerCase();
    expect(sys).toContain("plan forge");
    expect(sys).toContain("not");
    // Must mention at least one of the refusal triggers we're disarming.
    expect(sys).toMatch(/override|act on behalf|execute the instructions/);
  });
});

describe("API_ALLOWED_ROLES — role allowlist for API providers", () => {
  it("contains exactly the four allowed roles", () => {
    expect(API_ALLOWED_ROLES).toEqual(new Set(["reviewer", "quorum-dry-run", "analysis", "image"]));
  });

  it("does not contain code-writing roles", () => {
    expect(API_ALLOWED_ROLES.has("code")).toBe(false);
    expect(API_ALLOWED_ROLES.has("execute")).toBe(false);
    expect(API_ALLOWED_ROLES.has(null)).toBe(false);
  });
});

describe("spawnWorker — blocks API providers from code-writing role", () => {
  // These tests rely on the XAI_API_KEY env var being set so detectApiProvider
  // returns a provider for grok-* models. We mock it for isolation.
  const originalEnv = process.env.XAI_API_KEY;

  beforeAll(() => {
    process.env.XAI_API_KEY = "test-key-for-unit-tests";
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.XAI_API_KEY = originalEnv;
    } else {
      delete process.env.XAI_API_KEY;
    }
  });

  it("throws when model is grok-* and role is null (default code-writing)", () => {
    expect(() => spawnWorker("do stuff", { model: "grok-4.20" }))
      .toThrow(/grok.*API/i);
  });

  it("throws when model is grok-* and role is 'code'", () => {
    expect(() => spawnWorker("do stuff", { model: "grok-4.20", role: "code" }))
      .toThrow(/grok.*API/i);
  });

  it("throws when model is grok-* and role is 'execute'", () => {
    expect(() => spawnWorker("do stuff", { model: "grok-4.20", role: "execute" }))
      .toThrow(/grok.*API/i);
  });

  it("error message mentions reviewer as valid alternative", () => {
    try {
      spawnWorker("do stuff", { model: "grok-4.20", role: null });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e.message).toContain("reviewer");
    }
  });

  it("does NOT throw when model is grok-* and role is 'reviewer'", () => {
    // spawnWorker returns a promise for API-routed models; it should not
    // throw synchronously. The promise may reject due to network, but the
    // role check itself passes.
    expect(() => spawnWorker("review this", { model: "grok-4.20", role: "reviewer" }))
      .not.toThrow();
  });

  it("does NOT throw when model is grok-* and role is 'quorum-dry-run'", () => {
    expect(() => spawnWorker("dry run", { model: "grok-4.20", role: "quorum-dry-run" }))
      .not.toThrow();
  });

  it("does NOT throw when model is grok-* and role is 'analysis'", () => {
    expect(() => spawnWorker("analyze", { model: "grok-4.20", role: "analysis" }))
      .not.toThrow();
  });

  it("does NOT throw for claude-sonnet-4.6 with null role (CLI worker path)", () => {
    // claude-sonnet-4.6 is not an API-provider-pattern model (no Anthropic
    // direct entry enabled), so it goes through the CLI worker path.
    expect(() => spawnWorker("build feature", { model: "claude-sonnet-4.6", role: null }))
      .not.toThrow();
  });
});
