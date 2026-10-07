import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";
import { getCrossprojectDependencies, prepareFanout } from "../crossproject.mjs";

export default Object.freeze({
  name: "fanout", aliases: [], args: "<task> [-- projects…]", summary: "Run one task across projects",
  details: "Create one coordinated fan-out across visible projects. One approval covers all targets; use -- followed by project ids to select targets.",
  examples: ["/fanout check dependencies", "/fanout update docs -- alpha beta"],
  roles: [ROLES[0], ROLES[1]], scope: "general", mutating: true,
  available: true, sinceSlice: 16, group: "Work",
  async handle(context = {}, input = {}) {
    try {
      return prepareFanout({
        ...(getCrossprojectDependencies() ?? {}),
        ...(context.services ?? {}),
        caller: input.caller,
        chatId: input.chatId,
        threadId: input.threadId,
      }, input);
    } catch (error) {
      const code = error instanceof ClawError ? error.code : "FANOUT_FAILED";
      return { text: `${code}: Fan-out was not created.` };
    }
  },
});
