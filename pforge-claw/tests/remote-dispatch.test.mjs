import { EventEmitter, once } from "node:events";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createHttpServer } from "../src/http.mjs";
import { mac } from "../src/protocol/auth.mjs";
import { decode, encode, message } from "../src/protocol/messages.mjs";
import { buildLeaseGrant, deriveJobKey, signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { createLeasePreparer, proofFor, wrapPreparedLane } from "../src/jobs/lease-payload.mjs";
import { createDispatcher } from "../src/dispatcher.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createStore } from "../src/state/store.mjs";
import { createJob, currentJobs, transition } from "../src/jobs/model.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { g1Directory } from "./g1-runner-fixture.mjs";
import { createApprovalService } from "../src/approvals.mjs";
import { createBudgetService } from "../src/budget.mjs";
import { onChildTerminal, onParentApproved, onParentTerminal, prepareFanout } from "../src/crossproject.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { ROLES } from "../src/enums.mjs";

const cleanup = [];
const laneSecret = "fixture-lane-secret";
const workerSecret = "fixture-enrolled-worker-key";
const job = (id) => ({ id, projectId: "p1", type: "skill", skill: "check", mutating: false, runtime: "copilot-sdk" });
const keyFor = (laneId, jobId) => deriveJobKey({ laneSecret, laneId, jobId });
const grantFor = (payload, laneId = "pods") => buildLeaseGrant({
  leaseJob: payload, laneId, proof: { kind: "read-only", ref: null, decidedAt: null },
});

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function system(jobLanes = ["pods"]) {
  const registry = createWorkerRegistry({
    signLease: ({ worker, grant }) => signGrant({
      grant, subject: worker.id,
      key: worker.jobScope ? keyFor(worker.laneId, worker.jobScope.jobId) : workerSecret,
    }),
  });
  const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
  const server = createWorkerServer({
    registry,
    enrollment: {
      status: (id) => id === "w_remote" ? "active" : "unknown",
      worker: (id) => id === "w_remote" ? { status: "active", laneId: "remote" } : null,
    },
    secrets: { get: () => workerSecret }, allowedLanes: ["remote"], jobLanes, jobKeyFor: keyFor,
  });
  server.attach(http);
  const { port } = await http.listen();
  cleanup.push(async () => { server.close(); registry.close(); await http.close(); });
  return { registry, url: `ws://127.0.0.1:${port}/claw/workers` };
}

async function authenticate(url, { jobId = "j1", laneId = "pods", claimId = jobId, key = keyFor(laneId, jobId) } = {}) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const packet = decode(raw);
    if (waiters.length) waiters.shift()(packet);
    else messages.push(packet);
  });
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve) => waiters.push(resolve));
  const closed = once(socket, "close");
  cleanup.push(() => { socket.terminate(); });
  await once(socket, "open");
  socket.send(encode(message("hello", { mode: "job", laneId, jobId })));
  const challenge = await next();
  socket.send(encode(message("auth", { workerId: `job:${claimId}`, mac: mac(key, challenge.nonce, `job:${claimId}`) })));
  return { socket, next, closed };
}

