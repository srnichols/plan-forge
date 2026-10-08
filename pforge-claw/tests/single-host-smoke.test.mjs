import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootDispatcher } from "../src/cli/start.mjs";
import { currentJobs, JOBS_STREAM } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { startFakeTelegram } from "./helpers/fake-telegram.mjs";
import { createFixtureRepos } from "./helpers/fixture-repos.mjs";
import { createScriptedCopilot } from "./helpers/scripted-copilot.mjs";
import { createApp as createRealApp } from "../src/app.mjs";

const execFileAsync = promisify(execFile);
const temporaryRoots = [];
const originalEnv = new Map();
const ENV_KEYS = [
  "PFORGE_CLAW_TELEGRAM_TOKEN",
  "PFORGE_CLAW_FIXTURE_ROOT",
  "PFORGE_CLAW_GH_LOG",
];

async function git(repoPath, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], { windowsHide: true });
  return stdout.trim();
}

function parseJsonLines(text) {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function setFixtureEnvironment(values) {
  for (const key of ENV_KEYS) {
    if (!originalEnv.has(key)) originalEnv.set(key, process.env[key]);
    process.env[key] = values[key];
  }
}

function restoreFixtureEnvironment() {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
}

afterEach(async () => {
  restoreFixtureEnvironment();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 25,
  })));
});

