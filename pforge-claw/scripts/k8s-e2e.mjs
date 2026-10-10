import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildDevOverlay, materializeDevConfig, PACKAGE_ROOT, validateE2eNamespace, writeDevOverlay } from "./k8s-e2e-overlay.mjs";
import { applicationIdentity, matchesApplicationAck } from "../src/protocol/l2-ack.mjs";
import { L2_PACKET_KIND } from "../src/protocol/messages.mjs";
import { canonical } from "../src/protocol/lease-grant.mjs";
import { planExecutionChoices, projectExecutionChoices } from "../src/jobs/execution-choices.mjs";
import { resolveRuntimeId } from "../src/runtime/agent-runtime.mjs";
import { byokProviderReference } from "../src/runtime/byok.mjs";
import { validateConfig } from "../src/config.mjs";
import { buildJobEgressPolicy } from "../src/k8s/egress-policy.mjs";

const MAX_COMMAND_BYTES = 1_048_576;
const COMMAND_TIMEOUT_MS = 180_000;
const MAX_PROOF_EVENTS = 1000;
const MAX_PROOF_FILES = 128;
const MIN_PROOF_EVENTS = 3;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const NAMESPACE_RANDOM_BYTES = 6;
const SIGNED_CHOICE_FIELDS = Object.freeze(["runtime", "provider", "models", "bootstrap", "repository", "quorum", "resumeFrom"]);
const PROVIDER_REFERENCE_FIELDS = Object.freeze(["type", "keySecret", "endpoint"]);
const CHOICE_MAX_BYTES = 4096;
const JOB_DNS_NAME = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const FIXTURE_SOURCES = Object.freeze([
  path.join("tests", "helpers", "k8s-dispatcher.mjs"),
  path.join("tests", "helpers", "k8s-worker.mjs"),
  path.join("tests", "helpers", "k8s-scenario.mjs"),
  path.join("deploy", "Dockerfile.k8s-fixtures"),
]);
const PROOF_PATH = "/data/k8s-e2e-result.json";
const PROOF_READ = `import { readFileSync } from 'node:fs'; process.stdout.write(readFileSync('${PROOF_PATH}', 'utf8'));`;

