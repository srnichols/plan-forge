/**
 * Plan Forge -- Phase-51 Slice 0: No circular imports gate for capabilities.mjs.
 * Plan Forge -- Phase-52 Slice 0: Inherit gate to server.mjs.
 *
 * Uses madge to walk the static import graph and assert that no NEW import
 * cycles exist. Capabilities.mjs must have zero cycles; server.mjs allows one
 * known pre-existing cycle (orchestrator.mjs <-> cost-service.mjs) that is
 * explicitly documented in orchestrator.mjs and worked around with hoisted
 * function declarations.
 *
 * Scope: local (relative) imports only.
 * Node built-ins and npm packages are excluded by madge automatically.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import madge from "madge";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPABILITIES_PATH = resolve(HERE, "../capabilities.mjs");
const SERVER_PATH = resolve(HERE, "../server.mjs");

/**
 * Pre-existing cycles in server.mjs's transitive import graph that have been
 * reviewed and documented. Each entry is a canonical cycle key formed by
 * sorting the cycle members and joining with " -> ".
 *
 * DO NOT ADD entries here unless you have verified the cycle is unavoidable
 * and have documented it in both the source file and this list.
 */
const KNOWN_SERVER_CYCLES = new Set([
  // orchestrator.mjs re-exports cost-service.mjs functions for backward
  // compatibility (see orchestrator.mjs ~line 12983). cost-service.mjs imports
  // back into orchestrator.mjs for model-scoring helpers. Worked around with
  // hoisted function declarations so const aliases do not arrive undefined.
  "cost-service.mjs -> orchestrator.mjs",
]);

/** Normalise a madge cycle array to a canonical direction-insensitive key. */
function cycleKey(cycle) {
  return [...cycle].sort().join(" -> ");
}

describe("no circular imports in capabilities.mjs (Phase-51 S0)", () => {
  it("capabilities.mjs has no circular import cycles", async () => {
    const result = await madge(CAPABILITIES_PATH, {
      fileExtensions: ["mjs", "js"],
      detectiveOptions: {
        esm: { mixedImports: true },
      },
    });

    const circular = result.circular();
    if (circular.length > 0) {
      const formatted = circular.map((cycle) => cycle.join(" -> ")).join("\n  ");
      throw new Error(`Circular imports detected in capabilities.mjs:\n  ${formatted}`);
    }

    expect(circular).toHaveLength(0);
  }, 30_000);
});

describe("no circular imports in server.mjs (Phase-52 S0)", () => {
  it("server.mjs has no NEW circular import cycles beyond known exceptions", async () => {
    const result = await madge(SERVER_PATH, {
      fileExtensions: ["mjs", "js"],
      detectiveOptions: {
        esm: { mixedImports: true },
      },
    });

    const circular = result.circular();
    const newCycles = circular.filter((cycle) => !KNOWN_SERVER_CYCLES.has(cycleKey(cycle)));

    if (newCycles.length > 0) {
      const formatted = newCycles.map((cycle) => cycle.join(" -> ")).join("\n  ");
      throw new Error(
        `New circular imports detected in server.mjs (not in KNOWN_SERVER_CYCLES):\n  ${formatted}`,
      );
    }

    // Assert the known cycles have not been silently multiplied.
    expect(circular.length).toBeLessThanOrEqual(KNOWN_SERVER_CYCLES.size);
    expect(newCycles).toHaveLength(0);
  }, 60_000);
});