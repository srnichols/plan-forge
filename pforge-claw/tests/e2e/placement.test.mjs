import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

describe("scenario placement and lane opt-in", () => {
  it("keeps a Windows-required job waiting when worker-b is opted out", async () => {
    rig = await createE2ERig({
      projectOverrides: {
        "fixture-1": { placement: { prefer: ["worker-b"], requires: ["windows"] } },
      },
    });

    rig.send("/lane worker-b off");
    await expect.poll(() => rig.fakeTelegram.calls
      .filter(({ method }) => method === "sendMessage")
      .map(({ args }) => args.text)).not.toHaveLength(0);
    const laneMessages = rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage")
      .map(({ args }) => args.text);
    const laneReply = laneMessages.at(-1).replaceAll("\\", "");
    expect(laneReply).toContain("worker-b is off for new jobs.");
    expect(laneReply).toContain("Running jobs are not cancelled.");

    rig.send("/run docs/plans/Phase-1-DEMO-PLAN.md", { thread: "101" });
    const job = await rig.waitForJob((candidate) => candidate.type === "plan");
    await rig.tickApprovals();
    const approval = rig.cardFor("Approval required for plan job");
    expect(approval).not.toBeNull();
    const callback = approval.args.reply_markup.inline_keyboard[0][0].callback_data;
    await rig.tapCallback({
      data: callback,
      messageId: approval.result.message_id,
      topic: "101",
      user: "702",
    });

    await expect.poll(async () => (
      (await rig.auditRows("dispatcher.waiting"))
        .some((entry) => entry.jobId === job.id && entry.reason === "NO_ELIGIBLE_LANE")
    )).toBe(true);
    expect((await rig.jobs())[job.id].state).toBe("approved");
    expect([...rig.handles.store.read("jobs")]
      .filter(({ record }) => record.jobId === job.id && record.to === "leased")).toHaveLength(0);
  });
});
