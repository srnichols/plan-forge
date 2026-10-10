import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { createK8sClient } from "../src/k8s/api.mjs";
import { assertLane } from "../src/lanes/lane.mjs";
import { buildJobSpec, createK8sJobLane as createLane, runPodJob, startPodMcp } from "../src/lanes/k8s-job-lane.mjs";
import { deriveJobKey } from "../src/protocol/lease-grant.mjs";
import { finalizePodJob } from "../src/lanes/k8s-job-lane.mjs";
import { encodeDeltaChunks } from "../src/memory/l2-sync.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { L2_APPLIED_MESSAGE } from "../src/protocol/messages.mjs";

const tempDirs = [];
const jobKey = "b".repeat(64);

function createK8sJobLane(options) {
  options.registry.registerPending ??= vi.fn();
  options.registry.revoke ??= vi.fn();
  return createLane({ jobKeyFor: () => jobKey, canDeriveJobKeys: () => true, ...options });
}

async function tempDirectory() {
  const dir = await mkdtemp(path.join(path.dirname(fileURLToPath(import.meta.url)), ".claw-k8s-lane-"));
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

function appliedEvent(jobId, seq) {
  return laneEvent(jobId, seq, "finished", {
    status: "succeeded",
    l2: { jobId, projectId: "project-one", deltaId: `${jobId}:fixture`, sha256Total: createHash("sha256").update(jobId).digest("hex"), ok: true },
  });
}

function fixtureCompletion(event) {
  return { ok: true, event, applicationAck: event.data.l2 };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Kubernetes Job specification", () => {
  it("does not let Kubernetes TTL garbage-collect the only undelivered history copy", () => {
    const spec = buildJobSpec(fixtureSpec({
      lane: { id: "jobs", kind: "k8s", k8s: { defaultImage: "worker:test", ttlSecondsAfterFinished: 5 } },
    }));
    expect(spec.spec).not.toHaveProperty("ttlSecondsAfterFinished");
    expect(spec.metadata.annotations).toMatchObject({ "pforge-claw/cleanup-after-ack-seconds": "5" });
  });

  it.each(["PFORGE_CLAW_WORKER_SECRET", "PFORGE_CLAW_K8S_LANE_SECRET", "CUSTOM_LANE_CREDENTIAL"])(
    "refuses a lane-wide credential in the pod environment: %s", (name) => {
      expect(() => buildJobSpec(fixtureSpec({
        lane: {
          id: "jobs", kind: "k8s",
          k8s: {
            defaultImage: "worker:test", laneSecret: "CUSTOM_LANE_CREDENTIAL",
            secrets: { env: { [name]: { name: "lane-authentication", key: "credential" } } },
          },
        },
      }))).toThrowError(expect.objectContaining({ code: "LANE_BAD_CONFIG" }));
    },
  );

  it("projects only signed bootstrap/provider secret references for a prepared Job", () => {
    const job = {
      id: "signed-secret-refs", projectId: "project-one", runtime: "azure",
      provider: { type: "azure", keySecret: "APP_AZURE_KEY", endpoint: "https://example.com/azure" },
      project: { id: "project-one", bootstrap: { copy: [], env: ["APP_ENV"], install: "none" } },
      leaseGrant: { v: 1 },
    };
    const spec = buildJobSpec(fixtureSpec({
      job,
      lane: {
        id: "jobs", kind: "k8s",
        k8s: {
          defaultImage: "worker:dev",
          secrets: { env: {
            APP_ENV: { name: "app-bootstrap", key: "value" },
            APP_AZURE_KEY: { name: "app-provider", key: "key" },
            UNRELATED_KEY: { name: "another-project", key: "key" },
          } },
        },
      },
    }));
    const env = spec.spec.template.spec.containers[0].env;
    expect(env).toEqual(expect.arrayContaining([
      { name: "APP_ENV", valueFrom: { secretKeyRef: { name: "app-bootstrap", key: "value" } } },
      { name: "APP_AZURE_KEY", valueFrom: { secretKeyRef: { name: "app-provider", key: "key" } } },
    ]));
    expect(env.some(({ name }) => name === "UNRELATED_KEY")).toBe(false);
    expect(JSON.stringify(spec)).not.toContain("apiKey");
    expect(JSON.stringify(spec)).not.toContain("another-project");
  });

  it.each(["bootstrap", "provider"])("refuses a missing signed %s Secret reference before creating a Job", (kind) => {
    const job = {
      id: "missing-secret-ref", projectId: "project-one", leaseGrant: { v: 1 },
      project: { id: "project-one", bootstrap: { copy: [], env: kind === "bootstrap" ? ["APP_ENV"] : [], install: "none" } },
      ...(kind === "provider" ? { provider: { type: "openai", keySecret: "APP_OPENAI_KEY" } } : {}),
    };
    expect(() => buildJobSpec(fixtureSpec({ job }))).toThrowError(expect.objectContaining({ code: "BOOTSTRAP_SECRET_MISSING" }));
  });
  it("keeps a writable job-local home on the work volume while the root filesystem is read-only", () => {
    const pod = buildJobSpec(fixtureSpec()).spec.template.spec;
    expect(pod.containers[0].securityContext.readOnlyRootFilesystem).toBe(true);
    expect(pod.containers[0].env).toContainEqual({ name: "HOME", value: "/work/home" });
    expect(pod.containers[0].env).toContainEqual({ name: "PFORGE_CLAW_HOME", value: "/work/claw" });
    expect(pod.containers[0].volumeMounts).toContainEqual({ name: "work", mountPath: "/work" });
    expect(pod.volumes).toContainEqual({ name: "work", emptyDir: {} });
  });
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
    });
    expect(spec.spec).not.toHaveProperty("ttlSecondsAfterFinished");
    expect(spec.metadata.annotations).toMatchObject({ "pforge-claw/cleanup-after-ack-seconds": "300" });
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
      readOnlyRootFilesystem: true,
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
  it("never exposes an arbitrary API reason in a structured error", async () => {
    const canary = "fixture-g4-api-reason-credential";
    const client = createK8sClient({
      host: "kubernetes",
      readFile: async (file) => path.basename(file) === "token" ? canary : Buffer.from("ca"),
      request: fakeRequest([response(403, JSON.stringify({ reason: canary }))]),
    });
    const error = await client.getJob("claw", "job-one").catch((failure) => failure);
    expect(error.code).toBe("K8S_API");
    expect(JSON.stringify(error).includes(canary)).toBe(false);
    expect(error.details.reason).toBe("forbidden");
  });

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
  it("starts successful pod cleanup only after the matching canonical ACK and configured retention", async () => {
    vi.useFakeTimers();
    const job = { id: "ack-fenced-cleanup", projectId: "project-one", type: "task" };
    const final = appliedEvent(job.id, 2);
    const registry = {
      enqueue: () => ({ iterator: asyncEvents([laneEvent(job.id, 1, "started"), final]) }),
      cancel: vi.fn(), completion: () => fixtureCompletion(final),
    };
    const api = { createJob: async () => ({}), getJob: vi.fn(), deleteJob: vi.fn(async () => ({})), watchJob: async function* watch() {} };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig({ ttlSecondsAfterFinished: 5 }), registry, api });
    const events = [];
    for await (const event of lane.submit(job)) events.push(event);
    expect(events.at(-1).data.status).toBe("succeeded");
    expect(api.deleteJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5001);
    expect(api.deleteJob).toHaveBeenCalledExactlyOnceWith("claw", "pforge-claw-ack-fenced-cleanup");
  });

  it("cancels a running pod without deleting its unacknowledged job-local history", async () => {
    const job = { id: "cancel-retains-history", projectId: "project-one", type: "task" };
    const release = Promise.withResolvers();
    const registry = {
      enqueue: () => ({ iterator: {
        async *[Symbol.asyncIterator]() {
          yield laneEvent(job.id, 1, "started");
          await release.promise;
          yield laneEvent(job.id, 2, "finished", { status: "cancelled" });
        },
      } }),
      cancel: vi.fn(async () => { release.resolve(); return { ok: true, state: "cancelling" }; }),
      completion: () => null,
    };
    const api = { createJob: async () => ({}), getJob: vi.fn(), deleteJob: vi.fn(), watchJob: async function* watch() {} };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), registry, api });
    const stream = lane.submit(job)[Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "started" } });
    const cancellation = await lane.cancel(job.id);
    expect(cancellation).toMatchObject({ ok: true, state: "cancelling" });
    expect(api.deleteJob).not.toHaveBeenCalled();
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "finished", data: { status: "cancelled" } } });
    await stream.return();
  });

  it("delivers a real canonical receiver ACK before accepting a K8s worker terminal success", async () => {
    const workdir = await tempDirectory();
    const config = appConfig();
    config.lanes.push({ id: "local", kind: "local" });
    config.projects[0].homeLane = "local";
    config.projects[0].repo.path = workdir;
    const receiver = createL2Receiver({ config, currentLaneId: "local" });
    const registry = createWorkerRegistry({ requireL2: true });
    registry.setL2Receiver(receiver.receive);
    const job = { id: "canonical-k8s-lane", projectId: "project-one", type: "task", mutating: true };
    const workerId = `job:${job.id}`;
    const leased = Promise.withResolvers();
    const applied = Promise.withResolvers();
    registry.connect(workerId, {
      laneId: "jobs", jobScope: { jobId: job.id }, capabilities: { projects: ["project-one"] },
      send: (packet) => {
        if (packet.t === "lease") leased.resolve(packet);
        if (packet.t === L2_APPLIED_MESSAGE) applied.resolve(packet);
      },
    });
    const lane = createK8sJobLane({
      id: "jobs", config, registry,
      api: { createJob: async () => ({}), getJob: vi.fn(), deleteJob: vi.fn(), watchJob: async function* watch() {} },
    });
    try {
      const collection = (async () => {
        const events = [];
        for await (const event of lane.submit(job)) events.push(event);
        return events;
      })();
      const lease = await leased.promise;
      const scope = { leaseId: lease.leaseId, attempt: lease.attempt, workerId };
      registry.onAck(scope);
      registry.onEvent({ ...scope, event: laneEvent(job.id, 1, "started") });
      const line = '{"id":"g4-canonical-byte-proof","text":"offline queue leftover"}';
      const delta = { files: [], jsonl: { "openbrain-queue.jsonl": [line] }, maps: {} };
      const [chunk] = encodeDeltaChunks({ delta, deltaId: `${job.id}:history` });
      registry.onEvent({ ...scope, event: laneEvent(job.id, 2, "artifact", chunk) });
      const wireAck = await applied.promise;
      const ack = { jobId: wireAck.jobId, projectId: wireAck.projectId, deltaId: wireAck.deltaId, sha256Total: wireAck.sha256Total, ok: wireAck.ok };
      expect(ack.ok).toBe(true);
      registry.onEvent({ ...scope, event: laneEvent(job.id, 3, "finished", { status: "succeeded", l2: ack }) });
      const events = await collection;
      expect(events.map(({ type }) => type)).toEqual(["started", "artifact", "finished"]);
      expect(events.at(-1).data.status).toBe("succeeded");
      expect(registry.completion(job.id).applicationAck).toEqual(ack);
      expect(await readFile(path.join(workdir, ".forge", "openbrain-queue.jsonl"), "utf8")).toBe(`${line}\n`);
    } finally {
      registry.close();
    }
  });

  it("refuses terminal success without canonical application proof even if the worker sent finished", async () => {
    const job = { id: "unconfirmed-success", projectId: "project-one", type: "task" };
    const registry = {
      enqueue: () => ({ iterator: asyncEvents([
        laneEvent(job.id, 1, "started"),
        laneEvent(job.id, 2, "finished", { status: "succeeded" }),
      ]) }),
      cancel: vi.fn(), completion: () => ({ ok: false, applicationAck: null }),
    };
    const lane = createK8sJobLane({
      id: "jobs", config: appConfig(), registry,
      api: { createJob: async () => ({}), getJob: vi.fn(), deleteJob: vi.fn(), watchJob: async function* watch() {} },
    });
    const events = [];
    for await (const event of lane.submit(job)) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "finished", data: { status: "failed", reason: "l2-sync-incomplete" },
    });
  });

  it("requires an explicit namespace matching provisioned RBAC instead of silently using default", () => {
    const config = appConfig();
    delete config.lanes[0].k8s.namespace;
    expect(() => createK8sJobLane({
      id: "jobs", config,
      api: { createJob: vi.fn(), getJob: vi.fn(), deleteJob: vi.fn(), watchJob: vi.fn() },
      registry: { enqueue: vi.fn(), cancel: vi.fn() },
    })).toThrowError(expect.objectContaining({ code: "LANE_BAD_CONFIG" }));
  });

  describe("pod finalization application acknowledgement", () => {
    const jobId = "g4-finalize";
    const projectId = "project-one";
    const delta = { files: [], jsonl: { "openbrain-queue.jsonl": ['{"id":"offline-leftover"}'] }, maps: {} };

    it("fails closed when application fails and never returns a secret-bearing transport exception", async () => {
      const stop = vi.fn();
      const canary = "fixture-g4-apply-error-secret";
      const result = await finalizePodJob({
        repoDir: await tempDirectory(), jobId, projectId,
        env: {}, runner: async () => ({ code: 1 }), startMcp: async () => ({ stop }),
        collectDelta: async () => delta, awaitAck: async () => { throw new Error(canary); },
        deadlineMs: 1000, now: () => 0,
      });
      expect(result).toEqual({ status: "failed", reason: "l2-sync-incomplete" });
      expect(stop).toHaveBeenCalledOnce();
      expect(JSON.stringify(result).includes(canary)).toBe(false);
    });

    it("does not return unexpected secret-bearing fields from an otherwise valid application ACK", async () => {
      const canary = "fixture-g4-ack-secret";
      const result = await finalizePodJob({
        repoDir: await tempDirectory(), jobId, projectId,
        env: {}, runner: async () => ({ code: 1 }), startMcp: async () => ({ stop: vi.fn() }),
        collectDelta: async () => delta,
        awaitAck: async ({ transfer }) => ({
          jobId: transfer.jobId, projectId: transfer.projectId, deltaId: transfer.deltaId,
          sha256Total: transfer.sha256Total, ok: true, token: canary,
        }),
        deadlineMs: 1000, now: () => 0,
      });
      expect(result.status).toBe("ok");
      expect(JSON.stringify(result).includes(canary)).toBe(false);
    });

    it.each([true, undefined, null, { lastSeq: 99 }, { ok: true }])(
      "never treats transport or missing acknowledgement %j as canonical application", async (ack) => {
        const stop = vi.fn();
        const result = await finalizePodJob({
          repoDir: await tempDirectory(), jobId, projectId,
          env: {}, runner: async () => ({ code: 1 }), startMcp: async () => ({ stop }),
          collectDelta: async () => delta, awaitAck: async () => ack, deadlineMs: 1000, now: () => 0,
        });
        expect(result).toEqual({ status: "failed", reason: "l2-sync-incomplete" });
        expect(stop).toHaveBeenCalledOnce();
      },
    );

    it("accepts only an identity-matching application ACK for the exact checksummed transfer", async () => {
      const stop = vi.fn();
      const ackTransfer = vi.fn(async ({ transfer }) => {
        expect(transfer.chunks).toEqual(encodeDeltaChunks({ delta, deltaId: transfer.deltaId }));
        return { jobId: transfer.jobId, projectId: transfer.projectId, deltaId: transfer.deltaId, sha256Total: transfer.sha256Total, ok: true };
      });
      const result = await finalizePodJob({
        repoDir: await tempDirectory(), jobId, projectId,
        env: {}, runner: async () => ({ code: 1 }), startMcp: async () => ({ stop }),
        collectDelta: async () => delta, awaitAck: ackTransfer, deadlineMs: 1000, now: () => 0,
      });
      expect(result.status).toBe("ok");
      expect(result.applicationAck).toMatchObject({ jobId, projectId, ok: true });
      expect(stop).toHaveBeenCalledOnce();
    });

    it.each(["jobId", "projectId", "deltaId", "sha256Total"])("rejects a positive ACK for another %s", async (field) => {
      const result = await finalizePodJob({
        repoDir: await tempDirectory(), jobId, projectId,
        env: {}, runner: async () => ({ code: 1 }), startMcp: async () => ({ stop: vi.fn() }),
        collectDelta: async () => delta,
        awaitAck: async ({ transfer }) => ({
          jobId: transfer?.jobId, projectId: transfer?.projectId, deltaId: transfer?.deltaId,
          sha256Total: transfer?.sha256Total, ok: true, [field]: field === "sha256Total" ? "a".repeat(64) : "another-identity",
        }),
        deadlineMs: 1000, now: () => 0,
      });
      expect(result).toEqual({ status: "failed", reason: "l2-sync-incomplete" });
    });
  });

  it.each(["registerPending", "revoke"])("validates the required job authentication lifecycle port %s", (missing) => {
    const registry = { enqueue: vi.fn(), cancel: vi.fn(), registerPending: vi.fn(), revoke: vi.fn() };
    delete registry[missing];
    expect(() => createLane({
      id: "jobs", config: appConfig(), registry,
      api: { createJob: vi.fn(), getJob: vi.fn(), deleteJob: vi.fn(), watchJob: vi.fn() },
    })).toThrowError(expect.objectContaining({ code: "LANE_BAD_CONFIG" }));
  });

  it("drains worker PR and history queued before a Kubernetes failure before emitting that failure", async () => {
    const job = { id: "watch-failure-fifo", projectId: "project-one", type: "task" };
    const artifacts = [
      laneEvent(job.id, 2, "artifact", { kind: "pr", url: "https://example.com/pr/2" }),
      laneEvent(job.id, 3, "artifact", { kind: "l2-delta", entries: [{ path: "audit.jsonl" }] }),
    ];
    const registry = {
      enqueue: () => ({ iterator: asyncEvents([
        laneEvent(job.id, 1, "started"), ...artifacts,
        laneEvent(job.id, 4, "finished", { status: "succeeded" }),
      ]) }),
      cancel: vi.fn(async () => ({ ok: true })),
    };
    const api = {
      createJob: vi.fn(async () => ({})), getJob: vi.fn(), deleteJob: vi.fn(),
      watchJob: async function* watch() {
        yield { type: "MODIFIED", object: { status: { conditions: [
          { type: "Failed", status: "True", reason: "DeadlineExceeded" },
        ] } } };
      },
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    const events = [];
    for await (const event of lane.submit(job)) events.push(event);
    expect(events.filter((event) => event.type === "artifact")).toEqual(artifacts);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(events.at(-1)).toMatchObject({
      type: "finished", data: { status: "failed", reason: "l2-sync-incomplete" },
    });
    expect(events.filter((event) => event.type === "finished")).toHaveLength(1);
  });

  it("fails a worker stream that ends without a final event after delivering its history", async () => {
    vi.useFakeTimers();
    const job = { id: "ended-stream", projectId: "project-one" };
    const releaseWatch = Promise.withResolvers();
    const registry = {
      enqueue: () => ({ iterator: asyncEvents([
        laneEvent(job.id, 1, "started"),
        laneEvent(job.id, 2, "artifact", { kind: "l2-delta", entries: [] }),
      ]) }),
      cancel: vi.fn(),
    };
    const api = {
      createJob: vi.fn(async () => ({})), getJob: vi.fn(), deleteJob: vi.fn(),
      watchJob: async function* watch() {
        await releaseWatch.promise;
        yield { type: "MODIFIED", object: { status: { conditions: [
          { type: "Failed", status: "True", reason: "DeadlineExceeded" },
        ] } } };
      },
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    const stream = lane.submit(job)[Symbol.asyncIterator]();
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "started" } });
    await expect(stream.next()).resolves.toMatchObject({ value: { type: "artifact" } });
    let final;
    const pending = stream.next().then((event) => { final = event; });
    await vi.advanceTimersByTimeAsync(1);
    try {
      expect(final).toMatchObject({
        value: { type: "finished", seq: 3, data: { status: "failed", reason: "l2-sync-incomplete" } },
      });
    } finally {
      releaseWatch.resolve();
      await pending;
      await stream.return();
    }
  });

  it("drains buffered PR and L2 artifacts before terminal success when the consumer pauses", async () => {
    const job = { id: "job-slow-consumer", projectId: "project-one", type: "task" };
    const release = Promise.withResolvers();
    const produced = Promise.withResolvers();
    const expected = [
      laneEvent(job.id, 1, "started"),
      laneEvent(job.id, 2, "artifact", { kind: "pr", url: "https://example.com/pr/1" }),
      laneEvent(job.id, 3, "artifact", { kind: "l2-delta", entries: [{ path: "audit.jsonl" }] }),
      appliedEvent(job.id, 4),
    ];
    let index = 0;
    const source = {
      async next() {
        if (index > 0) await release.promise;
        const event = expected[index++];
        if (event?.type === "finished") queueMicrotask(produced.resolve);
        return event ? { value: event, done: false } : { done: true };
      },
      return: vi.fn(async () => ({ done: true })),
      [Symbol.asyncIterator]() { return this; },
    };
    const registry = {
      enqueue: () => ({ iterator: source }),
      cancel: vi.fn(),
      revoke: vi.fn(),
      completion: () => fixtureCompletion(expected.at(-1)),
    };
    const api = {
      createJob: vi.fn(async () => ({})),
      getJob: vi.fn(),
      deleteJob: vi.fn(),
      watchJob: async function* watch() {},
    };
    const lane = createK8sJobLane({ id: "jobs", config: appConfig(), api, registry });
    const stream = lane.submit(job)[Symbol.asyncIterator]();
    const first = await stream.next();
    expect(first.value).toEqual(expected[0]);
    release.resolve();
    await produced.promise;
    await Promise.resolve();
    const received = [first.value];
    for await (const event of { [Symbol.asyncIterator]: () => stream }) received.push(event);
    expect(received).toEqual(expected);
    expect(received.filter((event) => event.type === "finished")).toHaveLength(1);
    expect(registry.revoke).toHaveBeenCalledExactlyOnceWith(job.id);
    expect(source.return).toHaveBeenCalledOnce();
    expect(lane.health().active).toBe(0);
  });
  it("retains an unknown job rather than deleting a possibly unacknowledged history copy", async () => {
    const deletion = vi.fn(async () => { throw new ClawError("K8S_API", { status: 404 }); });
    const lane = createK8sJobLane({
      id: "jobs", config: appConfig(), registry: { enqueue: vi.fn(), cancel: () => ({ ok: false, error: "JOB_UNKNOWN" }) },
      api: { createJob: vi.fn(), getJob: vi.fn(), watchJob: vi.fn(), deleteJob: deletion },
    });
    expect(await lane.cancel("unknown-job")).toMatchObject({ ok: true });
    expect(deletion).not.toHaveBeenCalled();
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
    const final = appliedEvent(job.id, 3);
    const registry = {
      enqueue: vi.fn(() => ({ iterator: asyncEvents([
        laneEvent(job.id, 1, "started"),
        laneEvent(job.id, 2, "progress"),
        laneEvent(job.id, 2, "progress", { duplicate: true }),
        final,
      ]) })),
      cancel: vi.fn(async () => ({ ok: true, state: "cancelling" })),
      snapshot: () => ({ byLane: { jobs: { connected: 1 } } }),
      completion: () => fixtureCompletion(final),
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
    const final = appliedEvent(job.id, 2);
    const registry = {
      enqueue: () => ({ iterator: asyncEvents([laneEvent(job.id, 1, "started"), final]) }),
      cancel: async () => ({ ok: true }),
      snapshot: () => ({ byLane: {} }),
      completion: () => fixtureCompletion(final),
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
    expect(await lane.cancel(job.id)).toEqual({ ok: true, state: "cancelling", historyRetained: true });
    expect(await lane.cancel(job.id)).toEqual({ ok: true, state: "cancelling", historyRetained: true });
  });

  it("retains running jobs on cancellation even when Kubernetes deletion would return 404 or 403", async () => {
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
    await expect(forbiddenLane.cancel("active-job")).resolves.toEqual({ ok: true, state: "cancelling", historyRetained: true });
    await forbiddenStream.return();
  });
});

