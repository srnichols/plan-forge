import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";

export default Object.freeze({
  name: "remember", aliases: [], args: "<fact>", summary: "Save a project memory with type buttons",
  details: "Save a fact to the current project and choose its memory type with a button.",
  examples: ["/remember API uses cursors — choose a type", "/remember tests run with vitest — choose a type"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: true, sinceSlice: 7, group: "Ask & memory",
  async handle(context, args) {
    const service = this?.service ?? getBoundCaptureService();
    if (!service) throw new ClawError("SERVICE_UNAVAILABLE");
    return service.startRemember({
      project: args.project ?? context?.project,
      caller: args.caller,
      chatId: args.chatId,
      threadId: args.threadId,
      updateId: args.updateId,
      text: args.argsText ?? "",
    });
  },
});
