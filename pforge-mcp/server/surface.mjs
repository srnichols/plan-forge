import { TOOLS } from "./tool-definitions.mjs";
import { REST_ROUTES } from "./rest-api.mjs";
import { MCP_ONLY_TOOLS } from "./tool-handlers.mjs";

/**
 * Phase-52 S0 — Server surface snapshot contract.
 * Returns the deterministic server surface: MCP tools + REST routes + MCP-only tool names.
 * Used by pforge-mcp/tests/server-surface-snapshot.test.mjs to gate "no behavior change".
 * Pure function — no side effects, no I/O.
 */
export function buildServerSurface() {
  const tools = TOOLS
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const restRoutes = REST_ROUTES
    .map((route) => ({ ...route }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  const mcpOnlyTools = [...MCP_ONLY_TOOLS].sort();

  return { tools, restRoutes, mcpOnlyTools };
}
