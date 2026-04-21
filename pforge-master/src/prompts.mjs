/**
 * Forge-Master Prompt Catalog (Phase-29, Slice 2).
 *
 * 30+ guided prompts across 7 categories, enabling the Forge-Master Studio
 * UI to offer one-click reasoning workflows.
 *
 * @module forge-master/prompts
 */

const CATALOG_VERSION = "1.0.0";

const CATEGORIES = [
  {
    id: "plan-status",
    label: "Plan Status & Operations",
    description: "Check the health, progress, and details of plan runs",
    prompts: [
      {
        id: "ps-current-status",
        title: "Current Plan Status",
        description: "Get a concise overview of the current plan run status",
        template: "What is the current status of the plan? Show me the latest run, which slices are complete, which are in-progress, and any failures.",
        placeholders: [],
        suggestedTools: ["forge_plan_status", "forge_phase_status", "forge_status"],
        category: "plan-status",
      },
      {
        id: "ps-phase-summary",
        title: "Phase Summary",
        description: "Summarize a specific phase's progress",
        template: "Summarize the progress of {{phase}}. How many slices are done, which are blocked, and what is the estimated completion?",
        placeholders: [{ key: "phase", label: "Phase name or number", example: "Phase-29" }],
        suggestedTools: ["forge_phase_status", "forge_plan_status"],
        category: "plan-status",
      },
      {
        id: "ps-run-diff",
        title: "Plan vs Reality Diff",
        description: "Compare what was planned vs what was actually implemented",
        template: "Show me the diff between the planned implementation and the current state of the codebase.",
        placeholders: [],
        suggestedTools: ["forge_diff", "forge_drift_report"],
        category: "plan-status",
      },
      {
        id: "ps-cost-overview",
        title: "Cost Overview",
        description: "Get a full cost breakdown for recent runs",
        template: "Give me a cost report for the last 30 days including per-model spend, token counts, and any anomalies.",
        placeholders: [],
        suggestedTools: ["forge_cost_report", "forge_estimate_quorum"],
        category: "plan-status",
      },
      {
        id: "ps-hotspots",
        title: "Code Hotspots",
        description: "Identify files with the most churn, bugs, or complexity",
        template: "What are the current code hotspots in this project? Which files have the most bugs, churn, or complexity?",
        placeholders: [],
        suggestedTools: ["forge_hotspot", "forge_sweep"],
        category: "plan-status",
      },
      {
        id: "ps-regression",
        title: "Regression Check",
        description: "Check for regressions in tests or performance",
        template: "Run a regression check and tell me if any tests, performance benchmarks, or quality metrics have regressed.",
        placeholders: [],
        suggestedTools: ["forge_regression_guard", "forge_health_trend"],
        category: "plan-status",
      },
    ],
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting & Diagnosis",
    description: "Diagnose failures, errors, and anomalies",
    prompts: [
      {
        id: "ts-diagnose-failure",
        title: "Diagnose Slice Failure",
        description: "Analyze a failed slice and suggest fixes",
        template: "The slice {{sliceName}} has failed. Diagnose the failure, explain the root cause, and suggest how to fix it.",
        placeholders: [{ key: "sliceName", label: "Slice name or ID", example: "Slice-03" }],
        suggestedTools: ["forge_diagnose", "forge_analyze", "forge_smith"],
        category: "troubleshooting",
      },
      {
        id: "ts-alert-triage",
        title: "Alert Triage",
        description: "Triage open alerts by severity and impact",
        template: "Triage all open alerts. Prioritize by severity, show affected systems, and recommend immediate actions.",
        placeholders: [],
        suggestedTools: ["forge_alert_triage", "forge_watch", "forge_health_trend"],
        category: "troubleshooting",
      },
      {
        id: "ts-drift",
        title: "Drift Analysis",
        description: "Analyze drift between plan and codebase",
        template: "How much drift is there between the plan and the actual codebase? What are the biggest gaps?",
        placeholders: [],
        suggestedTools: ["forge_drift_report", "forge_diff"],
        category: "troubleshooting",
      },
      {
        id: "ts-dep-vulnerabilities",
        title: "Dependency Vulnerabilities",
        description: "Check for outdated or vulnerable dependencies",
        template: "Scan for dependency vulnerabilities. List packages with CVEs, outdated versions, and license issues.",
        placeholders: [],
        suggestedTools: ["forge_dep_watch", "forge_sweep"],
        category: "troubleshooting",
      },
      {
        id: "ts-env-check",
        title: "Environment Health Check",
        description: "Run a full environment and setup validation",
        template: "Run a full health check on the project environment. Check setup, configuration, and report any issues.",
        placeholders: [],
        suggestedTools: ["forge_smith", "forge_validate"],
        category: "troubleshooting",
      },
      {
        id: "ts-quorum-issues",
        title: "Quorum Configuration Issues",
        description: "Diagnose quorum setup and model availability",
        template: "Diagnose the quorum configuration. Are all models available? Are there any setup issues affecting multi-model consensus?",
        placeholders: [],
        suggestedTools: ["forge_doctor_quorum", "forge_quorum_analyze"],
        category: "troubleshooting",
      },
    ],
  },
  {
    id: "crucible",
    label: "Feature Ideation → Crucible",
    description: "Start structured planning for new features through Crucible interviews",
    prompts: [
      {
        id: "cr-list-smelts",
        title: "List Active Smelts",
        description: "Show all current Crucible smelts and their status",
        template: "List all active Crucible smelts. Show which are in-progress, pending review, or ready to finalize.",
        placeholders: [],
        suggestedTools: ["forge_crucible_list"],
        category: "crucible",
      },
      {
        id: "cr-start-feature",
        title: "Start New Feature Smelt",
        description: "Submit a new idea to Crucible for structured planning",
        template: "I want to plan a new feature: {{featureDescription}}. Start a Crucible interview to turn this into a structured implementation plan.",
        placeholders: [{ key: "featureDescription", label: "Feature description", example: "User authentication with OAuth2" }],
        suggestedTools: ["forge_crucible_submit", "forge_crucible_ask"],
        category: "crucible",
        requiresApproval: false,
      },
      {
        id: "cr-preview-plan",
        title: "Preview Draft Plan",
        description: "Preview the draft plan from an active Crucible smelt",
        template: "Preview the current draft plan for smelt {{smeltId}}. Show all phases, slices, and estimates.",
        placeholders: [{ key: "smeltId", label: "Smelt ID", example: "smelt-abc123" }],
        suggestedTools: ["forge_crucible_preview"],
        category: "crucible",
      },
      {
        id: "cr-answer-question",
        title: "Answer Interview Question",
        description: "Answer a pending Crucible interview question",
        template: "For smelt {{smeltId}}, answer the current interview question: {{answer}}",
        placeholders: [
          { key: "smeltId", label: "Smelt ID", example: "smelt-abc123" },
          { key: "answer", label: "Your answer", example: "We need OAuth2 with GitHub and Google providers" },
        ],
        suggestedTools: ["forge_crucible_ask"],
        category: "crucible",
      },
      {
        id: "cr-health-check",
        title: "Crucible Health Check",
        description: "Check for stalled or orphan smelts",
        template: "Are there any stalled or orphan Crucible smelts? Show me their age and what action is needed.",
        placeholders: [],
        suggestedTools: ["forge_crucible_list", "forge_diagnose"],
        category: "crucible",
      },
    ],
  },
  {
    id: "cost-quorum",
    label: "Cost & Quorum Analysis",
    description: "Analyze costs, estimates, and multi-model quorum results",
    prompts: [
      {
        id: "cq-estimate",
        title: "Estimate Plan Cost",
        description: "Project the cost of a plan under all quorum modes",
        template: "Estimate the cost of running the current plan under all four quorum modes (unanimous, majority, any, solo). Which is most cost-effective?",
        placeholders: [],
        suggestedTools: ["forge_estimate_quorum", "forge_cost_report"],
        category: "cost-quorum",
      },
      {
        id: "cq-analyze-run",
        title: "Analyze Quorum Run",
        description: "Break down model agreement, votes, and costs for a past quorum run",
        template: "Analyze the quorum run {{runId}}. Show model agreement, vote distribution, and cost breakdown.",
        placeholders: [{ key: "runId", label: "Run ID", example: "run-2024-001" }],
        suggestedTools: ["forge_quorum_analyze"],
        category: "cost-quorum",
      },
      {
        id: "cq-monthly-report",
        title: "Monthly Cost Report",
        description: "Get a full monthly cost breakdown",
        template: "Give me a cost report for this month. Break down by model, by phase, and show any spending anomalies.",
        placeholders: [],
        suggestedTools: ["forge_cost_report"],
        category: "cost-quorum",
      },
      {
        id: "cq-budget-alert",
        title: "Budget Anomaly Check",
        description: "Check for unusual spending patterns",
        template: "Are there any cost anomalies or budget alerts I should be aware of? Show me any unusual spending patterns.",
        placeholders: [],
        suggestedTools: ["forge_cost_report", "forge_health_trend"],
        category: "cost-quorum",
      },
    ],
  },
  {
    id: "testing",
    label: "Testing & Quality",
    description: "Validate test coverage, quality metrics, and tempering",
    prompts: [
      {
        id: "tq-tempering-status",
        title: "Tempering Status",
        description: "Get current tempering scanner results and baseline status",
        template: "What is the current tempering status? Show scanner results, any new findings since the last baseline, and approval status.",
        placeholders: [],
        suggestedTools: ["forge_tempering_status", "forge_tempering_scan"],
        category: "testing",
      },
      {
        id: "tq-sweep",
        title: "Code Completeness Sweep",
        description: "Find TODOs, stubs, and incomplete implementations",
        template: "Run a completeness sweep. Find all TODOs, stubs, mocks, and incomplete implementations that need attention.",
        placeholders: [],
        suggestedTools: ["forge_sweep"],
        category: "testing",
      },
      {
        id: "tq-skill-status",
        title: "Skill Status Overview",
        description: "Check health and status of all installed skills",
        template: "Give me a status overview of all installed skills. Which are active, when did they last run, and are there any health issues?",
        placeholders: [],
        suggestedTools: ["forge_skill_status"],
        category: "testing",
      },
      {
        id: "tq-regression-guard",
        title: "Full Regression Guard",
        description: "Run regression guard across all test gates",
        template: "Run a full regression guard check. Report any test failures, performance regressions, or quality metric drops.",
        placeholders: [],
        suggestedTools: ["forge_regression_guard", "forge_health_trend"],
        category: "testing",
      },
    ],
  },
  {
    id: "memory",
    label: "Memory & Knowledge",
    description: "Query and manage the 3-tier memory system",
    prompts: [
      {
        id: "mem-recall",
        title: "Recall Project Knowledge",
        description: "Retrieve relevant information from all memory tiers",
        template: "Recall what you know about {{topic}} from the project memory. Check all tiers (session, project, cross-project).",
        placeholders: [{ key: "topic", label: "Topic to recall", example: "authentication implementation" }],
        suggestedTools: ["brain_recall", "forge_memory_report"],
        category: "memory",
      },
      {
        id: "mem-report",
        title: "Memory System Report",
        description: "Get a summary of what's stored in all memory tiers",
        template: "Give me a full memory system report. What keys are stored, their sizes, and which entries are stale?",
        placeholders: [],
        suggestedTools: ["forge_memory_report"],
        category: "memory",
      },
      {
        id: "mem-search",
        title: "Search Across All Artifacts",
        description: "Search runs, bugs, incidents, reviews, plans, and memory",
        template: "Search across all project artifacts for {{query}}. Include runs, bugs, incidents, reviews, and memory entries.",
        placeholders: [{ key: "query", label: "Search query", example: "authentication blocker" }],
        suggestedTools: ["forge_search"],
        category: "memory",
      },
      {
        id: "mem-timeline",
        title: "Project Timeline",
        description: "Show a chronological event timeline",
        template: "Show me the project timeline for the last {{period}}. Include runs, bugs, incidents, and key events.",
        placeholders: [{ key: "period", label: "Time period", example: "7 days" }],
        suggestedTools: ["forge_timeline"],
        category: "memory",
      },
    ],
  },
  {
    id: "extensions",
    label: "Extensions & Integrations",
    description: "Discover and manage Plan Forge extensions",
    prompts: [
      {
        id: "ext-search",
        title: "Search Extensions",
        description: "Find available extensions in the registry",
        template: "Search the extension registry for {{query}}. Show name, description, and compatibility information.",
        placeholders: [{ key: "query", label: "Extension type or keyword", example: "testing" }],
        suggestedTools: ["forge_ext_search"],
        category: "extensions",
      },
      {
        id: "ext-info",
        title: "Extension Details",
        description: "Get detailed info about a specific extension",
        template: "Get detailed information about the {{extensionName}} extension. Show capabilities, configuration, and usage examples.",
        placeholders: [{ key: "extensionName", label: "Extension name", example: "pforge-ext-vitest" }],
        suggestedTools: ["forge_ext_info"],
        category: "extensions",
      },
      {
        id: "ext-capabilities",
        title: "Full Capabilities Overview",
        description: "Discover all available tools, config, and workflows",
        template: "Show me a full capabilities overview. List all available tools, extensions, configuration options, and workflows.",
        placeholders: [],
        suggestedTools: ["forge_capabilities"],
        category: "extensions",
      },
    ],
  },
];

/**
 * Get the full prompt catalog.
 *
 * @returns {{ version: string, categories: Array<{ id, label, description, prompts }> }}
 */
export function getPromptCatalog() {
  return {
    version: CATALOG_VERSION,
    categories: CATEGORIES,
  };
}

/**
 * Get a single prompt by ID, searching across all categories.
 *
 * @param {string} promptId
 * @returns {object|null}
 */
export function getPromptById(promptId) {
  for (const category of CATEGORIES) {
    const found = category.prompts.find(p => p.id === promptId);
    if (found) return found;
  }
  return null;
}
