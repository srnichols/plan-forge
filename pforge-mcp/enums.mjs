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

function freezeErrorCode(code, severity, remediation, docAnchor = "named-error-catalog") {
  return Object.freeze({ code, severity, remediation, docAnchor });
}

export const ERROR_CODES = Object.freeze({
  ALREADY_FIXED: freezeErrorCode("ALREADY_FIXED", "medium", "Bug is already fixed or otherwise terminal. Reopen it before validating again."),
  ASK_QUESTION_MISMATCH: freezeErrorCode("ASK_QUESTION_MISMATCH", "medium", "Client passed a stale questionId to forge_crucible_ask. Re-fetch with forge_crucible_preview, then retry with the current question id."),
  AUDITOR_SPAWN_FAILED: freezeErrorCode("auditor-spawn-failed", "low", "PostRun auditor hook could not be spawned. Check forgeMaster.auditor.outputPath permissions and the selected model tier; the parent run still exits 0."),
  BUG_NOT_FOUND: freezeErrorCode("BUG_NOT_FOUND", "medium", "Requested bug record does not exist. Verify the bugId and retry."),
  BUG_TERMINAL_STATUS: freezeErrorCode("BUG_TERMINAL_STATUS", "medium", "Bug is already fixed, wont-fix, or duplicate. Reopen it before running active remediation steps."),
  CREATE_FAILED: freezeErrorCode("CREATE_FAILED", "medium", "Provider operation could not create the requested resource. Check provider access and retry."),
  CRITICAL_FIELDS_MISSING: freezeErrorCode("CRITICAL_FIELDS_MISSING", "high", "Draft plan is missing build-command, test-command, scope, gates, forbidden-actions, or rollback. Call forge_crucible_preview for criticalGaps, then continue the interview."),
  DIFF_CLASSIFY_BLOCKED: freezeErrorCode("diff-classify-blocked", "high", "The diff classifier returned blocked for one or more files. Revert or move out-of-scope changes, then retry the commit."),
  DRIFT_DETECTED: freezeErrorCode("DRIFT_DETECTED", "high", "Worker tried to edit a file listed in the plan's Forbidden Actions. Revert the change, then re-run the slice."),
  DUPLICATE_BUG: freezeErrorCode("DUPLICATE_BUG", "low", "Bug fingerprint already exists in the registry. Reuse the existing bug record instead of filing a duplicate."),
  ERR_UPDATE_DURING_RUN: freezeErrorCode("ERR_UPDATE_DURING_RUN", "medium", "POST /api/self-update was rejected because a plan is currently running. Abort the run or wait for it to finish."),
  GATE_COMMAND_FAILED: freezeErrorCode("GATE_COMMAND_FAILED", "high", "Slice validation gate exited non-zero. Fix the build or test failure, then resume from the failed slice."),
  INVALID_CLASS: freezeErrorCode("INVALID_CLASS", "low", "Requested meta-bug class is not valid. Use one of the allowed classifier classes."),
  INVALID_STATUS: freezeErrorCode("INVALID_STATUS", "low", "Requested bug status is not valid. Retry with an allowed status value."),
  INVALID_TRANSITION: freezeErrorCode("INVALID_TRANSITION", "medium", "Requested bug status transition is not allowed. Move through the supported workflow states."),
  LOCK_HASH_MISMATCH: freezeErrorCode("lock-hash-mismatch", "high", "The plan's lockHash no longer matches the current plan body. Re-harden the plan to regenerate lockHash, then retry."),
  MISSING_BUG_ID: freezeErrorCode("MISSING_BUG_ID", "low", "bugId is required for tempering-bug flows. Supply the bugId and retry."),
  MISSING_EVIDENCE: freezeErrorCode("MISSING_EVIDENCE", "medium", "Bug evidence must include a test name or an assertion plus stack trace. Add evidence and retry."),
  MISSING_PAYLOAD: freezeErrorCode("MISSING_PAYLOAD", "low", "Required request payload object was not provided. Supply the payload and retry."),
  MISSING_REQUIRED_FIELDS: freezeErrorCode("MISSING_REQUIRED_FIELDS", "low", "Required fields are missing from the request payload. Populate the missing fields and retry."),
  MISSING_STATUS: freezeErrorCode("MISSING_STATUS", "low", "Target bug status was not provided. Pass newStatus or status and retry."),
  NETWORK_ALLOWLIST_VIOLATION: freezeErrorCode("network-allowlist-violation", "high", "Outbound call targeted a host outside network.allowed. Add the host to the allowlist or remove the outbound call."),
  NETWORK_ERROR: freezeErrorCode("NETWORK_ERROR", "medium", "Upstream request failed due to a transport or network error. Check connectivity and retry."),
  NO_API_KEY: freezeErrorCode("NO_API_KEY", "medium", "No provider API key is configured. Set XAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY, or use the zero-key Copilot path when supported."),
  NO_ISSUE_NUMBER: freezeErrorCode("NO_ISSUE_NUMBER", "medium", "GitHub issue number is missing from the external reference. Re-sync the external issue metadata."),
  NO_REASONING_MODEL: freezeErrorCode("NO_REASONING_MODEL", "high", "Forge-Master has no model configured and no provider key available. Set forgeMaster.reasoningModel or configure a provider key."),
  NO_REPO: freezeErrorCode("NO_REPO", "medium", "GitHub repository could not be resolved from config or remotes. Set bugRegistry.githubRepo or add a Git remote."),
  NO_TOKEN: freezeErrorCode("NO_TOKEN", "medium", "GitHub token is missing. Set GITHUB_TOKEN, configure .forge/secrets.json, or run gh auth login."),
  OBSERVER_BUDGET_EXCEEDED: freezeErrorCode("observer-budget-exceeded", "medium", "Forge-Master Observer hit its daily USD cap or hourly narration cap. Wait for the budget window to reset or widen the cap in .forge.json."),
  PLAN_ALREADY_EXISTS: freezeErrorCode("PLAN_ALREADY_EXISTS", "medium", "Refused to overwrite an existing hand-authored plan. Read both files, then re-finalize with overwrite: true if you really mean it."),
  PLAN_NOT_FOUND: freezeErrorCode("PLAN_NOT_FOUND", "medium", "Plan path doesn't exist or is outside the workspace. Verify the path and keep plans under docs/plans by convention."),
  PLAN_PARSE_ERROR: freezeErrorCode("PLAN_PARSE_ERROR", "high", "Plan is missing required sections or has malformed slice headers. Run forge_validate to see the specific gap and repair it."),
  PROJECT_PRINCIPLES_EXISTS: freezeErrorCode("PROJECT_PRINCIPLES_EXISTS", "low", "PROJECT-PRINCIPLES.md already exists. Remove it first or omit --sync-principles."),
  PROJECT_PRINCIPLES_NO_SOURCE: freezeErrorCode("PROJECT_PRINCIPLES_NO_SOURCE", "low", "No constitution.md source was found for --sync-principles. Add the source document or rerun without that flag."),
  QUORUM_ALL_FAILED: freezeErrorCode("QUORUM_ALL_FAILED", "high", "All quorum models timed out or errored. Check API keys and network connectivity, then retry; consider --quorum=speed if flagship models are unavailable."),
  RATE_LIMITED: freezeErrorCode("RATE_LIMITED", "medium", "Request was throttled. Honor retryAfter or the provider reset window before retrying."),
  REVIEW_REJECTED: freezeErrorCode("REVIEW_REJECTED", "high", "Session 3 reviewer rejected the slice. Read the review artifact, address the findings, then rerun the slice."),
  SCANNER_UNAVAILABLE: freezeErrorCode("SCANNER_UNAVAILABLE", "low", "Requested scanner is not installed or cannot run in this environment. Install the scanner or choose another one."),
  SCOPE_VIOLATION: freezeErrorCode("SCOPE_VIOLATION", "high", "Worker edited a path outside the allowed scope contract. Revert the change and rerun with the correct scope."),
  SMELT_NOT_FOUND: freezeErrorCode("SMELT_NOT_FOUND", "medium", "Requested Crucible smelt ID does not exist. Verify the smeltId or list smelts first."),
  SPECKIT_IMPORT_DIR_NOT_FOUND: freezeErrorCode("SPECKIT_IMPORT_DIR_NOT_FOUND", "low", "Spec Kit import directory path does not exist. Pass a valid directory and retry."),
  SPECKIT_IMPORT_MISSING_FIELD: freezeErrorCode("SPECKIT_IMPORT_MISSING_FIELD", "medium", "Required Spec Kit field is missing from an input artifact. Fill the missing field, then rerun the import."),
  SPECKIT_IMPORT_MISSING_REQUIRED: freezeErrorCode("SPECKIT_IMPORT_MISSING_REQUIRED", "medium", "Required Spec Kit files are missing. Provide spec.md and plan.md, then retry."),
  SPECKIT_IMPORT_NOT_FOUND: freezeErrorCode("SPECKIT_IMPORT_NOT_FOUND", "medium", "Requested imported smelt was not found. Re-run the import or verify the import location."),
  STRICT_GATES_REJECTED: freezeErrorCode("STRICT_GATES_REJECTED", "high", "Strict gates refused a plan that would otherwise have escalated. Drop --strict-gates or strengthen the failing gate."),
  TIMEOUT: freezeErrorCode("TIMEOUT", "medium", "Operation timed out before a provider response was received. Retry with a longer timeout or a smaller request."),
  TOOL_DENIED: freezeErrorCode("tool-denied", "high", "A worker or hook tried to invoke an MCP tool listed in tools.deny. Remove the tool from the denylist or update the prompt to avoid it."),
  UNEXPECTED: freezeErrorCode("UNEXPECTED", "medium", "Unexpected catch-all failure. Inspect the attached message or details and retry after fixing the root cause."),
  WORKER_TIMEOUT: freezeErrorCode("WORKER_TIMEOUT", "high", "Worker exceeded its per-slice execution budget. Split the slice or switch to a faster model."),
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
