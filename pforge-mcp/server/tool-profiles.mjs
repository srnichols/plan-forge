/**
 * Plan Forge — MCP tool profiles.
 *
 * Plan Forge registers 100+ tools; VS Code sends at most 128 tools per chat
 * request across every MCP server, and a long tool list makes models pick
 * worse. The server therefore lists a small `core` profile by default, and the
 * agent loads more with `forge_tool_profile` (which sends
 * `notifications/tools/list_changed`). Every tool stays callable by name.
 *
 * Config: `.forge.json` → `toolProfiles` (profile name or list, e.g. ["bugs"]
 * or "full"). Override: `PFORGE_TOOL_PROFILE=bugs,liveguard` (or `full`).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const TOOL_PROFILES = Object.freeze({
  core: Object.freeze([
    "forge_tool_profile", "forge_capabilities", "forge_master_ask", "forge_smith", "forge_validate",
    "forge_sweep", "forge_analyze", "forge_diff", "forge_diagnose", "forge_status", "forge_plan_status",
    "forge_run_plan", "forge_abort", "forge_estimate_quorum", "forge_estimate_slice", "forge_cost_report",
    "forge_search", "forge_new_phase", "forge_meta_bug_file", "forge_watch_live", "forge_run_skill",
    "forge_skill_status",
  ]),
  bugs: Object.freeze([
    "forge_bug_list", "forge_bug_register", "forge_bug_update_status", "forge_bug_validate_fix",
    "forge_fix_proposal", "forge_triage_route", "forge_alert_triage", "forge_classifier_issue",
    "forge_incident_capture", "forge_review_add", "forge_review_list", "forge_review_resolve",
    "forge_delegate_review", "forge_regression_guard",
  ]),
  liveguard: Object.freeze([
    "forge_liveguard_run", "forge_drift_report", "forge_secret_scan", "forge_env_diff", "forge_dep_watch",
    "forge_health_trend", "forge_hotspot", "forge_deploy_journal", "forge_runbook", "forge_watch",
    "forge_home_snapshot", "forge_timeline", "forge_audit_export", "forge_notify_send", "forge_notify_test",
    "forge_org_rules", "forge_master_observe",
  ]),
  tempering: Object.freeze([
    "forge_tempering_run", "forge_tempering_scan", "forge_tempering_status", "forge_tempering_drain",
    "forge_tempering_approve_baseline", "forge_testbed_run", "forge_testbed_findings", "forge_testbed_happypath",
  ]),
  crucible: Object.freeze([
    "forge_crucible_submit", "forge_crucible_ask", "forge_crucible_preview", "forge_crucible_finalize",
    "forge_crucible_list", "forge_crucible_abandon", "forge_crucible_import", "forge_crucible_status",
    "forge_export_plan", "forge_quorum_analyze", "forge_doctor_quorum", "forge_patterns_list",
    "forge_pipelines_list",
  ]),
  memory: Object.freeze([
    "forge_memory_capture", "forge_memory_report", "forge_sync_memories", "forge_sync_instructions",
    "forge_brain_replay", "forge_brain_test", "forge_embedding_status", "forge_local_recall_status",
    "forge_local_search", "forge_graph_query", "forge_hallmark_show", "forge_hallmark_verify",
  ]),
  "code-intel": Object.freeze([
    "forge_lattice_index", "forge_lattice_stat", "forge_lattice_query", "forge_lattice_callers",
    "forge_lattice_blast", "forge_anvil_stat", "forge_anvil_clear", "forge_anvil_rebuild",
    "forge_anvil_dlq_list", "forge_anvil_dlq_drain", "forge_diff_classify", "forge_diff_stats",
  ]),
  team: Object.freeze([
    "forge_team_activity", "forge_team_dashboard", "forge_github_metrics", "forge_github_status",
    "forge_delegate_to_agent", "forge_master_audit", "forge_ext_search", "forge_ext_info",
    "forge_generate_image",
  ]),
  full: Object.freeze([]),
});

export const DEFAULT_TOOL_PROFILES = Object.freeze(["core"]);
const FULL = "full";
const ALWAYS_ON = "core";

/** One-line purpose per profile, for forge_tool_profile's listing. */
export const TOOL_PROFILE_DESCRIPTIONS = Object.freeze({
  core: "plan execution, status, cost, search, diagnostics (always on)",
  bugs: "bug registry, triage, fix proposals, reviews, regression guard",
  liveguard: "drift, secrets, env diff, dependencies, health, incidents, notifications, live observer",
  tempering: "test-quality scans and the testbed",
  crucible: "idea-to-plan smelting, plan export, quorum analysis",
  memory: "memory capture and recall, OpenBrain, Hallmark provenance",
  "code-intel": "Lattice code graph and Anvil cache",
  team: "team activity, GitHub metrics, agent delegation, extensions",
  full: "every Plan Forge tool",
});

function normalizeProfiles(raw) {
  const names = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const known = names.map((name) => String(name).trim()).filter((name) => Object.hasOwn(TOOL_PROFILES, name));
  return [...new Set([ALWAYS_ON, ...known])];
}

function readConfiguredProfiles(cwd) {
  try {
    const path = resolve(cwd, ".forge.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).toolProfiles : undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {{ cwd: string, env?: object }} opts
 * @returns {string[]} Active profiles at server start; always includes "core".
 */
export function resolveInitialProfiles({ cwd, env = process.env }) {
  const fromEnv = env.PFORGE_TOOL_PROFILE;
  if (fromEnv) return normalizeProfiles(fromEnv);
  const configured = readConfiguredProfiles(cwd);
  return configured === undefined ? [...DEFAULT_TOOL_PROFILES] : normalizeProfiles(configured);
}

/**
 * Mutable set of active profiles for one server process.
 * @param {string[]} initial
 */
export function createToolProfileState(initial) {
  const active = new Set(normalizeProfiles(initial));
  const toolSet = () => (active.has(FULL) ? null : new Set([...active].flatMap((name) => TOOL_PROFILES[name])));
  return {
    active: () => [...active],
    listedTools(tools) {
      const allowed = toolSet();
      return allowed ? tools.filter((tool) => allowed.has(tool.name)) : tools;
    },
    /** @returns {{ changed: boolean, active: string[], unknown: string[] }} */
    apply({ load = [], unload = [] } = {}) {
      const before = [...active].join(",");
      const unknown = [...load, ...unload].filter((name) => !Object.hasOwn(TOOL_PROFILES, name));
      for (const name of load) if (Object.hasOwn(TOOL_PROFILES, name)) active.add(name);
      for (const name of unload) if (name !== ALWAYS_ON) active.delete(name);
      return { changed: [...active].join(",") !== before, active: [...active], unknown };
    },
  };
}
