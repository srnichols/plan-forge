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
 * @param {Function} [mcpCall] — in-process tool invoker from server.mjs; wires
 *   the real dispatcher into /stream. Falls back to no-op when omitted.
 */
export async function registerForgeMasterRoutes(app, mcpCall) {
  if (!existsSync(FORGE_MASTER_ROUTES_PATH)) {
    console.warn("[forge-master-routes] pforge-master not found — Forge-Master Studio API disabled");
    return;
  }

  try {
    const { createHttpRoutes } = await import(FORGE_MASTER_ROUTES_URL);
    createHttpRoutes(app, mcpCall ? { mcpCall } : undefined);
    console.error("[forge-master-routes] Forge-Master Studio API registered at /api/forge-master/*");
  } catch (err) {
    // Issue #149 Bucket B: previously this swallowed errors as warnings,
    // including TypeError when the app was missing required HTTP methods.
    // That hid an entire class of bug. Log loudly and re-throw so callers
    // (including tests) see the failure instead of a half-registered surface.
    console.error(`[forge-master-routes] Failed to register routes: ${err.message}`);
    throw err;
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
