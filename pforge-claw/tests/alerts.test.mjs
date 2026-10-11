import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import alertsCallback from "../src/callbacks/x.mjs";
import alertsFeature from "../src/features/alerts.mjs";
import {
  ALERT_DEFAULTS,
  bindAlertsService,
  createAlertsService,
  fingerprint,
  getAlertsService,
} from "../src/alerts.mjs";
import { createStore } from "../src/state/store.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { createRegistry } from "../src/registry.mjs";
import { ROLES } from "../src/enums.mjs";

const PROJECT = {
  id: "project-one",
  repo: { path: "C:\\workspace\\project-one" },
  channel: { chatId: "chat-1", topicId: "topic-1" },
};
const directories = [];
const fixtureHome = fileURLToPath(new URL("../.forge/", import.meta.url));
mkdirSync(fixtureHome, { recursive: true });
const FIXTURE_ROOT = mkdtempSync(join(fixtureHome, "claw-alerts-suite-"));

function makeStore(directory = mkdtempSync(join(FIXTURE_ROOT, "claw-alerts-"))) {
  if (!directories.includes(directory)) directories.push(directory);
  return createStore(directory);
}

function makeChannel() {
  return { send: vi.fn(async () => ({ messageId: "sent-1" })) };
}

function insight(seq, {
  id = `insight-${seq}`,
  summary = `Failure ${seq}`,
  eventType = "gate-failed",
  severity = "warn",
  suggestedAction = null,
} = {}) {
  return {
    seq,
    ts: new Date(1_700_000_000_000 + seq).toISOString(),
    insight: {
      id,
      severity,
      summary,
      evidence: [{ eventType, ref: `slice-${seq}` }, { eventType: "run-failed", ref: "run-1" }],
      suggestedAction,
    },
  };
}

function statusPage(items, { hasMore = false, nextCursor = null, stopped = false } = {}) {
  return {
    ok: true,
    status: { stopped, connected: !stopped },
    insights: { items, nextCursor, hasMore, total: items.length, truncated: false },
  };
}

function makeAlertConfig(projects = [PROJECT]) {
  return {
    projects,
    lanes: [],
    allowlist: [
      { channel: "telegram", userId: "owner-1", role: ROLES[0] },
      { channel: "telegram", userId: "approver-1", role: ROLES[1] },
      { channel: "telegram", userId: "viewer-1", role: ROLES[2] },
    ],
    policy: { ghcpRoles: [ROLES[0]], nonOwnerRuntime: "byok-only" },
  };
}

function createService({
  store = makeStore(),
  mcp = { call: vi.fn(async () => statusPage([])) },
  channel = makeChannel(),
  registry = { all: () => [PROJECT], byId: (id) => id === PROJECT.id ? PROJECT : undefined },
  config = makeAlertConfig(registry.all()),
  getConfig,
  lanes,
  options = {},
  secrets,
  logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  now = Date.now,
} = {}) {
  return {
    store,
    mcp,
    channel,
    logger,
    config,
    service: createAlertsService({
      store, mcp, registry, channel, config, getConfig, lanes, logger, secrets, now, options,
    }),
  };
}

function records(store, stream = "alerts") {
  return [...store.read(stream)].map(({ record }) => record);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T18:00:00.000Z"));
});

