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

import { describe, it, expect } from "vitest";
import { buildApiMessages } from "../orchestrator.mjs";

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
