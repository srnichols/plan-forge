import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../src/protocol/lease-grant.mjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDevOverlay, materializeDevConfig, validateE2eNamespace, writeDevOverlay,
  FIXTURE_CA_ENV, FIXTURE_SECRET_NAME, FIXTURE_TLS_CERT_ENV, FIXTURE_TLS_KEY_ENV,
} from "../scripts/k8s-e2e-overlay.mjs";
import { missingFixtureContracts, runK8sE2e, verifyScenarioEvidence } from "../scripts/k8s-e2e.mjs";
import { buildJobSpec } from "../src/lanes/k8s-job-lane.mjs";
import { fixtureSystemEnvironment } from "./helpers/k8s-worker.mjs";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_ROOT = path.join(PACKAGE_ROOT, "tests");
const NAMESPACE = "pforge-claw-e2e-fixture";
const DISPATCHER_IMAGE = "registry.example/claw/dispatcher:test";
const WORKER_IMAGE = "registry.example/claw/worker:test";
const PROCESS_TIMEOUT_MS = 30_000;
const MAX_CLI_DIAGNOSTIC_BYTES = 2048;
const COMMAND_OUTPUT_LIMIT_BYTES = 1_048_576;
const CI_NAMESPACE = "pforge-claw-e2e-ci";
const CI_CONTEXT = "kind-kind";
const CI_DISPATCHER_IMAGE = "pforge-claw-k8s-fixture-dispatcher:ci";
const CI_WORKER_IMAGE = "pforge-claw-k8s-fixture-worker:ci";
const DISPATCHER_HOST = `pforge-claw-dispatcher.${CI_NAMESPACE}.svc`;
const NEGATIVE_HOST = "pforge-claw-egress-target";
const directories = [];
const servers = [];

function deployedFixture() {
  const identity = { jobId: "j1", projectId: "fixture-1", deltaId: "j1:final", sha256Total: createHash("sha256").update("fixture transfer").digest("hex") };
  const ack = { ...identity, ok: true };
  const file = { path: "runs/j1/run.json", sha256: createHash("sha256").update("fixture canonical bytes").digest("hex") };
  const proof = {
    namespace: NAMESPACE, laneId: "k8s-dev", approvalConsumed: true, leaseGrantVerified: true,
    oneShot: true, jobId: "j1", jobName: "pforge-claw-j1", prUrl: "https://example.com/pr/1",
    transfer: identity, applicationAck: ack, expectedL2Files: [file], canonicalL2Files: [{ ...file }],
    canonicalQueue: { path: "openbrain-queue.jsonl", sha256: file.sha256, expectedSha256: file.sha256, records: 1 },
    signedChoices: {
      runtime: "openai", provider: { type: "openai", keySecret: "PFORGE_CLAW_FIXTURE_RUNTIME_TOKEN", endpoint: "https://example.com/runtime" },
      models: { chat: "fixture-chat", work: "fixture-work" },
      repository: { url: "https://example.com/fixture-1.git", defaultBranch: "main" },
      bootstrap: {
        copy: [".forge.json"],
        env: ["PFORGE_CLAW_FIXTURE_NAMESPACE", "PFORGE_CLAW_FIXTURE_CONTEXT", "PFORGE_CLAW_FIXTURE_RUNTIME_TOKEN", "PFORGE_CLAW_FIXTURE_CA"],
        install: "none",
      },
    },
    jobEvents: [
      { jobId: "j1", seq: 1, type: "started", data: {} },
      { jobId: "j1", seq: 2, type: "artifact", data: { kind: "pr", url: "https://example.com/pr/1" } },
      { jobId: "j1", seq: 3, type: "artifact", data: { kind: "l2-delta", ...identity } },
      { jobId: "j1", seq: 4, type: "finished", data: { status: "succeeded", l2: ack } },
    ],
  };
  proof.choiceDigest = createHash("sha256").update(canonical(proof.signedChoices)).digest("hex");
  const job = buildJobSpec({
    job: { id: proof.jobId, projectId: identity.projectId },
    project: { id: identity.projectId, image: WORKER_IMAGE },
    lane: { id: "k8s-dev", kind: "k8s", k8s: { namespace: NAMESPACE, deadlineSeconds: 120, ttlSecondsAfterFinished: 10 } },
    dispatcherUrl: "wss://example.com/claw/workers", jobKey: "b".repeat(64),
  });
  job.metadata.namespace = NAMESPACE;
  job.status = { succeeded: 1 };
  return { proof, job };
}

async function workspace() {
  const directory = await mkdtemp(path.join(TEST_ROOT, ".claw-k8s-render-"));
  directories.push(directory);
  return directory;
}

function renderedResource(render, kind, name) {
  const document = render.split(/^---\s*$/m).find((entry) =>
    entry.split("\n").includes(`kind: ${kind}`) && entry.split("\n").includes(`  name: ${name}`));
  if (!document) throw new Error(`Rendered fixture resource missing: ${kind}/${name}`);
  return document;
}

function renderedCommand(document) {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => line.trim() === "- command:");
  if (start === -1) throw new Error("Rendered fixture command missing");
  const indent = lines[start].indexOf("-") + 2;
  const argv = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith(" ".repeat(indent) + "- ")) argv.push(line.trim().slice(2));
    else if (line.startsWith(" ".repeat(indent + 2))) argv[argv.length - 1] += " " + line.trim();
    else break;
  }
  return argv.map((value) => {
    if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    return value.startsWith('"') ? JSON.parse(value) : value;
  });
}

