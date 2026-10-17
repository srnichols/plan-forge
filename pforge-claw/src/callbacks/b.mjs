import { getBudgetService, OVERRIDE_PREFIX } from "../budget.mjs";
import { ROLES } from "../enums.mjs";
import { writeApprovalAudit } from "../approvals.mjs";

function audit(service, record) {
  try {
    if (service?.audit) service.audit(record);
    else writeApprovalAudit(record);
  } catch {
    return false;
  }
}

function callerMetadata({ caller, chatId, threadId }) {
  return { userId: caller?.userId, chatId, threadId };
}

async function refuseOverride(service, request, reason) {
  audit(service, { kind: "budget-override-refused", reason, ...callerMetadata(request) });
  if (!service.channel || request.chatId === undefined || request.chatId === null) return;
  try {
    await service.channel.send({
      chatId: request.chatId, threadId: request.threadId, text: "This override is no longer valid.",
    });
  } catch {
    audit(service, { kind: "budget-override-reply-failed", reason: "CHANNEL_SEND_FAILED", ...callerMetadata(request) });
  }
}

async function acknowledgeRelease(service, request, jobId) {
  audit(service, { kind: "budget-override-released", jobId, ...callerMetadata(request) });
  if (!service.channel || request.messageId === undefined || request.messageId === null) return;
  try {
    await service.channel.edit({
      chatId: request.chatId,
      messageId: request.messageId,
      threadId: request.threadId,
      text: `✅ Released over budget by ${String(request.caller?.userId ?? "owner")}`,
      replyMarkup: { inline_keyboard: [] },
    });
  } catch {
    // A failed edit cannot undo the committed release or trigger a second send.
    audit(service, { kind: "budget-override-reply-failed", jobId, reason: "CHANNEL_EDIT_FAILED", ...callerMetadata(request) });
  }
}

export default Object.freeze({
  prefix: OVERRIDE_PREFIX,
  sinceSlice: 11,
  available: true,
  roles: [ROLES[0]],
  async handle(_ctx, request = {}) {
    const service = getBudgetService();
    if (!service) {
      audit(null, { kind: "budget-override-refused", reason: "unavailable", ...callerMetadata(request) });
      return;
    }
    try {
      const result = await service.override(request);
      if (!result?.ok) {
        await refuseOverride(service, request, typeof result?.reason === "string" ? result.reason : "internal");
        return;
      }
      await acknowledgeRelease(service, request, result.jobId);
    } catch {
      await refuseOverride(service, request, "internal");
    }
  },
});
