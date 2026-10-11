import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClawError } from "../errors.mjs";
import { assertInside } from "../path-safety.mjs";
import { TOKEN_SHAPES } from "../secrets.mjs";

/**
 * @typedef {object} McpBootstrap
 * @property {1} v
 * @property {string} serverName
 * @property {string} command
 * @property {string[]} args
 * @property {string} cwd
 * @property {Record<string, string>} env Literal safe settings or unresolved executing-lane references.
 * @property {string} toolProfile
 */

export const HOME_MCP_BOOTSTRAP_TOOL = "claw.bootstrap.mcp";
export const MCP_BOOTSTRAP_MAX_BYTES = 10_240;
export const MCP_BOOTSTRAP_FILE = path.join(".forge", "claw-mcp-bootstrap.json");
const MCP_CONFIG_MAX_BYTES = 65_536;
const MAX_ARGUMENTS = 64;
const MAX_ENVIRONMENT_NAMES = 64;
const MAX_VALUE_LENGTH = 1024;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONFIG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ENV_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;
const WORKSPACE = "${workspaceFolder}";
const SECRET_NAME = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTHORIZATION|COOKIE)(?:_|$)/i;
const SECRET_OPTION = /(?:^|-)(?:api-key|key|token|secret|password|credential|authorization|auth)(?:=|$)/i;
const SECRET_REFERENCE = /^(?:Bearer )?\$\{env:[A-Za-z_][A-Za-z0-9_]*\}$/;
const FLAG_VALUE = /^(--?[A-Za-z][A-Za-z0-9_-]*=)(.*)$/;
const DESCRIPTOR_FIELDS = Object.freeze(["v", "serverName", "command", "args", "cwd", "env", "toolProfile"]);
const RUNTIME_PACKAGES = Object.freeze(["pforge-mcp", "pforge-master"]);
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function invalid(code = "MCP_BOOTSTRAP_INVALID") {
  throw new ClawError(code);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && !value) || value.length > MAX_VALUE_LENGTH || CONTROL.test(value)) invalid();
  return value;
}

function references(value) {
  return [...value.matchAll(ENV_REFERENCE)].map((match) => match[1]);
}

function template(value) {
  const remainder = value.replaceAll(WORKSPACE, "").replace(ENV_REFERENCE, "");
  if (/\$\{[^}]*\}/.test(remainder)) invalid("MCP_UNRESOLVED_VAR");
  return references(value).length > 0 || value.includes(WORKSPACE);
}

function credentialLiteral(value) {
  return TOKEN_SHAPES.some(([, pattern]) => new RegExp(pattern.source, "i").test(value));
}

function credentialUrl(value) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  let url;
  try {
    url = new URL(value.replace(ENV_REFERENCE, "claw-reference"));
  } catch {
    invalid();
  }
  if (url.username || url.password) return true;
  return [...url.searchParams.keys()].some((key) => SECRET_NAME.test(optionName(key).replaceAll("-", "_")));
}

function relativePath(value) {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (parts.includes("..") || parts.some((part) => [".env", "secrets.json"].includes(part.toLowerCase()))) {
    invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  }
  return parts.filter((part) => part && part !== ".").join("/");
}

function absolute(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-z]:/i.test(value);
}

function workspacePath(value, root) {
  if (!root || !path.isAbsolute(value)) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  const relative = path.relative(root, value);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || absolute(relative)) {
    invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  }
  const normalized = relativePath(relative);
  return normalized ? `${WORKSPACE}/${normalized}` : WORKSPACE;
}

function templateValue(value) {
  relativePath(value);
  if (value.includes(WORKSPACE) && value !== WORKSPACE && !value.startsWith(`${WORKSPACE}/`)) {
    invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  }
  if (absolute(value)) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  return value.replaceAll("\\", "/");
}

function relativeValue(value) {
  const relative = relativePath(value);
  const runtimeEntry = RUNTIME_PACKAGES.includes(relative.split("/")[0]) && /\.(?:mjs|cjs|js)$/i.test(value);
  return value.startsWith("./") || value.startsWith(".\\") || runtimeEntry
    ? `${WORKSPACE}/${relative}` : value;
}

function executableValue(value, root) {
  if (value === process.execPath) return "node";
  if (CONFIG_NAME.test(value)) return value;
  if (absolute(value)) return workspacePath(value, root);
  if (!value.includes("/") && !value.includes("\\")) invalid();
  return `${WORKSPACE}/${relativePath(value)}`;
}

