import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";
import { buildStatusRollup, getCrossprojectDependencies, renderStatusRollup } from "../crossproject.mjs";

export default Object.freeze({
  name: "status", aliases: [], args: "", summary: "Show visible project and job status",
  details: "In #general, show a rollup of visible projects. In a project topic, show only that project.",
  examples: ["/status", "/status jobs"],
  roles: [...ROLES], scope: "both", mutating: false,
  available: true, sinceSlice: 16, group: "Status & budget",
  async handle(context = {}, input = {}) {
    const args = input.args ?? [];
    if (args.length > 1 || args.some((argument) => argument !== "jobs")) {
      return { text: "STATUS_USAGE: Usage: /status [jobs]" };
    }
    const active = getCrossprojectDependencies() ?? {};
    const services = { ...active, ...(context.services ?? {}) };
    if (!services.store) return { text: "SERVICE_UNAVAILABLE: Status unavailable." };
    try {
      const rollup = buildStatusRollup({
        store: services.store,
        budget: services.budget,
        config: services.config,
        registry: services.registry,
        scope: context.project ? "project" : "general",
        projectId: context.project?.id,
        now: services.now,
      });
      return { text: renderStatusRollup(rollup) };
    } catch (error) {
      const code = error instanceof ClawError ? error.code : "STATUS_UNAVAILABLE";
      return { text: `${code}: Status unavailable.` };
    }
  },
});