function renderedSecretValue(document, key) {
  const prefix = `  ${key}: `;
  const lines = document.split("\n");
  const index = lines.findIndex((entry) => entry.startsWith(prefix));
  if (index === -1) throw new Error(`Rendered fixture Secret field missing: ${key}`);
  let encoded = lines[index].slice(prefix.length);
  if (/^[|>]/.test(encoded)) {
    const chunks = [];
    for (const line of lines.slice(index + 1)) {
      if (!line.startsWith("    ")) break;
      chunks.push(line.trim());
    }
    encoded = chunks.join("");
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}

async function renderCiOverlay() {
  const destination = await workspace();
  await writeDevOverlay({
    namespace: CI_NAMESPACE, context: CI_CONTEXT, destination,
    dispatcherImage: CI_DISPATCHER_IMAGE, workerImage: CI_WORKER_IMAGE,
  });
  const render = spawnSync("kubectl", ["kustomize", destination], { encoding: "utf8", timeout: PROCESS_TIMEOUT_MS });
  expect(render.error).toBeUndefined();
  expect(render.status).toBe(0);
  return render.stdout;
}

async function controlledProbeEdge(render, status = 200) {
  const secret = renderedResource(render, "Secret", FIXTURE_SECRET_NAME);
  const requests = { secure: 0, plain: 0 };
  const secure = createHttpsServer({
    cert: renderedSecretValue(secret, FIXTURE_TLS_CERT_ENV),
    key: renderedSecretValue(secret, FIXTURE_TLS_KEY_ENV),
  }, (_request, response) => {
    requests.secure++;
    response.writeHead(status);
    response.end("trusted fixture dispatcher");
  });
  const plain = createHttpServer((_request, response) => {
    requests.plain++;
    response.writeHead(200);
    response.end("HTTP negative-control target");
  });
  for (const server of [secure, plain]) {
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  }
  return {
    ca: renderedSecretValue(secret, FIXTURE_CA_ENV), requests,
    securePort: secure.address().port, plainPort: plain.address().port,
  };
}

async function runRenderedCommand({ command, edge, ca, denyNegative = true }) {
  expect(command.slice(0, 3)).toEqual(["node", "--input-type=module", "-e"]);
  const directory = await workspace();
  const preload = path.join(directory, "probe-network-edge.cjs");
  await writeFile(preload, `
const https = require("node:https");
const dns = require("node:dns/promises");
const { syncBuiltinESMExports } = require("node:module");
const nativeGet = https.get;
const nativeFetch = global.fetch;
https.get = (url, options, callback) => {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== ${JSON.stringify(DISPATCHER_HOST)} || target.pathname !== "/healthz") throw new Error("Unexpected fixture HTTPS endpoint");
  target.port = ${JSON.stringify(String(edge.securePort))};
  return nativeGet(target, { ...options, lookup: (_host, options, callback) =>
    options.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4)
  }, callback);
};
dns.lookup = async (host) => {
  if (host !== ${JSON.stringify(NEGATIVE_HOST)}) throw new Error("Unexpected fixture DNS endpoint");
  return { address: "127.0.0.1", family: 4 };
};
global.fetch = (url, options) => {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.pathname !== "/healthz") throw new Error("Unexpected fixture HTTP endpoint");
  if (target.hostname === ${JSON.stringify(NEGATIVE_HOST)}) {
    if (${JSON.stringify(denyNegative)}) return Promise.reject(new Error("Controlled negative-target denial"));
    target.port = ${JSON.stringify(String(edge.plainPort))};
  } else if (["pforge-claw-dispatcher", ${JSON.stringify(DISPATCHER_HOST)}].includes(target.hostname)) {
    target.port = ${JSON.stringify(String(edge.securePort))};
  } else throw new Error("Unexpected fixture HTTP host");
  target.hostname = "127.0.0.1";
  return nativeFetch(target, options);
};
syncBuiltinESMExports();
`, { mode: 0o600 });
  const env = { ...fixtureSystemEnvironment(), NODE_OPTIONS: `--require ${JSON.stringify(preload)}` };
  if (ca !== undefined) env[FIXTURE_CA_ENV] = ca;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, command.slice(1), {
      cwd: PACKAGE_ROOT, env, stdio: ["ignore", "pipe", "pipe"], timeout: PROCESS_TIMEOUT_MS, windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function failedNativeCli(failures) {
  const directory = await workspace();
  const preload = path.join(directory, "native-command-edge.cjs");
  const trace = path.join(directory, "commands.jsonl");
  await writeFile(preload, `
const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");
const { appendFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const nativeSpawn = childProcess.spawn;
const failures = ${JSON.stringify(failures)};
childProcess.spawn = (command, args, options) => {
  const offset = args[0] === "--context" ? 2 : 0;
  const operation = command === "kind" ? "image-load" : ({
    "get namespace": "namespace-check", "create namespace": "namespace-create",
    "apply -k": "overlay-apply", "delete namespace": "namespace-cleanup",
  })[args.slice(offset, offset + 2).join(" ")];
  if (!operation || !["kubectl", "kind"].includes(command)) throw new Error("Unexpected native command");
  appendFileSync(${JSON.stringify(trace)}, JSON.stringify(operation) + "\\n");
  const reply = failures[operation] ?? { code: 0, stdout: "", stderr: "" };
  if (reply.missingExecutable) return nativeSpawn(${JSON.stringify(path.join(directory, "fixture-missing-native-credential-canary"))}, [], options);
  const replyFile = join(${JSON.stringify(directory)}, operation + ".json");
  writeFileSync(replyFile, JSON.stringify(reply), { mode: 0o600 });
  return nativeSpawn(process.execPath, ["-e",
    "const reply = JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')); process.stdout.write(reply.stdout); process.stderr.write(reply.stderr); process.exitCode = reply.code;",
    replyFile,
  ], { ...options, env: { ...process.env, NODE_OPTIONS: "" } });
};
syncBuiltinESMExports();
`);
  const execution = spawnSync(process.execPath, [
    path.join(PACKAGE_ROOT, "scripts", "k8s-e2e.mjs"),
    "--namespace", CI_NAMESPACE, "--context", CI_CONTEXT,
    "--dispatcher-fixture-image", CI_DISPATCHER_IMAGE,
    "--worker-fixture-image", CI_WORKER_IMAGE,
  ], {
    cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS,
    env: { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` },
  });
  expect(execution.error).toBeUndefined();
  expect(execution.status).toBe(1);
  expect(execution.stdout).toBe("");
  return {
    stderr: execution.stderr,
    commands: (await readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line)),
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  }));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("generated Kubernetes probe trusted HTTPS contract", () => {
  it("renders CA-trusted dispatcher HTTPS while preserving the HTTP control and default deny", async () => {
    const render = await renderCiOverlay();
    const probe = renderedResource(render, "Job", "pforge-claw-egress-probe");
    const control = renderedResource(render, "Job", "pforge-claw-egress-control");
    const dispatcher = renderedResource(render, "Deployment", "pforge-claw-dispatcher");
    const deny = renderedResource(render, "NetworkPolicy", "pforge-claw-jobs-default-deny");
    const code = renderedCommand(probe).at(-1);
    expect(dispatcher).toContain("scheme: HTTPS");
    expect(code).toContain(`https://${DISPATCHER_HOST}:3190/healthz`);
    expect(code).toContain(FIXTURE_CA_ENV);
    expect(probe).toMatch(new RegExp(`- name: ${FIXTURE_CA_ENV}\\n\\s+valueFrom:\\n\\s+secretKeyRef:\\n\\s+key: ${FIXTURE_CA_ENV}\\n\\s+name: ${FIXTURE_SECRET_NAME}`));
    expect(Boolean(renderedSecretValue(renderedResource(render, "Secret", FIXTURE_SECRET_NAME), FIXTURE_CA_ENV))).toBe(true);
    expect(code).toContain(`http://${NEGATIVE_HOST}:3190/healthz`);
    expect(renderedCommand(control).at(-1)).toContain(`http://${NEGATIVE_HOST}:3190/healthz`);
    expect(control).not.toContain("pforge-claw/role: job");
    expect(deny).toMatch(/egress:\s*\[\]/);
    expect(deny).toMatch(/ingress:\s*\[\]/);
    expect(probe).toContain("pforge-claw/role: job");
    expect(code).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|rejectUnauthorized:\s*false/);
  });

  it("executes the rendered control over HTTP and the rendered probe over genuinely trusted TLS", async () => {
    const render = await renderCiOverlay();
    const edge = await controlledProbeEdge(render);
    const control = await runRenderedCommand({
      command: renderedCommand(renderedResource(render, "Job", "pforge-claw-egress-control")),
      edge, denyNegative: false,
    });
    expect(control.status).toBe(0);
    expect(edge.requests.plain).toBe(1);
    const probe = await runRenderedCommand({
      command: renderedCommand(renderedResource(render, "Job", "pforge-claw-egress-probe")),
      edge, ca: edge.ca,
    });
    expect(probe.status).toBe(0);
    expect(edge.requests).toEqual({ secure: 1, plain: 1 });
    expect(probe.stdout).toContain("negative target denied");
  });

  it.each(["missing", "wrong"])("fails closed with %s CA rather than counting TLS failure as denial", async (kind) => {
    const render = await renderCiOverlay();
    const edge = await controlledProbeEdge(render);
    const { generateFixtureTls } = await import("./helpers/k8s-fixture-tls.mjs");
    const ca = kind === "wrong" ? (await generateFixtureTls(CI_NAMESPACE)).ca : undefined;
    const probe = await runRenderedCommand({
      command: renderedCommand(renderedResource(render, "Job", "pforge-claw-egress-probe")), edge, ca,
    });
    expect(probe.status).not.toBe(0);
    expect(probe.stdout).toBe("");
    expect(edge.requests).toEqual({ secure: 0, plain: 0 });
  });

  it("rejects a reachable HTTP negative target after verified dispatcher TLS", async () => {
    const render = await renderCiOverlay();
    const edge = await controlledProbeEdge(render);
    const probe = await runRenderedCommand({
      command: renderedCommand(renderedResource(render, "Job", "pforge-claw-egress-probe")),
      edge, ca: edge.ca, denyNegative: false,
    });
    expect(probe.status).not.toBe(0);
    expect(probe.stdout).toBe("");
    expect(edge.requests).toEqual({ secure: 1, plain: 1 });
  });

  it("rejects an unavailable HTTPS dispatcher before the negative-target check", async () => {
    const render = await renderCiOverlay();
    const edge = await controlledProbeEdge(render, 503);
    const probe = await runRenderedCommand({
      command: renderedCommand(renderedResource(render, "Job", "pforge-claw-egress-probe")), edge, ca: edge.ca,
    });
    expect(probe.status).not.toBe(0);
    expect(probe.stdout).toBe("");
    expect(edge.requests).toEqual({ secure: 1, plain: 0 });
  });
});

describe("hosted Kubernetes command failure diagnostics", () => {
  const canary = "fixture-native-command-credential-canary";
  const applyFailure = {
    code: 23, stdout: canary,
    stderr: `Error from server (Invalid): error when creating generated Secret: {"data":{"token":"${canary}"}}\n`,
  };

  it("identifies the failing kind image-load command and exit without exposing native output", async () => {
    const execution = await failedNativeCli({
      "image-load": {
        code: 17, stdout: canary,
        stderr: `ERROR: image: "${canary}" not present locally\n`,
      },
    });
    expect(execution.commands).toEqual(["namespace-check", "image-load"]);
    expect(execution.stderr).toContain("e2e-k8s: K8S_E2E_COMMAND_FAILED\n");
    expect(execution.stderr).toContain('"command":"kind"');
    expect(execution.stderr).not.toContain(canary);
    const diagnostic = JSON.parse(execution.stderr.trim().split("\n").at(-1));
    expect(diagnostic).toMatchObject({
      command: "kind", operation: "load", exitCode: 17, signal: null, stderrHint: "IMAGE_NOT_LOCAL",
      args: ["load", "docker-image", "<redacted>", "<redacted>", "--name", "<redacted>"],
    });
    expect(diagnostic).not.toHaveProperty("stderr");
  });

  it("identifies failed kubectl apply without printing the generated Secret body", async () => {
    const execution = await failedNativeCli({ "overlay-apply": applyFailure });
    expect(execution.commands).toEqual([
      "namespace-check", "image-load", "namespace-create", "overlay-apply", "namespace-cleanup",
    ]);
    expect(execution.stderr).toContain('"command":"kubectl"');
    expect(execution.stderr).not.toContain(canary);
    expect(execution.stderr).not.toContain('"data"');
    const diagnostic = JSON.parse(execution.stderr.trim().split("\n").at(-1));
    expect(diagnostic).toMatchObject({
      command: "kubectl", operation: "apply", exitCode: 23, signal: null, stderrHint: "API_RESOURCE_REJECTED",
      args: ["--context", "<redacted>", "apply", "-k", "<redacted>"],
    });
    expect(Buffer.byteLength(execution.stderr)).toBeLessThanOrEqual(MAX_CLI_DIAGNOSTIC_BYTES);
  });

  it("preserves the first apply failure when namespace cleanup also fails", async () => {
    const execution = await failedNativeCli({
      "overlay-apply": applyFailure,
      "namespace-cleanup": {
        code: 31, stdout: canary, stderr: `Error from server (Forbidden): ${canary}\n`,
      },
    });
    expect(execution.commands.at(-1)).toBe("namespace-cleanup");
    expect(execution.stderr).toContain('"operation":"apply"');
    expect(execution.stderr).not.toContain(canary);
    const diagnostic = JSON.parse(execution.stderr.trim().split("\n").at(-1));
    expect(diagnostic).toMatchObject({
      command: "kubectl", operation: "apply", exitCode: 23,
      cleanupFailure: { command: "kubectl", operation: "delete", exitCode: 31, stderrHint: "API_ACCESS_DENIED" },
    });
    expect(Buffer.byteLength(execution.stderr)).toBeLessThanOrEqual(MAX_CLI_DIAGNOSTIC_BYTES);
  });

  it("bounds and suppresses unrecognized native stderr instead of echoing credential text", async () => {
    const execution = await failedNativeCli({
      "image-load": { code: 17, stdout: canary, stderr: `${canary}\n`.repeat(500) },
    });
    expect(execution.stderr).not.toContain(canary);
    const diagnostic = JSON.parse(execution.stderr.trim().split("\n").at(-1));
    expect(diagnostic).toMatchObject({
      command: "kind", exitCode: 17, stderrHint: "STDERR_SUPPRESSED", stderrTruncated: true,
    });
    expect(diagnostic).not.toHaveProperty("stderr");
    expect(Buffer.byteLength(execution.stderr)).toBeLessThanOrEqual(MAX_CLI_DIAGNOSTIC_BYTES);
  });

  it("reports an output-limit failure without exposing stdout or inventing a native exit code", async () => {
    const execution = await failedNativeCli({
      "image-load": { code: 17, stdout: canary + "x".repeat(COMMAND_OUTPUT_LIMIT_BYTES), stderr: "" },
    });
    expect(execution.stderr).toContain("e2e-k8s: K8S_E2E_OUTPUT_LIMIT\n");
    expect(execution.stderr).not.toContain(canary);
    const diagnostic = JSON.parse(execution.stderr.trim().split("\n").at(-1));
    expect(diagnostic).toMatchObject({ command: "kind", operation: "load", exitCode: null, signal: null });
    expect(diagnostic).not.toHaveProperty("stdout");
    expect(Buffer.byteLength(execution.stderr)).toBeLessThanOrEqual(MAX_CLI_DIAGNOSTIC_BYTES);
  });

  it("identifies an unavailable native executable without leaking its host path", async () => {
    const execution = await failedNativeCli({ "namespace-check": { missingExecutable: true } });
    expect(execution.commands).toEqual(["namespace-check"]);
    expect(execution.stderr).toContain("e2e-k8s: K8S_E2E_COMMAND_UNAVAILABLE\n");
    expect(execution.stderr).not.toContain("fixture-missing-native-credential-canary");
    const diagnostic = JSON.parse(execution.stderr.trim().split("\n").at(-1));
    expect(diagnostic).toMatchObject({
      command: "kubectl", operation: "get", exitCode: null, signal: null, stderrHint: "COMMAND_NOT_FOUND",
    });
    expect(Buffer.byteLength(execution.stderr)).toBeLessThanOrEqual(MAX_CLI_DIAGNOSTIC_BYTES);
  });
});

describe("isolated Kubernetes gate rendering", () => {
  it("renders only configured CIDRs and keeps an empty external allowlist fail-closed", async () => {
    const { buildJobEgressPolicy } = await import("../src/k8s/egress-policy.mjs");
    const policy = buildJobEgressPolicy({
      namespace: NAMESPACE, allow: ["192.0.2.0/24", "2001:db8::/32", "192.0.2.0/24"],
    });
    expect(policy.metadata.namespace).toBe(NAMESPACE);
    expect(policy.spec).toMatchObject({
      podSelector: { matchLabels: { "app.kubernetes.io/part-of": "pforge-claw", "pforge-claw/role": "job" } },
      policyTypes: ["Egress"],
      egress: [{
        to: [{ ipBlock: { cidr: "192.0.2.0/24" } }, { ipBlock: { cidr: "2001:db8::/32" } }],
        ports: [{ protocol: "TCP", port: 443 }],
      }],
    });
    expect(buildJobEgressPolicy({ namespace: NAMESPACE, allow: [] }).spec.egress).toEqual([]);
  });

  it.each(["github.com", "*.githubcopilot.com"])(
    "refuses unresolved hostname %s instead of widening to public HTTPS", async (hostname) => {
      const { buildJobEgressPolicy } = await import("../src/k8s/egress-policy.mjs");
      expect(() => buildJobEgressPolicy({ namespace: NAMESPACE, allow: [hostname] }))
        .toThrowError(expect.objectContaining({ code: "K8S_EGRESS_HOSTNAME_UNSUPPORTED" }));
    },
  );

  it.each(["0.0.0.0/0", "::/0", "192.0.2.1/33", "192.0.2.1/-1", "not-a-cidr", "2001:db8::/129"])(
    "rejects an invalid or unrestricted egress target %s", async (target) => {
      const { buildJobEgressPolicy } = await import("../src/k8s/egress-policy.mjs");
      expect(() => buildJobEgressPolicy({ namespace: NAMESPACE, allow: [target] })).toThrow();
    },
  );

  it("wires the configured allowlist into the generated overlay rather than ignoring it", async () => {
    const destination = await workspace();
    const template = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "deploy", "k8s", "overlays", "dev", "config.json"), "utf8"));
    template.k8s = { egress: { allow: ["192.0.2.0/24"] } };
    const result = await writeDevOverlay({
      namespace: NAMESPACE, destination, dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE, config: template,
    });
    expect(result.kustomization.resources).toContain("job-egress.yaml");
    const policy = JSON.parse(await readFile(path.join(destination, "job-egress.yaml"), "utf8"));
    expect(policy.spec.egress[0].to).toEqual([{ ipBlock: { cidr: "192.0.2.0/24" } }]);
    expect(policy.metadata.namespace).toBe(NAMESPACE);
  });

  it.each(["default", "pforge-claw", "kube-system", "pforge-claw-e2e-../escape", "pforge-claw-e2e-Upper"])(
    "refuses a non-disposable namespace %s", (namespace) => {
      expect(() => validateE2eNamespace(namespace)).toThrow("K8S_E2E_NAMESPACE_INVALID");
    },
  );

  it("writes consistent namespace, RBAC-subject, config and image transformations", async () => {
    const destination = await workspace();
    const written = await writeDevOverlay({
      namespace: NAMESPACE, destination, dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    });
    expect(written.kustomization.namespace).toBe(NAMESPACE);
    expect(written.kustomization.patches).toContainEqual(expect.objectContaining({
      target: expect.objectContaining({ kind: "RoleBinding" }),
      patch: JSON.stringify([{ op: "replace", path: "/subjects/0/namespace", value: NAMESPACE }]),
    }));
    expect(written.config.lanes.find((lane) => lane.kind === "k8s").k8s).toMatchObject({
      namespace: NAMESPACE, defaultImage: WORKER_IMAGE,
    });
    expect(written.config.projects[0].placement.prefer).toEqual(["k8s-dev"]);
    expect(JSON.parse(await readFile(path.join(destination, "kustomization.yaml"), "utf8"))).toEqual(written.kustomization);
    expect(JSON.parse(await readFile(path.join(destination, "config.json"), "utf8"))).toEqual(written.config);
  });

  it("renders every namespaced resource and RBAC subject into the requested namespace offline", async () => {
    const destination = await workspace();
    await writeDevOverlay({
      namespace: NAMESPACE, destination, dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    });
    const render = spawnSync("kubectl", ["kustomize", destination], {
      encoding: "utf8", timeout: PROCESS_TIMEOUT_MS,
    });
    expect(render.error, "kubectl kustomize is an offline render requirement, not a cluster operation").toBeUndefined();
    expect(render.status, render.stderr).toBe(0);
    const namespaces = [...render.stdout.matchAll(/^\s+namespace:\s+(\S+)$/gm)].map((match) => match[1]);
    expect(namespaces.length).toBeGreaterThan(5);
    expect(new Set(namespaces)).toEqual(new Set([NAMESPACE]));
    expect(render.stdout).toContain(`kind: Namespace\nmetadata:\n  labels:\n    app: pforge-claw\n  name: ${NAMESPACE}`);
    expect(render.stdout).not.toMatch(/namespace:\s+pforge-claw\s*$/m);
    expect(render.stdout.includes(`image: ${DISPATCHER_IMAGE}`), "dispatcher fixture image survives nested image transformations").toBe(true);
    expect(render.stdout.includes(`image: ${WORKER_IMAGE}`), "worker fixture image survives nested image transformations").toBe(true);
    const dispatcherConfig = render.stdout.match(/  config\.json: \|\n((?:    .*\n)+)/);
    expect(dispatcherConfig, "rendered ConfigMap contains the materialized JSON literal").not.toBeNull();
    const config = JSON.parse(dispatcherConfig[1].replace(/^    /gm, ""));
    expect(config.lanes.find((lane) => lane.kind === "k8s").k8s.namespace).toBe(NAMESPACE);
    expect(config.projects[0].placement.prefer).toEqual(["k8s-dev"]);
    expect(render.stdout).toContain("suspend: true");
    expect(render.stdout).toContain("pforge-claw/role: job");
  }, PROCESS_TIMEOUT_MS);

  it("rejects writing a generated overlay into a directory outside the package", async () => {
    await expect(writeDevOverlay({
      namespace: NAMESPACE, destination: path.dirname(PACKAGE_ROOT),
      dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    })).rejects.toThrow("K8S_E2E_DESTINATION_INVALID");
  });

  it("does not mutate caller configuration while pinning the Kubernetes lane", () => {
    const template = { lanes: [{ id: "k8s-dev", kind: "k8s", k8s: { namespace: "base", defaultImage: "worker:base" } }] };
    const selected = materializeDevConfig({ namespace: NAMESPACE, workerImage: WORKER_IMAGE, template });
    expect(selected.lanes[0].k8s.namespace).toBe(NAMESPACE);
    expect(template.lanes[0].k8s.namespace).toBe("base");
  });

  it("rejects unpinned image inputs instead of silently selecting latest", () => {
    expect(() => buildDevOverlay({
      namespace: NAMESPACE, destination: TEST_ROOT, dispatcherImage: "dispatcher", workerImage: WORKER_IMAGE,
    })).toThrow("K8S_E2E_IMAGE_TAG_REQUIRED");
  });
});

