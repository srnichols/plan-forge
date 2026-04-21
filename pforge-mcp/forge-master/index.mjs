/**
 * Plan Forge — Forge-Master Subsystem (Phase-28).
 *
 * Package entry point. Re-exports all public surface from submodules
 * so consumers can import from `./forge-master/index.mjs`.
 */

export {
  getForgeMasterConfig,
  FORGE_MASTER_DEFAULTS,
} from "./config.mjs";

export {
  BASE_ALLOWLIST,
  WRITE_TOOLS_EXCLUDED,
  USAGE_HINTS,
  resolveAllowlist,
  isAllowlisted,
} from "./allowlist.mjs";

export {
  classify,
  LANES,
  LANE_TOOLS,
  OFFTOPIC_REDIRECT,
} from "./intent-router.mjs";

export {
  fetchContext,
  TOKEN_CAP,
  L1_KEYS,
  L2_KEYS_BY_LANE,
  L3_KEYS,
} from "./retrieval.mjs";

export {
  invokeAllowlisted,
  invokeMany,
  summarize,
  SUMMARY_LIMIT,
} from "./tool-bridge.mjs";
