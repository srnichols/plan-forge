import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBudgetService, createBudgetService, dayKey, foldLedger, getBudgetService } from "../src/budget.mjs";
import { createApprovalService, issueApproval } from "../src/approvals.mjs";
import budgetCallback from "../src/callbacks/b.mjs";
import budgetFeature from "../src/features/budget.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createRunners } from "../src/jobs/runners.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];
const storeDirectories = new WeakMap();
const FIXTURE_PREFIX = path.join(path.dirname(fileURLToPath(import.meta.url)), ".budget-fixture-");
const projectId = "project-1";
const chatId = "chat-1";
const threadId = "topic-1";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const PLAN_LABEL = "Native-Budget-Plan.md";
const PLAN_PATH = path.join("docs", "plans", PLAN_LABEL);

function makeStore() {
  const directory = mkdtempSync(FIXTURE_PREFIX);
  directories.push(directory);
  const store = createStore(directory, { now: () => new Date(NOW) });
  storeDirectories.set(store, directory);
  return store;
}

function addJob(store, {
  id = "abcdef0123456789abcdef01",
  type = "task",
  state = "approved",
  project = projectId,
  mutating,
  planPath,
} = {}) {
  const created = createJob({ id, type, projectId: project });
  const job = {
    ...created.job,
    ...(planPath === undefined ? {} : { planPath }),
    ...(mutating === undefined ? {} : { mutating }),
    chatId,
    threadId,
    callerId: "requester-1",
  };
  if (!job.mutating && state === "approved") {
    job.state = "approved";
    store.append(JOBS_STREAM, { kind: "job.created", job });
    return job;
  }
  store.append(JOBS_STREAM, { kind: "job.created", job });
  if (state === "awaiting-approval" || state === "approved") {
    const waiting = transition(job, "awaiting-approval");
    store.append(JOBS_STREAM, waiting.event);
    if (state === "approved") {
      const approved = transition(waiting.job, "approved");
      store.append(JOBS_STREAM, approved.event);
      return approved.job;
    }
    return waiting.job;
  }
  return job;
}

function makeChannel() {
  const calls = [];
  return {
    calls,
    async send(payload) {
      calls.push({ method: "send", ...payload });
      return [{ chatId: String(payload.chatId), messageId: `message-${calls.length}` }];
    },
    async edit(payload) {
      calls.push({ method: "edit", ...payload });
    },
  };
}

function records(store, stream = "budget") {
  return [...store.read(stream)].map(({ record }) => record);
}

function budgetService(store, overrides = {}) {
  return createBudgetService({
    store,
    now: () => NOW,
    config: { timezone: "Etc/UTC", projects: [{ id: projectId }], ...overrides.config },
    ...overrides,
  });
}

function addPlanJob(store, { id = "native-budget-job", project = projectId, planPath = PLAN_LABEL } = {}) {
  return addJob(store, { id, project, planPath, type: "plan", state: "queued" });
}

function nativeActuals(job, overrides = {}) {
  return {
    jobId: job.id,
    projectId: job.projectId,
    runId: `native-${job.id}`,
    plan: PLAN_LABEL,
    endedAt: new Date(NOW).toISOString(),
    usage: { costUSD: 0.42, premiumRequests: null },
    ...overrides,
  };
}

function nativeHomeReport() {
  return {
    runs: 2,
    total_cost_usd: 999,
    total_tokens_in: 10,
    total_tokens_out: 5,
    by_model: {},
    monthly: {},
    latest: {
      date: new Date(NOW).toISOString(),
      plan: "Another-Plan.md",
      status: "completed",
      sliceCount: 1,
      total_cost_usd: 998,
      by_model: {},
    },
    forge_model_stats: {},
  };
}

function nativeManager() {
  return { get: vi.fn(), call: vi.fn(async () => nativeHomeReport()) };
}

