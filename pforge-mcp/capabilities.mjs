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

const VERSION = "2.3.0";

// ─── Enriched Tool Metadata ───────────────────────────────────────────

export const TOOL_METADATA = {
  forge_smith: {
    intent: ["diagnose", "inspect", "health-check"],
    aliases: ["inspect-forge", "health-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge.json", ".github/"],
    sideEffects: [],
    errors: {
      NOT_GIT_REPO: { message: "Not inside a git repository", recovery: "Run from a git-initialized project" },
    },
    example: { input: {}, output: { summary: "8 passed, 1 failed, 2 warnings" } },
  },
  forge_validate: {
    intent: ["validate", "check", "verify"],
    aliases: ["check-setup", "validate-setup"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [".forge.json exists"],
    produces: [],
    consumes: [".forge.json", ".github/"],
    sideEffects: [],
    errors: {
      NO_CONFIG: { message: ".forge.json not found", recovery: "Run setup first" },
    },
    example: { input: {}, output: { result: "17 passed, 0 failed" } },
  },
  forge_sweep: {
    intent: ["scan", "audit", "completeness"],
    aliases: ["find-todos", "completeness-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: ["src/**", "tests/**"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { markers: 3, locations: ["src/api.ts:42 TODO", "..."] } },
  },
  forge_status: {
    intent: ["read", "status", "overview"],
    aliases: ["phase-status", "roadmap-status"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: ["docs/plans/DEPLOYMENT-ROADMAP.md exists"],
    produces: [],
    consumes: ["docs/plans/DEPLOYMENT-ROADMAP.md"],
    sideEffects: [],
    errors: {
      NO_ROADMAP: { message: "DEPLOYMENT-ROADMAP.md not found", recovery: "Create docs/plans/DEPLOYMENT-ROADMAP.md or run pforge new-phase" },
    },
    example: { input: {}, output: { phases: [{ name: "Phase 1", status: "complete" }] } },
  },
  forge_diff: {
    intent: ["compare", "drift-detect", "scope-check"],
    aliases: ["scope-drift", "check-drift"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: ["plan file exists", "git initialized"],
    produces: [],
    consumes: ["docs/plans/*.md"],
    sideEffects: [],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the plan path" },
    },
    example: { input: { plan: "docs/plans/Phase-1.md" }, output: { drift: false, forbidden: 0 } },
  },
  forge_analyze: {
    intent: ["analyze", "score", "audit"],
    aliases: ["consistency-check", "plan-analysis"],
    cost: "low",
    maxConcurrent: 5,
    addedIn: "1.3.0",
    prerequisites: ["plan file exists"],
    produces: [],
    consumes: ["docs/plans/*.md", "src/**", "tests/**"],
    sideEffects: [],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the plan path" },
      LOW_SCORE: { message: "Score below 60%", recovery: "Review gaps in traceability, coverage, tests, or gates" },
    },
    example: { input: { plan: "docs/plans/Phase-1.md" }, output: { score: 85, status: "passed" } },
  },
  forge_run_plan: {
    intent: ["execute", "automate", "run"],
    aliases: ["execute-plan", "run-plan"],
    cost: "high",
    maxConcurrent: 1,
    addedIn: "2.0.0",
    prerequisites: ["plan file exists", "gh copilot CLI installed (for auto mode)"],
    produces: [".forge/runs/<timestamp>/summary.json", ".forge/runs/<timestamp>/slice-N.json"],
    consumes: ["docs/plans/*.md", ".forge.json"],
    sideEffects: ["creates/modifies source files", "runs build/test commands", "spawns CLI workers"],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the path or run forge_status to see available plans" },
      NO_WORKER: { message: "No CLI workers available", recovery: "Install gh copilot CLI, or use mode: 'assisted'" },
      GATE_FAILED: { message: "Validation gate failed", recovery: "Check slice results, fix code, use resumeFrom to continue" },
      ABORTED: { message: "Run was aborted", recovery: "Re-run or use resumeFrom to continue from last slice" },
    },
    example: {
      input: { plan: "docs/plans/Phase-1.md", estimate: true },
      output: { status: "estimate", sliceCount: 4, estimatedCostUSD: 0.32, confidence: "heuristic" },
    },
  },
  forge_abort: {
    intent: ["stop", "cancel", "abort"],
    aliases: ["stop-run", "cancel-execution"],
    cost: "low",
    maxConcurrent: 1,
    addedIn: "2.0.0",
    prerequisites: ["active run in progress"],
    produces: [],
    consumes: [],
    sideEffects: ["stops execution after current slice"],
    errors: {
      NO_ACTIVE_RUN: { message: "No active plan execution to abort", recovery: "No action needed" },
    },
    example: { input: {}, output: { message: "Abort signal sent" } },
  },
  forge_plan_status: {
    intent: ["read", "status", "progress"],
    aliases: ["run-status", "check-progress"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.0.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/runs/"],
    sideEffects: [],
    errors: {
      NO_RUNS: { message: "No runs found", recovery: "Run forge_run_plan first" },
    },
    example: { input: {}, output: { status: "completed", passed: 4, failed: 0 } },
  },
  forge_cost_report: {
    intent: ["read", "cost", "billing"],
    aliases: ["cost-summary", "token-report"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.0.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/cost-history.json"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { runs: 5, total_cost_usd: 1.23, by_model: {} } },
  },
  forge_ext_search: {
    intent: ["search", "browse", "discover"],
    aliases: ["find-extensions", "browse-catalog"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: ["extensions/catalog.json"],
    sideEffects: [],
    errors: {},
    example: { input: { query: "azure" }, output: { results: [] } },
  },
  forge_ext_info: {
    intent: ["read", "detail", "info"],
    aliases: ["extension-detail"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: [],
    consumes: ["extensions/catalog.json"],
    sideEffects: [],
    errors: {
      NOT_FOUND: { message: "Extension not found", recovery: "Use forge_ext_search to find available extensions" },
    },
    example: { input: { name: "azure-infrastructure" }, output: { name: "azure-infrastructure", version: "1.0.0" } },
  },
  forge_new_phase: {
    intent: ["create", "scaffold", "plan"],
    aliases: ["new-plan", "create-phase"],
    cost: "low",
    maxConcurrent: 1,
    addedIn: "1.3.0",
    prerequisites: [],
    produces: ["docs/plans/Phase-N-<name>-PLAN.md", "docs/plans/DEPLOYMENT-ROADMAP.md (updated)"],
    consumes: [],
    sideEffects: ["creates plan file", "updates roadmap"],
    errors: {},
    example: { input: { name: "user-auth" }, output: { file: "docs/plans/Phase-1-USER-AUTH-PLAN.md" } },
  },
  forge_capabilities: {
    intent: ["discover", "introspect", "api-surface"],
    aliases: ["get-capabilities", "discover-tools", "api-schema"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.3.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge.json", ".vscode/mcp.json"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { tools: 14, workflows: 4, memory: { configured: true } } },
  },
};

// ─── Workflow Graphs ──────────────────────────────────────────────────

export const WORKFLOWS = {
  "execute-plan": {
    description: "Run a plan with cost awareness",
    steps: [
      { tool: "forge_run_plan", args: { estimate: true }, decision: "Review estimated cost. If acceptable, proceed." },
      { tool: "forge_run_plan", args: { estimate: false }, decision: "Monitor at localhost:3100/dashboard" },
      { tool: "forge_plan_status", description: "Check final results" },
      { tool: "forge_cost_report", description: "Review actual cost" },
    ],
  },
  "diagnose-project": {
    description: "Full project health check",
    steps: [
      { tool: "forge_smith", description: "Environment + setup health" },
      { tool: "forge_validate", description: "File counts + placeholders" },
      { tool: "forge_sweep", description: "Completeness markers" },
    ],
  },
  "plan-and-execute": {
    description: "Create a new phase and execute it",
    steps: [
      { tool: "forge_new_phase", args: { name: "<feature>" }, description: "Create plan file" },
      { tool: "forge_analyze", description: "Score the plan after hardening" },
      { tool: "forge_run_plan", args: { estimate: true }, description: "Estimate cost" },
      { tool: "forge_run_plan", description: "Execute" },
    ],
  },
  "review-run": {
    description: "Review a completed run",
    steps: [
      { tool: "forge_plan_status", description: "Per-slice results" },
      { tool: "forge_cost_report", description: "Token + cost breakdown" },
      { tool: "forge_sweep", description: "Check for leftover markers" },
      { tool: "forge_analyze", description: "Consistency score" },
    ],
  },
};

// ─── CLI Schema ───────────────────────────────────────────────────────

export const CLI_SCHEMA = {
  commands: {
    smith: { description: "Diagnose environment + setup health", args: [], flags: {}, examples: ["pforge smith"] },
    check: { description: "Validate setup files", args: [], flags: {}, examples: ["pforge check"] },
    status: { description: "Show phase status from roadmap", args: [], flags: {}, examples: ["pforge status"] },
    sweep: { description: "Scan for TODO/FIXME markers", args: [], flags: {}, examples: ["pforge sweep"] },
    "new-phase": {
      description: "Create a new phase plan + roadmap entry",
      args: [{ name: "name", type: "string", required: true, description: "Phase name (e.g., user-auth)" }],
      flags: { "--dry-run": { type: "boolean", description: "Preview without creating" } },
      examples: ["pforge new-phase user-auth", "pforge new-phase user-auth --dry-run"],
    },
    branch: {
      description: "Create git branch from plan's Branch Strategy",
      args: [{ name: "plan", type: "path", required: true }],
      flags: { "--dry-run": { type: "boolean" } },
      examples: ["pforge branch docs/plans/Phase-1-AUTH-PLAN.md"],
      note: "CLI-only — not available as MCP tool. Use via terminal.",
    },
    commit: {
      description: "Auto-generate conventional commit from slice goal",
      args: [
        { name: "plan", type: "path", required: true },
        { name: "slice", type: "number", required: true },
      ],
      flags: { "--dry-run": { type: "boolean" } },
      examples: ["pforge commit docs/plans/Phase-1.md 2"],
      note: "CLI-only — not available as MCP tool.",
    },
    "phase-status": {
      description: "Update phase status in DEPLOYMENT-ROADMAP.md",
      args: [
        { name: "plan", type: "path", required: true },
        { name: "status", type: "string", required: true, enum: ["planned", "in-progress", "complete", "paused"] },
      ],
      flags: {},
      examples: ["pforge phase-status docs/plans/Phase-1.md complete"],
      note: "CLI-only — not available as MCP tool.",
    },
    diff: {
      description: "Compare changes against plan's Scope Contract",
      args: [{ name: "plan", type: "path", required: true }],
      flags: {},
      examples: ["pforge diff docs/plans/Phase-1-AUTH-PLAN.md"],
    },
    analyze: {
      description: "Cross-artifact consistency scoring (0-100)",
      args: [{ name: "plan", type: "path", required: true }],
      flags: {},
      examples: ["pforge analyze docs/plans/Phase-1-AUTH-PLAN.md"],
    },
    "run-plan": {
      description: "Execute a hardened plan automatically or interactively",
      args: [{ name: "plan", type: "path", required: true }],
      flags: {
        "--estimate": { type: "boolean", description: "Cost prediction only" },
        "--assisted": { type: "boolean", description: "Human codes, orchestrator validates gates" },
        "--model": { type: "string", description: "Model override (e.g., claude-sonnet-4.6)" },
        "--resume-from": { type: "number", description: "Skip completed slices, resume from N" },
        "--dry-run": { type: "boolean", description: "Parse and validate without executing" },
      },
      examples: [
        "pforge run-plan docs/plans/Phase-1.md",
        "pforge run-plan docs/plans/Phase-1.md --estimate",
        "pforge run-plan docs/plans/Phase-1.md --assisted",
        "pforge run-plan docs/plans/Phase-1.md --model claude-sonnet-4.6",
        "pforge run-plan docs/plans/Phase-1.md --resume-from 3",
      ],
    },
    ext: {
      description: "Extension management",
      subcommands: {
        search: { description: "Search extension catalog", args: [{ name: "query", type: "string", required: false }] },
        add: { description: "Install extension", args: [{ name: "name", type: "string", required: true }] },
        info: { description: "Extension details", args: [{ name: "name", type: "string", required: true }] },
        list: { description: "List installed extensions", args: [] },
        remove: { description: "Remove extension", args: [{ name: "name", type: "string", required: true }] },
      },
      examples: ["pforge ext search azure", "pforge ext add azure-infrastructure", "pforge ext list"],
    },
    update: {
      description: "Update framework files from Plan Forge source",
      args: [{ name: "source", type: "path", required: false, description: "Plan Forge source path" }],
      flags: { "--dry-run": { type: "boolean" } },
      examples: ["pforge update ../plan-forge", "pforge update --dry-run"],
    },
    help: { description: "Show help", args: [], flags: {}, examples: ["pforge help"] },
  },
  server: {
    description: "MCP server commands (run directly with node)",
    commands: {
      start: { description: "Start MCP server (stdio + Express + WebSocket)", command: "node pforge-mcp/server.mjs" },
      "dashboard-only": { description: "Start dashboard + REST API without MCP stdio", command: "node pforge-mcp/server.mjs --dashboard-only" },
    },
  },
};

// ─── Config Schema ────────────────────────────────────────────────────

export const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: ".forge.json",
  type: "object",
  properties: {
    pipelineVersion: { type: "string", description: "Pipeline version", default: "2.0" },
    templateVersion: { type: "string", description: "Plan Forge template version" },
    projectName: { type: "string", description: "Project name (used for OpenBrain memory scoping)" },
    preset: { type: "string", enum: ["dotnet", "typescript", "python", "java", "go", "azure-iac", "custom"] },
    agents: { type: "array", items: { type: "string", enum: ["claude", "cursor", "codex"] }, description: "Configured agent adapters" },
    modelRouting: {
      type: "object",
      properties: {
        execute: { type: "string", description: "Model for slice execution" },
        review: { type: "string", description: "Model for reviews" },
        default: {
          type: "string",
          enum: ["auto", "claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5", "gpt-5.4", "gpt-5.2-codex", "gpt-5-mini", "gemini-3-pro-preview"],
          default: "auto",
        },
      },
    },
    maxParallelism: { type: "number", default: 3, minimum: 1, maximum: 10, description: "Max concurrent parallel slices" },
    maxRetries: { type: "number", default: 1, minimum: 0, maximum: 5, description: "Gate failure retry attempts" },
    maxRunHistory: { type: "number", default: 50, minimum: 1, description: "Max run directories to retain" },
    extensions: { type: "array", items: { type: "string" }, description: "Installed extensions" },
  },
};

// ─── System Reference ─────────────────────────────────────────────────

const SYSTEM_REFERENCE = {
  name: "Plan Forge",
  description: "AI coding guardrails that convert rough ideas into hardened execution contracts. Spec-driven framework with autonomous execution, cost tracking, telemetry, and persistent memory.",
  version: VERSION,
  repository: "https://github.com/srnichols/plan-forge",

  architecture: {
    description: "Single Node.js process serving MCP (stdio) + Express (HTTP) + WebSocket (events)",
    components: {
      "pforge-mcp/server.mjs": "MCP server + Express REST API + routes",
      "pforge-mcp/orchestrator.mjs": "DAG-based plan execution engine",
      "pforge-mcp/hub.mjs": "WebSocket event broadcasting server",
      "pforge-mcp/telemetry.mjs": "OTLP trace/span/log capture",
      "pforge-mcp/capabilities.mjs": "Machine-readable API surface (this module)",
      "pforge-mcp/memory.mjs": "OpenBrain persistent memory integration",
      "pforge-mcp/dashboard/": "Web UI (vanilla JS + Tailwind CDN + Chart.js)",
      "pforge.ps1": "CLI wrapper (PowerShell)",
      "pforge.sh": "CLI wrapper (Bash)",
    },
    ports: {
      3100: "Express HTTP (dashboard + REST API)",
      3101: "WebSocket hub (events + real-time)",
    },
  },

  pipeline: {
    description: "6-step planning and execution pipeline with 3-session isolation",
    steps: {
      "Step 0": { name: "Specify", prompt: "step0-specify-feature.prompt.md", agent: "specifier", description: "Define what and why" },
      "Step 1": { name: "Preflight", prompt: "step1-preflight-check.prompt.md", description: "Verify prerequisites" },
      "Step 2": { name: "Harden", prompt: "step2-harden-plan.prompt.md", agent: "plan-hardener", description: "Convert spec into binding execution contract with slices, gates, scope" },
      "Step 3": { name: "Execute", prompt: "step3-execute-slice.prompt.md", agent: "executor", description: "Build slice-by-slice. Also: pforge run-plan (automated)" },
      "Step 4": { name: "Sweep", prompt: "step4-completeness-sweep.prompt.md", description: "Eliminate TODO/stub/mock markers" },
      "Step 5": { name: "Review", prompt: "step5-review-gate.prompt.md", agent: "reviewer-gate", description: "Independent audit for drift, compliance, quality" },
    },
    sessionIsolation: "Steps 0-2 in Session 1, Steps 3-4 in Session 2, Step 5 in Session 3 (prevents context bleed)",
  },

  planFormat: {
    description: "Hardened plan Markdown format parsed by the orchestrator",
    sliceHeader: "### Slice N: Title [depends: Slice 1] [P] [scope: src/auth/**]",
    tags: {
      "[P]": "Parallel-eligible — can run concurrently with other [P] slices",
      "[depends: Slice N]": "Dependency — waits for specified slice(s) to complete",
      "[depends: Slice 1, Slice 3]": "Multiple dependencies",
      "[scope: path/**]": "File scope — limits worker to these paths, enables conflict detection",
    },
    sections: {
      "Scope Contract": "In Scope, Out of Scope, Forbidden Actions",
      "Validation Gate": "Build/test commands run at every slice boundary",
      "Stop Condition": "Halts execution if condition is met",
      "Build command / Test command": "Per-slice build and test commands",
    },
  },

  guardrails: {
    description: "17-18 instruction files per preset that auto-load based on the file being edited",
    shared: ["architecture-principles", "git-workflow", "ai-plan-hardening-runbook", "project-principles"],
    perStack: {
      dotnet: ["api-patterns", "auth", "caching", "dapr", "database", "deploy", "errorhandling", "graphql", "messaging", "multi-environment", "naming", "observability", "performance", "security", "testing", "version"],
      typescript: ["...same + frontend"],
    },
    mechanism: "YAML frontmatter applyTo glob pattern → Copilot loads matching files automatically",
  },

  agents: {
    description: "19 specialized AI reviewer/executor agents per app preset",
    stackSpecific: ["architecture-reviewer", "database-reviewer", "deploy-helper", "performance-analyzer", "security-reviewer", "test-runner"],
    crossStack: ["accessibility-reviewer", "api-contract-reviewer", "cicd-reviewer", "compliance-reviewer", "dependency-reviewer", "error-handling-reviewer", "multi-tenancy-reviewer", "observability-reviewer"],
    pipeline: ["specifier", "plan-hardener", "executor", "reviewer-gate", "shipper"],
    invocation: "Select from agent picker dropdown in VS Code, or reference via #file:.github/agents/<name>.agent.md",
  },

  skills: {
    description: "8 multi-step executable procedures with validation gates",
    available: {
      "/database-migration": "Generate, review, test, and deploy schema migrations",
      "/staging-deploy": "Build, push, migrate, deploy, and verify on staging",
      "/test-sweep": "Run all test suites and aggregate results",
      "/dependency-audit": "Scan dependencies for vulnerabilities, outdated, license issues",
      "/code-review": "Comprehensive review: architecture, security, testing, patterns",
      "/release-notes": "Generate release notes from git history and CHANGELOG",
      "/api-doc-gen": "Generate or update OpenAPI spec, validate spec-to-code consistency",
      "/onboarding": "Walk a new developer through project setup, architecture, first task",
    },
    invocation: "Type / in Copilot Chat to see available skills",
  },

  promptTemplates: {
    description: "15 scaffolding prompts for generating consistent code patterns",
    available: [
      "new-entity", "new-service", "new-controller", "new-repository", "new-test",
      "new-dto", "new-middleware", "new-event-handler", "new-worker", "new-config",
      "new-error-types", "new-dockerfile", "new-graphql-resolver", "bug-fix-tdd",
      "project-principles",
    ],
    invocation: "Attach via #file:.github/prompts/<name>.prompt.md in Copilot Chat",
  },

  lifecycleHooks: {
    description: "Automatic hooks that run during Copilot agent sessions",
    hooks: {
      SessionStart: "Injects Project Principles, current phase, and forbidden patterns into context",
      PreToolUse: "Blocks file edits to paths listed in the active plan's Forbidden Actions",
      PostToolUse: "Auto-formats edited files, warns on TODO/FIXME/stub markers",
      Stop: "Warns if code was modified but no test run was detected in the session",
    },
    config: ".github/hooks/plan-forge.json",
  },

  presets: {
    available: ["dotnet", "typescript", "python", "java", "go", "azure-iac", "custom"],
    description: "Stack-specific guardrail configurations with domain-relevant instruction files, agents, and prompts",
    counts: {
      dotnet: { instructions: 17, agents: 19, prompts: 15, skills: 8 },
      typescript: { instructions: 18, agents: 19, prompts: 15, skills: 8 },
      "azure-iac": { instructions: 12, agents: 18, prompts: 6, skills: 3 },
    },
  },

  executionModes: {
    auto: "gh copilot CLI executes each slice with full project context and model routing",
    assisted: "Human codes in VS Code Copilot; orchestrator prompts and validates gates",
    estimate: "Returns slice count, token estimate, and cost without executing",
    dryRun: "Parses and validates plan without executing",
    resumeFrom: "Skips completed slices and resumes from specified slice number",
  },
};

// ─── Capability Surface Builder ───────────────────────────────────────

/**
 * Build the full capability surface for forge_capabilities and .well-known.
 * @param {Array} mcpTools - Live TOOLS array from server.mjs
 * @param {object} options - { cwd, hubPort }
 */
export function buildCapabilitySurface(mcpTools, options = {}) {
  const { cwd = process.cwd(), hubPort = null } = options;

  // Enrich MCP tools with metadata
  const enrichedTools = mcpTools.map((tool) => {
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
    serverVersion: "2.3.0",
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
      },
      standalone: "node pforge-mcp/server.mjs --dashboard-only",
      description: "Use --dashboard-only to run the dashboard without MCP stdio (for standalone monitoring, demos, or testing)",
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
        { method: "GET", path: "/.well-known/plan-forge.json", description: "HTTP discovery endpoint" },
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
    extensions,
    memory: buildMemoryCapabilities(cwd),
    system: SYSTEM_REFERENCE,
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
