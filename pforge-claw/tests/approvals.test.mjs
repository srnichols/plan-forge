import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import approvalCallback from "../src/callbacks/a.mjs";
import { bindApprovalService, buildApprovalCard, createApprovalService, issueApproval, parseApprovalPayload } from "../src/approvals.mjs";
import approvalsFeature from "../src/features/approvals.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createRouter } from "../src/router.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];
const unbinders = [];
const NOW = 1_000_000;
const project = {
  id: "project-1",
  name: "Project One",
  homeLane: "local",
  channel: { adapter: "telegram", chatId: "chat-1", topicId: "topic-1" },
  repo: { path: "/repo/project-1", baseBranch: "main" },
};

function makeStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "claw-approvals-"));
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

  it("starts without a channel and clears its interval on stop", async () => {
    vi.useFakeTimers();
    await approvalsFeature.start({ approvalIntervalMs: 30_000, now: () => NOW });
    expect(approvalsFeature.available).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await approvalsFeature.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
