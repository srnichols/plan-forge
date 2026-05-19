/**
 * Plan Forge — Phase-51 Slice 0: No circular imports gate for capabilities.mjs.
 *
 * Uses madge to walk the static import graph of capabilities.mjs and assert
 * that no import cycle exists. A cycle here would cause unpredictable module
 * initialization order and intermittent failures in tests that import
 * capabilities.mjs directly.
 *
 * Scope: capabilities.mjs and its local (relative) imports only.
 * Node built-ins and npm packages are excluded by madge automatically.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import madge from "madge";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPABILITIES_PATH = resolve(HERE, "../capabilities.mjs");
const SERVER_PATH = resolve(HERE, "../server.mjs");

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
      // Surface the cycles so the developer can fix them without grepping.
      const formatted = circular.map((cycle) => cycle.join(" → ")).join("\n  ");
      throw new Error(`Circular imports detected in capabilities.mjs:\n  ${formatted}`);
    }

    expect(circular).toHaveLength(0);
  }, 30_000);
});

describe("no circular imports in server.mjs (Phase-52 S0)", () => {
  // Pre-existing cycle from Phase-52 S0 baseline — tracked as tech debt.
  // The gate prevents NEW cycles; fix of this cycle is deferred to a later slice.
  const KNOWN_CYCLES = new Set(["orchestrator.mjs → cost-service.mjs"]);

  it("server.mjs has no circular import cycles beyond the known baseline", async () => {
    const result = await madge(SERVER_PATH, {
      fileExtensions: ["mjs", "js"],
      detectiveOptions: {
        esm: { mixedImports: true },
      },
    });

    const circular = result.circular();
    const newCycles = circular.filter(
      (cycle) => !KNOWN_CYCLES.has(cycle.join(" → ")),
    );
    if (newCycles.length > 0) {
      const formatted = newCycles.map((cycle) => cycle.join(" → ")).join("\n  ");
      throw new Error(`New circular imports detected in server.mjs:\n  ${formatted}`);
    }

    expect(newCycles).toHaveLength(0);
  }, 60_000);
});
