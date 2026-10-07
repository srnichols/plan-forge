import { describe, expect, it } from "vitest";
import { LANE_EVENT_TYPES } from "../src/enums.mjs";
import { assertLane } from "../src/lanes/lane.mjs";
import {
  createLocalLane,
  createSemaphore,
  isHeavyJob,
  resolveMaxHeavy,
} from "../src/lanes/local-lane.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function readEvents(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

function job(id, projectId, values = {}) {
  return { id, projectId, type: "ask", ...values };
}

describe("local lane contract and configuration", () => {
  it("passes the lane contract and resolves both configuration shapes", () => {
    expect(assertLane(createLocalLane({ runtime: { run: async () => ({}) } })).kind).toBe("local");
    expect(resolveMaxHeavy({})).toBe(2);
    expect(resolveMaxHeavy({ config: { lanes: { local: { maxHeavy: 3 } } } })).toBe(3);
    expect(resolveMaxHeavy({ config: { lanes: [{ kind: "local", maxHeavy: 4 }] } })).toBe(4);
    for (const maxHeavy of [0, -1, 1.5, "2"]) {
      expect(() => resolveMaxHeavy({ maxHeavy })).toThrow("LANE_BAD_CONFIG");
    }
    expect(() => resolveMaxHeavy({ config: { lanes: { local: { maxHeavy: null } } } }))
      .toThrow("LANE_BAD_CONFIG");
    expect(() => createSemaphore(0)).toThrow("LANE_BAD_CONFIG");
  });

  it("classifies heavy jobs from explicit flags before job type", () => {
    expect(isHeavyJob(job("read-job", "project-a", { type: "ask" }))).toBe(false);
    expect(isHeavyJob(job("forced-heavy", "project-a", { type: "ask", heavy: true }))).toBe(true);
    expect(isHeavyJob(job("mutating", "project-a", { mutating: true }))).toBe(true);
  });

  it("releases a permit once and removes aborted FIFO waiters", async () => {
    const semaphore = createSemaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire({ signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: "JOB_CANCELLED" });
    expect(semaphore.waiting).toBe(0);
    release();
    release();
    expect(semaphore.inUse).toBe(0);
  });
});

describe("local lane scheduling", () => {
  it("runs jobs in the same project in submission order", async () => {
    const order = [];
    let active = 0;
    let maximum = 0;
    const lane = createLocalLane({
      runtime: {
        run: async ({ jobId }) => {
          active += 1;
          maximum = Math.max(maximum, active);
          order.push(jobId);
          await Promise.resolve();
          active -= 1;
          return { ok: true, status: "succeeded" };
        },
      },
    });
    const first = lane.submit(job("first", "project-a"));
    const second = lane.submit(job("second", "project-a"));
    const [firstEvents, secondEvents] = await Promise.all([readEvents(first), readEvents(second)]);
    expect(order).toEqual(["first", "second"]);
    expect(maximum).toBe(1);
    expect(firstEvents.at(-1).type).toBe("finished");
    expect(secondEvents.at(-1).type).toBe("finished");
  });

  it("overlaps light jobs across projects", async () => {
    const started = deferred();
    const gate = deferred();
    let count = 0;
    const lane = createLocalLane({
      runtime: {
        run: async () => {
          count += 1;
          if (count === 2) started.resolve();
          await gate.promise;
          return { ok: true, status: "succeeded" };
        },
      },
    });
    const a = lane.submit(job("light-a", "project-a"));
    const b = lane.submit(job("light-b", "project-b"));
    await started.promise;
    gate.resolve();
    await Promise.all([readEvents(a), readEvents(b)]);
    expect(count).toBe(2);
  });

  it("limits heavy work while allowing light work through a full semaphore", async () => {
    const twoHeavyStarted = deferred();
    const lightStarted = deferred();
    const releaseHeavy = deferred();
    let heavyActive = 0;
    let maxHeavyActive = 0;
    const lane = createLocalLane({
      maxHeavy: 2,
      runtime: {
        run: async ({ id, heavy }) => {
          if (heavy) {
            heavyActive += 1;
            maxHeavyActive = Math.max(maxHeavyActive, heavyActive);
            if (heavyActive === 2) twoHeavyStarted.resolve();
            await releaseHeavy.promise;
            heavyActive -= 1;
          } else {
            lightStarted.resolve();
          }
          return { ok: true, status: "succeeded", usage: { id } };
        },
      },
    });
    const streams = [
      lane.submit(job("heavy-a", "project-a", { heavy: true })),
      lane.submit(job("heavy-b", "project-b", { heavy: true })),
      lane.submit(job("heavy-c", "project-c", { heavy: true })),
    ];
    await twoHeavyStarted.promise;
    expect(lane.health()).toMatchObject({ heavyInUse: 2, maxHeavy: 2 });
    const light = lane.submit(job("light", "project-light", { heavy: false }));
    await lightStarted.promise;
    releaseHeavy.resolve();
    await Promise.all([...streams, light].map(readEvents));
    expect(maxHeavyActive).toBe(2);
  });

  it("reports sequence, event types, one finish, and health counters", async () => {
    const started = deferred();
    const release = deferred();
    const lane = createLocalLane({
      runtime: {
        run: async ({ emit }) => {
          emit("progress", { text: "working" });
          started.resolve();
          await release.promise;
          return { ok: true, status: "succeeded", usage: { tokensIn: 1 } };
        },
      },
    });
    const stream = lane.submit(job("observed", "project-a", { heavy: true }));
    await started.promise;
    expect(lane.health()).toMatchObject({ queued: 0, running: 1, heavyInUse: 1 });
    release.resolve();
    const events = await readEvents(stream);
    expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events.every((event) => LANE_EVENT_TYPES.includes(event.type))).toBe(true);
    expect(events.at(-1).data).toMatchObject({ status: "succeeded", usage: { tokensIn: 1 } });
    expect(lane.health()).toMatchObject({ queued: 0, running: 0, heavyInUse: 0 });
  });
});

