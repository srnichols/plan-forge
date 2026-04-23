/**
 * Plan Forge — Forge-Master Allowlist (Phase-28, Slice 1).
 *
 * Exports:
 *   - BASE_ALLOWLIST       — frozen array of ≈38 read-only tool names
 *   - USAGE_HINTS          — frozen map of tool -> short usage hint (for system prompt)
 *   - WRITE_TOOLS_EXCLUDED — frozen array of write tools deliberately excluded (Phase-29)
 *   - resolveAllowlist      — returns the full allowlist (base + discovered extension tools)
 *   - isAllowlisted         — checks if a tool name is in the resolved allowlist
 *
 * Phase-28 policy: read-only tools + Crucible interview writes (scoped to
 * an in-progress smelt, not a phase plan). All write tools graduate to
 * Phase-29 with approval cards.
 */

// ─── Base Allowlist (≈38 read-only + Crucible interview tools) ──────

export const BASE_ALLOWLIST = Object.freeze([
  // Planning / status
  "forge_plan_status",
  // "forge_phase_status",  // removed in Phase-37.1 — no MCP handler
  "forge_status",
  "forge_diff",
  "forge_capabilities",

  // Cost
  "forge_cost_report",
  "forge_estimate_quorum",
  "forge_quorum_analyze",
  "forge_doctor_quorum",

  // Health & watchers
  "forge_health_trend",
  "forge_watch",
  "forge_watch_live",
  "forge_alert_triage",
  // "forge_dep_watch",        // removed in Phase-37.1 — no MCP handler
  // "forge_drift_report",     // removed in Phase-37.1 — no MCP handler
  // "forge_hotspot",          // removed in Phase-37.1 — no MCP handler
  // "forge_regression_guard", // removed in Phase-37.1 — no MCP handler

  // Diagnostics
  "forge_smith",
  "forge_sweep",
  "forge_validate",
  "forge_analyze",
  // "forge_diagnose",         // removed in Phase-37.1 — no MCP handler

  // Crucible (interview — submit/ask/preview touch an in-progress smelt only)
  // "forge_crucible_list",    // removed in Phase-37.1 — no MCP handler
  // "forge_crucible_submit",  // removed in Phase-37.1 — no MCP handler
  // "forge_crucible_ask",     // removed in Phase-37.1 — no MCP handler
  // "forge_crucible_preview", // removed in Phase-37.1 — no MCP handler

  // Memory & retrieval
  // "brain_recall",           // removed in Phase-37.1 — no MCP handler
  "forge_memory_report",
  "forge_search",
  // "forge_timeline",         // removed in Phase-37.1 — no MCP handler

  // Tempering reads
  // "forge_tempering_scan",   // removed in Phase-37.1 — no MCP handler
  // "forge_tempering_status", // removed in Phase-37.1 — no MCP handler

  // Bug / review / skill reads
  // "forge_bug_list",         // removed in Phase-37.1 — no MCP handler
  // "forge_review_list",      // removed in Phase-37.1 — no MCP handler
  // "forge_skill_status",     // removed in Phase-37.1 — no MCP handler

  // Extension reads
  "forge_ext_search",
  "forge_ext_info",

  // Ops reads
  // "forge_runbook",          // removed in Phase-37.1 — no MCP handler
  // "forge_deploy_journal",   // removed in Phase-37.1 — no MCP handler

  // Phase-38.3 — Knowledge graph (advisory lane only)
  "forge_graph_query",
]);

/**
 * Write tools deliberately excluded from Phase-28. These graduate to
 * Phase-29 with approval cards.
 */
export const WRITE_TOOLS_EXCLUDED = Object.freeze([
  "forge_run_plan",
  "forge_crucible_finalize",
  "forge_bug_register",
  "forge_bug_update_status",
  "forge_tempering_approve_baseline",
  "forge_new_phase",
  "forge_incident_capture",
  "forge_fix_proposal",
  "forge_run_skill",
  "forge_review_add",
  "forge_review_resolve",
  "forge_delegate_to_agent",
  "forge_notify_send",
  "forge_notify_test",
  "forge_memory_capture",
  "forge_testbed_run",
  "forge_generate_image",
]);

// ─── Phase-29 Write Allowlist ────────────────────────────────────────

/**
 * Write tools admitted in Phase-29. Each entry carries approval metadata.
 * `severity: "destructive"` tools require typed confirmation in the UI.
 */
export const WRITE_ALLOWLIST = Object.freeze([
  { name: "forge_run_plan",                  requiresApproval: true, severity: "destructive" },
  { name: "forge_crucible_finalize",         requiresApproval: true, severity: "destructive" },
  { name: "forge_new_phase",                 requiresApproval: true, severity: "destructive" },
  { name: "forge_bug_register",              requiresApproval: true, severity: "write" },
  { name: "forge_bug_update_status",         requiresApproval: true, severity: "write" },
  { name: "forge_tempering_approve_baseline",requiresApproval: true, severity: "write" },
  { name: "forge_incident_capture",          requiresApproval: true, severity: "write" },
  { name: "forge_fix_proposal",              requiresApproval: true, severity: "write" },
  { name: "forge_run_skill",                 requiresApproval: true, severity: "write" },
  { name: "forge_review_add",                requiresApproval: true, severity: "write" },
  { name: "forge_review_resolve",            requiresApproval: true, severity: "write" },
  { name: "forge_notify_send",               requiresApproval: true, severity: "write" },
  { name: "forge_notify_test",               requiresApproval: true, severity: "write" },
  { name: "forge_memory_capture",            requiresApproval: true, severity: "write" },
]);

/**
 * Full Phase-29 allowlist: Base (read) + Write tools, as a flat array of
 * tool names. Suitable for use with `isAllowlisted()`.
 */
