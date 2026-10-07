import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import { bindBudgetService, createBudgetService } from "../src/budget.mjs";
import {
  buildStatusRollup,
  onChildTerminal,
  parseFanoutArgs,
  parseRecallAll,
  prepareFanout,
  recallAll,
  reconcile,
  renderStatusRollup,
  visibleProjects,
} from "../src/crossproject.mjs";
import crossprojectFeature from "../src/features/crossproject.mjs";
import approvalsFeature from "../src/features/approvals.mjs";
import budgetFeature from "../src/features/budget.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const config = {
  timezone: "Etc/UTC",
  budget: { dailyUSD: 100 },
  projects: [
    { id: "alpha", name: "Alpha", budget: { dailyUSD: 10, dailyPremiumRequests: 5 } },
    { id: "beta", name: "Beta", budget: { dailyUSD: 20, dailyPremiumRequests: 8 } },
    { id: "secret-canary-x", name: "Restricted Canary", visibility: "restricted" },
  ],
};

function makeStore() {
  const streams = new Map();
  return {
    append(stream, record) {
      const records = streams.get(stream) ?? [];
      records.push({ record: structuredClone(record) });
      streams.set(stream, records);
      return record;
    },
    read(stream) {
      return streams.get(stream) ?? [];
    },
    fold(stream, reducer, initial) {
      return (streams.get(stream) ?? []).reduce((state, { record }) => reducer(state, record), initial);
    },
  };
}

function makeChannel() {
  const calls = [];
  return {
    calls,
    async send(payload) {
      calls.push({ method: "send", ...payload });
      return [{ chatId: String(payload.chatId), messageId: `message-${calls.length}`, threadId: payload.threadId }];
    },
    async edit(payload) {
      calls.push({ method: "edit", ...payload });
    },
  };
}

function makeRuntime(overrides = {}) {
  const store = overrides.store ?? makeStore();
  const bus = overrides.bus ?? new EventEmitter();
  const channel = overrides.channel ?? makeChannel();
  const logger = { error: vi.fn(), warn: vi.fn() };
  const runtimeConfig = overrides.config ?? config;
  const now = overrides.now ?? (() => NOW);
  const budget = overrides.budget ?? createBudgetService({
    store, bus, config: runtimeConfig, channel, logger, now,
  });
  const unbindBudget = bindBudgetService(budget);
  const ctx = {
    store,
    bus,
    channel,
    config: runtimeConfig,
    registry: { all: () => runtimeConfig.projects },
    logger,
    now,
    approvalTtlMs: overrides.approvalTtlMs,
    approvalIntervalMs: 60_000,
    budget,
  };
  return {
    ...ctx,
    approvals: createApprovalService({ store, bus, channel, logger, now, ttlMs: overrides.approvalTtlMs }),
    cleanup: () => unbindBudget(),
  };
}

function addJob(store, { id, projectId, type = "task", state = "queued", parentId = null, ...fields }) {
  let job = { ...createJob({ id, projectId, type, parentId }).job, ...fields };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  while (job.state !== state) {
    const next = {
      queued: type === "fanout" || job.mutating ? "awaiting-approval" : "leased",
      "awaiting-approval": "approved",
      approved: state === "held-budget" ? "held-budget" : "leased",
      leased: "running",
      running: state,
    }[job.state];
    const updated = transition(job, next);
    store.append(JOBS_STREAM, updated.event);
    job = updated.job;
  }
  return job;
}

function transitionStored(runtime, jobId, to) {
  const job = currentJobs(runtime.store)[jobId];
  const updated = transition(job, to, { reason: "test" });
  runtime.store.append(JOBS_STREAM, updated.event);
  runtime.bus.emit("job.transition", updated.event);
  return updated.job;
}

async function createPendingFanout(runtime, argsText = "check the project") {
  const result = prepareFanout({
    store: runtime.store,
    config: runtime.config,
    registry: runtime.registry,
    caller: { userId: "requester" },
    chatId: "general-chat",
    threadId: "general-topic",
  }, { argsText });
  expect(result.text).toContain("awaiting approval");
  const parentId = /^Fan-out ([A-Za-z0-9._-]+)/.exec(result.text)?.[1];
  return currentJobs(runtime.store)[parentId];
}

