import { ClawError } from "../errors.mjs";
import { NULL_USAGE } from "./copilot-session.mjs";
import { buildByokProvider } from "./byok.mjs";
import { createCopilotRuntime } from "./copilot-session.mjs";
import { ROLES } from "../enums.mjs";

/**
 * @typedef {{id:string,runtime?:string}} RuntimeProject
 * @typedef {{id:string,runtime?:string}} RuntimeLane
 * @typedef {{
 *   projects?:RuntimeProject[],lanes?:RuntimeLane[],
 *   allowlist?:Array<{userId:string|number,role:string}>,
 *   policy?:{ghcpRoles?:readonly string[]},runtimes?:{default?:string}
 * }} RuntimeConfig
 * @typedef {{
 *   projectId:string,callerId?:string|number,runtime?:string,
 *   lane?:string,leaseGrant?:{laneId:string}
 * }} RuntimeJob
 * @typedef {{
 *   job?:RuntimeJob,config?:RuntimeConfig,project?:RuntimeProject|null,lane?:RuntimeLane
 * }} RuntimeSelection
 */

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

function projectFor(config, job) {
  return config?.projects?.find((project) => project.id === job?.projectId) ?? null;
}

function laneFor(config, job) {
  const laneId = job?.leaseGrant?.laneId ?? job?.lane;
  return config?.lanes?.find((lane) => lane.id === laneId);
}

function callerRole(config, job) {
  return config?.allowlist?.find((entry) => String(entry.userId) === String(job?.callerId))?.role;
}

function selectedRuntime({ config, job, project, lane }) {
  if (typeof job?.runtime === "string") return normalizeRuntimeId(job.runtime);
  return resolveRuntimeId({ config, project, lane });
}

/**
 * @param {RuntimeSelection} [options]
 * @returns {string}
 */
export function resolveJobRuntimeId({
  config, job, project = projectFor(config, job), lane = laneFor(config, job),
} = {}) {
  const id = selectedRuntime({ config, job, project, lane });
  const ghcpRoles = config?.policy?.ghcpRoles ?? [ROLES[0]];
  if (typeof job?.runtime !== "string" && id === DEFAULT_RUNTIME_ID && !ghcpRoles.includes(callerRole(config, job))) {
    throw new ClawError("RUNTIME_POLICY_DENIED");
  }
  return id;
}

/**
 * Existing factories receive the same selected configuration and job metadata.
 * @template {{id:string,run:(input:unknown)=>unknown}} Runtime
 * @param {RuntimeSelection & {
 *   runtimeFactory?:(input:RuntimeSelection & {id:string,runtimeId:string})=>Runtime|Promise<Runtime>
 * }} [options]
 * @returns {Promise<Runtime>}
 */
export async function resolveJobRuntime({
  job, config, runtimeFactory, project = projectFor(config, job), lane = laneFor(config, job),
} = {}) {
  const id = resolveJobRuntimeId({ job, config, project, lane });
  if (typeof runtimeFactory !== "function") throw new ClawError("RUNTIME_BAD_CONTRACT");
  const runtime = await runtimeFactory({ id, runtimeId: id, job, config, project, lane });
  if (!runtime || runtime.id !== id || typeof runtime.run !== "function") {
    throw new ClawError("RUNTIME_BAD_CONTRACT");
  }
  return runtime;
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

  return {
    id: runtimeId,
    async run(turn) {
      const result = buildByokProvider({ type: runtimeId, config, secrets });
      if (!result.ok) return {
        ok: false, status: "failed", error: result.error, provider: runtimeId, usage: NULL_USAGE,
      };
      const runtime = assertAgentRuntime(makeCopilotRuntime({
        createSession, secrets, provider: result.provider,
      }));
      return runtime.run(turn);
    },
  };
}
