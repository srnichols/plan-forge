const freezeArray = (values) => Object.freeze([...values]);

const formatValid = (values) => values.join(", ");

function assertOneOf(kind, value, values) {
  if (!values.includes(value)) {
    throw new RangeError(`Invalid ${kind} '${value}'. Valid: ${formatValid(values)}`);
  }
  return value;
}

export const HOOK_NAMES = Object.freeze({
  SessionStart: "sessionStart",
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  Stop: "stop",
  PreDeploy: "preDeploy",
  PostSlice: "postSlice",
  PreAgentHandoff: "preAgentHandoff",
  PostRun: "postRun",
});

export const HOOK_PASCAL = freezeArray(Object.keys(HOOK_NAMES));

export const HOOK_CATEGORY = Object.freeze({
  session: freezeArray(["SessionStart", "PreToolUse", "PostToolUse", "Stop"]),
  liveGuard: freezeArray(["PreDeploy", "PostSlice", "PreAgentHandoff", "PostRun"]),
});

export const MODEL_TIERS = freezeArray(["flagship", "mid", "fast"]);
export const QUORUM_MODES = freezeArray(["auto", "power", "speed", "false"]);
export const FORGE_MASTER_MODES = freezeArray(["ask", "observe"]);
export const WATCHER_MODES = freezeArray(["snapshot", "analyze", "cross-run"]);
export const COST_SOURCES = freezeArray(["worker", "forge-master", "observer", "auditor"]);
// TODO(phase-41/S4): populate ERROR_CODES from the generated named error catalog.
export const ERROR_CODES = Object.freeze({});

export function assertHookName(name) {
  return assertOneOf("hook name", name, HOOK_PASCAL);
}

export function assertModelTier(tier) {
  return assertOneOf("model tier", tier, MODEL_TIERS);
}

export function assertQuorumMode(mode) {
  return assertOneOf("quorum mode", mode, QUORUM_MODES);
}

export function assertWatcherMode(mode) {
  return assertOneOf("watcher mode", mode, WATCHER_MODES);
}

export function assertCostSource(src) {
  return assertOneOf("cost source", src, COST_SOURCES);
}

export function assertForgeMasterMode(mode) {
  return assertOneOf("forge-master mode", mode, FORGE_MASTER_MODES);
}
