import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_CA_ENV, materializeDevConfig } from "../scripts/k8s-e2e-overlay.mjs";
import { missingFixtureContracts, runK8sE2e, verifyScenarioEvidence } from "../scripts/k8s-e2e.mjs";
import { validateConfig } from "../src/config.mjs";
import { createK8sClient } from "../src/k8s/api.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { encodeDeltaChunks } from "../src/memory/l2-sync.mjs";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAMESPACE = "pforge-claw-e2e-fixture";
const CONTEXT = "kind-fixture";
const DISPATCHER_IMAGE = "registry.example/claw/dispatcher:test";
const WORKER_IMAGE = "registry.example/claw/worker:test";
const PROCESS_TIMEOUT_MS = 30_000;
const MAX_DIAGNOSTIC_BYTES = 4096;
const directories = [];
const running = [];
const edges = [];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function workspace() {
  const directory = await mkdtemp(path.join(PACKAGE_ROOT, "tests", ".k8s-fixture-"));
  directories.push(directory);
  return directory;
}

async function template() {
  return JSON.parse(await readFile(path.join(PACKAGE_ROOT, "deploy", "k8s", "overlays", "dev", "config.json"), "utf8"));
}

afterEach(async () => {
  for (const fixture of running.splice(0).reverse()) await fixture.stop();
  for (const edge of edges.splice(0)) await edge.drain();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Guard: Kubernetes fixture uses the real composition and protocol", () => {
  it("ships all required source contracts, not a substitute local rig", async () => {
    expect(await missingFixtureContracts({
      dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    })).toEqual([]);
    const dispatcher = await readFile(path.join(PACKAGE_ROOT, "tests", "helpers", "k8s-dispatcher.mjs"), "utf8");
    const worker = await readFile(path.join(PACKAGE_ROOT, "tests", "helpers", "k8s-worker.mjs"), "utf8");
    const scenario = await readFile(path.join(PACKAGE_ROOT, "tests", "helpers", "k8s-scenario.mjs"), "utf8");
    expect(dispatcher).toContain("bootDispatcher");
    expect(dispatcher).toContain("createL2Receiver");
    expect(worker).toContain("runOneShot");
    expect(worker).toContain("leasedJob");
    expect(worker).toContain("executionConfigFor");
    expect(scenario).toContain("completion");
    for (const source of [dispatcher, worker, scenario]) {
      expect(source).not.toMatch(/e2e-rig|createE2ERig|createK8sJobLane\s*\(|createDispatcher\s*\(|createStore\s*\(/);
      expect(source).not.toMatch(/process\.env\.[A-Z_]+\s*=|\bexecSync\b|\bexec\s*\(|shell:\s*true/);
    }
  });

  it.each(["dispatcher", "worker"])(
    "ships a reproducible test-only %s image target", async (target) => {
      const source = await readFile(path.join(PACKAGE_ROOT, "deploy", "Dockerfile.k8s-fixtures"), "utf8");
      expect(source).toContain("package-lock.json");
      expect(source).toContain("npm ci");
      expect(source).toContain("--ignore-scripts");
      expect(source).toMatch(/USER\s+10001:10001/);
      expect(source).toContain("k8s-");
      expect(source).toContain(`AS ${target}`);
      expect(source).not.toMatch(/npm install|:latest|\/tmp|\btsc\b/);
      expect(source).not.toContain("approve" + "All");
    },
  );

  it("materializes safe usable fixture paths, identities, runtime and worker references", async () => {
    const original = await template();
    const config = materializeDevConfig({
      namespace: NAMESPACE, workerImage: WORKER_IMAGE, template: original, context: CONTEXT,
    });
    expect(config.projects[0].repo.path).toBe("/data/fixtures/fixture-1");
    expect(config.projects[0].repo.forgeHome).toBe("/data/fixtures/fixture-1/.forge");
    expect(config.projects[0].repo.remote).toBe("https://example.com/fixture-1.git");
    expect(config.projects[0].bootstrap.install).toBe("none");
    expect(config.projects[0].models.work).toBe("fixture-work");
    expect(config.worker.dispatcherUrl).toContain(`.${NAMESPACE}.svc`);
    expect(config.lanes.find((lane) => lane.id === "k8s-dev").k8s.defaultImage).toBe(WORKER_IMAGE);
    expect(config.projects[0].placement.prefer).toEqual(["k8s-dev"]);
    expect((await validateConfig(config, { mode: "runtime" })).ok).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/<owner-id>|<chat-id>|<workspace>|<runtime>|<dev-instance>/);
    expect(original.projects[0].repo.path).toContain("<workspace>");
  });

  it("validates complete dry-run arguments without executing any command", async () => {
    const calls = [];
    const outcome = await runK8sE2e({
      namespace: NAMESPACE, context: CONTEXT,
      dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE, dryRun: true,
    }, { runner: async (...args) => { calls.push(args); throw new Error("external command forbidden"); } });
    expect(outcome).toMatchObject({ status: "dry-run", namespace: NAMESPACE, context: CONTEXT });
    expect(calls).toEqual([]);
    await expect(runK8sE2e({
      namespace: NAMESPACE, context: CONTEXT, dispatcherImage: "unpinned",
      workerImage: WORKER_IMAGE, dryRun: true,
    })).rejects.toThrow("K8S_E2E_IMAGE_TAG_REQUIRED");
  });

  it("generates ephemeral valid TLS trust for the selected namespace, never an insecure worker bypass", async () => {
    const { generateFixtureTls } = await import("./helpers/k8s-fixture-tls.mjs");
    const tls = await generateFixtureTls(NAMESPACE);
    const ca = new X509Certificate(tls.ca);
    const cert = new X509Certificate(tls.cert);
    expect(ca.ca).toBe(true);
    expect(cert.ca).toBe(false);
    expect(cert.verify(ca.publicKey)).toBe(true);
    expect(cert.checkHost(`pforge-claw-dispatcher.${NAMESPACE}.svc`)).toBeTruthy();
    expect(cert.checkHost("pforge-claw-dispatcher.pforge-claw-e2e-other.svc")).toBeUndefined();
    const worker = await readFile(path.join(PACKAGE_ROOT, "tests", "helpers", "k8s-worker.mjs"), "utf8");
    expect(worker).toContain("NODE_EXTRA_CA_CERTS");
    expect(worker).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized:\s*false|allowInsecureLan:\s*true/);
  });

  it("does not carry operator endpoints, credentials or process commands into a fixture config", async () => {
    const original = await template();
    original.memory = { openbrain: { endpoint: "https://operator.example/private", tokenSecret: "OPERATOR_TOKEN" } };
    original.channels.telegram.apiBase = "https://operator.example/telegram";
    original.channels.telegram.botTokenSecret = "OPERATOR_TOKEN";
    original.runtimes.pforgeCommand = ["operator-command", "operator-private-path"];
    const selected = materializeDevConfig({
      namespace: NAMESPACE, workerImage: WORKER_IMAGE, template: original,
    });
    expect(JSON.stringify(selected)).not.toContain("operator");
    expect((await validateConfig(selected, { mode: "runtime" })).ok).toBe(true);
  });

  it("rejects a non-fixture dispatcher transport before contacting it", async () => {
    const { callJobFixture } = await import("./helpers/k8s-fixture-common.mjs");
    let contacted = false;
    await expect(callJobFixture({
      env: {
        PFORGE_CLAW_FIXTURE_NAMESPACE: NAMESPACE, PFORGE_CLAW_FIXTURE_CONTEXT: CONTEXT,
        PFORGE_CLAW_JOB_ID: "fixture-job", PFORGE_CLAW_JOB_KEY: "0".repeat(64),
        PFORGE_CLAW_DISPATCHER_URL: "wss://operator.example/claw/workers",
      },
      route: "checkout", fetchFn: async () => { contacted = true; },
    })).rejects.toThrow("K8S_E2E_FIXTURE_TRANSPORT_INVALID");
    expect(contacted).toBe(false);
  });
});

describe("Kubernetes fixture application proof fails closed", () => {
  const identity = {
    jobId: "fixture-job", projectId: "fixture-1", deltaId: "fixture-job:pod-finalize:v1",
    sha256Total: sha256("fixture-delta"),
  };

  it.each([
    undefined, true, { ok: true }, { lastSeq: 4 },
    { ...identity, ok: false, code: "L2_CONFLICT" },
    { ...identity, jobId: "other-job", ok: true },
    { ...identity, projectId: "other-project", ok: true },
    { ...identity, deltaId: "other-transfer", ok: true },
    { ...identity, sha256Total: sha256("foreign"), ok: true },
  ])("rejects a receipt-only, foreign or negative completion %#", async (applicationAck) => {
    const { requireApplicationCompletion } = await import("./helpers/k8s-scenario.mjs");
    expect(() => requireApplicationCompletion({
      jobId: identity.jobId, projectId: identity.projectId,
      completion: {
        ok: true, applicationAck,
        event: { jobId: identity.jobId, seq: 4, type: "finished", data: { status: "succeeded", l2: identity } },
      },
    })).toThrow("K8S_E2E_APPLICATION_UNCONFIRMED");
  });

  it("boots the real dispatcher and applies canonical bytes through the real registered receiver", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const home = await workspace();
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0,
      workerImage: WORKER_IMAGE,
      k8sApiFactory: () => createK8sClient({ host: "example.com", request: () => { throw new Error("cluster forbidden"); } }),
    });
    running.push(fixture);
    expect(fixture.handles.appStarted).toBe(true);
    expect(fixture.handles.lanes.get("k8s-dev").kind).toBe("k8s");
    const contents = '{"source":"fixture-runtime","jobId":"fixture-job"}\n';
    const delta = { files: [{ rel: "runs/fixture-job/fixture.json", dataB64: Buffer.from(contents).toString("base64"), sha256: sha256(contents) }], jsonl: {}, maps: {} };
    const chunks = encodeDeltaChunks({ delta, deltaId: identity.deltaId });
    const transfer = { ...identity, sha256Total: chunks[0].sha256Total, chunks };
    const ack = await fixture.receiver.receive(transfer);
    expect(ack).toEqual({ ...identity, sha256Total: chunks[0].sha256Total, ok: true });
    const canonical = path.join(fixture.config.projects[0].repo.forgeHome, "runs", "fixture-job", "fixture.json");
    expect(await readFile(canonical, "utf8")).toBe(contents);
  });

  it("accepts evidence only from an approved real one-shot run and actual canonical bytes", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { runK8sWorker } = await import("./helpers/k8s-worker.mjs");
    const { createK8sRestEdge } = await import("./helpers/k8s-rest-edge.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const home = await workspace();
    const edge = createK8sRestEdge({
      namespace: NAMESPACE, home, runWorker: runK8sWorker,
    });
    edges.push(edge);
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0,
      workerImage: WORKER_IMAGE, k8sApiFactory: edge.apiFactory,
    });
    running.push(fixture);
    let proof;
    try {
      proof = await runK8sScenario({ control: fixture.control, output: false });
    } catch (error) {
      throw new Error(`${error.message}: ${JSON.stringify(error.diagnostics)}`);
    }
    const job = edge.job(proof.jobName);
    expect(verifyScenarioEvidence({ namespace: NAMESPACE, proof, job, workerImage: WORKER_IMAGE })).toBe(proof.jobName);
    expect(proof.jobEvents.filter((event) => event.type === "finished")).toHaveLength(1);
    expect(proof.jobEvents.at(-1).data.l2).toEqual(proof.applicationAck);
    expect(edge.calls.some(({ method }) => method === "POST")).toBe(true);
    expect(proof.expectedL2Files).toEqual(proof.canonicalL2Files);
    expect(proof.canonicalQueue.sha256).toBe(proof.canonicalQueue.expectedSha256);
    expect(proof.canonicalQueue.records).toBe(1);
    expect(proof.signedChoices).toMatchObject({
      runtime: "openai", models: { work: "fixture-work" },
      provider: { keySecret: "PFORGE_CLAW_FIXTURE_RUNTIME_TOKEN" },
      bootstrap: { install: "none", copy: [".forge.json"] },
    });
    expect(Buffer.byteLength(JSON.stringify(proof))).toBeLessThanOrEqual(10 * 1024);
  }, 20_000);

  it("restricts the fixture control capability to its token, namespace, context and fixed request", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const home = await workspace();
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: () => createK8sClient({ host: "example.com", request: () => { throw new Error("cluster forbidden"); } }),
    });
    running.push(fixture);
    const headers = {
      "x-fixture-token": fixture.control.token, "x-fixture-namespace": NAMESPACE, "x-fixture-context": CONTEXT,
    };
    for (const altered of [
      { "x-fixture-token": "0".repeat(64) },
      { "x-fixture-namespace": "pforge-claw-e2e-other" },
      { "x-fixture-context": "kind-other" },
    ]) {
      const denied = await fetch(`${fixture.control.url}/fixture/k8s/scenario`, {
        method: "POST", headers: { ...headers, ...altered }, body: "{}",
      });
      expect(denied.status).toBe(401);
      expect((await denied.json()).code).toBe("K8S_E2E_CONTROL_UNAUTHORIZED");
    }
    const override = await fetch(`${fixture.control.url}/fixture/k8s/scenario`, {
      method: "POST", headers, body: '{"runtime":"unapproved"}',
    });
    expect(override.status).toBe(400);
    expect(Object.values(currentJobs(fixture.handles.store))).toEqual([]);
  });

  it("retains the source history and Job after a real canonical conflict ACK", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { runK8sWorker } = await import("./helpers/k8s-worker.mjs");
    const { createK8sRestEdge } = await import("./helpers/k8s-rest-edge.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const home = await workspace();
    const edge = createK8sRestEdge({
      namespace: NAMESPACE, home, runWorker: runK8sWorker,
      async beforeWorker({ jobId }) {
        const file = path.join(home, "fixtures", "fixture-1", ".forge", "runs", jobId, "fixture.json");
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, "Existing canonical bytes must not be replaced.\n");
      },
    });
    edges.push(edge);
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0,
      workerImage: WORKER_IMAGE, k8sApiFactory: edge.apiFactory,
    });
    running.push(fixture);
    const failure = await runK8sScenario({ control: fixture.control, output: false }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("K8S_E2E_APPLICATION_UNCONFIRMED");
    expect(failure.diagnostics).toMatchObject({
      schemaVersion: 1, status: "failed", code: "K8S_E2E_APPLICATION_UNCONFIRMED", phase: "worker",
      jobState: "failed", approvalConsumed: true, receiptPresent: true, grantVerified: true,
      dispatcherReady: true, receiverReady: true,
      completion: { present: true, ok: false, applicationAckPresent: true, applicationAckOk: false },
    });
    await edge.drain();
    const [job] = Object.values(currentJobs(fixture.handles.store));
    expect(job.state).toBe("failed");
    const completion = fixture.registry.completion(job.id);
    expect(completion.ok).toBe(false);
    expect(completion.event.data.l2).toMatchObject({ ok: false, code: "L2_CONFLICT" });
    expect(edge.job(`pforge-claw-${job.id}`).status.failed).toBe(1);
    expect(edge.calls.some(({ method }) => method === "DELETE")).toBe(false);
    const source = path.join(home, "pods", job.id, "repo", ".forge", "runs", job.id, "fixture.json");
    expect(JSON.parse(await readFile(source, "utf8")).jobId).toBe(job.id);
    const canonical = path.join(fixture.config.projects[0].repo.forgeHome, "runs", job.id, "fixture.json");
    expect(await readFile(canonical, "utf8")).toBe("Existing canonical bytes must not be replaced.\n");
  }, 20_000);

  it("runs a separate worker CLI process over trusted TLS without disabling certificate verification", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { createK8sRestEdge, spawnK8sFixtureWorker } = await import("./helpers/k8s-rest-edge.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const { generateFixtureTls } = await import("./helpers/k8s-fixture-tls.mjs");
    const home = await workspace();
    const tls = await generateFixtureTls(NAMESPACE);
    const edge = createK8sRestEdge({ namespace: NAMESPACE, home, ca: tls.ca, runWorker: spawnK8sFixtureWorker });
    edges.push(edge);
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: edge.apiFactory, tls: { cert: tls.cert, key: tls.key, port: 0, loopback: true },
    });
    running.push(fixture);
    expect(fixture.config.worker.dispatcherUrl).toMatch(/^wss:\/\/localhost:\d+\/claw\/workers$/);
    const proof = await runK8sScenario({ control: fixture.control, output: false });
    expect(verifyScenarioEvidence({ namespace: NAMESPACE, proof, job: edge.job(proof.jobName), workerImage: WORKER_IMAGE })).toBe(proof.jobName);
    expect(proof.applicationAck.ok).toBe(true);
  }, 20_000);

  it("runs an approval-selected plan quorum and resume through the real signed one-shot configuration", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { runK8sWorker } = await import("./helpers/k8s-worker.mjs");
    const { createK8sRestEdge } = await import("./helpers/k8s-rest-edge.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const home = await workspace();
    const edge = createK8sRestEdge({ namespace: NAMESPACE, home, runWorker: runK8sWorker });
    edges.push(edge);
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: edge.apiFactory, scenarioType: "plan", quorum: "power", resumeFrom: 2,
    });
    running.push(fixture);
    const proof = await runK8sScenario({ control: fixture.control, output: false });
    expect(currentJobs(fixture.handles.store)[proof.jobId].type).toBe("plan");
    expect(proof.signedChoices).toMatchObject({ quorum: "power", resumeFrom: 2, models: { work: "fixture-work" } });
    expect(verifyScenarioEvidence({ namespace: NAMESPACE, proof, job: edge.job(proof.jobName), workerImage: WORKER_IMAGE })).toBe(proof.jobName);
    const source = path.join(home, "pods", proof.jobId, "repo", ".forge", "runs", proof.jobId, "fixture.json");
    expect(JSON.parse(await readFile(source, "utf8")).execution).toEqual({ quorum: "power", resumeFrom: 2 });
  }, 20_000);
});

