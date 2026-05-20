import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emitToolSpan } from "../telemetry.mjs";
import { withAuth } from "../auth/middleware.mjs";
import { PROJECT_DIR } from "./state.mjs";
import { executeTool } from "./tool-handlers/core.mjs";
import { _CALL_TOOL_NO_MATCH } from "./tool-handlers/shared.mjs";
import {
  _callToolHandler_001_forge_run_plan,
  _callToolHandler_002_forge_abort,
  _callToolHandler_003_forge_plan_status,
  _callToolHandler_004_forge_diff_stats,
  _callToolHandler_005_forge_cost_report,
  _callToolHandler_006_forge_estimate_quorum,
  _callToolHandler_007_forge_estimate_slice,
  _callToolHandler_008_forge_health_trend,
  _callToolHandler_009_forge_alert_triage,
  _callToolHandler_010_forge_sweep,
  _callToolHandler_011_forge_analyze,
  _callToolHandler_012_forge_analyze,
  _callToolHandler_013_forge_diagnose,
  _callToolHandler_014_forge_capabilities,
  _callToolHandler_015_forge_watch,
  _callToolHandler_016_forge_watch_live,
} from "./tool-handlers/orch.mjs";

import {
  _callToolHandler_017_forge_memory_report,
  _callToolHandler_018_forge_skill_status,
  _callToolHandler_019_forge_run_skill,
  _callToolHandler_020_forge_org_rules,
  _callToolHandler_040_forge_memory_capture,
  _callToolHandler_041_forge_brain_test,
  _callToolHandler_042_forge_brain_replay,
  _callToolHandler_043_forge_generate_image,
} from "./tool-handlers/memory.mjs";
import {
  _callToolHandler_021_forge_crucible_submit,
  _callToolHandler_022_forge_crucible_ask,
  _callToolHandler_023_forge_crucible_preview,
  _callToolHandler_024_forge_crucible_finalize,
  _callToolHandler_025_forge_crucible_list,
  _callToolHandler_026_forge_crucible_abandon,
  _callToolHandler_027_forge_crucible_import,
  _callToolHandler_028_forge_crucible_status,
} from "./tool-handlers/crucible.mjs";
import {
  _callToolHandler_029_forge_tempering_scan,
  _callToolHandler_030_forge_tempering_status,
  _callToolHandler_031_forge_tempering_run,
  _callToolHandler_032_forge_tempering_approve_baseline,
  _callToolHandler_033_forge_tempering_drain,
  _callToolHandler_034_forge_triage_route,
  _callToolHandler_035_forge_classifier_issue,
  _callToolHandler_036_forge_bug_register,
  _callToolHandler_037_forge_bug_list,
  _callToolHandler_038_forge_bug_update_status,
  _callToolHandler_039_forge_bug_validate_fix,
} from "./tool-handlers/tempering.mjs";
import {
  _callToolHandler_044_forge_incident_capture,
  _callToolHandler_045_forge_deploy_journal,
  _callToolHandler_046_forge_regression_guard,
  _callToolHandler_047_forge_drift_report,
  _callToolHandler_048_forge_runbook,
  _callToolHandler_049_forge_hotspot,
  _callToolHandler_050_forge_dep_watch,
  _callToolHandler_051_forge_diff_classify,
  _callToolHandler_052_forge_secret_scan,
  _callToolHandler_053_forge_env_diff,
  _callToolHandler_054_forge_fix_proposal,
  _callToolHandler_055_forge_liveguard_run,
  _callToolHandler_056_forge_home_snapshot,
} from "./tool-handlers/safety.mjs";
import {
  _callToolHandler_057_forge_review_add,
  _callToolHandler_058_forge_review_list,
  _callToolHandler_059_forge_review_resolve,
  _callToolHandler_060_forge_delegate_to_agent,
  _callToolHandler_061_forge_notify_send,
  _callToolHandler_062_forge_notify_test,
} from "./tool-handlers/review.mjs";
import {
  _callToolHandler_063_forge_search,
  _callToolHandler_064_forge_timeline,
  _callToolHandler_065_forge_doctor_quorum,
  _callToolHandler_066_forge_quorum_analyze,
  _callToolHandler_067_forge_smith,
  _callToolHandler_068_forge_testbed_run,
  _callToolHandler_069_forge_testbed_findings,
  _callToolHandler_070_forge_export_plan,
  _callToolHandler_071_forge_sync_memories,
  _callToolHandler_072_forge_sync_instructions,
  _callToolHandler_073_forge_testbed_happypath,
} from "./tool-handlers/discovery.mjs";
import {
  _callToolHandler_074_forge_master_ask,
  _callToolHandler_075_forge_meta_bug_file,
  _callToolHandler_076_forge_graph_query,
  _callToolHandler_077_forge_patterns_list,
  _callToolHandler_078_forge_delegate_review,
  _callToolHandler_079_forge_team_dashboard,
  _callToolHandler_080_forge_team_activity,
  _callToolHandler_081_forge_github_metrics,
  _callToolHandler_082_forge_anvil_stat,
  _callToolHandler_083_forge_anvil_clear,
  _callToolHandler_084_forge_anvil_rebuild,
  _callToolHandler_085_forge_anvil_dlq_list,
  _callToolHandler_086_forge_anvil_dlq_drain,
  _callToolHandler_087_forge_hallmark_show,
  _callToolHandler_088_forge_hallmark_verify,
  _callToolHandler_089_forge_pipelines_list,
  _callToolHandler_090_forge_lattice_index,
  _callToolHandler_091_forge_lattice_stat,
  _callToolHandler_092_forge_lattice_query,
  _callToolHandler_093_forge_lattice_callers,
  _callToolHandler_094_forge_lattice_blast,
  _callToolHandler_095_forge_local_search,
  _callToolHandler_096_forge_embedding_status,
  _callToolHandler_097_forge_local_recall_status,
  _callToolHandler_098_forge_audit_export,
} from "./tool-handlers/platform.mjs";
export {
  planNameToRunbookName,
  generateRunbook,
  executeTool,
  invokeForgeTool,
  searchOpenBrainL3,
} from "./tool-handlers/core.mjs";

