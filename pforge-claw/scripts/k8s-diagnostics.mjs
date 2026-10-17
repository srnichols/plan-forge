import { pathToFileURL } from "node:url";
import { ClawError } from "../src/errors.mjs";

const MAX_INPUT_BYTES = 1_048_576;
const MAX_CONTAINERS = 16;
const MAX_OUTPUT_BYTES = 10_240;
const MAX_STATUS_NUMBER = 2_147_483_647;
const POD_NAME_MAX_LENGTH = 253;
const LABEL_MAX_LENGTH = 63;
const DNS_NAME = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
const PHASES = Object.freeze(["Pending", "Running", "Succeeded", "Failed", "Unknown"]);
const STATE_TYPES = Object.freeze(["waiting", "running", "terminated"]);
const STATE_REASONS = Object.freeze([
  "ContainerCreating", "PodInitializing", "CrashLoopBackOff", "ErrImagePull", "ImagePullBackOff",
  "InvalidImageName", "CreateContainerConfigError", "CreateContainerError", "RunContainerError",
  "Completed", "Error", "OOMKilled", "ContainerCannotRun", "DeadlineExceeded", "Evicted", "Terminated",
]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function identifier(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && DNS_NAME.test(value) ? value : null;
}

function statusNumber(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_STATUS_NUMBER ? value : null;
}

function timestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function containerState(value) {
  const type = STATE_TYPES.find((candidate) => value?.[candidate] && typeof value[candidate] === "object");
  if (!type) return null;
  const state = value[type];
  return {
    type,
    reason: STATE_REASONS.includes(state.reason) ? state.reason : null,
    exitCode: type === "terminated" ? statusNumber(state.exitCode) : null,
    startedAt: type === "running" || type === "terminated" ? timestamp(state.startedAt) : null,
    finishedAt: type === "terminated" ? timestamp(state.finishedAt) : null,
  };
}

function containerStatus(status) {
  return {
    name: identifier(status?.name, LABEL_MAX_LENGTH),
    ready: typeof status?.ready === "boolean" ? status.ready : null,
    restarts: statusNumber(status?.restartCount),
    state: containerState(status?.state),
    previousState: containerState(status?.lastState),
  };
}

function limitedStatuses(groups) {
  const containers = [];
  for (const group of groups) {
    for (const status of group) {
      if (containers.length >= MAX_CONTAINERS) break;
      containers.push(containerStatus(status));
    }
  }
  return containers;
}

function podIdentity(pod) {
  const namespace = identifier(pod?.metadata?.namespace, LABEL_MAX_LENGTH);
  const name = identifier(pod?.metadata?.name, POD_NAME_MAX_LENGTH);
  if (pod?.kind !== "Pod" || !namespace || !name) throw new ClawError("K8S_DIAGNOSTICS_INPUT_INVALID");
  const phase = PHASES.includes(pod.status?.phase) ? pod.status.phase : "Unknown";
  return { namespace, name, phase };
}

/**
 * Return only bounded, validated Pod identity and container status fields; never copy spec, annotations or messages.
 * @param {object} pod
 * @returns {{ok: true, pod: object, containers: object[], totalContainers: number, limit: number, truncated: boolean}}
 */
export function summarizePod(pod) {
  const identity = podIdentity(pod);
  const groups = [pod.status?.initContainerStatuses, pod.status?.containerStatuses, pod.status?.ephemeralContainerStatuses]
    .filter(Array.isArray);
  const totalContainers = groups.reduce((total, group) => total + group.length, 0);
  const containers = limitedStatuses(groups);
  const summary = {
    ok: true,
    pod: identity,
    containers, totalContainers, limit: MAX_CONTAINERS, truncated: totalContainers > containers.length,
  };
  while (Buffer.byteLength(JSON.stringify(summary)) > MAX_OUTPUT_BYTES) {
    containers.pop();
    summary.truncated = true;
  }
  return summary;
}

async function readPod(input) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_INPUT_BYTES) throw new ClawError("K8S_DIAGNOSTICS_INPUT_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ClawError("K8S_DIAGNOSTICS_INPUT_INVALID");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 2 || process.stdin.isTTY) throw new ClawError("K8S_DIAGNOSTICS_INPUT_INVALID");
    process.stdout.write(JSON.stringify(summarizePod(await readPod(process.stdin))) + "\n");
  } catch (error) {
    const code = error instanceof ClawError ? error.code : "K8S_DIAGNOSTICS_INPUT_INVALID";
    process.stdout.write(JSON.stringify({ ok: false, code }) + "\n");
    process.exitCode = 2;
  }
}
