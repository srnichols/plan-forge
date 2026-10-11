import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { verifyScenarioEvidence } from "../scripts/k8s-e2e.mjs";
import { startK8sDispatcher } from "./helpers/k8s-dispatcher.mjs";
import { generateFixtureTls } from "./helpers/k8s-fixture-tls.mjs";
import { createK8sRestEdge } from "./helpers/k8s-rest-edge.mjs";
import { collectScenarioDiagnostics, runK8sScenario } from "./helpers/k8s-scenario.mjs";
import { fixtureSystemEnvironment } from "./helpers/k8s-worker.mjs";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAMESPACE = "pforge-claw-e2e-fixture";
const CONTEXT = "kind-fixture";
const WORKER_IMAGE = "registry.example/claw/worker:test";
const TEST_TIMEOUT_MS = 20_000;
const SAMPLE_INTERVAL_MS = 1000;
const MAX_STAGE_RECORDS = 128;
const MAX_STDERR_BUFFER = 4096;
const IPV4_FAMILY = 4;
const IPV6_FAMILY = 6;
const STAGE_PREFIX = "CLAW_WINDOWS_FLOOR_STAGE ";
const STAGE_EVENTS = new Set([
  "observer-ready", "child-spawn", "child-error", "child-close", "tls-start",
  "tls-secure", "tls-error", "http-start", "http-headers", "http-error",
  "uncaught-error", "before-exit", "process-exit", "worker-spawn", "worker-close",
  "tls-lookup", "tls-connection-attempt", "tls-connect-failed",
]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const running = [];
const evidenceDirectory = process.env.PFORGE_CLAW_WINDOWS_FLOOR_EVIDENCE;

function diagnosticFile(name) {
  if (!evidenceDirectory) return null;
  const root = path.resolve(evidenceDirectory);
  const relative = path.relative(process.cwd(), root);
  if (relative.startsWith("..") || path.isAbsolute(relative)
    || !/^\.claw-windows22-[a-z0-9-]+$/.test(path.basename(root))) {
    throw new Error("WINDOWS_FLOOR_EVIDENCE_SCOPE_INVALID");
  }
  return path.join(root, name);
}

async function recordEvidence(record) {
  const file = diagnosticFile(`attempt2-${process.version}.jsonl`);
  if (file) await appendFile(file, JSON.stringify(record) + "\n", { mode: 0o600 });
}

function safeErrorCode(code) {
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : null;
}

function transportFields(input) {
  return {
    ...(LOOPBACK_ADDRESSES.has(input.address) ? { address: input.address } : {}),
    ...([IPV4_FAMILY, IPV6_FAMILY].includes(input.family) ? { family: input.family } : {}),
    ...(["verbatim", "ipv4first", "ipv6first"].includes(input.dnsOrder) ? { dnsOrder: input.dnsOrder } : {}),
  };
}

function stageRecord(input) {
  if (!STAGE_EVENTS.has(input?.event) || !Number.isSafeInteger(input.pid) || input.pid <= 0) return null;
  const record = { event: input.event, pid: input.pid, ...transportFields(input) };
  if (Number.isSafeInteger(input.childPid) && input.childPid > 0) record.childPid = input.childPid;
  if (Number.isInteger(input.exitCode)) record.exitCode = input.exitCode;
  if (safeErrorCode(input.code)) record.code = input.code;
  for (const name of ["authorized", "extraCaPresent", "extraCaReadable", "autoSelectFamily"]) {
    if (typeof input[name] === "boolean") record[name] = input[name];
  }
  if (["tls-child", "worker", "external-command", "http", "tls"].includes(input.role)) record.role = input.role;
  return record;
}

function observedWorker(run) {
  return ({ env, workdir }) => new Promise((resolve) => {
    const args = [
      path.join(PACKAGE_ROOT, "tests", "helpers", "k8s-worker.mjs"),
      "claw", "worker", "--one-shot", "--job", env.PFORGE_CLAW_JOB_ID,
    ];
    const observer = diagnosticFile("transport-observer.mjs");
    if (observer) args.unshift("--import", pathToFileURL(observer).href);
    const child = spawn(process.execPath, args, {
      cwd: workdir, env: { ...fixtureSystemEnvironment(), ...env },
      stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    });
    run.child = child;
    run.stages.push({ event: "worker-spawn", pid: process.pid, childPid: child.pid });
    let buffered = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      buffered = (buffered + chunk).slice(-MAX_STDERR_BUFFER);
      while (buffered.includes("\n")) {
        const index = buffered.indexOf("\n");
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        if (!line.startsWith(STAGE_PREFIX) || run.stages.length >= MAX_STAGE_RECORDS) continue;
        try {
          const stage = stageRecord(JSON.parse(line.slice(STAGE_PREFIX.length)));
          if (stage) run.stages.push(stage);
        } catch {
          run.invalidStageRecords += 1;
        }
      }
    });
    child.once("error", (error) => {
      run.spawnError = safeErrorCode(error.code);
      resolve(1);
    });
    child.once("close", (code) => {
      run.stages.push({ event: "worker-close", pid: process.pid, childPid: child.pid, exitCode: code });
      resolve(code ?? 1);
    });
  });
}

