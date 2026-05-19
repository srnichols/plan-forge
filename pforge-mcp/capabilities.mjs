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
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { isOpenBrainConfigured } from "./memory.mjs";
import { TOOL_NAMES } from "./enums.mjs";

const VERSION = "2.3.0"; // capability-surface schema version (not the app version)

// App version — read from the repo's VERSION file at module load.
// Falls back gracefully if the file is missing (e.g. when Plan Forge is installed as a dependency).
const APP_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // pforge-mcp/capabilities.mjs → repo root is one level up
    const versionPath = join(here, "..", "VERSION");
    if (existsSync(versionPath)) {
      return readFileSync(versionPath, "utf-8").trim();
    }
  } catch { /* ignore */ }
  return "unknown";
})();

// ─── Enriched Tool Metadata + Workflows (extracted sub-module) ────────

import { TOOL_METADATA, WORKFLOWS } from './capabilities/tool-metadata.mjs';
export { TOOL_METADATA, WORKFLOWS };

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
        "--quorum": { type: "boolean|auto", description: "Force quorum on all slices, or 'auto' for threshold-based" },
        "--quorum-threshold": { type: "number", description: "Override complexity threshold (1-10, default: 6)" },
      },
      examples: [
        "pforge run-plan docs/plans/Phase-1.md",
        "pforge run-plan docs/plans/Phase-1.md --estimate",
        "pforge run-plan docs/plans/Phase-1.md --assisted",
        "pforge run-plan docs/plans/Phase-1.md --model claude-sonnet-4.6",
        "pforge run-plan docs/plans/Phase-1.md --resume-from 3",
        "pforge run-plan docs/plans/Phase-1.md --quorum",
        "pforge run-plan docs/plans/Phase-1.md --quorum=auto",
        "pforge run-plan docs/plans/Phase-1.md --quorum=auto --quorum-threshold 8",
        "pforge run-plan docs/plans/Phase-1.md --estimate --quorum",
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
    config: {
      description: "Read or write settable keys in .forge.json (v2.56.0+). Writes are atomic (tmp + rename). Use this instead of editing .forge.json by hand for schema-validated keys.",
      subcommands: {
        get: { description: "Read a value", args: [{ name: "key", type: "string", required: true }] },
        set: { description: "Write a value", args: [{ name: "key", type: "string", required: true }, { name: "value", type: "string", required: true }] },
        list: { description: "Show all settable keys and their current values", args: [] },
      },
      settableKeys: {
        "update-source": {
          jsonKey: "updateSource",
          allowed: ["auto", "github-tags", "local-sibling"],
          default: "auto",
          description: "Where `pforge update` pulls template bytes from. `auto` picks the newer of sibling clone and GitHub tag; `github-tags` ignores siblings; `local-sibling` always uses ../plan-forge (contributor workflow).",
        },
      },
      examples: [
        "pforge config get update-source",
        "pforge config set update-source github-tags",
        "pforge config list",
      ],
    },
    update: {
      description: "Update framework files from Plan Forge source. v2.56.0+ auto-selects source: picks newer of local sibling clone and latest GitHub tag (configurable via `updateSource` in .forge.json: auto|github-tags|local-sibling). Use `pforge self-update` to force-pull the latest GitHub release. Never clone the Plan Forge repo just to run an update — that's the first-time install path.",
      args: [{ name: "source", type: "path", required: false, description: "Optional explicit Plan Forge source path. Leave empty to use auto-mode." }],
      flags: {
        "--dry-run": { type: "boolean", description: "Preview changes without writing" },
        "--from-github": { type: "boolean", description: "Force GitHub tagged release source (ignore sibling clone)" },
        "--tag": { type: "string", description: "Specific tag to pull (e.g. v2.56.0); implies --from-github" },
        "--allow-dev": { type: "boolean", description: "Bypass the -dev-over-clean-release refusal guard" },
      },
      examples: [
        "pforge update                  # auto: newer of sibling or latest tag (v2.56.0+)",
        "pforge update --dry-run        # preview only, no writes",
        "pforge update --from-github    # force GitHub release source",
        "pforge self-update             # alias for latest GitHub release, overwrites existing install",
      ],
    },
    incident: {
      description: "Capture an incident — record description, severity, affected files, and optional resolution time for MTTR tracking",
      args: [{ name: "description", type: "string", required: true, description: "Short description of the incident" }],
      flags: {
        "--severity": { type: "string", enum: ["low", "medium", "high", "critical"], description: "Incident severity (default: medium)" },
        "--files": { type: "string", description: "Comma-separated list of affected file paths" },
        "--resolved-at": { type: "string", description: "ISO 8601 resolution timestamp for MTTR calculation (e.g., 2024-01-01T02:30:00Z)" },
      },
      examples: [
        'pforge incident "API latency spike on /checkout"',
        'pforge incident "Database connection pool exhausted" --severity high',
        'pforge incident "Deploy failed" --severity critical --files src/deploy.ts,infra/k8s.yaml',
        'pforge incident "Resolved: API latency" --resolved-at 2024-01-01T02:30:00Z',
      ],
    },
    triage: {
      description: "Triage open alerts — rank incidents and drift violations by priority (severity × recency). Read-only.",
      args: [],
      flags: {
        "--min-severity": { type: "string", enum: ["low", "medium", "high", "critical"], description: "Minimum severity to include (default: low)" },
        "--max": { type: "number", description: "Maximum number of alerts to return (default: 20)" },
      },
      examples: [
        "pforge triage",
        "pforge triage --min-severity high",
        "pforge triage --min-severity medium --max 10",
      ],
    },
    runbook: {
      description: "Generate a human-readable operational runbook from a hardened plan file — includes slices, scope, gates, and recent incidents",
      args: [{ name: "plan", type: "path", required: true, description: "Path to the plan file (e.g., docs/plans/Phase-1-AUTH-PLAN.md)" }],
      flags: {
        "--no-incidents": { type: "boolean", description: "Exclude recent incidents from the runbook" },
      },
      examples: [
        "pforge runbook docs/plans/Phase-1-AUTH-PLAN.md",
        "pforge runbook docs/plans/Phase-1-AUTH-PLAN.md --no-incidents",
      ],
    },
    // ─── LiveGuard CLI commands (v2.27+) ───
    drift: {
      description: "Score codebase against architecture guardrails — track drift over time",
      args: [],
      flags: { "--threshold": { type: "number", description: "Minimum acceptable score (default 70)" } },
      examples: ["pforge drift", "pforge drift --threshold 80"],
    },
    "deploy-log": {
      description: "Record a deployment — version, deployer, optional notes, slice ref",
      args: [{ name: "version", type: "string", required: true }],
      flags: {
        "--notes": { type: "string", description: "Deployment notes" },
        "--slice": { type: "string", description: "Related slice reference" },
      },
      examples: ["pforge deploy-log 2.52.1", "pforge deploy-log 2.52.1 --notes \"packaging hotfix\""],
    },
    "secret-scan": {
      description: "Scan recent commits for leaked secrets using Shannon entropy analysis",
      args: [],
      flags: { "--depth": { type: "number", description: "Number of commits to scan (default 20)" } },
      examples: ["pforge secret-scan", "pforge secret-scan --depth 50"],
    },
    "env-diff": {
      description: "Compare environment variable keys across .env files — detect missing keys",
      args: [],
      flags: {},
      examples: ["pforge env-diff"],
    },
    "regression-guard": {
      description: "Run validation gates from plan files — guard against regressions when files change",
      args: [],
      flags: {},
      examples: ["pforge regression-guard"],
    },
    hotspot: {
      description: "Identify git churn hotspots — most frequently changed files",
      args: [],
      flags: { "--top": { type: "number", description: "Top N files (default 20)" } },
      examples: ["pforge hotspot", "pforge hotspot --top 10"],
    },
    "dep-watch": {
      description: "Dependency vulnerability + freshness watcher",
      args: [],
      flags: {},
      examples: ["pforge dep-watch"],
    },
    "fix-proposal": {
      description: "Generate a fix-proposal plan for a drift or incident finding",
      args: [{ name: "finding-id", type: "string", required: true }],
      flags: {},
      examples: ["pforge fix-proposal drift-2026-04-19-001"],
    },
    "quorum-analyze": {
      description: "Assemble a quorum analysis prompt from LiveGuard data for multi-model dispatch",
      args: [],
      flags: {},
      examples: ["pforge quorum-analyze"],
    },
    "health-trend": {
      description: "Health trend analysis — drift, cost, incidents, model performance over time",
      args: [],
      flags: { "--window": { type: "string", description: "Time window (7d, 30d, 90d; default 30d)" } },
      examples: ["pforge health-trend", "pforge health-trend --window 7d"],
    },
    "org-rules": {
      description: "Export org custom instructions from .github/instructions/ for GitHub org settings",
      args: [{ name: "subcommand", type: "string", required: true, enum: ["export"] }],
      flags: {
        "--format": { type: "string", enum: ["github"], description: "Output format" },
        "--output": { type: "path", description: "Write to file instead of stdout" },
      },
      examples: ["pforge org-rules export", "pforge org-rules export --output org-rules.md"],
    },
    // ─── Version + release CLI (v2.33+) ───
    "self-update": {
      description: "Check for and install the latest Plan Forge release from GitHub",
      args: [],
      flags: {
        "--force": { type: "boolean", description: "Skip prompts" },
        "--dry-run": { type: "boolean", description: "Show what would happen" },
      },
      examples: ["pforge self-update", "pforge self-update --dry-run"],
    },
    "version-bump": {
      description: "Update VERSION, package.json, docs/README/ROADMAP version badges",
      args: [{ name: "version", type: "string", required: true }],
      flags: {},
      examples: ["pforge version-bump 2.53.0"],
    },
    "migrate-memory": {
      description: "Merge legacy *-history.json ledgers into canonical .jsonl siblings (idempotent)",
      args: [],
      flags: { "--dry-run": { type: "boolean", description: "Preview without modifying files" } },
      examples: ["pforge migrate-memory", "pforge migrate-memory --dry-run"],
    },
    "drain-memory": {
      description: "Drain pending OpenBrain queue records via the local MCP server REST endpoint",
      args: [],
      flags: {},
      examples: ["pforge drain-memory"],
    },
    // ─── Testbed CLI (v2.52+) ───
    "testbed-happypath": {
      description: "Run all happy-path testbed scenarios sequentially with aggregated pass/fail summary",
      args: [],
      flags: {
        "--dry-run": { type: "boolean", description: "List scenarios without executing" },
        "--testbed-path": { type: "path", description: "Path to the testbed repository" },
      },
      examples: ["pforge testbed-happypath", "pforge testbed-happypath --dry-run"],
    },
    // ─── Generic MCP proxy (v2.53+) ───
    "mcp-call": {
      description: "Invoke any MCP tool by name via the local MCP server on :3100 — covers tools without dedicated CLI wrappers",
      args: [{ name: "tool", type: "string", required: true, description: "Tool name (e.g., forge_crucible_list or crucible-list)" }],
      flags: {
        "--json": { type: "string", description: "JSON payload to send as params" },
      },
      examples: [
        "pforge mcp-call forge_crucible_list",
        "pforge mcp-call forge_bug_register --json '{\"severity\":\"high\",\"title\":\"x\"}'",
        "pforge mcp-call crucible-submit --title=\"Pagination\" --description=\"...\"",
      ],
    },
    // ─── OpenBrain L3 memory helpers (v3.6.0; brain test/replay receipt fix in v3.6.1) ───
    brain: {
      description: "OpenBrain (L3 memory) helpers — local config check, install hint, round-trip self-test, and replay of capture-only records",
      args: [
        { name: "subcommand", type: "string", required: true, description: "One of: status, hint, test, replay" },
        { name: "source", type: "string", required: false, description: "(replay only) Path to a .jsonl queue file, a single .md file, or a directory of .md files" },
      ],
      flags: {
        "--ping": { type: "boolean", description: "(status only) Probe the OpenBrain endpoint after local config check" },
        "--dry-run": { type: "boolean", description: "(replay only) Preview records without sending to OpenBrain" },
        "--project": { type: "string", description: "(replay only) Override project tag (defaults to .forge.json projectName or 'plan-forge')" },
        "--rate": { type: "number", description: "(replay only) Rate-limit between sends in milliseconds" },
        "--max": { type: "number", description: "(replay only) Cap on number of records to replay" },
      },
      examples: [
        "pforge brain status",
        "pforge brain status --ping",
        "pforge brain hint",
        "pforge brain test",
        "pforge brain replay .forge/openbrain-queue.jsonl",
        "pforge brain replay docs/plans/Phase-X-PLAN.md --dry-run",
      ],
    },
    tour: {
      description: "Guided walkthrough of your installed Plan Forge files",
      args: [],
      flags: {},
      examples: ["pforge tour"],
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
    preset: { type: "string", enum: ["dotnet", "typescript", "python", "java", "go", "swift", "azure-iac", "custom"] },
    agents: { type: "array", items: { type: "string", enum: ["claude", "cursor", "codex"] }, description: "Configured agent adapters" },
    modelRouting: {
      type: "object",
      properties: {
        execute: { type: "string", description: "Model for slice execution" },
        review: { type: "string", description: "Model for reviews" },
        default: {
          type: "string",
          enum: ["auto", "claude-opus-4.7", "claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5", "gpt-5.4", "gpt-5.2-codex", "gpt-5-mini", "gemini-3-pro-preview"],
          default: "auto",
        },
      },
    },
    maxParallelism: { type: "number", default: 3, minimum: 1, maximum: 10, description: "Max concurrent parallel slices" },
    maxRetries: { type: "number", default: 1, minimum: 0, maximum: 5, description: "Gate failure retry attempts" },
    maxRunHistory: { type: "number", default: 50, minimum: 1, description: "Max run directories to retain" },
    quorum: {
      type: "object",
      description: "Multi-model consensus configuration (v2.5)",
      properties: {
        enabled: { type: "boolean", default: false, description: "Master switch for quorum mode" },
        auto: { type: "boolean", default: true, description: "When enabled, only quorum high-complexity slices" },
        threshold: { type: "number", default: 6, minimum: 1, maximum: 10, description: "Complexity score threshold for auto mode" },
        models: { type: "array", items: { type: "string" }, default: ["claude-opus-4.7", "gpt-5.3-codex", "gemini-3.1-pro"], description: "Models for dry-run fan-out" },
        reviewerModel: { type: "string", default: "claude-opus-4.7", description: "Model for synthesis review" },
        dryRunTimeout: { type: "number", default: 300000, description: "Timeout per dry-run worker (ms)" },
        strictAvailability: { type: "boolean", default: false, description: "When true, fast-fail (exit 2) if any configured model is unavailable. When false (default), drop unavailable models and continue if ≥1 remain" },
      },
    },
    extensions: { type: "array", items: { type: "string" }, description: "Installed extensions" },
    hooks: {
      type: "object",
      description: "LiveGuard hook configuration (v2.29)",
      properties: {
        preDeploy: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true, description: "Enable or disable the PreDeploy hook" },
            blockOnSecrets: { type: "boolean", default: true, description: "Block deploy when secrets detected" },
            warnOnEnvGaps: { type: "boolean", default: true, description: "Warn on env key gaps" },
            scanSince: { type: "string", default: "HEAD~1", description: "Git range for secret scan" },
          },
        },
        postSlice: {
          type: "object",
          properties: {
            silentDeltaThreshold: { type: "number", default: 5, description: "Drift delta below this is silent" },
            warnDeltaThreshold: { type: "number", default: 10, description: "Drift delta above this is a warning" },
            scoreFloor: { type: "number", default: 70, description: "Score below this triggers red warning" },
          },
        },
        preAgentHandoff: {
          type: "object",
          properties: {
            injectContext: { type: "boolean", default: true, description: "Inject LiveGuard context on session start" },
            runRegressionGuard: { type: "boolean", default: true, description: "Run regression guard on handoff" },
            cacheMaxAgeMinutes: { type: "number", default: 30, description: "Max cache age before re-running tools" },
            minAlertSeverity: { type: "string", default: "medium", description: "Minimum severity for injected alerts" },
          },
        },
      },
    },
    openclaw: {
      type: "object",
      description: "OpenClaw analytics bridge — optional POST on PreAgentHandoff (v2.29)",
      properties: {
        endpoint: { type: "string", description: "OpenClaw ingest endpoint URL" },
        apiKey: { type: "string", description: "API key (or use .forge/secrets.json OPENCLAW_API_KEY)" },
      },
    },
    // Phase-25 v2.57 inner-loop subsystems (all opt-in; existing users see no change)
    runtime: {
      type: "object",
      description: "Phase-25 v2.57 inner-loop runtime configuration (opt-in subsystems)",
      properties: {
        gateSynthesis: {
          type: "object",
          description: "Phase-25 L6 — adaptive gate synthesis from Tempering minima. Suggest-only by default; never mutates plans.",
          properties: {
            mode: { type: "string", enum: ["off", "suggest", "enforce"], default: "suggest", description: "off=silent, suggest=print advisory, enforce=track in .forge/gate-suggestions.jsonl (Phase-26)" },
            domains: { type: "array", items: { type: "string", enum: ["domain", "integration", "controller"] }, default: ["domain", "integration", "controller"], description: "Which Tempering profiles to emit suggestions for" },
          },
        },
        reviewer: {
          type: "object",
          description: "Phase-25 L4 — opt-in speed-quorum reviewer that scores slice diffs inside brain.gate-check. Advisory-only in v2.57.",
          properties: {
            enabled: { type: "boolean", default: false, description: "Master switch (opt-in)" },
            quorumPreset: { type: "string", enum: ["speed", "power"], default: "speed", description: "Which quorum preset to use (D5 default: speed)" },
            blockOnCritical: { type: "boolean", default: false, description: "When true, critical verdicts block the next slice. Advisory-only (false) in v2.57 per D6" },
            timeoutMs: { type: "number", default: 30000, minimum: 1, description: "Max time to wait for reviewer response" },
          },
        },
      },
    },
    brain: {
      type: "object",
      description: "Phase-25 L2/L4 memory subsystem configuration",
      properties: {
        federation: {
          type: "object",
          description: "Phase-25 L4-lite — cross-project read-only memory federation. Opt-in; absolute local paths only (D9).",
          properties: {
            enabled: { type: "boolean", default: false, description: "Master switch (opt-in)" },
            repos: { type: "array", items: { type: "string" }, default: [], description: "Absolute local repo paths. Relative paths and URL schemes (http/https/ssh/git) are rejected" },
          },
        },
      },
    },
  },
};

