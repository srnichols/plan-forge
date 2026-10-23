/** Plan Forge — meta-bug #322: decide whether a run carried the whole plan */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** `slice-<number>.json`; the number may carry dots and letters but never a dash, so `slice-3-quorum.json` is not a result. */
const SLICE_RESULT_FILE_RE = /^slice-(\d[\w.]*)\.json$/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Slice numbers that passed in any earlier run of this plan.
 *
 * Run directories are named `<ISO timestamp>_<plan basename>` and hold one
 * `slice-<number>.json` per executed slice. History can corroborate a slice a
 * run skipped; it cannot stand in for one the run never mentioned.
 *
 * @param {object} params
 * @param {string} params.cwd
 * @param {string} params.planPath
 * @returns {Set<string>}
 */
export function readPassedSlicesFromHistory({ cwd, planPath }) {
  const passed = new Set();
  const planName = basename(String(planPath ?? ""), ".md");
  if (!planName) return passed;
  const runsDir = resolve(cwd, ".forge", "runs");
  const runDirRe = new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z_${escapeRegExp(planName)}$`);
  let runs;
  try {
    runs = readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return passed;
  }
  for (const run of runs) {
    if (!run.isDirectory() || !runDirRe.test(run.name)) continue;
    let files;
    try {
      files = readdirSync(join(runsDir, run.name));
    } catch {
      continue;
    }
    for (const file of files) {
      const match = SLICE_RESULT_FILE_RE.exec(file);
      if (!match) continue;
      try {
        if (JSON.parse(readFileSync(join(runsDir, run.name, file), "utf-8")).status === "passed") passed.add(match[1]);
      } catch { /* an unreadable record is not evidence */ }
    }
  }
  return passed;
}

/**
 * A slice counts as carried when this run passed it, or skipped it with
 * something other than the run vouching for the skip: the plan's own complete
 * marker, or an earlier run that passed it. A skip behind an unsatisfied
 * dependency is never a pass, and a slice the run has no result for never counts.
 */
function isSliceCovered(slice, result, priorPassed) {
  if (!result) return false;
  if (result.status === "passed") return true;
  if (result.status !== "skipped" || result.unsatisfied) return false;
  return slice.status === "completed" || priorPassed.has(String(slice.number));
}

/** Results keyed by slice number: scheduler skips carry only `sliceId`, executed slices carry `number`. */
function indexBySlice(results) {
  const byId = new Map();
  for (const result of results ?? []) byId.set(String(result.sliceId ?? result.number), result);
  return byId;
}

/**
 * Meta-bug #322 — did this run carry every slice of the plan to a state that
 * justifies calling the plan shipped?
 *
 * `results.every(passed|skipped)` only covers the slices that executed, so
 * `--only-slices 5` on a 29-slice plan scored 1 passed / 0 failed and rewrote
 * the plan header to "Complete — shipped". See {@link isSliceCovered} for what
 * counts as carried.
 *
 * @param {object} params
 * @param {{ slices?: Array<{ number: string|number, status?: string }> }} params.plan
 * @param {Array<{ sliceId?: string|number, number?: string|number, status: string, unsatisfied?: boolean }>} params.results
 * @param {Set<string>} [params.priorPassed] - slice numbers that passed in earlier runs
 * @param {boolean} [params.aborted] - the run was cut short
 * @returns {{ complete: boolean, covered: string[], uncovered: string[], reason: string|null }}
 */
export function computePlanCoverage({ plan, results, priorPassed = new Set(), aborted = false }) {
  const slices = Array.isArray(plan?.slices) ? plan.slices : [];
  if (slices.length === 0) return { complete: false, covered: [], uncovered: [], reason: "plan has no slices" };

  const resultById = indexBySlice(results);
  const covered = [];
  const uncovered = [];
  for (const slice of slices) {
    const id = String(slice.number);
    (isSliceCovered(slice, resultById.get(id), priorPassed) ? covered : uncovered).push(id);
  }

  if (aborted) return { complete: false, covered, uncovered, reason: "run was aborted" };
  if (uncovered.length > 0) return { complete: false, covered, uncovered, reason: `no pass recorded for slice(s) ${uncovered.join(", ")}` };
  return { complete: true, covered, uncovered, reason: null };
}
