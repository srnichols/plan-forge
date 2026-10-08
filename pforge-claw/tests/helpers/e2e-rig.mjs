import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../src/app.mjs";
import { createRegistry, resolveMcpLaunch } from "../../src/registry.mjs";
import { createProjectClients } from "../../src/mcp/project-client.mjs";
import chat from "../../src/features/chat.mjs";
import { createSecrets } from "../../src/secrets.mjs";
import { createStore } from "../../src/state/store.mjs";
import { startFakeTelegram } from "./fake-telegram.mjs";
import { createFixtureRepos } from "./fixture-repos.mjs";

const FAKE_TELEGRAM_TOKEN = "123456:fixture-telegram-token";
const OWNER_ID = "701";
const APPROVER_ID = "702";
const VIEWER_ID = "703";

export function cleanChildEnvironment(source = process.env) {
  const env = { ...source };
  for (const name of Object.keys(env)) {
    if (name === "GH_TOKEN" || name === "GITHUB_TOKEN"
      || name === "PFORGE_CLAW_TELEGRAM_TOKEN" || name.startsWith("COPILOT_")) {
      delete env[name];
    }
  }
  return env;
}

function buildConfig({ fakeTelegram, projects }) {
  return {
    v: 1,
    instanceId: "e2e-fixture",
    timezone: "Etc/UTC",
    channels: {
      telegram: {
        enabled: true,
        botTokenSecret: "PFORGE_CLAW_TELEGRAM_TOKEN",
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
    runtimes: { default: "copilot-sdk", pforgeCommand: "auto" },
    lanes: [
      { id: "local", kind: "local", labels: ["local"], enabled: true },
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
    http: { bind: "127.0.0.1", port: 0 },
  };
}

export async function createE2ERig({
  startupTimeoutMs = 5000,
  clock,
  schedules = [],
  schedulerTickMs,
} = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "pforge claw e2e-"));
  const fixtureRoot = path.join(home, "fixture repos with spaces");
  const repos = await createFixtureRepos(3, {
    directory: fixtureRoot,
    withForge: true,
    ghShim: true,
  });
  const fakeTelegram = await startFakeTelegram();
  const config = buildConfig({ fakeTelegram, projects: repos.projects });
  config.schedules = schedules;
  const childEnv = cleanChildEnvironment();
  let app;
  let startup;
  let store;
  let releaseLock;
  let clients;
  let disposed = false;

  async function boot() {
    const secrets = await createSecrets({
      env: { ...childEnv, PFORGE_CLAW_TELEGRAM_TOKEN: FAKE_TELEGRAM_TOKEN },
      trackNames: ["PFORGE_CLAW_TELEGRAM_TOKEN"],
    });
    store = createStore(path.join(home, "state"), { redact: secrets.redact });
    releaseLock = store.lock();
    const projectRegistry = createRegistry(config);
    const registry = { ...projectRegistry, resolveMcpLaunch };
    const logger = { info() {}, warn() {}, error() {} };
    clients = createProjectClients({ config, registry, logger });
    const context = {
      home,
      config,
      secrets,
      store,
      registry,
      projectRegistry,
      logger,
      bus: new EventEmitter(),
      mcp: clients,
      ...(clock ? { now: () => clock.now().getTime() } : {}),
      ...(schedulerTickMs ? { schedulerTickMs } : {}),
    };
    app = createApp(context);
    startup = app.start();
    startup.catch(() => {});
    await fakeTelegram.waitForCall("setMyCommands", (_args, entry) =>
      fakeTelegram.calls.filter(({ method }) => method === "setMyCommands").indexOf(entry) >= 2,
    startupTimeoutMs);
    return context;
  }

  let context;
  try {
    context = await boot();
  } catch (error) {
    await chat.stop({ mcp: { closeAll: async () => {} } }).catch(() => {});
    releaseLock?.();
    await fakeTelegram.close();
    await repos.cleanup();
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    throw error;
  }

  async function stopApp() {
    if (!app) return;
    try {
      await chat.stop(context);
      await startup;
      await app.stop();
    } finally {
      releaseLock?.();
      releaseLock = null;
      app = null;
      startup = null;
    }
  }

  return {
    home,
    config,
    repos: repos.projects,
    fakeTelegram,
    childEnv,
    get startup() { return startup; },
    send({ text, chatId = 42, userId = OWNER_ID, threadId, ...message } = {}) {
      return fakeTelegram.pushMessage({ chatId, userId, text, threadId, ...message });
    },
    tap(callbackData, fromUser = OWNER_ID, { chatId = 42, threadId } = {}) {
      return fakeTelegram.pushCallback({
        data: callbackData,
        userId: fromUser,
        chatId,
        threadId,
      });
    },
    async restart() {
      await stopApp();
      fakeTelegram.reset({ preserveUpdateSequence: true });
      context = await boot();
    },
    async teardown() {
      if (disposed) return;
      disposed = true;
      try {
        await stopApp();
      } finally {
        await fakeTelegram.close();
        await repos.cleanup();
        await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      }
    },
  };
}
