/**
 * forge_analyze / `pforge analyze` target classification, shared by the MCP
 * handlers (server/tool-handlers/orch.mjs) and the orchestrator's --analyze CLI.
 * A leaf module so the server and the orchestrator can both import it without
 * depending on each other.
 */

import { extname } from "node:path";
import { ANALYZE_MODES } from "./enums.mjs";

const PLAN_FILE_EXTENSIONS = Object.freeze([".md", ".markdown"]);

/**
 * Resolve the analysis mode: an explicit mode wins; otherwise plans are Markdown
 * and anything else is a source file (meta-bug #319 — a "Program.cs" target used
 * to fall through to the plan scorer, and a "src/planner.ts" target was read as a
 * plan because its path contained "plan").
 * @param {{ plan?: string, mode?: string|null }} args
 * @returns {{ mode: "plan"|"file" } | { error: string }}
 */
export function resolveAnalyzeMode({ plan, mode } = {}) {
  if (typeof plan !== "string" || !plan.trim()) {
    return { error: "plan is required: the path of the plan or source file to analyze" };
  }
  if (mode !== undefined && mode !== null && mode !== "") {
    return ANALYZE_MODES.includes(mode)
      ? { mode }
      : { error: `mode must be one of ${ANALYZE_MODES.map((m) => `"${m}"`).join(", ")} (got "${mode}")` };
  }
  return { mode: PLAN_FILE_EXTENSIONS.includes(extname(plan).toLowerCase()) ? "plan" : "file" };
}

export function analyzeFileModeNeedsQuorumMessage(target) {
  return [
    `forge_analyze without quorum scores plan files only, so it did not analyze "${target}" (mode "file").`,
    "For a code review of a source file, call forge_analyze with quorum: true (a multi-model review that spends tokens),",
    "or forge_diagnose for a bug investigation. To score a Markdown file as a plan, pass mode: \"plan\".",
  ].join(" ");
}
