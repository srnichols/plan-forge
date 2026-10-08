import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import { createBudgetService } from "../src/budget.mjs";
import { createDispatcher } from "../src/dispatcher.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];
const setupStores = [];

function makeStore() {
  const directory = mkdtempSync(path.join(tmpdir(), "claw-dispatcher-"));
  directories.push(directory);
  return createStore(directory);
}

function makeContext({ laneKind = "remote", registerLane = true, budgetConfig = {} } = {}) {
  const store = makeStore();
  const bus = new EventEmitter();
  const config = {
    timezone: "Etc/UTC",
    projects: [{ id: "project-1", homeLane: "worker" }],
    lanes: [{ id: "worker", kind: laneKind, enabled: true }],
    ...budgetConfig,
  };
  const lane = {
    id: "worker",
    kind: laneKind,
    capabilities: { jobTypes: ["task", "skill", "plan"], heavy: true },
    health: () => ({ ok: true, queued: 0 }),
    cancel: vi.fn(async () => ({ ok: true })),
    submit: vi.fn(),
  };
  const directory = createLaneDirectory();
  directory.configure(config.lanes);
  if (registerLane) directory.register(lane);
  const ctx = {
    store,
    bus,
    config,
    secrets: { redact: (value) => String(value) },
    logger: { error: vi.fn(), info: vi.fn() },
    projectRegistry: { byId: (id) => config.projects.find((project) => project.id === id) },
  };
  const approvals = createApprovalService({ store, bus });
  const budget = createBudgetService({ store, bus, config });
  setupStores.push({ store, bus, config, lane, directory, ctx, approvals, budget });
  return setupStores.at(-1);
}

function addJob(fixture, {
  id = "a0000001", type = "task", readOnly = false, state = "approved", quorum,
} = {}) {
  const created = createJob({
    id, type, projectId: "project-1", readOnly, parentId: null,
  });
  if (quorum) created.job.quorum = quorum;
  fixture.store.append(JOBS_STREAM, created.event);
  let job = created.job;
  if (type !== "skill" || !readOnly) {
    job = transition(job, "awaiting-approval").job;
    fixture.store.append(JOBS_STREAM, transition(created.job, "awaiting-approval").event);
    if (state === "approved") {
      const approval = fixture.approvals.createApproval({
        ...job, chatId: "chat-1", callerId: "requester-1",
      });
      fixture.approvals.issue({ ...job, chatId: "chat-1", callerId: "requester-1" }, { approval });
      fixture.approvals.decide({
        payload: approval.approve.slice(2),
        caller: { role: "owner", userId: "owner-1" },
        chatId: "chat-1",
        threadId: null,
      });
      job = currentJobs(fixture.store)[id];
    }
  }
  return currentJobs(fixture.store)[id] ?? job;
}

function appendJobTransition(fixture, jobId, to, meta = {}) {
  const job = currentJobs(fixture.store)[jobId];
  const result = transition(job, to, meta);
  fixture.store.append(JOBS_STREAM, result.event);
  fixture.bus.emit("job.transition", result.event);
  return result.job;
}

function makeEvent(jobId, type, data = {}, seq = 1) {
  return { v: 1, jobId, seq, ts: new Date().toISOString(), type, data };
}

function startDispatcher(fixture, options = {}) {
  const dispatcher = createDispatcher(fixture.ctx, {
    directory: fixture.directory,
    approvals: fixture.approvals,
    budget: fixture.budget,
    tickMs: 60_000,
    ...options,
  });
  return { dispatcher, start: () => dispatcher.start() };
}

async function flushJobs(predicate, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  expect(predicate()).toBe(true);
}

function transitionsFor(store, jobId) {
  return [...store.read(JOBS_STREAM)]
    .map(({ record }) => record)
    .filter((record) => record.kind === "job.transition" && record.jobId === jobId);
}