describe("job-scoped remote dispatch", () => {
  it("cannot claim another job even with its own valid job key", async () => {
    const { registry, url } = await system();
    registry.registerPending("pods", "j1", { deadlineMs: Date.now() + 60_000 });
    const client = await authenticate(url, { claimId: "j2" });
    expect(await client.next()).toMatchObject({ t: "bye", reason: "WORKER_AUTH_FAILED" });
    expect((await client.closed)[0]).toBe(4401);
  });
  it("is refused for a different jobId or expired pending registration", async () => {
    const { registry, url } = await system();
    registry.registerPending("pods", "j1", { deadlineMs: Date.now() + 60_000 });
    const client = await authenticate(url, { jobId: "j2" });
    expect(await client.next()).toMatchObject({ reason: "WORKER_JOB_UNKNOWN" });
  });
  it("is refused after the job finished", async () => {
    const { registry, url } = await system();
    registry.registerPending("pods", "j1", { deadlineMs: Date.now() + 60_000 });
    registry.revoke("j1");
    const client = await authenticate(url);
    expect(await client.next()).toMatchObject({ reason: "WORKER_JOB_UNKNOWN" });
  });
  it("lets two job-scoped workers run in parallel and settles each exactly once", async () => {
    const { registry, url } = await system();
    const streams = [];
    for (const id of ["j1", "j2"]) {
      const payload = job(id);
      registry.registerPending("pods", id, { deadlineMs: Date.now() + 60_000 });
      streams.push(registry.enqueue("pods", { kind: "job", job: { ...payload, leaseGrant: grantFor(payload) } }).iterator);
    }
    const leases = [];
    for (const id of ["j1", "j2"]) {
      const client = await authenticate(url, { jobId: id });
      expect(await client.next()).toMatchObject({ t: "ready" });
      const lease = await client.next();
      verifyGrant({ grant: lease.grant, job: lease.job, subject: `job:${id}`, laneId: "pods", key: keyFor("pods", id) });
      leases.push(lease);
      client.socket.send(encode(message("event", {
        leaseId: lease.leaseId, attempt: lease.attempt,
        event: { v: 1, jobId: id, seq: 1, ts: new Date(0).toISOString(), type: "started", data: {} },
      })));
    }
    expect(registry.snapshot().byLane.pods.active).toBe(2);
    for (const [index, lease] of leases.entries()) {
      registry.onEvent({
        leaseId: lease.leaseId, attempt: lease.attempt, workerId: `job:${lease.job.id}`,
        event: { v: 1, jobId: lease.job.id, seq: 2, ts: new Date(0).toISOString(), type: "finished", data: { status: "succeeded" } },
      });
      const events = [];
      for await (const event of streams[index]) events.push(event);
      expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
      expect(registry.hasActiveJob("pods", lease.job.id)).toBe(false);
    }
  });
  it("copies bootstrap files but never secrets.json, and strips channel identities", async () => {
    const root = await g1Directory("g1-payload-");
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, ".forge"));
    await writeFile(path.join(root, ".forge.json"), "{}");
    await writeFile(path.join(root, ".forge", "fm-prefs.json"), "{}");
    await writeFile(path.join(root, ".forge", "secrets.json"), "fixture-private-secret");
    const store = createStore(path.join(root, "state"));
    const unlock = store.lock();
    cleanup.push(unlock);
    const ctx = {
      config: {
        allowlist: [{ channel: "telegram", userId: "owner", role: "owner" }],
        lanes: [{ id: "local", kind: "local" }, { id: "pods", kind: "k8s" }],
        projects: [{ id: "p1", homeLane: "local", repo: { path: root, remote: "https://example.test/repo", baseBranch: "main" } }],
      },
      store,
    };
    const prepare = createLeasePreparer({ ctx, laneConfig: { id: "pods", kind: "k8s" } });
    const created = createJob({ id: "j1", projectId: "p1", type: "skill", readOnly: true });
    const stored = {
      ...created.job, skill: "check", callerId: "owner", callerRole: "owner",
      adapter: "telegram", chatId: 1, threadId: 2,
    };
    store.append("jobs", { ...created.event, job: stored });
    const original = { ...stored, channel: { chatId: 1 } };
    const payload = await prepare(original);
    expect(payload.bootstrapFiles.map((file) => file.path)).toEqual([".forge.json", ".forge/fm-prefs.json"]);
    for (const field of ["callerId", "chatId", "threadId", "channel"]) expect(payload).not.toHaveProperty(field);
    expect(JSON.stringify(payload)).not.toContain("fixture-private-secret");
  });
  it.each([
    { role: ROLES[1], reason: "RUNTIME_POLICY_DENIED" },
    { role: ROLES[2], reason: "CALLER_NOT_ALLOWED" },
  ])("refuses disallowed $role execution before sending a raw job", async ({ role, reason }) => {
    const root = await g1Directory("g1-dispatch-grant-");
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const store = createStore(root);
    const config = {
      allowlist: [{ channel: "telegram", userId: "caller", role }],
      lanes: [{ id: "remote", kind: "remote", enabled: true }],
      projects: [{ id: "p1", homeLane: "remote", repo: { path: root }, lanes: ["remote"] }],
    };
    const created = createJob({ id: "j1", projectId: "p1", type: "skill", readOnly: true });
    store.append("jobs", { ...created.event, job: {
      ...created.job, callerId: "caller", callerRole: role, adapter: "telegram", skill: "check",
    } });
    if (role === ROLES[1]) {
      expect(proofFor({ config, store }, currentJobs(store).j1)).toEqual({
        kind: "read-only", ref: null, decidedAt: null,
      });
    }
    const directory = createLaneDirectory();
    directory.configure(config.lanes);
    directory.register(wrapPreparedLane({
      id: "remote", kind: "remote", capabilities: {}, health: () => ({ ok: true }),
      submit: () => { throw new Error("must not submit"); }, cancel: () => ({ ok: true }),
    }, createLeasePreparer({ ctx: { config, store }, laneConfig: config.lanes[0], directory })));
    const dispatcher = createDispatcher({ config, store, bus: new EventEmitter() }, {
      directory, budget: { check: async () => ({ ok: true }) },
    });
    await dispatcher.start();
    cleanup.push(() => dispatcher.stop());
    await dispatcher.sweep();
    expect(currentJobs(store).j1.state).toBe("queued");
    expect([...store.read("jobs")].filter(({ record }) => record.jobId === "j1" && record.to === "leased")).toHaveLength(0);
    expect([...store.read("audit")].map(({ record }) => record.reason)).toContain(reason);
  });
  it.each(["read-only", "consumed", "parent-consumed", "missing"])(
    "keeps preparer and dispatcher approval checks in parity and dispatches signed remote grants: %s",
    async (kind) => {
      const root = await g1Directory("g1-proof-parity-");
      cleanup.push(() => rm(root, { recursive: true, force: true }));
      const store = createStore(root);
      const config = {
        lanes: [{ id: "remote", kind: "remote" }],
        projects: [{ id: "p1", homeLane: "remote", repo: { path: root, remote: "https://example.test/project.git", baseBranch: "main" } }],
        allowlist: [{ channel: "telegram", userId: "owner", role: "owner" }],
      };
      const ctx = { config, store, bus: new EventEmitter() };
      const approvals = createApprovalService({ store, bus: ctx.bus, config });
      const budget = createBudgetService({ store, bus: ctx.bus, config });
      let jobId = "a3000001";
      let parentId = null;
      if (kind === "parent-consumed") {
        const deps = {
          ...ctx, approvals, budget, caller: { channel: "telegram", userId: "owner", role: "owner" },
          scope: "general", chatId: "99", threadId: 88,
          channel: { id: "telegram", send: async () => ({ messageId: 1 }) },
        };
        ctx.bus.on("job.transition", (event) => {
          onParentApproved(deps, event);
          void onChildTerminal(deps, event);
          void onParentTerminal(deps, event);
        });
        const receipt = await prepareFanout(deps, { argsText: "fixture -- p1", updateId: "fanout-wire" });
        parentId = receipt.jobId;
        jobId = currentJobs(store)[parentId].targets[0].childId;
      } else {
        const created = createJob({ id: jobId, projectId: "p1", type: kind === "read-only" ? "skill" : "task",
          readOnly: kind === "read-only" });
        store.append("jobs", { ...created.event, job: {
          ...created.job, callerId: "owner", callerRole: "owner", adapter: "telegram",
          description: "fixture", skill: "check", chatId: "99", threadId: 88,
        } });
        if (kind !== "read-only") store.append("jobs", transition(currentJobs(store)[jobId], "awaiting-approval").event);
      }
      if (kind !== "missing" && kind !== "read-only") {
        const approved = currentJobs(store)[parentId ?? jobId];
        const issued = approvals.createApproval(approved);
        approvals.issue(approved, { approval: issued });
        expect(await approvals.decide({
          payload: issued.approve.slice(2), caller: { userId: "owner", role: "owner" }, chatId: "99", threadId: 88,
        })).toMatchObject({ ok: true });
      } else if (kind === "missing") store.append("jobs", transition(currentJobs(store)[jobId], "approved").event);
      if (kind === "missing") expect(() => proofFor(ctx, currentJobs(store)[jobId])).toThrow();
      else expect(proofFor(ctx, currentJobs(store)[jobId]).kind).toBe(kind);
      const { registry, url } = await system();
      const received = [];
      const agent = createWorkerAgent({
        url, workerId: "w_remote", secret: workerSecret, laneId: "remote",
        capabilities: { os: "linux", arch: "x64", macos: false, toolchains: [], projects: ["p1"] },
        verifyLease: (leased) => {
          const { leaseGrant, ...plain } = leased;
          verifyGrant({ grant: leaseGrant, job: plain, subject: "w_remote", laneId: "remote", key: workerSecret });
        },
        localLane: createLocalLane({
          runtime: { run: async (leased) => {
            received.push(leased);
            return { status: "succeeded" };
          } },
        }),
      });
      cleanup.push(() => agent.stop());
      agent.start();
      await expect.poll(() => registry.snapshot().byLane.remote?.connected).toBe(1);
      const directory = createLaneDirectory();
      directory.configure(config.lanes);
      directory.register(wrapPreparedLane(createRemoteLane({ id: "remote", registry }),
        createLeasePreparer({ ctx, laneConfig: config.lanes[0], directory })));
      const dispatcher = createDispatcher(ctx, { directory, budget });
      cleanup.push(() => dispatcher.stop());
      await dispatcher.start();
      if (kind === "missing") {
        expect(currentJobs(store)[jobId].state).toBe("approved");
        expect(received).toEqual([]);
      } else {
        await expect.poll(() => currentJobs(store)[jobId].state).toBe("succeeded");
        expect(received).toHaveLength(1);
        expect(received[0].leaseGrant.approval.kind).toBe(kind);
        expect(received[0]).not.toHaveProperty("callerId");
        const transitions = [...store.read("jobs")].filter(({ record }) => record.to === "succeeded");
        expect(transitions.filter(({ record }) => record.jobId === jobId)).toHaveLength(1);
      }
    },
  );
});
