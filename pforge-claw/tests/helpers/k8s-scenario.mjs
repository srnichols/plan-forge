import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { currentJobs, JOBS_STREAM } from "../../src/jobs/model.mjs";
import { JOB_STATES } from "../../src/enums.mjs";
import { assembleDeltaChunks } from "../../src/memory/l2-sync.mjs";
import { applicationIdentity, matchesApplicationAck } from "../../src/protocol/l2-ack.mjs";
import { L2_PACKET_KIND } from "../../src/protocol/messages.mjs";
import { canonical } from "../../src/protocol/lease-grant.mjs";
import {
  assertFixturePath, FIXTURE_LANE, FIXTURE_MAX_BYTES, FIXTURE_PREFIX, FIXTURE_PROOF_FILE,
  FIXTURE_HTTP_STATUS, FIXTURE_TIMEOUT_MS, readFixtureControl, validateFixtureScope,
} from "./k8s-fixture-common.mjs";

const MAX_EVENTS = 100;
const MAX_FILES = 16;
const SHA256 = /^[0-9a-f]{64}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const DIAGNOSTIC_REQUEST_TIMEOUT_MS = 3000;
const DIAGNOSTIC_JOB_TIMEOUT_MS = 2000;
const MAX_DIAGNOSTIC_COUNT = 2_147_483_647;
export const SCENARIO_DIAGNOSTIC_PREFIX = "K8S_E2E_SCENARIO_DIAGNOSTIC ";
export const SCENARIO_PHASE = Object.freeze({
  REQUEST: "request", APPROVAL: "approval", WORKER: "worker", COMPLETION: "completion", PROOF: "proof",
});
const SCENARIO_ERRORS = Object.freeze([
  "K8S_E2E_APPLICATION_UNCONFIRMED", "K8S_E2E_WORKER_UNCONFIRMED", "K8S_E2E_APPROVAL_UNCONFIRMED",
  "K8S_E2E_GRANT_UNCONFIRMED", "K8S_E2E_HISTORY_PROOF_INVALID", "K8S_E2E_QUEUE_UNCONFIRMED",
  "K8S_E2E_EVENTS_INVALID", "K8S_E2E_PROOF_TOO_LARGE", "K8S_E2E_SCENARIO_SINGLE_USE",
  "K8S_E2E_SCENARIO_FAILED", "K8S_E2E_SCENARIO_TIMEOUT", "K8S_E2E_SCENARIO_STOPPED", "K8S_E2E_CONTROL_UNAUTHORIZED",
  "K8S_E2E_CONTROL_INPUT_INVALID", "K8S_E2E_CONTROL_INVALID", "K8S_E2E_FIXTURE_PATH_INVALID",
  "K8S_E2E_NAMESPACE_INVALID", "K8S_E2E_CONTEXT_NOT_LOCAL",
]);
const diagnosticFlag = (value) => typeof value === "boolean" ? value : null;
const diagnosticCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DIAGNOSTIC_COUNT ? value : null;
const diagnosticObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const JOB_REJECTION_CODES = new Set([
  "K8S_API", "K8S_BAD_INPUT", "K8S_BAD_CONFIG", "K8S_UNAVAILABLE", "K8S_NETWORK", "K8S_TIMEOUT",
  "K8S_LANE_SECRET_MISSING", "K8S_NO_IMAGE", "LANE_BAD_CONFIG", "LANE_BAD_EVENT",
  "JOB_DUPLICATE", "JOB_CANCELLED", "LEASE_PROOF_MISSING", "LEASE_GRANT_INVALID",
  "RUNTIME_POLICY_DENIED", "BOOTSTRAP_SECRET_MISSING",
]);
const ADDITIONAL_HTTP_ERRORS = Object.freeze({
  GONE: 410, UNPROCESSABLE: 422, RATE_LIMITED: 429, INTERNAL: 500, UNAVAILABLE: 503, GATEWAY_TIMEOUT: 504,
});
const REJECTION_HTTP_STATUSES = new Set([
  ...Object.values(FIXTURE_HTTP_STATUS).filter((status) => status >= FIXTURE_HTTP_STATUS.BAD_REQUEST),
  ...Object.values(ADDITIONAL_HTTP_ERRORS),
]);

