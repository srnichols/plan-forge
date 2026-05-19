/**
 * Test helper — provides the full server source as a combined string.
 *
 * Phase 52 (SERVER-SPLIT) decomposed `server.mjs` (~9.2K LOC) into 12
 * focused sub-modules under `pforge-mcp/server/`. Tests that do source-
 * inspection against `server.mjs` (checking TOOLS entries, handler wiring,
 * MCP_ONLY_TOOLS membership, import paths, REST routes, etc.) must look at
 * the sub-modules rather than the shim.  Instead of updating every call
 * site to target the right file, this helper concatenates all sub-modules
 * into a single string so existing `toContain` / `toMatch` assertions keep
 * working without knowing which file owns each fragment.
 *
 * Usage:
 *   import { SERVER_COMBINED_SRC } from "./helpers/server-combined-src.mjs";
 *   // replace: const serverSrc = readFileSync(resolve(ROOT, "server.mjs"), "utf-8");
 *   // with:    const serverSrc = SERVER_COMBINED_SRC;
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");  // pforge-mcp/

const SERVER_FILES = [
  "server.mjs",
  "server/state.mjs",
  "server/audit-writer.mjs",
  "server/helpers.mjs",
  "server/org-rules.mjs",
  "server/anvil-compute.mjs",
  "server/tool-definitions.mjs",
  "server/tool-handlers.mjs",
  "server/openbrain-bridge.mjs",
  "server/rest-api.mjs",
  "server/mcp-handler.mjs",
  "server/main.mjs",
  "server/surface.mjs",
];

export const SERVER_COMBINED_SRC = SERVER_FILES
  .map((f) => readFileSync(resolve(ROOT, f), "utf-8"))
  .join("\n// ─── [Phase-52 file boundary] ───\n");