function parseOptions(argv) {
  const options = {};
  const flags = {
    "--namespace": "namespace", "--context": "context",
    "--dispatcher-fixture-image": "dispatcherImage", "--worker-fixture-image": "workerImage",
    "--fixture-config": "fixtureConfig",
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    if (!Object.hasOwn(flags, flag) || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("K8S_E2E_ARGUMENT_INVALID");
    options[flags[flag]] = argv[++index];
  }
  options.namespace ??= `pforge-claw-e2e-${randomBytes(NAMESPACE_RANDOM_BYTES).toString("hex")}`;
  validateE2eNamespace(options.namespace);
  return options;
}

/**
 * Report missing fixture contracts before building images or touching any cluster.
 * @param {{dispatcherImage?: string, workerImage?: string, exists?: Function}} options
 * @returns {Promise<string[]>}
 */
export async function missingFixtureContracts({ dispatcherImage, workerImage, exists = access } = {}) {
  const pending = [];
  if (!dispatcherImage) pending.push("dispatcher fixture image with bootDispatcher dependency injection");
  if (!workerImage) pending.push("one-shot worker fixture image with scripted runtime and Git/PR edges");
  for (const source of FIXTURE_SOURCES) {
    try {
      await exists(path.join(PACKAGE_ROOT, source));
    } catch {
      pending.push(source);
    }
  }
  return pending;
}

function localCluster(context) {
  if (typeof context !== "string") throw new Error("K8S_E2E_CONTEXT_REQUIRED");
  if (!/^(?:kind|k3d)-[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(context)) throw new Error("K8S_E2E_CONTEXT_NOT_LOCAL");
  if (context.startsWith("kind-") && context.length > "kind-".length) {
    return { command: "kind", name: context.slice("kind-".length) };
  }
  if (context.startsWith("k3d-") && context.length > "k3d-".length) {
    return { command: "k3d", name: context.slice("k3d-".length) };
  }
  throw new Error("K8S_E2E_CONTEXT_NOT_LOCAL");
}

async function validatedFixtureConfig(options) {
  validateE2eNamespace(options.namespace);
  buildDevOverlay({ ...options, destination: path.join(PACKAGE_ROOT, "scripts", ".k8s-e2e-validation") });
  let file = path.join(PACKAGE_ROOT, "deploy", "k8s", "overlays", "dev", "config.json");
  if (options.fixtureConfig) {
    const [root, selected] = await Promise.all([realpath(PACKAGE_ROOT), realpath(path.resolve(options.fixtureConfig))]);
    const relative = path.relative(root, selected);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("K8S_E2E_CONFIG_PATH_INVALID");
    file = selected;
  }
  const bytes = await readFile(file);
  if (bytes.length > MAX_COMMAND_BYTES) throw new Error("K8S_E2E_CONFIG_TOO_LARGE");
  let template;
  try {
    template = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("K8S_E2E_CONFIG_INVALID");
  }
  const config = materializeDevConfig({ ...options, template });
  if (!(await validateConfig(config, { mode: "runtime" })).ok) throw new Error("K8S_E2E_CONFIG_INVALID");
  buildJobEgressPolicy({ namespace: options.namespace, allow: config.k8s?.egress?.allow ?? [] });
  return config;
}

function execute(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: PACKAGE_ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let bytes = 0;
    let settled = false;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("K8S_E2E_COMMAND_TIMEOUT"));
    }, COMMAND_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_COMMAND_BYTES) {
        child.kill();
        finish(new Error("K8S_E2E_OUTPUT_LIMIT"));
      } else stdout += chunk.toString("utf8");
    });
    child.stderr.resume();
    child.once("error", () => finish(new Error("K8S_E2E_COMMAND_UNAVAILABLE")));
    child.once("close", (code) => finish(code === 0 ? null : new Error("K8S_E2E_COMMAND_FAILED"), stdout));
  });
}

/**
 * Verify scenario evidence before accepting a Job/PR/history success claim.
 * @param {{namespace: string, proof: object, job: object, workerImage: string}} options
 * @returns {string}
 */
export function verifyScenarioEvidence({ namespace, proof, job, workerImage, config }) {
  verifyScenarioIdentity(namespace, proof);
  verifyHistoryProof(proof);
  verifyChoicesProof(proof);
  verifyConfiguredChoices(proof, config);
  verifyWorkerJob({ namespace, proof, job, workerImage });
  return job.metadata.name;
}

function hasOnlyFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => fields.includes(key));
}

function verifyChoicesProof(proof) {
  const choices = proof.signedChoices;
  if (!hasOnlyFields(choices, SIGNED_CHOICE_FIELDS)
    || !HEX_DIGEST.test(proof.choiceDigest ?? "") || typeof choices.runtime !== "string"
    || (choices.provider !== undefined && !hasOnlyFields(choices.provider, PROVIDER_REFERENCE_FIELDS))) {
    throw new Error("K8S_E2E_SIGNED_CHOICES_INVALID");
  }
  const serialized = canonical(choices);
  if (Buffer.byteLength(serialized) > CHOICE_MAX_BYTES || createHash("sha256").update(serialized).digest("hex") !== proof.choiceDigest) {
    throw new Error("K8S_E2E_SIGNED_CHOICES_INVALID");
  }
  try {
    planExecutionChoices(choices);
  } catch {
    throw new Error("K8S_E2E_SIGNED_CHOICES_INVALID");
  }
}

