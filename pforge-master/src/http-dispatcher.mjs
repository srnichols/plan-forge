/**
 * Forge-Master HTTP Dispatcher (Phase-37.1, Slice 2; hardened Slice 4).
 *
 * Provides a factory for the allowlist-gated, in-process tool dispatcher
 * used by the `/stream` SSE handler. Separates allowlist enforcement from
 * the HTTP routing layer so both can be tested in isolation.
 *
 * Exports:
 *   - createHttpDispatcher({ allowlist?, mcpCall?, streamEventCap?, streamTimeout? }) → dispatcher fn
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
 * Failure handling (Phase-37.1 Slice 4):
 *   - mcpCall rejection → returns { error: <message> }
 *   - Stream throw mid-iteration → returns { error: <message> }
 *   - Stream timeout (no terminal within streamTimeout ms) → { error: "stream-timeout" }
 *   - null item yielded from stream → treated as terminal sentinel; terminal = null
 *   - Non-object, non-null primitive yielded → silently skipped (not counted toward cap)
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
 * Failure semantics (Phase-37.1 Slice 4):
 *   - mcpCall rejection → { error: <message> }
 *   - Stream throws → { error: <message> }
 *   - No terminal within streamTimeout ms → { error: "stream-timeout" }
 *   - null item in stream → terminal sentinel; returns { events, terminal: null }
 *   - Non-object primitive item → skipped (not counted toward streamEventCap)
 *
 * @param {{
 *   allowlist?: readonly string[],
 *   mcpCall?: (toolName: string, args: object) => Promise<any> | AsyncIterable<any>,
 *   streamEventCap?: number,
 *   streamTimeout?: number,  // ms; 0 = no timeout (default: 10000)
 * }} [opts]
 * @returns {(toolName: string, args: object) => Promise<any>}
 */
export function createHttpDispatcher({
  allowlist = BASE_ALLOWLIST,
  mcpCall = invokeForgeTool,
  streamEventCap = 20,
  streamTimeout = 10000,
} = {}) {
  const writeNames = new Set(WRITE_ALLOWLIST.map((t) => t.name));

  return async (toolName, args = {}) => {
    if (!allowlist.includes(toolName)) {
      return { error: "tool not allowlisted", tool: toolName };
    }
    if (writeNames.has(toolName)) {
      return { error: "destructive tool requires in-IDE confirmation", tool: toolName };
    }

    let rawResult;
    try {
      // Await so that async mcpCall functions are resolved before stream detection.
      rawResult = await mcpCall(toolName, args);
    } catch (err) {
      return { error: err?.message ?? String(err) };
    }

    // Collect async-iterable streams into { events: [...], terminal }.
    if (rawResult != null && typeof rawResult[Symbol.asyncIterator] === "function") {
      const consumeStream = async () => {
        const events = [];
        let terminal = null;
        for await (const item of rawResult) {
          // null item = terminal sentinel with value null; stop collecting.
          if (item === null) {
            return { events, terminal: null };
          }
          // Skip malformed (non-object) primitives — do not count toward cap.
          if (typeof item !== "object") {
            continue;
          }
          if (item.type === "terminal") {
            terminal = item;
            // Consume terminal and stop; remaining items are discarded.
            break;
          } else if (events.length < streamEventCap) {
            events.push(item);
          }
          // Items past streamEventCap are consumed but not stored.
        }
        return { events, terminal };
      };

      if (streamTimeout > 0) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("stream-timeout")), streamTimeout);
        });
        try {
          const result = await Promise.race([consumeStream(), timeoutPromise]);
          clearTimeout(timeoutId);
          return result;
        } catch (err) {
          clearTimeout(timeoutId);
          return { error: err?.message ?? String(err) };
        }
      }

      // streamTimeout === 0 → no timeout; still wrap in try/catch for throws.
      try {
        return await consumeStream();
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }

    return rawResult;
  };
}
