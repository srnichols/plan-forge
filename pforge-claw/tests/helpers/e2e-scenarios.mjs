import { expect } from "vitest";

const OWNER_ID = "701";
const APPROVER_ID = "702";
const PROJECT_TOPIC = "101";
const PLAN_PATH = "docs/plans/Phase-1-DEMO-PLAN.md";

export async function runAwayFromDesk(rig) {
  rig.send("/ask What should I know about this plan?", {
    user: OWNER_ID,
    topic: PROJECT_TOPIC,
  });
  await expect.poll(async () => (
    (await rig.mcpCalls()).some(({ name }) => name === "forge_master_ask")
  )).toBe(true);

  rig.send(`/run ${PLAN_PATH}`, { user: OWNER_ID, topic: PROJECT_TOPIC });
  const job = await rig.waitForJob((candidate) => candidate.type === "plan", undefined);
  expect(job.state).toBe("awaiting-approval");
  await expect.poll(async () => (
    (await rig.mcpCalls()).some(({ name }) => name === "forge_estimate_quorum")
  )).toBe(true);
  await rig.tickApprovals();
  const estimateCard = rig.cardFor("Estimated cost:");
  expect(estimateCard).not.toBeNull();
  expect(await rig.prCalls()).toEqual([]);

  await rig.approveLatest(APPROVER_ID);
  const completedJob = await rig.waitForJob(job.id, "succeeded", { timeoutMs: 20_000 });
  await expect.poll(async () => (await rig.prCalls()).length).toBe(1);
  const finalMessage = rig.fakeTelegram.calls.findLast(({ method, args }) =>
    ["sendMessage", "editMessageText"].includes(method)
      && String(args.text).includes("https://example.test/pr/1"));

  return { job: completedJob, estimateCard, finalMessage };
}