function verifyConfiguredChoices(proof, config) {
  if (!config) return;
  const project = config.projects.find((entry) => entry.id === proof.transfer.projectId);
  const lane = config.lanes.find((entry) => entry.id === proof.laneId);
  if (!project || !lane) throw new Error("K8S_E2E_SIGNED_CHOICES_INVALID");
  const runtime = resolveRuntimeId({ config, project, lane });
  const provider = byokProviderReference({ type: runtime, config });
  const approved = projectExecutionChoices({ config, project, lane });
  const expected = { runtime, ...(provider ? { provider } : {}), models: approved.models, bootstrap: approved.bootstrap, repository: approved.repo };
  const selected = Object.fromEntries(Object.keys(expected).map((key) => [key, proof.signedChoices[key]]));
  if (canonical(selected) !== canonical(expected)) throw new Error("K8S_E2E_SIGNED_CHOICES_INVALID");
}

function verifyScenarioIdentity(namespace, proof) {
  if (proof?.namespace !== namespace || proof.laneId !== "k8s-dev" || proof.approvalConsumed !== true
    || proof.leaseGrantVerified !== true || proof.oneShot !== true
    || typeof proof.prUrl !== "string" || !proof.prUrl.startsWith("https://example.com/")
    || !Array.isArray(proof.canonicalL2Files) || proof.canonicalL2Files.length === 0) {
    throw new Error("K8S_E2E_SCENARIO_PROOF_INVALID");
  }
}

function validHistoryFile(file) {
  return typeof file?.path === "string" && !file.path.includes("\\")
    && /^(?:runs|traces|checkpoints)\//.test(file.path)
    && !file.path.split("/").some((part) => part === ".." || !part)
    && typeof file.sha256 === "string" && HEX_DIGEST.test(file.sha256);
}

function verifyCanonicalBytes(proof) {
  const expected = proof.expectedL2Files;
  const canonical = proof.canonicalL2Files;
  if (!Array.isArray(expected) || !expected.length || expected.length > MAX_PROOF_FILES
    || !Array.isArray(canonical) || canonical.length !== expected.length || ![...expected, ...canonical].every(validHistoryFile)) {
    throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
  }
  const files = new Map(canonical.map((file) => [file.path, file.sha256]));
  if (files.size !== canonical.length || new Set(expected.map((file) => file.path)).size !== expected.length
    || expected.some((file) => files.get(file.path) !== file.sha256)) throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
}

function verifyEventOrder(proof, identity) {
  const events = proof.jobEvents;
  if (!Array.isArray(events) || events.length < MIN_PROOF_EVENTS || events.length > MAX_PROOF_EVENTS) throw new Error("K8S_E2E_EVENTS_INVALID");
  let seq = 0;
  for (const event of events) {
    if (event?.jobId !== proof.jobId || !Number.isSafeInteger(event.seq) || event.seq <= seq) throw new Error("K8S_E2E_EVENTS_INVALID");
    seq = event.seq;
  }
  const terminal = events.at(-1);
  const hasPr = events.slice(0, -1).some((event) => event.type === "artifact" && event.data?.kind === "pr" && event.data.url === proof.prUrl);
  const hasDelta = events.slice(0, -1).some((event) => event.type === "artifact" && event.data?.kind === L2_PACKET_KIND
    && event.data.deltaId === identity.deltaId && event.data.sha256Total === identity.sha256Total);
  if (!hasPr || !hasDelta) throw new Error("K8S_E2E_EVENTS_INVALID");
  verifyFinalEvent(events, terminal, identity);
}

function verifyFinalEvent(events, terminal, identity) {
  if (events.filter((event) => event.type === "finished").length !== 1 || terminal.type !== "finished"
    || terminal.data?.status !== "succeeded" || !matchesApplicationAck(identity, terminal.data.l2) || terminal.data.l2.ok !== true) {
    throw new Error("K8S_E2E_EVENTS_INVALID");
  }
}

