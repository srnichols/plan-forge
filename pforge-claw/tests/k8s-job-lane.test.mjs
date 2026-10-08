import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { createK8sClient } from "../src/k8s/api.mjs";
import { assertLane } from "../src/lanes/lane.mjs";
import { buildJobSpec, createK8sJobLane as createLane, runPodJob } from "../src/lanes/k8s-job-lane.mjs";
import { deriveJobKey } from "../src/protocol/lease-grant.mjs";

const tempDirs = [];
const jobKey = "b".repeat(64);

function createK8sJobLane(options) {
  options.registry.registerPending ??= vi.fn();
  options.registry.revoke ??= vi.fn();
  return createLane({ jobKeyFor: () => jobKey, canDeriveJobKeys: () => true, ...options });
}

async function tempDirectory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claw-k8s-lane-"));
  tempDirs.push(dir);
  return dir;
}

function response(statusCode, body = "") {
  if (body && typeof body !== "string" && Symbol.asyncIterator in body) {
    body.statusCode = statusCode;
    body.headers = {};
    return body;
  }
  const result = new EventEmitter();
  result.statusCode = statusCode;
  result.headers = {};
  result.pipe = undefined;
  result.deliver = () => process.nextTick(() => {
    if (body) result.emit("data", Buffer.from(String(body)));
    result.emit("end");
  });
  return result;
}

function fakeRequest(responses, optionsLog = []) {
  return (options, callback) => {
    optionsLog.push(options);
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = () => process.nextTick(() => {
      const res = responses.shift();
      callback(res);
      res.deliver?.();
    });
    req.destroy = () => {};
    return req;
  };
}

function fixtureSpec(overrides = {}) {
  const job = { id: "job-12345678901234567890", projectId: "project-one" };
  const project = { id: "project-one", repo: { remote: "https://example.com/repo.git", baseBranch: "main" } };
  const lane = { id: "jobs", kind: "k8s", k8s: { defaultImage: "example/worker:latest" } };
  return { job, project, lane, jobKey, dispatcherUrl: "https://dispatcher.example", ...overrides };
}

function appConfig(laneOverrides = {}, projectOverrides = {}) {
  return {
    lanes: [{ id: "jobs", kind: "k8s", k8s: { namespace: "claw", ...laneOverrides } }],
    projects: [{
      id: "project-one",
      image: "example/worker:latest",
      repo: { remote: "https://example.com/repo.git", baseBranch: "main" },
      ...projectOverrides,
    }],
    worker: { dispatcherUrl: "wss://dispatcher.example/claw/workers" },
  };
}