// ─── System Reference ─────────────────────────────────────────────────

const SYSTEM_REFERENCE = {
  name: "Plan Forge",
  description: "AI coding guardrails that convert rough ideas into hardened execution contracts. Spec-driven framework with autonomous execution, cost tracking, telemetry, and persistent memory.",
  version: VERSION,
  repository: "https://github.com/srnichols/plan-forge",
  website: "https://planforge.software",

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
    description: "7-step planning and execution pipeline with 3-session isolation",
    steps: {
      "Step 0": { name: "Specify", prompt: "step0-specify-feature.prompt.md", agent: "specifier", description: "Define what and why" },
      "Step 1": { name: "Preflight", prompt: "step1-preflight-check.prompt.md", description: "Verify prerequisites" },
      "Step 2": { name: "Harden", prompt: "step2-harden-plan.prompt.md", agent: "plan-hardener", description: "Convert spec into binding execution contract with slices, gates, scope" },
      "Step 3": { name: "Execute", prompt: "step3-execute-slice.prompt.md", agent: "executor", description: "Build slice-by-slice. Also: pforge run-plan (automated)" },
      "Step 4": { name: "Sweep", prompt: "step4-completeness-sweep.prompt.md", description: "Eliminate TODO/stub/mock markers" },
      "Step 5": { name: "Review", prompt: "step5-review-gate.prompt.md", agent: "reviewer-gate", description: "Independent audit for drift, compliance, quality" },
      "Step 6": { name: "Ship", prompt: "step6-ship.prompt.md", agent: "shipper", description: "Commit, update roadmap, capture lessons to memory" },
    },
    sessionIsolation: "Steps 0-2 in Session 1, Steps 3-4 in Session 2, Step 5 in Session 3, Step 6 in Session 4 (prevents context bleed)",
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
    description: "15-18 instruction files per preset that auto-load based on the file being edited. Each includes Temper Guards (agent shortcut prevention) and Warning Signs (behavioral anti-patterns).",
    shared: ["architecture-principles", "context-fuel", "git-workflow", "ai-plan-hardening-runbook", "project-principles", "status-reporting"],
    features: {
      temperGuards: "Tables of common shortcuts agents take (excuses + rebuttals) embedded in each instruction file — prevents quality erosion within passing builds",
      warningSigns: "Observable behavioral anti-patterns listed in each instruction file — helps agents and reviewers detect violations during and after execution",
      contextFuel: "Meta-instruction that teaches agents context window management — when to load what, recognizing degradation, session boundaries",
    },
    perStack: {
      dotnet: ["api-patterns", "auth", "caching", "dapr", "database", "deploy", "errorhandling", "graphql", "messaging", "multi-environment", "naming", "observability", "performance", "security", "testing", "version"],
      typescript: ["...same + frontend"],
      swift: ["api-patterns", "auth", "caching", "database", "deploy", "errorhandling", "messaging", "multi-environment", "naming", "observability", "performance", "security", "testing", "version"],
    },
    mechanism: "YAML frontmatter applyTo glob pattern → Copilot loads matching files automatically",
  },

  agents: {
    description: "20 specialized AI reviewer/executor agents per app preset, including a read-only health auditor",
    stackSpecific: ["architecture-reviewer", "database-reviewer", "deploy-helper", "performance-analyzer", "security-reviewer", "test-runner"],
    crossStack: ["accessibility-reviewer", "api-contract-reviewer", "cicd-reviewer", "compliance-reviewer", "dependency-reviewer", "error-handling-reviewer", "multi-tenancy-reviewer", "observability-reviewer"],
    pipeline: ["specifier", "plan-hardener", "executor", "reviewer-gate", "shipper"],
    health: ["plan-health-auditor"],
    invocation: "Select from agent picker dropdown in VS Code, or reference via #file:.github/agents/<name>.agent.md",
  },

  skills: {
    description: "14 multi-step executable procedures with validation gates, MCP tool integration, Temper Guards, Exit Proof, and Warning Signs per Skill Blueprint spec",
    format: "Every skill follows the Skill Blueprint (docs/SKILL-BLUEPRINT.md): Frontmatter → Trigger → Steps → Safety Rules → Temper Guards → Warning Signs → Exit Proof → Persistent Memory",
    available: {
      "/database-migration": "Generate, review, test, and deploy schema migrations",
      "/staging-deploy": "Build, push, migrate, deploy, and verify on staging (forge_validate pre-flight)",
      "/test-sweep": "Run all test suites, aggregate results, forge_sweep completeness scan",
      "/dependency-audit": "Scan dependencies for vulnerabilities, outdated, license issues",
      "/code-review": "Comprehensive review: architecture, security, testing, patterns (forge_analyze + forge_diff)",
      "/release-notes": "Generate release notes from git history and CHANGELOG",
      "/api-doc-gen": "Generate or update OpenAPI spec, validate spec-to-code consistency (forge_analyze)",
      "/onboarding": "Walk a new developer through project setup, architecture, first task (forge_smith)",
      "/health-check": "Forge diagnostic: forge_smith → forge_validate → forge_sweep with structured report",
      "/forge-execute": "Guided plan execution: list plans → estimate cost → choose mode → execute → report",
      "/forge-quench": "Systematically reduce code complexity while preserving behavior — measure, understand (Chesterton's Fence), propose, prove, report",
      "/forge-troubleshoot": "Diagnose forge/plan execution failures — gather logs, traces, and state for root-cause analysis",
      "/security-audit": "OWASP scan, dependency audit, secrets detection with severity report",
      "/audit-loop": "Recursive audit drain — scan → triage → fix, repeat until convergence (Phase-39)",
    },
    invocation: "Type / in Copilot Chat to see available skills, or use forge_run_skill MCP tool",
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
    available: ["dotnet", "typescript", "python", "java", "go", "swift", "azure-iac", "custom"],
    description: "Stack-specific guardrail configurations with domain-relevant instruction files, agents, and prompts",
    counts: {
      dotnet: { instructions: 17, agents: 19, prompts: 15, skills: 8 },
      typescript: { instructions: 18, agents: 19, prompts: 15, skills: 8 },
      swift: { instructions: 15, agents: 17, prompts: 13, skills: 8 },
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

  glossary: {
    // Core concepts
    "Plan Forge": "The framework itself — AI coding guardrails that enforce spec-driven development",
    "Forge": "Shorthand for Plan Forge. Also: .forge/ directory (project data), .forge.json (project config)",
    "Plan": "A Markdown file in docs/plans/ describing a feature to build. Contains slices, scope contract, and validation gates",
    "Hardened Plan": "A plan that has been through Step 2 (hardening) — locked-down execution contract with slices, gates, forbidden actions. The AI cannot deviate from it",
    "Slice": "A single unit of execution within a plan. Each slice has tasks, a validation gate, and optional dependencies. Like a sprint task but machine-executable",
    "Validation Gate": "Build + test commands that must pass at every slice boundary before proceeding. The quality checkpoint",
    "Gate": "Short for Validation Gate",
    "Scope Contract": "Section of a plan defining what files are In Scope, Out of Scope, and Forbidden. Prevents scope creep",
    "Forbidden Actions": "Files or operations the AI must not touch during execution. Enforced by lifecycle hooks and scope checks",
    "Stop Condition": "A condition that halts execution — e.g., 'If migration fails, STOP'",

    // Pipeline
    "Pipeline": "The 7-step process: Specify → Preflight → Harden → Execute → Sweep → Review → Ship",
    "Step 0 (Specify)": "Define what and why — structured specification with acceptance criteria",
    "Step 2 (Harden)": "Convert spec into binding execution contract with slices, gates, and scope",
    "Step 3 (Execute)": "Build code slice-by-slice. Can be automated (pforge run-plan) or manual (Agent Mode)",
    "Step 5 (Review Gate)": "Independent audit session — checks for drift, scope violations, and quality",

    // Execution
    "Full Auto": "Execution mode where gh copilot CLI runs each slice automatically with no human intervention",
    "Assisted": "Execution mode where human codes in VS Code while orchestrator validates gates between slices",
    "Worker": "The CLI process that executes a slice — usually gh copilot, with fallback to claude or codex CLI",
    "DAG": "Directed Acyclic Graph — the dependency graph of slices. Determines execution order",
    "[P] tag": "Parallel-safe marker on a slice header. Enables concurrent execution with other [P] slices",
    "[depends: Slice N]": "Dependency marker. This slice waits for Slice N to complete before starting",
    "[scope: path/**]": "File scope marker. Restricts the worker to these file paths. Enables conflict detection for parallel slices",

    // Components
    "Smith": "The diagnostic tool (pforge smith). Inspects environment, VS Code config, setup health, version currency. Named after a blacksmith inspecting the forge",
    "Sweep": "Completeness scan (pforge sweep). Finds TODO, FIXME, HACK, stub, placeholder markers in code",
    "Analyze": "Cross-artifact consistency scoring (pforge analyze). Scores 0-100 across traceability, coverage, tests, gates",
    "Orchestrator": "The execution engine (pforge-mcp/orchestrator.mjs). Parses plans, schedules slices, spawns workers, validates gates",
    "Hub": "WebSocket event server (pforge-mcp/hub.mjs). Broadcasts slice lifecycle events to connected clients in real-time",
    "Dashboard": "Web UI at localhost:3100/dashboard. FORGE section (10 tabs: Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces, Skills, Watcher) + LIVEGUARD section (5 tabs: Health, Incidents, Triage, Security, Env)",

    // Infrastructure
    "Guardrails": "Instruction files (.github/instructions/*.instructions.md) that auto-load based on the file being edited. 15-18 per preset",
    "Preset": "Stack-specific configuration (dotnet, typescript, python, java, go, swift, azure-iac). Determines which guardrails, agents, and prompts are installed",
    "Extension": "A community add-on providing additional agents, prompts, or instructions for specific domains (e.g., azure-infrastructure)",
    "Lifecycle Hook": "Automatic actions during Copilot sessions — SessionStart, PreToolUse, PostToolUse, Stop",

    // Data
    "Run": "A single execution of a plan. Creates .forge/runs/<timestamp>/ with results, traces, and logs",
    "Trace": "OTLP-compatible JSON (trace.json) recording the full execution with spans, events, and timing",
    "Span": "A timed unit within a trace — run-plan (root), slice (child), gate (grandchild)",
    "Manifest": "Per-run manifest.json listing all artifacts (files) produced by that run",
    "Index": ".forge/runs/index.jsonl — append-only global run registry for instant lookup",
    "Cost History": ".forge/cost-history.json — aggregate token/cost data across all runs",

    // Memory
    "OpenBrain": "Optional companion MCP server providing persistent semantic memory across sessions",
    "Thought": "A unit of knowledge in OpenBrain — a decision, convention, lesson, or insight captured for future retrieval",
    "search_thoughts": "OpenBrain tool to find prior decisions relevant to current work",
    "capture_thought": "OpenBrain tool to save a decision or lesson for future sessions",

    // Quorum (v2.5)
    "Quorum Mode": "Multi-model consensus execution. Dispatches a slice to 3+ AI models for dry-run analysis, synthesizes the best approach, then executes with higher confidence",
    "Dry-Run": "A quorum analysis mode where the worker produces a detailed implementation plan without executing any code changes",
    "Quorum Dispatch": "The fan-out phase: sending the same slice to multiple models (Claude, GPT, Gemini) in parallel for independent analysis",
    "Quorum Reviewer": "A synthesis agent that merges multiple dry-run responses into a single unified execution plan",
    "Complexity Score": "A 1-10 rating of a slice's technical difficulty based on file scope, dependencies, security keywords, database operations, gate count, task count, and historical failure rate",
    "Quorum Auto": "Threshold-based mode where only slices scoring above the configured threshold (default: 6) use quorum. Others run normally",
  },
};

// ─── Capability Surface Builder ───────────────────────────────────────

/**
 * Build the full capability surface for forge_capabilities and .well-known.
 * @param {Array} [mcpTools] - Live TOOLS array from server.mjs. If omitted, builds from TOOL_METADATA keys.
 * @param {object} [options] - { cwd, hubPort }
 */
// ─── Phase-25 v2.57: Inner-Loop Subsystem Surface ────────────────────

/**
 * Declarative description of the inner-loop subsystems added in Phase-25.
 * Surfaces via `forge_capabilities` so IDEs + MCP consumers (including the
 * Dashboard Config tab) auto-discover the subsystems and their opt-in state.
 * All new subsystems default off/suggest/read-only per the Phase-25 opt-in
 * invariant — existing users see zero behavior change.
 */
export const INNER_LOOP_SURFACE = Object.freeze({
  schemaVersion: "1.1",
  description: "Inner-loop feedback subsystems. Phase-25 (v2.57) shipped reflexion/trajectory/autoSkills/gateSynthesis/postmortem/federation/reviewer. Phase-26 (v2.58) adds competitive/autoFix/costAnomaly. All subsystems are opt-in for existing users; new projects receive the best-defaults preset via setup.ps1/setup.sh.",
  subsystems: {
    reflexion: {
      level: "L7",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "On gate-fail retry, injects a Markdown reflexion block (gate name, model, durationMs, stderrTail ≤2KB) into the next attempt's prompt so the worker can reason about its prior failure.",
      configKey: null,
      dashboardTab: "Traces",
      module: "pforge-mcp/memory.mjs → buildReflexionBlock()",
    },
    trajectory: {
      level: "L8",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "On slice pass, extracts a sentinel-wrapped trajectory note (≤500 words) from the worker output and writes it to .forge/trajectories/<slice>/<iso>.md for postmortem + federation consumers.",
      configKey: null,
      storage: ".forge/trajectories/",
      dashboardTab: "Replay",
      module: "pforge-mcp/memory.mjs → writeTrajectory()",
    },
    autoSkills: {
      level: "L2",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "Captures slice patterns as auto-skill Markdown files under .forge/auto-skills/ and promotes them once reuseCount reaches the promotion threshold (default 3). Skills are injected into future matching slices.",
      configKey: null,
      storage: ".forge/auto-skills/",
      promotionThreshold: 3,
      dashboardTab: "Skills",
      module: "pforge-mcp/memory.mjs → retrieveAutoSkills() / writeAutoSkill()",
    },
    gateSynthesis: {
      level: "L6",
      addedIn: "2.57.0",
      enabledByDefault: true,
      mode: "suggest",
      description: "Scans plan slices against Tempering domain minima. When a slice matches a profile (domain/integration/controller) but declares no validation gate, prints a suggested command. Never mutates plans. Enforce-mode tracking deferred to Phase-26.",
      configKey: "runtime.gateSynthesis",
      configDefaults: { mode: "suggest", domains: ["domain", "integration", "controller"] },
      dashboardTab: "Config",
      module: "pforge-mcp/orchestrator.mjs → synthesizeGateSuggestions()",
    },
    postmortem: {
      level: "L5",
      addedIn: "2.57.0",
      enabledByDefault: true,
      description: "After every run (pass or fail), writes a JSON postmortem with retriesPerSlice, gateFlaps, costDelta, driftDelta, topFailureReason. Retention 10 per plan (D7). Step-2 hardener reads the newest 3 to fold signal back into scope decisions.",
      storage: ".forge/plans/<plan-basename>/postmortem-*.json",
      retentionCount: 10,
      dashboardTab: "Runs",
      module: "pforge-mcp/orchestrator.mjs → buildPlanPostmortem() / writePlanPostmortem()",
    },
    federation: {
      level: "L4-lite",
      addedIn: "2.57.0",
      enabledByDefault: false,
      description: "Read-only cross-project memory fan-out. On brain.recall for a cross.* key that misses L3, reads peer projects' .forge/brain/<entity>/<id>.json. Absolute local paths only; URLs and relative paths rejected.",
      configKey: "brain.federation",
      configDefaults: { enabled: false, repos: [] },
      securityPosture: "absolute-local-paths-only (D9); '..' rejected; defense-in-depth checks resolved path lives under declared repo root",
      dashboardTab: "Config",
      module: "pforge-mcp/brain.mjs → federationRead()",
    },
    reviewer: {
      level: "L4",
      addedIn: "2.57.0",
      enabledByDefault: false,
      advisoryOnly: true,
      description: "Opt-in speed-quorum reviewer that scores slice diffs inside brain.gate-check. Advisory-only in v2.57; critical verdicts do NOT block unless operators explicitly set blockOnCritical=true.",
      configKey: "runtime.reviewer",
      configDefaults: { enabled: false, quorumPreset: "speed", blockOnCritical: false, timeoutMs: 30000 },
      dashboardTab: "Config",
      module: "pforge-mcp/brain.mjs → invokeReviewer()",
    },

    // ─── Phase-26 v2.58 additions ────────────────────────────────
    // Each subsystem ships in advisory posture by default. None take a
    // destructive action without an explicit opt-in.
    competitive: {
      level: "L9",
      addedIn: "2.58.0",
      enabledByDefault: false,
      description: "Opt-in worktree-based competitive execution. Two or more strategies race to complete a slice under isolated worktrees; the winner is elected by gate + reviewer verdict + token-cost tie-breaker. Other worktrees are cleaned up. Off by default — opt in via innerLoop.competitive.enabled.",
      configKey: "innerLoop.competitive",
      configDefaults: { enabled: false, maxParallel: 2, timeoutSec: 1800 },
      dashboardTab: "Inner Loop",
      module: "pforge-mcp/orchestrator.mjs → runCompetitiveSlice()",
    },
    autoFix: {
      level: "L6",
      addedIn: "2.58.0",
      enabledByDefault: true,
      advisoryOnly: true,
      description: "Drafts patch files under .forge/proposed-fixes/*.patch when a gate-fail trajectory suggests a small, local correction. Never auto-applies without applyWithoutReview=true.",
      configKey: "innerLoop.autoFix",
      configDefaults: { enabled: true, applyWithoutReview: false },
      storage: ".forge/proposed-fixes/",
      dashboardTab: "Inner Loop",
      module: "pforge-mcp/orchestrator.mjs → applyFixProposal() / rollbackFixProposal()",
    },
    costAnomaly: {
      level: "L5",
      addedIn: "2.58.0",
      enabledByDefault: true,
      advisoryOnly: true,
      description: "Detects slices whose token cost drifts above the per-model median by more than the configured ratio. Advisory only — surfaces on Dashboard → Inner Loop → Cost anomalies; never halts a run.",
      configKey: "innerLoop.costAnomaly",
      configDefaults: { enabled: true, ratio: 2.0, medianWindow: 20 },
      storage: ".forge/cost-anomalies.jsonl",
      dashboardTab: "Inner Loop",
      module: "pforge-mcp/orchestrator.mjs → detectCostAnomaly() / computeMedian()",
    },
  },
});

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
