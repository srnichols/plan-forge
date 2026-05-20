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
import { startObserver } from "./src/observer-loop.mjs";

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

const FORGE_MASTER_OBSERVE_TOOL = {
  name: "forge_master_observe",
  description:
    "Control the Forge-Master observer — a background hub subscriber that batches " +
    "live Plan Forge events and (in later slices) narrates notable patterns. " +
    "Observer is mute-by-default; LLM narration is wired in Slice 7. " +
    "Read-only: cannot invoke write tools or modify project files.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "stop", "status"],
        description: "start — begin observing hub events; stop — halt the observer; status — return current state.",
      },
      sessionId: {
        type: "string",
        description: "Optional session ID for tracing.",
      },
      detach: {
        type: "boolean",
        description: "If true, observer runs as a detached background process (not yet implemented — reserved for Slice 8).",
      },
    },
    required: ["action"],
  },
};

// ─── Active observer (singleton) ─────────────────────────────────────

let _activeObserver = null;
/** Echoed batches (ring-buffer of last 20 batches — for status echo before Slice 7 LLM). */
const _observedBatches = [];
const MAX_OBSERVED_BATCHES = 20;

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
  return { tools: [FORGE_MASTER_ASK_TOOL, FORGE_MASTER_OBSERVE_TOOL] };
});

function _textResult(obj, isError = false) {
  const text = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return isError ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };
}

function _handleObserveStart(cwd) {
  const fmConfig = getForgeMasterConfig({ cwd });
  if (!fmConfig.observer.enabled) {
    return { response: _textResult({
      ok: false,
      error: "observer-disabled",
      message: "Observer is disabled. Set forgeMaster.observer.enabled: true in .forge.json to enable.",
    }, true) };
  }

  if (_activeObserver && !_activeObserver.getStatus().stopped) {
    return { response: _textResult({
      ok: true,
      message: "Observer already running.",
      status: _activeObserver.getStatus(),
    }) };
  }
  _observedBatches.length = 0;
  const observer = startObserver({
    cwd,
    onBatch: (batch) => {
      _observedBatches.push({ receivedAt: new Date().toISOString(), events: batch });
      if (_observedBatches.length > MAX_OBSERVED_BATCHES) _observedBatches.shift();
      console.error(`[forge_master_observe] batch: ${batch.length} event(s)`);
      // Slice 7 will call runObserverTurn here
    },
  });
  console.error(`forge-master-server: observer started`);
  return {
    observer,
    response: _textResult({
      ok: true,
      message: "Observer started. Subscribing to hub events.",
      status: observer.getStatus(),
    }),
  };
}

function _handleObserveStop() {
  if (!_activeObserver || _activeObserver.getStatus().stopped) {
    return _textResult({ ok: true, message: "Observer is not running." });
  }
  _activeObserver.stop();
  const finalStatus = _activeObserver.getStatus();
  console.error(`forge-master-server: observer stopped`);
  return _textResult({ ok: true, message: "Observer stopped.", status: finalStatus });
}

function _handleObserveStatus() {
  const status = _activeObserver
    ? _activeObserver.getStatus()
    : { connected: false, stopped: true, message: "Observer has not been started." };
  return _textResult({
    ok: true,
    status,
    recentBatches: _observedBatches.slice(-5),
  });
}

function _handleObserve(args) {
  const { action } = args;
  const cwd = args.path || process.cwd();

  if (!action || !["start", "stop", "status"].includes(action)) {
    return _textResult("forge_master_observe: action must be 'start', 'stop', or 'status'", true);
  }

  if (action === "start") {
    const { observer, response } = _handleObserveStart(cwd);
    if (observer) _activeObserver = observer;
    return response;
  }

  if (action === "stop") {
    return _handleObserveStop();
  }

  return _handleObserveStatus();
}

async function _handleAsk(args) {
  if (!args.message || typeof args.message !== "string") {
    return _textResult("forge_master_ask: message (string) is required", true);
  }

  const t0 = Date.now();
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

    return _textResult(result);
  } catch (err) {
    console.error(`forge-master-server: error: ${err.message}`);
    return _textResult(`Forge-Master error: ${err.message}`, true);
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === "forge_master_observe") {
    return _handleObserve(args);
  }

  if (name === "forge_master_ask") {
    return _handleAsk(args);
  }

  return _textResult(`Unknown tool: ${name}`, true);
});

// ─── Self-test ────────────────────────────────────────────────────────

async function runSelfTest() {
  console.error("forge-master-server: --self-test starting");

  // Verify imports resolve
  const { runTurn: _rt } = await import("./src/reasoning.mjs");
  const { BASE_ALLOWLIST } = await import("./src/allowlist.mjs");
  const { startObserver: _so } = await import("./src/observer-loop.mjs");
  if (!_rt || !BASE_ALLOWLIST?.length) throw new Error("core module imports failed");
  if (typeof _so !== "function") throw new Error("observer-loop import failed");

  // Verify tool list (exactly 2 tools)
  const tools = [FORGE_MASTER_ASK_TOOL, FORGE_MASTER_OBSERVE_TOOL];
  if (!tools.find((t) => t.name === "forge_master_ask")) throw new Error("forge_master_ask not registered");
  if (!tools.find((t) => t.name === "forge_master_observe")) throw new Error("forge_master_observe not registered");
  if (tools.length !== 2) throw new Error(`expected 2 tools, got ${tools.length}`);

  console.error(`forge-master-server: --self-test PASS (2 tools: forge_master_ask, forge_master_observe; allowlist size ${BASE_ALLOWLIST.length})`);
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
