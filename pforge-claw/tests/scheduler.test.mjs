import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bus as eventBus } from "../src/events.mjs";
import schedulerFeature from "../src/features/scheduler.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { createScheduler, dueKey, lastDueSlot, parseSchedule } from "../src/scheduler.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];

async function makeStore(now = Date.now()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-scheduler-"));
  directories.push(directory);
  return { store: createStore(directory, { now: () => new Date(now) }), directory };
}

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await schedulerFeature.stop();
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("schedule grammar and time zones", () => {
  it.each([
    ["daily 07:05", { kind: "daily", hm: "07:05" }],
    ["weekly Mon 07:05", { kind: "weekly", day: "Mon", hm: "07:05" }],
    ["monthly 28 07:05", { kind: "monthly", dom: "28", hm: "07:05" }],
    ["every 5m", { kind: "every", n: 5 }],
    ["every 120m", { kind: "every", n: 120 }],
  ])("parses %s", (input, expected) => {
    expect(parseSchedule(input)).toEqual(expected);
  });

  it.each([
    "0 7 * * *",
    "every 4m",
    "every 9007199254740992m",
    "monthly 29 07:00",
    "daily 25:00",
    "daily 07:60",
  ])(
    "rejects invalid schedule %s",
    (input) => expect(() => parseSchedule(input)).toThrowError(expect.objectContaining({ code: "SCHEDULE_INVALID" })),
  );

  it("rejects an invalid time zone", async () => {
    const { store } = await makeStore();
    expect(() => createScheduler({
      store,
      schedules: [],
      timeZone: "Not/AZone",
      run: vi.fn(),
    })).toThrowError(expect.objectContaining({ code: "SCHEDULE_TZ_INVALID" }));
  });

  it.each([
    ["Etc/GMT-14", Date.parse("2026-01-01T10:05:00.000Z"), "2026-01-02"],
    ["Etc/GMT+12", Date.parse("2026-01-02T12:05:00.000Z"), "2026-01-02"],
  ])("uses the local date for daily schedules in %s", (timeZone, instant, key) => {
    expect(dueKey(parseSchedule("daily 00:05"), new Date(instant), timeZone)).toBe(key);
  });

  it("matches weekly weekday and monthly dates across a year boundary", () => {
    expect(dueKey(
      parseSchedule("weekly Mon 00:05"),
      new Date("2026-01-05T00:05:00.000Z"),
      "Etc/UTC",
    )).toBe("2026-01-05");
    expect(dueKey(
      parseSchedule("monthly 28 23:55"),
      new Date("2026-12-29T04:55:00.000Z"),
      "Etc/GMT+5",
    )).toBe("2026-12-28");
  });
});

describe("scheduler persistence and execution", () => {
  beforeEach(() => vi.setSystemTime(new Date("2026-10-07T12:00:00.000Z")));

  it("does not duplicate a schedule after restart during its due minute", async () => {
    const { store } = await makeStore();
    const run = vi.fn();
    const options = { store, schedules: [{ id: "daily", kind: "digest", at: "daily 12:00" }], timeZone: "Etc/UTC", run };
    await createScheduler(options).tick();
    await createScheduler(options).tick();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([30, 60])("catches up a run that was due %s minutes ago", async (minutesAgo) => {
    const { store } = await makeStore();
    const now = Date.parse("2026-10-07T12:00:00.000Z") + minutesAgo * 60_000;
    vi.setSystemTime(now);
    const run = vi.fn();
    const scheduler = createScheduler({
      store,
      schedules: [{ id: "daily", kind: "digest", at: "daily 12:00" }],
      timeZone: "Etc/UTC",
      now: Date.now,
      run,
    });
    await scheduler.tick();
    expect(run).toHaveBeenCalledOnce();
  });

  it("skips a run more than one hour old", () => {
    const now = Date.parse("2026-10-07T13:01:00.000Z");
    expect(lastDueSlot(parseSchedule("daily 12:00"), now, "Etc/UTC")).toBeNull();
    expect(lastDueSlot(parseSchedule("daily 12:00"), now + 60_000, "Etc/UTC")).toBeNull();
  });

  it("does not run when claiming the slot cannot be persisted", async () => {
    const { store } = await makeStore();
    const failingStore = {
      ...store,
      writeJsonAtomic: () => { throw Object.assign(new Error("disk full"), { code: "STORE_WRITE_FAILED" }); },
    };
    const run = vi.fn();
    const scheduler = createScheduler({
      store: failingStore,
      schedules: [{ id: "daily", kind: "digest", at: "daily 12:00" }],
      timeZone: "Etc/UTC",
      run,
      logger: logger(),
    });
    await expect(scheduler.tick()).rejects.toMatchObject({ code: "STORE_WRITE_FAILED" });
    expect(run).not.toHaveBeenCalled();
  });

  it("recovers corrupt state without replaying the current due slot", async () => {
    const { store, directory } = await makeStore();
    await writeFile(path.join(directory, "schedules.json"), "{not json");
    const run = vi.fn();
    const audit = vi.fn();
    const scheduler = createScheduler({
      store,
      schedules: [{ id: "daily", kind: "digest", at: "daily 12:00" }],
      timeZone: "Etc/UTC",
      run,
      audit,
    });
    await scheduler.tick();
    expect(run).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: "schedule.state-recovered" }));
  });

  it("serializes overlapping ticks and stop waits for the in-flight run", async () => {
    const { store } = await makeStore();
    let finishRun;
    const run = vi.fn(() => new Promise((resolve) => { finishRun = resolve; }));
    const scheduler = createScheduler({
      store,
      schedules: [{ id: "daily", kind: "digest", at: "daily 12:00" }],
      timeZone: "Etc/UTC",
      run,
    });
    const first = scheduler.tick();
    const second = scheduler.tick();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const stopped = scheduler.stop();
    let stopResolved = false;
    void stopped.then(() => { stopResolved = true; });
    await Promise.resolve();
    expect(stopResolved).toBe(false);
    finishRun();
    await Promise.all([first, second, stopped]);
    expect(run).toHaveBeenCalledOnce();
    expect(scheduler.snapshot()).toEqual([
      expect.objectContaining({ id: "daily", status: "done", lastRunAt: expect.any(String) }),
    ]);
  });

  it("records invalid entries and drops duplicate IDs", async () => {
    const { store } = await makeStore();
    const audit = vi.fn();
    const run = vi.fn();
    const scheduler = createScheduler({
      store,
      schedules: [
        { id: "duplicate", kind: "digest", at: "daily 12:00" },
        { id: "duplicate", kind: "digest", at: "daily 12:00" },
        { id: "invalid", kind: "digest", at: "monthly 29 07:00" },
      ],
      timeZone: "Etc/UTC",
      run,
      audit,
    });
    await scheduler.tick();
    expect(run).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ kind: ["schedule", "invalid"].join(".") }));
    expect(scheduler.snapshot()).toHaveLength(1);
  });

  it("persists a failed run state and audit record", async () => {
    const { store } = await makeStore();
    const scheduler = createScheduler({
      store,
      schedules: [{ id: "daily", kind: "digest", at: "daily 12:00" }],
      timeZone: "Etc/UTC",
      run: async () => { throw Object.assign(new Error("failed"), { code: "DIGEST_FAILED" }); },
    });
    await scheduler.tick();
    expect(scheduler.snapshot()[0]).toMatchObject({ status: "failed", errorCode: "DIGEST_FAILED" });
    expect([...store.read("audit")].map(({ record }) => record)).toContainEqual(
      expect.objectContaining({ kind: "schedule.failed", errorCode: "DIGEST_FAILED" }),
    );
  });
});