/** Whitelist declared pre-worker failure codes and known HTTP errors; never echo messages or bodies. */
export function normalizeJobRejection(input = {}) {
  const selected = diagnosticObject(input);
  return {
    code: JOB_REJECTION_CODES.has(selected.code) ? selected.code : null,
    apiCode: JOB_REJECTION_CODES.has(selected.apiCode) ? selected.apiCode : null,
    httpStatus: REJECTION_HTTP_STATUSES.has(selected.httpStatus) ? selected.httpStatus : null,
    createAttempted: diagnosticFlag(selected.createAttempted),
  };
}

/** Return only declared fixture failure codes, never provider/error text. */
export function scenarioErrorCode(error) {
  if (["TimeoutError", "AbortError"].includes(error?.name)) return "K8S_E2E_SCENARIO_TIMEOUT";
  const code = typeof error === "string" ? error : error?.message;
  return SCENARIO_ERRORS.includes(code) ? code : "K8S_E2E_SCENARIO_FAILED";
}

function workerDiagnostics(worker = {}) {
  return {
    created: diagnosticFlag(worker?.created), statusRead: diagnosticFlag(worker?.statusRead),
    active: diagnosticCount(worker?.active), ready: diagnosticCount(worker?.ready),
    succeeded: diagnosticCount(worker?.succeeded), failed: diagnosticCount(worker?.failed),
    complete: diagnosticFlag(worker?.complete),
  };
}

function completionDiagnostics(completion = {}) {
  return {
    present: diagnosticFlag(completion?.present), ok: diagnosticFlag(completion?.ok),
    applicationAckPresent: diagnosticFlag(completion?.applicationAckPresent),
    applicationAckOk: diagnosticFlag(completion?.applicationAckOk),
    terminalAckMatches: diagnosticFlag(completion?.terminalAckMatches),
    terminalStatus: JOB_STATES.includes(completion?.terminalStatus) ? completion.terminalStatus : null,
  };
}

function eventDiagnostics(events = {}) {
  return {
    observed: diagnosticCount(events?.observed), artifacts: diagnosticCount(events?.artifacts),
    deltaChunks: diagnosticCount(events?.deltaChunks), terminals: diagnosticCount(events?.terminals),
    lastSeq: diagnosticCount(events?.lastSeq), ordered: diagnosticFlag(events?.ordered),
    rejected: diagnosticFlag(events?.rejected),
  };
}

/**
 * Whitelist the bounded failure DTO at both HTTP and stderr boundaries; missing measurements stay null.
 * Contains only stage/state enums, readiness/approval/grant/ACK flags and worker/event counts.
 * jobRejection contains a declared durable code, typed API code, known HTTP error status and create-attempt flag.
 * Never contains job IDs, paths, keys, provider text, raw events, worker specs or application payloads.
 * @param {object} input
 * @returns {object}
 */
export function normalizeScenarioDiagnostics(input = {}) {
  const selected = diagnosticObject(input);
  return {
    schemaVersion: 1, status: "failed", code: scenarioErrorCode(selected.code),
    phase: Object.values(SCENARIO_PHASE).includes(selected.phase) ? selected.phase : "unknown",
    jobState: JOB_STATES.includes(selected.jobState) ? selected.jobState : null,
    jobs: diagnosticCount(selected.jobs), approvalConsumed: diagnosticFlag(selected.approvalConsumed),
    receiptPresent: diagnosticFlag(selected.receiptPresent), grantVerified: diagnosticFlag(selected.grantVerified),
    dispatcherReady: diagnosticFlag(selected.dispatcherReady), receiverReady: diagnosticFlag(selected.receiverReady),
    connectedWorkers: diagnosticCount(selected.connectedWorkers),
    worker: workerDiagnostics(selected.worker), completion: completionDiagnostics(selected.completion),
    events: eventDiagnostics(selected.events),
    jobRejection: normalizeJobRejection(selected.jobRejection),
  };
}

function receiptVerified(receipt, job) {
  if (!receipt || !job) return false;
  try {
    verifyWorkerReceipt(receipt, job);
    return true;
  } catch {
    return false;
  }
}

function terminalAckMatches(completion, job) {
  const ack = completion?.applicationAck;
  if (!ack || !job) return null;
  try {
    const identity = applicationIdentity(ack);
    return identity.jobId === job.id && identity.projectId === job.projectId
      && matchesApplicationAck(identity, completion.event?.data?.l2);
  } catch {
    return false;
  }
}

function completionSnapshot(completion, job) {
  const ack = completion?.applicationAck;
  return {
    present: Boolean(completion), ok: completion?.ok,
    applicationAckPresent: Boolean(ack), applicationAckOk: ack?.ok, terminalAckMatches: terminalAckMatches(completion, job),
    terminalStatus: completion?.event?.data?.status,
  };
}

