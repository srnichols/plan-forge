import { ROLES } from "../enums.mjs";
import { getTriageService } from "../capture.mjs";

export default Object.freeze({
  prefix: "t",
  sinceSlice: 15,
  available: true,
  roles: [...ROLES],
  async handle(context, { payload, caller, chatId, threadId } = {}) {
    const service = getTriageService();
    if (!service) {
      try {
        context?.store?.append("audit", {
          kind: "callback-ignored",
          reason: "unbound",
          prefix: "t",
        });
      } catch (error) {
        context?.logger?.error?.("Capture callback audit could not be recorded", {
          code: error?.code ?? "STORE_WRITE_FAILED",
        });
      }
      return [];
    }
    return service.complete({ payload, caller, chatId, threadId });
  },
});
