import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import progressCallback from "../src/callbacks/f.mjs";
import {
  bindProgressService,
  createProgressService,
  getProgressService,
} from "../src/progress.mjs";
import { currentJobs, createJob, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import progressFeature from "../src/features/progress.mjs";
import {
  failureKeyboard,
  renderFailure,
  renderProgress,
  renderRunSummary,
  renderSliceComplete,
} from "../src/progress.mjs";

const PROJECT_ID = "project-1";
const CHAT_ID = "chat-1";
const THREAD_ID = "topic-1";

function createMemoryStore() {
  const streams = new Map();
  return {
    append(stream, record) {
      const records = streams.get(stream) ?? [];
      const stored = { v: 1, ...record };
      records.push(stored);
      streams.set(stream, records);
      return stored;
    },
    *read(stream) {
      for (const record of streams.get(stream) ?? []) yield { record };
    },
    fold(stream, reducer, initial) {
      let state = initial;
      for (const record of streams.get(stream) ?? []) state = reducer(state, record);
      return state;
    },
  };
}

function createRunningJob(store, {
  id = "abcdef0123456789abcdef01",
  type = "task",
  state: targetState = "running",
  fields = {},
} = {}) {
  const created = createJob({ id, type, projectId: PROJECT_ID });
  let job = {
    ...created.job,
    description: "Improve the parser",
    callerId: "requester-1",
    createdAt: new Date(Date.now()).toISOString(),
    chatId: CHAT_ID,
    threadId: THREAD_ID,
    ...fields,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  const states = targetState === "failed"
    ? ["awaiting-approval", "approved", "leased", "running", "failed"]
    : targetState === "leased"
      ? ["awaiting-approval", "approved", "leased"]
      : targetState === "needs-input"
        ? ["awaiting-approval", "approved", "leased", "running", "needs-input"]
        : ["awaiting-approval", "approved", "leased", "running"];
  for (const next of states) {
    const result = transition(job, next);
    store.append(JOBS_STREAM, result.event);
    job = result.job;
  }
  return currentJobs(store)[id];
}

function createChannel() {
  let messageId = 0;
  return {
    id: "telegram",
    limits: { maxCallbackDataBytes: 64 },
    send: vi.fn(async () => ({ messageId: `message-${++messageId}` })),
    edit: vi.fn(async () => undefined),
  };
}

function createService(store, options = {}) {
  return createProgressService({
    store,
    bus: options.bus ?? new EventEmitter(),
    channel: options.channel ?? createChannel(),
    mcp: options.mcp,
    secrets: options.secrets,
    lanes: options.lanes,
    now: () => Date.now(),
    logger: { error: vi.fn(), warn: vi.fn() },
    minEditMs: 3000,
  });
}

function records(store, stream) {
  return [...store.read(stream)].map(({ record }) => record);
}

async function drainMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function startProgress(service, job) {
  await service.onJobTransition({ jobId: job.id, to: "running" });
  await drainMicrotasks();
}

function laneEvent(jobId, seq, type, data = {}) {
  return { jobId, seq, type, data };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(async () => {
  await progressFeature.stop();
  vi.useRealTimers();
});

describe("progress renderers", () => {
  const state = {
    state: "running",
    lane: "local",
    slice: { n: 2, m: 5 },
    startedAt: 0,
    spend: 1.25,
    now: () => 125_000,
    artifacts: [],
  };

  it("renders all operational fields in each template", () => {
    for (const text of [
      renderProgress(state),
      renderSliceComplete(state, { index: 2, total: 5 }),
      renderFailure({ ...state, state: "failed" }, "runner failed"),
      renderRunSummary(state, { summary: "run finished" }),
    ]) {
      expect(text).toContain("State:");
      expect(text).toContain("Lane:");
      expect(text).toContain("Slice:");
      expect(text).toContain("Elapsed:");
      expect(text).toContain("Spend:");
    }
  });

  it("renders unknown spend and known zero distinctly", () => {
    expect(renderProgress({ ...state, spend: null })).toContain("Spend: n/a");
    expect(renderProgress({ ...state, spend: 0 })).toContain("Spend: $0.00");
    expect(renderProgress({ ...state, lane: null })).toContain("Lane: n/a");
  });

  it("redacts secrets in dynamic text and leaves MarkdownV2 escaping to the channel adapter", () => {
    const secrets = { redact: (text) => String(text).replaceAll("secret-token", "[redacted]") };
    const text = renderFailure({
      ...state,
      secrets,
      lane: "secret-token_lane",
    }, "failed_secret-token!");
    expect(text).toContain("[redacted]_lane");
    expect(text).toContain("[redacted]!");
    expect(text).not.toContain("secret-token");
  });

  it("shows PR URLs only when supplied by an artifact and truncates long reasons", () => {
    expect(renderRunSummary({ ...state, artifacts: [] }, {})).toContain("No artifacts reported");
    expect(renderRunSummary({ ...state, prUrl: "https://example.test/pr/42" }, {}))
      .toContain("https://example.test/pr/42");
    const rendered = renderFailure(state, "x".repeat(1800));
    expect(rendered).toContain("[truncated]");
    expect(rendered.length).toBeLessThan(1700);
  });

  it("builds safe recovery buttons and omits resume for non-plan jobs", () => {
    const job = { id: "abcdef0123456789abcdef01", type: "task" };
    const taskButtons = failureKeyboard(job, { canResume: true }).inline_keyboard.flat();
    expect(taskButtons).toHaveLength(3);
    const planButtons = failureKeyboard({ ...job, type: "plan" }, { canResume: true }).inline_keyboard.flat();
    expect(planButtons).toHaveLength(4);
    for (const item of [...taskButtons, ...planButtons]) {
      expect(Buffer.byteLength(item.callback_data)).toBeLessThanOrEqual(64);
    }
  });
});

describe("progress service throttling and persistence", () => {
  it("coalesces edits until the 3-second interval expires", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    const job = createRunningJob(store);
    const service = createService(store, { channel });
    await startProgress(service, job);
    service.onLaneEvent(laneEvent(job.id, 1, "cost", { costUsd: 1 }));
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(1);
    service.onLaneEvent(laneEvent(job.id, 2, "cost", { costUsd: 2 }));
    await vi.advanceTimersByTimeAsync(2999);
    expect(channel.edit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(2);
    expect(channel.edit.mock.calls[1][0].text).toContain("$3.00");
    await service.stop();
  });

  it("limits ten rapid events to one immediate and one deferred edit", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    const job = createRunningJob(store);
    const service = createService(store, { channel });
    await startProgress(service, job);
    for (let seq = 1; seq <= 10; seq += 1) {
      service.onLaneEvent(laneEvent(job.id, seq, "cost", { costUsd: 0.1 }));
    }
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(2);
  });

  it("skips identical content and lets terminal output replace pending content", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    const job = createRunningJob(store, { state: "failed" });
    const service = createService(store, { channel });
    await startProgress(service, job);
    service.onLaneEvent(laneEvent(job.id, 1, "progress", {}));
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(0);
    service.onLaneEvent(laneEvent(job.id, 2, "cost", { costUsd: 1 }));
    await drainMicrotasks();
    service.onJobFinished({ jobId: job.id, state: "failed", reason: "final failure" });
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(3000);
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(2);
    expect(channel.edit.mock.calls[1][0].text).toContain("final failure");
  });

  it("throttles different jobs independently and sends only one message per job", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    const first = createRunningJob(store, { id: "a1111111b2222222c3333333" });
    const second = createRunningJob(store, { id: "a4444444b5555555c6666666" });
    const service = createService(store, { channel });
    await Promise.all([
      service.onJobTransition({ jobId: first.id, to: "running" }),
      service.onJobTransition({ jobId: first.id, to: "running" }),
      service.onJobTransition({ jobId: second.id, to: "running" }),
    ]);
    expect(channel.send).toHaveBeenCalledTimes(2);
    service.onLaneEvent(laneEvent(first.id, 1, "cost", { costUsd: 1 }));
    service.onLaneEvent(laneEvent(second.id, 1, "cost", { costUsd: 2 }));
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(2);
    await service.stop();
  });

  it("reuses the persisted message reference after service restart", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    const job = createRunningJob(store);
    const first = createService(store, { channel });
    await startProgress(first, job);
    await first.stop();
    const second = createService(store, { channel });
    await second.onJobTransition({ jobId: job.id, to: "running" });
    second.onLaneEvent(laneEvent(job.id, 1, "cost", { costUsd: 1 }));
    await drainMicrotasks();
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.edit).toHaveBeenCalledWith(expect.objectContaining({ messageId: "message-1" }));
    expect(records(store, "progress")).toContainEqual(expect.objectContaining({
      kind: "progress.message",
      jobId: job.id,
      messageId: "message-1",
    }));
    await second.stop();
  });

  it("takes PR URLs only from PR artifact events", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    const prJob = createRunningJob(store);
    const service = createService(store, { channel });
    await startProgress(service, prJob);
    service.onLaneEvent(laneEvent(prJob.id, 1, "artifact", {
      kind: "branch",
      url: "https://example.test/branch",
    }));
    service.onJobFinished({ jobId: prJob.id, state: "succeeded" });
    await drainMicrotasks();
    expect(channel.edit.mock.calls.at(-1)[0].text).not.toContain("Pull request:");
    const secondJob = createRunningJob(store, { id: "a1111111b2222222c3333333" });
    await service.onJobTransition({ jobId: secondJob.id, to: "running" });
    service.onLaneEvent(laneEvent(secondJob.id, 1, "artifact", {
      kind: "pr",
      url: "https://example.test/pr/42",
    }));
    service.onJobFinished({ jobId: secondJob.id, state: "succeeded" });
    await drainMicrotasks();
    expect(channel.edit.mock.calls.at(-1)[0].text).toContain("Pull request:");
    expect(channel.edit.mock.calls.at(-1)[0].text).toContain("https://example.test/pr/42");
    await service.stop();
  });

  it("drops stale lane sequences and logs deleted-message edit failures", async () => {
    const store = createMemoryStore();
    const channel = createChannel();
    channel.edit.mockRejectedValueOnce(Object.assign(new Error("message to edit not found"), { code: "MESSAGE_NOT_FOUND" }));
    const job = createRunningJob(store);
    const service = createService(store, { channel });
    await startProgress(service, job);
    service.onLaneEvent(laneEvent(job.id, 3, "cost", { costUsd: 1 }));
    service.onLaneEvent(laneEvent(job.id, 2, "cost", { costUsd: 4 }));
    await drainMicrotasks();
    expect(channel.edit).toHaveBeenCalledTimes(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "progress-edit-failed",
      jobId: job.id,
    }));
    await service.stop();
  });
});

