import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runOneShot, leasedJob } from "../../src/cli/worker.mjs";
import { finalizePodJob } from "../../src/lanes/k8s-job-lane.mjs";
import { executionConfigFor } from "../../src/jobs/execution-choices.mjs";
import { canonical } from "../../src/protocol/lease-grant.mjs";
import { createK8sProcessEdge } from "./k8s-process-edge.mjs";
import { startFixturePodMcp } from "./k8s-project-http.mjs";
import { writeFixtureRuntimeArtifacts } from "./k8s-runtime-artifacts.mjs";
import {
  assertFixturePath, callJobFixture, FIXTURE_CA_ENV, FIXTURE_CONTEXT_ENV,
  FIXTURE_NAMESPACE_ENV, FIXTURE_RECEIPT_FILE, FIXTURE_RUNTIME_ENV, validateFixtureScope, validateFixtureTransport,
} from "./k8s-fixture-common.mjs";

const SYSTEM_ENV = new Set(["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "LANG", "TZ"]);
const JOB_ENV = new Set([
  "PFORGE_CLAW_JOB_ID", "PFORGE_CLAW_LANE_ID", "PFORGE_CLAW_JOB_KEY",
  "PFORGE_CLAW_DISPATCHER_URL", "PFORGE_CLAW_JOB_DEADLINE_SECONDS",
  "PFORGE_CLAW_GH_TOKEN", "HOME", "PFORGE_CLAW_HOME",
  FIXTURE_CA_ENV, FIXTURE_CONTEXT_ENV, FIXTURE_NAMESPACE_ENV, FIXTURE_RUNTIME_ENV,
]);
const TLS_CHILD_FLAG = "--fixture-tls-child";
const CLI_ARGUMENT_COUNT = 5;

/** Do not inherit operator provider, Git, Telegram or worker credentials into fixtures. */
export function fixtureWorkerEnvironment(source = {}) {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) =>
    typeof value === "string" && (SYSTEM_ENV.has(name) || JOB_ENV.has(name))));
}

/** Carry only OS process-launch settings into dispatcher-owned external fixtures. */
export function fixtureSystemEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) =>
    typeof value === "string" && SYSTEM_ENV.has(name)));
}

function verifiedChoices({ job, config, env }) {
  const verified = leasedJob(job, {
    subject: `job:${env.PFORGE_CLAW_JOB_ID}`, laneId: env.PFORGE_CLAW_LANE_ID,
    key: env.PFORGE_CLAW_JOB_KEY, expectJobId: env.PFORGE_CLAW_JOB_ID,
  });
  const approved = executionConfigFor({ job: verified, config });
  const project = approved.projects.find((entry) => entry.id === verified.projectId);
  const choices = {
    runtime: verified.runtime,
    ...(verified.provider ? { provider: verified.provider } : {}),
    models: project.models, bootstrap: project.bootstrap, repository: verified.project.repo,
    ...(verified.quorum !== undefined ? { quorum: verified.quorum } : {}),
    ...(verified.resumeFrom !== undefined ? { resumeFrom: verified.resumeFrom } : {}),
  };
  return {
    jobId: verified.id, projectId: verified.projectId, laneId: env.PFORGE_CLAW_LANE_ID,
    oneShot: true, leaseGrantVerified: true, choices,
    choiceDigest: createHash("sha256").update(canonical(choices)).digest("hex"),
  };
}

/** Real one-shot grant/config/runner/protocol/finalizer execution with external edges only. */
export async function runK8sWorker({
  env: suppliedEnv = process.env, workdir = "/work", onVerified = async () => {}, onCommand, runner,
} = {}) {
  const env = fixtureWorkerEnvironment(suppliedEnv);
  validateFixtureScope({ namespace: env[FIXTURE_NAMESPACE_ENV], context: env[FIXTURE_CONTEXT_ENV] });
  validateFixtureTransport({ namespace: env[FIXTURE_NAMESPACE_ENV], url: env.PFORGE_CLAW_DISPATCHER_URL });
  await mkdir(workdir, { recursive: true });
  const processEdge = runner ?? createK8sProcessEdge({ env, workdir, onCommand });
  return runOneShot(env, {
    jobId: env.PFORGE_CLAW_JOB_ID, workdir, runner: processEdge,
    finalize: (options) => finalizePodJob({ ...options, startMcp: startFixturePodMcp }),
    runtimeFactory: async ({ id, job, config }) => {
      const receipt = verifiedChoices({ job, config, env });
      await onVerified(structuredClone(receipt));
      const receiptPath = await assertFixturePath(workdir, path.join(workdir, FIXTURE_RECEIPT_FILE));
      await writeFile(receiptPath, JSON.stringify(receipt), { mode: 0o600 });
      await callJobFixture({ env, route: "receipt", body: receipt });
      return {
        id,
        async run(turn) {
          turn.signal?.throwIfAborted();
          await writeFixtureRuntimeArtifacts({ cwd: turn.cwd, receipt, workdir });
          turn.emit?.("progress", { percent: 100, text: "Disposable fixture artifact written" });
          return { status: "succeeded", usage: { costUSD: null, premiumRequests: null } };
        },
      };
    },
  });
}

async function runTlsChild({ env, args, workdir }) {
  const caFile = path.join(workdir, ".fixture-ca.pem");
  await mkdir(workdir, { recursive: true });
  await assertFixturePath(workdir, caFile);
  await writeFile(caFile, env[FIXTURE_CA_ENV], { mode: 0o600 });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1], ...args, TLS_CHILD_FLAG], {
      env: { ...env, NODE_EXTRA_CA_CERTS: caFile }, cwd: workdir, stdio: "inherit", windowsHide: true,
    });
    const forward = () => child.kill("SIGTERM");
    process.once("SIGTERM", forward);
    process.once("SIGINT", forward);
    const finish = (code) => {
      process.removeListener("SIGTERM", forward);
      process.removeListener("SIGINT", forward);
      resolve(code);
    };
    child.once("error", () => finish(1));
    child.once("close", (code) => finish(code ?? 1));
  });
}

function workerCliArguments(args, env) {
  const filtered = args.filter((argument) => argument !== TLS_CHILD_FLAG);
  if (filtered[0] !== "claw" || filtered[1] !== "worker" || filtered[2] !== "--one-shot"
    || filtered[3] !== "--job" || filtered[4] !== env.PFORGE_CLAW_JOB_ID || filtered.length !== CLI_ARGUMENT_COUNT) {
    throw new Error("K8S_E2E_WORKER_ARGS_INVALID");
  }
  return filtered;
}

async function main(args) {
  const env = fixtureWorkerEnvironment(process.env);
  const workdir = path.dirname(env.PFORGE_CLAW_HOME ?? "/work/claw");
  const filtered = workerCliArguments(args, env);
  if (env.PFORGE_CLAW_DISPATCHER_URL?.startsWith("wss:") && !args.includes(TLS_CHILD_FLAG)) {
    if (!env[FIXTURE_CA_ENV]?.startsWith("-----BEGIN CERTIFICATE-----")) throw new Error("K8S_E2E_CA_REQUIRED");
    return runTlsChild({ env, args: filtered, workdir });
  }
  return runK8sWorker({ env, workdir });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch {
    process.stderr.write("K8S_E2E_WORKER_FAILED\n");
    process.exitCode = 1;
  }
}
