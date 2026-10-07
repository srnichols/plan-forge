import { APPROVER_ROLES, getApprovalService, writeApprovalAudit } from "../approvals.mjs";

function audit(service, record) {
  try {
    if (service?.audit) service.audit(record);
    else writeApprovalAudit(record);
  } catch {
    // Callback handling must stay non-throwing if audit storage is unavailable.
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
      audit(service, {
        kind: "approval-refused",
        reason: typeof result?.reason === "string" ? result.reason : "INTERNAL",
        userId: caller?.userId,
        chatId,
        threadId,
      });
      if (service.channel && chatId !== undefined && chatId !== null) {
        try {
          await service.channel.send({ chatId, threadId, text: "This approval is no longer valid." });
        } catch {
          // The neutral response is best-effort; never expose internal details.
        }
      }
      return;
    }

    audit(service, {
      kind: "approval-decision",
      jobId: result.jobId,
      userId: caller?.userId,
      chatId,
      threadId,
      decision: result.decision,
      ...(result.quorum ? { quorum: result.quorum } : {}),
    });
    if (service.channel && messageId !== undefined && messageId !== null) {
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
  },
});
