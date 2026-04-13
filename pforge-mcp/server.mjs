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
import { existsSync, readdirSync, readFileSync, writeFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan, runPlan, detectWorkers, getCostReport, analyzeWithQuorum, generateImage } from "./orchestrator.mjs";
import { isOpenBrainConfigured } from "./memory.mjs";
import { createHub, readHubPort } from "./hub.mjs";
import { createBridge } from "./bridge.mjs";
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
let activeHub = null;    // WebSocket hub instance
let activeBridge = null; // OpenClaw Bridge instance
let activeEventWatcher = null; // events.log file watcher

// Set of runIds that have already received an approval decision (rate-limit: 1 per runId)
const _approvedRunIds = new Set();

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Event File Watcher — tails events.log from the latest run dir and broadcasts
 * new events to the WebSocket hub. This bridges the orchestrator (standalone CLI
 * process writing to files) with the dashboard (WebSocket client).
 *
 * On startup: finds the latest run, reads ALL events from it (so the hub history
 * buffer has them for late-connecting dashboard clients).
 * On new run: detects the new events.log, replays it from the start, detaches
 * the old file watcher.
 */
function startEventFileWatcher(hub, cwd) {
  const runsDir = resolve(cwd, ".forge", "runs");
  let currentLogFile = null;
  let fileOffset = 0;
  let scanInterval = null;

  function findLatestEventsLog() {
    if (!existsSync(runsDir)) return null;
    const dirs = readdirSync(runsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
    for (const dir of dirs) {
      const logPath = resolve(runsDir, dir, "events.log");
      if (existsSync(logPath)) return logPath;
    }
    return null;
  }

  function processNewLines(logPath) {
    try {
      const stat = statSync(logPath);
      if (stat.size <= fileOffset) return;
      const fd = openSync(logPath, "r");
      const buf = Buffer.alloc(stat.size - fileOffset);
      readSync(fd, buf, 0, buf.length, fileOffset);
      closeSync(fd);
      fileOffset = stat.size;

      const lines = buf.toString("utf-8").split("\n").filter(l => l.trim());
      for (const line of lines) {
        const match = line.match(/^\[([^\]]+)\]\s+(\S+):\s+(.*)$/);
        if (!match) continue;
        try {
          const [, timestamp, type, jsonStr] = match;
          const data = JSON.parse(jsonStr);
          hub.broadcast({ type, data, timestamp, source: "file-watcher" });
        } catch {
          // Skip malformed event lines
        }
      }
    } catch {
      // File may be temporarily locked by the orchestrator
    }
  }

  function detachWatcher() {
    if (currentLogFile) {
      try { unwatchFile(currentLogFile); } catch { /* ignore */ }
    }
  }

  function attachWatcher(logPath) {
    try {
      watchFile(logPath, { interval: 1000 }, () => {
        processNewLines(logPath);
      });
    } catch {
      // watchFile not supported — polling covers it
    }
  }

  // Poll every 2 seconds: check for latest events.log and process new lines
  scanInterval = setInterval(() => {
    const logPath = findLatestEventsLog();
    if (!logPath) return;

    if (logPath !== currentLogFile) {
      // New or different run — detach old watcher, reset offset, replay from start
      detachWatcher();
      currentLogFile = logPath;
      fileOffset = 0;
      attachWatcher(logPath);
      console.error(`[event-watcher] Tracking new run: ${logPath}`);
    }

    processNewLines(logPath);
  }, 2000);

  // Initial scan — replay ALL events from the latest run so hub has history
  const initial = findLatestEventsLog();
  if (initial) {
    currentLogFile = initial;
    fileOffset = 0; // Start from beginning — replay full history into hub
    processNewLines(initial);
    attachWatcher(initial);
    console.error(`[event-watcher] Loaded ${initial} (replayed into hub history)`);
  }

  return {
    stop() {
      if (scanInterval) clearInterval(scanInterval);
      detachWatcher();
    },
  };
}

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

