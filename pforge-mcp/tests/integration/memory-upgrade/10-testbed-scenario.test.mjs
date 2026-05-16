/**
 * 10-testbed-scenario.test.mjs — Scenario 10: Testbed scenario + registration.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Testbed scenario):
 *   MUST: `forge_testbed_happypath` lists `memory-upgrade-e2e` in its scenarios
 *         output (verified by checking REGISTERED_SCENARIOS from the index).
 *   MUST: Running the scenario produces a summary JSON containing keys
 *         { anvilHits, anvilMisses, latticeChunks, hallmarkRecords, dlqCount }
 *         and all values are non-negative numbers.
 *   MUST: Scenario teardown removes the tmp directory (asserted by post-run
 *         filesystem check via result.tmpDirCleaned).
 *
 * Tests run the scenario directly via its exported `run()` function — the
 * same entry point `forge_testbed_happypath` calls for module-based scenarios.
 * No MCP server is required.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";

import { scenario } from "../../../testbed/scenarios/memory-upgrade-e2e.mjs";
import { REGISTERED_SCENARIOS, memoryUpgradeE2E } from "../../../testbed/scenarios/index.mjs";

// ─── Scenario metadata ────────────────────────────────────────────────────────

describe("Scenario 10a — memory-upgrade-e2e metadata", () => {
  it("scenario.scenarioId is 'memory-upgrade-e2e'", () => {
    expect(scenario.scenarioId).toBe("memory-upgrade-e2e");
  });

  it("scenario.kind is 'happy-path'", () => {
    expect(scenario.kind).toBe("happy-path");
  });

  it("scenario.description is a non-empty string", () => {
    expect(typeof scenario.description).toBe("string");
    expect(scenario.description.length).toBeGreaterThan(0);
  });

  it("scenario.run is a function", () => {
    expect(typeof scenario.run).toBe("function");
  });
});

// ─── Registry registration ────────────────────────────────────────────────────

describe("Scenario 10b — REGISTERED_SCENARIOS index", () => {
  it("REGISTERED_SCENARIOS is an array", () => {
    expect(Array.isArray(REGISTERED_SCENARIOS)).toBe(true);
  });

  it("REGISTERED_SCENARIOS includes memory-upgrade-e2e", () => {
    const ids = REGISTERED_SCENARIOS.map((s) => s.scenarioId);
    expect(ids).toContain("memory-upgrade-e2e");
  });

  it("memoryUpgradeE2E named export matches the scenario", () => {
    expect(memoryUpgradeE2E.scenarioId).toBe("memory-upgrade-e2e");
  });

  it("all registered scenarios have required shape (scenarioId, kind, run)", () => {
    for (const s of REGISTERED_SCENARIOS) {
      expect(typeof s.scenarioId).toBe("string");
      expect(typeof s.kind).toBe("string");
      expect(typeof s.run).toBe("function");
    }
  });

  it("forge_testbed_happypath would discover memory-upgrade-e2e (kind=happy-path filter)", () => {
    const happyPath = REGISTERED_SCENARIOS.filter((s) => s.kind === "happy-path");
    const ids = happyPath.map((s) => s.scenarioId);
    expect(ids).toContain("memory-upgrade-e2e");
  });
});

// ─── Summary shape ────────────────────────────────────────────────────────────

describe("Scenario 10c — run() summary shape", () => {
  it(
    "result has required top-level keys: ok, status, durationMs, summary",
    async () => {
      const result = await scenario.run();
      expect(typeof result.ok).toBe("boolean");
      expect(typeof result.status).toBe("string");
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.summary).toBeDefined();
      expect(typeof result.summary).toBe("object");
    },
    30_000,
  );

  it(
    "summary contains all five required keys",
    async () => {
      const { summary } = await scenario.run();
      expect(Object.keys(summary)).toEqual(
        expect.arrayContaining([
          "anvilHits",
          "anvilMisses",
          "latticeChunks",
          "hallmarkRecords",
          "dlqCount",
        ]),
      );
    },
    30_000,
  );

  it(
    "all summary values are non-negative numbers",
    async () => {
      const { summary } = await scenario.run();
      for (const [key, value] of Object.entries(summary)) {
        expect(typeof value, `${key} should be a number`).toBe("number");
        expect(value, `${key} should be non-negative`).toBeGreaterThanOrEqual(0);
      }
    },
    30_000,
  );

  it(
    "anvilHits >= 1 (cache hit on identical inputs)",
    async () => {
      const { summary } = await scenario.run();
      expect(summary.anvilHits).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "anvilMisses >= 1 (cold start on first call)",
    async () => {
      const { summary } = await scenario.run();
      expect(summary.anvilMisses).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "latticeChunks >= 1 (files were indexed)",
    async () => {
      const { summary } = await scenario.run();
      expect(summary.latticeChunks).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "hallmarkRecords >= 1 (memories were written to mock-OpenBrain)",
    async () => {
      const { summary } = await scenario.run();
      expect(summary.hallmarkRecords).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "dlqCount is 0 in the happy path (no failures)",
    async () => {
      const { summary } = await scenario.run();
      expect(summary.dlqCount).toBe(0);
    },
    30_000,
  );
});

// ─── Teardown / cleanup ───────────────────────────────────────────────────────

describe("Scenario 10d — teardown removes tmp directory", () => {
  it(
    "tmpDirCleaned is true after run()",
    async () => {
      const result = await scenario.run();
      expect(result.tmpDirCleaned).toBe(true);
    },
    30_000,
  );

  it(
    "tmpDir path no longer exists on the filesystem after run()",
    async () => {
      const result = await scenario.run();
      expect(existsSync(result.tmpDir)).toBe(false);
    },
    30_000,
  );
});

// ─── Status ───────────────────────────────────────────────────────────────────

describe("Scenario 10e — run() status", () => {
  it(
    "status is 'passed' in the happy path",
    async () => {
      const result = await scenario.run();
      expect(result.status).toBe("passed");
    },
    30_000,
  );

  it(
    "ok is true in the happy path",
    async () => {
      const result = await scenario.run();
      expect(result.ok).toBe(true);
    },
    30_000,
  );
});
