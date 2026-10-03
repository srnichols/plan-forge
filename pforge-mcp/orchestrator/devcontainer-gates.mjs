/**
 * Plan Forge — run validation gates inside the project's Dev Container.
 *
 * With `.forge.json` → `gateRunner: "devcontainer"`, every gate runs as
 * `devcontainer exec --workspace-folder <cwd> sh -c "<gate>"`, so it uses the
 * toolchain the project declares in `.devcontainer/devcontainer.json` (the same
 * one CI and Codespaces use) instead of whatever the host has installed.
 * Workers still run on the host and edit the bind-mounted workspace.
 *
 * Needs the Dev Containers CLI (`npm install -g @devcontainers/cli`) and
 * Docker. `PFORGE_DEVCONTAINER_CLI` points at a specific CLI (a `.js` entry
 * runs with Node).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const GATE_RUNNER_MODES = Object.freeze(["host", "devcontainer"]);
const DEFAULT_MODE = "host";
const CLI_PACKAGE = "@devcontainers/cli";
const INSTALL_HINT = `Install the Dev Containers CLI (npm install -g ${CLI_PACKAGE}) and start Docker, or set "gateRunner": "host" in .forge.json.`;
const UP_TIMEOUT_MS = 900_000;
const PROBE_TIMEOUT_MS = 60_000;
const DEFAULT_GATE_TIMEOUT_MS = 600_000;
const MAX_BUFFER = 16_777_216; // 16 MiB, as runGate
const UP_ERROR_TAIL_LINES = 5;
const JS_ENTRY = new Set([".js", ".mjs", ".cjs"]);

/** Workspace folders whose container this process has already started. */
const startedFolders = new Set();

/** @internal */
export function _resetDevcontainerStateForTests() {
  startedFolders.clear();
}

/**
 * @param {string} cwd
 * @returns {"host"|"devcontainer"}
 */
