import { afterEach, describe, expect, it, vi } from "vitest";
import { createE2ERig } from "../helpers/e2e-rig.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";
import { bootDispatcher } from "../../src/cli/start.mjs";

let rig;

afterEach(async () => {
  await rig?.teardown();
  rig = null;
});

describe("real channel timing dependency", () => {
  it.each([[null], [{}], [[]], [{ now: () => 0 }], [{ sleep: async () => {} }]])(
    "rejects malformed composition timing %s before any project startup",
    async (telegramTiming) => {
      await expect(bootDispatcher({ telegramTiming })).rejects.toMatchObject({ code: "CHANNEL_TIMING_INVALID" });
    },
  );

  it("uses an advancing transport clock without advancing approval or budget time", async () => {
    const clock = createFakeClock();
    const initialDomainTime = clock.now().getTime();
    let transportTime = 0;
    const sleep = vi.fn(async (milliseconds) => { transportTime += milliseconds; });
    rig = await createE2ERig({
      clock,
      telegramTiming: { now: () => transportTime, sleep },
    });
    rig.send("/help", { topic: "101" });
    rig.send("/help", { topic: "101" });
    await rig.fakeTelegram.waitForCall("sendMessage", (_args, entry) =>
      rig.fakeTelegram.calls.filter(({ method }) => method === "sendMessage").indexOf(entry) >= 1);
    expect(sleep).toHaveBeenCalled();
    expect(sleep.mock.calls.every(([milliseconds]) => milliseconds >= 1000)).toBe(true);
    expect(clock.now().getTime()).toBe(initialDomainTime);
  });
});