afterEach(async () => {
  await alertsFeature.stop();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

afterAll(() => rmSync(FIXTURE_ROOT, { recursive: true, force: true }));

describe("alert observer polling", () => {
  it("keeps generated alert state outside the product source inventory", () => {
    makeStore();
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    expect(relative(packageRoot, directories.at(-1)).split(sep)[0]).toBe(".forge");
  });

  it("passes page cursors, follows pages, and persists high-water and resume cursors", async () => {
    const directory = mkdtempSync(join(FIXTURE_ROOT, "claw-alerts-pages-"));
    directories.push(directory);
    const store = makeStore(directory);
    const calls = [];
    const mcp = {
      call: vi.fn(async (_id, _tool, args) => {
        calls.push(args);
        if (calls.length === 1) {
          return statusPage([insight(4), insight(3)], { hasMore: true, nextCursor: "3" });
        }
        return statusPage([insight(2), insight(1)], { hasMore: false });
      }),
    };
    const first = createService({
      store, mcp, options: { pageLimit: 2, maxPages: 1 },
    }).service;

    await first.pollProject(PROJECT);
    expect(calls[0]).toMatchObject({ action: "status", limit: 2 });
    expect(calls[0]).not.toHaveProperty("cursor");
    expect(store.readJson("cursors.json", null)).toMatchObject({
      v: 1,
      projects: { [PROJECT.id]: { insightSeq: 4, resumeCursor: "3", source: "observer" } },
    });

    const resumed = createService({
      store: makeStore(directory),
      mcp,
      options: { pageLimit: 2, maxPages: 2 },
    }).service;
    await resumed.pollProject(PROJECT);
    expect(calls[1]).toMatchObject({ action: "status", limit: 2, cursor: "3" });
    expect(records(store)).toHaveLength(4);
    expect(store.readJson("cursors.json", null).projects[PROJECT.id])
      .toMatchObject({ insightSeq: 4, resumeCursor: null });
  });

  it("stops at the saved high-water mark and suppresses repeats after observer restart", async () => {
    const store = makeStore();
    store.writeJsonAtomic("cursors.json", {
      v: 1, projects: { [PROJECT.id]: { insightSeq: 8, resumeCursor: null } },
    });
    store.append("alerts", {
      kind: "alert.emitted",
      projectId: PROJECT.id,
      eventType: "gate-failed",
      insightId: "insight-2",
      fp: fingerprint({ projectId: PROJECT.id, eventType: "gate-failed", text: "Failure 2" }),
      ref: "deadbeef",
    });
    const mcp = { call: vi.fn(async () => statusPage([insight(10), insight(8), insight(7)])) };
    const { service } = createService({ store, mcp });
    await service.pollProject(PROJECT);
    expect(records(store).filter((record) => record.kind === "alert.emitted")).toHaveLength(2);

    mcp.call.mockResolvedValueOnce(statusPage([insight(2)]));
    await service.pollProject(PROJECT);
    expect(records(store).filter((record) => record.kind === "alert.emitted")).toHaveLength(2);
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].insightSeq).toBe(2);
  });

  it("handles truncation diagnostically and rejects repeated or increasing cursors", async () => {
    const { service, mcp, logger } = createService({
      options: { pageLimit: 1, maxPages: 4 },
      mcp: { call: vi.fn()
        .mockResolvedValueOnce({
          ...statusPage([insight(3)], { hasMore: true, nextCursor: "3" }),
          insights: { items: [insight(3)], hasMore: true, nextCursor: "3", truncated: true },
        })
        .mockResolvedValueOnce({
          ...statusPage([insight(2)], { hasMore: true, nextCursor: "3" }),
          insights: { items: [insight(2)], hasMore: true, nextCursor: "3", truncated: false },
        }) },
    });
    await service.pollProject(PROJECT);
    expect(mcp.call).toHaveBeenCalledTimes(2);
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("alert delivery and dedupe", () => {
  it("dedupes by insight id across a service restart", async () => {
    const directory = mkdtempSync(join(FIXTURE_ROOT, "claw-alerts-dedupe-"));
    directories.push(directory);
    const store = makeStore(directory);
    const page = statusPage([insight(4, { id: "same-id" })]);
    const first = createService({ store, mcp: { call: vi.fn(async () => page) } });
    await first.service.pollProject(PROJECT);
    const second = createService({ store: makeStore(directory), mcp: { call: vi.fn(async () => page) } });
    await second.service.pollProject(PROJECT);
    expect(records(store).filter((record) => record.kind === "alert.emitted")).toHaveLength(1);
    expect(first.channel.send).toHaveBeenCalledTimes(1);
  });

  it("uses normalized redacted text for fingerprints", () => {
    expect(fingerprint({
      projectId: PROJECT.id,
      eventType: "gate-failed",
      text: "Run 123 failed at 2026-10-07T18:00:00Z id abcdef0123456789",
    })).toBe(fingerprint({
      projectId: PROJECT.id,
      eventType: "gate-failed",
      text: "Run 456 failed at 2026-10-08T19:01:00Z id fedcba9876543210",
    }));
    expect(fingerprint({
      projectId: PROJECT.id, eventType: "run-failed", text: "same text",
    })).not.toBe(fingerprint({
      projectId: "another-project", eventType: "gate-failed", text: "same text",
    }));
  });

  it("suppresses matching project/type fingerprints only inside the dedupe window", async () => {
    const channel = makeChannel();
    const mcp = {
      call: vi.fn()
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T18:00:00.000Z", type: "liveguard", summary: "Same alert" }] })
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T18:01:00.000Z", type: "liveguard", summary: "Same alert" }] })
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T18:02:00.000Z", type: "liveguard", summary: "Same alert" }] }),
    };
    const { service } = createService({ channel, mcp });
    await service.pollProject(PROJECT);
    await service.pollProject(PROJECT);
    expect(channel.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ALERT_DEFAULTS.dedupeWindowMs + 1);
    await service.pollProject(PROJECT);
    expect(channel.send).toHaveBeenCalledTimes(2);
  });

  it("keeps identical alert text distinct across projects and event types", async () => {
    const secondProject = {
      ...PROJECT,
      id: "project-two",
      channel: { chatId: "chat-2", topicId: "topic-2" },
    };
    const projects = [PROJECT, secondProject];
    const registry = {
      all: () => projects,
      byId: (id) => projects.find((project) => project.id === id),
    };
    const channel = makeChannel();
    const mcp = {
      call: vi.fn()
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T18:00:00Z", type: "liveguard", summary: "Same alert" }] })
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T18:00:00Z", type: "liveguard", summary: "Same alert" }] })
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T18:01:00Z", type: "drift-alert", summary: "Same alert" }] }),
    };
    const { service } = createService({ registry, channel, mcp });
    await service.pollProject(PROJECT);
    await service.pollProject(secondProject);
    await service.pollProject(PROJECT);
    expect(channel.send).toHaveBeenCalledTimes(3);
  });

  it("does not record emission or advance the cursor when sending fails", async () => {
    const store = makeStore();
    const channel = { send: vi.fn(async () => { throw new Error("offline"); }) };
    const { service } = createService({
      store, channel, mcp: { call: vi.fn(async () => statusPage([insight(4)])) },
    });
    await expect(service.pollProject(PROJECT)).rejects.toThrow("offline");
    channel.send.mockResolvedValueOnce({ ok: false, error: "CHANNEL_UNAVAILABLE" });
    await expect(service.pollProject(PROJECT)).rejects.toThrow("CHANNEL_UNAVAILABLE");
    expect(records(store).filter((record) => record.kind === "alert.emitted")).toHaveLength(0);
    expect(store.readJson("cursors.json", null)?.projects?.[PROJECT.id]?.insightSeq ?? 0).toBe(0);
  });

  it("replays a partially delivered observer page without losing older items", async () => {
    const store = makeStore();
    const channel = makeChannel();
    channel.send
      .mockResolvedValueOnce({ messageId: "first" })
      .mockRejectedValueOnce(new Error("temporary send failure"))
      .mockResolvedValue({ messageId: "retry" });
    const mcp = { call: vi.fn(async () => statusPage([insight(3), insight(2), insight(1)])) };
    const { service } = createService({ store, channel, mcp });
    await expect(service.pollProject(PROJECT)).rejects.toThrow("temporary send failure");
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].insightSeq ?? 0).toBe(0);
    await service.pollProject(PROJECT);
    expect(records(store).filter((record) => record.kind === "alert.emitted")).toHaveLength(3);
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].insightSeq).toBe(3);
  });

  it("skips fallback polling for a sleeping project without keepAlive when isOpen is false", async () => {
    const mcp = {
      isOpen: vi.fn(() => false),
      call: vi.fn(async () => statusPage([], { stopped: true })),
    };
    const { service } = createService({ mcp });
    await service.pollProject(PROJECT);
    expect(mcp.isOpen).toHaveBeenCalledWith(PROJECT.id);
    expect(mcp.call).toHaveBeenCalledTimes(1);
    expect(service.sourceFor(PROJECT.id)).toBe("watch-live");
  });

  it("redacts, escapes, bounds evidence and provides short callbacks", async () => {
    const canary = "alert-secret-canary";
    const directory = mkdtempSync(join(FIXTURE_ROOT, "claw-alerts-redact-"));
    directories.push(directory);
    const store = createStore(directory, {
      redact: (text) => String(text).replaceAll(canary, "[redacted]"),
    });
    const channel = makeChannel();
    const { service } = createService({
      store, channel,
      secrets: { redact: (text) => String(text).replaceAll(canary, "[redacted]") },
      mcp: { call: vi.fn(async () => statusPage([insight(1, {
        summary: `Leaked ${canary} *failure*`,
        suggestedAction: { type: "task", args: { task: "fix issue" } },
      })])) },
    });
    await service.pollProject(PROJECT);
    const sent = channel.send.mock.calls[0][0];
    expect(sent.text).not.toContain(canary);
    expect(sent.replyMarkup.inline_keyboard.flat().map((entry) => Buffer.byteLength(entry.callback_data)))
      .toEqual(expect.arrayContaining([12]));
    expect(sent.replyMarkup.inline_keyboard.flat().every((entry) => Buffer.byteLength(entry.callback_data) <= 64)).toBe(true);
    expect(readFileSync(join(directory, "alerts.jsonl"), "utf8")).not.toContain(canary);
  });
});

