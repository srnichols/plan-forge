import {
  getAlertsService,
  replyAlerts,
  writeAlertsAudit,
} from "../alerts.mjs";
import { getProgressService, writeProgressAudit } from "../progress.mjs";

const PAYLOAD_RE = /^(b|d|s):([0-9a-f]{8})$/;

export default Object.freeze({
  prefix: "x",
  sinceSlice: 14,
  available: true,
  async handle(context, { payload, caller, chatId, threadId } = {}) {
    const service = getAlertsService();
    if (!service) {
      const record = {
        kind: "alert.action",
        ref: null,
        action: "invalid",
        caller: String(caller?.userId ?? ""),
        outcome: "alerts-not-running",
      };
      if (!writeAlertsAudit(record)) writeProgressAudit(record);
      const progress = getProgressService();
      if (progress?.sendReply) {
        await progress.sendReply({ chatId, threadId, text: "alerts not running" });
      } else {
        await replyAlerts(chatId, threadId, "alerts not running");
      }
      return { ok: false, error: "alerts-not-running" };
    }

    const match = PAYLOAD_RE.exec(String(payload ?? ""));
    const [, action, ref] = match ?? [];
    const result = await service.handleAction({
      action,
      ref,
      caller,
      chatId,
      topicId: threadId,
    });
    if (!result?.ok) {
      await replyAlerts(chatId, threadId, result?.text ?? "Invalid alert action.");
    } else if (result.text) {
      await replyAlerts(chatId, threadId, result.text);
    }
    return result;
  },
});