function workspaceCwd(input, root) {
  const value = string(input, { empty: true });
  if (!value || value === ".") return WORKSPACE;
  if (template(value) || absolute(value)) return safeValue(value, root);
  const relative = relativePath(value);
  return relative ? `${WORKSPACE}/${relative}` : WORKSPACE;
}

function safeValue(input, root, { command = false } = {}) {
  const value = string(input);
  if (credentialLiteral(value)) invalid("MCP_BOOTSTRAP_CREDENTIAL_REFUSED");
  const flag = FLAG_VALUE.exec(value);
  if (flag) return flag[1] + safeValue(flag[2], root);
  if (credentialUrl(value)) invalid("MCP_BOOTSTRAP_CREDENTIAL_REFUSED");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (template(value)) return templateValue(value);
  if (command) return executableValue(value, root);
  if (absolute(value)) return workspacePath(value, root);
  return relativeValue(value);
}

function optionName(value) {
  return value.replace(/^-+/, "").replace(/([a-z])([A-Z])/g, "$1-$2").replaceAll("_", "-").toLowerCase();
}

function safeArguments(args, root) {
  if (!Array.isArray(args) || args.length > MAX_ARGUMENTS) invalid();
  return args.map((value, index) => {
    string(value);
    if (SECRET_OPTION.test(optionName(value))) {
      const reference = value.includes("=") ? value.slice(value.indexOf("=") + 1) : args[index + 1];
      if (typeof reference !== "string" || !SECRET_REFERENCE.test(reference)) invalid("MCP_BOOTSTRAP_CREDENTIAL_REFUSED");
    }
    return safeValue(value, root);
  });
}

