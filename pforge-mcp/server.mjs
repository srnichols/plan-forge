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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Load .env from project root (cwd) at startup ──────────────────────
// API keys (XAI_API_KEY, OPENAI_API_KEY, etc.) are commonly stored in a project-level
// .env file. Load them into process.env BEFORE any tool is invoked so smith and the
// generation tools can see them. Existing process.env values always win.
// Lightweight parser — no external dotenv dependency. Lines starting with # are comments.
try {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf8");
    for (const rawLine of envContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Existing process.env values (set by the parent shell) always take precedence.
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
} catch {
  // .env loading is best-effort. Failure must never break server startup.
}

import { parsePlan, runPlan, detectWorkers, getCostReport, getHealthTrend, analyzeWithQuorum, generateImage, runAnalyze, readForgeJson, readForgeJsonl, appendForgeJsonl, emitToolTelemetry, regressionGuard, runPostSliceHook, resetPostSliceHookFired, runPreAgentHandoffHook, postOpenClawSnapshot, loadOpenClawConfig, loadQuorumConfig, runWatch, runWatchLive } from "./orchestrator.mjs";
import {
  isOpenBrainConfigured,
  shapeWatcherAnomalyThought,
  dedupeWatcherAnomalies,
  shapeQueueRecord,
  dedupeThoughtsBySimilarity,
  stampThoughtExpiry,
  buildCaptureTelemetry,
  validateSourceFormat,
  buildWatcherSearchPrompt,
  buildMemoryReport,
} from "./memory.mjs";
import { createHub, readHubPort } from "./hub.mjs";
import { createBridge } from "./bridge.mjs";
import { buildCapabilitySurface, writeToolsJson, writeCliSchema } from "./capabilities.mjs";
import { readRunIndex } from "./telemetry.mjs";
import { parseSkill, executeSkill } from "./skill-runner.mjs";
import {
  handleSubmit as crucibleHandleSubmit,
  handleAsk as crucibleHandleAsk,
  handlePreview as crucibleHandlePreview,
  handleFinalize as crucibleHandleFinalize,
  handleList as crucibleHandleList,
  handleAbandon as crucibleHandleAbandon,
} from "./crucible-server.mjs";
import { loadCrucibleConfig, saveCrucibleConfig } from "./crucible-config.mjs";
import { readManualImports } from "./crucible-enforce.mjs";
import { checkForUpdate } from "./update-check.mjs";
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

/**
 * Broadcast a LiveGuard tool event to the WebSocket hub.
 * Emits both the detailed `liveguard-tool-completed` event and a simple
 * `liveguard` event for dashboard filtering.
 * Returns a Promise — callers should await to ensure WS writes flush.
 */
async function broadcastLiveGuard(tool, status, durationMs, summary = {}) {
  const ts = new Date().toISOString();
  const clientCount = activeHub?.clients?.size || 0;

  // File-based diagnostic log (stderr is captured by MCP stdio transport)
  try {
    const logDir = resolve(PROJECT_DIR, ".forge");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(resolve(logDir, "liveguard-broadcast.log"),
      `${ts} ${tool} hub=${!!activeHub} clients=${clientCount} status=${status}\n`);
  } catch { /* best-effort logging */ }

  if (!activeHub) {
    console.error(`[liveguard] broadcastLiveGuard(${tool}) — hub not initialized, event dropped`);
    return;
  }
  activeHub.broadcast({ type: "liveguard-tool-completed", tool, status, durationMs, timestamp: ts });
  activeHub.broadcast({ type: "liveguard", tool: tool.replace("forge_", "").replace(/_/g, "-"), status, ...summary, timestamp: ts });
  console.error(`[liveguard] ${tool} → ${clientCount} client(s)`);

  // Force event loop tick so WebSocket writes flush before MCP returns the response
  await new Promise(r => setImmediate(r));
}

/**
 * Auto-capture a LiveGuard finding to persistent memory.
 * Writes to .forge/liveguard-memories.jsonl (always) and broadcasts a hub event.
 * If OpenBrain is configured, the thought is also queued for OpenBrain ingestion
 * via .forge/openbrain-queue.jsonl (read by SessionStart hook on next session).
 *
 * @param {string} content - Human-readable description of the finding
 * @param {string} type - Thought type: 'decision', 'gotcha', 'lesson', 'pattern', 'convention'
 * @param {string} source - Tool that generated this (e.g., 'forge_drift_report')
 * @param {string} cwd - Project directory
 */
function captureMemory(content, type, source, cwd) {
  try {
    let project = "plan-forge";
    try {
      const forgeConfig = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
      project = forgeConfig.projectName || "plan-forge";
    } catch { /* use default */ }

    // GX.4 (v2.36): standardise source attribution. Invalid sources are
    // warn-logged but still persisted so callers see their mistake and
    // capture is never dropped silently.
    const sourceCheck = validateSourceFormat(source);
    if (!sourceCheck.valid) {
      console.error(`[memory] non-standard source '${source}': ${sourceCheck.reason}`);
    }

    let thought = {
      content,
      project,
      type,
      source,
      created_by: "liveguard-auto",
      captured_at: new Date().toISOString(),
    };

    // G3.5 (v2.36): stamp expiresAt based on thought type so short-lived
    // observations don't dominate future searches.
    thought = stampThoughtExpiry(thought);

    // G3.2 (v2.36): suppress near-duplicates by cosine similarity against
    // the last 50 captures. Threshold is configurable via .forge.json
    // openbrain.dedupThreshold (default 0.9).
    let deduped = false;
    let threshold = 0.9;
    try {
      const cfg = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
      if (typeof cfg?.openbrain?.dedupThreshold === "number") {
        threshold = cfg.openbrain.dedupThreshold;
      }
    } catch { /* use default */ }
    try {
      const recent = readForgeJsonl("liveguard-memories.jsonl", [], cwd);
      const tail = recent.slice(-50);
      const { dropped } = dedupeThoughtsBySimilarity([...tail, thought], { threshold });
      deduped = dropped.some((d) => d.thought === thought);
    } catch { /* best-effort */ }

    if (!deduped) {
      // Always persist locally
      appendForgeJsonl("liveguard-memories.jsonl", thought, cwd);

      // G2.6: queue records carry delivery state (_status / _attempts /
      // _enqueuedAt / _nextAttemptAt) so a drain worker can apply
      // exponential backoff and DLQ semantics.
      if (isOpenBrainConfigured(cwd)) {
        appendForgeJsonl("openbrain-queue.jsonl", shapeQueueRecord(thought), cwd);
      }
    }

    // G3.6 (v2.36): emit a capture-telemetry record regardless — we want
    // visibility into dedup rate, per-tool capture volume, etc.
    try {
      appendForgeJsonl(
        "telemetry/memory-captures.jsonl",
        buildCaptureTelemetry({ tool: source, type, source, content, project, deduped }),
        cwd,
      );
    } catch { /* best-effort */ }

    // Broadcast so dashboard/bridge can observe (include deduped flag)
    activeHub?.broadcast({
      type: "memory-captured",
      thought,
      deduped,
      timestamp: thought.captured_at,
    });
  } catch { /* memory capture is best-effort — never break tool execution */ }
}

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
        manualImport: { type: "boolean", description: "v2.37 Crucible — bypass the crucibleId frontmatter gate. Logged to .forge/crucible/manual-imports.jsonl." },
        manualImportSource: { type: "string", enum: ["human", "speckit", "grandfather"], description: "v2.37 Crucible — audit tag for --manual-import bypass. Default: human." },
        manualImportReason: { type: "string", description: "v2.37 Crucible — optional free-form note recorded in the manual-import audit log." },
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
    name: "forge_watch",
    description: "WATCHER (v2.34) — read-only observer that tails another project's pforge run. Run this from a SECOND VS Code Copilot session with Plan-Forge as the workspace, pointing targetPath at the project being executed. Returns snapshot of current run state (slices passed/failed/in-progress, token counts, gate errors) plus heuristic anomaly detection. Mode 'analyze' additionally invokes a frontier model (default: claude-opus-4.7) for narrative advice. The watcher CANNOT modify any files in the target project.",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", description: "Absolute path to the project being watched (e.g., E:/GitHub/Rummag)" },
        runId: { type: "string", description: "Specific run directory under .forge/runs/ (default: latest)" },
        mode: { type: "string", enum: ["snapshot", "analyze"], description: "snapshot = file reads only, no AI cost. analyze = invokes watcher model for advice." },
        model: { type: "string", description: "Override watcher model (default: claude-opus-4.7)" },
        tailEvents: { type: "number", description: "Trailing events to include (1-200, default: 25). Lower = cheaper analyze prompts." },
        sinceTimestamp: { type: "string", description: "(v2.35) ISO timestamp cursor — only flag events newer than this. Pass back the previous report's `cursor` field for continuous monitoring." },
        recordHistory: { type: "boolean", description: "(v2.35) Append snapshot to watcher's own .forge/watch-history.jsonl (default: true)" },
      },
      required: ["targetPath"],
    },
  },
  {
    name: "forge_watch_live",
    description: "WATCHER LIVE TAIL (v2.35) — stream events from another project's pforge run for a fixed duration. Connects to the target's WebSocket hub if running (`.forge/server-ports.json`); falls back to file polling otherwise. Read-only by design — only subscribes, never sends commands. Returns aggregate stats and the captured event stream.",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", description: "Absolute path to the project being watched" },
        durationMs: { type: "number", description: "How long to listen, in ms (1000-3600000, default: 60000)" },
        pollIntervalMs: { type: "number", description: "Polling interval if hub not running (default: 3000ms)" },
      },
      required: ["targetPath"],
    },
  },
  {
    name: "forge_memory_report",
    description: "GX.3 (v2.36): aggregate the health of every memory surface — L2 jsonl files (record counts, schema _v distribution), OpenBrain queue state (pending/delivered/failed/deferred/DLQ), drain stats trend, capture telemetry (per-tool/per-type volume + dedup rate), search cache health, and orphans under .forge/. Read-only — never mutates files.",
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
    name: "forge_crucible_submit",
    description: "Submit a raw idea to the Crucible — starts a new smelt (idea → spec workflow). Returns a smelt id, a recommended lane (tweak / feature / full), and the first interview question. USE FOR: kicking off Crucible from an AI agent or CLI with a one-line description of a change, bug, or feature. Agent-submitted smelts are subject to the recursion guardrail (default depth=1, set source='agent').",
    inputSchema: {
      type: "object",
      properties: {
        rawIdea: { type: "string", description: "The raw idea text — a sentence or short paragraph describing the change." },
        lane: { type: "string", enum: ["tweak", "feature", "full"], description: "Override the recommended lane. Omit to accept the heuristic's choice." },
        source: { type: "string", enum: ["human", "agent"], description: "Who submitted the smelt. Default: human." },
        parentSmeltId: { type: "string", description: "Parent smelt id if this was spawned from another smelt (used for recursion depth tracking)." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["rawIdea"],
    },
  },
  {
    name: "forge_crucible_ask",
    description: "Advance the Crucible interview — supply an answer and get the next question, or mark the smelt ready for preview/finalize when the interview is complete. Call without `answer` to fetch the current question. USE FOR: the interactive Q&A loop that turns a raw idea into a hardened spec.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id returned by forge_crucible_submit." },
        answer: { type: "string", description: "Answer to the current question. Omit to fetch the current question without advancing." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_preview",
    description: "Render the current draft of a smelt as a Markdown plan. Returns the draft, the tentative phase name (null until finalized), and a list of unresolved fields (slots still awaiting an answer). USE FOR: reviewing before finalize, or for the dashboard's live-preview pane.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_finalize",
    description: "Finalize a smelt — atomically claim the next phase number, write docs/plans/Phase-NN.md with a `crucibleId:` frontmatter stamp, and mark the smelt finalized. Returns the chosen phase name and the plan path. Plan Hardener handoff lands in Slice 01.6. USE FOR: closing the idea→spec workflow when the interview is done.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id. Must be status=in-progress." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_crucible_list",
    description: "List Crucible smelts, newest-first, optionally filtered by status. USE FOR: dashboard smelt-list panel, resuming in-progress smelts across sessions, auditing recently finalized smelts.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["in-progress", "finalized", "abandoned"], description: "Filter by smelt status. Omit to return all." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_crucible_abandon",
    description: "Abandon a smelt — marks it status=abandoned and releases any phase-number claim it held. Idempotent: re-abandoning a smelt is a no-op. USE FOR: discarding a smelt that was started by mistake or superseded by another idea.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Smelt id to abandon." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["id"],
    },
  },
  {
    name: "forge_memory_capture",
    description: "Capture a thought, decision, or lesson into OpenBrain persistent memory. USE FOR: recording architecture decisions, patterns chosen, gotchas discovered, conventions established, or any cross-session knowledge that future AI sessions should know. Requires OpenBrain to be configured in .vscode/mcp.json or .claude/mcp.json.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The thought, decision, or lesson to capture. Be specific — future agents will read this." },
        project: { type: "string", description: "Project name to scope the memory (default: read from .forge.json)" },
        type: { type: "string", description: "Memory type: decision | lesson | convention | pattern | gotcha (default: decision)", enum: ["decision", "lesson", "convention", "pattern", "gotcha"] },
        source: { type: "string", description: "Source identifier (e.g. 'openclaw-trigger', 'plan-forge/slice-3'). Default: 'forge_memory_capture'" },
        created_by: { type: "string", description: "Who captured this (e.g. 'openclaw', 'copilot-agent'). Default: 'forge_memory_capture'" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["content"],
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
  {
    name: "forge_drift_report", // LiveGuard — emitToolTelemetry in handler
    description: "Score the codebase against architecture guardrail rules. Tracks drift over time in .forge/drift-history.jsonl. Fires a bridge notification when score drops below threshold. With autoIncident, auto-captures incidents and generates fix proposals for high/critical violations.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to scan (default: project root)" },
        threshold: { type: "number", description: "Alert threshold 0-100. Fires drift-alert when score drops below this value. Default: 70", minimum: 0, maximum: 100 },
        rules: { type: "array", items: { type: "string" }, description: "Guardrail rule IDs to check. Default: all rules (empty-catch, any-type, sync-over-async, sql-injection, deferred-work)" },
        autoIncident: { type: "boolean", description: "Auto-capture incidents for high/critical violations and generate fix proposals. Default: false" },
      },
      required: [],
    },
  },
  {
    name: "forge_incident_capture", // LiveGuard — emitToolTelemetry in handler
    description: "Capture an incident — record description, severity, affected files, and optional resolution timestamp for MTTR tracking. Appends to .forge/incidents.jsonl. Dispatches a bridge notification to the onCall target configured in .forge.json when an incident is captured.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Short description of the incident (e.g., 'API latency spike on /checkout')" },
        severity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Incident severity level. Default: medium" },
        files: { type: "array", items: { type: "string" }, description: "Affected file paths (optional, for traceability)" },
        resolvedAt: { type: "string", description: "ISO 8601 resolution timestamp for MTTR calculation. Omit at capture time — supply via a second call when the incident is resolved." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["description"],
    },
  },
  {
    name: "forge_regression_guard", // LiveGuard — emitToolTelemetry in handler
    description: "Run regression guard — extract validation gate commands from plan files, execute them against the current codebase, and report passed/failed/blocked results. Guards against regressions when files change. Accepts a list of changed files and an optional plan to scope the check. Falls back to testCommand slice fields when no bash-block gates are present.",
    inputSchema: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" }, description: "Changed file paths to guard (included in result for traceability). If omitted, all plan gates are checked." },
        plan: { type: "string", description: "Path to a specific plan file to extract gates from (e.g., docs/plans/Phase-1-AUTH-PLAN.md). If omitted, all plan files in docs/plans/ are scanned." },
        failFast: { type: "boolean", description: "If true, stop on first gate failure. Default: false" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_runbook", // LiveGuard — emitToolTelemetry in handler
    description: "Generate a human-readable operational runbook from a hardened plan file. Parses slices, scope contract, build/test commands, and validation gates into a structured Markdown document. Optionally appends recent incidents from .forge/incidents.jsonl for operational context. Saves to .forge/runbooks/<plan-name>-runbook.md and returns the output path.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" },
        includeIncidents: { type: "boolean", description: "Include recent incidents from .forge/incidents.jsonl for operational context. Default: true" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["plan"],
    },
  },
  {
    name: "forge_hotspot", // LiveGuard — emitToolTelemetry in handler
    description: "Identify git churn hotspots — files that change most frequently. Helps prioritize refactoring, testing, and review effort. Caches results in .forge/hotspot-cache.json (24h TTL). Accepts --top N and --since filters.",
    inputSchema: {
      type: "object",
      properties: {
        top: { type: "number", description: "Number of hotspot files to return. Default: 10", minimum: 1, maximum: 100 },
        since: { type: "string", description: "Git log --since filter (e.g., '3 months ago', '2024-01-01'). Default: '6 months ago'" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_health_trend", // LiveGuard — emitToolTelemetry in handler
    description: "Health trend analysis — aggregates drift scores, cost history, incident frequency, and model performance over a configurable time window. Returns per-metric summaries, an overall health score (0–100), and trend direction. Data sourced from .forge/ operational files.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Number of days of history to analyze. Default: 30" },
        metrics: { type: "string", description: "Comma-separated metric filter (drift,cost,incidents,models). Default: all" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
    },
  },
  {
    name: "forge_alert_triage", // LiveGuard — emitToolTelemetry in handler
    description: "Triage open alerts — read incidents and drift violations, rank by priority (severity × recency), and return a prioritized list. Read-only: does not modify any data store. Tiebreak: more recent alerts rank higher when priority scores are equal.",
    inputSchema: {
      type: "object",
      properties: {
        minSeverity: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Minimum severity to include. Default: low (all)" },
        max: { type: "number", description: "Maximum number of alerts to return. Default: 20", minimum: 1, maximum: 200 },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_deploy_journal", // LiveGuard — emitToolTelemetry in handler
    description: "Record a deployment — log version, deployer, optional notes, and optional slice reference. Appends to .forge/deploy-journal.jsonl. Used by forge_incident_capture to correlate incidents with the most recent deploy.",
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", description: "Deployed version (e.g., 'v2.31.0', '1.0.0-rc.1')" },
        by: { type: "string", description: "Who or what triggered the deploy (e.g., 'CI', 'alice'). Default: 'unknown'" },
        notes: { type: "string", description: "Free-form deploy notes (e.g., 'hotfix for checkout timeout')" },
        slice: { type: "string", description: "Plan slice reference (e.g., 'S3', 'Slice 7.2')" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: ["version"],
    },
  },
  {
    name: "forge_dep_watch", // LiveGuard — emitToolTelemetry in handler
    description: "Scan project dependencies for known vulnerabilities using npm audit. Compares against previous snapshot in .forge/deps-snapshot.json to detect new and resolved CVEs. Fires a bridge notification when new vulnerabilities are found. Non-npm projects degrade gracefully.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project directory (default: current)" },
        notify: { type: "boolean", description: "Send bridge notification for new vulnerabilities. Default: true" },
      },
      required: [],
    },
  },
  {
    name: "forge_secret_scan", // LiveGuard — emitToolTelemetry in handler
    description: "Post-commit entropy analysis — scan git diff output for high-entropy strings that may be leaked secrets. Uses Shannon entropy with key-name heuristics. Never logs actual secret values — only file paths, line numbers, entropy scores, and <REDACTED> placeholders. Caches results in .forge/secret-scan-cache.json. Annotates deploy journal sidecar when last deploy matches HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Git ref or range to scan (e.g., 'HEAD~1', 'abc123..def456'). Default: HEAD~1" },
        threshold: { type: "number", description: "Minimum Shannon entropy to flag (3.5–5.0). Default: 4.0", minimum: 3.5, maximum: 5.0 },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_env_diff", // LiveGuard — emitToolTelemetry in handler
    description: "Compare environment variable keys across .env files — detect missing keys between baseline and target environments. Compares key names only (never values). Caches results in .forge/env-diff-cache.json. Integrates with forge_runbook to surface environment key gaps.",
    inputSchema: {
      type: "object",
      properties: {
        baseline: { type: "string", description: "Baseline .env file path (relative to project root). Default: .env" },
        files: { type: "string", description: "Comma-separated target .env file paths to compare against baseline (e.g., '.env.staging,.env.production'). Default: auto-detect .env.* files" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_fix_proposal",
    description: "Generate a 1-2 slice fix plan from regression, drift, incident, or secret-scan failure. Writes to docs/plans/auto/LIVEGUARD-FIX-<id>.md. Capped at one proposal per incidentId.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Data source: 'regression', 'drift', 'incident', or 'secret'. Default: auto-detect from latest data" },
        incidentId: { type: "string", description: "Incident ID to generate fix for (required for incident source)" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_quorum_analyze",
    description: "Assemble a structured 3-section quorum prompt from any LiveGuard data source. No LLM calls — returns the prompt for multi-model dispatch. Supports customQuestion freeform override (max 500 chars) and analysisGoal presets.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Data source: 'drift', 'incident', 'triage', 'runbook', 'fix-proposal'. Required." },
        targetFile: { type: "string", description: "Specific data file path (relative to .forge/). Defaults to most recent for source type." },
        analysisGoal: { type: "string", description: "Preset question: 'root-cause', 'risk-assess', 'fix-review', 'runbook-validate'. Ignored when customQuestion is provided." },
        customQuestion: { type: "string", description: "Freeform question override (max 500 chars). Replaces the analysisGoal preset entirely." },
        quorumSize: { type: "number", description: "Number of model votes to request in the prompt. Default: 3." },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
  {
    name: "forge_liveguard_run",
    description: "Run all applicable LiveGuard checks in a single call and return a unified health report. Executes: drift, sweep, secret-scan, regression-guard, dep-watch, alert-triage, and health-trend. Optionally runs diff if a plan is specified. NOTE: May take 2-3 minutes for .NET projects (dep-watch runs `dotnet list package --vulnerable`). Set client timeout to at least 300 seconds.",
    inputSchema: {
      type: "object",
      properties: {
        plan: { type: "string", description: "Plan file path for scope diff (optional). If omitted, diff is skipped." },
        threshold: { type: "number", description: "Drift alert threshold 0-100. Default: 70" },
        path: { type: "string", description: "Project directory (default: current)" },
      },
      required: [],
    },
  },
];
// ─── Runbook helpers ──────────────────────────────────────────────────

function planNameToRunbookName(planPath) {
  const base = basename(planPath, ".md");
  return base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") + "-runbook.md";
}

function generateRunbook(plan, cwd, options = {}) {
  const { includeIncidents = true } = options;
  const lines = [];

  lines.push(`# Runbook: ${plan.meta.title || "Unnamed Plan"}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (plan.meta.status) lines.push(`Status: ${plan.meta.status}`);
  if (plan.meta.branch) lines.push(`Branch: \`${plan.meta.branch}\``);
  lines.push("");

  // Scope Contract
  const sc = plan.scopeContract;
  if (sc && (sc.inScope.length || sc.outOfScope.length || sc.forbidden.length)) {
    lines.push("## Scope Contract");
    lines.push("");
    if (sc.inScope.length) {
      lines.push("### In Scope");
      sc.inScope.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (sc.outOfScope.length) {
      lines.push("### Out of Scope");
      sc.outOfScope.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
    if (sc.forbidden.length) {
      lines.push("### Forbidden Actions");
      sc.forbidden.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }
  }

  // Execution Slices
  lines.push("## Execution Slices");
  lines.push("");
  for (const slice of plan.slices) {
    const deps = slice.depends || [];
    const parallel = slice.parallel ? " [parallel]" : "";
    lines.push(`### Slice ${slice.number}: ${slice.title}${parallel}`);
    lines.push("");
    if (deps.length) {
      lines.push(`**Depends on:** Slice ${deps.join(", Slice ")}`);
      lines.push("");
    }
    if (slice.tasks && slice.tasks.length) {
      lines.push("**Tasks:**");
      slice.tasks.forEach((t) => lines.push(`1. ${t}`));
      lines.push("");
    }
    if (slice.buildCommand) {
      lines.push(`**Build Command:** \`${slice.buildCommand}\``);
      lines.push("");
    }
    if (slice.testCommand) {
      lines.push(`**Test Command:** \`${slice.testCommand}\``);
      lines.push("");
    }
    if (slice.validationGate) {
      lines.push("**Validation Gate:**");
      lines.push("```");
      lines.push(slice.validationGate);
      lines.push("```");
      lines.push("");
    }
    if (slice.stopCondition) {
      lines.push(`**Stop Condition:** ${slice.stopCondition}`);
      lines.push("");
    }
  }

  // Recent incidents
  if (includeIncidents) {
    const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
    if (incidents.length) {
      lines.push("## Recent Incidents");
      lines.push("");
      for (const inc of incidents.slice(-5)) {
        const sev = (inc.severity || "medium").toUpperCase();
        const resolved = inc.resolvedAt ? ` — resolved ${inc.resolvedAt}` : " — unresolved";
        lines.push(`- **[${sev}]** ${inc.description}${resolved} (${inc.capturedAt})`);
      }
      lines.push("");
    }
  }

  // Environment Key Gaps (from forge_env_diff cache)
  try {
    const envDiffPath = resolve(cwd, ".forge", "env-diff-cache.json");
    if (existsSync(envDiffPath)) {
      const envDiff = JSON.parse(readFileSync(envDiffPath, "utf-8"));
      if (envDiff.summary && !envDiff.summary.clean) {
        const gapPairs = (envDiff.pairs || []).filter(p => (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0);
        if (gapPairs.length) {
          lines.push("## Environment Key Gaps");
          lines.push("");
          lines.push(`Baseline: \`${envDiff.baseline || ".env"}\` (${envDiff.summary.baselineKeyCount || "?"} keys)`);
          lines.push("");
          for (const pair of gapPairs) {
            lines.push(`### ${pair.file}`);
            lines.push("");
            if (pair.missingInTarget?.length) {
              lines.push("**Missing in target (present in baseline):**");
              pair.missingInTarget.forEach(k => lines.push(`- \`${k}\``));
              lines.push("");
            }
            if (pair.missingInBaseline?.length) {
              lines.push("**Missing in baseline (present in target):**");
              pair.missingInBaseline.forEach(k => lines.push(`- \`${k}\``));
              lines.push("");
            }
          }
        }
      }
    }
  } catch { /* env-diff cache unavailable — skip */ }

  return lines.join("\n");
}

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
    case "forge_health_trend":
    case "forge_alert_triage":
    case "forge_capabilities":
    case "forge_fix_proposal":
    case "forge_quorum_analyze":
    case "forge_liveguard_run":
    case "forge_watch":
    case "forge_watch_live":
    case "forge_memory_report":
      return null; // Handled async in CallToolRequestSchema handler
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────
const server = new Server(
  { name: "plan-forge-mcp", version: "2.12.3" },
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
        // v2.37 Crucible (Slice 01.4) — bypass + audit
        manualImport: args.manualImport === true || args.manualImport === "true",
        manualImportSource: args.manualImportSource || "human",
        manualImportReason: args.manualImportReason || null,
      });
      activeAbortController = null;

      // Persist run summary + cost anomaly memories from orchestrator
      if (result?._memoryCapture) {
        if (result._memoryCapture.runSummary) {
          captureMemory(result._memoryCapture.runSummary, "decision", "forge_run_plan", cwd);
        }
        if (result._memoryCapture.costAnomaly) {
          captureMemory(result._memoryCapture.costAnomaly, "gotcha", "forge_run_plan/cost", cwd);
        }
      }

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
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const report = getCostReport(cwd);
      try {
        const ht = getHealthTrend(cwd, 30, ["drift", "cost"]);
        report.healthTrend = { trend: ht.trend, dataPoints: ht.dataPoints };
      } catch { /* backward-compatible — omit on failure */ }
      // G1.3 (v2.36): emit an L1 hub event so dashboards can show
      // "cost report generated" in real time, consistent with every other
      // dual-write tool. Best-effort — broadcastLiveGuard is no-op when
      // the hub isn't running.
      await broadcastLiveGuard("forge_cost_report", "OK", Date.now() - t0, {
        totalRuns: report.runs ?? 0,
        totalCost: report.total_cost_usd ?? 0,
      });
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Cost report error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_health_trend") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const days = Math.max(1, Math.min(365, parseInt(args.days) || 30));
      const metrics = args.metrics ? args.metrics.split(",").map(m => m.trim()) : null;
      const report = getHealthTrend(cwd, days, metrics);
      emitToolTelemetry("forge_health_trend", args, report, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_health_trend", "OK", Date.now() - t0);

      // Auto-capture significant health changes
      if (report.healthScore != null && report.trend && report.trend !== "stable") {
        captureMemory(
          `Health trend: score ${report.healthScore}/100, trend ${report.trend}. Drift avg: ${report.drift?.avg ?? "?"}, incidents: ${report.incidents?.open ?? 0} open.`,
          "decision", "forge_health_trend", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Health trend error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_alert_triage") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
      const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };
      const minSeverity = SEVERITY_ORDER.includes(args.minSeverity) ? args.minSeverity : "low";
      const minIdx = SEVERITY_ORDER.indexOf(minSeverity);
      const maxResults = Math.max(1, Math.min(200, parseInt(args.max) || 20));

      const now = Date.now();
      const recencyFactor = (isoTimestamp) => {
        const age = now - new Date(isoTimestamp).getTime();
        const hours24 = 24 * 60 * 60 * 1000;
        if (age < hours24) return 1.0;
        if (age < 7 * hours24) return 0.8;
        if (age < 30 * hours24) return 0.5;
        return 0.3;
      };

      const alerts = [];

      // Collect open incidents
      const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
      for (const inc of incidents) {
        if (inc.resolvedAt) continue; // skip resolved
        const sev = SEVERITY_ORDER.includes(inc.severity) ? inc.severity : "medium";
        if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
        const ts = inc.capturedAt || new Date(0).toISOString();
        const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
        alerts.push({ source: "incident", id: inc.id, description: inc.description, severity: sev, timestamp: ts, files: inc.files || [], priority: Math.round(priority * 100) / 100 });
      }

      // Collect latest drift violations
      const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
      if (driftHistory.length) {
        const latest = driftHistory[driftHistory.length - 1];
        for (const v of (latest.violations || [])) {
          const sev = SEVERITY_ORDER.includes(v.severity) ? v.severity : "medium";
          if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
          const ts = latest.timestamp || new Date(0).toISOString();
          const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
          alerts.push({ source: "drift", id: `drift-${v.rule}-${v.file}:${v.line}`, description: `${v.rule}: ${v.file}:${v.line}`, severity: sev, timestamp: ts, files: [v.file], priority: Math.round(priority * 100) / 100 });
        }
      }

      // Sort: primary by priority desc, tiebreak by timestamp desc (more recent first)
      alerts.sort((a, b) => b.priority - a.priority || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const result = { total: alerts.length, showing: Math.min(maxResults, alerts.length), minSeverity, alerts: alerts.slice(0, maxResults), generatedAt: new Date().toISOString() };
      emitToolTelemetry("forge_alert_triage", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_alert_triage", "OK", Date.now() - t0, { total: result.total, showing: result.showing });

      // Auto-capture when critical/high alerts exist
      const critHigh = alerts.filter(a => a.severity === "critical" || a.severity === "high");
      if (critHigh.length > 0) {
        captureMemory(
          `Alert triage: ${critHigh.length} critical/high alert(s) of ${result.total} total. Top: ${critHigh.slice(0, 3).map(a => a.description).join("; ")}.`,
          "gotcha", "forge_alert_triage", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Alert triage error: ${err.message}` }], isError: true };
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

  if (name === "forge_watch") {
    try {
      if (!args.targetPath) {
        return { content: [{ type: "text", text: "forge_watch requires targetPath (absolute path to the project being watched)." }], isError: true };
      }
      const report = await runWatch({
        targetPath: args.targetPath,
        runId: args.runId || null,
        mode: args.mode || "snapshot",
        model: args.model || undefined,
        tailEvents: args.tailEvents || undefined,
        sinceTimestamp: args.sinceTimestamp || undefined,
        recordHistory: args.recordHistory !== false,
        eventBus: activeHub
          ? { emit: (type, data) => { try { activeHub.broadcast({ type, data, timestamp: new Date().toISOString() }); } catch { /* ignore */ } } }
          : null,
      });

      // G3.1 (v2.35.1): capture watcher anomalies to L2/L3 memory.
      // The watcher is the only cross-project observer — anomaly patterns are high-value
      // semantic signals. Captures go to the WATCHER's .forge/ (PROJECT_DIR), NEVER the
      // target's, preserving the watcher's read-only contract on the target project.
      // Source attribution follows the GX.4 standard: "forge_watch/<anomaly-code>".
      let searchHints = "";
      if (Array.isArray(report?.anomalies) && report.anomalies.length > 0) {
        const meta = { targetPath: report.targetPath, runId: report.runId, runState: report.runState };
        // G3.3 (v2.36): build proactive OpenBrain search-prompt hints so the
        // agent consulting forge_watch knows to look up prior occurrences of
        // each anomaly code before reacting.
        let projectName = "plan-forge";
        try {
          const forgeCfg = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
          projectName = forgeCfg.projectName || projectName;
        } catch { /* use default */ }
        const seenCodes = new Set();
        for (const anomaly of report.anomalies) {
          const shaped = shapeWatcherAnomalyThought(anomaly, meta, "forge_watch");
          captureMemory(shaped.content, shaped.type, shaped.source, PROJECT_DIR);
          if (anomaly?.code && !seenCodes.has(anomaly.code)) {
            seenCodes.add(anomaly.code);
            searchHints += buildWatcherSearchPrompt(anomaly, projectName);
          }
        }
      }

      const reportJson = JSON.stringify(report, null, 2);
      const text = searchHints ? `${searchHints}\n${reportJson}` : reportJson;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Watcher error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_watch_live") {
    try {
      if (!args.targetPath) {
        return { content: [{ type: "text", text: "forge_watch_live requires targetPath." }], isError: true };
      }
      // G1.4 (v2.36): configurable cap + dropped-event counter so callers
      // know when the watcher ran hotter than the captured buffer could hold.
      // Default 500 preserves pre-v2.36 behaviour; max 10_000 guards memory.
      const rawMax = Number.isFinite(args.maxCapturedEvents) ? Number(args.maxCapturedEvents) : 500;
      const maxCapturedEvents = Math.min(10_000, Math.max(1, Math.floor(rawMax)));
      const captured = [];
      let droppedEvents = 0;
      const liveAnomalies = [];
      const result = await runWatchLive({
        targetPath: args.targetPath,
        durationMs: args.durationMs || 60_000,
        pollIntervalMs: args.pollIntervalMs || 3_000,
        onEvent: (event) => {
          // G1.4 (v2.36): cap configurable, track drops
          if (captured.length < maxCapturedEvents) {
            captured.push(event);
          } else {
            droppedEvents++;
          }
          // G3.1 (v2.35.1): collect anomaly events for L2/L3 capture after stream closes
          if (event?.type === "watch-anomaly-detected" && event?.data) {
            liveAnomalies.push(event.data);
          }
        },
      });

      // G3.1 (v2.35.1): dedupe by code+message within this live session and capture.
      // Writes land in the WATCHER's .forge/ — target project is never touched.
      const uniqueAnomalies = dedupeWatcherAnomalies(liveAnomalies);
      // G3.3 (v2.36): build proactive OpenBrain search hints, one per code.
      let projectName = "plan-forge";
      try {
        const forgeCfg = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
        projectName = forgeCfg.projectName || projectName;
      } catch { /* use default */ }
      let searchHints = "";
      const seenCodes = new Set();
      for (const a of uniqueAnomalies) {
        const meta = { targetPath: a.targetPath || args.targetPath, runId: a.runId };
        const shaped = shapeWatcherAnomalyThought(a, meta, "forge_watch_live");
        captureMemory(shaped.content, shaped.type, shaped.source, PROJECT_DIR);
        if (a?.code && !seenCodes.has(a.code)) {
          seenCodes.add(a.code);
          searchHints += buildWatcherSearchPrompt(a, projectName);
        }
      }
      const anomalyCaptureCount = uniqueAnomalies.length;

      const payload = JSON.stringify({
        ...result,
        capturedEvents: captured.length,
        droppedEvents,               // G1.4
        maxCapturedEvents,           // G1.4
        capturedAnomalies: anomalyCaptureCount,
        events: captured,
      }, null, 2);
      const text = searchHints ? `${searchHints}\n${payload}` : payload;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Watcher live error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_memory_report") {
    // GX.3 (v2.36): aggregate every memory surface (L2 files, OpenBrain queue
    // state, drain stats trend, capture telemetry, search cache, orphans).
    // Read-only — never mutates the forge dir.
    try {
      const report = buildMemoryReport(PROJECT_DIR);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Memory report error: ${err.message}` }], isError: true };
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

  // ─── Crucible (v2.37) — raw idea → hardened spec workflow ─────────
  if (name === "forge_crucible_submit") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleSubmit({
        rawIdea: args.rawIdea,
        lane: args.lane,
        source: args.source,
        parentSmeltId: args.parentSmeltId,
        projectDir: cwd,
        hub: activeHub,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible submit error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_crucible_ask") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleAsk({
        id: args.id,
        answer: args.answer,
        projectDir: cwd,
        hub: activeHub,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible ask error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_crucible_preview") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandlePreview({ id: args.id, projectDir: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible preview error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_crucible_finalize") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleFinalize({
        id: args.id,
        projectDir: cwd,
        hub: activeHub,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible finalize error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_crucible_list") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleList({ status: args.status || null, projectDir: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible list error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_crucible_abandon") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const result = crucibleHandleAbandon({ id: args.id, projectDir: cwd });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Crucible abandon error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_memory_capture") {
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      if (!isOpenBrainConfigured(cwd)) {
        return { content: [{ type: "text", text: "OpenBrain is not configured. Add the openbrain MCP server to .vscode/mcp.json or .claude/mcp.json to enable persistent memory capture." }], isError: true };
      }

      // Read project name from .forge.json if not provided
      let project = args.project || null;
      if (!project) {
        try {
          const forgeConfig = JSON.parse(readFileSync(resolve(cwd, ".forge.json"), "utf-8"));
          project = forgeConfig.projectName || "plan-forge";
        } catch { project = "plan-forge"; }
      }

      const thought = {
        content: args.content,
        project,
        type: args.type || "decision",
        source: args.source || "forge_memory_capture",
        created_by: args.created_by || "forge_memory_capture",
        captured_at: new Date().toISOString(),
      };

      // Return structured capture instructions — the AI worker executes capture_thought
      return {
        content: [{
          type: "text",
          text: `MEMORY CAPTURE — use the capture_thought tool with these parameters:\n\n${JSON.stringify(thought, null, 2)}\n\nAlternatively, POST to /api/memory/capture with the same payload to capture directly via REST (no AI worker needed).`,
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Memory capture error: ${err.message}` }], isError: true };
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

  if (name === "forge_incident_capture") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

      const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
      const severity = args.severity || "medium";
      if (!VALID_SEVERITIES.includes(severity)) {
        return { content: [{ type: "text", text: `Invalid severity '${severity}'. Must be one of: ${VALID_SEVERITIES.join(", ")}` }], isError: true };
      }

      const capturedAt = new Date().toISOString();
      const resolvedAt = args.resolvedAt || null;
      let mttr = null;

      if (resolvedAt) {
        const resolvedMs = new Date(resolvedAt).getTime();
        const capturedMs = new Date(capturedAt).getTime();
        if (isNaN(resolvedMs)) {
          return { content: [{ type: "text", text: `Invalid resolvedAt timestamp: '${resolvedAt}'. Must be ISO 8601 (e.g., 2024-01-01T02:30:00Z)` }], isError: true };
        }
        if (resolvedMs < capturedMs) {
          return { content: [{ type: "text", text: `resolvedAt (${resolvedAt}) is earlier than capturedAt (${capturedAt}). Check the timestamp.` }], isError: true };
        }
        mttr = resolvedMs - capturedMs;
      }

      const record = {
        id: `inc-${Date.now()}`,
        description: args.description,
        severity,
        files: args.files || [],
        capturedAt,
        resolvedAt,
        mttr,
      };

      // Correlate with most recent deploy before the incident
      try {
        const deploys = readForgeJsonl("deploy-journal.jsonl", [], cwd);
        const capturedMs = new Date(capturedAt).getTime();
        let preceding = null;
        for (let i = deploys.length - 1; i >= 0; i--) {
          const d = deploys[i];
          if (d.deployedAt && new Date(d.deployedAt).getTime() <= capturedMs) {
            preceding = d;
            break;
          }
        }
        if (preceding) {
          record.precedingDeploy = { journalId: preceding.id, version: preceding.version };
        }
      } catch { /* no deploy journal — skip */ }

      appendForgeJsonl("incidents.jsonl", record, cwd);

      // Recurring incident detection: check for prior incidents on same files
      let recurring = null;
      try {
        const incFiles = args.files || [];
        if (incFiles.length > 0) {
          const allIncidents = readForgeJsonl("incidents.jsonl", [], cwd);
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const priorOnSameFiles = allIncidents.filter(i =>
            i.id !== record.id &&
            new Date(i.capturedAt || 0).getTime() > thirtyDaysAgo &&
            (i.files || []).some(f => incFiles.some(cf => f.includes(cf) || cf.includes(f)))
          );
          if (priorOnSameFiles.length >= 2) {
            recurring = { count: priorOnSameFiles.length + 1, files: incFiles, pattern: "systemic" };
            record.recurring = recurring;
            // Auto-escalate severity for systemic issues
            if (severity === "medium" || severity === "low") {
              record.severity = "high";
              record.autoEscalated = true;
              record.escalationReason = `Recurring: ${priorOnSameFiles.length + 1} incidents on same file(s) in 30 days`;
            }
          }
        }
      } catch { /* best-effort recurring detection */ }

      // Notify hub
      activeHub?.broadcast({ type: "incident-captured", data: record, timestamp: capturedAt });

      // Dispatch bridge notification to onCall if configured
      let onCall = null;
      try {
        const forgeConfigPath = resolve(cwd, ".forge.json");
        if (existsSync(forgeConfigPath)) {
          const forgeConfig = JSON.parse(readFileSync(forgeConfigPath, "utf-8"));
          onCall = forgeConfig.onCall || null;
        }
      } catch { /* ignore */ }

      if (onCall) {
        activeBridge?.dispatch?.({ type: "incident-captured", severity, description: args.description, onCall });
      }

      emitToolTelemetry("forge_incident_capture", args, record, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_incident_capture", "OK", Date.now() - t0);

      // Auto-capture to memory
      captureMemory(
        `Incident ${record.id}: ${args.description}. Severity: ${severity}. Files: ${(args.files || []).join(", ") || "none"}.`,
        "gotcha", "forge_incident_capture", cwd
      );

      return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Incident capture error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_deploy_journal") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);

      if (!args.version || typeof args.version !== "string" || !args.version.trim()) {
        return { content: [{ type: "text", text: "version is required and must be a non-empty string" }], isError: true };
      }

      const record = {
        id: `deploy-${Date.now()}`,
        version: args.version.trim(),
        by: (args.by || "unknown").trim(),
        notes: args.notes ? args.notes.trim() : null,
        slice: args.slice ? args.slice.trim() : null,
        deployedAt: new Date().toISOString(),
      };

      appendForgeJsonl("deploy-journal.jsonl", record, cwd);

      activeHub?.broadcast({ type: "deploy-recorded", data: record, timestamp: record.deployedAt });

      emitToolTelemetry("forge_deploy_journal", args, record, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_deploy_journal", "OK", Date.now() - t0);

      // Auto-capture deploy decision
      captureMemory(
        `Deploy v${record.version}: ${record.notes || "no notes"}. By: ${record.by}.`,
        "decision", "forge_deploy_journal", cwd
      );

      return { content: [{ type: "text", text: JSON.stringify(record, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Deploy journal error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_regression_guard") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const files = args.files || [];
      const result = await regressionGuard(files, {
        plan: args.plan || null,
        failFast: args.failFast || false,
        cwd,
      });

      // E5: Append regression history for health trend tracking
      const regRecord = { timestamp: new Date().toISOString(), gatesChecked: result.gatesChecked, passed: result.passed, failed: result.failed, blocked: result.blocked || 0, skipped: result.skipped || 0 };
      appendForgeJsonl("regression-history.jsonl", regRecord, cwd); // G2.1: was .json

      // E8: Auto-resolve open incidents whose files overlap with passed gates
      if (result.success && result.passed > 0 && args.autoResolve !== false) {
        const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
        const resolvedIncidents = [];
        const guardedFiles = new Set(files);
        // Also add files from plan scope
        if (args.plan) {
          try {
            const plan = parsePlan(resolve(cwd, args.plan), cwd);
            for (const s of (plan.scopeContract?.inScope || [])) guardedFiles.add(s);
          } catch { /* skip */ }
        }

        // When tests pass with no explicit file scope, resolve all auto-drift incidents
        // (the whole project was validated by the passing gates)
        const hasOpenAutoDrift = incidents.some(i => !i.resolvedAt && i.source === "auto-drift");
        if (guardedFiles.size === 0 && hasOpenAutoDrift) {
          for (const inc of incidents) {
            if (!inc.resolvedAt && inc.source === "auto-drift") {
              for (const f of (inc.files || [])) guardedFiles.add(f);
            }
          }
        }

        // If still no guarded files but gates passed, treat it as project-wide pass
        const resolveAll = guardedFiles.size === 0 && result.passed > 0;

        const resolvedAt = new Date().toISOString();
        const updatedIncidents = incidents.map(inc => {
          if (inc.resolvedAt) return inc; // already resolved
          const incFiles = inc.files || [];
          const shouldResolve = resolveAll ||
            incFiles.some(f => [...guardedFiles].some(gf => f.includes(gf) || gf.includes(f)));
          if (shouldResolve) {
            const capturedMs = new Date(inc.capturedAt || inc.timestamp || 0).getTime();
            const resolvedMs = new Date(resolvedAt).getTime();
            resolvedIncidents.push(inc.id);
            return { ...inc, resolvedAt, mttr: resolvedMs - capturedMs };
          }
          return inc;
        });

        if (resolvedIncidents.length > 0) {
          const incPath = resolve(cwd, ".forge", "incidents.jsonl");
          writeFileSync(incPath, updatedIncidents.map(i => JSON.stringify(i)).join("\n") + "\n", "utf-8");
          result.resolvedIncidents = resolvedIncidents;

          // Track fix proposal outcomes — mark proposals as effective when their incidents resolve
          try {
            const proposals = readForgeJsonl("fix-proposals.json", [], cwd);
            for (const p of proposals) {
              if (!p.outcome) {
                // Check if any resolved incident matches the proposal's source/fixId
                const matchesResolved = resolvedIncidents.some(rid => p.fixId && rid.includes(p.fixId.replace("drift-auto-", "")));
                if (matchesResolved) {
                  p.outcome = "effective";
                  p.resolvedAt = new Date().toISOString();
                }
              }
            }
            const proposalPath = resolve(cwd, ".forge", "fix-proposals.json");
            writeFileSync(proposalPath, proposals.map(p => JSON.stringify(p)).join("\n") + "\n", "utf-8");
          } catch { /* best-effort outcome tracking */ }
        }
      }

      emitToolTelemetry("forge_regression_guard", args, result, Date.now() - t0, result.success ? "ok" : "error", cwd);
      await broadcastLiveGuard("forge_regression_guard", result.success ? "ok" : "error", Date.now() - t0, { gates: result.gatesChecked, passed: result.passed, failed: result.failed, resolved: (result.resolvedIncidents || []).length });

      // Auto-capture to memory
      if (result.resolvedIncidents?.length > 0) {
        captureMemory(
          `Regression guard passed (${result.passed}/${result.gatesChecked} gates). Auto-resolved ${result.resolvedIncidents.length} incident(s).`,
          "lesson", "forge_regression_guard", cwd
        );
      } else if (result.failed > 0) {
        captureMemory(
          `Regression guard failed: ${result.failed}/${result.gatesChecked} gate(s) failed.`,
          "gotcha", "forge_regression_guard", cwd
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Regression guard error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_drift_report") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const threshold = Math.max(0, Math.min(100, args.threshold ?? 70));
      const penaltyPerViolation = 2;

      const analysis = await runAnalyze({ mode: "file", path: ".", rules: args.rules || null, cwd });

      // Score based on app code violations only (framework violations reported separately)
      const score = Math.max(0, 100 - (analysis.violations.length * penaltyPerViolation));

      // E3: Quick test status — run project tests to provide complete picture
      let testStatus = null;
      try {
        const hasPkgJson = existsSync(resolve(cwd, "package.json"));
        const hasDotnet = readdirSync(cwd).some(f => f.endsWith(".csproj") || f.endsWith(".sln") || f.endsWith(".slnx"));
        const testCmd = hasPkgJson ? "npm test --if-present" : hasDotnet ? "dotnet test --nologo --verbosity quiet" : null;
        if (testCmd) {
          try {
            const output = execSync(testCmd, { cwd, encoding: "utf-8", timeout: 120_000, stdio: "pipe" });
            const passMatch = output.match(/(\d+)\s+passed/i);
            const failMatch = output.match(/(\d+)\s+failed/i);
            testStatus = { status: "green", passed: passMatch ? parseInt(passMatch[1], 10) : null, failed: 0, command: testCmd };
          } catch (testErr) {
            const errOutput = (testErr.stdout || "") + (testErr.stderr || "");
            const passMatch = errOutput.match(/(\d+)\s+passed/i);
            const failMatch = errOutput.match(/(\d+)\s+failed/i);
            testStatus = { status: "red", passed: passMatch ? parseInt(passMatch[1], 10) : 0, failed: failMatch ? parseInt(failMatch[1], 10) : 1, command: testCmd };
          }
        }
      } catch { /* test detection is best-effort */ }

      const history = readForgeJsonl("drift-history.json", [], cwd);
      const prev = history.length ? history[history.length - 1] : null;
      const delta = prev ? score - prev.score : 0;
      const trend = !prev ? "stable" : delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";

      const record = { timestamp: new Date().toISOString(), score, violations: analysis.violations, frameworkViolations: analysis.frameworkViolations || [], filesScanned: analysis.filesScanned, delta, trend };
      appendForgeJsonl("drift-history.json", record, cwd);

      if (score < threshold) {
        activeHub?.broadcast({ type: "drift-alert", data: { score, threshold, violations: analysis.violations.length }, timestamp: record.timestamp });
        activeBridge?.dispatch?.({ type: "drift-alert", score, threshold });
      }

      const result = { score, violations: analysis.violations, frameworkViolations: analysis.frameworkViolations || [], filesScanned: analysis.filesScanned, trend, delta, historyLength: history.length + 1, testStatus };

      // E1: Auto-chain drift → incident → fix proposal for high/critical violations
      if (args.autoIncident) {
        const severeViolations = analysis.violations.filter(v => v.severity === "high" || v.severity === "critical");
        if (severeViolations.length > 0) {
          // Group by file for cleaner incidents
          const byFile = {};
          for (const v of severeViolations) {
            if (!byFile[v.file]) byFile[v.file] = [];
            byFile[v.file].push(v);
          }
          const autoIncidents = [];
          for (const [file, violations] of Object.entries(byFile)) {
            const desc = violations.map(v => `${v.rule} at line ${v.line}`).join("; ");
            const incRecord = {
              id: `inc-drift-${Date.now()}-${file.replace(/[/\\]/g, "-")}`,
              description: `Drift violation in ${file}: ${desc}`,
              severity: violations.some(v => v.severity === "critical") ? "critical" : "high",
              files: [file],
              capturedAt: new Date().toISOString(),
              resolvedAt: null,
              mttr: null,
              source: "auto-drift",
            };
            appendForgeJsonl("incidents.jsonl", incRecord, cwd);
            autoIncidents.push(incRecord.id);
          }
          result.autoIncidents = autoIncidents;

          // Generate fix proposal from the latest drift data
          try {
            const fixId = `drift-auto-${Date.now()}`;
            const autoDir = resolve(cwd, "docs/plans/auto");
            mkdirSync(autoDir, { recursive: true });
            const planName = `LIVEGUARD-FIX-${fixId}.md`;
            const planPath = resolve(autoDir, planName);
            if (!existsSync(planPath)) {
              let planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n`;
              planContent += `> Generated: ${new Date().toISOString()}\n`;
              planContent += `> Source: drift (auto-incident)\n\n`;
              planContent += `## Scope Contract\n\nThis plan addresses ${severeViolations.length} high/critical drift violation(s) detected by LiveGuard.\n\n`;
              for (const [file, violations] of Object.entries(byFile)) {
                planContent += `## Slice — Fix: ${file}\n\n`;
                planContent += `**Tasks:**\n`;
                for (const v of violations) planContent += `- [ ] Fix ${v.rule} at line ${v.line}: ${v.description}\n`;
                // E2: Include code snippet around each violation
                try {
                  const filePath = resolve(cwd, file);
                  if (existsSync(filePath)) {
                    const lines = readFileSync(filePath, "utf-8").split("\n");
                    for (const v of violations.slice(0, 3)) {
                      const start = Math.max(0, v.line - 6);
                      const end = Math.min(lines.length, v.line + 5);
                      const snippet = lines.slice(start, end).map((l, i) => {
                        const num = start + i + 1;
                        const marker = num === v.line ? " >>>" : "    ";
                        return `${marker} ${String(num).padStart(4)}| ${l}`;
                      }).join("\n");
                      planContent += `\n**Code at violation (line ${v.line}):**\n\`\`\`\n${snippet}\n\`\`\`\n`;
                    }
                  }
                } catch { /* file read error — skip snippet */ }
                planContent += `\n**Scope:** ${file}\n\n`;
              }
              writeFileSync(planPath, planContent, "utf-8");
              result.autoFixPlan = `docs/plans/auto/${planName}`;
            }
          } catch { /* fix proposal generation is best-effort */ }
        }
      }

      emitToolTelemetry("forge_drift_report", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_drift_report", "OK", Date.now() - t0, { score, appViolations: analysis.violations.length, testStatus: testStatus?.status || null });

      // Auto-capture to memory when violations found
      if (analysis.violations.length > 0) {
        captureMemory(
          `Drift: ${analysis.violations.length} violation(s) — ${[...new Set(analysis.violations.map(v => v.rule))].join(", ")} in ${[...new Set(analysis.violations.map(v => v.file))].join(", ")}. Score: ${score}/100.`,
          "gotcha", "forge_drift_report", cwd
        );
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Drift report error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_runbook") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const planPath = resolve(cwd, args.plan);

      if (!existsSync(planPath)) {
        return { content: [{ type: "text", text: `Plan file not found: ${args.plan}` }], isError: true };
      }

      const plan = parsePlan(planPath, cwd);
      const includeIncidents = args.includeIncidents !== false;
      const content = generateRunbook(plan, cwd, { includeIncidents });

      const runbookName = planNameToRunbookName(planPath);
      const runbooksDir = resolve(cwd, ".forge", "runbooks");
      mkdirSync(runbooksDir, { recursive: true });
      writeFileSync(resolve(runbooksDir, runbookName), content, "utf-8");

      const result = { runbook: `.forge/runbooks/${runbookName}`, slices: plan.slices.length, generatedAt: new Date().toISOString() };
      emitToolTelemetry("forge_runbook", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_runbook", "OK", Date.now() - t0);

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Runbook error: ${err.message}` }], isError: true };
    }
  }

  if (name === "forge_hotspot") {
    try {
      const t0 = Date.now();
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const top = Math.max(1, Math.min(100, args.top ?? 10));
      const since = args.since || "6 months ago";

      const cacheFile = resolve(cwd, ".forge", "hotspot-cache.json");
      let cached = null;
      if (existsSync(cacheFile)) {
        try {
          cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
          const age = Date.now() - new Date(cached.generatedAt).getTime();
          if (age > 24 * 60 * 60 * 1000 || cached.since !== since) cached = null;
        } catch { cached = null; }
      }

      if (!cached) {
        const raw = execSync(`git log --format=format: --name-only --since="${since}"`, { cwd, encoding: "utf-8", timeout: 30_000 });
        const counts = {};
        for (const line of raw.split("\n")) {
          const f = line.trim();
          if (f && !f.startsWith(".forge/")) counts[f] = (counts[f] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const hotspots = sorted.map(([file, commits]) => ({ file, commits }));

        mkdirSync(resolve(cwd, ".forge"), { recursive: true });
        cached = { generatedAt: new Date().toISOString(), since, totalFiles: hotspots.length, hotspots };
        writeFileSync(cacheFile, JSON.stringify(cached, null, 2), "utf-8");
      }

      const result = { ...cached, hotspots: cached.hotspots.slice(0, top), showing: Math.min(top, cached.hotspots.length) };
      emitToolTelemetry("forge_hotspot", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_hotspot", "OK", Date.now() - t0);

      // Auto-capture hotspot patterns
      if (result.hotspots?.length > 0) {
        const top3 = result.hotspots.slice(0, 3).map(h => h.file).join(", ");
        captureMemory(
          `Hotspots (top ${result.showing}): ${top3}. ${result.totalFiles} files analyzed.`,
          "pattern", "forge_hotspot", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Hotspot analysis error: ${err.message}` }], isError: true };
    }
  }

  // ─── forge_dep_watch — dependency vulnerability scan ───
  if (name === "forge_dep_watch") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const notify = args.notify !== false;
      const snapshotPath = resolve(cwd, ".forge", "deps-snapshot.json");
      const pkgPath = resolve(cwd, "package.json");

      // Detect project type: npm or dotnet
      const hasPkgJson = existsSync(pkgPath);
      const csprojFiles = hasPkgJson ? [] : readdirSync(cwd).filter(f => f.endsWith(".csproj") || f.endsWith(".sln") || f.endsWith(".slnx"));
      const isDotnet = !hasPkgJson && csprojFiles.length > 0;

      if (!hasPkgJson && !isDotnet) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "No package.json or .csproj/.sln/.slnx found — project type not supported", newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 0, snapshot: null }) }], isError: false };
      }

      // Load previous snapshot
      let prevSnapshot = null;
      if (existsSync(snapshotPath)) {
        try { prevSnapshot = JSON.parse(readFileSync(snapshotPath, "utf-8")); } catch { prevSnapshot = null; }
      }

      let currentVulns = [];

      if (isDotnet) {
        // .NET: dotnet list package --vulnerable
        let dotnetOutput;
        try {
          dotnetOutput = execSync("dotnet list package --vulnerable --format json 2>&1", { cwd, encoding: "utf-8", timeout: 120_000 });
        } catch (err) {
          const raw = err.stdout || err.stderr || err.message || "";
          // Try parsing even on non-zero exit (dotnet may exit 1 when vulns found)
          try { dotnetOutput = raw; } catch { dotnetOutput = null; }
          if (!dotnetOutput) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `dotnet list package --vulnerable failed: ${err.message}`, newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 0, snapshot: null }) }], isError: true };
          }
        }

        // Parse dotnet JSON output
        try {
          const parsed = JSON.parse(dotnetOutput);
          const projects = parsed.projects || [];
          for (const proj of projects) {
            for (const fw of (proj.frameworks || [])) {
              for (const pkg of (fw.topLevelPackages || [])) {
                if (pkg.vulnerabilities && pkg.vulnerabilities.length > 0) {
                  for (const vuln of pkg.vulnerabilities) {
                    const severity = (vuln.severity || "unknown").toLowerCase();
                    currentVulns.push({ name: pkg.id, severity, via: [vuln.advisoryurl || ""], range: `${pkg.resolvedVersion || ""}` });
                  }
                }
              }
              for (const pkg of (fw.transitivePackages || [])) {
                if (pkg.vulnerabilities && pkg.vulnerabilities.length > 0) {
                  for (const vuln of pkg.vulnerabilities) {
                    const severity = (vuln.severity || "unknown").toLowerCase();
                    currentVulns.push({ name: pkg.id, severity, via: [vuln.advisoryurl || ""], range: `${pkg.resolvedVersion || ""}` });
                  }
                }
              }
            }
          }
        } catch {
          // Fallback: parse text output line by line
          const lines = dotnetOutput.split("\n");
          for (const line of lines) {
            const match = line.match(/>\s+(\S+)\s+(\S+)\s+(\S+)\s+(Low|Moderate|High|Critical)/i);
            if (match) {
              currentVulns.push({ name: match[1], severity: match[4].toLowerCase().replace("moderate", "medium"), via: [], range: match[2] });
            }
          }
        }
      } else {
        // npm audit
        let auditResult;
        try {
          const raw = execSync("npm audit --json 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 });
          auditResult = JSON.parse(raw);
        } catch (err) {
          // npm audit exits non-zero when vulnerabilities are found — parse stdout
          if (err.stdout) {
            try { auditResult = JSON.parse(err.stdout); } catch { auditResult = null; }
          }
          if (!auditResult) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `npm audit failed: ${err.message}`, newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 0, snapshot: null }) }], isError: true };
          }
        }

        const vulns = auditResult.vulnerabilities || {};
        for (const [pkgName, info] of Object.entries(vulns)) {
          currentVulns.push({ name: pkgName, severity: info.severity || "unknown", via: Array.isArray(info.via) ? info.via.filter(v => typeof v === "string") : [], range: info.range || "" });
        }
      }

      // Compare with previous snapshot
      const prevVulnNames = new Set((prevSnapshot?.vulnerabilities || []).map(v => v.name));
      const currVulnNames = new Set(currentVulns.map(v => v.name));
      const newVulnerabilities = currentVulns.filter(v => !prevVulnNames.has(v.name));
      const resolvedVulnerabilities = (prevSnapshot?.vulnerabilities || []).filter(v => !currVulnNames.has(v.name));
      const unchanged = currentVulns.length - newVulnerabilities.length;

      // Save new snapshot
      mkdirSync(resolve(cwd, ".forge"), { recursive: true });
      const snapshot = { capturedAt: new Date().toISOString(), depCount: currentVulns.length, vulnerabilities: currentVulns };
      writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

      // Bridge notification for new vulnerabilities
      if (notify && newVulnerabilities.length > 0 && activeBridge) {
        activeBridge.dispatch?.({ type: "dep-vulnerability", newVulnerabilities: newVulnerabilities.map(v => ({ name: v.name, severity: v.severity })), count: newVulnerabilities.length });
      }

      const result = { newVulnerabilities, resolvedVulnerabilities, unchanged, snapshot: { capturedAt: snapshot.capturedAt, depCount: snapshot.depCount } };
      emitToolTelemetry("forge_dep_watch", args, result, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_dep_watch", "OK", Date.now() - t0);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Dependency watch error: ${err.message}` }], isError: true };
    }
  }

  // ─── forge_secret_scan — post-commit entropy analysis ───
  if (name === "forge_secret_scan") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const since = args.since || "HEAD~1";
      const threshold = Math.max(3.5, Math.min(5.0, args.threshold ?? 4.0));

      // Shannon entropy — pure JS, zero dependencies
      function shannonEntropy(str) {
        if (!str || str.length === 0) return 0;
        const freq = {};
        for (const char of str) freq[char] = (freq[char] || 0) + 1;
        let entropy = 0;
        for (const count of Object.values(freq)) {
          const p = count / str.length;
          entropy -= p * Math.log2(p);
        }
        return entropy;
      }

      const KEY_PATTERNS = /(?:key|secret|token|password|api_key|auth|credential|private)/i;

      // Graceful degradation when git is unavailable
      let diffOutput;
      try {
        diffOutput = execSync(`git diff ${since}`, { cwd, encoding: "utf-8", timeout: 30_000 });
      } catch (err) {
        if (err.status === 128 || (err.message && err.message.includes("not a git repository"))) {
          const graceful = { clean: null, scannedFiles: 0, findings: [], error: "git unavailable" };
          emitToolTelemetry("forge_secret_scan", args, graceful, Date.now() - t0, "DEGRADED", cwd);
          return { content: [{ type: "text", text: JSON.stringify(graceful, null, 2) }], isError: false };
        }
        throw err;
      }

      // Parse diff: extract added lines with file context
      const findings = [];
      const scannedFiles = new Set();
      let currentFile = null;
      let lineNumber = 0;
      for (const line of diffOutput.split("\n")) {
        if (line.startsWith("+++ b/")) {
          currentFile = line.slice(6);
          scannedFiles.add(currentFile);
          continue;
        }
        if (line.startsWith("@@ ")) {
          const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
          lineNumber = match ? parseInt(match[1], 10) - 1 : 0;
          continue;
        }
        if (line.startsWith("+") && !line.startsWith("+++")) {
          lineNumber++;
          const added = line.slice(1);
          // Extract tokens: quoted strings and long unbroken sequences
          const tokens = added.match(/["']([^"']{8,})["']|(?:=|:|=>)\s*["']?([^\s"',;]{8,})["']?/g) || [];
          for (const raw of tokens) {
            const cleaned = raw.replace(/^[=:>]\s*["']?|["']$/g, "").replace(/^["']/, "");
            if (cleaned.length < 8) continue;
            const entropy = shannonEntropy(cleaned);
            if (entropy < threshold) continue;

            const keyMatch = KEY_PATTERNS.test(added);
            let confidence;
            if (entropy >= 4.5 && keyMatch) confidence = "high";
            else if ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) confidence = "medium";
            else confidence = "low";

            // Infer type from key-name heuristic
            let type = "unknown";
            const lowerLine = added.toLowerCase();
            if (/api.?key/i.test(lowerLine)) type = "api_key";
            else if (/secret/i.test(lowerLine)) type = "secret";
            else if (/token/i.test(lowerLine)) type = "token";
            else if (/password|passwd/i.test(lowerLine)) type = "password";
            else if (/auth/i.test(lowerLine)) type = "auth";
            else if (/private/i.test(lowerLine)) type = "private_key";
            else if (/credential/i.test(lowerLine)) type = "credential";

            findings.push({
              file: currentFile,
              line: lineNumber,
              type,
              entropyScore: Math.round(entropy * 100) / 100,
              masked: "<REDACTED>",
              confidence,
            });
          }
        } else if (!line.startsWith("-")) {
          lineNumber++;
        }
      }

      const clean = findings.length === 0;
      const result = {
        scannedAt: new Date().toISOString(),
        since,
        threshold,
        scannedFiles: scannedFiles.size,
        clean,
        findings,
      };

      // Write cache
      mkdirSync(resolve(cwd, ".forge"), { recursive: true });
      writeFileSync(resolve(cwd, ".forge", "secret-scan-cache.json"), JSON.stringify(result, null, 2), "utf-8");

      // Deploy journal sidecar annotation
      try {
        const journalPath = resolve(cwd, ".forge", "deploy-journal.jsonl");
        if (existsSync(journalPath)) {
          const deploys = readForgeJsonl("deploy-journal.jsonl", [], cwd);
          if (deploys.length > 0) {
            const lastDeploy = deploys[deploys.length - 1];
            let headSha = null;
            try { headSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim(); } catch { /* skip */ }
            if (headSha && lastDeploy.id) {
              const sidecarPath = resolve(cwd, ".forge", "deploy-journal-meta.json");
              let sidecar = {};
              try { if (existsSync(sidecarPath)) sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8")); } catch { sidecar = {}; }
              sidecar[lastDeploy.id] = {
                ...(sidecar[lastDeploy.id] || {}),
                secretScanClean: clean,
                secretScanAt: result.scannedAt,
              };
              writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), "utf-8");
            }
          }
        }
      } catch { /* best-effort sidecar annotation */ }

      emitToolTelemetry("forge_secret_scan", args, { clean, findings: findings.length, scannedFiles: scannedFiles.size }, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_secret_scan", "OK", Date.now() - t0);

      // Auto-capture if secrets found
      if (!clean) {
        captureMemory(
          `Secret scan: ${findings.length} high-entropy finding(s) in ${scannedFiles.size} file(s). Review and rotate if confirmed.`,
          "gotcha", "forge_secret_scan", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Secret scan error: ${err.message}` }], isError: true };
    }
  }

  // ─── forge_env_diff — environment key comparison ───
  if (name === "forge_env_diff") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const baselinePath = resolve(cwd, args.baseline || ".env");

      // Stop condition: baseline not found → return error object, no throw
      if (!existsSync(baselinePath)) {
        const graceful = { pairs: [], summary: { clean: null, error: `baseline file not found: ${args.baseline || ".env"}` } };
        emitToolTelemetry("forge_env_diff", args, graceful, Date.now() - t0, "DEGRADED", cwd);
        return { content: [{ type: "text", text: JSON.stringify(graceful, null, 2) }], isError: false };
      }

      // Parse .env keys (key names only — never values)
      function parseEnvKeys(filePath) {
        const content = readFileSync(filePath, "utf-8");
        const keys = new Set();
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx > 0) keys.add(trimmed.slice(0, eqIdx).trim());
        }
        return keys;
      }

      const baselineKeys = parseEnvKeys(baselinePath);

      // Resolve target files
      let targetFiles = [];
      if (args.files) {
        targetFiles = args.files.split(",").map(f => f.trim()).filter(Boolean);
      } else {
        // Auto-detect .env.* files in project root
        try {
          const entries = readdirSync(cwd);
          targetFiles = entries.filter(f => f.startsWith(".env.") && !f.endsWith(".example")).sort();
        } catch { targetFiles = []; }
      }

      const pairs = [];
      for (const targetFile of targetFiles) {
        const targetPath = resolve(cwd, targetFile);
        if (!existsSync(targetPath)) {
          pairs.push({ file: targetFile, missingInTarget: [], missingInBaseline: [], error: `file not found: ${targetFile}` });
          continue;
        }
        const targetKeys = parseEnvKeys(targetPath);
        const missingInTarget = [...baselineKeys].filter(k => !targetKeys.has(k)).sort();
        const missingInBaseline = [...targetKeys].filter(k => !baselineKeys.has(k)).sort();
        pairs.push({ file: targetFile, missingInTarget, missingInBaseline });
      }

      const totalGaps = pairs.reduce((sum, p) => sum + (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0), 0);
      const clean = totalGaps === 0;

      const result = {
        scannedAt: new Date().toISOString(),
        baseline: args.baseline || ".env",
        filesCompared: targetFiles.length,
        pairs,
        summary: { clean, totalGaps, baselineKeyCount: baselineKeys.size },
      };

      // Write cache (key names only, never values)
      mkdirSync(resolve(cwd, ".forge"), { recursive: true });
      writeFileSync(resolve(cwd, ".forge", "env-diff-cache.json"), JSON.stringify(result, null, 2), "utf-8");

      // G2.7 (v2.36): also append a compact history record so trend analysis
      // and the dashboard can see env-drift over time without re-reading the
      // single-snapshot cache. Keys only — values are never recorded.
      try {
        appendForgeJsonl("env-diff-history.jsonl", {
          scannedAt: result.scannedAt,
          baseline: result.baseline,
          filesCompared: result.filesCompared,
          totalGaps,
          clean,
          baselineKeyCount: baselineKeys.size,
          pairs: pairs.map((p) => ({
            file: p.file,
            missingInTargetCount: p.missingInTarget?.length || 0,
            missingInBaselineCount: p.missingInBaseline?.length || 0,
          })),
        }, cwd);
      } catch { /* best-effort history */ }

      emitToolTelemetry("forge_env_diff", args, { clean, totalGaps, filesCompared: targetFiles.length }, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_env_diff", "OK", Date.now() - t0);

      // Auto-capture env gaps
      if (totalGaps > 0) {
        captureMemory(
          `Env diff: ${totalGaps} missing key(s) across ${targetFiles.length} env file(s). Ensure all environments have required keys.`,
          "gotcha", "forge_env_diff", cwd
        );
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Env diff error: ${err.message}` }], isError: true };
    }
  }

  // ─── forge_fix_proposal — generate fix plan from LiveGuard data ───
  if (name === "forge_fix_proposal") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const source = args.source || "auto";
      const incidentId = args.incidentId || null;

      // Determine fix source data
      let sourceData = {};
      let fixId = "";

      if (source === "incident" || (source === "auto" && incidentId)) {
        if (!incidentId) return { content: [{ type: "text", text: "incidentId required for incident source" }], isError: true };
        const incidents = readForgeJsonl("incidents.jsonl", [], cwd);
        if (!incidents.length) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "no incident data — run pforge incident first", planFile: null }) }], isError: false };
        }
        const incident = incidents.find((i) => i.id === incidentId || i.incidentId === incidentId);
        if (!incident) return { content: [{ type: "text", text: `Incident not found: ${incidentId}` }], isError: true };
        sourceData = { type: "incident", incident };
        fixId = incidentId;
      } else if (source === "regression") {
        const regPath = resolve(cwd, ".forge", "regression-gates.json");
        if (!existsSync(regPath)) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "no regression data — run pforge regression-guard first", planFile: null }) }], isError: false };
        }
        try {
          const regData = JSON.parse(readFileSync(regPath, "utf-8"));
          if (!regData || (Array.isArray(regData) && regData.length === 0)) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "no regression data — run pforge regression-guard first", planFile: null }) }], isError: false };
          }
          sourceData = { type: "regression", regression: regData };
        } catch {
          return { content: [{ type: "text", text: JSON.stringify({ error: "no regression data — run pforge regression-guard first", planFile: null }) }], isError: false };
        }
        fixId = `regression-${Date.now()}`;
      } else if (source === "drift" || source === "auto") {
        const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
        if (!driftHistory.length) {
          if (source === "drift") {
            return { content: [{ type: "text", text: JSON.stringify({ error: "no drift data — run pforge drift first", planFile: null }) }], isError: false };
          }
          // auto mode: fall through to try other sources below
        } else {
          const latest = driftHistory[driftHistory.length - 1];
          sourceData = { type: "drift", drift: latest };
          fixId = `drift-${Date.now()}`;
        }
      }

      // auto mode: try secret if no source found yet
      if (source === "secret" || (source === "auto" && !fixId)) {
        const scanPath = resolve(cwd, ".forge", "secret-scan-cache.json");
        if (!existsSync(scanPath)) {
          if (source === "secret") {
            return { content: [{ type: "text", text: JSON.stringify({ error: "no secret scan data — run pforge secret-scan first", planFile: null }) }], isError: false };
          }
        } else {
          try {
            const scan = JSON.parse(readFileSync(scanPath, "utf-8"));
            sourceData = { type: "secret", scan };
            fixId = `secret-${Date.now()}`;
          } catch {
            if (source === "secret") {
              return { content: [{ type: "text", text: JSON.stringify({ error: "no secret scan data — run pforge secret-scan first", planFile: null }) }], isError: false };
            }
          }
        }
      }

      if (!fixId) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "no LiveGuard data found — run drift, incident-capture, regression-guard, or secret-scan first", planFile: null }) }], isError: false };
      }

      // Check for duplicate
      const autoDir = resolve(cwd, "docs/plans/auto");
      mkdirSync(autoDir, { recursive: true });
      const planName = `LIVEGUARD-FIX-${fixId}.md`;
      const planPath = resolve(autoDir, planName);

      if (existsSync(planPath)) {
        return { content: [{ type: "text", text: JSON.stringify({ alreadyExists: true, plan: `docs/plans/auto/${planName}`, fixId }) }], isError: false };
      }

      // Generate fix plan
      const slices = [];
      if (sourceData.type === "incident") {
        const inc = sourceData.incident;
        const affectedFiles = inc.files || inc.affectedFiles || [];
        const desc = inc.description || inc.title || fixId;
        const sev = inc.severity || "medium";

        // Slice 1: Investigate with specific guidance
        const investTasks = [`Review incident: ${desc}`];
        if (affectedFiles.length > 0) {
          investTasks.push(`Inspect affected file(s): ${affectedFiles.join(", ")}`);
        }
        investTasks.push("Identify root cause — check for: empty catch blocks, inverted logic, missing validation, null references");
        investTasks.push("Document the exact code location and failure mechanism");

        // E2: Read code snippets around flagged lines for actionable context
        const codeSnippets = [];
        for (const file of affectedFiles) {
          try {
            const filePath = resolve(cwd, file);
            if (existsSync(filePath)) {
              const lines = readFileSync(filePath, "utf-8").split("\n");
              // Find line numbers from incident violations or drift data
              const violationLines = (inc.violations || []).filter(v => v.file === file).map(v => v.line);
              // Also check recent drift for this file
              if (violationLines.length === 0) {
                const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
                if (driftHistory.length) {
                  const latest = driftHistory[driftHistory.length - 1];
                  for (const v of (latest.violations || [])) {
                    if (v.file === file) violationLines.push(v.line);
                  }
                }
              }
              for (const lineNum of violationLines.slice(0, 3)) { // Max 3 snippets per file
                const start = Math.max(0, lineNum - 6);
                const end = Math.min(lines.length, lineNum + 5);
                const snippet = lines.slice(start, end).map((l, i) => {
                  const num = start + i + 1;
                  const marker = num === lineNum ? " >>>" : "    ";
                  return `${marker} ${String(num).padStart(4)}| ${l}`;
                }).join("\n");
                codeSnippets.push({ file, line: lineNum, snippet });
              }
            }
          } catch { /* file read error — skip snippet */ }
        }

        slices.push({
          title: `Investigate: ${desc}`,
          tasks: investTasks,
          scope: affectedFiles,
          codeSnippets,
        });

        // Slice 2: Apply fix with concrete validation
        const fixTasks = ["Implement the fix in the identified file(s)"];
        if (affectedFiles.length > 0) {
          fixTasks.push(`Add or update unit tests covering the fix in affected file(s)`);
        }
        fixTasks.push("Run regression guard to verify no side effects");
        fixTasks.push("Verify incident resolution by reproducing the original failure scenario");

        // Build concrete gate command based on project type
        let gateCmd = null;
        const hasCsproj = existsSync(resolve(cwd, "*.csproj")) || readdirSync(cwd).some(f => f.endsWith(".csproj") || f.endsWith(".sln"));
        const hasPkgJson = existsSync(resolve(cwd, "package.json"));
        if (hasCsproj) {
          gateCmd = "dotnet test";
          if (affectedFiles.length > 0) {
            // Try to derive a test filter from affected file names
            const testFilters = affectedFiles
              .map(f => basename(f, extname(f)).replace(/\.(cs|fs|vb)$/, ""))
              .filter(n => n.length > 0);
            if (testFilters.length > 0) {
              gateCmd = `dotnet test --filter "${testFilters.map(n => `FullyQualifiedName~${n}`).join("|")}"`;
            }
          }
        } else if (hasPkgJson) {
          gateCmd = "npm test";
        } else {
          gateCmd = "pforge regression-guard";
        }

        slices.push({
          title: `Apply Fix + Verify (${sev})`,
          tasks: fixTasks,
          scope: affectedFiles,
          gate: gateCmd,
        });
      } else if (sourceData.type === "drift") {
        slices.push({
          title: `Resolve Drift Violations (score: ${sourceData.drift?.score || "unknown"})`,
          tasks: ["Review drift violations", "Fix architectural deviations", "Re-run drift report to verify score improvement"],
          gate: "pforge drift",
        });
      } else if (sourceData.type === "secret") {
        slices.push({
          title: "Credential Rotation",
          tasks: ["Rotate any exposed credentials", "Update secret references to use environment variables or secret manager", "Remove hardcoded values from source"],
          gate: "pforge secret-scan --since HEAD~1",
        });
      } else {
        slices.push({
          title: `Fix: ${source}`,
          tasks: ["Investigate the issue", "Apply fix", "Validate"],
          gate: "pforge regression-guard",
        });
      }

      // Write plan
      let planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n`;
      planContent += `> Generated: ${new Date().toISOString()}\n`;
      planContent += `> Source: ${sourceData.type}\n\n`;
      planContent += `## Scope Contract\n\n`;
      planContent += `This plan addresses a ${sourceData.type} finding detected by LiveGuard.\n\n`;
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i];
        planContent += `## Slice ${i + 1} — ${s.title}\n\n`;
        planContent += `**Tasks:**\n`;
        for (const t of s.tasks) planContent += `- [ ] ${t}\n`;
        if (s.codeSnippets && s.codeSnippets.length > 0) {
          planContent += `\n**Code Context:**\n`;
          for (const cs of s.codeSnippets) {
            planContent += `\n\`${cs.file}\` line ${cs.line}:\n\`\`\`\n${cs.snippet}\n\`\`\`\n`;
          }
        }
        if (s.scope && s.scope.length > 0) {
          planContent += `\n**Scope:** ${s.scope.join(", ")}\n`;
        }
        if (s.gate) {
          planContent += `\n**Validation Gate:**\n\`\`\`bash\n${s.gate}\n\`\`\`\n`;
        }
        planContent += "\n";
      }

      writeFileSync(planPath, planContent, "utf-8");

      // Persist proposal record
      const proposalRecord = { fixId, plan: `docs/plans/auto/${planName}`, source: sourceData.type, sliceCount: slices.length, generatedAt: new Date().toISOString() };
      appendForgeJsonl("fix-proposals.json", proposalRecord, cwd);

      const result = { fixId, plan: `docs/plans/auto/${planName}`, source: sourceData.type, sliceCount: slices.length, alreadyExists: false };
      emitToolTelemetry("forge_fix_proposal", args, result, Date.now() - t0, "OK", cwd);
      activeHub?.broadcast({ type: "fix-proposal-ready", data: result });
      await broadcastLiveGuard("forge_fix_proposal", "OK", Date.now() - t0);

      // Auto-capture fix proposal
      captureMemory(
        `Fix proposal ${fixId}: ${sourceData.type} source, ${slices.length} slice(s). Plan: docs/plans/auto/${planName}.`,
        "decision", "forge_fix_proposal", cwd
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `Fix proposal error: ${err.message}` }], isError: true };
    }
  }

  // ─── forge_liveguard_run — composite LiveGuard health check ───
  if (name === "forge_liveguard_run") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : findProjectRoot(PROJECT_DIR);
      const threshold = Math.max(0, Math.min(100, args.threshold ?? 70));
      const penaltyPerViolation = 2;
      const report = {};

      // 1. Drift
      try {
        const analysis = await runAnalyze({ mode: "file", path: ".", cwd });
        const score = Math.max(0, 100 - (analysis.violations.length * penaltyPerViolation));
        report.drift = { score, appViolations: analysis.violations.length, frameworkViolations: (analysis.frameworkViolations || []).length, filesScanned: analysis.filesScanned };
      } catch (err) { report.drift = { error: err.message }; }

      // 2. Sweep (count app vs framework markers)
      try {
        const sweepResult = JSON.parse(execSync(
          process.platform === "win32"
            ? `powershell.exe -NoProfile -ExecutionPolicy Bypass -File pforge.ps1 sweep`
            : `bash pforge.sh sweep`,
          { cwd, encoding: "utf-8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } }
        ).trim() || "{}");
        report.sweep = { appMarkers: 0, ran: true };
        // Parse text output for marker counts
        const sweepText = typeof sweepResult === "string" ? sweepResult : "";
        const appMatch = sweepText.match(/FOUND (\d+)/);
        if (appMatch) report.sweep.appMarkers = parseInt(appMatch[1], 10);
      } catch (err) {
        const output = (err.stdout || err.stderr || "").trim();
        const appMatch = output.match(/FOUND (\d+)/);
        report.sweep = { appMarkers: appMatch ? parseInt(appMatch[1], 10) : 0, ran: true };
        if (output.includes("SWEEP CLEAN")) report.sweep.appMarkers = 0;
      }

      // 3. Secret scan (filtered to reduce false positives)
      try {
        const since = "HEAD~1";
        const scanThreshold = 4.5;
        let diff;
        // Exclude known noisy files and framework paths from git diff
        try { diff = execSync(`git diff ${since} -p -- . ":!package-lock.json" ":!*.min.js" ":!*.min.css" ":!*.map" ":!*.svg" ":!pforge-mcp/" ":!.github/" ":!pforge.ps1" ":!pforge.sh"`, { cwd, encoding: "utf-8", timeout: 30_000 }); } catch { diff = ""; }
        const findings = [];
        // Key patterns that indicate a real secret assignment
        const SECRET_KEY_PATTERN = /(?:password|secret|token|api[_-]?key|auth|credential|private[_-]?key|connection[_-]?string|bearer)\s*[:=]/i;
        if (diff) {
          for (const line of diff.split("\n")) {
            if (!line.startsWith("+") || line.startsWith("+++")) continue;
            const content = line.slice(1);
            if (content.length < 8 || content.length > 200) continue;
            if (/^[a-f0-9]{40,}$/i.test(content.trim())) continue;
            if (/^[A-Za-z0-9+/=]{50,}$/.test(content.trim())) continue;
            if (content.includes("integrity") && content.includes("sha")) continue;
            const charSet = new Set(content);
            const entropy = [...charSet].reduce((sum, c) => {
              const p = (content.split(c).length - 1) / content.length;
              return sum - p * Math.log2(p);
            }, 0);
            // Only flag if entropy is high AND line looks like a secret assignment
            if (entropy >= scanThreshold && SECRET_KEY_PATTERN.test(content)) {
              findings.push({ line: content.slice(0, 80), entropy: Math.round(entropy * 100) / 100 });
            }
          }
        }
        report.secrets = { findings: findings.length };
      } catch (err) { report.secrets = { error: err.message }; }

      // 4. Regression guard
      try {
        const regResult = await regressionGuard([], { cwd });
        report.regression = { gates: regResult.gatesChecked, passed: regResult.passed, failed: regResult.failed };
      } catch (err) { report.regression = { error: err.message }; }

      // 5. Dep watch (quick check)
      try {
        const pkgPath = resolve(cwd, "package.json");
        const hasPkgJson = existsSync(pkgPath);
        const hasDotnet = !hasPkgJson && readdirSync(cwd).some(f => f.endsWith(".csproj") || f.endsWith(".sln") || f.endsWith(".slnx"));
        if (hasPkgJson) {
          let auditResult;
          try {
            auditResult = JSON.parse(execSync("npm audit --json 2>&1", { cwd, encoding: "utf-8", timeout: 60_000 }));
          } catch (err) {
            if (err.stdout) try { auditResult = JSON.parse(err.stdout); } catch { auditResult = null; }
          }
          report.deps = { vulnerabilities: auditResult ? Object.keys(auditResult.vulnerabilities || {}).length : 0 };
        } else if (hasDotnet) {
          let vulnCount = 0;
          try {
            const raw = execSync("dotnet list package --vulnerable --format json 2>&1", { cwd, encoding: "utf-8", timeout: 120_000 });
            const parsed = JSON.parse(raw);
            for (const proj of (parsed.projects || [])) {
              for (const fw of (proj.frameworks || [])) {
                vulnCount += (fw.topLevelPackages || []).filter(p => p.vulnerabilities?.length).length;
                vulnCount += (fw.transitivePackages || []).filter(p => p.vulnerabilities?.length).length;
              }
            }
          } catch { /* parse error — skip */ }
          report.deps = { vulnerabilities: vulnCount };
        } else {
          report.deps = { skipped: true, reason: "no package.json or .csproj/.sln/.slnx" };
        }
      } catch (err) { report.deps = { error: err.message }; }

      // 6. Alert triage
      try {
        const incidents = readForgeJsonl("incidents.jsonl", [], cwd).filter(i => !i.resolvedAt);
        const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
        const latestViolations = driftHistory.length ? (driftHistory[driftHistory.length - 1].violations || []) : [];
        const criticalAlerts = [...incidents.filter(i => i.severity === "critical" || i.severity === "high"), ...latestViolations.filter(v => v.severity === "critical" || v.severity === "high")];
        report.alerts = { critical: criticalAlerts.filter(a => (a.severity) === "critical").length, high: criticalAlerts.filter(a => (a.severity) === "high").length, openIncidents: incidents.length };
      } catch (err) { report.alerts = { error: err.message }; }

      // 7. Health trend summary
      try {
        const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
        const recentScores = driftHistory.slice(-5).map(d => d.score).filter(s => typeof s === "number");
        const avgScore = recentScores.length ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length) : null;
        const trend = recentScores.length >= 2 ? (recentScores[recentScores.length - 1] > recentScores[0] ? "improving" : recentScores[recentScores.length - 1] < recentScores[0] ? "degrading" : "stable") : "stable";
        report.health = { avgScore, trend, dataPoints: driftHistory.length };
      } catch (err) { report.health = { error: err.message }; }

      // 8. Diff (optional, only if plan specified)
      if (args.plan) {
        try {
          const planPath = resolve(cwd, args.plan);
          if (existsSync(planPath)) {
            const plan = parsePlan(planPath, cwd);
            const forbidden = plan.scopeContract?.forbidden || [];
            report.diff = { plan: args.plan, forbiddenPaths: forbidden.length, checked: true };
          } else {
            report.diff = { error: `Plan not found: ${args.plan}` };
          }
        } catch (err) { report.diff = { error: err.message }; }
      }

      // Overall status
      const driftOk = !report.drift.error && (report.drift.score ?? 0) >= threshold;
      const secretsOk = !report.secrets?.error && (report.secrets?.findings ?? 0) === 0;
      const regressionOk = !report.regression?.error && (report.regression?.failed ?? 0) === 0;
      const depsOk = !report.deps?.error && (report.deps?.vulnerabilities ?? 0) === 0;
      const alertsOk = !report.alerts?.error && (report.alerts?.critical ?? 0) === 0;
      report.overallStatus = (driftOk && secretsOk && regressionOk && depsOk && alertsOk) ? "green" : (!regressionOk || !secretsOk) ? "red" : "yellow";

      emitToolTelemetry("forge_liveguard_run", args, report, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_liveguard_run", "OK", Date.now() - t0, { overallStatus: report.overallStatus, driftScore: report.drift?.score, gates: report.regression?.gates, secrets: report.secrets?.findings });

      // Auto-capture health snapshot to memory
      captureMemory(
        `LiveGuard health: drift ${report.drift?.score ?? "?"}/100, ${report.regression?.passed ?? 0}/${report.regression?.gates ?? 0} gates, ${report.alerts?.openIncidents ?? 0} open incidents, ${report.deps?.vulnerabilities ?? 0} vulnerabilities. Status: ${report.overallStatus}.`,
        "decision", "forge_liveguard_run", cwd
      );
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: `LiveGuard run error: ${err.message}` }], isError: true };
    }
  }

  // ─── forge_quorum_analyze — assemble structured quorum prompt ───
  if (name === "forge_quorum_analyze") {
    const t0 = Date.now();
    try {
      const cwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const source = args.source || "all";
      const customQuestion = args.customQuestion || null;
      const analysisGoal = args.analysisGoal || null;
      const quorumSize = Math.max(1, Math.min(10, parseInt(args.quorumSize) || 3));
      const targetFile = args.targetFile || null;

      // Validate customQuestion length and XSS
      if (customQuestion) {
        if (customQuestion.length > 500) {
          return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: "customQuestion exceeds 500 character limit" }) }], isError: true };
        }
        if (/<script|javascript:|on\w+=/i.test(customQuestion)) {
          return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: "customQuestion contains disallowed content" }) }], isError: true };
        }
      }

      // analysisGoal preset map
      const GOAL_PRESETS = {
        "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
        "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
        "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
        "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
      };

      // Section 1: Context — gather LiveGuard data based on source
      const context = {};
      let oldestTimestamp = null;

      const trackAge = (ts) => {
        if (ts && (!oldestTimestamp || ts < oldestTimestamp)) oldestTimestamp = ts;
      };

      if (targetFile) {
        // Load a specific file from .forge/
        const data = readForgeJson(targetFile, null, cwd);
        if (data) {
          context.targetFile = data;
          if (data.timestamp) trackAge(data.timestamp);
        }
      } else {
        if (source === "all" || source === "drift") {
          const driftHistory = readForgeJsonl("drift-history.json", [], cwd);
          if (driftHistory.length) {
            const recent = driftHistory.slice(-5);
            context.drift = recent;
            trackAge(recent[0]?.timestamp);
          }
        }
        if (source === "all" || source === "incident") {
          const incidents = readForgeJsonl("incidents.jsonl", [], cwd).slice(-10);
          if (incidents.length) {
            context.incidents = incidents;
            trackAge(incidents[0]?.capturedAt);
          }
        }
        if (source === "all" || source === "triage") {
          const triageCache = readForgeJson("alert-triage-cache.json", null, cwd);
          if (triageCache) {
            context.triage = triageCache;
            trackAge(triageCache.generatedAt || triageCache.timestamp);
          }
        }
        if (source === "all" || source === "runbook") {
          const runbooksDir = resolve(cwd, ".forge/runbooks");
          if (existsSync(runbooksDir)) {
            try {
              const files = readdirSync(runbooksDir).filter(f => f.endsWith("-runbook.md")).slice(-3);
              if (files.length) {
                context.runbooks = files.map(f => {
                  const content = readFileSync(resolve(runbooksDir, f), "utf-8").slice(0, 2000);
                  const stat = statSync(resolve(runbooksDir, f));
                  trackAge(stat.mtime.toISOString());
                  return { file: f, preview: content };
                });
              }
            } catch { /* skip */ }
          }
        }
        if (source === "all" || source === "fix-proposal") {
          const proposals = readForgeJsonl("fix-proposals.json", [], cwd).slice(-5);
          if (proposals.length) {
            context.fixProposals = proposals;
            trackAge(proposals[0]?.generatedAt || proposals[0]?.timestamp);
          }
        }
      }

      // Stop condition: if specific source requested and no data found
      if (source !== "all" && !targetFile && Object.keys(context).length === 0) {
        const result = { quorumPrompt: null, error: `no ${source} data available — run the corresponding LiveGuard tool first` };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
      }

      // Section 2: Question — customQuestion overrides analysisGoal
      let questionUsed;
      if (customQuestion) {
        questionUsed = customQuestion;
      } else if (analysisGoal && GOAL_PRESETS[analysisGoal]) {
        questionUsed = GOAL_PRESETS[analysisGoal];
      } else {
        // Default to risk-assess preset
        questionUsed = GOAL_PRESETS["risk-assess"];
      }

      // Section 3: Voting instruction
      const votingInstruction = `Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= 60 and majority consensus. Quorum size: ${quorumSize} models.`;

      // Build the 3-section quorum prompt string
      const contextStr = JSON.stringify(context, null, 2);
      const quorumPrompt = `## Context\n${contextStr}\n\n## Question\n${questionUsed}\n\n## Voting Instruction\n${votingInstruction}`;

      // suggestedModels from .forge.json quorum.models (config is source of truth)
      const qConfig = loadQuorumConfig(cwd);
      const suggestedModels = (qConfig.models || ["claude-opus-4.6", "grok-4.20", "gemini-3-pro-preview"]).slice(0, quorumSize);

      // promptTokenEstimate
      const promptTokenEstimate = Math.ceil(quorumPrompt.length / 4);

      // dataSnapshotAge
      let dataSnapshotAge = "unknown";
      if (oldestTimestamp) {
        const ageMs = Date.now() - new Date(oldestTimestamp).getTime();
        const ageMins = Math.round(ageMs / 60000);
        dataSnapshotAge = ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
      }

      const result = { quorumPrompt, promptTokenEstimate, suggestedModels, dataSnapshotAge, questionUsed };
      emitToolTelemetry("forge_quorum_analyze", args, { source, questionLength: questionUsed.length }, Date.now() - t0, "OK", cwd);
      await broadcastLiveGuard("forge_quorum_analyze", "OK", Date.now() - t0);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ quorumPrompt: null, error: `Quorum analyze error: ${err.message}` }) }], isError: true };
    }
  }

  // ─── forge_smith — onCall validation enhancement ───
  if (name === "forge_smith") {
    const result = executeTool(name, args || {});
    let output = result.success ? result.output : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}`;
    try {
      const smithCwd = args.path ? findProjectRoot(resolve(args.path)) : PROJECT_DIR;
      const forgeJsonPath = resolve(smithCwd, ".forge.json");
      if (existsSync(forgeJsonPath)) {
        const config = JSON.parse(readFileSync(forgeJsonPath, "utf-8"));
        if (config.onCall) {
          const missing = [];
          if (!config.onCall.name) missing.push("name");
          if (!config.onCall.channel) missing.push("channel");
          if (missing.length) output += `\n\n⚠️  .forge.json: onCall is configured but missing required field(s): ${missing.join(", ")}. Incident notifications may not route correctly.`;
        }
      }
    } catch { /* .forge.json parse error — skip */ }
    return { content: [{ type: "text", text: output }], isError: !result.success };
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
export function createExpressApp() {
  const app = express();
  app.use(express.json());

  // Dashboard static files
  app.use("/dashboard", express.static(resolve(__dirname, "dashboard")));

  // Plan Browser static files
  app.use("/ui", express.static(resolve(__dirname, "ui")));

  // REST API: GET /api/version — server + framework version
  app.get("/api/version", (_req, res) => {
    try {
      const versionFile = resolve(PROJECT_DIR, "VERSION");
      const frameworkVersion = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : "unknown";
      res.json({ server: "2.10.2", framework: frameworkVersion });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/update-status — is there a newer Plan Forge release?
  // Returns the last cached check (may be null when suppressed / unavailable).
  // See `kickoffUpdateCheck()` below for the boot-time refresh.
  app.get("/api/update-status", async (_req, res) => {
    try {
      const versionFile = resolve(PROJECT_DIR, "VERSION");
      const current = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : null;
      if (!current) return res.json({ available: false, reason: "no-version-file" });
      // Serve from cache — never hit the network on a dashboard request.
      const result = await checkForUpdate({ currentVersion: current, projectDir: PROJECT_DIR });
      if (!result) return res.json({ available: false, current });
      return res.json({
        available: Boolean(result.isNewer),
        current: result.current,
        latest: result.latest,
        url: result.url,
        publishedAt: result.publishedAt,
        checkedAt: result.checkedAt,
        fromCache: result.fromCache,
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

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

  // REST API: GET /api/secrets — read .forge/secrets.json (masked values)
  app.get("/api/secrets", (_req, res) => {
    try {
      const secretsPath = resolve(PROJECT_DIR, ".forge", "secrets.json");
      if (!existsSync(secretsPath)) return res.json({ keys: {} });
      const secrets = JSON.parse(readFileSync(secretsPath, "utf-8"));
      // Mask values: show only last 4 chars
      const masked = {};
      for (const [key, value] of Object.entries(secrets)) {
        if (typeof value === "string" && value.length > 4) {
          masked[key] = { set: true, masked: "••••" + value.slice(-4) };
        } else if (typeof value === "string" && value.length > 0) {
          masked[key] = { set: true, masked: "••••" };
        } else {
          masked[key] = { set: false, masked: "" };
        }
      }
      // Also check env vars for known provider keys
      const envKeys = ["XAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENCLAW_API_KEY"];
      for (const ek of envKeys) {
        if (!masked[ek] && process.env[ek]) {
          masked[ek] = { set: true, masked: "••••" + process.env[ek].slice(-4), source: "env" };
        }
      }
      res.json({ keys: masked });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/secrets — write individual keys to .forge/secrets.json
  app.post("/api/secrets", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    try {
      const { key, value } = req.body || {};
      if (!key || typeof key !== "string") return res.status(400).json({ error: "key is required" });
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return res.status(400).json({ error: "key must be UPPER_SNAKE_CASE" });
      const secretsDir = resolve(PROJECT_DIR, ".forge");
      mkdirSync(secretsDir, { recursive: true });
      const secretsPath = resolve(secretsDir, "secrets.json");
      let secrets = {};
      if (existsSync(secretsPath)) {
        try { secrets = JSON.parse(readFileSync(secretsPath, "utf-8")); } catch { secrets = {}; }
      }
      if (value === "" || value === null || value === undefined) {
        delete secrets[key];
      } else {
        secrets[key] = value;
      }
      writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
      res.json({ success: true, key, action: value ? "set" : "removed" });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/cost — cost report
  app.get("/api/cost", (_req, res) => {
    try {
      res.json(getCostReport(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/memory/report — GX.3 (v2.36) memory health aggregator
  // Backs the Memory tab in the dashboard (GX.1).
  app.get("/api/memory/report", (_req, res) => {
    try {
      res.json(buildMemoryReport(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/health-trend — health trend analysis
  app.get("/api/health-trend", (_req, res) => {
    try {
      const days = Math.max(1, Math.min(365, parseInt(_req.query.days) || 30));
      const metrics = _req.query.metrics ? _req.query.metrics.split(",").map(m => m.trim()) : null;
      res.json(getHealthTrend(PROJECT_DIR, days, metrics));
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

  // REST API: GET /api/drift — run drift check
  app.get("/api/drift", async (_req, res) => {
    try {
      const threshold = Math.max(0, Math.min(100, parseInt(_req.query.threshold) || 70));
      const analysis = await runAnalyze({ mode: "file", path: ".", cwd: PROJECT_DIR });
      const score = Math.max(0, 100 - (analysis.violations.length * 2));
      const history = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
      const prev = history.length ? history[history.length - 1] : null;
      const delta = prev ? score - prev.score : 0;
      const trend = !prev ? "stable" : delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
      const record = { timestamp: new Date().toISOString(), score, violations: analysis.violations, filesScanned: analysis.filesScanned, delta, trend };
      appendForgeJsonl("drift-history.json", record, PROJECT_DIR);
      if (score < threshold) {
        activeHub?.broadcast({ type: "drift-alert", data: { score, threshold, violations: analysis.violations.length }, timestamp: record.timestamp });
      }
      res.json({ score, violations: analysis.violations, filesScanned: analysis.filesScanned, trend, delta, historyLength: history.length + 1 });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/drift/history — drift history
  app.get("/api/drift/history", (_req, res) => {
    try {
      res.json(readForgeJsonl("drift-history.json", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/regression-guard — run regression guard
  app.post("/api/regression-guard", async (req, res) => {
    try {
      const { files = [], plan = null, failFast = false } = req.body || {};
      if (!Array.isArray(files)) {
        return res.status(400).json({ error: "files must be an array of strings" });
      }
      const result = await regressionGuard(files, { plan, failFast, cwd: PROJECT_DIR });
      res.status(result.success ? 200 : 422).json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/incident — capture a new incident
  app.post("/api/incident", (req, res) => {
    try {
      const { description, severity = "medium", files = [], resolvedAt = null } = req.body || {};
      if (!description || typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ error: "description is required" });
      }
      const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
      if (!VALID_SEVERITIES.includes(severity)) {
        return res.status(400).json({ error: `severity must be one of: ${VALID_SEVERITIES.join(", ")}` });
      }
      const capturedAt = new Date().toISOString();
      let mttr = null;
      if (resolvedAt) {
        const resolvedMs = new Date(resolvedAt).getTime();
        if (isNaN(resolvedMs)) return res.status(400).json({ error: `Invalid resolvedAt: '${resolvedAt}'` });
        const capturedMs = new Date(capturedAt).getTime();
        if (resolvedMs < capturedMs) return res.status(400).json({ error: "resolvedAt must be after capturedAt" });
        mttr = resolvedMs - capturedMs;
      }
      const record = { id: `inc-${Date.now()}`, description: description.trim(), severity, files, capturedAt, resolvedAt, mttr };
      appendForgeJsonl("incidents.jsonl", record, PROJECT_DIR);
      activeHub?.broadcast({ type: "incident-captured", data: record, timestamp: capturedAt });
      // Bridge dispatch to onCall if configured
      try {
        const forgeConfig = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
        if (forgeConfig.onCall) activeBridge?.dispatch?.({ type: "incident-captured", severity, description: record.description, onCall: forgeConfig.onCall });
      } catch { /* no .forge.json or no onCall — skip */ }
      res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/incidents — list all captured incidents
  app.get("/api/incidents", (_req, res) => {
    try {
      res.json(readForgeJsonl("incidents.jsonl", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/deploy-journal — record a deployment
  app.post("/api/deploy-journal", (req, res) => {
    try {
      const { version, by = "unknown", notes = null, slice = null } = req.body || {};
      if (!version || typeof version !== "string" || !version.trim()) {
        return res.status(400).json({ error: "version is required" });
      }
      const record = {
        id: `deploy-${Date.now()}`,
        version: version.trim(),
        by: (by || "unknown").trim(),
        notes: notes ? notes.trim() : null,
        slice: slice ? slice.trim() : null,
        deployedAt: new Date().toISOString(),
      };
      appendForgeJsonl("deploy-journal.jsonl", record, PROJECT_DIR);
      activeHub?.broadcast({ type: "deploy-recorded", data: record, timestamp: record.deployedAt });
      res.status(201).json(record);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/deploy-journal — list all deploy journal entries
  app.get("/api/deploy-journal", (_req, res) => {
    try {
      res.json(readForgeJsonl("deploy-journal.jsonl", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/liveguard/traces — LiveGuard tool completion events
  app.get("/api/liveguard/traces", (_req, res) => {
    try {
      res.json(readForgeJsonl("liveguard-events.jsonl", [], PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/triage — prioritized alert triage (read-only)
  app.get("/api/triage", (req, res) => {
    try {
      const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
      const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };
      const minSeverity = SEVERITY_ORDER.includes(req.query.minSeverity) ? req.query.minSeverity : "low";
      const minIdx = SEVERITY_ORDER.indexOf(minSeverity);
      const maxResults = Math.max(1, Math.min(200, parseInt(req.query.max) || 20));

      const now = Date.now();
      const recencyFactor = (isoTimestamp) => {
        const age = now - new Date(isoTimestamp).getTime();
        const hours24 = 24 * 60 * 60 * 1000;
        if (age < hours24) return 1.0;
        if (age < 7 * hours24) return 0.8;
        if (age < 30 * hours24) return 0.5;
        return 0.3;
      };

      const alerts = [];

      // Open incidents
      const incidents = readForgeJsonl("incidents.jsonl", [], PROJECT_DIR);
      for (const inc of incidents) {
        if (inc.resolvedAt) continue;
        const sev = SEVERITY_ORDER.includes(inc.severity) ? inc.severity : "medium";
        if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
        const ts = inc.capturedAt || new Date(0).toISOString();
        const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
        alerts.push({ source: "incident", id: inc.id, description: inc.description, severity: sev, timestamp: ts, files: inc.files || [], priority: Math.round(priority * 100) / 100 });
      }

      // Latest drift violations
      const driftHistory = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
      if (driftHistory.length) {
        const latest = driftHistory[driftHistory.length - 1];
        for (const v of (latest.violations || [])) {
          const sev = SEVERITY_ORDER.includes(v.severity) ? v.severity : "medium";
          if (SEVERITY_ORDER.indexOf(sev) < minIdx) continue;
          const ts = latest.timestamp || new Date(0).toISOString();
          const priority = SEVERITY_WEIGHT[sev] * recencyFactor(ts);
          alerts.push({ source: "drift", id: `drift-${v.rule}-${v.file}:${v.line}`, description: `${v.rule}: ${v.file}:${v.line}`, severity: sev, timestamp: ts, files: [v.file], priority: Math.round(priority * 100) / 100 });
        }
      }

      alerts.sort((a, b) => b.priority - a.priority || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      res.json({ total: alerts.length, showing: Math.min(maxResults, alerts.length), minSeverity, alerts: alerts.slice(0, maxResults), generatedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/runbook — generate runbook from plan file
  app.post("/api/runbook", (req, res) => {
    try {
      const { plan, includeIncidents = true } = req.body || {};
      if (!plan || typeof plan !== "string") {
        return res.status(400).json({ error: "plan is required and must be a string" });
      }
      const planPath = resolve(PROJECT_DIR, plan);
      if (!existsSync(planPath)) {
        return res.status(404).json({ error: `Plan file not found: ${plan}` });
      }
      const parsed = parsePlan(planPath, PROJECT_DIR);
      const content = generateRunbook(parsed, PROJECT_DIR, { includeIncidents });
      const runbookName = planNameToRunbookName(planPath);
      const runbooksDir = resolve(PROJECT_DIR, ".forge", "runbooks");
      mkdirSync(runbooksDir, { recursive: true });
      writeFileSync(resolve(runbooksDir, runbookName), content, "utf-8");
      res.status(201).json({ runbook: `.forge/runbooks/${runbookName}`, slices: parsed.slices.length, generatedAt: new Date().toISOString() });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/runbooks — list generated runbooks
  app.get("/api/runbooks", (_req, res) => {
    try {
      const runbooksDir = resolve(PROJECT_DIR, ".forge", "runbooks");
      if (!existsSync(runbooksDir)) return res.json([]);
      const files = readdirSync(runbooksDir).filter((f) => f.endsWith(".md")).sort();
      res.json(files.map((f) => ({ file: `.forge/runbooks/${f}` })));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ─── v2.37 Crucible REST API (Slice 01.5) ──────────────────────────
  // Back the dashboard Crucible tab. Thin HTTP wrappers around the
  // crucible-server handlers that already power the MCP tools, so the
  // dashboard and the agent share one code path.

  // POST /api/crucible/submit — start a new smelt
  app.post("/api/crucible/submit", (req, res) => {
    try {
      const { rawIdea, lane = null, source = "human", parentSmeltId = null } = req.body || {};
      if (typeof rawIdea !== "string" || !rawIdea.trim()) {
        return res.status(400).json({ error: "rawIdea is required" });
      }
      const result = crucibleHandleSubmit({
        rawIdea,
        lane,
        source,
        parentSmeltId,
        projectDir: PROJECT_DIR,
        hub: activeHub,
      });
      res.status(201).json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/crucible/ask — record an answer and fetch the next question
  app.post("/api/crucible/ask", (req, res) => {
    try {
      const { id, answer } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleAsk({ id, answer, projectDir: PROJECT_DIR, hub: activeHub });
      res.json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/crucible/list — all smelts (optionally filtered by status)
  app.get("/api/crucible/list", (req, res) => {
    try {
      const status = typeof req.query?.status === "string" ? req.query.status : null;
      res.json(crucibleHandleList({ status, projectDir: PROJECT_DIR }));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/preview?id=… — live markdown preview + unresolved fields
  app.get("/api/crucible/preview", (req, res) => {
    try {
      const id = typeof req.query?.id === "string" ? req.query.id : null;
      if (!id) return res.status(400).json({ error: "id is required" });
      res.json(crucibleHandlePreview({ id, projectDir: PROJECT_DIR }));
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/crucible/finalize — emit docs/plans/Phase-NN.md
  app.post("/api/crucible/finalize", (req, res) => {
    try {
      const { id } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleFinalize({ id, projectDir: PROJECT_DIR, hub: activeHub });
      res.status(201).json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // POST /api/crucible/abandon — mark a smelt abandoned (no plan written)
  app.post("/api/crucible/abandon", (req, res) => {
    try {
      const { id } = req.body || {};
      if (typeof id !== "string" || !id) {
        return res.status(400).json({ error: "id is required" });
      }
      const result = crucibleHandleAbandon({ id, projectDir: PROJECT_DIR });
      res.json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // GET /api/crucible/config — load Crucible config (defaults if absent)
  app.get("/api/crucible/config", (_req, res) => {
    try {
      res.json(loadCrucibleConfig(PROJECT_DIR));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/crucible/config — persist Crucible config (sanitized)
  app.post("/api/crucible/config", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "body must be a JSON object" });
      }
      res.json(saveCrucibleConfig(PROJECT_DIR, req.body));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/manual-imports — read-only audit log for the
  // Governance tab. Newest first, capped at 500 so we never leak a
  // runaway log into the browser.
  app.get("/api/crucible/manual-imports", (_req, res) => {
    try {
      const entries = readManualImports(PROJECT_DIR);
      const capped = entries
        .slice()
        .reverse()
        .slice(0, 500);
      res.json({ total: entries.length, showing: capped.length, entries: capped });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/crucible/governance — read-only view of PROJECT-PRINCIPLES.md
  // and any project-profile files. Returns file content + mtime so the
  // Governance tab can render it and offer an "open in VS Code" deep link.
  app.get("/api/crucible/governance", (_req, res) => {
    try {
      const files = [
        { path: "docs/plans/PROJECT-PRINCIPLES.md", role: "principles" },
        { path: ".github/instructions/project-profile.instructions.md", role: "project-profile" },
        { path: ".github/instructions/project-principles.instructions.md", role: "principles-instruction" },
      ];
      const out = [];
      for (const f of files) {
        const abs = resolve(PROJECT_DIR, f.path);
        if (!existsSync(abs)) continue;
        try {
          const stat = statSync(abs);
          const content = readFileSync(abs, "utf-8");
          out.push({
            path: f.path,
            absolutePath: abs,
            role: f.role,
            mtime: stat.mtime.toISOString(),
            bytes: stat.size,
            content,
          });
        } catch { /* skip unreadable */ }
      }
      res.json({ files: out, readOnly: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/hotspots — git churn hotspot analysis (cache TTL 24h)
  app.get("/api/hotspots", (_req, res) => {
    try {
      const top = Math.max(1, Math.min(100, parseInt(_req.query.top) || 10));
      const since = _req.query.since || "6 months ago";
      const cacheFile = resolve(PROJECT_DIR, ".forge", "hotspot-cache.json");

      let cached = null;
      if (existsSync(cacheFile)) {
        try {
          cached = JSON.parse(readFileSync(cacheFile, "utf-8"));
          const age = Date.now() - new Date(cached.generatedAt).getTime();
          if (age > 24 * 60 * 60 * 1000 || cached.since !== since) cached = null;
        } catch { cached = null; }
      }

      if (!cached) {
        const raw = execSync(`git log --format=format: --name-only --since="${since}"`, { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 30_000 });
        const counts = {};
        for (const line of raw.split("\n")) {
          const f = line.trim();
          if (f && !f.startsWith(".forge/")) counts[f] = (counts[f] || 0) + 1;
        }
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const hotspots = sorted.map(([file, commits]) => ({ file, commits }));
        mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
        cached = { generatedAt: new Date().toISOString(), since, totalFiles: hotspots.length, hotspots };
        writeFileSync(cacheFile, JSON.stringify(cached, null, 2), "utf-8");
      }

      res.json({ ...cached, hotspots: cached.hotspots.slice(0, top), showing: Math.min(top, cached.hotspots.length) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/deps/watch — latest dependency vulnerability snapshot
  app.get("/api/deps/watch", (_req, res) => {
    try {
      const snapshotPath = resolve(PROJECT_DIR, ".forge", "deps-snapshot.json");
      if (!existsSync(snapshotPath)) return res.json({ snapshot: null, message: "No dependency snapshot yet — run forge_dep_watch first" });
      res.json(JSON.parse(readFileSync(snapshotPath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/deps/watch/run — trigger dependency scan (auth required)
  app.post("/api/deps/watch/run", (req, res) => {
    try {
      if (!checkApprovalSecret(req, res)) return;
      const pkgPath = resolve(PROJECT_DIR, "package.json");
      if (!existsSync(pkgPath)) return res.status(400).json({ error: "No package.json found" });

      let auditResult;
      try {
        const raw = execSync("npm audit --json 2>&1", { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 60_000 });
        auditResult = JSON.parse(raw);
      } catch (err) {
        if (err.stdout) { try { auditResult = JSON.parse(err.stdout); } catch { auditResult = null; } }
        if (!auditResult) return res.status(500).json({ error: `npm audit failed: ${err.message}` });
      }

      const currentVulns = [];
      const vulns = auditResult.vulnerabilities || {};
      for (const [name, info] of Object.entries(vulns)) {
        currentVulns.push({ name, severity: info.severity || "unknown" });
      }

      mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
      const snapshot = { capturedAt: new Date().toISOString(), depCount: currentVulns.length, vulnerabilities: currentVulns };
      writeFileSync(resolve(PROJECT_DIR, ".forge", "deps-snapshot.json"), JSON.stringify(snapshot, null, 2), "utf-8");
      res.json(snapshot);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/secret-scan — latest secret scan cache
  app.get("/api/secret-scan", (_req, res) => {
    try {
      const cachePath = resolve(PROJECT_DIR, ".forge", "secret-scan-cache.json");
      if (!existsSync(cachePath)) return res.json({ cache: null, message: "No scan results yet — run forge_secret_scan first" });
      res.json(JSON.parse(readFileSync(cachePath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/secret-scan/run — trigger secret scan (auth required)
  app.post("/api/secret-scan/run", (req, res) => {
    try {
      if (!checkApprovalSecret(req, res)) return;
      const since = req.body?.since || "HEAD~1";
      const threshold = Math.max(3.5, Math.min(5.0, parseFloat(req.body?.threshold) || 4.0));

      function shannonEntropy(str) {
        if (!str || str.length === 0) return 0;
        const freq = {};
        for (const char of str) freq[char] = (freq[char] || 0) + 1;
        let entropy = 0;
        for (const count of Object.values(freq)) {
          const p = count / str.length;
          entropy -= p * Math.log2(p);
        }
        return entropy;
      }

      const KEY_PATTERNS = /(?:key|secret|token|password|api_key|auth|credential|private)/i;
      let diffOutput;
      try {
        diffOutput = execSync(`git diff ${since}`, { cwd: PROJECT_DIR, encoding: "utf-8", timeout: 30_000 });
      } catch {
        return res.json({ clean: null, scannedFiles: 0, findings: [], error: "git unavailable" });
      }

      const findings = [];
      const scannedFiles = new Set();
      let currentFile = null;
      let lineNumber = 0;
      for (const line of diffOutput.split("\n")) {
        if (line.startsWith("+++ b/")) { currentFile = line.slice(6); scannedFiles.add(currentFile); continue; }
        if (line.startsWith("@@ ")) { const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/); lineNumber = m ? parseInt(m[1], 10) - 1 : 0; continue; }
        if (line.startsWith("+") && !line.startsWith("+++")) {
          lineNumber++;
          const added = line.slice(1);
          const tokens = added.match(/["']([^"']{8,})["']|(?:=|:|=>)\s*["']?([^\s"',;]{8,})["']?/g) || [];
          for (const raw of tokens) {
            const cleaned = raw.replace(/^[=:>]\s*["']?|["']$/g, "").replace(/^["']/, "");
            if (cleaned.length < 8) continue;
            const entropy = shannonEntropy(cleaned);
            if (entropy < threshold) continue;
            const keyMatch = KEY_PATTERNS.test(added);
            let confidence;
            if (entropy >= 4.5 && keyMatch) confidence = "high";
            else if ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) confidence = "medium";
            else confidence = "low";
            findings.push({ file: currentFile, line: lineNumber, type: "unknown", entropyScore: Math.round(entropy * 100) / 100, masked: "<REDACTED>", confidence });
          }
        } else if (!line.startsWith("-")) { lineNumber++; }
      }

      const result = { scannedAt: new Date().toISOString(), since, threshold, scannedFiles: scannedFiles.size, clean: findings.length === 0, findings };
      mkdirSync(resolve(PROJECT_DIR, ".forge"), { recursive: true });
      writeFileSync(resolve(PROJECT_DIR, ".forge", "secret-scan-cache.json"), JSON.stringify(result, null, 2), "utf-8");
      res.json(result);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: GET /api/env/diff — latest env diff cache
  app.get("/api/env/diff", (_req, res) => {
    try {
      const cachePath = resolve(PROJECT_DIR, ".forge", "env-diff-cache.json");
      if (!existsSync(cachePath)) return res.json({ cache: null, message: "No diff data yet — run forge_env_diff first" });
      res.json(JSON.parse(readFileSync(cachePath, "utf-8")));
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // REST API: POST /api/tool/:name — invoke forge tool
  // MCP-only tools route through internal handler; CLI tools proxy through pforge.ps1
  const MCP_ONLY_TOOLS = new Set([
    "forge_liveguard_run", "forge_quorum_analyze", "forge_health_trend",
    "forge_alert_triage", "forge_drift_report", "forge_regression_guard",
    "forge_incident_capture", "forge_deploy_journal", "forge_dep_watch",
    "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
    "forge_hotspot", "forge_runbook", "forge_run_plan", "forge_cost_report",
    "forge_capabilities", "forge_memory_capture",
  ]);
  app.post("/api/tool/:name", async (req, res) => {
    try {
      const toolName = req.params.name;
      if (MCP_ONLY_TOOLS.has(toolName)) {
        // Dispatch through the MCP CallToolRequestSchema handler directly
        try {
          const fakeRequest = { method: "tools/call", params: { name: toolName, arguments: req.body || {} } };
          const handlers = server._requestHandlers || server.requestHandlers;
          const handler = handlers?.get?.("tools/call");
          if (handler) {
            const mcpResult = await handler(fakeRequest);
            if (mcpResult?.content?.[0]?.text) {
              try { return res.json(JSON.parse(mcpResult.content[0].text)); } catch { return res.json(mcpResult); }
            }
            return res.json(mcpResult || { error: "No result from tool handler" });
          }
        } catch (err) {
          return res.status(500).json({ error: `Tool handler error: ${err.message}` });
        }
        // Fallback: try executeTool for CLI-delegated tools
        const syncResult = executeTool(toolName, req.body || {});
        if (syncResult !== null) return res.json(syncResult);
      }
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
          const parsed = parsePlan(resolve(plansDir, file), PROJECT_DIR);
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

  // POST /api/memory/capture — capture a thought directly into OpenBrain via REST
  //   Auth: Authorization: Bearer <bridge.approvalSecret>  OR  ?token=<secret>
  //   Body: { content, project?, type?, source?, created_by? }
  //   OpenClaw and external tools use this to write memories without going through an AI worker.
  app.post("/api/memory/capture", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;

    if (!isOpenBrainConfigured(PROJECT_DIR)) {
      return res.status(503).json({ error: "OpenBrain is not configured. Add the openbrain MCP server to .vscode/mcp.json or .claude/mcp.json." });
    }

    const { content, project, type, source, created_by } = req.body || {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required and must be a string" });
    }

    // Resolve project name from .forge.json if not provided
    let resolvedProject = project || null;
    if (!resolvedProject) {
      try {
        const forgeConfig = JSON.parse(readFileSync(resolve(PROJECT_DIR, ".forge.json"), "utf-8"));
        resolvedProject = forgeConfig.projectName || "plan-forge";
      } catch { resolvedProject = "plan-forge"; }
    }

    const thought = {
      content,
      project: resolvedProject,
      type: type || "decision",
      source: source || "api/memory/capture",
      created_by: created_by || "openclaw",
      captured_at: new Date().toISOString(),
    };

    // Broadcast to hub so dashboard + bridge can observe the capture event
    if (activeHub) {
      activeHub.broadcast({ type: "memory-captured", thought, timestamp: thought.captured_at });
    }

    // Return the thought payload — the caller (OpenClaw) must forward to OpenBrain's capture_thought API
    // This endpoint normalises and validates; OpenBrain's own REST/MCP handles persistence.
    res.json({
      ok: true,
      thought,
      note: "Forward this payload to OpenBrain capture_thought to persist. Plan Forge does not proxy writes to OpenBrain directly.",
    });
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

  // GET /api/fix/proposals — list all fix proposals
  app.get("/api/fix/proposals", (req, res) => {
    try {
      const autoDir = resolve(PROJECT_DIR, "docs/plans/auto");
      if (!existsSync(autoDir)) return res.json([]);
      const files = readdirSync(autoDir).filter((f) => f.startsWith("LIVEGUARD-FIX-") && f.endsWith(".md"));
      const proposals = files.map((f) => {
        const content = readFileSync(resolve(autoDir, f), "utf-8");
        const sourceMatch = content.match(/> Source: (.+)/);
        const genMatch = content.match(/> Generated: (.+)/);
        return { file: f, source: sourceMatch?.[1] || "unknown", generatedAt: genMatch?.[1] || null };
      });
      res.json(proposals);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/fix/propose — generate a fix proposal
  app.post("/api/fix/propose", (req, res) => {
    if (!checkApprovalSecret(req, res)) return;
    try {
      const { source, incidentId } = req.body || {};
      // Delegate to the MCP tool logic by simulating a tool call
      const args = { source, incidentId, path: PROJECT_DIR };
      // Inline the same logic (simplified)
      const autoDir = resolve(PROJECT_DIR, "docs/plans/auto");
      mkdirSync(autoDir, { recursive: true });
      const fixId = incidentId || `${source || "auto"}-${Date.now()}`;
      const planName = `LIVEGUARD-FIX-${fixId}.md`;
      const planPath = resolve(autoDir, planName);
      if (existsSync(planPath)) {
        return res.json({ alreadyExists: true, plan: `docs/plans/auto/${planName}`, fixId });
      }
      const planContent = `# LiveGuard Auto-Fix: ${fixId}\n\n> Generated: ${new Date().toISOString()}\n> Source: ${source || "auto"}\n\n## Slice 1 — Investigate\n\n- [ ] Review findings\n- [ ] Identify root cause\n\n## Slice 2 — Fix + Verify\n\n- [ ] Apply fix\n- [ ] Run validation\n`;
      writeFileSync(planPath, planContent, "utf-8");
      activeHub?.broadcast({ type: "fix-proposal-ready", data: { fixId, plan: `docs/plans/auto/${planName}` } });
      res.json({ fixId, plan: `docs/plans/auto/${planName}`, alreadyExists: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/quorum/prompt — assemble quorum prompt (read-only)
  app.get("/api/quorum/prompt", (req, res) => {
    try {
      const source = req.query.source || "all";
      const customQuestion = req.query.question || null;
      const analysisGoal = req.query.goal || null;
      const quorumSize = Math.max(1, Math.min(10, parseInt(req.query.quorumSize) || 3));
      if (customQuestion && customQuestion.length > 500) {
        return res.status(400).json({ quorumPrompt: null, error: "question exceeds 500 character limit" });
      }
      if (customQuestion && /<script|javascript:|on\w+=/i.test(customQuestion)) {
        return res.status(400).json({ quorumPrompt: null, error: "question contains disallowed content" });
      }

      const GOAL_PRESETS = {
        "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
        "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
        "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
        "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
      };

      const context = {};
      let oldestTimestamp = null;
      const trackAge = (ts) => { if (ts && (!oldestTimestamp || ts < oldestTimestamp)) oldestTimestamp = ts; };

      if (source === "all" || source === "drift") {
        const driftHistory = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
        if (driftHistory.length) { context.drift = driftHistory.slice(-5); trackAge(driftHistory[0]?.timestamp); }
      }
      if (source === "all" || source === "incident") {
        const incidents = readForgeJsonl("incidents.jsonl", [], PROJECT_DIR).slice(-10);
        if (incidents.length) { context.incidents = incidents; trackAge(incidents[0]?.capturedAt); }
      }
      if (source === "all" || source === "triage") {
        const triageCache = readForgeJson("alert-triage-cache.json", null, PROJECT_DIR);
        if (triageCache) { context.triage = triageCache; trackAge(triageCache.generatedAt); }
      }
      if (source === "all" || source === "fix-proposal") {
        const proposals = readForgeJsonl("fix-proposals.json", [], PROJECT_DIR).slice(-5);
        if (proposals.length) { context.fixProposals = proposals; trackAge(proposals[0]?.generatedAt); }
      }

      if (source !== "all" && Object.keys(context).length === 0) {
        return res.json({ quorumPrompt: null, error: `no ${source} data available — run the corresponding LiveGuard tool first` });
      }

      let questionUsed;
      if (customQuestion) { questionUsed = customQuestion; }
      else if (analysisGoal && GOAL_PRESETS[analysisGoal]) { questionUsed = GOAL_PRESETS[analysisGoal]; }
      else { questionUsed = GOAL_PRESETS["risk-assess"]; }

      const votingInstruction = `Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= 60 and majority consensus. Quorum size: ${quorumSize} models.`;
      const contextStr = JSON.stringify(context, null, 2);
      const quorumPrompt = `## Context\n${contextStr}\n\n## Question\n${questionUsed}\n\n## Voting Instruction\n${votingInstruction}`;

      const qConfig = loadQuorumConfig(PROJECT_DIR);
      const suggestedModels = (qConfig.models || ["claude-opus-4.6", "grok-4.20", "gemini-3-pro-preview"]).slice(0, quorumSize);
      const promptTokenEstimate = Math.ceil(quorumPrompt.length / 4);

      let dataSnapshotAge = "unknown";
      if (oldestTimestamp) {
        const ageMins = Math.round((Date.now() - new Date(oldestTimestamp).getTime()) / 60000);
        dataSnapshotAge = ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
      }

      res.json({ quorumPrompt, promptTokenEstimate, suggestedModels, dataSnapshotAge, questionUsed });
    } catch (err) {
      res.status(500).json({ quorumPrompt: null, error: err.message });
    }
  });

  // POST /api/quorum/prompt — same as GET but with body params
  app.post("/api/quorum/prompt", (req, res) => {
    try {
      const { source: reqSource, customQuestion, analysisGoal, quorumSize: reqQuorumSize, targetFile } = req.body || {};
      const source = reqSource || "all";
      const quorumSize = Math.max(1, Math.min(10, parseInt(reqQuorumSize) || 3));
      if (customQuestion && customQuestion.length > 500) {
        return res.status(400).json({ quorumPrompt: null, error: "customQuestion exceeds 500 character limit" });
      }
      if (customQuestion && /<script|javascript:|on\w+=/i.test(customQuestion)) {
        return res.status(400).json({ quorumPrompt: null, error: "customQuestion contains disallowed content" });
      }

      const GOAL_PRESETS = {
        "root-cause": "Identify the root cause of the issues shown in the data. Trace the causal chain from symptoms to underlying problems.",
        "risk-assess": "Assess the risk level of the current project state. Identify the highest-impact risks and their likelihood.",
        "fix-review": "Review the proposed fixes and assess whether they adequately address the underlying issues. Identify gaps or risks in the remediation approach.",
        "runbook-validate": "Validate the operational runbook against the current data. Identify any gaps, outdated steps, or missing escalation paths.",
      };

      const context = {};
      let oldestTimestamp = null;
      const trackAge = (ts) => { if (ts && (!oldestTimestamp || ts < oldestTimestamp)) oldestTimestamp = ts; };

      if (targetFile) {
        const data = readForgeJson(targetFile, null, PROJECT_DIR);
        if (data) { context.targetFile = data; if (data.timestamp) trackAge(data.timestamp); }
      } else {
        if (source === "all" || source === "drift") {
          const driftHistory = readForgeJsonl("drift-history.json", [], PROJECT_DIR);
          if (driftHistory.length) { context.drift = driftHistory.slice(-5); trackAge(driftHistory[0]?.timestamp); }
        }
        if (source === "all" || source === "incident") {
          const incidents = readForgeJsonl("incidents.jsonl", [], PROJECT_DIR).slice(-10);
          if (incidents.length) { context.incidents = incidents; trackAge(incidents[0]?.capturedAt); }
        }
        if (source === "all" || source === "triage") {
          const triageCache = readForgeJson("alert-triage-cache.json", null, PROJECT_DIR);
          if (triageCache) { context.triage = triageCache; trackAge(triageCache.generatedAt); }
        }
        if (source === "all" || source === "fix-proposal") {
          const proposals = readForgeJsonl("fix-proposals.json", [], PROJECT_DIR).slice(-5);
          if (proposals.length) { context.fixProposals = proposals; trackAge(proposals[0]?.generatedAt); }
        }
      }

      if (source !== "all" && !targetFile && Object.keys(context).length === 0) {
        return res.json({ quorumPrompt: null, error: `no ${source} data available — run the corresponding LiveGuard tool first` });
      }

      let questionUsed;
      if (customQuestion) { questionUsed = customQuestion; }
      else if (analysisGoal && GOAL_PRESETS[analysisGoal]) { questionUsed = GOAL_PRESETS[analysisGoal]; }
      else { questionUsed = GOAL_PRESETS["risk-assess"]; }

      const votingInstruction = `Each model must respond with: (1) a confidence score 0-100, (2) a one-paragraph answer, (3) one concrete recommendation. The aggregator accepts answers with confidence >= 60 and majority consensus. Quorum size: ${quorumSize} models.`;
      const contextStr = JSON.stringify(context, null, 2);
      const quorumPrompt = `## Context\n${contextStr}\n\n## Question\n${questionUsed}\n\n## Voting Instruction\n${votingInstruction}`;

      const qConfig = loadQuorumConfig(PROJECT_DIR);
      const suggestedModels = (qConfig.models || ["claude-opus-4.6", "grok-4.20", "gemini-3-pro-preview"]).slice(0, quorumSize);
      const promptTokenEstimate = Math.ceil(quorumPrompt.length / 4);

      let dataSnapshotAge = "unknown";
      if (oldestTimestamp) {
        const ageMins = Math.round((Date.now() - new Date(oldestTimestamp).getTime()) / 60000);
        dataSnapshotAge = ageMins < 60 ? `${ageMins}m ago` : `${Math.round(ageMins / 60)}h ago`;
      }

      res.json({ quorumPrompt, promptTokenEstimate, suggestedModels, dataSnapshotAge, questionUsed });
    } catch (err) {
      res.status(500).json({ quorumPrompt: null, error: err.message });
    }
  });

  // POST /api/openclaw/snapshot — post LiveGuard snapshot to OpenClaw endpoint
  app.post("/api/openclaw/snapshot", async (req, res) => {
    try {
      const extraContext = req.body || {};
      const result = await postOpenClawSnapshot(PROJECT_DIR, extraContext);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/openclaw/config — check OpenClaw configuration status
  app.get("/api/openclaw/config", (req, res) => {
    const config = loadOpenClawConfig(PROJECT_DIR);
    res.json({ configured: !!config.endpoint, endpoint: config.endpoint || null, hasApiKey: !!config.apiKey });
  });

  return app;
}

// ─── Start ────────────────────────────────────────────────────────────
const DASHBOARD_ONLY = process.argv.includes("--dashboard-only") || process.argv.includes("--dashboard");
const VALIDATE_ONLY = process.argv.includes("--validate");

async function main() {
  // --validate: quick startup check — verify imports, tool list, and exit
  if (VALIDATE_ONLY) {
    try {
      const toolNames = TOOLS.map((t) => t.name);
      if (!toolNames.length) throw new Error("No tools registered");
      writeToolsJson(TOOLS, __dirname);
      writeCliSchema(__dirname);
      console.error(`[validate] OK — ${toolNames.length} tools registered, capabilities generated`);
      process.exit(0);
    } catch (err) {
      console.error(`[validate] FAIL — ${err.message}`);
      process.exit(1);
    }
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

  // Phase UPDATE-01 — non-blocking, best-effort update check.
  // Runs once per boot, cached 24h. Honors PFORGE_NO_UPDATE_CHECK=1.
  // Failures are silent so a bad network never impedes startup.
  try {
    const versionFile = resolve(PROJECT_DIR, "VERSION");
    const current = existsSync(versionFile) ? readFileSync(versionFile, "utf-8").trim() : null;
    if (current) {
      // Delay 2s so startup logs stay clean and we don't race the hub.
      setTimeout(() => {
        checkForUpdate({ currentVersion: current, projectDir: PROJECT_DIR })
          .then((r) => {
            if (r && r.isNewer) {
              console.error(`[update-check] A newer Plan Forge release is available: v${r.latest} (you are on v${r.current}). ${r.url}`);
            }
          })
          .catch(() => { /* silent */ });
      }, 2000).unref?.();
    }
  } catch { /* silent */ }

  // Start WebSocket hub BEFORE stdio transport — ensures activeHub is set before any tool calls arrive
  try {
    activeHub = await createHub({ cwd: PROJECT_DIR });
    console.error(`Plan Forge WebSocket hub running on port ${activeHub.port}`);

    // Start event file watcher to bridge orchestrator events → dashboard
    activeEventWatcher = startEventFileWatcher(activeHub, PROJECT_DIR);
  } catch (err) {
    console.error(`[hub] WebSocket hub failed to start: ${err.message} (non-fatal)`);
  }

  // MCP stdio transport — AFTER hub so broadcastLiveGuard has a hub to send to
  if (!DASHBOARD_ONLY) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Plan Forge MCP server running (stdio transport)");
  } else {
    console.error("Plan Forge Dashboard-only mode (no MCP stdio)");
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

