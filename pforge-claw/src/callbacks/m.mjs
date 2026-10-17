import { ROLES } from "../enums.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";
import { auditUnboundCapture } from "../capture-callback.mjs";

export default Object.freeze({
  prefix: "m",
  sinceSlice: 7,
  available: true,
  roles: [ROLES[0], ROLES[1]],
  async handle(context, input = {}) {
    const service = getBoundCaptureService();
    if (!service) {
      auditUnboundCapture(context, "m");
      return [];
    }
    return service.completeRemember(input);
  },
});
