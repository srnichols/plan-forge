/**
 * Forge-Master HTTP Dispatcher (Phase-37.1, Slice 2).
 *
 * Provides a factory for the allowlist-gated, in-process tool dispatcher
 * used by the `/stream` SSE handler. Separates allowlist enforcement from
 * the HTTP routing layer so both can be tested in isolation.
 *
 * Exports:
 *   - createHttpDispatcher({ allowlist?, mcpCall?, streamEventCap? }) → dispatcher fn
 *   - invokeForgeTool(toolName, args) → default no-op (standalone fallback)
 *
 * Design notes:
 *   - The dispatcher awaits the terminal result of every tool call (terminal-await).
 *     When mcpCall returns an async iterable (streaming tool), the dispatcher
 *     collects all non-terminal events into { events: [...], terminal } up to
 *     streamEventCap (default 20) and returns that aggregate.
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
 * When mcpCall returns an async iterable, the dispatcher collects
 * non-terminal events into { events: [...], terminal } up to streamEventCap,
 * consuming the remainder of the stream to reach the terminal item.
 *
 * @param {{
 *   allowlist?: readonly string[],
 *   mcpCall?: (toolName: string, args: object) => Promise<any> | AsyncIterable<any>,
 *   streamEventCap?: number,
 * }} [opts]
 * @returns {(toolName: string, args: object) => Promise<any>}
 */
export function createHttpDispatcher({
  allowlist = BASE_ALLOWLIST,
  mcpCall = invokeForgeTool,
  streamEventCap = 20,
} = {}) {
  const writeNames = new Set(WRITE_ALLOWLIST.map((t) => t.name));

  return async (toolName, args = {}) => {
    if (!allowlist.includes(toolName)) {
      return { error: "tool not allowlisted", tool: toolName };
    }
    if (writeNames.has(toolName)) {
      return { error: "destructive tool requires in-IDE confirmation", tool: toolName };
    }

    // Await so that async mcpCall functions are resolved before stream detection.
    const rawResult = await mcpCall(toolName, args);

    // Collect async-iterable streams into { events: [...], terminal }.
    if (rawResult != null && typeof rawResult[Symbol.asyncIterator] === "function") {
      const events = [];
      let terminal = null;
      for await (const item of rawResult) {
        if (item?.type === "terminal") {
          terminal = item;
        } else if (events.length < streamEventCap) {
          events.push(item);
        }
        // Items past streamEventCap are consumed but not stored.
      }
      return { events, terminal };
    }

    return rawResult;
  };
}
