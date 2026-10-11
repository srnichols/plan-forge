import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ClawError } from "../errors.mjs";
import { resolveMcpLaunch } from "../registry.mjs";
import { prepareJobEnvironment } from "../jobs/runner-environment.mjs";
import { HOME_PLAN_RESOLVE_TOOL } from "../enums.mjs";
import { parsePlanResolveRequest, resolvePlan } from "../jobs/plan-resolution.mjs";

const DEFAULT_SERVER_NAME = "plan-forge";
const DEFAULT_IDLE_MINUTES = 5;
const STDERR_LIMIT_BYTES = 4096;

function expand(value, repoPath, env) {
  let unresolved = false;
  const expanded = String(value).replace(/\$\{(workspaceFolder|env:([A-Za-z_][A-Za-z0-9_]*))\}/g, (_match, token, name) => {
    if (token === "workspaceFolder") return repoPath;
    if (!Object.hasOwn(env, name) || env[name] === undefined) {
      unresolved = true;
      return "";
    }
    return String(env[name]);
  });
  if (unresolved || /\$\{[^}]+\}/.test(expanded)) {
    throw new ClawError("MCP_UNRESOLVED_VAR", { hint: "Set the missing MCP environment variable." });
  }
  return expanded;
}

async function readServerExtras(repoPath, serverName, env, read) {
  let config;
  try {
    config = JSON.parse(await read(path.join(repoPath, ".vscode", "mcp.json"), "utf8"));
  } catch (error) {
    throw new ClawError(error.code === "ENOENT" ? "MCP_CONFIG_MISSING" : "MCP_CONFIG_PARSE", {
      hint: "Check .vscode/mcp.json in the project checkout.",
    });
  }
  const server = (config?.servers ?? config?.mcpServers)?.[serverName];
  if (!server || typeof server !== "object") {
    throw new ClawError("MCP_SERVER_MISSING", { hint: "Check the configured MCP server name." });
  }
  const serverEnv = {};
  for (const [key, value] of Object.entries(server.env ?? {})) {
    if (typeof value !== "string") throw new ClawError("MCP_CONFIG_PARSE", { hint: "MCP environment values must be strings." });
    serverEnv[key] = expand(value, repoPath, env);
  }
  const cwd = typeof server.cwd === "string" && server.cwd
    ? path.resolve(repoPath, expand(server.cwd, repoPath, env))
    : repoPath;
  return { env: serverEnv, cwd };
}

function configuredHome(project, config) {
  const lane = config?.lanes?.find((entry) => entry.id === project?.homeLane);
  if (!lane) throw new ClawError("HOME_LANE_UNKNOWN");
  if (lane.kind !== "local" && lane.kind !== "remote") throw new ClawError("HOME_LANE_INVALID");
  return lane;
}

function isolatedPort(args) {
  const equalsPortIndex = args.findIndex((argument) => argument.startsWith("--port="));
  const portIndex = args.indexOf("--port");
  if (equalsPortIndex >= 0) args[equalsPortIndex] = "--port=0";
  else if (portIndex < 0) args.push("--port", "0");
  else if (portIndex + 1 < args.length) args[portIndex + 1] = "0";
  else args.push("0");
  return args;
}

function launchArguments(args, repoPath) {
  return isolatedPort(args.map((argument) => (
    argument.startsWith("./") || argument.startsWith("../")
      ? path.resolve(repoPath, argument)
      : path.isAbsolute(argument) ? path.normalize(argument) : argument
  )));
}

async function localLaunch(project, config, {
  env = process.env,
  readFile: read = readFile,
  registry = { resolveMcpLaunch },
  which,
} = {}) {
  const repoPath = project?.repo?.path;
  if (typeof repoPath !== "string" || !repoPath) throw new ClawError("PROJECT_PATH_MISSING");
  const serverName = config?.mcp?.serverName ?? DEFAULT_SERVER_NAME;
  const resolveLaunch = registry?.resolveMcpLaunch ?? resolveMcpLaunch;
  const launch = await resolveLaunch(repoPath, serverName, { env, readFile: read, ...(which ? { which } : {}) });
  if (!launch.ok) throw new ClawError(launch.code, { hint: launch.hint });

  const extras = await readServerExtras(repoPath, serverName, env, read);
  const command = launch.command === "node" ? process.execPath : launch.command;
  return {
    command,
    args: launchArguments(launch.args, repoPath),
    cwd: extras.cwd,
    env: {
      ...env,
      ...extras.env,
      PFORGE_TOOL_PROFILE: config?.mcp?.toolProfile ?? "full",
    },
  };
}

/** Canonical stdio belongs to local homes or the explicitly composed authenticated home worker. */
export async function buildLaunch(project, config, options = {}) {
  const home = configuredHome(project, config);
  if (home.kind !== "local" && options.currentLaneId !== home.id) throw new ClawError("HOME_LANE_REMOTE");
  return localLaunch(project, config, options);
}