describe("local lane cancellation and failure handling", () => {
  it("cancels a queued job without invoking its runtime", async () => {
    const running = deferred();
    const release = deferred();
    const called = [];
    const lane = createLocalLane({
      runtime: {
        run: async ({ jobId }) => {
          called.push(jobId);
          if (jobId === "active") {
            running.resolve();
            await release.promise;
          }
          return { ok: true, status: "succeeded" };
        },
      },
    });
    const active = lane.submit(job("active", "project-a"));
    await running.promise;
    const queued = lane.submit(job("queued", "project-a"));
    expect(await lane.cancel("queued")).toEqual({ ok: true, state: "cancelled" });
    expect((await readEvents(queued)).filter((event) => event.type === "finished")).toHaveLength(1);
    release.resolve();
    await readEvents(active);
    expect(called).toEqual(["active"]);
  });

  it("cancels a heavy job waiting for a permit", async () => {
    const running = deferred();
    const release = deferred();
    const invoked = [];
    const lane = createLocalLane({
      maxHeavy: 1,
      runtime: {
        run: async ({ jobId }) => {
          invoked.push(jobId);
          running.resolve();
          await release.promise;
          return { ok: true, status: "succeeded" };
        },
      },
    });
    const first = lane.submit(job("permit-holder", "project-a", { heavy: true }));
    await running.promise;
    const waiting = lane.submit(job("permit-waiter", "project-b", { heavy: true }));
    expect(lane.health()).toMatchObject({ queued: 1, heavyInUse: 1 });
    expect(await lane.cancel("permit-waiter")).toMatchObject({ ok: true, state: "cancelling" });
    const waitingEvents = await readEvents(waiting);
    expect(waitingEvents.at(-1).data.status).toBe("cancelled");
    release.resolve();
    await readEvents(first);
    expect(invoked).toEqual(["permit-holder"]);
  });

  it("cancels running work and allows the next project job to proceed", async () => {
    const running = deferred();
    const nextStarted = deferred();
    const lane = createLocalLane({
      runtime: {
        run: async ({ jobId, signal }) => {
          if (jobId === "cancellable") {
            running.resolve();
            await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
            return { ok: false, status: "cancelled" };
          }
          nextStarted.resolve();
          return { ok: true, status: "succeeded" };
        },
      },
    });
    const first = lane.submit(job("cancellable", "project-a"));
    await running.promise;
    const second = lane.submit(job("after-cancel", "project-a"));
    expect(await lane.cancel("cancellable")).toEqual({ ok: true, state: "cancelling" });
    await nextStarted.promise;
    const [firstEvents, secondEvents] = await Promise.all([readEvents(first), readEvents(second)]);
    expect(firstEvents.at(-1).data.status).toBe("cancelled");
    expect(secondEvents.at(-1).data.status).toBe("succeeded");
    expect(await lane.cancel("not-known")).toEqual({ ok: false, error: "JOB_UNKNOWN" });
  });

  it("marks thrown runtime errors failed and unblocks the project", async () => {
    const lane = createLocalLane({
      runtime: {
        run: async ({ jobId }) => {
          if (jobId === "broken") throw new Error("private runtime text");
          return { ok: true, status: "succeeded" };
        },
      },
    });
    const failed = lane.submit(job("broken", "project-a"));
    const next = lane.submit(job("next", "project-a"));
    const [failedEvents, nextEvents] = await Promise.all([readEvents(failed), readEvents(next)]);
    expect(failedEvents.at(-1).data).toMatchObject({ status: "failed", error: "RUNTIME_FAILED" });
    expect(nextEvents.at(-1).data.status).toBe("succeeded");
  });

  it("cancels when a consumer breaks early and rejects duplicate in-flight ids", async () => {
    const running = deferred();
    const stopped = deferred();
    const lane = createLocalLane({
      runtime: {
        run: async ({ signal }) => {
          running.resolve();
          await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
          stopped.resolve();
          return { ok: false, status: "cancelled" };
        },
      },
    });
    const stream = lane.submit(job("early-exit", "project-a"));
    expect(() => lane.submit(job("early-exit", "project-b"))).toThrow("JOB_DUPLICATE");
    await running.promise;
    for await (const event of stream) {
      expect(event.type).toBe("started");
      break;
    }
    await stopped.promise;
    expect((await lane.cancel("early-exit"))).toEqual({ ok: false, error: "JOB_UNKNOWN" });
  });
});