describe("bounded fixture scenario failure diagnostics", () => {
  const canary = "fixture-scenario-provider-credential-canary";
  const control = {
    namespace: NAMESPACE, context: CONTEXT, url: "http://127.0.0.1:3191", token: "0".repeat(64),
  };
  const snapshot = {
    schemaVersion: 1, status: "failed", code: "K8S_E2E_WORKER_UNCONFIRMED", phase: "worker",
    jobState: "running", jobs: 1, approvalConsumed: true, receiptPresent: true, grantVerified: true,
    dispatcherReady: true, receiverReady: true, connectedWorkers: 1,
    worker: { created: true, statusRead: true, active: 1, ready: 0, succeeded: 0, failed: 0, complete: false },
    completion: { present: false, ok: null, applicationAckPresent: false, applicationAckOk: null },
    events: { observed: 3, artifacts: 1, deltaChunks: 0, terminals: 0, lastSeq: 3, ordered: true, rejected: false },
    env: { PFORGE_CLAW_JOB_KEY: canary }, provider: { apiKey: canary }, error: canary,
  };

  it("preserves safe blocked-scenario evidence without admitting a fixture receipt as acceptance", async () => {
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const calls = [];
    const failure = await runK8sScenario({
      control, output: false, fetchFn: async (url) => {
        calls.push(url);
        return new Response(JSON.stringify({ status: "blocked", code: snapshot.code, diagnostics: snapshot }), { status: 409 });
      },
    }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe(snapshot.code);
    expect(failure.diagnostics).toMatchObject({
      status: "failed", phase: "worker", jobState: "running", receiptPresent: true,
      completion: { present: false, applicationAckOk: null },
    });
    expect(calls).toEqual([`${control.url}/fixture/k8s/scenario`]);
    expect(JSON.stringify(failure.diagnostics)).not.toContain(canary);
    expect(Buffer.byteLength(JSON.stringify(failure.diagnostics))).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);
  });

  it("collects an authenticated read-only snapshot after timeout without retrying the scenario", async () => {
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const calls = [];
    const failure = await runK8sScenario({
      control, output: false, fetchFn: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith("/scenario")) throw new DOMException(canary, "TimeoutError");
        return new Response(JSON.stringify({ diagnostics: snapshot }));
      },
    }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("K8S_E2E_SCENARIO_TIMEOUT");
    expect(failure.diagnostics).toMatchObject({
      code: "K8S_E2E_SCENARIO_TIMEOUT", phase: "worker", jobState: "running",
      worker: { active: 1, ready: 0 }, events: { observed: 3, lastSeq: 3 },
    });
    expect(calls.map(({ url }) => url)).toEqual([
      `${control.url}/fixture/k8s/scenario`, `${control.url}/fixture/k8s/diagnostics`,
    ]);
    expect(calls[1].options).toMatchObject({
      method: "POST", body: "{}",
      headers: {
        "x-fixture-token": control.token, "x-fixture-namespace": NAMESPACE, "x-fixture-context": CONTEXT,
      },
    });
    expect(JSON.stringify(failure.diagnostics)).not.toContain(canary);
  });

  it("allows diagnostics only with the existing fixture capability and never starts another scenario", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const fixture = await startK8sDispatcher({
      home: await workspace(), namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: () => createK8sClient({ host: "example.com", request: () => { throw new Error("cluster forbidden"); } }),
    });
    running.push(fixture);
    const headers = {
      "content-type": "application/json", "x-fixture-token": fixture.control.token,
      "x-fixture-namespace": NAMESPACE, "x-fixture-context": CONTEXT,
    };
    for (const altered of [
      { "x-fixture-token": "0".repeat(64) }, { "x-fixture-namespace": "pforge-claw-e2e-other" }, { "x-fixture-context": "kind-other" },
    ]) {
      const denied = await fetch(`${fixture.control.url}/fixture/k8s/diagnostics`, {
        method: "POST", body: "{}", headers: { ...headers, ...altered },
      });
      expect(denied.status).toBe(401);
      expect(await denied.json()).not.toHaveProperty("diagnostics");
    }
    const invalid = await fetch(`${fixture.control.url}/fixture/k8s/diagnostics`, {
      method: "POST", body: JSON.stringify({ override: canary }), headers,
    });
    expect(invalid.status).toBe(400);
    const response = await fetch(`${fixture.control.url}/fixture/k8s/diagnostics`, { method: "POST", body: "{}", headers });
    expect(response.status).toBe(200);
    expect((await response.json()).diagnostics).toMatchObject({
      schemaVersion: 1, status: "failed", jobs: 0, jobState: null, dispatcherReady: true, receiverReady: true,
      receiptPresent: false, grantVerified: false,
    });
    expect(fixture.scenarioStarted).toBe(false);
    expect(Object.values(currentJobs(fixture.handles.store))).toEqual([]);
  });

  it("stops the owned HTTP scenario poll without waiting for an unconfirmed worker or admitting success", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { createK8sRestEdge } = await import("./helpers/k8s-rest-edge.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const home = await workspace();
    let releaseWorker;
    let markWorkerStarted;
    const workerExit = new Promise((resolve) => { releaseWorker = resolve; });
    const workerStarted = new Promise((resolve) => { markWorkerStarted = resolve; });
    const edge = createK8sRestEdge({
      namespace: NAMESPACE, home, runWorker: async () => { markWorkerStarted(); return workerExit; },
    });
    edges.push(edge);
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE, k8sApiFactory: edge.apiFactory,
    });
    running.push(fixture);
    let scenarioFailure;
    const scenario = runK8sScenario({ control: fixture.control, output: false }).catch((error) => {
      scenarioFailure = error;
      return error;
    });
    let stopping;
    try {
      await workerStarted;
      stopping = fixture.stop();
      // One second permits Windows I/O scheduling without waiting the fixture's 60-second scenario deadline.
      await vi.waitFor(() => expect(scenarioFailure).toBeInstanceOf(Error), { timeout: 1000 });
      const failure = await scenario;
      expect(failure.message).toBe("K8S_E2E_SCENARIO_STOPPED");
      expect(failure.diagnostics).toMatchObject({
        status: "failed", completion: { applicationAckOk: null }, receiptPresent: false, grantVerified: false,
      });
      expect(Object.values(currentJobs(fixture.handles.store)).every((job) => job.state !== "succeeded")).toBe(true);
    } finally {
      releaseWorker(1);
      await scenario;
      await stopping;
    }
  }, 20_000);

  it("emits only the sanitized bounded scenario DTO through the actual CLI error path", async () => {
    const home = await workspace();
    await writeFile(path.join(home, ".k8s-fixture-control.json"), JSON.stringify(control), { mode: 0o600 });
    const preload = path.join(home, "scenario-http-edge.mjs");
    await writeFile(preload, `globalThis.fetch = async () => new Response(JSON.stringify(${JSON.stringify({
      status: "blocked", code: snapshot.code, diagnostics: snapshot,
    })}), { status: 409 });`, { mode: 0o600 });
    const execution = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, "tests", "helpers", "k8s-scenario.mjs")], {
      cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS,
      env: { ...process.env, PFORGE_CLAW_HOME: home, NODE_OPTIONS: `--import ${JSON.stringify(pathToFileURL(preload).href)}` },
    });
    expect(execution.error).toBeUndefined();
    expect(execution.status).toBe(1);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).not.toContain(canary);
    const lines = execution.stderr.trim().split("\n");
    expect(lines[0]).toBe(snapshot.code);
    expect(lines[1]).toMatch(/^K8S_E2E_SCENARIO_DIAGNOSTIC /);
    expect(JSON.parse(lines[1].slice("K8S_E2E_SCENARIO_DIAGNOSTIC ".length))).toMatchObject({
      schemaVersion: 1, status: "failed", phase: "worker", jobState: "running",
    });
    expect(Buffer.byteLength(execution.stderr)).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);
  });

  it("rejects arbitrary error text, state, and counter payloads at the diagnostic boundary", async () => {
    const { normalizeScenarioDiagnostics } = await import("./helpers/k8s-scenario.mjs");
    expect(typeof normalizeScenarioDiagnostics).toBe("function");
    const normalized = normalizeScenarioDiagnostics({
      ...snapshot, code: `K8S_E2E_${canary.toUpperCase()}`, phase: canary, jobState: canary,
      jobs: canary, connectedWorkers: -1,
      worker: { active: canary, ready: -1, statusRead: canary },
      completion: { ok: canary, applicationAckOk: canary, terminalStatus: canary },
      events: { observed: canary, lastSeq: canary, ordered: canary },
      jobRejection: {
        code: `K8S_${canary.toUpperCase()}`, apiCode: canary, httpStatus: "403", createAttempted: canary,
        message: canary, body: { token: canary },
      },
    });
    expect(normalized).toMatchObject({
      code: "K8S_E2E_SCENARIO_FAILED", phase: "unknown", jobState: null, jobs: null, connectedWorkers: null,
      worker: { active: null, ready: null, statusRead: null },
      completion: { ok: null, applicationAckOk: null, terminalStatus: null },
      events: { observed: null, lastSeq: null, ordered: null },
      jobRejection: { code: null, apiCode: null, httpStatus: null, createAttempted: null },
    });
    expect(JSON.stringify(normalized)).not.toContain(canary);
    expect(JSON.stringify(normalized)).not.toContain(canary.toUpperCase());
  });

  it.each([
    { name: "forbidden Job POST", host: "example.com", apiCode: "K8S_API", httpStatus: 403 },
    { name: "missing service host", host: "", apiCode: "K8S_UNAVAILABLE", httpStatus: null },
  ])("measures the declared $name failure before worker creation without disclosing API messages", async ({ host, apiCode, httpStatus }) => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    const requests = [];
    const fixture = await startK8sDispatcher({
      home: await workspace(), namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: () => createK8sClient({
        host, readFile: async (file) => file.endsWith("token") ? canary : Buffer.from("fixture-ca"),
        request: (options, callback) => {
          const request = new EventEmitter();
          request.write = () => {};
          request.destroy = () => request.emit("close");
          request.end = () => {
            requests.push(options.method);
            const response = new PassThrough();
            response.statusCode = 403;
            callback(response);
            response.end(JSON.stringify({ kind: "Status", status: "Failure", message: canary }));
          };
          return request;
        },
      }),
    });
    running.push(fixture);
    const failure = await runK8sScenario({ control: fixture.control, output: false }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe("K8S_E2E_APPLICATION_UNCONFIRMED");
    expect(failure.diagnostics).toMatchObject({
      phase: "worker", jobState: "failed", approvalConsumed: true, receiptPresent: false, grantVerified: false,
      worker: { created: false, statusRead: false },
      completion: { present: false, applicationAckPresent: false },
      events: { observed: 0, deltaChunks: 0 },
      jobRejection: { code: "K8S_API", apiCode, httpStatus, createAttempted: true },
    });
    expect(requests).toEqual(host ? ["POST"] : []);
    const output = JSON.stringify(failure.diagnostics);
    expect(output).not.toContain(canary);
    expect(output).not.toMatch(/"message"|"body"|"token"|"headers"/);
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(MAX_DIAGNOSTIC_BYTES);
    expect(fixture.jobNames.size).toBe(0);
    expect(fixture.receipts.size).toBe(0);
  });

  it("reads the exact durable pre-POST rejection without inventing an API status", async () => {
    const { startK8sDispatcher } = await import("./helpers/k8s-dispatcher.mjs");
    const { runK8sScenario } = await import("./helpers/k8s-scenario.mjs");
    let contacted = false;
    const fixture = await startK8sDispatcher({
      home: await workspace(), namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: () => createK8sClient({
        host: "example.com", request: () => { contacted = true; throw new Error("cluster forbidden"); },
      }),
    });
    running.push(fixture);
    delete fixture.config.lanes.find((lane) => lane.id === "k8s-dev").k8s.secrets.env[FIXTURE_CA_ENV];
    const failure = await runK8sScenario({ control: fixture.control, output: false }).catch((error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.diagnostics).toMatchObject({
      jobState: "failed", approvalConsumed: true, receiptPresent: false,
      jobRejection: { code: "BOOTSTRAP_SECRET_MISSING", apiCode: null, httpStatus: null, createAttempted: false },
    });
    expect(contacted).toBe(false);
    expect(fixture.jobNames.size).toBe(0);
    expect(fixture.receipts.size).toBe(0);
  });
});
