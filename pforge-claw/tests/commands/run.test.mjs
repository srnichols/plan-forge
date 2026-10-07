import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentJobs } from "../../src/jobs/model.mjs";
import { prepareRun } from "../../src/commands/run.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
async function fixture(names = ["Phase-1-PLAN.md"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claw-run-command-"));
  directories.push(root);
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
  for (const name of names) await writeFile(path.join(repo, "docs", "plans", name), "# Plan");
  return {
    project: { id: "p1", repo: { path: repo } },
    store: createStore(path.join(root, "state")),
    pending: new Map(),
    mcp: { call: vi.fn(async () => ({ modes: ["auto"] })) },
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("/run", () => {
  it("estimates a unique exact match and queues it for approval only", async () => {
    const f = await fixture();
    const result = await prepareRun(f, {
      argsText: "docs/plans/Phase-1-PLAN.md power",
      caller: { userId: "u1" },
      chatId: "c1",
    });
    expect(result.text).toContain("awaiting approval");
    expect(f.mcp.call).toHaveBeenCalledWith("forge_estimate_quorum", {
      planPath: path.join("docs", "plans", "Phase-1-PLAN.md"),
      path: f.project.repo.path,
    });
    const jobs = Object.values(currentJobs(f.store));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: "awaiting-approval", type: "plan", quorum: "power" });
  });

  it("reports no match and stores bounded selection callbacks for multiple matches", async () => {
    const f = await fixture(["Phase-1-PLAN.md", "Phase-2-PLAN.md"]);
    expect(await prepareRun(f, { args: ["not-a-plan"] })).toMatchObject({ text: expect.stringContaining("No plan found") });
    const result = await prepareRun(f, { args: ["Phase"], caller: { userId: "u1" }, chatId: "c1" });
    const id = result.keyboard.inline_keyboard[0][0].callback_data.split(":")[1];
    expect(f.pending.get(id)).toMatchObject({ callerId: "u1", projectId: "p1", chatId: "c1" });
    for (const row of result.keyboard.inline_keyboard) {
      for (const button of row) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64);
    }
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });

  it("fails explicitly when core services are missing or estimate is unavailable", async () => {
    const f = await fixture();
    expect(await prepareRun({}, { args: ["Plan"] })).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
    f.mcp.call.mockResolvedValueOnce({ isError: true });
    const rejectedEstimate = await prepareRun(f, { args: ["docs/plans/Phase-1-PLAN.md"] });
    expect(rejectedEstimate.text).toContain("ESTIMATE_UNAVAILABLE");
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    f.mcp.call.mockRejectedValueOnce(new Error("offline"));
    const result = await prepareRun(f, { args: ["docs/plans/Phase-1-PLAN.md"] });
    expect(result.text).toContain("ESTIMATE_UNAVAILABLE");
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });
});
