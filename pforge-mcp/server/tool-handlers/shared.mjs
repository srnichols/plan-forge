import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PROJECT_DIR,
  activeAbortController,
  _planPathAliasWarned,
  activeHub,
  captureMemory,
  setPlanPathAliasWarned,
} from "../state.mjs";
import { findProjectRoot } from "../helpers.mjs";

export const _CALL_TOOL_NO_MATCH = Symbol("call-tool-no-match");

export function _resolveToolCwd(args, key = "path") {
  return args[key] ? findProjectRoot(resolve(args[key])) : findProjectRoot(PROJECT_DIR);
}

export function _parsePlanArg(args) {
  let planArg = args.plan;
  if ((typeof planArg !== "string" || planArg === "") && typeof args.planPath === "string" && args.planPath !== "") {
    if (!_planPathAliasWarned) {
      setPlanPathAliasWarned(true);
      console.warn("[forge_run_plan] 'planPath' is an alias; prefer 'plan'");
    }
    planArg = args.planPath;
  }
  return planArg;
}

export function _parseQuorumMode(quorumArg) {
  let quorum = "auto";
  let quorumPreset = null;
  if (quorumArg === "power") { quorum = true; quorumPreset = "power"; }
  else if (quorumArg === "speed") { quorum = true; quorumPreset = "speed"; }
  else if (quorumArg === "true" || quorumArg === true) quorum = true;
  else if (quorumArg === "false" || quorumArg === false) quorum = false;
  return { quorum, quorumPreset };
}

export function _buildRunPlanOptions(args, cwd, eventHandler) {
  const { quorum, quorumPreset } = _parseQuorumMode(args.quorum);
  return {
    cwd,
    model: args.model || null,
    mode: args.mode || "auto",
    resumeFrom: args.resumeFrom != null ? Number(args.resumeFrom) : null,
    estimate: args.estimate || false,
    dryRun: args.dryRun || false,
    quorum,
    quorumPreset,
    quorumThreshold: args.quorumThreshold != null ? Number(args.quorumThreshold) : null,
    abortController: activeAbortController,
    eventHandler,
    manualImport: args.manualImport === true || args.manualImport === "true",
    manualImportSource: args.manualImportSource || "human",
    manualImportReason: args.manualImportReason || null,
  };
}

export function _handleRunPlanMemoryCapture(result, cwd) {
  if (!result?._memoryCapture) return;
  if (!result._memoryCapture._captured) {
    if (result._memoryCapture.runSummary) {
      captureMemory(result._memoryCapture.runSummary, "decision", "forge_run_plan", cwd);
    }
    if (result._memoryCapture.costAnomaly) {
      captureMemory(result._memoryCapture.costAnomaly, "gotcha", "forge_run_plan/cost", cwd);
    }
    return;
  }
  if (!result._memoryCapture.receipts) return;
  for (const key of ["runSummary", "costAnomaly"]) {
    const r = result._memoryCapture.receipts[key];
    if (r?.thought && !r.deduped) {
      try {
        activeHub?.broadcast({
          type: "memory-captured",
          thought: r.thought,
          deduped: false,
          timestamp: r.thought.captured_at,
        });
      } catch { /* never break run on broadcast failure */ }
    }
  }
}