function asyncEvents(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

function laneEvent(jobId, seq, type, data = {}) {
  return { v: 1, jobId, seq, ts: new Date(0).toISOString(), type, data };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Kubernetes Job specification", () => {
  it("lane secret never appears in the Job spec", () => {
    const laneSecret = "fixture-lane-secret-canary";
    const derived = deriveJobKey({ laneSecret, laneId: "jobs", jobId: "job-1" });
    const spec = buildJobSpec(fixtureSpec({ jobKey: derived }));
    expect(JSON.stringify(spec)).not.toContain(laneSecret);
    expect(JSON.stringify(spec)).not.toContain("PFORGE_CLAW_WORKER_SECRET");
    expect(spec.spec.template.spec.containers[0].env.find((entry) => entry.name === "PFORGE_CLAW_JOB_KEY").value).toBe(derived);
  });
  it("renders credential-free specs for policy inspection but cannot submit an absent job key", async () => {
    const spec = buildJobSpec(fixtureSpec({ jobKey: undefined }));
    expect(spec.spec.template.spec.containers[0].env.some((entry) => entry.name === "PFORGE_CLAW_JOB_KEY")).toBe(false);
    const api = { createJob: vi.fn(), getJob: vi.fn(), deleteJob: vi.fn(), watchJob: vi.fn() };
    const lane = createK8sJobLane({
      id: "jobs", config: appConfig(), api, registry: { enqueue: vi.fn(), cancel: vi.fn() },
      jobKeyFor: () => undefined,
    });
    const events = [];
    for await (const event of lane.submit({ id: "j1", projectId: "project-one" })) events.push(event);
    expect(events.at(-1).data).toMatchObject({ status: "failed", error: "K8S_LANE_SECRET_MISSING" });
    expect(api.createJob).not.toHaveBeenCalled();
  });
  it("gives pods job key, lane id and deadline and refuses environment overrides", () => {
    const spec = buildJobSpec(fixtureSpec());
    expect(spec.spec.template.spec.containers[0].env).toEqual(expect.arrayContaining([
      { name: "PFORGE_CLAW_JOB_KEY", value: jobKey },
      { name: "PFORGE_CLAW_LANE_ID", value: "jobs" },
      { name: "PFORGE_CLAW_JOB_DEADLINE_SECONDS", value: "3600" },
    ]));
    for (const name of ["PFORGE_CLAW_JOB_ID", "PFORGE_CLAW_JOB_KEY", "PFORGE_CLAW_LANE_ID", "PFORGE_CLAW_JOB_DEADLINE_SECONDS", "PFORGE_CLAW_DISPATCHER_URL"]) {
      expect(() => buildJobSpec(fixtureSpec({
        lane: { id: "jobs", k8s: { defaultImage: "worker", secrets: { env: { [name]: { name: "fake", key: "fake" } } } } },
      }))).toThrowError(expect.objectContaining({ code: "LANE_BAD_CONFIG" }));
    }
  });
  it("applies security, resource, workspace, command, and secret invariants", () => {
    const spec = buildJobSpec(fixtureSpec({
      job: { id: "a".repeat(90), projectId: "project-one" },
      lane: {
        id: "jobs",
        kind: "k8s",
        k8s: {
          defaultImage: "example/worker:latest",
          deadlineSeconds: 1800,
          ttlSecondsAfterFinished: 300,
          repoCache: { claimName: "repo-reference" },
          resources: {
            requests: { cpu: "250m", memory: "512Mi" },
            limits: { cpu: "1", memory: "2Gi" },
          },
          secrets: { env: { OPENAI_API_KEY: { name: "api-keys", key: "openai" } } },
        },
      },
    }));
    const name = spec.metadata.name;
    const pod = spec.spec.template.spec;
    const container = pod.containers[0];
    expect(name).toHaveLength(63);
    expect(name).toMatch(/^[a-z0-9-]+$/);
    expect(name).not.toMatch(/-$/);
    expect(spec.spec).toMatchObject({
      backoffLimit: 0,
      activeDeadlineSeconds: 1800,
      ttlSecondsAfterFinished: 300,
    });
    expect(pod).toMatchObject({
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 10001,
        fsGroup: 10001,
        seccompProfile: { type: "RuntimeDefault" },
      },
    });
    expect(container.securityContext).toEqual({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    });
    expect(container.resources).toEqual({
      requests: { cpu: "250m", memory: "512Mi" },
      limits: { cpu: "1", memory: "2Gi" },
    });
    expect(container.command).toEqual(["pforge", "claw", "worker", "--one-shot", "--job", "a".repeat(90)]);
    expect(container).not.toHaveProperty("args");
    expect(container.env.find((entry) => entry.name === "PFORGE_CLAW_COPILOT_TOKEN")).toBeUndefined();
    expect(spec.apiVersion).toBe("batch/v1");
    for (const name of ["PFORGE_CLAW_GH_TOKEN", "OPENAI_API_KEY"]) {
      expect(container.env.find((entry) => entry.name === name)).toHaveProperty("valueFrom.secretKeyRef");
    }
    expect(container.env.find((entry) => entry.name === "PFORGE_CLAW_DISPATCHER_URL").value)
      .toBe("https://dispatcher.example");
    expect(container.env.find((entry) => entry.name === "HOME").value).toBe("/work/home");
    expect(pod.volumes.find((volume) => volume.name === "work")).toEqual({ name: "work", emptyDir: {} });
    expect(container.volumeMounts.find((mount) => mount.name === "repo-cache"))
      .toMatchObject({ mountPath: "/cache", readOnly: true });
  });

  it("uses configured Copilot secret and defaults, and rejects missing images", () => {
    const configured = buildJobSpec(fixtureSpec({
      lane: {
        id: "jobs", kind: "k8s",
        k8s: {
          defaultImage: "example/worker:latest",
          secrets: { copilot: { name: "copilot-auth", key: "pat" } },
        },
      },
    }));
    const env = configured.spec.template.spec.containers[0].env;
    expect(env.find((entry) => entry.name === "PFORGE_CLAW_COPILOT_TOKEN"))
      .toMatchObject({ valueFrom: { secretKeyRef: { name: "copilot-auth", key: "pat" } } });
    expect(env.find((entry) => entry.name === "PFORGE_CLAW_WORKER_SECRET")).toBeUndefined();
    let missingImageError;
    try {
      buildJobSpec(fixtureSpec({
        project: { id: "project-one" },
        lane: { id: "jobs", kind: "k8s", k8s: {} },
      }));
    } catch (error) {
      missingImageError = error;
    }
    expect(missingImageError).toMatchObject({ code: "K8S_NO_IMAGE" });
  });
});