afterEach(() => {
  vi.useRealTimers();
  for (const { dispatcher } of setupStores.splice(0)) void dispatcher?.stop?.();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("dispatcher", () => {
  it("settles a remote job exactly once", async () => {
    const fixture = makeContext();
    addJob(fixture);
    fixture.lane.submit.mockImplementation(async function* (job) {
      yield makeEvent(job.id, "started");
      yield makeEvent(job.id, "finished", { status: "succeeded" }, 2);
    });
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await flushJobs(() => currentJobs(fixture.store).a0000001?.state === "succeeded");
    expect(transitionsFor(fixture.store, "a0000001").map((event) => event.to))
      .toEqual(["awaiting-approval", "approved", "leased", "running", "succeeded"]);
    await dispatcher.stop();
  });

  it("moves a held-budget job through the real budget gate", async () => {
    const fixture = makeContext({
      budgetConfig: { budget: { dailyUSD: 0 } },
    });
    addJob(fixture, { type: "plan" });
    fixture.budget.recordUsage({
      source: "ask", projectId: "project-1", jobId: "previous", usage: { costUSD: 1 },
    });
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    expect(currentJobs(fixture.store).a0000001.state).toBe("held-budget");
    expect(fixture.lane.submit).not.toHaveBeenCalled();
    await dispatcher.stop();
  });

  it("requires an approval proof for mutating jobs", async () => {
    const fresh = makeContext();
    const created = createJob({ id: "proofless", type: "task", projectId: "project-1" });
    fresh.store.append(JOBS_STREAM, created.event);
    const awaiting = transition(created.job, "awaiting-approval").job;
    fresh.store.append(JOBS_STREAM, transition(created.job, "awaiting-approval").event);
    fresh.store.append(JOBS_STREAM, transition(awaiting, "approved").event);
    const { dispatcher } = startDispatcher(fresh);
    await dispatcher.start();
    await dispatcher.sweep();
    expect(currentJobs(fresh.store).proofless.state).toBe("approved");
    expect(fresh.lane.submit).not.toHaveBeenCalled();
    expect([...fresh.store.read("audit")].map(({ record }) => record.reason))
      .toContain("approval-proof-missing");
    await dispatcher.stop();
  });

  it("accepts an explicit read-only proof and excludes non-dispatchable job types", async () => {
    const fixture = makeContext({ laneKind: "local" });
    addJob(fixture, { id: "readonly", type: "skill", readOnly: true, state: "queued" });
    const ask = createJob({ id: "ask-read", type: "ask", projectId: "project-1" });
    fixture.store.append(JOBS_STREAM, ask.event);
    fixture.lane.submit.mockImplementation(async function* (job) {
      appendJobTransition(fixture, job.id, "running");
      yield makeEvent(job.id, "started");
      appendJobTransition(fixture, job.id, "succeeded");
      yield makeEvent(job.id, "finished", { status: "succeeded" }, 2);
    });
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await flushJobs(() => currentJobs(fixture.store).readonly?.state === "succeeded");
    expect(fixture.lane.submit).toHaveBeenCalledOnce();
    expect(currentJobs(fixture.store)["ask-read"].state).toBe("queued");
    await dispatcher.stop();
  });

  it("fails leased and running work as orphaned after restart", async () => {
    const fixture = makeContext();
    for (const [id, state] of [["orphan-leased", "leased"], ["orphan-running", "running"]]) {
      const created = createJob({ id, type: "task", projectId: "project-1" });
      fixture.store.append(JOBS_STREAM, created.event);
      let job = transition(created.job, "awaiting-approval").job;
      fixture.store.append(JOBS_STREAM, transition(created.job, "awaiting-approval").event);
      job = transition(job, "approved").job;
      fixture.store.append(JOBS_STREAM, transition(
        transition(created.job, "awaiting-approval").job, "approved",
      ).event);
      job = transition(job, "leased", { lane: "worker" }).job;
      fixture.store.append(JOBS_STREAM, transition(
        currentJobs(fixture.store)[id], "leased", { lane: "worker" },
      ).event);
      if (state === "running") {
        fixture.store.append(JOBS_STREAM, transition(job, "running").event);
      }
    }
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    expect(currentJobs(fixture.store)["orphan-leased"]).toMatchObject({ state: "failed" });
    expect(currentJobs(fixture.store)["orphan-running"]).toMatchObject({ state: "failed" });
    expect([...fixture.store.read(JOBS_STREAM)].map(({ record }) => record.reason))
      .toContain("orphaned");
    await dispatcher.stop();
  });

  it("cancels a running job when the dispatcher stops", async () => {
    const fixture = makeContext();
    addJob(fixture);
    let finish;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    fixture.lane.submit.mockImplementation(async function* (job) {
      yield makeEvent(job.id, "started");
      markStarted();
      await new Promise((resolve) => { finish = resolve; });
      yield makeEvent(job.id, "finished", { status: "cancelled" }, 2);
    });
    fixture.lane.cancel.mockImplementation(async () => { finish?.(); return { ok: true }; });
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await started;
    await flushJobs(() => currentJobs(fixture.store).a0000001?.state === "running");
    await dispatcher.stop();
    expect(currentJobs(fixture.store).a0000001.state).toBe("cancelled");
  });

  it("sends terminal events out to the bus exactly once", async () => {
    const fixture = makeContext();
    addJob(fixture);
    fixture.lane.submit.mockImplementation(async function* (job) {
      yield makeEvent(job.id, "started");
      yield makeEvent(job.id, "finished", { status: "succeeded" }, 2);
    });
    const finished = [];
    const laneEvents = [];
    fixture.bus.on("job.finished", (event) => finished.push(event));
    fixture.bus.on("lane.event", (event) => laneEvents.push(event));
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await flushJobs(() => currentJobs(fixture.store).a0000001?.state === "succeeded");
    expect(finished.filter((event) => event.jobId === "a0000001")).toHaveLength(1);
    expect(laneEvents.filter((event) => event.jobId === "a0000001" && event.type === "finished")).toHaveLength(1);
    await dispatcher.stop();
  });

  it("passes a valid job quorum through dispatch", async () => {
    const fixture = makeContext();
    const job = addJob(fixture, { quorum: "power" });
    fixture.lane.submit.mockImplementation(async function* (submitted) {
      expect(submitted.quorum).toBe("power");
      yield makeEvent(submitted.id, "started");
      yield makeEvent(submitted.id, "finished", { status: "succeeded" }, 2);
    });
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await flushJobs(() => currentJobs(fixture.store)[job.id]?.state === "succeeded");
    await dispatcher.stop();
  });

  it("fails closed when the budget service is unavailable", async () => {
    const fixture = makeContext();
    addJob(fixture);
    const { dispatcher } = startDispatcher(fixture, { budget: null });
    await dispatcher.start();
    expect(currentJobs(fixture.store).a0000001.state).toBe("held-budget");
    expect([...fixture.store.read("audit")].map(({ record }) => record.reason))
      .toContain("budget-unavailable");
    await dispatcher.stop();
  });

  it("reports an unregistered configured lane as offline", async () => {
    const fixture = makeContext({ registerLane: false });
    addJob(fixture);
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    expect(currentJobs(fixture.store).a0000001.state).toBe("approved");
    expect(fixture.lane.submit).not.toHaveBeenCalled();
    expect([...fixture.store.read("audit")].map(({ record }) => record.reason))
      .toContain("NO_ELIGIBLE_LANE");
    await dispatcher.stop();
  });

  it("settles prepareLease failures and early stream endings", async () => {
    const fixture = makeContext();
    addJob(fixture, { id: "a0000002" });
    addJob(fixture, { id: "a0000003" });
    fixture.lane.prepareLease = vi.fn(async (job) => {
      if (job.id === "a0000002") throw Object.assign(new Error("no lease"), { code: "LEASE_FAILED" });
    });
    fixture.lane.submit.mockImplementation(async function* () {});
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await flushJobs(() => currentJobs(fixture.store).a0000002?.state === "failed"
      && currentJobs(fixture.store).a0000003?.state === "failed");
    expect(transitionsFor(fixture.store, "a0000002").at(-1).reason).toBe("LEASE_FAILED");
    expect(transitionsFor(fixture.store, "a0000003").at(-1).reason).toBe("lane-stream-ended");
    await dispatcher.stop();
  });

  it("settles remote artifacts and completion events into job state", async () => {
    const fixture = makeContext();
    addJob(fixture);
    fixture.lane.submit.mockImplementation(async function* (job) {
      yield makeEvent(job.id, "started");
      yield makeEvent(job.id, "artifact", {
        kind: "pr", branch: "claw/a0000001", url: "https://example.test/pull/1",
      }, 2);
      yield makeEvent(job.id, "finished", { status: "succeeded" }, 3);
    });
    const { dispatcher } = startDispatcher(fixture);
    await dispatcher.start();
    await flushJobs(() => currentJobs(fixture.store).a0000001?.state === "succeeded");
    expect(currentJobs(fixture.store).a0000001).toMatchObject({
      branch: "claw/a0000001", prUrl: "https://example.test/pull/1",
    });
    await dispatcher.stop();
  });

  it("settles timed-out shutdowns and fences late stream writes", async () => {
    const fixture = makeContext();
    addJob(fixture);
    let release;
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    fixture.lane.submit.mockImplementation(async function* (job) {
      yield makeEvent(job.id, "started");
      markStarted();
      await new Promise((resolve) => { release = resolve; });
      yield makeEvent(job.id, "finished", { status: "succeeded" }, 2);
    });
    const { dispatcher } = startDispatcher(fixture, { stopTimeoutMs: 5 });
    await dispatcher.start();
    await started;
    await dispatcher.stop();
    expect(currentJobs(fixture.store).a0000001.state).toBe("failed");
    expect(transitionsFor(fixture.store, "a0000001").at(-1).reason).toBe("dispatcher-stopped");
    release();
    await flushJobs(() => currentJobs(fixture.store).a0000001?.state === "failed");
    expect(currentJobs(fixture.store).a0000001.state).toBe("failed");
  });

  it("uses fake timers for the coalesced interval sweep", async () => {
    vi.useFakeTimers();
    const fixture = makeContext();
    const { dispatcher } = startDispatcher(fixture, { tickMs: 1000 });
    await dispatcher.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatcher.sweep()).toBeInstanceOf(Promise);
    await dispatcher.stop();
  });
});