describe("deployed Kubernetes gate evidence", () => {
  it.each(["missing-ack", "wrong-ack", "wrong-bytes", "early-terminal", "unverified-grant"])(
    "rejects deployed evidence with %s rather than accepting a Job/probe-only success", (failure) => {
      const { proof, job } = deployedFixture();
      if (failure === "missing-ack") delete proof.applicationAck;
      if (failure === "wrong-ack") proof.applicationAck = { ...proof.applicationAck, projectId: "another-project" };
      if (failure === "wrong-bytes") proof.canonicalL2Files[0].sha256 = "a".repeat(64);
      if (failure === "early-terminal") proof.jobEvents = [proof.jobEvents[0], proof.jobEvents.at(-1), ...proof.jobEvents.slice(1, -1)];
      if (failure === "unverified-grant") proof.leaseGrantVerified = false;
      expect(() => verifyScenarioEvidence({ namespace: NAMESPACE, proof, job, workerImage: WORKER_IMAGE })).toThrow();
    },
  );

  it.each(["missing-choices", "wrong-choice-hash", "missing-queue", "wrong-queue-bytes", "resolved-key"])(
    "rejects deployed evidence with %s instead of weakening fixture-only acceptance", (failure) => {
      const { proof, job } = deployedFixture();
      if (failure === "missing-choices") delete proof.signedChoices;
      if (failure === "wrong-choice-hash") proof.choiceDigest = "0".repeat(64);
      if (failure === "missing-queue") delete proof.canonicalQueue;
      if (failure === "wrong-queue-bytes") proof.canonicalQueue.sha256 = "0".repeat(64);
      if (failure === "resolved-key") {
        proof.signedChoices.provider.apiKey = "fixture-canary-not-a-provider-key";
        proof.choiceDigest = createHash("sha256").update(canonical(proof.signedChoices)).digest("hex");
      }
      expect(() => verifyScenarioEvidence({ namespace: NAMESPACE, proof, job, workerImage: WORKER_IMAGE })).toThrow();
    },
  );

  it("executes the deployed scenario, waits for the real worker Job, verifies bytes and ACK, then checks cleanup", async () => {
    const { proof, job } = deployedFixture();
    const runner = vi.fn(async (command, args) => {
      if (command !== "kubectl") return "";
      if (args.includes("namespace") && args.includes("--ignore-not-found")) return "";
      if (args.includes("-e")) return JSON.stringify(proof);
      if (args.includes("get") && args.includes("job")) return JSON.stringify(job);
      return "";
    });

    const result = await runK8sE2e({
      namespace: NAMESPACE, context: "kind-fixture", dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    }, { runner, exists: async () => {} });
    expect(result).toMatchObject({ status: "passed", namespace: NAMESPACE });
    expect(result.scenarioEvidence).toMatchObject({
      jobId: proof.jobId, jobName: proof.jobName, laneId: "k8s-dev",
      approvalConsumed: true, leaseGrantVerified: true, oneShot: true,
      applicationAck: proof.applicationAck, canonicalL2FileCount: 1, cleanedUp: true,
    });
    const commands = runner.mock.calls.filter(([command]) => command === "kubectl").map(([, args]) => args);
    expect(commands.every((args) => args[0] === "--context" && args[1] === "kind-fixture")).toBe(true);
    const scenario = commands.findIndex((args) => args.includes("/app/tests/helpers/k8s-scenario.mjs"));
    const complete = commands.findIndex((args) => args.includes("--for=condition=complete") && args.includes(`job/${proof.jobName}`));
    const getJob = commands.findIndex((args) => args.includes("get") && args.includes("job"));
    const cleanup = commands.findIndex((args) => args.includes("--for=delete") && args.includes(`job/${proof.jobName}`));
    expect(scenario).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(scenario);
    expect(getJob).toBeGreaterThan(complete);
    expect(cleanup).toBeGreaterThan(getJob);
  });

  it("normalizes an application ACK before returning CI proof so unexpected fields cannot leak", async () => {
    const { proof, job } = deployedFixture();
    const canary = "fixture-unexpected-ack-secret";
    proof.applicationAck.unexpected = canary;
    const runner = async (command, args) => {
      if (command !== "kubectl") return "";
      if (args.includes("-e")) return JSON.stringify(proof);
      if (args.includes("get") && args.includes("job")) return JSON.stringify(job);
      return "";
    };
    const outcome = await runK8sE2e({
      namespace: NAMESPACE, context: "kind-fixture", dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    }, { runner });
    expect(JSON.stringify(outcome)).not.toContain(canary);
    expect(outcome.scenarioEvidence.applicationAck).not.toHaveProperty("unexpected");
  });

  it("does not apply or delete a namespace when atomic ownership acquisition fails", async () => {
    const { proof, job } = deployedFixture();
    const runner = vi.fn(async (command, args) => {
      if (command !== "kubectl") return "";
      if (args.includes("create") && args.includes("namespace")) throw new Error("K8S_E2E_COMMAND_FAILED");
      if (args.includes("-e")) return JSON.stringify(proof);
      if (args.includes("get") && args.includes("job")) return JSON.stringify(job);
      return "";
    });
    await expect(runK8sE2e({
      namespace: NAMESPACE, context: "kind-fixture", dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    }, { runner })).rejects.toThrow("K8S_E2E_COMMAND_FAILED");
    const calls = runner.mock.calls.filter(([command]) => command === "kubectl").map(([, args]) => args);
    expect(calls.some((args) => args.includes("apply"))).toBe(false);
    expect(calls.some((args) => args.includes("delete") && args.includes("namespace"))).toBe(false);
  });

  it("rejects a proof-supplied Job flag before any Job query or wait", async () => {
    const { proof, job } = deployedFixture();
    proof.jobName = "--all-namespaces";
    const runner = vi.fn(async (command, args) => {
      if (command !== "kubectl") return "";
      if (args.includes("-e")) return JSON.stringify(proof);
      if (args.includes("get") && args.includes("job")) return JSON.stringify(job);
      return "";
    });
    await expect(runK8sE2e({
      namespace: NAMESPACE, context: "kind-fixture", dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
    }, { runner })).rejects.toThrow("K8S_E2E_SCENARIO_PROOF_INVALID");
    const calls = runner.mock.calls.filter(([command]) => command === "kubectl").map(([, args]) => args);
    expect(calls.some((args) => args.includes("get") && args.includes("job"))).toBe(false);
    expect(calls.some((args) => args.includes("job/--all-namespaces"))).toBe(false);
  });

  it("reports incomplete fixture contracts before any external command", async () => {
    const runner = vi.fn();
    const result = await runK8sE2e({ namespace: NAMESPACE, context: "kind-fixture" }, { runner });
    expect(result).toMatchObject({ status: "blocked", code: "K8S_E2E_FIXTURE_CONTRACTS_PENDING" });
    expect(result.pending).toContain("dispatcher fixture image with bootDispatcher dependency injection");
    expect(result.pending).toContain("one-shot worker fixture image with scripted runtime and Git/PR edges");
    expect(runner).not.toHaveBeenCalled();
  });

  it("lists a missing one-shot fixture source explicitly rather than substituting a local rig", async () => {
    const pending = await missingFixtureContracts({
      dispatcherImage: DISPATCHER_IMAGE, workerImage: WORKER_IMAGE,
      exists: async (file) => { if (file.endsWith("k8s-worker.mjs")) throw new Error("missing"); },
    });
    expect(pending).toEqual([path.join("tests", "helpers", "k8s-worker.mjs")]);
  });

  it("requires real approval, worker Job/image/command and canonical history evidence", () => {
    const { proof, job } = deployedFixture();
    expect(verifyScenarioEvidence({ namespace: NAMESPACE, proof, job, workerImage: WORKER_IMAGE })).toBe(proof.jobName);
    for (const changes of [{ laneId: "local" }, { approvalConsumed: false }, { canonicalL2Files: [] }, { oneShot: false }]) {
      expect(() => verifyScenarioEvidence({
        namespace: NAMESPACE, proof: { ...proof, ...changes }, job, workerImage: WORKER_IMAGE,
      })).toThrow("K8S_E2E_SCENARIO_PROOF_INVALID");
    }
    expect(() => verifyScenarioEvidence({
      namespace: NAMESPACE, proof, job: { ...job, status: { succeeded: 0 } }, workerImage: WORKER_IMAGE,
    })).toThrow("K8S_E2E_WORKER_JOB_INVALID");
  });
});

