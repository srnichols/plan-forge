/**
 * Testbed Scenario Registry — in-process (module-based) scenarios.
 *
 * Phase-MEMORY-QA-PLAN Slice 6
 *
 * Each entry is a scenario object with the shape:
 *   { scenarioId: string, kind: "happy-path"|"chaos"|"perf"|"long-horizon",
 *     description: string, run: async (deps) => result }
 *
 * Exported as `REGISTERED_SCENARIOS` so `forge_testbed_happypath` can
 * discover and run them without scanning the filesystem for JSON fixtures.
 *
 * @module testbed/scenarios/index
 */

export { scenario as memoryUpgradeE2E } from "./memory-upgrade-e2e.mjs";

import { scenario as memoryUpgradeE2E } from "./memory-upgrade-e2e.mjs";

/** All registered in-process scenarios, in run order. */
export const REGISTERED_SCENARIOS = [
  memoryUpgradeE2E,
];