/** Executing jobs explicitly launch their isolated workspace, not the canonical home. */
export async function buildWorktreeLaunch({ project, config, cwd, env, registry, ...options }) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) throw new ClawError("PROJECT_PATH_MISSING");
  return localLaunch({ ...project, repo: { ...project.repo, path: cwd } }, config, { env, registry, ...options });
}

function appendStderr(ring, chunk) {
  const next = Buffer.concat([ring, Buffer.from(chunk)]);
  return next.length > STDERR_LIMIT_BYTES ? next.subarray(next.length - STDERR_LIMIT_BYTES) : next;
}

export async function connectProject(launch, {
  ClientClass = Client,
  TransportClass = StdioClientTransport,
  redact = (value) => value,
  onClose = () => {},
} = {}) {
  const transport = new TransportClass({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    env: launch.env,
    stderr: "pipe",
  });
  let stderrRing = Buffer.alloc(0);
  transport.stderr?.on("data", (chunk) => { stderrRing = appendStderr(stderrRing, chunk); });

  let closed = false;
  transport.onclose = () => {
    closed = true;
    onClose();
  };
  const client = new ClientClass({ name: "pforge-claw", version: "1.0.0" });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close?.();
    throw error;
  }
  return {
    async call(tool, args, { signal } = {}) {
      signal?.throwIfAborted();
      if (closed) throw new ClawError("MCP_TRANSPORT_CLOSED");
      let result;
      try {
        result = await client.callTool({ name: tool, arguments: args }, undefined, { signal });
      } catch (error) {
        if (closed) throw new ClawError("MCP_TRANSPORT_CLOSED");
        throw error;
      }
      signal?.throwIfAborted();
      const text = result?.content?.find((item) => item?.type === "text")?.text ?? "";
      if (result?.isError) {
        throw new ClawError("MCP_TOOL_ERROR", {
          tool,
          text: redact(String(text)).slice(0, 500),
        });
      }
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    },
    close: () => client.close(),
  };
}

function createEntry(projectId) {
  return { projectId, promise: null, client: null, inFlight: 0, timer: null, closeRequested: false, drain: [] };
}

function resolveDrain(entry) {
  for (const resolve of entry.drain.splice(0)) resolve();
}

