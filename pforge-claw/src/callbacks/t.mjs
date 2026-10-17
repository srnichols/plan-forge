import { ROLES } from "../enums.mjs";
import { getTriageService } from "../capture.mjs";
import { auditUnboundCapture } from "../capture-callback.mjs";

export default Object.freeze({
  prefix: "t",
  sinceSlice: 15,
  available: true,
  roles: [...ROLES],
  async handle(context, input = {}) {
    const service = getTriageService();
    if (!service) {
      auditUnboundCapture(context, "t");
      return [];
    }
    return service.complete(input);
  },
});
