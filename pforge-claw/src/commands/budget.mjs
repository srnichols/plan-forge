import { ROLES } from "../enums.mjs";
import { getBudgetService } from "../budget.mjs";

export default Object.freeze({
  name: "budget", aliases: [], args: "[today]", summary: "Show budget usage",
  details: "Show daily USD and premium-request budgets in the configured time zone, including unreported usage. Owners retrieve fresh, single-use hold cards with /budget in the job's original chat and topic; retrieval never approves a job.",
  examples: ["/budget", "/budget today"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: true, sinceSlice: 11, group: "Status & budget",
  async handle(context = {}, input = {}) {
    const service = getBudgetService();
    if (!service) return { text: "SERVICE_UNAVAILABLE: budget" };
    const args = input.args ?? [];
    if (args.some((argument) => argument !== "today") || args.length > 1) {
      return { text: "Usage: /budget [today]" };
    }
    const visibleProjects = (service.config?.projects ?? []).filter((project) => (
      input.caller?.role === ROLES[0] || project.visibility !== "restricted"
    ));
    const scope = context.scope === "project" && context.project?.id
      ? { projectId: context.project.id }
      : { visibleProjects };
    return {
      text: service.render(scope),
      ...service.reissueHeld({
        ...scope, caller: input.caller, chatId: input.chatId, threadId: input.threadId,
      }),
    };
  },
});
