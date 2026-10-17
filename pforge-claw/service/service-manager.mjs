#!/usr/bin/env node
import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ClawError } from "../src/errors.mjs";
import { run } from "../src/jobs/worktree.mjs";

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ACTIONS = new Set(["install", "uninstall", "status"]);
const FORMATS = new Set(["xml", "systemd", "ps"]);
const OUTPUT_LIMIT = 16_384;

function validatePath(value) {
  if (typeof value !== "string" || !value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ClawError("SERVICE_PATH_INVALID");
  }
  return value;
}

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function escapeSystemd(value) {
  return value.replaceAll("%", "%%").replaceAll("$", () => "$$")
    .replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapePowerShell(value) {
  return value.replaceAll("'", "''");
}

/**
 * Return an argument-array service command for the requested host platform.
 * @param {{platform:string, action:string, home:string, nodePath:string, cliPath:string}} options
 * @returns {{bin:string,args:string[]}}
 */
export function planServiceCommand({
  platform = process.platform,
  action,
  home = path.join(os.homedir(), ".pforge-claw"),
  nodePath = process.execPath,
  cliPath = path.resolve(SERVICE_DIR, "..", "cli.mjs"),
} = {}) {
  if (!ACTIONS.has(action)) throw new ClawError("SERVICE_ACTION_INVALID");
  const homePath = validatePath(home);
  const executable = validatePath(nodePath);
  const cli = validatePath(cliPath);
  const script = path.join(SERVICE_DIR, "install-service.ps1");
  if (platform === "win32") {
    return {
      bin: "pwsh",
      args: ["-NoProfile", "-File", script, "-Action", action,
        "-HomeDir", homePath, "-NodePath", executable, "-CliPath", cli],
    };
  }
  if (platform === "darwin" || platform === "linux") {
    const shell = path.join(SERVICE_DIR, "install-service.sh");
    return {
      bin: "bash",
      args: [shell, action, "--home", homePath, "--node", executable, "--cli", cli],
    };
  }
  throw new ClawError("SERVICE_PLATFORM_UNSUPPORTED");
}

/**
 * Render service-template placeholders after validating paths and escaping for
 * their target configuration syntax.
 * @param {string} template
 * @param {Record<string,string>} vars
 * @param {{format:"xml"|"systemd"|"ps"}} options
 * @returns {string}
 */
export function renderTemplate(template, vars, { format } = {}) {
  if (typeof template !== "string" || !FORMATS.has(format)) {
    throw new ClawError("SERVICE_TEMPLATE_INVALID");
  }
  const escape = format === "xml" ? escapeXml
    : format === "systemd" ? escapeSystemd : escapePowerShell;
  return Object.entries(vars).reduce((rendered, [name, raw]) => {
    if (typeof raw !== "string") throw new ClawError("SERVICE_PATH_INVALID");
    const value = escape(validatePath(raw));
    return rendered.replaceAll(`__${name}__`, () => value);
  }, template);
}

/**
 * Run a planned service command using the injected argument-array runner.
 * @param {{bin:string,args:string[]}} plan
 * @param {{exec?:Function}} options
 * @returns {Promise<{code:number,stdout:string,stderr:string}>}
 */
export async function runServiceAction(plan, { exec = run } = {}) {
  if (!plan || typeof plan.bin !== "string" || !Array.isArray(plan.args)
    || plan.args.some((arg) => typeof arg !== "string")) {
    throw new ClawError("SERVICE_PLAN_INVALID");
  }
  return exec(plan.bin, plan.args, { timeoutMs: 15_000, maxOutput: OUTPUT_LIMIT });
}

async function ensureOwnedFile(target) {
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new ClawError("SERVICE_FILE_UNSAFE");
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw new ClawError("SERVICE_FILE_NOT_OWNED");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function materialize({ platform, home, nodePath, cliPath }) {
  const serviceHome = path.join(home, "service");
  await mkdir(serviceHome, { recursive: true, mode: 0o700 });
  const logDir = path.join(home, "logs");
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  const format = platform === "darwin" ? "xml" : "systemd";
  const source = path.join(SERVICE_DIR, platform === "darwin"
    ? "com.pforge.claw.plist" : "pforge-claw.service");
  const rendered = renderTemplate(await readFile(source, "utf8"), {
    NODE: nodePath, CLI: cliPath, HOME: home, LOGDIR: logDir,
  }, { format });
  const target = path.join(serviceHome, platform === "darwin"
    ? "com.pforge.claw.plist" : "pforge-claw.service");
  await ensureOwnedFile(target);
  await writeFile(target, rendered, { mode: 0o600 });
  return target;
}

async function installService({ platform, home, nodePath, cliPath, plan }) {
  const target = await materialize({ platform, home, nodePath, cliPath });
  if (platform !== "linux") return runServiceAction(plan);
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const userUnit = path.join(configHome, "systemd", "user", "pforge-claw.service");
  await mkdir(path.dirname(userUnit), { recursive: true, mode: 0o700 });
  await ensureOwnedFile(userUnit);
  await writeFile(userUnit, await readFile(target), { mode: 0o600 });
  const reload = await runServiceAction({ bin: "systemctl", args: ["--user", "daemon-reload"] });
  assertCommandSucceeded(reload, platform);
  return runServiceAction(plan);
}

async function uninstallService({ platform, home, plan }) {
  const result = await runServiceAction(plan);
  if (result.code !== 0) return result;
  if (platform === "linux" && plan.unitPath) {
    await ensureOwnedFile(plan.unitPath);
    await unlink(plan.unitPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    const reload = await runServiceAction({ bin: "systemctl", args: ["--user", "daemon-reload"] });
    assertCommandSucceeded(reload, platform);
  }
  if (platform === "darwin") {
    const plist = path.join(home, "service", "com.pforge.claw.plist");
    await ensureOwnedFile(plist);
    await unlink(plist).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return result;
}

function servicePlan({ platform, action, home, nodePath, cliPath }) {
  validatePath(home);
  validatePath(nodePath);
  validatePath(cliPath);
  const id = typeof process.getuid === "function" ? process.getuid() : process.env.UID ?? "0";
  const plist = path.join(home, "service", "com.pforge.claw.plist");
  const unit = "pforge-claw.service";
  if (platform === "darwin") {
    const target = `gui/${id}`;
    const command = action === "install"
      ? ["bootstrap", target, plist]
      : action === "uninstall" ? ["bootout", target, plist] : ["print", `${target}/com.pforge.claw`];
    return { bin: "launchctl", args: command };
  }
  if (platform === "linux") {
    const serviceHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    const unitPath = path.join(serviceHome, "systemd", "user", unit);
    if (action === "install") {
      return { bin: "systemctl", args: ["--user", "enable", "--now", unit] };
    }
    if (action === "uninstall") {
      return { bin: "systemctl", args: ["--user", "disable", "--now", unit], unitPath };
    }
    return { bin: "systemctl", args: ["--user", "show", unit, "--property=ActiveState", "--value"], unitPath };
  }
  return planServiceCommand({ platform, action, home, nodePath, cliPath });
}

function assertCommandSucceeded(result, platform) {
  if (result.code === 0) return;
  const noUserSession = platform === "linux"
    && /failed to connect to bus|no medium found/i.test(result.stderr ?? "");
  throw new ClawError(noUserSession ? "SERVICE_SYSTEMD_UNAVAILABLE" : "SERVICE_COMMAND_FAILED", {
    exitCode: result.code,
  });
}

function parseManagerArgs(argv) {
  try {
    return parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        home: { type: "string" }, node: { type: "string" },
        cli: { type: "string" }, "dry-run": { type: "boolean" },
      },
    });
  } catch {
    return null;
  }
}

async function executeManagerAction({ action, platform, home, nodePath, cliPath, plan }) {
  const result = action === "install"
    ? await installService({ platform, home, nodePath, cliPath, plan })
    : action === "uninstall"
      ? await uninstallService({ platform, home, plan })
      : await runServiceAction(plan);
  if (result.code !== 0 && action === "status") {
    process.stdout.write("unknown (service not installed or no user service session)\n");
    return 0;
  }
  assertCommandSucceeded(result, platform);
  const state = action === "status"
    ? result.stdout.trim() || "active"
    : action === "install" ? "installed" : "uninstalled";
  process.stdout.write(`${state}\n`);
  return 0;
}

async function runManager(argv) {
  const parsed = parseManagerArgs(argv);
  if (!parsed) {
    process.stderr.write("Usage: service-manager.mjs <install|uninstall|status> [--dry-run] [--home <dir>] [--node <path>] [--cli <path>]\n");
    return 2;
  }
  const [action, ...rest] = parsed.positionals;
  if (!ACTIONS.has(action) || rest.length) return 2;
  const home = path.resolve(parsed.values.home ?? path.join(os.homedir(), ".pforge-claw"));
  const nodePath = parsed.values.node ?? process.execPath;
  const cliPath = parsed.values.cli ?? path.resolve(SERVICE_DIR, "..", "cli.mjs");
  const platform = process.platform;
  try {
    const plan = servicePlan({ platform, action, home, nodePath, cliPath });
    if (parsed.values["dry-run"]) {
      process.stdout.write(`${JSON.stringify({ action, platform, command: plan })}\n`);
      return 0;
    }
    return await executeManagerAction({ action, platform, home, nodePath, cliPath, plan });
  } catch (error) {
    const failure = error instanceof ClawError ? error : new ClawError("SERVICE_ACTION_FAILED");
    process.stderr.write(`${failure.code}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runManager(process.argv.slice(2));
}