describe("progress recovery actions", () => {
  it("creates approval-gated retry and resume children and deduplicates repeated actions", async () => {
    const store = createMemoryStore();
    const bus = new EventEmitter();
    const job = createRunningJob(store, {
      type: "plan",
      state: "failed",
      fields: { plan: "docs/plans/example.md", description: "Run plan" },
    });
    const service = createService(store, { bus });
    service.onLaneEvent(laneEvent(job.id, 1, "slice", { index: 2, total: 5 }));
    const retry = await service.createRecoveryJob(job, {
      mode: "retry", caller: { userId: "owner-1" }, chatId: CHAT_ID, threadId: THREAD_ID,
    });
    const retryAgain = await service.createRecoveryJob(job, { mode: "retry" });
    const unbind = bindProgressService(service);
    await progressCallback.handle({ project: { id: PROJECT_ID } }, {
      payload: `n:${job.id.slice(0, 8)}`,
      caller: { userId: "owner-1", role: "owner" },
      chatId: CHAT_ID,
      threadId: THREAD_ID,
    });
    const resumeChild = Object.values(currentJobs(store)).find((candidate) => (
      candidate.parentId === job.id && candidate.resumeFrom === 3
    ));
    const resume = await service.createRecoveryJob(job, { mode: "resume" });
    expect(retry.job).toMatchObject({
      parentId: job.id,
      state: "awaiting-approval",
      type: "plan",
      planPath: "docs/plans/example.md",
    });
    expect(retryAgain.jobId).toBe(retry.jobId);
    expect(retryAgain.existing).toBe(true);
    expect(resumeChild).toMatchObject({ parentId: job.id, resumeFrom: 3, state: "awaiting-approval" });
    expect(resume.jobId).toBe(resumeChild.id);
    expect(bus.listenerCount("job.transition")).toBe(0);
    expect(records(store, "progress").filter((record) => record.kind === "progress.recovered")).toHaveLength(2);
    unbind();
  });

  it("rejects recovery of non-failed jobs, non-plan resumes, and resumes without a known next slice", async () => {
    const store = createMemoryStore();
    const failedTask = createRunningJob(store, { state: "failed" });
    const failedPlan = createRunningJob(store, { id: "a1111111b2222222c3333333", type: "plan", state: "failed" });
    const running = createRunningJob(store, { id: "a2222222b3333333c4444444" });
    const service = createService(store);
    expect(await service.createRecoveryJob(running)).toMatchObject({ error: "NOT_RETRYABLE" });
    expect(await service.createRecoveryJob(failedTask, { mode: "resume" })).toMatchObject({ error: "NOT_RESUMABLE" });
    expect(await service.createRecoveryJob(failedPlan, { mode: "resume" })).toMatchObject({ error: "NOT_RESUMABLE" });
  });

  it("resolves jobs only within the same project, chat, topic, and allowed states", () => {
    const store = createMemoryStore();
    const first = createRunningJob(store);
    createRunningJob(store, { id: "a1111111b2222222c3333333", fields: { chatId: "elsewhere" } });
    const service = createService(store);
    expect(service.resolveJob("latest", {
      projectId: PROJECT_ID, chatId: CHAT_ID, threadId: THREAD_ID, states: ["running"],
    }).id).toBe(first.id);
    expect(() => service.resolveJob("abcdef01", {
      projectId: PROJECT_ID, chatId: "elsewhere", threadId: THREAD_ID, states: ["running"],
    })).toThrowError(expect.objectContaining({ code: "JOB_NOT_FOUND" }));
    createRunningJob(store, { id: "abcdef01aaaaaaaaaaaaaaaa" });
    expect(() => service.resolveJob("abcdef01", {
      projectId: PROJECT_ID, chatId: CHAT_ID, threadId: THREAD_ID, states: ["running"],
    })).toThrowError(expect.objectContaining({ code: "AMBIGUOUS_JOB" }));
  });

  it("requests running cancellation without transitioning when a lane is unavailable", async () => {
    const store = createMemoryStore();
    const job = createRunningJob(store, { fields: { lane: "local" } });
    const service = createService(store);
    const result = await service.abortJob(job, { userId: "owner-1" });
    expect(result).toMatchObject({ error: "LANE_UNAVAILABLE" });
    expect(currentJobs(store)[job.id].state).toBe("running");
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "progress-abort-failed",
      reason: "LANE_UNAVAILABLE",
    }));
  });

  it("does not claim cancellation when a lane rejects the request", async () => {
    const store = createMemoryStore();
    const job = createRunningJob(store, { fields: { lane: "local" } });
    const service = createService(store, {
      lanes: new Map([["local", { cancel: async () => ({ ok: false, error: "JOB_UNKNOWN" }) }]]),
    });
    expect(await service.abortJob(job, { userId: "owner-1" }))
      .toMatchObject({ ok: false, error: "JOB_UNKNOWN" });
    expect(currentJobs(store)[job.id].state).toBe("running");
    await service.stop();
  });

  it("cancels through the lane and dismisses failed jobs without changing their state", async () => {
    const store = createMemoryStore();
    const lane = { cancel: vi.fn(async () => ({ ok: true })) };
    const running = createRunningJob(store, { fields: { lane: "local" } });
    const failed = createRunningJob(store, { id: "a1111111b2222222c3333333", state: "failed" });
    const channel = createChannel();
    const service = createService(store, { channel, lanes: new Map([["local", lane]]) });
    expect(await service.abortJob(running, { userId: "owner-1" })).toMatchObject({ ok: true });
    expect(lane.cancel).toHaveBeenCalledWith(running.id);
    await service.onJobTransition({ jobId: failed.id, to: "running" });
    await service.abortJob(failed, { userId: "owner-1" });
    expect(currentJobs(store)[failed.id].state).toBe("failed");
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "progress.discarded",
      jobId: failed.id,
    }));
    await service.stop();
  });

  it("aborts leased and needs-input jobs through their recorded lane", async () => {
    const store = createMemoryStore();
    const lane = { cancel: vi.fn(async () => ({ ok: true })) };
    const leased = createRunningJob(store, {
      id: "abcdef0123456789abcdef10", state: "leased", fields: { lane: "local" },
    });
    const waiting = createRunningJob(store, {
      id: "abcdef0123456789abcdef11", state: "needs-input", fields: { lane: "local" },
    });
    const service = createService(store, { lanes: new Map([["local", lane]]) });
    expect(await service.abortJob(leased, { userId: "owner-1" })).toMatchObject({ ok: true });
    expect(await service.abortJob(waiting, { userId: "owner-1" })).toMatchObject({ ok: true });
    expect(lane.cancel).toHaveBeenNthCalledWith(1, leased.id);
    expect(lane.cancel).toHaveBeenNthCalledWith(2, waiting.id);
    await service.stop();
  });

  it("asks Forge-Master with failure context and gates suggestions behind task approval", async () => {
    const store = createMemoryStore();
    const job = createRunningJob(store, { state: "failed" });
    const mcp = {
      call: vi.fn(async (_projectId, _toolName, args) => {
        expect(args.proposeActions).toBe(true);
        expect(args.contextBlocks[0].title).toBe("Failure summary");
        return {
          reply: "The plan failed because a test is missing.",
          proposedActions: [{ label: "Add a regression test", summary: "Add an assertion for the parser." }],
        };
      }),
    };
    const channel = createChannel();
    const service = createService(store, { channel, mcp });
    await service.onJobTransition({ jobId: job.id, to: "running" });
    const result = await service.explainFailure(job, {
      caller: { userId: "owner-1", role: "owner" }, chatId: CHAT_ID, threadId: THREAD_ID,
    });
    expect(result.ok).toBe(true);
    expect(mcp.call).toHaveBeenCalledWith(PROJECT_ID, "forge_master_ask", expect.objectContaining({
      proposeActions: true,
      caller: expect.objectContaining({ channel: "chat", topic: THREAD_ID }),
    }));
    expect(records(store, "progress")).toContainEqual(expect.objectContaining({
      kind: "progress.suggestions",
      jobId: job.id,
    }));
    expect(channel.edit.mock.calls.at(-1)[0].replyMarkup.inline_keyboard.flat()
      .some((item) => item.callback_data === `f:s:${job.id.slice(0, 8)}:0`)).toBe(true);
    const unbind = bindProgressService(service);
    await progressCallback.handle({ project: { id: PROJECT_ID } }, {
      payload: `s:${job.id.slice(0, 8)}:0`,
      caller: { userId: "owner-1", role: "owner" },
      chatId: CHAT_ID,
      threadId: THREAD_ID,
    });
    const chosen = Object.values(currentJobs(store)).find((candidate) => candidate.parentId === job.id
      && candidate.type === "task");
    expect(chosen).toMatchObject({
      type: "task",
      description: "Add an assertion for the parser.",
      state: "awaiting-approval",
      parentId: job.id,
      chatId: CHAT_ID,
      threadId: THREAD_ID,
    });
    unbind();
    await service.stop();
  });

  it("returns a neutral response on MCP errors and ignores tampered or unauthorized callbacks", async () => {
    const store = createMemoryStore();
    const job = createRunningJob(store, { state: "failed" });
    const channel = createChannel();
    const service = createService(store, {
      channel,
      mcp: { call: vi.fn(async () => { throw new Error("sensitive transport detail"); }) },
    });
    const unbind = bindProgressService(service);
    await service.explainFailure(job, {
      caller: { userId: "owner-1", role: "owner" }, chatId: CHAT_ID, threadId: THREAD_ID,
    });
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining("MCP_TOOL_ERROR"),
    }));
    await progressCallback.handle({ project: { id: PROJECT_ID } }, {
      payload: `r:${job.id.slice(0, 8)}`,
      caller: { userId: "viewer-1", role: "viewer" },
      chatId: CHAT_ID,
      threadId: THREAD_ID,
    });
    await progressCallback.handle({ project: { id: PROJECT_ID } }, {
      payload: "bad payload",
      caller: { userId: "owner-1", role: "owner" },
      chatId: CHAT_ID,
      threadId: THREAD_ID,
    });
    expect(currentJobs(store)[job.id].state).toBe("failed");
    expect(records(store, "audit")).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "callback-ignored", reason: "role" }),
      expect.objectContaining({ kind: "callback-ignored", reason: "bad-payload" }),
    ]));
    unbind();
    await service.stop();
  });

  it("rejects wrong-chat callbacks and creates exactly one recovery child on double-tap", async () => {
    const store = createMemoryStore();
    const job = createRunningJob(store, { state: "failed" });
    const channel = createChannel();
    const service = createService(store, { channel });
    const unbind = bindProgressService(service);
    const context = { project: { id: PROJECT_ID } };
    const input = {
      payload: `r:${job.id.slice(0, 8)}`,
      caller: { userId: "owner-1", role: "owner" },
      chatId: CHAT_ID,
      threadId: THREAD_ID,
    };
    await progressCallback.handle(context, { ...input, chatId: "other-chat" });
    expect(currentJobs(store)).toHaveProperty(job.id);
    await Promise.all([
      progressCallback.handle(context, input),
      progressCallback.handle(context, input),
    ]);
    expect(Object.values(currentJobs(store)).filter((candidate) => candidate.parentId === job.id)).toHaveLength(1);
    expect(records(store, "audit")).toContainEqual(expect.objectContaining({
      kind: "progress-callback",
      action: "r",
      jobId: job.id,
    }));
    unbind();
    await service.stop();
  });

  it("tracks through the feature without a channel and safely replaces its listeners", async () => {
    const store = createMemoryStore();
    const bus = new EventEmitter();
    const job = createRunningJob(store);
    const logger = { error: vi.fn() };
    const context = { store, bus, logger };
    await progressFeature.start(context);
    await progressFeature.start(context);
    expect(bus.listenerCount("job.transition")).toBe(1);
    expect(getProgressService()).toBeTruthy();
    bus.emit("job.transition", { jobId: job.id, to: "running" });
    await drainMicrotasks();
    expect(progressFeature.snapshot()).toEqual({ tracked: 1, pendingEdits: 0 });
    expect(logger.error).toHaveBeenCalledWith("PROGRESS_CHANNEL_UNAVAILABLE", {
      code: "PROGRESS_CHANNEL_UNAVAILABLE",
    });
    await progressFeature.stop();
    expect(bus.listenerCount("job.transition")).toBe(0);
    expect(getProgressService()).toBeNull();
  });
});