function safeLiteralEnvironment(name, value) {
  if (credentialLiteral(value) || credentialUrl(value)) invalid("MCP_BOOTSTRAP_CREDENTIAL_REFUSED");
  if (/^(?:true|false|-?\d+(?:\.\d+)?)$/.test(value)) return value;
  if (/(?:^|_)(?:MODEL|PROVIDER)$/i.test(name) && !absolute(value)) return value;
  if (/(?:^|_)TOOL_PROFILE$/i.test(name) && CONFIG_NAME.test(value)) return value;
  if (/(?:^|_)(?:URL|ENDPOINT)$/i.test(name) && /^https?:\/\//i.test(value) && !credentialUrl(value)) return value;
  invalid("MCP_BOOTSTRAP_ENV_REFUSED");
}

function validateChoiceEnvironment(name, value) {
  if (/(?:^|_)(?:MODEL|PROVIDER)$/i.test(name) && absolute(value)) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
}

function safeEnvironment(env, root, { collected = false } = {}) {
  if (!object(env) || Object.keys(env).length > MAX_ENVIRONMENT_NAMES) invalid();
  return Object.fromEntries(Object.entries(env).map(([name, input]) => {
    if (!NAME.test(name)) invalid();
    const value = string(input, { empty: true });
    if (value === "") return [name, ""];
    validateChoiceEnvironment(name, value);
    if (SECRET_NAME.test(name) && !template(value)) {
      if (!collected) invalid("MCP_BOOTSTRAP_CREDENTIAL_REFUSED");
      return [name, `\${env:${name}}`];
    }
    if (SECRET_NAME.test(name) && !SECRET_REFERENCE.test(value)) invalid("MCP_BOOTSTRAP_CREDENTIAL_REFUSED");
    if (template(value) || absolute(value)) return [name, safeValue(value, root)];
    return [name, safeLiteralEnvironment(name, value)];
  }));
}

function boundDescriptor(descriptor) {
  if (Buffer.byteLength(JSON.stringify(descriptor)) > MCP_BOOTSTRAP_MAX_BYTES) invalid("MCP_BOOTSTRAP_TOO_LARGE");
  return descriptor;
}

/**
 * Parse the exact secret-free signed/bootstrap DTO; never repair untrusted wire input.
 * @param {unknown} input
 * @returns {McpBootstrap}
 */
export function parseMcpBootstrap(input) {
  if (!object(input) || DESCRIPTOR_FIELDS.some((field) => !Object.hasOwn(input, field))
    || Object.keys(input).some((field) => !DESCRIPTOR_FIELDS.includes(field)) || input.v !== 1) invalid();
  if (!CONFIG_NAME.test(string(input.serverName)) || !CONFIG_NAME.test(string(input.toolProfile))) invalid();
  const descriptor = {
    v: 1, serverName: input.serverName, command: safeValue(input.command, undefined, { command: true }),
    args: safeArguments(input.args), cwd: safeValue(input.cwd), env: safeEnvironment(input.env),
    toolProfile: input.toolProfile,
  };
  if (descriptor.cwd !== WORKSPACE && !descriptor.cwd.startsWith(`${WORKSPACE}/`)) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  if (JSON.stringify(descriptor) !== JSON.stringify({
    v: input.v, serverName: input.serverName, command: input.command, args: input.args,
    cwd: input.cwd, env: input.env, toolProfile: input.toolProfile,
  })) invalid();
  return boundDescriptor(descriptor);
}

async function readBounded({ root, relative, limit, read = readFile, signal }) {
  signal?.throwIfAborted();
  if (typeof root !== "string" || !path.isAbsolute(root)) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  const file = path.join(root, relative);
  await assertInside(root, file, "MCP_BOOTSTRAP_PATH_REJECTED");
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  if (metadata.size > limit) invalid("MCP_BOOTSTRAP_TOO_LARGE");
  signal?.throwIfAborted();
  const contents = await read(file, "utf8");
  if (typeof contents !== "string" || Buffer.byteLength(contents) > limit) invalid("MCP_BOOTSTRAP_TOO_LARGE");
  signal?.throwIfAborted();
  return contents;
}

function configuredServer(config, serverName) {
  const servers = config?.servers ?? config?.mcpServers;
  const server = servers?.[serverName];
  if (!object(server) || typeof server.command !== "string") invalid("MCP_SERVER_MISSING");
  if (server.type !== undefined && server.type !== "stdio") invalid();
  return server;
}

async function readHomeServer({ repoPath, serverName, signal, read }) {
  let config;
  try {
    config = JSON.parse(await readBounded({
      root: repoPath, relative: path.join(".vscode", "mcp.json"), limit: MCP_CONFIG_MAX_BYTES, read, signal,
    }));
  } catch (error) {
    if (signal?.aborted || error instanceof ClawError) throw error;
    invalid(error.code === "ENOENT" ? "MCP_CONFIG_MISSING" : "MCP_CONFIG_PARSE");
  }
  return configuredServer(config, serverName);
}

/**
 * Read only the configured MCP server at a trusted registered home; resolve no secrets.
 * @param {{repoPath: string, serverName?: string, toolProfile?: string, signal?: AbortSignal, readFile?: Function}} options
 * @returns {Promise<McpBootstrap>}
 */
export async function collectMcpBootstrap({
  repoPath, serverName = "plan-forge", toolProfile = "full", signal, readFile: read = readFile,
}) {
  const server = await readHomeServer({ repoPath, serverName, signal, read });
  return parseMcpBootstrap({
    v: 1, serverName, command: safeValue(server.command, repoPath, { command: true }),
    args: safeArguments(server.args ?? [], repoPath),
    cwd: workspaceCwd(server.cwd ?? WORKSPACE, repoPath),
    env: safeEnvironment(server.env ?? {}, repoPath, { collected: true }), toolProfile,
  });
}

/** The internal registered-home read has no caller-selected paths, values or server. */
export function parseMcpBootstrapRequest(args) {
  if (!object(args) || Object.keys(args).length !== 0) invalid();
  return {};
}

/** Canonical reads use only configured local homes or authenticated remote homes. */
export function mcpHomeLane(project, config) {
  const lane = config?.lanes?.find((entry) => entry.id === project?.homeLane);
  if (!lane) invalid("HOME_LANE_UNKNOWN");
  if (lane.kind !== "local" && lane.kind !== "remote") invalid("HOME_LANE_INVALID");
  return lane;
}

/** Resolve canonical paths from configuration, never a caller/registry-supplied root. */
export function registeredMcpHome({ projectId, config }) {
  const project = config.projects?.find((entry) => entry.id === projectId);
  if (!project) invalid("PROJECT_NOT_FOUND");
  const home = mcpHomeLane(project, config);
  if (home.enabled === false) invalid("HOME_LANE_UNAVAILABLE");
  return { project, home };
}

async function readRemoteBootstrap({ lane, project, signal }) {
  if (lane?.kind !== "remote" || typeof lane.read !== "function") invalid("HOME_LANE_UNAVAILABLE");
  const descriptor = await lane.read({
    projectId: project.id, tool: HOME_MCP_BOOTSTRAP_TOOL, args: {},
  }, { signal });
  signal?.throwIfAborted();
  return parseMcpBootstrap(descriptor);
}

/**
 * Call after approval authorization; the coordinator signs this exact reference-only DTO.
 * @param {{project: object, config: object, directory?: object, signal?: AbortSignal}} options
 * @returns {Promise<McpBootstrap>}
 */
export async function collectLeaseMcpBootstrap({ project, config, directory, signal }) {
  signal?.throwIfAborted();
  const registered = registeredMcpHome({ projectId: project?.id, config });
  if (registered.home.kind === "remote") {
    return readRemoteBootstrap({
      lane: directory?.get?.(registered.home.id), project: registered.project, signal,
    });
  }
  const { serverName, toolProfile } = config.mcp ?? {};
  return collectMcpBootstrap({ repoPath: registered.project.repo.path, serverName, toolProfile, signal });
}

/** Load only the bounded job-owned descriptor; editor configuration is never copied. */
export async function readWorkspaceMcpBootstrap({ cwd, signal, readFile: read = readFile }) {
  try {
    const contents = await readBounded({ root: cwd, relative: MCP_BOOTSTRAP_FILE, limit: MCP_BOOTSTRAP_MAX_BYTES, read, signal });
    return parseMcpBootstrap(JSON.parse(contents));
  } catch (error) {
    if (signal?.aborted || error instanceof ClawError) throw error;
    if (error.code === "ENOENT") return null;
    invalid();
  }
}

async function writeWorkspaceDescriptor({ cwd, descriptor, signal }) {
  const file = path.join(cwd, MCP_BOOTSTRAP_FILE);
  await assertInside(cwd, file, "MCP_BOOTSTRAP_PATH_REJECTED");
  const existing = await lstat(file).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
  await mkdir(path.dirname(file), { recursive: true });
  await assertInside(cwd, file, "MCP_BOOTSTRAP_PATH_REJECTED");
  signal?.throwIfAborted();
  await writeFile(file, JSON.stringify(parseMcpBootstrap(descriptor)), { encoding: "utf8", mode: 0o600 });
  signal?.throwIfAborted();
}

async function inheritWorkspaceMcp({ project, config, sourceRoot, cwd, signal }) {
  const existing = await lstat(path.join(cwd, ".vscode", "mcp.json")).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing || !project?.repo?.path) return null;
  return collectMcpBootstrap({
    repoPath: sourceRoot, serverName: config?.mcp?.serverName, toolProfile: config?.mcp?.toolProfile, signal,
  });
}

