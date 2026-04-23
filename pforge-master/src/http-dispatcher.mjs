/**
 * Forge-Master HTTP Dispatcher (Phase-36, Slice 3).
 *
 * Provides a factory for the allowlist-gated, in-process tool dispatcher
 * used by the `/stream` SSE handler. Separates allowlist enforcement from
 * the HTTP routing layer so both can be tested in isolation.
 *
 * Exports:
 *   - createHttpDispatcher({ allowlist?, mcpCall? }) → dispatcher fn
 *   - invokeForgeTool(toolName, args) → default no-op (standalone fallback)
 *
 * Design notes:
 *   - Destructive tools (in WRITE_ALLOWLIST) are rejected over HTTP in this
 *     phase; approval is an in-IDE concern only (see Scope Contract, Phase-36).
 *   - mcpCall is injected at creation time so the dispatcher can be unit-tested
 *     without a live MCP server.
 *
 * @module forge-master/http-dispatcher
 */

import { BASE_ALLOWLIST, WRITE_ALLOWLIST } from "./allowlist.mjs";

// ─── Default fallback ─────────────────────────────────────────────────

/**
 * Default no-op invokeForgeTool — returns an empty object.
 *
 * Used when pforge-master runs standalone (without a live pforge-mcp
 * server available). forge-master-routes.mjs replaces this with the
 * real in-process dispatcher from server.mjs at registration time.
 *
 * @param {string} _toolName
 * @param {object} _args
 * @returns {Promise<{}>}
 */
export async function invokeForgeTool(_toolName, _args) {
  return {};
}

// ─── Dispatcher factory ───────────────────────────────────────────────

/**
 * Create an HTTP dispatcher that enforces the allowlist and rejects
 * destructive (write) tools before forwarding to mcpCall.
 *
 * @param {{
 *   allowlist?: readonly string[],
 *   mcpCall?: (toolName: string, args: object) => Promise<any>,
 * }} [opts]
 * @returns {(toolName: string, args: object) => Promise<any>}
 */
export function createHttpDispatcher({
  allowlist = BASE_ALLOWLIST,
  mcpCall = invokeForgeTool,
} = {}) {
  const writeNames = new Set(WRITE_ALLOWLIST.map((t) => t.name));

  return async (toolName, args = {}) => {
    if (!allowlist.includes(toolName)) {
      return { error: "tool not allowlisted", tool: toolName };
    }
    if (writeNames.has(toolName)) {
      return { error: "destructive tool requires in-IDE confirmation", tool: toolName };
    }
    return mcpCall(toolName, args);
  };
}
