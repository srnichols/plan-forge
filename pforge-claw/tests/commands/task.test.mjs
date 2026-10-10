import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import taskCommand, { prepareTask } from "../../src/commands/task.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";
import { c2Authority } from "../c2-fixtures.mjs";

const directories = [];
async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-task-command-"));
  directories.push(directory);
  return createStore(directory);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("/task", () => {
  it("retains full argsText and creates only an approval-pending task", async () => {
    const jobsStore = await store();
    const project = { id: "p1" };
    const result = await prepareTask({ store: jobsStore, project, ...c2Authority(project) }, {
      argsText: "Keep  internal spacing and Mixed Case",
    });
    expect(result.text).toContain("awaiting approval");
    expect(Object.values(currentJobs(jobsStore))[0]).toMatchObject({
      type: "task",
      description: "Keep  internal spacing and Mixed Case",
      callerId: "u1",
      state: "awaiting-approval",
    });
  });

  it("rejects invalid arguments and unavailable service without creating a job", async () => {
    expect(await prepareTask({}, { argsText: "work" })).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    const jobsStore = await store();
    expect(await prepareTask({ store: jobsStore, project: { id: "p1" } }, { argsText: "" }))
      .toMatchObject({ text: expect.stringContaining("Usage:") });
    expect(Object.values(currentJobs(jobsStore))).toHaveLength(0);
  });

  it("binds a chat-issued task to the requesting chat, topic and caller so an approval card can be sent", async () => {
    const jobsStore = await store();
    const project = { id: "p1" };
    const result = await taskCommand.handle({ services: { store: jobsStore, ...c2Authority(project) }, project }, {
      argsText: "inspect fixture one", caller: { userId: "u1", role: "owner" }, chatId: "42", threadId: "101",
    });
    expect(result.text).toContain("awaiting approval");
    expect(Object.values(currentJobs(jobsStore))[0]).toMatchObject({
      callerId: "u1", chatId: "42", threadId: "101", state: "awaiting-approval",
    });
  });
});
