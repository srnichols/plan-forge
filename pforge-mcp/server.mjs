#!/usr/bin/env node
/**
 * Plan Forge MCP Server
 * Thin entrypoint + public re-export shim for the split server modules.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECT_DIR, PROJECT_DIR_SOURCE, FRAMEWORK_VERSION } from "./server/state.mjs";
import { runServerMain } from "./server/main.mjs";

// ─── Load .env from project root (cwd) at startup ──────────────────────
// Lightweight parser — existing process.env values always win.
try {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    for (const rawLine of envContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
} catch {}

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
