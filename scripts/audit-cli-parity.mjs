#!/usr/bin/env node
/**
 * Plan Forge — CLI-parity audit
 *
 * Phase TESTBED-01 Slice 02
 *
 * Compares MCP tool names (from TOOL_METADATA in capabilities.mjs) against
 * CLI commands routed in pforge.ps1 and pforge.sh. Reports matched tools,
 * MCP-only tools, and CLI-only commands.
 *
 * Mapping convention:
 *   forge_run_plan       → run-plan
 *   forge_smith          → smith
 *   forge_testbed_run    → testbed-run   (nested subcommands not audited — noted as mcpOnly)
 *   forge_capabilities   → (implicit — no CLI equivalent expected)
 *
 * Exit code: 0 always (informational audit — gaps are findings, not failures).
 *
 * Usage:
 *   node scripts/audit-cli-parity.mjs                       # human-readable
 *   node scripts/audit-cli-parity.mjs --json                # machine-readable JSON
 *   node scripts/audit-cli-parity.mjs --log-findings        # also write findings to defect log
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Known exceptions: MCP tools that intentionally have no CLI equivalent ───
const KNOWN_MCP_ONLY = new Set([
  "forge_capabilities",
  "forge_home_snapshot",
  "forge_plan_status",
  "forge_cost_report",
  "forge_watch",
  "forge_watch_live",
  "forge_liveguard_run",
  "forge_notify_send",
  "forge_notify_test",
  "forge_review_add",
  "forge_review_list",
  "forge_review_resolve",
  "forge_doctor_quorum",
  "forge_delegate_to_agent",
  "forge_testbed_run",
  "forge_testbed_findings",
  "forge_export_plan",
  "forge_sync_memories",
  "forge_timeline",
  "forge_search",
  "forge_self_update",
]);

/**
 * Convert an MCP tool name to its expected CLI command name.
 * forge_run_plan → run-plan, forge_secret_scan → secret-scan
 */
export function mcpToCli(toolName) {
  return toolName
    .replace(/^forge_/, "")
    .replace(/_/g, "-");
}

/**
 * Extract MCP tool names from TOOL_METADATA.
 */
export async function loadMcpToolNames() {
  const { TOOL_METADATA } = await import("../pforge-mcp/capabilities.mjs");
  return Object.keys(TOOL_METADATA);
}

/**
 * Extract CLI command names from pforge.ps1 switch/case dispatch.
 */
export function extractPsCommands(content) {
  const commands = new Set();
  // Match: 'command-name' { ... } patterns in the switch block
  const switchMatch = content.match(/switch\s*\(\$Command\)\s*\{([\s\S]*?)\n\}/);
  if (!switchMatch) return commands;
  const block = switchMatch[1];
  for (const m of block.matchAll(/'([a-z][-a-z0-9]*)'\s*\{/g)) {
    if (m[1] !== "help" && m[1] !== "--help" && m[1] !== "") commands.add(m[1]);
  }
  return commands;
}

/**
 * Extract CLI command names from pforge.sh case dispatch.
 */
export function extractShCommands(content) {
  const commands = new Set();
  // Match: command-name) cmd_xxx ... ;; patterns in the main case block
  const caseMatch = content.match(/case\s+"\$\w+"\s+in([\s\S]*?)esac\s*$/m);
  if (!caseMatch) return commands;
  const block = caseMatch[1];
  for (const m of block.matchAll(/^\s+([a-z][-a-z0-9]*)\)\s/gm)) {
    if (m[1] !== "help" && m[1] !== "--help" && m[1] !== "*") commands.add(m[1]);
  }
  return commands;
}

/**
 * Run the full CLI-parity audit.
 */
export async function audit({ projectRoot } = {}) {
  const root = projectRoot || ROOT;
  const mcpTools = await loadMcpToolNames();

  const psContent = readFileSync(resolve(root, "pforge.ps1"), "utf-8");
  const shContent = readFileSync(resolve(root, "pforge.sh"), "utf-8");

  const psCommands = extractPsCommands(psContent);
  const shCommands = extractShCommands(shContent);

  // Union of CLI commands from both shells
  const cliCommands = new Set([...psCommands, ...shCommands]);

  const matched = [];
  const mcpOnly = [];

  for (const tool of mcpTools) {
    const expected = mcpToCli(tool);
    if (cliCommands.has(expected)) {
      matched.push({ tool, cliCommand: expected });
      cliCommands.delete(expected);
    } else {
      mcpOnly.push({
        tool,
        expectedCli: expected,
        knownException: KNOWN_MCP_ONLY.has(tool),
      });
    }
  }

  const cliOnly = [...cliCommands].map(cmd => ({ cliCommand: cmd }));

  return {
    matched,
    mcpOnly,
    cliOnly,
    matchedCount: matched.length,
    totalMcp: mcpTools.length,
    totalCli: psCommands.size + shCommands.size,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const jsonFlag = process.argv.includes("--json");
  const result = await audit();

  if (jsonFlag) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("=== Plan Forge CLI-Parity Audit ===\n");
    console.log(`MCP tools: ${result.totalMcp}`);
    console.log(`CLI commands: ${result.totalCli} (PS + SH union)`);
    console.log(`Matched: ${result.matchedCount}\n`);

    if (result.mcpOnly.length) {
      console.log("MCP-only (no CLI equivalent):");
      for (const item of result.mcpOnly) {
        const tag = item.knownException ? " [known]" : "";
        console.log(`  - ${item.tool} → expected '${item.expectedCli}'${tag}`);
      }
      console.log();
    }

    if (result.cliOnly.length) {
      console.log("CLI-only (no MCP equivalent):");
      for (const item of result.cliOnly) {
        console.log(`  - ${item.cliCommand}`);
      }
      console.log();
    }

    const unexpectedGaps = result.mcpOnly.filter(i => !i.knownException);
    if (unexpectedGaps.length) {
      console.log(`⚠ ${unexpectedGaps.length} unexpected MCP-only gap(s) found.`);
    } else {
      console.log("✅ All unexpected gaps accounted for.");
    }
  }
}