describe("single-host Forge-Claw smoke", () => {
  it("runs ask, plan approval, worktree execution, and publishing through the real dispatcher", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "claw dispatcher smoke-"));
    temporaryRoots.push(root);
    const fixtureRoot = path.join(root, "fixture repos");
    const repos = await createFixtureRepos(1, { directory: fixtureRoot, ghShim: true });
    const projectRepo = repos.projects[0];
    const telegram = await startFakeTelegram();
    const ghLog = path.join(fixtureRoot, "fake-gh-calls.jsonl");
    setFixtureEnvironment({
      PFORGE_CLAW_TELEGRAM_TOKEN: "fixture-telegram-token",
      PFORGE_CLAW_FIXTURE_ROOT: root,
      PFORGE_CLAW_GH_LOG: ghLog,
    });

    const projectId = "fixture-1";
    const home = path.join(root, "claw-home");
    const config = {
      v: 1,
      instanceId: "slice-30-smoke",
      timezone: "Etc/UTC",
      channels: {
        telegram: {
          enabled: true,
          botTokenSecret: "PFORGE_CLAW_TELEGRAM_TOKEN",
          mode: "poll",
          apiBase: telegram.apiBase,
          generalChat: { chatId: "42" },
        },
      },
      allowlist: [
        { channel: "telegram", userId: "701", role: "owner", alias: "Owner" },
        { channel: "telegram", userId: "702", role: "approver", alias: "Approver" },
      ],
      policy: { ghcpRoles: ["owner"] },
      runtimes: {
        default: "copilot-sdk",
        pforgeCommand: [process.execPath, path.resolve("tests/helpers/fake-pforge.mjs")],
        ghCommand: repos.ghShim.command,
      },
      lanes: [{ id: "local", kind: "local", enabled: true, concurrency: 1 }],
      projects: [{
        id: projectId,
        displayName: "Slice 30 fixture",
        repo: { path: projectRepo.repoPath, baseBranch: "main" },
        channel: { adapter: "telegram", chatId: "42", topicId: "101" },
        homeLane: "local",
        placement: { prefer: ["local"], requires: [] },
      }],
      http: { bind: "127.0.0.1", port: 0 },
    };
    const secrets = await createSecrets({
      env: process.env,
      trackNames: ["PFORGE_CLAW_TELEGRAM_TOKEN"],
    });
    const store = createStore(path.join(home, "state"), { redact: secrets.redact });
    const scripted = createScriptedCopilot();
    const bus = new (await import("node:events")).EventEmitter();
    const laneEvents = [];
    bus.on("lane.event", (event) => laneEvents.push(event));
    const initialHead = await git(projectRepo.repoPath, "rev-parse", "HEAD");
    let handles;

    try {
      handles = await bootDispatcher({
        home,
        env: process.env,
        loadedConfig: { ok: true, config },
        validateConfig: async () => ({ ok: true }),
        secrets,
        store,
        bus,
        runtimeFactory: async ({ id }) => ({ ...scripted.runtime, id }),
        createApp(ctx) {
          return createRealApp({ ...ctx, approvalIntervalMs: 10 });
        },
        logger: { info() {}, warn() {}, error() {} },
      });

      telegram.pushMessage({ chatId: 42, userId: 701, threadId: 101, text: "/ask execute the demo plan" });
      await vi.waitFor(() => expect(telegram.calls
        .filter(({ method }) => method === "editMessageText")
        .map(({ args }) => args.text))
        .toEqual(expect.arrayContaining([expect.stringContaining("A deterministic fixture response\\.")])), {
        timeout: 10_000, interval: 20,
      });

      telegram.pushMessage({
        chatId: 42, userId: 701, threadId: 101, text: "/run Phase-1-DEMO-PLAN.md",
      });
      await vi.waitFor(() => expect(
        telegram.calls.some(({ method, args }) => method === "sendMessage"
          && String(args.text).includes("Approval required for plan job")),
      ).toBe(true), { timeout: 10_000, interval: 20 });
      const approvalCard = telegram.calls.find(({ method, args }) => method === "sendMessage"
        && String(args.text).includes("Approval required for plan job"));
      const approvalData = approvalCard.args.reply_markup.inline_keyboard[0][0].callback_data;
      telegram.pushCallback({
        chatId: 42, userId: 702, threadId: 101, data: approvalData, callbackId: "approve-plan",
      });

      await vi.waitFor(() => {
        const job = Object.values(currentJobs(store)).find((entry) => entry.type === "plan");
        return expect(["succeeded", "failed", "cancelled"]).toContain(job?.state);
      }, { timeout: 30_000, interval: 25 });
      const job = Object.values(currentJobs(store)).find((entry) => entry.type === "plan");
      const records = [...store.read(JOBS_STREAM)].map(({ record }) => record);
      const history = records.filter((record) => record.kind === "job.transition" && record.jobId === job.id);
      expect(history.map((event) => event.to)).toEqual([
        "awaiting-approval", "approved", "leased", "running", "succeeded",
      ]);
      expect(job.state).toBe("succeeded");
      expect(history.at(-1).result).toMatchObject({
        branch: `claw/${job.id}`,
        prUrl: "https://example.test/pr/1",
      });
      expect(laneEvents.filter((event) => event.jobId === job.id)
        .map(({ type, data }) => ({ type, data }))).toContainEqual(expect.objectContaining({
        type: "artifact",
        data: expect.objectContaining({ kind: "pr", url: "https://example.test/pr/1" }),
      }));
      await vi.waitFor(() => expect(telegram.edits("42")
        .some(({ args }) => String(args.text).replaceAll("\\", "")
          .includes("https://example.test/pr/1"))).toBe(true), {
        timeout: 10_000, interval: 25,
      });

      const ghCalls = parseJsonLines(await readFile(ghLog, "utf8"));
      expect(ghCalls.some(({ args }) => args[0] === "pr" && args[1] === "create")).toBe(true);
      const { stdout: pushedRef } = await execFileAsync("git", [
        "--git-dir", projectRepo.originPath, "rev-parse", `refs/heads/claw/${job.id}`,
      ], { windowsHide: true });
      expect(pushedRef.trim()).toBeTruthy();
      expect(await git(projectRepo.repoPath, "rev-parse", "HEAD")).toBe(initialHead);
      expect(await git(projectRepo.repoPath, "status", "--porcelain")).toBe("");

      await expect(handles.stop()).resolves.toBeUndefined();
      expect(handles.stopped).toBe(true);
    } finally {
      if (handles) await handles.stop().catch(() => {});
      await telegram.close();
      await repos.cleanup();
    }
  }, 45_000);
});
