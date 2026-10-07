import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";

export default Object.freeze({
  name: "recall", aliases: [], args: "<query>", summary: "Search saved memories in this project",
  details: "Search saved memories for the current project only; results include their record references.",
  examples: ["/recall deployment — echoes record references", "/recall API decisions — current project only"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: true, sinceSlice: 7, group: "Ask & memory",
  async handle(context, args) {
    const service = this?.service ?? getBoundCaptureService();
    if (!service) throw new ClawError("SERVICE_UNAVAILABLE");
    return service.recall({
      project: args.project ?? context?.project,
      caller: args.caller,
      chatId: args.chatId,
      threadId: args.threadId,
      updateId: args.updateId,
      text: args.argsText ?? "",
    });
  },
});
