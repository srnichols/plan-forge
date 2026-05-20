#!/usr/bin/env node
/**
 * Plan Forge MCP Server
 * Thin entrypoint + public re-export shim for the split server modules.
 */

import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_DIR, PROJECT_DIR_SOURCE, FRAMEWORK_VERSION } from "./server/state.mjs";
import { runServerMain } from "./server/main.mjs";

console.error(`[pforge-mcp] PROJECT_DIR=${PROJECT_DIR} (source=${PROJECT_DIR_SOURCE})`);
console.error(`[pforge-mcp] FRAMEWORK_VERSION=${FRAMEWORK_VERSION}`);

export { resolveProjectRoot } from "./server/helpers.mjs";
export { invokeForgeTool } from "./server/tool-handlers.mjs";
export { _sweepAnvilCompute, _analyzeAnvilCompute, _temperingScanAnvilCompute, _hotspotAnvilCompute } from "./server/anvil-compute.mjs";
export { runDrainPass, __resetPlanPathAliasWarned, __shouldDrainOnInit } from "./server/openbrain-bridge.mjs";
export { createExpressApp } from "./server/rest-api.mjs";
export { buildServerSurface } from "./server/surface.mjs";

const isDirectRun = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runServerMain().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
