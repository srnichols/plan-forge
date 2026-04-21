#!/usr/bin/env node
/**
 * Forge-Master Studio — Server Entry Point (Phase-29, Slice 11).
 *
 * Supports two modes:
 *   node server.mjs              — MCP stdio transport (default)
 *   node server.mjs --http       — standalone HTTP server on port 3102
 *   node server.mjs --self-test  — run a ping self-test and exit 0
 *
 * @module forge-master/server
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args.includes("--http") ? "http" : "mcp-stdio";
const selfTest = args.includes("--self-test");

if (selfTest) {
  await runSelfTest();
} else if (mode === "http") {
  await runHttpMode();
} else {
  await runMcpStdioMode();
}

// ─── MCP stdio mode ──────────────────────────────────────────────────

async function runMcpStdioMode() {
  const { runTurn } = await import("./src/reasoning.mjs");
  const { McpClient } = await import("./src/mcp-client.mjs");

  const downstreamPath = resolve(__dirname, "../pforge-mcp/server.mjs");
  let dispatcher;

  if (existsSync(downstreamPath)) {
    try {
      const mcpClient = new McpClient({ logger: console });
      await mcpClient.connect({ serverPath: downstreamPath });
      dispatcher = async (toolName, toolArgs) => mcpClient.invoke(toolName, toolArgs);
    } catch (err) {
      console.error(`forge-master: failed to connect to downstream: ${err.message}`);
      dispatcher = async () => ({});
    }
  } else {
    dispatcher = async () => ({});
  }

  const server = new Server(
    { name: "forge-master", version: "2.63.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "forge_master_ask",
      description: "Ask Forge-Master a question about your Plan Forge project. Forge-Master will classify intent, retrieve context, and reason with available tools.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Your question or request" },
          sessionId: { type: "string", description: "Optional session ID for context continuity" },
          maxToolCalls: { type: "number", description: "Maximum tool calls (default: 5)" },
        },
        required: ["message"],
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    if (name !== "forge_master_ask") {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      const result = await runTurn(
        {
          message: toolArgs.message,
          sessionId: toolArgs.sessionId,
          maxToolCalls: toolArgs.maxToolCalls,
        },
        { dispatcher },
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Forge-Master error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ─── HTTP mode ───────────────────────────────────────────────────────

async function runHttpMode() {
  const { createHttpRoutes } = await import("./src/http-routes.mjs");

  const handler = createHttpRoutes(null);
  const PORT = 3102;
  const HOST = "127.0.0.1";

  const httpServer = createServer(async (req, res) => {
    // Static UI
    if (req.url === "/" || req.url === "") {
      res.writeHead(302, { Location: "/ui/" });
      res.end();
      return;
    }
    if (req.url?.startsWith("/ui/")) {
      await serveStatic(req, res);
      return;
    }

    // API routes
    try {
      await handler(req, res);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`forge-master HTTP server running at http://${HOST}:${PORT}`);
  });
}

async function serveStatic(req, res) {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const MIME = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  const urlPath = req.url.replace(/^\/ui/, "");
  const filePath = join(__dirname, "ui", urlPath === "/" ? "index.html" : urlPath);
  try {
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = filePath.match(/\.[^.]+$/)?.[0] || ".html";
    const mime = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(readFileSync(filePath));
  } catch {
    res.writeHead(500);
    res.end("Server error");
  }
}

// ─── Self-test mode ──────────────────────────────────────────────────

async function runSelfTest() {
  const { getPromptCatalog } = await import("./src/prompts.mjs");
  const { BASE_ALLOWLIST, WRITE_TOOLS_EXCLUDED } = await import("./src/allowlist.mjs");

  const catalog = getPromptCatalog();
  const promptCount = catalog.categories.reduce((n, c) => n + c.prompts.length, 0);

  const checks = [
    { name: "prompt-catalog-version", ok: catalog.version === "1.0.0" },
    { name: "prompt-count-gte-30", ok: promptCount >= 30 },
    { name: "base-allowlist-populated", ok: BASE_ALLOWLIST.length > 0 },
    { name: "write-allowlist-populated", ok: WRITE_TOOLS_EXCLUDED.length > 0 },
  ];

  const failed = checks.filter(c => !c.ok);
  if (failed.length > 0) {
    console.error(`Self-test FAILED: ${failed.map(c => c.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`Self-test OK (${checks.length} checks, ${promptCount} prompts)`);
  process.exit(0);
}
