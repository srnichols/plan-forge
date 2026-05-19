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
// TODO(phase-41/S4): populate ERROR_CODES from the generated named error catalog.
export const ERROR_CODES = Object.freeze({});

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
