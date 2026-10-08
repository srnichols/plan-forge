import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBudgetService, createBudgetService, dayKey, foldLedger } from "../src/budget.mjs";
import { createApprovalService, issueApproval } from "../src/approvals.mjs";
import budgetCallback from "../src/callbacks/b.mjs";
import budgetFeature from "../src/features/budget.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createRunners } from "../src/jobs/runners.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];
const projectId = "project-1";
const chatId = "chat-1";
const threadId = "topic-1";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function makeStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-budget-"));
  directories.push(directory);
  return createStore(directory);
}

function addJob(store, {
  id = "abcdef0123456789abcdef01",
  type = "task",
  state = "approved",
  project = projectId,
  mutating,
} = {}) {
  const created = createJob({ id, type, projectId: project });
  const job = {
    ...created.job,
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
    await expect(runners.runJob(job, {})).rejects.toMatchObject({ code: "JOB_NOT_LEASED" });
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

  it("collects one plan-specific actual report and records failures as unknown", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const mcpCall = vi.fn(async (name, args) => {
      expect(name).toBe("forge_cost_report");
      expect(args).toMatchObject({ runId: "plan-1" });
      return { content: [{ type: "text", text: JSON.stringify({
        total_cost_usd: 999,
        runs: [{ runId: "plan-1", total_cost_usd: 0.42, premiumRequests: 2 }],
      }) }] };
    });
    const logger = { error: vi.fn(), warn: vi.fn() };
    await budgetFeature.start({
      store, bus, config: { projects: [{ id: projectId }] },
      mcp: async () => ({ call: mcpCall }), now: () => NOW, logger,
    });
    bus.emit("job.finished", { type: "plan", jobId: "plan-1", projectId });
    await budgetFeature.stop();
    expect(mcpCall).toHaveBeenCalledTimes(1);
    expect(records(store)).toContainEqual(expect.objectContaining({
      kind: "usage", source: "cost-report", jobId: "plan-1", costUSD: 0.42, premiumRequests: 2,
    }));

    const failureStore = makeStore();
    const failureBus = new EventEmitter();
    await budgetFeature.start({
      store: failureStore, bus: failureBus, config: { projects: [{ id: projectId }] },
      mcp: async () => ({ call: async () => { throw Object.assign(new Error("no"), { code: "MCP_FAIL" }); } }),
      now: () => NOW, logger,
    });
    failureBus.emit("job.finished", { type: "plan", jobId: "plan-2", projectId });
    await budgetFeature.stop();
    expect(records(failureStore)).toContainEqual(expect.objectContaining({
      kind: "usage", source: "cost-report", jobId: "plan-2", costUSD: null, premiumRequests: null,
    }));
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
