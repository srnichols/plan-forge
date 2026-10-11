import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import workerCommand, { createLeaseExecution, runOneShot } from "../src/cli/worker.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createWorkerAgent } from "../src/protocol/worker-agent.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createLeasePreparer } from "../src/jobs/lease-payload.mjs";
import { createApprovalService } from "../src/approvals.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";
import { signGrant } from "../src/protocol/lease-grant.mjs";
import {
  decode, encode, message, PUBLICATION_MESSAGE, PUBLICATION_ACK_MESSAGE, PUBLICATION_ERRORS, PUBLICATION_OPERATIONS,
  PUBLICATION_FENCE_VERSION,
} from "../src/protocol/messages.mjs";
import { run as runCommand } from "../src/jobs/worktree.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createProjectClients } from "../src/mcp/project-client.mjs";
import { createRegistry, resolveMcpLaunch } from "../src/registry.mjs";
import { createEnrollment } from "../src/protocol/enrollment.mjs";
import { createWorkerServer } from "../src/protocol/ws-server.mjs";
import { createHttpServer } from "../src/http.mjs";
import { finalizePodJob } from "../src/lanes/k8s-job-lane.mjs";

const edges = vi.hoisted(() => ({ sockets: [], launches: [], onSocket: null }));
vi.mock("ws", async (original) => {
  const actual = await original();
  const { EventEmitter: Emitter } = await import("node:events");
  class Socket extends Emitter {
    OPEN = 1;
    readyState = 1;
    constructor(url) {
      super();
      if (edges.nativeTransport) return new actual.WebSocket(url);
      edges.sockets.push(this);
      edges.onSocket?.(this);
      queueMicrotask(() => this.emit("open"));
    }
    send(raw) { this.onSend?.(decode(raw)); }
    close() { this.readyState = 3; this.emit("close", 1000); }
  }
  return { ...actual, WebSocket: Socket };
});
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    StdioClientTransport: class {
      constructor(launch) { this.launch = launch; this.stderr = new Emitter(); }
      async close() { this.onclose?.(); }
    },
  };
});
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect(transport) { this.transport = transport; edges.launches.push(transport.launch); }
    async callTool() { return { content: [{ type: "text", text: '{"homeRead":true}' }] }; }
    async close() { await this.transport.close(); }
  },
}));

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const KEY = "authority-review-inert-worker-key";
const CAPABILITIES = { os: "linux", arch: "x64", macos: false, toolchains: [], projects: ["p1"] };
const HEARTBEAT_MS = 15_000;
const PROCESS_TIMEOUT_MS = 30_000;
const CLEANUP_RETRIES = 30;
const CLEANUP_RETRY_MS = 100;
const cleanups = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
  edges.sockets.length = 0;
  edges.launches.length = 0;
  edges.nativeTransport = false;
  edges.onSocket = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function directory() {
  const root = await mkdtemp(path.join(TEST_DIRECTORY, ".worker-authority-review-"));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: CLEANUP_RETRIES, retryDelay: CLEANUP_RETRY_MS }));
  return root;
}

async function approvedPayload(root, { laneKind = "remote", jobId = "f0020001" } = {}) {
  const repoPath = path.join(root, "canonical");
  await mkdir(path.join(repoPath, ".vscode"), { recursive: true });
  await writeFile(path.join(repoPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: { "plan-forge": { command: process.execPath, args: ["inert-mcp.mjs"] } },
  }));
  await writeFile(path.join(repoPath, "inert-mcp.mjs"), "export {};\n");
  const config = {
    allowlist: [{ channel: "telegram", userId: "holder", role: "owner" }],
    projects: [{
      id: "p1", homeLane: "canonical-home",
      repo: { path: repoPath, baseBranch: "main", url: "https://example.test/authority.git" },
      models: { work: "configured-test-model" }, bootstrap: { copy: [], env: [], install: "none" },
    }],
    lanes: [{ id: "canonical-home", kind: "local" }, { id: "execution-host", kind: laneKind }],
    runtimes: { default: "copilot-sdk", ghCommand: ["inert-gh"] },
    jobs: { pushOnFailure: false },
  };
  const store = createStore(path.join(root, "dispatcher-state"));
  const created = createJob({ id: jobId, type: "task", projectId: "p1" });
  const job = { ...created.job, description: "approved authority probe", callerId: "holder", callerRole: "owner",
    adapter: "telegram", chatId: "fixture-chat" };
  store.append(JOBS_STREAM, { ...created.event, job });
  const awaiting = transition(job, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  const approvals = createApprovalService({ config, store });
  const approval = approvals.createApproval(awaiting.job);
  approvals.issue(awaiting.job, { approval });
  const decision = await approvals.decide({
    payload: approval.approve.slice(2), caller: { userId: "holder", role: "owner" }, chatId: "fixture-chat", threadId: null,
  });
  expect(decision).toMatchObject({ ok: true });
  const prepare = createLeasePreparer({ ctx: { config, store }, laneConfig: config.lanes[1] });
  const payload = await prepare(currentJobs(store)[job.id]);
  expect(payload.leaseGrant.approval.kind).toBe("consumed");
  return { config, payload, repoPath };
}

