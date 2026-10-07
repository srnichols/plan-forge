import { execFile } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ClawError } from "./errors.mjs";

const execFileAsync = promisify(execFile);
const NO_TOPIC = "__general__";

export function normalizeRepoPath(repoPath, platform = process.platform) {
  const implementation = platform === "win32" ? path.win32 : path.posix;
  let normalized = implementation.resolve(repoPath);
  const root = implementation.parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith(implementation.sep)) {
    normalized = normalized.slice(0, -1);
  }
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function samePath(left, right, platform = process.platform) {
  return normalizeRepoPath(left, platform) === normalizeRepoPath(right, platform);
}

function routeKey(chatId, topicId) {
  if (chatId === undefined || chatId === null) return null;
  return JSON.stringify([String(chatId), topicId === undefined || topicId === null ? NO_TOPIC : `id:${String(topicId)}`]);
}

export function createRegistry(config, { platform = process.platform } = {}) {
  const projects = config.projects ?? [];
  const byIdMap = new Map();
  const byRouteMap = new Map();
  const byPathMap = new Map();
  for (const project of projects) {
    if (byIdMap.has(project.id)) throw new ClawError("DUPLICATE_PROJECT_ID");
    byIdMap.set(project.id, project);
    const route = routeKey(project.channel?.chatId, project.channel?.topicId);
    if (route !== null) {
      if (byRouteMap.has(route)) throw new ClawError("CHANNEL_ROUTE_COLLISION");
      byRouteMap.set(route, project);
    }
    if (project.repo?.path) byPathMap.set(normalizeRepoPath(project.repo.path, platform), project);
  }
  return {
    byId: (id) => byIdMap.get(id),
    byChat: (chatId, topicId) => byRouteMap.get(routeKey(chatId, topicId)),
    byPath: (repoPath) => byPathMap.get(normalizeRepoPath(repoPath, platform)),
    all: () => [...projects],
  };
}

export async function isGitRepo(directory, { runGit } = {}) {
  const execute = runGit ?? (async (command, args, options) => execFileAsync(command, args, options));
  try {
    const result = await execute("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], {
      timeout: 5000,
      windowsHide: true,
    });
    return String(result.stdout ?? result).trim() === "true";
  } catch {
    return false;
  }
}

export async function validateProjects(config, { isGitRepo: checkGit = isGitRepo, platform = process.platform, stat: statPath } = {}) {
  const lanes = new Map((config.lanes ?? []).map((lane) => [lane.id, lane]));
  const inspectStat = statPath ?? stat;
  const results = [];
  for (const project of config.projects ?? []) {
    const homeLane = lanes.get(project.homeLane);
    if (homeLane?.kind !== "local") {
      results.push({
        projectId: project.id,
        status: "skip",
        code: "REMOTE_HOME_UNVERIFIED",
        message: "Project path is on a non-local home lane and was not checked on this dispatcher.",
        hint: "Run doctor on the project's home lane.",
      });
      continue;
    }
    try {
      const metadata = await inspectStat(project.repo.path);
      if (!metadata.isDirectory()) {
        results.push({ projectId: project.id, status: "fail", code: "PROJECT_PATH_MISSING", message: "Project path is not a directory.", hint: "Check repo.path." });
        continue;
      }
    } catch (error) {
      results.push({
        projectId: project.id,
        status: "fail",
        code: error.code === "ENOENT" ? "PROJECT_PATH_MISSING" : "PROJECT_PATH_UNVERIFIED",
        message: "Project path could not be checked.",
        hint: "Check repo.path and filesystem permissions.",
      });
      continue;
    }
    if (!(await checkGit(project.repo.path, { platform }))) {
      results.push({ projectId: project.id, status: "fail", code: "PROJECT_NOT_GIT", message: "Project path is not a git working tree.", hint: "Use a git checkout for repo.path." });
      continue;
    }
    results.push({ projectId: project.id, status: "ok", code: "PROJECT_PATH_OK", message: "Project path is a git working tree.", hint: "" });
  }
  return results;
}

async function commandExists(command, env, platform) {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    try {
      await access(command);
      return true;
    } catch {
      return false;
    }
  }
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      try {
        await access(path.join(directory, platform === "win32" ? `${command}${extension}` : command));
        return true;
      } catch {
        continue;
      }
    }
  }
  return false;
}

function expandLaunchValue(value, repoPath, env) {
  let unresolved = false;
  const expanded = value.replace(/\$\{(workspaceFolder|env:([A-Za-z_][A-Za-z0-9_]*))\}/g, (_match, token, envName) => {
    if (token === "workspaceFolder") return repoPath;
    if (!Object.hasOwn(env, envName) || env[envName] === undefined) {
      unresolved = true;
      return "";
    }
    return String(env[envName]);
  });
  if (/\$\{[^}]+\}/.test(expanded)) unresolved = true;
  return { expanded, unresolved };
}

export async function resolveMcpLaunch(repoPath, serverName, { env = process.env, readFile: read = readFile, which } = {}) {
  let config;
  try {
    config = JSON.parse(await read(path.join(repoPath, ".vscode", "mcp.json"), "utf8"));
  } catch (error) {
    const missing = error.code === "ENOENT";
    return { ok: false, code: missing ? "MCP_CONFIG_MISSING" : "MCP_CONFIG_PARSE", hint: "Check .vscode/mcp.json in the project checkout." };
  }
  const servers = config?.servers ?? config?.mcpServers;
  const server = servers?.[serverName];
  if (!server || typeof server.command !== "string") {
    return { ok: false, code: "MCP_SERVER_MISSING", hint: "Check the configured MCP server name." };
  }
  const commandValue = expandLaunchValue(server.command, repoPath, env);
  const args = [];
  for (const value of server.args ?? []) {
    if (typeof value !== "string") return { ok: false, code: "MCP_CONFIG_PARSE", hint: "MCP command arguments must be strings." };
    const expanded = expandLaunchValue(value, repoPath, env);
    if (expanded.unresolved) return { ok: false, code: "MCP_UNRESOLVED_VAR", hint: "Set the missing MCP environment variable." };
    args.push(expanded.expanded);
  }
  if (commandValue.unresolved) return { ok: false, code: "MCP_UNRESOLVED_VAR", hint: "Set the missing MCP environment variable." };
  const exists = which
    ? await which(commandValue.expanded, { env, platform: process.platform })
    : await commandExists(commandValue.expanded, env, process.platform);
  if (!exists) return { ok: false, code: "MCP_COMMAND_NOT_FOUND", hint: "Install the MCP command or correct its configuration." };
  return { ok: true, command: commandValue.expanded, args, cwd: repoPath };
}
