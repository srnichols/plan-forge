import { APPROVER_ROLES } from "../approvals.mjs";
import { getProgressService, writeProgressAudit } from "../progress.mjs";

const PAYLOAD_RE = /^(r|n|a|w|s):([0-9a-f]{8})(?::(\d{1,2}))?$/;

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

export default Object.freeze({
  prefix: "f",
  sinceSlice: 12,
  available: true,
  roles: APPROVER_ROLES,
  async handle(context, { payload, caller, chatId, threadId } = {}) {
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
    if (!APPROVER_ROLES.includes(caller?.role)) {
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
    const states = action === "a" ? ["running", "failed"] : ["failed"];
    let job;
    try {
      job = service.resolveJob(shortId, {
        projectId: context?.project?.id,
        chatId,
        threadId,
        states,
      });
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
      return;
    }
    const options = { caller, chatId, threadId };
    let result;
    try {
      if (action === "r" || action === "n") {
        result = await service.createRecoveryJob(job, { ...options, mode: action === "n" ? "resume" : "retry" });
      } else if (action === "a") {
        result = await service.abortJob(job, caller);
      } else if (action === "w") {
        result = await service.explainFailure(job, options);
      } else {
        result = await service.applySuggestion(job, Number(rawIndex), options);
      }
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "PROGRESS_ACTION_FAILED";
      audit(service, {
        kind: "progress-callback",
        action,
        jobId: job.id,
        outcome: code,
        userId: caller?.userId,
        chatId,
        threadId,
      });
      await reply(service, chatId, threadId, `${code}: This action could not be completed.`);
      return;
    }
    audit(service, {
      kind: "progress-callback",
      action,
      jobId: job.id,
      outcome: result?.error ?? "accepted",
      userId: caller?.userId,
      chatId,
      threadId,
    });
    if (result?.text) await reply(service, chatId, threadId, result.text);
  },
});
