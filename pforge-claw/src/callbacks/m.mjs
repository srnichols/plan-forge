import { ROLES } from "../enums.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";

export default Object.freeze({
  prefix: "m",
  sinceSlice: 7,
  available: true,
  roles: [ROLES[0], ROLES[1]],
  async handle(context, { payload, caller, chatId, threadId } = {}) {
    const service = getBoundCaptureService();
    if (!service) {
      try {
        context?.store?.append("audit", { kind: "callback-ignored", reason: "unbound" });
      } catch (error) {
        context?.logger?.error?.("Memory callback audit could not be recorded", {
          code: error?.code ?? "STORE_WRITE_FAILED",
        });
      }
      return [];
    }
    return service.completeRemember({ payload, caller, chatId, threadId });
  },
});