function pipe({ registry, workerId, localLane, execution, publicationReady = true }) {
  let socket;
  const sent = [];
  const received = [];
  const transport = { dropServerPackets: false, dropPublicationAcks: false };
  const receive = (packet) => {
    received.push(packet);
    if (transport.dropServerPackets || (transport.dropPublicationAcks && packet.t === PUBLICATION_ACK_MESSAGE)) return;
    socket.emit("message", Buffer.from(encode(packet)), false);
  };
  class Socket extends EventEmitter {
    OPEN = 1;
    readyState = 1;
    constructor() { super(); socket = this; }
    send(raw) {
      const packet = decode(raw);
      sent.push(packet);
      if (packet.t === "ack") registry.onAck({ ...packet, workerId });
      if (packet.t === "event") registry.onEvent({ ...packet, workerId });
      if (packet.t === PUBLICATION_MESSAGE) receive(registry.onPublication({ ...packet, workerId }));
      if (packet.t === "heartbeat") {
        const leases = registry.onHeartbeat({ ...packet, workerId });
        receive(message("heartbeat", { ts: 0, leases }));
      }
    }
    close() { this.readyState = 3; this.emit("close", 1000); }
  }
  const agent = createWorkerAgent({
    url: "ws://127.0.0.1/claw/workers", workerId, laneId: "execution-host", secret: KEY,
    capabilities: CAPABILITIES, localLane, WebSocketImpl: Socket, rand: () => 0,
    verifyLease: execution.verifyLease, l2: execution.l2, afterJob: execution.afterJob,
    logger: { warn() {}, error() {} },
  });
  agent.start();
  socket.emit("open");
  const hello = sent.find((packet) => packet.t === "hello");
  receive(message("ready", {
    leaseMs: registry.leaseMs, heartbeatMs: HEARTBEAT_MS,
    ...(publicationReady ? { publicationFence: registry.publicationFence } : {}),
  }));
  registry.connect(workerId, {
    laneId: "execution-host", capabilities: CAPABILITIES,
    publicationFence: Object.hasOwn(hello, "publicationFence") && hello.publicationFence === PUBLICATION_FENCE_VERSION,
    send: receive,
  });
  cleanups.push(async () => { agent.stop(); await agent.drain(); });
  return { agent, sent, received, receive, socket, transport };
}

async function authoritySystem({
  holdPublicationFor, publicationReady = true, waitForRuntime = true, publicationOutcome,
} = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const root = await directory();
  const { config, payload, repoPath } = await approvedPayload(root);
  const receiver = createL2Receiver({ config, currentLaneId: "canonical-home" });
  const registry = createWorkerRegistry({
    requireL2: true, applyL2: receiver.receive,
    signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key: KEY }),
  });
  cleanups.push(() => registry.close());
  const publications = [];
  let nativeOutcomeConsumed = false;
  const workers = {};
  for (const workerId of ["A", "B"]) {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const pushStarted = Promise.withResolvers();
    const settlePush = Promise.withResolvers();
    let executionPipe;
    const runner = async (command, args) => {
      if (args.includes("--show-toplevel")) return { code: 0, stdout: repoPath, settlementConfirmed: true };
      if (args.includes("show-ref")) return { code: 1, stdout: "", settlementConfirmed: true };
      if (args.includes("worktree") && args.includes("add")) {
        const cwd = args.at(-2);
        await mkdir(path.join(cwd, ".vscode"), { recursive: true });
        await writeFile(path.join(cwd, ".vscode", "mcp.json"), JSON.stringify({
          servers: { "plan-forge": { command: process.execPath, args: ["inert-mcp.mjs"] } },
        }));
        await writeFile(path.join(cwd, "inert-mcp.mjs"), "export {};\n");
      }
      if (args.includes("worktree") && args.includes("remove")) await rm(args.at(-1), { recursive: true });
      if (args.includes("push") || command === "inert-gh") publications.push({ workerId, args });
      if (args.includes("push") && workerId === holdPublicationFor) {
        pushStarted.resolve();
        await settlePush.promise;
      }
      if (args.includes("push") && publicationOutcome && !nativeOutcomeConsumed) {
        nativeOutcomeConsumed = true;
        return publicationOutcome;
      }
      return {
        code: 0, settlementConfirmed: true,
        stdout: args.includes("rev-parse") ? "a".repeat(40)
          : args.includes("--count") ? "1" : command === "inert-gh" ? "https://example.test/pr/1" : "",
      };
    };
    const secrets = await createSecrets({ env: {} });
    const home = path.join(root, workerId);
    await mkdir(home);
    const clients = createProjectClients({
      config, registry: { ...createRegistry(config), resolveMcpLaunch }, secrets,
      connect: async () => ({ call: async () => ({}), close: async () => {} }),
    });
    cleanups.push(() => clients.closeAll());
    let signal;
    let cwd;
    const execution = createLeaseExecution({
      ctx: { config, home, secrets, runner, bus: new EventEmitter(), features: [],
        withPublication: (...args) => executionPipe.agent.withPublication(...args),
        isCurrentLease: (job) => executionPipe.agent.isCurrentLease(job) },
      clients, subject: workerId, laneId: "execution-host", key: KEY,
      runtimeFactory: ({ id }) => ({ id, async run(input) {
        signal = input.signal;
        cwd = input.cwd;
        entered.resolve();
        await release.promise;
        await mkdir(path.join(cwd, ".forge", "runs", workerId), { recursive: true });
        await writeFile(path.join(cwd, ".forge", "runs", workerId, "run.json"), JSON.stringify({ workerId }));
        return { status: "succeeded" };
      } }),
    });
    const localLane = createLocalLane({ id: "execution-host", runtimeFor: execution.runtimeFor });
    executionPipe = pipe({ registry, workerId, localLane, execution, publicationReady });
    cleanups.push(() => release.resolve());
    cleanups.push(() => settlePush.resolve());
    workers[workerId] = { ...executionPipe, entered, release, pushStarted, settlePush, execution, localLane,
      get signal() { return signal; }, get cwd() { return cwd; } };
  }
  const lane = createRemoteLane({ id: "execution-host", registry });
  const received = [];
  const consuming = (async () => { for await (const event of lane.submit(payload)) received.push(event); })();
  if (waitForRuntime) await vi.waitFor(() => expect(workers.A.signal).toBeInstanceOf(AbortSignal));
  return { root, registry, payload, workers, publications, received, consuming, repoPath };
}

