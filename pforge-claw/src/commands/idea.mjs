import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";

export default Object.freeze({
  name: "idea", aliases: [], args: "<idea>", summary: "Capture a project idea and echo its smelt id",
  details: "Submit an idea for later planning; this does not advance the interview.",
  examples: ["/idea add export support — echoes the smelt id", "/idea improve startup time — no interview advancement"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: true, sinceSlice: 7, group: "Ask & memory",
  async handle(context, args) {
    const service = this?.service ?? getBoundCaptureService();
    if (!service) throw new ClawError("SERVICE_UNAVAILABLE");
    return service.idea({
      project: args.project ?? context?.project,
      caller: args.caller,
      chatId: args.chatId,
      threadId: args.threadId,
      updateId: args.updateId,
      text: args.argsText ?? "",
    });
  },
});
