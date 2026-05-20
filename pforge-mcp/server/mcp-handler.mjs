import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FRAMEWORK_VERSION, setMcpServerRef } from "./state.mjs";
import { TOOLS } from "./tool-definitions.mjs";
import { callToolRequestHandler } from "./tool-handlers.mjs";

// ─── MCP Server ───────────────────────────────────────────────────────
export const server = new Server(
  // Issue #106: report the running install's version, not a stale literal.
  { name: "plan-forge-mcp", version: FRAMEWORK_VERSION },
  { capabilities: { tools: {} } }
);
setMcpServerRef(server);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, callToolRequestHandler);