// ─── Org Rules Consolidation ──────────────────────────────────────────
function callOrgRules({ format = "github", output: outputFile = null } = {}, cwd = PROJECT_DIR) {
  const instrDir = join(cwd, ".github", "instructions");
  const copilotFile = join(cwd, ".github", "copilot-instructions.md");
  const principlesFile = join(cwd, "PROJECT-PRINCIPLES.md");

  const instrFiles = existsSync(instrDir)
    ? readdirSync(instrDir).filter((f) => f.endsWith(".instructions.md")).sort().map((f) => join(instrDir, f))
    : [];

  let repoName = basename(cwd);
  try {
    const gitRemote = execSync("git remote get-url origin 2>/dev/null || true", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
    if (gitRemote) repoName = gitRemote.split("/").pop().replace(/\.git$/, "");
  } catch { /* keep folder name */ }

  const versionFile = join(cwd, "VERSION");
  const version = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : "2.14.0";

  function stripFrontmatter(raw) {
    const stripped = raw.replace(/^---[\s\S]*?---\s*/m, "").trim();
    const titleMatch = stripped.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : null;
    const body = stripped.replace(/^#\s+.+\n?/m, "").trim();
    return { title, body };
  }

  const SECTION_PATTERNS = [
    { section: "Architecture Principles", pattern: /architect|design|layer|separation/i },
    { section: "Git Workflow",            pattern: /git|commit|branch|workflow/i },
    { section: "Security Rules",          pattern: /security|auth|secret|permission/i },
    { section: "Testing Requirements",    pattern: /test|spec|coverage/i },
    { section: "Coding Standards",        pattern: /./ },
  ];

  function categorise(filePath) {
    const name = basename(filePath);
    for (const { section, pattern } of SECTION_PATTERNS) {
      if (pattern.test(name)) return section;
    }
    return "Coding Standards";
  }

  const grouped = {};
  for (const f of instrFiles) {
    const sec = categorise(f);
    if (!grouped[sec]) grouped[sec] = [];
    grouped[sec].push(f);
  }

  const sections = [];
  const sectionOrder = ["Architecture Principles", "Coding Standards", "Git Workflow", "Security Rules", "Testing Requirements"];
  for (const sec of sectionOrder) {
    if (!grouped[sec]?.length) continue;
    const entries = grouped[sec].map((f) => {
      const raw = readFileSync(f, "utf-8");
      const { title, body } = stripFrontmatter(raw);
      return { file: basename(f), title: title || basename(f).replace(/\.instructions\.md$/, ""), body };
    });
    sections.push({ section: sec, entries });
  }

  if (existsSync(copilotFile)) {
    const raw = readFileSync(copilotFile, "utf-8");
    const { title, body } = stripFrontmatter(raw);
    sections.push({ section: "Project Context", entries: [{ file: "copilot-instructions.md", title: title || "Project Context", body }] });
  }

  if (existsSync(principlesFile)) {
    const raw = readFileSync(principlesFile, "utf-8");
    const { title, body } = stripFrontmatter(raw);
    sections.push({ section: "Project Principles", entries: [{ file: "PROJECT-PRINCIPLES.md", title: title || "Project Principles", body }] });
  }

  const header = `# Generated by Plan Forge v${version} from repo: ${repoName}`;
  const timestamp = `# Generated: ${new Date().toISOString()}`;

  let output;
  if (format === "json") {
    output = JSON.stringify({ repo: repoName, version, generated: new Date().toISOString(), sections }, null, 2);
  } else if (format === "markdown") {
    const parts = [header, timestamp, ""];
    for (const { section, entries } of sections) {
      parts.push(`## ${section}`, "");
      for (const { title, body } of entries) {
        parts.push(`### ${title}`, "", body, "");
      }
    }
    output = parts.join("\n").trimEnd();
  } else {
    // github format — plain text for GitHub org custom instructions
    const parts = [header, timestamp, ""];
    for (const { section, entries } of sections) {
      parts.push(`=== ${section} ===`, "");
      for (const { body } of entries) {
        parts.push(body, "");
      }
    }
    output = parts.join("\n").trimEnd();
  }

  if (outputFile) {
    const outPath = resolve(cwd, outputFile);
    writeFileSync(outPath, output, "utf-8");
    return `Org rules exported to: ${outPath}\n\n${output}`;
  }

  return output;
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
        quorum: { type: "string", enum: ["false", "true", "auto", "power", "speed"], description: "Quorum mode: 'false' (off), 'true' (all slices), 'auto' (threshold-based), 'power' (flagship models: Opus + GPT-5.3 + Grok 4.20), 'speed' (fast models: Sonnet + GPT-5.4-mini + Grok 4.1-fast). Default: auto" },
        quorumThreshold: { type: "number", description: "Override complexity threshold for auto quorum (1-10). Default: 6" },
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
    description: "Cost tracking report — shows total spend, per-model breakdown, and monthly aggregation from .forge/cost-history.json. Includes token counts, run history, and forge_model_stats (success rate per model from model-performance.json).",
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
  {
    name: "forge_org_rules",
    description: "Export org custom instructions — consolidate .github/instructions/*.instructions.md files into a single block for GitHub org-level Copilot custom instructions (Layer 1 of the two-layer model). Strips per-file frontmatter since org instructions apply universally. USE FOR: export org rules, generate org-level Copilot instructions, consolidate coding standards, org governance, GitHub org custom instructions.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        format: { type: "string", description: "Output format: github (default, plain text for org settings), markdown (formatted with headers), or json (structured)", enum: ["github", "markdown", "json"] },
        output: { type: "string", description: "File path to write output relative to project dir (optional — returns content if omitted)" },
      },
    },
  },
  {
    name: "forge_generate_image",
    description: "Generate an image using AI image models (xAI Grok Aurora or OpenAI DALL-E). Provide a text description and get a generated image saved to disk. Supports format conversion — request WebP, PNG, AVIF, or JPEG regardless of what the API returns. Useful for creating logos, diagrams, UI mockups, icons, and illustrations during plan execution. Requires XAI_API_KEY (Grok) or OPENAI_API_KEY (DALL-E).",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed text description of the image to generate. Be specific about style, colors, composition, and content." },
        outputPath: { type: "string", description: "File path to save the image (relative to project dir). The file extension determines the output format — e.g., 'assets/logo.webp' converts to WebP, 'docs/hero.png' converts to PNG." },
        model: { type: "string", description: "Image model to use. Default: grok-imagine-image", enum: ["grok-imagine-image", "grok-imagine-image-pro", "dall-e-3", "dall-e-4", "gpt-image-1"] },
        size: { type: "string", description: "Image dimensions. Default: 1024x1024", enum: ["1024x1024", "1024x768", "768x1024"] },
        format: { type: "string", description: "Output format override (if different from file extension). Default: inferred from outputPath extension.", enum: ["jpg", "png", "webp", "avif"] },
        quality: { type: "number", description: "Encoding quality 1-100. Default: 85. Lower = smaller file, less detail.", minimum: 1, maximum: 100 },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["prompt", "outputPath"],
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
    case "forge_org_rules":
      return null; // Handled async in CallToolRequestSchema handler
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
  { name: "plan-forge-mcp", version: "2.9.0" },
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
      // If hub is running, use it as event handler for live broadcasting
      const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
      // Parse quorum parameter — default: "auto" (threshold-based)
      let quorum = "auto";
      let quorumPreset = null;
      if (args.quorum === "power") { quorum = true; quorumPreset = "power"; }
      else if (args.quorum === "speed") { quorum = true; quorumPreset = "speed"; }
      else if (args.quorum === "true" || args.quorum === true) quorum = true;
      else if (args.quorum === "false" || args.quorum === false) quorum = false;
      else if (args.quorum === "auto" || args.quorum === undefined) quorum = "auto";

      const result = await runPlan(planPath, {
        cwd,
        model: args.model || null,
        mode: args.mode || "auto",
        resumeFrom: args.resumeFrom != null ? Number(args.resumeFrom) : null,
        estimate: args.estimate || false,
        dryRun: args.dryRun || false,
        quorum,
        quorumPreset,
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

  if (name === "forge_org_rules") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = callOrgRules({ format: args.format || "github", output: args.output || null }, cwd);
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Org rules error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_generate_image") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = await generateImage(args.prompt, {
        model: args.model || "grok-imagine-image",
        size: args.size || "1024x1024",
        format: args.format,
        quality: args.quality,
        outputPath: args.outputPath,
        cwd,
      });

      if (result.success) {
        const payload = {
          status: "generated",
          localPath: result.localPath,
          mimeType: result.mimeType,
          originalFormat: result.originalFormat,
          converted: result.converted,
          model: result.model,
          revisedPrompt: result.revisedPrompt,
        };
        if (result.extensionCorrected) {
          payload.extensionWarning = `File extension was corrected from '${result.requestedPath}' to '${result.localPath}' — conversion to requested format was not possible (${result.warning || "sharp not installed"}).`;
        }
        if (result.warning) {
          payload.warning = result.warning;
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(payload, null, 2),
          }],
        };
      }
      return { content: [{ type: "text", text: `Image generation failed: ${result.error}` }], isError: true };
    } catch (err) {
      return { content: [{ type: "text", text: `Image generation error: ${err.message}` }], isError: true };
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

// ─── Express App + REST API  ─────────────────────────────
function createExpressApp() {
  const app = express();
  app.use(express.json());

  // Dashboard static files
  app.use("/dashboard", express.static(resolve(__dirname, "dashboard")));

  // Plan Browser static files
  app.use("/ui", express.static(resolve(__dirname, "ui")));

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

  // REST API: POST /api/tool/org-rules — export org custom instructions
  app.post("/api/tool/org-rules", (req, res) => {
    try {
      const format = req.body?.format || "github";
      const outputFile = req.body?.output || null;
      const result = callOrgRules({ format, output: outputFile }, PROJECT_DIR);
      if (outputFile) {
        res.json({ success: true, output: result });
      } else {
        res.type("text/plain").send(result);
      }
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

  // REST API: GET /api/replay/:runIdx/:sliceId — session replay log 
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

  // GET /api/traces — list all runs from index.jsonl
  app.get("/api/traces", (_req, res) => {
    try {
      const entries = readRunIndex(PROJECT_DIR);
      res.json(entries.reverse()); // Newest first
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/runs/latest — most recent run summary + current slice status
  app.get("/api/runs/latest", (_req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.status(404).json({ error: "No runs yet" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      if (dirs.length === 0) return res.status(404).json({ error: "No runs yet" });
      const runDir = resolve(runsDir, dirs[0]);
      const summaryPath = resolve(runDir, "summary.json");
      const runPath = resolve(runDir, "run.json");
      let base = {};
      if (existsSync(summaryPath)) {
        base = JSON.parse(readFileSync(summaryPath, "utf-8"));
      } else if (existsSync(runPath)) {
        base = { status: "running", ...JSON.parse(readFileSync(runPath, "utf-8")) };
      } else {
        base = { status: "unknown" };
      }
      // Attach current slice status from the most recent slice-N.json
      const sliceFiles = existsSync(runDir)
        ? readdirSync(runDir).filter((f) => /^slice-\d+\.json$/.test(f)).sort((a, b) => {
            const na = parseInt(a.match(/\d+/)[0], 10), nb = parseInt(b.match(/\d+/)[0], 10);
            return nb - na; // descending — latest slice first
          })
        : [];
      if (sliceFiles.length > 0) {
        try {
          const latestSlice = JSON.parse(readFileSync(resolve(runDir, sliceFiles[0]), "utf-8"));
          base.currentSlice = latestSlice;
        } catch { /* skip corrupt slice */ }
      }
      res.json(base);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/runs/:runIdx — single run detail with slice data
  app.get("/api/runs/:runIdx", (req, res) => {
    try {
      const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
      if (!existsSync(runsDir)) return res.status(404).json({ error: "No runs" });
      const dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse();
      const idx = parseInt(req.params.runIdx, 10);
      if (isNaN(idx) || idx < 0 || idx >= dirs.length) return res.status(404).json({ error: "Run not found" });
      const runDir = resolve(runsDir, dirs[idx]);
      const summaryPath = resolve(runDir, "summary.json");
      if (!existsSync(summaryPath)) return res.status(404).json({ error: "No summary" });
      const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
      // Load per-slice detail files
      const slices = [];
      const sliceFiles = readdirSync(runDir).filter((f) => /^slice-\d+\.json$/.test(f)).sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0], 10), nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb;
      });
      for (const sf of sliceFiles) {
        try { slices.push(JSON.parse(readFileSync(resolve(runDir, sf), "utf-8"))); } catch { /* skip */ }
      }
      res.json({ summary, slices });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/skills — available slash command skills
  app.get("/api/skills", (_req, res) => {
    try {
      const skills = [];
      // Check .github/skills/
      const skillsDir = resolve(PROJECT_DIR, ".github", "skills");
      if (existsSync(skillsDir)) {
        for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const skillMd = resolve(skillsDir, entry.name, "SKILL.md");
            if (existsSync(skillMd)) {
              try {
                const content = readFileSync(skillMd, "utf-8");
                const titleMatch = content.match(/^#\s+(.+)/m);
                const descMatch = content.match(/^(?!#)(.{10,})/m);
                skills.push({ name: entry.name, description: descMatch?.[1]?.trim() || "", file: `.github/skills/${entry.name}/SKILL.md` });
              } catch { /* skip */ }
            }
          }
        }
      }
      // Built-in forge skills
      const builtins = [
        { name: "code-review", description: "Comprehensive review: architecture, security, testing, patterns", file: "built-in" },
        { name: "test-sweep", description: "Run all test suites and aggregate results", file: "built-in" },
        { name: "staging-deploy", description: "Build, push, migrate, deploy, and verify on staging", file: "built-in" },
        { name: "dependency-audit", description: "Scan dependencies for vulnerabilities and outdated packages", file: "built-in" },
        { name: "release-notes", description: "Generate release notes from git history and CHANGELOG", file: "built-in" },
        { name: "health-check", description: "Forge diagnostic: smith → validate → sweep", file: "built-in" },
        { name: "forge-execute", description: "Guided plan execution: list plans → estimate cost → execute", file: "built-in" },
      ];
      res.json([...skills, ...builtins]);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/traces/:runId — single run trace detail (v2.8: includes quorum data)
  app.get("/api/traces/:runId", (req, res) => {
    try {
      const runDir = resolve(PROJECT_DIR, ".forge", "runs", req.params.runId);
      if (!existsSync(runDir)) return res.status(404).json({ error: "Run not found" });
      let traceResult = null;
      // Try trace.json first, fall back to manifest, then summary
      const tracePath = resolve(runDir, "trace.json");
      if (existsSync(tracePath)) traceResult = JSON.parse(readFileSync(tracePath, "utf-8"));
      if (!traceResult) {
        const manifestPath = resolve(runDir, "manifest.json");
        if (existsSync(manifestPath)) traceResult = JSON.parse(readFileSync(manifestPath, "utf-8"));
      }
      if (!traceResult) {
        const summaryPath = resolve(runDir, "summary.json");
        if (existsSync(summaryPath)) traceResult = JSON.parse(readFileSync(summaryPath, "utf-8"));
      }
      if (!traceResult) return res.status(404).json({ error: "No trace data" });

      // Attach quorum data from slice-N-quorum.json files
      const quorumFiles = readdirSync(runDir).filter((f) => /^slice-\d+-quorum\.json$/.test(f)).sort();
      if (quorumFiles.length > 0) {
        traceResult.quorum = {};
        for (const qf of quorumFiles) {
          const sliceNum = qf.match(/slice-(\d+)-quorum/)[1];
          try { traceResult.quorum[sliceNum] = JSON.parse(readFileSync(resolve(runDir, qf), "utf-8")); } catch { /* skip */ }
        }
      }
      res.json(traceResult);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // .well-known discovery endpoint
  app.get("/.well-known/plan-forge.json", (_req, res) => {
    try {
      const surface = buildCapabilitySurface(TOOLS, { cwd: PROJECT_DIR, hubPort: activeHub?.port || null });
      res.json(surface);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Capabilities API
  app.get("/api/capabilities", (_req, res) => {
    try {
      const surface = buildCapabilitySurface(TOOLS, { cwd: PROJECT_DIR, hubPort: activeHub?.port || null });
      res.json(surface);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Extensions catalog API (structured JSON)
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

  // Plans list API — parsed plan metadata for dashboard browser
  app.get("/api/plans", (_req, res) => {
    try {
      const plansDir = resolve(PROJECT_DIR, "docs", "plans");
      if (!existsSync(plansDir)) return res.json([]);
      const files = readdirSync(plansDir)
        .filter((f) => /^Phase-.*-PLAN\.md$/i.test(f))
        .sort();
      const plans = [];
      for (const file of files) {
        try {
          const parsed = parsePlan(resolve(plansDir, file));
          plans.push({
            file: `docs/plans/${file}`,
            title: parsed.meta.title || file,
            status: parsed.meta.status || "Unknown",
            sliceCount: parsed.slices.length,
            branch: parsed.meta.branch || null,
            scopeContract: parsed.scopeContract || null,
            slices: parsed.slices.map((s) => ({
              id: s.id || s.number,
              title: s.title || s.name || `Slice ${s.number}`,
              tasks: s.tasks || [],
              buildCommand: s.buildCommand || null,
              testCommand: s.testCommand || null,
              parallel: s.parallel || false,
              depends: s.depends || [],
              scope: s.scope || [],
            })),
          });
        } catch { /* skip malformed plans */ }
      }
      res.json(plans);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // OpenBrain memory status API
  app.get("/api/memory", (_req, res) => {
    try {
      const configured = isOpenBrainConfigured(PROJECT_DIR);
      const result = { configured, endpoint: null, serverName: null };
      if (configured) {
        // Extract endpoint from mcp.json
        for (const configFile of [".vscode/mcp.json", ".claude/mcp.json"]) {
          const configPath = join(PROJECT_DIR, configFile);
          if (existsSync(configPath)) {
            try {
              const config = JSON.parse(readFileSync(configPath, "utf-8"));
              const servers = config.servers || config.mcpServers || {};
              for (const [name, server] of Object.entries(servers)) {
                const serverStr = JSON.stringify(server).toLowerCase();
                if (serverStr.includes("openbrain") || serverStr.includes("open-brain")) {
                  result.serverName = name;
                  result.endpoint = server.url || server.command || null;
                  break;
                }
              }
            } catch { /* ignore parse errors */ }
          }
          if (result.endpoint) break;
        }
      }
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // OpenBrain memory search API
  app.post("/api/memory/search", (req, res) => {
    try {
      if (!isOpenBrainConfigured(PROJECT_DIR)) {
        return res.json({ configured: false, results: [], note: "OpenBrain not configured. Add openbrain MCP server to enable project memory." });
      }
      const query = req.body?.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query is required" });
      }
      // Search local .forge memory files for relevant content
      const results = [];
      const forgeDir = resolve(PROJECT_DIR, ".forge");
      const searchDirs = [forgeDir, resolve(PROJECT_DIR, "docs", "plans")];
      const searchPattern = query.toLowerCase();
      for (const dir of searchDirs) {
        if (!existsSync(dir)) continue;
        try {
          const files = readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".md"));
          for (const file of files.slice(0, 20)) {
            try {
              const content = readFileSync(resolve(dir, file), "utf-8");
              if (content.toLowerCase().includes(searchPattern)) {
                const lines = content.split("\n");
                const matchLine = lines.findIndex((l) => l.toLowerCase().includes(searchPattern));
                const excerpt = lines.slice(Math.max(0, matchLine - 1), matchLine + 3).join("\n").substring(0, 200);
                results.push({ file: `${dir === forgeDir ? ".forge" : "docs/plans"}/${file}`, excerpt, line: matchLine + 1 });
              }
            } catch { /* skip unreadable */ }
          }
        } catch { /* skip missing dir */ }
      }
      res.json({ configured: true, results, note: results.length === 0 ? "No matches found. Try broader terms or check preset suggestions." : null });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Memory search presets API
  app.get("/api/memory/presets", (_req, res) => {
    try {
      // Build context-aware presets from project config
      let projectName = "Plan Forge";
      let preset = "";
      const configPath = resolve(PROJECT_DIR, ".forge.json");
      if (existsSync(configPath)) {
        try {
          const config = JSON.parse(readFileSync(configPath, "utf-8"));
          projectName = config.projectName || projectName;
          preset = config.preset || "";
        } catch { /* ignore */ }
      }
      // Check what data exists to suggest relevant searches
      const hasRuns = existsSync(resolve(PROJECT_DIR, ".forge", "runs"));
      const hasCost = existsSync(resolve(PROJECT_DIR, ".forge", "cost-history.json"));
      const hasPlans = existsSync(resolve(PROJECT_DIR, "docs", "plans"));
      const presets = {
        categories: [
          { name: "Plans & Phases", icon: "📋", queries: ["Phase", "PLAN", "roadmap", "slice", "scope contract"] },
          { name: "Architecture", icon: "🏗️", queries: ["architecture", "design", "pattern", "layer", "service"] },
          { name: "Configuration", icon: "⚙️", queries: ["config", "model", "routing", "quorum", "preset"] },
          { name: "Testing", icon: "🧪", queries: ["test", "validation", "gate", "coverage", "sweep"] },
          { name: "Cost & Tokens", icon: "💰", queries: ["cost", "token", "spend", "model", "budget"] },
          { name: "Issues & Fixes", icon: "🐛", queries: ["bug", "fix", "error", "fail", "TODO"] },
        ],
        recentFiles: [],
        projectContext: { projectName, preset, hasRuns, hasCost, hasPlans },
      };
      // Add recent run files as suggested search targets
      if (hasRuns) {
        const runsDir = resolve(PROJECT_DIR, ".forge", "runs");
        try {
          const dirs = readdirSync(runsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory()).map((d) => d.name).sort().reverse().slice(0, 5);
          presets.recentFiles = dirs.map((d) => ({ dir: d, label: d.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+_/, "") }));
        } catch { /* ignore */ }
      }
      res.json(presets);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Worker detection API
  app.get("/api/workers", (_req, res) => {
    try {
      const workers = detectWorkers(PROJECT_DIR);
      res.json(workers);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Image generation API
  app.post("/api/image/generate", async (req, res) => {
    try {
      const { prompt, outputPath, model, size } = req.body || {};
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }
      if (!outputPath || typeof outputPath !== "string") {
        return res.status(400).json({ error: "outputPath is required" });
      }
      const result = await generateImage(prompt, {
        model: model || "grok-imagine-image",
        size: size || "1024x1024",
        outputPath,
        cwd: PROJECT_DIR,
      });
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── Bridge REST API ─────────────────────────────────────────────────

  // Helper: validate the optional bridge approval secret.
  // If bridge.approvalSecret is set, the request must supply it via
  //   Authorization: Bearer <secret>  OR  ?token=<secret>
  function checkApprovalSecret(req, res) {
    const secret = activeBridge?.config?.approvalSecret;
    if (!secret) return true; // No secret configured — open access
    const authHeader = req.headers?.authorization ?? "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    const queryToken = req.query?.token ?? null;
    if (bearerToken === secret || queryToken === secret) return true;
    res.status(401).json({ error: "Unauthorized — invalid or missing approval secret" });
    return false;
  }

  // GET /api/bridge/status — connected channels, pending approvals, stats
  app.get("/api/bridge/status", (_req, res) => {
    if (!activeBridge) {
      return res.json({
        enabled: false,
        message: "Bridge not initialised (no bridge config in .forge.json)",
      });
    }
    const channels = (activeBridge.config?.channels ?? []).map((c) => ({
      type: c.type,
      level: c.level ?? "important",
      approvalRequired: c.approvalRequired ?? false,
      // Mask URL to avoid leaking tokens
      url: (c.url ?? "").replace(/\/bot[^/]+\//, "/bot[REDACTED]/"),
    }));
    res.json({
      enabled: activeBridge.isEnabled,
      connected: !!(activeBridge._ws && activeBridge._ws.readyState === 1),
      hasApprovalChannels: activeBridge.hasApprovalChannels,
      channels,
      pendingApprovals: activeBridge.getPendingApprovals(),
    });
  });

  // POST /api/bridge/approve/:runId — receive approval callback
  //   Body: { action: "approve" | "reject", approver?: string }
  app.post("/api/bridge/approve/:runId", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    const { runId } = req.params;
    if (!runId) return res.status(400).json({ error: "runId is required" });

    if (!activeBridge) {
      return res.status(503).json({ error: "Bridge not initialised" });
    }

    // Rate limit: only accept one decision per runId
    if (_approvedRunIds.has(runId)) {
      return res.status(409).json({ error: "Approval already received for this runId" });
    }

    const { action, approver } = req.body || {};
    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: 'action must be "approve" or "reject"' });
    }

    const approved = action === "approve";
    const result = activeBridge.receiveApproval(runId, approved, approver ?? "api");

    if (!result.ok) {
      return res.status(404).json({ error: result.message });
    }

    _approvedRunIds.add(runId);
    res.json({ ok: true, runId, action, approver: approver ?? "api" });
  });

  // GET /api/bridge/approve/:runId — browser-friendly approval link (Telegram inline buttons)
  //   Query: ?action=approve|reject  (required)
  //          ?token=<secret>         (optional, if approvalSecret is set)
  app.get("/api/bridge/approve/:runId", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    const { runId } = req.params;
    if (!runId) return res.status(400).send("runId is required");

    if (!activeBridge) {
      return res.status(503).send("Bridge not initialised");
    }

    if (_approvedRunIds.has(runId)) {
      return res.status(409).send(`<html><body><h2>Already processed</h2><p>Approval for run <code>${runId}</code> was already received.</p></body></html>`);
    }

    const action = req.query?.action;
    if (action !== "approve" && action !== "reject") {
      return res.status(400).send('Query parameter "action" must be "approve" or "reject"');
    }

    const approved = action === "approve";
    const result = activeBridge.receiveApproval(runId, approved, "browser");

    if (!result.ok) {
      return res.status(404).send(`<html><body><h2>Not Found</h2><p>${result.message}</p></body></html>`);
    }

    _approvedRunIds.add(runId);
    const icon = approved ? "✅" : "❌";
    const label = approved ? "Approved" : "Rejected";
    res.send(`<html><body><h2>${icon} ${label}</h2><p>Run <code>${runId}</code> has been <strong>${label.toLowerCase()}</strong>.</p></body></html>`);
  });

  // POST /api/runs/trigger — inbound trigger for OpenClaw / external orchestrators
  //   Auth: Authorization: Bearer <bridge.approvalSecret>  OR  ?token=<secret>
  //   Body: { plan: "docs/plans/Phase-1.md", quorum?: "auto"|"power"|"speed"|true|false,
  //           model?: string, resumeFrom?: number, estimate?: boolean, dryRun?: boolean }
  //   Response: { ok: true, triggerId, message }  (run executes in background)
  app.post("/api/runs/trigger", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    const { plan, quorum: rawQuorum, model, resumeFrom, estimate, dryRun } = req.body || {};
    if (!plan || typeof plan !== "string") {
      return res.status(400).json({ error: "plan is required and must be a string path" });
    }

    // Prevent concurrent runs
    if (activeAbortController) {
      return res.status(409).json({ error: "A plan run is already in progress. Abort it first via POST /api/runs/abort" });
    }

    const cwd = findProjectRoot(PROJECT_DIR);
    const planPath = resolve(cwd, plan);
    if (!existsSync(planPath)) {
      return res.status(404).json({ error: `Plan file not found: ${plan}` });
    }

    // Parse quorum parameter (mirrors forge_run_plan MCP handler)
    let quorum = "auto";
    let quorumPreset = null;
    if (rawQuorum === "power") { quorum = true; quorumPreset = "power"; }
    else if (rawQuorum === "speed") { quorum = true; quorumPreset = "speed"; }
    else if (rawQuorum === "true" || rawQuorum === true) quorum = true;
    else if (rawQuorum === "false" || rawQuorum === false) quorum = false;

    const triggerId = `trigger-${Date.now()}`;

    // Fire-and-forget — run executes in background; dashboard + bridge handle progress
    activeAbortController = new AbortController();
    const eventHandler = activeHub ? { handle: (event) => activeHub.broadcast(event) } : null;
    runPlan(planPath, {
      cwd,
      model: model || null,
      mode: "auto",
      resumeFrom: resumeFrom != null ? Number(resumeFrom) : null,
      estimate: estimate || false,
      dryRun: dryRun || false,
      quorum,
      quorumPreset,
      abortController: activeAbortController,
      eventHandler,
    }).then(() => {
      activeAbortController = null;
    }).catch((err) => {
      activeAbortController = null;
      console.error(`[trigger] Run failed: ${err.message}`);
    });

    res.json({ ok: true, triggerId, message: `Plan run started: ${plan}`, plan });
  });

  // POST /api/runs/abort — abort an in-progress triggered run
  app.post("/api/runs/abort", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    if (!activeAbortController) {
      return res.status(404).json({ error: "No active run to abort" });
    }
    activeAbortController.abort();
    res.json({ ok: true, message: "Abort signal sent. Current slice will finish, then execution stops." });
  });

  // ─── Bridge REST API endpoints are registered above ─────────────────

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

  // Auto-generate tools.json + cli-schema.json on startup
  try {
    writeToolsJson(TOOLS, __dirname);
    writeCliSchema(__dirname);
    console.error("[capabilities] tools.json + cli-schema.json generated");
  } catch (err) {
    console.error(`[capabilities] Auto-generation failed: ${err.message} (non-fatal)`);
  }

  // Start Express HTTP server for dashboard + REST API
  try {
    const app = createExpressApp();
    app.listen(HTTP_PORT, "127.0.0.1", () => {
      console.error(`Plan Forge Dashboard at http://127.0.0.1:${HTTP_PORT}/dashboard`);
    });
  } catch (err) {
    console.error(`[http] Express server failed to start: ${err.message} (non-fatal)`);
  }

  // Start WebSocket hub alongside MCP server
  try {
    activeHub = await createHub({ cwd: PROJECT_DIR });
    console.error(`Plan Forge WebSocket hub running on port ${activeHub.port}`);

    // Start event file watcher to bridge orchestrator events → dashboard
    activeEventWatcher = startEventFileWatcher(activeHub, PROJECT_DIR);
  } catch (err) {
    console.error(`[hub] WebSocket hub failed to start: ${err.message} (non-fatal)`);
  }

  // Start Bridge (connects to hub as a WS client; activates if bridge config present)
  try {
    activeBridge = createBridge({ cwd: PROJECT_DIR, port: activeHub?.port });
    if (activeBridge) {
      console.error("[bridge] Bridge manager started");
    }
  } catch (err) {
    console.error(`[bridge] Bridge failed to start: ${err.message} (non-fatal)`);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    if (activeEventWatcher) activeEventWatcher.stop();
    if (activeHub) activeHub.close();
    if (activeBridge) activeBridge.stop();
  });
  process.on("SIGINT", () => {
    if (activeEventWatcher) activeEventWatcher.stop();
    if (activeHub) activeHub.close();
    if (activeBridge) activeBridge.stop();
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

