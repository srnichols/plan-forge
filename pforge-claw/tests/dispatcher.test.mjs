import { rmSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import { createBudgetService } from "../src/budget.mjs";
import { createDispatcher } from "../src/dispatcher.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createStore } from "../src/state/store.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createRunners } from "../src/jobs/runners.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createLeasePreparer, wrapPreparedLane } from "../src/jobs/lease-payload.mjs";
import { signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { applicationIdentity } from "../src/protocol/l2-ack.mjs";
import { encodeDeltaChunks } from "../src/memory/l2-sync.mjs";
import { onChildTerminal, onParentApproved, onParentTerminal, prepareFanout } from "../src/crossproject.mjs";
import { approveJob, g1Deferred, g1DirectorySync, runnerFixture } from "./g1-runner-fixture.mjs";

const directories = [];
const setupStores = [];

function makeStore() {
  const directory = g1DirectorySync("g1-dispatcher-");
  directories.push(directory);
  return createStore(directory);
}

function makeContext({ laneKind = "remote", registerLane = true, budgetConfig = {} } = {}) {
  const store = makeStore();
  const bus = new EventEmitter();
  const config = {
    timezone: "Etc/UTC",
    allowlist: [
      { channel: "telegram", userId: "requester-1", role: "owner" },
      { channel: "telegram", userId: "owner-1", role: "owner" },
    ],
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
  const approvals = createApprovalService({ store, bus, config });
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
  created.job = { ...created.job, callerId: "requester-1", callerRole: "owner",
    adapter: "telegram", chatId: "chat-1", threadId: null };
  created.event = { ...created.event, job: created.job };
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
  fixture.dispatcher = dispatcher;
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

const integrationFixtures = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const { dispatcher } of setupStores.splice(0)) await dispatcher?.stop?.();
  await Promise.all(integrationFixtures.splice(0).map((fixture) => fixture.cleanup()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function realDispatchFixture() {
  const f = await runnerFixture();
  integrationFixtures.push(f);
  const directory = createLaneDirectory();
  directory.configure(f.config.lanes);
  const lane = createLocalLane({
    id: "execution-host", bus: f.bus,
    runtime: { run: (job) => createRunners(f.ctx).runJob(job, { signal: job.signal, emit: job.emit }) },
  });
  directory.register(lane);
  const budget = createBudgetService({ store: f.store, bus: f.bus, config: f.config });
  return { ...f, directory, lane, budget };
}

function realDispatcher(f) {
  const dispatcher = createDispatcher(f.ctx, { directory: f.directory, budget: f.budget, tickMs: 60_000 });
  const cleanup = f.cleanup;
  f.cleanup = async () => { await dispatcher.stop(); await cleanup(); };
  integrationFixtures[integrationFixtures.length - 1].cleanup = f.cleanup;
  return dispatcher;
}

async function realFanout(f) {
  const deps = {
    config: f.config, store: f.store, bus: f.bus, budget: f.budget, approvals: f.approvals,
    caller: { channel: "telegram", userId: "requester-owner", role: "owner" },
    chatId: "chat", threadId: null, scope: "general", lanes: f.directory,
    secrets: f.ctx.secrets, channel: { id: "telegram", send: vi.fn(async () => ({ messageId: 1 })) },
  };
  const callback = (event) => {
    onParentApproved(deps, event);
    void onChildTerminal(deps, event);
    void onParentTerminal(deps, event);
  };
  f.bus.on("job.transition", callback);
  const receipt = await prepareFanout(deps, { argsText: "perform approved work -- project-1", updateId: "fanout-request" });
  const parent = currentJobs(f.store)[receipt.jobId];
  const approval = f.approvals.createApproval(parent);
  f.approvals.issue(parent, { approval });
  expect(await f.approvals.decide({
    payload: approval.approve.slice(2), caller: deps.caller, chatId: "chat", threadId: null,
  })).toMatchObject({ ok: true });
  return { deps, parentId: parent.id };
}

describe("G1 dispatcher final authority and family integration", () => {
  it("leases an explicitly approved scheduled skill through its actual configured owner channel", async () => {
    const f = await realDispatchFixture();
    const job = await approveJob(f, {
      id: "a9000001", type: "skill",
      fields: { adapter: "scheduler", updateId: "schedule:audit:slot-1", skill: "audit" },
    });
    const dispatcher = realDispatcher(f);
    await dispatcher.start();
    expect(transitionsFor(f.store, job.id).some(({ to }) => to === "leased")).toBe(true);
    expect(currentJobs(f.store)[job.id].adapter).toBe("scheduler");
  });

  it("rechecks the actual fallback lane runtime instead of a preferred BYOK lane", async () => {
    const f = await realDispatchFixture();
    f.config.allowlist[0].role = "approver";
    f.config.policy = { nonOwnerRuntime: "byok-only" };
    f.config.projects[0].placement = { prefer: ["preferred-byok", "execution-host"] };
    f.config.lanes.unshift({ id: "preferred-byok", kind: "remote", runtime: "byok:openai", enabled: true });
    f.config.lanes[1].runtime = "copilot-sdk";
    f.config.runtimes.byok = { openai: { keySecret: "PROVIDER_KEY", endpoint: "https://provider.example.test" } };
    const registry = createWorkerRegistry();
    f.directory.configure(f.config.lanes);
    f.directory.register(createRemoteLane({ id: "preferred-byok", registry }));
    const job = await approveJob(f, { id: "a2000001", fields: { callerRole: "owner" } });
    const dispatcher = realDispatcher(f);
    try {
      await dispatcher.start();
      expect(currentJobs(f.store)[job.id].state).toBe("approved");
      expect(f.ctx.runtime.run).not.toHaveBeenCalled();
      expect([...f.store.read("audit")].map(({ record }) => record.reason)).toContain("RUNTIME_POLICY_DENIED");
    } finally {
      registry.close();
    }
  });

  it.each(["missing", "invalid-key", "invalid-endpoint"])("denies non-owner BYOK with %s references before leasing", async (invalid) => {
    const f = await realDispatchFixture();
    f.config.allowlist[0].role = "approver";
    f.config.policy = { nonOwnerRuntime: "byok-only" };
    f.config.projects[0].runtime = "byok:openai";
    f.config.runtimes.byok = invalid === "missing" ? {} : {
      openai: {
        keySecret: invalid === "invalid-key" ? "bad key" : "PROVIDER_KEY",
        endpoint: invalid === "invalid-endpoint" ? "file:private" : "https://provider.example.test",
      },
    };
    const job = await approveJob(f, { id: { missing: "a2000002", "invalid-key": "a2000003", "invalid-endpoint": "a2000004" }[invalid] });
    const dispatcher = realDispatcher(f);
    await dispatcher.start();
    expect(currentJobs(f.store)[job.id].state).toBe("approved");
    expect(f.ctx.runtime.run).not.toHaveBeenCalled();
  });

  it.each(["runtime", "provider"])("never honors an unsigned stored %s override", async (field) => {
    const f = await realDispatchFixture();
    const value = field === "runtime" ? "openai" : { type: "openai", keySecret: "PROVIDER_KEY" };
    const job = await approveJob(f, { id: field === "runtime" ? "a2000005" : "a2000006", fields: { [field]: value } });
    const dispatcher = realDispatcher(f);
    await dispatcher.start();
    expect(currentJobs(f.store)[job.id].state).toBe("approved");
    expect(f.ctx.runtime.run).not.toHaveBeenCalled();
  });

  it("rejects arbitrary parentId references to a genuine consumed parent approval", async () => {
    const f = await realDispatchFixture();
    const { parentId } = await realFanout(f);
    const rogue = createJob({ id: "rogue-child", type: "task", projectId: "project-1", parentId });
    rogue.job = { ...rogue.job, callerId: "requester-owner", callerRole: "owner", adapter: "telegram",
      chatId: "chat", threadId: null, description: "unapproved additional work" };
    f.store.append("jobs", { ...rogue.event, job: rogue.job });
    let current = rogue.job;
    for (const to of ["awaiting-approval", "approved"]) {
      const updated = transition(current, to);
      f.store.append("jobs", updated.event);
      current = updated.job;
    }
    const dispatcher = realDispatcher(f);
    await dispatcher.start();
    await dispatcher.sweep();
    expect(currentJobs(f.store)[rogue.job.id].state).toBe("approved");
    expect(transitionsFor(f.store, rogue.job.id).some((event) => event.to === "leased")).toBe(false);
  });

  it("leases and settles the approved fanout parent only through the real dispatcher", async () => {
    const f = await realDispatchFixture();
    const { parentId, deps } = await realFanout(f);
    const dispatcher = realDispatcher(f);
    await dispatcher.start();
    await vi.waitFor(() => expect(currentJobs(f.store)[parentId].state).toBe("succeeded"));
    expect(transitionsFor(f.store, parentId).map((event) => event.to))
      .toEqual(["awaiting-approval", "approved", "leased", "running", "succeeded"]);
    for (const target of currentJobs(f.store)[parentId].targets) {
      expect(currentJobs(f.store)[target.childId].state).toBe("succeeded");
      expect(transitionsFor(f.store, target.childId).filter((event) => event.to === "leased")).toHaveLength(1);
    }
    await vi.waitFor(() => expect(deps.channel.send.mock.calls.filter(([payload]) => payload.text.startsWith("Fan-out")))
      .toHaveLength(1));
  });

  it("rechecks current caller authority after asynchronous lease preparation", async () => {
    const f = await realDispatchFixture();
    const job = await approveJob(f, { id: "a2000007" });
    const began = g1Deferred();
    const prepared = g1Deferred();
    f.lane.prepareLease = async () => { began.resolve(); await prepared.promise; };
    const dispatcher = realDispatcher(f);
    await dispatcher.start();
    await began.promise;
    f.config.allowlist[0].role = "viewer";
    prepared.resolve();
    await vi.waitFor(() => expect(currentJobs(f.store)[job.id].state).toBe("failed"));
    expect(f.ctx.runtime.run).not.toHaveBeenCalled();
  });

  it("forwards signed remote financial facts and the real terminal sequence after canonical ACK", async () => {
    const f = await realDispatchFixture();
    const remoteId = "remote-execution";
    const key = "fixture-remote-grant-key";
    const laneConfig = { id: remoteId, kind: "remote", enabled: true };
    f.config.lanes.push(laneConfig);
    f.config.projects[0].placement = { prefer: [remoteId] };
    f.config.projects[0].repo.remote = "https://example.test/project.git";
    f.directory.configure(f.config.lanes);
    const registry = createWorkerRegistry({
      requireL2: true, applyL2: f.ctx.l2Receiver.receive,
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key }),
    });
    const job = await approveJob(f, {
      id: "a2000008", type: "plan", fields: { planPath: path.join("docs", "plans", "Phase-1-PLAN.md") },
    });
    const actuals = {
      jobId: job.id, projectId: "project-1", runId: "remote-native-1", plan: "Phase-1-PLAN.md",
      endedAt: "2026-10-10T16:00:00.000Z", usage: { costUSD: 0.125, premiumRequests: null },
    };
    registry.connect("registered-executor", {
      laneId: remoteId, capabilities: { projects: ["project-1"] },
      send(packet) {
        if (packet.t === "lease") queueMicrotask(() => {
          verifyGrant({ grant: packet.grant, job: packet.job, subject: "registered-executor", laneId: remoteId, key });
          registry.onAck({ leaseId: packet.leaseId, attempt: packet.attempt, workerId: "registered-executor" });
          registry.onEvent({
            leaseId: packet.leaseId, attempt: packet.attempt, workerId: "registered-executor",
            event: makeEvent(job.id, "started", {}, 1),
          });
          const [chunk] = encodeDeltaChunks({
            deltaId: job.id, delta: { files: [], jsonl: { "openbrain-queue.jsonl": ['{"id":"remote-history"}\n'] }, maps: {} },
          });
          registry.onEvent({
            leaseId: packet.leaseId, attempt: packet.attempt, workerId: "registered-executor",
            event: makeEvent(job.id, "artifact", { ...chunk, jobId: job.id, projectId: "project-1" }, 2),
          });
        });
        if (packet.t === "l2-applied") queueMicrotask(() => registry.onEvent({
          leaseId: packet.leaseId, attempt: packet.attempt, workerId: "registered-executor",
          event: makeEvent(job.id, "finished", {
            status: "succeeded", l2: { ...applicationIdentity(packet), ok: packet.ok }, planActuals: actuals,
          }, 3),
        }));
      },
    });
    f.directory.register(wrapPreparedLane(createRemoteLane({ id: remoteId, registry }),
      createLeasePreparer({ ctx: f.ctx, laneConfig, directory: f.directory })));
    const finished = [];
    const terminals = [];
    f.bus.on("job.finished", (event) => { if (event.jobId === job.id) finished.push(event); });
    f.bus.on("lane.event", (event) => { if (event.jobId === job.id && event.type === "finished") terminals.push(event); });
    const dispatcher = realDispatcher(f);
    try {
      await dispatcher.start();
      await vi.waitFor(() => expect(currentJobs(f.store)[job.id].state).toBe("succeeded"));
      expect(finished).toHaveLength(1);
      expect(finished[0].planActuals).toEqual(actuals);
      expect(terminals).toHaveLength(1);
      expect(terminals[0].seq).toBe(3);
      expect(terminals[0].data.planActuals).toEqual(actuals);
      expect(Object.keys(transitionsFor(f.store, job.id).at(-1).result)).toEqual([]);
    } finally {
      registry.close();
    }
  });
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
