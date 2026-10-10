import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bootDispatcher } from "../../src/cli/start.mjs";
import { createProjectClients } from "../../src/mcp/project-client.mjs";
import { createSecrets } from "../../src/secrets.mjs";
import { createHttpServer } from "../../src/http.mjs";
import { createL2Receiver } from "../../src/protocol/l2-receiver.mjs";
import { createK8sClient } from "../../src/k8s/api.mjs";
import { currentJobs, TERMINAL } from "../../src/jobs/model.mjs";
import { prepareProducer } from "../../src/jobs/c2-job-producer.mjs";
import { QUORUM_MODES } from "../../src/approvals.mjs";
import approvalsFeature from "../../src/features/approvals.mjs";
import workersFeature from "../../src/features/workers.mjs";
import { materializeDevConfig, PACKAGE_ROOT, FIXTURE_TLS_CERT_ENV, FIXTURE_TLS_KEY_ENV } from "../../scripts/k8s-e2e-overlay.mjs";
import { collectScenarioEvidence } from "./k8s-scenario.mjs";
import { fixtureSystemEnvironment } from "./k8s-worker.mjs";
import { startFakeTelegram } from "./fake-telegram.mjs";
import { startFixtureTlsProxy } from "./k8s-tls-proxy.mjs";
import {
  fixtureCheckout, FIXTURE_CA_ENV, FIXTURE_CONTROL_FILE, FIXTURE_CONTEXT_ENV, FIXTURE_CORE_PORT,
  FIXTURE_HTTP_PORT, FIXTURE_HTTP_STATUS, FIXTURE_LANE,
  FIXTURE_MAX_BYTES, FIXTURE_NAMESPACE_ENV, FIXTURE_PLAN_PATH, FIXTURE_PREFIX, FIXTURE_RUNTIME_ENV, FIXTURE_TIMEOUT_MS,
  prepareFixtureProject, sameFixtureToken, signFixtureMessage, validateFixtureJob, validateFixtureScope,
} from "./k8s-fixture-common.mjs";

const SECRET_BYTES = 32;
const MAX_RAW_EVENTS = 100;
const MAX_RAW_BYTES = 131_072;
const JOB_SHORT_ID_LENGTH = 8;
const POLL_INTERVAL_MS = 25;

async function allocatePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function ownedHome(home) {
  const resolved = await realpath(home);
  if (process.platform !== "win32" && resolved === "/data") return resolved;
  const tests = await realpath(path.join(PACKAGE_ROOT, "tests"));
  const relative = path.relative(tests, resolved);
  if (!relative.startsWith(".k8s-fixture-") || relative.includes(path.sep)) {
    throw new Error("K8S_E2E_FIXTURE_HOME_INVALID");
  }
  return resolved;
}

function jobApiFactory({ factory, namespace, jobs, apis }) {
  return (lane) => {
    const api = factory(lane.k8s);
    apis.set(lane.id, api);
    return {
      ...api,
      async createJob(selectedNamespace, spec) {
        if (selectedNamespace !== namespace) throw new Error("K8S_E2E_NAMESPACE_INVALID");
        const created = await api.createJob(selectedNamespace, spec);
        jobs.set(spec.metadata.labels["pforge-claw/job-id"], created?.metadata?.name ?? spec.metadata.name);
        return created;
      },
    };
  };
}

function recordEvents(bus) {
  const entries = new Map();
  const rejected = new Set();
  const listener = (event) => {
    // Dispatcher job-state notifications are not the worker's typed terminal/ACK.
    if (event.type === "finished") return;
    const events = entries.get(event.jobId) ?? [];
    const next = structuredClone(event);
    events.push(next);
    if (events.length > MAX_RAW_EVENTS || Buffer.byteLength(JSON.stringify(events)) > MAX_RAW_BYTES) {
      rejected.add(event.jobId);
      return;
    }
    entries.set(event.jobId, events);
  };
  bus.on("lane.event", listener);
  return { entries, rejected, stop: () => bus.off("lane.event", listener) };
}

