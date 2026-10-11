import { afterEach, describe, expect, it, vi } from "vitest";
import abortCommand from "../../src/commands/abort.mjs";
import { bindProgressService, createProgressService } from "../../src/progress.mjs";
import { currentJobs, createJob, JOBS_STREAM, transition } from "../../src/jobs/model.mjs";

const PROJECT_ID = "project-1";
const CHAT_ID = "chat-1";
const THREAD_ID = "topic-1";
const unbinders = [];

function createStore() {
  const streams = new Map();
  return {
    append(stream, record) {
      const records = streams.get(stream) ?? [];
      records.push(record);
      streams.set(stream, records);
      return record;
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

function addJob(store, {
  id = "abcdef0123456789abcdef01",
  state: desired = "running",
  createdAt = new Date().toISOString(),
} = {}) {
  const { job: base } = createJob({ id, type: "task", projectId: PROJECT_ID });
  let job = {
    ...base,
    description: "Fix a regression",
    callerId: "user-1",
    chatId: CHAT_ID,
    threadId: THREAD_ID,
    createdAt,
    lane: "local",
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  for (const next of desired === "failed"
    ? ["awaiting-approval", "approved", "leased", "running", "failed"]
    : ["awaiting-approval", "approved", "leased", "running"]) {
    const moved = transition(job, next);
    store.append(JOBS_STREAM, moved.event);
    job = moved.job;
  }
  return currentJobs(store)[id];
}

function setup(store, lanes = new Map()) {
  const service = createProgressService({
    store,
    lanes,
    channel: { send: async () => ({ messageId: "message-1" }), edit: vi.fn(async () => {}) },
    logger: { error() {} },
  });
  unbinders.push(bindProgressService(service));
  return service;
}

const invoke = (argsText, project = { id: PROJECT_ID }) => abortCommand.handle(
  { project },
  { argsText, caller: { userId: "owner-1" }, chatId: CHAT_ID, threadId: THREAD_ID },
);

afterEach(async () => {
  for (const unbind of unbinders.splice(0).reverse()) unbind();
});

describe("/abort", () => {
  it("shows usage when no id is provided and cancels latest running job", async () => {
    expect(await invoke("")).toEqual({ text: "Usage: /abort <job-id|latest>" });
    const store = createStore();
    const job = addJob(store);
    const cancel = vi.fn(async () => ({ ok: true }));
    const service = setup(store, new Map([["local", { cancel }]]));
    expect((await invoke("latest")).text).toBe("Cancellation requested.");
    expect(cancel).toHaveBeenCalledWith(job.id);
    expect(currentJobs(store)[job.id].state).toBe("running");
    await service.stop();
  });

  it("falls back to the latest failed job and rejects terminal states", async () => {
    const store = createStore();
    const failed = addJob(store, { state: "failed" });
    const service = setup(store);
    expect((await invoke("latest")).text).toBe("Failed job dismissed.");
    expect(currentJobs(store)[failed.id].state).toBe("failed");
    expect((await invoke("missing")).text).toContain("JOB_NOT_FOUND");
    await service.stop();
  });

  it("prefers the latest running job over a newer failed job", async () => {
    const store = createStore();
    const running = addJob(store, { id: "a1111111b2222222c3333333", createdAt: "2026-10-06T00:00:00.000Z" });
    addJob(store, { id: "a4444444b5555555c6666666", state: "failed", createdAt: "2026-10-07T00:00:00.000Z" });
    const cancel = vi.fn(async () => ({ ok: true }));
    const service = setup(store, new Map([["local", { cancel }]]));
    await invoke("latest");
    expect(cancel).toHaveBeenCalledWith(running.id);
    await service.stop();
  });

  it("reports missing lanes and rejects jobs outside the caller chat", async () => {
    const store = createStore();
    const running = addJob(store);
    const service = setup(store);
    expect((await invoke(running.id)).text).toContain("LANE_UNAVAILABLE");
    expect((await invoke("latest", { id: "other-project" })).text).toContain("JOB_NOT_FOUND");
    await service.stop();
  });
});
