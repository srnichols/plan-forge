import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import * as crossprojectService from "../src/crossproject.mjs";
import { bindBudgetService, createBudgetService } from "../src/budget.mjs";
import {
  buildStatusRollup,
  fanoutCompletionFor,
  fanoutProofFor,
  onChildTerminal,
  onParentApproved,
  onParentClosed,
  onParentTerminal,
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
import { createStore } from "../src/state/store.mjs";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const config = {
  timezone: "Etc/UTC",
  budget: { dailyUSD: 100 },
  allowlist: [
    { channel: "telegram", userId: "requester", role: "owner" },
    { channel: "telegram", userId: "approver", role: "owner" },
    { channel: "telegram", userId: "owner", role: "owner" },
    { channel: "telegram", userId: "viewer", role: "viewer" },
  ],
  policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
  runtimes: { default: "copilot-sdk", byok: {} },
  lanes: [{ id: "local", kind: "local", runtime: "copilot-sdk" }],
  projects: [
    { id: "alpha", name: "Alpha", budget: { dailyUSD: 10, dailyPremiumRequests: 5 } },
    { id: "beta", name: "Beta", budget: { dailyUSD: 20, dailyPremiumRequests: 8 } },
    { id: "secret-canary-x", name: "Restricted Canary", visibility: "restricted" },
  ],
};

const fixtureDirectories = new Set();

function makeStore() {
  const directory = join(process.cwd(), ".test-fixtures", `fp03-crossproject-${randomUUID()}`);
  fixtureDirectories.add(directory);
  const store = createStore(directory, { now: () => new Date(NOW) });
  return Object.assign(store, { fixtureDirectory: directory });
}

function records(store, stream) {
  return [...store.read(stream)].map(({ record }) => record);
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
  const runtimeConfig = overrides.config ?? structuredClone(config);
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
    approvals: createApprovalService({ store, bus, channel, logger, config: runtimeConfig, now, ttlMs: overrides.approvalTtlMs }),
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
  const result = await prepareFanout({
    store: runtime.store,
    config: runtime.config,
    registry: runtime.registry,
    now: runtime.now,
    caller: { userId: "requester", role: "owner" },
    adapter: "telegram",
    chatId: "general-chat",
    threadId: "general-topic",
  }, { argsText });
  expect(result.text).toContain("awaiting approval");
  expect(result).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
  return currentJobs(runtime.store)[result.jobId];
}

async function consumeJobApproval(runtime, job, { quorum } = {}) {
  const approval = runtime.approvals.createApproval(job);
  runtime.approvals.issue(job, { approval });
  expect(await runtime.approvals.decide({
    payload: (quorum === undefined ? approval.approve : approval.quorum(quorum)).slice(2),
    caller: { userId: "approver", role: "owner" },
    chatId: job.chatId,
    threadId: job.threadId,
  })).toMatchObject({ ok: true, decision: "approve" });
  return records(runtime.store, "approvals").find((record) => record.kind === "approval.consumed" && record.jobId === job.id);
}

async function consumeParentApproval(runtime, parent) {
  return consumeJobApproval(runtime, parent);
}

function createPendingDirectJob(runtime, fields = {}) {
  return addJob(runtime.store, {
    id: "0123456789abcdef01234567", type: "task", projectId: "alpha", state: "awaiting-approval",
    callerId: "requester", callerRole: "owner", adapter: "telegram", updateId: "direct-proof-update",
    chatId: "general-chat", threadId: "general-topic", description: "Check the project",
    ...fields,
  });
}

async function startFeatures(runtime) {
  await approvalsFeature.start(runtime);
  await budgetFeature.start(runtime);
  await crossprojectFeature.start(runtime);
}

function recordDispatcherStart(runtime, parentId) {
  transitionStored(runtime, parentId, "leased");
  transitionStored(runtime, parentId, "running");
}

async function recordDispatcherCompletion(runtime, parentId) {
  const parent = currentJobs(runtime.store)[parentId];
  const completion = fanoutCompletionFor({ store: runtime.store, parent });
  expect(completion).not.toBeNull();
  transitionStored(runtime, parentId, completion.to);
  await crossprojectFeature.stop();
}

afterEach(async () => {
  await crossprojectFeature.stop();
  await budgetFeature.stop();
  await approvalsFeature.stop();
  for (const directory of fixtureDirectories) rmSync(directory, { recursive: true, force: true });
  fixtureDirectories.clear();
});

describe("shared consumed approval proof and choices", () => {
  it("selects only a direct durable consumed approval and never writes a job transition", async () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime);
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job })).toBeNull();
      const consumed = await consumeJobApproval(runtime, job);
      const stored = currentJobs(runtime.store)[job.id];
      const before = records(runtime.store, JOBS_STREAM).length;
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: stored }))
        .toMatchObject(consumed);
      expect(records(runtime.store, JOBS_STREAM)).toHaveLength(before);
      const restartedStore = createStore(runtime.store.fixtureDirectory, { now: () => new Date(NOW) });
      expect(crossprojectService.consumedApprovalFor({ store: restartedStore, config: runtime.config, job: stored }))
        .toMatchObject({ jobId: job.id, decision: "approve" });
    } finally {
      runtime.cleanup();
    }
  });

  it("refuses approved persisted state and a consumed row without its issued binding", () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime, { state: "approved" });
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job })).toBeNull();
      const approval = runtime.approvals.createApproval(job);
      runtime.store.append("approvals", {
        ...approval.record, kind: "approval.consumed", usedAt: NOW,
        approverId: "approver", decision: "approve",
      });
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job })).toBeNull();
      expect(currentJobs(runtime.store)[job.id].state).toBe("approved");
    } finally {
      runtime.cleanup();
    }
  });

  it.each([
    ["wrong job", { jobId: "unrelated-job" }],
    ["wrong requester", { requesterId: "viewer" }],
    ["wrong chat", { chatId: "unrelated-chat" }],
    ["wrong topic", { threadId: "unrelated-topic" }],
    ["wrong expiry binding", { expiresAt: NOW + 20 * 60_000 }],
    ["late consumption", { usedAt: NOW + 16 * 60_000 }],
    ["rejected", { decision: "reject" }],
  ])("refuses %s direct consumed proof despite approved job state", async (_name, changes) => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime);
      const consumed = await consumeJobApproval(runtime, job);
      runtime.store.append("approvals", { ...consumed, ...changes });
      const stored = currentJobs(runtime.store)[job.id];
      expect(stored.state).toBe("approved");
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: stored })).toBeNull();
    } finally {
      runtime.cleanup();
    }
  });

  it.each(["callerId", "adapter", "updateId", "chatId", "threadId", "parentId", "projectId", "type"])(
    "refuses a submitted job copy with mismatched %s rather than trusting its id",
    async (field) => {
      const runtime = makeRuntime();
      try {
        const job = createPendingDirectJob(runtime);
        await consumeJobApproval(runtime, job);
        const stored = currentJobs(runtime.store)[job.id];
        expect(crossprojectService.consumedApprovalFor({ ...runtime, job: { ...stored, [field]: "mismatch" } }))
          .toBeNull();
      } finally {
        runtime.cleanup();
      }
    },
  );

  it("rechecks current approver and caller roles for ordinary jobs", async () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime);
      await consumeJobApproval(runtime, job);
      const stored = currentJobs(runtime.store)[job.id];
      runtime.config.allowlist.find((entry) => entry.userId === "approver").role = "viewer";
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: stored })).toBeNull();
      runtime.config.allowlist.find((entry) => entry.userId === "approver").role = "approver";
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: stored })).not.toBeNull();
      runtime.config.allowlist.find((entry) => entry.userId === "requester").role = "viewer";
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: { ...stored, callerRole: "owner" } })).toBeNull();
    } finally {
      runtime.cleanup();
    }
  });

  it("never infers a direct approval through declared or arbitrary parentId references", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      const child = currentJobs(runtime.store)[parent.targets[0].childId];
      const foreign = createPendingDirectJob(runtime, { parentId: parent.id });
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: child })).toBeNull();
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: foreign })).toBeNull();
      expect(fanoutProofFor({ ...runtime, parent, child })).not.toBeNull();
      expect(fanoutProofFor({ ...runtime, parent, child: foreign })).toBeNull();
    } finally {
      runtime.cleanup();
    }
  });

  it("takes quorum only from actual consumed plan choice while the model retains the unsigned copy", async () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime, { type: "plan", quorum: "power", planFile: "docs/plans/example.md" });
      const consumed = await consumeJobApproval(runtime, job, { quorum: "speed" });
      const stored = currentJobs(runtime.store)[job.id];
      expect(stored.quorum).toBe("power");
      expect(consumed.quorum).toBe("speed");
      const before = records(runtime.store, JOBS_STREAM).length;
      const approval = crossprojectService.consumedApprovalFor({ ...runtime, job: stored });
      expect(approval.quorum).toBe("speed");
      const choices = crossprojectService.approvedChoicesFor({ job: stored, approval });
      expect(choices).toEqual({ quorum: "speed" });
      expect(Object.isFrozen(choices)).toBe(true);
      expect(currentJobs(runtime.store)[job.id].quorum).toBe("power");
      expect(records(runtime.store, JOBS_STREAM)).toHaveLength(before);
    } finally {
      runtime.cleanup();
    }
  });

  it("projects validated radio choice for detached local inputs without copying chat metadata", async () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime, { type: "plan", quorum: "power" });
      await consumeJobApproval(runtime, job, { quorum: "speed" });
      const stored = currentJobs(runtime.store)[job.id];
      const approval = crossprojectService.consumedApprovalFor({ ...runtime, job: stored });
      const detached = { id: stored.id, type: stored.type, projectId: stored.projectId };
      expect(crossprojectService.approvedChoicesFor({ job: detached, approval })).toEqual({ quorum: "speed" });
      expect(Object.keys(detached)).toEqual(["id", "type", "projectId"]);
    } finally {
      runtime.cleanup();
    }
  });

  it("returns no radio override without changing the immutable stored plan base choice", async () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime, { type: "plan", quorum: "power" });
      await consumeJobApproval(runtime, job);
      const stored = currentJobs(runtime.store)[job.id];
      const approval = crossprojectService.consumedApprovalFor({ ...runtime, job: stored });
      expect(approval).not.toBeNull();
      expect(crossprojectService.approvedChoicesFor({ job: stored, approval })).toEqual({ quorum: null });
      expect(crossprojectService.approvedChoicesFor({ job: stored, approval: null })).toEqual({ quorum: null });
      expect(currentJobs(runtime.store)[job.id].quorum).toBe("power");
    } finally {
      runtime.cleanup();
    }
  });

  it.each([
    ["plan", "unrecognized"],
    ["plan", null],
    ["task", "speed"],
    ["fanout", "speed"],
  ])("refuses %s consumed proof with an invalid selected quorum", async (type, quorum) => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime, { type });
      const consumed = await consumeJobApproval(runtime, job);
      runtime.store.append("approvals", { ...consumed, quorum });
      const stored = currentJobs(runtime.store)[job.id];
      expect(crossprojectService.consumedApprovalFor({ ...runtime, job: stored })).toBeNull();
      expect(() => crossprojectService.approvedChoicesFor({ job: stored, approval: { ...consumed, quorum } }))
        .toThrowError(expect.objectContaining({ code: "APPROVAL_QUORUM_INVALID" }));
    } finally {
      runtime.cleanup();
    }
  });

  it("treats approved-choice projection as data, not approval or submitted-state authority", async () => {
    const runtime = makeRuntime();
    try {
      const job = createPendingDirectJob(runtime, { type: "plan", quorum: "power" });
      const consumed = await consumeJobApproval(runtime, job, { quorum: "speed" });
      const stored = currentJobs(runtime.store)[job.id];
      for (const approval of [
        null,
        { ...consumed, kind: "approval.issued" },
        { ...consumed, decision: "reject" },
        { ...consumed, jobId: "unrelated-job" },
      ]) {
        expect(crossprojectService.approvedChoicesFor({ job: stored, approval })).toEqual({ quorum: null });
      }
    } finally {
      runtime.cleanup();
    }
  });
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
      await expect(prepareFanout({
        store: runtime.store,
        config,
        registry: runtime.registry,
      }, { argsText: "work -- secret-canary-x" })).rejects.toThrowError(
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
      expect(currentJobs(runtime.store)[approvedParent.id].state).toBe("approved");
      recordDispatcherStart(runtime, approvedParent.id);
      expect(currentJobs(runtime.store)[approvedParent.id].state).toBe("running");
      for (const target of approvedParent.targets) {
        expect(currentJobs(runtime.store)[target.childId].state).toBe("approved");
        expect(records(runtime.store, "audit")).toContainEqual(expect.objectContaining({
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
      recordDispatcherStart(runtime, parent.id);
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
      recordDispatcherStart(runtime, parent.id);
      const [alpha, beta] = parent.targets;
      transitionStored(runtime, alpha.childId, "leased");
      transitionStored(runtime, alpha.childId, "running");
      transitionStored(runtime, alpha.childId, "failed");
      expect(currentJobs(runtime.store)[beta.childId].state).toBe("approved");
      transitionStored(runtime, beta.childId, "leased");
      transitionStored(runtime, beta.childId, "running");
      transitionStored(runtime, beta.childId, "succeeded");
      expect(currentJobs(runtime.store)[parent.id].state).toBe("running");
      await recordDispatcherCompletion(runtime, parent.id);
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
      recordDispatcherStart(runtime, parent.id);
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
      await recordDispatcherCompletion(runtime, parent.id);
      expect(runtime.channel.calls.filter((call) => call.text?.startsWith(`Fan-out ${parent.id} complete`)))
        .toHaveLength(1);
    } finally {
      runtime.cleanup();
    }
  });

  it.each(["approved", "leased", "running"])("refuses proof-free %s recovery and repeated restart", async (state) => {
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
    if (state !== "approved") {
      parentState = transition(parentState.job, "leased");
      store.append(JOBS_STREAM, parentState.event);
    }
    if (state === "running") {
      parentState = transition(parentState.job, "running");
      store.append(JOBS_STREAM, parentState.event);
    }
    const child = createJob({ id: "child-reconcile", type: "task", projectId: "alpha", parentId: parent.id });
    store.append(JOBS_STREAM, { kind: "job.created", job: child.job });
    await reconcile({ ...runtime, approvals: runtime.approvals });
    const children = currentJobs(store);
    expect(children[parent.id].state).toBe(state);
    expect(children[child.job.id].state).toBe("queued");
    expect(runtime.logger.error).toHaveBeenCalledWith(
      "Fan-out authorization refused",
      expect.objectContaining({ parentId: parent.id, code: "FANOUT_APPROVAL_REQUIRED" }),
    );
    const before = records(store, JOBS_STREAM).length;
    await reconcile({ ...runtime, approvals: runtime.approvals });
    const restartedStore = createStore(store.fixtureDirectory, { now: () => new Date(NOW) });
    await reconcile({ ...runtime, store: restartedStore });
    expect(records(store, JOBS_STREAM)).toHaveLength(before);
    expect(currentJobs(restartedStore)[child.job.id].state).toBe("queued");
    expect(runtime.channel.calls).toHaveLength(0);
    runtime.cleanup();
  });

  it.each([
    ["rejected", { decision: "reject" }],
    ["wrong job", { jobId: "another-parent" }],
    ["wrong requester", { requesterId: "viewer" }],
    ["wrong chat", { chatId: "another-chat" }],
    ["wrong topic", { threadId: "another-topic" }],
    ["late consumption", { usedAt: NOW + 16 * 60_000 }],
  ])("refuses %s consumed parent proof before child authorization", async (_name, changes) => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      const consumed = await consumeParentApproval(runtime, parent);
      runtime.store.append("approvals", { ...consumed, ...changes });
      onParentApproved(runtime, { jobId: parent.id, to: "approved" });
      await reconcile(runtime);
      expect(currentJobs(runtime.store)[parent.id].state).toBe("approved");
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state))
        .toEqual(["queued", "queued"]);
      expect(runtime.logger.error).toHaveBeenCalled();
    } finally {
      runtime.cleanup();
    }
  });

  it("never leases or starts the parent even with a valid consumed approval", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      const requests = [];
      runtime.bus.on("fanout.ready", (request) => requests.push(request));
      onParentApproved(runtime, { jobId: parent.id, to: "approved" });
      expect(currentJobs(runtime.store)[parent.id].state).toBe("approved");
      expect(requests).toEqual([{ parentId: parent.id }]);
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state))
        .toEqual(["queued", "queued"]);
    } finally {
      runtime.cleanup();
    }
  });

  it("publishes canonical exact family membership and refuses arbitrary parentId references", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      const stored = currentJobs(runtime.store)[parent.id];
      const child = currentJobs(runtime.store)[parent.targets[0].childId];
      expect(crossprojectService.isDeclaredFanoutChild({ parent: stored, child })).toBe(true);
      expect(fanoutProofFor({ store: runtime.store, config: runtime.config, parent: stored, child }))
        .toMatchObject({ kind: "approval.consumed", jobId: parent.id, approverId: "approver" });
      const forged = addJob(runtime.store, {
        id: "unlisted-child", projectId: child.projectId, parentId: parent.id,
        fanoutParentId: parent.id, callerId: child.callerId, callerRole: child.callerRole,
        adapter: child.adapter, updateId: child.updateId, chatId: child.chatId, threadId: child.threadId,
        description: parent.task, targetBranch: "claw/unlisted-child",
      });
      expect(crossprojectService.isDeclaredFanoutChild({ parent: stored, child: forged })).toBe(false);
      expect(fanoutProofFor({ store: runtime.store, config: runtime.config, parent: stored, child: forged })).toBeNull();
      recordDispatcherStart(runtime, parent.id);
      await reconcile(runtime);
      expect(currentJobs(runtime.store)[forged.id].state).toBe("queued");
    } finally {
      runtime.cleanup();
    }
  });

  it.each([
    "callerId", "callerRole", "adapter", "updateId", "chatId", "threadId", "parentId",
    "fanoutParentId", "projectId", "type", "id", "description", "targetBranch",
  ])(
    "rejects a declared child's mismatched %s attribution",
    async (field) => {
      const runtime = makeRuntime();
      try {
        const parent = await createPendingFanout(runtime);
        await consumeParentApproval(runtime, parent);
        const child = currentJobs(runtime.store)[parent.targets[0].childId];
        const mismatched = { ...child, [field]: "mismatch" };
        expect(crossprojectService.isDeclaredFanoutChild({ parent, child: mismatched })).toBe(false);
        expect(fanoutProofFor({ store: runtime.store, config: runtime.config, parent, child: mismatched })).toBeNull();
      } finally {
        runtime.cleanup();
      }
    },
  );

  it.each(["runtime", "provider"])("refuses a declared child's unsigned %s override", async (field) => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      const child = currentJobs(runtime.store)[parent.targets[0].childId];
      expect(fanoutProofFor({
        store: runtime.store, config: runtime.config, parent,
        child: { ...child, [field]: "untrusted-override" },
      })).toBeNull();
    } finally {
      runtime.cleanup();
    }
  });

  it("retains consumed proof for a valid approved child when its parent becomes terminal", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      recordDispatcherStart(runtime, parent.id);
      await reconcile(runtime);
      transitionStored(runtime, parent.id, "failed");
      const stored = currentJobs(runtime.store)[parent.id];
      const child = currentJobs(runtime.store)[parent.targets[0].childId];
      expect(child.state).toBe("approved");
      expect(fanoutProofFor({ store: runtime.store, config: runtime.config, parent: stored, child }))
        .toMatchObject({ kind: "approval.consumed", jobId: parent.id });
      await reconcile(runtime);
      expect(currentJobs(runtime.store)[child.id].state).toBe("approved");
      expect(runtime.channel.calls).toHaveLength(0);
    } finally {
      runtime.cleanup();
    }
  });

  it("reports once when the last child ends after the parent is already terminal without another parent write", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      recordDispatcherStart(runtime, parent.id);
      await reconcile(runtime);
      transitionStored(runtime, parent.id, "failed");
      await startFeatures(runtime);
      const parentWrites = records(runtime.store, JOBS_STREAM).filter((record) => record.jobId === parent.id).length;
      const [alpha, beta] = parent.targets;
      for (const state of ["leased", "running", "failed"]) transitionStored(runtime, alpha.childId, state);
      expect(currentJobs(runtime.store)[beta.childId].state).toBe("approved");
      expect(runtime.channel.calls).toHaveLength(0);
      for (const state of ["leased", "running", "succeeded"]) transitionStored(runtime, beta.childId, state);
      await crossprojectFeature.stop();
      expect(runtime.channel.calls).toHaveLength(1);
      expect(runtime.channel.calls[0].text).toContain("Alpha: failed");
      expect(runtime.channel.calls[0].text).toContain("Beta: succeeded");
      expect(currentJobs(runtime.store)[parent.id].state).toBe("failed");
      expect(records(runtime.store, JOBS_STREAM).filter((record) => record.jobId === parent.id)).toHaveLength(parentWrites);
      await onChildTerminal(runtime, { jobId: beta.childId, to: "succeeded" });
      await reconcile(runtime);
      expect(runtime.channel.calls).toHaveLength(1);
    } finally {
      runtime.cleanup();
    }
  });

  it("accepts one actual consumed self-approval by the requesting current owner", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      const approval = runtime.approvals.createApproval(parent);
      runtime.approvals.issue(parent, { approval });
      expect(await runtime.approvals.decide({
        payload: approval.approve.slice(2),
        caller: { userId: parent.callerId, role: "owner" },
        chatId: parent.chatId, threadId: parent.threadId,
      })).toMatchObject({ ok: true, decision: "approve" });
      recordDispatcherStart(runtime, parent.id);
      await reconcile(runtime);
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state)).toEqual(["approved", "approved"]);
      expect(records(runtime.store, "approvals").filter((record) => record.kind === "approval.consumed")).toHaveLength(1);
    } finally {
      runtime.cleanup();
    }
  });

  it("recovers an interrupted child authorization exactly once from one consumed parent proof", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      recordDispatcherStart(runtime, parent.id);
      transitionStored(runtime, parent.targets[0].childId, "awaiting-approval");
      const restartedStore = createStore(runtime.store.fixtureDirectory, { now: () => new Date(NOW) });
      const resumed = makeRuntime({ store: restartedStore, config: runtime.config });
      try {
        await reconcile(resumed);
        await reconcile(resumed);
        const jobs = currentJobs(restartedStore);
        expect(parent.targets.map((target) => jobs[target.childId].state)).toEqual(["approved", "approved"]);
        expect(records(restartedStore, "approvals").filter((record) => record.kind === "approval.consumed")).toHaveLength(1);
        expect(records(restartedStore, "audit").filter((record) => record.kind === "fanout.child-approved")).toHaveLength(2);
        expect(records(restartedStore, JOBS_STREAM).filter((record) => record.kind === "job.created")).toHaveLength(3);
        expect(resumed.approvals.pendingWithoutCard()).toHaveLength(0);
      } finally {
        resumed.cleanup();
      }
    } finally {
      runtime.cleanup();
    }
  });

  it("rechecks current approver and caller authority instead of persisted role provenance", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      const child = currentJobs(runtime.store)[parent.targets[0].childId];
      runtime.config.allowlist.find((entry) => entry.userId === "approver").role = "viewer";
      expect(fanoutProofFor({ store: runtime.store, config: runtime.config, parent, child })).toBeNull();
      await reconcile(runtime);
      expect(currentJobs(runtime.store)[child.id].state).toBe("queued");
      runtime.config.allowlist.find((entry) => entry.userId === "approver").role = "approver";
      runtime.config.allowlist.find((entry) => entry.userId === "requester").role = "viewer";
      expect(fanoutProofFor({ store: runtime.store, config: runtime.config, parent, child })).toBeNull();
    } finally {
      runtime.cleanup();
    }
  });

  it("refuses current non-owner GHCP admission before promoting a previously approved family", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      runtime.config.allowlist.find((entry) => entry.userId === "requester").role = "approver";
      recordDispatcherStart(runtime, parent.id);
      onParentApproved(runtime, { jobId: parent.id, to: "running" });
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state)).toEqual(["queued", "queued"]);
      expect(runtime.logger.error).toHaveBeenCalledWith(
        "Fan-out authorization refused", expect.objectContaining({ code: "RUNTIME_POLICY_DENIED" }),
      );
      expect(currentJobs(runtime.store)[parent.id].callerRole).toBe("owner");
    } finally {
      runtime.cleanup();
    }
  });

  it("fails closed without the budget service and when a declared target becomes restricted", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      const requests = [];
      runtime.bus.on("fanout.ready", (request) => requests.push(request));
      onParentApproved({ ...runtime, budget: null }, { jobId: parent.id, to: "approved" });
      expect(requests).toHaveLength(0);
      expect(runtime.logger.error).toHaveBeenCalledWith(
        "Fan-out authorization refused", expect.objectContaining({ code: "FANOUT_BUDGET_UNAVAILABLE" }),
      );
      runtime.config.projects[1].visibility = "restricted";
      onParentApproved(runtime, { jobId: parent.id, to: "approved" });
      expect(requests).toHaveLength(0);
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state)).toEqual(["queued", "queued"]);
    } finally {
      runtime.cleanup();
    }
  });

  it("does not create a per-child approval card during interrupted authorization feature startup", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      await consumeParentApproval(runtime, parent);
      recordDispatcherStart(runtime, parent.id);
      transitionStored(runtime, parent.targets[0].childId, "awaiting-approval");
      await startFeatures(runtime);
      expect(runtime.channel.calls).toHaveLength(0);
      expect(records(runtime.store, "approvals").filter((record) => record.kind === "approval.issued")).toHaveLength(1);
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state)).toEqual(["approved", "approved"]);
    } finally {
      runtime.cleanup();
    }
  });

  it("closes an interrupted approval-pending child without creating another approval", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      transitionStored(runtime, parent.targets[0].childId, "awaiting-approval");
      const approval = runtime.approvals.createApproval(parent);
      runtime.approvals.issue(parent, { approval });
      expect(await runtime.approvals.decide({
        payload: approval.reject.slice(2),
        caller: { userId: "approver", role: "owner" },
        chatId: parent.chatId, threadId: parent.threadId,
      })).toMatchObject({ ok: true, decision: "reject" });
      onParentClosed(runtime, { jobId: parent.id, to: "rejected" });
      expect(parent.targets.map((target) => currentJobs(runtime.store)[target.childId].state)).toEqual(["rejected", "rejected"]);
      expect(records(runtime.store, "approvals")).toHaveLength(2);
    } finally {
      runtime.cleanup();
    }
  });

  it("never closes an unrelated queued job merely named by a malformed persisted parent", async () => {
    const runtime = makeRuntime();
    try {
      const parent = await createPendingFanout(runtime);
      const childId = parent.targets[0].childId;
      const file = join(runtime.store.fixtureDirectory, "jobs.jsonl");
      const lines = readFileSync(file, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
      const created = lines.find((record) => record.kind === "job.created" && record.job.id === childId);
      created.job.parentId = "independent-parent";
      writeFileSync(file, `${lines.map((record) => JSON.stringify(record)).join("\n")}\n`);
      transitionStored(runtime, parent.id, "rejected");
      onParentClosed(runtime, { jobId: parent.id, to: "rejected" });
      expect(currentJobs(runtime.store)[childId].state).toBe("queued");
    } finally {
      runtime.cleanup();
    }
  });

  it("parses task separators, enforces visible targets and caps, and parses recall-all", async () => {
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
    await expect(prepareFanout({ store, config, registry: { all: () => config.projects } }, {
      argsText: "work -- secret-canary-x",
    })).rejects.toThrowError(expect.objectContaining({ code: "FANOUT_UNKNOWN_PROJECT" }));
    await expect(prepareFanout({ store, config, registry: { all: () => config.projects } }, {
      argsText: `work -- ${Array.from({ length: 21 }, (_value, index) => `p${index}`).join(" ")}`,
    })).rejects.toThrowError(expect.objectContaining({ code: "FANOUT_TOO_MANY" }));

    const manyProjects = Array.from({ length: 21 }, (_value, index) => ({ id: `project${index}` }));
    await expect(prepareFanout({
      store, config: { projects: manyProjects }, registry: { all: () => manyProjects },
    }, { argsText: "work" })).rejects.toThrowError(expect.objectContaining({ code: "FANOUT_TOO_MANY" }));
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
    const channel = { send: vi.fn(async () => { throw Object.assign(new Error("send failed"), { code: "CHANNEL_DOWN" }); }) };
    const runtime = makeRuntime({ channel });
    try {
      const parent = await createPendingFanout(runtime, "check -- alpha");
      await consumeParentApproval(runtime, parent);
      recordDispatcherStart(runtime, parent.id);
      await reconcile(runtime);
      const childId = parent.targets[0].childId;
      for (const state of ["leased", "running", "succeeded"]) transitionStored(runtime, childId, state);
      transitionStored(runtime, parent.id, "succeeded");
      await onParentTerminal(runtime, { jobId: parent.id, to: "succeeded" });
      expect(records(runtime.store, "audit")).toContainEqual(expect.objectContaining({
        kind: "fanout.report-failed", parentId: parent.id, code: "CHANNEL_DOWN",
      }));
      expect(records(runtime.store, "audit").filter((record) => record.kind === "fanout.report-sent")).toHaveLength(0);
      expect(channel.send).toHaveBeenCalledTimes(1);
      const restartedStore = createStore(runtime.store.fixtureDirectory, { now: () => new Date(NOW) });
      const successfulChannel = makeChannel();
      const resumed = { ...runtime, store: restartedStore, channel: successfulChannel };
      await Promise.all([reconcile(resumed), reconcile(resumed)]);
      await reconcile({ ...resumed, store: createStore(runtime.store.fixtureDirectory, { now: () => new Date(NOW) }) });
      expect(successfulChannel.calls).toHaveLength(1);
      expect(records(restartedStore, "audit").filter((record) => record.kind === "fanout.report-sent")).toHaveLength(1);
    } finally {
      runtime.cleanup();
    }
  });
});