describe("scheduler feature skill dispatch", () => {
  beforeEach(() => vi.setSystemTime(new Date("2026-10-07T12:00:00.000Z")));

  async function runSkill({ readOnly = false, preApproved = false, owner = true } = {}) {
    const { store } = await makeStore();
    const config = {
      timezone: "Etc/UTC",
      channels: { telegram: { generalChat: { chatId: "general", topicId: "topic" } } },
      allowlist: owner ? [{ userId: "owner-1", role: "owner" }] : [],
      projects: [{ id: "project-1", repo: { path: "C:\\repo" } }],
      schedules: [{ id: "scheduled-skill", kind: "skill", skill: "inspect", project: "project-1", at: "daily 12:00", preApproved }],
    };
    const mcp = {
      call: vi.fn(async (_projectId, tool) => {
        if (tool !== "forge_run_skill") throw new Error(`unexpected tool ${tool}`);
        return { content: [{ type: "text", text: JSON.stringify({ status: "dry-run", skillName: "inspect", readOnly }) }] };
      }),
    };
    const audit = vi.fn();
    await schedulerFeature.start({
      store,
      config,
      mcp,
      channel: { send: vi.fn() },
      bus: eventBus,
      logger: logger(),
      now: Date.now,
      audit,
    });
    await schedulerFeature.stop();
    return { store, audit };
  }

  it("leaves mutating jobs awaiting approval unless pre-approval is explicit", async () => {
    const { store } = await runSkill({ preApproved: false });
    expect(Object.values(currentJobs(store))[0].state).toBe("awaiting-approval");
    expect([...store.read("approvals")].map(({ record }) => record.kind)).not.toContain("approval.consumed");
  });

  it("pre-approves through the approval service as the configured owner", async () => {
    const { store, audit } = await runSkill({ preApproved: true });
    expect(Object.values(currentJobs(store))[0].state).toBe("approved");
    expect([...store.read("approvals")].map(({ record }) => record)).toContainEqual(
      expect.objectContaining({ kind: "approval.consumed", approverId: "owner-1" }),
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "schedule.preapproved",
      scheduleId: "scheduled-skill",
      approverId: "owner-1",
    }));
  });

  it("keeps the job awaiting approval when no owner is configured", async () => {
    const { store, audit } = await runSkill({ preApproved: true, owner: false });
    expect(Object.values(currentJobs(store))[0].state).toBe("awaiting-approval");
    expect([...store.read("approvals")].map(({ record }) => record.kind)).not.toContain("approval.consumed");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "schedule.preapproved-fallback",
      reason: "owner-unavailable",
    }));
  });

  it("leaves read-only skill jobs queued", async () => {
    const { store } = await runSkill({ readOnly: true, preApproved: true });
    expect(Object.values(currentJobs(store))[0].state).toBe("queued");
    expect([...store.read("approvals")]).toHaveLength(0);
  });
});
