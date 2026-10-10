import { APPROVER_ROLES } from "../approvals.mjs";
import { currentCaller, readCurrentConfig } from "../handlers/c2-command-context.mjs";
import { getProgressService, writeProgressAudit } from "../progress.mjs";

const PAYLOAD_RE = /^(r|n|a|w|s):([0-9a-f]{8})(?::(\d{1,2}))?$/;
const RECOVERY_ACTIONS = Object.freeze(["r", "n", "s"]);

function audit(service, record) {
  try {
    if (service?.audit) service.audit(record);
    else writeProgressAudit(record);
  } catch {
    // Callback processing remains available when audit storage fails.
  }
}

function reply(service, chatId, threadId, text) {
  return service?.sendReply?.({ chatId, threadId, text });
}

function callbackJobScope({ context, action, caller, chatId, threadId }) {
  return {
    projectId: context?.project?.id,
    chatId,
    threadId,
    ...(RECOVERY_ACTIONS.includes(action) ? { callerId: caller?.userId ?? caller?.callerId } : {}),
    states: action === "a" ? ["running", "failed"] : ["failed"],
  };
}

async function resolveCallbackJob(service, { context, shortId, action, caller, chatId, threadId }) {
  try {
    return service.resolveJob(shortId, callbackJobScope({ context, action, caller, chatId, threadId }));
  } catch (error) {
    audit(service, {
      kind: "progress-callback",
      action,
      reason: typeof error?.code === "string" ? error.code : "JOB_NOT_FOUND",
      userId: caller?.userId,
      chatId,
      threadId,
    });
    await reply(service, chatId, threadId, `${error?.code ?? "JOB_NOT_FOUND"}: Job not found.`);
    return null;
  }
}

async function performAction(service, input) {
  const { job, action, rawIndex, caller, chatId, threadId, context, adapter, updateId, messageId } = input;
  const options = {
    caller, chatId, threadId, adapter, updateId, messageId,
    project: context?.project, services: context?.services, fromCallback: true,
  };
  if (action === "r" || action === "n") {
    return service.createRecoveryJob(job, { ...options, mode: action === "n" ? "resume" : "retry" });
  }
  if (action === "a") return service.abortJob(job, caller);
  if (action === "w") return service.explainFailure(job, options);
  return service.applySuggestion(job, Number(rawIndex), options);
}

async function completeAction(service, input) {
  const { job, action, caller, chatId, threadId } = input;
  let result;
  try {
    result = await performAction(service, input);
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : "PROGRESS_ACTION_FAILED";
    audit(service, {
      kind: "progress-callback", action, jobId: job.id, outcome: code,
      userId: caller?.userId, chatId, threadId,
    });
    await reply(service, chatId, threadId, `${code}: This action could not be completed.`);
    return;
  }
  audit(service, {
    kind: "progress-callback", action, jobId: job.id, outcome: result?.error ?? "accepted",
    userId: caller?.userId, chatId, threadId,
  });
  if (result?.text) await reply(service, chatId, threadId, result.text);
}

export default Object.freeze({
  prefix: "f",
  sinceSlice: 12,
  available: true,
  roles: APPROVER_ROLES,
  async handle(context, { payload, caller, chatId, threadId, adapter, updateId, messageId } = {}) {
    const service = getProgressService();
    const match = PAYLOAD_RE.exec(String(payload ?? ""));
    if (!match) {
      audit(service, {
        kind: "callback-ignored",
        reason: "bad-payload",
        userId: caller?.userId,
        chatId,
        threadId,
      });
      return;
    }
    const authority = currentCaller(readCurrentConfig(context?.services ?? service), caller);
    if (!APPROVER_ROLES.includes(authority?.role)) {
      audit(service, {
        kind: "callback-ignored",
        reason: "role",
        userId: caller?.userId,
        chatId,
        threadId,
      });
      return;
    }
    if (!service) {
      audit(null, { kind: "callback-ignored", reason: "service-unavailable", chatId, threadId });
      return;
    }
    const [, action, shortId, rawIndex] = match;
    const job = await resolveCallbackJob(service, { context, shortId, action, caller, chatId, threadId });
    if (job) await completeAction(service, {
      job, action, rawIndex, caller: { ...caller, role: authority.role }, chatId, threadId,
      context, adapter, updateId, messageId,
    });
  },
});
