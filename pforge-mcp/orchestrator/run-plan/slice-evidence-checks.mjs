/** Plan Forge — post-slice evidence checks: a slice that reported success must have left evidence of the work */

import { verifyNoOpSlice, verifyScopeFilesTrackable } from "../git-safety.mjs";

/** How many offending files a failure reason names before it stops listing them. */
const MAX_LISTED_FILES = 5;

/**
 * Meta-bug #338 — fail a slice that changed nothing although the files it
 * declares do not exist. A worker that stalls (on a Blocker, say) exits 0 and
 * leaves nothing for the gate to reject; with a gate that passes vacuously the
 * slice was recorded as passed and its dependents built on files that were
 * never created. The failure travels on the scheduler's slice-failed event.
 *
 * @param {object} params
 * @param {{ status: string, statusReason?: string }} params.sliceResult - mutated when the slice is a no-op
 * @param {{ title?: string, scope?: string[] }} params.slice
 * @param {string} params.cwd
 * @param {string|null} params.sliceStartHead - HEAD captured when the slice began
 */
export function failNoOpSlice({ sliceResult, slice, cwd, sliceStartHead }) {
  if (sliceResult.status !== "passed") return;
  try {
    const check = verifyNoOpSlice({ slice, cwd, startSha: sliceStartHead });
    if (!check.noOp) return;
    sliceResult.status = "failed";
    sliceResult.statusReason = `no-op-slice: slice "${slice.title}" changed no files and its declared file(s) do not exist (${check.missing.join(", ")})`;
    sliceResult.noOpSlice = { missing: check.missing };
  } catch { /* non-fatal */ }
}

/**
 * Meta-bug #342 — fail a slice whose declared deliverable git will never
 * commit. The file is on disk, so every filesystem-based gate passes, but it
 * sits under an ignore rule, so auto-commit leaves it out and a clean checkout
 * cannot contain it. Failing here names the file and the rule instead of
 * letting the omission surface later as a broken import.
 *
 * @param {object} params
 * @param {{ status: string, statusReason?: string }} params.sliceResult - mutated when a declared file is ignored
 * @param {{ title?: string, scope?: string[] }} params.slice
 * @param {string} params.cwd
 */
export function failIgnoredScopeSlice({ sliceResult, slice, cwd }) {
  if (sliceResult.status !== "passed") return;
  try {
    const { ignored } = verifyScopeFilesTrackable({ slice, cwd });
    if (ignored.length === 0) return;
    const listed = ignored.slice(0, MAX_LISTED_FILES).map((entry) => `${entry.path} (${entry.source}:${entry.line} "${entry.pattern}")`).join(", ");
    sliceResult.status = "failed";
    sliceResult.statusReason = `ignored-scope-file: slice "${slice.title}" declares file(s) that git ignores and would never commit: ${listed}`;
    sliceResult.ignoredScopeFiles = ignored;
  } catch { /* non-fatal */ }
}
