/**
 * Plan Forge — CLI Schema and Config Schema
 *
 * Extracted from capabilities.mjs (Phase-51 Slice 2) to reduce module size.
 * These are re-exported by capabilities.mjs as part of the public surface.
 *
 * @module capabilities/schemas
 */

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
          enum: ["auto", "claude-opus-4.8", "claude-opus-4.7", "claude-opus-4.6", "claude-sonnet-5", "claude-sonnet-4.6", "claude-haiku-4.5", "gpt-5.4", "gpt-5.3-codex", "gpt-5-mini", "gemini-3.1-pro-preview"],
          default: "auto",
        },
      },
    },
    maxParallelism: { type: "number", default: 3, minimum: 1, maximum: 10, description: "Max concurrent parallel slices" },
    maxRetries: { type: "number", default: 1, minimum: 0, maximum: 5, description: "Gate failure retry attempts" },
    maxRunHistory: { type: "number", default: 50, minimum: 1, description: "Max run directories to retain" },
    quorum: {
      type: "object",
      description: "Multi-model consensus configuration (v2.5; defaults refreshed 2026-05-21)",
      properties: {
        enabled: { type: "boolean", default: false, description: "Master switch for quorum mode" },
        auto: { type: "boolean", default: true, description: "When enabled, only quorum high-complexity slices" },
        threshold: { type: "number", default: 5, minimum: 1, maximum: 10, description: "Complexity score threshold for auto mode (raised 3→5 on 2026-05-21 — threshold=3 was triggering quorum on ~89% of slices)" },
        preset: { type: "string", enum: ["speed", "power", "power-gov", "false"], description: "Optional named preset (overrides models/threshold/reviewerModel). Equivalent to CLI --quorum=<name>." },
        models: { type: "array", items: { type: "string" }, default: ["claude-opus-4.7", "gpt-5.3-codex", "grok-4.20-0309-reasoning"], description: "Models for dry-run fan-out (used when no preset is selected)" },
        reviewerModel: { type: "string", default: "claude-opus-4.8", description: "Model for synthesis review" },
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
