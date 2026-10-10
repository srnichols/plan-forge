import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import approvalCallback from "../src/callbacks/a.mjs";
import { bindApprovalService, buildApprovalCard, createApprovalService, getApprovalService, issueApproval, parseApprovalPayload } from "../src/approvals.mjs";
import approvalsFeature from "../src/features/approvals.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createRouter } from "../src/router.mjs";
import { createStore } from "../src/state/store.mjs";
import { bindPlacementService, createPlacementService } from "../src/placement.mjs";

const directories = [];
const unbinders = [];
const NOW = 1_000_000;
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const project = {
  id: "project-1",
  name: "Project One",
  homeLane: "local",
  channel: { adapter: "telegram", chatId: "chat-1", topicId: "topic-1" },
  repo: { path: "/repo/project-1", baseBranch: "main" },
};

function makeStore() {
  const directory = mkdtempSync(path.join(TEST_DIRECTORY, ".approval-fixture-"));
  directories.push(directory);
  return createStore(directory);
}

function makeChannel() {
  const calls = [];
  return {
    calls,
    async send(payload) {
      calls.push({ method: "send", ...payload });
      return [{ chatId: String(payload.chatId), messageId: `message-${calls.length}`, threadId: payload.threadId ?? null }];
    },
    async edit(payload) {
      calls.push({ method: "edit", ...payload });
    },
    async answerCallback(payload) {
      calls.push({ method: "answerCallback", ...payload });
    },
  };
}

function makeEstimate(overrides = {}) {
  return {
    recommended: "auto",
    auto: { mode: "auto", estimatedCostUSD: 1.8423, totalSliceCount: 7, quorumSliceCount: 3 },
    power: { mode: "power", estimatedCostUSD: 2.4367, totalSliceCount: 7, quorumSliceCount: 7 },
    speed: { mode: "speed", estimatedCostUSD: 1.2384, totalSliceCount: 7, quorumSliceCount: 5 },
    false: { mode: "false", estimatedCostUSD: 0.4281, totalSliceCount: 7, quorumSliceCount: 0 },
    ...overrides,
  };
}

function makeService(store, options = {}) {
  const service = createApprovalService({
    store,
    now: options.now ?? (() => NOW),
    ttlMs: options.ttlMs,
    channel: options.channel,
    bus: options.bus,
    config: options.config,
    mcp: options.mcp ?? { call: async () => makeEstimate() },
    logger: { error: vi.fn() },
  });
  unbinders.push(bindApprovalService(service));
  return service;
}