describe("in-cluster Kubernetes API", () => {
  it("uses the namespace path, CA, bearer token, and re-reads the projected token", async () => {
    const requests = [];
    const values = ["tok-CANARY-123", "tok-CANARY-456"];
    const client = createK8sClient({
      host: "kubernetes",
      saDir: "/fake/serviceaccount",
      readFile: vi.fn(async (file) => file.endsWith("/token") ? values.shift() : Buffer.from("ca-data")),
      request: fakeRequest([response(201, "{\"metadata\":{\"name\":\"job\"}}"), response(200, "{}")], requests),
    });
    await client.createJob("claw", { kind: "Job" });
    await client.getJob("claw", "job-one");
    expect(requests[0].path).toBe("/apis/batch/v1/namespaces/claw/jobs");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.authorization).toBe("Bearer tok-CANARY-123");
    expect(requests[0].ca).toEqual(Buffer.from("ca-data"));
    expect(requests[1].headers.authorization).toBe("Bearer tok-CANARY-456");
  });

  it("deletes with background propagation and sanitizes API errors", async () => {
    const requests = [];
    const client = createK8sClient({
      host: "kubernetes",
      readFile: async (file) => file.endsWith("/token") ? "tok-CANARY-123" : Buffer.from("ca"),
      request: fakeRequest([
        response(200, "{}"),
        response(403, JSON.stringify({ reason: "forbidden", message: "tok-CANARY-123 leaked" })),
      ], requests),
    });
    await client.deleteJob("claw", "job-one");
    expect(requests[0].path).toContain("?propagationPolicy=Background");
    let capturedError;
    try {
      await client.getJob("claw", "job-one");
    } catch (error) {
      capturedError = error;
    }
    expect(JSON.stringify(capturedError)).not.toContain("tok-CANARY-123");
  });

  it("maps socket errors and parses a watch event split between chunks", async () => {
    const networkRequest = () => {
      const req = new EventEmitter();
      req.end = () => process.nextTick(() => req.emit("error", Object.assign(new Error("secret"), { code: "ECONNRESET" })));
      req.destroy = () => {};
      return req;
    };
    const networkClient = createK8sClient({
      host: "kubernetes",
      readFile: async (file) => file.endsWith("/token") ? "token" : Buffer.from("ca"),
      request: networkRequest,
    });
    await expect(networkClient.getJob("claw", "job-one")).rejects.toMatchObject({
      code: "K8S_NETWORK",
      details: { op: "get", code: "ECONNRESET" },
    });

    const event = JSON.stringify({ type: "MODIFIED", object: { metadata: { resourceVersion: "7" } } });
    const requests = [];
    const client = createK8sClient({
      host: "kubernetes",
      pollIntervalMs: 1,
      readFile: async (file) => file.endsWith("/token") ? "token" : Buffer.from("ca"),
      request: fakeRequest([response(200, Readable.from([event.slice(0, 12), event.slice(12), "\n"]))], requests),
    });
    const controller = new AbortController();
    const watcher = client.watchJob("claw", "job-one", { signal: controller.signal });
    await expect(watcher.next()).resolves.toMatchObject({
      value: { type: "MODIFIED", object: { metadata: { resourceVersion: "7" } } },
    });
    controller.abort();
    await watcher.return();
    expect(requests[0].path).toContain("fieldSelector=metadata.name%3Djob-one");
  });

  it("maps an unresponsive API request to a structured timeout", async () => {
    vi.useFakeTimers();
    const client = createK8sClient({
      host: "kubernetes",
      timeoutMs: 25,
      readFile: async (file) => file.endsWith("/token") ? "token" : Buffer.from("ca"),
      request: () => {
        const req = new EventEmitter();
        req.end = () => {};
        req.destroy = () => {};
        return req;
      },
    });
    const request = client.getJob("claw", "job-one");
    const assertion = expect(request).rejects.toMatchObject({
      code: "K8S_TIMEOUT",
      details: { op: "get" },
    });
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
  });

  it("recovers from a 410 watch event by re-reading the Job", async () => {
    let requestCount = 0;
    const client = createK8sClient({
      host: "kubernetes",
      readFile: async (file) => file.endsWith("/token") ? "token" : Buffer.from("ca"),
      request: (options, callback) => {
        requestCount += 1;
        const req = new EventEmitter();
        req.end = () => process.nextTick(() => {
          const res = requestCount === 1
            ? response(200, Readable.from([`${JSON.stringify({ type: "ERROR", object: { code: 410, reason: "Expired" } })}\n`]))
            : response(200, JSON.stringify({ metadata: { resourceVersion: "12" } }));
          callback(res);
          res.deliver?.();
        });
        req.destroy = () => {};
        return req;
      },
    });
    const controller = new AbortController();
    const watcher = client.watchJob("claw", "job-one", { signal: controller.signal });
    await expect(watcher.next()).resolves.toMatchObject({
      value: { type: "MODIFIED", object: { metadata: { resourceVersion: "12" } } },
    });
    controller.abort();
    await watcher.return();
    expect(requestCount).toBe(2);
  });

  it("falls back to polling after repeated empty watch connections", async () => {
    vi.useFakeTimers();
    let watchConnections = 0;
    const client = createK8sClient({
      host: "kubernetes",
      pollIntervalMs: 1,
      readFile: async (file) => file.endsWith("/token") ? "token" : Buffer.from("ca"),
      request: (options, callback) => {
        const req = new EventEmitter();
        req.end = () => process.nextTick(() => {
          if (options.path.includes("watch=true")) {
            watchConnections += 1;
            callback(response(200, Readable.from([])));
          } else {
            const res = response(200, JSON.stringify({ metadata: { resourceVersion: "poll-rv" } }));
            callback(res);
            res.deliver?.();
          }
        });
        req.destroy = () => {};
        return req;
      },
    });
    const controller = new AbortController();
    const watcher = client.watchJob("claw", "job-one", { signal: controller.signal });
    const next = watcher.next();
    await vi.advanceTimersByTimeAsync(20);
    await expect(next).resolves.toMatchObject({
      value: { type: "MODIFIED", object: { metadata: { resourceVersion: "poll-rv" } } },
    });
    controller.abort();
    await watcher.return();
    expect(watchConnections).toBe(3);
  });

  it("rejects invalid namespace and name segments", async () => {
    const client = createK8sClient({ host: "kubernetes" });
    await expect(client.getJob("bad/namespace", "job")).rejects.toMatchObject({ code: "K8S_BAD_INPUT" });
  });
});

