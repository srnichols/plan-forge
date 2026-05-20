/**
 * Plan Forge — Phase-51 Slice 0: Capabilities surface golden snapshot test.
 *
 * Guards against accidental addition or removal of:
 *   - top-level keys in the buildCapabilitySurface() return object
 *   - tool names (from TOOL_NAMES in enums.mjs)
 *   - skill names (from SYSTEM_REFERENCE.skills.available in capabilities.mjs)
 *
 * To update the golden after an intentional surface change, regenerate it:
 *   node -e "
 *     import('./capabilities.mjs').then(m => {
 *       const s = m.buildCapabilitySurface(null);
 *       const golden = {
 *         schemaVersion: s.schemaVersion,
 *         topLevelKeys: Object.keys(s),
 *         tools: s.tools.map(t => t.name).sort(),
 *         skills: Object.keys(s.system.skills.available).sort()
 *       };
 *       require('fs').writeFileSync('tests/fixtures/capabilities-surface.golden.json', JSON.stringify(golden, null, 2));
 *     });
 *   "
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCapabilitySurface } from "../capabilities.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = resolve(HERE, "fixtures/capabilities-surface.golden.json");

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));

// Build the surface once; pass null so buildCapabilitySurface uses TOOL_NAMES
// from enums.mjs (the canonical source of truth).
const surface = buildCapabilitySurface(null);

describe("capabilities surface golden snapshot (Phase-51 S0)", () => {
  it("golden fixture has required keys (tools + skills)", () => {
    expect(Array.isArray(golden.tools), "golden.tools must be an array").toBe(true);
    expect(golden.tools.length, "golden.tools must be non-empty").toBeGreaterThan(0);
    expect(Array.isArray(golden.skills), "golden.skills must be an array").toBe(true);
    expect(golden.skills.length, "golden.skills must be non-empty").toBeGreaterThan(0);
  });

  it("top-level surface keys match the golden", () => {
    expect(Object.keys(surface).sort()).toEqual([...golden.topLevelKeys].sort());
  });

  it("schemaVersion has not regressed", () => {
    expect(surface.schemaVersion).toBe(golden.schemaVersion);
  });

  it("tool names match the golden (no tool added or removed without a golden update)", () => {
    const current = surface.tools.map((t) => t.name).sort();
    const expected = [...golden.tools].sort();
    expect(current).toEqual(expected);
  });

  it("skill names match the golden (no skill added or removed without a golden update)", () => {
    const current = Object.keys(surface.system.skills.available).sort();
    const expected = [...golden.skills].sort();
    expect(current).toEqual(expected);
  });
});
