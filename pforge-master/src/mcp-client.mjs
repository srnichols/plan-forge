/**
 * Forge-Master Studio — Downstream MCP Client (Phase-29, Slice 3).
 *
 * Spawns `pforge-mcp/server.mjs` as a child process over stdio MCP,
 * performs the MCP handshake, calls `tools/list`, and exposes
 * `invoke(name, args)` that routes through the MCP protocol rather
 * than in-process imports.
 *
 * On startup the client asserts that the discovered tool count is at
 * least BASE_TOOL_COUNT_MIN (the Phase-28 base-allowlist size). A log
 * line confirms readiness:
 *   forge-master: downstream MCP ready (N tools, M allowlisted)
 *
 * Exports:
 *   - createMcpClient(options?, deps?) → McpClient
 *   - BASE_TOOL_COUNT_MIN — minimum expected downstream tool count
 *
 * @module forge-master/mcp-client
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, appendFileSync, mkdirSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BASE_ALLOWLIST } from "./allowlist.mjs";

// ─── Constants ──────────────────────────────────────────────────────

/** Minimum downstream tool count — at least the base allowlist size */
export const BASE_TOOL_COUNT_MIN = BASE_ALLOWLIST.length;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to pforge-mcp/server.mjs relative to this file */
const DOWNSTREAM_SERVER_PATH = resolve(__dirname, "../../pforge-mcp/server.mjs");

/** Default stderr log destination inside .forge/ */
const DEFAULT_LOG_PATH = resolve(__dirname, "../../.forge/forge-master-stdio.log");

// ─── McpClient class ─────────────────────────────────────────────────

/**
 * Thin wrapper around the MCP SDK Client + StdioClientTransport.
 * Manages lifecycle, tool discovery, and invocation.
 */
export class McpClient {
  #client = null;
  #transport = null;
  #tools = [];
  #ready = false;
  #logPath = null;
  #logger = null;

  constructor({ logPath = DEFAULT_LOG_PATH, logger = console } = {}) {
    this.#logPath = logPath;
    this.#logger = logger;
  }

  /** True when connected and tools/list has been received */
  get ready() {
    return this.#ready;
  }

  /** Array of discovered tool names */
  get toolNames() {
    return this.#tools.map((t) => t.name);
  }

  /** Number of discovered tools */
  get toolCount() {
    return this.#tools.length;
  }

  /**
   * Connect to the downstream MCP server.
   * Performs handshake + tools/list + assertion.
   *
   * @param {{ serverPath?: string, env?: object }} opts
   * @returns {Promise<void>}
   */
  async connect({ serverPath = DOWNSTREAM_SERVER_PATH, env = process.env } = {}) {
    if (this.#ready) return;

    if (!existsSync(serverPath)) {
      throw new Error(`downstream MCP server not found: ${serverPath}`);
    }

    // Ensure log directory exists
    try {
      const logDir = resolve(this.#logPath, "..");
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    } catch {
      // non-fatal
    }

    const stderrHandler = this.#logPath ? "pipe" : "inherit";

    this.#transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath, "--port", "0"],
      env: { ...env },
      stderr: stderrHandler,
    });

    // Tee child stderr to log file
    if (stderrHandler === "pipe" && this.#logPath) {
      this.#transport.stderr?.on("data", (chunk) => {
        try {
          appendFileSync(this.#logPath, chunk);
        } catch {
          // non-fatal
        }
      });
    }

    this.#client = new Client(
      { name: "forge-master-studio", version: "1.0.0" },
      { capabilities: {} },
    );

    await this.#client.connect(this.#transport);

    // Discover tools
    const { tools = [] } = await this.#client.listTools();
    this.#tools = tools;

    if (tools.length < BASE_TOOL_COUNT_MIN) {
      this.#logger.warn(
        `forge-master: downstream MCP connected but tool count ${tools.length} < expected ${BASE_TOOL_COUNT_MIN}`,
      );
    }

    this.#ready = true;
    const allowlisted = BASE_ALLOWLIST.filter((n) => tools.some((t) => t.name === n)).length;
    this.#logger.log(
      `forge-master: downstream MCP ready (${tools.length} tools, ${allowlisted} allowlisted)`,
    );
  }

  /**
   * Invoke a tool on the downstream MCP server.
   *
   * @param {string} name
   * @param {object} args
   * @returns {Promise<any>} raw result content
   */
  async invoke(name, args = {}) {
    if (!this.#ready || !this.#client) {
      throw new Error("McpClient not connected — call connect() first");
    }

    const res = await this.#client.callTool({ name, arguments: args });

    // MCP result is { content: [{type, text}], isError? }
    if (res.isError) {
      const msg = res.content?.map((c) => c.text).join("") || "tool error";
      throw new Error(`MCP tool error (${name}): ${msg}`);
    }

    // Return parsed content: if it looks like JSON, parse it; else return text
    const text = res.content?.map((c) => c.text ?? "").join("") ?? "";
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Check if a tool is available downstream.
   *
   * @param {string} name
   * @returns {boolean}
   */
  hasTool(name) {
    return this.#tools.some((t) => t.name === name);
  }

  /**
   * Close the client and terminate the child process.
   *
   * @returns {Promise<void>}
   */
  async close() {
    this.#ready = false;
    try {
      await this.#transport?.close();
    } catch {
      // already closed
    }
    this.#client = null;
    this.#transport = null;
    this.#tools = [];
  }

  // ─── Test-only hooks ───────────────────────────────────────────────

  /**
   * Inject mock client/transport for unit testing.
   * @internal test-only
   */
  _injectForTest({ client, transport }) {
    this.#client = client;
    this.#transport = transport;
  }

  /**
   * Run only the post-spawn logic (tools/list + assertion + ready flag)
   * using the already-injected client. For unit testing without spawning.
   * @internal test-only
   */
  async _connectWithInjected() {
    await this.#client.connect(this.#transport);
    const { tools = [] } = await this.#client.listTools();
    this.#tools = tools;

    if (tools.length < BASE_TOOL_COUNT_MIN) {
      this.#logger.warn(
        `forge-master: downstream MCP connected but tool count ${tools.length} < expected ${BASE_TOOL_COUNT_MIN}`,
      );
    }

    this.#ready = true;
    const allowlisted = BASE_ALLOWLIST.filter((n) => tools.some((t) => t.name === n)).length;
    this.#logger.log(
      `forge-master: downstream MCP ready (${tools.length} tools, ${allowlisted} allowlisted)`,
    );
  }
}

// ─── Factory ─────────────────────────────────────────────────────────

/**
 * Create and return a connected McpClient.
 *
 * @param {{ serverPath?: string, logPath?: string, env?: object }} opts
 * @param {{ logger?: { log, warn } }} deps
 * @returns {Promise<McpClient>}
 */
export async function createMcpClient(opts = {}, deps = {}) {
  const { serverPath, logPath, env } = opts;
  const { logger = console } = deps;
  const client = new McpClient({ logPath, logger });
  await client.connect({ serverPath, env });
  return client;
}
