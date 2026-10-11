import { ClawError } from "../errors.mjs";
import { buildLeaseGrant } from "../protocol/lease-grant.mjs";
import { MAX_FRAME_BYTES } from "../protocol/messages.mjs";
import { collectCopySet, COPYSET_MAX_BYTES } from "./bootstrap.mjs";
import { resolveJobRuntime } from "../runtime/agent-runtime.mjs";
import { byokProviderReference } from "../runtime/byok.mjs";
import { planExecutionChoices, projectExecutionChoices, snapshotExecutionChoices } from "./execution-choices.mjs";
import { approvedChoicesFor, consumedApprovalFor, currentJobCaller, fanoutProofFor } from "./approval-proof.mjs";
import { currentJobs } from "./model.mjs";
import { normalizeRequestFields } from "./request-identity.mjs";

const PAYLOAD_FIELDS = Object.freeze([
  "id", "projectId", "type", "skill", "plan", "prompt", "args", "mutating", "parentId", "branch", "baseRef",
  "readOnly", "summary",
]);

function dispatchAuthorization(ctx, requested) {
  const jobs = currentJobs(ctx.store);
  const stored = jobs[requested.id];
  if (!stored || JSON.stringify(normalizeRequestFields(stored)) !== JSON.stringify(normalizeRequestFields(requested))) {
    throw new ClawError("LEASE_PROOF_MISSING");
  }
  if (stored.type === "skill" && stored.mutating === false) {
    if (!currentJobCaller({ config: ctx.config, job: stored })) throw new ClawError("LEASE_PROOF_MISSING");
    return { job: stored, approval: null, proof: { kind: "read-only", ref: null, decidedAt: null } };
  }
  const approval = consumedApprovalFor({ store: ctx.store, config: ctx.config, job: requested })
    ?? fanoutProofFor({
      store: ctx.store, config: ctx.config, parent: jobs[stored.parentId], child: requested,
    });
  if (!approval) throw new ClawError("LEASE_PROOF_MISSING");
  return {
    job: stored,
    approval,
    proof: {
      kind: approval.jobId === stored.id ? "consumed" : "parent-consumed",
      ref: approval.nonceHash,
      decidedAt: approval.usedAt,
    },
  };
}

export function proofFor(ctx, job) {
  return dispatchAuthorization(ctx, job).proof;
}

function assertUnsignedJob(job) {
  if (job.runtime !== undefined || job.provider !== undefined) throw new ClawError("RUNTIME_POLICY_DENIED");
  planExecutionChoices(job);
}

function copyJobPayload(job) {
  assertUnsignedJob(job);
  const payload = planExecutionChoices(job);
  for (const field of PAYLOAD_FIELDS) if (job[field] !== undefined) payload[field] = job[field];
  // Keep the existing wire aliases; authorization and state remain dispatcher-owned.
  if (payload.prompt === undefined && job.description !== undefined) payload.prompt = job.description;
  if (payload.plan === undefined && job.planPath !== undefined) payload.plan = job.planPath;
  return payload;
}

async function bootstrapFilesFor({ config, project, paths, directory, signal }) {
  const homeLane = config.lanes?.find((lane) => lane.id === project.homeLane);
  if (!homeLane) throw new ClawError("BOOTSTRAP_HOME_UNAVAILABLE");
  if (homeLane.kind === "local") return collectCopySet({
    repoPath: project.repo.path, paths, maxBytes: COPYSET_MAX_BYTES,
  });
  try {
    const files = await directory.get(project.homeLane).read({
      projectId: project.id, tool: "claw.bootstrap.copySet", args: { projectId: project.id, paths },
    }, { signal });
    if (!Array.isArray(files)) throw new ClawError("BOOTSTRAP_HOME_UNAVAILABLE");
    return files;
  } catch {
    throw new ClawError("BOOTSTRAP_HOME_UNAVAILABLE");
  }
}

/**
 * Returns an immutable, allow-listed payload with signed quorum/resume, runtime,
 * provider references, project models/bootstrap metadata, and optional pod copy set.
 * No provider key is resolved here; workers resolve keySecret at execution.
 */
export function createLeasePreparer({ ctx, laneConfig, directory, now = Date.now }) {
  return async (inputJob, { signal } = {}) => {
    signal?.throwIfAborted();
    const requested = snapshotExecutionChoices(inputJob);
    assertUnsignedJob(requested);
    const config = snapshotExecutionChoices(ctx.config);
    const lane = snapshotExecutionChoices(laneConfig);
    const authorization = dispatchAuthorization({ ...ctx, config }, requested);
    const choices = approvedChoicesFor({ job: authorization.job, approval: authorization.approval });
    const job = snapshotExecutionChoices({
      ...authorization.job,
      ...(choices.quorum !== null ? { quorum: choices.quorum } : {}),
    });
    const payload = copyJobPayload(job);
    const project = config.projects?.find((entry) => entry.id === job.projectId);
    if (!project) throw new ClawError("PROJECT_NOT_FOUND");
    payload.runtime = (await resolveJobRuntime({
      job, config, project, lane, runtimeFactory: ({ id }) => ({ id, run() {} }),
    })).id;
    const provider = byokProviderReference({ type: payload.runtime, config });
    if (provider) payload.provider = provider;
    payload.project = projectExecutionChoices({ config, project, lane });
    const proof = authorization.proof;
    if (lane.kind === "k8s") payload.bootstrapFiles = await bootstrapFilesFor({
      config, project, paths: payload.project.bootstrap.copy, directory, signal,
    });
    signal?.throwIfAborted();
    payload.leaseGrant = buildLeaseGrant({ leaseJob: payload, laneId: lane.id, proof, now });
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_FRAME_BYTES) throw new ClawError("LEASE_PAYLOAD_TOO_LARGE");
    return snapshotExecutionChoices(payload);
  };
}

export function wrapPreparedLane(lane, prepare) {
  const prepared = new Map();
  const pending = new Map();
  return {
    ...lane,
    async prepareLease(job, options) {
      const token = {};
      prepared.delete(job.id);
      pending.set(job.id, token);
      try {
        const payload = await prepare(job, options);
        if (pending.get(job.id) !== token) throw new ClawError("JOB_CANCELLED");
        prepared.set(job.id, payload);
        return payload;
      } finally {
        if (pending.get(job.id) === token) pending.delete(job.id);
      }
    },
    submit(job) {
      const payload = prepared.get(job.id);
      prepared.delete(job.id);
      if (!payload) throw new ClawError("LEASE_NOT_PREPARED");
      return lane.submit(payload);
    },
    cancel(id) {
      prepared.delete(id);
      pending.delete(id);
      return lane.cancel(id);
    },
  };
}