function eventSnapshot({ events, completion, job, rejected }) {
  const sequence = [...events, ...(completion?.event ? [completion.event] : [])];
  let lastSeq = 0;
  const ordered = sequence.every((event) => {
    if (event?.jobId !== job?.id || !Number.isSafeInteger(event.seq) || event.seq <= lastSeq) return false;
    lastSeq = event.seq;
    return true;
  });
  return {
    observed: sequence.length, artifacts: events.filter((event) => event.type === "artifact").length,
    deltaChunks: events.filter((event) => event.type === "artifact" && event.data?.kind === L2_PACKET_KIND).length,
    terminals: sequence.filter((event) => event.type === "finished").length, lastSeq: lastSeq || null,
    ordered, rejected: rejected === true,
  };
}

function workerStatusSnapshot(status) {
  return {
    created: true, statusRead: true, active: status?.active, ready: status?.ready,
    succeeded: status?.succeeded, failed: status?.failed,
    complete: status?.conditions?.some((condition) => condition.type === "Complete" && condition.status === "True") ?? false,
  };
}

async function workerSnapshot(fixture, job) {
  const name = job && fixture.jobNames.get(job.id);
  const api = job && fixture.apis.get(job.lane);
  if (!name || !api) return { created: false, statusRead: false };
  let timer;
  try {
    const worker = await Promise.race([
      api.getJob(fixture.control.namespace, name),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("diagnostic read deadline")), DIAGNOSTIC_JOB_TIMEOUT_MS); }),
    ]);
    return workerStatusSnapshot(worker?.status);
  } catch {
    return { created: true, statusRead: false };
  } finally {
    clearTimeout(timer);
  }
}

function jobRejectionSnapshot(fixture, job) {
  if (!job) return { createAttempted: null };
  const creation = fixture.jobCreations.get(job.id);
  let code = null;
  // Job state reduction drops reasons; measure this job's matching durable transition instead.
  for (const { record } of fixture.handles.store.read(JOBS_STREAM)) {
    if (record.kind === "job.transition" && record.jobId === job.id && record.to === job.state) {
      code = normalizeJobRejection({ code: record.reason }).code;
    }
  }
  return { ...creation, code, createAttempted: Boolean(creation) };
}

/**
 * Measure only the exact scenario job, using existing read-only job/registry APIs; never select the latest job.
 * Diagnostics cannot supply acceptance evidence or start/retry a scenario.
 * @param {{fixture: object, code?: string}} options
 * @returns {Promise<object>}
 */
export async function collectScenarioDiagnostics({ fixture, code = "K8S_E2E_SCENARIO_FAILED" }) {
  const jobs = currentJobs(fixture.handles.store);
  const job = fixture.scenarioJobId ? jobs[fixture.scenarioJobId] : null;
  const receipt = job && fixture.receipts.get(job.id);
  const completion = job && fixture.registry.completion(job.id);
  const events = job ? fixture.events.entries.get(job.id) ?? [] : [];
  return normalizeScenarioDiagnostics({
    code, phase: fixture.scenarioPhase, jobs: Object.keys(jobs).length, jobState: job?.state,
    approvalConsumed: job ? approvalConsumed(fixture.handles.store, job.id) : false,
    receiptPresent: Boolean(receipt), grantVerified: receiptVerified(receipt, job),
    dispatcherReady: fixture.handles.appStarted === true, receiverReady: typeof fixture.receiver?.receive === "function",
    connectedWorkers: fixture.registry.snapshot().workers,
    worker: await workerSnapshot(fixture, job), completion: completionSnapshot(completion, job),
    events: eventSnapshot({ events, completion, job, rejected: job && fixture.events.rejected.has(job.id) }),
    jobRejection: jobRejectionSnapshot(fixture, job),
  });
}

class ScenarioFailure extends Error {
  constructor(code, diagnostics) {
    super(scenarioErrorCode(code));
    this.name = "ScenarioFailure";
    if (diagnostics) this.diagnostics = normalizeScenarioDiagnostics({ ...diagnostics, code: this.message });
  }
}

