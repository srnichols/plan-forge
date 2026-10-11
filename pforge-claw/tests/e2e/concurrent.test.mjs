import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getBudgetService } from "../../src/budget.mjs";
import { createE2ERig } from "../helpers/e2e-rig.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";
import {
  createExecutionHome, createExecutionProbe, readPublishedFixture,
} from "../helpers/execution-evidence.mjs";
import { createScriptedCopilot } from "../helpers/scripted-copilot.mjs";

let rig;
let copilot;

const PROOF_FILE = "execution-proof.json";
const OWNER_ID = "701";
const APPROVER_ID = "702";
const CANARY = "execution-e2e-fixture-secret";
const INBOUND_WINDOW_MS = 60_000;

afterEach(async () => {
  copilot?.releaseAll();
  await rig?.teardown();
  rig = null;
  copilot = null;
});

async function createTask(projectId, description) {
  const project = rig.config.projects.find((entry) => entry.id === projectId);
  rig.send(`/task ${description}`, { thread: project.channel.topicId });
  const job = await rig.waitForJob((candidate) => candidate.type === "task"
    && candidate.projectId === projectId && candidate.description === description);
  copilot.hold(job.id);
  await rig.tickApprovals();
  return job;
}

function approveTask(job) {
  const card = rig.cardFor(`Approval required for task job ${job.id}`);
  expect(card).not.toBeNull();
  const button = card.args.reply_markup.inline_keyboard.flat()
    .find((entry) => entry.callback_data?.startsWith("a:"));
  rig.tapCallback(APPROVER_ID, button.callback_data, {
    chat: card.args.chat_id,
    thread: card.args.message_thread_id,
    messageId: card.result.message_id,
  });
}

function proofFor(window) {
  return JSON.stringify({ jobId: window.jobId, projectId: window.projectId });
}

async function waitForRunning(job) {
  try {
    return await rig.waitForJob(job.id, "running");
  } catch (error) {
    const current = (await rig.jobs())[job.id];
    const audit = (await rig.auditRows()).filter((record) => record.kind?.startsWith("budget-"))
      .map(({ kind, reason }) => ({ kind, reason }));
    throw new Error(`${error.message}; state=${current?.state}; budgetAudit=${JSON.stringify(audit)}`);
  }
}

async function writeProof(turn) {
  const target = path.join(turn.cwd, PROOF_FILE);
  expect(await turn.onPermissionRequest({ kind: "write", fileName: target })).toEqual({ kind: "approved" });
  expect(await turn.onPermissionRequest({
    kind: "write", fileName: path.join(turn.cwd, "..", "outside-job.json"),
  })).toMatchObject({ kind: "denied-by-rules" });
  expect(await turn.onPermissionRequest({
    kind: "shell", fullCommandText: "curl https://example.test",
  })).toMatchObject({ kind: "denied-by-rules" });
  await writeFile(target, proofFor({
    jobId: path.basename(turn.cwd), projectId: path.basename(path.dirname(turn.cwd)),
  }));
  turn.emit("progress", { message: CANARY });
}

