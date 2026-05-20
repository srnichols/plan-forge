/** Plan Forge — Phase-53 S9: compatibility re-exports for shim-only imports */

export { loadAuditConfig, shouldAutoDrain } from "../tempering/auto-activate.mjs";
export { readTemperingState, readTemperingConfig, TEMPERING_SCAN_STALE_DAYS } from "../tempering.mjs";
