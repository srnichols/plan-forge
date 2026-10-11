import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { collectStatus } from "./status.mjs";

const CLI_PATH = fileURLToPath(new URL("../../cli.mjs", import.meta.url));
const DEV_HOME_NAME = "pforge-claw-dev";
const PORT = 3190;
const TOKEN_NAME = "PFORGE_CLAW_TELEGRAM_TOKEN";
const WORKER_SECRET = "PFORGE_CLAW_WORKER_SECRET";
const USAGE = [
  "Usage: pforge claw dev <up|down|status> [--fake|--live]",
  "  up       Start an isolated fake (default) or live local topology",
  "  down     Stop only processes whose recorded identity still matches",
  "  status   Show process and worker lane state",
].join("\n");

export function cleanEnvironment(source = process.env) {
  const clean = { ...source };
  for (const key of Object.keys(clean)) {
    if (key === "GH_TOKEN" || key === "GITHUB_TOKEN" || key === TOKEN_NAME
      || key.startsWith("COPILOT_")) delete clean[key];
  }
  return clean;
}

function cliProcess(args, env, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `CLI exited with status ${code}`));
    });
  });
}

function runIdentityCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.once("error", () => resolve(""));
    child.once("close", (code) => resolve(code === 0 ? output.trim() : ""));
  });
}

async function processStartToken(pid) {
  if (!Number.isInteger(pid) || pid < 1) return "";
  if (process.platform === "win32") {
    return runIdentityCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
    ]);
  }
  return runIdentityCommand("ps", ["-o", "lstart=", "-p", String(pid)]);
}

async function processMatches(record) {
  if (!record || !Number.isInteger(record.pid) || typeof record.startToken !== "string") return false;
  try {
    process.kill(record.pid, 0);
  } catch {
    return false;
  }
  return (await processStartToken(record.pid)) === record.startToken;
}

async function readDevFile(file) {
  try {
    const record = JSON.parse(await readFile(file, "utf8"));
    if (record?.v !== 1 || !Array.isArray(record.processes)) throw new Error("invalid dev state");
    return record;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("DEV_STATE_INVALID");
  }
}

