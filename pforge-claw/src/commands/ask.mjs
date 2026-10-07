import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";

export default Object.freeze({
  name: "ask", aliases: [], args: "<question>", summary: "Ask about the current project",
  details: "Ask a question about the configured project.", examples: ["/ask what changed", "/ask explain this failure"],
  roles: [...ROLES], scope: "project", mutating: false,
  available: true, sinceSlice: 6, group: "Ask & memory",
  async handle(context, args) {
    if (!this?.service) throw new ClawError("SERVICE_UNAVAILABLE");
    return this.service.ask({
      project: context?.project,
      caller: args?.caller,
      chatId: args?.chatId,
      threadId: args?.threadId,
      text: args?.argsText ?? "",
    });
  },
});
