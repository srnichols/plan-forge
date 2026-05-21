/**
 * Plan Forge — Crucible core/finalize (Phase-59 Slice 1 substrate).
 *
 * Thin re-export bridge. Imports flow inward (core → flat) in Slice 1.
 * A later slice will reverse direction: extract logic here and have
 * crucible-server.mjs re-export from this module instead.
 */

import { CRITICAL_FIELDS } from "../../crucible-server.mjs";

export {
  CRITICAL_FIELDS,
  handleFinalize,
  CrucibleFinalizeRefusedError,
  CruciblePlanExistsError,
  CrucibleAskMismatchError,
} from "../../crucible-server.mjs";

/**
 * Resolve critical fields for a mode. Per-mode mode.criticalFields takes
 * precedence over the global CRITICAL_FIELDS fallback.
 *
 * @param {import('../mode.mjs').CrucibleMode|null|undefined} mode
 * @returns {Set<string>}
 */
export function resolveCriticalFields(mode) {
  if (mode && mode.criticalFields instanceof Set) return mode.criticalFields;
  return CRITICAL_FIELDS;
}
