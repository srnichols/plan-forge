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
};

// ─── Config Schema ────────────────────────────────────────────────────

export const CONFIG_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: ".forge.json",
  type: "object",
  properties: {
    pipelineVersion: { type: "string", description: "Pipeline version", default: "2.0" },
    templateVersion: { type: "string", description: "Plan Forge template version" },
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
      tabs: ["Progress", "Runs", "Cost", "Actions", "Replay", "Extensions", "Config"],
    },
    hub: hubPort ? { url: `ws://127.0.0.1:${hubPort}`, status: "running" } : { status: "stopped" },
    extensions,
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
