import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectPlan } from "../../src/callbacks/s.mjs";
import { currentJobs } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "claw-select-plan-"));
  directories.push(root);
  const repo = path.join(root, "repo");
  await mkdir(path.join(repo, "docs", "plans"), { recursive: true });
  await writeFile(path.join(repo, "docs", "plans", "Phase-1-PLAN.md"), "# plan");
  return {
    project: { id: "p1", repo: { path: repo } },
    store: createStore(path.join(root, "state")),
    pending: new Map([["short", {
      callerId: "u1",
      projectId: "p1",
      chatId: "c1",
      threadId: "t1",
      candidates: ["docs/plans/Phase-1-PLAN.md"],
      expiresAt: Date.now() + 60_000,
    }]]),
    mcp: { call: vi.fn(async () => ({ estimate: "tool-backed" })) },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("plan selection callback", () => {
  it("binds selections to caller/chat/thread and queues the selected path for approval", async () => {
    const f = await fixture();
    const result = await selectPlan(f, {
      payload: "short:0",
      caller: { userId: "u1" },
      chatId: "c1",
      threadId: "t1",
    });
    expect(result.text).toContain("awaiting approval");
    expect(f.pending.has("short")).toBe(false);
    expect(Object.values(currentJobs(f.store))[0]).toMatchObject({
      type: "plan", planPath: path.join("docs", "plans", "Phase-1-PLAN.md"), state: "awaiting-approval",
    });
  });

  it.each([
    [{ userId: "other" }, "c1", "t1", "not available"],
    [{ userId: "u1" }, "other", "t1", "not available"],
    [{ userId: "u1" }, "c1", "other", "not available"],
  ])("refuses tampered identities", async (caller, chatId, threadId, message) => {
    const f = await fixture();
    const result = await selectPlan(f, { payload: "short:0", caller, chatId, threadId });
    expect(result.text).toContain(message);
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });

  it("refuses stale selections and invalid candidate indexes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00.000Z"));
    const f = await fixture();
    f.pending.get("short").expiresAt = Date.now() - 1;
    const stale = await selectPlan(f, {
      payload: "short:0", caller: { userId: "u1" }, chatId: "c1", threadId: "t1",
    });
    expect(stale.text).toContain("expired");
    f.pending.get("short").expiresAt = Date.now() + 60_000;
    const tampered = await selectPlan(f, {
      payload: "short:5", caller: { userId: "u1" }, chatId: "c1", threadId: "t1",
    });
    expect(tampered.text).toContain("expired");
  });

  it("revalidates missing files and requires services", async () => {
    const f = await fixture();
    f.pending.get("short").candidates = ["docs/plans/removed-PLAN.md"];
    const result = await selectPlan(f, {
      payload: "short:0", caller: { userId: "u1" }, chatId: "c1", threadId: "t1",
    });
    expect(result.text).toContain("no longer available");
    expect(await selectPlan({}, {})).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE") });
  });
});
