#!/usr/bin/env node
/**
 * Plan Forge MCP Server
 *
 * Exposes Plan Forge CLI operations as MCP tools so any agent with MCP support
 * (Copilot, Claude, Cursor, etc.) can invoke them as function calls.
 *
 * Architecture: Thin wrapper that shells out to existing pforge.ps1 / pforge.sh
 * commands. Zero business logic duplication — all logic stays in the CLI scripts.
 *
 * Usage:
 *   node mcp/server.mjs                        # stdio transport (default)
 *   node mcp/server.mjs --port 3100            # SSE transport
 *   node mcp/server.mjs --project /path/to/project
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

// ─── Config ───────────────────────────────────────────────────────────
const PROJECT_DIR = process.env.PLAN_FORGE_PROJECT || process.argv.find((a, i) => process.argv[i - 1] === "--project") || process.cwd();
const IS_WINDOWS = process.platform === "win32";
const PFORGE = IS_WINDOWS ? "powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1" : "bash pforge.sh";

// ─── Helpers ──────────────────────────────────────────────────────────
function runPforge(args, cwd = PROJECT_DIR) {
  const cmd = `${PFORGE} ${args}`;
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { success: true, output: output.trim() };
  } catch (err) {
    return {
      success: false,
      output: (err.stdout || "").trim(),
      error: (err.stderr || err.message || "").trim(),
      exitCode: err.status,
    };
  }
}

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, ".git"))) return dir;
    dir = resolve(dir, "..");
  }
  return startDir;
}

// ─── Tool Definitions ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: "forge_smith",
    description: "Inspect the forge — diagnose environment, VS Code config, setup health, version currency, and common problems. Returns structured results with pass/fail/warning counts.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_validate",
    description: "Validate Plan Forge setup — check that all required files exist, file counts match preset expectations, and no unresolved placeholders remain.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_sweep",
    description: "Run completeness sweep — scan code files for TODO, FIXME, HACK, stub, placeholder, and mock data markers. Returns locations of all deferred-work markers.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_status",
    description: "Show all phases from DEPLOYMENT-ROADMAP.md with their current status (planned, in-progress, complete, paused).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_diff",
    description: "Compare changed files against a plan's Scope Contract — detect drift, forbidden file edits, and unplanned changes.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_ext_search",
    description: "Search the Plan Forge community extension catalog. Returns matching extensions with names, descriptions, categories, and install commands.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword (optional — omit to list all)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_ext_info",
    description: "Show detailed information about a specific extension from the community catalog — author, version, category, provides, tags, and install command.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Extension name from the catalog" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["name"],
    },
  },
  {
    name: "forge_new_phase",
    description: "Create a new phase plan file and add it to the deployment roadmap. Returns the created file path and roadmap entry.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Phase name (e.g., 'user-auth', 'payment-gateway')" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["name"],
    },
  },
  {
    name: "forge_analyze",
    description: "Cross-artifact analysis — validates requirement traceability, test coverage, scope compliance, and validation gates. Returns a consistency score (0-100) with detailed breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
];

// ─── Tool Execution ───────────────────────────────────────────────────
function executeTool(name, args) {
  const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

  switch (name) {
    case "forge_smith":
      return runPforge("smith", cwd);
    case "forge_validate":
      return runPforge("check", cwd);
    case "forge_sweep":
      return runPforge("sweep", cwd);
    case "forge_status":
      return runPforge("status", cwd);
    case "forge_diff":
      return runPforge(`diff "${args.plan}"`, cwd);
    case "forge_ext_search":
      return runPforge(`ext search ${args.query || ""}`.trim(), cwd);
    case "forge_ext_info":
      return runPforge(`ext info "${args.name}"`, cwd);
    case "forge_new_phase":
      return runPforge(`new-phase "${args.name}"`, cwd);
    case "forge_analyze":
      return runPforge(`analyze "${args.plan}"`, cwd);
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────
const server = new Server(
  { name: "plan-forge-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const result = executeTool(name, args || {});

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? result.output
          : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}`,
      },
    ],
    isError: !result.success,
  };
});

// ─── Start ────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Plan Forge MCP server running (stdio transport)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