async function sample(run, stage) {
  const diagnostics = await collectScenarioDiagnostics({ fixture: run.fixture });
  const encoded = JSON.stringify(diagnostics);
  if (stage === "poll" && encoded === run.lastSnapshot) return;
  run.lastSnapshot = encoded;
  await recordEvidence({
    stage, node: process.version, diagnostics,
    stages: run.stages.splice(0), invalidStageRecords: run.invalidStageRecords,
    nativeWorkerClosed: run.child?.exitCode !== null && run.child?.exitCode !== undefined,
  });
}

function scheduleSample(run) {
  run.pendingSample = run.pendingSample.then(() => sample(run, "poll"));
}

afterEach(async () => {
  for (const run of running.splice(0).reverse()) {
    clearInterval(run.sampler);
    await run.pendingSample;
    await sample(run, "before-source-stop");
    await run.fixture.stop();
    await recordEvidence({ stage: "source-stopped", node: process.version });
    await run.edge.drain();
    await rm(run.home, { recursive: true, force: true });
    await recordEvidence({ stage: "owned-home-removed", node: process.version });
  }
});

describe("Windows Node floor native trusted-TLS settlement", () => {
  it("requires canonical current-job ACK and real CLI exit before removing the owned pod", async () => {
    const home = await mkdtemp(path.join(PACKAGE_ROOT, "tests", ".k8s-fixture-"));
    const run = { home, stages: [], invalidStageRecords: 0, pendingSample: Promise.resolve() };
    const tls = await generateFixtureTls(NAMESPACE);
    const edge = createK8sRestEdge({
      namespace: NAMESPACE, home, ca: tls.ca, runWorker: observedWorker(run),
    });
    const fixture = await startK8sDispatcher({
      home, namespace: NAMESPACE, context: CONTEXT, listenPort: 0, workerImage: WORKER_IMAGE,
      k8sApiFactory: edge.apiFactory, tls: { cert: tls.cert, key: tls.key, port: 0, loopback: true },
    });
    Object.assign(run, { edge, fixture });
    running.push(run);
    // Real transports retain the existing 20s test / 10s hook / 60s scenario tolerance.
    run.sampler = setInterval(scheduleSample, SAMPLE_INTERVAL_MS, run);
    const proof = await runK8sScenario({ control: fixture.control, output: false });
    expect(verifyScenarioEvidence({
      namespace: NAMESPACE, proof, job: edge.job(proof.jobName), workerImage: WORKER_IMAGE,
    })).toBe(proof.jobName);
    expect(proof.applicationAck.ok).toBe(true);
    expect(proof.expectedL2Files).toEqual(proof.canonicalL2Files);
    expect(proof.canonicalQueue.sha256).toBe(proof.canonicalQueue.expectedSha256);
    expect(proof.jobEvents.at(-1).data.l2).toEqual(proof.applicationAck);
    await edge.drain();
    expect(run.child.exitCode).toBe(0);
    await sample(run, "canonical-ack-and-native-exit");
  }, TEST_TIMEOUT_MS);
});
