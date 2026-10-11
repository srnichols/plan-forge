import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getProgressService } from "../progress.mjs";

function failureText(error) {
  const code = error instanceof ClawError ? error.code : "INTERNAL";
  return `${code}: Could not abort that job.`;
}

export default Object.freeze({
  name: "abort", aliases: [], args: "<job-id>", summary: "Abort a running job",
  details: "Request cancellation of a running job.", examples: ["/abort job-123", "/abort latest"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: true, sinceSlice: 12, group: "Work",
  async handle(context, { argsText, caller, chatId, threadId } = {}) {
    const ref = String(argsText ?? "").trim();
    if (!ref) return { text: "Usage: /abort <job-id|latest>" };
    const service = getProgressService();
    if (!service) return { text: "SERVICE_UNAVAILABLE: progress" };
    try {
      let job;
      if (ref.toLowerCase() === "latest") {
        try {
          job = service.resolveJob(ref, {
            projectId: context?.project?.id,
            chatId,
            threadId,
            states: ["running"],
          });
        } catch (error) {
          if (error?.code !== "JOB_NOT_FOUND") throw error;
          job = service.resolveJob(ref, {
            projectId: context?.project?.id,
            chatId,
            threadId,
            states: ["failed"],
          });
        }
      } else {
        job = service.resolveJob(ref, {
          projectId: context?.project?.id,
          chatId,
          threadId,
        });
      }
      const result = await service.abortJob(job, caller);
      return { text: result.text ?? `${result.error}: Could not abort that job.` };
    } catch (error) {
      return { text: failureText(error) };
    }
  },
});