async function startFeatures(runtime) {
  await approvalsFeature.start(runtime);
  await budgetFeature.start(runtime);
  await crossprojectFeature.start(runtime);
}

afterEach(async () => {
  await crossprojectFeature.stop();
  await budgetFeature.stop();
  await approvalsFeature.stop();
});

describe("cross-project status and fan-out", () => {
  it("rolls up visible project counts and spend while preserving unknown usage", () => {
    const store = makeStore();
    addJob(store, { id: "alpha-active-1", projectId: "alpha", state: "awaiting-approval" });
    addJob(store, { id: "alpha-active-2", projectId: "alpha", state: "held-budget" });
    addJob(store, { id: "alpha-active-3", projectId: "alpha", state: "running" });
    addJob(store, { id: "alpha-active-4", projectId: "alpha", state: "running" });
    addJob(store, { id: "beta-queued", projectId: "beta" });
    const budget = createBudgetService({ store, config, now: () => NOW });
    budget.recordUsage({ source: "session", projectId: "alpha", usage: { costUSD: 2, premiumRequests: 1 } });

    const rollup = buildStatusRollup({
      store, budget, config, registry: { all: () => config.projects }, scope: "general", now: () => NOW,
    });
    const rendered = renderStatusRollup(rollup);
    expect(rollup.projects).toHaveLength(2);
    expect(rollup.projects[0]).toMatchObject({
      counts: { queued: 0, "awaiting-approval": 1, "held-budget": 1, running: 2 },
      activeJobIds: ["alpha-active-1", "alpha-active-2", "alpha-active-3", "+1 more"],
      spend: { costUSD: 2, premiumRequests: 1 },
      caps: { costUSD: 10, premiumRequests: 5 },
    });
    expect(rollup.projects[1].spend).toEqual({ costUSD: null, premiumRequests: null });
    expect(rendered).toContain("Alpha: queued 0");
    expect(rendered).toContain("Beta: queued 1");
    expect(rendered).toContain("unknown");
    expect(rendered).not.toContain("secret-canary-x");

    const restrictedTopic = buildStatusRollup({
      store, config, registry: { all: () => config.projects }, scope: "project", projectId: "secret-canary-x",
    });
    expect(renderStatusRollup(restrictedTopic)).toContain("Restricted Canary");
    expect(visibleProjects({ config, scope: "general" }).map((project) => project.id))
      .not.toContain("secret-canary-x");
  });

  it("creates one approval card listing every child without exposing restricted projects", async () => {
    const runtime = makeRuntime();
    await startFeatures(runtime);
    try {
      const parent = await createPendingFanout(runtime);
      await approvalsFeature.tick();
      const sends = runtime.channel.calls.filter((call) => call.method === "send");
      expect(sends).toHaveLength(1);
      for (const target of parent.targets) {
        expect(sends[0].text).toContain(target.childId);
        expect(sends[0].text).toContain(target.branch);
      }
      expect(sends[0].text).not.toContain("secret-canary-x");
      const pending = runtime.approvals.pendingWithoutCard().map((job) => job.id);
      expect(parent.targets.every((target) => !pending.includes(target.childId))).toBe(true);
      expect(() => prepareFanout({
        store: runtime.store,
        config,
        registry: runtime.registry,
      }, { argsText: "work -- secret-canary-x" })).toThrowError(
        expect.objectContaining({ code: "FANOUT_UNKNOWN_PROJECT" }),
      );
    } finally {
      runtime.cleanup();
    }
  });

  it("approves, rejects, expires, and rejects replay of all fan-out children", async () => {
    let now = NOW;
    const runtime = makeRuntime({ now: () => now, approvalTtlMs: 10 });
    await startFeatures(runtime);
    try {
      const approvedParent = await createPendingFanout(runtime);
      await approvalsFeature.tick();
      const approvePayload = runtime.channel.calls[0].replyMarkup.inline_keyboard[0][0].callback_data;
      expect(await runtime.approvals.decide({
        payload: approvePayload.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      })).toMatchObject({ ok: true, decision: "approve" });
      expect(currentJobs(runtime.store)[approvedParent.id].state).toBe("running");
      for (const target of approvedParent.targets) {
        expect(currentJobs(runtime.store)[target.childId].state).toBe("approved");
        expect(runtime.store.read("audit").map(({ record }) => record)).toContainEqual(expect.objectContaining({
          kind: "fanout.child-approved", parentId: approvedParent.id, jobId: target.childId,
        }));
      }
      expect(await runtime.approvals.decide({
        payload: approvePayload.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      })).toMatchObject({ ok: false, reason: "replay" });

      const rejectedParent = await createPendingFanout(runtime, "review pull requests -- alpha");
      await approvalsFeature.tick();
      const rejectPayload = runtime.channel.calls.at(-1).replyMarkup.inline_keyboard[0][1].callback_data;
      await runtime.approvals.decide({
        payload: rejectPayload.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      });
      expect(currentJobs(runtime.store)[rejectedParent.targets[0].childId].state).toBe("rejected");

      const expiredParent = await createPendingFanout(runtime, "update docs -- beta");
      await approvalsFeature.tick();
      now += 11;
      await approvalsFeature.tick();
      expect(currentJobs(runtime.store)[expiredParent.targets[0].childId].state).toBe("expired");
    } finally {
      runtime.cleanup();
    }
  });

  it("holds a fan-out at the global budget gate and approves children after override", async () => {
    const runtimeConfig = { ...config, budget: { dailyUSD: 0 } };
    const runtime = makeRuntime({ config: runtimeConfig });
    runtime.budget.recordUsage({ source: "session", projectId: "alpha", usage: { costUSD: 1 } });
    await startFeatures(runtime);
    try {
      const parent = await createPendingFanout(runtime, "run checks -- alpha");
      await approvalsFeature.tick();
      const payload = runtime.channel.calls[0].replyMarkup.inline_keyboard[0][0].callback_data;
      await runtime.approvals.decide({
        payload: payload.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      });
      expect(currentJobs(runtime.store)[parent.id].state).toBe("held-budget");
      expect(currentJobs(runtime.store)[parent.targets[0].childId].state).toBe("queued");
      const hold = runtime.channel.calls.find((call) => call.text?.includes("held by budget governor"));
      const overridePayload = hold.replyMarkup.inline_keyboard[0][0].callback_data;
      expect(runtime.budget.override({
        payload: overridePayload,
        caller: { userId: "owner", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      })).toMatchObject({ ok: true });
      expect(currentJobs(runtime.store)[parent.targets[0].childId].state).toBe("approved");
    } finally {
      runtime.cleanup();
    }
  });

  it("isolates siblings and sends one report after every child is terminal", async () => {
    const runtime = makeRuntime();
    await startFeatures(runtime);
    try {
      const parent = await createPendingFanout(runtime);
      await approvalsFeature.tick();
      const payload = runtime.channel.calls[0].replyMarkup.inline_keyboard[0][0].callback_data;
      await runtime.approvals.decide({
        payload: payload.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      });
      const [alpha, beta] = parent.targets;
      transitionStored(runtime, alpha.childId, "leased");
      transitionStored(runtime, alpha.childId, "running");
      transitionStored(runtime, alpha.childId, "failed");
      expect(currentJobs(runtime.store)[beta.childId].state).toBe("approved");
      transitionStored(runtime, beta.childId, "leased");
      transitionStored(runtime, beta.childId, "running");
      transitionStored(runtime, beta.childId, "succeeded");
      const reports = runtime.channel.calls.filter((call) => call.text?.startsWith(`Fan-out ${parent.id} complete`));
      expect(reports).toHaveLength(1);
      expect(reports[0].text).toContain("Alpha: failed");
      expect(reports[0].text).toContain("Beta: succeeded");
      expect(reports[0].text).not.toContain("secret-canary-x");
      expect(currentJobs(runtime.store)[parent.id].state).toBe("failed");
    } finally {
      runtime.cleanup();
    }
  });

  it("waits to report while a child is held and reconciles stored fan-outs idempotently", async () => {
    const runtime = makeRuntime();
    await startFeatures(runtime);
    try {
      const parent = await createPendingFanout(runtime);
      await approvalsFeature.tick();
      const payload = runtime.channel.calls[0].replyMarkup.inline_keyboard[0][0].callback_data;
      await runtime.approvals.decide({
        payload: payload.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: "general-chat",
        threadId: "general-topic",
      });
      const [alpha, beta] = parent.targets;
      transitionStored(runtime, alpha.childId, "held-budget");
      transitionStored(runtime, beta.childId, "leased");
      transitionStored(runtime, beta.childId, "running");
      transitionStored(runtime, beta.childId, "succeeded");
      expect({
        parent: currentJobs(runtime.store)[parent.id].state,
        alpha: currentJobs(runtime.store)[alpha.childId].state,
        beta: currentJobs(runtime.store)[beta.childId].state,
        errors: runtime.logger.error.mock.calls,
      }).toEqual({ parent: "running", alpha: "held-budget", beta: "succeeded", errors: [] });
      expect(runtime.channel.calls.filter((call) => call.text?.startsWith(`Fan-out ${parent.id} complete`)))
        .toHaveLength(0);
      transitionStored(runtime, alpha.childId, "approved");
      transitionStored(runtime, alpha.childId, "leased");
      transitionStored(runtime, alpha.childId, "running");
      transitionStored(runtime, alpha.childId, "succeeded");
      expect(runtime.channel.calls.filter((call) => call.text?.startsWith(`Fan-out ${parent.id} complete`)))
        .toHaveLength(1);
    } finally {
      runtime.cleanup();
    }
  });

  it("completes interrupted fan-outs during reconcile and ignores duplicate events", async () => {
    const store = makeStore();
    const bus = new EventEmitter();
    const runtime = makeRuntime({ store, bus });
    const parentCreated = createJob({ id: "parent-reconcile", type: "fanout", projectId: "general" });
    const parent = {
      ...parentCreated.job,
      targets: [{ projectId: "alpha", childId: "child-reconcile", branch: "claw/child-reconcile" }],
      chatId: "general-chat",
      threadId: "general-topic",
    };
    store.append(JOBS_STREAM, { kind: "job.created", job: parent });
    let parentState = transition(parent, "awaiting-approval");
    store.append(JOBS_STREAM, parentState.event);
    parentState = transition(parentState.job, "approved");
    store.append(JOBS_STREAM, parentState.event);
    const child = createJob({ id: "child-reconcile", type: "task", projectId: "alpha", parentId: parent.id });
    store.append(JOBS_STREAM, { kind: "job.created", job: child.job });
    await reconcile({ ...runtime, approvals: runtime.approvals });
    const children = currentJobs(store);
    expect(children[parent.id].state).toBe("running");
    expect(children[child.job.id].state).toBe("approved");
    const before = store.read(JOBS_STREAM).length;
    await reconcile({ ...runtime, approvals: runtime.approvals });
    expect(store.read(JOBS_STREAM)).toHaveLength(before);

    let completed = children[child.job.id];
    for (const to of ["leased", "running", "succeeded"]) {
      const update = transition(completed, to);
      store.append(JOBS_STREAM, update.event);
      completed = update.job;
    }
    await crossprojectFeature.start(runtime);
    expect(currentJobs(store)[parent.id].state).toBe("succeeded");
    expect(runtime.channel.calls.filter((call) => call.text?.startsWith(`Fan-out ${parent.id} complete`)))
      .toHaveLength(1);
    const afterReport = store.read(JOBS_STREAM).length;
    bus.emit("job.transition", { kind: "job.transition", jobId: child.job.id, to: "succeeded" });
    expect(store.read(JOBS_STREAM)).toHaveLength(afterReport);
    expect(runtime.channel.calls.filter((call) => call.text?.startsWith(`Fan-out ${parent.id} complete`)))
      .toHaveLength(1);
    runtime.cleanup();
  });

  it("parses task separators, enforces visible targets and caps, and parses recall-all", () => {
    expect(parseFanoutArgs("check dependencies beta")).toEqual({
      task: "check dependencies beta", projectIds: null,
    });
    expect(parseFanoutArgs("check dependencies -- alpha beta alpha"))
      .toEqual({ task: "check dependencies", projectIds: ["alpha", "beta"] });
    expect(() => parseFanoutArgs(" -- alpha")).toThrowError(expect.objectContaining({ code: "FANOUT_USAGE" }));
    expect(() => parseFanoutArgs("work -- ")).toThrowError(expect.objectContaining({ code: "FANOUT_NO_TARGETS" }));
    expect(parseRecallAll("anything")).toBeNull();
    expect(parseRecallAll("--all search these notes")).toEqual({ all: true, query: "search these notes" });
    expect(() => parseRecallAll("--all")).toThrowError(expect.objectContaining({ code: "RECALL_USAGE" }));
    const store = makeStore();
    expect(() => prepareFanout({ store, config, registry: { all: () => config.projects } }, {
      argsText: "work -- secret-canary-x",
    })).toThrowError(expect.objectContaining({ code: "FANOUT_UNKNOWN_PROJECT" }));
    expect(() => prepareFanout({ store, config, registry: { all: () => config.projects } }, {
      argsText: `work -- ${Array.from({ length: 21 }, (_value, index) => `p${index}`).join(" ")}`,
    })).toThrowError(expect.objectContaining({ code: "FANOUT_TOO_MANY" }));

    const manyProjects = Array.from({ length: 21 }, (_value, index) => ({ id: `project${index}` }));
    expect(() => prepareFanout({
      store, config: { projects: manyProjects }, registry: { all: () => manyProjects },
    }, { argsText: "work" })).toThrowError(expect.objectContaining({ code: "FANOUT_TOO_MANY" }));
  });

  it("filters restricted recall hits and distinguishes partial failures from no matches", async () => {
    const memory = {
      fanoutSearch: vi.fn(async () => ({
        hits: [
          { projectId: "alpha", recordRef: "alpha:1", snippet: "safe note" },
          { projectId: "alpha", recordRef: "alpha:2", visibility: "restricted", snippet: "hidden" },
          { projectId: "secret-canary-x", recordRef: "secret:1", snippet: "hidden project" },
        ],
        errors: [{ projectId: "beta", code: "SEARCH_FAILED" }, { projectId: "secret-canary-x", code: "NO_ACCESS" }],
      })),
    };
    const result = await recallAll({ memory, config, registry: { all: () => config.projects } }, {
      query: "find notes", limit: 5,
    });
    expect(result).toMatchObject({
      total: 1,
      errors: [{ projectId: "beta", code: "SEARCH_FAILED" }],
      message: "1 matches returned; 1 project searches failed.",
    });
    expect(result.hits[0].snippet).toContain("```");
    expect(JSON.stringify(result)).not.toContain("secret-canary-x");
    memory.fanoutSearch.mockResolvedValue({ hits: [], errors: [] });
    expect((await recallAll({ memory, config }, { query: "missing" })).message).toContain("No matches");
    memory.fanoutSearch.mockResolvedValue({ hits: [], errors: [{ projectId: "alpha", code: "FAILED" }] });
    expect((await recallAll({ memory, config }, { query: "missing" })).message)
      .toContain("1 project searches failed");
  });

  it("records a failed combined-report send without claiming delivery", async () => {
    const store = makeStore();
    const channel = { send: vi.fn(async () => { throw Object.assign(new Error("send failed"), { code: "CHANNEL_DOWN" }); }) };
    const parent = addJob(store, {
      id: "report-parent", type: "fanout", projectId: "general", state: "running",
      targets: [{ projectId: "alpha", childId: "report-child" }], chatId: "chat", threadId: "topic",
    });
    const child = addJob(store, {
      id: "report-child", projectId: "alpha", parentId: parent.id, state: "succeeded",
    });
    const event = { kind: "job.transition", jobId: child.id, to: "succeeded" };
    const logger = { error: vi.fn() };
    await onChildTerminal({
      store, channel, config, logger,
      approvals: { audit: (record) => store.append("audit", record) },
    }, event);
    expect(store.read("audit").map(({ record }) => record)).toContainEqual(expect.objectContaining({
      kind: "fanout.report-failed", parentId: parent.id, code: "CHANNEL_DOWN",
    }));
    expect(channel.send).toHaveBeenCalledTimes(1);
  });
});