async function waitUntil(predicate, code) {
  const expires = Date.now() + FIXTURE_TIMEOUT_MS;
  while (Date.now() < expires) {
    const match = await predicate();
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(code);
}

function scopeAuthorized(request, control) {
  return request.headers["x-fixture-namespace"] === control.namespace
    && request.headers["x-fixture-context"] === control.context;
}

function jobAuthorized({ request, body, route, fixture }) {
  if (!scopeAuthorized(request, fixture.control)) return false;
  const jobId = request.headers["x-fixture-job"];
  try {
    validateFixtureJob(jobId);
    const job = currentJobs(fixture.handles.store)[jobId];
    if (job?.lane !== FIXTURE_LANE || !["leased", "running"].includes(job.state)) return false;
    const key = workersFeature.jobKeyFor(FIXTURE_LANE, jobId);
    const expected = signFixtureMessage({ ...fixture.control, key, route, jobId, body });
    return sameFixtureToken(expected, request.headers["x-fixture-mac"]);
  } catch {
    return false;
  }
}

function jsonResponse(response, status, contents) {
  const encoded = JSON.stringify(contents);
  if (Buffer.byteLength(encoded) > FIXTURE_MAX_BYTES) throw new Error("K8S_E2E_PROOF_TOO_LARGE");
  response.writeHead(status, { "content-type": "application/json" });
  response.end(encoded);
}

function installJobRoutes(http, fixture) {
  for (const route of ["checkout", "receipt"]) {
    http.route("POST", `${FIXTURE_PREFIX}/${route}`, async ({ request, response, body }) => {
      const input = JSON.parse(body || "{}");
      if (!jobAuthorized({ request, body: input, route, fixture })) {
        jsonResponse(response, FIXTURE_HTTP_STATUS.UNAUTHORIZED, { code: "K8S_E2E_JOB_AUTH_INVALID" });
        return;
      }
      const jobId = request.headers["x-fixture-job"];
      const job = currentJobs(fixture.handles.store)[jobId];
      if (route === "checkout") {
        const project = fixture.config.projects.find((entry) => entry.id === job.projectId);
        jsonResponse(response, FIXTURE_HTTP_STATUS.OK, await fixtureCheckout(project));
        return;
      }
      if (input.jobId !== jobId || input.projectId !== job.projectId || fixture.receipts.has(jobId)) {
        jsonResponse(response, FIXTURE_HTTP_STATUS.CONFLICT, { code: "K8S_E2E_GRANT_UNCONFIRMED" });
        return;
      }
      fixture.receipts.set(jobId, structuredClone(input));
      jsonResponse(response, FIXTURE_HTTP_STATUS.OK, { ok: true });
    });
  }
}

async function approvedScenario(fixture) {
  if (fixture.scenarioStarted) throw new Error("K8S_E2E_SCENARIO_SINGLE_USE");
  fixture.scenarioStarted = true;
  const project = fixture.config.projects[0];
  const chat = project.channel;
  if (fixture.scenario.type === "plan") await requestFixturePlan(fixture, project);
  else fixture.telegram.pushMessage({
    userId: "1", chatId: chat.chatId, threadId: chat.topicId, text: "/task Write a disposable Kubernetes fixture artifact",
  });
  const job = await waitUntil(() => Object.values(currentJobs(fixture.handles.store))
    .find((entry) => entry.projectId === project.id && entry.state === "awaiting-approval"), "K8S_E2E_APPROVAL_UNCONFIRMED");
  await approvalsFeature.tick();
  const card = await fixture.telegram.waitForCall("sendMessage", (args) =>
    args.reply_markup?.inline_keyboard?.flat().some((button) => button.callback_data?.startsWith(`a:${job.id.slice(0, JOB_SHORT_ID_LENGTH)}:`)));
  const callback = card.args.reply_markup.inline_keyboard.flat().find((button) =>
    button.callback_data?.startsWith("a:") && (fixture.scenario.type !== "plan" || button.callback_data.endsWith(`:${fixture.scenario.quorum}`)));
  if (!callback) throw new Error("K8S_E2E_APPROVAL_UNCONFIRMED");
  fixture.telegram.pushCallback({
    userId: "1", chatId: chat.chatId, threadId: chat.topicId, messageId: card.result?.message_id, data: callback.callback_data,
  });
  const terminal = await waitUntil(() => {
    const latest = currentJobs(fixture.handles.store)[job.id];
    return TERMINAL.includes(latest?.state) && latest;
  }, "K8S_E2E_WORKER_UNCONFIRMED");
  if (terminal.state !== "succeeded") throw new Error("K8S_E2E_APPLICATION_UNCONFIRMED");
  await fixture.registry.waitForCompletion({ jobId: job.id, timeoutMs: FIXTURE_TIMEOUT_MS });
  const jobName = fixture.jobNames.get(job.id);
  await waitUntil(async () => {
    const status = await fixture.apis.get(FIXTURE_LANE).getJob(fixture.control.namespace, jobName);
    return status?.status?.succeeded === 1;
  }, "K8S_E2E_WORKER_UNCONFIRMED");
  if (fixture.events.rejected.has(job.id)) throw new Error("K8S_E2E_EVENTS_INVALID");
  return collectScenarioEvidence({
    namespace: fixture.control.namespace, handles: fixture.handles, registry: fixture.registry,
    receipt: fixture.receipts.get(job.id), events: fixture.events.entries.get(job.id) ?? [], jobId: job.id, jobName,
  });
}

async function requestFixturePlan(fixture, project) {
  const { handles, scenario } = fixture;
  const estimate = await handles.clients.call(project.id, "forge_estimate_quorum", { planPath: FIXTURE_PLAN_PATH });
  const prepared = await prepareProducer({
    deps: {
      config: fixture.config, secrets: handles.secrets, store: handles.store, project,
      caller: { userId: "1", role: "owner", channel: "telegram" },
      chatId: project.channel.chatId, threadId: project.channel.topicId,
    },
    input: { updateId: "fixture-plan", adapter: "telegram" }, type: "plan", label: "Plan",
  }, async () => ({ fields: {
    planPath: FIXTURE_PLAN_PATH, description: FIXTURE_PLAN_PATH, estimate,
    quorum: scenario.quorum, ...(scenario.resumeFrom !== undefined ? { resumeFrom: scenario.resumeFrom } : {}),
  } }));
  if (!prepared.jobId) throw new Error("K8S_E2E_APPROVAL_UNCONFIRMED");
}

function scenarioOptions(options) {
  const type = options.scenarioType ?? "task";
  if (!["task", "plan"].includes(type) || (options.quorum !== undefined && !QUORUM_MODES.includes(options.quorum))
    || (options.resumeFrom !== undefined && (!Number.isSafeInteger(options.resumeFrom) || options.resumeFrom < 1))) {
    throw new Error("K8S_E2E_SCENARIO_OPTIONS_INVALID");
  }
  return { type, quorum: options.quorum ?? "auto", resumeFrom: options.resumeFrom };
}

function installScenarioRoute(http, fixture) {
  http.route("POST", `${FIXTURE_PREFIX}/scenario`, async ({ request, response, body }) => {
    if (!scopeAuthorized(request, fixture.control) || !sameFixtureToken(fixture.control.token, request.headers["x-fixture-token"])) {
      jsonResponse(response, FIXTURE_HTTP_STATUS.UNAUTHORIZED, { code: "K8S_E2E_CONTROL_UNAUTHORIZED" });
      return;
    }
    if (body !== "{}") { jsonResponse(response, FIXTURE_HTTP_STATUS.BAD_REQUEST, { code: "K8S_E2E_CONTROL_INPUT_INVALID" }); return; }
    try {
      jsonResponse(response, FIXTURE_HTTP_STATUS.OK, await approvedScenario(fixture));
    } catch (error) {
      const code = /^K8S_E2E_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "K8S_E2E_SCENARIO_FAILED";
      jsonResponse(response, FIXTURE_HTTP_STATUS.CONFLICT, { status: "blocked", code });
    }
  });
}

async function configuration({ options, home, telegram, port }) {
  const source = options.config ?? JSON.parse(await readFile(path.join(PACKAGE_ROOT, "deploy", "k8s", "overlays", "dev", "config.json"), "utf8"));
  const workerImage = options.workerImage ?? source.lanes.find((lane) => lane.id === FIXTURE_LANE)?.k8s.defaultImage;
  const config = materializeDevConfig({ ...options, fixtureHome: home, pathImpl: path, template: source, workerImage });
  config.channels.telegram.apiBase = telegram.apiBase;
  config.http = { bind: "127.0.0.1", port };
  if (!options.tls) config.worker.dispatcherUrl = `ws://127.0.0.1:${port}/claw/workers`;
  if (options.tls?.loopback) config.worker.dispatcherUrl = `wss://localhost:${options.tls.port}/claw/workers`;
  for (const project of config.projects) await prepareFixtureProject(project);
  return config;
}

async function fixtureSecrets({ control, tls }) {
  return createSecrets({ env: {
    PFORGE_CLAW_TELEGRAM_TOKEN: randomBytes(SECRET_BYTES).toString("hex"),
    PFORGE_CLAW_K8S_LANE_SECRET: randomBytes(SECRET_BYTES).toString("hex"),
    [FIXTURE_RUNTIME_ENV]: randomBytes(SECRET_BYTES).toString("hex"),
    [FIXTURE_NAMESPACE_ENV]: control.namespace,
    [FIXTURE_CONTEXT_ENV]: control.context,
    [FIXTURE_CA_ENV]: tls?.cert ?? "disposable-public-ca-not-used-on-loopback",
  } });
}

async function fixtureStartup(input) {
  let options = input;
  validateFixtureScope(options);
  const scenario = scenarioOptions(options);
  const home = await ownedHome(options.home ?? "/data");
  const port = options.listenPort === 0 ? await allocatePort() : options.listenPort ?? FIXTURE_CORE_PORT;
  if (options.tls?.loopback && options.listenPort !== 0) throw new Error("K8S_E2E_FIXTURE_TRANSPORT_INVALID");
  if (options.tls?.port === 0) options = { ...options, tls: { ...options.tls, port: await allocatePort() } };
  return { options, scenario, home, port };
}

/** Disposable fixture root uses the real boot and registered canonical receiver, never a rig/lane substitute. */
export async function startK8sDispatcher(input = {}) {
  const { options, scenario, home, port } = await fixtureStartup(input);
  const telegram = await startFakeTelegram();
  const logger = options.logger ?? { info() {}, warn() {}, error() {} };
  const control = { namespace: options.namespace, context: options.context, url: `http://127.0.0.1:${port}`, token: randomBytes(SECRET_BYTES).toString("hex") };
  const fixture = { home, control, telegram, receipts: new Map(), jobNames: new Map(), apis: new Map(), scenarioStarted: false, scenario };
  let http;
  let proxy;
  let stopped = false;
  fixture.stop = async () => {
    if (stopped) return;
    stopped = true;
    fixture.events?.stop();
    await proxy?.stop();
    await http?.close();
    await fixture.handles?.stop();
    await telegram.close();
  };
  try {
    fixture.config = await configuration({ options, home, telegram, port });
    const bus = new EventEmitter();
    fixture.events = recordEvents(bus);
    const secrets = await fixtureSecrets({ control, tls: options.tls });
    fixture.handles = await bootDispatcher({
      home, loadedConfig: { ok: true, config: fixture.config }, secrets, logger, bus,
      env: fixtureSystemEnvironment(),
      runtimeFactory: async ({ id }) => ({ id, async run() { throw new Error("K8S_E2E_LOCAL_RUNTIME_REFUSED"); } }),
      createProjectClients: (input) => createProjectClients({ ...input, secrets, env: fixtureSystemEnvironment(), currentLaneId: "local" }),
      k8sApiFactory: jobApiFactory({ factory: options.k8sApiFactory ?? createK8sClient, namespace: options.namespace, jobs: fixture.jobNames, apis: fixture.apis }),
    });
    fixture.registry = workersFeature.registry();
    if (!fixture.registry?.setL2Receiver) throw new Error("K8S_E2E_RECEIVER_UNAVAILABLE");
    fixture.receiver = createL2Receiver({ config: fixture.config, currentLaneId: "local", directory: fixture.handles.lanes });
    fixture.registry.setL2Receiver(fixture.receiver.receive);
    http = createHttpServer({ bind: "127.0.0.1", port, maxBodyBytes: FIXTURE_MAX_BYTES });
    installJobRoutes(http, fixture);
    installScenarioRoute(http, fixture);
    await http.listen();
    if (options.tls) proxy = await startFixtureTlsProxy({
      ...options.tls, targetPort: port, ...(options.tls.loopback ? { bind: "127.0.0.1" } : {}),
    });
    await writeFile(path.join(home, FIXTURE_CONTROL_FILE), JSON.stringify(control), { mode: 0o600 });
    return fixture;
  } catch (error) {
    await fixture.stop();
    throw error;
  }
}

async function main() {
  const home = process.env.PFORGE_CLAW_HOME ?? "/data";
  await mkdir(home, { recursive: true });
  const config = JSON.parse(await readFile("/fixture-config/config.json", "utf8"));
  const fixture = await startK8sDispatcher({
    home, config, namespace: process.env[FIXTURE_NAMESPACE_ENV], context: process.env[FIXTURE_CONTEXT_ENV],
    tls: { cert: process.env[FIXTURE_TLS_CERT_ENV], key: process.env[FIXTURE_TLS_KEY_ENV], port: FIXTURE_HTTP_PORT },
  });
  await new Promise((resolve) => {
    const stop = () => { void fixture.stop().then(resolve, () => { process.exitCode = 1; resolve(); }); };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch {
    process.stderr.write("K8S_E2E_DISPATCHER_FAILED\n");
    process.exitCode = 1;
  }
}
