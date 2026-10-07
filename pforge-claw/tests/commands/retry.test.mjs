import { afterEach, describe, expect, it } from "vitest";
import retryCommand from "../../src/commands/retry.mjs";
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
  state: desired = "failed",
  chatId = CHAT_ID,
  threadId = THREAD_ID,
} = {}) {
  const { job: base } = createJob({ id, type: "task", projectId: PROJECT_ID });
  let job = {
    ...base,
    description: "Fix a regression",
    callerId: "user-1",
    chatId,
    threadId,
    createdAt: new Date().toISOString(),
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

function setup(store, { lanes } = {}) {
  const service = createProgressService({
    store,
    lanes,
    channel: { send: async () => ({ messageId: "message-1" }), edit: async () => {} },
    logger: { error() {} },
  });
  unbinders.push(bindProgressService(service));
  return service;
}

const invoke = (argsText, project = { id: PROJECT_ID }) => retryCommand.handle(
  { project },
  { argsText, caller: { userId: "owner-1" }, chatId: CHAT_ID, threadId: THREAD_ID },
);

afterEach(async () => {
  for (const unbind of unbinders.splice(0).reverse()) unbind();
});

describe("/retry", () => {
  it("shows usage when no id is provided and retries the latest failed job", async () => {
    expect(await invoke("")).toEqual({ text: "Usage: /retry <job-id|latest>" });
    const store = createStore();
    const job = addJob(store);
    const service = setup(store);
    const response = await invoke("latest");
    expect(response.text).toContain("awaiting approval");
    expect(Object.values(currentJobs(store)).find((candidate) => candidate.parentId === job.id))
      .toMatchObject({ parentId: job.id, state: "awaiting-approval" });
    await service.stop();
  });

  it("reports unknown, ambiguous, and non-failed jobs without throwing", async () => {
    const store = createStore();
    addJob(store);
    addJob(store, { id: "abcdef01aaaaaaaaaaaaaaaa" });
    addJob(store, { id: "a1111111b2222222c3333333", state: "running" });
    const service = setup(store);
    expect((await invoke("not-a-job")).text).toContain("JOB_NOT_FOUND");
    expect((await invoke("abcdef01")).text).toContain("AMBIGUOUS_JOB");
    expect((await invoke("a1111111b2222222c3333333")).text).toContain("NOT_RETRYABLE");
    await service.stop();
  });

  it("does not resolve jobs in a different chat or topic", async () => {
    const store = createStore();
    addJob(store, { chatId: "another-chat" });
    const service = setup(store);
    expect((await invoke("latest")).text).toContain("JOB_NOT_FOUND");
    await service.stop();
  });
});
