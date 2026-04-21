/**
 * Forge-Master Studio — Express route adapter (Phase-29, Slice 15).
 *
 * Registers `/api/forge-master/*` routes on the pforge-mcp Express app.
 * This is a thin adapter that delegates to the pforge-master http-routes
 * module, making the Forge-Master API available on the same port as the
 * Plan Forge dashboard (port 3100).
 *
 * Usage:
 *   import { registerForgeMasterRoutes } from "./forge-master-routes.mjs";
 *   registerForgeMasterRoutes(app);
 *
 * @module pforge-mcp/forge-master-routes
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORGE_MASTER_ROUTES_PATH = resolve(__dirname, "../pforge-master/src/http-routes.mjs");
const FORGE_MASTER_PROMPTS_PATH = resolve(__dirname, "../pforge-master/src/prompts.mjs");
// Dynamic import() needs file:// URLs on Windows, not raw absolute paths.
const FORGE_MASTER_ROUTES_URL = pathToFileURL(FORGE_MASTER_ROUTES_PATH).href;
const FORGE_MASTER_PROMPTS_URL = pathToFileURL(FORGE_MASTER_PROMPTS_PATH).href;

/**
 * Register Forge-Master Studio API routes on the Express app.
 * Safe to call even when pforge-master package is not present —
 * routes are skipped with a console warning in that case.
 *
 * @param {import("express").Application} app
 */
export async function registerForgeMasterRoutes(app) {
  if (!existsSync(FORGE_MASTER_ROUTES_PATH)) {
    console.warn("[forge-master-routes] pforge-master not found — Forge-Master Studio API disabled");
    return;
  }

  try {
    const { createHttpRoutes } = await import(FORGE_MASTER_ROUTES_URL);
    createHttpRoutes(app);
    console.error("[forge-master-routes] Forge-Master Studio API registered at /api/forge-master/*");
  } catch (err) {
    console.warn(`[forge-master-routes] Failed to register routes: ${err.message}`);
  }
}

/**
 * Build a minimal capabilities summary for the Forge-Master Studio tab.
 * Used by the dashboard capabilities panel.
 *
 * @returns {Promise<object>}
 */
export async function getForgeMasterCapabilitiesSummary() {
  if (!existsSync(FORGE_MASTER_PROMPTS_PATH)) return null;
  try {
    const { getPromptCatalog } = await import(FORGE_MASTER_PROMPTS_URL);
    const catalog = getPromptCatalog();
    return {
      available: true,
      promptCategories: catalog.categories.length,
      promptCount: catalog.categories.reduce((n, c) => n + c.prompts.length, 0),
    };
  } catch {
    return { available: false };
  }
}