export function createProjectClients({
  config,
  registry,
  connect = connectProject,
  resolveLaunch = buildLaunch,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger,
  directory,
  env = process.env,
  secrets,
  currentLaneId = null,
} = {}) {
  const entries = new Map();
  const workspaceClients = new Set();
  const baseEnv = { ...env };
  // Set by closeAll(): a shutting-down client set must never spawn a new project MCP process.
  let closed = false;

  function drop(key, entry) {
    if (entries.get(key) !== entry) return;
    clearTimer(entry.timer);
    entries.delete(key);
  }

  function projectFor(projectId) {
    if (closed) throw new ClawError("MCP_TRANSPORT_CLOSED");
    const project = registry?.byId?.(projectId);
    if (!project) throw new ClawError("PROJECT_NOT_FOUND");
    return project;
  }

  function needsRemoteRead(project) {
    const home = configuredHome(project, config);
    return home.kind === "remote" && home.id !== currentLaneId;
  }

  async function resolveHomePlan(projectId, args, options) {
    options.signal?.throwIfAborted();
    const request = parsePlanResolveRequest(args);
    const project = config.projects?.find((entry) => entry.id === projectId);
    if (!project) throw new ClawError("PROJECT_NOT_FOUND");
    const home = configuredHome(project, config);
    if (home.enabled === false) throw new ClawError("HOME_LANE_UNAVAILABLE");
    if (needsRemoteRead(project)) return remoteClient(project).call(HOME_PLAN_RESOLVE_TOOL, request, options);
    const resolved = await resolvePlan({
      root: project.repo?.path, input: request.input, exact: request.exact, limit: request.limit, signal: options.signal,
    });
    options.signal?.throwIfAborted();
    if (closed) throw new ClawError("MCP_TRANSPORT_CLOSED");
    return resolved;
  }

  function entryKey(projectId, preparedEnv) {
    const serialized = JSON.stringify(Object.entries(preparedEnv).sort(([left], [right]) => left.localeCompare(right)));
    return `${projectId}\0${createHash("sha256").update(serialized).digest("hex")}`;
  }

  function ensureEntry(projectId, options = {}) {
    const project = projectFor(projectId);
    if (needsRemoteRead(project)) throw new ClawError("HOME_LANE_REMOTE");
    const preparedEnv = prepareJobEnvironment({
      project, config, secrets, env: options.env ?? baseEnv, signal: options.signal,
    });
    const key = entryKey(projectId, preparedEnv);
    const existing = entries.get(key);
    if (existing) {
      if (existing.client && existing.closeRequested) throw new ClawError("MCP_TRANSPORT_CLOSED");
      return existing;
    }
    const entry = createEntry(projectId);
    entry.key = key;
    entries.set(key, entry);
    entry.promise = (async () => {
      const launch = await resolveLaunch(project, config, { registry, env: preparedEnv, currentLaneId });
      const client = await connect(launch, { redact: secrets?.redact, onClose: () => drop(key, entry) });
      if (entries.get(key) !== entry) {
        await client.close?.();
        throw new ClawError("MCP_TRANSPORT_CLOSED");
      }
      entry.client = client;
      return client;
    })().catch((error) => {
      drop(key, entry);
      throw error;
    });
    return entry;
  }

  function remoteClient(project) {
    const home = configuredHome(project, config);
    return {
      call(tool, args = {}, options = {}) {
        if (closed) throw new ClawError("MCP_TRANSPORT_CLOSED");
        options.signal?.throwIfAborted();
        const lane = directory?.get?.(home.id);
        if (!lane || lane.kind !== "remote" || typeof lane.read !== "function" || home.enabled === false) {
          throw new ClawError("HOME_LANE_UNAVAILABLE");
        }
        return lane.read({ projectId: project.id, tool, args }, options);
      },
      close: async () => {},
    };
  }

  async function get(projectId, options) {
    const project = projectFor(projectId);
    return needsRemoteRead(project)
      ? remoteClient(project) : ensureEntry(projectId, options).promise;
  }

  async function closeEntry(projectId, entry) {
    clearTimer(entry.timer);
    entry.closeRequested = true;
    if (entry.inFlight > 0) {
      await new Promise((resolve) => entry.drain.push(resolve));
    }
    if (entries.get(entry.key) !== entry) return;
    drop(entry.key, entry);
    const client = entry.client ?? await entry.promise.catch((error) => {
      logger?.warn?.("Project MCP client closed before connection completed", { projectId, code: error?.code ?? "MCP_CONNECT_FAILED" });
      return null;
    });
    await client?.close?.();
  }

  async function close(projectId) {
    await Promise.all([...entries.values()].filter((entry) => entry.projectId === projectId)
      .map((entry) => closeEntry(projectId, entry)));
  }

  async function closeAll() {
    closed = true;
    await Promise.all([
      ...[...entries.values()].map((entry) => closeEntry(entry.projectId, entry)),
      ...[...workspaceClients].map((client) => client.close()),
    ]);
  }

  function scheduleIdleClose(entry) {
    const idleMinutes = config?.mcp?.idleMinutes ?? DEFAULT_IDLE_MINUTES;
    entry.timer = setTimer(() => {
      void closeEntry(entry.projectId, entry).catch((error) => logger?.error?.("Project MCP idle close failed", {
        projectId: entry.projectId, code: error?.code ?? "MCP_CLOSE_FAILED",
      }));
    }, idleMinutes * 60_000);
    entry.timer?.unref?.();
  }

  async function call(projectId, tool, args = {}, options = {}) {
    const project = projectFor(projectId);
    if (tool === HOME_PLAN_RESOLVE_TOOL) return resolveHomePlan(projectId, args, options);
    if (needsRemoteRead(project)) return remoteClient(project).call(tool, args, options);
    const entry = ensureEntry(projectId, options);
    entry.inFlight += 1;
    clearTimer(entry.timer);
    try {
      const client = await entry.promise;
      if (entries.get(entry.key) !== entry || entry.client !== client) {
        throw new ClawError("MCP_TRANSPORT_CLOSED");
      }
      return await client.call(tool, args, options);
    } finally {
      entry.inFlight -= 1;
      if (entry.inFlight === 0) {
        resolveDrain(entry);
        if (entry.closeRequested) await closeEntry(projectId, entry);
        else if (entries.get(entry.key) === entry) scheduleIdleClose(entry);
      }
    }
  }

  async function forWorktree({ projectId, cwd, env: preparedEnv, signal }) {
    const project = projectFor(projectId);
    signal?.throwIfAborted();
    const launch = await buildWorktreeLaunch({ project, config, cwd, env: preparedEnv, registry });
    signal?.throwIfAborted();
    const client = await connect(launch, { redact: secrets?.redact });
    let closePromise;
    const owned = {
      ...client, launch,
      close() {
        closePromise ??= Promise.resolve().then(() => client.close?.()).finally(() => workspaceClients.delete(owned));
        return closePromise;
      },
    };
    workspaceClients.add(owned);
    if (closed || signal?.aborted) {
      await owned.close();
      throw new ClawError(closed ? "MCP_TRANSPORT_CLOSED" : "JOB_CANCELLED");
    }
    return owned;
  }

  return { get, call, close, closeAll, forWorktree };
}

export function isMasterStub(result) {
  return result?.error === "pforge-master not installed";
}

export async function probeForgeMaster(clients, projectId) {
  try {
    const result = await clients.call(projectId, "forge_master_ask", { message: "Reply with a short readiness check." });
    if (isMasterStub(result)) return { ok: false, code: "FORGE_MASTER_STUB" };
    if (result?.error) return { ok: false, code: result.error };
    return { ok: true, code: "FORGE_MASTER_OK" };
  } catch (error) {
    return { ok: false, code: error?.code ?? "MCP_TOOL_ERROR" };
  }
}
