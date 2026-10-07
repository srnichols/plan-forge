import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { getProgressService } from "../progress.mjs";

function failureText(error) {
  const code = error instanceof ClawError ? error.code : "INTERNAL";
  return `${code}: Could not retry that job.`;
}

export default Object.freeze({
  name: "retry", aliases: [], args: "<job-id>", summary: "Retry a failed job",
  details: "Create a retry for a retryable job.", examples: ["/retry job-123", "/retry latest"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: true, sinceSlice: 12, group: "Work",
  async handle(context, { argsText, caller, chatId, threadId } = {}) {
    const ref = String(argsText ?? "").trim();
    if (!ref) return { text: "Usage: /retry <job-id|latest>" };
    const service = getProgressService();
    if (!service) return { text: "SERVICE_UNAVAILABLE: progress" };
    try {
      const job = service.resolveJob(ref, {
        projectId: context?.project?.id,
        chatId,
        threadId,
        states: ref.toLowerCase() === "latest" ? ["failed"] : [],
      });
      const result = await service.createRecoveryJob(job, { mode: "retry", caller, chatId, threadId });
      return { text: result.text ?? `${result.error}: Could not retry that job.` };
    } catch (error) {
      return { text: failureText(error) };
    }
  },
});
