import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createDispatcher } from "../src/dispatcher.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { approveJob, drain, g1Deferred, runnerFixture } from "./g1-runner-fixture.mjs";

const fixtures = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.cleanup())); });

describe("G1 local cancellation ordering", () => {
  it("settles a submitted queued local job in the real dispatcher without running it", async () => {
    const f = await runnerFixture();
    fixtures.push(f);
    const first = await approveJob(f, { id: "a1000002" });
    const second = await approveJob(f, { id: "a1000003" });
    const gate = g1Deferred();
    const started = g1Deferred();
    const called = [];
    const terminal = [];
    f.bus.on("lane.event", (event) => {
      if (event.jobId === second.id && event.type === "finished") terminal.push(event);
    });
    const lane = createLocalLane({
      id: "execution-host", bus: f.bus,
      runtime: { run: async (job) => {
        called.push(job.id);
        started.resolve();
        await gate.promise;
        return { status: job.signal.aborted ? "cancelled" : "failed", error: "FIXTURE_STOP" };
      } },
    });
    const directory = createLaneDirectory();
    directory.configure(f.config.lanes);
    directory.register(lane);
    const dispatcher = createDispatcher(f.ctx, { directory, budget: { gate() {} }, tickMs: 60_000 });
    try {
      await dispatcher.start();
      await started.promise;
      expect(currentJobs(f.store)[second.id].state).toBe("leased");
      await lane.cancel(second.id);
      await vi.waitFor(() => expect(currentJobs(f.store)[second.id].state).toBe("cancelled"));
      expect(called).toEqual([first.id]);
      expect(terminal).toHaveLength(1);
    } finally {
      gate.resolve();
      await dispatcher.stop();
    }
  });

  it("does not invoke runtime after cancellation while the runtime factory is resolving", async () => {
    const factory = g1Deferred();
    const factoryStarted = g1Deferred();
    const run = vi.fn(async () => ({ status: "succeeded" }));
    const lane = createLocalLane({
      runtimeFor: async () => { factoryStarted.resolve(); return factory.promise; },
    });
    const stream = lane.submit({ id: "job-1", projectId: "project-1", type: "task" });
    const events = drain(stream);
    await factoryStarted.promise;
    const cancelling = lane.cancel("job-1");
    factory.resolve({ run });
    await cancelling;
    expect((await events).at(-1).data.status).toBe("cancelled");
    expect(run).not.toHaveBeenCalled();
  });

  it("awaits running cancellation and cleanup before reporting settlement or starting the next job", async () => {
    const started = g1Deferred();
    const cleanup = g1Deferred();
    const next = vi.fn();
    const lane = createLocalLane({
      runtime: { run: async ({ id, signal }) => {
        if (id === "next") { next(); return { status: "succeeded" }; }
        started.resolve();
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        await cleanup.promise;
        return { status: "cancelled" };
      } },
    });
    const first = drain(lane.submit({ id: "job-1", projectId: "project-1", type: "task" }));
    await started.promise;
    const second = drain(lane.submit({ id: "next", projectId: "project-1", type: "task" }));
    let settled = false;
    const cancelling = lane.cancel("job-1").then((result) => { settled = true; return result; });
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
    expect(settled).toBe(false);
    expect(next).not.toHaveBeenCalled();
    cleanup.resolve();
    expect(await cancelling).toMatchObject({ ok: true, state: "cancelled" });
    await Promise.all([first, second]);
    expect(next).toHaveBeenCalledOnce();
    expect(lane.health()).toMatchObject({ running: 0, queued: 0, heavyInUse: 0 });
  });

  it("bounds dispatcher shutdown even while a running lane awaits unconfirmed termination", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const f = await runnerFixture();
    fixtures.push(f);
    const job = await approveJob(f, { id: "a1000004" });
    const began = g1Deferred();
    const termination = g1Deferred();
    const lane = createLocalLane({
      id: "execution-host", bus: f.bus,
      runtime: { run: async ({ signal }) => {
        began.resolve();
        await termination.promise;
        return { status: signal.aborted ? "cancelled" : "succeeded" };
      } },
    });
    const directory = createLaneDirectory();
    directory.configure(f.config.lanes);
    directory.register(lane);
    const dispatcher = createDispatcher(f.ctx, {
      directory, budget: { gate() {} }, tickMs: 60_000, stopTimeoutMs: 1000,
    });
    await dispatcher.start();
    await began.promise;
    const stopping = dispatcher.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    expect(currentJobs(f.store)[job.id].state).toBe("failed");
    const prior = [...f.store.read("jobs")].map(({ record }) => record);
    termination.resolve();
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
    expect([...f.store.read("jobs")].map(({ record }) => record)).toEqual(prior);
    expect(lane.health()).toMatchObject({ queued: 0, running: 0 });
  });
});
