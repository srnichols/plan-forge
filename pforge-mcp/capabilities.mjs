/**
 * Plan Forge — Machine-Readable API Surface (v2.3)
 *
 * Provides:
 *   - Enriched tool metadata (intent, prerequisites, errors, cost, workflows)
 *   - CLI command schema
 *   - Configuration schema
 *   - Auto-generated tools.json
 *   - forge_capabilities MCP tool
 *   - .well-known/plan-forge.json HTTP endpoint
 *
 * @module capabilities
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { isOpenBrainConfigured } from "./memory.mjs";
import { TOOL_NAMES } from "./enums.mjs";

// ─── Enriched Tool Metadata + Workflows (extracted sub-module) ────────

import { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';
export { TOOL_METADATA, WORKFLOWS };

// ─── CLI Schema + Config Schema (extracted sub-module) ───────────────

import { CLI_SCHEMA, CONFIG_SCHEMA } from './capabilities/schemas.mjs';
export { CLI_SCHEMA, CONFIG_SCHEMA };

// ─── System Reference (extracted sub-module) ──────────────────────────

import { VERSION, APP_VERSION, SYSTEM_REFERENCE } from './capabilities/reference.mjs';
export { SYSTEM_REFERENCE };

// ─── Inner-Loop Subsystem Surface (extracted sub-module) ──────────────

import { INNER_LOOP_SURFACE } from './capabilities/subsystems.mjs';
export { INNER_LOOP_SURFACE };

// ─── Capability Surface Builder ───────────────────────────────────────

/**
 * Build the full capability surface for forge_capabilities and .well-known.
 * @param {Array} [mcpTools] - Live TOOLS array from server.mjs. If omitted, builds from TOOL_METADATA keys.
 * @param {object} [options] - { cwd, hubPort }
 */
