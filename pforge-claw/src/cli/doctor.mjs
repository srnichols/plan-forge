import { access } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, requiredSecretNames, resolveHome, validateConfig } from "../config.mjs";
import { createSecrets, checkSecretsFilePermissions } from "../secrets.mjs";
import { isGitRepo, resolveMcpLaunch, validateProjects } from "../registry.mjs";

const MIN_NODE = [22, 12, 0];
const USAGE = "Usage: pforge claw doctor [--json] [--home <dir>]";

function parseVersion(version) {
  const parts = String(version).replace(/^v/, "").split(".").map((part) => Number.parseInt(part, 10));
  return parts.length >= 2 && parts.slice(0, 3).every(Number.isFinite) ? parts : [0, 0, 0];
}

function versionAtLeast(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

export async function whichOnPath(command, { env = process.env, platform = process.platform } = {}) {
  const pathValue = env.PATH ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const commandHasPath = pathApi.isAbsolute(command) || command.includes(pathApi.sep);
  const candidates = commandHasPath
    ? [command]
    : pathValue.split(delimiter).filter(Boolean).flatMap((directory) =>
      extensions.map((extension) => pathApi.join(directory, platform === "win32" ? `${command}${extension}` : command)));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function record(checks, { id, status, code, message, hint = "" }, redact) {
  checks.push({
    id: redact(id),
    status,
    code: redact(code),
    message: redact(message),
    hint: redact(hint),
  });
}

function summarize(checks) {
  const summary = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;
  return summary;
}

async function appendConfigChecks(config, loaded, checks) {
  const neutral = (text) => text;
  const loadError = loaded.errors?.find(({ code }) => ["CONFIG_MISSING", "CONFIG_PARSE", "CONFIG_READ"].includes(code));
  if (loadError) {
    record(checks, { id: "config.load", status: "fail", code: loadError.code, message: loadError.message, hint: loadError.hint }, neutral);
    record(checks, { id: "config.valid", status: "skip", code: "CONFIG_UNAVAILABLE", message: "Config could not be validated.", hint: "" }, neutral);
  } else {
    record(checks, { id: "config.load", status: "ok", code: "CONFIG_LOADED", message: "Config file loaded.", hint: "" }, neutral);
  }
  if (!config) return;
  const result = await validateConfig(config, { mode: "runtime" });
  record(checks, result.ok
    ? { id: "config.valid", status: "ok", code: "CONFIG_VALID", message: "Config is valid for runtime.", hint: "" }
    : { id: "config.valid", status: "fail", code: result.errors[0].code, message: `Config has ${result.errors.length} validation error(s).`, hint: result.errors.map(({ hint }) => hint).filter(Boolean).join(" ") }, neutral);
}

function appendOwnerCheck(config, checks) {
  const neutral = (text) => text;
  const ownerExists = (config?.allowlist ?? []).some((entry) => entry.role === "owner");
  record(checks, ownerExists
    ? { id: "allowlist.owner", status: "ok", code: "OWNER_CONFIGURED", message: "An owner is configured.", hint: "" }
    : { id: "allowlist.owner", status: config ? "fail" : "skip", code: config ? "NO_OWNER" : "CONFIG_UNAVAILABLE", message: config ? "No allowlist owner is configured." : "Owner check requires a config.", hint: "" }, neutral);
}

async function appendProjectPathChecks(config, checks, { isGitRepo: checkGit, platform }) {
  if (config) {
    const results = await validateProjects(config, { isGitRepo: checkGit, platform });
    for (const result of results) record(checks, {
      id: `project.${result.projectId}.path`, status: result.status, code: result.code,
      message: result.message, hint: result.hint,
    }, (text) => text);
  }
}

async function appendMcpChecks(config, checks, { env, platform, which, readFile }) {
  if (!config) return;
  const laneById = new Map((config.lanes ?? []).map((lane) => [lane.id, lane]));
  for (const project of config.projects ?? []) {
    if (laneById.get(project.homeLane)?.kind !== "local") {
      record(checks, { id: `project.${project.id}.mcp`, status: "skip", code: "REMOTE_HOME_UNVERIFIED", message: "MCP launch was not checked on this dispatcher because the project home is remote.", hint: "Run doctor on the project's home lane." }, (text) => text);
      continue;
    }
    const result = await resolveMcpLaunch(project.repo.path, config.mcp?.serverName ?? "plan-forge", {
      env,
      readFile,
      which: async (command) => Boolean(await which(command, { env, platform })),
    });
    record(checks, result.ok
      ? { id: `project.${project.id}.mcp`, status: "ok", code: "MCP_LAUNCH_OK", message: "Project MCP launch configuration is available.", hint: "" }
      : { id: `project.${project.id}.mcp`, status: "fail", code: result.code, message: "Project MCP launch configuration could not be resolved.", hint: result.hint }, (text) => text);
  }
}

async function appendSecretsChecks(config, checks, { home, env, platform, runIcacls }) {
  const secretNames = config ? requiredSecretNames(config) : [];
  let secrets;
  let fileError = null;
  try {
    secrets = await createSecrets({ env, file: path.join(home, "secrets.json"), trackNames: secretNames });
  } catch (error) {
    fileError = error;
    secrets = await createSecrets({ env, trackNames: secretNames });
  }
  const redact = secrets.redact;
  for (const { name, reason } of secretNames) {
    const present = secrets.has(name);
    record(checks, present
      ? { id: `secret.${name}`, status: "ok", code: "SECRET_PRESENT", message: `${name} is available (${reason}).`, hint: "" }
      : { id: `secret.${name}`, status: "fail", code: "SECRET_MISSING", message: `${name} is not set (${reason}).`, hint: "Set the environment variable or add it to secrets.json." }, redact);
  }
  if (fileError) {
    const code = fileError.code === "SECRETS_PARSE" ? fileError.code : "SECRETS_INVALID";
    record(checks, { id: "secrets.permissions", status: "fail", code, message: "Secrets file could not be loaded safely.", hint: "Repair secrets.json without including secret values in diagnostics." }, redact);
    return redact;
  }
  const permissions = await checkSecretsFilePermissions(path.join(home, "secrets.json"), { platform, runIcacls });
  record(checks, { id: "secrets.permissions", ...permissions }, redact);
  return redact;
}

async function appendToolChecks(config, checks, { env, platform, which, redact }) {
  for (const [name, command] of [["git", "git"], ["copilot", "copilot"]]) {
    const found = await which(command, { env, platform });
    record(checks, found
      ? { id: `tool.${name}`, status: "ok", code: `${name.toUpperCase()}_AVAILABLE`, message: `${name} is available on PATH.`, hint: "" }
      : { id: `tool.${name}`, status: "warn", code: `${name.toUpperCase()}_NOT_FOUND`, message: `${name} was not found on PATH.`, hint: name === "copilot" ? "Copilot is optional when BYOK runtimes are configured." : "Install git and add it to PATH." }, redact);
  }
  const pforgeCommand = config?.runtimes?.pforgeCommand ?? "auto";
  let pforgeFound = false;
  if (pforgeCommand === "auto") {
    const candidates = ["pwsh", "bash"];
    for (const command of candidates) {
      if (await which(command, { env, platform })) {
        pforgeFound = true;
        break;
      }
    }
  } else if (Array.isArray(pforgeCommand) && pforgeCommand.length > 0) {
    pforgeFound = Boolean(await which(pforgeCommand[0], { env, platform }));
  }
  record(checks, pforgeFound
    ? { id: "tool.pforge", status: "ok", code: "PFORGE_AVAILABLE", message: "The configured pforge runtime is available.", hint: "" }
    : { id: "tool.pforge", status: config ? "fail" : "skip", code: config ? "PFORGE_NOT_FOUND" : "CONFIG_UNAVAILABLE", message: config ? "The configured pforge runtime was not found on PATH." : "pforge runtime check requires a config.", hint: "Install the configured shell or executable and add it to PATH." }, redact);
}

export async function runDoctor({
  home = resolveHome(),
  env = process.env,
  platform = process.platform,
  nodeVersion = process.versions.node,
  which = whichOnPath,
  isGitRepo: checkGit = isGitRepo,
  runIcacls,
  readFile,
} = {}) {
  const checks = [];
  const version = parseVersion(nodeVersion);
  record(checks, versionAtLeast(version, MIN_NODE)
    ? { id: "node.version", status: "ok", code: "NODE_VERSION_OK", message: `Node.js ${nodeVersion} meets the minimum version.` }
    : { id: "node.version", status: "fail", code: "NODE_VERSION_OLD", message: `Node.js ${nodeVersion} is below 22.12.0.`, hint: "Install Node.js 22.12 or newer." }, (text) => text);
  const loaded = await loadConfig({ home });
  const config = loaded.config;
  await appendConfigChecks(config, loaded, checks);
  appendOwnerCheck(config, checks);
  await appendProjectPathChecks(config, checks, { isGitRepo: checkGit, platform });
  await appendMcpChecks(config, checks, { env, platform, which, readFile });
  const redact = await appendSecretsChecks(config, checks, { home, env, platform, runIcacls });
  await appendToolChecks(config, checks, { env, platform, which, redact });
  for (const check of checks) {
    for (const key of ["id", "code", "message", "hint"]) check[key] = redact(check[key]);
  }
  const summary = summarize(checks);
  return { ok: summary.fail === 0, summary, checks };
}

export function formatDoctorReport(report) {
  const icon = { ok: "✔", warn: "!", fail: "✖", skip: "–" };
  const lines = [`Setup status: ${report.summary.fail ? "incomplete" : "ready"}`];
  for (const check of report.checks) lines.push(`${icon[check.status]} ${check.id}: ${check.message}`);
  lines.push(`Summary: ${report.summary.ok} ok, ${report.summary.warn} warnings, ${report.summary.fail} failed, ${report.summary.skip} skipped`);
  return lines.join("\n");
}

async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        json: { type: "boolean" },
        home: { type: "string" },
      },
    });
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const report = await runDoctor({ ...(parsed.values.home ? { home: parsed.values.home } : {}) });
  if (parsed.values.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else process.stdout.write(`${formatDoctorReport(report)}\n`);
  return report.ok ? 0 : 1;
}

export default {
  name: "doctor",
  summary: "Check Forge-Claw prerequisites and configuration",
  usage: USAGE,
  run,
};
