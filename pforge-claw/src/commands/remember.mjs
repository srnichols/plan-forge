import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";

export default Object.freeze({
  name: "remember", aliases: [], args: "<fact>", summary: "Save a project memory with type buttons",
  details: "Preview a fact and explicitly confirm its type. Captured or proposed material remains untrusted; L3-off projects store locally.",
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
      ...(args.adapter !== undefined ? { adapter: args.adapter } : {}),
      ...(args.messageId !== undefined ? { messageId: args.messageId } : {}),
      ...(args.origin !== undefined ? { origin: args.origin } : {}),
      ...(args.untrustedContext !== undefined ? { untrustedContext: args.untrustedContext } : {}),
      text: args.argsText ?? "",
    });
  },
});