describe("scenario concurrent job isolation", () => {
  it("runs three approved project jobs concurrently, owner-releases the budget hold, and isolates same-project work", async () => {
    const clock = createFakeClock();
    copilot = createScriptedCopilot({ beforeRun: writeProof });
    const probe = createExecutionProbe(copilot.runtime);
    rig = await createE2ERig({
      home: await createExecutionHome("concurrent"),
      clock,
      copilot,
      runtimeFactory: async ({ id }) => ({ ...probe.runtime, id }),
      secrets: { EXECUTION_E2E_CANARY: CANARY },
      budget: { dailyUSD: 10, dailyPremiumRequests: 20, maxUnknownPerDay: 0 },
      projectOverrides: {
        "fixture-3": { visibility: "normal", budget: { dailyUSD: 1, dailyPremiumRequests: 10 } },
      },
    });
    getBudgetService().recordUsage({
      source: "session", projectId: "fixture-3", jobId: "prior-reported-usage",
      usage: { costUSD: 2, premiumRequests: 1 }, at: clock.now().getTime(),
    });
    const first = await createTask("fixture-1", "execute first project");
    const second = await createTask("fixture-2", "execute second project");
    const third = await createTask("fixture-3", "execute budget-held project");
    expect(probe.windows).toEqual([]);
    expect(await rig.prCalls()).toEqual([]);

    approveTask(first);
    approveTask(second);
    approveTask(third);
    await Promise.all([waitForRunning(first), waitForRunning(second)]);
    await Promise.all([probe.entered(first.id), probe.entered(second.id)]);
    await rig.waitForJob(third.id, "held-budget");
    expect(probe.active.size).toBe(2);
    expect(probe.active.has(third.id)).toBe(false);
    const budgetCard = await rig.fakeTelegram.waitFor(({ method, args }) => method === "sendMessage"
      && args.reply_markup?.inline_keyboard?.flat().some((button) => button.callback_data?.startsWith("b:")));
    const override = budgetCard.args.reply_markup.inline_keyboard.flat()
      .find((button) => button.callback_data?.startsWith("b:"));
    rig.tapCallback(OWNER_ID, override.callback_data, {
      chat: budgetCard.args.chat_id, thread: budgetCard.args.message_thread_id,
      messageId: budgetCard.result.message_id,
    });
    await waitForRunning(third);
    await probe.entered(third.id);
    expect(probe.peakActive).toBe(3);
    expect(new Set([...probe.active.values()].map((entry) => entry.projectId)).size).toBe(3);
    expect(rig.handles.lanes.get("local").health()).toMatchObject({
      running: 3, heavyInUse: 3, maxHeavy: 3,
    });
    for (const window of probe.active.values()) {
      expect(window.cwd).toBe(path.join(rig.home, "worktrees", window.projectId, window.jobId));
      expect(rig.repos.some((project) => project.repoPath === window.cwd)).toBe(false);
      expect((await rig.jobs())[window.jobId]).toMatchObject({ state: "running", lane: "local" });
    }

    clock.advance(INBOUND_WINDOW_MS);
    const fourth = await createTask("fixture-1", "execute serialized project followup");
    approveTask(fourth);
    await rig.waitForJob(fourth.id, "leased");
    expect(rig.handles.lanes.get("local").health()).toMatchObject({ queued: 1, running: 3 });
    expect(probe.active.has(fourth.id)).toBe(false);
    copilot.release(first.id);
    await waitForRunning(fourth);
    await probe.entered(fourth.id);
    expect(probe.active.has(first.id)).toBe(false);
    expect(probe.peakActive).toBe(3);
    expect([...probe.projectPeaks.values()]).toEqual([1, 1, 1]);
    for (const job of [second, third, fourth]) copilot.release(job.id);
    const completed = await Promise.all([first, second, third, fourth]
      .map((job) => rig.waitForJob(job.id, "succeeded")));

    expect(await rig.prCalls()).toHaveLength(4);
    for (const job of completed) {
      expect(job).toMatchObject({ branch: `claw/${job.id}`, prUrl: expect.stringContaining("https://example.test/pr/") });
      const project = rig.repos.find((entry) => entry.id === job.projectId);
      const published = await readPublishedFixture({ project, jobId: job.id, relativePath: PROOF_FILE });
      expect(published).toBe(proofFor(probe.windows.find((entry) => entry.jobId === job.id)));
      const states = [...rig.handles.store.read("jobs")].map(({ record }) => record)
        .filter((record) => record.jobId === job.id && record.kind === "job.transition")
        .map((record) => record.to);
      expect(states).toEqual(job.id === third.id
        ? ["awaiting-approval", "approved", "held-budget", "approved", "leased", "running", "succeeded"]
        : ["awaiting-approval", "approved", "leased", "running", "succeeded"]);
    }
    expect(await rig.budgetRows()).toContainEqual(expect.objectContaining({
      kind: "override", jobId: third.id, approverId: OWNER_ID,
    }));
    expect(await rig.grepStateFor(CANARY)).toBe(false);
  });
});
