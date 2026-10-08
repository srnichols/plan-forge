import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import skillCommand, { prepareSkill } from "../../src/commands/skill.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
async function store() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-skill-command-"));
  directories.push(directory);
  return createStore(directory);
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("/skill", () => {
  it("creates a read job only for explicit readOnly metadata", async () => {
    const jobsStore = await store();
    const metadata = { status: "dry-run", skillName: "inspect", readOnly: true };
    const mcp = { call: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(metadata) }] })) };
    const project = { id: "p1", repo: { path: "C:\\repo" } };
    const result = await prepareSkill({ store: jobsStore, mcp, project }, {
      args: ["inspect", "the", "diff"],
    });
    expect(mcp.call).toHaveBeenCalledWith("forge_run_skill", {
      skill: "inspect", dryRun: true, path: project.repo.path,
    });
    expect(result.text).toContain("queued");
    expect(Object.values(currentJobs(jobsStore))[0]).toMatchObject({
      type: "skill", skill: "inspect", args: "the diff", readOnly: true, state: "queued",
    });
  });

  it("requires approval for all other skills and handles unknown or unavailable metadata", async () => {
    const jobsStore = await store();
    const metadata = { status: "dry-run", skillName: "review", readOnly: false };
    const mcp = {
      call: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(metadata) }] })),
    };
    const dependencies = { store: jobsStore, mcp, project: { id: "p1", repo: { path: "C:\\repo" } } };
    await prepareSkill(dependencies, { args: ["review"] });
    expect(Object.values(currentJobs(jobsStore))[0].state).toBe("awaiting-approval");
    expect(await prepareSkill(dependencies, { args: ["missing"] }))
      .toMatchObject({ text: expect.stringContaining("Unknown skill") });
    expect(await prepareSkill({ store: jobsStore, project: { id: "p1" } }, { args: ["review"] }))
      .toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    expect(Object.values(currentJobs(jobsStore))).toHaveLength(1);
  });

  it("binds a chat-issued skill job to the requesting chat, topic and caller", async () => {
    const jobsStore = await store();
    const metadata = { status: "dry-run", skillName: "review", readOnly: false };
    const mcp = { call: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(metadata) }] })) };
    const context = { services: { store: jobsStore, mcp }, project: { id: "p1", repo: { path: "C:\\repo" } } };
    const result = await skillCommand.handle(context, {
      args: ["review"], caller: { userId: "u1", role: "owner" }, chatId: "42", threadId: "101",
    });
    expect(result.text).toContain("awaiting approval");
    expect(Object.values(currentJobs(jobsStore))[0]).toMatchObject({
      callerId: "u1", chatId: "42", threadId: "101", state: "awaiting-approval",
    });
  });
});
