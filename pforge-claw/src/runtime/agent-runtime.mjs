import { ClawError } from "../errors.mjs";
import { NULL_USAGE } from "./copilot-session.mjs";
import { buildByokProvider } from "./byok.mjs";
import { createCopilotRuntime } from "./copilot-session.mjs";

export const RUNTIME_IDS = Object.freeze(["copilot-sdk", "anthropic", "openai", "azure"]);
export const DEFAULT_RUNTIME_ID = "copilot-sdk";

export function normalizeRuntimeId(raw) {
  const runtime = typeof raw === "string" && raw.startsWith("byok:")
    ? raw.slice("byok:".length)
    : raw;
  if (!RUNTIME_IDS.includes(runtime)) {
    throw new ClawError("RUNTIME_UNKNOWN", { runtime: raw });
  }
  return runtime;
}

export function resolveRuntimeId({ config, lane, project } = {}) {
  const selected = project?.runtime
    ?? lane?.runtime
    ?? config?.runtimes?.default
    ?? DEFAULT_RUNTIME_ID;
  return normalizeRuntimeId(selected);
}

export function assertAgentRuntime(runtime) {
  if (!runtime || typeof runtime !== "object"
    || typeof runtime.id !== "string"
    || typeof runtime.run !== "function") {
    throw new ClawError("RUNTIME_BAD_CONTRACT");
  }
  return runtime;
}

export async function createAgentRuntime({
  id,
  config,
  secrets,
  createSession,
  createCopilotRuntime: makeCopilotRuntime = createCopilotRuntime,
} = {}) {
  const runtimeId = normalizeRuntimeId(id ?? DEFAULT_RUNTIME_ID);
  if (runtimeId === DEFAULT_RUNTIME_ID) {
    return assertAgentRuntime(makeCopilotRuntime({ createSession, secrets }));
  }

  const result = buildByokProvider({ type: runtimeId, config, secrets });
  if (!result.ok) {
    return {
      id: runtimeId,
      run: async () => ({
        ok: false,
        status: "failed",
        error: result.error,
        provider: runtimeId,
        usage: NULL_USAGE,
      }),
    };
  }
  return assertAgentRuntime(makeCopilotRuntime({
    createSession,
    secrets,
    provider: result.provider,
  }));
}