it("FRC-03 releases authenticated publication authority after a real physically settled nonzero command", async () => {
  const native = await runCommand(process.execPath, ["-e", "process.exitCode=7"], {
    requireSettlement: true, timeoutMs: 5_000,
  });
  const diagnostics = {
    code: native.code,
    errorCode: /^[A-Z0-9_]{1,64}$/.test(native.error?.code ?? "") ? native.error.code : null,
    rootReady: native.settlement?.rootReady === true,
    rootIdentityPresent: Number.isSafeInteger(native.settlement?.rootPid)
      && typeof native.settlement?.rootStartedAt === "string",
    settlementConfirmed: native.settlementConfirmed === true,
    zeroUnknownMeasured: native.settlement?.unknownProcesses === 0,
  };
  expect(native, JSON.stringify(diagnostics)).toMatchObject({ code: 7, settlementConfirmed: true });
  expect(native.settlement).toMatchObject({
    rootReady: true, rootStartedAt: expect.any(String), unknownProcesses: 0,
  });
  const system = await authoritySystem({ publicationOutcome: native });
  system.workers.A.release.resolve();
  await vi.waitFor(() => expect(system.registry.completion(system.payload.id)?.event.data.status).toBe("failed"));
  await system.consuming;
  expect(system.registry.snapshot().byLane["execution-host"]).toMatchObject({
    publicationFences: 0, active: 0,
  });
  expect(system.workers.A.sent.some((packet) => packet.t === PUBLICATION_MESSAGE
    && packet.operation === PUBLICATION_OPERATIONS.END)).toBe(true);
  const next = await approvedPayload(path.join(system.root, "next-job"), { jobId: "f0020002" });
  expect(next.payload.leaseGrant.approval).not.toEqual(system.payload.leaseGrant.approval);
  system.registry.enqueue("execution-host", { kind: "job", job: next.payload });
  await vi.waitFor(() => expect(Object.values(system.workers).some((worker) =>
    worker.received.some((packet) => packet.kind === "job" && packet.job?.id === next.payload.id))).toBe(true));
}, PROCESS_TIMEOUT_MS);

async function workerHomeFixture() {
  const root = await directory();
  const repoPath = path.join(root, "home-checkout");
  await mkdir(path.join(repoPath, ".vscode"), { recursive: true });
  await mkdir(path.join(root, "state"));
  const config = {
    v: 1, instanceId: "fr06-test", timezone: "Etc/UTC",
    allowlist: [{ channel: "telegram", userId: "fixture-holder", role: "owner" }],
    projects: [{ id: "p1", homeLane: "registered-home", repo: { path: repoPath },
      channel: { adapter: "telegram", chatId: "fixture-chat" } }],
    lanes: [{ id: "registered-home", kind: "remote" }],
    worker: { laneId: "registered-home", dispatcherUrl: "ws://127.0.0.1/claw/workers" },
    runtimes: { default: "openai", byok: { openai: { keySecret: "FR06_WORKER_BYOK", endpoint: "https://example.test/v1" } } },
  };
  vi.stubEnv("FR06_WORKER_BYOK", undefined);
  vi.stubEnv("PFORGE_CLAW_WORKER_SECRET", undefined);
  const canary = "inert-worker-store-byok-reference";
  const secretFile = path.join(root, "secrets.json");
  await writeFile(path.join(root, "config.json"), JSON.stringify(config));
  await writeFile(secretFile, JSON.stringify({ PFORGE_CLAW_WORKER_SECRET: KEY, FR06_WORKER_BYOK: canary }));
  await writeFile(path.join(root, "state", "worker.json"), JSON.stringify({
    v: 1, workerId: "home-worker", laneId: "registered-home",
  }));
  await writeFile(path.join(repoPath, ".vscode", "mcp.json"), JSON.stringify({
    servers: { "plan-forge": { command: process.execPath, args: ["inert-mcp.mjs"], env: { HOME_PROVIDER: "${env:FR06_WORKER_BYOK}" } } },
  }));
  return { root, repoPath, config, canary, secretFile };
}