export function buildCapabilitySurface(mcpTools, options = {}) {
  const { cwd = process.cwd(), hubPort = null } = options;

  // If no tools array provided, build minimal tool objects from TOOL_NAMES (enums.mjs source of truth)
  const tools = mcpTools || TOOL_NAMES.map((name) => ({ name, description: TOOL_METADATA[name]?.intent?.[0] || name }));

  // Enrich MCP tools with metadata
  const enrichedTools = tools.map((tool) => {
    const meta = TOOL_METADATA[tool.name] || {};
    return {
      ...tool,
      ...meta,
    };
  });

  // Read installed extensions
  let extensions = [];
  try {
    const extPath = resolve(cwd, ".forge/extensions/extensions.json");
    if (existsSync(extPath)) {
      extensions = JSON.parse(readFileSync(extPath, "utf-8"));
    }
  } catch { /* ignore */ }

  // Read .forge.json
  let projectConfig = {};
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      projectConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    }
  } catch { /* ignore */ }

  return {
    schemaVersion: VERSION,
    version: APP_VERSION,
    serverVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    tools: enrichedTools,
    cli: CLI_SCHEMA,
    workflows: WORKFLOWS,
    config: {
      schema: CONFIG_SCHEMA,
      current: projectConfig,
    },
    dashboard: {
      url: `http://127.0.0.1:3100/dashboard`,
      tabs: {
        Progress: "Real-time slice progress cards via WebSocket — pending → executing → pass/fail",
        Runs: "Run history table with date, plan, slices, status, cost, duration",
        Cost: "Total spend, model breakdown (doughnut chart), monthly trend (bar chart)",
        Actions: "One-click buttons: Smith, Sweep, Analyze, Status, Validate, Extensions",
        Replay: "Browse agent session logs per slice with error/file filters",
        Extensions: "Visual extension catalog browser with search/filter",
        Config: "Visual .forge.json editor (agents, model routing) with save confirmation",
        Traces: "OTLP trace waterfall with span detail, severity filters, attributes viewer",
        Skills: "Skill catalog and execution history with step-level detail",
        "LG Health": "LiveGuard drift score gauge, drift history chart, hotspot analysis — monitors plan alignment over time",
        "LG Incidents": "Open incidents feed and fix proposals from LiveGuard alerting pipeline",
        "LG Triage": "Alert triage view — severity grouping, quorum analysis launch, actionable summaries",
        "LG Security": "Secret scan results with Shannon entropy findings, confidence levels, and file locations",
        "LG Env": "Environment key diff — key-name-only comparison across .env files (values never displayed)",
      },
      standalone: "node pforge-mcp/server.mjs --dashboard-only",
      description: "Use --dashboard-only to run the dashboard without MCP stdio (for standalone monitoring, demos, or testing). FORGE section covers plan execution; LIVEGUARD section covers runtime safety",
    },
    restApi: {
      baseUrl: `http://127.0.0.1:3100`,
      endpoints: [
        { method: "GET", path: "/api/status", description: "Current run status (latest summary or in-progress)" },
        { method: "GET", path: "/api/runs", description: "Run history (last 50 summaries)" },
        { method: "GET", path: "/api/config", description: "Read .forge.json" },
        { method: "POST", path: "/api/config", description: "Write .forge.json (with validation)" },
        { method: "GET", path: "/api/cost", description: "Cost report from cost-history.json" },
        { method: "POST", path: "/api/tool/:name", description: "Invoke any pforge CLI command via HTTP" },
        { method: "GET", path: "/api/hub", description: "WebSocket hub status + connected clients" },
        { method: "GET", path: "/api/replay/:runIdx/:sliceId", description: "Session replay log for a slice" },
        { method: "GET", path: "/api/traces", description: "List all runs from index.jsonl" },
        { method: "GET", path: "/api/traces/:runId", description: "Single run trace detail (trace.json)" },
        { method: "GET", path: "/api/capabilities", description: "Full capability surface (same as forge_capabilities)" },
        { method: "GET", path: "/.well-known/plan-forge.json", description: "HTTP discovery endpoint — machine-readable surface for OpenClaw and external agents" },
        { method: "POST", path: "/api/runs/trigger", description: "Inbound run trigger — start a plan remotely (OpenClaw, CI). Auth: bridge.approvalSecret Bearer token. Body: { plan, quorum?, model?, resumeFrom?, estimate?, dryRun? }" },
        { method: "POST", path: "/api/runs/abort", description: "Abort an in-progress triggered run. Auth: bridge.approvalSecret Bearer token." },
        { method: "GET", path: "/api/memory", description: "OpenBrain connection status and endpoint" },
        { method: "POST", path: "/api/memory/search", description: "Search OpenBrain project memory. Body: { query, project?, limit? }" },
        { method: "POST", path: "/api/memory/capture", description: "Capture a thought into OpenBrain via REST (OpenClaw use). Auth: bridge.approvalSecret. Body: { content, project?, type?, source?, created_by? }" },
        { method: "POST", path: "/api/memory/drain", description: "Manually drain pending OpenBrain queue records. Auth: bridge.approvalSecret. Returns { ok, attempted, delivered, deferred, dlq, durationMs }." },
        { method: "GET", path: "/api/bridge/status", description: "Bridge status — channels, pending approvals, stats" },
        { method: "POST", path: "/api/bridge/approve/:runId", description: "Receive approval callback. Auth: bridge.approvalSecret. Body: { action: 'approve'|'reject', approver? }" },
        { method: "GET", path: "/api/bridge/approve/:runId", description: "Browser-friendly approval link for Telegram inline buttons. Query: ?action=approve|reject&token=<secret>" },
        // LiveGuard REST endpoints (v2.27.0)
        { method: "GET", path: "/api/drift", description: "Run architecture drift check against guardrail rules. Returns score, violations, trend." },
        { method: "GET", path: "/api/drift/history", description: "Drift score history from .forge/drift-history.jsonl" },
        { method: "POST", path: "/api/incident", description: "Capture an incident. Body: { description, severity?, files?, resolvedAt? }" },
        { method: "GET", path: "/api/incidents", description: "List all captured incidents from .forge/incidents.jsonl" },
        { method: "POST", path: "/api/regression-guard", description: "Run regression guard — execute validation gates from plan files. Body: { files?, plan?, failFast? }" },
        { method: "POST", path: "/api/deploy-journal", description: "Record a deployment. Body: { version, by?, notes?, slice? }" },
        { method: "GET", path: "/api/deploy-journal", description: "List all deploy journal entries from .forge/deploy-journal.jsonl" },
        { method: "GET", path: "/api/triage", description: "Prioritized alert triage — ranked cross-signal alert list. Query: ?minSeverity=&max=" },
        { method: "POST", path: "/api/runbook", description: "Generate operational runbook from a plan file. Body: { plan, includeIncidents? }" },
        { method: "GET", path: "/api/runbooks", description: "List all generated runbooks from .forge/runbooks/" },
        { method: "GET", path: "/api/hotspots", description: "Git churn hotspot analysis. Query: ?top=&since=" },
        { method: "GET", path: "/api/health-trend", description: "Health trend analysis — drift, cost, incidents, model performance over time. Query: ?days=&metrics=" },
        { method: "GET", path: "/api/deps/watch", description: "Latest dependency vulnerability snapshot from .forge/deps-snapshot.json" },
        { method: "POST", path: "/api/deps/watch/run", description: "Trigger a new dependency vulnerability scan. Auth: bridge.approvalSecret Bearer token. Body: { path?, notify? }" },
        { method: "POST", path: "/api/tool/org-rules", description: "Generate org-rules instruction file via REST" },
        { method: "POST", path: "/api/image/generate", description: "Generate an image via xAI Aurora or OpenAI DALL-E. Body: { prompt, outputPath, model?, size?, format?, quality? }" },
      ],
    },
    hub: hubPort
      ? {
          url: `ws://127.0.0.1:${hubPort}`,
          status: "running",
          connectionString: `ws://127.0.0.1:${hubPort}?label=<your-label>`,
          features: ["broadcast", "heartbeat (30s)", "event history (last 100)", "session registry", "client labels"],
          portFallback: "If 3101 unavailable, increments until free. Active port stored in .forge/server-ports.json",
        }
      : { status: "stopped" },
    telemetry: {
      traceFormat: "OTLP-compatible JSON in .forge/runs/<timestamp>/trace.json",
      spanKinds: ["SERVER (run-plan root)", "INTERNAL (slice orchestration)", "CLIENT (worker spawn, gate execution)"],
      severityLevels: { TRACE: 1, DEBUG: 5, INFO: 9, WARN: 13, ERROR: 17, FATAL: 21 },
      logRegistry: {
        manifest: ".forge/runs/<timestamp>/manifest.json — per-run artifact registry",
        index: ".forge/runs/index.jsonl — append-only global run index (corruption-tolerant)",
      },
      retention: "maxRunHistory config in .forge.json (default: 50), auto-prunes oldest runs",
    },
    orchestratorApi: {
      description: "Internal APIs exported from pforge-mcp/orchestrator.mjs for advanced integrations",
      exports: {
        parsePlan: { description: "Parse plan Markdown → DAG with slices, deps, scope, gates", args: "planPath" },
        runPlan: { description: "Execute a plan end-to-end (main orchestration entry)", args: "planPath, options" },
        detectWorkers: { description: "Detect available CLI workers (gh-copilot, claude, codex)", returns: "array" },
        spawnWorker: { description: "Spawn a CLI worker with prompt, model, timeout", args: "prompt, options" },
        runGate: { description: "Execute a validation gate command (allowlisted)", args: "command, cwd" },
        getCostReport: { description: "Generate cost report from .forge/cost-history.json", args: "cwd" },
        calculateSliceCost: { description: "Calculate cost for a single slice from token data", args: "tokens" },
        buildCostBreakdown: { description: "Build cost breakdown from all slice results", args: "sliceResults" },
        SequentialScheduler: { description: "Execute slices one-at-a-time in DAG order" },
        ParallelScheduler: { description: "Execute [P]-tagged slices concurrently (up to maxParallelism)" },
      },
      schedulerSelection: "Auto-detected: if plan has [P] tags → ParallelScheduler, else SequentialScheduler",
      conflictDetection: "Parallel slices with overlapping [scope:] patterns forced to sequential",
    },
    innerLoop: INNER_LOOP_SURFACE,
    forgeMaster: buildForgeMasterCapabilities(cwd),
    extensions,
    memory: buildMemoryCapabilities(cwd),
    system: SYSTEM_REFERENCE,
  };
}

