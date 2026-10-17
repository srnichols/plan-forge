import { APPROVER_ROLES, getApprovalService, writeApprovalAudit } from "../approvals.mjs";

function audit(service, record) {
  try {
    if (service?.audit) service.audit(record);
    else writeApprovalAudit(record);
  } catch {
    // Callback handling must stay non-throwing if audit storage is unavailable.
  }
}

async function refuseApproval(service, { result, caller, chatId, threadId }) {
  audit(service, {
    kind: "approval-refused",
    reason: typeof result?.reason === "string" ? result.reason : "INTERNAL",
    userId: caller?.userId,
    chatId,
    threadId,
  });
  if (!service.channel || chatId === undefined || chatId === null) return;
  try {
    await service.channel.send({ chatId, threadId, text: "This approval is no longer valid." });
  } catch {
    // The neutral response is best-effort; never expose internal details.
  }
}

function auditDecision(service, { result, caller, chatId, threadId }) {
  audit(service, {
    kind: "approval-decision",
    jobId: result.jobId,
    userId: caller?.userId,
    chatId,
    threadId,
    decision: result.decision,
    ...(result.quorum ? { quorum: result.quorum } : {}),
  });
}

async function editDecisionCard(service, { result, caller, chatId, threadId, messageId }) {
  if (!service.channel || messageId === undefined || messageId === null) return;
  try {
    const text = result.decision === "approve"
      ? `✅ Approved by ${String(caller?.userId ?? "approver")}`
      : "❌ Rejected";
    await service.channel.edit({
      chatId,
      messageId,
      threadId,
      text,
      replyMarkup: { inline_keyboard: [] },
    });
  } catch {
    // The approval remains committed even if the card cannot be updated.
  }
}

export default Object.freeze({
  prefix: "a",
  sinceSlice: 10,
  available: true,
  roles: APPROVER_ROLES,
  async handle(_ctx, { payload, caller, chatId, threadId, messageId } = {}) {
    const service = getApprovalService();
    if (!service) {
      audit(null, { kind: "approval-refused", reason: "unavailable", userId: caller?.userId, chatId, threadId });
      return;
    }
    let result;
    try {
      result = await service.decide({ payload, caller, chatId, threadId });
    } catch {
      result = { ok: false, reason: "INTERNAL" };
    }
    if (!result?.ok) {
      await refuseApproval(service, { result, caller, chatId, threadId });
      return;
    }

    auditDecision(service, { result, caller, chatId, threadId });
    await editDecisionCard(service, { result, caller, chatId, threadId, messageId });
  },
});
