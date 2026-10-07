import { getBudgetService } from "../budget.mjs";
import { ROLES } from "../enums.mjs";
import { writeApprovalAudit } from "../approvals.mjs";

function audit(service, record) {
  try {
    if (service?.audit) service.audit(record);
    else writeApprovalAudit(record);
  } catch {
    // Callback acknowledgement must not expose storage failures.
  }
}

export default Object.freeze({
  prefix: "b",
  sinceSlice: 11,
  available: true,
  roles: [ROLES[0]],
  async handle(_ctx, { payload, caller, chatId, threadId, messageId } = {}) {
    const service = getBudgetService();
    if (!service) {
      audit(null, { kind: "budget-override-refused", reason: "unavailable", userId: caller?.userId, chatId, threadId });
      return;
    }
    try {
      const result = await service.override({ payload, caller, chatId, threadId });
      if (!result?.ok) {
        audit(service, {
          kind: "budget-override-refused",
          reason: typeof result?.reason === "string" ? result.reason : "internal",
          userId: caller?.userId,
          chatId,
          threadId,
        });
        if (service.channel && chatId !== undefined && chatId !== null) {
          try {
            await service.channel.send({ chatId, threadId, text: "This override is no longer valid." });
          } catch {
            // A neutral refusal is best-effort.
          }
        }
        return;
      }
      audit(service, {
        kind: "budget-override-released",
        jobId: result.jobId,
        userId: caller?.userId,
        chatId,
        threadId,
      });
      if (service.channel && messageId !== undefined && messageId !== null) {
        try {
          await service.channel.edit({
            chatId,
            messageId,
            threadId,
            text: `✅ Released over budget by ${String(caller?.userId ?? "owner")}`,
            replyMarkup: { inline_keyboard: [] },
          });
        } catch {
          // The release is committed even if the card cannot be updated.
        }
      }
    } catch {
      audit(service, {
        kind: "budget-override-refused", reason: "internal",
        userId: caller?.userId, chatId, threadId,
      });
      if (service.channel && chatId !== undefined && chatId !== null) {
        try {
          await service.channel.send({ chatId, threadId, text: "This override is no longer valid." });
        } catch {
          // Callback handling remains non-throwing.
        }
      }
    }
  },
});
