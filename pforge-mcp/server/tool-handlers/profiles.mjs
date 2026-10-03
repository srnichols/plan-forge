import { TOOLS } from "../tool-definitions.mjs";
import { _mcpServerRef } from "../state.mjs";
import { toolProfiles } from "../tool-profile-state.mjs";
import { TOOL_PROFILES, TOOL_PROFILE_DESCRIPTIONS } from "../tool-profiles.mjs";
import { _CALL_TOOL_NO_MATCH } from "./shared.mjs";

const toList = (value) => (Array.isArray(value) ? value : value ? [value] : []).map(String);

function profileSummary(active) {
  return Object.keys(TOOL_PROFILES).map((name) => ({
    name,
    tools: name === "full" ? TOOLS.length : TOOL_PROFILES[name].length,
    active: active.includes(name),
    description: TOOL_PROFILE_DESCRIPTIONS[name],
  }));
}

function profileMessage({ changed, listed, unknown, load, unload }) {
  const parts = [];
  if (unknown.length > 0) parts.push(`Unknown profile(s): ${unknown.join(", ")} — see profiles below.`);
  if (changed) {
    parts.push(`${listed} of ${TOOLS.length} tools are now listed; your client refreshes its tool list automatically.`);
  } else if (load.length === 0 && unload.length === 0) {
    parts.push(`${listed} of ${TOOLS.length} tools are listed. Load more with { load: ["<profile>"] }, or "full" for every tool.`);
  } else {
    parts.push("No change: those profiles were already in that state.");
  }
  return parts.join(" ");
}

/** forge_tool_profile — list, load or unload MCP tool profiles. */
export async function _callToolHandler_100_forge_tool_profile(request, args = {}) {
  if (request.params.name !== "forge_tool_profile") return _CALL_TOOL_NO_MATCH;
  const load = toList(args.load);
  const unload = toList(args.unload);
  const result = toolProfiles.apply({ load, unload });
  if (result.changed) {
    try {
      await _mcpServerRef?.sendToolListChanged?.();
    } catch { /* a client that did not subscribe still sees the change on its next tools/list */ }
  }
  const listed = toolProfiles.listedTools(TOOLS).length;
  const payload = {
    active: result.active,
    changed: result.changed,
    listedTools: listed,
    totalTools: TOOLS.length,
    unknown: result.unknown,
    profiles: profileSummary(result.active),
    message: profileMessage({ changed: result.changed, listed, unknown: result.unknown, load, unload }),
  };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: result.unknown.length > 0 && !result.changed };
}
