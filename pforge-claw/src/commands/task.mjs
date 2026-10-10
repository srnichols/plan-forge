import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { preparationFailure, prepareProducer } from "../jobs/c2-job-producer.mjs";

export async function prepareTask(deps = {}, input = {}) {
  if (!deps.store || !deps.project?.id) return preparationFailure("SERVICE_UNAVAILABLE: task");
  const description = input.argsText;
  if (typeof description !== "string" || !description.trim()) return preparationFailure("Usage: /task <description>");
  return prepareProducer({ deps, input, type: "task", label: "Task" }, async () => ({
    fields: { description },
  }));
}

export default Object.freeze({
  name: "task", aliases: [], args: "<description>", summary: "Start an ad-hoc task",
  details: "Create a task in an isolated worktree.", examples: ["/task fix the parser", "/task add a dashboard filter"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: true, sinceSlice: 9, group: "Work",
  async handle(context, input) {
    try {
      return await prepareTask({ ...context?.services, project: context?.project }, input);
    } catch (error) {
      return preparationFailure(`${error instanceof ClawError ? error.code : "TASK_FAILED"}: The task was not created.`);
    }
  },
});
