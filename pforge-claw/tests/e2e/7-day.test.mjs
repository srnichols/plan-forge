import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "../../src/scheduler.mjs";
import { createStore } from "../../src/state/store.mjs";
import { createFakeClock } from "../helpers/fake-clock.mjs";

let directory;

afterEach(async () => {
  vi.useRealTimers();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("scenario (d) seven-day scheduler persistence", () => {
  it("claims exactly one daily digest key across restarts on days two and five", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    const clock = createFakeClock("2026-01-01T07:30:00.000Z");
    vi.setSystemTime(clock.now());
    directory = await mkdtemp(path.join(os.tmpdir(), "claw-7-day-"));
    const store = createStore(directory);
    const keys = [];
    let scheduler;
    const openScheduler = async () => {
      scheduler = createScheduler({
        store,
        schedules: [{ id: "daily-digest", kind: "digest", at: "daily 07:30" }],
        timeZone: "Etc/UTC",
        now: () => clock.now().getTime(),
        run: async (_schedule, slot) => { keys.push(slot.key); },
      });
      await scheduler.start();
    };

    await openScheduler();
    for (let day = 2; day <= 7; day += 1) {
      clock.advance(24 * 60 * 60 * 1000);
      vi.setSystemTime(clock.now());
      if (day === 2 || day === 5) {
        await scheduler.stop();
        await openScheduler();
      } else {
        await scheduler.tick();
      }
    }
    await scheduler.stop();

    expect(keys).toEqual([
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
      "2026-01-05", "2026-01-06", "2026-01-07",
    ]);
    expect(store.readJson("schedules.json").schedules["daily-digest"].lastKey).toBe("2026-01-07");
    expect(new Set(keys).size).toBe(7);
  });
});
