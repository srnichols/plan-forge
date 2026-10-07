import { ClawError } from "../errors.mjs";

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

export function mapSdkEvent(ev) {
  if (!ev || typeof ev.type !== "string") return null;
  const data = eventData(ev);
  if (ev.type === "assistant.message_delta" || ev.type === "assistant.message") {
    return { type: "progress", data: { text: progressText(data) } };
  }
  if (ev.type === "tool.execution_start" || ev.type === "tool.execution_complete") {
    const mapped = {
      tool: data.toolName ?? data.tool ?? data.mcpToolName ?? null,
      phase: ev.type === "tool.execution_start" ? "start" : "complete",
    };
    if (ev.type === "tool.execution_complete") mapped.success = data.success ?? null;
    return { type: "log", data: mapped };
  }
  if (ev.type === "assistant.usage") {
    return {
      type: "cost",
      data: {
        tokensIn: usageField(data, "tokensIn"),
        tokensOut: usageField(data, "tokensOut"),
        model: data.model ?? null,
      },
    };
  }
  if (ev.type === "user_input.requested" || ev.type.startsWith("elicitation.")) {
    return { type: "needs-input", data: { kind: data.kind ?? ev.type } };
  }
  if (ev.type === "session.error") {
    return {
      type: "log",
      data: { level: "error", code: data.code ?? data.errorCode ?? data.errorType ?? null },
    };
  }
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

async function defaultCreateSession({ clientOptions, sessionConfig }) {
  let sdk;
  try {
    sdk = await import("@github/copilot-sdk");
  } catch {
    throw new ClawError("SDK_IMPORT_FAILED");
  }
  const client = new sdk.CopilotClient(clientOptions);
  const session = await client.createSession(sessionConfig);
  return { client, session };
}

export function createCopilotRuntime({
  createSession = defaultCreateSession,
  secrets,
  provider,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    id: provider?.type ?? "copilot-sdk",
    async run(turn) {
      const usage = createUsageAccumulator();
      if (turn?.signal?.aborted) {
        return { ok: false, status: "cancelled", usage: usage.result() };
      }
      if (!turn?.model) throw new ClawError("MODEL_MISSING");
      if (!turn?.mcpServers || Object.keys(turn.mcpServers).length === 0) {
        throw new ClawError("MCP_ENTRY_MISSING");
      }

      let client;
      let session;
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        session?.abort?.();
      };
      try {
        const clientOptions = { workingDirectory: turn.cwd };
        if (!provider) {
          const token = secrets?.get(COPILOT_TOKEN_SECRET);
          if (token) clientOptions.gitHubToken = token;
          else clientOptions.useLoggedInUser = true;
        }
        const sessionConfig = {
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
        turn.signal?.addEventListener("abort", onAbort, { once: true });
        ({ client, session } = await createSession({ clientOptions, sessionConfig }));
        if (turn.signal?.aborted || aborted) {
          onAbort();
          return { ok: false, status: "cancelled", usage: usage.result() };
        }
        await session.sendAndWait({ prompt: turn.prompt }, turn.timeoutMs ?? timeoutMs);
        return turn.signal?.aborted
          ? { ok: false, status: "cancelled", usage: usage.result() }
          : { ok: true, status: "succeeded", usage: usage.result() };
      } catch (error) {
        if (turn.signal?.aborted || aborted) {
          return { ok: false, status: "cancelled", usage: usage.result() };
        }
        return {
          ok: false,
          status: "failed",
          error: error instanceof ClawError ? error.code : "RUNTIME_FAILED",
          usage: usage.result(),
        };
      } finally {
        turn.signal?.removeEventListener("abort", onAbort);
        try {
          await session?.disconnect?.();
        } catch (cleanupError) {
          void cleanupError;
        }
        try {
          await client?.stop();
        } catch {
          try {
            await client?.forceStop?.();
          } catch (cleanupError) {
            void cleanupError;
          }
        }
      }
    },
  };
}
