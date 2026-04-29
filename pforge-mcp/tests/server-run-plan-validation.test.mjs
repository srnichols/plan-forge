/**
 * server-run-plan-validation.test.mjs — forge_run_plan body validation (Bug #117)
 *
 * Verifies that the forge_run_plan MCP handler:
 *   - Returns a structured error when args.plan is missing/empty/non-string
 *     BEFORE any path.resolve() / path.join() call (no crash)
 *   - Accepts args.planPath as an alias for args.plan
 *   - Emits a one-time console.warn deprecation when planPath is used
 *
 * Test setup mirrors drain-io-wrapper.test.mjs: set PLAN_FORGE_PROJECT so
 * PROJECT_DIR binds to a temp fixture; import server.mjs; use invokeForgeTool.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpProject;
let savedEnv;
let invokeForgeTool;
let resetPlanPathAliasWarned;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-run-plan-validation-"));
  mkdirSync(join(tmpProject, ".forge"), { recursive: true });
  writeFileSync(join(tmpProject, ".forge.json"), "{}", "utf-8");

  savedEnv = process.env.PLAN_FORGE_PROJECT;
  process.env.PLAN_FORGE_PROJECT = tmpProject;

  const mod = await import("../server.mjs");
  invokeForgeTool = mod.invokeForgeTool;
  resetPlanPathAliasWarned = mod.__resetPlanPathAliasWarned;
});

afterAll(() => {
  if (savedEnv === undefined) {
    delete process.env.PLAN_FORGE_PROJECT;
  } else {
    process.env.PLAN_FORGE_PROJECT = savedEnv;
  }
  if (tmpProject && existsSync(tmpProject)) {
    rmSync(tmpProject, { recursive: true, force: true });
  }
});

beforeEach(() => {
  // Reset one-time warn flag before each test so spy tests are deterministic
  resetPlanPathAliasWarned();
});

// ─── (a) Missing plan → validation error, no crash ───────────────────────────

describe("forge_run_plan body validation", () => {
  it("(a) returns structured error when args.plan is absent — no path.join crash", async () => {
    const result = await invokeForgeTool("forge_run_plan", {});
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toMatch(/plan.*is required/i);
  });

  it("(a2) returns structured error when args.plan is empty string", async () => {
    const result = await invokeForgeTool("forge_run_plan", { plan: "" });
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toMatch(/plan.*is required/i);
  });

  // ─── (c) Non-string plan → validation error ───────────────────────────────

  it("(c) returns structured error when args.plan is a number", async () => {
    const result = await invokeForgeTool("forge_run_plan", { plan: 42 });
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toMatch(/plan.*is required/i);
  });

  it("(c2) returns structured error when args.plan is an object", async () => {
    const result = await invokeForgeTool("forge_run_plan", { plan: { path: "foo.md" } });
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text ?? "";
    expect(text).toMatch(/plan.*is required/i);
  });

  // ─── (b) planPath alias accepted ─────────────────────────────────────────

  it("(b) accepts planPath alias — error is file-not-found, not a crash or plan-required error", async () => {
    const result = await invokeForgeTool("forge_run_plan", { planPath: "docs/plans/nonexistent.md" });
    // Validation passed: we get past the plan-required guard
    const text = result.content?.[0]?.text ?? "";
    expect(text).not.toMatch(/plan.*is required/i);
    // Handler either returns file-not-found or some other downstream error, but NOT the validation error
    expect(result).toBeDefined();
  });

  // ─── (d) One-shot deprecation warn via console.warn spy ───────────────────

  it("(d) emits console.warn deprecation when planPath alias is used", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await invokeForgeTool("forge_run_plan", { planPath: "docs/plans/test.md" });
      const calls = warnSpy.mock.calls;
      const warned = calls.some(([msg]) =>
        typeof msg === "string" && msg.includes("planPath") && msg.includes("prefer 'plan'")
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("(d2) emits warn only once per process — second planPath call does not warn again", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // First call — flag was reset in beforeEach, so warn fires
      await invokeForgeTool("forge_run_plan", { planPath: "docs/plans/test.md" });
      const firstCallCount = warnSpy.mock.calls.filter(([msg]) =>
        typeof msg === "string" && msg.includes("planPath")
      ).length;
      expect(firstCallCount).toBe(1);

      // Second call — flag is already true, no second warn
      await invokeForgeTool("forge_run_plan", { planPath: "docs/plans/test.md" });
      const secondCallCount = warnSpy.mock.calls.filter(([msg]) =>
        typeof msg === "string" && msg.includes("planPath")
      ).length;
      expect(secondCallCount).toBe(1); // still only 1 total
    } finally {
      warnSpy.mockRestore();
    }
  });
});
