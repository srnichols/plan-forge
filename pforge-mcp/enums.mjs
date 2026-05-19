const freezeArray = (values) => Object.freeze([...values]);

const formatValid = (values) => values.join(", ");

function assertOneOf(kind, value, values) {
  if (!values.includes(value)) {
    throw new RangeError(`Invalid ${kind} '${value}'. Valid: ${formatValid(values)}`);
  }
  return value;
}

export const HOOK_NAMES = Object.freeze({
  SessionStart: "sessionStart",
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  Stop: "stop",
  PreDeploy: "preDeploy",
  PostSlice: "postSlice",
  PreAgentHandoff: "preAgentHandoff",
  PostRun: "postRun",
});

export const HOOK_PASCAL = freezeArray(Object.keys(HOOK_NAMES));

export const HOOK_CATEGORY = Object.freeze({
  session: freezeArray(["SessionStart", "PreToolUse", "PostToolUse", "Stop"]),
  liveGuard: freezeArray(["PreDeploy", "PostSlice", "PreAgentHandoff", "PostRun"]),
});

export const MODEL_TIERS = freezeArray(["flagship", "mid", "fast"]);
export const QUORUM_MODES = freezeArray(["auto", "power", "speed", "false"]);
export const FORGE_MASTER_MODES = freezeArray(["ask", "observe"]);
export const WATCHER_MODES = freezeArray(["snapshot", "analyze", "cross-run"]);
export const COST_SOURCES = freezeArray(["worker", "forge-master", "observer", "auditor"]);
export const ERROR_CODES = Object.freeze({
  ALREADY_FIXED: "ALREADY_FIXED", // Bug is already fixed or otherwise terminal; reopen it before validating again.
  ASK_QUESTION_MISMATCH: "ASK_QUESTION_MISMATCH", // Client passed a stale questionId to forge_crucible_ask; re-fetch state and retry.
  AUDITOR_SPAWN_FAILED: "auditor-spawn-failed", // PostRun auditor hook could not be spawned; advisory only.
  BUG_NOT_FOUND: "BUG_NOT_FOUND", // Requested bug record does not exist.
  BUG_TERMINAL_STATUS: "BUG_TERMINAL_STATUS", // Bug is fixed, wont-fix, or duplicate and cannot be used for active remediation.
  CRITICAL_FIELDS_MISSING: "CRITICAL_FIELDS_MISSING", // Crucible finalize blocked because required plan sections are missing.
  DIFF_CLASSIFY_BLOCKED: "diff-classify-blocked", // PreCommit diff classifier blocked the staged change set.
  DRIFT_DETECTED: "DRIFT_DETECTED", // A forbidden or out-of-scope edit was detected.
  DUPLICATE_BUG: "DUPLICATE_BUG", // Bug fingerprint already exists in the registry.
  ERR_UPDATE_DURING_RUN: "ERR_UPDATE_DURING_RUN", // Self-update was refused while a plan run is active.
  GATE_COMMAND_FAILED: "GATE_COMMAND_FAILED", // Slice validation gate exited non-zero.
  INVALID_CLASS: "INVALID_CLASS", // Meta-bug class is missing or not in the allowed class list.
  INVALID_STATUS: "INVALID_STATUS", // Requested bug status is not a valid enum member.
  INVALID_TRANSITION: "INVALID_TRANSITION", // Requested bug status transition is not allowed.
  LOCK_HASH_MISMATCH: "lock-hash-mismatch", // Plan lockHash does not match the current plan contents.
  MISSING_BUG_ID: "MISSING_BUG_ID", // bugId is required for tempering-bug workflows.
  MISSING_EVIDENCE: "MISSING_EVIDENCE", // Bug evidence must include a test name or assertion+stack trace.
  MISSING_PAYLOAD: "MISSING_PAYLOAD", // Required request payload object was not provided.
  MISSING_REQUIRED_FIELDS: "MISSING_REQUIRED_FIELDS", // Required fields are missing from the request payload.
  MISSING_STATUS: "MISSING_STATUS", // Target bug status was not provided.
  NETWORK_ALLOWLIST_VIOLATION: "network-allowlist-violation", // Outbound call targeted a host outside network.allowed.
  NO_API_KEY: "NO_API_KEY", // Provider API key is missing.
  NO_REASONING_MODEL: "NO_REASONING_MODEL", // Forge-Master has no reasoning model configured.
  NO_REPO: "NO_REPO", // GitHub repository could not be resolved from config or remotes.
  NO_TOKEN: "NO_TOKEN", // GitHub token is missing from env, secrets, or gh auth.
  OBSERVER_BUDGET_EXCEEDED: "observer-budget-exceeded", // Forge-Master observer hit its configured narration budget.
  PLAN_ALREADY_EXISTS: "PLAN_ALREADY_EXISTS", // Crucible finalize refused to overwrite an existing plan.
  PLAN_NOT_FOUND: "PLAN_NOT_FOUND", // Plan file path does not exist or is outside the workspace.
  PLAN_PARSE_ERROR: "PLAN_PARSE_ERROR", // Plan file is malformed or missing required sections.
  PROJECT_PRINCIPLES_EXISTS: "PROJECT_PRINCIPLES_EXISTS", // project-principles.md already exists; overwrite explicitly to replace it.
  PROJECT_PRINCIPLES_NO_SOURCE: "PROJECT_PRINCIPLES_NO_SOURCE", // No project-principles source was found in the imported Spec Kit.
  QUORUM_ALL_FAILED: "QUORUM_ALL_FAILED", // All quorum models timed out or errored.
  RATE_LIMITED: "RATE_LIMITED", // Request was throttled; honor retry timing before retrying.
  REVIEW_REJECTED: "REVIEW_REJECTED", // Review gate rejected the slice.
  SCANNER_UNAVAILABLE: "SCANNER_UNAVAILABLE", // Requested scanner is not installed or cannot run in this environment.
  SCOPE_VIOLATION: "SCOPE_VIOLATION", // Worker edited a path outside the allowed scope contract.
  SMELT_NOT_FOUND: "SMELT_NOT_FOUND", // Requested Crucible smelt ID does not exist.
  SPECKIT_IMPORT_DIR_NOT_FOUND: "SPECKIT_IMPORT_DIR_NOT_FOUND", // Spec Kit import directory path does not exist.
  SPECKIT_IMPORT_MISSING_FIELD: "SPECKIT_IMPORT_MISSING_FIELD", // Required Spec Kit field is missing from an input artifact.
  SPECKIT_IMPORT_MISSING_REQUIRED: "SPECKIT_IMPORT_MISSING_REQUIRED", // Required Spec Kit files are missing.
  SPECKIT_IMPORT_NOT_FOUND: "SPECKIT_IMPORT_NOT_FOUND", // Requested imported smelt was not found.
  STRICT_GATES_REJECTED: "STRICT_GATES_REJECTED", // --strict-gates refused a plan that would otherwise escalate.
  TOOL_DENIED: "tool-denied", // Worker or hook attempted to call a denied MCP tool.
  UNEXPECTED: "UNEXPECTED", // Unexpected catch-all failure; inspect the attached message/details.
  WORKER_TIMEOUT: "WORKER_TIMEOUT", // Worker exceeded its per-slice execution budget.
});