/** Signed metadata is consumed only after the caller's existing lease-grant verification. */
export async function bootstrapWorkspaceMcp(options) {
  const { job, cwd, signal } = options;
  signal?.throwIfAborted();
  const signed = job?.mcpBootstrap;
  if (signed !== undefined && !job.leaseGrant) invalid("MCP_BOOTSTRAP_UNTRUSTED");
  const descriptor = signed !== undefined ? parseMcpBootstrap(signed) : await inheritWorkspaceMcp(options);
  if (descriptor !== null) await writeWorkspaceDescriptor({ cwd, descriptor, signal });
}

/** Expand the existing editor syntax without reading or serializing provider credentials. */
export function expandMcpTemplate(value, cwd, env) {
  let unresolved = false;
  const expanded = String(value).replace(/\$\{(workspaceFolder|env:([A-Za-z_][A-Za-z0-9_]*))\}/g, (_match, token, name) => {
    if (token === "workspaceFolder") return cwd;
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

function environmentReference(name, env, secrets) {
  try {
    return secrets?.get?.(name) ?? env[name];
  } catch {
    invalid("MCP_BOOTSTRAP_SECRET_FAILED");
  }
}

function resolveReferences(descriptor, env, secrets) {
  const prepared = { ...env };
  const values = [descriptor.command, ...descriptor.args, descriptor.cwd, ...Object.values(descriptor.env)];
  for (const name of new Set(values.flatMap(references))) {
    const value = environmentReference(name, env, secrets);
    if (typeof value !== "string" || !value) invalid("MCP_UNRESOLVED_VAR");
    prepared[name] = value;
  }
  return prepared;
}

/**
 * Prepare callback consumers from job-local references; the returned values stay in memory.
 * @param {{cwd: string, env?: object, secrets?: {get: Function}, signal?: AbortSignal}} options
 * @returns {Promise<object>}
 */
export async function prepareWorkspaceMcpEnvironment({ cwd, env = {}, secrets, signal }) {
  signal?.throwIfAborted();
  const descriptor = await readWorkspaceMcpBootstrap({ cwd, signal });
  return descriptor ? resolveReferences(descriptor, env, secrets) : { ...env };
}

function localRuntimeHome({ project, config, currentLaneId }) {
  const actual = config.projects?.find((entry) => entry.id === project.id) ?? project;
  const home = config.lanes?.find((lane) => lane.id === actual.homeLane);
  return home?.kind === "local" || (typeof currentLaneId === "string" && home?.id === currentLaneId)
    ? actual.repo?.path : null;
}

async function workspaceReference({ value, cwd, env, signal }) {
  const flag = FLAG_VALUE.exec(value);
  const input = flag ? flag[2] : value;
  if (input !== WORKSPACE && !input.startsWith(`${WORKSPACE}/`)) return null;
  signal?.throwIfAborted();
  const target = path.resolve(expandMcpTemplate(input, cwd, env));
  await assertInside(cwd, target, "MCP_BOOTSTRAP_PATH_REJECTED");
  return { target, prefix: flag ? flag[1] : "" };
}

async function runtimeArgument({ argument, cwd, roots, env, signal }) {
  const reference = await workspaceReference({ value: argument, cwd, env, signal });
  if (!reference) return argument;
  const { target, prefix } = reference;
  const relative = relativePath(path.relative(cwd, target));
  if (!RUNTIME_PACKAGES.includes(relative.split("/")[0])) return argument;
  if (await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  })) return argument;
  for (const root of roots.filter(Boolean)) {
    signal?.throwIfAborted();
    if (typeof root !== "string" || !path.isAbsolute(root)) invalid("MCP_BOOTSTRAP_PATH_REJECTED");
    const candidate = path.join(root, ...relative.split("/"));
    await assertInside(root, candidate, "MCP_BOOTSTRAP_PATH_REJECTED");
    const metadata = await lstat(candidate).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (metadata?.isFile() && !metadata.isSymbolicLink()) return prefix + await realpath(candidate);
  }
  invalid("MCP_BOOTSTRAP_RUNTIME_MISSING");
}

/** Materialize paths/credentials only in the executing process, retaining the approved launch. */
export async function workspaceMcpLaunchOptions({
  descriptor, cwd, project, config = {}, env = {}, secrets, currentLaneId = null, mcpRuntimeRoot, signal,
}) {
  signal?.throwIfAborted();
  const parsed = parseMcpBootstrap(descriptor);
  const prepared = resolveReferences(parsed, env, secrets);
  const runtimeRoot = mcpRuntimeRoot ?? (env.PFORGE_CLAW_PATH ? path.dirname(env.PFORGE_CLAW_PATH) : FRAMEWORK_ROOT);
  const roots = [localRuntimeHome({ project, config, currentLaneId }), runtimeRoot];
  const args = [];
  for (const argument of parsed.args) args.push(await runtimeArgument({ argument, cwd, roots, env: prepared, signal }));
  await workspaceReference({ value: parsed.cwd, cwd, env: prepared, signal });
  for (const value of Object.values(parsed.env)) await workspaceReference({ value, cwd, env: prepared, signal });
  const command = await runtimeArgument({ argument: parsed.command, cwd, roots, env: prepared, signal });
  signal?.throwIfAborted();
  const server = { command, args, cwd: parsed.cwd, env: { ...parsed.env, PLAN_FORGE_PROJECT: WORKSPACE } };
  return {
    config: { ...config, mcp: { ...config.mcp, serverName: parsed.serverName, toolProfile: parsed.toolProfile } },
    env: prepared,
    readFile: async (file) => {
      if (path.relative(path.join(cwd, ".vscode", "mcp.json"), path.resolve(file)) !== "") invalid("MCP_BOOTSTRAP_PATH_REJECTED");
      return JSON.stringify({ servers: { [parsed.serverName]: server } });
    },
  };
}
