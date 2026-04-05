/**
 * Plan Forge — OpenBrain Memory Integration
 *
 * Integrates persistent semantic memory into the orchestrator pipeline.
 * When OpenBrain is configured, the orchestrator:
 *   - Injects memory search results into worker prompts (before each slice)
 *   - Instructs workers to capture decisions (after each slice)
 *   - Captures run summaries as thoughts (after completion)
 *
 * All integration is opt-in: if OpenBrain is not configured, all functions
 * return empty strings / no-ops. Zero impact on non-OpenBrain users.
 *
 * @module memory
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Check if OpenBrain is configured in .vscode/mcp.json.
 */
export function isOpenBrainConfigured(cwd) {
  const mcpConfigPaths = [
    resolve(cwd, ".vscode", "mcp.json"),
    resolve(cwd, ".claude", "mcp.json"),
  ];

  for (const configPath of mcpConfigPaths) {
    try {
      if (existsSync(configPath)) {
        const config = readFileSync(configPath, "utf-8");
        if (config.includes("openbrain") || config.includes("open-brain")) {
          return true;
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * Build memory search instructions to prepend to a worker prompt.
 * The worker (gh copilot) will execute the search_thoughts call.
 *
 * @param {string} projectName - Project name for scoping
 * @param {object} slice - Slice metadata
 * @returns {string} Memory context block to prepend to prompt
 */
export function buildMemorySearchBlock(projectName, slice) {
  return `
--- MEMORY CONTEXT (OpenBrain) ---
Before starting work, search for relevant prior decisions:

1. Search for project conventions:
   Use the search_thoughts tool with query: "conventions patterns ${slice.title}"
   project: "${projectName}", type: "convention", limit: 5

2. Search for prior lessons on similar work:
   Use the search_thoughts tool with query: "${slice.title} ${slice.tasks?.[0] || ''}"
   project: "${projectName}", limit: 5

Apply any relevant findings. Do NOT repeat mistakes documented in prior thoughts.
--- END MEMORY CONTEXT ---
`;
}

/**
 * Build memory capture instructions to append to a worker prompt.
 * The worker will capture key decisions after completing work.
 *
 * @param {string} projectName - Project name
 * @param {object} slice - Slice metadata
 * @param {string} planName - Plan file name
 * @returns {string} Capture instructions block
 */
export function buildMemoryCaptureBlock(projectName, slice, planName) {
  return `
--- MEMORY CAPTURE (OpenBrain) ---
After completing all tasks and passing validation gates, capture key decisions:

Use the capture_thought tool for each significant decision:
- content: "Decision: <what you decided and why>"
- project: "${projectName}"
- source: "plan-forge-orchestrator/${planName}/slice-${slice.number}"
- created_by: "gh-copilot-worker"

Capture:
1. Architecture decisions made during this slice
2. Patterns chosen (and why alternatives were rejected)
3. Any gotchas or constraints discovered
4. Conventions established that future slices should follow

Do NOT capture trivial facts. Focus on decisions that would save time in future phases.
--- END MEMORY CAPTURE ---
`;
}

/**
 * Build a run summary thought for capture after completion.
 *
 * @param {object} summary - Run summary object
 * @param {string} projectName - Project name
 * @returns {{ content: string, project: string, source: string, created_by: string }}
 */
export function buildRunSummaryThought(summary, projectName) {
  const parts = [
    `Plan execution completed: ${summary.plan}`,
    `Status: ${summary.status}`,
    `Slices: ${summary.results?.passed || 0} passed, ${summary.results?.failed || 0} failed`,
    `Duration: ${Math.round((summary.totalDuration || 0) / 1000)}s`,
  ];

  if (summary.cost?.total_cost_usd > 0) {
    parts.push(`Cost: $${summary.cost.total_cost_usd}`);
  }

  if (summary.sweep?.ran) {
    parts.push(`Sweep: ${summary.sweep.clean ? "clean" : `${summary.sweep.markerCount || "?"} markers`}`);
  }

  if (summary.analyze?.score != null) {
    parts.push(`Consistency score: ${summary.analyze.score}/100`);
  }

  // Include per-slice outcomes for learning
  if (summary.sliceResults) {
    for (const sr of summary.sliceResults) {
      if (sr.status === "failed") {
        parts.push(`Slice ${sr.number || sr.sliceId} FAILED: ${sr.gateError || sr.error || "unknown"}`);
      }
    }
  }

  return {
    content: parts.join(". "),
    project: projectName,
    source: `plan-forge-orchestrator/${summary.plan}`,
    created_by: "plan-forge-orchestrator",
  };
}

/**
 * Build a cost anomaly thought if current run cost differs significantly.
 *
 * @param {object} summary - Current run summary
 * @param {object} costReport - Historical cost report
 * @param {string} projectName - Project name
 * @returns {object|null} Thought to capture, or null if no anomaly
 */
export function buildCostAnomalyThought(summary, costReport, projectName) {
  if (!summary.cost?.total_cost_usd || !costReport?.total_cost_usd || costReport.runs < 2) {
    return null;
  }

  const avgCostPerRun = costReport.total_cost_usd / costReport.runs;
  const currentCost = summary.cost.total_cost_usd;
  const ratio = currentCost / avgCostPerRun;

  if (ratio > 2.0) {
    return {
      content: `Cost anomaly: ${summary.plan} cost $${currentCost} (${ratio.toFixed(1)}x the average of $${avgCostPerRun.toFixed(2)}). Review slice complexity or model selection.`,
      project: projectName,
      source: `plan-forge-orchestrator/${summary.plan}`,
      created_by: "plan-forge-orchestrator",
      type: "insight",
    };
  }

  return null;
}
