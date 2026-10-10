import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectDigest,
  DIGEST_PROPOSAL_TTL_MS,
  renderDigest,
  sendDigest,
  SOURCE_TIMEOUT_MS,
} from "../src/digest.mjs";
import { createScheduler } from "../src/scheduler.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];

async function makeStore(now = Date.now()) {
  const directory = await mkdtemp(path.resolve("claw-c7-digest-fixture-"));
  directories.push(directory);
  let timestamp = now;
  const store = createStore(directory, { now: () => new Date(timestamp) });
  store.setTime = (value) => { timestamp = value; };
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T08:00:00.000Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function project(id, overrides = {}) {
  return { id, displayName: `Project ${id}`, ...overrides };
}

function sourceClient({ failingProject } = {}) {
  return {
    call: vi.fn(async (projectId, tool) => {
      if (projectId === failingProject) throw Object.assign(new Error("unavailable"), { code: "HOME_LANE_REMOTE" });
      if (tool === "forge_plan_status") return { status: "running" };
      if (tool === "forge_bug_list") return { total: 2 };
      if (tool === "forge_drift_report") return { summary: "stable" };
      if (tool === "forge_master_audit") {
        return {
          risks: [{ title: "First risk" }, { title: "Second risk" }, { title: "Third risk" }, { title: "Fourth risk" }],
          actions: [
            { priority: "P0", kind: "task", args: { description: "Fix the first risk" } },
            { priority: "P1", kind: "task", args: { description: "Not a P0 action" } },
            { priority: "P0", kind: "task", args: {} },
          ],
        };
      }
      throw new Error(`Unexpected tool: ${tool}`);
    }),
  };
}

describe("morning digest", () => {
  it("delivers seven daily digests once per persisted slot across restart", async () => {
    const store = await makeStore();
    const mcp = sourceClient();
    const channel = { send: vi.fn() };
    const config = {
      timezone: "Etc/UTC",
      channels: { telegram: { generalChat: { chatId: "general", topicId: "morning" } } },
      projects: [project("p1"), project("p2")],
    };
    const options = {
      store,
      schedules: [{ id: "morning", kind: "digest", at: "daily 08:00" }],
      timeZone: config.timezone,
      now: Date.now,
      run: async () => {
        const data = await collectDigest({ store, config, mcp, now: Date.now });
        await sendDigest({ store, config, channel, data, now: Date.now });
      },
    };
    for (let day = 0; day < 7; day += 1) {
      const timestamp = Date.parse("2026-10-07T08:00:00.000Z") + day * 86_400_000;
      vi.setSystemTime(timestamp);
      store.setTime(timestamp);
      await createScheduler(options).tick();
      vi.setSystemTime(timestamp + 30_000);
      await createScheduler(options).tick();
      expect(store.readJson("schedules.json").schedules.morning).toMatchObject({
        lastKey: new Date(timestamp).toISOString().slice(0, 10),
        status: "done",
      });
    }
    expect(channel.send).toHaveBeenCalledTimes(7);
    for (const [message] of channel.send.mock.calls) {
      expect(message).toMatchObject({ chatId: "general", threadId: "morning" });
      expect(message.text).toContain("Project p1");
      expect(message.text).toContain("Project p2");
    }
    expect(mcp.call.mock.calls.every((args) => args.length === 3)).toBe(true);
    expect([...store.read("audit")].filter(({ record }) => record.kind === "schedule.fired")).toHaveLength(7);
  });

  it("renders all project lines and keeps unreported spend distinct from zero", async () => {
    const now = Date.parse("2026-10-07T08:00:00.000Z");
    const store = await makeStore(now);
    store.append("budget", { kind: "usage", project: "p1", at: now - 86_400_000, costUSD: 3.25 });
    const config = { timezone: "Etc/UTC", projects: [project("p1"), project("p2")] };
    const mcp = sourceClient();
    const data = await collectDigest({ store, config, mcp, now, timeZone: "Etc/UTC" });
    const rendered = renderDigest(data, { secrets: { redact: String } });
    expect(rendered.text).toContain("Project p1");
    expect(rendered.text).toContain("Project p2");
    expect(rendered.text).toContain("$3.25");
    expect(rendered.text).toMatch(/Project p2.*\?/);
    expect(rendered.text).not.toContain("$0.00");
    expect(mcp.call.mock.calls.filter(([, tool]) => tool === "forge_master_audit"))
      .toEqual([["p1", "forge_master_audit", {}]]);
  });

  it("isolates a remote project failure while collecting other project data", async () => {
    const now = Date.parse("2026-10-07T08:00:00.000Z");
    const store = await makeStore(now);
    const config = { timezone: "Etc/UTC", projects: [project("remote"), project("local")] };
    const mcp = sourceClient({ failingProject: "remote" });
    const data = await collectDigest({ store, config, mcp, now, timeZone: "Etc/UTC" });
    const rendered = renderDigest(data, { secrets: { redact: String } });
    expect(rendered.text).toMatch(/Project remote.*unavailable/);
    expect(rendered.text).toContain("Project local");
    expect(mcp.call).toHaveBeenCalledWith("local", "forge_plan_status", {});
  });

  it("hides restricted titles and redacts secret-like source data", async () => {
    const now = Date.parse("2026-10-07T08:00:00.000Z");
    const store = await makeStore(now);
    const config = {
      timezone: "Etc/UTC",
      projects: [project("private", {
        visibility: "restricted",
        displayName: "sk-test-secret-value-that-is-long-enough",
      })],
    };
    const mcp = sourceClient();
    mcp.call.mockImplementation(async (_projectId, tool) => {
      if (tool === "forge_plan_status") return { status: "running", title: "Confidential plan title" };
      if (tool === "forge_bug_list") return { total: 1, bugs: [{ title: "Confidential bug title" }] };
      if (tool === "forge_drift_report") return { summary: "Confidential drift detail" };
      return { risks: [{ title: "Confidential risk title" }] };
    });
    const data = await collectDigest({ store, config, mcp, now, timeZone: "Etc/UTC" });
    const rendered = renderDigest(data, {
      secrets: { redact: (text) => String(text).replace("sk-test-secret-value-that-is-long-enough", "[redacted]") },
    });
    expect(rendered.text).not.toContain("Confidential");
    expect(rendered.text).toContain("[redacted]");
  });

  it("counts only terminal job transitions from the preceding 24 hours", async () => {
    const now = Date.parse("2026-10-07T08:00:00.000Z");
    const store = await makeStore(now);
    store.setTime(now - 26 * 60 * 60_000);
    store.append("jobs", { kind: "job.created", job: { id: "old", projectId: "p1" } });
    store.append("jobs", { kind: "job.transition", jobId: "old", to: "failed" });
    store.setTime(now - 12 * 60 * 60_000);
    store.append("jobs", { kind: "job.created", job: { id: "new", projectId: "p1" } });
    store.append("jobs", { kind: "job.transition", jobId: "new", to: "succeeded" });
    store.setTime(now - 60 * 60_000);
    store.append("jobs", { kind: "job.created", job: { id: "cancelled", projectId: "p2" } });
    store.append("jobs", { kind: "job.transition", jobId: "cancelled", to: "cancelled" });
    const data = await collectDigest({
      store,
      config: { timezone: "Etc/UTC", projects: [project("p1"), project("p2")] },
      mcp: sourceClient(),
      now,
      timeZone: "Etc/UTC",
    });
    expect(data.projects.map(({ jobs }) => jobs)).toEqual([
      { succeeded: 1, failed: 0 },
      { succeeded: 0, failed: 1 },
    ]);
  });

  it("times out a stalled MCP source without rejecting collection", async () => {
    vi.useFakeTimers();
    try {
      const now = Date.parse("2026-10-07T08:00:00.000Z");
      const store = await makeStore(now);
      const result = collectDigest({
        store,
        config: { timezone: "Etc/UTC", projects: [project("stalled")] },
        mcp: { call: () => new Promise(() => {}) },
        now,
        timeZone: "Etc/UTC",
      });
      await vi.advanceTimersByTimeAsync(SOURCE_TIMEOUT_MS);
      const data = await result;
      expect(data.projects[0].sources.plan).toEqual({ ok: false, code: "SOURCE_TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("compacts optional detail while preserving every project line under Telegram's limit", () => {
    const data = {
      projects: Array.from({ length: 60 }, (_value, index) => ({
        id: `project-${index}`,
        name: `Project ${index} with a long display name`,
        sources: {
          plan: { ok: true, value: { status: "running" } },
          bugs: { ok: true, value: { total: 4 } },
          drift: { ok: true, value: { summary: "A fairly long drift summary ".repeat(3) } },
        },
        jobs: { succeeded: 10, failed: 2 },
        costUSD: 12.34,
      })),
      lookAtFirst: {
        risks: [{ title: "Risk title ".repeat(100) }],
        actions: [],
      },
    };
    const { text } = renderDigest(data, { secrets: { redact: String } });
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.split("\n").filter((line) => line.startsWith("• "))).toHaveLength(60);
  });

  it.each([
    [150, "• projec 10/2", "\n\nLook first"],
    [300, "• pro 10/2", "\nLook first\nAudit unavailable (MCP_SOURCE_FAILED)"],
  ])("preserves every project in the %s-line minimal rendering", (count, projectLine, suffix) => {
    const data = {
      projects: Array.from({ length: count }, (_value, index) => ({
        id: `project-${index}`,
        name: "Project with a long display name",
        sources: {},
        jobs: { succeeded: 10, failed: 2 },
        costUSD: null,
      })),
      lookAtFirst: { unavailable: "MCP_SOURCE_FAILED" },
    };
    const { text } = renderDigest(data);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(text.split("\n").filter((line) => line.startsWith("• "))).toHaveLength(count);
    expect(text).toContain(projectLine);
    expect(text.endsWith(suffix)).toBe(true);
  });

  it("refuses an oversized digest instead of silently dropping project lines", () => {
    expect(() => renderDigest({
      projects: Array.from({ length: 1000 }, () => ({
        id: "project",
        name: "Project",
        sources: {},
        jobs: { succeeded: 10, failed: 2 },
      })),
    })).toThrowError(expect.objectContaining({ code: "DIGEST_TOO_LARGE" }));
  });

  it("adds validated P0 proposals and sends one topic-bound message", async () => {
    const now = Date.parse("2026-10-07T08:00:00.000Z");
    const store = await makeStore(now);
    const config = {
      timezone: "Etc/UTC",
      channels: { telegram: { generalChat: { chatId: "general", topicId: "morning" } } },
      projects: [project("p1")],
    };
    const data = await collectDigest({ store, config, mcp: sourceClient(), now, timeZone: "Etc/UTC" });
    const channel = { send: vi.fn() };
    const result = await sendDigest({
      store,
      channel,
      config,
      data,
      secrets: { redact: String },
      now: () => now,
    });
    expect(result.sent).toBe(true);
    expect(result.proposalCount).toBe(1);
    expect(channel.send).toHaveBeenCalledOnce();
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "general",
      threadId: "morning",
    }));
    const [{ replyMarkup }] = channel.send.mock.calls[0];
    const callback = replyMarkup.inline_keyboard.flat()[0].callback_data;
    expect(callback).toMatch(/^p:/);
    expect(Buffer.byteLength(callback, "utf8")).toBeLessThanOrEqual(64);
    expect([...store.read("proposals")].map(({ record }) => record)).toContainEqual(
      expect.objectContaining({
        id: callback.slice(2),
        project: "p1",
        chatId: "general",
        topicId: "morning",
        untrusted: true,
        expiresAt: now + DIGEST_PROPOSAL_TTL_MS,
        used: false,
      }),
    );
  });

  it.each([
    ["no-general-chat", { send: vi.fn() }, { channels: { telegram: {} } }],
    ["no-channel", null, { channels: { telegram: { generalChat: { chatId: "general" } } } }],
  ])("skips sending and audits %s", async (reason, channel, channelConfig) => {
    const store = await makeStore();
    const config = { projects: [], ...channelConfig };
    const result = await sendDigest({
      store,
      channel,
      config,
      data: { projects: [], lookAtFirst: { risks: [], actions: [] } },
      secrets: { redact: String },
    });
    expect(result).toMatchObject({ sent: false, reason });
    expect([...store.read("audit")].map(({ record }) => record)).toContainEqual(
      expect.objectContaining({ kind: "digest.skipped", reason }),
    );
    if (channel) expect(channel.send).not.toHaveBeenCalled();
  });
});