function requireCompletionTerminal(terminal, identity) {
  if (!terminal || !terminal.data || terminal.jobId !== identity.jobId || terminal.type !== "finished"
    || terminal.data.status !== "succeeded" || !Number.isSafeInteger(terminal.seq) || terminal.seq < 1) {
    throw new Error("K8S_E2E_APPLICATION_UNCONFIRMED");
  }
  if (!matchesApplicationAck(identity, terminal.data.l2) || terminal.data.l2.ok !== true) {
    throw new Error("K8S_E2E_APPLICATION_UNCONFIRMED");
  }
}

/** Receipt, worker exit or a generic ok never stands in for canonical application. */
export function requireApplicationCompletion({ jobId, projectId, completion }) {
  let identity;
  try {
    identity = applicationIdentity(completion?.applicationAck ?? {});
  } catch {
    throw new Error("K8S_E2E_APPLICATION_UNCONFIRMED");
  }
  const terminal = completion?.event;
  if (completion.ok !== true || completion.applicationAck.ok !== true
    || identity.jobId !== jobId || identity.projectId !== projectId) {
    throw new Error("K8S_E2E_APPLICATION_UNCONFIRMED");
  }
  requireCompletionTerminal(terminal, identity);
  return { identity, terminal, applicationAck: { ...identity, ok: true } };
}

function approvalConsumed(store, jobId) {
  return [...store.read("approvals")].some(({ record }) =>
    record.kind === "approval.consumed" && record.jobId === jobId && record.decision === "approve");
}

function verifyWorkerReceipt(receipt, job) {
  if (receipt?.jobId !== job.id || receipt.projectId !== job.projectId || receipt.laneId !== FIXTURE_LANE
    || receipt.oneShot !== true || receipt.leaseGrantVerified !== true
    || !SHA256.test(receipt.choiceDigest ?? "") || hash(canonical(receipt.choices)) !== receipt.choiceDigest) {
    throw new Error("K8S_E2E_GRANT_UNCONFIRMED");
  }
}

function deltaFromEvents(events, identity) {
  const chunks = events.filter((event) => event.type === "artifact" && event.data?.kind === L2_PACKET_KIND
    && event.data.deltaId === identity.deltaId && event.data.sha256Total === identity.sha256Total)
    .map((event) => event.data);
  if (!chunks.length) throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
  return assembleDeltaChunks({ chunks });
}

async function canonicalFiles({ forgeHome, delta }) {
  if (!delta.files.length || delta.files.length > MAX_FILES) throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
  const expected = [];
  const applied = [];
  for (const file of delta.files) {
    const target = await assertFixturePath(forgeHome, path.join(forgeHome, ...file.rel.split("/")));
    const sourceBytes = Buffer.from(file.dataB64, "base64");
    if (hash(sourceBytes) !== file.sha256) throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
    const appliedHash = hash(await readFile(target));
    if (appliedHash !== file.sha256) throw new Error("K8S_E2E_HISTORY_PROOF_INVALID");
    expected.push({ path: file.rel, sha256: file.sha256 });
    applied.push({ path: file.rel, sha256: appliedHash });
  }
  return { expectedL2Files: expected, canonicalL2Files: applied };
}

async function canonicalQueue({ forgeHome, delta }) {
  const lines = delta.jsonl["openbrain-queue.jsonl"];
  if (!Array.isArray(lines) || lines.length !== 1) throw new Error("K8S_E2E_QUEUE_UNCONFIRMED");
  const target = await assertFixturePath(forgeHome, path.join(forgeHome, "openbrain-queue.jsonl"));
  const bytes = await readFile(target);
  const expected = Buffer.from(lines.map((line) => line.endsWith("\n") ? line : `${line}\n`).join(""));
  if (!bytes.equals(expected)) throw new Error("K8S_E2E_QUEUE_UNCONFIRMED");
  return { path: "openbrain-queue.jsonl", sha256: hash(bytes), expectedSha256: hash(expected), records: lines.length };
}

function proofEvents(events, terminal) {
  const ordered = [...events.filter((event) => event.type !== "finished"), terminal];
  if (ordered.length > MAX_EVENTS) throw new Error("K8S_E2E_EVENTS_INVALID");
  return ordered.map((event) => ({
    jobId: event.jobId, seq: event.seq, type: event.type,
    data: event.type === "artifact" && event.data?.kind === L2_PACKET_KIND
      ? { kind: L2_PACKET_KIND, deltaId: event.data.deltaId, sha256Total: event.data.sha256Total }
      : event.type === "artifact" ? { kind: event.data.kind, url: event.data.url, branch: event.data.branch }
      : event.type === "finished" ? { status: event.data.status, l2: event.data.l2 }
      : {},
  }));
}