// ─── Forge-Master Capabilities ────────────────────────────────────────

/**
 * Build the forgeMaster subsystem block for forge_capabilities output.
 * Surfaces config, tools, and allowlist so agents know the subsystem exists.
 */
function buildForgeMasterCapabilities(cwd) {
  let config = {};
  try {
    const configPath = resolve(cwd, ".forge.json");
    if (existsSync(configPath)) {
      const forgeJson = JSON.parse(readFileSync(configPath, "utf-8"));
      const block = forgeJson?.forgeMaster ?? {};
      config = {
        reasoningModel: block.reasoningModel ?? forgeJson?.model?.default ?? null,
        routerModel: block.routerModel ?? "grok-3-mini",
        discoverExtensionTools: block.discoverExtensionTools ?? true,
          observerEnabled: block.observer?.enabled ?? false,
        };
    }
  } catch { /* fall through to defaults */ }

  return {
    description: "Forge-Master: an in-IDE reasoning assistant that classifies intent, fetches memory context, and orchestrates read-only tool calls on the owner's behalf. Phase-28 MVP.",
    addedIn: "2.61.0",
    tools: TOOL_NAMES.filter((n) => n.startsWith("forge_master_")),
    reasoningModel: config.reasoningModel ?? null,
    routerModel: config.routerModel ?? "grok-3-mini",
    configKey: "forgeMaster",
    studio: {
      dashboardTabEnabled: true,
      reasoningModel: config.reasoningModel ?? null,
      routerModel: config.routerModel ?? "grok-3-mini",
      promptCatalogVersion: "1.0.0",
      observerEnabled: config.observerEnabled ?? false,
    },
  };
}

