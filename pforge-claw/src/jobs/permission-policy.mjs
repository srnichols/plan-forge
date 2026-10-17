import path from "node:path";
import { READ_TYPES } from "./model.mjs";
import { isInside, realpathNearest } from "./worktree.mjs";

export const POLICY_KINDS = Object.freeze(["read", "write", "shell", "url", "fetch", "mcp"]);
const SAFE_COMMANDS = new Set(["git", "node", "npm", "npx", "pforge"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "invoke-webrequest", "ssh", "scp"]);
const SHELL_META = /[;&|`$()<>\n\r\0%^!]/;

function denied(reason = "permission denied by job policy") {
  return { kind: "denied-by-rules", reason };
}

function tokenize(command) {
  if (typeof command !== "string" || !command.trim() || SHELL_META.test(command)) return null;
  const tokens = [];
  let quote = null;
  let token = "";
  let hasToken = false;
  for (const character of command) {
    if (quote) {
      if (quote === character) quote = null;
      else token += character;
    } else if (character === "'" || character === "\"") {
      quote = character;
      hasToken = true;
    } else if (/\s/.test(character)) {
      if (hasToken) tokens.push(token);
      token = "";
      hasToken = false;
    } else {
      token += character;
      hasToken = true;
    }
  }
  if (quote) return null;
  if (hasToken) tokens.push(token);
  return tokens;
}

function prefixMatches(argv, prefixes) {
  return Array.isArray(prefixes) && prefixes.some((prefix) => Array.isArray(prefix) && prefix.length > 0
    && prefix.every((token, index) => argv[index] === token)
    && argv.length >= prefix.length);
}

function hasNoPath(command) {
  return path.basename(command) === command && !command.includes("/") && !command.includes("\\")
    && !/^[A-Za-z]:/.test(command);
}

async function pathsInside(worktree, paths) {
  if (typeof worktree !== "string" || !worktree) return false;
  try {
    for (const requestedPath of paths) {
      if (typeof requestedPath !== "string" || !requestedPath || requestedPath.startsWith("~")) return false;
      if (process.platform !== "win32" && path.win32.isAbsolute(requestedPath)
        && !path.posix.isAbsolute(requestedPath)) return false;
      const target = await realpathNearest(path.resolve(worktree, requestedPath));
      if (!(await isInside(worktree, target))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function allowFile({ worktree, request, field }) {
  const paths = [request[field]];
  if (request.resolvedPath !== undefined) paths.push(request.resolvedPath);
  return pathsInside(worktree, paths);
}

function shellArgv(request) {
  // The SDK's complete text is authoritative; legacy fields must not bypass it.
  if (request.fullCommandText !== undefined) return tokenize(request.fullCommandText);
  if (Array.isArray(request.argv) && request.argv.every((arg) => typeof arg === "string")) return request.argv;
  return tokenize(request.command);
}

function argumentPath(argument) {
  let value = argument.includes("=")
    ? argument.slice(argument.indexOf("=") + 1)
    : argument;
  if (value.startsWith("-") && (value.includes("/") || value.includes("\\"))) {
    const attachedPath = /^-[A-Za-z](\.\.?[\\/].*|[\\/].*|[A-Za-z]:.*)$/.exec(value);
    if (!attachedPath) return false;
    value = attachedPath[1];
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return null;
  if (value.includes("/") || value.includes("\\") || /^[A-Za-z]:/.test(value)
    || value === "." || value === ".." || value.startsWith("~")) return value;
  return null;
}

async function shellPathsInside({ request, argv, worktree }) {
  if (request.possiblePaths !== undefined && !Array.isArray(request.possiblePaths)) return false;
  const paths = [...(request.possiblePaths ?? [])];
  for (const argument of argv) {
    const requestedPath = argumentPath(argument);
    if (requestedPath === false) return false;
    if (requestedPath !== null) paths.push(requestedPath);
  }
  for (const requestedPath of request.possiblePaths ?? []) {
    const resolved = request.resolvedPaths?.[requestedPath];
    if (resolved !== undefined) paths.push(resolved);
  }
  if (request.resolvedWorkingDirectory !== undefined) paths.push(request.resolvedWorkingDirectory);
  return pathsInside(worktree, paths);
}

async function allowShell({ request, project, worktree }) {
  const argv = shellArgv(request);
  if (!argv?.length || argv.some((arg) => SHELL_META.test(arg))) return false;
  if (request.hasWriteFileRedirection) return false;
  const executable = argv[0];
  const basename = path.basename(executable).toLowerCase();
  if (NETWORK_COMMANDS.has(basename)) return false;
  const isAllowedCommand = (hasNoPath(executable) && SAFE_COMMANDS.has(basename))
    || prefixMatches(argv, project?.testCommands ?? []);
  return isAllowedCommand && await shellPathsInside({ request, argv, worktree });
}

function requiresExplicitApproval(request) {
  return request.managedApprovalRequired || request.requestSandboxBypass || request.requestSandboxPermissive;
}

async function allowsMutatingPermission({ request, project, worktree }) {
  if (request.kind === "read") return allowFile({ worktree, request, field: "path" });
  if (request.kind === "write") return allowFile({ worktree, request, field: "fileName" });
  if (request.kind === "shell") return allowShell({ request, project, worktree });
  return request.kind === "mcp" && request.serverName === "plan-forge";
}

/**
 * This callback is a permission policy, not an OS sandbox. Allowing node, npm,
 * or npx permits indirect execution; this is accepted residual risk for Slice 26.
 */
export function policyFor(job, { worktree, project, readOnly = job?.readOnly } = {}) {
  return async (request = {}) => {
    if (!request || requiresExplicitApproval(request)) return denied();
    if (job?.type === "plan") return denied("plan jobs run via pforge run-plan (D10)");
    if (job?.type === "fanout" || !["ask", "capture", "skill", "task"].includes(job?.type)) {
      return denied("job type is not permitted to request tools");
    }
    const isReadJob = READ_TYPES.includes(job.type) || (job.type === "skill" && readOnly === true);
    if (isReadJob) {
      if (request.kind === "mcp") return { kind: "approved" };
      if (request.kind !== "read") return denied();
      return await allowFile({ worktree: worktree ?? project?.repo?.path, request, field: "path" })
        ? { kind: "approved" } : denied();
    }
    return await allowsMutatingPermission({ request, project, worktree }) ? { kind: "approved" } : denied();
  };
}