/**
 * Wrap a CallToolRequestSchema handler to emit an OTel `execute_tool` span
 * after every invocation. Fire-and-forget — never delays or throws.
 */
function _wrapWithToolSpan(handler) {
  return async (request) => {
    const { name } = request.params;
    const t0 = Date.now();
    let isError = false;
    try {
      const result = await handler(request);
      isError = result?.isError ?? false;
      return result;
    } catch (err) {
      isError = true;
      throw err;
    } finally {
      emitToolSpan({ toolName: name, durationMs: Date.now() - t0, isError });
    }
  };
}

// ─── Auth gate for MCP tool dispatch ─────────────────────────────────
// Read-only tools that are open by default (Decision #9 — operators can
// restrict these further by adding explicit scope entries in rbac.json).
const _READ_ONLY_TOOLS = new Set([
  "forge_capabilities", "forge_status", "forge_search", "forge_timeline",
  "forge_watch_live", "forge_home_snapshot", "forge_cost_report",
  "forge_plan_status", "forge_diff", "forge_diff_classify", "forge_diff_stats",
]);

let _rbacConfigCache; // undefined = not yet loaded; null = absent

function _getRbacConfig() {
  if (_rbacConfigCache !== undefined) return _rbacConfigCache;
  try {
    const rbacPath = resolve(PROJECT_DIR, ".forge", "rbac.json");
    _rbacConfigCache = existsSync(rbacPath)
      ? JSON.parse(readFileSync(rbacPath, "utf8"))
      : null;
  } catch {
    _rbacConfigCache = null;
  }
  return _rbacConfigCache;
}

/**
 * Auth gate for MCP tool calls using the withAuth middleware.
 * Returns null when the call is allowed, or an MCP error response when denied.
 * When .forge/rbac.json is absent → always null (open-by-default, Decision #1).
 *
 * @param {string} toolName
 * @param {object} request - MCP CallTool request object
 * @returns {Promise<null|{content: Array, isError: boolean}>}
 */