export function loadGateRunnerMode(cwd) {
  try {
    const path = resolve(cwd, ".forge.json");
    if (!existsSync(path)) return DEFAULT_MODE;
    const mode = JSON.parse(readFileSync(path, "utf8")).gateRunner;
    return GATE_RUNNER_MODES.includes(mode) ? mode : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function launcherFor(path) {
  return JS_ENTRY.has(extname(path).toLowerCase()) ? { command: process.execPath, prefix: [path] } : { command: path, prefix: [] };
}

/** The CLI's JS entry next to an npm shim directory, if it is the Dev Containers package. */
function npmShimEntry(shimDir) {
  const pkgDir = join(shimDir, "node_modules", "@devcontainers", "cli");
  try {
    const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.devcontainer;
    if (manifest.name !== CLI_PACKAGE || typeof bin !== "string" || isAbsolute(bin)) return null;
    const entry = resolve(pkgDir, bin);
    const within = relative(pkgDir, entry);
    if (within.startsWith(`..${sep}`) || within === ".." || !existsSync(entry)) return null;
    return entry;
  } catch {
    return null;
  }
}

/**
 * Locate the Dev Containers CLI. On Windows the npm shim (`devcontainer.cmd`)
 * cannot be executed without a shell, so its package's JS entry runs with Node.
 *
 * @param {{ env?: object, platform?: string }} [opts]
 * @returns {{ command: string, prefix: string[] }|null}
 */
export function resolveDevcontainerCli({ env = process.env, platform = process.platform } = {}) {
  if (env.PFORGE_DEVCONTAINER_CLI) return launcherFor(env.PFORGE_DEVCONTAINER_CLI);
  const separator = platform === "win32" ? ";" : ":";
  const dirs = String(env.PATH ?? env.Path ?? "").split(separator).filter(Boolean);
  const find = platform === "win32" ? windowsCliIn : posixCliIn;
  for (const dir of dirs) {
    const cli = find(dir);
    if (cli) return cli;
  }
  return null;
}

function windowsCliIn(dir) {
  if (!existsSync(join(dir, "devcontainer.cmd"))) return null;
  const entry = npmShimEntry(dir);
  return entry ? launcherFor(entry) : null;
}

function posixCliIn(dir) {
  const path = join(dir, "devcontainer");
  return existsSync(path) ? { command: path, prefix: [] } : null;
}

/**
 * @param {{ cli: { command: string, prefix: string[] }, workspaceFolder: string, command: string }} opts
 * @returns {string[]} Arguments for `cli.command`.
 */
export function devcontainerExecArgs({ cli, workspaceFolder, command }) {
  return [...cli.prefix, "exec", "--workspace-folder", workspaceFolder, "sh", "-c", command];
}

function runCli(cli, args, { cwd, timeout }) {
  return execFileSync(cli.command, [...cli.prefix, ...args], {
    cwd, encoding: "utf8", timeout, maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

/**
 * Start (or reuse) the Dev Container for `cwd`. Runs `devcontainer up` once per
 * folder per process; later calls return immediately.
 *
 * @param {{ cwd: string, env?: object, platform?: string }} opts
 * @returns {{ ok: boolean, started?: boolean, error?: string }}
 */
export function ensureDevcontainerUp({ cwd, env, platform }) {
  const workspaceFolder = resolve(cwd);
  if (startedFolders.has(workspaceFolder)) return { ok: true, started: false };
  const cli = resolveDevcontainerCli({ env, platform });
  if (!cli) return { ok: false, error: `gateRunner is "devcontainer" but the Dev Containers CLI was not found. ${INSTALL_HINT}` };
  try {
    runCli(cli, ["up", "--workspace-folder", workspaceFolder], { cwd: workspaceFolder, timeout: UP_TIMEOUT_MS });
    startedFolders.add(workspaceFolder);
    return { ok: true, started: true };
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message).trim().split(/\r?\n/).slice(-UP_ERROR_TAIL_LINES).join(" ");
    return { ok: false, error: `devcontainer up failed for ${workspaceFolder}: ${detail}. ${INSTALL_HINT}` };
  }
}

/**
 * Run one gate inside the Dev Container. Same result shape as runGate.
 *
 * @param {{ command: string, cwd: string, gateTimeout?: number, failOnStderr?: boolean }} opts
 */
export function runDevcontainerGate({ command, cwd, gateTimeout = DEFAULT_GATE_TIMEOUT_MS, failOnStderr = false }) {
  const cli = resolveDevcontainerCli();
  if (!cli) return { success: false, output: "", stderr: "", error: `Dev Containers CLI not found. ${INSTALL_HINT}`, exitCode: -1 };
  const workspaceFolder = resolve(cwd);
  try {
    const output = execFileSync(cli.command, devcontainerExecArgs({ cli, workspaceFolder, command }), {
      cwd: workspaceFolder, encoding: "utf8", timeout: gateTimeout, maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, NO_COLOR: "1" },
    });
    return { success: true, output: (output || "").trim(), stderr: "", error: "", exitCode: 0 };
  } catch (err) {
    const exitCode = typeof err.status === "number" ? err.status : 1;
    const stdoutText = (err.stdout || "").toString().trim();
    const stderrText = (err.stderr || err.message || "").toString().trim();
    if (exitCode === 0 && !failOnStderr) return { success: true, output: stdoutText, stderr: stderrText, error: "", exitCode };
    return { success: false, output: stdoutText, stderr: stderrText, error: stderrText, exitCode };
  }
}

/**
 * Whether `tool` is on the container's PATH (for the gate tool preflight).
 * @param {{ cwd: string, tool: string }} opts
 */
export function devcontainerHasTool({ cwd, tool }) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(tool)) return false;
  return runDevcontainerGate({ command: `command -v ${tool}`, cwd, gateTimeout: PROBE_TIMEOUT_MS }).success;
}
