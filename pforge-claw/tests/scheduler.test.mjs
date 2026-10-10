import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { bus as eventBus } from "../src/events.mjs";
import schedulerFeature from "../src/features/scheduler.mjs";
import { createJob, currentJobs, transition } from "../src/jobs/model.mjs";
import { createScheduler, dueKey, lastDueSlot, parseSchedule } from "../src/scheduler.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];

async function makeStore(now = Date.now()) {
  const directory = await mkdtemp(path.resolve("claw-c7-scheduler-fixture-"));
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

  function seedAwaitingSlot(store, overrides = {}) {
    const job = {
      ...createJob({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", type: "skill", projectId: "project-1" }).job,
      skill: "inspect",
      callerId: "owner-1",
      callerRole: "owner",
      adapter: "scheduler",
      updateId: "schedule:scheduled-skill:2026-10-07",
      chatId: "general",
      threadId: "topic",
      ...overrides,
    };
    store.append("jobs", { kind: "job.created", job });
    store.append("jobs", transition(job, "awaiting-approval").event);
  }

  async function runSkill({ readOnly = false, preApproved = false, owner = true, beforeStart } = {}) {
    const { store } = await makeStore();
    const config = {
      timezone: "Etc/UTC",
      channels: { telegram: { generalChat: { chatId: "general", topicId: "topic" } } },
      allowlist: owner ? [{ channel: "telegram", userId: "owner-1", role: "owner" }] : [],
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
    const channel = { send: vi.fn() };
    const context = {
      store,
      config,
      mcp,
      channel,
      bus: eventBus,
      logger: logger(),
      now: Date.now,
      audit,
    };
    await beforeStart?.(context);
    await schedulerFeature.start(context);
    await schedulerFeature.stop();
    return { store, audit, config, mcp, channel, context };
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

  it.each([false, true])("fails without fabricating an owner when preApproved is %s", async (preApproved) => {
    const { store, audit, mcp } = await runSkill({ preApproved, owner: false });
    expect(Object.values(currentJobs(store))).toHaveLength(0);
    expect([...store.read("approvals")]).toHaveLength(0);
    expect(mcp.call).not.toHaveBeenCalled();
    expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toMatchObject({
      status: "failed",
      errorCode: "SCHEDULE_OWNER_UNAVAILABLE",
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "schedule.failed",
      errorCode: "SCHEDULE_OWNER_UNAVAILABLE",
    }));
  });

  it("leaves read-only skill jobs queued", async () => {
    const { store } = await runSkill({ readOnly: true, preApproved: true });
    expect(Object.values(currentJobs(store))[0].state).toBe("queued");
    expect([...store.read("approvals")]).toHaveLength(0);
  });

  it("binds the job to the configured owner and requested schedule slot", async () => {
    const { store, mcp } = await runSkill({ readOnly: true });
    expect(Object.values(currentJobs(store))[0]).toMatchObject({
      projectId: "project-1",
      type: "skill",
      skill: "inspect",
      callerId: "owner-1",
      callerRole: "owner",
      updateId: "schedule:scheduled-skill:2026-10-07",
      state: "queued",
    });
    expect(mcp.call.mock.calls).toEqual([[
      "project-1",
      "forge_run_skill",
      { skill: "inspect", dryRun: true, path: "C:\\repo" },
    ]]);
  });

  it("refuses preapproval when a recovered slot job has a different skill", async () => {
    const { store, audit } = await runSkill({
      preApproved: true,
      beforeStart: ({ store }) => {
        seedAwaitingSlot(store, { skill: "different-skill" });
      },
    });
    expect(Object.values(currentJobs(store))).toHaveLength(1);
    expect([...store.read("approvals")]).toHaveLength(0);
    expect(currentJobs(store).aaaaaaaaaaaaaaaaaaaaaaaa.state).toBe("awaiting-approval");
    expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toMatchObject({
      status: "failed",
      errorCode: "SCHEDULE_SKILL_JOB_MISMATCH",
    });
    expect(audit.mock.calls.filter(([record]) => record.kind === "schedule.fired")).toHaveLength(0);
  });

  it.each([{ runtime: "unconfigured-runtime" }, { provider: { type: "openai" } }])(
    "refuses preapproval of recovered unsigned runtime/provider overrides %#",
    async (overrides) => {
      const { store } = await runSkill({
        preApproved: true,
        beforeStart: ({ store }) => seedAwaitingSlot(store, overrides),
      });
      expect(Object.values(currentJobs(store))).toHaveLength(1);
      expect([...store.read("approvals")]).toHaveLength(0);
      expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toMatchObject({
        status: "failed",
        errorCode: "SCHEDULE_SKILL_JOB_MISMATCH",
      });
    },
  );

  it("does not copy schedule-selected runtime/provider fields to a new unsigned job", async () => {
    const { store } = await runSkill({
      readOnly: true,
      beforeStart: ({ config }) => {
        config.schedules[0].runtime = "unconfigured-runtime";
        config.schedules[0].provider = { type: "openai" };
      },
    });
    const [job] = Object.values(currentJobs(store));
    expect(Object.hasOwn(job, "runtime")).toBe(false);
    expect(Object.hasOwn(job, "provider")).toBe(false);
    expect(job).toMatchObject({ callerId: "owner-1", state: "queued" });
  });

  it("keeps explicit preapproval awaiting when the general chat is unavailable", async () => {
    const { store, audit } = await runSkill({
      preApproved: true,
      beforeStart: ({ config }) => { delete config.channels.telegram.generalChat; },
    });
    expect(Object.values(currentJobs(store))[0]).toMatchObject({
      callerId: "owner-1",
      chatId: null,
      state: "awaiting-approval",
    });
    expect([...store.read("approvals")]).toHaveLength(0);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "schedule.preapproved-fallback",
      reason: "general-chat-unavailable",
    }));
  });

  it("fails the next slot on metadata error instead of reusing an older queued job", async () => {
    const { store, audit, mcp, context } = await runSkill({ readOnly: true });
    const [oldJob] = Object.values(currentJobs(store));
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    mcp.call.mockRejectedValue(new ClawError("SKILL_METADATA_FAILED"));
    await schedulerFeature.start(context);
    await schedulerFeature.stop();

    expect(Object.values(currentJobs(store))).toEqual([oldJob]);
    expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toEqual({
      lastKey: "2026-10-08",
      lastRunAt: "2026-10-08T12:00:00.000Z",
      status: "failed",
      errorCode: "SCHEDULE_SKILL_JOB_MISSING",
    });
    expect(audit.mock.calls.filter(([record]) => record.kind === "schedule.fired")).toHaveLength(1);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      kind: "schedule.failed",
      key: "2026-10-08",
      errorCode: "SCHEDULE_SKILL_JOB_MISSING",
    }));
    expect([...store.read("approvals")]).toHaveLength(0);

    await schedulerFeature.start(context);
    await schedulerFeature.stop();
    expect(mcp.call).toHaveBeenCalledTimes(2);
    expect(store.readJson("schedules.json").schedules["scheduled-skill"].status).toBe("failed");
  });

  it("never preapproves an old job whose ID appears in the next slot's metadata error text", async () => {
    const { store, audit, mcp, config, context } = await runSkill();
    const [oldJob] = Object.values(currentJobs(store));
    config.schedules[0].preApproved = true;
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    mcp.call.mockRejectedValue(new ClawError(oldJob.id));
    await schedulerFeature.start(context);
    await schedulerFeature.stop();

    expect(Object.values(currentJobs(store))).toEqual([oldJob]);
    expect(currentJobs(store)[oldJob.id].state).toBe("awaiting-approval");
    expect([...store.read("approvals")]).toHaveLength(0);
    expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toMatchObject({
      lastKey: "2026-10-08",
      status: "failed",
      errorCode: "SCHEDULE_SKILL_JOB_MISSING",
    });
    expect(audit.mock.calls.filter(([record]) => record.kind === "schedule.fired")).toHaveLength(1);
    expect(audit.mock.calls.filter(([record]) => record.kind === "schedule.preapproved")).toHaveLength(0);
  });

  it.each([
    { isError: true },
    { status: "dry-run", skillName: "different-skill", readOnly: false },
    { content: [{ type: "text", text: "{invalid metadata" }] },
  ])("does not fire a second slot for invalid or unrelated metadata %#", async (metadata) => {
    const { store, mcp, config, context } = await runSkill();
    const [oldJob] = Object.values(currentJobs(store));
    config.schedules[0].preApproved = true;
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    mcp.call.mockResolvedValue(metadata);
    await schedulerFeature.start(context);
    await schedulerFeature.stop();
    expect(Object.values(currentJobs(store))).toEqual([oldJob]);
    expect([...store.read("approvals")]).toHaveLength(0);
    expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toMatchObject({
      status: "failed",
      errorCode: "SCHEDULE_SKILL_JOB_MISSING",
    });
  });

  it("rechecks the original owner's current role after metadata returns", async () => {
    const { store, mcp, config, context } = await runSkill();
    config.schedules[0].preApproved = true;
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    mcp.call.mockImplementation(async () => {
      config.allowlist[0].role = "viewer";
      config.allowlist.push({ channel: "telegram", userId: "other-owner", role: "owner" });
      return { status: "dry-run", skillName: "inspect", readOnly: false };
    });
    await schedulerFeature.start(context);
    await schedulerFeature.stop();

    expect(Object.values(currentJobs(store))).toHaveLength(1);
    expect(Object.values(currentJobs(store))[0].state).toBe("awaiting-approval");
    expect([...store.read("approvals")]).toHaveLength(0);
    expect(store.readJson("schedules.json").schedules["scheduled-skill"]).toMatchObject({
      status: "failed",
      errorCode: "SCHEDULE_OWNER_UNAVAILABLE",
    });
  });

  it("creates seven owner-bound slot jobs at most once across repeated restart and clock rollback", async () => {
    const { store, mcp, context } = await runSkill({ readOnly: true });
    for (let day = 0; day < 7; day += 1) {
      vi.setSystemTime(new Date(Date.parse("2026-10-07T12:00:00.000Z") + day * 86_400_000));
      await schedulerFeature.start(context);
      await schedulerFeature.stop();
      await schedulerFeature.start(context);
      await schedulerFeature.stop();
    }
    const jobs = Object.values(currentJobs(store));
    expect(jobs).toHaveLength(7);
    expect(mcp.call).toHaveBeenCalledTimes(7);
    expect(new Set(jobs.map((job) => job.updateId)).size).toBe(7);
    expect(jobs.every((job) => job.callerId === "owner-1" && job.state === "queued")).toBe(true);

    vi.setSystemTime(new Date("2026-10-13T11:59:00.000Z"));
    await schedulerFeature.start(context);
    await schedulerFeature.stop();
    vi.setSystemTime(new Date("2026-10-13T12:00:00.000Z"));
    await schedulerFeature.start(context);
    await schedulerFeature.stop();
    expect(Object.values(currentJobs(store))).toHaveLength(7);
  });
});

describe("Guard: scheduled skills never infer job identity or invent owner authority", () => {
  it("has no text job-ID parser, historical success fallback, or synthetic owner", () => {
    const source = readFileSync(path.join(
      path.dirname(fileURLToPath(import.meta.url)), "..", "src", "features", "scheduler.mjs",
    ), "utf8");
    expect(source).not.toContain("jobFromText");
    expect(source).not.toContain("latestScheduledJob");
    expect(source).not.toContain("`scheduler:${");
  });
});