function verifyHistoryProof(proof) {
  let identity;
  try {
    identity = applicationIdentity(proof.transfer ?? {});
  } catch {
    throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
  }
  if (identity.jobId !== proof.jobId || !matchesApplicationAck(identity, proof.applicationAck) || proof.applicationAck.ok !== true) {
    throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
  }
  verifyCanonicalBytes(proof);
  verifyQueueProof(proof.canonicalQueue);
  verifyEventOrder(proof, identity);
}

function verifyQueueProof(queue) {
  if (queue?.path !== "openbrain-queue.jsonl" || !HEX_DIGEST.test(queue.sha256 ?? "")
    || queue.sha256 !== queue.expectedSha256 || queue.records !== 1) throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
}

function verifyWorkerJob({ namespace, proof, job, workerImage }) {
  verifyJobIdentity({ namespace, proof, job });
  const pod = job.spec?.template?.spec;
  const worker = pod?.containers?.[0];
  if (worker?.image !== workerImage || job.status?.succeeded !== 1
    || JSON.stringify(worker.command) !== JSON.stringify(["pforge", "claw", "worker", "--one-shot", "--job", proof.jobId])) {
    throw new Error("K8S_E2E_WORKER_JOB_INVALID");
  }
  verifyWorkerSecurity({ pod, worker });
  verifyWorkerDeadline(job);
  verifyWorkerAuthentication(worker);
}

function verifyWorkerSecurity({ pod, worker }) {
  if (pod.automountServiceAccountToken !== false || pod.securityContext?.runAsNonRoot !== true
    || worker.securityContext?.readOnlyRootFilesystem !== true || worker.securityContext?.allowPrivilegeEscalation !== false) {
    throw new Error("K8S_E2E_WORKER_JOB_INVALID");
  }
}

function verifyWorkerDeadline(job) {
  if (job.spec?.backoffLimit !== 0 || !Number.isSafeInteger(job.spec.activeDeadlineSeconds)
    || job.spec.activeDeadlineSeconds < 1 || Object.hasOwn(job.spec, "ttlSecondsAfterFinished")) throw new Error("K8S_E2E_WORKER_JOB_INVALID");
  const retainedSeconds = Number(job.metadata?.annotations?.["pforge-claw/cleanup-after-ack-seconds"]);
  if (!Number.isSafeInteger(retainedSeconds) || retainedSeconds < 0) throw new Error("K8S_E2E_WORKER_JOB_INVALID");
}

function verifyWorkerAuthentication(worker) {
  const keys = (worker.env ?? []).filter(({ name }) => name === "PFORGE_CLAW_JOB_KEY");
  if (keys.length !== 1 || !HEX_DIGEST.test(keys[0].value ?? "")
    || worker.env.some(({ name }) => ["PFORGE_CLAW_WORKER_SECRET", "PFORGE_CLAW_K8S_LANE_SECRET"].includes(name))) {
    throw new Error("K8S_E2E_WORKER_JOB_INVALID");
  }
}

function verifyJobIdentity({ namespace, proof, job }) {
  if (job?.kind !== "Job" || job.metadata?.namespace !== namespace || job.metadata?.name !== proof.jobName
    || job.metadata?.labels?.["pforge-claw/job-id"] !== proof.jobId) {
    throw new Error("K8S_E2E_WORKER_JOB_INVALID");
  }
}
async function resumeProbe({ kubectl, namespace, name }) {
  await kubectl(["patch", "job", name, "-n", namespace, "--type=merge", "-p", '{"spec":{"suspend":false}}']);
  await kubectl(["wait", "--for=condition=complete", `job/${name}`, "-n", namespace, "--timeout=90s"]);
}