export function assertHookName(name) {
  return assertOneOf("hook name", name, HOOK_PASCAL);
}

export function assertModelTier(tier) {
  return assertOneOf("model tier", tier, MODEL_TIERS);
}

export function assertQuorumMode(mode) {
  return assertOneOf("quorum mode", mode, QUORUM_MODES);
}

export function assertWatcherMode(mode) {
  return assertOneOf("watcher mode", mode, WATCHER_MODES);
}

export function assertCostSource(src) {
  return assertOneOf("cost source", src, COST_SOURCES);
}

export function assertForgeMasterMode(mode) {
  return assertOneOf("forge-master mode", mode, FORGE_MASTER_MODES);
}

// Single source of truth for the MCP tool inventory.
// Alphabetically sorted; used by capabilities.mjs and the doc-gen scripts.
// Keep in sync with TOOL_METADATA in capabilities.mjs — the CI guard enforces this.
export const TOOL_NAMES = freezeArray([
  "forge_abort",
  "forge_alert_triage",
  "forge_analyze",
  "forge_anvil_clear",
  "forge_anvil_dlq_drain",
  "forge_anvil_dlq_list",
  "forge_anvil_rebuild",
  "forge_anvil_stat",
  "forge_brain_replay",
  "forge_brain_test",
  "forge_bug_list",
  "forge_bug_register",
  "forge_bug_update_status",
  "forge_bug_validate_fix",
  "forge_capabilities",
  "forge_classifier_issue",
  "forge_cost_report",
  "forge_crucible_abandon",
  "forge_crucible_ask",
  "forge_crucible_finalize",
  "forge_crucible_import",
  "forge_crucible_list",
  "forge_crucible_preview",
  "forge_crucible_status",
  "forge_crucible_submit",
  "forge_delegate_review",
  "forge_delegate_to_agent",
  "forge_dep_watch",
  "forge_deploy_journal",
  "forge_diagnose",
  "forge_diff",
  "forge_diff_classify",
  "forge_doctor_quorum",
  "forge_drift_report",
  "forge_env_diff",
  "forge_estimate_quorum",
  "forge_estimate_slice",
  "forge_export_plan",
  "forge_ext_info",
  "forge_ext_search",
  "forge_fix_proposal",
  "forge_generate_image",
  "forge_github_metrics",
  "forge_github_status",
  "forge_graph_query",
  "forge_hallmark_show",
  "forge_hallmark_verify",
  "forge_health_trend",
  "forge_home_snapshot",
  "forge_hotspot",
  "forge_incident_capture",
  "forge_lattice_blast",
  "forge_lattice_callers",
  "forge_lattice_index",
  "forge_lattice_query",
  "forge_lattice_stat",
  "forge_liveguard_run",
  "forge_master_ask",
  "forge_master_observe",
  "forge_memory_capture",
  "forge_memory_report",
  "forge_meta_bug_file",
  "forge_new_phase",
  "forge_notify_send",
  "forge_notify_test",
  "forge_org_rules",
  "forge_patterns_list",
  "forge_pipelines_list",
  "forge_plan_status",
  "forge_quorum_analyze",
  "forge_regression_guard",
  "forge_review_add",
  "forge_review_list",
  "forge_review_resolve",
  "forge_run_plan",
  "forge_run_skill",
  "forge_runbook",
  "forge_search",
  "forge_secret_scan",
  "forge_self_update",
  "forge_skill_status",
  "forge_smith",
  "forge_status",
  "forge_sweep",
  "forge_sync_instructions",
  "forge_sync_memories",
  "forge_team_activity",
  "forge_team_dashboard",
  "forge_tempering_approve_baseline",
  "forge_tempering_drain",
  "forge_tempering_run",
  "forge_tempering_scan",
  "forge_tempering_status",
  "forge_testbed_findings",
  "forge_testbed_happypath",
  "forge_testbed_run",
  "forge_timeline",
  "forge_triage_route",
  "forge_validate",
  "forge_watch",
  "forge_watch_live",
]);
