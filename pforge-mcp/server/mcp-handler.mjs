import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { FRAMEWORK_VERSION, setMcpServerRef } from "./state.mjs";
import { TOOLS } from "./tool-definitions.mjs";
import { toolProfiles } from "./tool-profile-state.mjs";
import { callToolRequestHandler } from "./tool-handlers.mjs";

// ─── MCP Server ───────────────────────────────────────────────────────
export const server = new Server(
  // Issue #106: report the running install's version, not a stale literal.
  { name: "plan-forge-mcp", version: FRAMEWORK_VERSION },
  // listChanged: forge_tool_profile changes which tools are listed.
  { capabilities: { tools: { listChanged: true } } }
);
setMcpServerRef(server);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolProfiles.listedTools(TOOLS),
}));

server.setRequestHandler(CallToolRequestSchema, callToolRequestHandler);
