import { ClawError } from "../errors.mjs";
import { buildLeaseGrant } from "../protocol/lease-grant.mjs";
import { MAX_FRAME_BYTES } from "../protocol/messages.mjs";
import { collectCopySet, COPYSET_MAX_BYTES } from "./bootstrap.mjs";
import { resolveJobRuntime } from "./executor.mjs";

const PAYLOAD_FIELDS = Object.freeze([
  "id", "projectId", "type", "skill", "plan", "prompt", "args", "mutating", "parentId", "branch", "baseRef",
]);

export function proofFor(ctx, job) {
  // Mirrors dispatcher.approvalProof: only consumed approvals authorize a lease.
  if (job.type === "skill" && job.mutating === false) return { kind: "read-only", ref: null, decidedAt: null };
  const records = [...(ctx.store.read("approvals") ?? [])].map(({ record }) => record);
  for (const [id, kind] of [[job.id, "consumed"], [job.parentId, "parent-consumed"]]) {
    if (!id) continue;
    const record = records.find((entry) => entry.kind === "approval.consumed"
      && entry.decision === "approve" && entry.jobId === id);
    if (record) return {
      kind, ref: record.approvalId ?? record.id ?? record.nonceHash,
      decidedAt: record.decidedAt ?? record.usedAt,
    };
  }
  throw new ClawError("LEASE_PROOF_MISSING");
}

export function createLeasePreparer({ ctx, laneConfig, directory, now = Date.now }) {
  return async (job, { signal } = {}) => {
    signal?.throwIfAborted();
    if (job.runtime !== undefined) throw new ClawError("RUNTIME_POLICY_DENIED");
    const payload = {};
    for (const field of PAYLOAD_FIELDS) if (job[field] !== undefined) payload[field] = job[field];
    // The runners use description/planPath; the wire contract uses prompt/plan.
    if (payload.prompt === undefined && job.description !== undefined) payload.prompt = job.description;
    if (payload.plan === undefined && job.planPath !== undefined) payload.plan = job.planPath;
    payload.runtime = (await resolveJobRuntime({
      job, config: ctx.config, runtimeFactory: ({ id }) => ({ id, run() {} }),
    })).id;
    const proof = proofFor(ctx, job);
    if (laneConfig.kind === "k8s") {
      const project = ctx.config.projects.find((entry) => entry.id === job.projectId);
      if (!project) throw new ClawError("PROJECT_NOT_FOUND");
      payload.project = {
        id: project.id,
        repo: { url: project.repo.url ?? project.repo.remote, defaultBranch: project.repo.defaultBranch ?? project.repo.baseBranch },
        bootstrap: { copy: project.bootstrap?.copy },
      };
      if (project.homeLane === "local") {
        payload.bootstrapFiles = await collectCopySet({
          repoPath: project.repo.path, paths: project.bootstrap?.copy, maxBytes: COPYSET_MAX_BYTES,
        });
      } else {
        try {
          payload.bootstrapFiles = await directory.get(project.homeLane).read({
            projectId: project.id, tool: "claw.bootstrap.copySet", args: { projectId: project.id },
          }, { signal });
          if (!Array.isArray(payload.bootstrapFiles)) throw new ClawError("BOOTSTRAP_HOME_UNAVAILABLE");
        } catch {
          throw new ClawError("BOOTSTRAP_HOME_UNAVAILABLE");
        }
      }
    }
    signal?.throwIfAborted();
    payload.leaseGrant = buildLeaseGrant({ leaseJob: payload, laneId: laneConfig.id, proof, now });
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_FRAME_BYTES) throw new ClawError("LEASE_PAYLOAD_TOO_LARGE");
    return payload;
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