/** Derive proof from real durable approvals, registry completion, wire chunks and canonical bytes. */
export async function collectScenarioEvidence({ namespace, handles, registry, receipt, events, jobId, jobName }) {
  const job = currentJobs(handles.store)[jobId];
  if (job?.state !== "succeeded" || job.lane !== FIXTURE_LANE || !approvalConsumed(handles.store, jobId)) {
    throw new Error("K8S_E2E_APPROVAL_UNCONFIRMED");
  }
  verifyWorkerReceipt(receipt, job);
  const { identity, terminal, applicationAck } = requireApplicationCompletion({
    jobId, projectId: job.projectId, completion: registry.completion(jobId),
  });
  const project = handles.config.projects.find((entry) => entry.id === job.projectId);
  const delta = deltaFromEvents(events, identity);
  const proof = {
    namespace, laneId: job.lane, approvalConsumed: true, leaseGrantVerified: receipt.leaseGrantVerified,
    oneShot: receipt.oneShot, jobId, jobName, prUrl: job.prUrl, transfer: identity, applicationAck,
    ...await canonicalFiles({ forgeHome: project.repo.forgeHome, delta }),
    canonicalQueue: await canonicalQueue({ forgeHome: project.repo.forgeHome, delta }),
    signedChoices: receipt.choices, choiceDigest: receipt.choiceDigest, jobEvents: proofEvents(events, terminal),
  };
  if (Buffer.byteLength(JSON.stringify(proof)) > FIXTURE_MAX_BYTES) throw new Error("K8S_E2E_PROOF_TOO_LARGE");
  return proof;
}

/** Request the disposable dispatcher's actual approval/job scenario; never submit a pre-authored Job. */
export async function runK8sScenario({ control, home = process.env.PFORGE_CLAW_HOME ?? "/data", output = true, fetchFn = fetch } = {}) {
  control ??= await readFixtureControl(home);
  validateFixtureScope(control);
  const headers = {
    "content-type": "application/json", "x-fixture-token": control.token,
    "x-fixture-namespace": control.namespace, "x-fixture-context": control.context,
  };
  try {
    const response = await fetchFn(`${control.url}${FIXTURE_PREFIX}/scenario`, {
      method: "POST", signal: AbortSignal.timeout(FIXTURE_TIMEOUT_MS), headers, body: "{}",
    });
    const proof = await readScenarioResponse(response);
    if (output) {
      const destination = await assertFixturePath(home, path.join(home, FIXTURE_PROOF_FILE));
      await writeFile(destination, JSON.stringify(proof) + "\n", { mode: 0o600 });
    }
    return proof;
  } catch (error) {
    const code = scenarioErrorCode(error);
    const diagnostics = error instanceof ScenarioFailure && error.diagnostics
      ? error.diagnostics : await requestScenarioDiagnostics({ control, headers, fetchFn });
    throw new ScenarioFailure(code, diagnostics ?? {});
  }
}

async function readScenarioDocument(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > FIXTURE_MAX_BYTES) throw new Error("K8S_E2E_PROOF_TOO_LARGE");
  return JSON.parse(bytes.toString("utf8"));
}

async function requestScenarioDiagnostics({ control, headers, fetchFn }) {
  try {
    const response = await fetchFn(`${control.url}${FIXTURE_PREFIX}/diagnostics`, {
      method: "POST", signal: AbortSignal.timeout(DIAGNOSTIC_REQUEST_TIMEOUT_MS), headers, body: "{}",
    });
    const body = await readScenarioDocument(response);
    return response.ok ? normalizeScenarioDiagnostics(body.diagnostics) : null;
  } catch {
    return null;
  }
}

async function readScenarioResponse(response) {
  const proof = await readScenarioDocument(response);
  if (!response.ok || proof.status === "blocked" || !proof.jobId) {
    throw new ScenarioFailure(proof.code, proof.diagnostics);
  }
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const proof = await runK8sScenario();
    process.stdout.write(JSON.stringify({ status: "fixture-scenario-complete", jobId: proof.jobId }) + "\n");
  } catch (error) {
    process.stderr.write(scenarioErrorCode(error) + "\n");
    const diagnostics = normalizeScenarioDiagnostics({ ...error?.diagnostics, code: scenarioErrorCode(error) });
    process.stderr.write(SCENARIO_DIAGNOSTIC_PREFIX + JSON.stringify(diagnostics) + "\n");
    process.exitCode = 1;
  }
}