describe("fallback and stale-work nudges", () => {
  it.each([
    ["stopped status", statusPage([], { stopped: true })],
    ["returned unavailable", { ok: false, error: "FORGE_MASTER_UNAVAILABLE" }],
  ])("uses watch-live for %s", async (_name, result) => {
    const mcp = {
      call: vi.fn()
        .mockResolvedValueOnce(result)
        .mockResolvedValueOnce({
          events: [{ ts: "2026-10-07T17:59:00.000Z", type: "liveguard", summary: "Drift issue" }],
        }),
    };
    const { service } = createService({ mcp });
    await service.pollProject(PROJECT);
    expect(mcp.call.mock.calls[1]).toEqual([
      PROJECT.id,
      "forge_watch_live",
      expect.objectContaining({
        targetPath: PROJECT.repo.path,
        durationMs: ALERT_DEFAULTS.watchDurationMs,
        maxCapturedEvents: ALERT_DEFAULTS.watchMaxEvents,
        verbose: true,
      }),
    ]);
    expect(service.sourceFor(PROJECT.id)).toBe("watch-live");
  });

  it("falls back for a thrown unavailable error and persists watchTs", async () => {
    const store = makeStore();
    const mcp = {
      call: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("not available"), { code: "FORGE_MASTER_UNAVAILABLE" }))
        .mockResolvedValueOnce({ events: [{ ts: "2026-10-07T17:58:00Z", type: "run-failed", summary: "failed" }] }),
    };
    const { service } = createService({ store, mcp });
    await service.pollProject(PROJECT);
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].watchTs).toBe("2026-10-07T17:58:00Z");
  });

  it("does not fall back for unrelated errors", async () => {
    const mcp = { call: vi.fn().mockRejectedValue(Object.assign(new Error("bad input"), { code: "INVALID_INPUT" })) };
    const { service, logger } = createService({ mcp });
    await expect(service.pollProject(PROJECT)).rejects.toThrow("bad input");
    expect(mcp.call).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("collects stale, held-budget, and failed-worktree nudges at strict thresholds", async () => {
    const store = makeStore();
    const worktree = mkdtempSync(join(FIXTURE_ROOT, "claw-alert-worktree-"));
    directories.push(worktree);
    store.append("jobs", { kind: "job.created", job: {
      id: "held-job", projectId: PROJECT.id, type: "task", state: "queued", mutating: true,
      createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    } });
    store.append("jobs", { kind: "job.transition", jobId: "held-job", from: "queued", to: "awaiting-approval" });
    store.append("jobs", { kind: "job.transition", jobId: "held-job", from: "awaiting-approval", to: "approved" });
    vi.setSystemTime(Date.now() - 24 * 3_600_000);
    store.append("jobs", { kind: "job.transition", jobId: "held-job", from: "approved", to: "held-budget", ts: new Date(Date.now() - 24 * 3_600_000 - 1).toISOString() });
    vi.setSystemTime(new Date("2026-10-07T18:00:00.000Z"));
    store.append("jobs", { kind: "job.created", job: {
      id: "failed-job", projectId: PROJECT.id, type: "task", state: "queued", mutating: true,
      worktreePath: worktree, createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    } });
    for (const [from, to] of [
      ["queued", "awaiting-approval"],
      ["awaiting-approval", "approved"],
      ["approved", "leased"],
      ["leased", "running"],
      ["running", "failed"],
    ]) store.append("jobs", { kind: "job.transition", jobId: "failed-job", from, to });
    const hardenedAt = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const mcp = { call: vi.fn(async (_id, tool) => tool === "forge_plan_status"
      ? { ok: true, hardened: true, hardenedAt, lastRunAt: null }
      : statusPage([])) };
    const { service, channel } = createService({ store, mcp });
    const nudges = await service.collectNudges();
    expect(nudges.map((item) => item.eventType)).toEqual(["nudge.failed-worktree"]);
    await vi.advanceTimersByTimeAsync(1);
    const beyondThreshold = await service.collectNudges();
    expect(beyondThreshold.map((item) => item.eventType)).toEqual(expect.arrayContaining([
      "nudge.stale-phase", "nudge.held-budget",
    ]));
    expect(channel.send).toHaveBeenCalledTimes(3);

    store.append("jobs", { kind: "job.transition", jobId: "held-job", from: "held-budget", to: "approved" });
    store.append("audit", { kind: "worktree.cleaned", jobId: "failed-job", path: worktree });
    const fresh = createService({ store, mcp }).service;
    const remaining = await fresh.collectNudges();
    expect(remaining.map((item) => item.eventType)).not.toContain("nudge.held-budget");
    expect(remaining.map((item) => item.eventType)).not.toContain("nudge.failed-worktree");
  });

  it("does not nudge when hardening or run-history timestamps are unknown", async () => {
    const { service, channel, logger } = createService({
      mcp: { call: vi.fn(async () => ({
        ok: true,
        plans: [
          { status: "hardened", hardenedAt: null, neverRun: true },
          { status: "hardened", hardenedAt: "2026-09-01T00:00:00.000Z" },
        ],
      })) },
    });
    expect(await service.collectNudges()).toEqual([]);
    expect(channel.send).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("alert actions and feature checks", () => {
  it("prepares draft tasks for d/s, routes b through bug capture, and returns duplicate task action", async () => {
    const store = makeStore();
    const { service } = createService({ store });
    const emission = {
      v: 1, kind: "alert.emitted", projectId: PROJECT.id, eventType: "run-failed",
      fp: "a".repeat(64), ref: "aaaaaaaa", ts: Date.now(), summary: "build failed",
      suggestedAction: { type: "task", args: { task: "unsafe suggestion" } },
    };
    store.append("alerts", emission);
    const d = await service.handleAction({
      action: "d", ref: emission.ref, caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId,
    });
    const duplicate = await service.handleAction({
      action: "d", ref: emission.ref, caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId,
    });
    expect(d.jobId).toBe(duplicate.jobId);
    const suggestedEmission = {
      ...emission,
      fp: "b".repeat(64),
      ref: "bbbbbbbb",
    };
    store.append("alerts", suggestedEmission);

    const s = await service.handleAction({
      action: "s", ref: suggestedEmission.ref, caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId,
    });
    expect(s.jobId).toBeTruthy();
    expect(Object.values(currentJobs(store))).toHaveLength(2);
    expect(Object.values(currentJobs(store)).every((job) => job.state === "awaiting-approval")).toBe(true);
    expect(Object.values(currentJobs(store)).some((job) => job.description.startsWith("⚠️ from observer insight"))).toBe(true);
    expect(records(store).filter((record) => record.kind === "alert.action").length).toBeGreaterThanOrEqual(3);

    const bugStore = makeStore();
    const bugMcp = { call: vi.fn(async () => ({ ok: true })) };
    const bugService = createService({ store: bugStore, mcp: bugMcp }).service;
    bugStore.append("alerts", emission);
    const result = await bugService.handleAction({
      action: "b", ref: emission.ref, caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId,
    });
    expect(result.ok).toBe(true);
    expect(bugMcp.call).toHaveBeenCalledWith(PROJECT.id, "forge_bug_file", expect.any(Object));
  });

  it("audits invalid, wrong-role, wrong-topic and unknown callbacks without creating jobs", async () => {
    const store = makeStore();
    const { service } = createService({ store });
    const unbind = bindAlertsService(service);
    store.append("alerts", {
      kind: "alert.emitted",
      projectId: PROJECT.id,
      eventType: "run-failed",
      fp: "c".repeat(64),
      ref: "cccccccc",
      summary: "A real alert",
    });
    const context = { project: PROJECT, store };
    for (const [payload, caller, chatId, threadId] of [
      ["bad", { role: ROLES[0], userId: "u" }, "chat-1", "topic-1"],
      ["d:cccccccc", { role: ROLES[2], userId: "u" }, "chat-1", "topic-1"],
      ["d:cccccccc", { role: ROLES[0], userId: "u" }, "chat-1", "wrong"],
      ["d:aaaaaaaa", { role: ROLES[0], userId: "u" }, "chat-1", "topic-1"],
    ]) {
      await alertsCallback.handle(context, { payload, caller, chatId, threadId });
    }
    expect(records(store).filter((record) => record.kind === "alert.action")).toHaveLength(4);
    expect(currentJobs(store)).toEqual({});

    vi.setSystemTime(Date.now() - ALERT_DEFAULTS.dedupeWindowMs - 1);
    store.append("alerts", {
      kind: "alert.emitted",
      projectId: PROJECT.id,
      eventType: "run-failed",
      fp: "d".repeat(64),
      ref: "dddddddd",
      summary: "An expired alert",
    });
    vi.setSystemTime(new Date("2026-10-07T18:00:00.000Z"));
    await alertsCallback.handle(context, {
      payload: "d:dddddddd",
      caller: { role: ROLES[0], userId: "u" },
      chatId: PROJECT.channel.chatId,
      threadId: PROJECT.channel.topicId,
    });
    expect(records(store).filter((record) => record.kind === "alert.action")).toHaveLength(5);
    expect(currentJobs(store)).toEqual({});
    unbind();
  });

  it("audits and replies that alerts are not running when the service is unbound", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const { service } = createService({ store, channel });
    const unbind = bindAlertsService(service);
    unbind();
    await alertsCallback.handle({}, {
      payload: "d:aaaaaaaa",
      caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId,
      threadId: PROJECT.channel.topicId,
    });
    expect(records(store).some((record) => record.kind === "alert.action"
      && record.outcome === "alerts-not-running")).toBe(true);
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ text: "alerts not running" }));
  });

  it("reports doctor status and performs no MCP calls offline", async () => {
    const mcp = { call: vi.fn(async () => ({ ok: true, status: { stopped: false } })) };
    const offline = await alertsFeature.doctorChecks({
      live: false, registry: { all: () => [{ ...PROJECT, keepAlive: true }, { ...PROJECT, id: "project-two", keepAlive: false }] }, mcp,
    });
    expect(offline).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: `alerts:${PROJECT.id}`, status: "ok", detail: expect.stringContaining("keepAlive") }),
      expect.objectContaining({ name: "alerts:project-two", status: "warn", detail: expect.stringContaining("no keepAlive") }),
      expect.objectContaining({ name: "alerts:observer-probe", status: "skip" }),
    ]));
    expect(mcp.call).not.toHaveBeenCalled();
    const running = await alertsFeature.doctorChecks({
      live: true, registry: { all: () => [PROJECT] }, mcp,
    });
    expect(running[0]).toMatchObject({ status: "ok" });
    mcp.call.mockResolvedValueOnce({ ok: true, status: { stopped: true } });
    const live = await alertsFeature.doctorChecks({
      live: true, registry: { all: () => [PROJECT] }, mcp,
    });
    expect(live[0]).toMatchObject({ status: "warn", detail: expect.stringContaining("forge_master_observe start") });
    mcp.call.mockResolvedValueOnce({ ok: false, error: "FORGE_MASTER_UNAVAILABLE" });
    expect(await alertsFeature.doctorChecks({
      live: true, registry: { all: () => [PROJECT] }, mcp,
    })).toMatchObject([{ status: "warn", code: "FORGE_MASTER_UNAVAILABLE" }]);
    expect(mcp.call.mock.calls.at(-1)[2]).toEqual({ action: "status" });
    mcp.call.mockResolvedValueOnce({ ok: true, status: { running: false } });
    expect(await alertsFeature.doctorChecks({
      live: true, registry: { all: () => [PROJECT] }, mcp,
    })).toMatchObject([{ status: "warn" }]);
    mcp.call.mockResolvedValueOnce({ ok: false, error: "OBSERVER_FAILED" });
    expect(await alertsFeature.doctorChecks({
      live: true, registry: { all: () => [PROJECT] }, mcp,
    })).toMatchObject([{ status: "warn", code: "OBSERVER_FAILED" }]);
  });

  it("reports an empty registry without probing MCP", async () => {
    const mcp = { call: vi.fn() };
    expect(await alertsFeature.doctorChecks({ live: true, registry: { all: () => [] }, mcp }))
      .toEqual([{ name: "alerts", status: "ok", detail: "no registered projects" }]);
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it("starts an unref'd poll timer and waits on stop without closing shared clients", async () => {
    const store = makeStore();
    const timerRef = { unref: vi.fn() };
    const setTimer = vi.fn(() => timerRef);
    const clearTimer = vi.fn();
    await alertsFeature.start({
      store,
      registry: { all: () => [] },
      mcp: { call: vi.fn() },
      channel: { send: vi.fn() },
      config: { alerts: { pollMs: 1234 } },
      setTimer,
      clearTimer,
    });
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 1234);
    expect(timerRef.unref).toHaveBeenCalledOnce();
    await alertsFeature.stop();
    expect(clearTimer).toHaveBeenCalledWith(timerRef);
  });

  it("guards source dependencies and keeps callback size limits", async () => {
    const source = readFileSync(new URL("../src/alerts.mjs", import.meta.url), "utf8");
    expect(source).not.toContain("forge-master-insight");
    expect(source).not.toMatch(/from ["']ws["']/);
    expect(source).not.toContain("WebSocket");
    const store = makeStore();
    const channel = makeChannel();
    const { service } = createService({
      store,
      channel,
      mcp: { call: vi.fn(async () => statusPage([insight(1, {
        suggestedAction: { type: "task", args: { task: "draft" } },
      })])) },
    });
    await service.pollProject(PROJECT);
    for (const item of channel.send.mock.calls[0][0].replyMarkup.inline_keyboard.flat()) {
      expect(Buffer.byteLength(item.callback_data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("alert lint packet characterization", () => {
  it("keeps the frozen defaults, raw event allowlist and public service surface", async () => {
    const alerts = await import("../src/alerts.mjs");
    expect(ALERT_DEFAULTS).toEqual({
      pollMs: 60_000, pageLimit: 25, maxPages: 3, dedupeWindowMs: 21_600_000,
      staleDays: 7, heldBudgetMs: 86_400_000, watchDurationMs: 2_000, watchMaxEvents: 50,
    });
    expect(Object.isFrozen(ALERT_DEFAULTS)).toBe(true);
    expect(alerts.RAW_EVENT_TYPES).toEqual([
      "liveguard", "liveguard-tool-completed", "secret-scan", "drift-alert", "run-failed",
    ]);
    expect(Object.isFrozen(alerts.RAW_EVENT_TYPES)).toBe(true);
    expect(Object.keys(alerts).sort()).toEqual([
      "ALERT_DEFAULTS", "RAW_EVENT_TYPES", "bindAlertsService", "createAlertsService",
      "fingerprint", "getAlertsService", "replyAlerts", "writeAlertsAudit",
    ].sort());
    expect(Object.keys(createService().service).sort()).toEqual([
      "store", "channel", "logger", "pollProject", "pollAll", "collectNudges",
      "handleAction", "sourceFor", "lastPollAt", "snapshot",
    ].sort());
  });

  it.each([
    ["structured JSON", (page) => ({ structuredContent: JSON.stringify(page) })],
    ["text content", (page) => ({ content: [{ type: "image" }, { type: "text", text: JSON.stringify(page) }] })],
  ])("pulls %s pages and skips non-finite insight sequences", async (_name, wrap) => {
    const mcp = { call: vi.fn(async () => wrap(statusPage([
      { seq: "not-a-number", insight: { summary: "ignored" } },
      insight(2),
    ]))) };
    const { service, store, channel } = createService({ mcp });
    expect(await service.pollProject(PROJECT)).toEqual({ source: "observer", resumeCursor: null });
    expect(mcp.call).toHaveBeenCalledExactlyOnceWith(
      PROJECT.id, "forge_master_observe", { action: "status", limit: 25 },
    );
    expect(channel.send).toHaveBeenCalledOnce();
    expect(store.readJson("cursors.json", null).projects[PROJECT.id]).toEqual({
      source: "observer", insightSeq: 2, resumeCursor: null,
    });
  });

  it.each([
    ["flagged tool error", { isError: true, structuredContent: { error: "OBSERVER_EDGE" } }, "OBSERVER_EDGE"],
    ["reported failure", { ok: false, error: "OBSERVER_DENIED" }, "OBSERVER_DENIED"],
    ["invalid status", { ok: true, status: [], insights: { items: [] } }, "OBSERVER_STATUS_INVALID"],
    ["invalid page", { ok: true, status: { stopped: false }, insights: { items: null } }, "OBSERVER_PAGE_INVALID"],
  ])("preserves cursor and failure reporting for %s", async (_name, raw, code) => {
    const { service, store, channel, mcp, logger } = createService({
      mcp: { call: vi.fn(async () => raw) },
    });
    store.writeJsonAtomic("cursors.json", { v: 1, projects: {
      [PROJECT.id]: { insightSeq: 8, resumeCursor: "3", source: "observer" },
    } });
    await expect(service.pollProject(PROJECT)).rejects.toMatchObject({ code });
    expect(store.readJson("cursors.json", null).projects[PROJECT.id]).toEqual({
      insightSeq: 8, resumeCursor: "3", source: "observer",
    });
    expect(service.lastPollAt).toBeNull();
    expect(service.snapshot()).toEqual({ projects: [{
      id: PROJECT.id, source: "observer", lastPollAt: null, lastError: code,
    }] });
    expect(mcp.call).toHaveBeenCalledOnce();
    expect(channel.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("Alerts project poll failed", { projectId: PROJECT.id, code });
  });

  it.each(["3", "4", "invalid", 2])("clears an invalid resumed next cursor %s only after page delivery", async (nextCursor) => {
    const { service, store, mcp, channel, logger } = createService({
      mcp: { call: vi.fn(async () => statusPage([insight(2)], { hasMore: true, nextCursor })) },
    });
    store.writeJsonAtomic("cursors.json", { v: 1, projects: {
      [PROJECT.id]: { insightSeq: 8, resumeCursor: "3" },
    } });
    expect(await service.pollProject(PROJECT)).toEqual({ source: "observer", resumeCursor: null });
    expect(mcp.call).toHaveBeenCalledExactlyOnceWith(
      PROJECT.id, "forge_master_observe", { action: "status", limit: 25, cursor: "3" },
    );
    expect(channel.send).toHaveBeenCalledOnce();
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].insightSeq).toBe(8);
    expect(logger.warn).toHaveBeenCalledWith("Observer cursor did not decrease", {
      projectId: PROJECT.id, code: "OBSERVER_CURSOR_INVALID",
    });
  });

  it("retries an undeliverable observer page without committing its high-water mark", async () => {
    const channel = {};
    const { service, store, mcp } = createService({
      channel, mcp: { call: vi.fn(async () => statusPage([insight(2)])) },
    });
    expect(await service.pollProject(PROJECT)).toEqual({ source: "observer", unavailable: true });
    expect(store.readJson("cursors.json", null).projects[PROJECT.id]).toEqual({ source: "observer" });
    expect(records(store)).toEqual([]);
    channel.send = vi.fn(async () => ({ messageId: "retry" }));
    expect(await service.pollProject(PROJECT)).toEqual({ source: "observer", headSeq: 2, resumeCursor: null });
    expect(mcp.call).toHaveBeenCalledTimes(2);
    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("filters and sorts raw LiveGuard events while preserving the original timestamp cursor", async () => {
    const lastStamp = Date.parse("2026-10-07T18:03:00.000Z");
    const { service, store, channel } = createService({
      mcp: { call: vi.fn()
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce({ events: [
          { ts: lastStamp, type: "liveguard", data: { severity: "error", message: "Later raw alert", ref: "late-ref" } },
          { timestamp: "2026-10-07T18:01:00.000Z", type: "drift-alert", summary: "Earlier raw alert" },
          { ts: "2026-10-07T18:00:00.000Z", type: "run-failed", summary: "already covered" },
          { ts: "invalid", type: "secret-scan", summary: "invalid timestamp" },
          { ts: "2026-10-07T18:02:00.000Z", type: "forge-master-insight", summary: "not raw LiveGuard" },
        ] }) },
    });
    store.writeJsonAtomic("cursors.json", { v: 1, projects: {
      [PROJECT.id]: { watchTs: "2026-10-07T18:00:00.000Z" },
    } });
    expect(await service.pollProject(PROJECT)).toEqual({ source: "watch-live", events: 2 });
    expect(channel.send.mock.calls.map(([message]) => message.text)).toEqual([
      "🟠\nEarlier raw alert\n• drift\\-alert",
      "🔴\nLater raw alert\n• liveguard: late\\-ref",
    ]);
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].watchTs).toBe(lastStamp);
  });

  it.each([
    [{ ok: false, error: "WATCH_DENIED" }, "WATCH_DENIED"],
    [{ ok: true }, "WATCH_LIVE_RESPONSE_INVALID"],
  ])("reports raw fallback failures without advancing watchTs", async (raw, code) => {
    const { service, store, channel } = createService({
      mcp: { call: vi.fn()
        .mockResolvedValueOnce(statusPage([], { stopped: true }))
        .mockResolvedValueOnce(raw) },
    });
    const watchTs = "2026-10-07T18:00:00.000Z";
    store.writeJsonAtomic("cursors.json", { v: 1, projects: { [PROJECT.id]: { watchTs } } });
    await expect(service.pollProject(PROJECT)).rejects.toMatchObject({ code });
    expect(store.readJson("cursors.json", null).projects[PROJECT.id]).toEqual({ source: "watch-live", watchTs });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it("retains card bounds, evidence bounds and nested redaction", async () => {
    const canary = "alert-characterization-canary";
    const summary = `${canary} *failure* ${"x".repeat(4000)}`;
    const item = insight(1, { summary, severity: "high", suggestedAction: { args: { detail: canary } } });
    item.insight.evidence = Array.from({ length: 5 }, (_value, index) => ({
      eventType: "gate-failed", ref: `${index}-${canary}`, nested: { detail: canary },
    }));
    const { service, channel, store } = createService({
      secrets: { redact: (text) => text.replaceAll(canary, "[redacted]") },
      mcp: { call: vi.fn(async () => statusPage([item])) },
    });
    await service.pollProject(PROJECT);
    const message = channel.send.mock.calls[0][0];
    const [emission] = records(store);
    expect(message.text).toHaveLength(3800);
    expect(message.text.startsWith("🔴\n\\[redacted\\] \\*failure\\* ")).toBe(true);
    expect(emission.summary).toHaveLength(500);
    expect(emission.evidence).toHaveLength(3);
    expect(JSON.stringify(emission)).not.toContain(canary);
    expect(message.replyMarkup.inline_keyboard.flat()).toHaveLength(3);
  });

  it("keeps restricted alerts and actions in their own project topic", async () => {
    const restricted = { ...PROJECT, id: "restricted-project", visibility: "restricted",
      channel: { chatId: "restricted-chat", topicId: "restricted-topic" } };
    const projects = [PROJECT, restricted];
    const { service, store, channel, mcp } = createService({
      registry: { all: () => projects, byId: (id) => projects.find((project) => project.id === id) },
      mcp: { call: vi.fn(async (projectId) => statusPage([
        insight(1, { id: "shared-insight-id", summary: projectId === restricted.id ? "Restricted alert content" : "Normal alert content" }),
      ])) },
    });
    expect((await service.pollAll()).map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(channel.send.mock.calls.find(([message]) => message.chatId === PROJECT.channel.chatId)[0].text)
      .not.toContain("Restricted alert content");
    expect(channel.send.mock.calls.find(([message]) => message.chatId === restricted.channel.chatId)[0])
      .toMatchObject({ threadId: restricted.channel.topicId, text: expect.stringContaining("Restricted alert content") });
    const emitted = records(store).find((record) => record.projectId === restricted.id);
    const request = { action: "d", ref: emitted.ref, caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId };
    expect(await service.handleAction(request)).toEqual({
      ok: false, error: "wrong-topic", text: "This alert belongs to a different topic.",
    });
    expect(await service.handleAction({ ...request, caller: { role: ROLES[2], userId: "viewer-1" },
      chatId: restricted.channel.chatId, topicId: restricted.channel.topicId })).toMatchObject({ ok: false, error: "role" });
    expect(currentJobs(store)).toEqual({});
    const accepted = await service.handleAction({ ...request, chatId: restricted.channel.chatId, topicId: restricted.channel.topicId });
    expect(currentJobs(store)[accepted.jobId]).toMatchObject({ projectId: restricted.id, state: "awaiting-approval", mutating: true });
    expect(await service.handleAction({ ...request, chatId: restricted.channel.chatId, topicId: restricted.channel.topicId }))
      .toMatchObject({ ok: true, duplicate: true, jobId: accepted.jobId });
    expect(mcp.call.mock.calls.every(([, tool]) => tool === "forge_master_observe")).toBe(true);
  });

  it("accepts the exact action expiry boundary and rejects the next millisecond", async () => {
    const now = Date.now();
    const { service, store, mcp } = createService({ mcp: { call: vi.fn(async () => ({ ok: true })) } });
    vi.setSystemTime(now - ALERT_DEFAULTS.dedupeWindowMs);
    store.append("alerts", { kind: "alert.emitted", projectId: PROJECT.id, ref: "eeeeeeee", summary: "Boundary alert" });
    vi.setSystemTime(now);
    const request = { action: "b", ref: "eeeeeeee", caller: { role: ROLES[1], userId: "approver-1" },
      chatId: PROJECT.channel.chatId, threadId: PROJECT.channel.topicId };
    expect(await service.handleAction(request)).toEqual({ ok: true, text: "Bug report filed." });
    await vi.advanceTimersByTimeAsync(1);
    expect(await service.handleAction(request)).toEqual({ ok: false, error: "unknown-or-expired", text: "This alert expired." });
    expect(mcp.call).toHaveBeenCalledOnce();
    expect(records(store).filter((record) => record.kind === "alert.action").map((record) => record.outcome))
      .toEqual(["accepted", "unknown-or-expired"]);
  });

  it("keeps failed bug actions unsuccessful and records the actual failure code", async () => {
    const { service, store } = createService({
      mcp: { call: vi.fn(async () => ({ isError: true, structuredContent: { error: "BUG_EDGE_FAILED" } })) },
    });
    store.append("alerts", { kind: "alert.emitted", projectId: PROJECT.id, ref: "ffffffff", summary: "Failing bug alert" });
    expect(await service.handleAction({ action: "b", ref: "ffffffff",
      caller: { role: ROLES[0], userId: "owner-1" }, chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId }))
      .toEqual({ ok: false, error: "BUG_EDGE_FAILED", text: "This alert action could not be completed." });
    expect(records(store).at(-1)).toMatchObject({ kind: "alert.action", outcome: "BUG_EDGE_FAILED" });
    expect(currentJobs(store)).toEqual({});
  });

  it("distinguishes never-run metadata from positive and unknown run history", async () => {
    const hardenedAt = new Date(Date.now() - ALERT_DEFAULTS.staleDays * 86_400_000 - 1).toISOString();
    const eligible = [
      { name: "zero-count", runCount: 0 }, { name: "false-flag", hasRun: false },
      { name: "never-flag", neverRun: true }, { name: "null-at", lastRunAt: null },
      { name: "null-run", lastRun: null },
    ];
    const alreadyRun = [
      { name: "positive-count", runCount: 1, neverRun: true },
      { name: "true-flag", hasRun: true, neverRun: true },
      { name: "known-at", lastRunAt: hardenedAt, neverRun: true },
      { name: "known-run", lastRun: "run-one", neverRun: true },
      { name: "known-id", lastRunId: "run-one", neverRun: true },
      { name: "unknown-run" },
    ];
    const { service, channel, logger } = createService({
      mcp: { call: vi.fn(async () => ({ ok: true, plans: [...eligible, ...alreadyRun].map((plan) => ({
        status: "hardened", hardenedAt, ...plan,
      })) })) },
    });
    expect(await service.collectNudges()).toHaveLength(eligible.length);
    expect(channel.send).toHaveBeenCalledTimes(eligible.length);
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith("Stale plan run history is unknown", {
      projectId: PROJECT.id, code: "ALERTS_PLAN_RUN_UNKNOWN",
    });
  });

  it("keeps per-project nudge failures isolated and records their codes", async () => {
    const other = { ...PROJECT, id: "other-project", channel: { chatId: "other-chat", topicId: "other-topic" } };
    const projects = [PROJECT, other];
    const { service, channel, logger } = createService({
      registry: { all: () => projects },
      mcp: { call: vi.fn(async (projectId) => projectId === PROJECT.id
        ? { ok: false, error: "PLAN_EDGE_FAILED" }
        : { ok: true, hardened: true, hardenedAt: "2026-09-01T00:00:00.000Z", runCount: 0, name: "Other phase" }) },
    });
    expect(await service.collectNudges()).toMatchObject([{ projectId: other.id, eventType: "nudge.stale-phase" }]);
    expect(channel.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ chatId: other.channel.chatId }));
    expect(logger.warn).toHaveBeenCalledWith("Plan status nudge check failed", {
      projectId: PROJECT.id, code: "PLAN_EDGE_FAILED",
    });
  });

  it("shares a pending project poll and clears the in-flight entry after failure", async () => {
    let fail;
    const mcp = { call: vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }))
      .mockResolvedValue(statusPage([])) };
    const { service, logger } = createService({ mcp });
    const first = service.pollProject(PROJECT);
    const second = service.pollProject(PROJECT);
    expect(mcp.call).toHaveBeenCalledOnce();
    const settled = Promise.allSettled([first, second]);
    fail(Object.assign(new Error("pending poll failed"), { code: "PENDING_EDGE_FAILED" }));
    expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
    await service.pollProject(PROJECT);
    expect(mcp.call).toHaveBeenCalledTimes(2);
    expect(service.snapshot().projects[0]).not.toHaveProperty("lastError");
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("waits for pending work on stop without closing MCP or subscribing to shared events", async () => {
    let finish;
    const mcp = { call: vi.fn((_projectId, tool) => tool === "forge_master_observe"
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ ok: true, plans: [] })), close: vi.fn() };
    const events = { on: vi.fn(), off: vi.fn() };
    const setTimer = vi.fn();
    await alertsFeature.start({ store: makeStore(), registry: { all: () => [PROJECT] },
      mcp, events, channel: makeChannel(), setTimer });
    let stopped = false;
    const stopping = alertsFeature.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(alertsFeature.snapshot()).toEqual({ projects: [] });
    finish(statusPage([]));
    await stopping;
    await vi.advanceTimersByTimeAsync(ALERT_DEFAULTS.pollMs);
    expect(mcp.call.mock.calls.map(([, tool]) => tool)).toEqual(["forge_master_observe", "forge_plan_status"]);
    expect(setTimer).not.toHaveBeenCalled();
    expect(mcp.close).not.toHaveBeenCalled();
    expect(events.on).not.toHaveBeenCalled();
    expect(events.off).not.toHaveBeenCalled();
  });

  it.each([
    [0, 60_000], [-1, 60_000], [NaN, 60_000], [Infinity, 60_000], ["1234", 1234],
  ])("preserves timer normalization for %s", async (pollMs, expected) => {
    const timerRef = { unref: vi.fn() };
    const setTimer = vi.fn(() => timerRef);
    const clearTimer = vi.fn();
    await alertsFeature.start({ store: makeStore(), registry: { all: () => [] },
      mcp: { call: vi.fn() }, channel: makeChannel(), alertsOptions: { pollMs }, setTimer, clearTimer });
    await vi.advanceTimersByTimeAsync(0);
    expect(setTimer).toHaveBeenCalledExactlyOnceWith(expect.any(Function), expected);
    expect(timerRef.unref).toHaveBeenCalledOnce();
    await alertsFeature.stop();
    expect(clearTimer).toHaveBeenCalledExactlyOnceWith(timerRef);
  });

  it.each([
    ["structured JSON", { structuredContent: JSON.stringify({ ok: true, status: { stopped: false } }) }, "ok", undefined],
    ["flagged unavailable", { isError: true, structuredContent: { error: "FORGE_MASTER_UNAVAILABLE" } }, "warn", "FORGE_MASTER_UNAVAILABLE"],
    ["stopped top-level", { ok: true, running: false }, "warn", undefined],
    ["bad JSON", { structuredContent: "not JSON" }, "warn", "MCP_TOOL_ERROR"],
  ])("preserves doctor diagnostics for %s", async (_name, raw, status, code) => {
    const mcp = { call: vi.fn(async () => raw) };
    const [check] = await alertsFeature.doctorChecks({ live: true, registry: { all: () => [PROJECT] }, mcp });
    expect(check).toMatchObject({ name: `alerts:${PROJECT.id}`, status });
    if (code === undefined) expect(check).not.toHaveProperty("code");
    else expect(check.code).toBe(code);
    expect(mcp.call).toHaveBeenCalledExactlyOnceWith(PROJECT.id, "forge_master_observe", { action: "status" });
  });
});

describe("alert lint extraction parity", () => {
  it.each(["opaque", "NaN"])("preserves the rejection comparison for a saved non-numeric cursor %s", async (resumeCursor) => {
    const { service, store, mcp, logger } = createService({
      options: { maxPages: 2 },
      mcp: { call: vi.fn()
        .mockResolvedValueOnce(statusPage([insight(4)], { hasMore: true, nextCursor: "3" }))
        .mockResolvedValueOnce(statusPage([insight(2)])) },
    });
    store.writeJsonAtomic("cursors.json", { v: 1, projects: {
      [PROJECT.id]: { insightSeq: 8, resumeCursor },
    } });
    expect(await service.pollProject(PROJECT)).toEqual({ source: "observer", resumeCursor: null });
    expect(mcp.call.mock.calls.map(([, tool, args]) => [tool, args])).toEqual([
      ["forge_master_observe", { action: "status", limit: 25, cursor: resumeCursor }],
      ["forge_master_observe", { action: "status", limit: 25, cursor: "3" }],
    ]);
    expect(store.readJson("cursors.json", null).projects[PROJECT.id]).toEqual({
      insightSeq: 8, resumeCursor: null, source: "observer",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("calls the injected service clock without a receiver in every extracted concern", async () => {
    const receivers = [];
    const clockTime = Date.now();
    function readClock() {
      receivers.push(this);
      return Date.now();
    }
    const store = makeStore();
    store.append("alerts", { kind: "alert.emitted", projectId: PROJECT.id,
      eventType: "clock-fixture", ref: "cccccccc", summary: "Clock fixture alert", ts: clockTime });
    const { service } = createService({
      store,
      now: readClock,
      mcp: { call: vi.fn(async (_projectId, tool) => {
        if (tool === "forge_master_observe") return statusPage([insight(2)]);
        if (tool === "forge_plan_status") return { ok: true, hardened: true, runCount: 0,
          name: "Clock fixture phase", hardenedAt: new Date(clockTime - 8 * 86_400_000).toISOString() };
        return { ok: true };
      }) },
    });
    await service.pollProject(PROJECT);
    expect(await service.collectNudges()).toHaveLength(1);
    expect(await service.handleAction({ action: "b", ref: "cccccccc",
      caller: { role: ROLES[0], userId: "owner-1" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId }))
      .toEqual({ ok: true, text: "Bug report filed." });
    expect(service.lastPollAt).toBe(clockTime);
    expect(records(store).filter((record) => record.kind === "alert.emitted").map((record) => Date.parse(record.ts)))
      .toEqual([clockTime, clockTime, clockTime]);
    expect(receivers.length).toBeGreaterThan(1);
    expect(receivers.every((receiver) => receiver === undefined)).toBe(true);
  });

  it("retains the effective raw cursor after partial delivery and preserves same-time events", async () => {
    const firstStamp = "2026-10-07T18:01:00.000Z";
    const finalStamp = "2026-10-07T18:02:00.000Z";
    const events = [
      { timestamp: firstStamp, type: "liveguard", summary: "First same-time alert" },
      { ts: Date.parse(firstStamp), type: "drift-alert", summary: "Second same-time alert" },
      { at: finalStamp, type: "run-failed", summary: "Later alert" },
    ];
    const channel = makeChannel();
    channel.send.mockResolvedValueOnce({ messageId: "first" })
      .mockResolvedValueOnce({ messageId: "second" })
      .mockRejectedValueOnce(new Error("LiveGuard delivery failed"))
      .mockResolvedValue({ messageId: "retry" });
    const { service, store } = createService({
      channel,
      mcp: { call: vi.fn(async (_projectId, tool) => tool === "forge_master_observe"
        ? statusPage([], { stopped: true }) : { events }) },
    });
    await expect(service.pollProject(PROJECT)).rejects.toThrow("LiveGuard delivery failed");
    expect(store.readJson("cursors.json", null).projects[PROJECT.id]).toEqual({
      source: "watch-live", watchTs: Date.parse(firstStamp),
    });
    expect(await service.pollProject(PROJECT)).toEqual({ source: "watch-live", events: 1 });
    expect(store.readJson("cursors.json", null).projects[PROJECT.id].watchTs).toBe(finalStamp);
    expect(channel.send).toHaveBeenCalledTimes(4);
    expect(records(store).filter((record) => record.kind === "alert.emitted").map((record) => record.eventType))
      .toEqual(["liveguard", "drift-alert", "run-failed"]);
    expect(service.snapshot().projects[0]).not.toHaveProperty("lastError");
  });

  it.each([
    ["flagged wrapper precedence", { isError: true, error: "WRAPPER_ERROR",
      structuredContent: { error: "PAYLOAD_ERROR" } }, "PAYLOAD_ERROR", "Observer probe failed (PAYLOAD_ERROR)."],
    ["flagged wrapper fallback", { isError: true, error: "WRAPPER_ERROR",
      structuredContent: { status: { stopped: false } } }, "WRAPPER_ERROR", "Observer probe failed (WRAPPER_ERROR)."],
    ["flagged payload default", { structuredContent: { isError: true } },
      "MCP_TOOL_ERROR", "Observer probe failed (MCP_TOOL_ERROR)."],
    ["flagged unavailable", { isError: true, structuredContent: { error: "FORGE_MASTER_UNAVAILABLE" } },
      "FORGE_MASTER_UNAVAILABLE", "Observer probe failed (FORGE_MASTER_UNAVAILABLE)."],
    ["unflagged unavailable", { structuredContent: { error: "FORGE_MASTER_UNAVAILABLE" } },
      "FORGE_MASTER_UNAVAILABLE", "Forge-Master observer unavailable; using forge_watch_live fallback."],
    ["code-absent failure", { ok: false }, undefined, "Observer probe failed (undefined)."],
    ["empty error with failure flag", { ok: false, error: "" }, "", "Observer probe failed ()."],
  ])("preserves doctor error ordering and detail for %s", async (_name, raw, code, detail) => {
    const mcp = { call: vi.fn(async () => raw) };
    const [check] = await alertsFeature.doctorChecks({ live: true, registry: { all: () => [PROJECT] }, mcp });
    expect(check).toStrictEqual({ name: `alerts:${PROJECT.id}`, status: "warn", code, detail });
    expect(mcp.call).toHaveBeenCalledExactlyOnceWith(PROJECT.id, "forge_master_observe", { action: "status" });
  });

  it.each([
    ["explicit unavailable code", { code: "FORGE_MASTER_UNAVAILABLE", message: "offline" },
      "FORGE_MASTER_UNAVAILABLE", "Forge-Master observer unavailable; using forge_watch_live fallback."],
    ["unavailable detail", { detail: "FORGE_MASTER_UNAVAILABLE", message: "offline" },
      "FORGE_MASTER_UNAVAILABLE", "Forge-Master observer unavailable; using forge_watch_live fallback."],
    ["explicit other code wins", { code: "OTHER_PROBE_ERROR", detail: "FORGE_MASTER_UNAVAILABLE" },
      "OTHER_PROBE_ERROR", "Observer probe failed (OTHER_PROBE_ERROR)."],
    ["code-absent error", { message: "offline" }, "MCP_TOOL_ERROR", "Observer probe failed (MCP_TOOL_ERROR)."],
  ])("preserves doctor thrown-error diagnostics for %s", async (_name, error, code, detail) => {
    const mcp = { call: vi.fn(async () => { throw error; }) };
    const [check] = await alertsFeature.doctorChecks({ live: true, registry: { all: () => [PROJECT] }, mcp });
    expect(check).toStrictEqual({ name: `alerts:${PROJECT.id}`, status: "warn", code, detail });
  });
});

describe("alert task producer integration", () => {
  function appendTaskAlert(store, fields = {}) {
    return store.append("alerts", {
      kind: "alert.emitted", projectId: PROJECT.id, eventType: "run-failed",
      fp: "a".repeat(64), ref: "aaaaaaaa", summary: "Governed alert task",
      suggestedAction: { type: "task", args: { runtime: "unsigned-override", provider: "unsigned-override" } },
      ...fields,
    });
  }

  function taskRequest(fields = {}) {
    return { action: "d", ref: "aaaaaaaa", caller: { role: ROLES[0], userId: "owner-1", channel: "telegram" },
      chatId: PROJECT.channel.chatId, topicId: PROJECT.channel.topicId, ...fields };
  }

  it.each(["d", "s"])("uses actual producer authority and structured durable result for %s", async (action) => {
    const { service, store, mcp } = createService();
    appendTaskAlert(store, { id: "stored-alert-record" });
    const result = await service.handleAction(taskRequest({ action }));
    expect(result).toMatchObject({ ok: true, jobId: expect.any(String), state: "awaiting-approval" });
    const job = currentJobs(store)[result.jobId];
    expect(job).toMatchObject({
      id: result.jobId, type: "task", state: result.state, mutating: true,
      projectId: PROJECT.id, callerId: "owner-1", callerRole: ROLES[0],
      chatId: PROJECT.channel.chatId, threadId: PROJECT.channel.topicId,
      adapter: "telegram", updateId: "alert:stored-alert-record",
    });
    expect(job).not.toHaveProperty("runtime");
    expect(job).not.toHaveProperty("provider");
    if (action === "s") expect(job.origin).toBe("untrusted");
    expect(records(store, "jobs").filter((record) => record.kind === "job.created")).toHaveLength(1);
    expect(records(store, "jobs").filter((record) => record.kind === "job.transition").map((record) => record.to))
      .toEqual(["awaiting-approval"]);
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it("recovers one task after action-audit loss, restart and concurrent draft-button replay", async () => {
    const directory = mkdtempSync(join(FIXTURE_ROOT, "claw-alert-task-recovery-"));
    const store = makeStore(directory);
    const first = createService({ store });
    appendTaskAlert(store);
    const accepted = await first.service.handleAction(taskRequest());
    expect(accepted.ok).toBe(true);
    const originalJob = currentJobs(store)[accepted.jobId];
    expect(originalJob.updateId).toMatch(/^alert:[0-9a-f]{64}$/);
    writeFileSync(join(directory, "alerts.jsonl"), `${records(store)
      .filter((record) => record.kind !== "alert.action").map((record) => JSON.stringify(record)).join("\n")}\n`);
    const reopened = createService({ store: makeStore(directory), config: first.config });
    const replayed = await Promise.all([
      reopened.service.handleAction(taskRequest()),
      reopened.service.handleAction(taskRequest({ action: "s" })),
    ]);
    expect(replayed.map((result) => result.jobId)).toEqual([accepted.jobId, accepted.jobId]);
    expect(replayed.every((result) => result.ok && result.state === "awaiting-approval")).toBe(true);
    expect(Object.values(currentJobs(reopened.store))).toHaveLength(1);
    expect(records(reopened.store, "jobs").filter((record) => record.kind === "job.created")).toHaveLength(1);
    expect(currentJobs(reopened.store)[accepted.jobId].updateId).toBe(originalJob.updateId);
  });

  it.each(["demoted", "removed", "runtime-unavailable"])("reauthorizes a repeated action after %s", async (change) => {
    let activeConfig = makeAlertConfig();
    const { service, store } = createService({ config: activeConfig, getConfig: () => activeConfig });
    appendTaskAlert(store, { id: "reauthorized-alert" });
    const accepted = await service.handleAction(taskRequest());
    expect(accepted.ok).toBe(true);
    const changed = makeAlertConfig();
    if (change === "demoted") changed.allowlist[0].role = ROLES[2];
    if (change === "removed") changed.allowlist = changed.allowlist.filter((entry) => entry.userId !== "owner-1");
    if (change === "runtime-unavailable") changed.projects = [{ ...PROJECT, runtime: "unavailable-runtime" }];
    activeConfig = changed;
    expect(await service.handleAction(taskRequest())).toEqual({
      ok: false, error: "TASK_PREPARE_FAILED", text: "This alert action could not be completed.",
    });
    expect(Object.values(currentJobs(store))).toHaveLength(1);
    expect(records(store).at(-1)).toMatchObject({ kind: "alert.action", outcome: "TASK_PREPARE_FAILED" });
  });

  it("does not invent producer authority when actual configuration is absent", async () => {
    const { service, store } = createService({ config: null });
    appendTaskAlert(store);
    expect(await service.handleAction(taskRequest())).toMatchObject({ ok: false, error: "TASK_PREPARE_FAILED" });
    expect(currentJobs(store)).toEqual({});
  });

  it("keeps non-owner GHCP denied and configured BYOK approval-pending", async () => {
    const config = makeAlertConfig();
    const secrets = { get: (name) => name === "PFORGE_ALERT_TEST_PROVIDER" ? "alert-test-provider-fixture" : undefined };
    const { service, store } = createService({ config, secrets });
    appendTaskAlert(store);
    const request = taskRequest({ caller: { role: ROLES[1], userId: "approver-1", channel: "telegram" } });
    expect(await service.handleAction(request)).toMatchObject({ ok: false, error: "TASK_PREPARE_FAILED" });
    expect(currentJobs(store)).toEqual({});
    config.projects = [{ ...PROJECT, runtime: "openai" }];
    config.runtimes = { byok: { openai: { keySecret: "PFORGE_ALERT_TEST_PROVIDER",
      endpoint: "https://provider.example" } } };
    const accepted = await service.handleAction(request);
    expect(accepted).toMatchObject({ ok: true, state: "awaiting-approval", jobId: expect.any(String) });
    expect(currentJobs(store)[accepted.jobId]).toMatchObject({
      callerId: "approver-1", callerRole: ROLES[1], constraint: "byok-only", state: "awaiting-approval",
    });
    expect(currentJobs(store)[accepted.jobId]).not.toHaveProperty("runtime");
    expect(currentJobs(store)[accepted.jobId]).not.toHaveProperty("provider");
  });

  it.each(["removed", "missing-configuration"])("keeps feature-bound task preparation on the actual current composition context after %s", async (change) => {
    const store = makeStore();
    const config = makeAlertConfig();
    const mcp = { call: vi.fn(async (_projectId, tool) => tool === "forge_master_observe"
      ? statusPage([]) : { ok: true, plans: [] }) };
    const context = {
      store, config, getConfig() { return this.config; }, registry: createRegistry(config),
      mcp, channel: makeChannel(), setTimer: vi.fn(), now: Date.now,
    };
    await alertsFeature.start(context);
    appendTaskAlert(store, { id: "composition-alert" });
    const active = getAlertsService();
    expect(await active.handleAction(taskRequest())).toMatchObject({ ok: true, state: "awaiting-approval" });
    context.config = change === "missing-configuration" ? null : { ...config, allowlist: [] };
    expect(await active.handleAction(taskRequest())).toMatchObject({ ok: false, error: "TASK_PREPARE_FAILED" });
    expect(Object.values(currentJobs(store))).toHaveLength(1);
  });

  it("guards the structured producer result boundary against display-text parsing", () => {
    const source = readFileSync(new URL("../src/alerts.mjs", import.meta.url), "utf8");
    expect(source).not.toContain("/Task job ([A-Za-z0-9._-]+)/");
    expect(source).toContain("response.jobId");
    expect(source).toContain("response.state");
  });
});