describe("PowerShell and Bash Kubernetes gate twins", () => {
  it("end-to-end acceptance passes explicit images/context/namespace and never treats SKIPPED as passed", async () => {
    const source = await readFile(path.join(PACKAGE_ROOT, "tests", "e2e", "k8s.test.mjs"), "utf8");
    for (const name of ["PFORGE_CLAW_E2E_K8S_CONTEXT", "PFORGE_CLAW_E2E_K8S_NAMESPACE", "PFORGE_CLAW_E2E_K8S_DISPATCHER_IMAGE", "PFORGE_CLAW_E2E_K8S_WORKER_IMAGE"]) {
      expect(source).toContain(name);
    }
    expect(source).toContain("scenarioEvidence");
    expect(source).not.toMatch(/context\.skip|it\.skip|stdout\.includes\("SKIPPED:"\)/);
  });

  it("both shells accept complete image arguments in a validated offline dry-run", () => {
    const bash = process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
    const commands = [
      ["pwsh", ["-NoProfile", "-File", path.join(PACKAGE_ROOT, "scripts", "e2e-k8s.ps1"), "-Namespace", NAMESPACE, "-Context", "kind-fixture", "-DispatcherFixtureImage", DISPATCHER_IMAGE, "-WorkerFixtureImage", WORKER_IMAGE, "-DryRun"]],
      [bash, [path.join(PACKAGE_ROOT, "scripts", "e2e-k8s.sh"), "--namespace", NAMESPACE, "--context", "kind-fixture", "--dispatcher-fixture-image", DISPATCHER_IMAGE, "--worker-fixture-image", WORKER_IMAGE, "--dry-run"]],
    ];
    for (const [command, args] of commands) {
      const result = spawnSync(command, args, { cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ status: "dry-run", namespace: NAMESPACE, context: "kind-fixture" });
    }
  }, PROCESS_TIMEOUT_MS);

  it("provides paired offline configured-egress renderers without printing other config values", async () => {
    const directory = await workspace();
    const file = path.join(directory, "config.json");
    const canary = "fixture-g4-config-secret-canary";
    await writeFile(file, JSON.stringify({ k8s: { egress: { allow: ["192.0.2.0/24"] } }, secrets: { token: canary } }));
    const bash = process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe") : "bash";
    for (const [command, args] of [
      ["pwsh", ["-NoProfile", "-File", path.join(PACKAGE_ROOT, "scripts", "render-egress.ps1"), "-Config", file, "-Namespace", NAMESPACE]],
      [bash, [path.join(PACKAGE_ROOT, "scripts", "render-egress.sh"), "--config", file, "--namespace", NAMESPACE]],
    ]) {
      const rendered = spawnSync(command, args, { cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS });
      expect(rendered.error).toBeUndefined();
      expect(rendered.status).toBe(0);
      expect(rendered.stdout.includes(canary) || rendered.stderr.includes(canary)).toBe(false);
      expect(JSON.parse(rendered.stdout)).toMatchObject({
        metadata: { namespace: NAMESPACE },
        spec: { egress: [{ to: [{ ipBlock: { cidr: "192.0.2.0/24" } }] }] },
      });
    }
  });

  it("uses a common core that requires fixture images and never builds or contacts live services", async () => {
    for (const file of ["e2e-k8s.ps1", "e2e-k8s.sh"]) {
      const source = await readFile(path.join(PACKAGE_ROOT, "scripts", file), "utf8");
      expect(source).toContain("k8s-e2e.mjs");
      expect(source).not.toContain("away-from-desk.test.mjs");
      expect(source).not.toMatch(/\bdocker\s+build|\bbuild-images\b|\bcluster-info\b/);
    }
    const core = await readFile(path.join(PACKAGE_ROOT, "scripts", "k8s-e2e.mjs"), "utf8");
    expect(core).toContain('["--context", options.context, ...args]');
    expect(core).not.toContain("e2e-rig");
    expect(core).not.toMatch(/\bexecSync\b|\bexec\s*\(|shell:\s*true/);
    expect(core).toContain("K8S_E2E_NAMESPACE_ALREADY_EXISTS");
  });

  describe("secret-safe Kubernetes CI diagnostics", () => {
    it("sanitizes planted-canary valid stdin through the actual CLI", () => {
      const canary = "fixture-g4-stdin-pod-secret";
      const input = JSON.stringify({
        kind: "Pod", metadata: { namespace: NAMESPACE, name: "fixture-worker", annotations: { unsafe: canary } },
        spec: { containers: [{ args: [canary], env: [{ name: "PFORGE_CLAW_JOB_KEY", value: canary }] }] },
        status: { phase: "Running", containerStatuses: [{ name: "worker", ready: true, restartCount: 0, state: { running: { startedAt: "2026-10-09T12:00:00Z" } } }] },
      });
      const execution = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, "scripts", "k8s-diagnostics.mjs")], {
        cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS, input,
      });
      expect(execution.status).toBe(0);
      expect(execution.stdout.includes(canary) || execution.stderr.includes(canary)).toBe(false);
      expect(execution.stderr).toBe("");
      expect(Buffer.byteLength(execution.stdout)).toBeLessThanOrEqual(10 * 1024 + 1);
      expect(JSON.parse(execution.stdout)).toMatchObject({ ok: true, pod: { phase: "Running" }, containers: [{ ready: true, restarts: 0 }] });
    });

    it("emits bounded whitelisted Pod status and never env, args, annotations or raw messages", async () => {
      const { summarizePod } = await import("../scripts/k8s-diagnostics.mjs");
      const canary = "fixture-g4-literal-job-key-secret";
      const pod = {
        kind: "Pod", metadata: { namespace: NAMESPACE, name: "fixture-worker", annotations: { credentials: canary } },
        spec: { containers: [{ env: [{ name: "PFORGE_CLAW_JOB_KEY", value: canary }], command: ["echo", canary], args: [canary] }] },
        status: {
          phase: "Running", message: canary,
          containerStatuses: [{
            name: "worker", ready: false, restartCount: 2,
            state: { waiting: { reason: "CrashLoopBackOff", message: canary } },
            lastState: { terminated: { reason: "OOMKilled", exitCode: 137, message: canary, finishedAt: "2026-10-09T12:00:00Z" } },
          }],
        },
      };
      const summary = summarizePod(pod);
      expect(summary).toMatchObject({
        ok: true, pod: { namespace: NAMESPACE, name: "fixture-worker", phase: "Running" },
        containers: [{
          name: "worker", ready: false, restarts: 2,
          state: { type: "waiting", reason: "CrashLoopBackOff" },
          previousState: { type: "terminated", reason: "OOMKilled", exitCode: 137, finishedAt: "2026-10-09T12:00:00.000Z" },
        }],
        totalContainers: 1, truncated: false,
      });
      const output = JSON.stringify(summary);
      expect(output.includes(canary)).toBe(false);
      expect(output).not.toMatch(/annotations|PFORGE_CLAW_JOB_KEY|command|args|message/);
      expect(Buffer.byteLength(output)).toBeLessThanOrEqual(10 * 1024);
    });

    it("does not trust secret-bearing arbitrary state reasons or malformed timestamps", async () => {
      const { summarizePod } = await import("../scripts/k8s-diagnostics.mjs");
      const canary = "fixture-g4-status-secret";
      const summary = summarizePod({
        kind: "Pod", metadata: { namespace: NAMESPACE, name: "fixture-worker" },
        status: {
          phase: canary,
          containerStatuses: [{ name: "worker", state: { terminated: { reason: canary, startedAt: canary, finishedAt: canary, exitCode: canary } } }],
        },
      });
      expect(JSON.stringify(summary).includes(canary)).toBe(false);
      expect(summary.pod.phase).toBe("Unknown");
      expect(summary.containers[0].state).toMatchObject({ type: "terminated", reason: null, exitCode: null, startedAt: null, finishedAt: null });
    });

    it("reports truncated status counts without returning an unbounded container list", async () => {
      const { summarizePod } = await import("../scripts/k8s-diagnostics.mjs");
      const summary = summarizePod({
        kind: "Pod", metadata: { namespace: NAMESPACE, name: "fixture-worker" },
        status: { phase: "Pending", containerStatuses: Array.from({ length: 100 }, (_, index) => ({ name: `worker-${index}`, ready: false, restartCount: 0 })) },
      });
      expect(summary.totalContainers).toBe(100);
      expect(summary.containers.length).toBeLessThanOrEqual(16);
      expect(summary.truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(summary))).toBeLessThanOrEqual(10 * 1024);
    });

    it.each(["malformed", "shape"])("returns only a safe error code for planted-canary %s stdin", (kind) => {
      const canary = "fixture-g4-malformed-pod-secret";
      const input = kind === "malformed" ? `{"env":"${canary}"` : JSON.stringify({ kind: "Secret", data: { key: canary } });
      const execution = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, "scripts", "k8s-diagnostics.mjs")], {
        cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS, input,
      });
      expect(execution.error).toBeUndefined();
      expect(execution.status).toBe(2);
      expect(execution.stdout.includes(canary) || execution.stderr.includes(canary)).toBe(false);
      expect(execution.stderr).toBe("");
      expect(JSON.parse(execution.stdout)).toEqual({ ok: false, code: "K8S_DIAGNOSTICS_INPUT_INVALID" });
    });
  });

  it("PowerShell forwards the same blocked invocation without touching a cluster", () => {
    const result = spawnSync("pwsh", [
      "-NoProfile", "-File", path.join(PACKAGE_ROOT, "scripts", "e2e-k8s.ps1"),
      "-Namespace", NAMESPACE, "-Context", "kind-fixture", "-DryRun",
    ], { cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      status: "blocked", code: "K8S_E2E_FIXTURE_CONTRACTS_PENDING",
    });
  }, PROCESS_TIMEOUT_MS);

  it("Bash forwards the same blocked invocation without touching a cluster", () => {
    const bash = process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
      : "bash";
    expect(process.platform !== "win32" || existsSync(bash), "Git Bash is required for the Windows shell parity check").toBe(true);
    const result = spawnSync(bash, [
      path.join(PACKAGE_ROOT, "scripts", "e2e-k8s.sh"),
      "--namespace", NAMESPACE, "--context", "kind-fixture", "--dry-run",
    ], { cwd: PACKAGE_ROOT, encoding: "utf8", timeout: PROCESS_TIMEOUT_MS });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      status: "blocked", code: "K8S_E2E_FIXTURE_CONTRACTS_PENDING",
    });
  }, PROCESS_TIMEOUT_MS);
});