async function makeHeldJob({ id = "heldjob000000000000000001", now = () => NOW } = {}) {
  const store = makeStore();
  const bus = new EventEmitter();
  const channel = makeChannel();
  const config = {
    timezone: "Etc/UTC",
    budget: { dailyUSD: 1 },
    projects: [{ id: projectId }],
  };
  const service = createBudgetService({ store, bus, channel, config, now });
  const job = addJob(store, { id });
  service.recordUsage({ source: "session", projectId, jobId: "prior-run", usage: { costUSD: 2 } });
  service.gate(job.id);
  await Promise.resolve();
  const card = channel.calls.find((call) => call.method === "send");
  const payload = card.replyMarkup.inline_keyboard[0][0].callback_data.slice(2);
  return { store, bus, channel, service, job, payload };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await budgetFeature.stop();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("budget ledger", () => {
  it("normalizes legacy costs, rejects negative and non-finite values, and preserves measured zero", () => {
    expect(foldLedger).toBeTypeOf("function");
    const service = createBudgetService({ store: makeStore(), now: () => NOW });
    expect(service).toBeTruthy();
    const raw = {
      costUSD: NaN,
      costUsd: -1,
      usd: 0,
      premiumRequests: Infinity,
    };
    expect(service.recordUsage({
      source: "session", projectId, usage: raw,
    })).toMatchObject({ costUSD: null, premiumRequests: null });
    expect(service.recordUsage({
      source: "session", projectId, usage: { usd: 0 },
    })).toMatchObject({ costUSD: 0, premiumRequests: null });
  });

  it.each([
    ["project", "costUSD", "dailyUSD", "cap-usd"],
    ["project", "premiumRequests", "dailyPremiumRequests", "cap-premium"],
    ["global", "costUSD", "dailyUSD", "cap-usd"],
    ["global", "premiumRequests", "dailyPremiumRequests", "cap-premium"],
  ])("uses strict exceeding boundaries for %s %s caps", (_scope, unit, capKey, reason) => {
    for (const delta of [-0.01, 0, 0.01]) {
      const store = makeStore();
      const cap = unit === "costUSD" ? 1 : 10;
      const config = _scope === "project"
        ? { projects: [{ id: projectId, budget: { [capKey]: cap } }] }
        : { budget: { [capKey]: cap }, projects: [{ id: projectId }] };
      const service = budgetService(store, { config });
      const amount = cap + delta;
      service.recordUsage({ source: "session", projectId, usage: { [unit]: amount } });
      const result = service.check({ mutating: true, projectId, type: "task" });
      expect(result.ok).toBe(delta <= 0);
      if (delta > 0) expect(result).toMatchObject({ reason, unit, cap });
    }
  });

  it("checks plan estimates from the caller and treats missing caps as unlimited", () => {
    const store = makeStore();
    const service = budgetService(store, { config: { budget: {}, projects: [{ id: projectId }] } });
    service.recordUsage({ source: "session", projectId, usage: { costUSD: 9 } });
    expect(service.check({ mutating: true, type: "task", projectId })).toEqual({ ok: true });
    expect(service.check({ mutating: true, type: "plan", projectId }, {
      estimate: { recommended: "auto", auto: { estimatedCostUSD: 1.01 } },
    })).toEqual({ ok: true });
    const capped = budgetService(store, {
      config: { budget: { dailyUSD: 10 }, projects: [{ id: projectId }] },
    });
    expect(capped.check({ mutating: true, type: "plan", projectId }, {
      estimate: { recommended: "auto", auto: { estimatedCostUSD: 1.01 } },
    })).toMatchObject({ ok: false, reason: "cap-usd", spent: 10.01 });
  });

  it("uses local calendar days across UTC midnight and falls back to UTC for invalid zones", () => {
    const beforeLocalMidnight = Date.parse("2026-10-07T06:59:00.000Z");
    const afterLocalMidnight = Date.parse("2026-10-07T07:00:00.000Z");
    expect(dayKey({ epochMs: beforeLocalMidnight, timeZone: "Etc/GMT+7" })).toBe("2026-10-06");
    expect(dayKey({ epochMs: afterLocalMidnight, timeZone: "Etc/GMT+7" })).toBe("2026-10-07");

    const store = makeStore();
    let localNow = beforeLocalMidnight;
    const localService = createBudgetService({
      store, config: { timezone: "Etc/GMT+7" }, now: () => localNow,
    });
    localService.recordUsage({
      source: "session", projectId, usage: { costUSD: 2 }, at: beforeLocalMidnight,
    });
    expect(localService.today().global.costUSD).toBe(2);
    expect(localService.today().day).toBe("2026-10-06");
    localNow = afterLocalMidnight;
    expect(localService.today().global.costUSD).toBeNull();

    const utcStore = makeStore();
    const utcService = createBudgetService({
      store: utcStore, config: { timezone: "Etc/GMT+7" }, now: () => Date.parse("2026-10-07T00:30:00Z"),
    });
    utcService.recordUsage({
      source: "session", projectId, usage: { costUSD: 1 }, at: Date.parse("2026-10-07T00:30:00Z"),
    });
    expect(utcService.today().day).toBe("2026-10-06");
    expect(utcService.today().global.costUSD).toBe(1);

    const invalid = createBudgetService({
      store: makeStore(), config: { timezone: "Not/AZone" }, now: () => NOW,
    });
    expect(invalid.today().timeZone).toBe("Etc/UTC");
    expect(invalid.today().day).toBe("2026-10-07");
  });

  it("distinguishes null, zero, partial usage, unknown jobs, and legacy asks", () => {
    const day = "2026-10-07";
    const recordsForDay = [
      { kind: "usage", source: "session", project: "p1", jobId: "null", at: NOW, costUSD: null, premiumRequests: null },
      { kind: "usage", source: "session", project: "p1", jobId: "zero", at: NOW, costUSD: 0, premiumRequests: null },
      { kind: "usage", source: "session", project: "p1", jobId: "partial", at: NOW, costUSD: null, premiumRequests: 2 },
      { kind: "usage", source: "cost-report", project: "p1", jobId: "null", at: NOW, costUSD: null, premiumRequests: null },
      { kind: "ask", source: "ask", project: "p1", usage: { costUsd: 3 }, ts: new Date(NOW).toISOString() },
    ];
    expect(foldLedger({ records: recordsForDay, timeZone: "Etc/UTC", day })).toEqual({
      global: { costUSD: 3, premiumRequests: 2, unknownUsageJobs: 1 },
      projects: {
        p1: { costUSD: 3, premiumRequests: 2, unknownUsageJobs: 1 },
      },
    });

    const store = makeStore();
    const service = budgetService(store, {
      config: { budget: { maxUnknownPerDay: 1 }, projects: [{ id: projectId }] },
    });
    service.recordUsage({ source: "session", projectId, jobId: "unknown-1", usage: {} });
    service.recordUsage({ source: "cost-report", projectId, jobId: "unknown-1", usage: {} });
    expect(service.check({ mutating: true, projectId, type: "task" })).toEqual({ ok: true });
    service.recordUsage({ source: "session", projectId, jobId: "unknown-2", usage: {} });
    expect(service.check({ mutating: true, projectId, type: "task" }))
      .toMatchObject({ ok: false, reason: "unknown-limit", cap: 1, spent: 2 });
  });

  it("deduplicates job/source records and makes run-specific cost reports replace sessions", () => {
    const store = makeStore();
    const service = budgetService(store);
    service.recordUsage({ source: "session", projectId, jobId: "job-1", usage: { costUSD: 8 } });
    service.recordUsage({ source: "cost-report", projectId, jobId: "job-1", usage: { costUSD: 2 } });
    service.recordUsage({ source: "cost-report", projectId, jobId: "job-1", usage: { costUSD: 3 } });
    service.recordUsage({ source: "session", projectId, jobId: "job-2", usage: { costUSD: 1 } });
    expect(service.today().global.costUSD).toBe(4);
  });

  it("CP10: replaces only the same project's session when job IDs match across projects", () => {
    const store = makeStore();
    const service = budgetService(store);
    service.recordUsage({ source: "session", projectId: "project-1", jobId: "shared-plan", usage: { costUSD: 8 } });
    service.recordUsage({ source: "session", projectId: "project-2", jobId: "shared-plan", usage: { costUSD: 5 } });
    service.recordUsage({ source: "cost-report", projectId: "project-1", jobId: "shared-plan", usage: { costUSD: 2 } });

    expect(service.today()).toMatchObject({
      global: { costUSD: 7, premiumRequests: null, unknownUsageJobs: 0 },
      projects: {
        "project-1": { costUSD: 2, premiumRequests: null, unknownUsageJobs: 0 },
        "project-2": { costUSD: 5, premiumRequests: null, unknownUsageJobs: 0 },
      },
    });
  });

  it("replaces session usage with run actuals even when the final report lands on a later day", () => {
    const store = makeStore();
    const previousDay = Date.parse("2026-10-06T23:30:00Z");
    const service = createBudgetService({ store, now: () => NOW });
    service.recordUsage({
      source: "session", projectId, jobId: "overnight-plan", usage: { costUSD: 8 }, at: previousDay,
    });
    service.recordUsage({
      source: "cost-report", projectId, jobId: "overnight-plan", usage: { costUSD: 2 }, at: NOW,
    });
    expect(service.today().global.costUSD).toBe(2);
    expect(service.today().projects[projectId].costUSD).toBe(2);
  });

  it("records held transitions synchronously before a runner can lease the job", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const config = {
      budget: { dailyUSD: 1 }, projects: [{ id: projectId }],
    };
    const service = createBudgetService({ store, bus, config, now: () => NOW });
    bus.on("job.transition", (event) => {
      if (event.to === "approved") service.gate(event.jobId);
    });
    const job = addJob(store, { state: "awaiting-approval" });
    service.recordUsage({ source: "session", projectId, usage: { costUSD: 2 } });
    const approvals = createApprovalService({ store, bus, now: () => NOW });
    const approval = issueApproval({
      jobId: job.id, chatId, threadId, requesterId: "requester-1", now: () => NOW,
    });
    approvals.issue(job, { approval });
    expect(await approvals.decide({
      payload: approval.approve.slice(2),
      caller: { userId: "owner-1", role: "owner" }, chatId, threadId,
    })).toMatchObject({ ok: true });
    expect(currentJobs(store)[job.id].state).toBe("held-budget");
    const runners = createRunners({ store });
    // D28: only the dispatcher leases; runners refuse anything not leased (held-budget included).
    await expect(Promise.resolve().then(() => runners.runJob(job, {})))
      .rejects.toMatchObject({ code: "JOB_NOT_LEASED" });
  });

  it("does not hold read jobs and pins the synchronous gate boundary with a source guard", () => {
    const store = makeStore();
    const job = addJob(store, { id: "readjob000000000000000001", type: "ask", mutating: false });
    const service = createBudgetService({
      store, config: { budget: { dailyUSD: 0 }, projects: [{ id: projectId }] }, now: () => NOW,
    });
    service.recordUsage({ source: "session", projectId, usage: { costUSD: 4 } });
    service.gate(job.id);
    expect(currentJobs(store)[job.id].state).toBe("approved");
    const source = readFileSync(new URL("../src/budget.mjs", import.meta.url), "utf8");
    const gate = source.slice(source.indexOf("  function gate(jobId) {"), source.indexOf("  function override(", source.indexOf("  function gate(jobId) {")));
    expect(gate).not.toMatch(/\bawait\b/);
    expect(gate.indexOf("append(JOBS_STREAM")).toBeLessThan(gate.indexOf("bus?.emit"));
  });

  it("fails closed when the budget ledger cannot be read", () => {
    const store = makeStore();
    const job = addJob(store);
    const read = store.read;
    store.read = function* readWithLedgerFailure(stream, options) {
      if (stream === "budget") throw Object.assign(new Error("unavailable"), { code: "STORE_READ_FAILED" });
      yield* read(stream, options);
    };
    const logger = { error: vi.fn() };
    const service = createBudgetService({ store, config: {}, logger, now: () => NOW });
    service.gate(job.id);
    store.read = read;
    expect(currentJobs(store)[job.id].state).toBe("held-budget");
    expect(records(store, JOBS_STREAM).at(-1).reason).toBe("budget:error");
    expect(logger.error).toHaveBeenCalledWith("Budget check failed; holding job", { code: "STORE_READ_FAILED" });
  });

  it("allows the owner to release a held job once and refuses invalid overrides", async () => {
    const fixture = await makeHeldJob();
    const { service, payload, store, job, channel } = fixture;
    expect(service.override({ payload, caller: { role: "approver", userId: "a" }, chatId, threadId }))
      .toMatchObject({ ok: false, reason: "role" });
    expect(service.override({ payload, caller: { role: "viewer", userId: "v" }, chatId, threadId }))
      .toMatchObject({ ok: false, reason: "role" });
    expect(service.override({
      payload: `${payload.slice(0, -1)}X`,
      caller: { role: "owner", userId: "owner-1" }, chatId, threadId,
    })).toMatchObject({ ok: false, reason: "tampered" });
    expect(service.override({
      payload, caller: { role: "owner", userId: "owner-1" }, chatId: "wrong", threadId,
    })).toMatchObject({ ok: false, reason: "chat" });

    const released = service.override({
      payload, caller: { role: "owner", userId: "owner-1" }, chatId, threadId,
    });
    expect(released).toEqual({ ok: true, jobId: job.id });
    expect(currentJobs(store)[job.id].state).toBe("approved");
    expect(service.override({
      payload, caller: { role: "owner", userId: "owner-1" }, chatId, threadId,
    })).toMatchObject({ ok: false, reason: "used" });
    expect(records(store)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "override.consumed", jobId: job.id }),
      expect.objectContaining({ kind: "override", jobId: job.id }),
    ]));
    service.audit({ kind: "budget-override-released", jobId: job.id });
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({ kind: "budget-audit" }));
    expect(channel.calls[0].replyMarkup.inline_keyboard[0][0].text).toBe("Approve over budget");
  });

  it("refuses expired and stale override payloads", async () => {
    let now = NOW;
    const fixture = await makeHeldJob({ now: () => now });
    const issued = records(fixture.store).find((record) => record.kind === "override.issued");
    now = issued.expiresAt + 1;
    expect(fixture.service.override({
      payload: fixture.payload, caller: { role: "owner", userId: "owner-1" }, chatId, threadId,
    })).toMatchObject({ ok: false, reason: "expired" });

    now = NOW;
    const stale = await makeHeldJob({ id: "stalejob000000000000000001", now: () => now });
    const transitionBack = transition(currentJobs(stale.store)[stale.job.id], "approved");
    stale.store.append(JOBS_STREAM, transitionBack.event);
    expect(stale.service.override({
      payload: stale.payload, caller: { role: "owner", userId: "owner-1" }, chatId, threadId,
    })).toMatchObject({ ok: false, reason: "stale" });
  });

  it("CP12: refuses an override at its exact expiry without releasing the hold", async () => {
    let now = NOW;
    const fixture = await makeHeldJob({ now: () => now });
    now = records(fixture.store).find((record) => record.kind === "override.issued").expiresAt;

    expect(fixture.service.override({
      payload: fixture.payload, caller: { role: "owner", userId: "owner-1" }, chatId, threadId,
    })).toMatchObject({ ok: false, reason: "expired" });
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
    expect(records(fixture.store).filter((record) => record.kind === "override.consumed")).toEqual([]);
  });

  it("edits successful hold cards and sends a neutral response for refused callbacks", async () => {
    const fixture = await makeHeldJob({ id: "callbackjob0000000000000001" });
    const unbind = bindBudgetService(fixture.service);
    try {
      await budgetCallback.handle({}, {
        payload: fixture.payload,
        caller: { role: "owner", userId: "owner-1" },
        chatId, threadId, messageId: "hold-card",
      });
      expect(fixture.channel.calls.at(-1)).toMatchObject({
        method: "edit",
        text: "✅ Released over budget by owner-1",
        replyMarkup: { inline_keyboard: [] },
      });
      expect(records(fixture.store, "audit")).toContainEqual(expect.objectContaining({
        kind: "budget-audit", action: "budget-override-released",
      }));

      const second = await makeHeldJob({ id: "callbackjob0000000000000002" });
      unbind();
      const unbindSecond = bindBudgetService(second.service);
      try {
        await budgetCallback.handle({}, {
          payload: "not-valid",
          caller: { role: "owner", userId: "owner-1" },
          chatId, threadId,
        });
        expect(second.channel.calls.at(-1)).toMatchObject({
          method: "send", text: "This override is no longer valid.",
        });
      } finally {
        unbindSecond();
      }
    } finally {
      unbind();
    }
  });

  it.each(["succeeded", "failed", "cancelled"])(
    "CP10 native: consumes verified %s job actuals despite a different concurrent home report",
    async (state) => {
      const store = makeStore();
      const bus = new EventEmitter();
      const manager = nativeManager();
      const job = addPlanJob(store);
      const actuals = nativeActuals(job);
      await budgetFeature.start({
        store, bus, mcp: manager, now: () => NOW, config: { projects: [{ id: projectId }] },
      });
      bus.emit("job.finished", { type: "plan", jobId: job.id, projectId, state, planActuals: actuals });
      await budgetFeature.stop();

      expect(manager.call).not.toHaveBeenCalled();
      expect(manager.get).not.toHaveBeenCalled();
      expect(actuals.runId).not.toBe(job.id);
      expect(records(store).filter((record) => record.kind === "usage")).toEqual([
        expect.objectContaining({
          source: "cost-report", project: projectId, jobId: job.id,
          runId: actuals.runId, plan: PLAN_LABEL, endedAt: actuals.endedAt,
          costUSD: 0.42, premiumRequests: null,
        }),
      ]);
      expect(budgetService(store).today().global).toEqual({
        costUSD: 0.42, premiumRequests: null, unknownUsageJobs: 0,
      });
    },
  );

  it("CP10 native: scopes two project actuals and persists one per job across duplicate delivery and restart", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const manager = nativeManager();
    const jobs = [
      addPlanJob(store, { id: "plan-a", project: "project-1" }),
      addPlanJob(store, { id: "plan-b", project: "project-2" }),
    ];
    const usage = [{ costUSD: 0.25, premiumRequests: 3 }, { costUSD: 0, premiumRequests: null }];
    const events = jobs.map((job, index) => ({
      type: "plan", jobId: job.id, projectId: job.projectId,
      planActuals: nativeActuals(job, { usage: usage[index] }),
    }));
    const ctx = {
      store, bus, mcp: manager, now: () => NOW,
      config: { projects: [{ id: "project-1" }, { id: "project-2" }] },
    };
    await budgetFeature.start(ctx);
    for (const event of events) {
      bus.emit("job.finished", event);
      bus.emit("job.finished", event);
    }
    await budgetFeature.stop();

    expect(manager.call).not.toHaveBeenCalled();
    expect(manager.get).not.toHaveBeenCalled();
    expect(records(store).filter((record) => record.kind === "usage")).toEqual([
      expect.objectContaining({
        project: "project-1", jobId: "plan-a", runId: "native-plan-a", costUSD: 0.25, premiumRequests: 3,
      }),
      expect.objectContaining({
        project: "project-2", jobId: "plan-b", runId: "native-plan-b", costUSD: 0, premiumRequests: null,
      }),
    ]);
    expect(budgetService(store).today().global).toEqual({
      costUSD: 0.25, premiumRequests: 3, unknownUsageJobs: 0,
    });
    for (const name of ["job.transition", "lane.event", "job.finished"]) expect(bus.listenerCount(name)).toBe(0);
    bus.emit("job.finished", events[0]);

    const restartedStore = createStore(storeDirectories.get(store), { now: () => new Date(NOW) });
    await budgetFeature.start({ ...ctx, store: restartedStore });
    for (const event of events) bus.emit("job.finished", event);
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(restartedStore).filter((record) => record.kind === "usage")).toHaveLength(2);
  });

  it("CP10 native: never invokes function-bound home clients and preserves independent partial usage", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const clients = {
      "project-1": { call: vi.fn(async () => nativeHomeReport()) },
      "project-2": { call: vi.fn(async () => nativeHomeReport()) },
    };
    const factory = vi.fn(async ({ projectId: selected }) => clients[selected]);
    const first = addPlanJob(store, { id: "partial-a", project: "project-1" });
    const second = addPlanJob(store, { id: "partial-b", project: "project-2" });
    await budgetFeature.start({
      store, bus, mcp: factory, now: () => NOW,
      config: { projects: [{ id: "project-1" }, { id: "project-2" }] },
    });
    for (const [job, usage] of [
      [first, { costUSD: null, premiumRequests: 2 }],
      [second, { costUSD: 0, premiumRequests: null }],
    ]) {
      bus.emit("job.finished", {
        type: "plan", jobId: job.id, projectId: job.projectId, planActuals: nativeActuals(job, { usage }),
      });
    }
    await budgetFeature.stop();

    expect(factory).not.toHaveBeenCalled();
    expect(clients["project-1"].call).not.toHaveBeenCalled();
    expect(clients["project-2"].call).not.toHaveBeenCalled();
    expect(budgetService(store).today()).toMatchObject({
      global: { costUSD: 0, premiumRequests: 2, unknownUsageJobs: 0 },
      projects: {
        "project-1": { costUSD: null, premiumRequests: 2, unknownUsageJobs: 0 },
        "project-2": { costUSD: 0, premiumRequests: null, unknownUsageJobs: 0 },
      },
    });
  });

  it("CP10 native: explicit ledger actuals override unrelated usage and wrong-plan evidence becomes unknown", () => {
    const store = makeStore();
    const job = addPlanJob(store);
    const service = budgetService(store);
    const actuals = nativeActuals(job);
    expect(service.recordUsage({
      source: "cost-report", projectId, jobId: job.id,
      usage: { costUSD: 999, premiumRequests: 999 }, planActuals: actuals,
    })).toMatchObject({
      costUSD: 0.42, premiumRequests: null, runId: actuals.runId, plan: PLAN_LABEL, endedAt: actuals.endedAt,
    });

    const wrongPlan = addPlanJob(store, { id: "wrong-plan" });
    const unknown = service.recordUsage({
      source: "cost-report", projectId, jobId: wrongPlan.id,
      usage: { costUSD: 999, premiumRequests: 999 },
      planActuals: nativeActuals(wrongPlan, { plan: "Different-Plan.md" }),
    });
    expect(unknown).toMatchObject({ costUSD: null, premiumRequests: null });
    expect(unknown.runId).toBeUndefined();
  });

  it("CP10 native: keeps the native run ID distinct from scoped Claw job identity", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const manager = nativeManager();
    await budgetFeature.start({
      store, bus, mcp: manager, now: () => NOW,
      config: { projects: [{ id: "project-1" }, { id: "project-2" }] },
    });
    for (const [project, id, costUSD] of [["project-1", "shared-a", 2], ["project-2", "shared-b", 5]]) {
      const job = addPlanJob(store, { id, project });
      bus.emit("job.finished", {
        type: "plan", jobId: id, projectId: project,
        planActuals: nativeActuals(job, {
          runId: "native-shared-run", usage: { costUSD, premiumRequests: null },
        }),
      });
    }
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(budgetService(store).today()).toMatchObject({
      global: { costUSD: 7, premiumRequests: null, unknownUsageJobs: 0 },
      projects: {
        "project-1": { costUSD: 2, premiumRequests: null, unknownUsageJobs: 0 },
        "project-2": { costUSD: 5, premiumRequests: null, unknownUsageJobs: 0 },
      },
    });
    expect(records(store).filter((record) => record.kind === "usage").map((record) => ({
      project: record.project, jobId: record.jobId, runId: record.runId,
    }))).toEqual([
      { project: "project-1", jobId: "shared-a", runId: "native-shared-run" },
      { project: "project-2", jobId: "shared-b", runId: "native-shared-run" },
    ]);
  });

  it("CP10 native: persists one unknown without a home query or new backfill policy after restart", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const manager = nativeManager();
    const logger = { error: vi.fn(), warn: vi.fn() };
    const job = addPlanJob(store);
    const ctx = { store, bus, mcp: manager, now: () => NOW, logger, config: { projects: [{ id: projectId }] } };
    const event = { type: "plan", jobId: job.id, projectId, planActuals: null, planActualsError: "PLAN_ACTUALS_UNCONFIRMED" };
    await budgetFeature.start(ctx);
    bus.emit("job.finished", event);
    bus.emit("job.finished", event);
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(store).filter((record) => record.kind === "usage")).toEqual([
      expect.objectContaining({
        source: "cost-report", project: projectId, jobId: job.id, costUSD: null, premiumRequests: null,
      }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { code: "PLAN_ACTUALS_UNCONFIRMED" });

    const restartedStore = createStore(storeDirectories.get(store), { now: () => new Date(NOW) });
    await budgetFeature.start({ ...ctx, store: restartedStore });
    bus.emit("job.finished", { ...event, planActuals: nativeActuals(job) });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(restartedStore).filter((record) => record.kind === "usage")).toHaveLength(1);
    expect(budgetService(restartedStore).today().global).toEqual({
      costUSD: null, premiumRequests: null, unknownUsageJobs: 1,
    });
  });

  it.each([
    ["absent actuals", () => undefined],
    ["explicit unknown", () => null],
    ["scalar actuals", () => 0],
    ["encoded actuals", (job) => JSON.stringify(nativeActuals(job))],
    ["array actuals", (job) => [nativeActuals(job)]],
    ["wrong job", (job) => nativeActuals(job, { jobId: "another-job" })],
    ["wrong project", (job) => nativeActuals(job, { projectId: "another-project" })],
    ["missing native run", (job) => nativeActuals(job, { runId: null })],
    ["unsafe native run", (job) => nativeActuals(job, { runId: "../another-run" })],
    ["wrong plan", (job) => nativeActuals(job, { plan: "Another-Plan.md" })],
    ["private plan path", (job) => nativeActuals(job, { plan: "C:\\private\\workspace\\Native-Budget-Plan.md" })],
    ["missing native end time", (job) => nativeActuals(job, { endedAt: undefined })],
    ["invalid native end time", (job) => nativeActuals(job, { endedAt: "not-a-date" })],
    ["missing usage", (job) => nativeActuals(job, { usage: null })],
    ["negative USD", (job) => nativeActuals(job, { usage: { costUSD: -1, premiumRequests: null } })],
    ["nonfinite USD", (job) => nativeActuals(job, { usage: { costUSD: NaN, premiumRequests: null } })],
    ["invalid premium type", (job) => nativeActuals(job, { usage: { costUSD: 0.42, premiumRequests: "5" } })],
    ["native aggregate-only report", () => nativeHomeReport()],
    ["native latest without run/job identity", () => ({ ...nativeHomeReport().latest })],
    ["legacy invented run rows", (job) => ({ runs: [{ runId: job.id, costUSD: 999 }] })],
  ])("CP10 native: records %s as explicit unknown, never aggregates or guessed run rows", async (_name, supplied) => {
    const store = makeStore();
    const bus = new EventEmitter();
    const manager = nativeManager();
    const job = addPlanJob(store);
    const logger = { error: vi.fn(), warn: vi.fn() };
    await budgetFeature.start({
      store, bus, mcp: manager, now: () => NOW, logger,
      config: { budget: { maxUnknownPerDay: 0 }, projects: [{ id: projectId }] },
    });
    bus.emit("job.finished", {
      type: "plan", jobId: job.id, projectId, runId: "native-top-level-is-not-proof",
      planActuals: supplied(job),
    });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(store).filter((record) => record.kind === "usage")).toEqual([
      expect.objectContaining({
        source: "cost-report", project: projectId, jobId: job.id, costUSD: null, premiumRequests: null,
      }),
    ]);
    expect(records(store).find((record) => record.kind === "usage").runId).toBeUndefined();
    const service = budgetService(store, {
      config: { budget: { maxUnknownPerDay: 0 }, projects: [{ id: projectId }] },
    });
    expect(service.today().global).toEqual({ costUSD: null, premiumRequests: null, unknownUsageJobs: 1 });
    expect(service.check({ mutating: true, projectId, type: "task" })).toMatchObject({
      ok: false, reason: "unknown-limit", spent: 1, cap: 0,
    });
  });

  it("CP10 native: missing premium preserves reported zero rather than making the entire job unknown", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const job = addPlanJob(store);
    const manager = nativeManager();
    await budgetFeature.start({ store, bus, mcp: manager, now: () => NOW });
    bus.emit("job.finished", {
      type: "plan", jobId: job.id, projectId,
      planActuals: nativeActuals(job, { usage: { costUSD: 0 } }),
    });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(budgetService(store).today().global).toEqual({
      costUSD: 0, premiumRequests: null, unknownUsageJobs: 0,
    });
  });

  it("CP10 native: raw lane terminal data and task/SDK facts do not bypass dispatcher-owned completion", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const manager = nativeManager();
    const job = addPlanJob(store);
    const task = addJob(store, { id: "plain-task", state: "queued" });
    const actuals = nativeActuals(job);
    await budgetFeature.start({ store, bus, mcp: manager, now: () => NOW });
    bus.emit("lane.event", { type: "finished", jobId: job.id, data: { status: "succeeded", planActuals: actuals } });
    bus.emit("job.finished", { type: "task", jobId: task.id, projectId, planActuals: nativeActuals(task) });
    expect(records(store).filter((record) => record.kind === "usage")).toEqual([]);

    bus.emit("job.finished", { type: "plan", jobId: job.id, projectId, planActuals: actuals });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(store).filter((record) => record.kind === "usage")).toHaveLength(1);
    expect(budgetService(store).today().global.costUSD).toBe(0.42);
  });

  it.each(["result", "data"])("CP10 native: does not promote misplaced %s.planActuals as final proof", async (field) => {
    const store = makeStore();
    const bus = new EventEmitter();
    const job = addPlanJob(store);
    const manager = nativeManager();
    await budgetFeature.start({ store, bus, mcp: manager, now: () => NOW });
    bus.emit("job.finished", {
      type: "plan", jobId: job.id, projectId, [field]: { planActuals: nativeActuals(job) },
    });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(budgetService(store).today().global).toEqual({
      costUSD: null, premiumRequests: null, unknownUsageJobs: 1,
    });
  });

  it("CP10 native: stop removes listeners/service without starting or waiting for an unrelated home call", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const job = addPlanJob(store);
    let resolveReport;
    const pendingReport = new Promise((resolve) => { resolveReport = resolve; });
    const manager = { get: vi.fn(), call: vi.fn(() => pendingReport) };
    await budgetFeature.start({ store, bus, mcp: manager, now: () => NOW });
    const event = {
      type: "plan", jobId: job.id, projectId,
      planActuals: nativeActuals(job, { usage: { costUSD: 0.5, premiumRequests: null } }),
    };
    bus.emit("job.finished", event);
    bus.emit("job.finished", event);
    const stopping = budgetFeature.stop();
    for (const name of ["job.transition", "lane.event", "job.finished"]) expect(bus.listenerCount(name)).toBe(0);
    expect(getBudgetService()).toBeNull();
    bus.emit("job.finished", { ...event, jobId: "after-stop" });
    resolveReport(nativeHomeReport());
    await stopping;
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(store).filter((record) => record.kind === "usage")).toHaveLength(1);
    expect(records(store).find((record) => record.kind === "usage")).toMatchObject({
      jobId: job.id, costUSD: 0.5, premiumRequests: null,
    });
    expect(bus.eventNames()).toEqual([]);
  });

  it("CP10 native: snapshots nested actuals before a later event mutation", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const job = addPlanJob(store);
    const manager = nativeManager();
    const actuals = nativeActuals(job, { usage: { costUSD: 0, premiumRequests: 2 } });
    const event = { type: "plan", jobId: job.id, projectId, planActuals: actuals };
    await budgetFeature.start({ store, bus, mcp: manager, now: () => NOW });
    bus.emit("job.finished", event);
    event.jobId = "different-job";
    event.projectId = "different-project";
    actuals.runId = "different-run";
    actuals.plan = "C:\\private\\changed-plan.md";
    actuals.usage.costUSD = 999;
    actuals.usage.premiumRequests = 999;
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(store).find((record) => record.kind === "usage")).toMatchObject({
      project: projectId, jobId: job.id, runId: `native-${job.id}`, plan: PLAN_LABEL,
      costUSD: 0, premiumRequests: 2,
    });
  });

  it("CP10 native: records the observed run end time rather than a late delivery date", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const job = addPlanJob(store);
    const manager = nativeManager();
    const deliveredAt = NOW + 86_400_000;
    await budgetFeature.start({ store, bus, mcp: manager, now: () => deliveredAt });
    bus.emit("job.finished", {
      type: "plan", jobId: job.id, projectId, ts: new Date(deliveredAt).toISOString(),
      planActuals: nativeActuals(job),
    });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(records(store).find((record) => record.kind === "usage")).toMatchObject({
      at: NOW, endedAt: new Date(NOW).toISOString(), costUSD: 0.42, premiumRequests: null,
    });
    expect(foldLedger({ records: records(store), day: "2026-10-07", timeZone: "Etc/UTC" }).global.costUSD).toBe(0.42);
    expect(foldLedger({ records: records(store), day: "2026-10-08", timeZone: "Etc/UTC" }).global.costUSD).toBeNull();
  });

  it("CP10 native: validates a directory-qualified stored plan but persists only the safe basename", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const manager = nativeManager();
    const job = addPlanJob(store, { id: "qualified-plan", planPath: PLAN_PATH });
    const unsafe = addPlanJob(store, { id: "unsafe-plan-label", planPath: PLAN_PATH });
    await budgetFeature.start({ store, bus, mcp: manager, now: () => NOW });
    bus.emit("job.finished", { type: "plan", jobId: job.id, projectId, planActuals: nativeActuals(job) });
    bus.emit("job.finished", {
      type: "plan", jobId: unsafe.id, projectId, planActuals: nativeActuals(unsafe, { plan: PLAN_PATH }),
    });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    const usage = records(store).filter((record) => record.kind === "usage");
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ jobId: job.id, plan: PLAN_LABEL, costUSD: 0.42 });
    expect(usage[1]).toMatchObject({ jobId: unsafe.id, costUSD: null, premiumRequests: null });
    expect(usage[1].plan).toBeUndefined();
    expect(JSON.stringify(usage)).not.toContain(PLAN_PATH.replaceAll("\\", "\\\\"));
  });

  it("CP10 native: discards private/credential fields without logging or serializing them", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const job = addPlanJob(store);
    const manager = nativeManager();
    const logger = { error: vi.fn(), warn: vi.fn() };
    await budgetFeature.start({ store, bus, mcp: manager, logger, now: () => NOW });
    bus.emit("job.finished", {
      type: "plan", jobId: job.id, projectId,
      planActuals: nativeActuals(job, {
        workspacePath: "C:\\private\\workspace",
        apiKey: "discarded-provider-value",
        usage: { costUSD: 0.42, premiumRequests: null, providerKey: "discarded-provider-value" },
      }),
    });
    await budgetFeature.stop();
    expect(manager.call).not.toHaveBeenCalled();
    expect(budgetService(store).today().global.costUSD).toBe(0.42);
    const persisted = JSON.stringify(records(store));
    expect(persisted).not.toContain("workspacePath");
    expect(persisted).not.toContain("apiKey");
    expect(persisted).not.toContain("discarded-provider-value");
    expect(JSON.stringify([...logger.error.mock.calls, ...logger.warn.mock.calls])).not.toContain("discarded-provider-value");
  });

  describe("Guard: native plan actuals acquisition stays with the producer", () => {
    it("budget consumes typed completion only while the producer retains the cost-report query", () => {
      const consumer = readFileSync(new URL("../src/features/budget.mjs", import.meta.url), "utf8");
      const producer = readFileSync(new URL("../src/jobs/plan-process.mjs", import.meta.url), "utf8");
      expect(consumer).not.toContain("forge_cost_report");
      expect(consumer).not.toContain("runSpecificReport");
      expect(producer).toContain("forge_cost_report");
      expect(producer).toContain("collectPlanActuals");
    });
  });

  it("records session costs and removes listeners cleanly across restarts", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const ctx = { store, bus, config: { projects: [{ id: projectId }] }, now: () => NOW };
    await budgetFeature.start(ctx);
    expect(bus.listenerCount("job.transition")).toBe(1);
    expect(bus.listenerCount("lane.event")).toBe(1);
    expect(bus.listenerCount("job.finished")).toBe(1);
    addJob(store, { id: "sessionjob000000000000000001", type: "plan" });
    bus.emit("lane.event", {
      type: "cost", jobId: "sessionjob000000000000000001", ts: new Date(NOW).toISOString(),
      data: { costUSD: 0, premiumRequests: 0 },
    });
    expect(records(store)).toContainEqual(expect.objectContaining({
      source: "session", project: projectId, costUSD: 0, premiumRequests: 0,
    }));
    await budgetFeature.stop();
    expect(bus.listenerCount("job.transition")).toBe(0);
    expect(bus.listenerCount("lane.event")).toBe(0);
    expect(bus.listenerCount("job.finished")).toBe(0);
    await budgetFeature.start(ctx);
    await budgetFeature.start(ctx);
    expect(bus.listenerCount("job.transition")).toBe(1);
    await budgetFeature.stop();
  });

  it("keeps the compact snapshot under one kilobyte", () => {
    const service = budgetService(makeStore());
    expect(Buffer.byteLength(JSON.stringify(service.snapshot()), "utf8")).toBeLessThanOrEqual(1024);
  });
});
