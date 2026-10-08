import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

describe("scenario concurrent job isolation", () => {
  it.fails("BUG_REF S27-BLOCKER-CONCURRENT: task jobs need approval cards before concurrent dispatch", async () => {
    rig = await createE2ERig();
    rig.send("/task inspect fixture one", { thread: "101" });
    rig.send("/task inspect fixture two", { thread: "102" });
    await expect.poll(async () => Object.values(await rig.jobs())
      .filter((job) => job.type === "task")).toHaveLength(2);
    const jobs = Object.values(await rig.jobs()).filter((job) => job.type === "task");
    await rig.tickApprovals();
    expect(await rig.auditRows()).not.toContainEqual(expect.objectContaining({
      kind: "approval-card-skipped",
      reason: "missing-chat",
    }));
    expect(jobs.map((job) => job.chatId)).toEqual(["42", "42"]);
  });
});
