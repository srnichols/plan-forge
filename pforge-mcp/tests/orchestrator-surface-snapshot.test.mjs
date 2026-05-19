/**
 * Phase 53 (ORCHESTRATOR-SPLIT) — Snapshot-as-contract test.
 *
 * Asserts that `buildOrchestratorSurface()` returns a payload that is
 * byte-identical to the checked-in golden fixture at
 * `tests/fixtures/orchestrator-surface.golden.json`.
 *
 * Fails if any exported symbol is added, removed, or renamed during
 * the Phase 53 extraction slices — enforcing the zero-behavior-change rule.
 *
 * To update the fixture intentionally (e.g., new export added):
 *   node pforge-mcp/tests/generate-orchestrator-surface.mjs
 *   git add pforge-mcp/tests/fixtures/orchestrator-surface.golden.json
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOrchestratorSurface } from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(__dirname, "fixtures", "orchestrator-surface.golden.json");

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
const surface = buildOrchestratorSurface();

describe("orchestrator-surface-snapshot (Phase 53 S0)", () => {
  it("buildOrchestratorSurface returns an object with an exports array", () => {
    expect(surface).toHaveProperty("exports");
    expect(Array.isArray(surface.exports)).toBe(true);
  });

  it("exports list is sorted alphabetically", () => {
    const sorted = [...surface.exports].sort();
    expect(surface.exports).toEqual(sorted);
  });

  it("exports list matches the golden fixture byte-for-byte", () => {
    const actual = JSON.stringify(surface, null, 2) + "\n";
    const expected = JSON.stringify(golden, null, 2) + "\n";
    expect(actual).toBe(expected);
  });

  it("all golden exports are present in live module", async () => {
    const mod = await import("../orchestrator.mjs");
    const liveKeys = new Set(Object.keys(mod));
    const missingFromLive = golden.exports.filter((name) => !liveKeys.has(name));
    expect(
      missingFromLive,
      `golden fixture has exports not found in live module: ${missingFromLive.join(", ")}`
    ).toHaveLength(0);
  });

  it("live module exports match the golden fixture (no undeclared new exports)", async () => {
    const mod = await import("../orchestrator.mjs");
    const liveKeys = Object.keys(mod).sort();
    const goldenKeys = [...golden.exports].sort();
    expect(liveKeys).toEqual(goldenKeys);
  });
});
