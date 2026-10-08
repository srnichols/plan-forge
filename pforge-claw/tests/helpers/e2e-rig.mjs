import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootDispatcher } from "../../src/cli/start.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";
import { createSecrets } from "../../src/secrets.mjs";
import { createStore } from "../../src/state/store.mjs";
import { createFakeClock } from "./fake-clock.mjs";
import { startFakeTelegram } from "./fake-telegram.mjs";
import { createFixtureRepos } from "./fixture-repos.mjs";
import { createScriptedCopilot } from "./scripted-copilot.mjs";

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_PFORGE_PATH = path.join(HELPER_DIR, "fake-pforge.mjs");
const TOKEN_NAME = "PFORGE_CLAW_TELEGRAM_TOKEN";
const FAKE_TELEGRAM_TOKEN = "123456:fixture-telegram-token";
const OWNER_ID = "701";
const APPROVER_ID = "702";
const VIEWER_ID = "703";

export function cleanChildEnvironment(source = process.env) {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (name === "GH_TOKEN" || name === "GITHUB_TOKEN"
      || name === TOKEN_NAME || name.startsWith("COPILOT_")) delete env[name];
  }
  return env;
}

function buildConfig({ fakeTelegram, projects, repos, home, schedules = [] }) {
  return {
    v: 1,
    instanceId: "e2e-fixture",
    timezone: "Etc/UTC",
    channels: {
      telegram: {
        enabled: true,
        botTokenSecret: TOKEN_NAME,
        mode: "poll",
        apiBase: fakeTelegram.apiBase,
        generalChat: { chatId: "42" },
      },
    },
    allowlist: [
      { channel: "telegram", userId: OWNER_ID, role: "owner", alias: "Owner" },
      { channel: "telegram", userId: APPROVER_ID, role: "approver", alias: "Approver" },
      { channel: "telegram", userId: VIEWER_ID, role: "viewer", alias: "Viewer" },
    ],
    policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
    runtimes: {
      default: "copilot-sdk",
      pforgeCommand: [process.execPath, FAKE_PFORGE_PATH, "--fixture-root", home],
      ghCommand: repos.ghShim.command,
    },
    lanes: [
      { id: "local", kind: "local", labels: ["local"], enabled: true, concurrency: 3 },
      { id: "worker-a", kind: "remote", labels: ["macos"], enabled: true, optIn: true },
      { id: "worker-b", kind: "remote", labels: ["windows"], enabled: true, optIn: true },
    ],
    projects: projects.map((project, index) => ({
      id: project.id,
      displayName: `Fixture ${index + 1}`,
      repo: { path: project.repoPath, baseBranch: "main" },
      channel: { adapter: "telegram", chatId: "42", topicId: String(101 + index) },
      placement: { prefer: ["local"], requires: [] },
      homeLane: "local",
      keepAlive: false,
      ...(index === 2 ? { visibility: "restricted" } : {}),
    })),
    schedules,
  };
}