describe("Kubernetes Job lane lifecycle", () => {
  it("deletes an unknown job by its derived name and treats 404 as success", async () => {
    const deletion = vi.fn(async () => { throw new ClawError("K8S_API", { status: 404 }); });
    const lane = createK8sJobLane({
      id: "jobs", config: appConfig(), registry: { enqueue: vi.fn(), cancel: () => ({ ok: false, error: "JOB_UNKNOWN" }) },
      api: { createJob: vi.fn(), getJob: vi.fn(), watchJob: vi.fn(), deleteJob: deletion },
    });
    expect(await lane.cancel("unknown-job")).toMatchObject({ ok: true });
    expect(deletion).toHaveBeenCalledWith("claw", "pforge-claw-unknown-job");
  });
  it("reports a missing lane secret while a provisioned idle lane is healthy", async () => {
    const options = {
      id: "jobs", config: appConfig(),
      registry: { enqueue: vi.fn(), cancel: vi.fn() },
      api: { createJob: vi.fn(), getJob: vi.fn(), watchJob: vi.fn(), deleteJob: vi.fn() },
    };
    const missing = createK8sJobLane({ ...options, canDeriveJobKeys: () => false });
    expect(missing.health()).toMatchObject({ ok: false, code: "K8S_LANE_SECRET_MISSING" });
    const events = [];
    for await (const event of missing.submit({ id: "j1" })) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0].data.error).toBe("K8S_LANE_SECRET_MISSING");
    expect(createK8sJobLane(options).health().ok).toBe(true);
  });
  it("pre-registers job authentication before create and rolls it back when create fails", async () => {
    const order = [];
    const registry = {
      enqueue: vi.fn(), cancel: vi.fn(),
      registerPending: () => order.push("registered"),
      revoke: () => order.push("revoked"),
    };
    const lane = createK8sJobLane({
      id: "jobs", config: appConfig(), registry,
      api: {
        createJob: async () => { order.push("create"); throw new ClawError("K8S_API"); },
        deleteJob: vi.fn(), getJob: vi.fn(), watchJob: vi.fn(),
      },
    });
    const events = [];
    for await (const event of lane.submit({ id: "j1", projectId: "project-one" })) events.push(event);
    expect(order).toEqual(["registered", "create", "revoked"]);
    expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
    expect(registry.enqueue).not.toHaveBeenCalled();
  });
  it("forwards worker events in order and emits one terminal event", async () => {
    const job = { id: "job-123", projectId: "project-one", type: "task" };
    const registry = {
      enqueue: vi.fn(() => ({ iterator: asyncEvents([
        laneEvent(job.id, 1, "started"),
        laneEvent(job.id, 2, "progress"),
        laneEvent(job.id, 2, "progress", { duplicate: true }),
        laneEvent(job.id, 3, "finished", { status: "succeeded" }),
      ]) })),
      cancel: vi.fn(async () => ({ ok: true, state: "cancelling" })),
      snapshot: () => ({ byLane: { jobs: { connected: 1 } } }),
    };
    const api = {
      createJob: vi.fn(async () => ({})),
      deleteJob: vi.fn(async () => ({})),
      getJob: vi.fn(),
      watchJob: vi.fn(async function* watch() {}),
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    expect(assertLane(lane)).toBe(lane);
    const events = [];
    for await (const event of lane.submit(job)) events.push(event);
    expect(api.createJob).toHaveBeenCalledOnce();
    expect(registry.enqueue).toHaveBeenCalledWith("jobs", { kind: "job", job });
    expect(events.map((event) => event.type)).toEqual(["started", "progress", "finished"]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
    expect(lane.health()).toMatchObject({ ok: true, kind: "k8s", id: "jobs", namespace: "claw", active: 0 });
  });

  it("turns create failures into one structured terminal event", async () => {
    const registry = {
      enqueue: vi.fn(),
      cancel: vi.fn(),
      snapshot: () => ({ byLane: {} }),
    };
    const lane = createK8sJobLane({
      id: "jobs",
      config: appConfig(),
      registry,
      api: {
        createJob: async () => { throw new ClawError("K8S_API", { status: 403, reason: "forbidden" }); },
        getJob: async () => ({}),
        deleteJob: async () => ({}),
        watchJob: async function* watch() {},
      },
    });
    const events = [];
    for await (const event of lane.submit({ id: "job-403", projectId: "project-one" })) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ status: "failed", error: "K8S_API", reason: "forbidden" });
    expect(registry.enqueue).not.toHaveBeenCalled();
  });

  it("fails failed Jobs with the correct deadline classification", async () => {
    const registry = {
      enqueue: () => ({
        iterator: {
          [Symbol.asyncIterator]() {
            let resolveNext;
            return {
              next: () => new Promise((resolve) => { resolveNext = resolve; }),
              return: async () => {
                resolveNext?.({ done: true });
                return { done: true };
              },
            };
          },
        },
      }),
      cancel: async () => ({ ok: true }),
      snapshot: () => ({ byLane: {} }),
    };
    const api = {
      createJob: async () => ({}),
      getJob: async () => ({}),
      deleteJob: async () => ({}),
      watchJob: async function* watch() {
        yield { type: "MODIFIED", object: { status: { conditions: [
          { type: "Failed", status: "True", reason: "DeadlineExceeded" },
        ] } } };
      },
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    const events = [];
    for await (const event of lane.submit({ id: "job-deadline", projectId: "project-one" })) events.push(event);
    expect(events.at(-1).data).toEqual({ status: "failed", reason: "deadline" });
  });

  it("waits briefly for a worker final event after Kubernetes reports completion", async () => {
    vi.useFakeTimers();
    const job = { id: "job-no-final", projectId: "project-one" };
    let signalCompleteCondition;
    const completeConditionObserved = new Promise((resolve) => { signalCompleteCondition = resolve; });
    const registry = {
      enqueue: () => ({
        iterator: {
          [Symbol.asyncIterator]() {
            let resolveNext;
            let sentStarted = false;
            return {
              next: () => {
                if (!sentStarted) {
                  sentStarted = true;
                  return Promise.resolve({ value: laneEvent(job.id, 1, "started"), done: false });
                }
                return new Promise((resolve) => { resolveNext = resolve; });
              },
              return: async () => {
                resolveNext?.({ done: true });
                return { done: true };
              },
            };
          },
        },
      }),
      cancel: async () => ({ ok: true }),
      snapshot: () => ({ byLane: {} }),
    };
    const api = {
      createJob: async () => ({}),
      getJob: async () => ({}),
      deleteJob: async () => ({}),
      watchJob: async function* watch() {
        signalCompleteCondition();
        yield { type: "MODIFIED", object: { status: { conditions: [
          { type: "Complete", status: "True" },
        ] } } };
      },
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    const stream = lane.submit(job)[Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "started" } });
    const finalEvent = stream.next();
    await completeConditionObserved;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(finalEvent).resolves.toMatchObject({
      value: { type: "finished", data: { status: "failed", reason: "no-final-event" } },
    });
    await stream.return();
  });

  it("uses a single terminal guard and treats owned 409 Jobs as adoptable", async () => {
    const job = { id: "already-created", projectId: "project-one" };
    const registry = {
      enqueue: () => ({ iterator: asyncEvents([laneEvent(job.id, 1, "started"), laneEvent(job.id, 2, "finished", { status: "succeeded" })]) }),
      cancel: async () => ({ ok: true }),
      snapshot: () => ({ byLane: {} }),
    };
    const api = {
      createJob: async () => { throw new ClawError("K8S_API", { status: 409, reason: "conflict" }); },
      getJob: async () => ({ metadata: { labels: { "pforge-claw/job-id": "already-created" } } }),
      deleteJob: async () => ({}),
      watchJob: async function* watch() {},
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    const events = [];
    for await (const event of lane.submit(job)) events.push(event);
    expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
    expect(events.at(-1).data.status).toBe("succeeded");
  });

  it("rejects a 409 Job owned by a different job id", async () => {
    const registry = {
      enqueue: vi.fn(),
      cancel: async () => ({ ok: true }),
      snapshot: () => ({ byLane: {} }),
    };
    const lane = createK8sJobLane({
      id: "jobs",
      config: appConfig(),
      registry,
      api: {
        createJob: async () => { throw new ClawError("K8S_API", { status: 409, reason: "conflict" }); },
        getJob: async () => ({ metadata: { labels: { "pforge-claw/job-id": "someone-else" } } }),
        deleteJob: async () => ({}),
        watchJob: async function* watch() {},
      },
    });
    const events = [];
    for await (const event of lane.submit({ id: "duplicate-job", projectId: "project-one" })) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ status: "failed", error: "JOB_DUPLICATE" });
    expect(registry.enqueue).not.toHaveBeenCalled();
  });

  it("deletes on a connection timeout and allows safe repeated cancellation", async () => {
    vi.useFakeTimers();
    const job = { id: "job-timeout", projectId: "project-one" };
    let wakeWorker;
    const registry = {
      enqueue: () => ({
        iterator: {
          [Symbol.asyncIterator]() {
            return {
              next: () => new Promise((resolve) => { wakeWorker = resolve; }),
              return: async () => {
                wakeWorker?.({ done: true });
                return { done: true };
              },
            };
          },
        },
      }),
      cancel: vi.fn(async () => ({ ok: false, error: "JOB_UNKNOWN" })),
      snapshot: () => ({ byLane: {} }),
    };
    const api = {
      createJob: async () => ({}),
      getJob: async () => ({}),
      deleteJob: vi.fn(async () => ({})),
      watchJob: async function* watch() { await new Promise(() => {}); },
    };
    const lane = createK8sJobLane({
      id: "jobs", config: appConfig(), api, registry, connectTimeoutMs: 50,
    });
    const stream = lane.submit(job)[Symbol.asyncIterator]();
    const first = stream.next();
    await vi.advanceTimersByTimeAsync(51);
    await expect(first).resolves.toMatchObject({
      value: { type: "finished", data: { status: "failed", reason: "worker-connect-timeout" } },
    });
    await stream.return();
    expect(api.deleteJob).toHaveBeenCalledOnce();
    expect(await lane.cancel(job.id)).toEqual({ ok: true, state: "cancelling" });
    expect(await lane.cancel(job.id)).toEqual({ ok: true, state: "cancelling" });
  });

  it("treats 404 deletion as already gone and returns authorization failures", async () => {
    const registry = {
      enqueue: () => ({
        iterator: {
          [Symbol.asyncIterator]() {
            let resolveNext;
            let sentStarted = false;
            return {
              next: () => {
                if (!sentStarted) {
                  sentStarted = true;
                  return Promise.resolve({ value: laneEvent("active-job", 1, "started"), done: false });
                }
                return new Promise((resolve) => { resolveNext = resolve; });
              },
              return: async () => {
                resolveNext?.({ done: true });
                return { done: true };
              },
            };
          },
        },
      }),
      cancel: async () => ({ ok: true, state: "cancelling" }),
      snapshot: () => ({ byLane: {} }),
    };
    const config = appConfig();
    const notFoundLane = createK8sJobLane({
      id: "jobs", config, registry,
      api: {
        createJob: async () => ({}),
        getJob: async () => ({}),
        deleteJob: async () => { throw new ClawError("K8S_API", { status: 404 }); },
        watchJob: async function* watch() {},
      },
    });
    const stream = notFoundLane.submit({ id: "active-job", projectId: "project-one" })[Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "started" } });
    expect(await notFoundLane.cancel("active-job")).toMatchObject({ ok: true, state: "cancelling" });
    await stream.return();

    const forbiddenLane = createK8sJobLane({
      id: "jobs", config, registry,
      api: {
        createJob: async () => ({}),
        getJob: async () => ({}),
        deleteJob: async () => { throw new ClawError("K8S_API", { status: 403 }); },
        watchJob: async function* watch() {},
      },
    });
    const forbiddenStream = forbiddenLane.submit({ id: "active-job", projectId: "project-one" })[Symbol.asyncIterator]();
    await expect(forbiddenStream.next()).resolves.toMatchObject({ value: { type: "started" } });
    await expect(forbiddenLane.cancel("active-job")).resolves.toEqual({ ok: false, error: "K8S_API" });
    await forbiddenStream.return();
  });
});

