import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "new", aliases: [], args: "", summary: "Start a fresh Forge-Master conversation in this topic.",
  details: "Start a fresh Forge-Master conversation in this topic.",
  examples: ["/new", "/new"],
  // D8: viewers are limited to ask/help/status.
  roles: ROLES.filter((role) => role !== "viewer"), scope: "project", mutating: false,
  available: true, sinceSlice: 6, group: "Ask & memory",
  async handle(context, args) {
    if (!this?.service) throw new ClawError("SERVICE_UNAVAILABLE");
    return this.service.resetSession({
      project: context?.project,
      chatId: args?.chatId,
      threadId: args?.threadId,
    });
  },
});
