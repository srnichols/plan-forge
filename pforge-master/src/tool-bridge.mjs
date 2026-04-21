/**
 * Plan Forge — Forge-Master Tool Bridge (Phase-28, Slice 4).
 *
 * Single choke point between the reasoning loop and the main MCP
 * dispatcher. Every tool call the frontier model requests passes
 * through here. The bridge:
 *
 *   1. Checks the resolved allowlist — rejects blocked tools.
 *   2. Invokes the tool handler via the injected dispatcher.
 *   3. Truncates the raw result to ≤2000 chars for context efficiency.
 *   4. Emits a hub event with `source: "forge-master"` for cost tagging.
 *   5. Returns `{ok, result, summary, resultFull, error?, costUSD}`.
 *
 * For multi-tool turns the caller should use `invokeMany()` which
 * runs allowlisted calls in parallel via `Promise.allSettled`.
 *
 * Exports:
 *   - invokeAllowlisted({tool, args, cwd}, deps) → result object
 *   - invokeMany(calls, deps) → result object[]
 *   - summarize(text, limit?) → string
 *   - SUMMARY_LIMIT — default truncation limit (2000)
 *
 * @module forge-master/tool-bridge
 */

import { isAllowlisted } from "./allowlist.mjs";

// ─── Constants ──────────────────────────────────────────────────────

export const SUMMARY_LIMIT = 2000;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Truncate text to `limit` characters with an ellipsis marker when
 * the original exceeds the limit.
 *
 * @param {string} text
 * @param {number} [limit=SUMMARY_LIMIT]
 * @returns {string}
 */
export function summarize(text, limit = SUMMARY_LIMIT) {
  if (typeof text !== "string") {
    text = text == null ? "" : JSON.stringify(text);
  }
  if (text.length <= limit) return text;
  return text.slice(0, limit - 13) + " …[truncated]";
}

// ─── Single-tool invocation ─────────────────────────────────────────

/**
 * Invoke a single tool through the allowlist gate.
 *
 * @param {{ tool: string, args?: object, cwd?: string }} call
 * @param {{
 *   resolvedAllowlist: string[],
 *   dispatcher: (name: string, args: object, cwd?: string) => Promise<any>,
 *   hub?: { broadcast: (event: object) => void } | null,
 * }} deps — injected dependencies (DI for testability)
 * @returns {Promise<{
 *   ok: boolean,
 *   tool: string,
 *   result?: any,
 *   summary?: string,
 *   resultFull?: any,
 *   error?: string,
 *   costUSD?: number,
 *   source: "forge-master",
 * }>}
 */
export async function invokeAllowlisted({ tool, args = {}, cwd }, deps) {
  const { resolvedAllowlist, dispatcher, hub = null } = deps;

  // ── Allowlist gate ──
  const check = isAllowlisted(tool, resolvedAllowlist);
  if (!check.allowed) {
    const errorPayload = {
      ok: false,
      tool,
      error: "tool_not_allowlisted",
      reason: check.reason,
      source: "forge-master",
    };
    emitEvent(hub, "forge-master.tool-rejected", { tool, reason: check.reason });
    return errorPayload;
  }

  // ── Dispatch ──
  const t0 = Date.now();
  let raw;
  try {
    raw = await dispatcher(tool, args, cwd);
  } catch (err) {
    const elapsed = Date.now() - t0;
    const errorPayload = {
      ok: false,
      tool,
      error: `dispatcher_error: ${err.message}`,
      source: "forge-master",
    };
    emitEvent(hub, "forge-master.tool-error", {
      tool,
      error: err.message,
      durationMs: elapsed,
      source: "forge-master",
    });
    return errorPayload;
  }

  const elapsed = Date.now() - t0;

  // ── Serialise raw result for summarisation ──
  const fullText = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
  const summary = summarize(fullText);

  const result = {
    ok: true,
    tool,
    result: raw,
    summary,
    resultFull: raw,
    costUSD: 0,
    source: "forge-master",
  };

  emitEvent(hub, "forge-master.tool-complete", {
    tool,
    durationMs: elapsed,
    summaryLength: summary.length,
    truncated: fullText.length > SUMMARY_LIMIT,
    source: "forge-master",
  });

  return result;
}

// ─── Multi-tool (parallel) invocation ───────────────────────────────

/**
 * Invoke multiple tools in parallel. Each call goes through the
 * allowlist gate individually.
 *
 * @param {Array<{ tool: string, args?: object, cwd?: string }>} calls
 * @param {object} deps — same as `invokeAllowlisted`
 * @returns {Promise<Array<object>>}
 */
export async function invokeMany(calls, deps) {
  if (!Array.isArray(calls) || calls.length === 0) return [];

  const settled = await Promise.allSettled(
    calls.map((c) => invokeAllowlisted(c, deps)),
  );

  return settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : {
          ok: false,
          tool: "unknown",
          error: `promise_rejected: ${s.reason?.message ?? String(s.reason)}`,
          source: "forge-master",
        },
  );
}

// ─── Transport-aware dispatcher factory ─────────────────────────────

/**
 * Create a dispatcher function that routes tool calls through the MCP
 * protocol or falls back to in-process invocation.
 *
 * @param {{
 *   transport: "mcp" | "inprocess",
 *   mcpClient?: { ready: boolean, hasTool: (n: string) => boolean, invoke: (n: string, a: object) => Promise<any> } | null,
 *   fallbackDispatcher?: (name: string, args: object, cwd?: string) => Promise<any>,
 * }} opts
 * @returns {(name: string, args: object, cwd?: string) => Promise<any>}
 */
export function createDispatcher({ transport, mcpClient = null, fallbackDispatcher = null } = {}) {
  if (!transport) {
    throw new Error("createDispatcher: transport is required ('mcp' or 'inprocess')");
  }

  return async (name, args = {}, cwd) => {
    if (transport === "mcp" && mcpClient?.ready) {
      // When MCP transport is selected but the tool isn't available
      // downstream, fall back to in-process if available.
      if (!mcpClient.hasTool(name)) {
        if (fallbackDispatcher) return fallbackDispatcher(name, args, cwd);
        throw new Error(`tool '${name}' not found on downstream MCP and no fallback dispatcher`);
      }
      return mcpClient.invoke(name, args);
    }

    // transport === "inprocess", or MCP requested but client not ready
    if (fallbackDispatcher) return fallbackDispatcher(name, args, cwd);
    throw new Error(`no dispatcher available (transport=${transport}, mcpReady=${!!mcpClient?.ready})`);
  };
}

// ─── Hub event helper ───────────────────────────────────────────────

function emitEvent(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  hub.broadcast({
    type,
    ...data,
    source: "forge-master",
    timestamp: new Date().toISOString(),
  });
}
