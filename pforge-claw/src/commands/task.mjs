import { randomBytes } from "node:crypto";
import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { createJob, JOBS_STREAM, transition } from "../jobs/model.mjs";

export async function prepareTask({ store, project, caller, chatId, threadId } = {}, { argsText = "" } = {}) {
  if (!store || !project?.id) return { text: "SERVICE_UNAVAILABLE: task" };
  if (typeof argsText !== "string" || !argsText.trim()) return { text: "Usage: /task <description>" };
  const created = createJob({
    id: randomBytes(12).toString("hex"),
    type: "task",
    projectId: project.id,
  });
  const job = {
    ...created.job,
    description: argsText,
    callerId: String(caller?.userId ?? ""),
    createdAt: new Date().toISOString(),
    chatId: chatId ?? null,
    threadId: threadId ?? null,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  const awaiting = transition(job, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  return { text: `Task job ${job.id} is awaiting approval.` };
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
      return { text: `${error instanceof ClawError ? error.code : "TASK_FAILED"}: The task was not created.` };
    }
  },
});
