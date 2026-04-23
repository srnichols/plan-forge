/**
 * http-dispatcher-parity.test.mjs
 *
 * Parity audit: every tool in BASE_ALLOWLIST must NOT produce
 * `{ error: "Unknown tool: <name>" }` when dispatched through the HTTP bridge.
 *
 * Classification (from pforge-mcp/server.mjs:executeTool switch, 2026-04-23,
 * updated Phase-37.1 Slice 2):
 *   OK      — executeTool returns runPforge(...) → CLI output, no error
 *   ASYNC   — executeTool returns null → dispatched through MCP handler; returns
 *             real data via invokeForgeTool terminal-await (no stub error)
 *
 * MISSING entries (previously returned "Unknown tool:") were removed from
 * BASE_ALLOWLIST in Phase-37.1 Slice 2 and are no longer tested here.
 *
 * When server.mjs:executeTool is updated, update SIMULATED_MCP_CALL_TABLE below
 * to match (move the tool from MISSING to OK or ASYNC).
 */

import { describe, it, expect } from "vitest";
import { createHttpDispatcher } from "../src/http-dispatcher.mjs";
import { BASE_ALLOWLIST } from "../src/allowlist.mjs";

// ─── Simulated invokeForgeTool ────────────────────────────────────────────────
//
// Mirrors the executeTool() switch in pforge-mcp/server.mjs without running
// real CLI commands.  Regenerate from server.mjs whenever it is updated.

/**
 * Tools handled by executeTool via `return runPforge(...)`.
 * invokeForgeTool returns a non-null CLI-output object → no "Unknown tool:" error.
 */
const OK_TOOLS = new Set([
  "forge_status",
  "forge_diff",
  "forge_smith",
  "forge_sweep",
  "forge_validate",
  "forge_ext_search",
  "forge_ext_info",
  "forge_analyze", // non-quorum path; quorum path → null (ASYNC)
]);

/**
 * Tools where executeTool returns null — now dispatched through the MCP handler
 * via invokeForgeTool terminal-await.  invokeForgeTool returns the parsed JSON
 * result from the MCP handler → no "Unknown tool:" error.
 */
const ASYNC_TOOLS = new Set([
  "forge_plan_status",
  "forge_capabilities",
  "forge_cost_report",
  "forge_estimate_quorum",
  "forge_quorum_analyze",
  "forge_doctor_quorum",
  "forge_health_trend",
  "forge_watch",
  "forge_watch_live",
  "forge_alert_triage",
  "forge_memory_report",
  "forge_search",
  "forge_graph_query",
]);

/**
 * Simulate invokeForgeTool without spawning CLI processes or connecting to MCP.
 * OK   → { success: true }
 * ASYNC→ { success: true }   (terminal-await returns real handler data; success here)
 * else → { success: false, error: `Unknown tool: <name>` }  ← mirrors real default case
 */
async function simulatedMcpCall(toolName, _args = {}) {
  if (OK_TOOLS.has(toolName) || ASYNC_TOOLS.has(toolName)) {
    return { success: true };
  }
  // MISSING: executeTool hits the default case in the real server
  return { success: false, error: `Unknown tool: ${toolName}` };
}

// ─── Parity tests (parameterized) ───────────────────────────────────────────

const dispatch = createHttpDispatcher({
  allowlist: BASE_ALLOWLIST,
  mcpCall: simulatedMcpCall,
});

describe("http-dispatcher parity: every BASE_ALLOWLIST tool must not return 'Unknown tool:'", () => {
  for (const tool of BASE_ALLOWLIST) {
    it(`${tool} — no 'Unknown tool:' error`, async () => {
      const result = await dispatch(tool, {});
      // The dispatcher must not surface "Unknown tool:" — that indicates
      // the tool is absent from executeTool's switch in server.mjs.
      expect(result?.error ?? "").not.toMatch(/^Unknown tool:/);
    });
  }
});