async function isOwnedProcessRunning(pid) {
  if (process.platform !== "win32") {
    const observed = await runCommand("ps", ["-o", "stat=", "-p", String(pid)]);
    if (observed.code === 1) return false;
    if (observed.code !== 0) throw new Error("Owned process state unavailable");
    return Boolean(observed.stdout.trim()) && !observed.stdout.trim().startsWith("Z");
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function nativePublicationFixture() {
  const root = await directory();
  const childFile = path.join(root, "owned-child.mjs");
  const parentFile = path.join(root, "owned-parent.mjs");
  const manifest = path.join(root, "owned-pids.json");
  const started = path.join(root, "started");
  const gate = path.join(root, "publication-gate");
  const published = path.join(root, "published");
  await writeFile(childFile, [
    'import { existsSync, writeFileSync } from "node:fs";',
    "const [started, gate, published] = process.argv.slice(2);",
    'writeFileSync(started, "owned");',
    'const timer = setInterval(() => { if (existsSync(gate)) { writeFileSync(published, "inert"); clearInterval(timer); } }, 25);',
    "// A generous 60s safety lifetime is not a measured timing assertion; file handshakes establish readiness.",
    "setTimeout(() => process.exit(0), 60000).unref();",
  ].join("\n"));
  await writeFile(parentFile, [
    'import { spawn } from "node:child_process";',
    'import { writeFileSync } from "node:fs";',
    "const [childFile, manifest, ...args] = process.argv.slice(2);",
    'const child = spawn(process.execPath, [childFile, ...args], { detached: true, stdio: "ignore" });',
    "child.unref();",
    "writeFileSync(manifest, JSON.stringify({ parentPid: process.pid, childPid: child.pid }));",
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const controller = new AbortController();
  const executing = runCommand(process.execPath, [parentFile, childFile, manifest, started, gate, published], {
    cwd: root, signal: controller.signal, requireSettlement: true,
  });
  let pids;
  cleanups.push(async () => {
    controller.abort();
    await executing;
    if (pids && await isOwnedProcessRunning(pids.childPid)) {
      process.kill(pids.childPid);
      await vi.waitFor(async () => expect(await isOwnedProcessRunning(pids.childPid)).toBe(false), { timeout: PROCESS_TIMEOUT_MS });
    }
  });
  await vi.waitFor(async () => {
    pids = JSON.parse(await readFile(manifest, "utf8"));
    await access(started);
  }, { timeout: PROCESS_TIMEOUT_MS });
  return { controller, executing, pids, gate, published };
}

describe("FR-02 current lease publication authority", () => {
  it("executes the real one-shot composition with authenticated fencing and actual canonical application", async () => {
    edges.nativeTransport = true;
    const root = await directory();
    const { config, payload, repoPath } = await approvedPayload(root, { laneKind: "k8s" });
    const podKey = "b".repeat(64);
    const receiver = createL2Receiver({ config, currentLaneId: "canonical-home" });
    const registry = createWorkerRegistry({
      requireL2: true, applyL2: receiver.receive,
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key: podKey }),
    });
    const protocolSecrets = await createSecrets({ env: {} });
    const enrollment = createEnrollment({
      store: createStore(path.join(root, "pod-protocol-state")),
      secretFile: path.join(root, "pod-protocol-secrets.json"), secrets: protocolSecrets,
    });
    const http = createHttpServer({ bind: "127.0.0.1", port: 0 });
    const server = createWorkerServer({
      registry, enrollment, secrets: protocolSecrets, jobLanes: ["execution-host"],
      jobKeyFor: () => podKey,
    });
    server.attach(http);
    const { port } = await http.listen();
    cleanups.push(async () => { server.close(); registry.close(); await http.close(); });
    // A generous 30s deadline tolerates Windows filesystem setup; readiness uses actual connection/file state.
    registry.registerPending("execution-host", payload.id, { deadlineMs: Date.now() + PROCESS_TIMEOUT_MS });
    const packets = [];
    const runner = async (command, args, options = {}) => {
      packets.push({ command, args, signal: options.signal, requireSettlement: options.requireSettlement });
      if (args[0] === "clone") {
        const target = args.at(-1);
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, "inert-mcp.mjs"), "export {};\n");
        await writeFile(path.join(target, ".forge.json"), JSON.stringify({ runtimes: { ghCommand: ["inert-gh"] } }));
      }
      return { code: 0, settlementConfirmed: true, stderr: "",
        stdout: args.includes("rev-parse") ? "a".repeat(40)
          : args.includes("--count") ? "1" : command === "inert-gh" ? "https://example.test/pr/pod" : "" };
    };
    const env = {
      ...Object.fromEntries(["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC"].flatMap(
        (name) => typeof process.env[name] === "string" ? [[name, process.env[name]]] : [],
      )),
      PFORGE_CLAW_JOB_ID: payload.id, PFORGE_CLAW_LANE_ID: "execution-host", PFORGE_CLAW_JOB_KEY: podKey,
      PFORGE_CLAW_DISPATCHER_URL: `ws://127.0.0.1:${port}/claw/workers`,
      PFORGE_CLAW_JOB_DEADLINE_SECONDS: String(PROCESS_TIMEOUT_MS / 1000),
    };
    const worker = runOneShot(env, {
      workdir: path.join(root, "pod"), runner,
      finalize: (options) => finalizePodJob({ ...options, startMcp: async () => ({ stop: async () => {} }) }),
      runtimeFactory: ({ id }) => ({ id, async run({ cwd }) {
        await mkdir(path.join(cwd, ".forge", "runs", payload.id), { recursive: true });
        await writeFile(path.join(cwd, ".forge", "runs", payload.id, "pod.json"), '{"executed":"pod"}');
        return { status: "succeeded" };
      } }),
    });
    cleanups.push(async () => { registry.cancel(payload.id); await worker; });
    registry.enqueue("execution-host", { kind: "job", job: payload });
    const exitCode = await worker;
    const completion = registry.completion(payload.id);
    expect(exitCode, JSON.stringify(completion?.event?.data)).toBe(0);
    expect(completion).toMatchObject({ ok: true, applicationAck: { ok: true, jobId: payload.id, projectId: "p1" } });
    expect(await readFile(path.join(repoPath, ".forge", "runs", payload.id, "pod.json"), "utf8")).toBe('{"executed":"pod"}');
    expect(packets.find((packet) => packet.args.includes("push"))?.requireSettlement).toBe(true);
    expect(edges.launches[0].cwd).toBe(path.join(root, "pod", "repo"));
  }, PROCESS_TIMEOUT_MS);

  it("never leases publication jobs to an authenticated legacy v1 worker while preserving its reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const root = await directory();
    const { payload } = await approvedPayload(root);
    const packets = [];
    const registry = createWorkerRegistry({
      signLease: ({ worker, grant }) => signGrant({ grant, subject: worker.id, key: KEY }),
    });
    cleanups.push(() => registry.close());
    const hello = decode(encode(message("hello", {
      mode: "auth", workerId: "legacy", laneId: "execution-host", capabilities: CAPABILITIES,
    })));
    expect(hello).not.toHaveProperty("publicationFence");
    registry.connect(hello.workerId, {
      laneId: hello.laneId, capabilities: hello.capabilities, publicationFence: false,
      send(packet) {
        packets.push(packet);
        if (packet.kind !== "read") return;
        queueMicrotask(() => {
          registry.onAck({ leaseId: packet.leaseId, attempt: packet.attempt, workerId: "legacy" });
          registry.onEvent({
            leaseId: packet.leaseId, attempt: packet.attempt, workerId: "legacy",
            event: { v: 1, jobId: packet.request.requestId, seq: 1, ts: new Date(0).toISOString(),
              type: "finished", data: { status: "ok", result: { legacyRead: true } } },
          });
        });
      },
    });
    registry.enqueue("execution-host", { kind: "job", job: payload });
    expect(packets.some((packet) => packet.kind === "job")).toBe(false);
    const lane = createRemoteLane({ id: "execution-host", registry });
    await expect(lane.read({ projectId: "p1", tool: "forge_search", args: {} })).resolves.toEqual({ legacyRead: true });
    expect(packets.some((packet) => packet.kind === "job")).toBe(false);
  });

  it("refuses a signed publication job if the authenticated READY does not explicitly negotiate fencing", async () => {
    const system = await authoritySystem({ publicationReady: false, waitForRuntime: false });
    await vi.waitFor(() => expect(system.registry.completion(system.payload.id)).toMatchObject({
      ok: false, event: { data: { status: "failed", error: PUBLICATION_ERRORS.DENIED } },
    }));
    expect(system.workers.A.signal).toBeUndefined();
    expect(system.publications).toEqual([]);
  });

  it("fences the old isolated job source and actual publication after immediate signed replacement", async () => {
    const system = await authoritySystem();
    system.registry.disconnect("A");
    await vi.waitFor(() => expect(system.workers.B.signal).toBeInstanceOf(AbortSignal));
    expect.soft(system.workers.A.signal.aborted).toBe(true);
    system.workers.A.release.resolve();
    await vi.waitFor(() => expect(system.workers.A.localLane.health().running).toBe(0));
    expect(system.publications.filter((item) => item.workerId === "A")).toEqual([]);
    expect(system.workers.B.localLane.health().running).toBe(1);
    system.workers.B.release.resolve();
    await system.workers.B.agent.drain();
    await system.consuming;
    expect(system.publications.filter((item) => item.workerId === "B")).toHaveLength(2);
    expect(system.registry.completion(system.payload.id)).toMatchObject({
      ok: true, attempt: 2, applicationAck: { ok: true, jobId: system.payload.id, projectId: "p1" },
    });
    expect(await readFile(path.join(system.repoPath, ".forge", "runs", "B", "run.json"), "utf8")).toBe('{"workerId":"B"}');
    expect(await readFile(path.join(system.workers.A.cwd, ".forge", "runs", "A", "run.json"), "utf8")).toBe('{"workerId":"A"}');
  });

  it("refuses a partitioned old source's publication even when cancellation cannot reach its live runtime", async () => {
    const system = await authoritySystem();
    system.workers.A.transport.dropServerPackets = true;
    system.registry.disconnect("A");
    await vi.waitFor(() => expect(system.workers.B.signal).toBeInstanceOf(AbortSignal));
    expect(system.workers.A.signal.aborted).toBe(false);
    system.workers.A.release.resolve();
    await vi.waitFor(() => expect(system.workers.A.sent.some((packet) => packet.t === PUBLICATION_MESSAGE)).toBe(true));
    await vi.advanceTimersByTimeAsync(system.registry.ackMs * 2 + 1);
    await vi.waitFor(() => expect(system.workers.A.localLane.health().running).toBe(0));
    expect(system.publications.filter((item) => item.workerId === "A")).toEqual([]);
    expect(system.workers.B.localLane.health().running).toBe(1);
    system.workers.B.release.resolve();
    await system.workers.B.agent.drain();
    await system.consuming;
    expect(system.registry.completion(system.payload.id)).toMatchObject({ ok: true, attempt: 2 });
  });

  it("holds replacement through the real check-to-push window until the owned publication command settles", async () => {
    const system = await authoritySystem({ holdPublicationFor: "A" });
    system.workers.A.release.resolve();
    await vi.waitFor(() => expect(system.publications.some((item) => item.workerId === "A")).toBe(true));
    system.registry.disconnect("A");
    await vi.advanceTimersByTimeAsync(0);
    expect(system.workers.B.sent.some((packet) => packet.t === "ack")).toBe(false);
    expect(system.workers.B.signal).toBeUndefined();
    expect(system.workers.A.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(system.registry.ackMs + 1);
    expect(system.workers.B.signal).toBeUndefined();
    system.workers.A.settlePush.resolve();
    await vi.waitFor(() => expect(system.workers.B.signal).toBeInstanceOf(AbortSignal));
    expect(system.publications.filter((item) => item.workerId === "A")).toHaveLength(1);
    system.workers.B.release.resolve();
    await system.workers.B.agent.drain();
    await system.consuming;
    expect(system.registry.completion(system.payload.id)).toMatchObject({ ok: true, attempt: 2 });
  });

  it("fails a dead publication explicitly on timeout without releasing its unsettled replacement fence", async () => {
    const system = await authoritySystem({ holdPublicationFor: "A" });
    system.workers.A.release.resolve();
    await vi.waitFor(() => expect(system.publications.some((item) => item.workerId === "A")).toBe(true));
    system.registry.disconnect("A");
    await vi.advanceTimersByTimeAsync(system.registry.leaseMs + 1);
    await system.consuming;
    expect(system.registry.completion(system.payload.id)).toMatchObject({
      ok: false, event: { data: { status: "failed", code: "LEASE_PUBLICATION_TIMEOUT" } },
    });
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(1);
    expect(system.workers.B.sent.some((packet) => packet.t === "ack")).toBe(false);
    system.workers.A.settlePush.resolve();
    await vi.waitFor(() => expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(0));
    expect(system.workers.B.signal).toBeUndefined();
    expect(system.publications.filter((item) => item.workerId === "A")).toHaveLength(1);
  });

  it("revokes deadline-ended publication authority while retaining the physical settlement fence", async () => {
    const system = await authoritySystem({ holdPublicationFor: "A" });
    system.workers.A.release.resolve();
    await vi.waitFor(() => expect(system.publications.some((item) => item.workerId === "A")).toBe(true));
    system.registry.registerPending("execution-host", system.payload.id, { deadlineMs: system.registry.ackMs });
    await vi.advanceTimersByTimeAsync(system.registry.ackMs + 1);
    expect(system.workers.A.signal.aborted).toBe(true);
    expect(system.registry.completion(system.payload.id)).toMatchObject({ ok: false });
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(1);
    system.workers.A.settlePush.resolve();
    await vi.waitFor(() => expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(0));
    expect(system.publications.filter((item) => item.workerId === "A")).toHaveLength(1);
  });

  it("requires the actual identity-matching publication ACK rather than a lease receipt or a foreign ACK", async () => {
    const system = await authoritySystem();
    const worker = system.workers.A;
    const packet = worker.received.find((item) => item.t === "lease");
    const job = { ...packet.job, leaseGrant: packet.grant };
    worker.transport.dropPublicationAcks = true;
    let called = 0;
    const publishing = worker.agent.withPublication({ job }, async ({ confirmSettled }) => {
      called += 1;
      confirmSettled();
      return "published";
    });
    await vi.advanceTimersByTimeAsync(0);
    const actualAck = worker.received.find((item) => item.t === PUBLICATION_ACK_MESSAGE);
    expect(actualAck).toMatchObject({ ok: true, operation: PUBLICATION_OPERATIONS.BEGIN });
    worker.receive(message("heartbeat", {
      ts: 0, leases: system.registry.onHeartbeat({
        workerId: "A", leases: [{ leaseId: packet.leaseId, attempt: packet.attempt, lastSeq: 0 }],
      }),
    }));
    expect(called).toBe(0);
    for (const changed of [
      { jobId: "other" }, { leaseId: "other" }, { attempt: packet.attempt + 1 }, { requestId: "other" },
      { operation: PUBLICATION_OPERATIONS.END },
    ]) {
      worker.socket.emit("message", Buffer.from(encode(message(PUBLICATION_ACK_MESSAGE, { ...actualAck, ...changed }))), false);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(called).toBe(0);
    worker.transport.dropPublicationAcks = false;
    worker.receive(actualAck);
    await expect(publishing).resolves.toBe("published");
    expect(called).toBe(1);
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(0);
  });

  it("can release an uncertain BEGIN only when the callback never started, without inventing publication success", async () => {
    const system = await authoritySystem();
    const worker = system.workers.A;
    const packet = worker.received.find((item) => item.t === "lease");
    const job = { ...packet.job, leaseGrant: packet.grant };
    worker.transport.dropPublicationAcks = true;
    let called = false;
    const publishing = worker.agent.withPublication({ job }, async ({ confirmSettled }) => {
      called = true;
      confirmSettled();
      return "not expected";
    });
    const rejected = expect(publishing).rejects.toMatchObject({ code: PUBLICATION_ERRORS.TIMEOUT });
    await vi.advanceTimersByTimeAsync(system.registry.ackMs + 1);
    expect(called).toBe(false);
    expect(worker.sent.some((item) => item.t === PUBLICATION_MESSAGE && item.operation === PUBLICATION_OPERATIONS.END)).toBe(true);
    worker.transport.dropPublicationAcks = false;
    const releaseAck = worker.received.find((item) => item.t === PUBLICATION_ACK_MESSAGE && item.operation === PUBLICATION_OPERATIONS.END);
    worker.receive(releaseAck);
    await rejected;
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(0);
  });

  it("quarantines a callback return without physical confirmation instead of sending a success-shaped END", async () => {
    const system = await authoritySystem();
    const worker = system.workers.A;
    const packet = worker.received.find((item) => item.t === "lease");
    const job = { ...packet.job, leaseGrant: packet.grant };
    await expect(worker.agent.withPublication({ job }, async () => "unproven"))
      .rejects.toMatchObject({ code: PUBLICATION_ERRORS.DENIED });
    expect(worker.sent.some((item) => item.t === PUBLICATION_MESSAGE && item.operation === PUBLICATION_OPERATIONS.END)).toBe(false);
    system.registry.disconnect("A");
    await vi.advanceTimersByTimeAsync(system.registry.leaseMs + 1);
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(1);
    expect(system.workers.B.signal).toBeUndefined();
    expect(system.publications).toEqual([]);
  });

  it("withholds every same-project lane while an interrupted publication remains quarantined", async () => {
    const system = await authoritySystem();
    const worker = system.workers.A;
    const packet = worker.received.find((item) => item.t === "lease");
    const job = { ...packet.job, leaseGrant: packet.grant };
    await expect(worker.agent.withPublication({ job }, async () => "unproven"))
      .rejects.toMatchObject({ code: PUBLICATION_ERRORS.DENIED });
    const otherLane = [];
    system.registry.connect("other-worker", {
      laneId: "other-lane", publicationFence: true, capabilities: CAPABILITIES, send: (item) => otherLane.push(item),
    });
    system.registry.enqueue("other-lane", { kind: "job", job: { ...system.payload, id: "f0020002" } });
    expect(otherLane.some((item) => item.kind === "job")).toBe(false);
    system.registry.cancel(system.payload.id);
    expect(otherLane.some((item) => item.kind === "job")).toBe(false);
  });

  it("does not release on publication transport error, caller abort or physical uncertainty alone", async () => {
    const system = await authoritySystem();
    const worker = system.workers.A;
    const packet = worker.received.find((item) => item.t === "lease");
    const job = { ...packet.job, leaseGrant: packet.grant };
    const begun = Promise.withResolvers();
    const release = Promise.withResolvers();
    cleanups.push(() => release.resolve());
    const controller = new AbortController();
    const publishing = worker.agent.withPublication({ job, signal: controller.signal }, async () => {
      begun.resolve();
      await release.promise;
      throw new Error("inert unconfirmed transport");
    });
    const rejected = expect(publishing).rejects.toThrow("inert unconfirmed transport");
    await begun.promise;
    controller.abort();
    expect(worker.sent.some((item) => item.t === PUBLICATION_MESSAGE && item.operation === PUBLICATION_OPERATIONS.END)).toBe(false);
    release.resolve();
    await rejected;
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(1);
    expect(worker.sent.some((item) => item.t === PUBLICATION_MESSAGE && item.operation === PUBLICATION_OPERATIONS.END)).toBe(false);
  });

  it("rejects wrong worker, stale attempt and malformed publication requests before reserving authority", async () => {
    const system = await authoritySystem();
    const lease = system.workers.A.received.find((item) => item.t === "lease");
    const request = {
      leaseId: lease.leaseId, attempt: lease.attempt, jobId: system.payload.id,
      requestId: "request-1", operation: PUBLICATION_OPERATIONS.BEGIN,
    };
    for (const changed of [{ workerId: "B" }, { attempt: lease.attempt + 1 }, { leaseId: "old-lease" }, { jobId: "other" }]) {
      expect(system.registry.onPublication({ ...message(PUBLICATION_MESSAGE, request), workerId: "A", ...changed }))
        .toMatchObject({ ok: false, code: PUBLICATION_ERRORS.DENIED });
    }
    expect(() => system.registry.onPublication({
      ...message(PUBLICATION_MESSAGE, request), workerId: "A", attempt: Number.MAX_SAFE_INTEGER + 1,
    })).toThrowError(expect.objectContaining({ code: "PROTO_BAD_MESSAGE" }));
    expect(() => system.registry.onPublication({
      ...message(PUBLICATION_MESSAGE, request), workerId: "A", unexpected: true,
    })).toThrowError(expect.objectContaining({ code: "PROTO_BAD_MESSAGE" }));
    const acknowledgement = system.registry.onPublication({ ...message(PUBLICATION_MESSAGE, request), workerId: "B" });
    expect(() => system.registry.onPublication({ ...acknowledgement, workerId: "A" }))
      .toThrowError(expect.objectContaining({ code: "PROTO_BAD_MESSAGE" }));
    expect(system.registry.snapshot().byLane["execution-host"].publicationFences).toBe(0);
  });

  // File handshakes synchronize ownership; the 30s process budget accommodates Windows startup/inspection.
  it("requires native publication process-tree settlement rather than merely direct parent close", async () => {
    const system = await nativePublicationFixture();
    system.controller.abort();
    const returned = await system.executing;
    expect(returned).toMatchObject({ code: -1, settlementConfirmed: true });
    expect(await isOwnedProcessRunning(system.pids.childPid)).toBe(false);
    await writeFile(system.gate, "release inert operation");
    await expect(access(system.published)).rejects.toMatchObject({ code: "ENOENT" });
  }, PROCESS_TIMEOUT_MS);
});

describe("FR-06 authenticated worker home credentials", () => {
  it("uses the worker-store-only BYOK reference in the actual command's home-read client pool", async () => {
    const { root, repoPath, config, canary } = await workerHomeFixture();
    const packets = [];
    const registry = createWorkerRegistry();
    cleanups.push(() => registry.close());
    const connected = Promise.withResolvers();
    edges.onSocket = connected.resolve;
    const running = workerCommand.run(["--home", root]);
    cleanups.push(async () => { process.emit("SIGTERM"); await running; });
    const socket = await Promise.race([
      connected.promise,
      running.then(() => { throw new Error("Worker ended before creating its transport"); }),
    ]);
    edges.onSocket = null;
    socket.onSend = (packet) => {
      packets.push(packet);
      if (packet.t === "ack") registry.onAck({ ...packet, workerId: "home-worker" });
      if (packet.t === "event") registry.onEvent({ ...packet, workerId: "home-worker" });
    };
    registry.connect("home-worker", {
      laneId: "registered-home", capabilities: CAPABILITIES,
      send: (packet) => socket.emit("message", Buffer.from(encode(packet)), false),
    });
    const lane = createRemoteLane({ id: "registered-home", registry });
    expect(await lane.read({ projectId: "p1", tool: "forge_search", args: { query: "home" } })).toEqual({ homeRead: true });
    expect(edges.launches).toHaveLength(1);
    expect(edges.launches[0].cwd).toBe(repoPath);
    expect(edges.launches[0].env).toMatchObject({ FR06_WORKER_BYOK: canary, HOME_PROVIDER: canary });
    expect(JSON.stringify(packets)).not.toContain(canary);
    expect(config.projects[0].homeLane).toBe("registered-home");
  });

  it("retains resolver refresh and redaction while refusing a removed worker-store provider key", async () => {
    const { config, canary, secretFile } = await workerHomeFixture();
    const secrets = await createSecrets({ file: secretFile, env: {} });
    const clients = createProjectClients({
      config, registry: { ...createRegistry(config), resolveMcpLaunch },
      currentLaneId: "registered-home", secrets, env: {},
    });
    cleanups.push(() => clients.closeAll());
    await clients.call("p1", "forge_search");
    const rotated = "inert-refreshed-worker-store-reference";
    await writeFile(secretFile, JSON.stringify({ PFORGE_CLAW_WORKER_SECRET: KEY, FR06_WORKER_BYOK: rotated }));
    await secrets.refresh();
    await clients.call("p1", "forge_search");
    expect(edges.launches.map((launch) => launch.env.HOME_PROVIDER)).toEqual([canary, rotated]);
    expect(secrets.redact(`${canary}|${rotated}`)).not.toContain(canary);
    expect(secrets.redact(`${canary}|${rotated}`)).not.toContain(rotated);
    await writeFile(secretFile, JSON.stringify({ PFORGE_CLAW_WORKER_SECRET: KEY }));
    await secrets.refresh();
    await expect(clients.call("p1", "forge_search")).rejects.toMatchObject({ code: "BYOK_KEY_MISSING" });
    expect(edges.launches).toHaveLength(2);
  });
});