async function _mcpAuthGate(toolName, request) {
  const rbac = _getRbacConfig();
  if (!rbac) return null; // open-by-default: no rbac.json → no enforcement

  const isReadOnly = _READ_ONLY_TOOLS.has(toolName);
  const headers = request?._meta?.headers ?? {};
  const fakeReq = { headers };

  let denied = null;
  const fakeRes = {
    headersSent: false,
    writeHead(status) { denied = status; },
    end() { if (denied == null) denied = 403; },
  };

  const opts = isReadOnly
    ? { provider: "none" }                    // read-only: no auth required
    : { rbac, scope: "forge:run" };           // write/exec: require forge:run scope

  await withAuth(() => {}, opts)(fakeReq, fakeRes);

  if (denied) {
    const error = denied === 401 ? "unauthenticated" : "forbidden";
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error }) }],
      isError: true,
    };
  }
  return null;
}

const _CALL_TOOL_HANDLERS = [
  _callToolHandler_001_forge_run_plan,
  _callToolHandler_002_forge_abort,
  _callToolHandler_003_forge_plan_status,
  _callToolHandler_004_forge_diff_stats,
  _callToolHandler_005_forge_cost_report,
  _callToolHandler_006_forge_estimate_quorum,
  _callToolHandler_007_forge_estimate_slice,
  _callToolHandler_008_forge_health_trend,
  _callToolHandler_009_forge_alert_triage,
  _callToolHandler_010_forge_sweep,
  _callToolHandler_011_forge_analyze,
  _callToolHandler_012_forge_analyze,
  _callToolHandler_013_forge_diagnose,
  _callToolHandler_014_forge_capabilities,
  _callToolHandler_015_forge_watch,
  _callToolHandler_016_forge_watch_live,
  _callToolHandler_017_forge_memory_report,
  _callToolHandler_018_forge_skill_status,
  _callToolHandler_019_forge_run_skill,
  _callToolHandler_020_forge_org_rules,
  _callToolHandler_021_forge_crucible_submit,
  _callToolHandler_022_forge_crucible_ask,
  _callToolHandler_023_forge_crucible_preview,
  _callToolHandler_024_forge_crucible_finalize,
  _callToolHandler_025_forge_crucible_list,
  _callToolHandler_026_forge_crucible_abandon,
  _callToolHandler_027_forge_crucible_import,
  _callToolHandler_028_forge_crucible_status,
  _callToolHandler_029_forge_tempering_scan,
  _callToolHandler_030_forge_tempering_status,
  _callToolHandler_031_forge_tempering_run,
  _callToolHandler_032_forge_tempering_approve_baseline,
  _callToolHandler_033_forge_tempering_drain,
  _callToolHandler_034_forge_triage_route,
  _callToolHandler_035_forge_classifier_issue,
  _callToolHandler_036_forge_bug_register,
  _callToolHandler_037_forge_bug_list,
  _callToolHandler_038_forge_bug_update_status,
  _callToolHandler_039_forge_bug_validate_fix,
  _callToolHandler_040_forge_memory_capture,
  _callToolHandler_041_forge_brain_test,
  _callToolHandler_042_forge_brain_replay,
  _callToolHandler_043_forge_generate_image,
  _callToolHandler_044_forge_incident_capture,
  _callToolHandler_045_forge_deploy_journal,
  _callToolHandler_046_forge_regression_guard,
  _callToolHandler_047_forge_drift_report,
  _callToolHandler_048_forge_runbook,
  _callToolHandler_049_forge_hotspot,
  _callToolHandler_050_forge_dep_watch,
  _callToolHandler_051_forge_diff_classify,
  _callToolHandler_052_forge_secret_scan,
  _callToolHandler_053_forge_env_diff,
  _callToolHandler_054_forge_fix_proposal,
  _callToolHandler_055_forge_liveguard_run,
  _callToolHandler_057_forge_review_add,
  _callToolHandler_058_forge_review_list,
  _callToolHandler_059_forge_review_resolve,
  _callToolHandler_060_forge_delegate_to_agent,
  _callToolHandler_061_forge_notify_send,
  _callToolHandler_062_forge_notify_test,
  _callToolHandler_063_forge_search,
  _callToolHandler_064_forge_timeline,
  _callToolHandler_065_forge_doctor_quorum,
  _callToolHandler_066_forge_quorum_analyze,
  _callToolHandler_067_forge_smith,
  _callToolHandler_068_forge_testbed_run,
  _callToolHandler_069_forge_testbed_findings,
  _callToolHandler_070_forge_export_plan,
  _callToolHandler_071_forge_sync_memories,
  _callToolHandler_072_forge_sync_instructions,
  _callToolHandler_073_forge_testbed_happypath,
  _callToolHandler_074_forge_master_ask,
  _callToolHandler_075_forge_meta_bug_file,
  _callToolHandler_076_forge_graph_query,
  _callToolHandler_077_forge_patterns_list,
  _callToolHandler_078_forge_delegate_review,
  _callToolHandler_079_forge_team_dashboard,
  _callToolHandler_080_forge_team_activity,
  _callToolHandler_081_forge_github_metrics,
  _callToolHandler_082_forge_anvil_stat,
  _callToolHandler_083_forge_anvil_clear,
  _callToolHandler_084_forge_anvil_rebuild,
  _callToolHandler_085_forge_anvil_dlq_list,
  _callToolHandler_086_forge_anvil_dlq_drain,
  _callToolHandler_087_forge_hallmark_show,
  _callToolHandler_088_forge_hallmark_verify,
  _callToolHandler_089_forge_pipelines_list,
  _callToolHandler_090_forge_lattice_index,
  _callToolHandler_091_forge_lattice_stat,
  _callToolHandler_092_forge_lattice_query,
  _callToolHandler_093_forge_lattice_callers,
  _callToolHandler_094_forge_lattice_blast,
  _callToolHandler_095_forge_local_search,
  _callToolHandler_096_forge_embedding_status,
  _callToolHandler_097_forge_local_recall_status,
  _callToolHandler_098_forge_audit_export,
];

