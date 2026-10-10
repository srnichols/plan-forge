import { ClawError } from "../errors.mjs";
import { disconnectSdkSession, stopSdkClient } from "./session-lifecycle.mjs";

const MAX_PROGRESS_LENGTH = 2000;

export const DEFAULT_TIMEOUT_MS = 30 * 60_000;
export const COPILOT_TOKEN_SECRET = "PFORGE_CLAW_COPILOT_TOKEN";
export const NULL_USAGE = Object.freeze({ tokensIn: null, tokensOut: null, model: null });

export const denyAllPermissions = () => ({
  kind: "reject",
  feedback: "no permission policy configured",
});

export function toSessionMcpServers({ serverName = "plan-forge", launch } = {}) {
  if (!launch || typeof launch.command !== "string" || !launch.command) {
    throw new ClawError("MCP_ENTRY_MISSING", { serverName });
  }
  return {
    [serverName]: {
      type: "stdio",
      command: launch.command,
      args: Array.isArray(launch.args) ? [...launch.args] : [],
      env: launch.env ? { ...launch.env } : {},
      tools: ["*"],
    },
  };
}

function eventData(ev) {
  return ev?.data && typeof ev.data === "object" ? ev.data : ev ?? {};
}

function progressText(data) {
  const text = typeof data.deltaContent === "string"
    ? data.deltaContent
    : typeof data.content === "string"
    ? data.content
    : typeof data.text === "string" ? data.text : "";
  return text.slice(0, MAX_PROGRESS_LENGTH);
}

function usageField(data, field) {
  const sdkField = field === "tokensIn" ? "inputTokens" : "outputTokens";
  const value = data[field] ?? data[sdkField];
  return typeof value === "number" ? value : null;
}

function mapToolEvent(ev) {
  const data = eventData(ev);
  const mapped = {
    tool: data.toolName ?? data.tool ?? data.mcpToolName ?? null,
    phase: ev.type === "tool.execution_start" ? "start" : "complete",
  };
  if (ev.type === "tool.execution_complete") mapped.success = data.success ?? null;
  return { type: "log", data: mapped };
}

function mapUsageEvent(ev) {
  const data = eventData(ev);
  return {
    type: "cost",
    data: { tokensIn: usageField(data, "tokensIn"), tokensOut: usageField(data, "tokensOut"), model: data.model ?? null },
  };
}

function mapInputEvent(ev) {
  return { type: "needs-input", data: { kind: eventData(ev).kind ?? ev.type } };
}

function mapProgressEvent(ev) {
  return { type: "progress", data: { text: progressText(eventData(ev)) } };
}

const SDK_EVENT_MAPPERS = Object.freeze({
  "assistant.message_delta": mapProgressEvent,
  "assistant.message": mapProgressEvent,
  "tool.execution_start": mapToolEvent,
  "tool.execution_complete": mapToolEvent,
  "assistant.usage": mapUsageEvent,
  "user_input.requested": mapInputEvent,
  "session.error": (ev) => {
    const data = eventData(ev);
    return { type: "log", data: { level: "error", code: data.code ?? data.errorCode ?? data.errorType ?? null } };
  },
});

export function mapSdkEvent(ev) {
  if (!ev || typeof ev.type !== "string") return null;
  if (Object.hasOwn(SDK_EVENT_MAPPERS, ev.type)) return SDK_EVENT_MAPPERS[ev.type](ev);
  if (ev.type.startsWith("elicitation.")) return mapInputEvent(ev);
  return null;
}

export function createUsageAccumulator() {
  const usage = { tokensIn: null, tokensOut: null, model: null };
  return {
    add(ev) {
      if (ev?.type !== "assistant.usage") return;
      const data = eventData(ev);
      for (const field of ["tokensIn", "tokensOut"]) {
        const value = usageField(data, field);
        if (value !== null) {
          usage[field] = (usage[field] ?? 0) + value;
        }
      }
      if (data.model !== null && data.model !== undefined) usage.model = data.model;
    },
    result() {
      return { ...usage };
    },
  };
}

