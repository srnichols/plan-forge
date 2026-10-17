import { authorizeJobRequest, readCurrentConfig } from "../handlers/c2-command-context.mjs";
import { ensureRequestJob, findRequestJob, normalizeRequestFields, requestIdentity, withRequestIdentity } from "./request-identity.mjs";

/** Preparation failures never advertise a job from an earlier request. */
export function preparationFailure(text) {
  return { text, jobId: null, state: null };
}

function authorityFor(deps, input) {
  return authorizeJobRequest({
    ...deps, config: readCurrentConfig(deps), caller: input.caller ?? deps.caller,
  });
}

function requestFor({ deps, input, type, authority }) {
  return normalizeRequestFields({
    adapter: input.adapter ?? deps.adapter ?? authority.caller.channel,
    updateId: input.updateId ?? deps.updateId ?? null,
    type,
    projectId: authority.project.id,
    callerId: String(authority.caller.userId),
    chatId: input.chatId ?? deps.chatId ?? null,
    threadId: input.threadId ?? deps.threadId ?? null,
    parentId: input.parentId ?? deps.parentId ?? null,
  });
}

function jobReply(job, label, suffix = "") {
  const stateText = job.state === "awaiting-approval" ? "awaiting approval" : job.state;
  const prefix = job.type === "skill" && job.readOnly ? "Read-only skill" : label;
  return { text: `${prefix} job ${job.id} is ${stateText}.${suffix}`, jobId: job.id, state: job.state };
}

function provenanceFor(authority, input) {
  return {
    callerRole: authority.caller.role,
    ...(authority.constraint ? { constraint: authority.constraint } : {}),
    ...(input.origin === "untrusted" ? { origin: "untrusted" } : {}),
  };
}

/** Runs preparation once per scoped delivery and rechecks authority immediately before durable creation. */
export async function prepareProducer({ deps, input = {}, type, label }, prepareFields) {
  if (Object.hasOwn(input, "runtime") || Object.hasOwn(input, "provider")) {
    return preparationFailure("RUNTIME_POLICY_DENIED: Execution choices must come from configuration.");
  }
  const authority = authorityFor(deps, input);
  if (!authority.ok) return preparationFailure(authority.text);
  const request = requestFor({ deps, input, type, authority });
  return withRequestIdentity({ identity: requestIdentity(request) }, async () => {
    const admitted = authorityFor(deps, input);
    if (!admitted.ok) return preparationFailure(admitted.text);
    const existing = findRequestJob(deps.store, request);
    if (existing) {
      const recovered = ensureRequestJob({ store: deps.store, request });
      return jobReply(recovered.job, label);
    }
    const prepared = await prepareFields({ ...admitted, request });
    if (!prepared.fields) return prepared;
    const current = authorityFor(deps, input);
    if (!current.ok) return preparationFailure(current.text);
    const { job } = ensureRequestJob({
      store: deps.store, request, now: deps.now,
      fields: { ...prepared.fields, ...provenanceFor(current, input) },
    });
    return jobReply(job, label, prepared.suffix);
  });
}