export const callToolRequestHandler = _wrapWithToolSpan(async (request) => {
  const { name, arguments: args } = request.params;

  // ─── Auth gate — open-by-default when .forge/rbac.json is absent ───
  const authDenied = await _mcpAuthGate(name, request);
  if (authDenied) return authDenied;

  // ─── Async orchestrator tools ───
    for (const handler of _CALL_TOOL_HANDLERS) {
    const handled = await handler(request, args);
    if (handled !== _CALL_TOOL_NO_MATCH) return handled;
  }

const result = executeTool(name, args || {});

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? result.output
          : `Error (exit code ${result.exitCode}):\n${result.output}\n${result.error}`,
      },
    ],
    isError: !result.success,
  };
});

// REST API: POST /api/tool/:name — invoke forge tool
// MCP-only tools route through internal handler; CLI tools proxy through pforge.ps1
export const MCP_ONLY_TOOLS = new Set([
  "forge_liveguard_run", "forge_quorum_analyze", "forge_health_trend",
  "forge_alert_triage", "forge_drift_report", "forge_regression_guard",
  "forge_incident_capture", "forge_deploy_journal", "forge_dep_watch",
  "forge_diff_classify", "forge_secret_scan", "forge_env_diff", "forge_fix_proposal",
  "forge_hotspot", "forge_runbook", "forge_run_plan", "forge_cost_report",
  // Phase-27.1 Slice 2b — forge_estimate_quorum was registered in
  // capabilities.mjs/tools.json/switch case/handler in Phase-27 Slice 6 but
  // missed this Set, so /api/tool/forge_estimate_quorum fell through to
  // runPforge() (no CLI counterpart). Added here so the HTTP bridge reaches
  // the MCP handler.
  "forge_estimate_quorum",
  // Phase-27.2 Slice 3 — forge_estimate_slice is MCP-native (no CLI
  // counterpart). Adding here so /api/tool/forge_estimate_slice reaches
  // the MCP handler instead of falling through to runPforge().
  "forge_estimate_slice",
  "forge_capabilities", "forge_memory_capture",
  // Phase TEMPER-01 Slice 01.2 — Tempering tools handle their own IO
  // via tempering.mjs; they are MCP-native and must not be shelled
  // through pforge.ps1 (which has no Tempering command).
  "forge_tempering_scan", "forge_tempering_status",
  // Phase TEMPER-02 Slice 02.1 — execution harness owns its own
  // subprocess boundary; must not shell through pforge.ps1.
  "forge_tempering_run",
  // Phase TEMPER-04 Slice 04.1 — baseline promotion is MCP-native.
  "forge_tempering_approve_baseline",
  // Phase TEMPER-06 Slice 06.1 — Bug registry tools are MCP-native.
  "forge_bug_register", "forge_bug_list", "forge_bug_update_status",
  // Phase TEMPER-06 Slice 06.3 — Closed-loop validation is MCP-native.
  "forge_bug_validate_fix",
  // Phase FORGE-SHOP-01 Slice 01.1 — Home snapshot is MCP-native read-only.
  "forge_home_snapshot",
  // Phase FORGE-SHOP-02 Slice 02.1 — Review Queue tools are MCP-native.
  "forge_review_add", "forge_review_list", "forge_review_resolve",
  // Phase TEMPER-07 Slice 07.1 — Agent delegation is MCP-native.
  "forge_delegate_to_agent",
  // Phase FORGE-SHOP-03 Slice 03.1 — Notification tools are MCP-native.
  "forge_notify_send", "forge_notify_test",
  // Phase FORGE-SHOP-04 Slice 04.1 — Search is MCP-native read-only.
  "forge_search",
  // Phase FORGE-SHOP-05 Slice 05.1 — Timeline is MCP-native read-only.
  "forge_timeline",
  // Issue #73 — Doctor quorum is MCP-native read-only.
  "forge_doctor_quorum",
  // Phase TESTBED-01 Slice 01 — Testbed runner is MCP-native.
  "forge_testbed_run",
  // Phase TESTBED-02 Slice 01 — Testbed happypath runner is MCP-native.
  "forge_testbed_happypath",
  // Phase-28.3 Slice 03 — Self-repair meta-bug filer is MCP-native.
  "forge_meta_bug_file",
  // Phase-38.3 — Knowledge graph query is MCP-native.
  "forge_graph_query",
  // Phase-38.6 — Pattern list is MCP-native.
  "forge_patterns_list",
  // Phase GITHUB-D — GitHub metrics is MCP-native.
  "forge_github_metrics",
  // Phase-TEAM-ACTIVITY — Team activity feed is MCP-native.
  // Phase-TEAM-DASHBOARD — Team coordination dashboard is MCP-native.
  "forge_team_dashboard",
  "forge_team_activity",
  // Phase CLASSIFIER-ISSUE — Classifier-lane GitHub issue filer is MCP-native.
  "forge_classifier_issue",
  // D6 — Agentic code review delegation is MCP-native.
  "forge_delegate_review",
  // Phase-ANVIL Slice 6 — Anvil + Hallmark + Pipelines tools are MCP-native.
  "forge_anvil_stat",
  "forge_anvil_clear",
  "forge_anvil_rebuild",
  "forge_anvil_dlq_list",
  "forge_anvil_dlq_drain",
  "forge_hallmark_show",
  "forge_hallmark_verify",
  "forge_pipelines_list",
  // Phase LATTICE Slice 7 — Lattice code-graph tools are MCP-native.
  "forge_lattice_index",
  "forge_lattice_stat",
  "forge_lattice_query",
  "forge_lattice_callers",
  "forge_lattice_blast",
  // Issue #134 — Crucible tools are MCP-native (handled by switch-case
  // in CallToolRequestSchema). Without these in the allowlist,
  // POST /api/tool/forge_crucible_* falls through to runPforge() which
  // has no Crucible CLI commands and returns "Unknown command".
  "forge_crucible_submit",
  "forge_crucible_ask",
  "forge_crucible_preview",
  "forge_crucible_finalize",
  "forge_crucible_list",
  "forge_crucible_abandon",
  "forge_crucible_import",
  "forge_crucible_status",
  // Roadmap C2 — forge_export_plan is MCP-native (no CLI shell equivalent).
  "forge_export_plan",
  // Roadmap C3 — forge_sync_memories is MCP-native (CLI also available via pforge sync-memories).
  "forge_sync_memories",
  // v3.0.0 — forge_sync_instructions is MCP-native (CLI also available via pforge sync-instructions).
  "forge_sync_instructions",
  // Phase 55/56 — Embedding tools are MCP-native. forge_local_search has a CLI path
  // via pforge mcp-call, but forge_embedding_status is read-only and MCP-native.
  "forge_local_search",
  "forge_embedding_status",
  // Phase 58 — forge_local_recall_status is MCP-native (status/warm/clear subcommands
  // also available via pforge local-recall CLI).
  "forge_local_recall_status",
  // Phase OTEL-AUDIT-EXPORT — forge_audit_export is MCP-native; the handler
  // collects streaming JSONL into an ACI-paginated payload (limit, truncated).
  // The unbounded streaming form stays in the CLI (pforge audit export).
  "forge_audit_export",
]);