async function readJsonLines(file) {
  try {
    const text = await readFile(file, "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function listFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory() && entry.name !== ".git") files.push(...await listFiles(target));
    else if (entry.isFile() && entry.name !== "secrets.json") files.push(target);
  }
  return files;
}

export async function createE2ERig({
  startupTimeoutMs = 5000,
  clock = createFakeClock(),
  schedules = [],
  schedulerTickMs,
  copilot = createScriptedCopilot(),
  secrets: extraSecrets = {},
} = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "pforge claw e2e-"));
  const fixtureRoot = path.join(home, "fixture repos with spaces");
  const repos = await createFixtureRepos(3, {
    directory: fixtureRoot,
    withForge: true,
    ghShim: true,
  });
  const fakeTelegram = await startFakeTelegram();
  const config = buildConfig({ fakeTelegram, projects: repos.projects, repos, home, schedules });
  const env = cleanChildEnvironment();
  const logs = [];
  let handles = null;
  let disposed = false;

  async function boot() {
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "secrets.json"), JSON.stringify({
      [TOKEN_NAME]: FAKE_TELEGRAM_TOKEN,
      ...extraSecrets,
    }), { mode: 0o600 });
    const secrets = await createSecrets({
      env,
      file: path.join(home, "secrets.json"),
      trackNames: [TOKEN_NAME],
    });
    const store = createStore(path.join(home, "state"), { redact: secrets.redact });
    const logger = Object.fromEntries(["info", "warn", "error"].map((level) => [
      level,
      (...values) => logs.push(values.map(String).join(" ")),
    ]));
    handles = await bootDispatcher({
      home,
      env,
      loadedConfig: { ok: true, config },
      secrets,
      store,
      createSession: copilot.createSession,
      runtimeFactory: async ({ id }) => ({ ...copilot.runtime, id }),
      logger,
      now: () => clock.now().getTime(),
      ...(schedulerTickMs ? { schedulerTickMs } : {}),
    });
    await fakeTelegram.waitForCall("setMyCommands", (_args, entry) =>
      fakeTelegram.calls.indexOf(entry) >= 0
        && fakeTelegram.menus().length >= 2, startupTimeoutMs);
    return { handles, store };
  }

  try {
    let active = await boot();
    async function jobs() {
      return currentJobs(active.store);
    }
    async function audit(type) {
      const rows = await readJsonLines(path.join(home, "state", "audit.jsonl"));
      return type ? rows.filter((row) => row.kind === type || row.type === type) : rows;
    }
    async function waitForJob(id, status, { timeoutMs = 5000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        const job = currentJobs(active.store)[id];
        if (job?.state === status) return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for job ${id} to reach ${status}`);
    }
    async function grepStateFor(value) {
      const candidates = await listFiles(home);
      const persisted = await Promise.all(candidates.map((file) => readFile(file, "utf8")));
      const outbound = fakeTelegram.calls
        .filter(({ method }) => method === "sendMessage" || method === "editMessageText")
        .map(({ args }) => String(args.text ?? ""))
        .join("\n");
      return [...persisted, logs.join("\n"), outbound].some((text) => text.includes(value));
    }
    const rig = {
      home,
      config,
      repos: repos.projects,
      fakeTelegram,
      env,
      clock,
      copilot,
      logs,
      get handles() { return handles; },
      async jobs() { return jobs(); },
      async audit(type) { return audit(type); },
      async mcpCalls(projectId = repos.projects[0].id) {
        const project = repos.projects.find((entry) => entry.id === projectId);
        return project ? readJsonLines(project.logPath) : [];
      },
      waitForJob,
      editsFor(messageId) {
        return fakeTelegram.edits("42", messageId).map(({ args }) => args.text);
      },
      grepStateFor,
      send(text, { user = OWNER_ID, thread, forwarded = false, chat = "42" } = {}) {
        return fakeTelegram.pushMessage({
          text,
          userId: user,
          chatId: chat,
          ...(thread === undefined ? {} : { threadId: thread }),
          ...(forwarded ? { forward_origin: { type: "user", sender_user: { id: "999" }, date: 1 } } : {}),
        });
      },
      tap(callbackData, { user = OWNER_ID, chat = "42", thread } = {}) {
        return fakeTelegram.pushCallback({
          data: callbackData,
          userId: user,
          chatId: chat,
          ...(thread === undefined ? {} : { threadId: thread }),
        });
      },
      async restart() {
        await handles.stop();
        handles = null;
        active = await boot();
      },
      async teardown() {
        if (disposed) return;
        disposed = true;
        try {
          await handles?.stop();
        } finally {
          handles = null;
          await fakeTelegram.close();
          await repos.cleanup();
          await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
        }
      },
    };
    return rig;
  } catch (error) {
    try {
      await handles?.stop();
    } finally {
      await fakeTelegram.close();
      await repos.cleanup();
      await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
    throw error;
  }
}
