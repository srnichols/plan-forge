import { ROLES } from "../enums.mjs";
import { placeJob } from "../placement.mjs";
import { resolveRuntimeId, DEFAULT_RUNTIME_ID } from "../runtime/agent-runtime.mjs";
import { BYOK_PROVIDERS, byokProviderReference } from "../runtime/byok.mjs";

const KEY_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const JOB_ROLES = Object.freeze([ROLES[0], ROLES[1]]);
const DEFAULT_CHANNEL = "telegram";

/** Invokes a current-config method with its receiver and never falls back after it returns null. */
export function readCurrentConfig(source) {
  const getter = source?.getConfig;
  return typeof getter === "function" ? getter.call(source) : source?.config;
}

/** Resolves authority from current configuration; supplied role snapshots never grant rights. */
export function currentCaller(config, caller) {
  const id = caller?.userId ?? caller?.callerId;
  if (id === undefined || id === null) return null;
  const channel = caller?.channel ?? DEFAULT_CHANNEL;
  return config?.allowlist?.find((entry) => entry.channel === channel
    && String(entry.userId) === String(id)) ?? null;
}

function validEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !endpoint.trim()) return false;
  try {
    const url = new URL(endpoint);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function providerEligibility({ config, runtimeId, secrets, requireKey }) {
  const configured = config?.runtimes?.byok?.[runtimeId];
  if (!configured || !KEY_REFERENCE.test(configured.keySecret ?? "")
    || !validEndpoint(configured.endpoint)) return { ok: false, code: "BYOK_CONFIG_INVALID" };
  if (requireKey) {
    try {
      const key = secrets?.get?.(configured.keySecret);
      if (typeof key !== "string" || !key.trim()) return { ok: false, code: "BYOK_KEY_MISSING" };
    } catch {
      return { ok: false, code: "BYOK_KEY_MISSING" };
    }
  }
  return { ok: true, provider: byokProviderReference({ type: runtimeId, config }) };
}

function runtimeForAuthority({ config, authority, runtimeId, secrets, requireKey }) {
  if (runtimeId === DEFAULT_RUNTIME_ID) {
    const ghcpRoles = config?.policy?.ghcpRoles ?? [ROLES[0]];
    if (authority.role !== ROLES[0] || !ghcpRoles.includes(authority.role)) {
      return { ok: false, code: "RUNTIME_POLICY_DENIED" };
    }
    return { ok: true, runtimeId, role: authority.role, provider: null };
  }
  if (!BYOK_PROVIDERS.includes(runtimeId)) return { ok: false, code: "RUNTIME_POLICY_DENIED" };
  if (authority.role !== ROLES[0] && config?.policy?.nonOwnerRuntime !== "byok-only") {
    return { ok: false, code: "RUNTIME_POLICY_DENIED" };
  }
  const eligible = providerEligibility({ config, runtimeId, secrets, requireKey });
  if (!eligible.ok) return eligible;
  return { ok: true, runtimeId, role: authority.role, provider: eligible.provider };
}

function configuredProjectFor(config, project) {
  return config?.projects?.find((candidate) => candidate.id === project?.id);
}

/** Shared admission/final-placement policy; remote credentials remain executing-lane-local. */
export function runtimeEligibility({
  config, project, lane, caller, secrets, requireKey = true,
} = {}) {
  const authority = currentCaller(config, caller);
  if (!authority) return { ok: false, code: "CALLER_NOT_ALLOWED" };
  if (!JOB_ROLES.includes(authority.role)) return { ok: false, code: "ROLE_DENIED" };
  const configuredProject = configuredProjectFor(config, project);
  if (project && !configuredProject) return { ok: false, code: "PROJECT_NOT_CONFIGURED" };
  try {
    const runtimeId = resolveRuntimeId({ config, project: configuredProject, lane });
    return runtimeForAuthority({ config, authority, runtimeId, secrets, requireKey });
  } catch {
    return { ok: false, code: "RUNTIME_UNKNOWN" };
  }
}

function admissionLane({ config, project, store, lanes }) {
  const placement = placeJob({
    project, projects: config.projects, lanes: config.lanes ?? [],
    laneState: store?.readJson?.("lanes.json"),
    health: lanes?.snapshot?.(),
  });
  return placement.ok ? config.lanes.find((lane) => lane.id === placement.laneId) : undefined;
}

/** Authorizes a producer against the current configured project and actual placement precedence. */
export function authorizeJobRequest({ config, project, caller, secrets, store, lanes } = {}) {
  if (!config) return { ok: false, code: "SERVICE_UNAVAILABLE", text: "SERVICE_UNAVAILABLE: job authority" };
  const configuredProject = configuredProjectFor(config, project);
  if (!configuredProject) return { ok: false, code: "PROJECT_NOT_CONFIGURED", text: "This project is not configured." };
  const lane = admissionLane({ config, project: configuredProject, store, lanes });
  const verdict = runtimeEligibility({
    config, project: configuredProject, lane, caller, secrets, requireKey: !lane || lane.kind === "local",
  });
  if (!verdict.ok) return {
    ...verdict,
    text: verdict.code === "ROLE_DENIED" || verdict.code === "CALLER_NOT_ALLOWED"
      ? "Your current role can't start this job."
      : "This job requires a usable configured runtime.",
  };
  const authority = currentCaller(config, caller);
  return {
    ok: true, caller: authority, project: configuredProject,
    ...(authority.role !== ROLES[0] ? { constraint: "byok-only" } : {}),
  };
}

function refused(reason, text) {
  return { ok: false, reason, text };
}

function commandRuntimeDecision({ config, command, authority, context }) {
  if (!command.mutating) return { ok: true, caller: authority };
  if (command.name === "lane") return { ok: true, caller: authority };
  // Fanout owns target parsing; each declared target must pass this same producer policy.
  if (command.name === "fanout" && context.scope === "general") {
    if (authority.role !== ROLES[0] && config?.policy?.nonOwnerRuntime !== "byok-only") {
      return refused("runtime-policy", `/${command.name} requires an approved runtime.`);
    }
    return { ok: true, caller: authority, ...(authority.role !== ROLES[0] ? { constraint: "byok-only" } : {}) };
  }
  const verdict = authorizeJobRequest({
    ...context.services, config, project: context.project, caller: authority,
  });
  return verdict.ok ? verdict : refused("runtime-policy", `/${command.name} requires an approved runtime.`);
}

/** Ordinary commands, proposals and selections share availability, scope, role and runtime decisions. */
export function authorizeCommand({ config, command, caller, context } = {}) {
  if (!command?.available || typeof command.handle !== "function") {
    return refused("unavailable", `/${command?.name ?? "command"} isn't available yet.`);
  }
  if (!context || (command.scope !== "both" && command.scope !== context.scope)) {
    const location = command.scope === "project" ? "project topics" : "#general";
    return refused("wrong-scope", `/${command.name} works in ${location}.`);
  }
  const authority = currentCaller(config, caller);
  if (!authority || !command.roles?.includes(authority.role)) {
    return refused("role", `Your role can't run /${command.name}.`);
  }
  return commandRuntimeDecision({ config, command, authority, context });
}

function projectContext({ project, shared, services, clients }) {
  const mcp = clients ? {
    call: (tool, args, options) => options === undefined
      ? clients.call(project.id, tool, args)
      : clients.call(project.id, tool, args, options),
  } : services.mcp;
  return {
    scope: "project", project, services: { ...shared, ...(mcp ? { mcp } : {}) },
    ...(mcp ? { mcp } : {}),
  };
}

function generalRouteMatches(config, chatId, threadId) {
  const general = config?.channels?.telegram?.generalChat;
  return general && String(general.chatId) === String(chatId)
    && String(general.topicId ?? "") === String(threadId ?? "");
}

function routeMatches(project, chatId, threadId) {
  const channel = project?.channel;
  return channel?.adapter === DEFAULT_CHANNEL && String(channel.chatId) === String(chatId)
    && String(channel.topicId ?? "") === String(threadId ?? "");
}

function configuredRouteProject({ config, registry, chatId, threadId }) {
  const indexed = registry?.byChat?.(chatId, threadId);
  const current = configuredProjectFor(config, indexed);
  if (routeMatches(current, chatId, threadId)) return current;
  return config?.projects?.find((candidate) => routeMatches(candidate, chatId, threadId));
}

function actionTarget({ config, routedProject, projectId, chatId, threadId }) {
  if (!projectId) return routedProject;
  const target = config?.projects?.find((candidate) => candidate.id === projectId);
  if (!target) return null;
  if (routedProject) return routedProject.id === target.id ? target : null;
  if (!generalRouteMatches(config, chatId, threadId) || target.visibility === "restricted") return null;
  return target;
}

/** Builds the same configured-project MCP facade for channel and stored-action dispatch. */
export function createCommandContext({
  config, registry, services = {}, clients, chatId, threadId, projectId,
} = {}) {
  const routedProject = configuredRouteProject({ config, registry, chatId, threadId });
  const project = actionTarget({ config, routedProject, projectId, chatId, threadId });
  if (projectId && !project) return null;
  const shared = { ...services, config, registry };
  if (project) {
    return projectContext({ project, shared, services, clients });
  }
  if (generalRouteMatches(config, chatId, threadId)) return { scope: "general", services: shared };
  return null;
}