describe("pod-side clone and bootstrap", () => {
  it("clones, copies allowed files, installs, and runs smith in order", async () => {
    const workdir = await tempDirectory();
    const repoDir = path.join(workdir, "repo");
    const calls = [];
    const runner = async (command, args, options = {}) => {
      calls.push({ command, args, options });
      if (command === "git") {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(repoDir, { recursive: true });
      }
      return { code: 0, stdout: "", stderr: "" };
    };
    const result = await runPodJob({
      job: { id: "pod-job" },
      project: { repo: { remote: "https://example.com/repo.git", baseBranch: "main" } },
      config: { bootstrap: { copy: [".forge.json"] }, runtimes: { pforgeCommand: ["pforge"] } },
      requestCopySet: async (files) => {
        expect(files).toEqual([".forge.json"]);
        return [{ path: ".forge.json", content: Buffer.from("{\"v\":1}").toString("base64") }];
      },
      runner,
      workdir,
    });
    expect(result).toMatchObject({ ok: true, repoDir });
    expect(await readFile(path.join(repoDir, ".forge.json"), "utf8")).toBe("{\"v\":1}");
    expect(calls.map(({ command, args }) => [path.basename(command), args.at(-1)])).toEqual([
      ["git", repoDir],
      ["git", "claw/pod-job"],
      ["node.exe", "ci"],
      ["pforge", "smith"],
    ]);
    expect(calls[2].args[0]).toContain("npm-cli.js");
    expect(calls[0].args).toEqual(["clone", "--depth", "1", "--branch", "main", "--", "https://example.com/repo.git", repoDir]);
  });

  it.each(["../x", ".forge/secrets.json", "C:\\.forge\\secrets.json"])(
    "rejects unsafe copy paths %s",
    async (copyPath) => {
      const workdir = await tempDirectory();
      const runner = async (command) => {
        if (command === "git") {
          const { mkdir } = await import("node:fs/promises");
          await mkdir(path.join(workdir, "repo"), { recursive: true });
        }
        return { code: 0 };
      };
      await expect(runPodJob({
        job: { id: "pod-job" },
        project: { repo: { remote: "https://example.com/repo.git", baseBranch: "main" } },
        config: { bootstrap: { copy: [copyPath] } },
        requestCopySet: async () => [{ path: copyPath, content: "no" }],
        runner,
        workdir,
      })).resolves.toMatchObject({ ok: false, reason: "bootstrap", step: "copy" });
    },
  );

  it("reports smith failure as a bootstrap failure", async () => {
    const workdir = await tempDirectory();
    const runner = async (command, args) => {
      if (command === "git") {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path.join(workdir, "repo"), { recursive: true });
      }
      return { code: args.includes("smith") ? 1 : 0 };
    };
    await expect(runPodJob({
      job: { id: "pod-job" },
      project: { repo: { remote: "https://example.com/repo.git", baseBranch: "main" } },
      config: { bootstrap: { copy: [] }, runtimes: { pforgeCommand: ["pforge"] } },
      requestCopySet: async () => [],
      runner,
      workdir,
    })).resolves.toMatchObject({ ok: false, reason: "bootstrap", step: "smith" });
  });

  it("rejects token-only SSH remotes before invoking git", async () => {
    const runner = vi.fn();
    await expect(runPodJob({
      job: { id: "ssh-job" },
      project: { repo: { remote: "git@example.com:owner/repo.git", baseBranch: "main" } },
      requestCopySet: async () => [],
      runner,
    })).resolves.toMatchObject({ ok: false, code: "REMOTE_AUTH_UNSUPPORTED" });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe("Kubernetes lane source guards", () => {
  const apiSource = readFileSync(new URL("../src/k8s/api.mjs", import.meta.url), "utf8");
  const laneSource = readFileSync(new URL("../src/lanes/k8s-job-lane.mjs", import.meta.url), "utf8");

  it("uses no shell execution, pod log scraping, insecure TLS, or extra transport dependency", () => {
    for (const source of [apiSource, laneSource]) {
      expect(source).not.toMatch(/\bexec\s*\(/);
      expect(source).not.toMatch(/\/log|pods\/.*\/log/);
      expect(source).not.toContain("rejectUnauthorized");
      expect(source).not.toContain("undici");
    }
  });
});