function createAwaitingJob(store, {
  id = "abcdef0123456789abcdef01",
  type = "task",
  chatId = "chat-1",
  threadId = "topic-1",
  callerId = "requester-1",
  ...fields
} = {}) {
  const created = createJob({ id, type, projectId: project.id });
  const job = {
    ...created.job,
    chatId,
    threadId,
    callerId,
    description: type === "plan" ? "Run the plan" : type === "task" ? "Improve the parser" : undefined,
    planPath: type === "plan" ? "docs/plans/test-plan.md" : undefined,
    ...fields,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  const pending = transition(job, "awaiting-approval");
  store.append(JOBS_STREAM, pending.event);
  return pending.job;
}

function makeIssue(service, job, messageRef = { chatId: job.chatId, messageId: "message-1", threadId: job.threadId }) {
  const approval = service.createApproval(job);
  service.issue(job, { approval, messageRef });
  return approval;
}

function records(store, stream) {
  return [...store.read(stream)].map(({ record }) => record);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await approvalsFeature.stop();
  for (const unbind of unbinders.splice(0).reverse()) unbind();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("approval callback flow", () => {
  it("approves a job, audits the decision, and edits the approval card", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const job = createAwaitingJob(store);
    const service = makeService(store, { channel });
    const approval = makeIssue(service, job);

    await approvalCallback.handle({}, {
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "approver" },
      chatId: "chat-1",
      threadId: "topic-1",
      messageId: "message-1",
    });

    expect(records(store, "approvals").at(-1)).toMatchObject({
      kind: "approval.consumed",
      decision: "approve",
      approverId: "approver-1",
    });
    expect(currentJobs(store)[job.id].state).toBe("approved");
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-decision", jobId: job.id, decision: "approve",
    }));
    expect(channel.calls).toContainEqual(expect.objectContaining({
      method: "edit", text: "✅ Approved by approver-1", replyMarkup: { inline_keyboard: [] },
    }));
  });

  it("rejects a job when the callback carries the reject suffix", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const service = makeService(store);
    const approval = makeIssue(service, job);

    const result = await service.decide({
      payload: approval.reject.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: "chat-1",
      threadId: "topic-1",
    });

    expect(result).toMatchObject({ ok: true, decision: "reject" });
    expect(currentJobs(store)[job.id].state).toBe("rejected");
  });

  it("stores the selected quorum choice for a plan approval", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store, { type: "plan" });
    const service = makeService(store);
    const approval = makeIssue(service, job);

    const result = await service.decide({
      payload: approval.quorum("speed").slice(2),
      caller: { userId: "approver-1", role: "approver" },
      chatId: "chat-1",
      threadId: "topic-1",
    });

    expect(result).toMatchObject({ ok: true, decision: "approve", quorum: "speed" });
    expect(records(store, "approvals").at(-1)).toMatchObject({ kind: "approval.consumed", quorum: "speed" });
    expect(currentJobs(store)[job.id].state).toBe("approved");
  });

  it("rejects replay after consumption and after rebuilding the service from the same store", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const service = makeService(store);
    const approval = makeIssue(service, job);
    const args = {
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: "chat-1",
      threadId: "topic-1",
    };

    expect((await service.decide(args)).ok).toBe(true);
    expect(await service.decide(args)).toMatchObject({ ok: false, reason: "replay" });
    const rebuilt = createApprovalService({ store, now: () => NOW });
    expect(await rebuilt.decide(args)).toMatchObject({ ok: false, reason: "replay" });
  });

  it("refuses expired approvals without consuming them and makes sweep idempotent", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    let now = NOW;
    const service = makeService(store, { now: () => now, ttlMs: 100 });
    const approval = makeIssue(service, job);
    now += 101;

    expect(await service.decide({
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: "chat-1",
      threadId: "topic-1",
    })).toMatchObject({ ok: false, reason: "expired" });
    expect(records(store, "approvals").at(-1)).toMatchObject({ kind: "approval.issued", usedAt: null });
    expect(service.sweep()).toHaveLength(1);
    expect(currentJobs(store)[job.id].state).toBe("expired");
    expect(service.sweep()).toEqual([]);
  });

  it("FP01 refuses an approval at its exact expiry without consuming a proof", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    let now = NOW;
    const service = makeService(store, { now: () => now, ttlMs: 100 });
    const approval = makeIssue(service, job);
    const before = records(store, "approvals");
    now += 100;

    expect(await service.decide({
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: job.chatId,
      threadId: job.threadId,
    })).toMatchObject({ ok: false, reason: "expired" });
    expect(records(store, "approvals")).toEqual(before);
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
  });

  it("FP01 expires and sweeps a pending approval once at its exact deadline", () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    let now = NOW;
    const service = makeService(store, { now: () => now, ttlMs: 100 });
    const approval = makeIssue(service, job);
    now += 100;

    expect(service.sweep()).toHaveLength(1);
    expect(currentJobs(store)[job.id].state).toBe("expired");
    expect(records(store, "approvals").at(-1)).toMatchObject({
      kind: "approval.expired", nonceHash: approval.record.nonceHash,
    });
    expect(service.sweep()).toEqual([]);
    expect(records(store, "approvals").filter(({ kind }) => kind === "approval.consumed")).toEqual([]);
  });

  it("FP01 permits a valid approval immediately before the deadline", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    let now = NOW;
    const service = makeService(store, { now: () => now, ttlMs: 100 });
    const approval = makeIssue(service, job);
    now += 99;

    expect(await service.decide({
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: job.chatId,
      threadId: job.threadId,
    })).toMatchObject({ ok: true, decision: "approve" });
    expect(currentJobs(store)[job.id].state).toBe("approved");
  });

  it.each(["approve", "reject"])(
    "FP01 refuses %s when the clock reaches expiry before proof consumption",
    async (decision) => {
      const store = makeStore();
      const job = createAwaitingJob(store);
      let now = NOW;
      const service = makeService(store, { now: () => now++, ttlMs: 100 });
      const approval = makeIssue(service, job);
      const before = records(store, "approvals");
      now = approval.record.expiresAt - 1;

      expect(await service.decide({
        payload: approval[decision].slice(2),
        caller: { userId: "approver-1", role: "owner" },
        chatId: job.chatId,
        threadId: job.threadId,
      })).toMatchObject({ ok: false, reason: "expired" });
      expect(records(store, "approvals")).toEqual(before);
      expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
    },
  );

  it.each(["task", "plan", "skill"])(
    "FP01 permits the legitimate requesting owner to approve their own %s once",
    async (type) => {
      const store = makeStore();
      const job = createAwaitingJob(store, { type, callerId: "owner-1" });
      const config = { allowlist: [{ channel: "telegram", userId: "owner-1", role: "owner" }] };
      const service = makeService(store, { config });
      const approval = makeIssue(service, job);
      const input = {
        payload: approval.approve.slice(2),
        caller: { userId: "owner-1", role: "owner" },
        chatId: job.chatId,
        threadId: job.threadId,
      };

      expect(await service.decide(input)).toMatchObject({
        ok: true, jobId: job.id, decision: "approve",
      });
      expect(currentJobs(store)[job.id].state).toBe("approved");
      expect(records(store, "approvals").filter(({ kind }) => kind === "approval.consumed"))
        .toEqual([expect.objectContaining({
          jobId: job.id,
          requesterId: "owner-1",
          approverId: "owner-1",
          chatId: job.chatId,
          threadId: job.threadId,
          nonceHash: approval.record.nonceHash,
          usedAt: NOW,
          decision: "approve",
        })]);
      expect(await createApprovalService({ store, now: () => NOW }).decide(input))
        .toMatchObject({ ok: false, reason: "replay" });
    },
  );

  it("FP01 lets the single allowlisted requesting owner approve through the router", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const job = createAwaitingJob(store, { callerId: "owner-1" });
    const service = makeService(store, { channel });
    const approval = makeIssue(service, job);
    const config = {
      allowlist: [{ channel: "telegram", userId: "owner-1", role: "owner" }],
      projects: [project],
      channels: { telegram: {} },
    };
    const router = createRouter({ config, channel, store });
    const update = {
      kind: "callback", adapter: "telegram", updateId: "owner-approval-1",
      chatId: job.chatId, threadId: job.threadId, userId: "owner-1",
      callbackId: "owner-callback-1", data: approval.approve,
    };

    await router.route(update);
    expect(currentJobs(store)[job.id].state).toBe("approved");
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-decision", jobId: job.id, userId: "owner-1", decision: "approve",
    }));
    await router.route({ ...update, updateId: "owner-approval-2", callbackId: "owner-callback-2" });
    expect(records(store, "approvals").filter(({ kind }) => kind === "approval.consumed"))
      .toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-refused", reason: "replay",
    }));
  });

  it("FP01 still drops an unknown Telegram identity without a reply or acknowledgement", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const job = createAwaitingJob(store, { callerId: "owner-1" });
    const service = makeService(store, { channel });
    const approval = makeIssue(service, job);
    const router = createRouter({
      store,
      channel,
      config: {
        allowlist: [{ channel: "telegram", userId: "owner-1", role: "owner" }],
        projects: [project],
        channels: { telegram: {} },
      },
    });

    await router.route({
      kind: "callback", adapter: "telegram", updateId: "unknown-approval-1",
      chatId: job.chatId, threadId: job.threadId, userId: "unknown-1",
      callbackId: "unknown-callback-1", data: approval.approve,
    });

    expect(channel.calls).toEqual([]);
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
    expect(records(store, "approvals")).toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "drop", reason: "unknown-user",
    }));
  });

  it("FP01 refuses a requesting owner demoted to viewer after the card was issued", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const caller = { channel: "telegram", userId: "owner-1", role: "owner" };
    const config = { allowlist: [caller], projects: [project], channels: { telegram: {} } };
    const router = createRouter({ config, channel, store });
    const job = createAwaitingJob(store, { callerId: caller.userId, callerRole: caller.role });
    const service = makeService(store, { channel });
    const approval = makeIssue(service, job);
    caller.role = "viewer";

    await router.route({
      kind: "callback", adapter: "telegram", updateId: "demoted-approval-1",
      chatId: job.chatId, threadId: job.threadId, userId: caller.userId,
      callbackId: "demoted-callback-1", data: approval.approve,
    });

    expect(channel.calls.filter(({ method }) => method === "answerCallback")).toHaveLength(1);
    expect(channel.calls.filter(({ method }) => method === "edit")).toEqual([]);
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
    expect(records(store, "approvals")).toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "callback-ignored", reason: "role",
    }));
  });

  it.each(["demoted", "removed", "forged"])(
    "FP01 refuses a %s configured identity despite an owner-role caller snapshot",
    async (change) => {
      const store = makeStore();
      const job = createAwaitingJob(store, { callerId: "owner-1" });
      const identity = {
        channel: "telegram", userId: "owner-1", role: change === "forged" ? "viewer" : "owner",
      };
      const config = { allowlist: [identity] };
      const service = makeService(store, { config });
      const approval = makeIssue(service, job);
      const caller = { userId: identity.userId, role: "owner" };
      if (change === "removed") config.allowlist = [];
      else if (change === "demoted") config.allowlist = [{ ...identity, role: "viewer" }];

      expect(await service.decide({
        payload: approval.approve.slice(2), caller,
        chatId: job.chatId, threadId: job.threadId,
      })).toMatchObject({ ok: false, reason: "wrong-user" });
      expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
      expect(records(store, "approvals")).toHaveLength(1);
    },
  );

  it("FP01 passes feature configuration through to stale-role approval decisions", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const job = createAwaitingJob(store, { callerId: "owner-1" });
    const config = {
      projects: [project],
      allowlist: [{ channel: "telegram", userId: "owner-1", role: "owner" }],
    };
    await approvalsFeature.start({ store, channel, config, now: () => NOW });
    const service = getApprovalService();
    const sent = channel.calls.find(({ method }) => method === "send");
    const payload = sent.replyMarkup.inline_keyboard[0][0].callback_data.slice(2);
    config.allowlist = [{ channel: "telegram", userId: "owner-1", role: "viewer" }];

    await approvalCallback.handle({}, {
      payload, caller: { userId: "owner-1", role: "owner" },
      chatId: job.chatId, threadId: job.threadId, messageId: "message-1",
    });

    expect(service).not.toBeNull();
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
    expect(records(store, "approvals")).toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-refused", reason: "wrong-user",
    }));
    expect(channel.calls.filter(({ method }) => method === "edit")).toEqual([]);
  });

  it.each([
    { name: "viewer", caller: { userId: "owner-1", role: "viewer" }, chatId: "chat-1", threadId: "topic-1", reason: "wrong-user" },
    { name: "missing identity", caller: { role: "owner" }, chatId: "chat-1", threadId: "topic-1", reason: "wrong-user" },
    { name: "wrong chat", caller: { userId: "owner-1", role: "owner" }, chatId: "other-chat", threadId: "topic-1", reason: "wrong-chat" },
    { name: "wrong topic", caller: { userId: "owner-1", role: "owner" }, chatId: "chat-1", threadId: "other-topic", reason: "mismatch" },
  ])("FP01 refuses $name on a self-approval without creating a consumed proof", async ({
    caller, chatId, threadId, reason,
  }) => {
    const store = makeStore();
    const job = createAwaitingJob(store, { callerId: "owner-1" });
    const service = makeService(store);
    const approval = makeIssue(service, job);

    expect(await service.decide({
      payload: approval.approve.slice(2), caller, chatId, threadId,
    })).toMatchObject({ ok: false, reason });
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
    expect(records(store, "approvals")).toHaveLength(1);
  });

  it("FP01 never approves when consumed-proof persistence fails", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const service = makeService(store);
    const approval = makeIssue(service, job);
    const release = store.lock();
    rmSync(path.join(directories.at(-1), "dispatcher.lock"));

    try {
      expect(await service.decide({
        payload: approval.approve.slice(2),
        caller: { userId: "approver-1", role: "owner" },
        chatId: job.chatId,
        threadId: job.threadId,
      })).toMatchObject({ ok: false, reason: "STATE_LOCKED" });
      expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
      expect(records(store, "approvals")).toHaveLength(1);
    } finally {
      release();
    }
  });

  it("FP01 retains the committed approval when editing its card fails", async () => {
    const store = makeStore();
    const channel = makeChannel();
    channel.edit = async () => { throw new Error("fixture edit failure"); };
    const job = createAwaitingJob(store);
    const service = makeService(store, { channel });
    const approval = makeIssue(service, job);

    await expect(approvalCallback.handle({}, {
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: job.chatId, threadId: job.threadId, messageId: "message-1",
    })).resolves.toBeUndefined();
    expect(currentJobs(store)[job.id].state).toBe("approved");
    expect(records(store, "approvals").filter(({ kind }) => kind === "approval.consumed"))
      .toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-decision", jobId: job.id,
    }));
  });

  it("FP01 keeps an expired callback refusal non-throwing when delivery fails", async () => {
    const store = makeStore();
    const channel = makeChannel();
    channel.send = async () => { throw new Error("fixture send failure"); };
    const job = createAwaitingJob(store);
    let now = NOW;
    const service = makeService(store, { channel, now: () => now, ttlMs: 100 });
    const approval = makeIssue(service, job);
    now += 101;

    await expect(approvalCallback.handle({}, {
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: job.chatId, threadId: job.threadId,
    })).resolves.toBeUndefined();
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
    expect(records(store, "approvals")).toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-refused", reason: "expired",
    }));
  });

  it.each(["missing-chat", "estimate-unavailable", "send-failure"])(
    "FP01 preserves feature refusal handling for %s",
    async (failure) => {
      vi.useFakeTimers();
      const store = makeStore();
      const channel = makeChannel();
      if (failure === "send-failure") {
        channel.send = async () => { throw new Error("fixture send failure"); };
      }
      createAwaitingJob(store, {
        type: failure === "estimate-unavailable" ? "plan" : "task",
        chatId: failure === "missing-chat" ? null : "chat-1",
      });
      await approvalsFeature.start({
        store, channel, config: { projects: [project] }, now: () => NOW,
        mcp: { call: async () => ({ ok: false }) },
        logger: { error: vi.fn() },
      });

      expect(records(store, "approvals")).toEqual([]);
      expect(records(store, "audit")).toContainEqual(expect.objectContaining({
        kind: failure === "send-failure" ? "approval-card-failed" : "approval-card-skipped",
        reason: failure === "send-failure" ? "CHANNEL_SEND_FAILED" : failure,
      }));
      await approvalsFeature.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("FP01 preserves expiry after feature card-edit failure and clears its timer", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    const channel = makeChannel();
    channel.edit = async () => { throw new Error("fixture edit failure"); };
    const job = createAwaitingJob(store);
    let now = NOW;
    await approvalsFeature.start({
      store, channel, config: { projects: [project] }, now: () => now,
      approvalTtlMs: 100, logger: { error: vi.fn() },
    });
    now += 101;

    await approvalsFeature.tick();
    expect(currentJobs(store)[job.id].state).toBe("expired");
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "approval-card-edit-failed", reason: "CHANNEL_EDIT_FAILED", jobId: job.id,
    }));
    await approvalsFeature.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects the wrong user at the service boundary", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const service = makeService(store);
    const approval = makeIssue(service, job);

    expect(await service.decide({
      payload: approval.approve.slice(2),
      caller: { userId: "viewer-1", role: "viewer" },
      chatId: "chat-1",
      threadId: "topic-1",
    })).toMatchObject({ ok: false, reason: "wrong-user" });
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
  });

  it("rejects the wrong chat without consuming the approval", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const service = makeService(store);
    const approval = makeIssue(service, job);

    expect(await service.decide({
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: "other-chat",
      threadId: "topic-1",
    })).toMatchObject({ ok: false, reason: "wrong-chat" });
    expect(records(store, "approvals").at(-1)).toMatchObject({ kind: "approval.issued", usedAt: null });
  });

  it("prevents a viewer from approving through the router and answers the callback once", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const service = makeService(store);
    const approval = makeIssue(service, job);
    const channel = makeChannel();
    const config = {
      allowlist: [{ channel: "telegram", userId: "viewer-1", role: "viewer" }],
      projects: [project],
      channels: { telegram: {} },
    };
    const router = createRouter({
      config,
      channel,
      store,
      registry: createRegistry(config),
    });

    await router.route({
      kind: "callback",
      adapter: "telegram",
      updateId: "update-1",
      chatId: "chat-1",
      threadId: "topic-1",
      userId: "viewer-1",
      callbackId: "callback-1",
      data: approval.approve,
    });

    expect(channel.calls.filter(({ method }) => method === "answerCallback")).toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "callback-ignored", reason: "role",
    }));
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
  });

  it("rejects tampered callback data without changing the approval stream", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store);
    const taskService = makeService(store);
    const approval = makeIssue(taskService, job);
    const validPayload = approval.approve.slice(2);
    const parsed = parseApprovalPayload(validPayload);
    const flippedNonce = `${parsed.shortId}:${parsed.nonce.slice(0, -1)}${parsed.nonce.endsWith("A") ? "B" : "A"}`;
    const swappedShortId = `00000000:${parsed.nonce}`;
    const payloads = ["garbage", flippedNonce, swappedShortId, "x".repeat(65), `${validPayload}:speed`];
    const before = records(store, "approvals");

    for (const payload of payloads) {
      expect((await taskService.decide({
        payload,
        caller: { userId: "approver-1", role: "owner" },
        chatId: "chat-1",
        threadId: "topic-1",
      })).ok).toBe(false);
    }

    expect(records(store, "approvals")).toEqual(before);
    expect(currentJobs(store)[job.id].state).toBe("awaiting-approval");
  });

  it("uses the nonce hash to resolve colliding shortIds", async () => {
    const store = makeStore();
    const first = createAwaitingJob(store, { id: "deadbeef0000000000000001" });
    const second = createAwaitingJob(store, { id: "deadbeef1111111111111111" });
    const service = makeService(store);
    makeIssue(service, first);
    const secondApproval = makeIssue(service, second);

    const result = await service.decide({
      payload: secondApproval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: "chat-1",
      threadId: "topic-1",
    });

    expect(result).toMatchObject({ ok: true, jobId: second.id });
    expect(currentJobs(store)[first.id].state).toBe("awaiting-approval");
    expect(currentJobs(store)[second.id].state).toBe("approved");
  });

  it("sources plan estimates from the tool and refuses unavailable estimates", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store, { type: "plan", quorum: "auto" });
    const estimate = makeEstimate();
    const mcp = { call: vi.fn(async () => estimate) };
    const service = makeService(store, { mcp });
    const approval = service.createApproval(job);
    const card = await buildApprovalCard({ job, project, mcp, approval });

    expect(mcp.call).toHaveBeenCalledWith("forge_estimate_quorum", { planPath: job.planPath });
    expect(card.text).toContain("1.8423");
    expect(card.text).toContain("7");
    expect(card.text).toContain("3");
    const displayedCosts = [
      ...card.text.matchAll(/\$[0-9]+(?:\.[0-9]+)?/g),
      ...card.keyboard.inline_keyboard.flat().flatMap(({ text }) => [...text.matchAll(/\$[0-9]+(?:\.[0-9]+)?/g)]),
    ].map(([cost]) => cost);
    expect(new Set(displayedCosts)).toEqual(new Set([
      "$1.8423", "$2.4367", "$1.2384", "$0.4281",
    ]));

    const failed = await buildApprovalCard({
      job,
      project,
      approval,
      mcp: { call: async () => { throw new Error("unavailable"); } },
    });
    expect(failed).toEqual({ ok: false, error: "ESTIMATE_UNAVAILABLE" });
    expect(failed.error).not.toContain("$");
  });

  it("adapts project client managers for the plan estimate MCP call", async () => {
    const store = makeStore();
    const job = createAwaitingJob(store, { type: "plan" });
    const manager = {
      get: vi.fn(),
      call: vi.fn(async (_projectId, tool) => {
        expect(tool).toBe("forge_estimate_quorum");
        return makeEstimate();
      }),
    };
    const card = await buildApprovalCard({ job, project, mcp: manager });
    expect(card.text).toContain("Estimated cost");
    expect(manager.call).toHaveBeenCalledWith(job.projectId, "forge_estimate_quorum", {
      planPath: job.planPath,
    });
  });

  it("builds task and skill cards without quorum buttons or cost", async () => {
    for (const type of ["task", "skill"]) {
      const store = makeStore();
      const job = createAwaitingJob(store, {
        id: type === "task" ? "abcdef0123456789abcdef01" : "abcdef0123456789abcdef02",
        type,
        skill: type === "skill" ? "test-sweep" : undefined,
        lane: "remote",
      });
      const approval = issueApproval({
        jobId: job.id, chatId: job.chatId, threadId: job.threadId,
        requesterId: job.callerId, now: () => NOW,
      });
      const card = await buildApprovalCard({ job, project, approval, mcp: { call: vi.fn() } });

      expect(card.text).toContain(type === "task" ? "Improve the parser" : "test-sweep");
      expect(card.text).toContain(`claw/${job.id}`);
      expect(card.text).toContain("remote");
      expect(card.text).not.toContain("$");
      expect(card.keyboard.inline_keyboard).toHaveLength(1);
      expect(card.keyboard.inline_keyboard[0]).toHaveLength(2);
    }
  });

  it("placement preview shows the selected lane and skipped-lane explanation", async () => {
    const store = makeStore();
    const previewProject = {
      ...project,
      homeLane: "local",
      placement: { prefer: ["remote"] },
    };
    const unbind = bindPlacementService(createPlacementService({
      store,
      config: {
        projects: [previewProject],
        lanes: [
          { id: "remote", kind: "remote" },
          { id: "local", kind: "local" },
        ],
      },
      health: () => ({
        remote: { ok: false },
        local: { ok: true, queued: 0 },
      }),
    }));
    unbinders.push(unbind);
    const job = {
      id: "abcdef0123456789abcdef03",
      projectId: project.id,
      type: "task",
      description: "Improve the parser",
    };
    const approval = issueApproval({
      jobId: job.id,
      chatId: "chat-1",
      requesterId: "requester-1",
      now: () => NOW,
    });
    const card = await buildApprovalCard({ job, project: previewProject, approval });
    expect(card.text).toContain("Expected to run on: local (remote offline)");
    expect(card.text).toContain("Skipped lanes: remote offline");
    expect(card.text).not.toContain("Lane:");

    const override = await buildApprovalCard({
      job: { ...job, placement: { explanation: "precomputed lane" } },
      project: previewProject,
      approval,
    });
    expect(override.text).toContain("Expected to run on: precomputed lane");
    expect(override.text).not.toContain("remote offline");
  });

  it("falls back to the configured lane when placement preview is unavailable", async () => {
    const job = {
      id: "abcdef0123456789abcdef03",
      type: "task",
      description: "Improve the parser",
      placement: { explanation: "k8s-jobs (mac-1 offline)" },
    };
    const approval = issueApproval({
      jobId: job.id,
      chatId: "chat-1",
      requesterId: "requester-1",
      now: () => NOW,
    });
    const card = await buildApprovalCard({ job, project, approval });
    expect(card.text).toContain("Expected to run on: k8s-jobs (mac-1 offline)");
    expect(card.text).not.toContain("Lane:");
  });

  it("keeps callback data and persisted streams free of raw nonces", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const job = createAwaitingJob(store, { type: "plan" });
    const service = makeService(store, { channel });
    const approval = service.createApproval(job);
    const card = await service.buildApprovalCard({ job, project, approval });
    const callbackData = card.keyboard.inline_keyboard.flat().map(({ callback_data }) => callback_data);
    const nonce = parseApprovalPayload(callbackData[0].slice(2)).nonce;
    await channel.send({ chatId: job.chatId, text: card.text, replyMarkup: card.keyboard });
    service.issue(job, { approval, messageRef: { chatId: job.chatId, messageId: "message-1" } });
    await approvalCallback.handle({}, {
      payload: approval.approve.slice(2),
      caller: { userId: "approver-1", role: "owner" },
      chatId: job.chatId,
      threadId: job.threadId,
      messageId: "message-1",
    });

    expect(callbackData.every((data) => Buffer.byteLength(data, "utf8") <= 64)).toBe(true);
    expect(readFileSync(path.join(directories.at(-1), "approvals.jsonl"), "utf8")).not.toContain(nonce);
    expect(readFileSync(path.join(directories.at(-1), "audit.jsonl"), "utf8")).not.toContain(nonce);
    expect(channel.calls.filter(({ method }) => method === "answerCallback")).toHaveLength(0);
  });

  it("FP01 leaves a declared fanout child's approval to its pending parent", () => {
    const store = makeStore();
    const childId = "cabcde0123456789abcdef01";
    const parent = createAwaitingJob(store, {
      id: "fabcde0123456789abcdef01",
      type: "fanout",
      targets: [{ childId, projectId: project.id, branch: `claw/${childId}` }],
    });
    createAwaitingJob(store, { id: childId, parentId: parent.id });
    const service = makeService(store);

    expect(service.pendingWithoutCard().map(({ id }) => id)).toEqual([parent.id]);
    expect(records(store, "approvals")).toEqual([]);
  });

  it("FP01 never issues a per-child card during approved fanout recovery", async () => {
    const store = makeStore();
    const channel = makeChannel();
    const childId = "cabcde0123456789abcdef01";
    const parent = createAwaitingJob(store, {
      id: "fabcde0123456789abcdef01",
      type: "fanout",
      callerId: "owner-1",
      targets: [{ childId, projectId: project.id, branch: `claw/${childId}` }],
    });
    const child = createAwaitingJob(store, { id: childId, parentId: parent.id, callerId: "owner-1" });
    const config = {
      projects: [project],
      allowlist: [{ channel: "telegram", userId: "owner-1", role: "owner" }],
    };
    const service = makeService(store, { config });
    const approval = makeIssue(service, parent);
    expect(await service.decide({
      payload: approval.approve.slice(2), caller: { userId: "owner-1", role: "owner" },
      chatId: parent.chatId, threadId: parent.threadId,
    })).toMatchObject({ ok: true, jobId: parent.id, decision: "approve" });

    await approvalsFeature.start({ store, channel, config, now: () => NOW });

    expect(channel.calls.length).toBe(0);
    expect(records(store, "approvals").map(({ jobId }) => jobId)).toEqual([parent.id, parent.id]);
    expect(currentJobs(store)[child.id].state).toBe("awaiting-approval");
  });

  it.each(["undeclared child", "wrong project", "non-fanout parent", "missing parent"])(
    "FP01 does not suppress an approval with a forged %s relationship",
    (relationship) => {
      const store = makeStore();
      const childId = "cabcde0123456789abcdef01";
      const parent = createAwaitingJob(store, {
        id: "fabcde0123456789abcdef01",
        type: relationship === "non-fanout parent" ? "task" : "fanout",
        targets: [{
          childId: relationship === "undeclared child" ? "0abcde0123456789abcdef01" : childId,
          projectId: relationship === "wrong project" ? "project-2" : project.id,
          branch: `claw/${childId}`,
        }],
      });
      const child = createAwaitingJob(store, {
        id: childId,
        parentId: relationship === "missing parent" ? "0abcde0123456789abcdef01" : parent.id,
      });
      const service = makeService(store);

      expect(service.pendingWithoutCard().map(({ id }) => id)).toContain(child.id);
      expect(records(store, "approvals")).toEqual([]);
    },
  );

  it("starts without a channel and clears its interval on stop", async () => {
    vi.useFakeTimers();
    await approvalsFeature.start({ approvalIntervalMs: 30_000, now: () => NOW });
    expect(approvalsFeature.available).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await approvalsFeature.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