describe("pod-side clone and bootstrap", () => {
  it("honors the supplied approved project's bootstrap choices over stale host defaults", async () => {
    const workdir = await tempDirectory();
    const job = {
      id: "approved-project-bootstrap", projectId: "project-one", quorum: "speed", resumeFrom: 2,
      project: Object.freeze({
        id: "project-one",
        repo: Object.freeze({ url: "https://example.com/approved.git", defaultBranch: "approved-base" }),
        models: Object.freeze({ work: "approved-work-model" }),
        bootstrap: Object.freeze({ copy: [], env: ["APP_ENV"], install: "none" }),
      }),
    };
    const runner = vi.fn(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.join(workdir, "repo"), { recursive: true });
      return { code: 0 };
    });
    const boot = await runPodJob({
      job, project: job.project, workdir, runner, requestCopySet: async () => [],
      config: { bootstrap: { copy: [], env: [], install: "ci" }, runtimes: { pforgeCommand: ["pforge"] } },
      secrets: { get: (name) => name === "APP_ENV" ? "fixture-approved-environment" : undefined },
    });
    expect(boot.ok).toBe(true);
    expect(runner.mock.calls.some(([, args]) => args.includes("ci"))).toBe(false);
    expect(boot.env.APP_ENV).toBe("fixture-approved-environment");
    expect(job.quorum).toBe("speed");
    expect(job.resumeFrom).toBe(2);
    expect(job.project.models.work).toBe("approved-work-model");
  });

  it("uses the supplied job-owned environment rather than inheriting dispatcher process values", async () => {
    const workdir = await tempDirectory();
    const preparedEnv = { G4_JOB_SCOPE: "fixture-only", GIT_AUTHOR_NAME: "Approved Job Author" };
    const runner = vi.fn(async () => ({ code: 1 }));
    await runPodJob({
      job: { id: "prepared-environment" },
      project: { repo: { url: "https://example.com/approved.git", defaultBranch: "main" } },
      env: preparedEnv, workdir, runner, requestCopySet: async () => [],
    });
    expect(runner.mock.calls[0][2].env.G4_JOB_SCOPE).toBe("fixture-only");
    expect(runner.mock.calls[0][2].env.GIT_AUTHOR_NAME).toBe("Approved Job Author");
    expect(preparedEnv).not.toHaveProperty("HOME");
  });

  it.each(["http://example.com/repo.git", "git://example.com/repo.git", "file:///repo", "ext::unexpected-helper", "repo-on-host"])(
    "refuses a non-HTTPS token-only clone before invoking Git: %s", async (remote) => {
      const runner = vi.fn();
      const boot = await runPodJob({
        job: { id: "unsupported-transport" },
        project: { repo: { remote, baseBranch: "main" } },
        requestCopySet: async () => [], runner, workdir: await tempDirectory(),
      });
      expect(boot).toMatchObject({ ok: false, reason: "bootstrap", code: "REMOTE_AUTH_UNSUPPORTED" });
      expect(runner).not.toHaveBeenCalled();
    },
  );

  it("honors a verified bootstrap install none instead of silently running npm ci", async () => {
    const workdir = await tempDirectory();
    const runner = vi.fn(async (command) => {
      if (command === "git") {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path.join(workdir, "repo"), { recursive: true });
      }
      return { code: 0 };
    });
    const result = await runPodJob({
      job: { id: "signed-install-choice" },
      project: { repo: { remote: "https://example.com/repo.git", baseBranch: "main" }, bootstrap: { copy: [] } },
      config: { bootstrap: { copy: [], env: [], install: "none" }, runtimes: { pforgeCommand: ["pforge"] } },
      requestCopySet: async () => [],
      runner,
      workdir,
    });
    expect(result.ok).toBe(true);
    expect(runner.mock.calls.map(([command]) => path.basename(command))).toEqual(["git", "git", "pforge"]);
    expect(runner.mock.calls.some(([, args]) => args.includes("ci"))).toBe(false);
  });

  it("gives the initial HTTPS clone isolated token-backed Git authentication and generic authors", async () => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GIT_AUTHOR_NAME", "");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "");
    vi.stubEnv("GIT_COMMITTER_NAME", "");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "");
    const workdir = await tempDirectory();
    const runner = vi.fn(async () => ({ code: 1 }));
    const token = "fixture-git-credential-canary";
    await runPodJob({
      job: { id: "authenticated-clone" },
      project: { repo: { remote: "https://example.com/repo.git", baseBranch: "main" } },
      workdir,
      secrets: { get: (name) => name === "PFORGE_CLAW_GH_TOKEN" ? token : undefined },
      requestCopySet: async () => [],
      runner,
    });
    const [command, args, options] = runner.mock.calls[0];
    expect(command).toBe("git");
    expect(options.env).toMatchObject({
      HOME: path.join(workdir, "home"),
      GH_TOKEN: token,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(workdir, "home", ".gitconfig"),
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "!gh auth git-credential",
      GIT_AUTHOR_NAME: "Forge-Claw",
      GIT_AUTHOR_EMAIL: "claw@localhost",
      GIT_COMMITTER_NAME: "Forge-Claw",
      GIT_COMMITTER_EMAIL: "claw@localhost",
    });
    expect(JSON.stringify(args)).not.toContain(token);
    expect(args).not.toContain("--global");
  });

  it("preserves configured author and committer identities in the clone environment", async () => {
    vi.stubEnv("GIT_AUTHOR_NAME", "Configured Author");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "author@example.com");
    vi.stubEnv("GIT_COMMITTER_NAME", "Configured Committer");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "committer@example.com");
    const runner = vi.fn(async () => ({ code: 1 }));
    await runPodJob({
      job: { id: "configured-author" },
      project: { repo: { remote: "https://example.com/repo.git", baseBranch: "main" } },
      workdir: await tempDirectory(),
      requestCopySet: async () => [],
      runner,
    });
    expect(runner.mock.calls[0][2].env).toMatchObject({
      GIT_AUTHOR_NAME: "Configured Author",
      GIT_AUTHOR_EMAIL: "author@example.com",
      GIT_COMMITTER_NAME: "Configured Committer",
      GIT_COMMITTER_EMAIL: "committer@example.com",
    });
  });

  it("refuses credentials in an HTTPS repository URL before invoking Git", async () => {
    const runner = vi.fn();
    await expect(runPodJob({
      job: { id: "embedded-credentials" },
      project: { repo: { remote: "https://user:fixture-credential@example.com/repo.git", baseBranch: "main" } },
      requestCopySet: async () => [],
      runner,
    })).resolves.toMatchObject({ ok: false, reason: "bootstrap", step: "clone", code: "REMOTE_AUTH_UNSUPPORTED" });
    expect(runner).not.toHaveBeenCalled();
  });

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

describe("pod-local MCP environment", () => {
  it("passes the prepared job environment to MCP without mutating the process environment", async () => {
    const preparedEnv = Object.freeze({ G4_JOB_SCOPE: "mcp-fixture" });
    const child = new EventEmitter();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn(() => { child.exitCode = 0; child.emit("exit", 0); });
    const spawnFn = vi.fn(() => child);
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 405 })));
    const mcp = await startPodMcp({
      repoDir: path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture-repo"),
      env: preparedEnv, spawnFn, now: () => 0, sleep: async () => {},
    });
    try {
      expect(spawnFn.mock.calls[0][2].env === preparedEnv).toBe(true);
      expect(process.env.G4_JOB_SCOPE).toBeUndefined();
    } finally {
      await mcp.stop();
    }
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
