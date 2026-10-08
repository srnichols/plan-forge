import { afterEach, describe, expect, it } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

describe("scenario (d) 7-day full-dispatcher scheduler persistence", () => {
  it.fails("BLOCKER_REF S27-CLOCK-SEAM: bootDispatcher does not pass clock or scheduler tick into feature context", async () => {
    rig = await createE2ERig({
      clock: createFakeClock("2026-01-01T07:30:00.000Z"),
      schedulerTickMs: 10,
      schedules: [{ id: "daily-digest", kind: "digest", at: "daily 07:30" }],
    });
    await rig.restart();
    await rig.restart();

    expect(rig.handles.ctx.now).toBeTypeOf("function");
    expect(rig.handles.ctx.schedulerTickMs).toBe(10);
  });
});
