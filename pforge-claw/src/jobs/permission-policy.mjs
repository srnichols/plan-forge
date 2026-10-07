import path from "node:path";
import { READ_TYPES } from "./model.mjs";
import { isInside, realpathNearest } from "./worktree.mjs";

export const POLICY_KINDS = Object.freeze(["read", "write", "shell", "url", "fetch", "mcp"]);
const SAFE_COMMANDS = new Set(["git", "node", "npm", "npx", "pforge"]);
const NETWORK_COMMANDS = new Set(["curl", "wget", "invoke-webrequest", "ssh", "scp"]);
const SHELL_META = /[;&|`$()<>\n\r]/;

function denied(reason = "permission denied by job policy") {
  return { kind: "denied-by-rules", reason };
}

function tokenize(command) {
  if (typeof command !== "string" || !command.trim() || SHELL_META.test(command)) return null;
  let quote = null;
  for (const character of command) {
    if (quote === character) quote = null;
    else if (!quote && (character === "'" || character === "\"")) quote = character;
  }
  if (quote) return null;
  const tokens = [];
  const tokenPattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match;
  while ((match = tokenPattern.exec(command)) !== null) {
    const token = match[1] ?? match[2] ?? match[3];
    if (/[;&|`$()<>\n\r]/.test(token)) return null;
    tokens.push(token);
  }
  return tokens;
}

function prefixMatches(argv, prefixes) {
  return prefixes.some((prefix) => Array.isArray(prefix) && prefix.length > 0
    && prefix.every((token, index) => argv[index] === token)
    && argv.length >= prefix.length);
}

function hasNoPath(command) {
  return path.basename(command) === command && !command.includes("/") && !command.includes("\\")
    && !/^[A-Za-z]:/.test(command);
}

async function allowWrite({ worktree, request }) {
  if (typeof request.fileName !== "string" || !request.fileName) return false;
  try {
    const target = await realpathNearest(path.resolve(worktree, request.fileName));
    return await isInside(worktree, target);
  } catch {
    return false;
  }
}

function allowShell({ request, project }) {
  const argv = Array.isArray(request.argv) && request.argv.every((arg) => typeof arg === "string")
    ? request.argv
    : tokenize(request.command);
  if (!argv?.length || argv.some((arg) => SHELL_META.test(arg))) return false;
  const executable = argv[0];
  const basename = path.basename(executable).toLowerCase();
  if (NETWORK_COMMANDS.has(basename)) return false;
  return (hasNoPath(executable) && SAFE_COMMANDS.has(basename))
    || prefixMatches(argv, project?.testCommands ?? []);
}

/**
 * This callback is a permission policy, not an OS sandbox. Allowing node, npm,
 * or npx permits indirect execution; this is accepted residual risk for Slice 26.
 */
export function policyFor(job, { worktree, project, readOnly = job?.readOnly } = {}) {
  return async (request = {}) => {
    if (job?.type === "plan") return denied("plan jobs run via pforge run-plan (D10)");
    if (job?.type === "fanout" || !["ask", "capture", "skill", "task"].includes(job?.type)) {
      return denied("job type is not permitted to request tools");
    }
    const isReadJob = READ_TYPES.includes(job.type) || (job.type === "skill" && readOnly === true);
    if (isReadJob) return ["read", "mcp"].includes(request.kind)
      ? { kind: "approved" }
      : denied();
    if (request.kind === "read") return { kind: "approved" };
    if (request.kind === "write") {
      return await allowWrite({ worktree, request }) ? { kind: "approved" } : denied();
    }
    if (request.kind === "shell") {
      return allowShell({ request, project }) ? { kind: "approved" } : denied();
    }
    if (request.kind === "mcp") {
      return request.serverName === "plan-forge" ? { kind: "approved" } : denied();
    }
    if (request.kind === "url" || request.kind === "fetch") return denied();
    return denied("unknown permission kind");
  };
}
