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
    quorum: {
      addedIn: "2.5.0",
      description: "Multi-model consensus: dispatch to 3+ models for dry-run analysis, synthesize best approach, then execute",
      parameters: {
        quorum: { type: "string", enum: ["false", "true", "auto"], default: "auto", description: "Quorum mode (default: 'auto' — threshold-based; 'true' forces all slices; 'false' disables)" },
        quorumThreshold: { type: "number", description: "Complexity score threshold for auto mode (1-10, default: 6)" },
      },
      config: ".forge.json → quorum { enabled, auto, threshold, models[], reviewerModel, dryRunTimeout }",
    },
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
    consumes: [".forge/cost-history.json", ".forge/model-performance.json"],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { runs: 5, total_cost_usd: 1.23, by_model: {}, forge_model_stats: { "claude-sonnet-4.6": { total_slices: 10, passed: 9, failed: 1, success_rate: 0.9, avg_cost_usd: 0.05 } } } },
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
    example: { input: {}, output: { tools: 28, workflows: 4, memory: { configured: true } } },
  },
  forge_diagnose: {
    intent: ["analyze", "debug", "investigate"],
    aliases: ["bug-investigate", "multi-model-debug", "root-cause"],
    cost: "medium",
    maxConcurrent: 3,
    addedIn: "2.15.0",
    prerequisites: ["file exists"],
    produces: [],
    consumes: ["src/**", "tests/**"],
    sideEffects: [],
    errors: {
      FILE_NOT_FOUND: { message: "Target file not found", recovery: "Check the file path" },
    },
    example: { input: { file: "src/api.ts" }, output: { diagnosis: "Root cause identified", models: 3 } },
  },
  forge_skill_status: {
    intent: ["read", "status", "skills"],
    aliases: ["skill-events", "recent-skills"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.16.0",
    prerequisites: [],
    produces: [],
    consumes: [],
    sideEffects: [],
    errors: {},
    example: { input: {}, output: { events: [] } },
  },
  forge_run_skill: {
    intent: ["execute", "skill", "automate"],
    aliases: ["invoke-skill", "execute-skill"],
    cost: "medium",
    maxConcurrent: 3,
    addedIn: "2.16.0",
    prerequisites: ["skill exists"],
    produces: [],
    consumes: [".github/skills/*.md"],
    sideEffects: ["may modify source files depending on skill"],
    errors: {
      SKILL_NOT_FOUND: { message: "Skill not found", recovery: "Use forge_skill_status to list available skills" },
    },
    example: { input: { skill: "test-sweep" }, output: { status: "completed", steps: 5 } },
  },
  forge_org_rules: {
    intent: ["generate", "export", "org-standards"],
    aliases: ["org-rules-export", "org-instructions"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.15.0",
    prerequisites: [".forge.json exists"],
    produces: ["org-rules.instructions.md"],
    consumes: [".forge.json", ".github/instructions/*.instructions.md"],
    sideEffects: ["generates org-rules instruction file"],
    errors: {},
    example: { input: {}, output: { file: "org-rules.instructions.md", rules: 12 } },
  },
  forge_memory_capture: {
    intent: ["capture", "remember", "persist"],
    aliases: ["save-thought", "memory-broadcast"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.6.0",
    prerequisites: [],
    produces: [],
    consumes: [],
    sideEffects: ["broadcasts memory-captured hub event"],
    errors: {},
    example: { input: { content: "Use JWT for auth", type: "convention" }, output: { event: "memory-captured" } },
  },
  forge_generate_image: {
    intent: ["create", "generate", "image"],
    aliases: ["image-gen", "generate-artwork", "create-image"],
    cost: "medium",
    maxConcurrent: 3,
    addedIn: "2.17.0",
    prerequisites: ["XAI_API_KEY or OPENAI_API_KEY set"],
    produces: ["<outputPath>"],
    consumes: [],
    sideEffects: ["creates image file on disk", "calls external API"],
    errors: {
      NO_API_KEY: { message: "No image generation API key found", recovery: "Set XAI_API_KEY or OPENAI_API_KEY in env or .forge/secrets.json" },
      GENERATION_FAILED: { message: "Image generation failed", recovery: "Check the prompt, try a different model, or verify API key" },
    },
    example: { input: { prompt: "minimalist logo", outputPath: "assets/logo.webp" }, output: { file: "assets/logo.webp", model: "grok-imagine-image" } },
  },
  forge_drift_report: {
    intent: ["drift-detect", "architecture-audit", "guardrail-score"],
    aliases: ["drift-check", "drift-score", "arch-drift"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: ["git initialized"],
    produces: [".forge/drift-history.json"],
    consumes: [".github/instructions/*.instructions.md", "**/*.{js,ts,cs,py}"],
    sideEffects: ["appends to .forge/drift-history.json", "may fire drift-alert hub event"],
    errors: {
      NO_SOURCE_FILES: { message: "No source files found to analyze", recovery: "Check path argument" },
      ANALYSIS_FAILED: { message: "Rule analysis failed", recovery: "Check file permissions and path" },
    },
    example: { input: { threshold: 70 }, output: { score: 85, violations: [], trend: "stable", delta: 0, historyLength: 1 } },
  },
  forge_incident_capture: {
    intent: ["capture-incident", "record-outage", "track-mttr"],
    aliases: ["incident-capture", "record-incident", "log-incident"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: [".forge directory exists or will be created"],
    produces: [".forge/incidents.jsonl"],
    consumes: [".forge.json"],
    sideEffects: ["appends to .forge/incidents.jsonl", "may fire incident-captured hub event", "may dispatch bridge notification to onCall target"],
    errors: {
      RESOLVED_BEFORE_CAPTURED: { message: "resolvedAt is earlier than capturedAt", recovery: "Check the resolvedAt timestamp — it must be after the incident was captured" },
      INVALID_SEVERITY: { message: "severity must be low, medium, high, or critical", recovery: "Use one of: low, medium, high, critical" },
    },
    example: {
      input: { description: "API latency spike on /checkout", severity: "high", files: ["src/api/checkout.ts"] },
      output: { id: "inc-1700000000000", description: "API latency spike on /checkout", severity: "high", capturedAt: "2024-01-01T00:00:00.000Z", resolvedAt: null, mttr: null },
    },
  },
  forge_deploy_journal: {
    intent: ["record-deploy", "log-deployment", "deploy-tracking"],
    aliases: ["deploy-journal", "deploy-log", "record-deployment"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: [".forge directory exists or will be created"],
    produces: [".forge/deploy-journal.jsonl"],
    consumes: [],
    sideEffects: ["appends to .forge/deploy-journal.jsonl", "may fire deploy-recorded hub event"],
    errors: {
      MISSING_VERSION: { message: "version is required", recovery: "Supply a version string (e.g., 'v2.31.0')" },
    },
    example: {
      input: { version: "v2.31.0", by: "CI", notes: "hotfix for checkout timeout", slice: "S3" },
      output: { id: "deploy-1700000000000", version: "v2.31.0", by: "CI", notes: "hotfix for checkout timeout", slice: "S3", deployedAt: "2024-01-01T00:00:00.000Z" },
    },
  },
  forge_regression_guard: {
    intent: ["regression-check", "gate-validation", "ci-guard"],
    aliases: ["regression-guard", "run-gates", "guard-regressions"],
    cost: "medium",
    maxConcurrent: 1,
    addedIn: "2.29.0",
    prerequisites: ["docs/plans/ contains at least one *-PLAN.md (or supply plan arg)"],
    produces: [".forge/telemetry/tool-calls.jsonl"],
    consumes: ["docs/plans/*.md"],
    sideEffects: ["executes shell commands from validation gates"],
    errors: {
      NO_PLANS_FOUND: { message: "No plan files found in docs/plans/", recovery: "Supply a plan path via the plan argument or create a plan file" },
      GATE_FAILED: { message: "One or more validation gates failed", recovery: "Review failed gate output and fix the issue, then re-run" },
    },
    example: {
      input: { files: ["src/api.ts", "src/auth.ts"], failFast: false },
      output: { gatesChecked: 3, passed: 3, failed: 0, blocked: 0, skipped: 0, success: true },
    },
  },
  forge_runbook: {
    intent: ["generate-runbook", "document-plan", "ops-runbook"],
    aliases: ["runbook-gen", "plan-runbook", "generate-ops-doc"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.30.0",
    prerequisites: ["plan file exists"],
    produces: [".forge/runbooks/<plan-name>-runbook.md"],
    consumes: ["docs/plans/*.md", ".forge/incidents.jsonl"],
    sideEffects: ["creates .forge/runbooks/ directory", "writes runbook markdown file"],
    errors: {
      PLAN_NOT_FOUND: { message: "Plan file not found", recovery: "Check the plan path argument" },
    },
    example: {
      input: { plan: "docs/plans/Phase-1-AUTH-PLAN.md", includeIncidents: true },
      output: { runbook: ".forge/runbooks/phase-1-auth-plan-runbook.md", slices: 4, generatedAt: "2024-01-01T00:00:00.000Z" },
    },
  },
  forge_hotspot: {
    intent: ["churn-analysis", "hotspot-detect", "risk-files"],
    aliases: ["hotspot", "churn", "change-frequency"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.31.0",
    prerequisites: ["git initialized"],
    produces: [".forge/hotspot-cache.json"],
    consumes: ["git log history"],
    sideEffects: ["writes .forge/hotspot-cache.json (24h cache TTL)"],
    errors: {
      GIT_LOG_FAILED: { message: "git log command failed", recovery: "Ensure you are inside a git repository with commit history" },
      NO_COMMITS: { message: "No commits found in the given time range", recovery: "Widen the --since filter or check the branch has history" },
    },
    example: {
      input: { top: 5, since: "3 months ago" },
      output: { generatedAt: "2024-01-01T00:00:00.000Z", since: "3 months ago", totalFiles: 42, showing: 5, hotspots: [{ file: "src/api.ts", commits: 28 }] },
    },
  },
  forge_health_trend: {
    intent: ["health", "trend", "monitoring"],
    aliases: ["health-analysis", "system-health", "health-report"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.31.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/drift-history.json", ".forge/cost-history.json", ".forge/incidents.jsonl", ".forge/model-performance.json"],
    sideEffects: [],
    errors: {
      NO_DATA: { message: "No operational data found for the requested time window", recovery: "Run forge tools (drift, run-plan, incident) to generate data, or widen the --days window" },
    },
    example: {
      input: { days: 30 },
      output: { days: 30, healthScore: 87, trend: "stable", dataPoints: 15, drift: { snapshots: 5, avg: 85 }, cost: { runs: 3, totalUsd: 1.23 }, incidents: { total: 2, open: 0 }, models: { totalSlices: 10 } },
    },
  },
  forge_alert_triage: {
    intent: ["triage-alerts", "prioritize-incidents", "rank-alerts"],
    aliases: ["alert-triage", "triage", "prioritize-alerts"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.31.0",
    prerequisites: [],
    produces: [],
    consumes: [".forge/incidents.jsonl", ".forge/drift-history.json"],
    sideEffects: [],
    errors: {
      NO_ALERTS: { message: "No open alerts found matching the filter criteria", recovery: "Lower --min-severity or check that incidents exist in .forge/incidents.jsonl" },
      INVALID_SEVERITY: { message: "minSeverity must be low, medium, high, or critical", recovery: "Use one of: low, medium, high, critical" },
    },
    example: {
      input: { minSeverity: "medium", max: 5 },
      output: { total: 3, showing: 3, minSeverity: "medium", alerts: [{ source: "incident", id: "inc-1700000000000", description: "API latency spike", severity: "high", priority: 2.4, timestamp: "2024-01-01T00:00:00.000Z", files: ["src/api.ts"] }], generatedAt: "2024-01-01T00:00:00.000Z" },
    },
    notes: "Read-only — does not write to any data store. Priority = severity_weight × recency_factor. Tiebreak: more recent timestamp ranks higher.",
  },
  forge_dep_watch: {
    intent: ["dep-scan", "cve-check", "dependency-audit"],
    aliases: ["dep-watch", "dependency-watch", "cve-scan"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.27.0",
    prerequisites: ["package.json or package-lock.json in project root"],
    produces: [".forge/deps-snapshot.json"],
    consumes: ["package.json", "package-lock.json"],
    sideEffects: ["writes .forge/deps-snapshot.json", "may fire dep-vulnerability hub event"],
    errors: {
      NO_PACKAGE_JSON: { message: "No package.json found in project root", recovery: "Ensure you are in a Node.js project with a package.json file" },
      AUDIT_FAILED: { message: "npm audit command failed", recovery: "Check npm is installed and network connectivity; non-npm projects return graceful degradation" },
    },
    example: {
      input: { path: ".", notify: true },
      output: { newVulnerabilities: [], resolvedVulnerabilities: [], unchanged: 42, snapshot: { capturedAt: "2024-01-01T00:00:00.000Z", depCount: 42 } },
    },
  },
  forge_secret_scan: {
    intent: ["secret-scan", "entropy-scan", "leak-detection"],
    aliases: ["secret-scan", "scan-secrets", "entropy-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.28.0",
    prerequisites: ["git initialized"],
    produces: [".forge/secret-scan-cache.json"],
    consumes: ["git diff output"],
    sideEffects: ["writes .forge/secret-scan-cache.json", "may annotate .forge/deploy-journal-meta.json sidecar"],
    securityNote: "Never logs actual secret values — only file paths, line numbers, entropy scores, and <REDACTED> placeholders. All findings are masked before caching or emitting telemetry.",
    errors: {
      GIT_UNAVAILABLE: { message: "git is not available or not a git repository", recovery: "Ensure you are inside a git repository — tool degrades gracefully returning { clean: null, scannedFiles: 0, findings: [], error: 'git unavailable' }" },
      DIFF_TIMEOUT: { message: "git diff timed out (30s limit)", recovery: "Narrow the --since range to reduce diff size" },
    },
    example: {
      input: { since: "HEAD~1", threshold: 4.0 },
      output: { scannedAt: "2024-01-01T00:00:00.000Z", since: "HEAD~1", threshold: 4.0, scannedFiles: 5, clean: false, findings: [{ file: "src/config.js", line: 5, type: "api_key", entropyScore: 4.8, masked: "<REDACTED>", confidence: "high" }] },
    },
  },
  forge_env_diff: {
    intent: ["env-diff", "environment-comparison", "env-key-gaps"],
    aliases: ["env-diff", "compare-env", "env-check"],
    cost: "low",
    maxConcurrent: 10,
    addedIn: "2.28.0",
    prerequisites: ["baseline .env file exists"],
    produces: [".forge/env-diff-cache.json"],
    consumes: [".env", ".env.*"],
    sideEffects: ["writes .forge/env-diff-cache.json — key names only, no values"],
    securityNote: "Compares key names only — never reads, logs, or caches environment variable values.",
    errors: {
      BASELINE_NOT_FOUND: { message: "baseline .env file does not exist", recovery: "Create the baseline file or pass --baseline pointing to an existing .env file" },
      TARGET_NOT_FOUND: { message: "one or more target .env files not found", recovery: "Check the --files argument or ensure .env.* files exist in the project root" },
    },
    example: {
      input: { baseline: ".env", files: ".env.staging,.env.production" },
      output: { scannedAt: "2024-01-01T00:00:00.000Z", baseline: ".env", filesCompared: 2, pairs: [{ file: ".env.staging", missingInTarget: ["STRIPE_KEY"], missingInBaseline: [] }], summary: { clean: false, totalGaps: 1, baselineKeyCount: 12 } },
    },
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
  "quorum-execute": {
    description: "Run a plan with multi-model consensus on complex slices",
    steps: [
      { tool: "forge_run_plan", args: { estimate: true, quorum: "auto" }, decision: "Review estimate including quorum overhead. If acceptable, proceed." },
      { tool: "forge_run_plan", args: { quorum: "auto" }, decision: "Monitor at localhost:3100/dashboard — quorum legs visible in trace" },
      { tool: "forge_plan_status", description: "Check results including quorum scores per slice" },
      { tool: "forge_cost_report", description: "Review cost — includes quorum dry-run + reviewer tokens" },
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
    update: {
      description: "Update framework files from Plan Forge source",
      args: [{ name: "source", type: "path", required: false, description: "Plan Forge source path" }],
      flags: { "--dry-run": { type: "boolean" } },
      examples: ["pforge update ../plan-forge", "pforge update --dry-run"],
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
          enum: ["auto", "claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5", "gpt-5.4", "gpt-5.2-codex", "gpt-5-mini", "gemini-3-pro-preview"],
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
        models: { type: "array", items: { type: "string" }, default: ["claude-opus-4.6", "gpt-5.3-codex", "gemini-3.1-pro"], description: "Models for dry-run fan-out" },
        reviewerModel: { type: "string", default: "claude-opus-4.6", description: "Model for synthesis review" },
        dryRunTimeout: { type: "number", default: 300000, description: "Timeout per dry-run worker (ms)" },
      },
    },
    extensions: { type: "array", items: { type: "string" }, description: "Installed extensions" },
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
    description: "19 specialized AI reviewer/executor agents per app preset",
    stackSpecific: ["architecture-reviewer", "database-reviewer", "deploy-helper", "performance-analyzer", "security-reviewer", "test-runner"],
    crossStack: ["accessibility-reviewer", "api-contract-reviewer", "cicd-reviewer", "compliance-reviewer", "dependency-reviewer", "error-handling-reviewer", "multi-tenancy-reviewer", "observability-reviewer"],
    pipeline: ["specifier", "plan-hardener", "executor", "reviewer-gate", "shipper"],
    invocation: "Select from agent picker dropdown in VS Code, or reference via #file:.github/agents/<name>.agent.md",
  },

  skills: {
    description: "12 multi-step executable procedures with validation gates, MCP tool integration, Temper Guards, Exit Proof, and Warning Signs per Skill Blueprint spec",
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
    "Pipeline": "The 6-step process: Specify → Preflight → Harden → Execute → Sweep → Review",
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
    "Dashboard": "Web UI at localhost:3100/dashboard. 8 tabs: Progress, Runs, Cost, Actions, Replay, Extensions, Config, Traces",

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
export function buildCapabilitySurface(mcpTools, options = {}) {
  const { cwd = process.cwd(), hubPort = null } = options;

  // If no tools array provided, build minimal tool objects from TOOL_METADATA keys
  const tools = mcpTools || Object.keys(TOOL_METADATA).map((name) => ({ name, description: TOOL_METADATA[name]?.intent?.[0] || name }));

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
        { method: "GET", path: "/.well-known/plan-forge.json", description: "HTTP discovery endpoint — machine-readable surface for OpenClaw and external agents" },
        { method: "POST", path: "/api/runs/trigger", description: "Inbound run trigger — start a plan remotely (OpenClaw, CI). Auth: bridge.approvalSecret Bearer token. Body: { plan, quorum?, model?, resumeFrom?, estimate?, dryRun? }" },
        { method: "POST", path: "/api/runs/abort", description: "Abort an in-progress triggered run. Auth: bridge.approvalSecret Bearer token." },
        { method: "GET", path: "/api/memory", description: "OpenBrain connection status and endpoint" },
        { method: "POST", path: "/api/memory/search", description: "Search OpenBrain project memory. Body: { query, project?, limit? }" },
        { method: "POST", path: "/api/memory/capture", description: "Capture a thought into OpenBrain via REST (OpenClaw use). Auth: bridge.approvalSecret. Body: { content, project?, type?, source?, created_by? }" },
        { method: "GET", path: "/api/bridge/status", description: "Bridge status — channels, pending approvals, stats" },
        { method: "POST", path: "/api/bridge/approve/:runId", description: "Receive approval callback. Auth: bridge.approvalSecret. Body: { action: 'approve'|'reject', approver? }" },
        { method: "GET", path: "/api/bridge/approve/:runId", description: "Browser-friendly approval link for Telegram inline buttons. Query: ?action=approve|reject&token=<secret>" },
        // LiveGuard REST endpoints (v2.27.0)
        { method: "GET", path: "/api/drift", description: "Run architecture drift check against guardrail rules. Returns score, violations, trend." },
        { method: "GET", path: "/api/drift/history", description: "Drift score history from .forge/drift-history.json" },
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
