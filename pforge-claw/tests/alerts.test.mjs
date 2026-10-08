import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import alertsCallback from "../src/callbacks/x.mjs";
import alertsFeature from "../src/features/alerts.mjs";
import {
  ALERT_DEFAULTS,
  bindAlertsService,
  createAlertsService,
  fingerprint,
} from "../src/alerts.mjs";
import { createStore } from "../src/state/store.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { ROLES } from "../src/enums.mjs";

const PROJECT = {
  id: "project-one",
  repo: { path: "C:\\workspace\\project-one" },
  channel: { chatId: "chat-1", topicId: "topic-1" },
};
const directories = [];

function makeStore(directory = mkdtempSync(join(tmpdir(), "claw-alerts-"))) {
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

function createService({
  store = makeStore(),
  mcp = { call: vi.fn(async () => statusPage([])) },
  channel = makeChannel(),
  registry = { all: () => [PROJECT], byId: (id) => id === PROJECT.id ? PROJECT : undefined },
  options = {},
  secrets,
  logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
} = {}) {
  return {
    store,
    mcp,
    channel,
    logger,
    service: createAlertsService({
      store, mcp, registry, channel, logger, secrets, now: Date.now, options,
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

describe("alert observer polling", () => {
  it("passes page cursors, follows pages, and persists high-water and resume cursors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "claw-alerts-pages-"));
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
    const directory = mkdtempSync(join(tmpdir(), "claw-alerts-dedupe-"));
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
    const directory = mkdtempSync(join(tmpdir(), "claw-alerts-redact-"));
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
    const worktree = mkdtempSync(join(tmpdir(), "claw-alert-worktree-"));
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
