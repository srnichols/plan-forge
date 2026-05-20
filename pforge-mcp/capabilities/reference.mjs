/**
 * Plan Forge — System Reference sub-module
 *
 * Contains the APP_VERSION reader and SYSTEM_REFERENCE declarative surface.
 * Extracted from capabilities.mjs (Slice 3, Phase-51 capabilities split).
 *
 * @module capabilities/reference
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Capability-surface schema version (not the app version).
export const VERSION = "2.3.0";

// App version — read from the repo's VERSION file at module load.
// Falls back gracefully if the file is missing (e.g. when Plan Forge is installed as a dependency).
// NOTE: this file lives at pforge-mcp/capabilities/reference.mjs — repo root is two levels up.
export const APP_VERSION = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const versionPath = join(here, "..", "..", "VERSION");
    if (existsSync(versionPath)) {
      return readFileSync(versionPath, "utf-8").trim();
    }
  } catch { /* ignore */ }
  return "unknown";
})();

// ─── System Reference ─────────────────────────────────────────────────

export const SYSTEM_REFERENCE = {
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
      "[scope: path/**]": "File scope — limits worker to these paths, enables conflict detection for parallel slices",
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
