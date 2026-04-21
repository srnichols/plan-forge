/**
 * Forge-Master Lifecycle Manager (Phase-29, Slice 10).
 *
 * Start/stop/status/logs helpers for the Forge-Master Studio HTTP server.
 * Manages a PID file at .forge/forge-master.pid.
 *
 * Can be run as a CLI script:
 *   node src/lifecycle.mjs start
 *   node src/lifecycle.mjs stop
 *   node src/lifecycle.mjs status [--json]
 *   node src/lifecycle.mjs logs [--n=50]
 *
 * @module forge-master/lifecycle
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "../server.mjs");
const HTTP_PORT = 3102;

function forgePath(cwd, file) {
  const dir = resolve(cwd, ".forge");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return resolve(dir, file);
}

/**
 * Start the Forge-Master HTTP server as a detached background process.
 *
 * @param {{ cwd?: string }} [opts]
 */
export async function start(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pidFile = forgePath(cwd, "forge-master.pid");

  const existing = await status({ cwd });
  if (existing.running) {
    console.log(`forge-master already running (PID ${existing.pid})`);
    return;
  }

  const child = spawn(process.execPath, [SERVER_PATH, "--http"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    cwd,
  });

  writeFileSync(pidFile, String(child.pid));
  child.unref();
  console.log(`forge-master started on http://127.0.0.1:${HTTP_PORT} (PID ${child.pid})`);
}

/**
 * Stop the running Forge-Master HTTP server.
 *
 * @param {{ cwd?: string }} [opts]
 */
export async function stop(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pidFile = forgePath(cwd, "forge-master.pid");
  if (!existsSync(pidFile)) { console.log("forge-master is not running"); return; }
  const pidStr = readFileSync(pidFile, "utf-8").trim();
  if (!pidStr) { console.log("forge-master is not running"); return; }
  const pid = parseInt(pidStr, 10);
  try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
  try { writeFileSync(pidFile, ""); } catch { /* non-fatal */ }
  console.log(`forge-master stopped (PID ${pid})`);
}

/**
 * Get the running status of Forge-Master.
 *
 * @param {{ cwd?: string }} [opts]
 * @returns {{ running: boolean, pid?: number, port?: number }}
 */
export async function status(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const pidFile = forgePath(cwd, "forge-master.pid");
  if (!existsSync(pidFile)) return { running: false };
  const pidStr = readFileSync(pidFile, "utf-8").trim();
  if (!pidStr) return { running: false };
  const pid = parseInt(pidStr, 10);
  if (!Number.isFinite(pid)) return { running: false };
  try {
    process.kill(pid, 0); // 0 = existence check
    return { running: true, pid, port: HTTP_PORT };
  } catch {
    return { running: false };
  }
}

/**
 * Print recent log lines from the Forge-Master stdio log.
 *
 * @param {{ cwd?: string, n?: number }} [opts]
 */
export async function logs(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const n = opts.n || 50;
  const logFile = forgePath(cwd, "forge-master-stdio.log");
  if (!existsSync(logFile)) { console.log("No log file found"); return; }
  const content = readFileSync(logFile, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  console.log(lines.slice(-n).join("\n"));
}

// ─── CLI entry point ─────────────────────────────────────────────────

const [,, cmd, ...cliArgs] = process.argv;
if (cmd && ["start", "stop", "status", "logs"].includes(cmd)) {
  const jsonFlag = cliArgs.includes("--json");
  const nArg = cliArgs.find(a => a.startsWith("--n="));
  const n = nArg ? parseInt(nArg.split("=")[1], 10) : 50;
  const fn = { start, stop, status, logs }[cmd];
  fn({ json: jsonFlag, n }).then(result => {
    if (result && jsonFlag) console.log(JSON.stringify(result));
  }).catch(err => { console.error(err.message); process.exit(1); });
}