export const PHASE29_FULL_ALLOWLIST = Object.freeze([
  ...BASE_ALLOWLIST,
  ...WRITE_ALLOWLIST.map(t => t.name),
]);

/**
 * Per-tool usage hints injected into the system prompt so the reasoning
 * model knows when and why to call each tool.
 */
export const USAGE_HINTS = Object.freeze({
  forge_plan_status:      "Check the status of a specific plan run — slices passed/failed, current slice, ETA.",
  forge_phase_status:     "Get high-level status of a phase (how many slices, which are done).",
  forge_status:           "Quick project health snapshot — plans, runs, open bugs, cost trend.",
  forge_diff:             "Show the diff between two plan versions or between plan and reality.",
  forge_capabilities:     "Discover all available tools, config, extensions, and workflows.",
  forge_cost_report:      "Get actual cost data — token counts, per-model spend, monthly aggregates. ALWAYS use this for cost questions.",
  forge_estimate_quorum:  "Project the cost of a plan under all four quorum modes before execution.",
  forge_quorum_analyze:   "Analyze a past quorum run — model agreement, vote distribution, cost breakdown.",
  forge_doctor_quorum:    "Diagnose quorum configuration issues — model availability, provider health.",
  forge_health_trend:     "Trend analysis of project health metrics over time.",
  forge_watch:            "Read the latest watcher snapshot — dependency, security, performance alerts.",
  forge_watch_live:       "Get real-time watcher output (live tail of recent events).",
  forge_alert_triage:     "Triage open alerts — severity, affected systems, suggested actions.",
  forge_dep_watch:        "Dependency monitoring — outdated packages, vulnerabilities, license issues.",
  forge_drift_report:     "Measure drift between the plan and the actual codebase state.",
  forge_hotspot:          "Find code hotspots — files with most churn, most bugs, most complexity.",
  forge_regression_guard: "Check for regressions in test results, performance, or quality metrics.",
  forge_smith:            "Run forge diagnostics — environment check, setup validation, health report.",
  forge_sweep:            "Scan for TODOs, stubs, mocks, and incomplete implementations.",
  forge_validate:         "Validate setup files, instruction files, and project configuration.",
  forge_analyze:          "Deep analysis of a specific file, function, or module.",
  forge_diagnose:         "Diagnose a specific problem — error messages, test failures, build issues.",
  forge_crucible_list:    "List all Crucible smelts (draft plans / interviews).",
  forge_crucible_submit:  "Start a new Crucible interview — submit a raw idea for structured planning.",
  forge_crucible_ask:     "Answer a Crucible interview question to progress the smelt.",
  forge_crucible_preview: "Preview the draft plan from a completed or in-progress Crucible interview.",
  brain_recall:           "Recall information from the 3-tier memory system (L1 session, L2 project, L3 cross-project).",
  forge_memory_report:    "Summary of what's stored in memory — keys, sizes, staleness.",
  forge_search:           "Search across runs, bugs, incidents, reviews, memory, and plans.",
  forge_timeline:         "Chronological event timeline — hub events, runs, memory, incidents.",
  forge_tempering_scan:   "Run tempering scanners — find code quality, security, or architecture issues.",
  forge_tempering_status: "Status of tempering baselines and scanner results.",
  forge_bug_list:         "List registered bugs — severity, status, affected slices.",
  forge_review_list:      "List review queue items — pending reviews, resolved items.",
  forge_skill_status:     "Status of installed skills — which are active, last run, health.",
  forge_ext_search:       "Search the extension registry for available Plan Forge extensions.",
  forge_ext_info:         "Get detailed info about a specific extension.",
  forge_runbook:          "Read the project runbook — operational procedures, escalation paths.",
  forge_deploy_journal:   "Read the deploy journal — recent deployments, rollbacks, incidents.",
  forge_graph_query:      "Query the knowledge graph — phases, slices, commits, files, bugs, runs, and their relationships.",
});

// ─── Dynamic Extension-Tool Discovery ───────────────────────────────

const _baseSet = new Set(BASE_ALLOWLIST);

/**
 * Resolve the full allowlist for a Forge-Master session.
 *
 * Base tools are always included. Extension tools are auto-discovered
 * from `toolMetadata` (the TOOL_METADATA registry from capabilities.mjs)
 * when they carry `source: "extension"` and `readOnly: true`.
 *
 * @param {{
 *   toolMetadata?: Record<string, { source?: string, readOnly?: boolean }>,
 *   discoverExtensionTools?: boolean,
 * }} [opts]
 * @returns {string[]}  Frozen array of allowlisted tool names.
 */
export function resolveAllowlist({ toolMetadata = {}, discoverExtensionTools = true } = {}) {
  if (!discoverExtensionTools) return [...BASE_ALLOWLIST];

  const discovered = [];
  for (const [name, meta] of Object.entries(toolMetadata)) {
    if (_baseSet.has(name)) continue;
    if (meta?.source === "extension" && meta?.readOnly === true) {
      discovered.push(name);
    }
  }

  return Object.freeze([...BASE_ALLOWLIST, ...discovered]);
}

/**
 * Check whether a tool name is in the resolved allowlist.
 *
 * @param {string} toolName
 * @param {string[]} resolvedAllowlist — output of resolveAllowlist()
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function isAllowlisted(toolName, resolvedAllowlist) {
  const allowSet = new Set(resolvedAllowlist);
  if (allowSet.has(toolName)) return { allowed: true };

  // Provide a specific reason for extension tools vs general rejection
  if (WRITE_TOOLS_EXCLUDED.includes(toolName)) {
    return { allowed: false, reason: "write_tool_excluded_phase28" };
  }

  return { allowed: false, reason: "tool_not_allowlisted" };
}
