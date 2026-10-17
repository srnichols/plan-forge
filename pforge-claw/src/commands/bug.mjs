import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getBoundCaptureService } from "../handlers/capture-commands.mjs";
import { captureProvenance } from "../capture-policy.mjs";

export default Object.freeze({
  name: "bug", aliases: [], args: "<description>", summary: "Record a project bug and echo its id or link",
  details: "Record a bug for the current project; this command does not fix it.",
  examples: ["/bug login fails on retry — records the bug", "/bug export omits empty values — echoes its id or link"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: false,
  available: true, sinceSlice: 7, group: "Ask & memory",
  async handle(context, args) {
    const service = this?.service ?? getBoundCaptureService();
    if (!service) throw new ClawError("SERVICE_UNAVAILABLE");
    return service.bug({
      project: args.project ?? context?.project,
      caller: args.caller,
      chatId: args.chatId,
      threadId: args.threadId,
      updateId: args.updateId,
      text: args.argsText ?? "",
      ...captureProvenance(args),
    });
  },
});
