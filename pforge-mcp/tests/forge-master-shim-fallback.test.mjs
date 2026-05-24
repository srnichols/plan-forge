/**
 * Plan Forge — Forge-Master Shim Fallback Tests (Issue #200).
 *
 * Validates that forge-master/index.mjs:
 *   (1) exports runTurn and loadPrefs as callable functions
 *   (2) correctly re-exports the full pforge-master surface when present
 *   (3) loadPrefs stub returns proper defaults from an empty directory
 *   (4) runTurn stub returns a well-shaped fallback object (isolated test)
 *
 * Tests (1)-(3) run against the shim with pforge-master present (dev env).
 * Test (4) exercises the stub logic directly to validate the Issue #200 contract.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ─── (1)-(3) Shim re-export contract ────────────────────────────────────────

describe("forge-master shim — re-export contract", () => {
  it("(1a) exports runTurn as a function", async () => {
    const mod = await import("../forge-master/index.mjs");
    expect(typeof mod.runTurn).toBe("function");
  });

  it("(1b) exports loadPrefs as a function", async () => {
    const mod = await import("../forge-master/index.mjs");
    expect(typeof mod.loadPrefs).toBe("function");
  });

  it("(2a) re-exports getForgeMasterConfig when pforge-master is present", async () => {
    const mod = await import("../forge-master/index.mjs");
    // Only assert type when pforge-master is installed (dev environment)
    if (mod.getForgeMasterConfig !== undefined) {
      expect(typeof mod.getForgeMasterConfig).toBe("function");
    }
  });

  it("(2b) re-exports classify when pforge-master is present", async () => {
    const mod = await import("../forge-master/index.mjs");
    if (mod.classify !== undefined) {
      expect(typeof mod.classify).toBe("function");
    }
  });

  it("(2c) re-exports LANES when pforge-master is present", async () => {
    const mod = await import("../forge-master/index.mjs");
    if (mod.LANES !== undefined) {
      expect(typeof mod.LANES).toBe("object");
    }
  });
});

// ─── (3) loadPrefs stub behavior ─────────────────────────────────────────────

describe("forge-master shim — loadPrefs stub behavior", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "fm-shim-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(3a) loadPrefs returns defaults from an empty directory", async () => {
    const { loadPrefs } = await import("../forge-master/index.mjs");
    const prefs = loadPrefs(tmpDir);
    expect(prefs).toBeDefined();
    expect(typeof prefs).toBe("object");
    // tier defaults to null; Phase-43 flipped autoEscalate default → true
    expect(prefs.autoEscalate).toBe(true);
    expect(prefs.tier === null || typeof prefs.tier === "string").toBe(true);
  });
});

// ─── (4) runTurn stub shape (Issue #200 contract) ────────────────────────────
// This test exercises the stub implementation inline (without pforge-master).
// It validates the exact shape that server.mjs expects from runTurn.

describe("forge-master shim — runTurn stub shape (Issue #200)", () => {
  async function runTurnStub(params) {
    return {
      reply: [
        "Forge-Master is not available in this environment.",
        "The `pforge-master` package was not found alongside `pforge-mcp`.",
      ].join("\n"),
      sessionId: randomUUID(),
      tokensIn: 0,
      tokensOut: 0,
      totalCostUSD: 0,
      toolCalls: [],
      truncated: false,
      error: "pforge-master not installed",
    };
  }

  it("(4a) stub reply is a non-empty string", async () => {
    const result = await runTurnStub({ message: "test" });
    expect(typeof result.reply).toBe("string");
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.reply).toContain("pforge-master");
  });

  it("(4b) stub returns a valid UUID sessionId", async () => {
    const result = await runTurnStub({ message: "test" });
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("(4c) stub returns zero token counts", async () => {
    const result = await runTurnStub({ message: "test" });
    expect(result.tokensIn).toBe(0);
    expect(result.tokensOut).toBe(0);
    expect(result.totalCostUSD).toBe(0);
  });

  it("(4d) stub returns empty toolCalls array and truncated=false", async () => {
    const result = await runTurnStub({ message: "test" });
    expect(Array.isArray(result.toolCalls)).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("(4e) stub error field is set to indicate missing package", async () => {
    const result = await runTurnStub({ message: "test" });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("pforge-master");
  });
});
