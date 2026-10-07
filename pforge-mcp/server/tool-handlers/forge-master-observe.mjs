/**
 * forge_master_observe — proxy to the long-lived Forge-Master studio child.
 *
 * The observer and its insight ring live in the pforge-master child process,
 * so start/stop/status must all reach the SAME child. There is deliberately no
 * in-process fallback: an in-process observer would hold a different ring and
 * `status` would page insights that `start` never produced.
 */

import { resolve } from "node:path";
import { emitToolTelemetry } from "../../orchestrator.mjs";
import { PROJECT_DIR, getOrSpawnStudioChild, setStudioClient } from "../state.mjs";
import { findProjectRoot } from "../helpers.mjs";
import { _CALL_TOOL_NO_MATCH } from "./shared.mjs";

const TOOL_NAME = "forge_master_observe";
export const OBSERVE_ACTIONS = Object.freeze(["start", "stop", "status"]);
// Mirrors INSIGHT_LIMITS.maxPage in pforge-master/src/observer-insights.mjs.
export const OBSERVE_MAX_LIMIT = 25;
const MAX_CURSOR_CHARS = 32;
const STUDIO_TOOL_ERROR_PREFIX = `MCP tool error (${TOOL_NAME}): `;
const FORWARDED_FIELDS = Object.freeze(["action", "sessionId", "detach", "limit", "cursor"]);

const UNAVAILABLE_SPAWN_MESSAGE =
  "The Forge-Master studio child is unavailable: pforge-master/server.mjs was not found next to pforge-mcp or failed to spawn. " +
  "Ensure the pforge-master package is installed (cd pforge-master && npm install) and check the pforge-mcp stderr for " +
  "'failed to spawn studio child'. forge_master_observe has no in-process fallback because insights live in the studio child's ring.";

function _jsonResult(payload, isError = false) {
  const content = [{ type: "text", text: JSON.stringify(payload, null, 2) }];
  return isError ? { content, isError: true } : { content };
}

function _invalid(message) {
  return { ok: false, error: "INVALID_INPUT", message: `${TOOL_NAME}: ${message}` };
}

function _validateOptionalTypes(args) {
  if (args.sessionId !== undefined && typeof args.sessionId !== "string") return _invalid("sessionId must be a string.");
  if (args.detach !== undefined && typeof args.detach !== "boolean") return _invalid("detach must be a boolean.");
  if (args.path !== undefined && (typeof args.path !== "string" || !args.path)) return _invalid("path must be a non-empty string.");
  return null;
}

function _validatePaging(args) {
  const { limit, cursor } = args;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1 && limit <= OBSERVE_MAX_LIMIT)) {
    return _invalid(`limit must be an integer between 1 and ${OBSERVE_MAX_LIMIT}.`);
  }
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > MAX_CURSOR_CHARS)) {
    return _invalid(`cursor must be a non-empty string of at most ${MAX_CURSOR_CHARS} characters (use nextCursor from a previous status page).`);
  }
  return null;
}

/**
 * Validate forge_master_observe arguments at the pforge-mcp boundary.
 * @param {object} args
 * @returns {null | { ok: false, error: "INVALID_INPUT", message: string }}
 */
export function _validateObserveArgs(args) {
  if (!args || typeof args !== "object") return _invalid("arguments must be an object.");
  if (!OBSERVE_ACTIONS.includes(args.action)) return _invalid("action must be 'start', 'stop', or 'status'.");
  return _validateOptionalTypes(args) || _validatePaging(args);
}

/** Forward only the declared fields, plus the resolved project root so the child observes the right project. */
function _buildProxyArgs(args, cwd) {
  const forwarded = Object.fromEntries(FORWARDED_FIELDS
    .filter((field) => args[field] !== undefined)
    .map((field) => [field, args[field]]));
  return { ...forwarded, path: cwd };
}

/** A tool-level error from a healthy child (e.g. observer-disabled) — its payload, or null for transport errors. */
function _studioToolErrorPayload(err) {
  const msg = typeof err?.message === "string" ? err.message : "";
  if (!msg.startsWith(STUDIO_TOOL_ERROR_PREFIX)) return null;
  const text = msg.slice(STUDIO_TOOL_ERROR_PREFIX.length);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { /* plain-text tool error */ }
  return { ok: false, error: "FORGE_MASTER_OBSERVE_ERROR", message: text || "Forge-Master observer returned an error without details." };
}

function _unavailable(message) {
  return { ok: false, error: "FORGE_MASTER_UNAVAILABLE", message };
}

/** Drop a broken studio client so the next call respawns it; close it so no orphaned observer keeps spending. */
function _resetStudioClient(studio) {
  setStudioClient(null);
  try {
    Promise.resolve(studio?.close?.()).catch(() => {});
  } catch { /* already gone */ }
}

function _asPayload(value) {
  if (value && typeof value === "object") return value;
  const message = typeof value === "string" && value ? value : "Forge-Master observer returned an empty response.";
  return { ok: false, error: "FORGE_MASTER_OBSERVE_ERROR", message };
}

/** @returns {Promise<{ payload: object, proxied: boolean }>} */
async function _proxyObserve(studio, proxyArgs) {
  try {
    return { payload: _asPayload(await studio.invoke(TOOL_NAME, proxyArgs)), proxied: true };
  } catch (err) {
    const toolError = _studioToolErrorPayload(err);
    if (toolError) return { payload: toolError, proxied: true };
    _resetStudioClient(studio);
    const message = `Lost contact with the Forge-Master studio child (${err?.message ?? err}). The client was reset; retry to respawn it — ` +
      "a respawned child starts with the observer stopped and an empty insight ring, so call action:'start' again.";
    return { payload: _unavailable(message), proxied: false };
  }
}

async function _observe(input, cwd) {
  const studio = await getOrSpawnStudioChild();
  if (studio) return _proxyObserve(studio, _buildProxyArgs(input, cwd));
  setStudioClient(null);
  return { payload: _unavailable(UNAVAILABLE_SPAWN_MESSAGE), proxied: false };
}

/** forge_master_observe — proxied to pforge-master/server.mjs; no in-process fallback. */
export async function _callToolHandler_101_forge_master_observe(request, args) {
  if (request.params.name !== TOOL_NAME) return _CALL_TOOL_NO_MATCH;
  const t0 = Date.now();
  const input = args ?? {};
  const invalid = _validateObserveArgs(input);
  if (invalid) return _jsonResult(invalid, true);

  let cwd = PROJECT_DIR;
  let outcome;
  try {
    cwd = input.path ? findProjectRoot(resolve(input.path)) : findProjectRoot(PROJECT_DIR);
    outcome = await _observe(input, cwd);
  } catch (err) {
    outcome = { payload: _unavailable(`forge_master_observe failed before reaching the studio child: ${err?.message ?? err}`), proxied: false };
  }
  const isError = outcome.payload.ok === false;
  try {
    emitToolTelemetry({
      toolName: TOOL_NAME,
      inputs: input,
      result: { proxied: outcome.proxied, action: input.action, ...(isError && { error: outcome.payload.error }) },
      durationMs: Date.now() - t0,
      status: isError ? "ERROR" : "OK",
      cwd,
    });
  } catch { /* telemetry is best-effort */ }
  return _jsonResult(outcome.payload, isError);
}
