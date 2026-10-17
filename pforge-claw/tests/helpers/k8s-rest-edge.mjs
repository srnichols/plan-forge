import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createK8sClient } from "../../src/k8s/api.mjs";
import { fixtureSystemEnvironment } from "./k8s-worker.mjs";
import {
  FIXTURE_CA_ENV, FIXTURE_CONTEXT_ENV, FIXTURE_HTTP_STATUS, FIXTURE_NAMESPACE_ENV, FIXTURE_RUNTIME_ENV, HELPER_ROOT, validateFixtureJob,
} from "./k8s-fixture-common.mjs";

function respond(callback, status, contents) {
  const response = new PassThrough();
  response.statusCode = status;
  callback(response);
  response.end(JSON.stringify(contents));
}

const SECRET_BYTES = 32;

function podEnvironment(spec) {
  return Object.fromEntries(spec.spec.template.spec.containers[0].env.map((entry) => [
    entry.name, entry.value ?? ({
      PFORGE_CLAW_GH_TOKEN: "disposable-external-git-edge",
      [FIXTURE_RUNTIME_ENV]: randomBytes(SECRET_BYTES).toString("hex"),
    })[entry.name],
  ]).filter(([, value]) => value !== undefined));
}

/** In-process Kubernetes REST/process edge; job status derives only from the real one-shot exit. */
export function createK8sRestEdge({
  namespace, context = "kind-fixture", home, runWorker, onVerified, onCommand, beforeWorker,
  ca = "disposable-public-ca-not-used-on-loopback",
} = {}) {
  const jobs = new Map();
  const watchStreams = new Map();
  const calls = [];
  const workers = new Set();

  async function startWorker(spec) {
    const jobId = validateFixtureJob(spec.metadata.labels["pforge-claw/job-id"]);
    const workdir = path.join(home, "pods", jobId);
    await mkdir(workdir, { recursive: true });
    const env = podEnvironment(spec);
    env[FIXTURE_NAMESPACE_ENV] = namespace;
    env[FIXTURE_CONTEXT_ENV] = context;
    env[FIXTURE_CA_ENV] = ca;
    env.HOME = path.join(workdir, "home");
    env.PFORGE_CLAW_HOME = path.join(workdir, "claw");
    await beforeWorker?.({ jobId, workdir });
    const code = await runWorker({ env, workdir, onVerified, onCommand });
    spec.status = code === 0 ? { succeeded: 1, conditions: [{ type: "Complete", status: "True" }] }
      : { failed: 1, conditions: [{ type: "Failed", status: "True" }] };
    for (const stream of watchStreams.get(spec.metadata.name) ?? []) stream.end(JSON.stringify({ type: "MODIFIED", object: spec }) + "\n");
  }

  function request(options, callback) {
    const pending = new EventEmitter();
    let body = "";
    pending.write = (bytes) => { body += bytes; };
    pending.destroy = () => pending.emit("close");
    pending.end = () => {
      const url = new URL(options.path, "https://example.com");
      const segments = url.pathname.split("/");
      if (segments[5] !== namespace) { respond(callback, FIXTURE_HTTP_STATUS.FORBIDDEN, {}); return; }
      const name = segments[7];
      calls.push({ method: options.method, path: options.path });
      if (options.method === "POST") {
        const spec = JSON.parse(body);
        spec.metadata.namespace = namespace;
        spec.metadata.resourceVersion = "1";
        jobs.set(spec.metadata.name, spec);
        respond(callback, FIXTURE_HTTP_STATUS.CREATED, spec);
        const worker = new Promise((resolve) => setImmediate(resolve)).then(() => startWorker(spec));
        workers.add(worker);
        void worker.finally(() => workers.delete(worker)).catch(() => {
          spec.status = { failed: 1, conditions: [{ type: "Failed", status: "True" }] };
          for (const stream of watchStreams.get(spec.metadata.name) ?? []) stream.end(JSON.stringify({ type: "MODIFIED", object: spec }) + "\n");
        });
      } else if (options.method === "DELETE") {
        jobs.delete(name);
        respond(callback, FIXTURE_HTTP_STATUS.OK, { kind: "Status", status: "Success" });
      } else if (url.searchParams.get("watch") === "true") {
        const selected = url.searchParams.get("fieldSelector").slice("metadata.name=".length);
        const stream = new PassThrough();
        stream.statusCode = FIXTURE_HTTP_STATUS.OK;
        const watchers = watchStreams.get(selected) ?? new Set();
        watchers.add(stream);
        watchStreams.set(selected, watchers);
        stream.once("close", () => watchers.delete(stream));
        pending.destroy = () => stream.destroy();
        callback(stream);
        const job = jobs.get(selected);
        if (job?.status) stream.end(JSON.stringify({ type: "MODIFIED", object: job }) + "\n");
      } else if (name) respond(callback, jobs.has(name) ? FIXTURE_HTTP_STATUS.OK : FIXTURE_HTTP_STATUS.NOT_FOUND, jobs.get(name) ?? {});
      else respond(callback, FIXTURE_HTTP_STATUS.OK, { items: [...jobs.values()] });
    };
    return pending;
  }

  return {
    calls, job: (name) => structuredClone(jobs.get(name)),
    apiFactory: () => createK8sClient({
      host: "example.com", request,
      readFile: async (file) => file.endsWith("token") ? "fixture-service-account" : Buffer.from("fixture-ca"),
    }),
    async drain() {
      await Promise.allSettled([...workers]);
      for (const streams of watchStreams.values()) for (const stream of streams) stream.destroy();
    },
  };
}

/** External worker-process edge exercises the image's actual CLI adapter and TLS child startup. */
export function spawnK8sFixtureWorker({ env, workdir }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      path.join(HELPER_ROOT, "k8s-worker.mjs"), "claw", "worker", "--one-shot", "--job", env.PFORGE_CLAW_JOB_ID,
    ], { cwd: workdir, env: { ...fixtureSystemEnvironment(), ...env }, stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}
