/**
 * Plan Forge — TEMPER-05 Slice 05.2: Mutation scheduling decision helper.
 *
 * Pure functions — no I/O, no shared state. Determines whether the
 * mutation scanner should run based on trigger type, critical paths,
 * and explicit overrides.
 *
 * @module tempering/scheduling
 */

// ─── Critical path matching ──────────────────────────────────────────

/**
 * Check whether any touched file matches a critical path glob pattern.
 * Uses simple glob matching (supports `*` and `**` wildcards).
 *
 * @param {string[]} touchedFiles - Files changed in the current slice
 * @param {string[]} criticalPaths - Glob patterns from config
 * @returns {boolean}
 */
export function isCriticalPathTouched(touchedFiles = [], criticalPaths = []) {
  if (!Array.isArray(touchedFiles) || touchedFiles.length === 0) return false;
  if (!Array.isArray(criticalPaths) || criticalPaths.length === 0) return false;

  for (const pattern of criticalPaths) {
    if (typeof pattern !== "string" || !pattern) continue;
    try {
      const re = globToRegex(pattern);
      for (const file of touchedFiles) {
        if (typeof file === "string" && re.test(file)) return true;
      }
    } catch {
      // Malformed glob — treat as non-match (logged by caller if needed)
      continue;
    }
  }
  return false;
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `*` (single segment) and `**` (multi-segment).
 *
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegex(glob) {
  let re = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")  // escape regex chars (except * and ?)
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${re}$`);
}

// ─── Nightly window ──────────────────────────────────────────────────

/**
 * Check if the current context is within a nightly window.
 *
 * @param {string} trigger - "post-slice" | "nightly" | "manual"
 * @param {object} config - Tempering config
 * @returns {boolean}
 */
export function isNightlyWindow(trigger, config) {
  if (trigger === "nightly") return true;
  // Future: time-based fallback if config.scanners.mutation.nightlyWindow set
  return false;
}

// ─── Main scheduling decision ────────────────────────────────────────

/**
 * Decide whether the mutation scanner should run.
 *
 * @param {object} ctx
 * @param {object} ctx.config - Tempering config
 * @param {string} ctx.trigger - "post-slice" | "nightly" | "manual"
 * @param {object} [ctx.sliceRef] - Current slice reference
 * @param {string[]} [ctx.touchedFiles] - Files changed in this slice
 * @param {Function} [ctx.now] - Clock function
 * @returns {{ run: boolean, reason: string }}
 */
export function shouldRunMutation(ctx) {
  const { config = {}, trigger = "manual", touchedFiles = [] } = ctx || {};

  const mutationConfig = typeof config.scanners?.mutation === "object"
    ? config.scanners.mutation
    : {};

  // Explicit full-mutation override
  if (mutationConfig.fullMutation) {
    return { run: true, reason: "explicit-full" };
  }

  // Manual trigger always runs
  if (trigger === "manual") {
    return { run: true, reason: "manual-trigger" };
  }

  // Nightly trigger always runs
  if (trigger === "nightly") {
    return { run: true, reason: "nightly-trigger" };
  }

  // Post-slice: only run if critical path touched
  if (trigger === "post-slice") {
    const criticalPaths = Array.isArray(mutationConfig.criticalPaths)
      ? mutationConfig.criticalPaths
      : [];
    if (isCriticalPathTouched(touchedFiles, criticalPaths)) {
      return { run: true, reason: "critical-path-touched" };
    }
    return { run: false, reason: "non-critical-post-slice" };
  }

  // Unknown trigger — conservative skip
  return { run: false, reason: "unknown-trigger" };
}