async function defaultCreateSession({ clientOptions, sessionConfig, onCleanupFailure }) {
  let sdk;
  try {
    sdk = await import("@github/copilot-sdk");
  } catch {
    throw new ClawError("SDK_IMPORT_FAILED");
  }
  const client = new sdk.CopilotClient(clientOptions);
  try {
    const session = await client.createSession(sessionConfig);
    return { client, session };
  } catch (error) {
    await stopSdkClient({ client, onCleanupFailure });
    throw error;
  }
}

function clientOptionsFor({ turn, provider, secrets }) {
  const options = { workingDirectory: turn.cwd };
  if (turn.env !== undefined) options.env = { ...turn.env };
  if (!provider) {
    const token = secrets?.get(COPILOT_TOKEN_SECRET);
    if (token) options.gitHubToken = token;
    else options.useLoggedInUser = true;
  }
  return options;
}

function sessionConfigFor({ turn, provider, usage }) {
  return {
    model: turn.model,
    workingDirectory: turn.cwd,
    mcpServers: turn.mcpServers,
    onPermissionRequest: turn.onPermissionRequest ?? denyAllPermissions,
    onEvent: (ev) => {
      usage.add(ev);
      const mapped = mapSdkEvent(ev);
      if (mapped) turn.emit?.(mapped.type, mapped.data);
    },
    ...(provider ? { provider } : {}),
  };
}

function turnResult({ turn, aborted, usage, error }) {
  if (turn.signal?.aborted || aborted) return { ok: false, status: "cancelled", usage: usage.result() };
  if (error) return {
    ok: false, status: "failed", error: error instanceof ClawError ? error.code : "RUNTIME_FAILED", usage: usage.result(),
  };
  return { ok: true, status: "succeeded", usage: usage.result() };
}

function validateTurn(turn) {
  if (!turn?.model) throw new ClawError("MODEL_MISSING");
  if (!turn.mcpServers || Object.keys(turn.mcpServers).length === 0) throw new ClawError("MCP_ENTRY_MISSING");
}

async function runTurn({ turn, createSession, provider, secrets, timeoutMs }) {
  const usage = createUsageAccumulator();
  if (turn?.signal?.aborted) return { ok: false, status: "cancelled", usage: usage.result() };
  validateTurn(turn);
  let client;
  let session;
  let aborted = false;
  let outcome;
  const cleanupErrors = [];
  const onCleanupFailure = (code) => {
    cleanupErrors.push(code);
    try {
      turn.emit?.("log", { level: "error", code });
    } catch {
      if (!cleanupErrors.includes("SDK_CLEANUP_REPORT_FAILED")) cleanupErrors.push("SDK_CLEANUP_REPORT_FAILED");
    }
  };
  const onAbort = () => {
    aborted = true;
    session?.abort?.();
  };
  try {
    turn.signal?.addEventListener("abort", onAbort, { once: true });
    ({ client, session } = await createSession({
      clientOptions: clientOptionsFor({ turn, provider, secrets }),
      sessionConfig: sessionConfigFor({ turn, provider, usage }),
      onCleanupFailure,
    }));
    if (turn.signal?.aborted || aborted) onAbort();
    else await session.sendAndWait({ prompt: turn.prompt }, turn.timeoutMs ?? timeoutMs);
    outcome = turnResult({ turn, aborted, usage });
  } catch (error) {
    outcome = turnResult({ turn, aborted, usage, error });
  } finally {
    turn.signal?.removeEventListener("abort", onAbort);
    await disconnectSdkSession({ session, onCleanupFailure });
    const stopped = await stopSdkClient({ client, onCleanupFailure });
    if (!stopped && outcome?.ok) outcome = {
      ok: false, status: "failed", error: "SDK_CLEANUP_FAILED", usage: usage.result(),
    };
  }
  return cleanupErrors.length ? { ...outcome, cleanupErrors } : outcome;
}

export function createCopilotRuntime({
  createSession = defaultCreateSession,
  secrets,
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    id: provider?.type ?? "copilot-sdk",
    run: (turn) => runTurn({ turn, createSession, provider, secrets, timeoutMs }),
  };
}