async function runDeployedScenario({ kubectl, namespace, workerImage, config }) {
  const pod = ["-n", namespace, "deployment/pforge-claw-dispatcher", "--", "node"];
  await kubectl(["exec", ...pod, "/app/tests/helpers/k8s-scenario.mjs"]);
  const proof = JSON.parse(await kubectl(["exec", ...pod, "--input-type=module", "-e", PROOF_READ]));
  if (typeof proof?.jobName !== "string" || !JOB_DNS_NAME.test(proof.jobName)) throw new Error("K8S_E2E_SCENARIO_PROOF_INVALID");
  await kubectl(["wait", "--for=condition=complete", `job/${proof.jobName}`, "-n", namespace, "--timeout=90s"]);
  const job = JSON.parse(await kubectl(["get", "job", proof.jobName, "-n", namespace, "-o", "json"]));
  const name = verifyScenarioEvidence({ namespace, proof, job, workerImage, config });
  await kubectl(["wait", "--for=delete", `job/${name}`, "-n", namespace, "--timeout=90s"]);
  return {
    jobId: proof.jobId, jobName: name, laneId: proof.laneId, approvalConsumed: true,
    leaseGrantVerified: proof.leaseGrantVerified, oneShot: proof.oneShot,
    applicationAck: { ...applicationIdentity(proof.transfer), ok: true },
    canonicalL2FileCount: proof.canonicalL2Files.length, cleanedUp: true,
  };
}

/**
 * Run only against an explicitly named kind/k3d context with complete prebuilt fixture images.
 * @param {object} options
 * @param {{runner?: Function}} dependencies
 * @returns {Promise<object>}
 */
export async function runK8sE2e(options, { runner = execute, exists = access } = {}) {
  const pending = await missingFixtureContracts({ ...options, exists });
  if (pending.length) return { status: "blocked", code: "K8S_E2E_FIXTURE_CONTRACTS_PENDING", pending };
  const cluster = localCluster(options.context);
  const config = await validatedFixtureConfig(options);
  if (options.dryRun) return { status: "dry-run", namespace: options.namespace, context: options.context };
  const kubectl = (args) => runner("kubectl", ["--context", options.context, ...args]);
  const existing = await kubectl(["get", "namespace", options.namespace, "--ignore-not-found", "-o", "name"]);
  if (existing.trim()) throw new Error("K8S_E2E_NAMESPACE_ALREADY_EXISTS");
  const directory = await mkdtemp(path.join(PACKAGE_ROOT, "scripts", ".k8s-e2e-"));
  let ownsNamespace = false;
  try {
    await writeDevOverlay({ ...options, config, destination: directory });
    const images = [options.dispatcherImage, options.workerImage];
    const loadArgs = cluster.command === "kind"
      ? ["load", "docker-image", ...images, "--name", cluster.name]
      : ["image", "import", ...images, "--cluster", cluster.name];
    await runner(cluster.command, loadArgs);
    await kubectl(["create", "namespace", options.namespace]);
    ownsNamespace = true;
    await kubectl(["apply", "-k", directory]);
    await kubectl(["rollout", "status", "deployment/pforge-claw-dispatcher", "-n", options.namespace, "--timeout=90s"]);
    await kubectl(["rollout", "status", "deployment/pforge-claw-egress-target", "-n", options.namespace, "--timeout=90s"]);
    await resumeProbe({ kubectl, namespace: options.namespace, name: "pforge-claw-egress-control" });
    await resumeProbe({ kubectl, namespace: options.namespace, name: "pforge-claw-egress-probe" });
    const scenarioEvidence = await runDeployedScenario({ kubectl, namespace: options.namespace, workerImage: options.workerImage, config });
    return { status: "passed", namespace: options.namespace, context: options.context, scenarioEvidence };
  } finally {
    try {
      if (ownsNamespace) await kubectl(["delete", "namespace", options.namespace, "--ignore-not-found=true", "--wait=true"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runK8sE2e(parseOptions(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.status === "blocked" ? 2 : 0;
  } catch (error) {
    const code = /^K8S_E2E_[A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "K8S_E2E_FAILED";
    process.stderr.write(`e2e-k8s: ${code}\n`);
    process.exitCode = 1;
  }
}
