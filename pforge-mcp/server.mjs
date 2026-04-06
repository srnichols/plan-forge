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
 *   node pforge-mcp/server.mjs                        # stdio transport (default)
 *   node pforge-mcp/server.mjs --port 3100            # SSE transport
 *   node pforge-mcp/server.mjs --project /path/to/project
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan, runPlan, detectWorkers, getCostReport, analyzeWithQuorum } from "./orchestrator.mjs";
import { createHub, readHubPort } from "./hub.mjs";
import { buildCapabilitySurface, writeToolsJson, writeCliSchema } from "./capabilities.mjs";
import { readRunIndex } from "./telemetry.mjs";
import { parseSkill, executeSkill } from "./skill-runner.mjs";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────
const PROJECT_DIR = process.env.PLAN_FORGE_PROJECT || process.argv.find((a, i) => process.argv[i - 1] === "--project") || process.cwd();
const HTTP_PORT = parseInt(process.env.PLAN_FORGE_HTTP_PORT || "3100", 10);
const IS_WINDOWS = process.platform === "win32";
const PFORGE = IS_WINDOWS ? "powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1" : "bash pforge.sh";

// ─── Orchestrator State ───────────────────────────────────────────────
let activeAbortController = null;
let activeRunPromise = null;
let activeHub = null; // Phase 3: WebSocket hub instance

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
    description: "Cross-artifact analysis — validates requirement traceability, test coverage, scope compliance, and validation gates. Returns a consistency score (0-100) with detailed breakdown. With quorum=true, dispatches to multiple AI models (including API providers like xAI Grok) for multi-model consensus analysis.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan or source file to analyze (e.g., docs/plans/Phase-1-AUTH-PLAN.md or src/services/billing.ts)" },
        quorum: { type: "boolean", description: "If true, dispatch analysis to multiple models and synthesize findings. Default: false" },
        mode: { type: "string", enum: ["plan", "file"], description: "Analysis mode: 'plan' (plan consistency) or 'file' (code review). Default: auto-detected from filename" },
        models: { type: "string", description: "Comma-separated model list override (e.g., 'grok-3-mini,claude-sonnet-4.6,gpt-5.3-codex'). Default: quorum config models" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_diagnose",
    description: "Multi-model bug investigation — dispatches independent bug analysis to multiple AI models (including API providers like xAI Grok), then synthesizes root cause analysis with fix recommendations. Each model examines code paths, failure modes, edge cases, and race conditions independently.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Path to the source file to investigate (e.g., src/services/billing.ts)" },
        models: { type: "string", description: "Comma-separated model list override (e.g., 'grok-3-mini,grok-4,claude-sonnet-4.6'). Default: quorum config models" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["file"],
    },
  },
  {
    name: "forge_run_plan",
    description: "Execute a hardened plan — spawn CLI workers for each slice, validate at every boundary, track tokens. Supports Full Auto (gh copilot CLI) and Assisted (human + automated gates) modes. Use --estimate for cost prediction without executing.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the hardened plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        mode: { type: "string", enum: ["auto", "assisted"], description: "Execution mode: 'auto' (CLI worker) or 'assisted' (human + gates). Default: auto" },
        model: { type: "string", description: "Model override (e.g., claude-sonnet-4.6, gpt-5.2-codex). Default: auto" },
        estimate: { type: "boolean", description: "If true, return cost estimate without executing" },
        resumeFrom: { type: "number", description: "Slice number to resume from (skips completed slices)" },
        dryRun: { type: "boolean", description: "If true, parse and validate plan without executing" },
        quorum: { type: "string", enum: ["false", "true", "auto"], description: "Quorum mode: 'false' (off), 'true' (all slices), 'auto' (threshold-based). Default: false" },
        quorumThreshold: { type: "number", description: "Override complexity threshold for auto quorum (1-10). Default: 7" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_abort",
    description: "Abort the currently running plan execution. The abort takes effect between slices — the current slice will finish first.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_plan_status",
    description: "Get the status of the latest plan execution run. Shows per-slice results, token usage, duration, and overall status from .forge/runs/.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Filter by plan name (optional — shows latest if omitted)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_cost_report",
    description: "Cost tracking report — shows total spend, per-model breakdown, and monthly aggregation from .forge/cost-history.json. Includes token counts and run history.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_capabilities",
    description: "Machine-readable API surface — returns all MCP tools with semantic metadata (intent, prerequisites, errors, cost), CLI commands, workflow graphs, config schema, dashboard info, and installed extensions. Agents call this once on session start for full discoverability.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_skill_status",
    description: "Get recent skill execution events from the WebSocket hub history. Shows which skills were run, per-step results, and timing.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "Filter by skill name (optional — shows all recent if omitted)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_run_skill",
    description: "Execute a skill programmatically — parse the SKILL.md, run steps with validation gates, emit events to the hub, return structured results. Use for automated skill execution with progress tracking.",
    inputSchema: {
      type: "object",
      properties: {
        skill: { type: "string", description: "Skill name (e.g., 'health-check', 'test-sweep') or path to SKILL.md" },
        args: { type: "string", description: "Arguments to pass to the skill (optional)" },
        dryRun: { type: "boolean", description: "If true, parse and validate skill without executing" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["skill"],
    },
  },
];
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
      if (args.quorum) return null; // Quorum analysis handled async
      return runPforge(`analyze "${args.plan}"`, cwd);
    case "forge_run_plan":
    case "forge_abort":
    case "forge_plan_status":
    case "forge_cost_report":
    case "forge_capabilities":
      return null; // Handled async in CallToolRequestSchema handler
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────
const server = new Server(
  { name: "plan-forge-mcp", version: "2.6.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ─── Async orchestrator tools ───
  if (name === "forge_run_plan") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const planPath = resolve(cwd, args.plan);

      if (!existsSync(planPath)) {
        return { content: [{ type: "text", text: `Plan file not found: ${args.plan}` }], isError: true };
      }

      activeAbortController = new AbortController();
      // Phase 3: If hub is running, use it as event handler for live broadcasting
      const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
      // Parse quorum parameter
      let quorum = false;
      if (args.quorum === "true" || args.quorum === true) quorum = true;
      else if (args.quorum === "auto") quorum = "auto";

      const result = await runPlan(planPath, {
        cwd,
        model: args.model || null,
        mode: args.mode || "auto",
        resumeFrom: args.resumeFrom != null ? Number(args.resumeFrom) : null,
        estimate: args.estimate || false,
        dryRun: args.dryRun || false,
        quorum,
        quorumThreshold: args.quorumThreshold != null ? Number(args.quorumThreshold) : null,
        abortController: activeAbortController,
        eventHandler,
      });
      activeAbortController = null;

      // C3: Safe status check with fallback
      const isError = !result || result.status === "failed" || (result.results?.failed > 0);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError,
      };
    } catch (err) {
      activeAbortController = null;
      return { content: [{ type: "text", text: `Orchestrator error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_abort") {
    if (activeAbortController) {
      activeAbortController.abort();
      return { content: [{ type: "text", text: "Abort signal sent. Current slice will finish, then execution stops." }] };
    }
    return { content: [{ type: "text", text: "No active plan execution to abort." }] };
  }

  if (name === "forge_plan_status") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const runsDir = resolve(cwd, ".forge", "runs");

      if (!existsSync(runsDir)) {
        return { content: [{ type: "text", text: "No runs found. Run `forge_run_plan` first." }] };
      }

      const runDirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();

      if (runDirs.length === 0) {
        return { content: [{ type: "text", text: "No runs found." }] };
      }

      // Find matching run (by plan name filter or latest)
      let targetDir = runDirs[0];
      if (args.plan) {
        const planName = args.plan.replace(/\.md$/, "").split("/").pop();
        // M1: Match plan name at end of directory name (after timestamp_) to avoid false positives
        const match = runDirs.find((d) => d.endsWith(`_${planName}`) || d.endsWith(`_${planName}/`));
        if (match) targetDir = match;
      }

      const summaryPath = resolve(runsDir, targetDir, "summary.json");
      if (existsSync(summaryPath)) {
        const summary = readFileSync(summaryPath, "utf-8");
        return { content: [{ type: "text", text: summary }] };
      }

      // No summary yet — check run.json for in-progress
      const runPath = resolve(runsDir, targetDir, "run.json");
      if (existsSync(runPath)) {
        const runMeta = readFileSync(runPath, "utf-8");
        return { content: [{ type: "text", text: `Run in progress:\n${runMeta}` }] };
      }

      return { content: [{ type: "text", text: `Run directory exists but no data: ${targetDir}` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Status error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_cost_report") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const report = getCostReport(cwd);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Cost report error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_analyze" && args.quorum) {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const mode = args.mode || (args.plan.match(/plan/i) ? "plan" : "file");
      const models = args.models ? args.models.split(",").map((m) => m.trim()) : null;

      const result = await analyzeWithQuorum({
        target: args.plan,
        mode,
        models,
        cwd,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Quorum analysis error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_diagnose") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const models = args.models ? args.models.split(",").map((m) => m.trim()) : null;

      const result = await analyzeWithQuorum({
        target: args.file,
        mode: "diagnose",
        models,
        cwd,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Diagnosis error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_capabilities") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const surface = buildCapabilitySurface(TOOLS, { cwd, hubPort: activeHub?.port || null });
      return { content: [{ type: "text", text: JSON.stringify(surface, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Capabilities error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_skill_status") {
    try {
      if (!activeHub) {
        return { content: [{ type: "text", text: "Hub not running. Start the MCP server with --port to enable skill event tracking." }] };
      }
      const history = activeHub.getHistory();
      let skillEvents = history.filter((e) => e.type?.startsWith("skill-"));
      if (args.skillName) {
        skillEvents = skillEvents.filter((e) => e.skillName === args.skillName || e.data?.skillName === args.skillName);
      }
      if (skillEvents.length === 0) {
        return { content: [{ type: "text", text: "No skill execution events found. Run a skill via forge_run_skill first." }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(skillEvents, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Skill status error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_run_skill") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

      // Resolve skill path — accept name or full path
      let skillPath = args.skill;
      if (!skillPath.endsWith(".md")) {
        // Try well-known locations
        const candidates = [
          join(cwd, ".github", "skills", skillPath, "SKILL.md"),
          join(cwd, "presets", "shared", "skills", skillPath, "SKILL.md"),
        ];
        skillPath = candidates.find((p) => existsSync(p));
        if (!skillPath) {
          return { content: [{ type: "text", text: `Skill not found: ${args.skill}. Looked in .github/skills/${args.skill}/SKILL.md` }], isError: true };
        }
      } else {
        skillPath = resolve(cwd, skillPath);
      }

      if (!existsSync(skillPath)) {
        return { content: [{ type: "text", text: `Skill file not found: ${skillPath}` }], isError: true };
      }

      const skill = parseSkill(skillPath);

      // Dry run — return parsed structure without executing
      if (args.dryRun) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "dry-run",
              skillName: skill.meta.name,
              description: skill.meta.description,
              tools: skill.meta.tools,
              stepCount: skill.stepCount,
              steps: skill.steps.map((s) => ({ number: s.number, name: s.name, hasConditional: !!s.conditional })),
              safetyRules: skill.safetyRules,
            }, null, 2),
          }],
        };
      }

      // Execute with hub event broadcasting
      const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
      const result = await executeSkill(skill, { cwd, eventHandler });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.status === "failed",
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Skill execution error: ${err.message}` }], isError: true };
    }
  }

  // ─── Sync pforge tools ───
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

// ─── Express App + REST API (Phase 4, C6) ─────────────────────────────
function createExpressApp() {
  const app = express();
  app.use(express.json());

  // Dashboard static files
  app.use("/dashboard", express.static(resolve(__dirname, "dashboard")));

  // REST API: GET /api/status — current run status
  app.get("/api/status", (_req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.json({ status: "idle", message: "No runs yet" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      if (dirs.length === 0) return res.json({ status: "idle" });
      const summaryPath = resolve(runsDir, dirs[0], "summary.json");
      if (existsSync(summaryPath)) {
        return res.json(JSON.parse(readFileSync(summaryPath, "utf-8")));
      }
      const runPath = resolve(runsDir, dirs[0], "run.json");
      if (existsSync(runPath)) {
        return res.json({ status: "running", ...JSON.parse(readFileSync(runPath, "utf-8")) });
      }
      res.json({ status: "unknown" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/runs — run history
  app.get("/api/runs", (_req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.json([]);
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      const runs = [];
      for (const dir of dirs.slice(0, 50)) { // Limit to 50
        const summaryPath = resolve(runsDir, dir, "summary.json");
        if (existsSync(summaryPath)) {
          try { runs.push(JSON.parse(readFileSync(summaryPath, "utf-8"))); } catch { /* skip corrupt */ }
        }
      }
      res.json(runs);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/config — read .forge.json
  app.get("/api/config", (_req, res) => {
    try {
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      if (!existsSync(configPath)) return res.json({});
      res.json(JSON.parse(readFileSync(configPath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/config — write .forge.json (with validation)
  app.post("/api/config", (req, res) => {
    try {
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object" });
      }
      // Validate required fields
      const config = req.body;
      if (config.preset && typeof config.preset !== "string") {
        return res.status(400).json({ error: "preset must be a string" });
      }
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/cost — cost report
  app.get("/api/cost", (_req, res) => {
    try {
      res.json(getCostReport(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/tool/:name — invoke forge tool (proxy to pforge CLI)
  app.post("/api/tool/:name", (req, res) => {
    try {
      const toolName = req.params.name;
      const toolArgs = req.body?.args || "";
      const result = runPforge(`${toolName} ${toolArgs}`.trim(), PROJECT_DIR);
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/hub — hub status
  app.get("/api/hub", (_req, res) => {
    if (activeHub) {
      res.json({ running: true, port: activeHub.port, clients: activeHub.getClients() });
    } else {
      res.json({ running: false });
    }
  });

  // REST API: GET /api/replay/:runIdx/:sliceId — session replay log (Phase 5)
  app.get("/api/replay/:runIdx/:sliceId", (req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.status(404).json({ error: "No runs" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      const runIdx = parseInt(req.params.runIdx, 10);
      if (runIdx < 0 || runIdx >= dirs.length) return res.status(404).json({ error: "Run not found" });
      const logPath = resolve(runsDir, dirs[runIdx], `slice-${req.params.sliceId}-log.txt`);
      if (!existsSync(logPath)) return res.status(404).json({ error: "Log not found" });
      res.json({ log: readFileSync(logPath, "utf-8") });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v2.4: GET /api/traces — list all runs from index.jsonl
  app.get("/api/traces", (_req, res) => {
    try {
      const entries = readRunIndex(PROJECT_DIR);
      res.json(entries.reverse()); // Newest first
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v2.4: GET /api/traces/:runId — single run trace detail
  app.get("/api/traces/:runId", (req, res) => {
    try {
      const runDir = resolve(PROJECT_DIR, ".forge", "runs", req.params.runId);
      if (!existsSync(runDir)) return res.status(404).json({ error: "Run not found" });
      // Try trace.json first, fall back to manifest, then summary
      const tracePath = resolve(runDir, "trace.json");
      if (existsSync(tracePath)) return res.json(JSON.parse(readFileSync(tracePath, "utf-8")));
      const manifestPath = resolve(runDir, "manifest.json");
      if (existsSync(manifestPath)) return res.json(JSON.parse(readFileSync(manifestPath, "utf-8")));
      const summaryPath = resolve(runDir, "summary.json");
      if (existsSync(summaryPath)) return res.json(JSON.parse(readFileSync(summaryPath, "utf-8")));
      res.status(404).json({ error: "No trace data" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v2.3: .well-known discovery endpoint
  app.get("/.well-known/plan-forge.json", (_req, res) => {
    try {
      const surface = buildCapabilitySurface(TOOLS, { cwd: PROJECT_DIR, hubPort: activeHub?.port || null });
      res.json(surface);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v2.3: Capabilities API
  app.get("/api/capabilities", (_req, res) => {
    try {
      const surface = buildCapabilitySurface(TOOLS, { cwd: PROJECT_DIR, hubPort: activeHub?.port || null });
      res.json(surface);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // v2.6: Extensions catalog API (structured JSON)
  app.get("/api/extensions", (_req, res) => {
    try {
      const catalogPath = join(PROJECT_DIR, "extensions", "catalog.json");
      if (existsSync(catalogPath)) {
        const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));
        const extensions = catalog.extensions || {};
        res.json(Object.values(extensions));
      } else {
        res.json([]);
      }
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  return app;
}

// ─── Start ────────────────────────────────────────────────────────────
const DASHBOARD_ONLY = process.argv.includes("--dashboard-only") || process.argv.includes("--dashboard");

async function main() {
  // MCP stdio transport (skip in dashboard-only mode)
  if (!DASHBOARD_ONLY) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Plan Forge MCP server running (stdio transport)");
  } else {
    console.error("Plan Forge Dashboard-only mode (no MCP stdio)");
  }

  // v2.3: Auto-generate tools.json + cli-schema.json on startup
  try {
    writeToolsJson(TOOLS, __dirname);
    writeCliSchema(__dirname);
    console.error("[capabilities] tools.json + cli-schema.json generated");
  } catch (err) {
    console.error(`[capabilities] Auto-generation failed: ${err.message} (non-fatal)`);
  }

  // Phase 4: Start Express HTTP server for dashboard + REST API
  try {
    const app = createExpressApp();
    app.listen(HTTP_PORT, "127.0.0.1", () => {
      console.error(`Plan Forge Dashboard at http://127.0.0.1:${HTTP_PORT}/dashboard`);
    });
  } catch (err) {
    console.error(`[http] Express server failed to start: ${err.message} (non-fatal)`);
  }

  // Phase 3: Start WebSocket hub alongside MCP server
  try {
    activeHub = await createHub({ cwd: PROJECT_DIR });
    console.error(`Plan Forge WebSocket hub running on port ${activeHub.port}`);
  } catch (err) {
    console.error(`[hub] WebSocket hub failed to start: ${err.message} (non-fatal)`);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    if (activeHub) activeHub.close();
  });
  process.on("SIGINT", () => {
    if (activeHub) activeHub.close();
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
