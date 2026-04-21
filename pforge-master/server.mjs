#!/usr/bin/env node
/**
 * Forge-Master Studio — MCP Server (Phase-29, Slice 4).
 *
 * Exposes the Forge-Master reasoning loop as a single MCP tool
 * (`forge_master_ask`) over a stdio transport. This is the "second
 * MCP server" that IDE agents can call directly and that
 * `pforge-mcp/server.mjs` proxies to.
 *
 * Usage:
 *   node pforge-master/server.mjs                 # stdio MCP (default)
 *   node pforge-master/server.mjs --mcp-stdio     # explicit stdio flag
 *   node pforge-master/server.mjs --self-test     # run startup self-test and exit 0
 *
 * On startup:
 *   1. Optionally creates the downstream MCP client (pforge-mcp/server.mjs).
 *   2. Registers the forge_master_ask tool.
 *   3. Connects stdio transport and begins serving.
 *
 * The server logs to stderr so stdout is reserved for MCP protocol.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { runTurn } from "./src/reasoning.mjs";
import { getForgeMasterConfig } from "./src/config.mjs";
import { resolveAllowlist } from "./src/allowlist.mjs";
import { createMcpClient } from "./src/mcp-client.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SELF_TEST = process.argv.includes("--self-test");
const MCP_STDIO = process.argv.includes("--mcp-stdio") || !SELF_TEST;

// ─── Tool definition ──────────────────────────────────────────────────

const FORGE_MASTER_ASK_TOOL = {
  name: "forge_master_ask",
  description:
    "Ask Forge-Master a question about your Plan Forge project. " +
    "Forge-Master classifies the intent, retrieves relevant context from memory tiers, " +
    "and calls read-only Plan Forge tools to ground its answer. " +
    "Write tools require an approval card before execution.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Your question or task for Forge-Master.",
      },
      sessionId: {
        type: "string",
        description: "Continue an existing session (optional). Omit to start a new session.",
      },
      maxToolCalls: {
        type: "number",
        description: "Maximum number of tool calls per turn (default: from config, hard ceiling: 10).",
      },
      path: {
        type: "string",
        description: "Project root path override (optional).",
      },
    },
    required: ["message"],
  },
};

// ─── Downstream MCP client ────────────────────────────────────────────

let _downstreamClient = null;
const DOWNSTREAM_PATH = resolve(__dirname, "../pforge-mcp/server.mjs");

async function getDownstreamClient() {
  if (_downstreamClient?.ready) return _downstreamClient;
  if (!existsSync(DOWNSTREAM_PATH)) return null;
  try {
    _downstreamClient = await createMcpClient(
      {
        serverPath: DOWNSTREAM_PATH,
        env: { PFORGE_CHILD_MODE: "1", ...process.env },
      },
      { logger: console },
    );
    return _downstreamClient;
  } catch (err) {
    console.error(`forge-master-server: downstream MCP unavailable: ${err.message}`);
    return null;
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────

const server = new Server(
  { name: "forge-master-studio", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [FORGE_MASTER_ASK_TOOL] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name !== "forge_master_ask") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  const t0 = Date.now();

  if (!args.message || typeof args.message !== "string") {
    return {
      content: [{ type: "text", text: "forge_master_ask: message (string) is required" }],
      isError: true,
    };
  }

  const cwd = args.path || process.cwd();
  const config = getForgeMasterConfig({ cwd });

  try {
    const downstreamClient = await getDownstreamClient();
    const allowlist = resolveAllowlist({ toolMetadata: {}, discoverExtensionTools: config.discoverExtensionTools });

    const result = await runTurn(
      {
        message: args.message,
        sessionId: args.sessionId || undefined,
        maxToolCalls: args.maxToolCalls || undefined,
        cwd,
      },
      {
        mcpClient: downstreamClient,
        dispatcher: async (toolName, toolArgs, toolCwd) => {
          if (downstreamClient?.ready) {
            return downstreamClient.invoke(toolName, { ...toolArgs, path: toolCwd || cwd });
          }
          return { output: `(tool ${toolName} unavailable — downstream MCP not connected)` };
        },
        hub: null,
        toolMetadata: Object.fromEntries(allowlist.map((n) => [n, { name: n }])),
      },
    );

    const durationMs = Date.now() - t0;
    console.error(`forge-master-server: turn complete in ${durationMs}ms, ${result.toolCalls?.length ?? 0} tool calls`);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    console.error(`forge-master-server: error: ${err.message}`);
    return {
      content: [{ type: "text", text: `Forge-Master error: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Self-test ────────────────────────────────────────────────────────

async function runSelfTest() {
  console.error("forge-master-server: --self-test starting");

  // Verify imports resolve
  const { runTurn: _rt } = await import("./src/reasoning.mjs");
  const { BASE_ALLOWLIST } = await import("./src/allowlist.mjs");
  if (!_rt || !BASE_ALLOWLIST?.length) throw new Error("core module imports failed");

  // Verify tool list
  const tools = [FORGE_MASTER_ASK_TOOL];
  if (!tools.find((t) => t.name === "forge_master_ask")) throw new Error("forge_master_ask not registered");

  console.error(`forge-master-server: --self-test PASS (forge_master_ask registered, allowlist size ${BASE_ALLOWLIST.length})`);
  process.exit(0);
}

// ─── Boot ─────────────────────────────────────────────────────────────

async function main() {
  if (SELF_TEST) {
    await runSelfTest();
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("forge-master-server: stdio MCP ready (1 tool: forge_master_ask)");

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    if (_downstreamClient) await _downstreamClient.close().catch(() => {});
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    if (_downstreamClient) await _downstreamClient.close().catch(() => {});
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`forge-master-server: fatal: ${err.message}`);
  process.exit(1);
});
