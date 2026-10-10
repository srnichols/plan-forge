import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { currentJobs } from "../../src/jobs/model.mjs";
import { assembleDeltaChunks } from "../../src/memory/l2-sync.mjs";
import { applicationIdentity, matchesApplicationAck } from "../../src/protocol/l2-ack.mjs";
import { L2_PACKET_KIND } from "../../src/protocol/messages.mjs";
import { canonical } from "../../src/protocol/lease-grant.mjs";
import {
  assertFixturePath, FIXTURE_LANE, FIXTURE_MAX_BYTES, FIXTURE_PREFIX, FIXTURE_PROOF_FILE,
  FIXTURE_TIMEOUT_MS, readFixtureControl, validateFixtureScope,
} from "./k8s-fixture-common.mjs";

const MAX_EVENTS = 100;
const MAX_FILES = 16;
const SHA256 = /^[0-9a-f]{64}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
  const response = await fetchFn(`${control.url}${FIXTURE_PREFIX}/scenario`, {
    method: "POST", signal: AbortSignal.timeout(FIXTURE_TIMEOUT_MS),
    headers: { "content-type": "application/json", "x-fixture-token": control.token, "x-fixture-namespace": control.namespace, "x-fixture-context": control.context },
    body: "{}",
  });
  const proof = await readScenarioResponse(response);
  if (output) {
    const destination = await assertFixturePath(home, path.join(home, FIXTURE_PROOF_FILE));
    await writeFile(destination, JSON.stringify(proof) + "\n", { mode: 0o600 });
  }
  return proof;
}

async function readScenarioResponse(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > FIXTURE_MAX_BYTES) throw new Error("K8S_E2E_PROOF_TOO_LARGE");
  const proof = JSON.parse(bytes.toString("utf8"));
  if (!response.ok || proof.status === "blocked" || !proof.jobId) {
    throw new Error(/^K8S_E2E_[A-Z_]+$/.test(proof.code ?? "") ? proof.code : "K8S_E2E_SCENARIO_FAILED");
  }
  return proof;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const proof = await runK8sScenario();
    process.stdout.write(JSON.stringify({ status: "fixture-scenario-complete", jobId: proof.jobId }) + "\n");
  } catch (error) {
    process.stderr.write((/^K8S_E2E_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "K8S_E2E_SCENARIO_FAILED") + "\n");
    process.exitCode = 1;
  }
}