async function writeJsonSecure(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function buildConfig({ root, telegramApi, workerLane }) {
  const projectRoot = path.join(root, "projects");
  const projects = [1, 2, 3].map((number) => ({
    id: `fixture-${number}`,
    displayName: `Development fixture ${number}`,
    repo: { path: path.join(projectRoot, `fixture-${number}`), baseBranch: "main" },
    channel: { adapter: "telegram", chatId: "42", topicId: String(100 + number) },
    placement: { prefer: ["local"], requires: [] },
    homeLane: "local",
    keepAlive: false,
    ...(number === 3 ? { visibility: "restricted" } : {}),
  }));
  return {
    v: 1,
    instanceId: "pforge-claw-dev",
    timezone: "Etc/UTC",
    channels: {
      telegram: {
        enabled: true,
        botTokenSecret: TOKEN_NAME,
        mode: "poll",
        ...(telegramApi ? { apiBase: telegramApi } : {}),
        generalChat: { chatId: "42" },
      },
    },
    allowlist: [
      { channel: "telegram", userId: "1", role: "owner", alias: "Owner" },
      { channel: "telegram", userId: "2", role: "approver", alias: "Approver" },
      { channel: "telegram", userId: "3", role: "viewer", alias: "Viewer" },
    ],
    policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
    runtimes: { default: "copilot-sdk", pforgeCommand: "auto" },
    lanes: [
      { id: "local", kind: "local", labels: ["local"], enabled: true },
      { id: "worker-a", kind: "remote", labels: ["macos"], enabled: true, optIn: true },
      { id: "worker-b", kind: "remote", labels: ["windows"], enabled: true, optIn: true },
    ],
    projects,
    ...(workerLane ? {
      worker: {
        laneId: workerLane,
        dispatcherUrl: `ws://127.0.0.1:${PORT}/claw/workers`,
        secretName: WORKER_SECRET,
        allowInsecureLan: true,
      },
    } : {}),
    http: { bind: "127.0.0.1", port: PORT },
  };
}

async function startFakeTelegram() {
  const server = createServer(async (request, response) => {
    const route = new URL(request.url, "http://127.0.0.1").pathname;
    const method = route.split("/").at(-1);
    if (method === "getUpdates") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, result: [] }));
      return;
    }
    const result = method === "getMe"
      ? { id: 9, is_bot: true, username: "dev_fake_bot", can_read_all_group_messages: true }
      : method === "sendMessage"
      ? { message_id: 1, chat: { id: 42 }, text: "" }
      : true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    apiBase: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function spawnService({ role, home, env, laneId }) {
  const args = role === "dispatcher"
    ? [CLI_PATH, "start", "--home", home]
    : [CLI_PATH, "worker", "run", "--home", home];
  const child = spawn(process.execPath, args, {
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const startToken = await processStartToken(child.pid);
  if (!startToken) {
    child.kill("SIGTERM");
    throw new Error(`${role} failed to start`);
  }
  return {
    child,
    record: { pid: child.pid, startToken, role, home, ...(laneId ? { laneId } : {}) },
  };
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("DISPATCHER_NOT_READY");
}

async function stopProcesses(records) {
  for (const record of records) {
    if (await processMatches(record)) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline && await processMatches(record)) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (await processMatches(record)) {
        try {
          process.kill(record.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
  }
}

async function waitForSignal() {
  return new Promise((resolve) => {
    const finish = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolve();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

async function startDev(mode) {
  const root = path.join(os.tmpdir(), DEV_HOME_NAME);
  const stateFile = path.join(root, "dev.json");
  const liveToken = process.env[TOKEN_NAME];
  if (mode === "live" && !liveToken) {
    throw new Error(`LIVE_TOKEN_REQUIRED: Set ${TOKEN_NAME} to use --live.`);
  }
  const existing = await readDevFile(stateFile);
  if (existing && (await Promise.all(existing.processes.map(processMatches))).some(Boolean)) {
    throw new Error("DEV_ALREADY_RUNNING");
  }
  await rm(root, { recursive: true, force: true });
  const dispatcherHome = path.join(root, "dispatcher");
  const workerHomes = ["worker-a", "worker-b"].map((lane) => path.join(root, lane));
  await mkdir(path.join(root, "projects"), { recursive: true });
  for (const workerHome of workerHomes) await mkdir(workerHome, { recursive: true });
  const fakeTelegram = mode === "fake" ? await startFakeTelegram() : null;
  const config = buildConfig({ root, telegramApi: fakeTelegram?.apiBase });
  for (const project of config.projects) await mkdir(project.repo.path, { recursive: true });
  await writeJsonSecure(path.join(dispatcherHome, "config.json"), config);
  await writeJsonSecure(path.join(dispatcherHome, "secrets.json"), {
    [TOKEN_NAME]: mode === "live" ? liveToken : "123456:dev-fake-telegram-token",
  });
  for (const [index, laneId] of ["worker-a", "worker-b"].entries()) {
    const home = workerHomes[index];
    await writeJsonSecure(path.join(home, "config.json"), buildConfig({ root, workerLane: laneId }));
  }

  const cleanEnv = cleanEnvironment();
  const processes = [{
    pid: process.pid,
    startToken: await processStartToken(process.pid),
    role: "supervisor",
    home: root,
  }];
  const children = [];
  try {
    for (const laneId of ["worker-a", "worker-b"]) {
      const code = await cliProcess([
        "worker", "enroll", "--home", dispatcherHome, "--lane", laneId,
      ], cleanEnv);
      const codeFile = path.join(root, `${laneId}.join-code`);
      await writeFile(codeFile, `${code}\n`, { mode: 0o600 });
    }
    const dispatcherEnv = {
      ...cleanEnv,
      PFORGE_CLAW_HOME: dispatcherHome,
      ...(mode === "live" ? { [TOKEN_NAME]: liveToken } : {}),
    };
    const dispatcher = await spawnService({ role: "dispatcher", home: dispatcherHome, env: dispatcherEnv });
    children.push(dispatcher);
    processes.push(dispatcher.record);
    await waitForHttp(`http://127.0.0.1:${PORT}/healthz`);

    for (const [index, laneId] of ["worker-a", "worker-b"].entries()) {
      const workerHome = workerHomes[index];
      const code = (await readFile(path.join(root, `${laneId}.join-code`), "utf8")).trim();
      await cliProcess([
        "worker", "join", "--home", workerHome, "--code", code,
        "--url", `ws://127.0.0.1:${PORT}/claw/workers`,
      ], cleanEnv);
      await rm(path.join(root, `${laneId}.join-code`), { force: true });
      const worker = await spawnService({
        role: "worker",
        home: workerHome,
        laneId,
        env: { ...cleanEnv, PFORGE_CLAW_HOME: workerHome },
      });
      children.push(worker);
      processes.push(worker.record);
    }
    await writeJsonSecure(stateFile, { v: 1, root, dispatcherHome, processes });
    await waitForSignal();
  } catch (error) {
    await stopProcesses(children.map(({ record }) => record));
    throw error;
  } finally {
    await stopProcesses(children.map(({ record }) => record));
    await fakeTelegram?.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function stopDev(root) {
  const stateFile = path.join(root, "dev.json");
  const record = await readDevFile(stateFile);
  if (!record) {
    await rm(root, { recursive: true, force: true });
    return { stopped: true, processes: [] };
  }
  const matching = [];
  for (const processRecord of record.processes) {
    if (await processMatches(processRecord)) matching.push(processRecord);
  }
  await stopProcesses(matching.filter(({ role }) => role !== "supervisor"));
  const supervisor = matching.find(({ role }) => role === "supervisor");
  if (supervisor && supervisor.pid !== process.pid) {
    try {
      process.kill(supervisor.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await rm(root, { recursive: true, force: true });
  return { stopped: true, processes: matching.map(({ role, pid }) => ({ role, pid })) };
}

async function statusDev(root) {
  const record = await readDevFile(path.join(root, "dev.json"));
  if (!record) return { running: false, processes: [], workers: [] };
  const processes = [];
  for (const entry of record.processes) {
    processes.push({ role: entry.role, pid: entry.pid, alive: await processMatches(entry) });
  }
  let lanes = [];
  try {
    const report = await collectStatus({ home: record.dispatcherHome, env: cleanEnvironment() });
    lanes = report.lanes;
  } catch (error) {
    throw new Error(`DEV_STATUS_FAILED: ${error.message}`);
  }
  const workers = ["worker-a", "worker-b"].map((id) => {
    const lane = lanes.find((entry) => entry.id === id);
    return { id, connected: lane?.state === "on", lease: lane?.lease ?? null };
  });
  return { running: processes.some(({ role, alive }) => role === "supervisor" && alive), processes, workers };
}

async function run(argv = []) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: { fake: { type: "boolean" }, live: { type: "boolean" } },
    });
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const [command, ...positionals] = parsed.positionals;
  if (!["up", "down", "status"].includes(command) || positionals.length > 0
    || (parsed.values.fake && parsed.values.live)
    || (command !== "up" && (parsed.values.fake || parsed.values.live))) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const root = path.join(os.tmpdir(), DEV_HOME_NAME);
  try {
    if (command === "up") {
      await startDev(parsed.values.live ? "live" : "fake");
      return 0;
    }
    const result = command === "down" ? await stopDev(root) : await statusDev(root);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message || "DEV_FAILED"}\n`);
    return 1;
  }
}

export default {
  name: "dev",
  summary: "Run an isolated local development topology",
  usage: USAGE,
  run,
};

export const DEV_CONSTANTS = Object.freeze({ DEV_HOME_NAME, PORT });
