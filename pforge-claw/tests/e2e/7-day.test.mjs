import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_ID = "daily-digest";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

async function firedKeys(currentRig) {
  return (await currentRig.audit("schedule.fired"))
    .filter((row) => row.scheduleId === SCHEDULE_ID)
    .map((row) => row.key);
}

async function waitForFiredCount(currentRig, count, { timeoutMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const keys = await firedKeys(currentRig);
    if (keys.length >= count) return keys;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${count} digest runs; saw ${(await firedKeys(currentRig)).length}`);
}

describe("scenario (d) 7-day full-dispatcher scheduler persistence", () => {
  it("fires the daily digest once per day for 7 days across dispatcher restarts", async () => {
    const clock = createFakeClock("2026-01-01T07:30:00.000Z");
    rig = await createE2ERig({
      clock,
      schedulerTickMs: 10,
      schedules: [{ id: SCHEDULE_ID, kind: "digest", at: "daily 07:30" }],
    });
    expect(rig.handles.ctx.now).toBeTypeOf("function");
    expect(rig.handles.ctx.schedulerTickMs).toBe(10);

    for (let day = 1; day <= 7; day += 1) {
      if (day > 1) {
        clock.advance(DAY_MS);
        await rig.restart();
      }
      await waitForFiredCount(rig, day);
      // A same-day restart must not re-run the claimed slot (at-most-once, persisted state).
      await rig.restart();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await firedKeys(rig)).toHaveLength(day);
    }

    const keys = await firedKeys(rig);
    expect(new Set(keys).size).toBe(7);
  });
});