// ─── OpenBrain Memory Integration ─────────────────────────────────────

/**
 * Build OpenBrain memory capabilities section for the API surface.
 * Tells agents how to use persistent memory with Plan Forge.
 */
function buildMemoryCapabilities(cwd) {
  const configured = isOpenBrainConfigured(cwd);

  return {
    provider: "OpenBrain",
    configured,
    description: configured
      ? "Persistent semantic memory is active. Use search_thoughts before work and capture_thought after decisions."
      : "OpenBrain is not configured. Memory features are disabled. See CUSTOMIZATION.md for setup.",

    // Companion MCP tools (from OpenBrain server, not Plan Forge)
    companionTools: {
      search_thoughts: {
        description: "Search for prior decisions, patterns, and lessons relevant to current work",
        when: "Before starting any slice, review, or planning session",
        params: {
          query: "Natural language search (e.g., 'authentication patterns', 'database migration conventions')",
          project: "Scope to current project name (from .forge.json projectName)",
          type: "Filter by type: 'convention', 'decision', 'lesson', 'insight'",
          limit: "Max results (default: 10)",
        },
        examples: [
          { query: "project conventions", project: "MyApp", type: "convention", limit: 5 },
          { query: "authentication patterns EF Core", project: "MyApp" },
          { query: "prior phase mistakes lessons", project: "MyApp", type: "lesson" },
        ],
      },
      capture_thought: {
        description: "Save a decision, convention, or lesson for future sessions to find",
        when: "After completing a slice, making an architecture decision, or discovering a pattern",
        params: {
          content: "The thought (e.g., 'Decision: Used repository pattern for data access because...')",
          project: "Current project name",
          source: "Where captured (e.g., 'plan-forge-orchestrator/Phase-1/slice-3')",
          created_by: "Who captured (e.g., 'copilot-vscode', 'gh-copilot-worker')",
        },
        captureGuidelines: [
          "Capture architecture decisions and WHY alternatives were rejected",
          "Capture naming conventions and patterns established",
          "Capture gotchas and constraints discovered (saves time in future phases)",
          "Capture lessons from failures (what broke, what fixed it)",
          "Do NOT capture trivial facts or code that's already in version control",
        ],
        examples: [
          {
            content: "Decision: Used IProjectService interface with EF Core repository pattern. Rejected Active Record because the team prefers explicit separation of concerns.",
            project: "TimeTracker",
            source: "plan-forge-orchestrator/Phase-2/slice-1",
            created_by: "gh-copilot-worker",
          },
          {
            content: "Convention: All soft-deletes use IsActive=false, never physical DELETE. GetAllAsync filters by IsActive=true by default.",
            project: "TimeTracker",
            source: "plan-forge-orchestrator/Phase-1/slice-2",
            created_by: "gh-copilot-worker",
          },
        ],
      },
      capture_thoughts: {
        description: "Batch capture multiple thoughts in one call (more efficient than multiple capture_thought calls)",
        when: "After completing a run or phase with multiple decisions",
      },
      thought_stats: {
        description: "Get statistics about captured thoughts (count by project, type, source)",
        when: "To understand how much project knowledge has been accumulated",
      },
    },

    // How Plan Forge orchestrator integrates with OpenBrain
    orchestratorIntegration: {
      beforeSlice: "Worker prompts include search_thoughts instructions to load prior conventions and decisions",
      afterSlice: "Worker prompts include capture_thought instructions to persist architecture decisions and patterns",
      afterRun: "Summary includes _memoryCapture field with run summary thought + cost anomaly thought",
      costAnomaly: "If run cost exceeds 2x the historical average, a cost insight thought is auto-generated",
      autoCapture: {
        runSummary: {
          trigger: "After every run (pass or fail)",
          content: "Plan name, status, slices passed/failed, duration, cost, failed slice details",
          project: "From .forge.json projectName",
          source: "plan-forge-orchestrator/<plan-path>",
        },
        costAnomaly: {
          trigger: "After run if cost > 2x historical average",
          content: "Cost anomaly alert with current vs average cost",
          threshold: "2.0x average cost per run",
          requiresHistory: "At least 2 prior runs in cost-history.json",
        },
      },
      summaryField: "_memoryCapture in summary JSON (in-memory only, not written to disk — caller acts on it)",
    },

    // Recommended workflows combining Plan Forge + OpenBrain
    workflows: {
      "memory-enhanced-execution": {
        description: "Execute a plan with full memory context",
        steps: [
          { tool: "search_thoughts", args: { query: "project conventions", type: "convention" }, description: "Load conventions before planning" },
          { tool: "forge_run_plan", args: { estimate: true }, description: "Estimate with historical data" },
          { tool: "forge_run_plan", description: "Execute — workers auto-search/capture if OpenBrain configured" },
          { tool: "forge_cost_report", description: "Review cost" },
          { tool: "capture_thought", args: { content: "Phase N complete: <summary>" }, description: "Persist phase summary" },
        ],
      },
      "knowledge-review": {
        description: "Review accumulated project knowledge",
        steps: [
          { tool: "thought_stats", description: "See knowledge distribution" },
          { tool: "search_thoughts", args: { query: "decisions", type: "decision" }, description: "Review architecture decisions" },
          { tool: "search_thoughts", args: { query: "lessons mistakes", type: "lesson" }, description: "Review lessons learned" },
        ],
      },
    },
  };
}

/**
 * Build capabilities surface with no required args — convenience wrapper
 * for tooling and validation gates that call buildCapabilities().
 */
export function buildCapabilities(options = {}) {
  return buildCapabilitySurface([], options);
}

/**
 * Write tools.json to pforge-mcp/ directory.
 */
export function writeToolsJson(mcpTools, outputDir) {
  const surface = buildCapabilitySurface(mcpTools);
  const toolsPath = resolve(outputDir, "tools.json");
  writeFileSync(toolsPath, JSON.stringify(surface.tools, null, 2));
  return toolsPath;
}

/**
 * Write cli-schema.json to pforge-mcp/ directory.
 */
export function writeCliSchema(outputDir) {
  const schemaPath = resolve(outputDir, "cli-schema.json");
  writeFileSync(schemaPath, JSON.stringify(CLI_SCHEMA, null, 2));
  return schemaPath;
}
